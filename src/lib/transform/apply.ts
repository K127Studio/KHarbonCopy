import { StyleModel } from "../analysis/model";
import { FontMetrics } from "../analysis/metrics";
import { applyFields } from "../analysis/pipeline";
import {
  applyNormalOffset, bboxOfLive, cornerLookup, Live, liveToShape, makeLive, refreshNormals,
} from "../analysis/ops";
import { cleanUnion } from "../geometry/clip";
import { EdgeIndex } from "../geometry/index";
import { findTerminals, profileAt, terminalWindow } from "../analysis/terminals";
import type { Grid } from "../analysis/field";

const EM_REF = 1000;
import { ringToTrueType, TTPoint } from "../geometry/fit";
import { sampleShape } from "../geometry/sample";
import { bboxOf, mapShape, Shape, signedArea } from "../geometry/types";
import { evalWave } from "../math/linalg";
import { idftReal } from "../math/fft";
import { rng } from "../math/rng";
import { TransferParams } from "./params";

export interface TransferPlan {
  k: number;
  sx: number;
  sy: number;
  kappa: number;
  kStem: number;
  targetV: number;
  targetH: number;
  o0: number;
  c2: number;
  coefH: number[];
  O: (phi: number, x?: number, y?: number) => number;
  notes: string[];
}

function targetH0(mK: FontMetrics, src: FontMetrics, targetV: number, p: TransferParams) {
  const nativeRatio = mK.hstem / (mK.vstem || 1);
  const srcRatio = src.hstem / (src.vstem || 1);
  return targetV * (nativeRatio + (srcRatio - nativeRatio) * p.contrast);
}

