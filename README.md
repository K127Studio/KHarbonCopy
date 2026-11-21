# KHarbonCopy

**Latin-to-Khmer font style transfer, entirely in the browser.**

KHarbonCopy measures a Latin typeface against a reference of the same category at full vector precision, describes
how every point departs from it with exact wave functions, refines them iteratively, and replays them on a Khmer
typeface. The result is a downloadable TTF/WOFF that carries the style of the Latin font into the Khmer script.

Nothing is uploaded: fonts are parsed, analysed and generated locally in a Web Worker.

- `/` — the tool (source → setup → screening → Khmer → export)
- `/how-it-works` — the mathematics, with interactive demos
- `/why` — why the project exists

## Why

Google Fonts lists 1,840 families that cover Latin and 28 that cover Khmer — about 66 to 1. Across the whole web the
gap is closer to three orders of magnitude. KHarbonCopy is not a substitute for Cambodian type designers, nor a
shortcut for imitating someone else's work. It has two goals:

1. **A starting point for designers** — a first draft that already carries a coherent style, to be refined by hand
   (curve tension, stem weights, contrast, overshoots, terminals, counters, spacing, kerning).
2. **A fast route for campaigns** — when a team knows the look it wants from a Latin reference and needs a matching
   Khmer font for banners, social posts and print, now.

The name is a provocation: it never returns a perfect carbon copy — only a charcoal trace to draw over in ink.

## Getting started

Requires Node.js 20+.

```bash
npm install
npm run dev          # http://localhost:3000
```

Production build:

```bash
npm run build
npm start
```

The bundled reference and Khmer fonts are already in `public/fonts`. To download them again from
[google/fonts](https://github.com/google/fonts) and rebuild `public/fonts/manifest.json`:

```bash
npm run fonts
```

## How it works

All geometry is vector: outlines are normalised to a 1000-unit em, flattened at 0.01 u tolerance and resampled by arc
length. For every glyph shared by the source and the reference:

1. **Global geometry** — slant, horizontal scale and a vertical zone map, fitted with robust regression.
2. **Wave function O(φ, v)** — a Fourier series of the normal displacement as a function of the normal direction φ
   (weight, contrast, stress axis), with a Legendre polynomial in height v.
3. **Corner kernels** — displacement profiles around corners by type and angle: fillet radius, ink traps, flares, spurs.
4. **Slice fields** — exact horizontal and vertical scanlines, run alignment and bicubic warp / thickness fields.
5. **Texture** — intrinsic roughness via Savitzky–Golay residuals and Welch power spectra.

Refinement is monotone: global and per-glyph passes keep a correction only if the error falls, halving the step
otherwise, and stop on an error threshold, a minimum gain or a pass cap. The transferable model is the
consistency-gated median of the per-glyph functions, with bootstrap confidence intervals.

The transfer replays the same stages on the Khmer font, cleans the result with boolean operations, fits cubic curves
(Schneider) and converts them to TrueType quadratics. A custom sfnt writer rewrites
`glyf/loca/hmtx/maxp/head/hhea/post/OS2/name`, keeps `GSUB`/`GDEF` and transforms `GPOS` anchors.

The full explanation is on the `/how-it-works` page.

## Project structure

```
app/                    Next.js App Router pages (/, /how-it-works, /why) and global styles
src/components/         UI: Studio (the tool), charts, glyph views, explainer demos
src/lib/analysis/       measurement pipeline, model, ranking of references, duration estimate
src/lib/geometry/       flattening, sampling, scanlines, distance fields, clipping, curve fitting
src/lib/math/           FFT (Bluestein), linear algebra, statistics, seeded RNG
src/lib/transform/      applying the model to a Khmer font
src/lib/font/           font loading and the sfnt / glyf / GPOS writer
src/lib/worker/         Web Worker engine and its typed protocol
public/fonts/           bundled reference (Latin) and Khmer fonts + manifest
scripts/                font download, command-line tests and benchmarks
```

## Command-line tools

```bash
npm run typecheck
npx tsx scripts/test-analysis.ts <source.ttf> <reference.ttf> [characters]
npx tsx scripts/test-transfer.ts <source.ttf> <reference.ttf> <khmer.ttf> <out.ttf>
```

## Stack

Next.js · React · TypeScript · Tailwind CSS · fontkit · clipper-lib

## Licenses

Code: [MIT](LICENSE) © K127.

Bundled fonts keep their own licenses: SIL Open Font License 1.1 or Apache License 2.0 (from google/fonts).
When you modify a Khmer font with KHarbonCopy, respect its license — OFL fonts require the license to travel with the
derived font, and Reserved Font Names may not be reused.
