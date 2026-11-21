/**
 * 2D fields on a regular G×G grid over the unit square (u = x in box, v = y in box),
 * built from slice samples: values are first interpolated ALONG each slice, then
 * ACROSS slices (both with monotone PCHIP), and evaluated with Catmull–Rom bicubic.
 */

export interface Grid {
  G: number;
  /** row-major [v][u] */
  data: number[];
}

/** Monotone piecewise cubic Hermite interpolation (Fritsch–Carlson). Constant extrapolation. */
export function pchip(xs: number[], ys: number[], x: number): number {
  const n = xs.length;
  if (n === 0) return 0;
  if (n === 1) return ys[0];
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]) i++;
  const h = (k: number) => xs[k + 1] - xs[k];
  const delta = (k: number) => (ys[k + 1] - ys[k]) / (h(k) || 1e-12);
  const slope = (k: number) => {
    if (k === 0) return delta(0);
    if (k === n - 1) return delta(n - 2);
    const d0 = delta(k - 1), d1 = delta(k);
    if (d0 * d1 <= 0) return 0;
    const w1 = 2 * h(k) + h(k - 1), w2 = h(k) + 2 * h(k - 1);
    return (w1 + w2) / (w1 / d0 + w2 / d1);
  };
  const hi = h(i);
  const t = (x - xs[i]) / hi;
  const t2 = t * t, t3 = t2 * t;
  return (
    (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * hi * slope(i) + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * hi * slope(i + 1)
  );
}

export interface SliceSample {
  /** position along the slice (0..1) */
  along: number;
  value: number;
}

export interface SliceLine {
  /** position of the slice across (0..1) */
  across: number;
  samples: SliceSample[];
}

/**
 * Build a grid from slices. `orientation` "h": slices are horizontal (across = v, along = u),
 * "v": slices are vertical (across = u, along = v).
 */
export function gridFromSlices(slices: SliceLine[], G: number, orientation: "h" | "v"): { grid: Grid; support: number[] } {
  const nodes = Array.from({ length: G }, (_, i) => i / (G - 1));
  // 1) along each slice
  const lines: { across: number; vals: number[] }[] = [];
  for (const sl of slices) {
    if (!sl.samples.length) continue;
    const s = [...sl.samples].sort((a, b) => a.along - b.along);
    // merge coincident positions
    const xs: number[] = [], ys: number[] = [];
    for (const p of s) {
      if (xs.length && Math.abs(p.along - xs[xs.length - 1]) < 1e-6) {
        ys[ys.length - 1] = (ys[ys.length - 1] + p.value) / 2;
      } else {
        xs.push(p.along);
        ys.push(p.value);
      }
    }
    lines.push({ across: sl.across, vals: nodes.map((t) => pchip(xs, ys, t)) });
  }
  const data = new Array<number>(G * G).fill(0);
  const support = new Array<number>(G * G).fill(0);
  if (!lines.length) return { grid: { G, data }, support };
  lines.sort((a, b) => a.across - b.across);
  // 2) across slices
  for (let a = 0; a < G; a++) {
    const xs = lines.map((l) => l.across);
    const ys = lines.map((l) => l.vals[a]);
    for (let c = 0; c < G; c++) {
      const v = pchip(xs, ys, nodes[c]);
      const idx = orientation === "h" ? c * G + a : a * G + c; // [v][u]
      data[idx] = v;
    }
  }
  // support: density of raw samples around each node
  const rad = 1.5 / (G - 1);
  for (const sl of slices)
    for (const p of sl.samples) {
      const u = orientation === "h" ? p.along : sl.across;
      const v = orientation === "h" ? sl.across : p.along;
      const i0 = Math.max(0, Math.floor((u - rad) * (G - 1))), i1 = Math.min(G - 1, Math.ceil((u + rad) * (G - 1)));
      const j0 = Math.max(0, Math.floor((v - rad) * (G - 1))), j1 = Math.min(G - 1, Math.ceil((v + rad) * (G - 1)));
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const d = Math.hypot(u - i / (G - 1), v - j / (G - 1));
          if (d < rad) support[j * G + i] += 1 - d / rad;
        }
    }
  return { grid: { G, data }, support };
}

function cr(p0: number, p1: number, p2: number, p3: number, t: number) {
  return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
}

/** Catmull–Rom bicubic evaluation; (u,v) clamped to the unit square. */
export function evalGrid(g: Grid, u: number, v: number): number {
  const G = g.G;
  const x = Math.min(1, Math.max(0, u)) * (G - 1);
  const y = Math.min(1, Math.max(0, v)) * (G - 1);
  const i = Math.min(G - 2, Math.floor(x)), j = Math.min(G - 2, Math.floor(y));
  const tx = x - i, ty = y - j;
  const at = (a: number, b: number) => g.data[Math.min(G - 1, Math.max(0, b)) * G + Math.min(G - 1, Math.max(0, a))];
  const rows = [-1, 0, 1, 2].map((dj) => cr(at(i - 1, j + dj), at(i, j + dj), at(i + 1, j + dj), at(i + 2, j + dj), tx));
  return cr(rows[0], rows[1], rows[2], rows[3], ty);
}

/** Node-wise weighted median of many grids. */
export function aggregateGrids(grids: { grid: Grid; support: number[] }[], G: number): { grid: Grid; spread: number[] } {
  const data = new Array<number>(G * G).fill(0);
  const spread = new Array<number>(G * G).fill(0);
  for (let k = 0; k < G * G; k++) {
    const vals: number[] = [], ws: number[] = [];
    for (const g of grids) {
      const w = g.support[k];
      if (w > 0.05) { vals.push(g.grid.data[k]); ws.push(w); }
    }
    if (!vals.length) continue;
    const idx = vals.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    const tot = ws.reduce((s, w) => s + w, 0);
    let acc = 0, med = vals[idx[0]];
    for (const i of idx) { acc += ws[i]; if (acc >= tot / 2) { med = vals[i]; break; } }
    data[k] = med;
    // weighted MAD as spread
    const dev = vals.map((v) => Math.abs(v - med));
    const id2 = dev.map((_, i) => i).sort((a, b) => dev[a] - dev[b]);
    acc = 0;
    for (const i of id2) { acc += ws[i]; if (acc >= tot / 2) { spread[k] = dev[i]; break; } }
  }
  return { grid: { G, data }, spread };
}
