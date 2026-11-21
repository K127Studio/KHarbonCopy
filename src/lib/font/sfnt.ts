import { Writer, checksum, setU32, u16, u32 } from "./binary";

/** Raw (decompressed, untransformed) table bytes of a fontkit font. */
export function rawTables(font: any): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>();
  if (typeof font._decompress === "function") font._decompress();
  const tables = font.directory?.tables ?? {};
  for (const tag of Object.keys(tables)) {
    const t = tables[tag];
    // WOFF2 transformed glyf/loca/hmtx are rebuilt by the writer anyway
    if (t.transformed || (t.transformVersion != null && t.transformVersion !== 0 && (tag === "glyf" || tag === "loca")))
      continue;
    const stream = font._getTableStream(tag);
    if (!stream) continue;
    const start = stream.pos;
    const len = t.length ?? t.origLength;
    const buf: Uint8Array = stream.buffer;
    out.set(tag, new Uint8Array(buf.buffer, buf.byteOffset + start, len).slice());
  }
  return out;
}

/** Serialise an sfnt (TrueType outlines) with correct checksums & head.checkSumAdjustment. */
export function writeSfnt(tables: Map<string, Uint8Array>): Uint8Array {
  const tags = [...tables.keys()].sort();
  const num = tags.length;
  let es = 0;
  while (1 << (es + 1) <= num) es++;
  const searchRange = (1 << es) * 16;
  const w = new Writer();
  w.u32(0x00010000);
  w.u16(num);
  w.u16(searchRange);
  w.u16(es);
  w.u16(num * 16 - searchRange);
  let offset = 12 + num * 16;
  const records: { tag: string; off: number; data: Uint8Array }[] = [];
  for (const tag of tags) {
    const data = tables.get(tag)!;
    if (tag === "head") setU32(data, 8, 0);
    records.push({ tag, off: offset, data });
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const r of records) {
    for (let i = 0; i < 4; i++) w.u8(r.tag.charCodeAt(i));
    w.u32(checksum(r.data));
    w.u32(r.off);
    w.u32(r.data.length);
  }
  for (const r of records) {
    w.bytes(r.data);
    w.pad4();
  }
  const out = w.done();
  const head = records.find((r) => r.tag === "head");
  if (head) {
    const adj = (0xb1b0afba - checksum(out)) >>> 0;
    setU32(out, head.off + 8, adj);
  }
  return out;
}

/** WOFF 1.0 wrapper (zlib per table via CompressionStream). */
export async function toWoff(ttf: Uint8Array): Promise<Uint8Array> {
  const num = u16(ttf, 4);
  const entries: { tag: string; data: Uint8Array; comp: Uint8Array; cs: number }[] = [];
  for (let i = 0; i < num; i++) {
    const r = 12 + i * 16;
    const tag = String.fromCharCode(ttf[r], ttf[r + 1], ttf[r + 2], ttf[r + 3]);
    const cs = u32(ttf, r + 4), off = u32(ttf, r + 8), len = u32(ttf, r + 12);
    const data = ttf.slice(off, off + len);
    const comp = await deflate(data);
    entries.push({ tag, data, comp: comp.length < data.length ? comp : data, cs });
  }
  const w = new Writer();
  const headerLen = 44 + num * 20;
  let offset = headerLen;
  const offs: number[] = [];
  for (const e of entries) {
    offs.push(offset);
    offset += Math.ceil(e.comp.length / 4) * 4;
  }
  w.u32(0x774f4646); // 'wOFF'
  w.u32(0x00010000);
  w.u32(offset);
  w.u16(num);
  w.u16(0);
  w.u32(ttf.length);
  w.u16(1); w.u16(0); // version
  w.u32(0); w.u32(0); w.u32(0); // meta
  w.u32(0); w.u32(0); // priv
  entries.forEach((e, i) => {
    for (let k = 0; k < 4; k++) w.u8(e.tag.charCodeAt(k));
    w.u32(offs[i]);
    w.u32(e.comp.length);
    w.u32(e.data.length);
    w.u32(e.cs);
  });
  for (const e of entries) { w.bytes(e.comp); w.pad4(); }
  return w.done();
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

// ------------------------------------------------------------------ name table

export interface FontNames {
  family: string;
  style: string;
  designer: string;
  designerURL: string;
  manufacturer: string;
  vendorURL: string;
  copyright: string;
  license: string;
  licenseURL: string;
  version: string;
  description: string;
  trademark: string;
  vendorID: string;
}

const RIBBI = ["Regular", "Bold", "Italic", "Bold Italic"];

export function postscriptName(family: string, style: string) {
  const clean = (s: string) => s.replace(/[^A-Za-z0-9]/g, "");
  return `${clean(family) || "Untitled"}-${clean(style) || "Regular"}`.slice(0, 63);
}

export function buildNameTable(n: FontNames): Uint8Array {
  const ribbi = RIBBI.includes(n.style);
  const fam1 = ribbi ? n.family : `${n.family} ${n.style}`;
  const sub2 = ribbi ? n.style : "Regular";
  const version = /^\d+(\.\d+)?$/.test(n.version) ? `Version ${Number(n.version).toFixed(3)}` : n.version || "Version 1.000";
  const ps = postscriptName(n.family, n.style);
  const records: [number, string][] = [
    [0, n.copyright],
    [1, fam1],
    [2, sub2],
    [3, `${version.replace(/^Version /, "")};${n.vendorID || "NONE"};${ps}`],
    [4, `${n.family} ${n.style}`.replace(/ Regular$/, "") || n.family],
    [5, version],
    [6, ps],
    [7, n.trademark],
    [8, n.manufacturer],
    [9, n.designer],
    [10, n.description],
    [11, n.vendorURL],
    [12, n.designerURL],
    [13, n.license],
    [14, n.licenseURL],
  ];
  if (!ribbi) records.push([16, n.family], [17, n.style]);
  const list = records.filter(([, s]) => s && s.trim().length).sort((a, b) => a[0] - b[0]);
  const strings: Uint8Array[] = list.map(([, s]) => utf16be(s));
  const w = new Writer();
  w.u16(0);
  w.u16(list.length);
  w.u16(6 + list.length * 12);
  let off = 0;
  list.forEach(([id], i) => {
    w.u16(3); w.u16(1); w.u16(0x409); w.u16(id);
    w.u16(strings[i].length); w.u16(off);
    off += strings[i].length;
  });
  for (const s of strings) w.bytes(s);
  return w.done();
}

function utf16be(s: string): Uint8Array {
  const out = new Uint8Array(s.length * 2);
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out[2 * i] = c >> 8;
    out[2 * i + 1] = c & 0xff;
  }
  return out;
}

/** Read existing name records (platform 3, English) of a raw name table. */
export function readNames(name: Uint8Array | undefined): Record<number, string> {
  const out: Record<number, string> = {};
  if (!name) return out;
  const count = u16(name, 2), strOff = u16(name, 4);
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    const pid = u16(name, r), lang = u16(name, r + 4), id = u16(name, r + 6);
    const len = u16(name, r + 8), off = u16(name, r + 10);
    if (pid !== 3 || (lang & 0xff) !== 0x09) continue;
    let s = "";
    for (let k = 0; k < len; k += 2) s += String.fromCharCode(u16(name, strOff + off + k));
    if (!(id in out)) out[id] = s;
  }
  return out;
}