/** Derive the concrete transfer constants for a Khmer font with metrics mK. */
export function planTransfer(model: StyleModel, mK: FontMetrics, p: TransferParams): TransferPlan {
  const src = model.metrics.src;
  const notes: string[] = [];
  // slant is an ABSOLUTE property of the source: the Khmer font must end up leaning like the
  // source, whatever the reference leans (shear = source − reference only describes the analysis
  // map; with an upright source and a slanted reference it would backslant the Khmer).
  // A ±1.5° dead zone keeps measurement noise of upright fonts from tilting the output.
  const dead = Math.tan((1.5 * Math.PI) / 180);
  const sSl = Math.abs(src.slant) < dead ? 0 : src.slant;
  const kSl = Math.abs(mK.slant) < dead ? 0 : mK.slant;
  const k = (sSl - kSl) * p.slant;
  const sx = 1 + (model.global.sx - 1) * p.width;
  const sy = p.height;
  const kappa = p.detailScale > 0 ? p.detailScale : mK.body / (src.body || 1);
  const relV = src.vstem / (src.body || 1);
  const targetV = mK.vstem + (relV * mK.body - mK.vstem) * p.weight;
  const kStem = targetV / (src.vstem || 1);
  const nativeRatio = mK.hstem / (mK.vstem || 1);
  const srcRatio = src.hstem / (src.vstem || 1);
  const targetH = targetV * (nativeRatio + (srcRatio - nativeRatio) * p.contrast);
  // harmonic part of O(φ) (constant term removed), truncated, scaled to the Khmer stem size
  const K = Math.min(p.harmonics, model.normalFn.K);
  // spectral taper: high harmonics turn into ripples on curved outlines (the normal rotates
  // continuously), so order k is damped by 1 / (1 + (k / k0)^4)
  const taper = (i: number) => {
    if (!p.waveSmooth) return 1;
    const k = Math.ceil(i / 2);
    return 1 / (1 + Math.pow(k / p.waveSmooth, 4));
  };
  // per height block d: drop the global mean (handled by o0), keep height-varying weight (d > 0, j = 0)
  // scaled by the stem ratio, and harmonics scaled by stem ratio × contrast × spectral taper
  const Kfit = model.normalFn.K, D = model.normalFn.D ?? 0, nFit = 2 * Kfit + 1, nUse = 2 * K + 1;
  const coefH: number[] = [];
  for (let d = 0; d <= D; d++)
    for (let j = 0; j < nUse; j++) {
      const c = model.normalFn.coef[d * nFit + j] ?? 0;
      if (j === 0) coefH.push(d === 0 ? 0 : c * kStem);
      else coefH.push(c * kStem * p.contrast * taper(j));
    }
  // Khmer height, piecewise (point 3): baseline → 0, top of the consonant body → 1, and the Khmer
  // subscript / above-vowel zones are mapped onto the SOURCE descender / ascender zones, so a style
  // that changes in the descenders acts on the subscripts, one that changes on top acts on vowels
  const vr = model.normalFn.vRef ?? { baseline: 0, height: 500 };
  const vDesc = (src.descender - vr.baseline) / (vr.height || 1);
  const vAsc = (Math.max(src.ascender, src.capHeight) - vr.baseline) / (vr.height || 1);
  const kTop = mK.baseline + mK.body;
  const vK = (y: number) => {
    if (y < mK.baseline) return vDesc * ((y - mK.baseline) / ((mK.descender - mK.baseline) || -1));
    if (y <= kTop) return (y - mK.baseline) / (mK.body || 1);
    return 1 + (vAsc - 1) * ((y - kTop) / ((mK.ascender - kTop) || 1));
  };
  // physical guard: the anisotropic part may never remove more than 30 % of a stroke per side
  // (it is style, not structure); reliability of the comparison further scales it down
  const lim = 0.3 * 0.5 * Math.min(targetV, targetH0(mK, src, targetV, p));
  const rel = model.reliability ? Math.min(1, Math.max(0.15, (model.reliability.iou - 0.4) / 0.4)) : 1;
  const Oh = (phi: number, v = 0.5) => {
    const val = evalWave(coefH, phi, v, K, D) * rel;
    return Math.max(-lim, Math.min(lim, val));
  };
  if (rel < 1) notes.push(`comparison reliability ${(model.reliability.iou * 100).toFixed(0)}% → harmonics ×${rel.toFixed(2)}`);
  const A = Oh(0) + Oh(Math.PI);
  const B = Oh(Math.PI / 2) + Oh(-Math.PI / 2);
  let o0: number, c2: number;
  if (p.contrastMode === "absolute") {
    const dv = targetV - mK.vstem - A, dh = targetH - mK.hstem - B;
    o0 = (dv + dh) / 4;
    c2 = (dv - dh) / 4;
  } else {
    o0 = (targetV - mK.vstem - A) / 2;
    c2 = 0;
  }
  const c2lim = 0.25 * Math.min(targetV, targetH);
  c2 = Math.max(-c2lim, Math.min(c2lim, c2));
  o0 += p.weightBias;
  notes.push(
    `vertical stem ${mK.vstem.toFixed(1)} → ${targetV.toFixed(1)}`,
    `horizontal stem ${mK.hstem.toFixed(1)} → ${targetH.toFixed(1)}`,
    `uniform offset ${o0.toFixed(2)}, contrast correction cos2φ ${c2.toFixed(2)}`,
    `detail scale κ = ${kappa.toFixed(3)}, stem scale = ${kStem.toFixed(3)}`,
  );
  return {
    k, sx, sy, kappa, kStem, targetV, targetH, o0, c2, coefH,
    O: (phi, _x, y) => o0 + c2 * Math.cos(2 * phi) + Oh(phi, y == null ? 0.5 : vK(y)),
    notes,
  };
}

export interface GlyphOut {
  /** TrueType contours in font units */
  contours: TTPoint[][];
  /** dense final outline in 1000-em (for preview) */
  shape: Shape;
  adv: number; // 1000-em
  dx: number; // 1000-em horizontal shift applied after the transform
}

/**
 * Transforms one glyph outline (1000-em, already instance-resolved and decomposed).
 * Order mirrors the analysis: affine → O(φ) → corners → fields → texture → clean → fit.
 */
