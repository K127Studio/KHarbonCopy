import * as fontkit from "fontkit";
import { commandsToShape, PathCommand } from "../geometry/flatten";
import { Shape } from "../geometry/types";

/** All analysis happens in a normalised 1000-unit em. */
export const EM = 1000;

export interface FontHandle {
  base: any; // default fontkit font
  font: any; // current instance (variation applied)
  upm: number;
  scale: number; // EM / upm
  axes: Record<string, { name: string; min: number; default: number; max: number }>;
  coords: Record<string, number>;
  family: string;
  subfamily: string;
}

export function openFont(bytes: Uint8Array): FontHandle {
  let f = fontkit.create(bytes);
  if (f.fonts) f = f.fonts[0]; // collections: first face
  const axes = f.variationAxes ?? {};
  const coords: Record<string, number> = {};
  for (const k of Object.keys(axes)) coords[k] = axes[k].default;
  return {
    base: f,
    font: f,
    upm: f.unitsPerEm,
    scale: EM / f.unitsPerEm,
    axes,
    coords,
    family: f.familyName ?? "Untitled",
    subfamily: f.subfamilyName ?? "Regular",
  };
}

export function setVariation(h: FontHandle, coords: Record<string, number>): FontHandle {
  if (!Object.keys(h.axes).length) return h;
  const c = { ...h.coords, ...coords };
  return { ...h, coords: c, font: h.base.getVariation(c) };
}

export const isVariable = (h: FontHandle) => Object.keys(h.axes).length > 0;

const shapeCache = new WeakMap<any, Map<number, Shape>>();

/** Cleaned polyline shape of a glyph in the normalised em (y up, origin at glyph origin). */
export function glyphShape(h: FontHandle, gid: number, tolerance = 0.01): Shape {
  let cache = shapeCache.get(h.font);
  if (!cache) shapeCache.set(h.font, (cache = new Map()));
  const hit = cache.get(gid);
  if (hit) return hit;
  let cmds: PathCommand[] = [];
  try {
    cmds = h.font.getGlyph(gid).path.commands as PathCommand[];
  } catch {
    cmds = [];
  }
  const s = commandsToShape(cmds, { scale: h.scale, tolerance });
  cache.set(gid, s);
  return s;
}

export function glyphIdForChar(h: FontHandle, ch: string): number {
  const cp = ch.codePointAt(0)!;
  if (!h.font.hasGlyphForCodePoint(cp)) return 0;
  return h.font.glyphForCodePoint(cp).id;
}

export function advanceOf(h: FontHandle, gid: number): number {
  try {
    return h.font.getGlyph(gid).advanceWidth * h.scale;
  } catch {
    return 0;
  }
}

export function glyphName(h: FontHandle, gid: number): string {
  try {
    return h.font.getGlyph(gid).name ?? `gid${gid}`;
  } catch {
    return `gid${gid}`;
  }
}
