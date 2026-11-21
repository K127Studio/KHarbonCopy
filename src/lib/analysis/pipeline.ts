import { FontHandle, glyphIdForChar, glyphShape } from "../font/load";
import { cleanUnion, iou } from "../geometry/clip";
import { EdgeIndex } from "../geometry/index";
import { SignedDistance } from "../geometry/sdf";
import { buildTerminalModel, findTerminals, TERM_BINS, TERM_U0, TERM_U1, TerminalModel, terminalWindow } from "./terminals";
import { sampleShape } from "../geometry/sample";
import { alignRuns, scanRuns } from "../geometry/scanline";
import { bboxOf, centroid, mapShape, Shape, packShape } from "../geometry/types";
import { dft, idftReal } from "../math/fft";
import { huberFit, waveRow } from "../math/linalg";
import { rng } from "../math/rng";
import { kurtosis, mad, mean, median, quantile, rms, skewness, std } from "../math/stats";
import { aggregateGrids, evalGrid, Grid, gridFromSlices, SliceLine } from "./field";
import { Category, FontMetrics, measureLatin } from "./metrics";
import {
  sanitizeOptions, AnalysisOptions, CornerBin, GlyphReport, RefinementStep, StageStat, StyleModel, STAGE_NAMES, TextureBand, TextureModel,
} from "./model";
import {
  applyNormalOffset, bboxOfLive, cornerLookup, filletDeviation, wave, Live, liveToShape, makeLive, packLive,
  refreshNormals, zoneMapper,
} from "./ops";

export interface AnalyzeInput {
  src: FontHandle;
  ref: FontHandle;
  refMeta: { id: string; name: string; file: string; coords: Record<string, number> };
  category: Category;
  options: AnalysisOptions;
  progress: (msg: string, frac: number) => void;
}

interface G {
  c: string;
  S: Shape;
  idx: EdgeIndex;
  /** exact signed distance to the source outline (fast path of every measurement) */
  sdf: SignedDistance;
  R0: Shape;
  R1: Shape;
  lives0: Live[];
  lives: Live[];
  dev: Float64Array[][]; // [stage][ring]
  stats: StageStat[];
  polys: Float32Array[][];
  outlier: boolean;
  reason?: string;
  fields?: { wx: Grid; wy: Grid; th: Grid; tv: Grid; sup: { wx: number[]; wy: number[]; th: number[]; tv: number[] } };
  box?: { minX: number; minY: number; maxX: number; maxY: number };
  slicesH: GlyphReport["slicesH"];
  slicesV: GlyphReport["slicesV"];
  texture?: Float64Array[];
  /** per-glyph refined wave function and corner corrections */
  coefG?: number[];
  cornerCorr?: Map<string, Float64Array>;
  refineSteps?: RefinementStep[];
  refined?: StageStat;
}

const CORNER_EDGES = [15, 50, 80, 100, 135, 180].map((d) => (d * Math.PI) / 180);

