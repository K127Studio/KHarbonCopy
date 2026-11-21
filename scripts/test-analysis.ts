import { readFileSync } from "node:fs";
import { openFont } from "../src/lib/font/load";
import { analyze } from "../src/lib/analysis/pipeline";
import { DEFAULT_OPTIONS } from "../src/lib/analysis/model";
import { measureLatin, detectCategory } from "../src/lib/analysis/metrics";

const [srcPath, refPath, charset] = process.argv.slice(2);
const src = openFont(new Uint8Array(readFileSync(srcPath)));
const ref = openFont(new Uint8Array(readFileSync(refPath)));
const mS = measureLatin(src);
console.log("src metrics", mS, detectCategory(src, mS));
console.log("ref metrics", measureLatin(ref));
const t0 = Date.now();
const { model, glyphs } = analyze({
  src, ref, refMeta: { id: "t", name: "t", file: refPath, coords: {} }, category: "sans-serif",
  options: { ...DEFAULT_OPTIONS, charset: charset ?? DEFAULT_OPTIONS.charset },
  progress: () => {},
});
console.log("time", (Date.now() - t0) / 1000, "s; glyphs", glyphs.length);
console.log("global", model.global);
console.log("normalFn", model.normalFn.coef.map((c) => c.toFixed(2)).join(" "));
console.log("corners", model.corners.bins.map((b) => `${b.convex ? "cvx" : "ccv"} ${(b.lo * 57.3).toFixed(0)}-${(b.hi * 57.3).toFixed(0)} n=${b.count} r=${b.radius.toFixed(1)} res=${b.residualRms.toFixed(2)}`).join("\n"));
const { tape, ...tex } = model.texture;
console.log("texture", { ...tex, bands: tex.bands.map((b) => `${b.lo.toFixed(1)}-${b.hi.toFixed(1)}:${b.psd.toExponential(2)}`) }, "tape", tape.length);
console.table(model.fidelity.map((f) => ({ ...f, meanAbs: +f.meanAbs.toFixed(3), rms: +f.rms.toFixed(3), p95: +f.p95.toFixed(3), max: +f.max.toFixed(1), iou: +f.iou.toFixed(4), coverage: +f.coverage.toFixed(3) })));
console.log("outliers", model.outliers); console.table(model.refinement); console.log("reliability", model.reliability, "zones", model.global.zoneFrom, model.global.zoneTo);
