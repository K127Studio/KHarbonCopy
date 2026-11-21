import { TTPoint } from "../geometry/fit";
import { Writer, clampI16 } from "./binary";

export interface EncodedGlyph {
  data: Uint8Array;
  xMin: number; yMin: number; xMax: number; yMax: number;
  points: number;
  contours: number;
}

/** Encode a simple TrueType glyph (no instructions) with compressed flags/coordinates. */
export function encodeSimpleGlyph(contours: TTPoint[][]): EncodedGlyph {
  const cs = contours
    .map((c) => c.map((p) => ({ x: clampI16(p.x), y: clampI16(p.y), on: p.on })))
    .map(dropDuplicates)
    .filter((c) => c.length >= 2);
  if (!cs.length) return { data: new Uint8Array(0), xMin: 0, yMin: 0, xMax: 0, yMax: 0, points: 0, contours: 0 };
  let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
  for (const c of cs) for (const p of c) {
    xMin = Math.min(xMin, p.x); yMin = Math.min(yMin, p.y);
    xMax = Math.max(xMax, p.x); yMax = Math.max(yMax, p.y);
  }
  const w = new Writer();
  w.i16(cs.length);
  w.i16(xMin); w.i16(yMin); w.i16(xMax); w.i16(yMax);
  let end = -1;
  for (const c of cs) { end += c.length; w.u16(end); }
  w.u16(0); // instructionLength
  const pts = cs.flat();
  const flags: number[] = [];
  const xs: { v: number; size: 0 | 1 | 2 }[] = [];
  const ys: { v: number; size: 0 | 1 | 2 }[] = [];
  let px = 0, py = 0;
  for (const p of pts) {
    let f = p.on ? 0x01 : 0;
    const dx = p.x - px, dy = p.y - py;
    if (dx === 0) { f |= 0x10; xs.push({ v: 0, size: 0 }); }
    else if (Math.abs(dx) <= 255) { f |= 0x02 | (dx > 0 ? 0x10 : 0); xs.push({ v: Math.abs(dx), size: 1 }); }
    else xs.push({ v: dx, size: 2 });
    if (dy === 0) { f |= 0x20; ys.push({ v: 0, size: 0 }); }
    else if (Math.abs(dy) <= 255) { f |= 0x04 | (dy > 0 ? 0x20 : 0); ys.push({ v: Math.abs(dy), size: 1 }); }
    else ys.push({ v: dy, size: 2 });
    flags.push(f);
    px = p.x; py = p.y;
  }
  // flags with repeat compression
  for (let i = 0; i < flags.length; ) {
    let r = 0;
    while (i + r + 1 < flags.length && flags[i + r + 1] === flags[i] && r < 255) r++;
    if (r > 0) { w.u8(flags[i] | 0x08); w.u8(r); i += r + 1; }
    else { w.u8(flags[i]); i++; }
  }
  for (const x of xs) if (x.size === 1) w.u8(x.v); else if (x.size === 2) w.i16(x.v);
  for (const y of ys) if (y.size === 1) w.u8(y.v); else if (y.size === 2) w.i16(y.v);
  w.pad4();
  return { data: w.done(), xMin, yMin, xMax, yMax, points: pts.length, contours: cs.length };
}

function dropDuplicates(c: { x: number; y: number; on: boolean }[]) {
  const out: typeof c = [];
  for (const p of c) {
    const q = out[out.length - 1];
    if (q && q.x === p.x && q.y === p.y) {
      if (p.on) q.on = true;
      continue;
    }
    out.push({ ...p });
  }
  while (out.length > 1 && out[0].x === out[out.length - 1].x && out[0].y === out[out.length - 1].y) {
    const last = out.pop()!;
    if (last.on) out[0].on = true;
  }
  return out;
}
