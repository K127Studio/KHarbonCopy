// Downloads the bundled OFL/Apache reference + Khmer fonts from github.com/google/fonts
// into public/fonts and writes public/fonts/manifest.json.
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const RAW = "https://raw.githubusercontent.com/google/fonts/main/";
const OUT = path.join(process.cwd(), "public", "fonts");

const reference = [
  // sans-serif: humanist · neo-grotesk · geometric wide · condensed
  { id: "lato", name: "Lato", category: "sans-serif", trait: "humanist", files: ["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold", "ExtraBold", "Black"].map((w) => `ofl/lato/Lato-${w}.ttf`) },
  { id: "inter", name: "Inter", category: "sans-serif", trait: "neo-grotesk", files: ["ofl/inter/Inter[opsz,wght].ttf"] },
  { id: "montserrat", name: "Montserrat", category: "sans-serif", trait: "geometric, wide", files: ["ofl/montserrat/Montserrat[wght].ttf"] },
  { id: "oswald", name: "Oswald", category: "sans-serif", trait: "condensed", files: ["ofl/oswald/Oswald[wght].ttf"] },
  // serif: transitional · modern text · didone high contrast · old-style
  { id: "notoserif", name: "Noto Serif", category: "serif", trait: "transitional, low contrast", files: ["ofl/notoserif/NotoSerif[wdth,wght].ttf"] },
  { id: "sourceserif4", name: "Source Serif 4", category: "serif", trait: "modern text", files: ["ofl/sourceserif4/SourceSerif4[opsz,wght].ttf"] },
  { id: "playfair", name: "Playfair Display", category: "serif", trait: "didone, high contrast", files: ["ofl/playfairdisplay/PlayfairDisplay[wght].ttf"] },
  { id: "ebgaramond", name: "EB Garamond", category: "serif", trait: "old-style", files: ["ofl/ebgaramond/EBGaramond[wght].ttf"] },
  // slab: clarendon-ish · humanist slab · geometric slab · light slab
  { id: "robotoslab", name: "Roboto Slab", category: "slab-serif", trait: "neutral slab", files: ["apache/robotoslab/RobotoSlab[wght].ttf"] },
  { id: "bitter", name: "Bitter", category: "slab-serif", trait: "humanist slab", files: ["ofl/bitter/Bitter[wght].ttf"] },
  { id: "arvo", name: "Arvo", category: "slab-serif", trait: "geometric slab", files: ["ofl/arvo/Arvo-Regular.ttf", "ofl/arvo/Arvo-Bold.ttf"] },
  { id: "zillaslab", name: "Zilla Slab", category: "slab-serif", trait: "contrasted slab", files: ["Light", "Regular", "Medium", "SemiBold", "Bold"].map((w) => `ofl/zillaslab/ZillaSlab-${w}.ttf`) },
  // monospace: grotesk · coding humanist · slab mono · geometric quirky
  { id: "robotomono", name: "Roboto Mono", category: "monospace", trait: "grotesk mono", files: ["ofl/robotomono/RobotoMono[wght].ttf"] },
  { id: "jetbrainsmono", name: "JetBrains Mono", category: "monospace", trait: "tall x-height", files: ["ofl/jetbrainsmono/JetBrainsMono[wght].ttf"] },
  { id: "ibmplexmono", name: "IBM Plex Mono", category: "monospace", trait: "slab-serif mono", files: ["Thin", "ExtraLight", "Light", "Regular", "Medium", "SemiBold", "Bold"].map((w) => `ofl/ibmplexmono/IBMPlexMono-${w}.ttf`) },
  { id: "spacemono", name: "Space Mono", category: "monospace", trait: "geometric, quirky", files: ["ofl/spacemono/SpaceMono-Regular.ttf", "ofl/spacemono/SpaceMono-Bold.ttf"] },
  // handwriting: casual pen · connected script · brush-print · marker
  { id: "caveat", name: "Caveat", category: "handwriting", trait: "casual pen", files: ["ofl/caveat/Caveat[wght].ttf"] },
  { id: "dancingscript", name: "Dancing Script", category: "handwriting", trait: "connected script", files: ["ofl/dancingscript/DancingScript[wght].ttf"] },
  { id: "kalam", name: "Kalam", category: "handwriting", trait: "print, felt pen", files: ["Light", "Regular", "Bold"].map((w) => `ofl/kalam/Kalam-${w}.ttf`) },
  { id: "permanentmarker", name: "Permanent Marker", category: "handwriting", trait: "marker", files: ["apache/permanentmarker/PermanentMarker-Regular.ttf"] },
  // display: condensed caps · fat face · rounded geometric · heavy grotesk
  { id: "bebasneue", name: "Bebas Neue", category: "display", trait: "condensed caps", files: ["ofl/bebasneue/BebasNeue-Regular.ttf"] },
  { id: "abrilfatface", name: "Abril Fatface", category: "display", trait: "fat face didone", files: ["ofl/abrilfatface/AbrilFatface-Regular.ttf"] },
  { id: "righteous", name: "Righteous", category: "display", trait: "rounded geometric", files: ["ofl/righteous/Righteous-Regular.ttf"] },
  { id: "archivoblack", name: "Archivo Black", category: "display", trait: "heavy grotesk", files: ["ofl/archivoblack/ArchivoBlack-Regular.ttf"] },
];

