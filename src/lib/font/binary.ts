/** Big-endian binary writer with growable buffer. */
export class Writer {
  buf = new Uint8Array(1024);
  view = new DataView(this.buf.buffer);
  pos = 0;
  private ensure(n: number) {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf);
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u8(v: number) { this.ensure(1); this.view.setUint8(this.pos, v); this.pos += 1; }
  i8(v: number) { this.ensure(1); this.view.setInt8(this.pos, v); this.pos += 1; }
  u16(v: number) { this.ensure(2); this.view.setUint16(this.pos, v); this.pos += 2; }
  i16(v: number) { this.ensure(2); this.view.setInt16(this.pos, v); this.pos += 2; }
  u32(v: number) { this.ensure(4); this.view.setUint32(this.pos, v >>> 0); this.pos += 4; }
  i32(v: number) { this.ensure(4); this.view.setInt32(this.pos, v); this.pos += 4; }
  bytes(b: Uint8Array) { this.ensure(b.length); this.buf.set(b, this.pos); this.pos += b.length; }
  pad4() { while (this.pos % 4) this.u8(0); }
  done(): Uint8Array { return this.buf.slice(0, this.pos); }
}

export function u16(b: Uint8Array, o: number) { return (b[o] << 8) | b[o + 1]; }
export function i16(b: Uint8Array, o: number) { const v = u16(b, o); return v & 0x8000 ? v - 0x10000 : v; }
export function u32(b: Uint8Array, o: number) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
export function setU16(b: Uint8Array, o: number, v: number) { b[o] = (v >> 8) & 0xff; b[o + 1] = v & 0xff; }
export function setI16(b: Uint8Array, o: number, v: number) { setU16(b, o, v < 0 ? v + 0x10000 : v); }
export function setU32(b: Uint8Array, o: number, v: number) {
  b[o] = (v >>> 24) & 0xff; b[o + 1] = (v >>> 16) & 0xff; b[o + 2] = (v >>> 8) & 0xff; b[o + 3] = v & 0xff;
}

export function checksum(b: Uint8Array): number {
  let sum = 0;
  const n = Math.ceil(b.length / 4) * 4;
  for (let i = 0; i < n; i += 4) {
    const v = ((b[i] ?? 0) << 24) | ((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0);
    sum = (sum + (v >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

export const clampI16 = (v: number) => Math.max(-32768, Math.min(32767, Math.round(v)));
