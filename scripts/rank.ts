import { readFileSync } from "node:fs";
import { openFont } from "../src/lib/font/load";
import { prepareSource, quickRelStem, scoreReference, weightMatch } from "../src/lib/analysis/rank";
const man = JSON.parse(readFileSync("public/fonts/manifest.json", "utf8"));
for (const srcPath of process.argv.slice(2)) {
  const t0 = Date.now();
  const src = openFont(new Uint8Array(readFileSync(srcPath)));
  const probe = prepareSource(src);
  const target = quickRelStem(src);
  const rows: any[] = [];
  for (const r of man.reference) {
    const hs = r.files.map((f: string) => ({ h: openFont(new Uint8Array(readFileSync("public" + f))), file: f }));
    const w = weightMatch(hs, target);
    const s = scoreReference(probe, w.h);
    rows.push({ ref: r.name, cat: r.category, wght: w.coords.wght ? Math.round(w.coords.wght) : w.file.split("/").pop(), score: +s.score.toFixed(2), cov: +s.coverage.toFixed(3) });
  }
  rows.sort((a, b) => a.score - b.score);
  console.log(srcPath.split("/").pop(), "·", ((Date.now() - t0) / 1000).toFixed(1), "s");
  console.table(rows.slice(0, 6));
}
