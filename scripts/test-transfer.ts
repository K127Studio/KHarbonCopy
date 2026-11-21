import { readFileSync, writeFileSync } from "node:fs";
import { openFont } from "../src/lib/font/load";
import { analyze } from "../src/lib/analysis/pipeline";
import { DEFAULT_OPTIONS } from "../src/lib/analysis/model";
import { transferFont } from "../src/lib/transform/font";
import { DEFAULT_PARAMS } from "../src/lib/transform/params";

const [srcPath, refPath, khPath, outPath] = process.argv.slice(2);
const src = openFont(new Uint8Array(readFileSync(srcPath)));
const ref = openFont(new Uint8Array(readFileSync(refPath)));
const { model } = analyze({ src, ref, refMeta: { id: "t", name: "t", file: refPath, coords: {} }, category: "sans-serif",
  options: { ...DEFAULT_OPTIONS }, progress: () => {} });
const { tape, ...tx } = model.texture;
writeFileSync(outPath.replace(/\.ttf$/, ".model.json"), JSON.stringify({ ...model, texture: { ...tx, tape: tape.length } }, null, 1));
const kh = openFont(new Uint8Array(readFileSync(khPath)));
const names = { family: "Test Transfer", style: "Regular", designer: "Tester", designerURL: "", manufacturer: "", vendorURL: "",
  copyright: "test", license: "OFL", licenseURL: "", version: "1.0", description: "", trademark: "", vendorID: "TEST" };
const r = transferFont(kh, model, { ...DEFAULT_PARAMS, ...(process.env.PARAMS ? JSON.parse(process.env.PARAMS) : {}) }, names, (m, f) => { if (f === 1 || m.startsWith("scelta")) console.log(m); });
console.log(r.report.join("\n"));
console.log("glyphs", r.glyphCount, "time", r.seconds.toFixed(1), "s", "bytes", r.ttf.length);
writeFileSync(outPath, r.ttf);