export function analyze(input: AnalyzeInput): { model: StyleModel; glyphs: GlyphReport[] } {
  const { src, ref, progress } = input;
  // every constant is validated before anything runs
  const { options: o, fixes: optionFixes } = sanitizeOptions(input.options);
  if (optionFixes.length) console.warn("[KHarbonCopy] options clamped:", optionFixes.join(", "));
  const tick = phaseTimer();
  const mS = measureLatin(src);
  const mR = measureLatin(ref);
  progress("metrics measured", 0.02);

  // ------------------------------------------------------------------ glyph pairs
  const pairs: { c: string; S: Shape; R: Shape }[] = [];
  for (const c of [...new Set([...o.charset])]) {
    const gs = glyphIdForChar(src, c), gr = glyphIdForChar(ref, c);
    if (!gs || !gr) continue;
    const S = glyphShape(src, gs), R = glyphShape(ref, gr);
    if (S.length && R.length) pairs.push({ c, S, R });
  }
  if (!pairs.length) throw new Error("No glyphs in common between source and reference.");

  // ------------------------------------------------------------------ stage 1: global affine
  // zones are mapped on horizontal-stroke CENTRES so that weight differences stay in O(φ)
  const hr = mR.hstem / 2, hs = mS.hstem / 2;
  // a zone is used only if it is a real zone in BOTH fonts (unicase / caps-only / no-descender
  // display fonts would otherwise produce a folded vertical map). Baseline is always kept.
  const zonesOk = {
    desc: mS.descender < mS.baseline - 60 && mR.descender < mR.baseline - 60,
    x: mS.xHeight < 0.92 * mS.capHeight && mR.xHeight < 0.92 * mR.capHeight,
    asc: mS.ascender > mS.capHeight + 10 && mR.ascender > mR.capHeight + 10,
  };
  const zf: number[] = [mR.baseline + hr, mR.capHeight - hr];
  const zt: number[] = [mS.baseline + hs, mS.capHeight - hs];
  if (zonesOk.desc) { zf.push(mR.descender + hr); zt.push(mS.descender + hs); }
  if (zonesOk.x) { zf.push(mR.xHeight - hr); zt.push(mS.xHeight - hs); }
  if (zonesOk.asc) { zf.push(mR.ascender - hr); zt.push(mS.ascender - hs); }
  const zone = monotoneZones(zf, zt);
  const Z = zoneMapper(zone.from, zone.to);
  const wS: number[] = [], wR: number[] = [];
  for (const p of pairs) {
    const bs = bboxOf(mapShape(p.S, (q) => ({ x: q.x - mS.slant * q.y, y: q.y })));
    const br = bboxOf(mapShape(p.R, (q) => ({ x: q.x - mR.slant * q.y, y: q.y })));
    wS.push(bs.maxX - bs.minX);
    wR.push(br.maxX - br.minX);
  }
  // width model w_src = sx·w_ref + b with the intercept pinned to the measured stem difference
  // (weight growth adds ink on both sides); sx is then a robust median ratio
  const b0 = mS.vstem - mR.vstem;
  const ratios = wR.map((w, i) => (wS[i] - b0) / w).filter((r) => isFinite(r) && r > 0.2 && r < 5);
  const wfit = { slope: ratios.length ? median(ratios) : 1, intercept: b0 };
  const sx = wfit.slope;
  const range = Math.max(40, 0.35 * mS.xHeight);
  const step = o.step;
  // ---- automatic check of the global affine: candidate variants are scored on a coarse sampling
  // after removing the uniform weight difference (median deviation); the best one is used.
  // Protects against zone maps that distort more than they align (e.g. very large x-heights).
  const sdfs = pairs.map((p) => new SignedDistance(p.S, 2, range + 20));
  type Aff = (q: { x: number; y: number }) => { x: number; y: number };
  const variants: { name: string; f: Aff }[] = [
    { name: "slant + width + zone map", f: (q) => { const y = Z(q.y); return { x: sx * (q.x - mR.slant * q.y) + mS.slant * y, y }; } },
    { name: "slant + width", f: (q) => ({ x: sx * (q.x - mR.slant * q.y) + mS.slant * q.y, y: q.y }) },
    { name: "slant only", f: (q) => ({ x: q.x - mR.slant * q.y + mS.slant * q.y, y: q.y }) },
  ];
  const scoreAffine = (f: Aff) => {
    const ds: number[] = [];
    pairs.forEach((p, gi) => {
      const A = mapShape(p.R, f);
      const cS = centroid(p.S), cA = centroid(A);
      const R1 = mapShape(A, (q) => ({ x: q.x + cS.x - cA.x, y: q.y }));
      for (const rs of sampleShape(R1, 4)) {
        for (let i = 0; i < rs.n; i++) {
          const q = sdfs[gi].query(rs.x[i], rs.y[i]);
          const cos = q ? q.nx * rs.nx[i] + q.ny * rs.ny[i] : 0;
          if (q && cos > 0.35 && Math.abs(q.d / cos) <= range) ds.push(-q.d / cos);
        }
      }
    });
    if (!ds.length) return { score: Infinity, coverage: 0 };
    const med = median(ds);
    return { score: mean(ds.map((v) => Math.abs(v - med))), coverage: ds.length };
  };
  const scored = variants.map((v) => ({ ...v, ...scoreAffine(v.f) }));
  const maxCov = Math.max(...scored.map((v) => v.coverage));
  // a variant must keep ≥ 97 % of the best coverage; among those the lowest score wins
  const chosen = scored.filter((v) => v.coverage >= 0.97 * maxCov).sort((a, b) => a.score - b.score)[0] ?? scored[0];
  const affine = chosen.f;
  const affineReport = scored.map((v) => `${v.name}${v === chosen ? " ✓" : ""}: ${v.score.toFixed(2)}`).join(" · ");
  console.info(`[KHarbonCopy] affine check → ${affineReport}`);

  const glyphs: G[] = pairs.map((p, gi) => {
    const cS = centroid(p.S);
    const cR = centroid(p.R);
    const R0 = mapShape(p.R, (q) => ({ x: q.x + cS.x - cR.x, y: q.y }));
    const A = mapShape(p.R, affine);
    const cA = centroid(A);
    const R1 = mapShape(A, (q) => ({ x: q.x + cS.x - cA.x, y: q.y }));
    progress(`sampling ${p.c}`, 0.02 + (0.1 * gi) / pairs.length);
    return {
      c: p.c, S: p.S, idx: new EdgeIndex(p.S, 10), sdf: sdfs[gi], R0, R1,
      lives0: sampleShape(R0, step).map(makeLive),
      lives: sampleShape(R1, step).map(makeLive),
      dev: [], stats: [], polys: [], outlier: false, slicesH: [], slicesV: [],
    };
  });

  let skipIoU = false;
  const measure = (g: G, stage: number, lives: Live[], keepNormals = false) => {
    const devs: Float64Array[] = [];
    const all: number[] = [];
    let total = 0, sSum = 0, sW = 0;
    for (const l of lives) {
      if (stage > 0 && !keepNormals) refreshNormals(l);
      const d = new Float64Array(l.x.length);
      for (let i = 0; i < l.x.length; i++) {
        // fast path: exact signed distance to the nearest source feature, accepted when that feature
        // faces the same way as this sample (same side of the stroke)
        const q = g.sdf.query(l.x[i], l.y[i]);
        const cos = q ? q.nx * l.nx[i] + q.ny * l.ny[i] : 0;
        // nearest-point distance projected on this sample's normal (exact for a straight boundary:
        // distance along the normal = perpendicular distance / cos θ), so the deviation stays
        // linear in the normal offsets the wave function applies
        if (q && cos > 0.35 && Math.abs(q.d / cos) <= range) { d[i] = -q.d / cos; continue; }
        // otherwise (thin strokes, the nearest wall is the opposite side): exact ray along the normal
        const v = g.idx.closestCompatible({ x: l.x[i], y: l.y[i] }, { x: l.nx[i], y: l.ny[i] }, range, 0.2);
        d[i] = v == null ? NaN : v;
      }
      const raw = d.slice();
      const sp = despike(d);
      for (let i = 0; i < d.length; i++) {
        total++;
        if (isFinite(d[i])) all.push(d[i]);
        // smooth objective: instead of dropping spikes (a discontinuous decision), every matched
        // sample is down-weighted continuously by how far it sits from the running median
        // (Cauchy weight), and the loss is Charbonnier √(d²+1)−1 (L1-like, but differentiable at 0)
        const v = raw[i];
        if (!isFinite(v)) { sSum += range; sW += 1; continue; }
        const m = sp && isFinite(sp.med[i]) ? sp.med[i] : v;
        const z = sp ? (v - m) / (sp.thr || 1) : 0;
        const w = 1 / (1 + z * z);
        sSum += w * (Math.sqrt(v * v + 1) - 1);
        sW += w;
      }
      devs.push(d);
    }
    g.dev[stage] = devs;
    g.polys[stage] = packLive(lives);
    const abs = all.map(Math.abs);
    let io = NaN;
    if (!skipIoU)
      try {
        io = iou(cleanUnion(liveToShape(lives), "positive"), g.S);
      } catch { io = 0; }
    g.stats[stage] = {
      name: STAGE_NAMES[stage], meanAbs: mean(abs), rms: rms(all), p95: quantile(abs, 0.95),
      max: abs.length ? Math.max(...abs) : 0, iou: io, coverage: total ? all.length / total : 0,
      objective: total ? (abs.reduce((a, b) => a + b, 0) + (total - all.length) * range) / total : Infinity,
      smooth: sW ? sSum / sW : Infinity,
    };
  };

  glyphs.forEach((g, i) => {
    measure(g, 0, g.lives0);
    measure(g, 1, g.lives);
    progress(`stage 1 · ${g.c}`, 0.12 + (0.12 * i) / glyphs.length);
  });

  // ------------------------------------------------------------------ stage 2: normal function O(φ)
  const W = o.cornerWindow > 0 ? Math.round(o.cornerWindow) : Math.min(120, Math.max(24, Math.round(0.75 * Math.min(mS.vstem, mR.vstem))));
  // height coordinate of the wave function: 0 = baseline, 1 = x-height (source metrics, stroke edges)
  const D = Math.max(0, Math.min(3, Math.round(o.heightDegree ?? 2)));
  const vRef = { baseline: mS.baseline, height: Math.max(50, mS.xHeight - mS.baseline) };
  const vOf = (y: number) => (y - vRef.baseline) / vRef.height;
  const O = (c: number[]) => wave(c, o.harmonics, D, vOf);
  /** robust Fourier fit; `l1` → near-L1 (median) regression, the same objective as the mean |error| */
  const fitNormal = (useOutliers: boolean, stage = 1, l1 = false, lm = 0) => {
    const rows: number[][] = [], b: number[] = [];
    for (const g of glyphs) {
      if (!useOutliers && g.outlier) continue;
      g.lives.forEach((l, r) => {
        const d = g.dev[stage][r];
        for (let i = 0; i < l.x.length; i++) {
          if (!isFinite(d[i]) || Math.abs(l.rs.cornerDist[i]) < W * 0.6) continue;
          rows.push(waveRow(Math.atan2(l.ny[i], l.nx[i]), vOf(l.y[i]), o.harmonics, D));
          b.push(d[i]);
        }
      });
    }
    // uniform decimation keeps the system tractable while staying unbiased
    const maxRows = 6000; // uniform decimation: ≥ 80 rows per unknown; the line search fixes the step length
    let rr = rows, bb = b;
    if (rows.length > maxRows) {
      const k = rows.length / maxRows;
      rr = []; bb = [];
      for (let i = 0; i < maxRows; i++) { const j = Math.floor(i * k); rr.push(rows[j]); bb.push(b[j]); }
    }
    const prior = fourierPrior(o.harmonics, rr.length, D);
    // Levenberg–Marquardt: (JᵀJ + λ·diag JᵀJ)Δ = Jᵀr, realised as extra rows √(λ·Σ_i J_ij²)·e_j.
    // Larger λ rotates the Gauss–Newton step towards the scaled gradient (shorter, safer).
    const damp: { rows: number[][]; b: number[] } = { rows: [], b: [] };
    if (lm > 0 && rr.length) {
      const nU = rr[0].length;
      for (let j = 0; j < nU; j++) {
        let sjj = 0;
        for (const r of rr) sjj += r[j] * r[j];
        const row = new Array<number>(nU).fill(0);
        row[j] = Math.sqrt(lm * sjj);
        damp.rows.push(row);
        damp.b.push(0);
      }
    }
    return {
      fit: huberFit([...rr, ...prior.rows, ...damp.rows], [...bb, ...prior.b, ...damp.b],
        { ...(l1 ? { delta: 0.1, iterations: 6 } : { iterations: 4 }), fixedFrom: rr.length }),
      n: rows.length,
    };
  };
  tick("sampling + stage 1");
  progress("fitting normal function O(φ)", 0.25);
  let nf = fitNormal(true);
  /** sampling step currently used by the refinement (coarse first, then the configured one) */
  let curStep = step;
  const applyStage2 = (coef: number[]) => {
    for (const g of glyphs) {
      g.lives = sampleShape(g.R1, curStep).map(makeLive);
      for (const l of g.lives) applyNormalOffset(l, O(coef));
      measure(g, 2, g.lives);
    }
  };
  applyStage2(nf.fit.x);
  // adaptive outlier rule (works across design families): robust z-score on IoU and coverage,
  // never more than 30 % of the glyphs
  {
    const ious = glyphs.map((g) => g.stats[2].iou), covs = glyphs.map((g) => g.stats[2].coverage);
    const thrI = Math.min(0.86, median(ious) - 3 * 1.4826 * mad(ious));
    const thrC = Math.min(0.85, median(covs) - 3 * 1.4826 * mad(covs));
    const score = (g: G) => Math.min(g.stats[2].iou - thrI, g.stats[2].coverage - thrC);
    const cand = glyphs.filter((g) => score(g) < 0).sort((a, b) => score(a) - score(b));
    for (const g of cand.slice(0, Math.floor(glyphs.length * 0.3))) {
      g.outlier = true;
      g.reason = g.stats[2].iou < thrI ? `IoU ${(g.stats[2].iou * 100).toFixed(1)}%` : `coverage ${(g.stats[2].coverage * 100).toFixed(0)}%`;
    }
  }
  if (glyphs.some((g) => g.outlier) && glyphs.some((g) => !g.outlier)) {
    nf = fitNormal(false);
    applyStage2(nf.fit.x);
  }
  progress("stage 2 done", 0.35);

  // ------------------------------------------------------------------ stage 3: corner kernels
  const NB = 2 * W + 1;
  type Inst = { key: string; convex: boolean; turn: number; prof: Float64Array };
  /** smooth (gaussian σ in samples) and taper to zero at the window ends (no steps at the edges) */
  const smoothTaper = (arr: ArrayLike<number>): number[] => {
    const sig = Math.max(1.5, W / 10);
    const R = Math.ceil(3 * sig);
    const out = new Array<number>(NB).fill(0);
    for (let k = 0; k < NB; k++) {
      let sw = 0, sv = 0;
      for (let j = -R; j <= R; j++) {
        const q = k + j;
        if (q < 0 || q >= NB || !isFinite(arr[q])) continue;
        const w = Math.exp(-(j * j) / (2 * sig * sig));
        sw += w; sv += w * arr[q];
      }
      const u = Math.abs(k - W) / W; // 0 at apex, 1 at the window ends
      const taper = u < 0.6 ? 1 : Math.cos(((u - 0.6) / 0.4) * (Math.PI / 2)) ** 2;
      out[k] = sw ? (sv / sw) * taper : 0;
    }
    return out;
  };
  /** per-corner detrended deviation profiles of one glyph, from the residual of `stage` */
  const glyphCornerInstances = (g: G, stage: number): Inst[] => {
    const inst: Inst[] = [];
    g.lives.forEach((l, r) => {
      const d = g.dev[stage][r];
      const rs = l.rs;
      for (let c = 0; c < rs.n; c++) {
        if (!rs.corner[c] || Math.abs(rs.turn[c]) < CORNER_EDGES[0]) continue;
        const prof = new Float64Array(NB), cnt = new Float64Array(NB);
        for (let i = 0; i < rs.n; i++) {
          if (rs.cornerIdx[i] !== c || !isFinite(d[i])) continue;
          const sd = rs.cornerDist[i];
          if (Math.abs(sd) > W) continue;
          const k = Math.round(sd + W);
          prof[k] += d[i];
          cnt[k]++;
        }
        for (let k = 0; k < NB; k++) prof[k] = cnt[k] ? prof[k] / cnt[k] : NaN;
        // detrend with the outer quarter on each side (removes broad structural offset)
        const outer = (from: number, to: number) => {
          const v: number[] = [];
          for (let k = from; k <= to; k++) if (isFinite(prof[k])) v.push(prof[k]);
          return v.length ? median(v) : NaN;
        };
        const q = Math.round(W * 0.25);
        let bl = outer(0, q), br = outer(NB - 1 - q, NB - 1);
        if (!isFinite(bl)) bl = br;
        if (!isFinite(br)) br = bl;
        if (!isFinite(bl)) continue;
        for (let k = 0; k < NB; k++) if (isFinite(prof[k])) prof[k] -= bl + ((br - bl) * k) / (NB - 1);
        inst.push({ key: `${r}:${c}`, convex: rs.turn[c] > 0, turn: Math.abs(rs.turn[c]), prof });
      }
    });
    return inst;
  };
  const cornerInstances = (stage: number): Inst[] =>
    glyphs.filter((g) => !g.outlier).flatMap((g) => glyphCornerInstances(g, stage));
  /** bins from instance profiles; `prior` raw profiles are added (backfitting update) */
  const buildBins = (inst: Inst[], prior?: CornerBin[], relax = 1): CornerBin[] => {
    const out: CornerBin[] = [];
    let bi = 0;
    for (const convex of [true, false])
      for (let b = 0; b < CORNER_EDGES.length - 1; b++, bi++) {
        const lo = CORNER_EDGES[b], hi = CORNER_EDGES[b + 1];
        const last = b === CORNER_EDGES.length - 2 ? 1e-9 : 0;
        const members = inst.filter((x) => x.convex === convex && x.turn >= lo && x.turn < hi + last);
        // gated median: positions where corners disagree (structure, not style) shrink to 0
        const upd = new Array<number>(NB).fill(0);
        for (let k = 0; k < NB; k++) {
          const v = members.map((m) => m.prof[k]).filter(isFinite);
          if (v.length < 3) continue;
          const med = median(v);
          const se = (1.8533 * mad(v)) / Math.sqrt(v.length);
          upd[k] = (med * med * med) / (med * med + se * se + 1e-12);
        }
        const updS = smoothTaper(upd);
        const raw = updS.map((v, k) => (prior ? prior[bi].raw[k] : 0) + v * relax);
        const count = prior ? prior[bi].count : members.length;
        const turnMid = members.length ? median(members.map((m) => m.turn)) : (lo + hi) / 2;
        // a fillet radius needs enough corners to be a style trait, and can never exceed the window
        const radius = count >= 8 ? Math.min(W, fitFillet(raw, W, turnMid, convex)) : 0;
        // residual detail is trusted in proportion to how many corners agree; clamped to ±0.2 stem
        const trust = count / (count + 6);
        const lim = 0.2 * mS.vstem;
        const profile = smoothTaper(raw.map((v, k) => v - filletDeviation(radius, turnMid, k - W, convex))).map((v) =>
          Math.max(-lim, Math.min(lim, v * trust)),
        );
        const rawLim = 0.12 * Math.min(mS.vstem, mR.vstem * 2, 160);
        for (let k = 0; k < NB; k++) raw[k] = Math.max(-rawLim, Math.min(rawLim, raw[k]));
        out.push({ convex, lo, hi, count, radius, residualRms: rms(profile), profile, raw });
      }
    return out;
  };
  const cornersOnGlyph = (g: G, bins: CornerBin[], corr?: Map<string, Float64Array>) => {
    g.lives.forEach((l, r) => {
      const rs = l.rs;
      const disp = new Float64Array(rs.n);
      for (let i = 0; i < rs.n; i++) {
        const c = rs.cornerIdx[i];
        if (c < 0 || Math.abs(rs.cornerDist[i]) > W || Math.abs(rs.turn[c]) < CORNER_EDGES[0]) continue;
        const lk = cornerLookup(bins, rs.turn[c] > 0, Math.abs(rs.turn[c]));
        if (lk) disp[i] = lk.raw(rs.cornerDist[i]);
        const cc = corr?.get(`${r}:${c}`);
        if (cc) disp[i] += cc[Math.max(0, Math.min(NB - 1, Math.round(rs.cornerDist[i] + W)))];
      }
      for (let i = 0; i < rs.n; i++) { l.x[i] += l.nx[i] * disp[i]; l.y[i] += l.ny[i] * disp[i]; }
    });
  };
  /** apply the corner model (bin raw profiles) to the current stage-2 shapes and measure stage 3 */
  const applyStage3 = (bins: CornerBin[], report = true) => {
    glyphs.forEach((g, gi) => {
      cornersOnGlyph(g, bins);
      measure(g, 3, g.lives);
      if (report) progress(`stage 3 · ${g.c}`, 0.35 + (0.08 * gi) / glyphs.length);
    });
  };
  const modelError = () => {
    const st = glyphs.filter((g) => !g.outlier).map((g) => g.stats[3]);
    return {
      meanAbs: mean(st.map((x) => x.meanAbs)), rms: mean(st.map((x) => x.rms)),
      p95: mean(st.map((x) => x.p95)), iou: mean(st.map((x) => x.iou)),
      objective: mean(st.map((x) => x.objective ?? Infinity)),
      coverage: mean(st.map((x) => x.coverage)),
      smooth: mean(st.map((x) => x.smooth ?? Infinity)),
    };
  };
  // acceptance uses the SAME quantity the corrections minimise (mean |d| over matched samples),
  // guarded so that a step can never "win" by losing matches: coverage may not drop by more than
  // 0.5 % in TOTAL relative to the state the refinement started from (cumulative, not per step)
  // acceptance uses the SMOOTH objective (soft outlier weights, Charbonnier loss): no hard switches
  const better = (a: { smooth: number; coverage: number }, b: { smooth: number; coverage: number }, floor: number) =>
    isFinite(a.smooth) && a.smooth < b.smooth && a.coverage >= floor;
  let coef = nf.fit.x.slice();
  let bins = buildBins(cornerInstances(2));
  applyStage3(bins);

  // ---------------------------------------------- iterative refinement (backfitting O(phi) + corners)
  // Each pass re-estimates the corrections of the wave function O(phi) and of the corner kernels
  // on the residual left by the previous pass, then re-applies the chain from stage 1.
  // Stops when: error <= threshold, gain < minGain, error grows (reverted), or maxIter reached.
  type Ev = { meanAbs: number; coverage: number; smooth: number };
  /**
   * Line search along a correction direction: α = 1, then 2 (if it helped) or ½, ¼ (if not),
   * then the vertex of the parabola through the best three points. Returns the best α that
   * lowers the error while keeping coverage ≥ floor, or null.
   */
  const lineSearch = (evalAt: (a: number) => Ev, e0: Ev, floor: number): { alpha: number; e: Ev } | null => {
    const f = (e: Ev) => (isFinite(e.smooth) && e.coverage >= floor ? e.smooth : Infinity);
    const pts: { a: number; v: number; e: Ev }[] = [{ a: 0, v: e0.smooth, e: e0 }];
    const probe = (a: number) => { const e = evalAt(a); pts.push({ a, v: f(e), e }); return f(e); };
    const v1 = probe(1);
    if (v1 < e0.smooth) { if (probe(2) < v1) probe(4); }
    else if (!(probe(0.5) < e0.smooth) && !(probe(0.25) < e0.smooth)) probe(0.1);
    const fin = pts.filter((p) => isFinite(p.v)).sort((p, q) => p.a - q.a);
    if (fin.length >= 3) {
      let k = 0;
      for (let j = 1; j < fin.length; j++) if (fin[j].v < fin[k].v) k = j;
      const c = Math.min(Math.max(k, 1), fin.length - 2);
      const [p1, p2, p3] = [fin[c - 1], fin[c], fin[c + 1]];
      const den = (p1.a - p2.a) * (p1.a - p3.a) * (p2.a - p3.a);
      if (Math.abs(den) > 1e-12) {
        const A = (p3.a * (p2.v - p1.v) + p2.a * (p1.v - p3.v) + p1.a * (p3.v - p2.v)) / den;
        const B = (p3.a * p3.a * (p1.v - p2.v) + p2.a * p2.a * (p3.v - p1.v) + p1.a * p1.a * (p2.v - p3.v)) / den;
        const av = A > 0 ? -B / (2 * A) : NaN;
        if (isFinite(av) && av > 0.05 && av <= 6 && pts.every((p) => Math.abs(p.a - av) > 0.05)) probe(av);
      }
    }
    let best: { a: number; v: number; e: Ev } | null = null;
    for (const p of pts) if (p.a > 0 && p.v < e0.smooth && (!best || p.v < best.v)) best = p;
    return best ? { alpha: best.a, e: best.e } : null;
  };

  const refinement: RefinementStep[] = [];
  const maxIter = Math.max(0, Math.min(50, Math.floor(o.refineMaxIter)));
  // multi-resolution: most passes run on a coarse sampling (≤ 2 u), the last ones on the configured
  // step — corrections are smooth functions, so the coarse passes find the same direction 4× faster
  const coarse = step < 2 ? Math.min(2, step * 4) : step;
  const coarsePasses = coarse !== step ? Math.max(1, Math.round(maxIter * 0.6)) : 0;
  const setResolution = (sp: number) => { curStep = sp; applyStage2(coef); applyStage3(bins, false); };
  if (coarsePasses) setResolution(coarse);
  let err = modelError();
  let covFloor = err.coverage - 0.005;
  refinement.push({ iter: 0, ...err, accepted: true, note: `initial estimate · sampling ${curStep} u` });
  let relaxC = o.refineRelax;
  let stalled = 0; void stalled;
  const toFine = (it: number) => {
    setResolution(step);
    err = modelError();
    covFloor = err.coverage - 0.005;
    stalled = 0; relaxC = o.refineRelax;
    revPrev = reverseError();
    blocked.clear();
    refinement.push({ iter: it, ...err, reverse: reverseError(), accepted: true, note: `→ fine sampling ${step} u (re-measured)` });
  };
  skipIoU = true;
  // Policy: every configured pass runs. A pass never ends the loop by itself; when the fitted
  // directions cannot lower the error, a seeded random search explores the coefficient space
  // (smooth directions: high harmonics and high height degrees get smaller amplitudes) and is
  // accepted only if the error falls — so the loss curve is monotone and the loop always finishes.
  // Early exits: error ≤ threshold, or a user-set minimum gain (> 0) being undercut on the fine sampling.
  const R = rng(0x5eed + Math.round(err.meanAbs * 1000));
  const nCoef = coef.length, nBlock = 2 * o.harmonics + 1;
  const smoothScale = (j: number) => {
    const d = Math.floor(j / nBlock), k = Math.max(1, Math.ceil((j % nBlock) / 2));
    return 1 / (k * k * (1 + 2 * d));
  };
  let explore = 0.5; // random-search amplitude (units), adapted multiplicatively
  // reverse (source → transformed reference) mean distance, on source samples every 4 units
  const srcSamples = glyphs.map((g) => sampleShape(g.S, 4));
  const reverseError = () => {
    const vals: number[] = [];
    glyphs.forEach((g, gi) => {
      if (g.outlier) return;
      const sdfR = new SignedDistance(liveToShape(g.lives), 4, range + 20);
      let sum = 0, n = 0;
      for (const rs of srcSamples[gi])
        for (let i = 0; i < rs.n; i++) {
          const q = sdfR.query(rs.x[i], rs.y[i]);
          sum += q ? Math.min(range, Math.abs(q.d)) : range;
          n++;
        }
      if (n) vals.push(sum / n);
    });
    return mean(vals);
  };
  let revPrev = reverseError();
  const blocked = new Set<string>();
  refinement[0].reverse = revPrev;
  for (let it = 1; it <= maxIter; it++) {
    if (curStep !== step && it > coarsePasses) toFine(it - 1);
    if (err.meanAbs <= o.refineThreshold) {
      if (curStep !== step) { toFine(it - 1); continue; }
      refinement[refinement.length - 1].note += " · threshold reached";
      break;
    }
    const snap = { coef: coef.slice(), bins, err };
    let usedDir = "";
    const say = (what: string) =>
      progress(`global pass ${it}/${maxIter} · ${curStep} u · ${what} · mean error ${err.meanAbs.toFixed(3)}`, 0.27 + (0.2 * it) / Math.max(1, maxIter));
    const start = err.meanAbs;
    const notes: string[] = [];
    // (a) wave function O(φ, v): exact line search along the fitted corrections
    let done = false;
    // after a bidirectional revert the same state would yield the same directions: skip the ones
    // already tried from this state and start from the more damped LM steps
    const cands = ([["L1", true, 0], ["Huber", false, 0], ["LM λ=0.3", false, 0.3], ["LM λ=3", false, 3], ["LM λ=30", false, 30]] as const)
      .filter(([name]) => !blocked.has(name));
    for (const [name, l1, lm] of cands) {
      say(`fitting ${name} direction`);
      const dO = fitNormal(false, 3, l1, lm).fit.x;
      let lastA = 0;
      const evalAt = (a: number) => {
        lastA = a;
        say(`${name} line search α=${a.toFixed(2)}`);
        applyStage2(coef.map((c, i) => c + a * dO[i]));
        applyStage3(bins, false);
        return modelError();
      };
      const ls = lineSearch(evalAt, err, covFloor);
      if (ls) {
        coef = coef.map((c, i) => c + ls.alpha * dO[i]);
        if (lastA !== ls.alpha) { applyStage2(coef); applyStage3(bins, false); }
        err = modelError();
        notes.push(`O(φ,v) ${name} α=${ls.alpha.toFixed(2)}`);
        usedDir = name;
        done = true;
        break;
      }
      applyStage2(coef); applyStage3(bins, false);
    }
    // (a') random exploration when the fitted directions are exhausted
    if (!done) {
      let bestE: Ev | null = null, bestC: number[] | null = null;
      for (let trial = 0; trial < 3; trial++) {
        const dir = Array.from({ length: nCoef }, (_, j) => R.gauss() * explore * smoothScale(j));
        for (const a of [1, -1]) {
          say(`random search ${trial + 1}/3 α=${a}`);
          const cand = coef.map((c, i) => c + a * dir[i]);
          applyStage2(cand);
          applyStage3(bins, false);
          const e = modelError();
          if (better(e, bestE ?? err, covFloor)) { bestE = e; bestC = cand; }
          if (bestE === e) break; // this sign helped: next trial
        }
      }
      if (bestE && bestC) {
        coef = bestC;
        applyStage2(coef); applyStage3(bins, false);
        err = modelError();
        explore = Math.min(8, explore * 1.5);
        notes.push(`O(φ,v) random search ✓ (amp ${explore.toFixed(2)})`);
      } else {
        applyStage2(coef); applyStage3(bins, false);
        explore = Math.max(0.01, explore * 0.5);
        notes.push(`O(φ,v) no descent · random amp → ${explore.toFixed(2)}`);
      }
    }
    // (b) corner kernels, on the residual of the state accepted in (a); the step recovers after failures
    {
      say("corner kernels");
      const nextBins = buildBins(cornerInstances(3), bins, relaxC);
      applyStage2(coef);
      applyStage3(nextBins, false);
      const e = modelError();
      if (better(e, err, covFloor)) { bins = nextBins; err = e; notes.push(`corners ok (step ${relaxC.toFixed(3)})`); relaxC = Math.min(o.refineRelax, relaxC * 1.5); }
      else { relaxC = Math.max(o.refineRelax / 64, relaxC / 2); notes.push(`corners rejected → step ${relaxC.toFixed(3)}`); applyStage2(coef); applyStage3(bins, false); }
    }
    // (c) bidirectional check (point 4): the pass is kept only if the source → reference distance
    // does not grow either — a step cannot "improve" by drifting away from parts of the source ink
    say("bidirectional check");
    const rev = reverseError();
    if (rev > revPrev * 1.002 && snap.coef.some((c, i) => c !== coef[i])) {
      coef = snap.coef; bins = snap.bins; err = snap.err;
      applyStage2(coef); applyStage3(bins, false);
      notes.push(`reverted: source→reference distance ${revPrev.toFixed(2)} → ${rev.toFixed(2)}`);
      if (usedDir) blocked.add(usedDir);
      relaxC = Math.max(o.refineRelax / 64, relaxC / 2);
    } else { revPrev = rev; blocked.clear(); }
    const gain = (start - err.meanAbs) / (start || 1);
    refinement.push({ iter: it, ...err, reverse: revPrev, accepted: gain > 0, note: `${notes.join(" · ")} · gain ${(gain * 100).toFixed(3)}%` });
    if (o.refineMinGain > 0 && gain > 0 && gain < o.refineMinGain) {
      if (curStep !== step) { refinement[refinement.length - 1].note += " · converged at coarse sampling"; toFine(it); continue; }
      refinement[refinement.length - 1].note += " · converged (gain below the minimum you set)";
      break;
    }
    if (it === maxIter) refinement[refinement.length - 1].note += " · all passes completed";
  }
  if (curStep !== step) setResolution(step);
  skipIoU = false;
  // final state with full statistics (IoU)
  applyStage2(coef);
  applyStage3(bins, false);
  nf = { ...nf, fit: { ...nf.fit, x: coef } };

  tick(`global refinement (${refinement.length - 1} passes)`);
  // ---------------------------------------------- per-glyph refinement
  // Every glyph refines its OWN wave function O_g(phi) and its own corner corrections on its own
  // residual (same monotone coordinate descent, same stop rules). The transferable model is then
  // the consistency-gated median of the converged per-glyph functions.
  const coefRaw = coef.slice();
  // ≥ 8 rows per unknown (the smoothness prior regularises the rest), so coarse passes can fit too
  const rowsMin = 8 * (2 * o.harmonics + 1) * (D + 1);
  skipIoU = true;
  glyphs.forEach((g, gi) => {
    progress(`per-glyph refinement · ${g.c}`, 0.43 + (0.05 * gi) / glyphs.length);
    let cg = coef.slice();
    let corr = new Map<string, Float64Array>();
    let stepG = step;
    const applyG = (cc: number[], cr: Map<string, Float64Array>) => {
      g.lives = sampleShape(g.R1, stepG).map(makeLive);
      for (const l of g.lives) applyNormalOffset(l, O(cc));
      cornersOnGlyph(g, bins, cr);
      measure(g, 3, g.lives);
      return { meanAbs: g.stats[3].meanAbs, coverage: g.stats[3].coverage, smooth: g.stats[3].smooth ?? Infinity };
    };
    const maxIterG = Math.min(maxIter, Math.max(1, Math.round(o.perGlyphMaxIter ?? 12)));
    // multi-resolution per glyph: all passes but the last 3 on the coarse sampling
    const coarseG = coarse !== step && maxIterG > 3 ? maxIterG - 3 : 0;
    if (coarseG) stepG = coarse;
    let e = applyG(cg, corr);
    let covFloorG = e.coverage - 0.005;
    const steps: RefinementStep[] = [{ iter: 0, meanAbs: g.stats[3].meanAbs, rms: g.stats[3].rms, p95: g.stats[3].p95, iou: NaN, accepted: true, note: `global model · ${stepG} u` }];
    let rC = o.refineRelax;
    let oFailsG = 0, stalledG = 0, exploreG = 0.5;
    void oFailsG; void stalledG;
    const fineG = (it: number) => {
      stepG = step;
      e = applyG(cg, corr);
      covFloorG = e.coverage - 0.005;
      oFailsG = 0; stalledG = 0; rC = o.refineRelax;
      steps.push({ iter: it, meanAbs: e.meanAbs, rms: g.stats[3].rms, p95: g.stats[3].p95, iou: NaN, accepted: true, note: `→ fine sampling ${step} u` });
    };
    for (let it = 1; it <= maxIterG; it++) {
      if (stepG !== step && it > coarseG) fineG(it - 1);
      if (g.stats[3].meanAbs <= o.refineThreshold && g.stats[3].coverage > 0.95) {
        if (stepG !== step) { fineG(it - 1); continue; }
        steps[steps.length - 1].note += " · threshold reached";
        break;
      }
      const start = e;
      const notes: string[] = [];
      {
        const rows: number[][] = [], bb: number[] = [];
        g.lives.forEach((l, r) => {
          const d = g.dev[3][r];
          for (let i = 0; i < l.x.length; i++) {
            if (!isFinite(d[i]) || Math.abs(l.rs.cornerDist[i]) < W * 0.6) continue;
            rows.push(waveRow(Math.atan2(l.ny[i], l.nx[i]), vOf(l.y[i]), o.harmonics, D));
            bb.push(d[i]);
          }
        });
        if (rows.length >= rowsMin) {
          // decimate to ≤ 2500 rows (> 30 per unknown) with a moderate Huber threshold
          const cap = 2000;
          let rr = rows, bq = bb;
          if (rows.length > cap) {
            const k = rows.length / cap;
            rr = []; bq = [];
            for (let q = 0; q < cap; q++) { const j = Math.floor(q * k); rr.push(rows[j]); bq.push(bb[j]); }
          }
          const prior = fourierPrior(o.harmonics, rr.length, D);
          let done = false;
          for (const delta of [0.3, 1.345]) {
            const dO = huberFit([...rr, ...prior.rows], [...bq, ...prior.b], { delta, iterations: 5, fixedFrom: rr.length }).x;
            if (!dO.every((c) => isFinite(c))) continue;
            let lastA = 0;
            const evalAt = (a: number) => {
              lastA = a;
              const cand = cg.map((c, i) => c + a * dO[i]);
              if (!cand.every((c) => Math.abs(c) < range)) return { meanAbs: Infinity, coverage: 0, smooth: Infinity };
              return applyG(cand, corr);
            };
            const ls = lineSearch(evalAt, e, covFloorG);
            if (ls) {
              cg = cg.map((c, i) => c + ls.alpha * dO[i]);
              e = lastA !== ls.alpha ? applyG(cg, corr) : ls.e;
              oFailsG = 0;
              notes.push(`O α=${ls.alpha.toFixed(2)}`);
              done = true;
              break;
            }
            e = applyG(cg, corr);
          }
          if (!done) { oFailsG++; notes.push("O no descent"); }
        } else oFailsG = 99;
      }
      if (rC >= o.refineRelax / 16) {
        const inst = glyphCornerInstances(g, 3);
        if (inst.length) {
          const cand = new Map(corr);
          for (const ins of inst) {
            const prev = cand.get(ins.key) ?? new Float64Array(NB);
            const upd = smoothTaper(ins.prof);
            const lim = 0.12 * Math.min(mS.vstem, 160); // a corner correction is a local detail, never a structural rewrite
            cand.set(ins.key, prev.map((v, k) => Math.max(-lim, Math.min(lim, v + rC * upd[k]))));
          }
          const e2 = applyG(cg, cand);
          if (better(e2, e, covFloorG)) { corr = cand; e = e2; notes.push(`corners ok (${rC.toFixed(3)})`); }
          else { rC /= 2; notes.push(`corners rejected → ${rC.toFixed(3)}`); e = applyG(cg, corr); }
        } else rC = 0;
      }
      // random exploration when the fitted directions are exhausted (accepted only if better)
      if (!notes.some((n) => n.startsWith("O α"))) {
        const RG = rng(0xbeef + gi * 131 + it);
        let bestE: Ev | null = null, bestC: number[] | null = null;
        for (let trial = 0; trial < 2; trial++) {
          const dir = cg.map((_, j) => RG.gauss() * exploreG * smoothScale(j));
          for (const a of [1, -1]) {
            const cand = cg.map((c, i) => c + a * dir[i]);
            if (!cand.every((c) => Math.abs(c) < range)) continue;
            const e2 = applyG(cand, corr);
            if (better(e2, bestE ?? e, covFloorG)) { bestE = e2; bestC = cand; }
          }
        }
        if (bestE && bestC) { cg = bestC; e = applyG(cg, corr); exploreG = Math.min(8, exploreG * 1.5); notes.push("O random ✓"); }
        else { e = applyG(cg, corr); exploreG = Math.max(0.01, exploreG * 0.5); }
      }
      if (rC < o.refineRelax / 16) rC = o.refineRelax / 16; // corners keep trying with a small step
      const gain = (start.meanAbs - e.meanAbs) / (start.meanAbs || 1);
      steps.push({ iter: it, meanAbs: g.stats[3].meanAbs, rms: g.stats[3].rms, p95: g.stats[3].p95, iou: NaN, accepted: gain > 0, note: `${notes.join(" · ")} · gain ${(gain * 100).toFixed(2)}%` });
      if (o.refineMinGain > 0 && gain > 0 && gain < o.refineMinGain) {
        if (stepG !== step) { fineG(it); continue; }
        steps[steps.length - 1].note += " · converged";
        break;
      }
      if (it === maxIterG) steps[steps.length - 1].note += " · all passes completed";
    }
    if (stepG !== step) { stepG = step; applyG(cg, corr); }
    g.coefG = cg;
    g.cornerCorr = corr;
    g.refineSteps = steps;
    g.refined = { ...g.stats[3], name: "3p · per-glyph refined" };
    g.polys[6] = packLive(g.lives);
  });
  skipIoU = false;
  for (const g of glyphs) {
    try { g.refined!.iou = iou(cleanUnion(liveToShape(g.lives), "positive"), g.S); } catch { /* keep NaN */ }
  }

  // ---- aggregation: consistency-gated median of the per-glyph wave functions
  const perGlyph = glyphs.filter((g) => !g.outlier && g.coefG && g.coefG.every((c) => isFinite(c))).map((g) => g.coefG!);
  const harmonicTrust: number[] = coef.map(() => 1);
  // bootstrap over glyphs (point 5): B resamples with replacement of the per-glyph functions give,
  // for every coefficient, the sampling distribution of the median → standard error and a 95 % CI.
  // The bootstrap SE replaces the asymptotic MAD formula in the consistency gate.
  const coefSE: number[] = coef.map(() => NaN);
  const coefCI: [number, number][] = coef.map(() => [NaN, NaN]);
  if (perGlyph.length >= 5) {
    const B = 400;
    const RB = rng(0xb007);
    const G = perGlyph.length;
    const boot = coef.map(() => new Float64Array(B));
    for (let b = 0; b < B; b++) {
      const pick = Array.from({ length: G }, () => perGlyph[Math.floor(RB.next() * G)]);
      for (let i = 0; i < coef.length; i++) boot[i][b] = median(pick.map((v) => v[i]));
    }
    for (let i = 0; i < coef.length; i++) {
      const vals = perGlyph.map((v) => v[i]).filter((v) => isFinite(v));
      if (vals.length < 5) { harmonicTrust[i] = 0; coef[i] = i === 0 ? coef[i] : 0; continue; }
      const med = median(vals);
      const bs = Array.from(boot[i]).sort((x, y) => x - y);
      const se = std(bs);
      coefSE[i] = se;
      coefCI[i] = [bs[Math.floor(0.025 * B)], bs[Math.floor(0.975 * B)]];
      harmonicTrust[i] = i === 0 ? 1 : (med * med) / (med * med + se * se + 1e-12);
      coef[i] = med * harmonicTrust[i];
    }
  }
  // corner bins: add the gated median of the per-glyph corner corrections
  {
    const inst: Inst[] = [];
    for (const g of glyphs) {
      if (g.outlier || !g.cornerCorr) continue;
      g.lives.forEach((l, r) => {
        for (let c = 0; c < l.rs.n; c++) {
          const cc = g.cornerCorr!.get(`${r}:${c}`);
          if (cc) inst.push({ key: `${r}:${c}`, convex: l.rs.turn[c] > 0, turn: Math.abs(l.rs.turn[c]), prof: cc });
        }
      });
    }
    if (inst.length) bins = buildBins(inst, bins, 1);
  }
  // re-apply the aggregated (transferable) model to every glyph
  applyStage2(coef);
  applyStage3(bins, false);
  nf = { ...nf, fit: { ...nf.fit, x: coef } };
  // ---- stroke terminals (point 2): residual profile across stroke ends, normalised by cap width
  let terminals: TerminalModel = { count: 0, profile: new Array(TERM_BINS).fill(0), raw: new Array(TERM_BINS).fill(0) };
  {
    const profs: Float64Array[] = [];
    const lo = 0.3 * Math.min(mR.vstem, mR.hstem), hi = 1.8 * Math.max(mR.vstem, mR.hstem);
    for (const g of glyphs) {
      if (g.outlier) continue;
      g.lives.forEach((l, r) => {
        const d = g.dev[3][r];
        for (const t of findTerminals(l.rs, lo, hi)) {
          const acc = new Float64Array(TERM_BINS), cnt = new Float64Array(TERM_BINS);
          for (const { idx, u } of terminalWindow(t, l.rs.n)) {
            if (!isFinite(d[idx])) continue;
            const k = Math.round(((u - TERM_U0) / (TERM_U1 - TERM_U0)) * (TERM_BINS - 1));
            if (k < 0 || k >= TERM_BINS) continue;
            acc[k] += d[idx]; cnt[k]++;
          }
          profs.push(acc.map((v, k) => (cnt[k] ? v / cnt[k] : NaN)));
        }
      });
    }
    if (profs.length >= 3) terminals = buildTerminalModel(profs, mS.vstem);
    console.info(`[KHarbonCopy] terminals: ${profs.length} stroke ends measured`);
  }
  const stage2Iou = mean(glyphs.filter((g) => !g.outlier).map((g) => g.stats[2].iou));

  tick("per-glyph refinement");
  // ------------------------------------------------------------------ stage 4: slice fields
  const Gd = o.grid;
  const NS = o.slices;
  const gap = 0.15 * mS.xHeight;
  glyphs.forEach((g, gi) => {
    const R3 = liveToShape(g.lives);
    const bS = bboxOf(g.S), bR = bboxOfLive(g.lives);
    const box = {
      minX: Math.min(bS.minX, bR.minX), minY: Math.min(bS.minY, bR.minY),
      maxX: Math.max(bS.maxX, bR.maxX), maxY: Math.max(bS.maxY, bR.maxY),
    };
    const bw = Math.max(1, box.maxX - box.minX), bh = Math.max(1, box.maxY - box.minY);
    const hWx: SliceLine[] = [], hTh: SliceLine[] = [], vWy: SliceLine[] = [], vTv: SliceLine[] = [];
    for (let j = 0; j < NS; j++) {
      const t = (j + 0.5) / NS;
      // horizontal slice
      const y = box.minY + bh * t;
      const rs = scanRuns(g.S, y, "y"), rr = scanRuns(R3, y, "y");
      const lw: SliceLine = { across: t, samples: [] }, lt: SliceLine = { across: t, samples: [] };
      for (const [a, b] of alignRuns(rs, rr, gap)) {
        const S = rs[a], R = rr[b];
        if (!goodPair(S, R, mS.vstem)) continue;
        const u = ((R.a + R.b) / 2 - box.minX) / bw;
        lw.samples.push({ along: u, value: ((S.a + S.b) / 2 - (R.a + R.b) / 2) / bw });
        lt.samples.push({ along: u, value: (S.b - S.a - (R.b - R.a)) / (mS.vstem || 1) });
      }
      hWx.push(lw); hTh.push(lt);
      g.slicesH.push({ c: y, src: rs.map((r) => [r.a, r.b]), ref: rr.map((r) => [r.a, r.b]) });
      // vertical slice
      const x = box.minX + bw * t;
      const vs = scanRuns(g.S, x, "x"), vr = scanRuns(R3, x, "x");
      const vw: SliceLine = { across: t, samples: [] }, vt: SliceLine = { across: t, samples: [] };
      for (const [a, b] of alignRuns(vs, vr, gap)) {
        const S = vs[a], R = vr[b];
        if (!goodPair(S, R, mS.hstem)) continue;
        const v = ((R.a + R.b) / 2 - box.minY) / bh;
        vw.samples.push({ along: v, value: ((S.a + S.b) / 2 - (R.a + R.b) / 2) / bh });
        vt.samples.push({ along: v, value: (S.b - S.a - (R.b - R.a)) / (mS.hstem || 1) });
      }
      vWy.push(vw); vTv.push(vt);
      g.slicesV.push({ c: x, src: vs.map((r) => [r.a, r.b]), ref: vr.map((r) => [r.a, r.b]) });
    }
    const fx = gridFromSlices(hWx, Gd, "h"), fth = gridFromSlices(hTh, Gd, "h");
    const fy = gridFromSlices(vWy, Gd, "v"), ftv = gridFromSlices(vTv, Gd, "v");
    g.box = box;
    g.fields = {
      wx: fx.grid, wy: fy.grid, th: fth.grid, tv: ftv.grid,
      sup: { wx: fx.support, wy: fy.support, th: fth.support, tv: ftv.support },
    };
    // per-glyph fields are trusted only where slices actually observed ink (support gate)
    const gate = (sup: number[], grid: Grid): Grid => ({ G: grid.G, data: grid.data.map((v, i) => v * Math.min(1, sup[i])) });
    applyFields(g.lives, box, {
      wx: gate(fx.support, fx.grid), wy: gate(fy.support, fy.grid), th: gate(fth.support, fth.grid), tv: gate(ftv.support, ftv.grid),
    }, mS.vstem, mS.hstem);
    measure(g, 4, g.lives);
    progress(`stage 4 · ${g.c}`, 0.47 + (0.25 * gi) / glyphs.length);
  });
  const inl = glyphs.filter((g) => !g.outlier && g.fields);
  // node-wise weighted median, shrunk towards 0 where glyphs disagree (v·v²/(v²+spread²))
  // standard error of the median ≈ 1.25·1.4826·MAD/√n; nodes seen by few glyphs fade out
  const agg = (k: "wx" | "wy" | "th" | "tv") => {
    const list = inl.map((g) => ({ grid: g.fields![k], support: g.fields!.sup[k] }));
    const a = aggregateGrids(list, Gd);
    const floor = k === "wx" || k === "wy" ? 0.004 : 0.03;
    a.grid.data = a.grid.data.map((v, i) => {
      const n = list.filter((g) => g.support[i] > 0.05).length;
      if (n < Math.max(3, 0.2 * list.length)) return 0;
      const se = (1.8533 * a.spread[i]) / Math.sqrt(n);
      const s2 = se * se + floor * floor;
      return ((v * v * v) / (v * v + s2)) * Math.min(1, n / (0.5 * list.length));
    });
    return a;
  };
  const A = { wx: agg("wx"), wy: agg("wy"), th: agg("th"), tv: agg("tv") };
  // generalisation check: aggregated fields on stage-3 shapes
  const genStats: StageStat[] = [];
  for (const g of inl) {
    const lives = g.dev[3] ? cloneLives(g.polys[3], g.lives) : g.lives;
    applyFields(lives, g.box!, { wx: A.wx.grid, wy: A.wy.grid, th: A.th.grid, tv: A.tv.grid }, mS.vstem, mS.hstem);
    const tmp = { ...g, dev: [], stats: [], polys: [] } as G;
    measure(tmp, 4, lives);
    genStats.push(tmp.stats[4]);
  }

  // ------------------------------------------------------------------ stage 5: texture
  tick("slice fields");
  progress("texture spectral analysis", 0.75);
  const cutoff = o.textureCutoff;
  const nBands = 20;
  const lamLo = Math.max(2 * step, 2), lamHi = cutoff;
  const edges = Array.from({ length: nBands + 1 }, (_, i) => lamLo * Math.pow(lamHi / lamLo, i / nBands));
  const tape: number[] = [];
  const tapePhi: number[] = [];
  const corrLens: number[] = [];
  /** append a clean piece to the tape with a short linear cross-fade (keeps the tape continuous) */
  const appendPiece = (vals: number[], phis: number[]) => {
    const F = Math.min(8, Math.floor(vals.length / 4));
    if (tape.length && F > 0) {
      for (let j = 0; j < F; j++) {
        const w = (j + 1) / (F + 1);
        const k = tape.length - F + j;
        tape[k] = tape[k] * (1 - w) + vals[j] * w;
      }
      vals = vals.slice(F);
      phis = phis.slice(F);
    }
    for (const v of vals) tape.push(v);
    for (const v of phis) tapePhi.push(v);
  };
  glyphs.forEach((g, gi) => {
    g.texture = [];
    g.lives.forEach((l, r) => {
      const d = g.dev[4][r];
      const N = d.length;
      const valid = d.filter(isFinite).length;
      const tex = new Float64Array(N);
      if (valid < N * 0.7 || N < 16) { g.texture!.push(tex); return; }
      const filled = fillCyclic(d);
      const L = l.rs.length;
      const { re, im } = dft(filled);
      // smooth (gaussian) band split, 50 % gain at the cutoff wavelength – no Gibbs ringing
      const gain = (k: number) => Math.exp(-((k / L) * (k / L) * cutoff * cutoff * Math.LN2));
      const low = lowpass(re, im, gain);
      for (let i = 0; i < N; i++) tex[i] = isFinite(d[i]) ? filled[i] - low[i] : 0;
      const sd = Math.sqrt(mean(Array.from(tex, (v) => v * v))) || 0;
      for (let i = 0; i < N; i++) tex[i] = Math.max(-4 * sd, Math.min(4 * sd, tex[i]));
      g.texture!.push(tex);
      if (g.outlier) return;
    });
    // stage 5 reconstruction: add the measured texture back along normals
    g.lives.forEach((l, r) => {
      const t = g.texture![r];
      for (let i = 0; i < l.x.length; i++) { l.x[i] += l.nx[i] * t[i]; l.y[i] += l.ny[i] * t[i]; }
    });
    measure(g, 5, g.lives, true);
    progress(`stage 5 · ${g.c}`, 0.78 + (0.18 * gi) / glyphs.length);
  });
  // ---- intrinsic roughness of the SOURCE outline (independent of the reference design):
  // quartic Savitzky–Golay smoothing along the arc (window = cutoff) preserves curvature,
  // so on clean Bézier outlines the residual is ~0; brush/rough outlines leave their texture.
  // Corners and curves tighter than the window are excluded.
  {
    const m = Math.max(3, Math.round(cutoff / 2 / step));
    const wSG = savitzkyGolay(m, 4);
    for (const g of glyphs) {
      if (g.outlier) continue;
      for (const rs of sampleShape(g.S, step)) {
        const N = rs.n;
        if (N < 2 * m + 8) continue;
        const sx = new Float64Array(N), sy = new Float64Array(N);
        for (let i = 0; i < N; i++) {
          let ax = 0, ay = 0;
          for (let j = -m; j <= m; j++) {
            const k = (i + j + N) % N;
            ax += wSG[j + m] * rs.x[k];
            ay += wSG[j + m] * rs.y[k];
          }
          sx[i] = ax; sy[i] = ay;
        }
        let piece: number[] = [], phis: number[] = [];
        for (let i = 0; i <= N; i++) {
          let ok = i < N && Math.abs(rs.cornerDist[i]) > (m + 2) * step;
          if (ok) {
            // curvature of the smoothed curve (turning over ±2 samples)
            const a = (i - 2 + N) % N, b = (i + 2) % N;
            const t1 = Math.atan2(sy[i] - sy[a], sx[i] - sx[a]), t2 = Math.atan2(sy[b] - sy[i], sx[b] - sx[i]);
            let dt = t2 - t1;
            while (dt > Math.PI) dt -= 2 * Math.PI;
            while (dt < -Math.PI) dt += 2 * Math.PI;
            const kappa = Math.abs(dt) / (2 * step);
            ok = kappa * m * step < 0.5;
          }
          if (ok) {
            piece.push((rs.x[i] - sx[i]) * rs.nx[i] + (rs.y[i] - sy[i]) * rs.ny[i]);
            phis.push(rs.phi[i]);
            continue;
          }
          if (piece.length >= 24) appendPiece(piece, phis);
          piece = []; phis = [];
        }
      }
    }
  }
  // Welch PSD on the clean tape (Hann window, 50 % overlap)
  const seg = Math.min(1024, Math.max(64, 1 << Math.ceil(Math.log2((2 * cutoff) / step))));
  const bandAcc = Array.from({ length: nBands }, () => ({ sum: 0, n: 0 }));
  const hann = Float64Array.from({ length: seg }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (seg - 1)));
  const sw2 = hann.reduce((acc, v) => acc + v * v, 0);
  for (let start = 0; start + seg <= tape.length; start += seg >> 1) {
    const x = new Float64Array(seg);
    let m = 0;
    for (let i = 0; i < seg; i++) m += tape[start + i];
    m /= seg;
    for (let i = 0; i < seg; i++) x[i] = (tape[start + i] - m) * hann[i];
    const { re, im } = dft(x);
    for (let k = 1; k < seg / 2; k++) {
      const lam = (seg * step) / k;
      const bIdx = edges.findIndex((e, i) => i < nBands && lam >= e && lam < edges[i + 1]);
      if (bIdx < 0) continue;
      bandAcc[bIdx].sum += (2 * step * (re[k] * re[k] + im[k] * im[k])) / sw2;
      bandAcc[bIdx].n++;
    }
  }
  const texRms = rms(tape);
  const sigT = texRms || 1e-9;
  let notchCount = 0;
  const notchW: number[] = [], notchA: number[] = [];
  {
    let w = 0, a = 0;
    for (let i = 0; i < tape.length; i++) {
      if (Math.abs(tape[i]) > 3 * sigT) { w++; a = Math.max(a, Math.abs(tape[i])); }
      else if (w) { notchCount++; notchW.push(w * step); notchA.push(a); w = 0; a = 0; }
    }
  }
  {
    let c0 = 0;
    for (const v of tape) c0 += v * v;
    for (let lag = 1; lag < Math.min(tape.length >> 1, Math.ceil(cutoff / step)); lag++) {
      let c = 0;
      for (let i = 0; i + lag < tape.length; i++) c += tape[i] * tape[i + lag];
      if (c / (c0 || 1) < 1 / Math.E) { corrLens.push(lag * step); break; }
    }
  }
  const phiAcc = Array.from({ length: 8 }, () => ({ s: 0, n: 0 }));
  tape.forEach((v, i) => {
    const pb = ((Math.floor(((tapePhi[i] + Math.PI / 8) / (2 * Math.PI)) * 8) % 8) + 8) % 8;
    phiAcc[pb].s += v * v;
    phiAcc[pb].n++;
  });
  const bands: TextureBand[] = bandAcc.map((b, i) => ({ lo: edges[i], hi: edges[i + 1], psd: b.n ? b.sum / b.n : 0 }));
  const texture: TextureModel = {
    cutoff, step, bands, rms: texRms, skewness: skewness(tape), kurtosis: kurtosis(tape),
    corrLength: corrLens.length ? median(corrLens) : 0,
    notchRate: tape.length ? (notchCount / (tape.length * step)) * 1000 : 0,
    notchWidth: notchW.length ? median(notchW) : 0,
    notchAmp: notchA.length ? median(notchA) : 0,
    phiMod: phiAcc.map((p) => (p.n && texRms ? Math.sqrt(p.s / p.n) / texRms : 1)),
    tape: tape.map((v) => Math.round(v * 1000) / 1000),
  };

  // ------------------------------------------------------------------ fidelity summary
  const fidelity: StageStat[] = STAGE_NAMES.map((name, s) => {
    const st = inl.map((g) => g.stats[s]).filter(Boolean);
    return {
      name,
      meanAbs: mean(st.map((x) => x.meanAbs)), rms: mean(st.map((x) => x.rms)), p95: mean(st.map((x) => x.p95)),
      max: st.length ? Math.max(...st.map((x) => x.max)) : 0, iou: mean(st.map((x) => x.iou)), coverage: mean(st.map((x) => x.coverage)),
    };
  });
  {
    const rf = inl.map((g) => g.refined).filter(Boolean) as StageStat[];
    fidelity.splice(4, 0, {
      name: "3p · per-glyph refined",
      meanAbs: mean(rf.map((x) => x.meanAbs)), rms: mean(rf.map((x) => x.rms)), p95: mean(rf.map((x) => x.p95)),
      max: rf.length ? Math.max(...rf.map((x) => x.max)) : 0, iou: mean(rf.map((x) => x.iou).filter(isFinite)), coverage: mean(rf.map((x) => x.coverage)),
    });
  }
  fidelity.splice(6, 0, {
    name: "4g · aggregated fields (generalisation)",
    meanAbs: mean(genStats.map((x) => x.meanAbs)), rms: mean(genStats.map((x) => x.rms)), p95: mean(genStats.map((x) => x.p95)),
    max: genStats.length ? Math.max(...genStats.map((x) => x.max)) : 0, iou: mean(genStats.map((x) => x.iou)), coverage: mean(genStats.map((x) => x.coverage)),
  });

  const model: StyleModel = {
    version: 1,
    createdAt: new Date().toISOString(),
    options: o,
    source: { family: src.family, style: src.subfamily, category: input.category },
    reference: input.refMeta,
    metrics: { src: mS, ref: mR },
    global: {
      shear: mS.slant - mR.slant, slantDeg: (Math.atan(mS.slant - mR.slant) * 180) / Math.PI,
      sx: chosen.name.includes("width") ? sx : 1, widthIntercept: wfit.intercept, zoneFrom: zone.from, zoneTo: zone.to,
      affineChoice: affineReport,
    },
    normalFn: { coef, coefRaw, trust: harmonicTrust, se: coefSE, ci: coefCI, K: o.harmonics, D, vRef, scale: nf.fit.residualScale, samples: nf.n },
    reliability: {
      iou: stage2Iou,
      zones: zonesOk,
      level: stage2Iou >= 0.8 ? "high" : stage2Iou >= 0.6 ? "medium" : "low",
    },
    fields: {
      G: Gd, wx: A.wx.grid, wy: A.wy.grid, th: A.th.grid, tv: A.tv.grid,
      spread: { wx: A.wx.spread, wy: A.wy.spread, th: A.th.spread, tv: A.tv.spread },
    },
    corners: { window: W, bins },
    terminals,
    refinement,
    optionFixes,
    texture,
    fidelity,
    glyphCount: glyphs.length,
    outliers: glyphs.filter((g) => g.outlier).map((g) => `${g.c} (${g.reason})`),
  };

  const reports: GlyphReport[] = glyphs.map((g) => ({
    char: g.c,
    outlier: g.outlier,
    reason: g.reason,
    src: packShape(g.S),
    stages: g.polys,
    rings: g.lives.map((l, r) => ({
      s: Float32Array.from(l.rs.s),
      phi: Float32Array.from(l.rs.phi),
      corner: l.rs.corner,
      length: l.rs.length,
      dev: [1, 2, 3, 4, 5].map((st) => Float32Array.from(g.dev[st]?.[r] ?? [])),
    })),
    stats: g.stats,
    refined: g.refined,
    refineSteps: g.refineSteps ?? [],
    coefG: g.coefG ?? [],
    slicesH: g.slicesH,
    slicesV: g.slicesV,
    box: g.box!,
    fields: { G: Gd, wx: g.fields!.wx.data, wy: g.fields!.wy.data, th: g.fields!.th.data, tv: g.fields!.tv.data },
  }));
  tick("texture + report");
  progress("analysis complete", 1);
  return { model, glyphs: reports };
}

