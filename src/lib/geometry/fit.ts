import { Pt, Ring } from "./types";

/** TrueType contour point. */
export interface TTPoint {
  x: number;
  y: number;
  on: boolean;
}

type Cubic = [Pt, Pt, Pt, Pt];

const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dotp = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const len = (a: Pt) => Math.hypot(a.x, a.y);
const norm = (a: Pt): Pt => {
  const l = len(a);
  return l > 1e-15 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};

function bez(c: Cubic, t: number): Pt {
  const u = 1 - t;
  const b0 = u * u * u, b1 = 3 * u * u * t, b2 = 3 * u * t * t, b3 = t * t * t;
  return { x: b0 * c[0].x + b1 * c[1].x + b2 * c[2].x + b3 * c[3].x, y: b0 * c[0].y + b1 * c[1].y + b2 * c[2].y + b3 * c[3].y };
}
function bezD1(c: Cubic, t: number): Pt {
  const u = 1 - t;
  return add(add(mul(sub(c[1], c[0]), 3 * u * u), mul(sub(c[2], c[1]), 6 * u * t)), mul(sub(c[3], c[2]), 3 * t * t));
}
function bezD2(c: Cubic, t: number): Pt {
  const u = 1 - t;
  return add(mul(add(sub(c[2], mul(c[1], 2)), c[0]), 6 * u), mul(add(sub(c[3], mul(c[2], 2)), c[1]), 6 * t));
}

function chordParams(p: Pt[]): number[] {
  const u = [0];
  for (let i = 1; i < p.length; i++) u.push(u[i - 1] + len(sub(p[i], p[i - 1])));
  const L = u[u.length - 1] || 1;
  return u.map((v) => v / L);
}

function generateBezier(p: Pt[], u: number[], t1: Pt, t2: Pt): Cubic {
  const first = p[0], last = p[p.length - 1];
  let c00 = 0, c01 = 0, c11 = 0, x0 = 0, x1 = 0;
  for (let i = 0; i < p.length; i++) {
    const t = u[i], s = 1 - t;
    const b0 = s * s * s, b1 = 3 * s * s * t, b2 = 3 * s * t * t, b3 = t * t * t;
    const a1 = mul(t1, b1), a2 = mul(t2, b2);
    c00 += dotp(a1, a1); c01 += dotp(a1, a2); c11 += dotp(a2, a2);
    const tmp = sub(p[i], add(mul(first, b0 + b1), mul(last, b2 + b3)));
    x0 += dotp(a1, tmp); x1 += dotp(a2, tmp);
  }
  const det = c00 * c11 - c01 * c01;
  let al = 0, ar = 0;
  if (Math.abs(det) > 1e-12) {
    al = (x0 * c11 - x1 * c01) / det;
    ar = (c00 * x1 - c01 * x0) / det;
  }
  const segLen = len(sub(last, first));
  const eps = 1e-6 * segLen;
  // degenerate or runaway solutions (near-collinear samples) → Schneider's fallback handles
  if (al < eps || ar < eps || al > 1.5 * segLen || ar > 1.5 * segLen) { al = ar = segLen / 3; }
  return [first, add(first, mul(t1, al)), add(last, mul(t2, ar)), last];
}

function newtonReparam(c: Cubic, p: Pt[], u: number[]): number[] {
  return u.map((t, i) => {
    const d = sub(bez(c, t), p[i]);
    const d1 = bezD1(c, t), d2 = bezD2(c, t);
    const num = dotp(d, d1);
    const den = dotp(d1, d1) + dotp(d, d2);
    if (Math.abs(den) < 1e-12) return t;
    const nt = t - num / den;
    return nt < 0 ? 0 : nt > 1 ? 1 : nt;
  });
}

/** True geometric max distance from samples to curve (dense projection), used as fit error. */
function maxError(c: Cubic, p: Pt[], u: number[]): { err: number; split: number } {
  let err = 0, split = Math.floor(p.length / 2);
  for (let i = 1; i < p.length - 1; i++) {
    const d = len(sub(bez(c, u[i]), p[i]));
    if (d > err) { err = d; split = i; }
  }
  return { err, split };
}

function fitCubicRec(p: Pt[], t1: Pt, t2: Pt, tol: number, out: Cubic[], depth = 0) {
  if (p.length === 2) {
    const d = len(sub(p[1], p[0])) / 3;
    out.push([p[0], add(p[0], mul(t1, d)), add(p[1], mul(t2, d)), p[1]]);
    return;
  }
  let u = chordParams(p);
  let c = generateBezier(p, u, t1, t2);
  let { err, split } = maxError(c, p, u);
  if (err <= tol) { out.push(c); return; }
  if (err <= tol * 6) {
    for (let it = 0; it < 30; it++) {
      u = newtonReparam(c, p, u);
      c = generateBezier(p, u, t1, t2);
      ({ err, split } = maxError(c, p, u));
      if (err <= tol) { out.push(c); return; }
    }
  }
  if (depth > 40 || p.length < 4) { out.push(c); return; }
  split = Math.max(1, Math.min(p.length - 2, split));
  const tc = norm(sub(p[split - 1], p[split + 1]));
  fitCubicRec(p.slice(0, split + 1), t1, tc, tol, out, depth + 1);
  fitCubicRec(p.slice(split), mul(tc, -1), t2, tol, out, depth + 1);
}