const khmer = [
  { id: "kantumruypro", name: "Kantumruy Pro", style: "sans-serif", files: ["ofl/kantumruypro/KantumruyPro[wght].ttf"] },
  { id: "notosanskhmer", name: "Noto Sans Khmer", style: "sans-serif", files: ["ofl/notosanskhmer/NotoSansKhmer[wdth,wght].ttf"] },
  { id: "notoserifkhmer", name: "Noto Serif Khmer", style: "serif", files: ["ofl/notoserifkhmer/NotoSerifKhmer[wdth,wght].ttf"] },
  { id: "hanuman", name: "Hanuman", style: "serif", files: ["ofl/hanuman/Hanuman[wght].ttf"] },
  { id: "nokora", name: "Nokora", style: "sans-serif", files: ["ofl/nokora/Nokora[wght].ttf"] },
  { id: "battambang", name: "Battambang", style: "serif", files: ["Thin", "Light", "Regular", "Bold", "Black"].map((w) => `ofl/battambang/Battambang-${w}.ttf`) },
  { id: "suwannaphum", name: "Suwannaphum", style: "serif", files: ["Thin", "Light", "Regular", "Bold", "Black"].map((w) => `ofl/suwannaphum/Suwannaphum-${w}.ttf`) },
  { id: "content", name: "Content", style: "sans-serif", files: ["ofl/content/Content-Regular.ttf", "ofl/content/Content-Bold.ttf"] },
  { id: "kdamthmorpro", name: "Kdam Thmor Pro", style: "display", files: ["ofl/kdamthmorpro/KdamThmorPro-Regular.ttf"] },
  { id: "koulen", name: "Koulen", style: "display", files: ["ofl/koulen/Koulen-Regular.ttf"] },
  { id: "moul", name: "Moul", style: "display", files: ["ofl/moul/Moul-Regular.ttf"] },
  { id: "moulpali", name: "Moulpali", style: "display", files: ["ofl/moulpali/Moulpali-Regular.ttf"] },
  { id: "bokor", name: "Bokor", style: "display", files: ["ofl/bokor/Bokor-Regular.ttf"] },
  { id: "dangrek", name: "Dangrek", style: "display", files: ["ofl/dangrek/Dangrek-Regular.ttf"] },
  { id: "angkor", name: "Angkor", style: "display", files: ["ofl/angkor/Angkor-Regular.ttf"] },
  { id: "bayon", name: "Bayon", style: "display", files: ["ofl/bayon/Bayon-Regular.ttf"] },
  { id: "chenla", name: "Chenla", style: "display", files: ["ofl/chenla/Chenla.ttf"] },
  { id: "metal", name: "Metal", style: "display", files: ["ofl/metal/Metal-Regular.ttf"] },
  { id: "siemreap", name: "Siemreap", style: "sans-serif", files: ["ofl/siemreap/Siemreap.ttf"] },
  { id: "preahvihear", name: "Preahvihear", style: "sans-serif", files: ["ofl/preahvihear/Preahvihear-Regular.ttf"] },
  { id: "odormeanchey", name: "Odor Mean Chey", style: "serif", files: ["ofl/odormeanchey/OdorMeanChey-Regular.ttf"] },
  { id: "taprom", name: "Taprom", style: "display", files: ["ofl/taprom/Taprom-Regular.ttf"] },
  { id: "fasthand", name: "Fasthand", style: "handwriting", files: ["ofl/fasthand/Fasthand-Regular.ttf"] },
  { id: "freehand", name: "Freehand", style: "handwriting", files: ["ofl/freehand/Freehand-Regular.ttf"] },
];

async function exists(p) { try { await access(p); return true; } catch { return false; } }

async function fetchSet(kind, list) {
  const dir = path.join(OUT, kind);
  await mkdir(dir, { recursive: true });
  const out = [];
  for (const f of list) {
    const files = [];
    for (const src of f.files) {
      const name = path.basename(src).replace(/[\[\],]/g, (c) => (c === "[" ? "-VF-" : c === "]" ? "" : "_"));
      const dest = path.join(dir, name);
      if (!(await exists(dest))) {
        const res = await fetch(RAW + src.split("/").map(encodeURIComponent).join("/"));
        if (!res.ok) { console.warn("skip", src, res.status); continue; }
        await writeFile(dest, Buffer.from(await res.arrayBuffer()));
        console.log("ok", src);
      }
      files.push(`/fonts/${kind}/${name}`);
    }
    if (files.length) out.push({ ...f, files });
  }
  return out;
}

const manifest = { reference: await fetchSet("reference", reference), khmer: await fetchSet("khmer", khmer) };
await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log("manifest written");