/** Field displacement: warp (fraction of box) + thickness change (fraction of stems) along normals. */
export function applyFields(
  lives: Live[],
  box: { minX: number; minY: number; maxX: number; maxY: number },
  f: { wx: Grid; wy: Grid; th: Grid; tv: Grid },
  vstem: number,
  hstem: number,
  strength = { warp: 1, thickness: 1 },
) {
  const bw = Math.max(1, box.maxX - box.minX), bh = Math.max(1, box.maxY - box.minY);
  for (const l of lives) {
    refreshNormals(l);
    const n = l.x.length;
    const dx = new Float64Array(n), dy = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const u = (l.x[i] - box.minX) / bw, v = (l.y[i] - box.minY) / bh;
      const lim = (x: number) => Math.max(-0.6, Math.min(0.6, x));
      const th = lim(evalGrid(f.th, u, v)) * vstem * 0.5 * strength.thickness;
      const tv = lim(evalGrid(f.tv, u, v)) * hstem * 0.5 * strength.thickness;
      // per-side normal displacement: horizontal slices see Δw/|nx|, vertical slices Δw/|ny|;
      // blend the two estimates with weights nx², ny² (sum = 1) → |n|³ terms
      const ax = Math.abs(l.nx[i]), ay = Math.abs(l.ny[i]);
      const nrm = th * ax * ax * ax + tv * ay * ay * ay;
      dx[i] = evalGrid(f.wx, u, v) * bw * strength.warp + l.nx[i] * nrm;
      dy[i] = evalGrid(f.wy, u, v) * bh * strength.warp + l.ny[i] * nrm;
    }
    for (let i = 0; i < n; i++) { l.x[i] += dx[i]; l.y[i] += dy[i]; }
  }
}