/** One-sided tangent estimate from the first points within `reach` arc length. */
function endTangent(p: Pt[], fromStart: boolean, reach: number): Pt {
  const n = p.length;
  const o = fromStart ? p[0] : p[n - 1];
  let acc = { x: 0, y: 0 };
  let dist = 0;
  for (let k = 1; k < n; k++) {
    const q = fromStart ? p[k] : p[n - 1 - k];
    const prev = fromStart ? p[k - 1] : p[n - k];
    dist += len(sub(q, prev));
    const v = norm(sub(q, o));
    const w = 1 / k;
    acc = add(acc, mul(v, w));
    if (dist >= reach) break;
  }
  return norm(acc);
}

/**
 * Least-squares cubic fit (Schneider) of an open point run with corner-free interior.
 * Free ends use one-sided tangents.
 */
export function fitOpen(p: Pt[], tol: number, reach: number, t1?: Pt, t2?: Pt): Cubic[] {
  const out: Cubic[] = [];
  const pts = densify(dedupe(p), Math.max(0.5, reach / 4));
  if (pts.length < 2) return out;
  fitCubicRec(pts, t1 ?? endTangent(pts, true, reach), t2 ?? endTangent(pts, false, reach), tol, out);
  return out;
}

/** Insert points so no segment is longer than maxSeg (long collinear edges left by clipping). */
function densify(p: Pt[], maxSeg: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < p.length; i++) {
    out.push(p[i]);
    if (i === p.length - 1) break;
    const a = p[i], b = p[i + 1];
    const n = Math.floor(len(sub(b, a)) / maxSeg);
    for (let k = 1; k <= n; k++) {
      const t = k / (n + 1);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function dedupe(p: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const q of p) if (!out.length || len(sub(q, out[out.length - 1])) > 1e-6) out.push(q);
  return out;
}

// ---------------------------------------------------------------- cu2qu

function calcIntersect(a: Pt, b: Pt, c: Pt, d: Pt): Pt | null {
  const ab = sub(b, a), cd = sub(d, c);
  const p = { x: -ab.y, y: ab.x };
  const den = dotp(cd, p);
  if (Math.abs(den) < 1e-12) {
    if (len(sub(b, c)) < 1e-9 || len(sub(a, b)) < 1e-9 || len(sub(c, d)) < 1e-9) return b;
    return null;
  }
  const h = dotp(p, sub(a, c)) / den;
  return add(c, mul(cd, h));
}

function farthestFitInside(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, depth = 0): boolean {
  if (len(p2) <= tol && len(p1) <= tol) return true;
  if (depth > 16) return false;
  const mid = mul(add(add(p0, mul(add(p1, p2), 3)), p3), 0.125);
  if (len(mid) > tol) return false;
  const d3 = mul(sub(sub(add(p3, p2), p1), p0), 0.125);
  return (
    farthestFitInside(p0, mul(add(p0, p1), 0.5), sub(mid, d3), mid, tol, depth + 1) &&
    farthestFitInside(mid, add(mid, d3), mul(add(p2, p3), 0.5), p3, tol, depth + 1)
  );
}

function splitCubicN(c: Cubic, n: number): Cubic[] {
  const [p0, p1, p2, p3] = c;
  const cc = mul(sub(p1, p0), 3);
  const bb = sub(mul(sub(p2, p1), 3), cc);
  const dd = p0;
  const aa = sub(sub(sub(p3, dd), cc), bb);
  const dt = 1 / n, dt2 = dt * dt, dt3 = dt2 * dt;
  const out: Cubic[] = [];
  for (let i = 0; i < n; i++) {
    const t1 = i * dt, t1_2 = t1 * t1;
    const a1 = mul(aa, dt3);
    const b1 = mul(add(mul(aa, 3 * t1), bb), dt2);
    const c1 = mul(add(add(mul(bb, 2 * t1), cc), mul(aa, 3 * t1_2)), dt);
    const d1 = add(add(add(mul(aa, t1 * t1_2), mul(bb, t1_2)), mul(cc, t1)), dd);
    const q1 = d1;
    const q2 = add(mul(c1, 1 / 3), d1);
    const q3 = add(mul(add(b1, c1), 1 / 3), q2);
    const q4 = add(add(add(a1, d1), c1), b1);
    out.push([q1, q2, q3, q4]);
  }
  return out;
}

function approxControl(t: number, c: Cubic): Pt {
  const _p1 = add(c[0], mul(sub(c[1], c[0]), 1.5));
  const _p2 = add(c[3], mul(sub(c[2], c[3]), 1.5));
  return add(_p1, mul(sub(_p2, _p1), t));
}

/** Returns [on, off..., on] quadratic spline approximating the cubic within tol, or null. */
function cubicApproxSpline(c: Cubic, n: number, tol: number): Pt[] | null {
  if (n === 1) {
    const q1 = calcIntersect(c[0], c[1], c[2], c[3]);
    if (!q1) return null;
    const c1 = add(c[0], mul(sub(q1, c[0]), 2 / 3));
    const c2 = add(c[3], mul(sub(q1, c[3]), 2 / 3));
    if (!farthestFitInside({ x: 0, y: 0 }, sub(c1, c[1]), sub(c2, c[2]), { x: 0, y: 0 }, tol)) return null;
    return [c[0], q1, c[3]];
  }
  const cubics = splitCubicN(c, n);
  let nextCubic = cubics[0];
  let nextQ1 = approxControl(0, nextCubic);
  let q2 = c[0];
  let d1 = { x: 0, y: 0 };
  const spline = [c[0], nextQ1];
  for (let i = 1; i <= n; i++) {
    const [, c1, c2, c3] = nextCubic;
    const q0 = q2;
    const q1 = nextQ1;
    if (i < n) {
      nextCubic = cubics[i];
      nextQ1 = approxControl(i / (n - 1), nextCubic);
      spline.push(nextQ1);
      q2 = mul(add(q1, nextQ1), 0.5);
    } else q2 = c3;
    const d0 = d1;
    d1 = sub(q2, c3);
    if (
      len(d1) > tol ||
      !farthestFitInside(d0, sub(add(q0, mul(sub(q1, q0), 2 / 3)), c1), sub(add(q2, mul(sub(q1, q2), 2 / 3)), c2), d1, tol)
    )
      return null;
  }
  spline.push(c[3]);
  return spline;
}

export function cubicToQuadratic(c: Cubic, tol: number): Pt[] {
  for (let n = 1; n <= 64; n++) {
    const s = cubicApproxSpline(c, n, tol);
    if (s) return s;
  }
  return [c[0], mul(add(c[1], c[2]), 0.5), c[3]];
}

function isLine(c: Cubic, tol: number): boolean {
  const d = sub(c[3], c[0]);
  const l = len(d);
  if (l < 1e-9) return true;
  const dist = (p: Pt) => Math.abs((p.x - c[0].x) * d.y - (p.y - c[0].y) * d.x) / l;
  const proj = (p: Pt) => dotp(sub(p, c[0]), d) / (l * l);
  return dist(c[1]) <= tol * 0.25 && dist(c[2]) <= tol * 0.25 && proj(c[1]) >= -0.01 && proj(c[2]) <= 1.01;
}

/**
 * Converts a dense ring (with corner flags) into a TrueType quadratic contour,
 * keeping every flagged corner as an on-curve point and fitting smooth runs
 * within `tol` (font units). Orientation is preserved.
 */
export function ringToTrueType(r: Ring, tol: number, reach: number): TTPoint[] {
  const n = r.pts.length;
  if (n < 3) return [];
  const cornerIdx: number[] = [];
  r.corner.forEach((c, i) => c && cornerIdx.push(i));
  const cubics: Cubic[] = [];
  if (!cornerIdx.length) {
    // closed smooth ring: start at the point of max curvature-free position, enforce G1 closure
    const p = [...r.pts, r.pts[0]];
    const t = norm(sub(r.pts[1], r.pts[n - 1]));
    cubics.push(...fitOpen(p, tol, reach, t, mul(t, -1)));
  } else {
    for (let k = 0; k < cornerIdx.length; k++) {
      const a = cornerIdx[k];
      const b = cornerIdx[(k + 1) % cornerIdx.length];
      const run: Pt[] = [];
      let i = a;
      run.push(r.pts[i]);
      do {
        i = (i + 1) % n;
        run.push(r.pts[i]);
      } while (i !== b);
      const cs = fitOpen(run, tol, reach);
      cubics.push(...cs);
    }
  }
  const out: TTPoint[] = [];
  for (const c of cubics) {
    out.push({ ...c[0], on: true });
    if (isLine(c, tol)) continue;
    const q = cubicToQuadratic(c, tol * 0.5);
    for (let j = 1; j < q.length - 1; j++) out.push({ ...q[j], on: false });
  }
  return out;
}
