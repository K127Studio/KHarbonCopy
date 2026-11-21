import { Pt, Shape } from "./types";

export interface RayHit {
  /** signed distance along the ray direction */
  t: number;
  /** outward unit normal of the hit edge (away from ink) */
  nx: number;
  ny: number;
  x: number;
  y: number;
}

/**
 * Uniform-grid spatial index over the edges of a cleaned shape.
 * Supports exact ray/edge intersection and nearest-point queries.
 */
export class EdgeIndex {
  ax: Float64Array; ay: Float64Array; bx: Float64Array; by: Float64Array;
  cells = new Map<number, number[]>();
  stamp: Uint32Array;
  tick = 1;
  minX: number; minY: number;
  constructor(shape: Shape, public cell = 12) {
    let n = 0;
    for (const r of shape) n += r.pts.length;
    this.ax = new Float64Array(n); this.ay = new Float64Array(n);
    this.bx = new Float64Array(n); this.by = new Float64Array(n);
    this.stamp = new Uint32Array(n);
    let minX = Infinity, minY = Infinity;
    for (const r of shape) for (const p of r.pts) { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); }
    this.minX = (isFinite(minX) ? minX : 0) - 1000;
    this.minY = (isFinite(minY) ? minY : 0) - 1000;
    let e = 0;
    for (const r of shape) {
      const m = r.pts.length;
      for (let i = 0; i < m; i++) {
        const a = r.pts[i], b = r.pts[(i + 1) % m];
        this.ax[e] = a.x; this.ay[e] = a.y; this.bx[e] = b.x; this.by[e] = b.y;
        const x0 = this.cx(Math.min(a.x, b.x)), x1 = this.cx(Math.max(a.x, b.x));
        const y0 = this.cy(Math.min(a.y, b.y)), y1 = this.cy(Math.max(a.y, b.y));
        for (let gx = x0; gx <= x1; gx++)
          for (let gy = y0; gy <= y1; gy++) {
            const k = this.key(gx, gy);
            let list = this.cells.get(k);
            if (!list) this.cells.set(k, (list = []));
            list.push(e);
          }
        e++;
      }
    }
  }
  get size() { return this.ax.length; }
  private cx(x: number) { return Math.floor((x - this.minX) / this.cell); }
  private cy(y: number) { return Math.floor((y - this.minY) / this.cell); }
  private key(gx: number, gy: number) { return gx * 100003 + gy; }

  private nextTick() {
    this.tick++;
    if (this.tick > 0xfffffff0) { this.stamp.fill(0); this.tick = 1; }
    return this.tick;
  }

  /** All intersections of the line p + t·d (|t| <= tmax) with shape edges, sorted by |t|. */
  ray(p: Pt, d: Pt, tmax: number): RayHit[] {
    const hits: RayHit[] = [];
    const tick = this.nextTick();
    const stepLen = this.cell * 0.5;
    const steps = Math.ceil((2 * tmax) / stepLen) + 1;
    const seen = new Set<number>();
    for (let i = 0; i <= steps; i++) {
      const t = -tmax + (2 * tmax * i) / steps;
      const gx = this.cx(p.x + d.x * t), gy = this.cy(p.y + d.y * t);
      for (let ox = -1; ox <= 1; ox++)
        for (let oy = -1; oy <= 1; oy++) {
          const k = this.key(gx + ox, gy + oy);
          if (seen.has(k)) continue;
          seen.add(k);
          const list = this.cells.get(k);
          if (!list) continue;
          for (const e of list) {
            if (this.stamp[e] === tick) continue;
            this.stamp[e] = tick;
            const ex = this.bx[e] - this.ax[e], ey = this.by[e] - this.ay[e];
            const den = d.x * ey - d.y * ex;
            if (Math.abs(den) < 1e-14) continue;
            const wx = this.ax[e] - p.x, wy = this.ay[e] - p.y;
            const tt = (wx * ey - wy * ex) / den;
            const u = (wx * d.y - wy * d.x) / den;
            if (u < 0 || u > 1 || Math.abs(tt) > tmax) continue;
            const l = Math.hypot(ex, ey);
            hits.push({ t: tt, nx: ey / l, ny: -ex / l, x: p.x + d.x * tt, y: p.y + d.y * tt });
          }
        }
    }
    hits.sort((a, b) => Math.abs(a.t) - Math.abs(b.t));
    return hits;
  }

  /** Nearest point on the shape boundary within maxR. */
  nearest(p: Pt, maxR = 400): { d: number; x: number; y: number; e: number } | null {
    let best = null as { d: number; x: number; y: number; e: number } | null;
    const gx = this.cx(p.x), gy = this.cy(p.y);
    const maxRing = Math.ceil(maxR / this.cell) + 1;
    const tick = this.nextTick();
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let ox = -ring; ox <= ring; ox++)
        for (let oy = -ring; oy <= ring; oy++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== ring) continue;
          const list = this.cells.get(this.key(gx + ox, gy + oy));
          if (!list) continue;
          for (const e of list) {
            if (this.stamp[e] === tick) continue;
            this.stamp[e] = tick;
            const ax = this.ax[e], ay = this.ay[e];
            const ex = this.bx[e] - ax, ey = this.by[e] - ay;
            const l2 = ex * ex + ey * ey;
            let t = l2 > 0 ? ((p.x - ax) * ex + (p.y - ay) * ey) / l2 : 0;
            t = t < 0 ? 0 : t > 1 ? 1 : t;
            const x = ax + ex * t, y = ay + ey * t;
            const d = Math.hypot(p.x - x, p.y - y);
            if (!best || d < best.d) best = { d, x, y, e };
          }
        }
      // any point found within ring*cell is guaranteed nearest once ring*cell >= best.d
      if (best && best.d <= (ring - 0) * this.cell) break;
    }
    return best && best.d <= maxR ? best : null;
  }

  /**
   * Distance along +d (t > eps only) to the first edge whose outward normal n_e satisfies
   * sign·(n_e·d) > 0.2. sign = -1: the facing wall across WHITESPACE (ray leaving the ink);
   * sign = +1: the opposite side of the STROKE (ray travelling inside the ink).
   */
  wallDistance(p: Pt, d: Pt, range: number, sign: 1 | -1, eps = 0.5): number | null {
    const cell = this.cell;
    const tick = this.nextTick();
    const fx = (p.x - this.minX) / cell, fy = (p.y - this.minY) / cell;
    let gx = Math.floor(fx), gy = Math.floor(fy);
    const stepX = d.x > 0 ? 1 : -1, stepY = d.y > 0 ? 1 : -1;
    const tDX = Math.abs(d.x) > 1e-15 ? cell / Math.abs(d.x) : Infinity;
    const tDY = Math.abs(d.y) > 1e-15 ? cell / Math.abs(d.y) : Infinity;
    let tMX = Math.abs(d.x) > 1e-15 ? ((d.x > 0 ? gx + 1 - fx : fx - gx) * cell) / Math.abs(d.x) : Infinity;
    let tMY = Math.abs(d.y) > 1e-15 ? ((d.y > 0 ? gy + 1 - fy : fy - gy) * cell) / Math.abs(d.y) : Infinity;
    let tEnter = 0;
    let best = Infinity;
    for (let guard = 0; guard < 100000 && tEnter <= Math.min(best, range); guard++) {
      const list = this.cells.get(gx * 100003 + gy);
      if (list)
        for (const e of list) {
          if (this.stamp[e] === tick) continue;
          this.stamp[e] = tick;
          const ex = this.bx[e] - this.ax[e], ey = this.by[e] - this.ay[e];
          const den = d.x * ey - d.y * ex;
          if (Math.abs(den) < 1e-14) continue;
          const wx = this.ax[e] - p.x, wy = this.ay[e] - p.y;
          const t = (wx * ey - wy * ex) / den;
          const u = (wx * d.y - wy * d.x) / den;
          if (u < 0 || u > 1 || t <= eps || t > range) continue;
          const l = Math.hypot(ex, ey);
          if (sign * ((ey / l) * d.x + (-ex / l) * d.y) <= 0.2) continue;
          if (t < best) best = t;
        }
      if (tMX < tMY) { tEnter = tMX; tMX += tDX; gx += stepX; }
      else { tEnter = tMY; tMY += tDY; gy += stepY; }
    }
    return isFinite(best) ? best : null;
  }

  /**
   * Closest crossing (by |t|) of the line p + t·d, |t| <= range, whose edge outward normal
   * agrees with d (dot > minDot). Exact Amanatides–Woo grid traversal in both directions.
   */
  closestCompatible(p: Pt, d: Pt, range: number, minDot: number): number | null {
    const cell = this.cell;
  const tick = this.nextTick();
  let best = Infinity;
  let bestT: number | null = null;
  // two walkers: +d and -d
  const walkers = [1, -1].map((sgn) => {
    const dx = d.x * sgn, dy = d.y * sgn;
    const fx = (p.x - this.minX) / cell, fy = (p.y - this.minY) / cell;
    let gx = Math.floor(fx), gy = Math.floor(fy);
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dx) > 1e-15 ? cell / Math.abs(dx) : Infinity;
    const tDeltaY = Math.abs(dy) > 1e-15 ? cell / Math.abs(dy) : Infinity;
    let tMaxX = Math.abs(dx) > 1e-15 ? ((dx > 0 ? gx + 1 - fx : fx - gx) * cell) / Math.abs(dx) : Infinity;
    let tMaxY = Math.abs(dy) > 1e-15 ? ((dy > 0 ? gy + 1 - fy : fy - gy) * cell) / Math.abs(dy) : Infinity;
    let tEnter = 0;
    return {
      get tEnter() { return tEnter; },
      cellKey() { return gx * 100003 + gy; },
      advance() {
        if (tMaxX < tMaxY) { tEnter = tMaxX; tMaxX += tDeltaX; gx += stepX; }
        else { tEnter = tMaxY; tMaxY += tDeltaY; gy += stepY; }
      },
    };
  });
  const test = (key: number) => {
    const list = this.cells.get(key);
    if (!list) return;
    for (const e of list) {
      if (this.stamp[e] === tick) continue;
      this.stamp[e] = tick;
      const ex = this.bx[e] - this.ax[e], ey = this.by[e] - this.ay[e];
      const den = d.x * ey - d.y * ex;
      if (Math.abs(den) < 1e-14) continue;
      const wx = this.ax[e] - p.x, wy = this.ay[e] - p.y;
      const tt = (wx * ey - wy * ex) / den;
      const u = (wx * d.y - wy * d.x) / den;
      if (u < -1e-12 || u > 1 + 1e-12 || Math.abs(tt) > range) continue;
      const l = Math.hypot(ex, ey);
      if ((ey / l) * d.x + (-ex / l) * d.y <= minDot) continue;
      if (Math.abs(tt) < best) { best = Math.abs(tt); bestT = tt; }
    }
  };
  test(walkers[0].cellKey());
  // both walkers start in the same cell; afterwards advance the one that is closer
  for (let guard = 0; guard < 100000; guard++) {
    const w = walkers[0].tEnter <= walkers[1].tEnter ? walkers[0] : walkers[1];
    const other = w === walkers[0] ? walkers[1] : walkers[0];
    if (Math.min(w.tEnter, other.tEnter) > Math.min(best, range)) break;
    w.advance();
    if (w.tEnter > range) {
      if (other.tEnter > range) break;
      // exhaust the other walker
      while (other.tEnter <= Math.min(best, range)) { other.advance(); if (other.tEnter <= range) test(other.cellKey()); }
      break;
    }
    test(w.cellKey());
  }
  return bestT;
}

  /** Nonzero winding number of point p (ray to +x). */
  winding(p: Pt): number {
    let w = 0;
    for (let e = 0; e < this.size; e++) {
      const ay = this.ay[e], by = this.by[e];
      if ((ay <= p.y) !== (by <= p.y)) {
        const x = this.ax[e] + ((p.y - ay) * (this.bx[e] - this.ax[e])) / (by - ay);
        if (x > p.x) w += by > ay ? 1 : -1;
      }
    }
    return w;
  }
}

/**
 * Signed normal deviation: distance along the outward normal n from p to the target outline,
 * choosing the closest crossing whose edge orientation is compatible (n·n_edge > minDot).
 * Positive = target lies outside (more ink), negative = inside.
 */
export function normalDeviation(index: EdgeIndex, p: Pt, n: Pt, range: number, minDot = 0.2): number | null {
  return index.closestCompatible(p, n, range, minDot);
}