function cloneLives(poly: Float32Array[], lives: Live[]): Live[] {
  return lives.map((l, r) => {
    const p = poly[r];
    const x = new Float64Array(l.x.length), y = new Float64Array(l.y.length);
    for (let i = 0; i < x.length; i++) { x[i] = p[2 * i]; y[i] = p[2 * i + 1]; }
    return { rs: l.rs, x, y, nx: l.nx.slice(), ny: l.ny.slice() };
  });
}

/**
 * Tikhonov smoothness prior for a Fourier series in φ: one extra row per coefficient,
 * weight ∝ k² (penalty ∝ k⁴ · c²). Directions never observed (e.g. diagonals in a set of purely
 * rectilinear glyphs) are then filled by the smoothest function instead of exploding.
 */
function fourierPrior(K: number, nRows: number, D = 0, strength = 2e-3): { rows: number[][]; b: number[] } {
  const rows: number[][] = [], b: number[] = [];
  const base = Math.sqrt(Math.max(1, nRows) * strength);
  const n = 2 * K + 1;
  for (let d = 0; d <= D; d++)
    for (let j = 0; j < n; j++) {
      if (d === 0 && j === 0) continue; // the mean weight offset is free
      const k = Math.max(1, Math.ceil(j / 2));
      const r = new Array<number>(n * (D + 1)).fill(0);
      // smoothness in φ (k²) and in height (higher Legendre degrees cost more)
      r[d * n + j] = base * k * k * (1 + 2 * d);
      rows.push(r);
      b.push(0);
    }
  return { rows, b };
}