export function transformGlyph(
  shape: Shape,
  adv: number,
  model: StyleModel,
  plan: TransferPlan,
  p: TransferParams,
  emScale: number,
  seed: number,
): GlyphOut {
  const isMark = adv === 0;
  if (!shape.length) return { contours: [], shape: [], adv: isMark ? 0 : adv * plan.sx + 2 * p.tracking, dx: 0 };
  const b0 = bboxOf(shape);
  // 1 · affine
  const A = mapShape(shape, (q) => ({ x: plan.sx * q.x + plan.k * q.y, y: plan.sy * q.y }));
  const lives = sampleShape(A, p.step).map(makeLive);
  const cornerFlags = lives.map((l) => Uint8Array.from(l.rs.corner));
  const base = lives.map((l) => ({ x: l.x.slice(), y: l.y.slice() }));
  // whitespace & stroke budget of every sample, measured on the (affine) Khmer outline itself:
  // gap = distance to the facing wall across whitespace, stroke = distance to the other side of the ink
  const idxA = new EdgeIndex(A, 8);
  const reach = 0.6 * EM_REF;
  const budget: Budget[] = lives.map((l) => {
    const n = l.x.length;
    const gap = new Float64Array(n), stroke = new Float64Array(n);
    // fan of 3 rays (normal, ±25°): projected wall distance, robust at slot ends and on curves
    const fan = [0, 0.436, -0.436].map((a) => ({ c: Math.cos(a), s: Math.sin(a) }));
    for (let i = 0; i < n; i++) {
      const pnt = { x: l.x[i], y: l.y[i] };
      let g = Infinity, st = Infinity;
      for (const f of fan) {
        const dx = l.nx[i] * f.c - l.ny[i] * f.s, dy = l.nx[i] * f.s + l.ny[i] * f.c;
        const a = idxA.wallDistance(pnt, { x: dx, y: dy }, reach, -1);
        if (a != null) g = Math.min(g, a * f.c);
        const b = idxA.wallDistance(pnt, { x: -dx, y: -dy }, reach, 1);
        if (b != null) st = Math.min(st, b * f.c);
      }
      gap[i] = g;
      stroke[i] = st;
    }
    return { gap, stroke, nx: l.nx.slice(), ny: l.ny.slice() };
  });
  // 2 · normal function
  // counters (holes) keep at least (1 - counterKeep) of their half-width: growth into a hole is capped
  A.forEach((ring, i) => {
    const area = signedArea(ring.pts);
    if (area >= 0) { applyNormalOffset(lives[i], plan.O); return; }
    const halfWidth = (2 * Math.abs(area)) / (lives[i].rs.length || 1);
    const cap = p.counterKeep * halfWidth;
    applyNormalOffset(lives[i], (phi, x, y) => Math.min(plan.O(phi, x, y), cap));
  });
  // 3 · corners (exact fillet + residual profile)
  applyCorners(lives, cornerFlags, model, plan, p);
  // 3b · stroke terminals: the measured stroke-end profile, scaled by each Khmer cap width
  if (p.terminalDetail && model.terminals && model.terminals.count >= 3) {
    const lo = 0.3 * Math.min(plan.targetV, plan.targetH), hi = 1.8 * Math.max(plan.targetV, plan.targetH);
    for (const l of lives) {
      const ts = findTerminals(l.rs, lo, hi);
      if (!ts.length) continue;
      refreshNormals(l);
      const disp = new Float64Array(l.x.length);
      for (const t of ts)
        for (const { idx, u } of terminalWindow(t, l.rs.n)) disp[idx] += profileAt(model.terminals, u) * plan.targetV * p.terminalDetail;
      for (let i = 0; i < l.x.length; i++) { l.x[i] += l.nx[i] * disp[i]; l.y[i] += l.ny[i] * disp[i]; }
    }
  }
  // 4 · fields
  if (p.warp !== 0 || p.thickness !== 0) {
    const box = bboxOfLive(lives);
    applyFields(lives, box, smoothFields(model.fields), plan.targetV, plan.targetH, { warp: p.warp, thickness: p.thickness });
  }
  // smoother: the total structural displacement (O, corners, fields) is low-passed along the arc
  // with a gaussian, never across a true corner; geometry stays exact, only jitter is removed
  if (p.smoothing > 0) smoothDisplacement(lives, base, p.smoothing * plan.kStem);
  // preserve the Khmer negative space and stroke skeleton: the normal component of the total
  // displacement is clamped to the local whitespace / stroke budget (then re-smoothed lightly)
  const capSigma = Math.max(2, p.smoothing * plan.kStem);
  const caps = smoothCaps(lives, budget, p.counterKeep, p.strokeKeep, capSigma);
  clampToBudget(lives, base, budget, caps);
  if (p.smoothing > 0) {
    smoothDisplacement(lives, base, p.smoothing * plan.kStem);
    clampToBudget(lives, base, budget, caps);
  }
  // 5 · texture (intentional roughness, added after smoothing)
  if (p.texture !== 0 && model.texture.rms > 0) applyTexture(lives, model, plan, p, seed);
  // clean + fit
  const dense = liveToShape(lives).map((r, i) => ({ pts: r.pts, corner: Array.from(cornerFlags[i], (c) => c === 1) }));
  // despeckle: islands and pin-holes smaller than (despeckle · stem)² are removed
  const minFeature = Math.max(2, (p.despeckle * plan.targetV) ** 2);
  const clean = cleanUnion(dense, "positive", { minArea: minFeature });
  const tol = p.fitTolerance;
  const contours = clean
    .map((r) => ringToTrueType(r, tol, p.step * 4))
    .filter((c) => c.length >= 3)
    .map((c) => c.reverse().map((q) => ({ x: q.x / emScale, y: q.y / emScale, on: q.on })));
  // metrics
  const b1 = bboxOf(clean);
  let dx = 0;
  let newAdv = adv * plan.sx;
  if (!isMark && b0.minX >= 0) {
    const lsb = b0.minX * plan.sx + p.tracking;
    const rsb = (adv - b0.maxX) * plan.sx + p.tracking;
    dx = lsb - b1.minX;
    newAdv = Math.max(0, lsb + (b1.maxX - b1.minX) + rsb);
  } else if (!isMark) newAdv = adv * plan.sx + 2 * p.tracking;
  if (dx !== 0)
    for (const c of contours) for (const q of c) q.x += dx / emScale;
  const shifted = dx ? mapShape(clean, (q) => ({ x: q.x + dx, y: q.y })) : clean;
  return { contours, shape: shifted, adv: newAdv, dx };
}

