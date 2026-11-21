import { evalWave } from "../math/linalg";
import { CornerBin } from "./model";
import { recomputeNormals, RingSamples } from "../geometry/sample";
import { Pt, Ring, Shape } from "../geometry/types";

/** Mutable displaced copy of ring samples. */
export interface Live {
  rs: RingSamples;
  x: Float64Array;
  y: Float64Array;
  nx: Float64Array;
  ny: Float64Array;
}

export function makeLive(rs: RingSamples): Live {
  return { rs, x: rs.x.slice(), y: rs.y.slice(), nx: rs.nx.slice(), ny: rs.ny.slice() };
}

export function refreshNormals(l: Live) {
  const { nx, ny } = recomputeNormals(l.x, l.y, l.rs.corner);
  l.nx = nx;
  l.ny = ny;
}

export function liveToShape(lives: Live[]): Shape {
  return lives.map((l) => ({
    pts: Array.from(l.x, (x, i) => ({ x, y: l.y[i] })),
    corner: Array.from(l.rs.corner, (c) => c === 1),
  }));
}

export function liveToRings(lives: Live[]): Ring[] {
  return liveToShape(lives);
}

/** Monotone piecewise-linear vertical zone map with linear extrapolation. */
export function zoneMapper(from: number[], to: number[]): (y: number) => number {
  const n = from.length;
  if (n < 2) return (y) => y;
  return (y) => {
    let i = 0;
    if (y <= from[0]) i = 0;
    else if (y >= from[n - 1]) i = n - 2;
    else while (i < n - 2 && y > from[i + 1]) i++;
    const t = (y - from[i]) / (from[i + 1] - from[i]);
    return to[i] + (to[i + 1] - to[i]) * t;
  };
}

/** Offset all samples along their outward normal by f(φ); corners use a capped miter. */
export function applyNormalOffset(l: Live, f: (phi: number, x: number, y: number) => number) {
  const { corner, turn } = l.rs;
  for (let i = 0; i < l.x.length; i++) {
    const phi = Math.atan2(l.ny[i], l.nx[i]);
    let d = f(phi, l.x[i], l.y[i]);
    if (corner[i]) d *= Math.min(2, 1 / Math.max(0.5, Math.cos(turn[i] / 2)));
    l.x[i] += l.nx[i] * d;
    l.y[i] += l.ny[i] * d;
  }
}

/** Wave function evaluator; `vOf` maps a y coordinate to the normalised height v. */
export const wave = (coef: number[], K: number, D: number, vOf: (y: number) => number) =>
  (phi: number, _x: number, y: number) => evalWave(coef, phi, vOf(y), K, D);

/** Exact fillet deviation (along edge normal) at arc distance s from a corner apex. */
export function filletDeviation(rho: number, absTurn: number, s: number, convex: boolean): number {
  if (rho <= 0) return 0;
  const alpha = Math.PI - absTurn; // interior angle of the (ink or white) wedge
  const T = rho / Math.tan(alpha / 2);
  const a = Math.abs(s);
  let d: number;
  if (a >= T) d = 0;
  else {
    const q = T - a;
    d = rho - Math.sqrt(Math.max(0, rho * rho - q * q));
  }
  if (a < 1e-9) d = rho * (1 / Math.sin(alpha / 2) - 1); // apex along the bisector
  return convex ? -d : d;
}

/** Interpolate corner bins by turning angle; returns fillet radius and residual profile accessor. */
export function cornerLookup(bins: CornerBin[], convex: boolean, absTurn: number) {
  const cand = bins.filter((b) => b.convex === convex && b.count >= 3);
  if (!cand.length) return null;
  const centers = cand.map((b) => (b.lo + b.hi) / 2);
  let i = 0;
  while (i < cand.length - 1 && absTurn > centers[i + 1]) i++;
  let j = Math.min(cand.length - 1, i + 1);
  let t = 0;
  if (absTurn <= centers[0]) { i = j = 0; }
  else if (absTurn >= centers[cand.length - 1]) { i = j = cand.length - 1; }
  else t = (absTurn - centers[i]) / (centers[j] - centers[i] || 1);
  const A = cand[i], B = cand[j];
  const radius = A.radius + (B.radius - A.radius) * t;
  const W = (A.profile.length - 1) / 2;
  const prof = (arr: (b: CornerBin) => number[], s: number) => {
    const k = s + W;
    if (k < 0 || k > 2 * W) return 0;
    const k0 = Math.floor(k), k1 = Math.min(2 * W, k0 + 1), f = k - k0;
    const va = arr(A)[k0] + (arr(A)[k1] - arr(A)[k0]) * f;
    const vb = arr(B)[k0] + (arr(B)[k1] - arr(B)[k0]) * f;
    return va + (vb - va) * t;
  };
  return {
    radius,
    window: W,
    residual: (s: number) => prof((b) => b.profile, s),
    raw: (s: number) => prof((b) => b.raw, s),
  };
}

export function bboxOfLive(lives: Live[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const l of lives)
    for (let i = 0; i < l.x.length; i++) {
      minX = Math.min(minX, l.x[i]); maxX = Math.max(maxX, l.x[i]);
      minY = Math.min(minY, l.y[i]); maxY = Math.max(maxY, l.y[i]);
    }
  return { minX, minY, maxX, maxY };
}

export function packLive(lives: Live[]): Float32Array[] {
  return lives.map((l) => {
    const a = new Float32Array(l.x.length * 2);
    for (let i = 0; i < l.x.length; i++) { a[2 * i] = l.x[i]; a[2 * i + 1] = l.y[i]; }
    return a;
  });
}

export const P = (x: number, y: number): Pt => ({ x, y });
