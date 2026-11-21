import ClipperLib from "clipper-lib";
import { Pt, Ring, Shape, signedArea } from "./types";

/** Clipper works on integers: 1 font unit = SCALE integer steps (1/1024 unit precision). */
export const SCALE = 1024;

type Path = { X: number; Y: number }[];

const toPath = (pts: Pt[]): Path => pts.map((p) => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.y * SCALE) }));
const fromPath = (path: Path): Pt[] => path.map((p) => ({ x: p.X / SCALE, y: p.Y / SCALE }));

export type FillRule = "nonzero" | "positive" | "evenodd";

function fillType(rule: FillRule) {
  return rule === "nonzero"
    ? ClipperLib.PolyFillType.pftNonZero
    : rule === "positive"
      ? ClipperLib.PolyFillType.pftPositive
      : ClipperLib.PolyFillType.pftEvenOdd;
}

function execute(subject: Pt[][], clip: Pt[][] | null, op: number, rule: FillRule): Pt[][] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(subject.filter((p) => p.length >= 3).map(toPath), ClipperLib.PolyType.ptSubject, true);
  if (clip) c.AddPaths(clip.filter((p) => p.length >= 3).map(toPath), ClipperLib.PolyType.ptClip, true);
  const out: Path[] = [];
  c.Execute(op, out, fillType(rule), fillType(rule));
  return out.map(fromPath);
}

/**
 * Union a set of closed point lists and return rings with the canonical orientation
 * (outer positive area, holes negative). Corner flags are restored for vertices that
 * coincide with original corner vertices (exact integer match) and for new junction
 * vertices whose turning angle exceeds `junctionDeg`.
 */
export function cleanUnion(
  rings: { pts: Pt[]; corner?: boolean[] }[],
  rule: FillRule = "nonzero",
  opts: { minArea?: number; junctionDeg?: number } = {},
): Shape {
  const cornerKeys = new Set<string>();
  const allKeys = new Set<string>();
  for (const r of rings)
    r.pts.forEach((p, i) => {
      const k = `${Math.round(p.x * SCALE)},${Math.round(p.y * SCALE)}`;
      allKeys.add(k);
      if (r.corner?.[i]) cornerKeys.add(k);
    });
  const res = execute(
    rings.map((r) => r.pts),
    null,
    ClipperLib.ClipType.ctUnion,
    rule,
  );
  const minArea = opts.minArea ?? 0.25;
  const jcos = Math.cos(((opts.junctionDeg ?? 30) * Math.PI) / 180);
  const out: Shape = [];
  for (const pts of res) {
    if (Math.abs(signedArea(pts)) < minArea) continue;
    const n = pts.length;
    const corner = pts.map((p, i) => {
      const k = `${Math.round(p.x * SCALE)},${Math.round(p.y * SCALE)}`;
      if (cornerKeys.has(k)) return true;
      if (allKeys.has(k)) return false; // an original smooth vertex
      // vertex created by the boolean op (overlap junction): corner if it turns sharply
      const a = pts[(i - 1 + n) % n];
      const b = pts[(i + 1) % n];
      const ux = p.x - a.x, uy = p.y - a.y, vx = b.x - p.x, vy = b.y - p.y;
      const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
      if (lu < 1e-9 || lv < 1e-9) return false;
      return (ux * vx + uy * vy) / (lu * lv) < jcos;
    });
    out.push({ pts, corner });
  }
  // Clipper returns outers with positive orientation in its integer space (y-up math) –
  // enforce explicitly: the largest |area| ring must be positive.
  if (out.length) {
    let big = out[0];
    for (const r of out) if (Math.abs(signedArea(r.pts)) > Math.abs(signedArea(big.pts))) big = r;
    if (signedArea(big.pts) < 0)
      for (const r of out) {
        r.pts.reverse();
        r.corner.reverse();
      }
  }
  return out;
}

export function areaOf(rings: Pt[][]): number {
  return rings.reduce((s, r) => s + signedArea(r), 0);
}

export function intersectionArea(a: Shape, b: Shape): number {
  return areaOf(execute(a.map((r) => r.pts), b.map((r) => r.pts), ClipperLib.ClipType.ctIntersection, "nonzero"));
}

export function unionArea(a: Shape, b: Shape): number {
  return areaOf(execute(a.map((r) => r.pts), b.map((r) => r.pts), ClipperLib.ClipType.ctUnion, "nonzero"));
}

/** Intersection-over-union of two cleaned shapes (1 = identical ink). */
export function iou(a: Shape, b: Shape): number {
  const u = unionArea(a, b);
  return u > 0 ? intersectionArea(a, b) / u : 1;
}

export function ringsOf(shape: Shape): Ring[] {
  return shape;
}