function applyCorners(lives: Live[], flags: Uint8Array[], model: StyleModel, plan: TransferPlan, p: TransferParams) {
  const bins = model.corners.bins;
  const minTurn = (15 * Math.PI) / 180;
  lives.forEach((l, r) => {
    const rs = l.rs;
    const N = rs.n;
    const cIdx: number[] = [];
    for (let i = 0; i < N; i++) if (rs.corner[i] && Math.abs(rs.turn[i]) >= minTurn) cIdx.push(i);
    if (!cIdx.length) return;
    const step = rs.length / N;
    const nx = new Float64Array(N), ny = new Float64Array(N);
    const extra = new Float64Array(N);
    const setX = new Float64Array(N).fill(NaN), setY = new Float64Array(N).fill(NaN);
    for (let ci = 0; ci < cIdx.length; ci++) {
      const c = cIdx[ci];
      const turn = rs.turn[c];
      const convex = turn > 0;
      const lk = cornerLookup(bins, convex, Math.abs(turn));
      if (!lk) continue;
      // neighbouring corners limit the tangent length
      const prev = cIdx[(ci - 1 + cIdx.length) % cIdx.length], next = cIdx[(ci + 1) % cIdx.length];
      const gapPrev = cIdx.length > 1 ? ((c - prev + N) % N || N) * step : rs.length;
      const gapNext = cIdx.length > 1 ? ((next - c + N) % N || N) * step : rs.length;
      const alpha = Math.PI - Math.abs(turn);
      let rho = lk.radius * plan.kStem * p.cornerRadius;
      let T = rho / Math.tan(alpha / 2);
      const Tmax = 0.45 * Math.min(gapPrev, gapNext);
      if (T > Tmax) { T = Tmax; rho = T * Math.tan(alpha / 2); }
      const m = Math.round(T / step);
      if (rho > 0.25 && m >= 1) {
        const at = (j: number) => ({ x: l.x[(j + N) % N], y: l.y[(j + N) % N] });
        const P0 = at(c), Pa = at(c - m), Pb = at(c + m);
        const tin = norm(P0.x - Pa.x, P0.y - Pa.y), tout = norm(Pb.x - P0.x, Pb.y - P0.y);
        const realTurn = Math.atan2(tin.x * tout.y - tin.y * tout.x, tin.x * tout.x + tin.y * tout.y);
        const a2 = Math.PI - Math.abs(realTurn);
        const Tr = Math.min(T, Math.hypot(P0.x - Pa.x, P0.y - Pa.y), Math.hypot(Pb.x - P0.x, Pb.y - P0.y));
        const rr = Tr * Math.tan(a2 / 2);
        const T1 = { x: P0.x - tin.x * Tr, y: P0.y - tin.y * Tr };
        const side = realTurn > 0 ? 1 : -1;
        const C = { x: T1.x - side * tin.y * rr, y: T1.y + side * tin.x * rr };
        const a1 = Math.atan2(T1.y - C.y, T1.x - C.x);
        for (let j = -m; j <= m; j++) {
          const t = (j + m) / (2 * m);
          const ang = a1 + realTurn * t;
          const idx = (c + j + N) % N;
          setX[idx] = C.x + rr * Math.cos(ang);
          setY[idx] = C.y + rr * Math.sin(ang);
        }
        flags[r][c] = 0;
      }
      // residual detail profile (scaled to the Khmer stem size)
      if (p.cornerDetail !== 0) {
        const W = lk.window * plan.kStem;
        const mm = Math.floor(W / step);
        for (let j = -mm; j <= mm; j++) {
          const idx = (c + j + N) % N;
          extra[idx] += lk.residual((j * step) / plan.kStem) * plan.kStem * p.cornerDetail;
        }
      }
    }
    for (let i = 0; i < N; i++) if (isFinite(setX[i])) { l.x[i] = setX[i]; l.y[i] = setY[i]; }
    refreshNormals(l);
    nx.set(l.nx); ny.set(l.ny);
    for (let i = 0; i < N; i++) { l.x[i] += nx[i] * extra[i]; l.y[i] += ny[i] * extra[i]; }
  });
}