/** Savitzky–Golay smoothing weights for the central sample (half-window m, polynomial order p). */
function savitzkyGolay(m: number, p: number): number[] {
  const n = p + 1;
  const M = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let j = -m; j <= m; j++) for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) M[a][b] += Math.pow(j / m, a + b);
  // solve M c = e0 (Gauss–Jordan with partial pivoting); weights w_j = Σ_a c_a (j/m)^a
  const A = M.map((r, i) => [...r, i === 0 ? 1 : 0]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k];
    }
  }
  const coef = A.map((r, i) => r[n] / A[i][i]);
  const w: number[] = [];
  for (let j = -m; j <= m; j++) { let v = 0; for (let a = 0; a < n; a++) v += coef[a] * Math.pow(j / m, a); w.push(v); }
  return w;
}

/** A matched run pair is trusted when the runs overlap substantially and differ by < 1 stem. */
function goodPair(S: { a: number; b: number }, R: { a: number; b: number }, stem: number) {
  const ov = Math.min(S.b, R.b) - Math.max(S.a, R.a);
  const wmin = Math.min(S.b - S.a, R.b - R.a);
  if (ov < 0.3 * wmin) return false;
  return Math.abs((S.a + S.b) / 2 - (R.a + R.b) / 2) < 0.6 * stem && Math.abs(S.b - S.a - (R.b - R.a)) < 1.2 * stem;
}

