/// <reference lib="webworker" />
import { analyze } from "../analysis/pipeline";
import { detectCategory, measureKhmer, measureLatin, KHMER_BODY } from "../analysis/metrics";
import { StyleModel } from "../analysis/model";
import { originalNames } from "../font/build";
import { FontHandle, glyphIdForChar, glyphShape, openFont, setVariation } from "../font/load";
import { ringLength } from "../geometry/sample";
import { toWoff } from "../font/sfnt";
import { prepareSource, quickRelStem, RankEntry, scoreReference, weightMatch } from "../analysis/rank";
import { transferFont } from "../transform/font";
import type { Req, Res } from "./protocol";

let source: FontHandle | null = null;
let khmer: FontHandle | null = null;
let model: StyleModel | null = null;
const refCache = new Map<string, FontHandle>();

const post = (m: Res, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(m, transfer);

function info(h: FontHandle) {
  return {
    family: h.family, style: h.subfamily, upm: h.upm, numGlyphs: h.font.numGlyphs, axes: h.axes,
    names: originalNames(h.base),
  };
}

async function loadRef(url: string): Promise<FontHandle> {
  const hit = refCache.get(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`cannot load ${url}`);
  const h = openFont(new Uint8Array(await res.arrayBuffer()));
  refCache.set(url, h);
  return h;
}

/** Reference instance whose relative stem weight (vstem / x-height) matches the source. */
async function matchReference(files: string[], target: number, progress: (m: string) => void) {
  const rel = (h: FontHandle) => {
    const m = measureLatin(h);
    return m.vstem / (m.body || 1);
  };
  let best: { h: FontHandle; err: number; file: string; coords: Record<string, number> } | null = null;
  for (const f of files) {
    progress(`reference: measuring ${f.split("/").pop()}`);
    const h = await loadRef(f);
    const ax = h.axes["wght"];
    if (ax) {
      let lo = ax.min, hi = ax.max;
      let cand = { h, err: Infinity, file: f, coords: h.coords };
      for (let it = 0; it < 16; it++) {
        const mid = (lo + hi) / 2;
        const v = setVariation(h, { wght: mid });
        const r = rel(v);
        const e = Math.abs(r - target);
        if (e < cand.err) cand = { h: v, err: e, file: f, coords: v.coords };
        if (r < target) lo = mid;
        else hi = mid;
      }
      if (!best || cand.err < best.err) best = cand;
    } else {
      const e = Math.abs(rel(h) - target);
      if (!best || e < best.err) best = { h, err: e, file: f, coords: {} };
    }
  }
  return best!;
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  const progress = (msg: string, frac: number) => post({ id: req.id, type: "progress", msg, frac });
  try {
    switch (req.type) {
      case "loadSource": {
        source = openFont(new Uint8Array(req.bytes));
        const metrics = measureLatin(source);
        const guess = detectCategory(source, metrics);
        let latinCount = 0;
        // mean outline length per Latin glyph (1000 em): drives the time estimate
        let outline = 0;
        for (const c of "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789") {
          const gid = glyphIdForChar(source, c);
          if (!gid) continue;
          latinCount++;
          for (const r of glyphShape(source, gid)) outline += ringLength(r);
        }
        post({ id: req.id, type: "sourceInfo", info: { ...info(source), metrics, guess, latinCount, meanOutline: latinCount ? outline / latinCount : 2500 } });
        break;
      }
      case "analyze": {
        if (!source) throw new Error("load the source font first");
        const mS = measureLatin(source);
        const target = mS.vstem / (mS.body || 1);
        let ref: { h: FontHandle; file: string; coords: Record<string, number> };
        if (req.options.matchWeight) ref = await matchReference(req.reference.files, target, (m) => progress(m, 0));
        else {
          const f = req.reference.files.find((x) => /Regular|VF/.test(x)) ?? req.reference.files[0];
          const h = await loadRef(f);
          ref = { h, file: f, coords: h.coords };
        }
        const { model: m, glyphs } = analyze({
          src: source,
          ref: ref.h,
          refMeta: { id: req.reference.id, name: req.reference.name, file: ref.file, coords: ref.coords },
          category: req.category,
          options: req.options,
          progress,
        });
        model = m;
        const coordsTxt = Object.entries(ref.coords).map(([k, v]) => `${k}=${Math.round(v)}`).join(" ");
        post({
          id: req.id, type: "analysis", model: m, glyphs,
          refNote: `${req.reference.name} · ${ref.file.split("/").pop()}${coordsTxt ? " · " + coordsTxt : ""}`,
        });
        break;
      }
      case "loadKhmer": {
        let bytes: Uint8Array;
        if (req.bytes) bytes = new Uint8Array(req.bytes);
        else {
          const r = await fetch(req.url!);
          bytes = new Uint8Array(await r.arrayBuffer());
        }
        khmer = openFont(bytes);
        let khmerGlyphs = 0;
        for (const c of KHMER_BODY) if (glyphIdForChar(khmer, c)) khmerGlyphs++;
        if (!khmerGlyphs) throw new Error("the selected font has no Khmer glyphs");
        post({ id: req.id, type: "khmerInfo", info: { ...info(khmer), metrics: measureKhmer(khmer), khmerGlyphs } });
        break;
      }
      case "transfer": {
        if (!model) throw new Error("run the analysis first");
        if (!khmer) throw new Error("select a Khmer font");
        const result = transferFont(khmer, model, req.params, req.names, progress);
        // functions cannot cross the worker boundary
        post({ id: req.id, type: "transfer", result: { ...result, plan: { ...result.plan, O: undefined as never } } }, [result.ttf.buffer as ArrayBuffer]);
        break;
      }
      case "rank": {
        if (!source) throw new Error("load the source font first");
        const probe = prepareSource(source);
        const target = quickRelStem(source);
        const guess = detectCategory(source, probe.m);
        const ranking: RankEntry[] = [];
        for (let i = 0; i < req.references.length; i++) {
          const r = req.references[i];
          progress(`ranking references · ${r.name}`, i / req.references.length);
          try {
            const hs = [];
            for (const f of r.files) hs.push({ h: await loadRef(f), file: f });
            const w = weightMatch(hs, target);
            const s = scoreReference(probe, w.h);
            // priors on top of the shape score: a reference leaning differently from the source
            // forces a shear into the analysis map (shear is not a rotation: it distorts curves),
            // and a reference outside the detected category explains the source with the wrong
            // skeleton. Both only matter when shape scores are close.
            const dSlant = Math.abs(Math.atan(probe.m.slant) - Math.atan(measureLatin(w.h).slant)) * 180 / Math.PI;
            const catPenalty = r.category === guess.category ? 0 : 0.12 * guess.confidence;
            const score = s.score * (1 + catPenalty) + 0.35 * dSlant;
            ranking.push({ id: r.id, name: r.name, category: r.category, trait: r.trait, file: w.file, coords: w.coords, score, shape: s.score, slantDiff: dSlant, coverage: s.coverage });
          } catch {
            /* a reference that fails to load is simply not ranked */
          }
        }
        ranking.sort((a, b) => a.score - b.score);
        post({ id: req.id, type: "rank", ranking });
        break;
      }
      case "woff": {
        const bytes = await toWoff(req.ttf);
        post({ id: req.id, type: "woff", bytes });
        break;
      }
    }
  } catch (e) {
    post({ id: req.id, type: "error", error: e instanceof Error ? `${e.message}` : String(e) });
  }
};