function norm(x: number, y: number) {
  const L = Math.hypot(x, y) || 1;
  return { x: x / L, y: y / L };
}

function applyTexture(lives: Live[], model: StyleModel, plan: TransferPlan, p: TransferParams, seed: number) {
  const T = model.texture;
  const R = rng(seed * 2654435761 + p.seed * 97);
  const scale = plan.kappa * p.textureScale; // Khmer length per Latin length
  const amp = plan.kappa * p.texture;
  for (const l of lives) {
    refreshNormals(l);
    const N = l.x.length;
    const L = l.rs.length;
    let sig: Float64Array;
    if (p.textureMode === "tape" && T.tape.length > 32) {
      sig = new Float64Array(N);
      const tapeLen = T.tape.length;
      const start = R.next() * tapeLen;
      const fade = Math.min(N / 4, Math.ceil(T.cutoff / T.step / 2));
      const read = (pos: number) => {
        const q = ((pos % tapeLen) + tapeLen) % tapeLen;
        const i0 = Math.floor(q), f = q - i0;
        return T.tape[i0] * (1 - f) + T.tape[(i0 + 1) % tapeLen] * f;
      };
      const perSample = L / N / scale / T.step; // tape samples per Khmer sample
      for (let i = 0; i < N; i++) {
        let v = read(start + i * perSample);
        // periodic closure: cross-fade the tail into the tape segment preceding the start
        if (i >= N - fade) {
          const w = (i - (N - fade)) / fade;
          v = v * (1 - w) + read(start - (N - i) * perSample) * w;
        }
        sig[i] = v * amp;
      }
    } else {
      // spectral synthesis from the measured PSD (log-log interpolation), random phases
      const re = new Float64Array(N), im = new Float64Array(N);
      const Llat = L / scale;
      for (let k = 1; k < N / 2; k++) {
        const lamLat = Llat / k;
        const D = psdAt(T.bands, lamLat);
        if (D <= 0) continue;
        const a = Math.sqrt((2 * D) / Llat) * amp;
        const ph = R.next() * 2 * Math.PI;
        re[k] = (N / 2) * a * Math.cos(ph);
        im[k] = (N / 2) * a * Math.sin(ph);
        re[N - k] = re[k];
        im[N - k] = -im[k];
      }
      sig = idftReal(re, im);
    }
    for (let i = 0; i < N; i++) {
      const phi = Math.atan2(l.ny[i], l.nx[i]);
      const b = ((Math.floor(((phi + Math.PI / 8) / (2 * Math.PI)) * 8) % 8) + 8) % 8;
      const mod = 1 + ((T.phiMod[b] ?? 1) - 1) * p.textureAniso;
      const d = sig[i] * mod;
      l.x[i] += l.nx[i] * d;
      l.y[i] += l.ny[i] * d;
    }
  }
}

