// End-to-end: analysis (given options) → Khmer transfer → TTF, printing the key diagnostics.
import { readFileSync, writeFileSync } from "node:fs";
import { openFont } from "../src/lib/font/load";
import { analyze } from "../src/lib/analysis/pipeline";
import { DEFAULT_OPTIONS } from "../src/lib/analysis/model";
import { transferFont } from "../src/lib/transform/font";
import { DEFAULT_PARAMS } from "../src/lib/transform/params";
const [srcP, refP, khP, out, json] = process.argv.slice(2);
const src = openFont(new Uint8Array(readFileSync(srcP))), ref = openFont(new Uint8Array(readFileSync(refP)));
const { model } = analyze({ src, ref, refMeta: { id: "", name: "", file: refP, coords: {} }, category: "sans-serif", options: { ...DEFAULT_OPTIONS, ...(json ? JSON.parse(json) : {}) }, progress: () => {} });
const r = model.refinement;
console.log("global", r[0].meanAbs.toFixed(2), "→", r[r.length - 1].meanAbs.toFixed(2), "passes", r.length - 1, "reverts", r.filter((x) => x.note.includes("reverted")).length);
console.log("terminals", model.terminals?.count, "a0 CI", model.normalFn.ci?.[0], "se a1", model.normalFn.se?.[1]?.toFixed(3));
const kh = openFont(new Uint8Array(readFileSync(khP)));
const names = { family: "E2E", style: "Regular", designer: "", designerURL: "", manufacturer: "", vendorURL: "", copyright: "", license: "", licenseURL: "", version: "1.0", description: "", trademark: "", vendorID: "NONE" };
const t = transferFont(kh, model, DEFAULT_PARAMS, names, () => {});
console.log(t.report.join(" | "));
writeFileSync(out, t.ttf);
