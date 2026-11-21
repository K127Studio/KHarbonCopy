"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Engine } from "@/lib/worker/client";
import type { KhmerInfo, SourceInfo } from "@/lib/worker/protocol";
import type { AnalysisOptions, GlyphReport, StyleModel } from "@/lib/analysis/model";
import { DEFAULT_OPTIONS } from "@/lib/analysis/model";
import { CATEGORIES, Category, DEFAULT_REFERENCE } from "@/lib/analysis/categories";
import { DEFAULT_PARAMS, TransferParams } from "@/lib/transform/params";
import type { TransferResult } from "@/lib/transform/font";
import type { FontNames } from "@/lib/font/sfnt";
import { evalWave } from "@/lib/math/linalg";
import { GlyphCard, GlyphDetail, STAGE_TABS } from "./GlyphViews";
import LoadingOverlay, { ProgressMsg } from "./LoadingOverlay";
import FontSelect from "./FontSelect";
import Wordmark from "./Wordmark";
import { estimateAnalysis, fmtDuration } from "@/lib/analysis/estimate";
import type { RankEntry } from "@/lib/analysis/rank";
import { Heatmap, LinePlot, PolarPlot, ringsPath } from "./charts";
import { Bar, Button, Callout, Check, DataTable, DropZone, KV, Label, PagedGrid, Select, Slider, Stat, Stepper, Tabs, TextField } from "./ui";

interface Manifest {
  reference: { id: string; name: string; category: Category; trait?: string; files: string[] }[];
  khmer: { id: string; name: string; style: string; files: string[] }[];
}

type Busy = { msg: string; frac: number } | null;

const SAMPLE = "សួស្តី កម្ពុជា ភាសាខ្មែរ\nកខគឃង ចឆជឈញ ដឋឌឍណ តថទធន បផពភម យរលវ សហឡអ\n០១២៣៤៥៦៧៨៩";

