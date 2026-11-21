import { readFileSync } from "node:fs";
import { openFont } from "../src/lib/font/load";
import { analyze } from "../src/lib/analysis/pipeline";
import { DEFAULT_OPTIONS } from "../src/lib/analysis/model";
const [a, b, cs, json] = process.argv.slice(2);
const src = openFont(new Uint8Array(readFileSync(a))), ref = openFont(new Uint8Array(readFileSync(b)));
const { model, glyphs } = analyze({ src, ref, refMeta: { id: "", name: "", file: "", coords: {} }, category: "sans-serif", options: { ...DEFAULT_OPTIONS, charset: cs, ...(json ? JSON.parse(json) : {}) }, progress: () => {} });
for (const r of model.refinement) console.log("G", r.iter, r.meanAbs.toFixed(3), "smooth", r.smooth?.toFixed(3), "rev", r.reverse?.toFixed(2), r.note);
for (const g of glyphs.slice(0, 2)) for (const r of g.refineSteps) console.log(g.char, r.iter, r.meanAbs.toFixed(3), r.note);
