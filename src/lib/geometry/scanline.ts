import { Shape } from "./types";

export interface Run {
  a: number;
  b: number;
}

/**
 * Exact ink runs along a horizontal (axis "y": line y = c) or vertical (axis "x": line x = c)
 * scanline, using the nonzero winding rule on the polyline edges.
 */
export function scanRuns(shape: Shape, c: number, axis: "y" | "x"): Run[] {
  const xs: { v: number; dir: number }[] = [];
  for (const r of shape) {
    const n = r.pts.length;
    for (let i = 0; i < n; i++) {
      const p = r.pts[i], q = r.pts[(i + 1) % n];
      const pa = axis === "y" ? p.y : p.x, qa = axis === "y" ? q.y : q.x;
      const pb = axis === "y" ? p.x : p.y, qb = axis === "y" ? q.x : q.y;
      if ((pa <= c) !== (qa <= c)) {
        const v = pb + ((c - pa) * (qb - pb)) / (qa - pa);
        xs.push({ v, dir: qa > pa ? 1 : -1 });
      }
    }
  }
  xs.sort((a, b) => a.v - b.v);
  const runs: Run[] = [];
  let w = 0;
  let start = 0;
  for (const x of xs) {
    const prev = w;
    w += x.dir;
    if (prev === 0 && w !== 0) start = x.v;
    else if (prev !== 0 && w === 0 && x.v - start > 1e-9) runs.push({ a: start, b: x.v });
  }
  return runs;
}

/**
 * Monotone alignment of two run sequences (dynamic programming, Needleman–Wunsch style).
 * Cost of matching = |center difference| + 0.5·|width difference|; gaps cost `gap`.
 */
export function alignRuns(A: Run[], B: Run[], gap: number): [number, number][] {
  const n = A.length, m = B.length;
  const D = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const T = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
  for (let i = 1; i <= n; i++) { D[i][0] = i * gap; T[i][0] = 1; }
  for (let j = 1; j <= m; j++) { D[0][j] = j * gap; T[0][j] = 2; }
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const a = A[i - 1], b = B[j - 1];
      const overlap = Math.min(a.b, b.b) - Math.max(a.a, b.a);
      const cost =
        Math.abs((a.a + a.b) / 2 - (b.a + b.b) / 2) + 0.5 * Math.abs(a.b - a.a - (b.b - b.a)) + (overlap > 0 ? 0 : gap);
      const m0 = D[i - 1][j - 1] + cost, m1 = D[i - 1][j] + gap, m2 = D[i][j - 1] + gap;
      if (m0 <= m1 && m0 <= m2) { D[i][j] = m0; T[i][j] = 0; }
      else if (m1 <= m2) { D[i][j] = m1; T[i][j] = 1; }
      else { D[i][j] = m2; T[i][j] = 2; }
    }
  const pairs: [number, number][] = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    const t = T[i][j];
    if (i > 0 && j > 0 && t === 0) {
      const a = A[i - 1], b = B[j - 1];
      if (Math.min(a.b, b.b) - Math.max(a.a, b.a) > 0) pairs.push([i - 1, j - 1]);
      i--; j--;
    } else if (i > 0 && (t === 1 || j === 0)) i--;
    else j--;
  }
  return pairs.reverse();
}