function download(bytes: Uint8Array | string, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const pct = (v: number, d = 1) => (isFinite(v) ? `${(v * 100).toFixed(d)}%` : "—");

export default function Studio() {
  const engine = useRef<Engine | null>(null);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  /** long phases get the full-screen overlay with curiosities */
  const [longTask, setLongTask] = useState<string | null>(null);
  const [longEstimate, setLongEstimate] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [srcName, setSrcName] = useState("");
  const [src, setSrc] = useState<SourceInfo | null>(null);
  const [srcFace, setSrcFace] = useState<string | null>(null);
  const [category, setCategory] = useState<Category>("sans-serif");
  const [refId, setRefId] = useState("lato");
  const [opts, setOpts] = useState<AnalysisOptions>(DEFAULT_OPTIONS);

  const [model, setModel] = useState<StyleModel | null>(null);
  const [glyphs, setGlyphs] = useState<GlyphReport[]>([]);
  const [refNote, setRefNote] = useState("");
  const [stage, setStage] = useState(6);
  const [detail, setDetail] = useState<GlyphReport | null>(null);
  const [screen, setScreen] = useState(0);
  const go = (n: number) => setScreen(n);
  const [tab, setTab] = useState<"overview" | "refinement" | "wave" | "texture" | "glyphs">("overview");
  const [setupTab, setSetupTab] = useState<"precision" | "refinement" | "characters">("precision");
  const [ktools, setKtools] = useState<"font" | "shape" | "detail" | "output">("font");
  const [logPage, setLogPage] = useState(0);
  const [glyphPage, setGlyphPage] = useState(0);
  /** Khmer preview grid pages independently of the Latin comparison grid */
  const [khGlyphPage, setKhGlyphPage] = useState(0);
  const [editText, setEditText] = useState(false);
  const [ktab, setKtab] = useState<"text" | "glyphs" | "report">("text");
  const [sortBy, setSortBy] = useState<"char" | "error">("char");
  const [hideOutliers, setHideOutliers] = useState(false);

  const [khId, setKhId] = useState("kantumruypro");
  const [khFile, setKhFile] = useState(0);
  const [khInfo, setKhInfo] = useState<KhmerInfo | null>(null);
  const [khFace, setKhFace] = useState<string | null>(null);
  const [params, setParams] = useState<TransferParams>(DEFAULT_PARAMS);
  const [result, setResult] = useState<TransferResult | null>(null);
  const [outFace, setOutFace] = useState<string | null>(null);
  const [text, setText] = useState(SAMPLE);
  const [size, setSize] = useState(64);
  const [names, setNames] = useState<FontNames>({
    family: "", style: "Regular", designer: "", designerURL: "", manufacturer: "", vendorURL: "",
    copyright: "Font generated with KHarbonCopy", license: "", licenseURL: "", version: "1.000", description: "", trademark: "", vendorID: "NONE",
  });
  const [namesDirty, setNamesDirty] = useState(true);
  const faceSeq = useRef(0);

  useEffect(() => {
    engine.current = new Engine();
    fetch("/fonts/manifest.json").then((r) => r.json()).then(setManifest).catch(() => setError("Font manifest not found: run `npm run fonts`."));
    return () => engine.current?.terminate();
  }, []);

  const run = useCallback(async <T,>(fn: (progress: (m: string, f: number) => void) => Promise<T>) => {
    setError(null);
    setBusy({ msg: "starting…", frac: 0 });
    try {
      return await fn((msg, frac) => setBusy({ msg, frac }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, []);

  const registerFace = async (bytes: ArrayBuffer | Uint8Array, prefix: string) => {
    const name = `${prefix}-${++faceSeq.current}`;
    const buf = bytes instanceof Uint8Array ? bytes.slice().buffer : bytes.slice(0);
    const face = new FontFace(name, buf as ArrayBuffer);
    await face.load();
    document.fonts.add(face);
    return name;
  };

  // ------------------------------------------------------------------ source
  const onSource = async (file: File) => {
    const bytes = await file.arrayBuffer();
    setSrcName(file.name);
    setModel(null); setGlyphs([]); setResult(null); setScreen(0);
    const r = await run((p) => engine.current!.call<"sourceInfo">({ type: "loadSource", bytes: bytes.slice(0) }, p));
    if (!r) return;
    setSrc(r.info);
    setCategory(r.info.guess.category);
    setRefId(DEFAULT_REFERENCE[r.info.guess.category]);
    try { setSrcFace(await registerFace(bytes, "src")); } catch { setSrcFace(null); }
    setNames((n) => ({ ...n, family: n.family || `${r.info.family} Khmer` }));
    // rank every bundled reference against the new source and pre-select the closest one
    setRanking(null);
    if (manifest?.reference.length) {
      const rk = await run((p) => engine.current!.call<"rank">({ type: "rank", references: manifest.reference }, p));
      if (rk && rk.ranking.length) {
        setRanking(rk.ranking);
        setRefId(rk.ranking[0].id);
        setCategory(rk.ranking[0].category as Category);
      }
    }
  };

  const [ranking, setRanking] = useState<RankEntry[] | null>(null);
  const rankOf = (id: string) => ranking?.find((r) => r.id === id);
  const refs = (manifest?.reference ?? []).slice().sort((a, b) => (rankOf(a.id)?.score ?? 1e9) - (rankOf(b.id)?.score ?? 1e9));
  const reference = refs.find((r) => r.id === refId);

  const analyze = async () => {
    if (!reference) return;
    setLongTask(`Analysing ${src?.family ?? "the source"} against ${reference.name}`);
    setLongEstimate(estimate?.seconds ?? null);
    const r = await run((p) => engine.current!.call<"analysis">({ type: "analyze", reference, category, options: opts }, p));
    setLongTask(null);
    if (!r) return;
    setModel(r.model);
    setGlyphs(r.glyphs);
    setRefNote(r.refNote);
    setParams((pp) => ({ ...pp, harmonics: r.model.normalFn.K }));
    setTab("overview");
    go(2);
  };

  // ------------------------------------------------------------------ khmer
  const khEntry = manifest?.khmer.find((k) => k.id === khId);
  const loadKhmer = async (opt: { url?: string; bytes?: ArrayBuffer }) => {
    const r = await run((p) => engine.current!.call<"khmerInfo">({ type: "loadKhmer", ...opt, bytes: opt.bytes?.slice(0) }, p));
    if (!r) return;
    setKhInfo(r.info);
    setResult(null);
    try {
      const bytes = opt.bytes ?? (await (await fetch(opt.url!)).arrayBuffer());
      setKhFace(await registerFace(bytes, "kh"));
    } catch { setKhFace(null); }
    const orig = r.info.names;
    setNames((n) => ({
      ...n,
      license: orig[13] ?? n.license,
      licenseURL: orig[14] ?? n.licenseURL,
    }));
  };
  useEffect(() => {
    if (khEntry && engine.current) loadKhmer({ url: khEntry.files[Math.min(khFile, khEntry.files.length - 1)] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [khId, khFile, manifest]);

  const transfer = async () => {
    setLongTask(`Generating ${names.family || "the Khmer font"}`);
    // generation scales with glyph count and sampling density; reuse the last measured run when available
    setLongEstimate(result ? result.seconds * 1.05 : (khInfo?.numGlyphs ?? 500) * 0.045 * (2 / Math.max(0.5, params.step)));
    const r = await run((p) => engine.current!.call<"transfer">({ type: "transfer", params, names: { ...names, family: names.family || "Untitled Khmer" } }, p));
    setLongTask(null);
    if (!r) return null;
    setResult(r.result);
    setNamesDirty(false);
    try { setOutFace(await registerFace(r.result.ttf, "out")); } catch (e) { setError("The browser rejected the generated font: " + String(e)); }
    return r.result;
  };

  const exportFont = async (fmt: "ttf" | "woff") => {
    let res = result;
    if (!res || namesDirty) res = await transfer();
    if (!res) return;
    const base = names.family.replace(/[^A-Za-z0-9]+/g, "") + "-" + names.style.replace(/[^A-Za-z0-9]+/g, "");
    if (fmt === "ttf") download(res.ttf, `${base}.ttf`, "font/ttf");
    else {
      const r = await run((p) => engine.current!.call<"woff">({ type: "woff", ttf: res!.ttf }, p));
      if (r) download(r.bytes, `${base}.woff`, "font/woff");
    }
  };

  const setP = <K extends keyof TransferParams>(k: K, v: TransferParams[K]) => setParams((p) => ({ ...p, [k]: v }));
  const setN = (k: keyof FontNames) => (v: string) => { setNames((n) => ({ ...n, [k]: v })); setNamesDirty(true); };
  const setO = <K extends keyof AnalysisOptions>(k: K, v: AnalysisOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const estimate = useMemo(() => {
    if (!src) return null;
    const G = Math.min(new Set([...opts.charset]).size, src.latinCount + 8);
    return estimateAnalysis(opts, src.meanOutline ?? 2500, G);
  }, [src, opts]);
  const waveFns = useMemo(() => {
    if (!model) return null;
    const { coef, K, D = 0 } = model.normalFn;
    return [
      { v: 1, color: "var(--src)", label: "top (v=1)" },
      { v: 0.5, color: "var(--accent)", label: "middle" },
      { v: 0, color: "var(--good)", label: "base (v=0)" },
    ].map((h) => ({ fn: (phi: number) => evalWave(coef, phi, h.v, K, D), color: h.color, label: h.label }));
  }, [model]);
  const inliers = glyphs.filter((g) => !g.outlier);
  const deg = (t: number) => `${((Math.atan(t) * 180) / Math.PI).toFixed(2)}°`;

  const stepsDef = [
    { label: "Source", done: !!src, enabled: true },
    { label: "Setup", done: !!model, enabled: !!src },
    { label: "Screening", done: !!model && screen > 2, enabled: !!model },
    { label: "Khmer", done: !!result, enabled: !!model },
    { label: "Export", done: false, enabled: !!model && !!khInfo },
  ];
  const sortedGlyphs = glyphs
    .filter((g) => !hideOutliers || !g.outlier)
    .slice()
    .sort((a, b) => {
      if (sortBy === "char") return 0;
      const ea = (stage === 6 ? a.refined : a.stats[stage])?.meanAbs ?? 0;
      const eb = (stage === 6 ? b.refined : b.stats[stage])?.meanAbs ?? 0;
      return eb - ea;
    });

  return (
    <div className="flex h-dvh flex-col overflow-hidden font-sans text-sm">
      {/* ---------------------------------------------------------- top bar */}
      <header className="relative shrink-0 border-b border-line bg-panel/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1480px] items-center gap-4 px-4 py-2.5">
          <button onClick={() => go(0)} className="flex shrink-0 items-center gap-3 text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <span className="px-1.5 py-1 shadow-sm"><img src="/images/logo.png" alt="KHarbonCopy logo" className="h-12 w-auto" /></span>
            <div className="leading-tight">
              <div className="text-[19px] font-semibold leading-none tracking-tight">
                <Wordmark />
              </div>
              <div className="hidden text-[11px] mt-0.5 text-muted sm:block">Typeface style analysis · Khmer transfer</div>
            </div>
          </button>
          <div className="min-w-0 flex-1 px-2">
            {busy ? (
              <div className="mx-auto flex max-w-md items-center gap-2 font-mono text-[11px] text-muted">
                <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-accent" />
                <span className="truncate"><ProgressMsg msg={busy.msg} /></span>
                {busy.frac > 0 && <span className="ml-auto shrink-0">{Math.round(busy.frac * 100)}%</span>}
              </div>
            ) : error ? (
              <div className="mx-auto flex max-w-md items-center gap-2 text-xs text-src">
                <span>⚠</span><span className="truncate">{error}</span>
                <button onClick={() => setError(null)} className="ml-auto shrink-0 text-muted hover:text-ink">dismiss</button>
              </div>
            ) : null}
          </div>
          <a href="/why" target="_blank" rel="noopener noreferrer"
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-line px-3 py-1 text-[11px] text-muted transition hover:border-accent hover:text-ink md:inline-flex">
            Why <span aria-hidden>↗</span>
          </a>
          <a href="/how-it-works" target="_blank" rel="noopener noreferrer"
            className="hidden shrink-0 items-center gap-1.5 rounded-full border border-transparent px-3 py-1 text-[11px] text-white bg-brand-red transition hover:border-white md:inline-flex">
            ∑ How it works <span aria-hidden>↗</span>
          </a>
          <Stepper current={screen} onSelect={go} steps={stepsDef} />
        </div>
        <div className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden">
          {busy && (busy.frac > 0
            ? <div className="h-full bg-accent transition-all duration-300" style={{ width: `${Math.round(busy.frac * 100)}%` }} />
            : <div className="absolute inset-y-0 w-1/3 bg-accent" style={{ animation: "indeterminate 1.1s ease-in-out infinite" }} />)}
        </div>
      </header>

      <main className="mx-auto flex min-h-0 w-full max-w-[1480px] flex-1 flex-col p-3 sm:p-4">
        {/* ------------------------------------------------------------ 1 · welcome + source */}
        {screen === 0 && (
          <Screen step={1} title="Source typeface" subtitle="Load the font whose style you want to reproduce."
            nav={<StepNav
              extra={<span className="hidden text-[11px] text-muted md:inline">
                Runs locally in your browser · MIT License · bundled fonts: SIL OFL / Apache 2.0 ·{" "}
                <a href="/how-it-works" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">the mathematics ↗</a>
              </span>}
              next={<Button variant="primary" disabled={!src} onClick={() => go(1)}>Analysis setup →</Button>} />}>
            <div className="grid h-full gap-6 lg:grid-cols-[1.15fr_1fr]">
              <div className="flex min-w-0 flex-col justify-center gap-4 rounded-xl border border-line bg-gradient-to-br from-brand-red/20 to-panel p-5 [@media(max-height:719px)]:gap-3 [@media(max-height:719px)]:p-4 [@media(min-height:820px)]:gap-5 [@media(min-height:820px)]:p-6">
                {/* top: heading + paragraph (2/3) beside the logo (1/3) */}
                <div className="grid items-center gap-5 sm:grid-cols-[2fr_1fr]">
                  <div className="min-w-0 space-y-2.5">
                    <h3 className="text-2xl font-bold leading-tight tracking-tight xl:text-[28px] min-[1440px]:text-[34px]">
                      Copy the <span className="text-brand-red">soul</span> of a typeface<br />into <span className="text-accent">Khmer</span>.
                    </h3>
                    <p className="text-sm leading-relaxed text-muted">
                      <Wordmark className="font-semibold text-ink" /> compares every outline of your font with a reference of the same category at full vector precision,
                      writes exact wave functions describing how each point departs from it, refines them iteratively, and replays them on a Khmer typeface.
                    </p>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/images/logo.png" alt="" className="mx-auto hidden h-auto max-h-36 w-full max-w-[220px] object-contain sm:block" />
                </div>
                <ol className="grid gap-2 text-xs sm:grid-cols-2">
                  {[
                    ["Measure", "slant, width, weight, contrast and stress"],
                    ["Model", "O(φ) Fourier series, corner kernels, slice fields, texture spectrum"],
                    ["Refine", "global and per-glyph descent until the error stops falling"],
                    ["Transfer", "applied to a Khmer font, smoothed, fitted to TrueType curves"],
                  ].map(([t, d], i) => (
                    <li key={t} className="flex gap-2.5 rounded-lg border border-line bg-panel/70 px-2.5 py-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded-md bg-accent/10 text-[10px] font-bold text-accent">{i + 1}</span>
                      <span><b className="font-semibold text-ink">{t}</b> <span className="text-muted">— {d}</span></span>
                    </li>
                  ))}
                </ol>
                {/* opens in a new tab so a loaded font and the current step are not lost */}
                <a href="/why" target="_blank" rel="noopener noreferrer"
                  className="group flex items-center justify-center gap-2 rounded-full bg-accent whitespace-nowrap px-4 py-3 text-center text-xs font-semibold uppercase tracking-[0.04em] sm:gap-3 sm:px-6 sm:py-3 sm:text-base sm:tracking-[0.14em] text-accent-ink shadow-lg shadow-accent/20 transition hover:-translate-y-0.5 hover:shadow-accent/40 xl:text-lg">
                  The story behind the trace
                  <span aria-hidden className="transition-transform group-hover:translate-x-1">→</span>
                </a>
              </div>
              <div className="flex min-h-[260px] min-w-0 flex-col gap-4">
                <DropZone fill={!src} accept=".ttf,.otf,.woff,.woff2" onFile={onSource} label={srcName || "Drop a font here or click to browse"} sub={src ? "click or drop to replace" : "TTF · OTF · WOFF · WOFF2"} />
                {src ? (
                  <>
                    {srcFace && <div className="truncate rounded-xl border border-line bg-sunken/60 px-4 py-3 text-3xl leading-tight" style={{ fontFamily: srcFace }}>Hamburgefonstiv 0123</div>}
                    <KV rows={[
                      ["family", `${src.family} · ${src.style}`],
                      ["UPM / glyphs", `${src.upm} / ${src.numGlyphs} (${src.latinCount} basic Latin)`],
                      ["axes", Object.keys(src.axes).join(", ") || "—"],
                      ["x-height / caps", `${src.metrics.xHeight.toFixed(1)} / ${src.metrics.capHeight.toFixed(1)} (1000 em)`],
                      ["stems V / H", `${src.metrics.vstem.toFixed(2)} / ${src.metrics.hstem.toFixed(2)}`],
                      ["slant", deg(src.metrics.slant)],
                      ["detected category", `${src.guess.category} (${Math.round(src.guess.confidence * 100)}%)`],
                    ]} />
                    <p className="text-xs text-muted">{src.guess.evidence.join(" · ")}</p>
                  </>
                ) : (
                  <Callout tone="info">The font is parsed locally; nothing is uploaded. Latin glyphs (A–Z, a–z, 0–9) are used for the measurement.</Callout>
                )}
              </div>
            </div>
          </Screen>
        )}

        {/* ------------------------------------------------------------ 2 · setup */}
        {screen === 1 && src && (
          <Screen step={2} title="Analysis setup" subtitle="Choose the reference of the same category and how precise the measurement and refinement should be."
            nav={<StepNav
              back={<Button onClick={() => go(0)}>← Source</Button>}
              extra={model && <Button onClick={() => go(2)}>Open last screening</Button>}
              next={<Button variant="primary" disabled={!src || !!busy} onClick={analyze}>{busy ? "Analysing…" : model ? "Re-run analysis →" : "Run analysis →"}</Button>} />}>
            <div className="grid h-full min-h-0 gap-8 lg:grid-cols-[1fr_1.25fr]">
              <div className="flex min-w-0 flex-col gap-3">
                <Label>Reference</Label>
                <div className="grid grid-cols-2 gap-3">
                  <Select label="category" value={category} onChange={(e) => { const c = e.target.value as Category; setCategory(c); setRefId(DEFAULT_REFERENCE[c]); }}>
                    {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
                  </Select>
                  <FontSelect label="reference typeface" value={refId} onChange={setRefId}
                    options={refs.map((r, i) => ({
                      id: r.id, label: r.name,
                      meta: `${r.category}${r.trait ? " · " + r.trait : ""}${rankOf(r.id) ? ` · score ${rankOf(r.id)!.score.toFixed(1)}${ranking && i === 0 ? " · closest" : ""}` : ""}`,
                      sample: "Hamburgefonstiv",
                      url: r.files.find((f) => /Regular|VF/.test(f)) ?? r.files[0],
                    }))} />
                </div>
                {ranking && (
                  <div className="rounded-xl border border-line bg-sunken/40 p-3">
                    <div className="mb-1.5 flex items-baseline justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Closest references</span>
                      <a href="/how-it-works#affine" target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent hover:underline">how the score works ↗</a>
                    </div>
                    <div className="space-y-0.5">
                      {ranking.slice(0, 5).map((r, i) => (
                        <button key={r.id} onClick={() => { setRefId(r.id); setCategory(r.category as Category); }}
                          title={r.shape != null ? `shape ${r.shape.toFixed(1)} · slant Δ ${(r.slantDiff ?? 0).toFixed(1)}°` : undefined}
                          className={`flex w-full items-center gap-3 rounded-lg px-2 py-1 text-left text-xs transition ${r.id === refId ? "bg-accent/10 text-ink" : "text-muted hover:bg-sunken"}`}>
                          <span className="w-4 font-mono">{i + 1}</span>
                          <span className="min-w-0 flex-1 truncate"><b className="font-medium text-ink">{r.name}</b> · {r.category}{r.trait ? ` · ${r.trait}` : ""}</span>
                          <Bar value={1 - (r.score - ranking[0].score) / (ranking[ranking.length - 1].score - ranking[0].score || 1)} tone={i === 0 ? "good" : "accent"} />
                          <span className="w-10 text-right font-mono">{r.score.toFixed(1)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Callout tone="info">
                  Detected: <b>{src.guess.category}</b> ({Math.round(src.guess.confidence * 100)}%). The reference is instanced at the weight that best matches the source,
                  so the measured differences describe style rather than boldness.
                </Callout>
                <Check label="match reference weight to the source" checked={opts.matchWeight} onChange={(v) => setO("matchWeight", v)} />
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                {estimate && (
                  <div className="rounded-xl border border-line bg-sunken/50 p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">Estimated duration</span>
                      <span className="font-mono text-xl font-semibold">≈ {fmtDuration(estimate.seconds)}</span>
                    </div>
                    <div className="mt-2 space-y-1">
                      {estimate.parts.map((p) => (
                        <div key={p.label} className="flex items-center gap-3 text-xs text-muted">
                          <span className="flex-1 truncate">{p.label}</span>
                          <Bar value={p.seconds / (estimate.seconds || 1)} />
                          <span className="w-20 shrink-0 whitespace-nowrap text-right font-mono">{fmtDuration(p.seconds)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <Tabs items={[
                  { id: "precision" as const, label: "Precision" },
                  { id: "refinement" as const, label: "Refinement" },
                  { id: "characters" as const, label: "Characters" },
                ]} value={setupTab} onChange={setSetupTab} />
                {setupTab === "precision" && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <Slider label="sample step (u)" value={opts.step} min={0.25} max={4} step={0.25} onChange={(v) => setO("step", v)} />
                    <Slider label="O(φ) harmonics" value={opts.harmonics} min={1} max={16} step={1} onChange={(v) => setO("harmonics", v)} />
                    <Slider label="height degree of O(φ, v)" value={opts.heightDegree ?? 2} min={0} max={3} step={1} onChange={(v) => setO("heightDegree", v)} fmt={(v) => (v === 0 ? "off" : String(v))} />
                    <Slider label="slices per axis" value={opts.slices} min={16} max={160} step={8} onChange={(v) => setO("slices", v)} />
                    <Slider label="field grid" value={opts.grid} min={6} max={32} step={1} onChange={(v) => setO("grid", v)} />
                    <Slider label="corner window" fmt={(v) => (v === 0 ? "auto" : String(v))} value={opts.cornerWindow} min={0} max={160} step={4} onChange={(v) => setO("cornerWindow", v)} />
                    <Slider label="texture cutoff λ (u)" value={opts.textureCutoff} min={40} max={400} step={10} onChange={(v) => setO("textureCutoff", v)} />
                  </div>
                )}
                {setupTab === "refinement" && (
                  <>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                      <Slider label="max global passes" value={opts.refineMaxIter} min={0} max={50} step={1} onChange={(v) => setO("refineMaxIter", v)} />
                      <Slider label="max passes per glyph" value={opts.perGlyphMaxIter ?? 12} min={0} max={50} step={1} onChange={(v) => setO("perGlyphMaxIter", v)} />
                      <Slider label="error threshold (u)" value={opts.refineThreshold} min={0.1} max={10} step={0.1} onChange={(v) => setO("refineThreshold", v)} />
                      <Slider label="min gain / pass" value={opts.refineMinGain} min={0} max={0.1} step={0.001} onChange={(v) => setO("refineMinGain", v)} fmt={(v) => (v === 0 ? "off · run all" : (v * 100).toFixed(1) + "%")} />
                      <Slider label="step relaxation" value={opts.refineRelax} min={0.1} max={1.5} step={0.05} onChange={(v) => setO("refineRelax", v)} />
                    </div>
                    <p className="text-xs leading-relaxed text-muted">
                      Each pass keeps a correction only if the error falls; rejected passes halve their step. Refinement stops at the threshold,
                      when the gain drops below the minimum (set it to 0 to run every pass), or at the pass cap.{" "}
                      <a href="/how-it-works#refinement" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">How the refinement works ↗</a>
                    </p>
                  </>
                )}
                {setupTab === "characters" && (
                  <>
                    <TextField label="characters analysed" value={opts.charset} onChange={(v) => setO("charset", v)} />
                    {srcFace && <div className="break-all rounded-xl border border-line bg-sunken/60 px-4 py-3 text-2xl leading-snug" style={{ fontFamily: srcFace }}>{opts.charset}</div>}
                  </>
                )}
              </div>
            </div>
          </Screen>
        )}

        {/* ------------------------------------------------------------ 3 · screening */}
        {model && screen === 2 && (
          <Screen step={3} title="Screening" subtitle={<>{model.source.family} measured against <span className="font-mono">{refNote}</span></>}
            right={<Tabs items={[
              { id: "overview" as const, label: "Overview" },
              { id: "refinement" as const, label: `Refinement (${model.refinement.length - 1})` },
              { id: "wave" as const, label: "Wave functions" },
              { id: "texture" as const, label: "Texture & fields" },
              { id: "glyphs" as const, label: `Glyphs (${glyphs.length})` },
            ]} value={tab} onChange={setTab} />}
            nav={<StepNav
              back={<Button onClick={() => go(1)}>← Setup</Button>}
              extra={<Button onClick={() => download(JSON.stringify(model), `${model.source.family.replace(/\s+/g, "")}-style-model.json`, "application/json")}>Download model (JSON)</Button>}
              next={<Button variant="primary" onClick={() => go(3)}>Apply to Khmer →</Button>} />}>
            {tab === "overview" && (
              <div className="space-y-5">
                {model.optionFixes && model.optionFixes.length > 0 && (
                  <Callout tone="info">Some constants were out of range and were clamped: {model.optionFixes.join(" · ")}</Callout>
                )}
                {model.reliability && model.reliability.level !== "high" && (
                  <Callout tone="warn">
                    <b>{model.reliability.level === "low" ? "Low" : "Medium"} reliability</b> (IoU after O(φ) {pct(model.reliability.iou, 0)}): this design differs
                    a lot from the reference, so most differences are structural. Inconsistent harmonics are damped automatically — try another reference or category.
                    {!model.reliability.zones.x && " Unicase / caps-only font: x-height zone ignored."}
                    {!model.reliability.zones.desc && " No descenders: descender zone ignored."}
                  </Callout>
                )}
                {(() => {
                  const f0 = model.fidelity[0], f3 = model.fidelity.find((f) => f.name.startsWith("3 ")), fp = model.fidelity.find((f) => f.name.startsWith("3p"));
                  const rel = model.reliability?.level;
                  return (
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                      <Stat label="raw error" value={f0.meanAbs.toFixed(2)} sub="mean |d| · reference as is" />
                      <Stat label="model error" value={f3?.meanAbs.toFixed(2) ?? "—"} sub={`${f3 ? Math.round((1 - f3.meanAbs / f0.meanAbs) * 100) : 0}% explained by the style model`} tone="good" />
                      <Stat label="per-glyph fit" value={fp?.meanAbs.toFixed(2) ?? "—"} sub="each glyph refined on its own" />
                      <Stat label="reliability" value={rel ?? "—"} sub={`IoU after O(φ) ${pct(model.reliability?.iou ?? NaN, 0)}`} tone={rel === "high" ? "good" : rel === "medium" ? "warn" : "bad"} />
                      <Stat label="slant (source)" value={deg(model.metrics.src.slant)} sub={`ref ${deg(model.metrics.ref.slant)} · width ×${model.global.sx.toFixed(3)}`} />
                      <Stat label="weight" value={`${model.normalFn.coef[0] >= 0 ? "+" : ""}${model.normalFn.coef[0].toFixed(1)}`} sub="units per side vs reference" />
                    </div>
                  );
                })()}
                <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
                  <div className="min-w-0">
                    <Label>Model fidelity by stage (inlier glyphs)</Label>
                    <DataTable
                      head={["stage", "mean |d|", "", "p95", "IoU", "cover"]}
                      rows={model.fidelity.map((f) => [f.name, f.meanAbs.toFixed(3), <Bar key="b" value={f.meanAbs / (model.fidelity[0].meanAbs || 1)} tone={f.name.startsWith("0") ? "src" : "accent"} />, f.p95.toFixed(2), pct(f.iou, 2), pct(f.coverage)])}
                    />
                    <p className="mt-2 text-xs text-muted">Units: thousandths of an em. 3p = each glyph refined on its own; 4g = mean fields of all glyphs (how well the style generalises).{" "}
                      <a href="/how-it-works#pipeline" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">What each stage measures ↗</a></p>
                  </div>
                  <div className="min-w-0">
                    <Label>Loss curve · mean |d| per pass</Label>
                    <LinePlot height={220} xLabel="pass" yLabel="mean |d|" zeroLine={false}
                      series={[
                        { x: model.refinement.map((_, i) => i), y: model.refinement.map((r) => r.meanAbs), color: "var(--accent)", width: 1.8 },
                        { x: model.refinement.map((_, i) => i), y: model.refinement.map((r) => (r.note.includes("fine sampling") ? r.meanAbs : NaN)), color: "var(--src)", width: 4 },
                        { x: model.refinement.map((_, i) => i), y: model.refinement.map((r) => r.reverse ?? NaN), color: "var(--good)", width: 1.4, dash: "4 3", label: "source → ref" },
                      ]} />
                    <p className="mt-1 text-[11px] text-muted">Red dot: switch from the coarse to the configured sampling (the error is re-measured there, so it can jump). Dashed: source → reference distance (bidirectional check).{" "}
                      <button onClick={() => setTab("refinement")} className="text-accent hover:underline">Pass-by-pass log →</button></p>
                  </div>
                </div>
              </div>
            )}
            {tab === "refinement" && (() => {
              const PER = 10;
              const pages = Math.max(1, Math.ceil(model.refinement.length / PER));
              const pg = Math.min(logPage, pages - 1);
              const rows = model.refinement.slice(pg * PER, (pg + 1) * PER);
              return (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <div className="flex shrink-0 flex-wrap items-center gap-3">
                    <Label>Global refinement · O(φ, v) + corners</Label>
                    {pages > 1 && <div className="ml-auto"><Tabs items={Array.from({ length: pages }, (_, k) => ({ id: k, label: `${k * PER}–${Math.min(model.refinement.length - 1, (k + 1) * PER - 1)}` }))} value={pg} onChange={setLogPage} /></div>}
                  </div>
                  <div className="min-h-0 flex-1 overflow-hidden">
                    <DataTable
                      head={["iter", "mean |d|", "p95", "source → ref", "result"]}
                      struck={(i) => !rows[i].accepted}
                      rows={rows.map((r) => [String(r.iter), r.meanAbs.toFixed(4), r.p95.toFixed(2), r.reverse != null ? r.reverse.toFixed(2) : "—", <span key="n" className="line-clamp-2 block min-w-[320px] whitespace-normal text-left font-sans text-muted" title={r.note}>{r.note}</span>])}
                    />
                  </div>
                </div>
              );
            })()}
            {tab === "wave" && (
              <div className="grid gap-6 lg:grid-cols-[1fr_1.1fr_1fr]">
                <div className="min-w-0">
                  <Label>Global parameters</Label>
                  <KV rows={[
                    ["Δ slant", `${model.global.slantDeg.toFixed(3)}°`],
                    ["horizontal scale sx", model.global.sx.toFixed(4)],
                    ["affine check", model.global.affineChoice ?? "—"],
                    ["weight offset a₀", `${model.normalFn.coef[0].toFixed(3)} u / side`],
                    ["V stem src / ref", `${model.metrics.src.vstem.toFixed(2)} / ${model.metrics.ref.vstem.toFixed(2)}`],
                    ["H/V contrast src / ref", `${(model.metrics.src.hstem / model.metrics.src.vstem).toFixed(3)} / ${(model.metrics.ref.hstem / model.metrics.ref.vstem).toFixed(3)}`],
                    ["relative weight stem/x", (model.metrics.src.vstem / model.metrics.src.body).toFixed(4)],
                    ["O(φ) samples", String(model.normalFn.samples)],
                    ["outliers", model.outliers.join(", ") || "none"],
                  ]} />
                  <div className="mt-4"><Label>O(φ, v) · normal offset vs direction, at three heights</Label></div>
                  {waveFns && <div className="w-[220px]"><PolarPlot fns={waveFns} size={220} /></div>}
                </div>
                <div className="min-w-0">
                  <Label>Coefficients · bootstrap 95 % CI · consistency</Label>
                  <div>
                    <div className="space-y-0.5 font-mono text-[11px]">
                      {(model.normalFn.D ?? 0) > 0 && (
                        <div className="mb-1 text-muted">
                          height terms RMS: {Array.from({ length: model.normalFn.D }, (_, d) => {
                            const n = 2 * model.normalFn.K + 1;
                            const blk = model.normalFn.coef.slice((d + 1) * n, (d + 2) * n);
                            return `P${d + 1} ${Math.sqrt(blk.reduce((a, c) => a + c * c, 0) / (blk.length || 1)).toFixed(2)}`;
                          }).join(" · ")}
                        </div>
                      )}
                      {model.normalFn.coef.slice(0, 2 * model.normalFn.K + 1).map((c, i) => (
                        <div key={i} className="flex justify-between gap-3">
                          <span>{i === 0 ? "a₀" : `${i % 2 ? "a" : "b"}${Math.ceil(i / 2)}`} = {c.toFixed(3)}</span>
                          {model.normalFn.ci && isFinite(model.normalFn.ci[i]?.[0]) ? (
                            <span className="text-muted" title="bootstrap 95 % confidence interval over glyphs · consistency">
                              [{model.normalFn.ci[i][0].toFixed(1)}, {model.normalFn.ci[i][1].toFixed(1)}]{i > 0 ? ` · ${Math.round(model.normalFn.trust[i] * 100)}%` : ""}
                            </span>
                          ) : i > 0 && model.normalFn.trust && <span className="text-muted">raw {model.normalFn.coefRaw[i].toFixed(2)} · {Math.round(model.normalFn.trust[i] * 100)}%</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="min-w-0">
                  {model.terminals && model.terminals.count > 0 && (
                    <>
                      <Label>Stroke ends · {model.terminals.count} terminals</Label>
                      <LinePlot height={100} xLabel="position across the stroke end (cap = 0…1)" yLabel="Δ / stem" zeroLine
                        series={[{ x: model.terminals.profile.map((_, k) => -0.5 + (2 * k) / (model.terminals!.profile.length - 1)), y: model.terminals.profile, color: "var(--accent)", width: 1.8 }]} />
                    </>
                  )}
                  <Label>Corner kernels · exact fillet + residual</Label>
                  <LinePlot height={130} xLabel="arc distance from apex" yLabel="d"
                    series={model.corners.bins.filter((b) => b.count >= 3).map((b, i) => ({
                      x: b.raw.map((_, k) => k - model.corners.window), y: b.raw,
                      color: `hsl(${(i * 67) % 360} 60% 52%)`, dash: b.convex ? undefined : "4 3",
                    }))} />
                  <DataTable
                    head={["type", "angle", "n", "radius", "residual"]}
                    rows={model.corners.bins.filter((b) => b.count > 0).map((b) => [b.convex ? "convex" : "concave", `${(b.lo * 57.3).toFixed(0)}–${(b.hi * 57.3).toFixed(0)}°`, String(b.count), b.radius.toFixed(2), b.residualRms.toFixed(2)])}
                  />
                </div>
              </div>
            )}
            {tab === "texture" && (
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="min-w-0">
                  <Label>Texture · intrinsic roughness spectrum (Welch)</Label>
                  <LinePlot height={200} logX logY zeroLine={false} xLabel="λ (u)" yLabel="PSD"
                    series={[{ x: model.texture.bands.map((b) => Math.sqrt(b.lo * b.hi)), y: model.texture.bands.map((b) => Math.max(b.psd, 1e-9)), color: "var(--accent)" }]} />
                  <div className="mt-3">
                    <KV rows={[
                      ["RMS", `${model.texture.rms.toFixed(3)} u`],
                      ["skew / kurtosis", `${model.texture.skewness.toFixed(2)} / ${model.texture.kurtosis.toFixed(2)}`],
                      ["correlation length", `${model.texture.corrLength.toFixed(1)} u`],
                      ["notches > 3σ", `${model.texture.notchRate.toFixed(2)} / 1000u · width ${model.texture.notchWidth.toFixed(1)} · amp ${model.texture.notchAmp.toFixed(2)}`],
                    ]} />
                  </div>
                </div>
                <div className="min-w-0">
                  <Label>Aggregated slice fields · PCHIP along / across slices, bicubic</Label>
                  <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
                    <Heatmap G={model.fields.G} data={model.fields.wx.data} title="warp x" size={150} />
                    <Heatmap G={model.fields.G} data={model.fields.wy.data} title="warp y" size={150} />
                    <Heatmap G={model.fields.G} data={model.fields.th.data} title="V thickness" size={150} />
                    <Heatmap G={model.fields.G} data={model.fields.tv.data} title="H thickness" size={150} />
                  </div>
                </div>
              </div>
            )}
            {tab === "glyphs" && (
              <div className="flex h-full min-h-0 flex-col">
                <div className="mb-3 flex shrink-0 flex-wrap items-center gap-3">
                  <Tabs items={STAGE_TABS} value={stage} onChange={setStage} />
                  <Tabs items={[{ id: "char" as const, label: "A–Z" }, { id: "error" as const, label: "worst first" }]} value={sortBy} onChange={setSortBy} />
                  <Check label={`hide outliers (${glyphs.length - inliers.length})`} checked={hideOutliers} onChange={setHideOutliers} />
                  <span className="ml-auto flex items-center gap-3 text-xs text-muted">
                    <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-src" />source</span>
                    <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-ref" />reference at stage</span>
                  </span>
                </div>
                <PagedGrid items={sortedGlyphs} minW={150} itemH={150} page={glyphPage} onPage={setGlyphPage}
                  render={(g) => <GlyphCard key={g.char} g={g} stage={stage} onOpen={() => setDetail(g)} />} />
              </div>
            )}
          </Screen>
        )}

        {/* ------------------------------------------------------------ 4 · khmer */}
        {model && screen === 3 && (
          <Screen step={4} title="Apply to a Khmer typeface" subtitle="The measured wave functions are applied to every glyph of a Khmer font; shaping tables are preserved." scrollBody={false}
            nav={<StepNav
              back={<Button onClick={() => go(2)}>← Screening</Button>}
              extra={result && <span className="hidden text-xs text-muted md:inline">{result.glyphCount} glyphs · {result.seconds.toFixed(1)} s · {(result.ttf.length / 1024).toFixed(0)} KB</span>}
              next={<Button variant="primary" disabled={!result} onClick={() => go(4)}>Name & export →</Button>} />}>
            <div className="grid h-full min-h-0 gap-5 lg:grid-cols-[380px_1fr]">
              <aside className="flex min-h-0 flex-col rounded-xl border border-line bg-sunken/30">
                <div className="shrink-0 border-b border-line p-3">
                  <Tabs items={[
                    { id: "font" as const, label: "Font" },
                    { id: "shape" as const, label: "Weight & shape" },
                    { id: "detail" as const, label: "Detail" },
                    { id: "output" as const, label: "Output" },
                  ]} value={ktools} onChange={setKtools} />
                </div>
                <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
                  {ktools === "font" && (<>
                  <div className={khEntry && khEntry.files.length > 1 ? "grid grid-cols-2 gap-3" : "grid gap-3"}>
                    <FontSelect label="Khmer font" value={khId} onChange={(id) => { setKhId(id); setKhFile(0); }}
                      options={(manifest?.khmer ?? []).map((k) => ({
                        id: k.id, label: k.name, meta: k.style, sample: "កម្ពុជា ខ្មែរ",
                        url: k.files.find((f) => /Regular|VF/.test(f)) ?? k.files[0],
                      }))} />
                    {khEntry && khEntry.files.length > 1 ? (
                      <Select label="file" value={khFile} onChange={(e) => setKhFile(+e.target.value)}>
                        {khEntry.files.map((f, i) => <option key={f} value={i}>{f.split("/").pop()}</option>)}
                      </Select>
                    ) : null}
                  </div>
                  <DropZone compact accept=".ttf,.otf,.woff,.woff2" label="…or upload your own Khmer font" onFile={async (f) => loadKhmer({ bytes: await f.arrayBuffer() })} />
                  {khInfo && (
                    <KV rows={[
                      ["font", khInfo.family],
                      ["glyphs / UPM", `${khInfo.numGlyphs} / ${khInfo.upm}`],
                      ["axes", Object.entries(khInfo.axes).map(([k, a]) => `${k} ${a.min}–${a.max}`).join(", ") || "static"],
                      ["body / V / H stem", `${khInfo.metrics.body.toFixed(1)} / ${khInfo.metrics.vstem.toFixed(2)} / ${khInfo.metrics.hstem.toFixed(2)}`],
                    ]} />
                  )}
                  <Check label="use the wght axis of variable fonts" checked={params.useAxes} onChange={(v) => setP("useAxes", v)} />
                  </>)}
                  {ktools === "shape" && (<>
                  <Label>Geometry</Label>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <Slider label="slant ×" value={params.slant} min={0} max={2} step={0.01} onChange={(v) => setP("slant", v)} />
                    <Slider label="width ×" value={params.width} min={0} max={2} step={0.01} onChange={(v) => setP("width", v)} />
                    <Slider label="height (Y scale)" value={params.height} min={0.8} max={1.2} step={0.005} onChange={(v) => setP("height", v)} />
                    <Slider label="tracking (u / side)" value={params.tracking} min={-40} max={80} step={1} onChange={(v) => setP("tracking", v)} />
                  </div>
                  <Label>Weight & contrast</Label>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <Slider label="weight (native → source)" value={params.weight} min={0} max={1.5} step={0.01} onChange={(v) => setP("weight", v)} />
                    <Slider label="weight bias (u)" value={params.weightBias} min={-40} max={40} step={0.5} onChange={(v) => setP("weightBias", v)} />
                    <Slider label="contrast / stress ×" value={params.contrast} min={0} max={2} step={0.01} onChange={(v) => setP("contrast", v)} />
                    <Slider label="O(φ) harmonics used" value={params.harmonics} min={0} max={model.normalFn.K} step={1} onChange={(v) => setP("harmonics", v)} />
                    <Slider label="whitespace fill max" value={params.counterKeep} min={0} max={1} step={0.05} onChange={(v) => setP("counterKeep", v)} fmt={(v) => `${Math.round(v * 100)}%`} hint="largest share of any counter, slot or gap that the ink may fill — preserves Khmer negative space" />
                    <Slider label="stroke kept min" value={params.strokeKeep} min={0} max={1} step={0.05} onChange={(v) => setP("strokeKeep", v)} fmt={(v) => `${Math.round(v * 100)}%`} hint="minimum share of every stroke that survives thinning" />
                    <Slider label="wave smoothness k₀" value={params.waveSmooth} min={0} max={12} step={0.5} onChange={(v) => setP("waveSmooth", v)} fmt={(v) => (v === 0 ? "off" : String(v))} hint="O(φ) harmonics above this order are damped: removes ripples on curved strokes" />
                  </div>
                  </>)}
                  {ktools === "detail" && (<>
                  <Label>Corners & fields</Label>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <Slider label="corner radius ×" value={params.cornerRadius} min={0} max={3} step={0.05} onChange={(v) => setP("cornerRadius", v)} />
                    <Slider label="stroke ends ×" value={params.terminalDetail ?? 1} min={0} max={2} step={0.05} onChange={(v) => setP("terminalDetail", v)} hint="profile measured on the source's stroke terminals (flare, cut, rounding), applied to Khmer stroke ends" />
                    <Slider label="corner detail ×" value={params.cornerDetail} min={0} max={2} step={0.05} onChange={(v) => setP("cornerDetail", v)} />
                    <Slider label="field warp ×" value={params.warp} min={0} max={2} step={0.05} onChange={(v) => setP("warp", v)} />
                    <Slider label="field thickness ×" value={params.thickness} min={0} max={2} step={0.05} onChange={(v) => setP("thickness", v)} />
                  </div>
                  <Label>Texture</Label>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <Slider label="amplitude ×" value={params.texture} min={0} max={3} step={0.05} onChange={(v) => setP("texture", v)} />
                    <Slider label="scale ×" value={params.textureScale} min={0.25} max={4} step={0.05} onChange={(v) => setP("textureScale", v)} />
                    <Slider label="anisotropy" value={params.textureAniso} min={0} max={1} step={0.05} onChange={(v) => setP("textureAniso", v)} />
                    <Slider label="seed" value={params.seed} min={1} max={999} step={1} onChange={(v) => setP("seed", v)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Select label="contrast mode" value={params.contrastMode} onChange={(e) => setP("contrastMode", e.target.value as TransferParams["contrastMode"])}>
                      <option value="absolute">absolute (source H/V)</option>
                      <option value="relative">relative (Δ vs ref)</option>
                    </Select>
                    <Select label="texture source" value={params.textureMode} onChange={(e) => setP("textureMode", e.target.value as TransferParams["textureMode"])}>
                      <option value="tape">measured tape</option>
                      <option value="spectral">spectral synthesis</option>
                    </Select>
                  </div>
                  </>)}
                  {ktools === "output" && (<>
                  <Label>Smoothing & output</Label>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-4">
                    <Slider label="smoother σ (u)" value={params.smoothing} min={0} max={40} step={0.5} onChange={(v) => setP("smoothing", v)} hint="Gaussian low-pass of the structural displacement along the outline (never across corners)" />
                    <Slider label="despeckle (× stem)" value={params.despeckle} min={0} max={0.6} step={0.01} onChange={(v) => setP("despeckle", v)} hint="removes islands and pin-holes smaller than (value × stem)²" />
                    <Slider label="detail scale κ" fmt={(v) => (v === 0 ? "auto" : v.toFixed(2))} value={params.detailScale} min={0} max={3} step={0.01} onChange={(v) => setP("detailScale", v)} />
                    <Slider label="sample step (u)" value={params.step} min={0.5} max={6} step={0.25} onChange={(v) => setP("step", v)} />
                    <Slider label="curve-fit tolerance (u)" value={params.fitTolerance} min={0.05} max={2} step={0.05} onChange={(v) => setP("fitTolerance", v)} />
                  </div>
                  </>)}
                </div>
                <div className="flex shrink-0 gap-2 border-t border-line p-3">
                  <Button variant="primary" className="flex-1" disabled={!khInfo || !!busy} onClick={transfer}>{result ? "Regenerate preview" : "Generate preview"}</Button>
                  <Button onClick={() => setParams({ ...DEFAULT_PARAMS, harmonics: model.normalFn.K })}>Reset</Button>
                </div>
              </aside>
              <div className="flex min-h-0 min-w-0 flex-col gap-3">
                <div className="flex shrink-0 flex-wrap items-center gap-3">
                  <Tabs items={[{ id: "text" as const, label: "Text" }, { id: "glyphs" as const, label: "Glyphs" }, { id: "report" as const, label: "Report" }]} value={ktab} onChange={setKtab} />
                  {ktab === "text" && (
                    <Button onClick={() => setEditText((v) => !v)} className={editText ? "border-accent text-accent" : ""}>
                      {editText ? "Done" : "Edit sample text"}
                    </Button>
                  )}
                  <div className="ml-auto w-56"><Slider label="preview size (px)" value={size} min={16} max={200} step={2} onChange={setSize} /></div>
                </div>
                {editText && ktab === "text" && (
                  <textarea autoFocus rows={3} value={text} onChange={(e) => setText(e.target.value)}
                    className="shrink-0 resize-none rounded-xl border border-accent/40 bg-sunken px-4 py-3 text-lg leading-relaxed outline-none focus:border-accent"
                    style={{ fontFamily: khFace ?? undefined }} />
                )}
                <div className={`min-h-0 flex-1 rounded-xl border border-line bg-sunken/30 p-4 ${ktab === "glyphs" ? "flex flex-col overflow-hidden" : "scroll-thin overflow-y-auto"}`}>
                  {result && outFace ? (
                    <>
                      {ktab === "text" && (
                        <div className="space-y-5">
                          <div className="whitespace-pre-wrap break-words leading-[1.6]" style={{ fontFamily: outFace, fontSize: size }}>{text}</div>
                          <div className="grid gap-4 border-t border-line pt-4 md:grid-cols-2">
                            {khFace && (
                              <div>
                                <Label>Original · {khInfo?.family}</Label>
                                <div className="whitespace-pre-wrap break-words leading-[1.6] text-muted" style={{ fontFamily: khFace, fontSize: Math.max(14, size * 0.45) }}>{text}</div>
                              </div>
                            )}
                            {srcFace && (
                              <div>
                                <Label>Source style</Label>
                                <div className="leading-tight" style={{ fontFamily: srcFace, fontSize: Math.max(14, size * 0.55) }}>Hamburgefonstiv 0123</div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                      {ktab === "glyphs" && (
                        <div className="flex h-full min-h-0 flex-col">
                          <PagedGrid items={result.previews} minW={120} itemH={130} gap={8} page={khGlyphPage} onPage={setKhGlyphPage}
                            render={(p) => <Compare key={p.char} p={p} />} />
                        </div>
                      )}
                      {ktab === "report" && (
                        <ul className="list-disc space-y-1 pl-5 text-xs text-muted">
                          {result.report.map((r, i) => <li key={i}>{r}</li>)}
                          <li>{result.glyphCount} glyphs in {result.seconds.toFixed(1)} s · {(result.ttf.length / 1024).toFixed(0)} KB</li>
                        </ul>
                      )}
                    </>
                  ) : (
                    <div className="grid h-full place-items-center">
                      <div className="max-w-sm text-center text-sm text-muted">
                        <div className="mb-2 text-3xl">ក</div>
                        Press <b className="text-ink">Generate preview</b>: the whole font is transformed and loaded into the browser with native shaping (GSUB/GPOS kept).
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </Screen>
        )}

        {/* ------------------------------------------------------------ 5 · export */}
        {model && khInfo && screen === 4 && (
          <Screen step={5} title="Name, author & download" subtitle="Metadata is written into the name table. Every field, copyright included, is editable."
            nav={<StepNav
              back={<Button onClick={() => go(3)}>← Khmer</Button>}
              extra={namesDirty && result ? <span className="hidden text-xs text-muted md:inline">metadata changed — the font is regenerated on download</span> : null}
              next={<div className="flex gap-2">
                <Button disabled={!!busy || !names.family} onClick={() => exportFont("woff")}>Download WOFF</Button>
                <Button variant="primary" disabled={!!busy || !names.family} onClick={() => exportFont("ttf")}>Download TTF</Button>
              </div>} />}>
            <div className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
              <div className="min-w-0 space-y-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <TextField label="family" value={names.family} onChange={setN("family")} />
                  <TextField label="style" value={names.style} onChange={setN("style")} />
                  <TextField label="designer / author" value={names.designer} onChange={setN("designer")} />
                  <TextField label="designer URL" value={names.designerURL} onChange={setN("designerURL")} />
                  <TextField label="manufacturer" value={names.manufacturer} onChange={setN("manufacturer")} />
                  <TextField label="vendor URL" value={names.vendorURL} onChange={setN("vendorURL")} />
                  <TextField label="version" value={names.version} onChange={setN("version")} />
                  <TextField label="vendor ID (4 chars)" value={names.vendorID} maxLength={4} onChange={setN("vendorID")} />
                  <TextField label="trademark" value={names.trademark} onChange={setN("trademark")} />
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  <TextField multiline rows={4} label="copyright" value={names.copyright} onChange={setN("copyright")} />
                  <TextField multiline rows={4} label="description" value={names.description} onChange={setN("description")} />
                </div>
              </div>
              <div className="min-w-0 space-y-3">
                <TextField label="license URL" value={names.licenseURL} onChange={setN("licenseURL")} />
                <TextField multiline rows={4} label="license" value={names.license} onChange={setN("license")} />
                <p className="text-xs text-muted">If the base Khmer font declares an OFL Reserved Font Name, the new family name must not contain it.</p>
                {result && outFace && (
                  <div className="rounded-xl border border-line bg-sunken/50 px-5 py-4">
                    <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted">{names.family || "Untitled"} · {names.style}</div>
                    <div className="truncate text-4xl leading-[1.5]" style={{ fontFamily: outFace }}>សួស្តី កម្ពុជា</div>
                  </div>
                )}
              </div>
            </div>
          </Screen>
        )}
      </main>
      {detail && <GlyphDetail g={detail} onClose={() => setDetail(null)} />}
      {longTask && busy && <LoadingOverlay title={longTask} msg={busy.msg} frac={busy.frac} estimate={longEstimate ?? undefined} />}
    </div>
  );
}

/** One step = one viewport-sized panel: fixed header, scrollable body, fixed navigation. */
function Screen({ step, title, subtitle, right, nav, children, scrollBody = true }: {
  step: number; title: React.ReactNode; subtitle?: React.ReactNode; right?: React.ReactNode; nav: React.ReactNode; children: React.ReactNode; scrollBody?: boolean;
}) {
  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-ink">{step}</span>
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold tracking-tight">{title}</h2>
            {subtitle && <p className="truncate text-xs text-muted">{subtitle}</p>}
          </div>
        </div>
        {right}
      </header>
      <div className={scrollBody ? "scroll-thin min-h-0 flex-1 overflow-y-auto px-5 py-5" : "min-h-0 flex-1 overflow-hidden px-5 py-4"}>{children}</div>
      <div className="shrink-0 border-t border-line px-5 py-3">{nav}</div>
    </section>
  );
}

function StepNav({ back, next, extra }: { back?: React.ReactNode; next?: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">{back}{extra}</div>
      <div>{next}</div>
    </div>
  );
}

function Compare({ p }: { p: TransferResult["previews"][number] }) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of [...p.before, ...p.after]) for (let i = 0; i < r.length; i += 2) {
    minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]); minY = Math.min(minY, r[i + 1]); maxY = Math.max(maxY, r[i + 1]);
  }
  if (!isFinite(minX)) return null;
  const m = 30;
  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-sunken p-1.5">
      <div className="px-1 font-mono text-[11px] text-muted">{p.char}</div>
      <svg className="block min-h-0 w-full flex-1" viewBox={`${minX - m} ${-maxY - m} ${maxX - minX + 2 * m} ${maxY - minY + 2 * m}`}>
        <g transform="scale(1,-1)">
          <path d={ringsPath(p.before)} fill="var(--line)" />
          <path d={ringsPath(p.after)} fill="color-mix(in srgb, var(--src) 18%, transparent)" stroke="var(--src)" strokeWidth={2.5} />
        </g>
      </svg>
    </div>
  );
}