function psdAt(bands: StyleModel["texture"]["bands"], lam: number): number {
  if (!bands.length) return 0;
  const lo = bands[0].lo, hi = bands[bands.length - 1].hi;
  if (lam < lo || lam > hi) return 0;
  const centers = bands.map((b) => Math.sqrt(b.lo * b.hi));
  let i = 0;
  while (i < centers.length - 1 && lam > centers[i + 1]) i++;
  const j = Math.min(centers.length - 1, i + 1);
  const a = Math.max(1e-12, bands[i].psd), b = Math.max(1e-12, bands[j].psd);
  if (i === j || lam <= centers[0]) return a;
  const t = Math.log(lam / centers[i]) / Math.log(centers[j] / centers[i]);
  return Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * Math.min(1, Math.max(0, t)));
}

/** Gaussian low-pass of the displacement (current − base) inside corner-free spans. */
function smoothDisplacement(lives: Live[], base: { x: Float64Array; y: Float64Array }[], sigmaUnits: number) {
  lives.forEach((l, r) => {
    const N = l.x.length;
    if (N < 8) return;
    const step = l.rs.length / N;
    const sig = sigmaUnits / step;
    if (sig < 0.5) return;
    const R = Math.ceil(3 * sig);
    const dx = new Float64Array(N), dy = new Float64Array(N);
    for (let i = 0; i < N; i++) { dx[i] = l.x[i] - base[r].x[i]; dy[i] = l.y[i] - base[r].y[i]; }
    const corner = l.rs.corner;
    const hasCorner = corner.some((c) => c === 1);
    const kern = Array.from({ length: 2 * R + 1 }, (_, j) => Math.exp(-((j - R) ** 2) / (2 * sig * sig)));
    const ox = new Float64Array(N), oy = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      if (corner[i]) { ox[i] = dx[i]; oy[i] = dy[i]; continue; }
      let sw = kern[R], sx = dx[i] * kern[R], sy = dy[i] * kern[R];
      for (const dir of [1, -1]) {
        for (let j = 1; j <= R; j++) {
          const q = (i + dir * j + N) % N;
          if (hasCorner && corner[q]) {
            const w = kern[R + j];
            sw += w; sx += w * dx[q]; sy += w * dy[q];
            break; // a corner sample is the last one used on this side
          }
          const w = kern[R + j];
          sw += w; sx += w * dx[q]; sy += w * dy[q];
        }
      }
      ox[i] = sx / sw;
      oy[i] = sy / sw;
    }
    for (let i = 0; i < N; i++) { l.x[i] = base[r].x[i] + ox[i]; l.y[i] = base[r].y[i] + oy[i]; }
  });
}