/**
 * Removes correspondence failures: samples that disagree with the running median (cyclic
 * window of 11) by more than max(4 units, 5·σ_MAD) are marked NaN.
 */
function despike(d: Float64Array): { med: Float64Array; thr: number } | null {
  const N = d.length;
  if (N < 12) return null;
  const R = 5;
  const med = new Float64Array(N);
  const buf = new Float64Array(2 * R + 1);
  for (let i = 0; i < N; i++) {
    let m = 0;
    for (let k = -R; k <= R; k++) {
      const v = d[(i + k + N) % N];
      if (v !== v) continue; // NaN
      let j = m++;
      while (j > 0 && buf[j - 1] > v) { buf[j] = buf[j - 1]; j--; }
      buf[j] = v;
    }
    med[i] = m ? buf[m >> 1] : NaN;
  }
  const res: number[] = [];
  for (let i = 0; i < N; i++) if (isFinite(d[i]) && isFinite(med[i])) res.push(Math.abs(d[i] - med[i]));
  res.sort((a, b) => a - b);
  const sigma = 1.4826 * (res[res.length >> 1] ?? 0);
  const thr = Math.max(4, 5 * sigma);
  for (let i = 0; i < N; i++) if (!isFinite(med[i]) || Math.abs(d[i] - med[i]) > thr) d[i] = NaN;
  return { med, thr };
}

