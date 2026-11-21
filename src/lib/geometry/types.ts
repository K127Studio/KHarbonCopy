export interface Pt {
  x: number;
  y: number;
}

/**
 * Closed polyline (last point is NOT repeated).
 * Orientation convention for a cleaned shape: ink is on the LEFT of the travel
 * direction (outer rings CCW / positive area in y-up space, holes CW).
 * Outward normal (pointing away from ink) is therefore (ty, -tx).
 */
export interface Ring {
  pts: Pt[];
  corner: boolean[];
}

export type Shape = Ring[];

export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function shapeArea(shape: Shape): number {
  return shape.reduce((s, r) => s + signedArea(r.pts), 0);
}

export function bboxOf(shape: Shape): BBox {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const r of shape)
    for (const p of r.pts) {
      if (p.x < b.minX) b.minX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y > b.maxY) b.maxY = p.y;
    }
  if (!isFinite(b.minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return b;
}

/** Exact area centroid of a (cleaned) shape via Green's theorem. */
export function centroid(shape: Shape): Pt & { area: number } {
  let A = 0, cx = 0, cy = 0;
  for (const r of shape) {
    const n = r.pts.length;
    for (let i = 0; i < n; i++) {
      const p = r.pts[i];
      const q = r.pts[(i + 1) % n];
      const c = p.x * q.y - q.x * p.y;
      A += c;
      cx += (p.x + q.x) * c;
      cy += (p.y + q.y) * c;
    }
  }
  A /= 2;
  if (Math.abs(A) < 1e-12) return { x: 0, y: 0, area: 0 };
  return { x: cx / (6 * A), y: cy / (6 * A), area: A };
}

export function mapShape(shape: Shape, f: (p: Pt) => Pt): Shape {
  return shape.map((r) => ({ pts: r.pts.map(f), corner: r.corner.slice() }));
}

export function cloneShape(shape: Shape): Shape {
  return shape.map((r) => ({ pts: r.pts.map((p) => ({ x: p.x, y: p.y })), corner: r.corner.slice() }));
}

export function shapeToSvgPath(shape: Shape, digits = 2): string {
  let d = "";
  for (const r of shape) {
    if (!r.pts.length) continue;
    d += "M" + r.pts.map((p) => `${p.x.toFixed(digits)} ${p.y.toFixed(digits)}`).join("L") + "Z";
  }
  return d;
}

/** Compact transport format (worker → UI): Float32 xy arrays per ring. */
export type PackedShape = Float32Array[];

export function packShape(shape: Shape): PackedShape {
  return shape.map((r) => {
    const a = new Float32Array(r.pts.length * 2);
    r.pts.forEach((p, i) => {
      a[2 * i] = p.x;
      a[2 * i + 1] = p.y;
    });
    return a;
  });
}
