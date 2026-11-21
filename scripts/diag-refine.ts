// Diagnostic only: how much of the stage-3 residual can different (transferable) models explain?
import { readFileSync } from "node:fs";
import { openFont } from "../src/lib/font/load";
import { analyze } from "../src/lib/analysis/pipeline";
import { DEFAULT_OPTIONS } from "../src/lib/analysis/model";
import { fourierRow, huberFit, dot } from "../src/lib/math/linalg";
import { EdgeIndex } from "../src/lib/geometry/index";

const [srcP, refP] = process.argv.slice(2);
const src = openFont(new Uint8Array(readFileSync(srcP)));
const ref = openFont(new Uint8Array(readFileSync(refP)));
const opts = { ...DEFAULT_OPTIONS, step: 1, slices: 64, grid: 16, harmonics: 12, refineMaxIter: 30, refineMinGain: 0.001 };
const t0 = Date.now();
const { model, glyphs } = analyze({ src, ref, refMeta: { id: "t", name: "t", file: "", coords: {} }, category: "sans-serif", options: opts, progress: () => {} });
console.log("analysis", ((Date.now() - t0) / 1000).toFixed(0), "s");
console.table(model.refinement.map((r) => ({ iter: r.iter, meanAbs: +r.meanAbs.toFixed(3), objective: +(r.objective ?? 0).toFixed(3), note: r.note })));

type S = { g: string; phi: number; d: number; v: number; u: number; k: number; w: number; corner: boolean };
const S: S[] = [];
let total = 0, unmatched = 0;
for (const g of glyphs) {
  if (g.outlier) continue;
  const poly = g.stages[3];
  const shape = poly.map((a) => ({ pts: Array.from({ length: a.length / 2 }, (_, i) => ({ x: a[2 * i], y: a[2 * i + 1] })), corner: [] as boolean[] }));
  const idx = new EdgeIndex(shape as any, 8);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const a of poly) for (let i = 0; i < a.length; i += 2) { minX = Math.min(minX, a[i]); maxX = Math.max(maxX, a[i]); minY = Math.min(minY, a[i + 1]); maxY = Math.max(maxY, a[i + 1]); }
  g.rings.forEach((rg, r) => {
    const a = poly[r], d = rg.dev[2], n = a.length / 2;
    for (let i = 0; i < n; i++) {
      total++;
      if (!isFinite(d[i])) { unmatched++; continue; }
      const p = (j: number) => ({ x: a[2 * ((j + n) % n)], y: a[2 * ((j + n) % n) + 1] });
      const A = p(i - 3), B = p(i), C = p(i + 3);
      const t1 = Math.atan2(B.y - A.y, B.x - A.x), t2 = Math.atan2(C.y - B.y, C.x - B.x);
      let dt = t2 - t1; while (dt > Math.PI) dt -= 2 * Math.PI; while (dt < -Math.PI) dt += 2 * Math.PI;
      const tx = C.x - A.x, ty = C.y - A.y, L = Math.hypot(tx, ty) || 1;
      const nx = ty / L, ny = -tx / L;
      const w = idx.wallDistance(B, { x: -nx, y: -ny }, 600, 1) ?? 300;
      S.push({ g: g.char, phi: rg.phi[i], d: d[i], v: (B.y - minY) / (maxY - minY || 1), u: (B.x - minX) / (maxX - minX || 1),
        k: dt / (Math.hypot(C.x - A.x, C.y - A.y) || 1), w, corner: rg.corner[i] === 1 });
    }
  });
}
const meanAbs = (r: number[]) => r.reduce((s, x) => s + Math.abs(x), 0) / r.length;
const base = S.map((s) => s.d);
console.log(`samples ${S.length}, unmatched ${unmatched} (${(100 * unmatched / total).toFixed(1)}%), residual mean|d| ${meanAbs(base).toFixed(3)}`);
const near = S.filter((s) => Math.abs(s.k) > 0.05);
console.log(`share of |d| on tight-curvature/corner samples: ${(100 * near.reduce((a, s) => a + Math.abs(s.d), 0) / S.reduce((a, s) => a + Math.abs(s.d), 0)).toFixed(1)}%`);

function test(name: string, feat: (s: S) => number[]) {
  const step = Math.max(1, Math.floor(S.length / 60000));
  const sub = S.filter((_, i) => i % step === 0);
  const A = sub.map(feat), b = sub.map((s) => s.d);
  const x = huberFit(A, b, { delta: 0.02, iterations: 25 }).x;
  const res = S.map((s) => s.d - dot(feat(s), x));
  console.log(`${name.padEnd(46)} params ${String(x.length).padStart(3)}  mean|d| ${meanAbs(res).toFixed(3)}  (${(100 * (1 - meanAbs(res) / meanAbs(base))).toFixed(1)}% explained)`);
}
const F = (s: S, K = 12) => fourierRow(s.phi, K);
test("O(φ) again, 12 harmonics", (s) => F(s));
test("O(φ) 24 harmonics", (s) => F(s, 24));
test("O(φ) × height v (1, v, v²)", (s) => { const f = F(s, 8); return [...f, ...f.map((c) => c * s.v), ...f.map((c) => c * s.v * s.v)]; });
test("O(φ) × curvature κ (1, κ, |κ|)", (s) => { const f = F(s, 8); const k = Math.max(-0.2, Math.min(0.2, s.k)); return [...f, ...f.map((c) => c * k * 10), ...f.map((c) => c * Math.abs(k) * 10)]; });
test("O(φ) × stroke width w (1, w, w²)", (s) => { const f = F(s, 8); const w = Math.min(400, s.w) / 200; return [...f, ...f.map((c) => c * w), ...f.map((c) => c * w * w)]; });
test("O(φ) × (v, κ, w) combined", (s) => { const f = F(s, 6); const k = Math.max(-0.2, Math.min(0.2, s.k)) * 10, w = Math.min(400, s.w) / 200; return [...f, ...f.map((c) => c * s.v), ...f.map((c) => c * k), ...f.map((c) => c * Math.abs(k)), ...f.map((c) => c * w), ...f.map((c) => c * w * w)]; });
// non-transferable upper bound: one O(φ) per glyph
{
  const by = new Map<string, S[]>();
  for (const s of S) { if (!by.has(s.g)) by.set(s.g, []); by.get(s.g)!.push(s); }
  let acc = 0, n = 0;
  for (const arr of by.values()) {
    const x = huberFit(arr.map((s) => F(s, 8)), arr.map((s) => s.d), { delta: 0.02, iterations: 25 }).x;
    for (const s of arr) { acc += Math.abs(s.d - dot(F(s, 8), x)); n++; }
  }
  console.log(`${"one O(φ) per glyph (NOT transferable)".padEnd(46)}            mean|d| ${(acc / n).toFixed(3)}  (${(100 * (1 - acc / n / meanAbs(base))).toFixed(1)}% explained)`);
}