/** Gaussian low-pass in the frequency domain (exact inverse DFT). */
function lowpass(re: Float64Array, im: Float64Array, gain: (k: number) => number): Float64Array {
  const N = re.length;
  const r2 = new Float64Array(N), i2 = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const kk = Math.min(k, N - k); // symmetric (negative frequencies)
    const g = gain(kk);
    r2[k] = re[k] * g;
    i2[k] = im[k] * g;
  }
  return idftReal(r2, i2);
}

function fillCyclic(d: Float64Array): Float64Array {
  const N = d.length;
  const out = d.slice();
  const idx: number[] = [];
  for (let i = 0; i < N; i++) if (isFinite(d[i])) idx.push(i);
  if (!idx.length) return new Float64Array(N);
  for (let k = 0; k < idx.length; k++) {
    const a = idx[k], b = idx[(k + 1) % idx.length];
    const span = (b - a + N) % N || N;
    for (let j = 1; j < span; j++) {
      const i = (a + j) % N;
      out[i] = d[a] + ((d[b] - d[a]) * j) / span;
    }
  }
  return out;
}

function monotoneZones(from: number[], to: number[]) {
  const pairs = from.map((f, i) => [f, to[i]] as [number, number]).filter(([f, t]) => isFinite(f) && isFinite(t)).sort((a, b) => a[0] - b[0]);
  const f: number[] = [], t: number[] = [];
  for (const [a, b] of pairs) {
    if (f.length && (a - f[f.length - 1] < 5 || b <= t[t.length - 1])) continue;
    f.push(a);
    t.push(b);
  }
  return { from: f, to: t };
}

