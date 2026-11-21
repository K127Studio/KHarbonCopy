import { Pt, Shape } from "./types";
import { cleanUnion } from "./clip";

export interface PathCommand {
  command: "moveTo" | "lineTo" | "quadraticCurveTo" | "bezierCurveTo" | "closePath";
  args: number[];
}

type Seg =
  | { kind: "L"; p0: Pt; p1: Pt }
  | { kind: "Q"; p0: Pt; c: Pt; p1: Pt }
  | { kind: "C"; p0: Pt; c1: Pt; c2: Pt; p1: Pt };

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const near = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9;

function startTangent(s: Seg): Pt {
  if (s.kind === "L") return sub(s.p1, s.p0);
  if (s.kind === "Q") return near(s.c, s.p0) ? sub(s.p1, s.p0) : sub(s.c, s.p0);
  if (!near(s.c1, s.p0)) return sub(s.c1, s.p0);
  if (!near(s.c2, s.p0)) return sub(s.c2, s.p0);
  return sub(s.p1, s.p0);
}
function endTangent(s: Seg): Pt {
  if (s.kind === "L") return sub(s.p1, s.p0);
  if (s.kind === "Q") return near(s.c, s.p1) ? sub(s.p1, s.p0) : sub(s.p1, s.c);
  if (!near(s.c2, s.p1)) return sub(s.p1, s.c2);
  if (!near(s.c1, s.p1)) return sub(s.p1, s.c1);
  return sub(s.p1, s.p0);
}

function angleBetween(a: Pt, b: Pt): number {
  const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
  if (la < 1e-12 || lb < 1e-12) return 0;
  const c = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y) / (la * lb)));
  return Math.acos(c);
}

/** Adaptive de Casteljau flattening: max deviation from the true curve <= tol. */
function flattenSeg(s: Seg, tol: number, out: Pt[]) {
  if (s.kind === "L") {
    out.push(s.p1);
    return;
  }
  const c = s.kind === "Q"
    ? { p0: s.p0, c1: { x: s.p0.x + (2 / 3) * (s.c.x - s.p0.x), y: s.p0.y + (2 / 3) * (s.c.y - s.p0.y) }, c2: { x: s.p1.x + (2 / 3) * (s.c.x - s.p1.x), y: s.p1.y + (2 / 3) * (s.c.y - s.p1.y) }, p1: s.p1 }
    : s;
  cubicRec(c.p0, c.c1, c.c2, c.p1, tol, out, 0);
}

function distToLine(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l = Math.hypot(dx, dy);
  if (l < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / l;
}

function cubicRec(p0: Pt, p1: Pt, p2: Pt, p3: Pt, tol: number, out: Pt[], depth: number) {
  // control-polygon flatness bound (curve within 3/4 * max ctrl distance)
  const d = Math.max(distToLine(p1, p0, p3), distToLine(p2, p0, p3));
  if (depth > 18 || d * 0.75 <= tol) {
    out.push(p3);
    return;
  }
  const m = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const p01 = m(p0, p1), p12 = m(p1, p2), p23 = m(p2, p3);
  const p012 = m(p01, p12), p123 = m(p12, p23);
  const mid = m(p012, p123);
  cubicRec(p0, p01, p012, mid, tol, out, depth + 1);
  cubicRec(mid, p123, p23, p3, tol, out, depth + 1);
}

export interface FlattenOptions {
  /** max distance between flattened polyline and true outline, font units */
  tolerance?: number;
  /** tangent discontinuity (deg) that marks an on-curve node as a corner */
  cornerDeg?: number;
  scale?: number;
  dx?: number;
  dy?: number;
}

/**
 * Converts fontkit path commands to a cleaned (overlap-free, canonically oriented)
 * polyline shape with corner flags on true outline corners.
 */
export function commandsToShape(commands: PathCommand[], opts: FlattenOptions = {}): Shape {
  const tol = opts.tolerance ?? 0.01;
  const cornerRad = ((opts.cornerDeg ?? 8) * Math.PI) / 180;
  const sc = opts.scale ?? 1, ox = opts.dx ?? 0, oy = opts.dy ?? 0;
  const P = (x: number, y: number): Pt => ({ x: x * sc + ox, y: y * sc + oy });

  const contours: Seg[][] = [];
  let cur: Seg[] = [];
  let start: Pt | null = null;
  let pen: Pt | null = null;
  const close = () => {
    if (start && pen && !near(pen, start)) cur.push({ kind: "L", p0: pen, p1: start });
    if (cur.length) contours.push(cur);
    cur = [];
    start = pen = null;
  };
  for (const c of commands) {
    const a = c.args;
    switch (c.command) {
      case "moveTo":
        if (cur.length) close();
        start = pen = P(a[0], a[1]);
        break;
      case "lineTo": {
        const p = P(a[0], a[1]);
        if (pen && !near(pen, p)) cur.push({ kind: "L", p0: pen, p1: p });
        pen = p;
        break;
      }
      case "quadraticCurveTo": {
        const p = P(a[2], a[3]);
        if (pen) cur.push({ kind: "Q", p0: pen, c: P(a[0], a[1]), p1: p });
        pen = p;
        break;
      }
      case "bezierCurveTo": {
        const p = P(a[4], a[5]);
        if (pen) cur.push({ kind: "C", p0: pen, c1: P(a[0], a[1]), c2: P(a[2], a[3]), p1: p });
        pen = p;
        break;
      }
      case "closePath":
        close();
        break;
    }
  }
  if (cur.length) close();

  const rings: { pts: Pt[]; corner: boolean[] }[] = [];
  for (const segs of contours) {
    // drop zero-length segments
    const S = segs.filter((s) => !(s.kind === "L" && near(s.p0, s.p1)));
    if (!S.length) continue;
    const pts: Pt[] = [];
    const corner: boolean[] = [];
    for (let i = 0; i < S.length; i++) {
      const prev = S[(i - 1 + S.length) % S.length];
      const s = S[i];
      const isCorner = angleBetween(endTangent(prev), startTangent(s)) > cornerRad;
      pts.push(s.p0);
      corner.push(isCorner);
      const tmp: Pt[] = [];
      flattenSeg(s, tol, tmp);
      tmp.pop(); // end point is the next segment's p0
      for (const p of tmp) {
        pts.push(p);
        corner.push(false);
      }
    }
    if (pts.length >= 3) rings.push({ pts, corner });
  }
  return cleanUnion(rings, "nonzero");
}
