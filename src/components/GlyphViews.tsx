"use client";
import React, { useMemo, useState } from "react";
import type { GlyphReport } from "@/lib/analysis/model";
import { STAGE_NAMES } from "@/lib/analysis/model";
import { dft, reconstruct } from "@/lib/math/fft";
import { LinePlot, ringsPath } from "./charts";
import { Button, Check, cx, DataTable, Label, Slider, Tabs } from "./ui";

/** Stage tabs in pipeline order; index 6 = this glyph's own refined fit (3p). */
export const STAGE_TABS = [0, 1, 2, 3, 6, 4, 5].map((id) => ({
  id,
  label: id === 6 ? "3p · per-glyph" : STAGE_NAMES[id].replace(/^(\d) · /, "$1 · "),
}));

function bounds(rings: Float32Array[][]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const rs of rings)
    for (const r of rs ?? [])
      for (let i = 0; i < r.length; i += 2) {
        minX = Math.min(minX, r[i]); maxX = Math.max(maxX, r[i]);
        minY = Math.min(minY, r[i + 1]); maxY = Math.max(maxY, r[i + 1]);
      }
  if (!isFinite(minX)) return { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
  return { minX, minY, maxX, maxY };
}

const statFor = (g: GlyphReport, stage: number) => (stage === 6 ? g.refined : g.stats[stage]);

export function GlyphCard({ g, stage, onOpen }: { g: GlyphReport; stage: number; onOpen: () => void }) {
  const b = useMemo(() => bounds([g.src, g.stages[stage] ?? []]), [g, stage]);
  const m = 30;
  const vb = `${b.minX - m} ${-b.maxY - m} ${b.maxX - b.minX + 2 * m} ${b.maxY - b.minY + 2 * m}`;
  const st = statFor(g, stage);
  return (
    <button
      onClick={onOpen}
      title={g.outlier ? `outlier: ${g.reason}` : "open detail"}
      className={cx(
        "group relative flex h-full min-h-0 flex-col rounded-lg border border-line bg-sunken p-1.5 text-left transition hover:border-accent",
        g.outlier && "opacity-50",
      )}
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-1 font-mono text-[11px] leading-none text-muted">
        <span className="text-sm font-semibold leading-none text-ink">{g.char}</span>
        {st && <span className="truncate">|d| {st.meanAbs.toFixed(2)} · IoU {isFinite(st.iou) ? (st.iou * 100).toFixed(1) + "%" : "—"}</span>}
      </div>
      <svg className="block min-h-0 w-full flex-1" viewBox={vb}>
        <g transform="scale(1,-1)">
          <path d={ringsPath(g.stages[stage])} fill="color-mix(in srgb, var(--ref) 20%, transparent)" stroke="var(--ref)" strokeWidth={2} />
          <path d={ringsPath(g.src)} fill="none" stroke="var(--src)" strokeWidth={2.5} />
        </g>
      </svg>
    </button>
  );
}

