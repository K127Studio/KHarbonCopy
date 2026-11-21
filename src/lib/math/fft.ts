/** In-place iterative radix-2 FFT. Length must be a power of two. */
export function fftPow2(re: Float64Array, im: Float64Array, inverse = false): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k], ai = im[i + k];
        const br = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const bi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ar + br; im[i + k] = ai + bi;
        re[i + k + len / 2] = ar - br; im[i + k + len / 2] = ai - bi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export const nextPow2 = (n: number) => 1 << Math.ceil(Math.log2(Math.max(1, n)));

/**
 * Exact DFT of arbitrary length N (Bluestein / chirp-z). X_k = Σ x_n e^{-2πi kn/N}.
 */
export function dft(signal: ArrayLike<number>, imag?: ArrayLike<number>): { re: Float64Array; im: Float64Array } {
  const N = signal.length;
  const outRe = new Float64Array(N);
  const outIm = new Float64Array(N);
  if (N === 0) return { re: outRe, im: outIm };
  const si = (n: number) => (imag ? imag[n] : 0);
  if ((N & (N - 1)) === 0) {
    for (let i = 0; i < N; i++) { outRe[i] = signal[i]; outIm[i] = si(i); }
    fftPow2(outRe, outIm);
    return { re: outRe, im: outIm };
  }
  const M = nextPow2(2 * N - 1);
  const wr = new Float64Array(N);
  const wi = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    // chirp e^{-iπ n²/N}; reduce n² mod 2N for precision
    const a = (Math.PI * ((n * n) % (2 * N))) / N;
    wr[n] = Math.cos(a);
    wi[n] = -Math.sin(a);
  }
  const ar = new Float64Array(M), ai = new Float64Array(M);
  for (let n = 0; n < N; n++) {
    ar[n] = signal[n] * wr[n] - si(n) * wi[n];
    ai[n] = signal[n] * wi[n] + si(n) * wr[n];
  }
  const br = new Float64Array(M), bi = new Float64Array(M);
  br[0] = wr[0]; bi[0] = -wi[0];
  for (let n = 1; n < N; n++) {
    br[n] = br[M - n] = wr[n];
    bi[n] = bi[M - n] = -wi[n];
  }
  fftPow2(ar, ai);
  fftPow2(br, bi);
  for (let i = 0; i < M; i++) {
    const r = ar[i] * br[i] - ai[i] * bi[i];
    const im = ar[i] * bi[i] + ai[i] * br[i];
    ar[i] = r; ai[i] = im;
  }
  fftPow2(ar, ai, true);
  for (let k = 0; k < N; k++) {
    outRe[k] = ar[k] * wr[k] - ai[k] * wi[k];
    outIm[k] = ar[k] * wi[k] + ai[k] * wr[k];
  }
  return { re: outRe, im: outIm };
}

/**
 * Reconstruct a real periodic signal from its DFT using harmonics 0..H (H = Infinity: exact).
 * Returns values at the original N sample positions.
 */
export function reconstruct(re: Float64Array, im: Float64Array, H: number): Float64Array {
  const N = re.length;
  const out = new Float64Array(N);
  const maxH = Math.min(Math.floor(N / 2), H);
  for (let n = 0; n < N; n++) {
    let s = re[0] / N;
    for (let k = 1; k <= maxH; k++) {
      const a = (2 * Math.PI * k * n) / N;
      const scale = k === N / 2 ? 1 / N : 2 / N;
      s += scale * (re[k] * Math.cos(a) - im[k] * Math.sin(a));
    }
    out[n] = s;
  }
  return out;
}

/** Exact inverse DFT (real part) of a complex spectrum: x = conj(DFT(conj X)) / N. */
export function idftReal(re: ArrayLike<number>, im: ArrayLike<number>): Float64Array {
  const N = re.length;
  const negIm = Float64Array.from(im, (v) => -v);
  const r = dft(re, negIm);
  const out = new Float64Array(N);
  for (let i = 0; i < N; i++) out[i] = r.re[i] / N;
  return out;
}
