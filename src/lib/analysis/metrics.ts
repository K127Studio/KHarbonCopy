import { FontHandle, glyphIdForChar, glyphShape, advanceOf, EM } from "../font/load";
import { scanRuns } from "../geometry/scanline";
import { bboxOf, mapShape, Shape } from "../geometry/types";
import { kdeMode, median, weightedMedian } from "../math/stats";

import { Category } from "./categories";
export { CATEGORIES, DEFAULT_REFERENCE } from "./categories";
export type { Category } from "./categories";

export interface FontMetrics {
  xHeight: number;
  capHeight: number;
  ascender: number;
  descender: number;
  /** thickness of vertical stems (measured on horizontal slices) */
  vstem: number;
  /** thickness of horizontal strokes (measured on vertical slices) */
  hstem: number;
  /** stem slant as tan(angle) (positive = leaning right) */
  slant: number;
  /** body height used to normalise weight (x-height for Latin, consonant body for Khmer) */
  body: number;
  /** ink bottom of flat-bottomed glyphs (≈0, lower when ink grows below the baseline) */
  baseline: number;
}

const shapeFor = (h: FontHandle, ch: string): Shape | null => {
  const gid = glyphIdForChar(h, ch);
  if (!gid) return null;
  const s = glyphShape(h, gid);
  return s.length ? s : null;
};

function topOf(h: FontHandle, chars: string, which: "max" | "min"): number | null {
  const vals: number[] = [];
  for (const ch of chars) {
    const s = shapeFor(h, ch);
    if (!s) continue;
    const b = bboxOf(s);
    vals.push(which === "max" ? b.maxY : b.minY);
  }
  return vals.length ? median(vals) : null;
}

/** Dominant near-vertical straight-edge slant (tan), length-weighted median. */
export function measureSlant(shapes: Shape[], minLen: number): number {
  const vals: number[] = [];
  const w: number[] = [];
  for (const shape of shapes)
    for (const r of shape) {
      const n = r.pts.length;
      let i = 0;
      // walk straight runs
      while (i < n) {
        const a = r.pts[i];
        let j = i + 1;
        let b = r.pts[j % n];
        const dir = Math.atan2(b.y - a.y, b.x - a.x);
        while (j < n + i) {
          const c = r.pts[(j + 1) % n];
          const d2 = Math.atan2(c.y - a.y, c.x - a.x);
          let diff = Math.abs(d2 - dir);
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          if (diff > (0.6 * Math.PI) / 180) break;
          j++;
          b = c;
        }
        const dx = b.x - a.x, dy = b.y - a.y;
        const L = Math.hypot(dx, dy);
        if (L >= minLen && Math.abs(dy) > 0 && Math.abs(dx / dy) < Math.tan((35 * Math.PI) / 180)) {
          vals.push(dx / dy);
          w.push(L);
        }
        i = Math.max(j, i + 1);
      }
    }
  return vals.length ? weightedMedian(vals, w) : 0;
}

export const shear = (s: Shape, k: number) => mapShape(s, (p) => ({ x: p.x + k * p.y, y: p.y }));

/** Mode of run lengths across slices; `axis` "y" = horizontal slices (vertical stems). */
export function strokeMode(shapes: Shape[], axis: "y" | "x", lo: number, hi: number, maxRun: number, slices = 24): number {
  const runs: number[] = [];
  for (const s of shapes) {
    const b = bboxOf(s);
    for (let i = 0; i < slices; i++) {
      const t = lo + ((hi - lo) * (i + 0.5)) / slices;
      const c = axis === "y" ? b.minY + (b.maxY - b.minY) * t : b.minX + (b.maxX - b.minX) * t;
      for (const r of scanRuns(s, c, axis)) {
        const L = r.b - r.a;
        if (L > 1 && L < maxRun) runs.push(L);
      }
    }
  }
  if (!runs.length) return 0;
  // mode of the lower cluster (stems), bandwidth ~2% of median
  return kdeMode(runs, Math.max(0.5, median(runs) * 0.04));
}