/** Large view of one glyph: overlay, deviation whiskers, slices, exact wave functions, refinement. */
export function GlyphDetail({ g, onClose }: { g: GlyphReport; onClose: () => void }) {
  const [stage, setStage] = useState(6);
  const [zoom, setZoom] = useState(1);
  const [showSlices, setShowSlices] = useState(false);
  const [showWhiskers, setShowWhiskers] = useState(true);
  const [ring, setRing] = useState(0);
  const [harm, setHarm] = useState(32);
  const devStage = stage === 6 ? 3 : Math.max(1, stage);
  const b = useMemo(() => bounds([g.src, ...g.stages]), [g]);
  const m = 40;
  const vb = `${b.minX - m} ${-b.maxY - m} ${b.maxX - b.minX + 2 * m} ${b.maxY - b.minY + 2 * m}`;

  const whiskers = useMemo(() => {
    const poly = g.stages[devStage];
    const bucket: Record<string, string> = {};
    if (!poly) return [];
    g.rings.forEach((rg, r) => {
      const p = poly[r];
      const dev = rg.dev[devStage - 1];
      if (!p || !dev) return;
      const n = p.length / 2;
      const stride = Math.max(1, Math.round(n / 500));
      for (let i = 0; i < n; i += stride) {
        const d = dev[i];
        if (!isFinite(d) || Math.abs(d) < 0.25) continue;
        const a = (i - 1 + n) % n, c = (i + 1) % n;
        const tx = p[2 * c] - p[2 * a], ty = p[2 * c + 1] - p[2 * a + 1];
        const l = Math.hypot(tx, ty) || 1;
        const x = p[2 * i], y = p[2 * i + 1];
        const col = d > 0 ? "var(--src)" : "var(--ref)";
        bucket[col] = (bucket[col] ?? "") + `M${x.toFixed(1)} ${y.toFixed(1)}L${(x + (ty / l) * d).toFixed(1)} ${(y - (tx / l) * d).toFixed(1)}`;
      }
    });
    return Object.entries(bucket).map(([c, d]) => ({ c, d }));
  }, [g, devStage]);

  const rg = g.rings[ring];
  const signal = rg?.dev[devStage - 1];
  const wave = useMemo(() => {
    if (!signal || !signal.length) return null;
    const N = signal.length;
    const idx: number[] = [];
    for (let i = 0; i < N; i++) if (isFinite(signal[i])) idx.push(i);
    if (!idx.length) return null;
    const f = new Float64Array(N);
    for (let k = 0; k < idx.length; k++) {
      const a = idx[k], bb = idx[(k + 1) % idx.length];
      const span = (bb - a + N) % N || N;
      for (let j = 0; j < span; j++) f[(a + j) % N] = signal[a] + ((signal[bb] - signal[a]) * j) / span;
    }
    const X = dft(f);
    const amp = Array.from({ length: Math.floor(N / 2) }, (_, k) => (k === 0 ? Math.abs(X.re[0]) / N : (2 * Math.hypot(X.re[k], X.im[k])) / N));
    return { f, X, amp, N };
  }, [signal]);
  const recon = useMemo(() => (wave ? reconstruct(wave.X.re, wave.X.im, harm) : null), [wave, harm]);
  const reconErr = useMemo(() => {
    if (!wave || !recon) return 0;
    let s = 0;
    for (let i = 0; i < wave.N; i++) s += (wave.f[i] - recon[i]) ** 2;
    return Math.sqrt(s / wave.N);
  }, [wave, recon]);

  const rows = STAGE_TABS.map((t) => statFor(g, t.id)).filter(Boolean);
  return (
    <div className="fixed inset-0 z-20 flex items-start justify-center overflow-auto bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-[1320px] rounded-xl border border-line bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Glyph <span className="font-mono">“{g.char}”</span>
            {g.outlier && <span className="ml-2 rounded-full border border-line px-2 py-0.5 text-xs font-normal text-muted">outlier · {g.reason}</span>}
          </h2>
          <Button onClick={onClose}>Close</Button>
        </div>
        <Tabs items={STAGE_TABS} value={stage} onChange={setStage} />
        <div className="mt-4 grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-4">
              <div className="w-48"><Slider label="zoom" value={zoom} min={1} max={6} step={0.25} onChange={setZoom} fmt={(v) => `${v}×`} /></div>
              <Check label="normal deviations" checked={showWhiskers} onChange={setShowWhiskers} />
              <Check label="slices (stage 3 → 4)" checked={showSlices} onChange={setShowSlices} />
            </div>
            <div className="max-h-[72vh] overflow-auto rounded-lg border border-line bg-sunken">
              <svg className="block h-auto" viewBox={vb} style={{ width: `${zoom * 100}%` }}>
                <g transform="scale(1,-1)">
                  <path d={ringsPath(g.stages[stage])} fill="color-mix(in srgb, var(--ref) 15%, transparent)" stroke="var(--ref)" strokeWidth={1.2} />
                  <path d={ringsPath(g.src)} fill="none" stroke="var(--src)" strokeWidth={1.4} />
                  {showWhiskers && stage > 0 && whiskers.map((w) => <path key={w.c} d={w.d} stroke={w.c} strokeWidth={0.8} opacity={0.8} />)}
                  {showSlices && (
                    <g opacity={0.8}>
                      {g.slicesH.map((s, i) => (
                        <g key={"h" + i}>
                          {s.ref.map(([a, bb], k) => <line key={"r" + k} x1={a} x2={bb} y1={s.c - 1.5} y2={s.c - 1.5} stroke="var(--ref)" strokeWidth={1.5} />)}
                          {s.src.map(([a, bb], k) => <line key={"s" + k} x1={a} x2={bb} y1={s.c + 1.5} y2={s.c + 1.5} stroke="var(--src)" strokeWidth={1.5} />)}
                        </g>
                      ))}
                      {g.slicesV.map((s, i) => (
                        <g key={"v" + i}>
                          {s.ref.map(([a, bb], k) => <line key={"r" + k} y1={a} y2={bb} x1={s.c - 1.5} x2={s.c - 1.5} stroke="var(--ref)" strokeWidth={1.5} />)}
                          {s.src.map(([a, bb], k) => <line key={"s" + k} y1={a} y2={bb} x1={s.c + 1.5} x2={s.c + 1.5} stroke="var(--src)" strokeWidth={1.5} />)}
                        </g>
                      ))}
                    </g>
                  )}
                </g>
              </svg>
            </div>
            <div className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-src" />source font</span>
              <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-sm bg-ref" />transformed reference</span>
              <span>whiskers: red = source outside, blue = source inside</span>
            </div>
          </div>
          <div className="min-w-0">
            <Label>Error by stage</Label>
            <DataTable
              head={["stage", "mean |d|", "p95", "IoU", "coverage"]}
              highlight={STAGE_TABS.findIndex((t) => t.id === stage)}
              rows={rows.map((s) => [s!.name, s!.meanAbs.toFixed(3), s!.p95.toFixed(2), isFinite(s!.iou) ? (s!.iou * 100).toFixed(2) + "%" : "—", (s!.coverage * 100).toFixed(1) + "%"])}
            />
            {g.refineSteps.length > 0 && (
              <>
                <Label>Per-glyph refinement</Label>
                <LinePlot height={120} xLabel="pass" yLabel="mean |d|" zeroLine={false}
                  series={[{ x: g.refineSteps.map((_, i) => i), y: g.refineSteps.map((r) => r.meanAbs), color: "var(--accent)", width: 1.8 }]} />
                <DataTable
                  head={["iter", "mean |d|", "p95", "result"]}
                  struck={(i) => !g.refineSteps[i].accepted}
                  rows={g.refineSteps.map((r) => [String(r.iter), r.meanAbs.toFixed(4), r.p95.toFixed(2), <span key="n" className="block min-w-[220px] whitespace-normal text-left font-sans text-muted">{r.note}</span>])}
                />
              </>
            )}
            <Label>Contour wave function</Label>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted">
              <select value={ring} onChange={(e) => setRing(+e.target.value)} className="rounded-md border border-line bg-sunken px-2 py-1 text-ink">
                {g.rings.map((r, i) => <option key={i} value={i}>contour {i} · L={r.length.toFixed(0)}</option>)}
              </select>
              <span>residual after {stage === 6 ? "per-glyph refinement" : STAGE_NAMES[devStage]}</span>
            </div>
            {wave && recon && (
              <div className="mt-2 space-y-2">
                <LinePlot height={170} xLabel="arc length s" yLabel="d(s)"
                  series={[
                    { x: rg.s, y: wave.f, color: "var(--muted)", label: "measured" },
                    { x: rg.s, y: recon, color: "var(--accent)", label: `${harm} harmonics`, width: 1.6 },
                  ]} />
                <Slider label="harmonics H (N/2 = exact)" value={Math.min(harm, Math.floor(wave.N / 2))} min={1} max={Math.floor(wave.N / 2)} step={1} onChange={setHarm}
                  fmt={(v) => `${v} · RMS error ${reconErr.toExponential(2)}`} />
                <LinePlot height={140} logY zeroLine={false} xLabel="harmonic k" yLabel="amplitude"
                  series={[{ x: wave.amp.map((_, k) => k), y: wave.amp.map((a) => Math.max(a, 1e-6)), color: "var(--accent)" }]} />
                <p className="text-xs leading-relaxed text-muted">
                  d(s) = a₀ + Σ<sub>k</sub> A<sub>k</sub> cos(2πks/L + θ<sub>k</sub>) over {wave.N} samples, exact DFT (Bluestein). With H = {Math.floor(wave.N / 2)} the
                  reconstruction matches every sample to machine precision.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
