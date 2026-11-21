import { readFileSync } from "node:fs";
import { openFont } from "../src/lib/font/load";
import { analyze } from "../src/lib/analysis/pipeline";
import { DEFAULT_OPTIONS } from "../src/lib/analysis/model";
const [a, b, cs] = process.argv.slice(2);
const src = openFont(new Uint8Array(readFileSync(a))), ref = openFont(new Uint8Array(readFileSync(b)));
let last = Date.now(), lastMsg = "start";
const acc = new Map<string, number>();
analyze({ src, ref, refMeta: { id: "", name: "", file: "", coords: {} }, category: "sans-serif", options: { ...DEFAULT_OPTIONS, charset: cs }, progress: (m) => {
  const now = Date.now(); const key = lastMsg.replace(/ ·.*| \d.*/, "");
  acc.set(key, (acc.get(key) ?? 0) + now - last); last = now; lastMsg = m; } });
for (const [k, v] of acc) console.log((v / 1000).toFixed(1).padStart(7), "s ", k);
