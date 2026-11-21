import { i16, setI16, setU16, u16, u32 } from "./binary";

/** Maps an anchor (glyph id, x, y) to its new position. */
export type AnchorMap = (gid: number, x: number, y: number) => { x: number; y: number };

function coverage(b: Uint8Array, off: number): number[] {
  const fmt = u16(b, off);
  const out: number[] = [];
  if (fmt === 1) {
    const n = u16(b, off + 2);
    for (let i = 0; i < n; i++) out.push(u16(b, off + 4 + 2 * i));
  } else if (fmt === 2) {
    const n = u16(b, off + 2);
    for (let i = 0; i < n; i++) {
      const r = off + 4 + 6 * i;
      const s = u16(b, r), e = u16(b, r + 2), start = u16(b, r + 4);
      for (let g = s; g <= e; g++) out[start + g - s] = g;
    }
  }
  return out;
}

function valueRecordSize(fmt: number) {
  let n = 0;
  for (let i = 0; i < 8; i++) if (fmt & (1 << i)) n++;
  return n * 2;
}

/**
 * Rewrites GPOS in place (on a copy): every Anchor table is moved through `map`
 * (anchor-point format 2 is downgraded to format 1, since contour point indices change),
 * and horizontal ValueRecord fields are scaled by `sx`.
 * Shared anchor tables are transformed once (first owner wins).
 */
