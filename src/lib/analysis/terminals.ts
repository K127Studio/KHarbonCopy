import type { RingSamples } from "../geometry/sample";
import { mad, median } from "../math/stats";

/**
 * Stroke terminals (point 2 · stroke-level description).
 *
 * A terminal is the end of a stroke: two consecutive convex corners (turn ≥ 50°) whose arc
 * distance is about one stroke width. Its profile is the residual deviation along the arc from
 * u = −0.5 (half a cap before the first corner) to u = 1.5, with u normalised by the cap width,
 * so the same profile fits a thin hairline end and a heavy stem end. Flares, angled cuts,
 * rounded or pointed ends all show up as a characteristic shape of this profile.
 */
export const TERM_BINS = 41;
export const TERM_U0 = -0.5, TERM_U1 = 1.5;

export interface Terminal {
  /** ring sample index of the first corner and the cap width in samples */
  c1: number;
  c2: number;
  gapSamples: number;
  gap: number;
}

export interface TerminalModel {
  count: number;
  /** consistency-gated, smoothed residual profile (units relative to the source vertical stem) */
  profile: number[];
  /** raw median profile in units */
  raw: number[];
}

export function findTerminals(rs: RingSamples, minGap: number, maxGap: number): Terminal[] {
  const N = rs.n;
  const step = rs.length / Math.max(1, N);
  const cs: number[] = [];
  for (let i = 0; i < N; i++) if (rs.corner[i] && rs.turn[i] > (50 * Math.PI) / 180) cs.push(i);
  const out: Terminal[] = [];
  for (let k = 0; k < cs.length; k++) {
    const c1 = cs[k], c2 = cs[(k + 1) % cs.length];
    if (c1 === c2) continue;
    const gs = (c2 - c1 + N) % N;
    const gap = gs * step;
    if (gap >= minGap && gap <= maxGap) out.push({ c1, c2, gapSamples: gs, gap });
  }
  return out;
}

/** Sample index and normalised position u for every sample in the terminal's window. */
export function terminalWindow(t: Terminal, N: number): { idx: number; u: number }[] {
  const out: { idx: number; u: number }[] = [];
  const from = Math.floor(TERM_U0 * t.gapSamples), to = Math.ceil(TERM_U1 * t.gapSamples);
  for (let j = from; j <= to; j++) out.push({ idx: (t.c1 + j + N) % N, u: j / (t.gapSamples || 1) });
  return out;
}

export function buildTerminalModel(profiles: Float64Array[], stem: number): TerminalModel {
  const raw = new Array<number>(TERM_BINS).fill(0);
  const gated = new Array<number>(TERM_BINS).fill(0);
  for (let k = 0; k < TERM_BINS; k++) {
    const v = profiles.map((p) => p[k]).filter(isFinite);
    if (v.length < 3) continue;
    const med = median(v);
    const se = (1.8533 * mad(v)) / Math.sqrt(v.length);
    raw[k] = med;
    gated[k] = (med * med * med) / (med * med + se * se + 1e-12);
  }
  // gaussian smoothing (σ = 1.5 bins) and a cosine taper at both ends; clamp to ±0.15 stem
  const sm = gated.map((_, k) => {
    let s = 0, w = 0;
    for (let j = -4; j <= 4; j++) {
      const q = k + j;
      if (q < 0 || q >= TERM_BINS) continue;
      const ww = Math.exp(-(j * j) / (2 * 1.5 * 1.5));
      s += ww * gated[q]; w += ww;
    }
    const u = Math.abs(k - (TERM_BINS - 1) / 2) / ((TERM_BINS - 1) / 2);
    const taper = u < 0.7 ? 1 : Math.cos(((u - 0.7) / 0.3) * (Math.PI / 2)) ** 2;
    return Math.max(-0.15 * stem, Math.min(0.15 * stem, (s / w) * taper));
  });
  return { count: profiles.length, profile: sm.map((v) => v / (stem || 1)), raw };
}

export function profileAt(m: TerminalModel, u: number): number {
  const x = ((u - TERM_U0) / (TERM_U1 - TERM_U0)) * (TERM_BINS - 1);
  if (x < 0 || x > TERM_BINS - 1) return 0;
  const i = Math.floor(x), f = x - i;
  return m.profile[i] * (1 - f) + (m.profile[Math.min(TERM_BINS - 1, i + 1)] ?? 0) * f;
}