const LATIN_VSTEM = "lnmhuiIHdbpq";
const LATIN_HSTEM = "HEFTezo";
export const KHMER_BODY = "កគងចជញដណតទនបពមយរវសហអ";

export function measureLatin(h: FontHandle): FontMetrics {
  const xHeight = topOf(h, "xzvw", "max") ?? (h.font["OS/2"]?.xHeight ? h.font["OS/2"].xHeight * h.scale : EM * 0.5);
  const capHeight = topOf(h, "HIEFTZ", "max") ?? (h.font["OS/2"]?.capHeight ? h.font["OS/2"].capHeight * h.scale : EM * 0.7);
  const ascender = topOf(h, "bdhkl", "max") ?? capHeight;
  const descender = topOf(h, "pq", "min") ?? -EM * 0.2;
  const baseline = topOf(h, "xzHIELn", "min") ?? 0;
  const shapes = [...LATIN_VSTEM].map((c) => shapeFor(h, c)).filter(Boolean) as Shape[];
  const slant = measureSlant([...shapes, ...([..."HIEFTLN"].map((c) => shapeFor(h, c)).filter(Boolean) as Shape[])], xHeight * 0.12);
  const up = shapes.map((s) => shear(s, -slant));
  const vstem = strokeMode(up, "y", 0.3, 0.7, xHeight * 0.6);
  const hs = ([...LATIN_HSTEM].map((c) => shapeFor(h, c)).filter(Boolean) as Shape[]).map((s) => shear(s, -slant));
  const hstem = strokeMode(hs, "x", 0.3, 0.7, xHeight * 0.45);
  return { xHeight, capHeight, ascender, descender, vstem, hstem, slant, body: xHeight - baseline, baseline };
}

const zoneCache = new WeakMap<object, { subBottom: number; vowelTop: number }>();

export function measureKhmer(h: FontHandle): FontMetrics {
  const shapes = [...KHMER_BODY].map((c) => shapeFor(h, c)).filter(Boolean) as Shape[];
  const tops = shapes.map((s) => bboxOf(s).maxY);
  const bottoms = shapes.map((s) => bboxOf(s).minY);
  const baseline = bottoms.length ? median(bottoms) : 0;
  const body = (tops.length ? median(tops) : EM * 0.55) - baseline;
  const slant = measureSlant(shapes, body * 0.12);
  const up = shapes.map((s) => shear(s, -slant));
  const vstem = strokeMode(up, "y", 0.3, 0.7, body * 0.5);
  const hstem = strokeMode(up, "x", 0.3, 0.7, body * 0.4);
  // Khmer zones (point 3): subscripts (coeng forms) live below the baseline, dependent vowels and
  // diacritics above the consonant body. They are only reachable through shaping, so the zones are
  // read from the control boxes of ALL glyphs: robust percentiles of the bottoms / tops that clearly
  // leave the body.
  const top = body + baseline;
  // zones barely change with weight: computed once per font file (default instance) and cached
  let z = zoneCache.get(h.base);
  if (!z) {
    const lows: number[] = [], highs: number[] = [];
    const n = h.base.numGlyphs as number;
    for (let gid = 0; gid < n; gid++) {
      let b: { minY: number; maxY: number } | null = null;
      try { b = h.base.getGlyph(gid).cbox; } catch { b = null; }
      if (!b || !isFinite(b.minY) || b.maxY - b.minY < 1) continue;
      const lo = b.minY * h.scale, hi = b.maxY * h.scale;
      if (lo < baseline - 0.15 * body) lows.push(lo);
      if (hi > top + 0.15 * body) highs.push(hi);
    }
    const pct = (arr: number[], q: number) => (arr.length ? arr.sort((x, y) => x - y)[Math.min(arr.length - 1, Math.floor(q * arr.length))] : NaN);
    z = { subBottom: pct(lows, 0.25), vowelTop: pct(highs, 0.75) }; // ignore a few extreme outliers
    zoneCache.set(h.base, z);
  }
  const { subBottom, vowelTop } = z;
  return {
    xHeight: top, capHeight: top,
    ascender: isFinite(vowelTop) ? vowelTop : top + 0.45 * body,
    descender: isFinite(subBottom) ? subBottom : baseline - 0.55 * body,
    vstem, hstem, slant, body, baseline,
  };
}

