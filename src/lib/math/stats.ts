export function mean(a: ArrayLike<number>): number {
  if (!a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i];
  return s / a.length;
}

export function std(a: ArrayLike<number>): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2;
  return Math.sqrt(s / (a.length - 1));
}

export function rms(a: ArrayLike<number>): number {
  if (!a.length) return 0;
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * a[i];
  return Math.sqrt(s / a.length);
}

export function quantile(a: ArrayLike<number>, q: number): number {
  if (!a.length) return 0;
  const s = Array.from(a).sort((x, y) => x - y);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export const median = (a: ArrayLike<number>) => quantile(a, 0.5);

export function weightedMedian(values: number[], weights: number[]): number {
  if (!values.length) return 0;
  const idx = values.map((_, i) => i).sort((i, j) => values[i] - values[j]);
  const total = weights.reduce((s, w) => s + w, 0);
  let acc = 0;
  for (const i of idx) {
    acc += weights[i];
    if (acc >= total / 2) return values[i];
  }
  return values[idx[idx.length - 1]];
}

export function mad(a: ArrayLike<number>): number {
  const m = median(a);
  return median(Array.from(a, (v) => Math.abs(v - m)));
}

export function skewness(a: ArrayLike<number>): number {
  const m = mean(a);
  const s = std(a);
  if (s < 1e-12) return 0;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc += ((a[i] - m) / s) ** 3;
  return acc / a.length;
}

/** Excess kurtosis (0 for a gaussian). High values = spiky signal (notches, kinks). */
export function kurtosis(a: ArrayLike<number>): number {
  const m = mean(a);
  const s = std(a);
  if (s < 1e-12) return 0;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc += ((a[i] - m) / s) ** 4;
  return acc / a.length - 3;
}

/** Theil–Sen robust line fit y = a*x + b. */
export function theilSen(x: number[], y: number[]): { slope: number; intercept: number } {
  const slopes: number[] = [];
  for (let i = 0; i < x.length; i++)
    for (let j = i + 1; j < x.length; j++) {
      const dx = x[j] - x[i];
      if (Math.abs(dx) > 1e-9) slopes.push((y[j] - y[i]) / dx);
    }
  const slope = slopes.length ? median(slopes) : 1;
  const intercept = median(x.map((xi, i) => y[i] - slope * xi));
  return { slope, intercept };
}

/** Mode of a 1D sample via gaussian kernel density estimate evaluated on a fine grid. */
export function kdeMode(values: number[], bandwidth?: number, weights?: number[]): number {
  if (!values.length) return 0;
  if (values.length === 1) return values[0];
  const s = std(values) || 1;
  const h = bandwidth ?? Math.max(1e-3, 1.06 * s * Math.pow(values.length, -0.2));
  const lo = Math.min(...values) - 3 * h;
  const hi = Math.max(...values) + 3 * h;
  const steps = 2000;
  let best = lo;
  let bestD = -Infinity;
  for (let i = 0; i <= steps; i++) {
    const t = lo + ((hi - lo) * i) / steps;
    let d = 0;
    for (let j = 0; j < values.length; j++) {
      const z = (t - values[j]) / h;
      d += (weights ? weights[j] : 1) * Math.exp(-0.5 * z * z);
    }
    if (d > bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

export function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
