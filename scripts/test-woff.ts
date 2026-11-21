import { readFileSync, writeFileSync } from "node:fs";
import { toWoff } from "../src/lib/font/sfnt";
const [i, o] = process.argv.slice(2);
toWoff(new Uint8Array(readFileSync(i))).then((w) => { writeFileSync(o, w); console.log("woff bytes", w.length); });
