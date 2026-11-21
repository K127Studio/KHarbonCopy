/**
 * Dense least squares via Householder QR (numerically stable, no normal equations).
 * Rows of A are observations, columns are unknowns.
 */
export function lstsq(A: number[][], b: number[], w?: number[]): number[] {
  const m = A.length;
  if (m === 0) return [];
  const n = A[0].length;
  if (m > 40 * n) return lstsqTall(A, b, w);
  // weighted copy (sqrt(w) scaling)
  const R = A.map((row, i) => {
    const s = w ? Math.sqrt(Math.max(0, w[i])) : 1;
    return row.map((v) => v * s);
  });
  const y = b.map((v, i) => v * (w ? Math.sqrt(Math.max(0, w[i])) : 1));
  const k = Math.min(m, n);
  for (let j = 0; j < k; j++) {
    let norm = 0;
    for (let i = j; i < m; i++) norm += R[i][j] * R[i][j];
    norm = Math.sqrt(norm);
    if (norm < 1e-300) continue;
    const alpha = R[j][j] > 0 ? -norm : norm;
    const v = new Float64Array(m - j);
    for (let i = j; i < m; i++) v[i - j] = R[i][j];
    v[0] -= alpha;
    let vn = 0;
    for (let i = 0; i < v.length; i++) vn += v[i] * v[i];
    if (vn < 1e-300) continue;
    for (let c = j; c < n; c++) {
      let dot = 0;
      for (let i = j; i < m; i++) dot += v[i - j] * R[i][c];
      const f = (2 * dot) / vn;
      for (let i = j; i < m; i++) R[i][c] -= f * v[i - j];
    }
    let dot = 0;
    for (let i = j; i < m; i++) dot += v[i - j] * y[i];
    const f = (2 * dot) / vn;
    for (let i = j; i < m; i++) y[i] -= f * v[i - j];
  }
  // back substitution with tiny-pivot guard (ridge-like fallback)
  const x = new Array<number>(n).fill(0);
  let maxDiag = 0;
  for (let j = 0; j < k; j++) maxDiag = Math.max(maxDiag, Math.abs(R[j][j]));
  for (let j = k - 1; j >= 0; j--) {
    let s = y[j];
    for (let c = j + 1; c < n; c++) s -= R[j][c] * x[c];
    x[j] = Math.abs(R[j][j]) > maxDiag * 1e-12 ? s / R[j][j] : 0;
  }
  return x;
}

/** Iteratively reweighted least squares with Huber loss. Returns coefficients and final weights. */
export function huberFit(
  A: number[][],
  b: number[],
  opts: { iterations?: number; delta?: number; baseWeights?: number[]; /** rows from this index on (priors) are never down-weighted */ fixedFrom?: number } = {},
): { x: number[]; weights: number[]; residualScale: number } {
  const m = A.length;
  if (!m) return { x: [], weights: [], residualScale: 0 };
  const n = A[0].length;
  const iterations = opts.iterations ?? 10;
  const base = opts.baseWeights ?? new Array<number>(m).fill(1);
  const fixedFrom = Math.min(m, opts.fixedFrom ?? m);
  // flat copy once: every IRLS step only changes the weights
  const F = new Float64Array(m * n);
  for (let i = 0; i < m; i++) { const r = A[i]; for (let j = 0; j < n; j++) F[i * n + j] = r[j]; }
  const B = Float64Array.from(b);
  const solve = (w: ArrayLike<number>) => (m > 4 * n ? normalSolve(F, B, m, n, w) : lstsq(A, b, Array.from(w)));
  let w = Float64Array.from(base);
  let x = solve(w);
  let scale = 1;
  const r = new Float64Array(m);
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < m; i++) {
      let s = 0;
      const off = i * n;
      for (let j = 0; j < n; j++) s += F[off + j] * x[j];
      r[i] = B[i] - s;
    }
    // robust scale: 1.4826 * MAD of the data rows
    const abs = Array.from(r.subarray(0, fixedFrom), Math.abs).sort((p, q) => p - q);
    scale = 1.4826 * (abs[abs.length >> 1] ?? 1) || 1e-9;
    const delta = (opts.delta ?? 1.345) * scale;
    for (let i = 0; i < m; i++) {
      if (i >= fixedFrom) { w[i] = base[i]; continue; }
      const a = Math.abs(r[i]);
      w[i] = base[i] * (a <= delta ? 1 : delta / a);
    }
    const nx = solve(w);
    let change = 0, mag = 1e-9;
    for (let i = 0; i < nx.length; i++) { change = Math.max(change, Math.abs(nx[i] - x[i])); mag = Math.max(mag, Math.abs(nx[i])); }
    x = nx;
    if (change < 1e-5 * mag) break; // relative convergence
  }
  return { x, weights: Array.from(w), residualScale: scale };
}

