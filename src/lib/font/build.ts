import { TTPoint } from "../geometry/fit";
import { clampI16, setI16, setU16, setU32, u16, u32, Writer } from "./binary";
import { encodeSimpleGlyph } from "./glyf";
import { AnchorMap, patchGPOS } from "./gpos";
import { buildNameTable, FontNames, readNames, rawTables, writeSfnt } from "./sfnt";

export interface BuiltGlyph {
  contours: TTPoint[][]; // font units
  adv: number; // font units
}

export interface BuildOptions {
  names: FontNames;
  italicAngle: number; // degrees, negative = leaning right
  weightClass: number;
  italic: boolean;
  bold: boolean;
  sx: number;
  anchorMap: AnchorMap;
  /** VariationIndex → delta at the chosen instance (variable sources) */
  delta?: (outer: number, inner: number) => number;
}

const DROP = new Set([
  "CFF ", "CFF2", "VORG", "gvar", "fvar", "avar", "cvar", "HVAR", "MVAR", "VVAR", "STAT", "hdmx", "LTSH", "VDMX",
  "fpgm", "prep", "cvt ", "DSIG", "vhea", "vmtx", "glyf", "loca", "hmtx", "maxp", "name", "kern", "BASE", "JSTF",
]);

export function buildFont(base: any, glyphs: BuiltGlyph[], o: BuildOptions): { ttf: Uint8Array; report: string[] } {
  const report: string[] = [];
  const src = rawTables(base);
  const out = new Map<string, Uint8Array>();
  for (const [tag, data] of src) if (!DROP.has(tag)) out.set(tag, data);
  const dropped = [...src.keys()].filter((t) => DROP.has(t) && !["glyf", "loca", "hmtx", "maxp", "name"].includes(t));
  if (dropped.length) report.push(`tables dropped (no longer valid after the transformation): ${dropped.join(", ")}`);

  // glyf + loca
  const glyf = new Writer();
  const loca = new Writer();
  let maxPoints = 0, maxContours = 0;
  let xMin = 32767, yMin = 32767, xMax = -32768, yMax = -32768;
  const metrics: { adv: number; lsb: number; xMax: number }[] = [];
  for (const g of glyphs) {
    loca.u32(glyf.pos);
    const e = encodeSimpleGlyph(g.contours);
    glyf.bytes(e.data);
    maxPoints = Math.max(maxPoints, e.points);
    maxContours = Math.max(maxContours, e.contours);
    if (e.contours) {
      xMin = Math.min(xMin, e.xMin); yMin = Math.min(yMin, e.yMin);
      xMax = Math.max(xMax, e.xMax); yMax = Math.max(yMax, e.yMax);
    }
    metrics.push({ adv: Math.max(0, Math.round(g.adv)), lsb: e.contours ? e.xMin : 0, xMax: e.contours ? e.xMax : 0 });
  }
  loca.u32(glyf.pos);
  out.set("glyf", glyf.done());
  out.set("loca", loca.done());

  // hmtx (full, numberOfHMetrics = numGlyphs)
  const hmtx = new Writer();
  for (const m of metrics) { hmtx.u16(Math.min(65535, m.adv)); hmtx.i16(clampI16(m.lsb)); }
  out.set("hmtx", hmtx.done());

  // maxp 1.0
  const maxp = new Writer();
  maxp.u32(0x00010000);
  maxp.u16(glyphs.length);
  maxp.u16(maxPoints); maxp.u16(maxContours);
  maxp.u16(0); maxp.u16(0); // composite
  maxp.u16(2); maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0);
  maxp.u16(0); maxp.u16(0);
  out.set("maxp", maxp.done());

  // head
  const head = src.get("head")!.slice();
  const ver = parseFloat(o.names.version) || 1;
  setU32(head, 4, Math.round(ver * 65536));
  setU32(head, 8, 0);
  const now = BigInt(Math.floor(Date.now() / 1000) + 2082844800);
  setU32(head, 28, Number(now >> 32n));
  setU32(head, 32, Number(now & 0xffffffffn));
  setI16(head, 36, xMin); setI16(head, 38, yMin); setI16(head, 40, xMax); setI16(head, 42, yMax);
  setU16(head, 44, (o.bold ? 1 : 0) | (o.italic ? 2 : 0));
  setI16(head, 50, 1);
  setI16(head, 52, 0);
  out.set("head", head);

  // hhea
  const hhea = src.get("hhea")!.slice();
  let advMax = 0, minL = 32767, minR = 32767, xMaxExt = -32768;
  for (const m of metrics) {
    advMax = Math.max(advMax, m.adv);
    if (m.xMax !== 0 || m.lsb !== 0) {
      minL = Math.min(minL, m.lsb);
      minR = Math.min(minR, m.adv - m.xMax);
      xMaxExt = Math.max(xMaxExt, m.xMax);
    }
  }
  setU16(hhea, 10, advMax);
  setI16(hhea, 12, minL === 32767 ? 0 : minL);
  setI16(hhea, 14, minR === 32767 ? 0 : minR);
  setI16(hhea, 16, xMaxExt === -32768 ? 0 : xMaxExt);
  const slope = Math.tan((-o.italicAngle * Math.PI) / 180);
  if (Math.abs(slope) > 1e-6) {
    setI16(hhea, 18, 1000);
    setI16(hhea, 20, Math.round(slope * 1000));
  } else { setI16(hhea, 18, 1); setI16(hhea, 20, 0); }
  setU16(hhea, 34, glyphs.length);
  out.set("hhea", hhea);

  // post
  let post = src.get("post");
  if (!post) {
    const w = new Writer();
    w.u32(0x00030000); w.i32(0); w.i16(-100); w.i16(50); w.u32(0); w.u32(0); w.u32(0); w.u32(0); w.u32(0);
    post = w.done();
  } else post = post.slice();
  const ia = Math.round(o.italicAngle * 65536);
  setU32(post, 4, ia < 0 ? ia + 0x100000000 : ia);
  out.set("post", post);

  // OS/2
  const os2 = src.get("OS/2")?.slice();
  if (os2) {
    const advs = metrics.map((m) => m.adv).filter((a) => a > 0);
    setI16(os2, 2, Math.round(advs.reduce((s, a) => s + a, 0) / (advs.length || 1)));
    setU16(os2, 4, Math.max(1, Math.min(1000, Math.round(o.weightClass))));
    for (let i = 0; i < 4; i++) os2[58 + i] = (o.names.vendorID.padEnd(4, " ").charCodeAt(i) || 32) & 0x7f;
    let fs = u16(os2, 62) & ~(1 | 32 | 64);
    if (o.italic) fs |= 1;
    if (o.bold) fs |= 32;
    if (!o.italic && !o.bold) fs |= 64;
    setU16(os2, 62, fs);
    out.set("OS/2", os2);
  }

  // name (keep original copyright alongside, OFL §)
  out.set("name", buildNameTable(o.names));

  // GPOS
  const gpos = src.get("GPOS");
  if (gpos) {
    const r = patchGPOS(gpos, o.anchorMap, o.sx, o.delta);
    out.set("GPOS", r.data);
    report.push(`GPOS: ${r.anchors} anchors transformed${r.shared ? `, ${r.shared} shared` : ""}`);
  }
  // GDEF: drop the variation store reference (fvar is gone) – keep table otherwise intact
  const gdef = out.get("GDEF");
  if (gdef && u32(gdef, 0) === 0x00010003 && gdef.length >= 18) {
    const g = gdef.slice();
    setU32(g, 14, 0);
    out.set("GDEF", g);
  }
  void u16;
  return { ttf: writeSfnt(out), report };
}

export function originalNames(base: any): Record<number, string> {
  return readNames(rawTables(base).get("name"));
}
