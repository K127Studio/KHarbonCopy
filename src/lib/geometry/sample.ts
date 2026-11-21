import { Pt, Ring, Shape } from "./types";

/** Uniform arc-length samples of a ring with exact samples on every corner. */
export interface RingSamples {
  x: Float64Array;
  y: Float64Array;
  /** outward unit normal (away from ink) */
  nx: Float64Array;
  ny: Float64Array;
  /** outward normal angle φ = atan2(ny, nx) */
  phi: Float64Array;
  /** arc position */
  s: Float64Array;
  /** 1 = corner sample */
  corner: Uint8Array;
  /** signed turning angle at corner samples (+ = left turn = convex ink corner) */
  turn: Float64Array;
  /** signed arc distance to nearest corner (Infinity when ring has no corner) */
  cornerDist: Float64Array;
  /** index of nearest corner sample (-1 if none) */
  cornerIdx: Int32Array;
  length: number;
  n: number;
}

export function ringLength(r: Ring): number {
  let L = 0;
  const n = r.pts.length;
  for (let i = 0; i < n; i++) {
    const a = r.pts[i], b = r.pts[(i + 1) % n];
    L += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return L;
}

class PolyEval {
  cum: Float64Array;
  L: number;
  constructor(public pts: Pt[]) {
    const n = pts.length;
    this.cum = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      this.cum[i + 1] = this.cum[i] + Math.hypot(b.x - a.x, b.y - a.y);
    }
    this.L = this.cum[n];
  }
  at(s: number): Pt {
    const L = this.L;
    s = ((s % L) + L) % L;
    let lo = 0, hi = this.pts.length;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    const a = this.pts[lo], b = this.pts[(lo + 1) % this.pts.length];
    const seg = this.cum[lo + 1] - this.cum[lo];
    const t = seg > 0 ? (s - this.cum[lo]) / seg : 0;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
}

function unit(x: number, y: number): Pt {
  const l = Math.hypot(x, y);
  return l > 1e-15 ? { x: x / l, y: y / l } : { x: 0, y: 0 };
}

export function sampleRing(r: Ring, step: number): RingSamples {
  const ev = new PolyEval(r.pts);
  const L = ev.L;
  const cornerS: number[] = [];
  r.corner.forEach((c, i) => c && cornerS.push(ev.cum[i]));
  const positions: number[] = [];
  const isCorner: boolean[] = [];
  if (!cornerS.length) {
    const n = Math.max(8, Math.round(L / step));
    for (let i = 0; i < n; i++) {
      positions.push((L * i) / n);
      isCorner.push(false);
    }
  } else {
    for (let c = 0; c < cornerS.length; c++) {
      const a = cornerS[c];
      const b = c + 1 < cornerS.length ? cornerS[c + 1] : cornerS[0] + L;
      const span = b - a;
      const n = Math.max(1, Math.round(span / step));
      for (let i = 0; i < n; i++) {
        positions.push(a + (span * i) / n);
        isCorner.push(i === 0);
      }
    }
  }
  const N = positions.length;
  const out: RingSamples = {
    x: new Float64Array(N), y: new Float64Array(N), nx: new Float64Array(N), ny: new Float64Array(N),
    phi: new Float64Array(N), s: new Float64Array(N), corner: new Uint8Array(N), turn: new Float64Array(N),
    cornerDist: new Float64Array(N).fill(Infinity), cornerIdx: new Int32Array(N).fill(-1), length: L, n: N,
  };
  const h = Math.min(step * 0.5, L / 32);
  for (let i = 0; i < N; i++) {
    const s = positions[i];
    const p = ev.at(s);
    out.x[i] = p.x;
    out.y[i] = p.y;
    out.s[i] = s - (positions[0] ?? 0);
    const pb = ev.at(s - h), pf = ev.at(s + h);
    let n: Pt;
    if (isCorner[i]) {
      const tin = unit(p.x - pb.x, p.y - pb.y);
      const tout = unit(pf.x - p.x, pf.y - p.y);
      const nin = { x: tin.y, y: -tin.x }, nout = { x: tout.y, y: -tout.x };
      n = unit(nin.x + nout.x, nin.y + nout.y);
      if (n.x === 0 && n.y === 0) n = nin;
      out.corner[i] = 1;
      out.turn[i] = Math.atan2(tin.x * tout.y - tin.y * tout.x, tin.x * tout.x + tin.y * tout.y);
    } else {
      const t = unit(pf.x - pb.x, pf.y - pb.y);
      n = { x: t.y, y: -t.x };
    }
    out.nx[i] = n.x;
    out.ny[i] = n.y;
    out.phi[i] = Math.atan2(n.y, n.x);
  }
  // signed arc distance to nearest corner
  const cIdx: number[] = [];
  for (let i = 0; i < N; i++) if (out.corner[i]) cIdx.push(i);
  if (cIdx.length) {
    for (let i = 0; i < N; i++) {
      let best = Infinity, bi = -1;
      for (const c of cIdx) {
        let d = out.s[i] - out.s[c];
        if (d > L / 2) d -= L;
        if (d < -L / 2) d += L;
        if (Math.abs(d) < Math.abs(best)) {
          best = d;
          bi = c;
        }
      }
      out.cornerDist[i] = best;
      out.cornerIdx[i] = bi;
    }
  }
  return out;
}

export function sampleShape(shape: Shape, step: number): RingSamples[] {
  return shape.map((r) => sampleRing(r, step));
}

/** Recompute outward normals of displaced samples (central differences, corner-aware). */
export function recomputeNormals(x: Float64Array, y: Float64Array, corner: Uint8Array) {
  const N = x.length;
  const nx = new Float64Array(N), ny = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i - 1 + N) % N, b = (i + 1) % N;
    let n: Pt;
    if (corner[i]) {
      const tin = unit(x[i] - x[a], y[i] - y[a]);
      const tout = unit(x[b] - x[i], y[b] - y[i]);
      n = unit(tin.y + tout.y, -tin.x - tout.x);
    } else {
      const t = unit(x[b] - x[a], y[b] - y[a]);
      n = { x: t.y, y: -t.x };
    }
    nx[i] = n.x;
    ny[i] = n.y;
  }
  return { nx, ny };
}
