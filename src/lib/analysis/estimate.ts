import type { AnalysisOptions } from "./model";

/**
 * A-priori duration of an analysis from the configured options and the size of the source.
 *
 * N = samples per glyph at the configured step (= mean outline length / step), G = glyphs,
 * n = unknowns of the wave function. Refinement runs most passes on a coarse sampling, so each
 * phase uses an effective sample count Neff:
 *   base      = A  · G · N
 *   global    = P  · (Bg · G · NeffG + Cg · n²)      P = global passes
 *   per-glyph = G · Q · (Bq · NeffQ + Cq · n²)      Q = passes per glyph
 *   slices    = S  · G · slices · (1 + N / 2000)
 *
 * Calibrated on scripts/bench.ts (ChemyRetro vs Lato ExtraBold, 65 glyphs, step 0.5, K 12, D 2,
 * 28 global + 12 per-glyph passes, 128 slices): measured 9.5 / 501.7 / 149.6 / 14.6 s in Node.
 * The browser worker is ~1.15× slower.
 */
export const CAL = {
  A: 2.3e-5,
  Bg: 7.2e-5,
  Cg: 2.7e-4,
  Bq: 5.7e-5,
  Cq: 5.0e-6,
  S: 4.2e-4,
  browser: 1.15,
};

export interface Estimate {
  seconds: number;
  parts: { label: string; seconds: number }[];
}

export function estimateAnalysis(o: AnalysisOptions, meanOutline: number, glyphCount: number): Estimate {
  const G = Math.max(1, glyphCount);
  const step = Math.max(0.25, o.step);
  const N = Math.max(50, meanOutline / step);
  const n = (2 * o.harmonics + 1) * ((o.heightDegree ?? 0) + 1);
  const coarse = step < 2 ? Math.min(2, step * 4) : step;
  const ratio = step / coarse; // coarse samples relative to fine
  // every configured pass runs (early exit only with a minimum gain > 0, typically ~60 %)
  const P = o.refineMinGain > 0 ? Math.ceil(o.refineMaxIter * 0.6) : o.refineMaxIter;
  const Q = Math.min(o.refineMaxIter, o.perGlyphMaxIter ?? 12) * (o.refineMinGain > 0 ? 0.8 : 1);
  const fracCoarseG = coarse !== step ? 0.6 : 0;
  const NeffG = N * (fracCoarseG * ratio + (1 - fracCoarseG));
  const fineQ = Math.min(Q, 3);
  const NeffQ = Q > 0 ? N * (((Q - fineQ) * (coarse !== step ? ratio : 1) + fineQ) / Q) : 0;
  const parts = [
    { label: "sampling & first fit", seconds: CAL.A * G * N },
    { label: `global refinement · ${P} passes`, seconds: P * (CAL.Bg * G * NeffG + CAL.Cg * n * n) },
    { label: `per-glyph refinement · ${Math.round(Q)} passes × ${G}`, seconds: G * Q * (CAL.Bq * NeffQ + CAL.Cq * n * n) },
    { label: "slice fields & texture", seconds: CAL.S * G * o.slices * (1 + N / 2000) },
  ].map((p) => ({ ...p, seconds: p.seconds * CAL.browser }));
  return { seconds: parts.reduce((s, p) => s + p.seconds, 0), parts };
}

export const fmtDuration = (sec: number) => {
  if (!isFinite(sec)) return "—";
  if (sec < 60) return `${Math.max(1, Math.round(sec))} s`;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return s ? `${m} min ${s} s` : `${m} min`;
};