type Budget = { gap: Float64Array; stroke: Float64Array; nx: Float64Array; ny: Float64Array };

/**
 * Smooth displacement limits along each ring: running minimum (an erosion, so the limit never
 * exceeds the true local budget) followed by a gaussian — the clamped outline stays smooth.
 */
function smoothCaps(lives: Live[], budget: Budget[], gapKeep: number, strokeKeep: number, sigmaUnits: number) {
  return lives.map((l, r) => {
    const n = l.x.length;
    const step = l.rs.length / Math.max(1, n);
    const sig = Math.max(1, sigmaUnits / step);
    const R = Math.ceil(2 * sig);
    const b = budget[r];
    const BIG = 1e6;
    const rawOut = Float64Array.from(b.gap, (g) => (isFinite(g) ? (gapKeep * g) / 2 : BIG));
    const rawIn = Float64Array.from(b.stroke, (t) => (isFinite(t) ? ((1 - strokeKeep) * t) / 2 : BIG));
    const erode = (a: Float64Array) => {
      const o = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let m = a[i];
        for (let j = -R; j <= R; j++) m = Math.min(m, a[(i + j + n) % n]);
        o[i] = m;
      }
      return o;
    };
    const blur = (a: Float64Array) => {
      const o = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        let sw = 0, sv = 0;
        for (let j = -R; j <= R; j++) {
          const w = Math.exp(-(j * j) / (2 * sig * sig));
          sw += w;
          sv += w * Math.min(BIG, a[(i + j + n) % n]);
        }
        o[i] = Math.min(a[i] === BIG ? BIG : Infinity, sv / sw);
      }
      return o;
    };
    return { out: blur(erode(rawOut)), in: blur(erode(rawIn)) };
  });
}

/** Clamp the normal component of (current − base) to the smoothed whitespace / stroke limits. */
function clampToBudget(lives: Live[], base: { x: Float64Array; y: Float64Array }[], budget: Budget[], caps: { out: Float64Array; in: Float64Array }[]) {
  lives.forEach((l, r) => {
    const b = budget[r], c = caps[r];
    for (let i = 0; i < l.x.length; i++) {
      const dx = l.x[i] - base[r].x[i], dy = l.y[i] - base[r].y[i];
      const dn = dx * b.nx[i] + dy * b.ny[i];
      const v = Math.max(-c.in[i], Math.min(c.out[i], dn));
      if (v !== dn) {
        l.x[i] += (v - dn) * b.nx[i];
        l.y[i] += (v - dn) * b.ny[i];
      }
    }
  });
}

const fieldCache = new WeakMap<object, StyleModel["fields"]>();
/** 3×3 binomial smoothing of the aggregated fields and a tighter amplitude limit for transfer. */
function smoothFields(f: StyleModel["fields"]): StyleModel["fields"] {
  const hit = fieldCache.get(f);
  if (hit) return hit;
  const sm = (g: Grid, lim: number): Grid => {
    const G = g.G, out = new Array<number>(G * G).fill(0);
    const k = [1, 2, 1];
    for (let j = 0; j < G; j++)
      for (let i = 0; i < G; i++) {
        let s = 0, w = 0;
        for (let b = -1; b <= 1; b++)
          for (let a = -1; a <= 1; a++) {
            const x = i + a, y = j + b;
            if (x < 0 || y < 0 || x >= G || y >= G) continue;
            const ww = k[a + 1] * k[b + 1];
            s += ww * g.data[y * G + x];
            w += ww;
          }
        out[j * G + i] = Math.max(-lim, Math.min(lim, s / w));
      }
    return { G, data: out };
  };
  const res = { ...f, wx: sm(f.wx, 0.05), wy: sm(f.wy, 0.05), th: sm(f.th, 0.3), tv: sm(f.tv, 0.3) };
  fieldCache.set(f, res);
  return res;
}
