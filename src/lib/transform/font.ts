import { measureKhmer, FontMetrics } from "../analysis/metrics";
import { StyleModel } from "../analysis/model";
import { buildFont, BuiltGlyph } from "../font/build";
import { FontHandle, glyphShape, setVariation, advanceOf, EM, glyphIdForChar } from "../font/load";
import { FontNames } from "../font/sfnt";
import { packShape } from "../geometry/types";
import { bboxOf } from "../geometry/types";
import { planTransfer, transformGlyph, TransferPlan } from "./apply";
import { TransferParams } from "./params";

export interface InstanceChoice {
  inst: FontHandle;
  metrics: FontMetrics;
  coords: Record<string, number>;
  note: string;
}

/** Picks the Khmer instance whose vertical stem best matches the transfer target. */
export function chooseInstance(kh: FontHandle, model: StyleModel, p: TransferParams): InstanceChoice {
  const m0 = measureKhmer(kh);
  const axis = kh.axes["wght"];
  if (!p.useAxes || !axis) return { inst: kh, metrics: m0, coords: kh.coords, note: "default instance" };
  const src = model.metrics.src;
  const target = m0.vstem + ((src.vstem / src.body) * m0.body - m0.vstem) * p.weight;
  const stemAt = (w: number) => {
    const h = setVariation(kh, { wght: w });
    return { h, m: measureKhmer(h) };
  };
  let lo = axis.min, hi = axis.max;
  let best = { w: axis.default, err: Math.abs(m0.vstem - target), h: kh, m: m0 };
  const lowEnd = stemAt(lo), highEnd = stemAt(hi);
  for (const [w, r] of [[lo, lowEnd], [hi, highEnd]] as const) {
    const e = Math.abs(r.m.vstem - target);
    if (e < best.err) best = { w, err: e, h: r.h, m: r.m };
  }
  if (target > lowEnd.m.vstem && target < highEnd.m.vstem) {
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2;
      const r = stemAt(mid);
      const e = Math.abs(r.m.vstem - target);
      if (e < best.err) best = { w: mid, err: e, h: r.h, m: r.m };
      if (r.m.vstem < target) lo = mid;
      else hi = mid;
    }
  }
  const coords = { ...kh.coords, wght: Math.round(best.w * 100) / 100 };
  return {
    inst: best.h,
    metrics: best.m,
    coords,
    note: `instance wght=${coords.wght} (stem ${best.m.vstem.toFixed(1)}, target ${target.toFixed(1)}, remainder via offset)`,
  };
}

export interface TransferResult {
  ttf: Uint8Array;
  plan: TransferPlan;
  instance: { coords: Record<string, number>; note: string; metrics: FontMetrics };
  report: string[];
  previews: { char: string; before: Float32Array[]; after: Float32Array[]; adv0: number; adv1: number }[];
  glyphCount: number;
  seconds: number;
}

export const PREVIEW_CHARS = "កខគឃងចឆជឈញដឋឌឍណតថទធនបផពភមយរលវសហឡអ";

export function transferFont(
  kh: FontHandle,
  model: StyleModel,
  p: TransferParams,
  names: FontNames,
  progress: (msg: string, f: number) => void,
): TransferResult {
  const t0 = performance.now();
  progress("choosing Khmer instance", 0);
  const choice = chooseInstance(kh, model, p);
  const inst = choice.inst;
  const plan = planTransfer(model, choice.metrics, p);
  const n = inst.font.numGlyphs as number;
  const emScale = inst.scale; // 1000-em per font unit
  const glyphs: BuiltGlyph[] = [];
  const dxs = new Float64Array(n);
  const previewIds = new Map<number, string>();
  for (const ch of PREVIEW_CHARS) {
    const gid = glyphIdForChar(inst, ch);
    if (gid) previewIds.set(gid, ch);
  }
  const previews: TransferResult["previews"] = [];
  const report: string[] = [...plan.notes, choice.note];
  let failures = 0;
  for (let gid = 0; gid < n; gid++) {
    const shape = glyphShape(inst, gid);
    const adv = advanceOf(inst, gid);
    let out;
    try {
      out = transformGlyph(shape, adv, model, plan, p, emScale, gid + 1);
    } catch (e) {
      failures++;
      out = { contours: [], shape: [], adv, dx: 0 };
    }
    dxs[gid] = out.dx;
    glyphs.push({ contours: out.contours, adv: out.adv / emScale });
    const ch = previewIds.get(gid);
    if (ch) previews.push({ char: ch, before: packShape(shape), after: packShape(out.shape), adv0: adv, adv1: out.adv });
    if (gid % 8 === 0) progress(`glyph ${gid + 1}/${n}`, 0.05 + (0.85 * gid) / n);
  }
  if (failures) report.push(`${failures} glyphs could not be transformed (left empty)`);
  progress("writing font", 0.92);
  const slantDeg = (Math.atan(plan.k) * 180) / Math.PI;
  const vp = inst.font._variationProcessor;
  const store = inst.font.GDEF?.itemVariationStore;
  const delta = vp && store ? (o: number, i: number) => vp.getDelta(store, o, i) : undefined;
  const built = buildFont(inst.base, glyphs, {
    names,
    italicAngle: -slantDeg,
    weightClass: weightClassFor(plan.targetV / (choice.metrics.body || 1)),
    italic: Math.abs(slantDeg) > 3 && /italic|oblique/i.test(names.style),
    bold: /bold/i.test(names.style),
    sx: plan.sx,
    anchorMap: (gid, x, y) => {
      const X = x * emScale, Y = y * emScale;
      const nx = plan.sx * X + plan.k * Y + (dxs[gid] ?? 0);
      return { x: nx / emScale, y: (plan.sy * Y) / emScale };
    },
    delta,
  });
  report.push(...built.report);
  progress("done", 1);
  return {
    ttf: built.ttf, plan, instance: { coords: choice.coords, note: choice.note, metrics: choice.metrics }, report, previews,
    glyphCount: n, seconds: (performance.now() - t0) / 1000,
  };
}

/** Map relative stem weight (stem / body height) to a usWeightClass estimate. */
export function weightClassFor(rel: number): number {
  // empirical anchors (Latin x-height based): hairline 0.04 … black 0.36
  const pts: [number, number][] = [[0.04, 100], [0.08, 200], [0.12, 300], [0.16, 400], [0.19, 500], [0.22, 600], [0.26, 700], [0.31, 800], [0.36, 900]];
  if (rel <= pts[0][0]) return 100;
  for (let i = 0; i < pts.length - 1; i++)
    if (rel <= pts[i + 1][0]) {
      const t = (rel - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
      return Math.round((pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t) / 50) * 50;
    }
  return 900;
}

export { EM, bboxOf };
