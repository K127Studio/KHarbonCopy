// Timing benchmark of a full analysis with the given options (JSON in argv[4]).
import { readFileSync } from "node:fs";
import { openFont } from "../src/lib/font/load";
import { analyze } from "../src/lib/analysis/pipeline";
import { DEFAULT_OPTIONS } from "../src/lib/analysis/model";
const [a, b, json] = process.argv.slice(2);
const src = openFont(new Uint8Array(readFileSync(a))), ref = openFont(new Uint8Array(readFileSync(b)));
const opts = { ...DEFAULT_OPTIONS, ...(json ? JSON.parse(json) : {}) };
const t0 = Date.now();
const { model, glyphs } = analyze({ src, ref, refMeta: { id: "", name: "", file: "", coords: {} }, category: "sans-serif", options: opts, progress: () => {} });
console.log(`TOTAL ${((Date.now() - t0) / 1000).toFixed(1)} s · glyphs ${glyphs.length} · samples/glyph ${Math.round(glyphs.reduce((s, g) => s + g.rings.reduce((q, r) => q + r.s.length, 0), 0) / glyphs.length)}`);
for (const r of model.refinement.slice(-3)) console.log(r.iter, r.meanAbs.toFixed(3), r.coverage?.toFixed?.(4), r.note);
console.log("per-glyph passes", glyphs.map((g) => g.refineSteps.length - 1).join(","));