/** Weighted normal equations on a flat row-major matrix, Cholesky + one refinement step. */
function normalSolve(F: Float64Array, B: Float64Array, m: number, n: number, w: ArrayLike<number>): number[] {
  const M = new Float64Array(n * n);
  const v = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    const wi = w[i];
    if (!wi) continue;
    const off = i * n;
    const bi = B[i] * wi;
    for (let j = 0; j < n; j++) {
      const a = F[off + j];
      if (a === 0) continue;
      v[j] += a * bi;
      const aw = a * wi, mo = j * n;
      for (let k = j; k < n; k++) M[mo + k] += aw * F[off + k];
    }
  }
  for (let j = 0; j < n; j++) for (let k = 0; k < j; k++) M[j * n + k] = M[k * n + j];
  const L = cholesky(M, n);
  const x = cholSolve(L, v, n);
  // one step of iterative refinement on the true weighted residual
  const v2 = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    const wi = w[i];
    if (!wi) continue;
    const off = i * n;
    let s = 0;
    for (let j = 0; j < n; j++) s += F[off + j] * x[j];
    const ri = (B[i] - s) * wi;
    for (let j = 0; j < n; j++) v2[j] += F[off + j] * ri;
  }
  const dx = cholSolve(L, v2, n);
  return Array.from(x, (xi, j) => xi + dx[j]);
}

function cholesky(M: Float64Array, n: number): Float64Array {
  const L = new Float64Array(n * n);
  let tr = 0;
  for (let j = 0; j < n; j++) tr += M[j * n + j];
  const ridge = (tr / n) * 1e-13;
  for (let j = 0; j < n; j++) {
    let d = M[j * n + j] + ridge;
    for (let k = 0; k < j; k++) d -= L[j * n + k] ** 2;
    const ljj = Math.sqrt(Math.max(d, 1e-300));
    L[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = M[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      L[i * n + j] = s / ljj;
    }
  }
  return L;
}

function cholSolve(L: Float64Array, v: Float64Array, n: number): Float64Array {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = v[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/** Fourier design row: [1, cos φ, sin φ, cos 2φ, sin 2φ, ...] */
export function fourierRow(phi: number, K: number): number[] {
  const row = [1];
  for (let k = 1; k <= K; k++) row.push(Math.cos(k * phi), Math.sin(k * phi));
  return row;
}

export function evalFourier(coef: number[], phi: number): number {
  let s = coef[0] ?? 0;
  const K = (coef.length - 1) / 2;
  for (let k = 1; k <= K; k++) s += coef[2 * k - 1] * Math.cos(k * phi) + coef[2 * k] * Math.sin(k * phi);
  return s;
}

/**
 * Tall-skinny weighted least squares: normal equations solved by Cholesky, followed by
 * two steps of iterative refinement on the true residual (recovers QR-level accuracy
 * for well-conditioned bases such as Fourier rows).
 */
function lstsqTall(A: number[][], b: number[], w?: number[]): number[] {
  const m = A.length, n = A[0].length;
  const M = new Float64Array(n * n);
  const rhs = (r: ArrayLike<number>) => {
    const v = new Float64Array(n);
    for (let i = 0; i < m; i++) {
      const wi = w ? w[i] : 1;
      if (wi === 0) continue;
      const row = A[i], ri = r[i] * wi;
      for (let j = 0; j < n; j++) v[j] += row[j] * ri;
    }
    return v;
  };
  const row = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    const wi = w ? w[i] : 1;
    if (wi === 0) continue;
    const Ai = A[i];
    let nz = 0;
    for (let j = 0; j < n; j++) { row[j] = Ai[j]; if (Ai[j] !== 0) nz++; }
    if (!nz) continue;
    for (let j = 0; j < n; j++) {
      const rj = row[j];
      if (rj === 0) continue;
      const a = rj * wi;
      const off = j * n;
      for (let k = j; k < n; k++) M[off + k] += a * row[k];
    }
  }
  for (let j = 0; j < n; j++) for (let k = 0; k < j; k++) M[j * n + k] = M[k * n + j];
  // Cholesky (with tiny ridge for safety)
  const Lm = new Float64Array(n * n);
  let tr = 0;
  for (let j = 0; j < n; j++) tr += M[j * n + j];
  const ridge = (tr / n) * 1e-14;
  for (let j = 0; j < n; j++) {
    let d = M[j * n + j] + ridge;
    for (let k = 0; k < j; k++) d -= Lm[j * n + k] ** 2;
    const ljj = Math.sqrt(Math.max(d, 1e-300));
    Lm[j * n + j] = ljj;
    for (let i = j + 1; i < n; i++) {
      let s = M[i * n + j];
      for (let k = 0; k < j; k++) s -= Lm[i * n + k] * Lm[j * n + k];
      Lm[i * n + j] = s / ljj;
    }
  }
  const solve = (v: Float64Array) => {
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let s = v[i];
      for (let k = 0; k < i; k++) s -= Lm[i * n + k] * y[k];
      y[i] = s / Lm[i * n + i];
    }
    const x = new Float64Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = y[i];
      for (let k = i + 1; k < n; k++) s -= Lm[k * n + i] * x[k];
      x[i] = s / Lm[i * n + i];
    }
    return x;
  };
  const x = solve(rhs(b));
  for (let it = 0; it < 1; it++) {
    const r = new Float64Array(m);
    for (let i = 0; i < m; i++) r[i] = b[i] - dot(A[i], x);
    const dx = solve(rhs(r));
    for (let j = 0; j < n; j++) x[j] += dx[j];
  }
  return Array.from(x);
}