/** Logs the duration of consecutive analysis phases (console.info), used to calibrate time estimates. */
function phaseTimer() {
  let t = performance.now();
  const t0 = t;
  return (label: string) => {
    const now = performance.now();
    console.info(`[KHarbonCopy] ${label}: ${((now - t) / 1000).toFixed(1)} s (total ${((now - t0) / 1000).toFixed(1)} s)`);
    t = now;
  };
}

/** Golden-section search for the fillet radius that best explains a corner profile. */
function fitFillet(raw: number[], W: number, turn: number, convex: boolean): number {
  const alpha = Math.PI - turn;
  const maxR = Math.min(W * Math.tan(alpha / 2), 400);
  const err = (rho: number) => {
    let e = 0;
    for (let k = 0; k < raw.length; k++) e += (raw[k] - filletDeviation(rho, turn, k - W, convex)) ** 2;
    return e;
  };
  // coarse scan then golden refinement (objective can be multi-modal on noisy data)
  let best = 0, bestE = err(0);
  const steps = 80;
  for (let i = 1; i <= steps; i++) {
    const r = (maxR * i) / steps;
    const e = err(r);
    if (e < bestE) { bestE = e; best = r; }
  }
  let a = Math.max(0, best - maxR / steps), b = Math.min(maxR, best + maxR / steps);
  const gr = (Math.sqrt(5) - 1) / 2;
  for (let it = 0; it < 60; it++) {
    const c = b - gr * (b - a), d = a + gr * (b - a);
    if (err(c) < err(d)) b = d;
    else a = c;
  }
  const r = (a + b) / 2;
  return err(r) < bestE ? r : best;
}

export type { FontMetrics };