export function patchGPOS(
  src: Uint8Array,
  map: AnchorMap,
  sx: number,
  /** variable-font delta for a VariationIndex (outer, inner) at the chosen instance */
  delta?: (outer: number, inner: number) => number,
): { data: Uint8Array; anchors: number; shared: number } {
  const b = src.slice();
  const done = new Set<number>();
  let anchors = 0, shared = 0;
  const anchor = (off: number, gid: number) => {
    if (!off) return;
    if (done.has(off)) { shared++; return; }
    done.add(off);
    const fmt = u16(b, off);
    if (fmt < 1 || fmt > 3) return;
    let x = i16(b, off + 2), y = i16(b, off + 4);
    if (fmt === 3) {
      x += varDelta(off, u16(b, off + 6));
      y += varDelta(off, u16(b, off + 8));
    }
    const p = map(gid, x, y);
    setI16(b, off + 2, Math.round(p.x));
    setI16(b, off + 4, Math.round(p.y));
    // format 2 contour-point and format 3 device data no longer apply: downgrade to format 1
    if (fmt !== 1) setU16(b, off, 1);
    anchors++;
  };
  /** VariationIndex device table → delta at the instance (0 for classic device tables). */
  function varDelta(base: number, devOff: number): number {
    if (!devOff || !delta) return 0;
    const D = base + devOff;
    if (u16(b, D + 4) !== 0x8000) return 0;
    return delta(u16(b, D), u16(b, D + 2));
  }
  const scaleValue = (off: number, fmt: number, base: number) => {
    // field offsets inside the record
    const pos: Record<number, number> = {};
    let o = off;
    for (let bit = 0; bit < 8; bit++) if (fmt & (1 << bit)) { pos[bit] = o; o += 2; }
    for (const [bit, dev] of [[0, 4], [1, 5], [2, 6], [3, 7]] as const) {
      if (pos[bit] == null) continue;
      let v = i16(b, pos[bit]);
      if (pos[dev] != null) { v += varDelta(base, u16(b, pos[dev])); setU16(b, pos[dev], 0); }
      if (bit === 0 || bit === 2) v *= sx;
      setI16(b, pos[bit], Math.round(v));
    }
  };
  const doneValues = new Set<number>();

  const lookupList = u16(b, 8);
  if (!lookupList) return { data: b, anchors, shared };
  const LL = lookupList;
  const nLookups = u16(b, LL);
  for (let li = 0; li < nLookups; li++) {
    const L = LL + u16(b, LL + 2 + 2 * li);
    let type = u16(b, L);
    const nSub = u16(b, L + 4);
    for (let si = 0; si < nSub; si++) {
      let S = L + u16(b, L + 6 + 2 * si);
      if (type === 9) {
        const extType = u16(b, S + 2);
        S = S + u32(b, S + 4);
        processSubtable(extType, S);
      } else processSubtable(type, S);
    }
    void type;
  }

  function processSubtable(type: number, S: number) {
    const fmt = u16(b, S);
    if (type === 1) {
      if (doneValues.has(S)) return;
      doneValues.add(S);
      const vf = u16(b, S + 4);
      if (fmt === 1) scaleValue(S + 6, vf, S);
      else if (fmt === 2) {
        const n = u16(b, S + 6), sz = valueRecordSize(vf);
        for (let i = 0; i < n; i++) scaleValue(S + 8 + i * sz, vf, S);
      }
    } else if (type === 2) {
      if (doneValues.has(S)) return;
      doneValues.add(S);
      const vf1 = u16(b, S + 4), vf2 = u16(b, S + 6);
      const s1 = valueRecordSize(vf1), s2 = valueRecordSize(vf2);
      if (fmt === 1) {
        const nSets = u16(b, S + 8);
        for (let i = 0; i < nSets; i++) {
          const P = S + u16(b, S + 10 + 2 * i);
          const n = u16(b, P);
          for (let j = 0; j < n; j++) {
            const r = P + 2 + j * (2 + s1 + s2);
            scaleValue(r + 2, vf1, S);
            scaleValue(r + 2 + s1, vf2, S);
          }
        }
      } else if (fmt === 2) {
        const c1 = u16(b, S + 12), c2 = u16(b, S + 14);
        for (let i = 0; i < c1; i++)
          for (let j = 0; j < c2; j++) {
            const r = S + 16 + (i * c2 + j) * (s1 + s2);
            scaleValue(r, vf1, S);
            scaleValue(r + s1, vf2, S);
          }
      }
    } else if (type === 3) {
      const cov = coverage(b, S + u16(b, S + 2));
      const n = u16(b, S + 4);
      for (let i = 0; i < n; i++) {
        const e = u16(b, S + 6 + 4 * i), x = u16(b, S + 8 + 4 * i);
        if (e) anchor(S + e, cov[i]);
        if (x) anchor(S + x, cov[i]);
      }
    } else if (type === 4 || type === 6) {
      const markCov = coverage(b, S + u16(b, S + 2));
      const baseCov = coverage(b, S + u16(b, S + 4));
      const classCount = u16(b, S + 6);
      const MA = S + u16(b, S + 8);
      const BA = S + u16(b, S + 10);
      const nm = u16(b, MA);
      for (let i = 0; i < nm; i++) {
        const ao = u16(b, MA + 2 + 4 * i + 2);
        if (ao) anchor(MA + ao, markCov[i]);
      }
      const nb = u16(b, BA);
      for (let i = 0; i < nb; i++)
        for (let c = 0; c < classCount; c++) {
          const ao = u16(b, BA + 2 + (i * classCount + c) * 2);
          if (ao) anchor(BA + ao, baseCov[i]);
        }
    } else if (type === 5) {
      const markCov = coverage(b, S + u16(b, S + 2));
      const ligCov = coverage(b, S + u16(b, S + 4));
      const classCount = u16(b, S + 6);
      const MA = S + u16(b, S + 8);
      const LA = S + u16(b, S + 10);
      const nm = u16(b, MA);
      for (let i = 0; i < nm; i++) {
        const ao = u16(b, MA + 2 + 4 * i + 2);
        if (ao) anchor(MA + ao, markCov[i]);
      }
      const nl = u16(b, LA);
      for (let i = 0; i < nl; i++) {
        const AT = LA + u16(b, LA + 2 + 2 * i);
        const comps = u16(b, AT);
        for (let k = 0; k < comps; k++)
          for (let c = 0; c < classCount; c++) {
            const ao = u16(b, AT + 2 + (k * classCount + c) * 2);
            if (ao) anchor(AT + ao, ligCov[i]);
          }
      }
    }
    // types 7/8 (context) reference other lookups; nothing to patch directly
  }
  return { data: b, anchors, shared };
}
