import { Shape } from "./types";

/**
 * Exact signed distance to a polygonal outline, accelerated by a "nearest feature" grid.
 *
 * Every grid node (spacing h) stores the index of the outline segment closest to it, found by
 * seeding exact distances near the outline and propagating segment ids with a two-pass vector
 * distance transform (8-neighbourhood, forward + backward + forward). A query point looks at the
 * segments of its 4 surrounding nodes plus their ±2 neighbours along the ring and returns the
 * EXACT distance to the closest of them — grid resolution only decides which segments are
 * candidates, never the returned value.
 *
 * Sign convention: negative inside the ink (outlines are ink-left), positive outside.
 */
export class SignedDistance {
  private ax: Float64Array; private ay: Float64Array; private bx: Float64Array; private by: Float64Array;
  private nx: Float64Array; private ny: Float64Array;
  private prev: Int32Array; private next: Int32Array;
  private grid: Int32Array;
  readonly minX: number; readonly minY: number; readonly W: number; readonly H: number;

  constructor(shape: Shape, readonly h = 2, margin = 220) {
    let n = 0;
    for (const r of shape) n += r.pts.length;
    this.ax = new Float64Array(n); this.ay = new Float64Array(n); this.bx = new Float64Array(n); this.by = new Float64Array(n);
    this.nx = new Float64Array(n); this.ny = new Float64Array(n);
    this.prev = new Int32Array(n); this.next = new Int32Array(n);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let e = 0;
    for (const r of shape) {
      const m = r.pts.length, start = e;
      for (let i = 0; i < m; i++, e++) {
        const a = r.pts[i], b = r.pts[(i + 1) % m];
        this.ax[e] = a.x; this.ay[e] = a.y; this.bx[e] = b.x; this.by[e] = b.y;
        const l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        this.nx[e] = (b.y - a.y) / l; this.ny[e] = -(b.x - a.x) / l; // outward (ink-left)
        this.prev[e] = i === 0 ? start + m - 1 : e - 1;
        this.next[e] = i === m - 1 ? start : e + 1;
        minX = Math.min(minX, a.x); maxX = Math.max(maxX, a.x); minY = Math.min(minY, a.y); maxY = Math.max(maxY, a.y);
      }
    }
    if (!n) { minX = minY = 0; maxX = maxY = 1; }
    this.minX = minX - margin; this.minY = minY - margin;
    this.W = Math.ceil((maxX - minX + 2 * margin) / h) + 1;
    this.H = Math.ceil((maxY - minY + 2 * margin) / h) + 1;
    const W = this.W, H = this.H;
    const grid = (this.grid = new Int32Array(W * H).fill(-1));
    if (!n) return;
    const best = new Float64Array(W * H).fill(Infinity);
    // 1) exact seeds in a band of ±2 cells around every segment
    for (let s = 0; s < n; s++) {
      const x0 = Math.floor((Math.min(this.ax[s], this.bx[s]) - this.minX) / h) - 2;
      const x1 = Math.ceil((Math.max(this.ax[s], this.bx[s]) - this.minX) / h) + 2;
      const y0 = Math.floor((Math.min(this.ay[s], this.by[s]) - this.minY) / h) - 2;
      const y1 = Math.ceil((Math.max(this.ay[s], this.by[s]) - this.minY) / h) + 2;
      for (let gy = Math.max(0, y0); gy <= Math.min(H - 1, y1); gy++)
        for (let gx = Math.max(0, x0); gx <= Math.min(W - 1, x1); gx++) {
          const k = gy * W + gx;
          const d = this.segDist2(s, this.minX + gx * h, this.minY + gy * h);
          if (d < best[k]) { best[k] = d; grid[k] = s; }
        }
    }
    // 2) propagate nearest-segment ids (vector distance transform)
    const relax = (gx: number, gy: number, ox: number, oy: number) => {
      const qx = gx + ox, qy = gy + oy;
      if (qx < 0 || qy < 0 || qx >= W || qy >= H) return;
      const s = grid[qy * W + qx];
      if (s < 0) return;
      const k = gy * W + gx;
      if (grid[k] === s) return;
      const d = this.segDist2(s, this.minX + gx * h, this.minY + gy * h);
      if (d < best[k]) { best[k] = d; grid[k] = s; }
    };
    const forward = () => {
      for (let gy = 0; gy < H; gy++) {
        for (let gx = 0; gx < W; gx++) { relax(gx, gy, -1, 0); relax(gx, gy, -1, -1); relax(gx, gy, 0, -1); relax(gx, gy, 1, -1); }
        for (let gx = W - 1; gx >= 0; gx--) relax(gx, gy, 1, 0);
      }
    };
    const backward = () => {
      for (let gy = H - 1; gy >= 0; gy--) {
        for (let gx = W - 1; gx >= 0; gx--) { relax(gx, gy, 1, 0); relax(gx, gy, 1, 1); relax(gx, gy, 0, 1); relax(gx, gy, -1, 1); }
        for (let gx = 0; gx < W; gx++) relax(gx, gy, -1, 0);
      }
    };
    forward(); backward(); forward();
  }

  private segDist2(s: number, px: number, py: number): number {
    const ax = this.ax[s], ay = this.ay[s];
    const ex = this.bx[s] - ax, ey = this.by[s] - ay;
    const l2 = ex * ex + ey * ey;
    let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = px - (ax + ex * t), dy = py - (ay + ey * t);
    return dx * dx + dy * dy;
  }

  /**
   * Exact signed distance at (px, py) and the outward normal of the nearest boundary feature
   * (pseudo-normal at vertices). Returns null outside the grid.
   */
  query(px: number, py: number): { d: number; nx: number; ny: number } | null {
    const h = this.h, W = this.W;
    const fx = (px - this.minX) / h, fy = (py - this.minY) / h;
    const gx = Math.floor(fx), gy = Math.floor(fy);
    if (gx < 0 || gy < 0 || gx + 1 >= W || gy + 1 >= this.H) return null;
    let bestS = -1, bestD = Infinity;
    const tryS = (s: number) => {
      if (s < 0) return;
      const d = this.segDist2(s, px, py);
      if (d < bestD) { bestD = d; bestS = s; }
    };
    for (const k of [gy * W + gx, gy * W + gx + 1, (gy + 1) * W + gx, (gy + 1) * W + gx + 1]) {
      const s = this.grid[k];
      if (s < 0) continue;
      tryS(s);
      let a = s, b = s;
      for (let j = 0; j < 3; j++) { a = this.prev[a]; b = this.next[b]; tryS(a); tryS(b); }
    }
    if (bestS < 0) return null;
    const s = bestS;
    const ax = this.ax[s], ay = this.ay[s];
    const ex = this.bx[s] - ax, ey = this.by[s] - ay;
    const l2 = ex * ex + ey * ey;
    const t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
    let nx = this.nx[s], ny = this.ny[s];
    // pseudo-normal at the shared vertex makes the sign exact at corners
    if (t <= 0) { const p = this.prev[s]; nx += this.nx[p]; ny += this.ny[p]; }
    else if (t >= 1) { const q = this.next[s]; nx += this.nx[q]; ny += this.ny[q]; }
    const tc = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + ex * tc, cy = ay + ey * tc;
    const sign = (px - cx) * nx + (py - cy) * ny >= 0 ? 1 : -1;
    const ln = Math.hypot(nx, ny) || 1;
    return { d: sign * Math.sqrt(bestD), nx: nx / ln, ny: ny / ln };
  }
}
