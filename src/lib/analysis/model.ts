import { Grid } from "./field";
import { Category, FontMetrics } from "./metrics";

export interface CornerBin {
  convex: boolean;
  /** turning-angle range (radians, absolute) */
  lo: number;
  hi: number;
  count: number;
  /** best-fit exact fillet radius (units, 1000-em) */
  radius: number;
  /** RMS of the profile residual after removing the fillet */
  residualRms: number;
  /** residual deviation profile vs signed arc distance (index = s + window) */
  profile: number[];
  /** raw median profile before fillet removal */
  raw: number[];
}

export interface TextureBand {
  lo: number; // wavelength lo (units)
  hi: number;
  /** one-sided power spectral density (units² per cycle/unit) */
  psd: number;
}

export interface TextureModel {
  cutoff: number;
  step: number;
  bands: TextureBand[];
  rms: number;
  skewness: number;
  kurtosis: number;
  corrLength: number;
  /** spikes beyond 3σ per 1000 units of outline */
  notchRate: number;
  notchWidth: number;
  notchAmp: number;
  /** relative RMS per outward-normal direction (8 bins starting at φ = 0) */
  phiMod: number[];
  /** concatenated high-pass residual of all inlier contours (sample spacing = step) */
  tape: number[];
}

export interface StageStat {
  name: string;
  meanAbs: number;
  rms: number;
  p95: number;
  max: number;
  iou: number;
  coverage: number;
  /** refinement objective: mean |d| with unmatched samples counted at the search range */
  objective?: number;
  /** smooth objective used for acceptance: Cauchy-weighted Charbonnier loss */
  smooth?: number;
}

export interface RefinementStep {
  objective?: number;
  smooth?: number;
  /** bidirectional term: mean distance from the source outline to the transformed reference */
  reverse?: number;
  iter: number;
  meanAbs: number;
  rms: number;
  p95: number;
  iou: number;
  accepted: boolean;
  note: string;
}

export interface StyleModel {
  version: 1;
  createdAt: string;
  options: AnalysisOptions;
  source: { family: string; style: string; category: Category };
  reference: { id: string; name: string; file: string; coords: Record<string, number> };
  metrics: { src: FontMetrics; ref: FontMetrics };
  global: {
    shear: number;
    slantDeg: number;
    sx: number;
    widthIntercept: number;
    zoneFrom: number[];
    zoneTo: number[];
    /** automatic affine check: score of each variant, ✓ = used */
    affineChoice?: string;
  };
  /** coef = consistency-gated wave function used for transfer; coefRaw = before gating */
  /**
   * wave function O(φ, v): Fourier order K in φ × Legendre degree D in height v,
   * v = (y − vRef.baseline) / vRef.height (0 = baseline, 1 = x-height of the source)
   */
  normalFn: {
    coef: number[]; coefRaw: number[]; trust: number[]; K: number; D: number;
    /** bootstrap standard error and 95 % confidence interval of each coefficient (over glyphs) */
    se?: number[]; ci?: [number, number][];
    vRef: { baseline: number; height: number }; scale: number; samples: number;
  };
  /** how much the source/reference comparison can be trusted (stage-2 IoU) */
  reliability: { iou: number; zones: { desc: boolean; x: boolean; asc: boolean }; level: "high" | "medium" | "low" };
  fields: {
    G: number;
    /** relative warp (fraction of glyph box) */
    wx: Grid; wy: Grid;
    /** relative thickness change (fraction of stem) */
    th: Grid; tv: Grid;
    spread: { wx: number[]; wy: number[]; th: number[]; tv: number[] };
  };
  corners: { window: number; bins: CornerBin[] };
  /** stroke-end profile (point 2), relative to the source vertical stem */
  terminals?: import("./terminals").TerminalModel;
  /** history of the iterative refinement of O(phi) and corner kernels */
  refinement: RefinementStep[];
  /** analysis constants that were out of range and clamped before running */
  optionFixes?: string[];
  texture: TextureModel;
  fidelity: StageStat[];
  glyphCount: number;
  outliers: string[];
}

