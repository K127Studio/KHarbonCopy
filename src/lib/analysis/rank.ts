import { FontHandle, glyphIdForChar, glyphShape, setVariation } from "../font/load";
import { SignedDistance } from "../geometry/sdf";
import { sampleShape } from "../geometry/sample";
import { bboxOf, centroid, mapShape, Shape } from "../geometry/types";
import { mean, median } from "../math/stats";
import { FontMetrics, measureLatin, shear, strokeMode } from "./metrics";

/**
 * Fast reference ranking. For each candidate reference:
 *  1. weight match — the instance (variable wght axis or static file) whose relative stem
 *     (vertical stem / x-height) is closest to the source's, using a light stem estimate;
 *  2. shape score — the candidate glyphs are mapped with the same global affine as the
 *     analysis (slant, width, zone map), sampled every 4 units and compared with the source
 *     through exact signed distance fields; the uniform weight difference (median) is removed
 *     and the remaining mean |d| is the score (lower = closer design).
 */
export const RANK_CHARS = "HOnoaegsbdpRk";

export interface RankEntry {
  id: string;
  name: string;
  category: string;
  trait?: string;
  file: string;
  coords: Record<string, number>;
  /** final score: shape score with slant and category priors (lower = closer) */
  score: number;
  /** pure shape score (median-removed mean |d|) */
  shape?: number;
  /** |source slant − reference slant| in degrees */
  slantDiff?: number;
  coverage: number;
}

/** Light relative-stem estimate: vertical stem of l/n/H (de-slanted) over x-height. */
export function quickRelStem(h: FontHandle): number {
  const shapes: Shape[] = [];
  for (const c of "lnH") {
    const g = glyphIdForChar(h, c);
    if (g) { const s = glyphShape(h, g); if (s.length) shapes.push(s); }
  }
  const gx = glyphIdForChar(h, "x");
  const xh = gx ? bboxOf(glyphShape(h, gx)).maxY : 500;
  if (!shapes.length) return 0;
  const vstem = strokeMode(shapes, "y", 0.3, 0.7, xh * 0.6, 12);
  return vstem / (xh || 1);
}

/** Pick the instance of a reference family closest in relative weight. */
export function weightMatch(handles: { h: FontHandle; file: string }[], target: number): { h: FontHandle; file: string; coords: Record<string, number> } {
  let best: { h: FontHandle; file: string; coords: Record<string, number>; err: number } | null = null;
  for (const { h, file } of handles) {
    const ax = h.axes["wght"];
    if (ax) {
      // sample the axis, then refine around the best sample (stem is monotone in wght)
      const grid = [0, 0.25, 0.5, 0.75, 1].map((t) => ax.min + (ax.max - ax.min) * t);
      const vals = grid.map((w) => ({ w, r: quickRelStem(setVariation(h, { wght: w })) }));
      let lo = ax.min, hi = ax.max;
      for (let i = 0; i < vals.length - 1; i++) if ((vals[i].r - target) * (vals[i + 1].r - target) <= 0) { lo = vals[i].w; hi = vals[i + 1].w; }
      let w = vals.reduce((a, b) => (Math.abs(b.r - target) < Math.abs(a.r - target) ? b : a)).w;
      for (let it = 0; it < 5 && hi - lo > 1; it++) {
        const mid = (lo + hi) / 2;
        const r = quickRelStem(setVariation(h, { wght: mid }));
        if (r < target) lo = mid; else hi = mid;
        w = mid;
      }
      const v = setVariation(h, { wght: w });
      const err = Math.abs(quickRelStem(v) - target);
      if (!best || err < best.err) best = { h: v, file, coords: v.coords, err };
    } else {
      const err = Math.abs(quickRelStem(h) - target);
      if (!best || err < best.err) best = { h, file, coords: {}, err };
    }
  }
  return best!;
}

export interface SourceProbe {
  m: FontMetrics;
  glyphs: Map<string, { S: Shape; sdf: SignedDistance }>;
  range: number;
}

export function prepareSource(src: FontHandle): SourceProbe {
  const m = measureLatin(src);
  const range = Math.max(40, 0.35 * m.xHeight);
  const glyphs = new Map<string, { S: Shape; sdf: SignedDistance }>();
  for (const c of RANK_CHARS) {
    const g = glyphIdForChar(src, c);
    if (!g) continue;
    const S = glyphShape(src, g);
    if (S.length) glyphs.set(c, { S, sdf: new SignedDistance(S, 3, range + 20) });
  }
  return { m, glyphs, range };
}

export function scoreReference(probe: SourceProbe, ref: FontHandle): { score: number; coverage: number } {
  const mS = probe.m, mR = measureLatin(ref);
  const hr = mR.hstem / 2, hs = mS.hstem / 2;
  // vertical map on stroke centres: baseline and x-height (and caps when meaningful)
  const from = [mR.baseline + hr, mR.xHeight - hr, mR.capHeight - hr];
  const to = [mS.baseline + hs, mS.xHeight - hs, mS.capHeight - hs];
  const Z = (y: number) => {
    const i = y <= from[1] ? 0 : 1;
    const t = (y - from[i]) / ((from[i + 1] - from[i]) || 1);
    return to[i] + (to[i + 1] - to[i]) * t;
  };
  const ds: number[] = [];
  let total = 0;
  for (const [c, { S, sdf }] of probe.glyphs) {
    const g = glyphIdForChar(ref, c);
    if (!g) continue;
    const R = glyphShape(ref, g);
    if (!R.length) continue;
    const A = mapShape(R, (q) => { const y = Z(q.y); return { x: q.x - mR.slant * q.y + mS.slant * y, y }; });
    // width: match ink widths (de-slanted) after removing the stem difference
    const bS = bboxOf(shear(S, -mS.slant)), bA = bboxOf(shear(A, -mS.slant));
    const sx = Math.max(0.5, Math.min(2, (bS.maxX - bS.minX - (mS.vstem - mR.vstem)) / ((bA.maxX - bA.minX) || 1)));
    const cA0 = centroid(A);
    const A2 = mapShape(A, (q) => ({ x: cA0.x + (q.x - cA0.x) * sx, y: q.y }));
    const cS = centroid(S), cA = centroid(A2);
    const R1 = mapShape(A2, (q) => ({ x: q.x + cS.x - cA.x, y: q.y }));
    for (const rs of sampleShape(R1, 4)) {
      for (let i = 0; i < rs.n; i++) {
        total++;
        const q = sdf.query(rs.x[i], rs.y[i]);
        const cos = q ? q.nx * rs.nx[i] + q.ny * rs.ny[i] : 0;
        if (q && cos > 0.35 && Math.abs(q.d / cos) <= probe.range) ds.push(-q.d / cos);
      }
    }
  }
  if (!ds.length) return { score: Infinity, coverage: 0 };
  const med = median(ds);
  const coverage = ds.length / (total || 1);
  // unmatched samples count at the search range, so a reference cannot win by matching less
  const score = (mean(ds.map((v) => Math.abs(v - med))) * ds.length + probe.range * (total - ds.length)) / (total || 1);
  return { score, coverage };
}