export interface CategoryGuess {
  category: Category;
  confidence: number;
  evidence: string[];
}

export function detectCategory(h: FontHandle, m: FontMetrics): CategoryGuess {
  const ev: string[] = [];
  const panose: number[] = Array.from(h.font["OS/2"]?.panose ?? []);
  const fixed = !!h.font.post?.isFixedPitch;
  const advs = [..."abcdefghijklmnopqrstuvwxyz"].map((c) => advanceOf(h, glyphIdForChar(h, c))).filter((a) => a > 0);
  const meanAdv = advs.reduce((s, a) => s + a, 0) / (advs.length || 1);
  const cv = advs.length ? Math.sqrt(advs.reduce((s, a) => s + (a - meanAdv) ** 2, 0) / advs.length) / meanAdv : 1;
  if (fixed || cv < 0.01) {
    ev.push(fixed ? "post.isFixedPitch = 1" : `advance CV ${(cv * 100).toFixed(2)}%`);
    return { category: "monospace", confidence: 0.95, evidence: ev };
  }
  if (panose[0] === 3) return { category: "handwriting", confidence: 0.85, evidence: ["PANOSE family = Script"] };
  // geometric serif test on 'l' / 'I'
  let serifRatio = 1, footThick = 0;
  for (const ch of "lI") {
    const s0 = shapeFor(h, ch);
    if (!s0) continue;
    const s = shear(s0, -m.slant);
    const b = bboxOf(s);
    const H = b.maxY - b.minY;
    const mid = scanRuns(s, b.minY + H * 0.5, "y");
    const foot = scanRuns(s, b.minY + Math.max(1.5, H * 0.012), "y");
    const wMid = Math.max(0, ...mid.map((r) => r.b - r.a));
    const footRun = foot.reduce((best, r) => (r.b - r.a > best.b - best.a ? r : best), { a: 0, b: 0 });
    const wFoot = footRun.b - footRun.a;
    if (wMid > 0) {
      serifRatio = Math.max(serifRatio, wFoot / wMid);
      ev.push(`'${ch}' foot/stem width ratio ${(wFoot / wMid).toFixed(2)}`);
      if (wFoot / wMid > 1.6) {
        const x = footRun.a + (wFoot - wMid) * 0.12;
        const v = scanRuns(s, x, "x").filter((r) => r.a < b.minY + H * 0.2);
        footThick = Math.max(footThick, ...v.map((r) => r.b - r.a), 0);
      }
    }
    break;
  }
  if (panose[0] === 4) ev.push("PANOSE family = Decorative");
  if (serifRatio > 1.6) {
    const slab = footThick / (m.vstem || 1);
    ev.push(`serif thickness / stem ${slab.toFixed(2)}`);
    if (slab > 0.55 || panose[1] === 6) return { category: "slab-serif", confidence: 0.8, evidence: ev };
    return { category: "serif", confidence: 0.85, evidence: ev };
  }
  if (panose[0] === 4) return { category: "display", confidence: 0.6, evidence: ev };
  if (Math.abs(m.slant) > 0.18 && panose[0] !== 2) {
    ev.push(`strong slant ${(Math.atan(m.slant) * 180 / Math.PI).toFixed(1)}°`);
    return { category: "handwriting", confidence: 0.45, evidence: ev };
  }
  return { category: "sans-serif", confidence: 0.8, evidence: ev };
}