export interface AnalysisOptions {
  /** arc-length sample spacing (units of the 1000 em) */
  step: number;
  /** Fourier harmonics of the normal-offset function */
  harmonics: number;
  /** slices per direction */
  slices: number;
  /** field grid resolution */
  grid: number;
  /** corner analysis window (units); 0 = automatic (0.75 · stem) */
  cornerWindow: number;
  /** texture high-pass cutoff wavelength (units) */
  textureCutoff: number;
  /** match reference weight to source before measuring */
  matchWeight: boolean;
  /** height dependence of the wave function: Legendre degree in v (0 = O(φ) only) */
  heightDegree: number;
  /** iterative refinement: max passes (hard cap 50, protects against infinite loops) */
  refineMaxIter: number;
  /** per-glyph refinement: max passes per glyph (bounded separately, it runs once per glyph) */
  perGlyphMaxIter: number;
  /** stop when the mean |deviation| of the transferable model (units) is below this */
  refineThreshold: number;
  /** stop when a pass improves the error by less than this fraction */
  refineMinGain: number;
  /** relaxation factor of each correction (1 = full step) */
  refineRelax: number;
  /** characters analysed */
  charset: string;
}

export const DEFAULT_OPTIONS: AnalysisOptions = {
  step: 0.5,
  harmonics: 12,
  slices: 128,
  grid: 24,
  cornerWindow: 0,
  textureCutoff: 140,
  matchWeight: true,
  heightDegree: 2,
  refineMaxIter: 30,
  perGlyphMaxIter: 12,
  refineThreshold: 0.1,
  refineMinGain: 0.001,
  refineRelax: 1,
  charset: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789&?!",
};

/** Per-glyph diagnostic data shipped to the UI. */
export interface GlyphReport {
  char: string;
  outlier: boolean;
  reason?: string;
  /** source outline */
  src: Float32Array[];
  /** stage outlines (polylines of the displaced samples): 0 raw, 1 affine, 2 normal fn, 3 corners, 4 fields, 5 texture */
  stages: Float32Array[][];
  /** per ring: arc positions and residual deviation after each stage (NaN where unmatched) */
  rings: { s: Float32Array; phi: Float32Array; dev: Float32Array[]; corner: Uint8Array; length: number }[];
  stats: StageStat[];
  /** state after this glyph's own refinement (its exact fit) */
  refined?: StageStat;
  refineSteps: RefinementStep[];
  /** this glyph's converged wave function O_g(phi) */
  coefG: number[];
  slicesH: { c: number; src: [number, number][]; ref: [number, number][] }[];
  slicesV: { c: number; src: [number, number][]; ref: [number, number][] }[];
  box: { minX: number; minY: number; maxX: number; maxY: number };
  fields: { G: number; wx: number[]; wy: number[]; th: number[]; tv: number[] };
}

export const STAGE_NAMES = [
  "0 · raw reference",
  "1 · global affine",
  "2 · normal function O(φ)",
  "3 · corner kernels",
  "4 · slice fields",
  "5 · texture",
];

/**
 * Clamp every analysis constant to a safe range (non-finite → default). Returns the cleaned options
 * and a human-readable list of what was changed.
 */
export function sanitizeOptions(o: Partial<AnalysisOptions>): { options: AnalysisOptions; fixes: string[] } {
  const fixes: string[] = [];
  const out = { ...DEFAULT_OPTIONS, ...o } as AnalysisOptions;
  const num = (k: keyof AnalysisOptions, lo: number, hi: number, int = false) => {
    let v = Number(out[k]);
    const before = v;
    if (!isFinite(v)) v = DEFAULT_OPTIONS[k] as number;
    v = Math.min(hi, Math.max(lo, int ? Math.round(v) : v));
    if (v !== before) fixes.push(`${String(k)}: ${before} → ${v}`);
    (out as unknown as Record<string, unknown>)[k] = v;
  };
  num("step", 0.25, 4);
  num("harmonics", 1, 16, true);
  num("slices", 8, 256, true);
  num("grid", 4, 48, true);
  num("cornerWindow", 0, 300);
  num("textureCutoff", 20, 600);
  num("heightDegree", 0, 3, true);
  num("refineMaxIter", 0, 50, true);
  num("perGlyphMaxIter", 0, 50, true);
  num("refineThreshold", 0, 50);
  num("refineMinGain", 0, 0.5);
  num("refineRelax", 0.05, 2);
  if (typeof out.charset !== "string" || ![...out.charset].some((c) => c.trim())) {
    fixes.push("charset: empty → default");
    out.charset = DEFAULT_OPTIONS.charset;
  }
  out.matchWeight = !!out.matchWeight;
  return { options: out, fixes };
}