/** Legendre polynomials P0..Pdeg at x = 2v − 1 (v clamped to [-0.6, 1.6] to avoid extrapolation blow-up). */
export function legendre(v: number, deg: number): number[] {
  const x = 2 * Math.max(-0.6, Math.min(1.6, v)) - 1;
  const out = [1];
  if (deg >= 1) out.push(x);
  for (let n = 2; n <= deg; n++) out.push(((2 * n - 1) * x * out[n - 1] - (n - 1) * out[n - 2]) / n);
  return out;
}

/**
 * Design row of the height-dependent wave function
 *   O(φ, v) = Σ_d P_d(v) · [a_d0 + Σ_k a_dk cos kφ + b_dk sin kφ]
 * coefficients are stored block by block (block d has 2K+1 entries).
 */
export function waveRow(phi: number, v: number, K: number, D: number): number[] {
  const f = fourierRow(phi, K);
  const p = legendre(v, D);
  const row: number[] = [];
  for (let d = 0; d <= D; d++) for (const c of f) row.push(c * p[d]);
  return row;
}

export function evalWave(coef: number[], phi: number, v: number, K: number, D: number): number {
  // allocation-free: Legendre recurrence and Fourier terms computed inline
  const n = 2 * K + 1;
  const x = 2 * Math.max(-0.6, Math.min(1.6, v)) - 1;
  let p0 = 1, p1 = x, s = 0;
  for (let d = 0; d <= D; d++) {
    const pd = d === 0 ? 1 : d === 1 ? x : ((2 * d - 1) * x * p1 - (d - 1) * p0) / d;
    if (d >= 2) { p0 = p1; p1 = pd; }
    const off = d * n;
    if (off >= coef.length) break;
    let f = coef[off];
    for (let k = 1; k <= K; k++) {
      const c = coef[off + 2 * k - 1], sn = coef[off + 2 * k];
      if (c === undefined) break;
      f += c * Math.cos(k * phi) + sn * Math.sin(k * phi);
    }
    s += pd * f;
  }
  return s;
}
