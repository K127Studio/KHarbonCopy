import type { Metadata } from "next";
import Wordmark from "@/components/Wordmark";
import LinkButton from "@/components/LinkButton";
import Toc from "@/components/explainer/Toc";

const whyDescription =
  "Why KHarbonCopy exists: the gap between Latin and Khmer type is still two to three orders of magnitude wide. A starting point for Cambodian designers and a fast route to campaign fonts — never a substitute for them.";

export const metadata: Metadata = {
  title: { absolute: "KHarbonCopy | Why we built it" },
  description: whyDescription,
  keywords: ["Khmer fonts", "Cambodian type design", "Khmer typography", "Latin vs Khmer fonts", "font design tools", "open source design"],
  alternates: { canonical: "/why" },
  openGraph: {
    type: "article",
    siteName: "KHarbonCopy",
    url: "/why",
    title: "KHarbonCopy | Why we built it",
    description: whyDescription,
    images: [{ url: "/images/logo.png", alt: "KHarbonCopy logo" }],
  },
  twitter: {
    card: "summary",
    title: "KHarbonCopy | Why we built it",
    description: whyDescription,
    images: ["/images/logo.png"],
  },
};

/* ------------------------------------------------------------------ data
   Google Fonts: counted from fonts.google.com/metadata/fonts (families by subset), November 2026.
   Whole web: no authoritative census exists — Latin figures follow the most-cited estimates
   (≈ 500,000 fonts, e.g. Luc Devroye's catalogue); Khmer Unicode fonts are estimated at a few hundred. */
const GF_LATIN = 1840;
const GF_KHMER = 28;
const WEB_LATIN = 500_000;
const WEB_KHMER = 500;

const TOC = [
  ["gap", "The gap, in numbers"],
  ["momentum", "A new generation"],
  ["not", "What it is not"],
  ["purpose", "Two purposes"],
  ["layers", "The first step is cultural"],
  ["name", "About the name"],
] as const;

/* ------------------------------------------------------------------ building blocks */

/** Tilt of a section number: -30° plus a jitter in [-8°, +8°].
 *  Seeded by the number itself, so server and client render the same angle (no hydration mismatch). */
function numberTilt(n: string): number {
  const x = Math.sin(Number(n) * 12.9898 + 78.233) * 43758.5453;
  const r = x - Math.floor(x); // pseudo-random in [0, 1)
  return Math.round((-30 + (r * 2 - 1) * 8) * 10) / 10;
}

function Section({ id, n, title, kicker, children }: { id: string; n: string; title: string; kicker?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line pb-14 pt-20 first:border-t-0 sm:pt-24">
      {/* oversized, rotated section number centred on the heading, half of it in the left gutter.
          Its rotated box spans ~±90px vertically (sm: ±100px), so the top padding keeps it clear of the divider. */}
      <div className="relative isolate">
        <span aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 -z-10 -translate-x-[12%] -translate-y-1/2 sm:-translate-x-[35%] select-none font-mono text-[6rem] font-bold leading-none tracking-tighter text-accent opacity-25 sm:text-[8rem]"
          style={{ rotate: `${numberTilt(n)}deg` }}>
          {n}
        </span>
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      </div>
      {kicker && <p className="mt-3 max-w-3xl text-lg leading-relaxed text-muted">{kicker}</p>}
      <div className="mt-8 max-w-3xl space-y-5 text-[15.5px] leading-[1.75] text-ink/90">{children}</div>
    </section>
  );
}

function Stat({ value, label, tone }: { value: string; label: string; tone: "red" | "accent" | "ink" }) {
  const color = tone === "red" ? "text-brand-red" : tone === "accent" ? "text-accent" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-panel p-5">
      <div className={`font-mono text-3xl font-semibold tracking-tight sm:text-4xl ${color}`}>{value}</div>
      <div className="mt-1 text-sm leading-snug text-muted">{label}</div>
    </div>
  );
}

/** Horizontal bars on a log10 axis — the only honest way to put 28 and 500,000 on one chart. */
function LogBars({ title, rows, max }: { title: string; rows: { label: string; value: number; tone: "red" | "accent" }[]; max: number }) {
  const lmax = Math.log10(max);
  return (
    <figure className="rounded-2xl border border-line bg-panel p-5">
      <figcaption className="mb-4 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{title}</figcaption>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 text-sm">
            <span className="text-muted">{r.label}</span>
            <div className="h-3 overflow-hidden rounded-full bg-sunken">
              <div className={`h-full rounded-full ${r.tone === "red" ? "bg-brand-red" : "bg-accent"}`}
                style={{ width: `${Math.max(2, (Math.log10(r.value) / lmax) * 100)}%` }} />
            </div>
            <span className="w-20 text-right font-mono text-ink">{r.value.toLocaleString("en-US")}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs text-muted">logarithmic scale — each step of the bar is ×10</div>
    </figure>
  );
}

function Aside({ label, tone, children }: { label: string; tone: "red" | "accent"; children: React.ReactNode }) {
  const cls = tone === "red" ? "border-brand-red/25 bg-brand-red/5 text-brand-red" : "border-accent/25 bg-accent/5 text-accent";
  return (
    <aside className={`my-6 rounded-2xl border p-5 ${cls}`}>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em]">{label}</div>
      <div className="text-[15px] leading-relaxed text-ink/90">{children}</div>
    </aside>
  );
}

/* ------------------------------------------------------------------ page */

export default function WhyPage() {
  return (
    <div className="min-h-dvh overflow-x-clip font-sans">
      <header className="sticky top-0 z-10 border-b border-line bg-panel/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <a href="/" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo.png" alt="KHarbonCopy logo" className="h-8 w-auto" />
            <Wordmark className="text-lg font-semibold tracking-tight" />
          </a>
          <nav className="flex items-center gap-2">
            <span className="hidden sm:contents"><LinkButton href="/how-it-works" variant="red">∑ How it works</LinkButton></span>
            <LinkButton href="/" variant="blue">Open the tool</LinkButton>
          </nav>
        </div>
      </header>

      {/* hero */}
      <div className="mx-auto max-w-6xl px-5 pb-6 pt-16">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-accent">Why</div>
        <h1 className="mt-3 max-w-4xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
          Not a <span className="text-brand-red">copy</span>.<br />A <span className="text-accent">trace</span> to draw over.
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted">
          For every Khmer typeface on the web there are, by a conservative count, hundreds of Latin ones.{" "}
          <Wordmark className="font-semibold text-ink" /> was built to narrow that distance — not by replacing the people who draw
          Khmer letters, but by giving them a first step to stand on.
        </p>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-24 lg:grid-cols-[1fr_220px]">
      <main className="min-w-0">
        <Section id="gap" n="01" title="The gap, in numbers"
          kicker="Nobody keeps an official census of the world's fonts, so the figures below are estimates — but even the most generous ones leave a gulf.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat value={GF_LATIN.toLocaleString("en-US")} label="font families on Google Fonts that cover Latin" tone="accent" />
            <Stat value={String(GF_KHMER)} label="font families on Google Fonts that cover Khmer" tone="red" />
            <Stat value={`×${Math.round(GF_LATIN / GF_KHMER)}`} label="Latin families for every Khmer one, on the same free library" tone="ink" />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <LogBars title="Google Fonts · families" max={WEB_LATIN}
              rows={[{ label: "Latin", value: GF_LATIN, tone: "accent" }, { label: "Khmer", value: GF_KHMER, tone: "red" }]} />
            <LogBars title="Whole web · fonts (estimate)" max={WEB_LATIN}
              rows={[{ label: "Latin", value: WEB_LATIN, tone: "accent" }, { label: "Khmer", value: WEB_KHMER, tone: "red" }]} />
          </div>
          <p>
            On Google Fonts — the largest free library and the default for most websites — <b>{GF_LATIN.toLocaleString("en-US")}</b> families
            include Latin, against <b>{GF_KHMER}</b> that include Khmer: a ratio of about <b>66 to 1</b>, close to <b>two orders of magnitude</b>.
          </p>
          <p>
            Across the whole web the distance widens. The most-cited estimates put Latin-script fonts at around <b>half a million</b>{" "}
            once weights and styles are counted (Luc Devroye&apos;s type catalogue alone indexes about that many). Khmer Unicode fonts, gathered from
            every free collection and foundry we know of, number in the <b>low hundreds</b> — perhaps a thousand if you include the legacy,
            pre-Unicode encodings. That is roughly <b>1,000 to 1</b>: <b>three orders of magnitude</b>.
          </p>
          <p className="text-sm text-muted">
            Both totals are approximations; the Google Fonts counts are exact, taken from its public metadata in November 2026.
          </p>
        </Section>

        <Section id="momentum" n="02" title="A new generation is closing in"
          kicker="Something is changing — fast. The gap is still there, but it is no longer standing still.">
          <p>
            In recent years a growing number of <b>young Cambodian designers</b> have started drawing their own typefaces: display faces for
            posters and film titles, contemporary text faces, revivals of hand-lettered signage and calligraphy. Two shifts made it possible.
          </p>
          <p>
            <b>Tools stopped being a luxury.</b> For a long time, serious vector work meant a paid subscription — Adobe Illustrator for drawing,
            commercial font editors for spacing and export. Today free and open-source tools cover the whole path: FontForge and Inkscape have
            done so for years, and newcomers such as <b>VectorCraft</b>, an open-source editor that reimplements the Illustrator workflow, keep
            lowering the bar.
          </p>
          <p>
            <b>AI became a studio assistant.</b> Generative tools help with sketches, specimens, scripting and the tedious parts of font production,
            so a single designer can now ship what used to require a team.
          </p>
          <Aside label="And yet" tone="red">
            Even at today&apos;s pace, closing a gap of two to three orders of magnitude one typeface at a time would take generations. A Khmer
            font is not a small job: hundreds of glyphs, subscript consonants (coeng), stacked vowels and diacritics, and the OpenType logic that
            puts them together.
          </Aside>
        </Section>

        <Section id="not" n="03" title="What KHarbonCopy is not">
          <p>
            <Wordmark className="font-semibold text-ink" /> is <b>not a substitute for Cambodian type designers</b>. A mathematical model can measure
            stroke contrast and curvature; it cannot decide how a letter should feel, or know which tradition it belongs to.
          </p>
          <p>
            Nor is it <b>a shortcut for imitating somebody else&apos;s work</b>. It transfers measurable traits of a style — weight, contrast, stress,
            terminals, proportions — onto an existing Khmer typeface whose license allows modification. It does not copy outlines, and it cannot
            produce a Khmer version of a design that does not exist.
          </p>
        </Section>

        <Section id="purpose" n="04" title="Two purposes"
          kicker="One for the designer who wants to go further, one for the team that needs a font by Friday.">
          <h3 className="pt-2 text-xl font-semibold tracking-tight text-ink">1 · A starting point for designers</h3>
          <p>
            A blank canvas is the hardest place to begin. <Wordmark className="font-semibold text-ink" /> gives designers a <b>first draft that
            already carries a coherent graphic style</b> — a solid step from which to develop their own creations, in their own voice.
          </p>
          <p>
            The output is a draft by design. A careful type designer will take it further: rebalancing <b>curve tension</b> and placing on-curve
            points at the <b>extremes</b>; evening out <b>stem weights</b> and the <b>contrast</b> between thick and thin strokes; fixing{" "}
            <b>overshoots</b> on round forms; correcting <b>terminals</b>, <b>joins</b> and the transitions where strokes meet; opening{" "}
            <b>counters</b> that close up at small sizes; and finally setting <b>sidebearings</b>, <b>kerning</b> and the positioning of
            subscripts and vowel marks. Those <b>optical corrections</b> are what make a typeface harmonious — and they are exactly what a purely
            mathematical tool cannot do on its own.
          </p>

          <h3 className="pt-6 text-xl font-semibold tracking-tight text-ink">2 · A fast route for campaigns</h3>
          <p>
            Sometimes there is no time for a full design cycle. A campaign needs a Khmer typeface <i>now</i>, and the team knows exactly the look it
            wants — maybe seen in an online magazine, on the packaging of an English-language product, in a brand&apos;s Latin identity.
          </p>
          <p>
            Load that reference, choose a Khmer base, and you have a <b>strong starting font</b> for marketing campaigns, banners, social posts,
            packaging mock-ups and whatever else the brief requires — with the Latin and Khmer lines finally speaking the same visual language.
          </p>
        </Section>

        <Section id="layers" n="05" title="The first step is cultural"
          kicker="What is often missing from the creative process is the very first step.">
          <p>
            Every design tradition is built in layers: each generation draws on what came before and on what arrives from elsewhere. In a global
            world, a country can — and should — hold firmly to its cultural identity, yet it cannot ignore what the rest of the world has made.
          </p>
          <p>
            <Wordmark className="font-semibold text-ink" /> exists to make that layer available: to take a typographic idea born for the Latin
            alphabet and let it meet the Khmer script, so that the conversation can start from something instead of from nothing. What comes next
            belongs to Cambodian designers.
          </p>
        </Section>

        <Section id="name" n="06" title="About the name">
          <p>
            The name is, paradoxically, a provocation. <Wordmark className="font-semibold text-ink" /> will <b>never return a perfect carbon copy</b> —
            and it is not supposed to.
          </p>
          <p>
            What it leaves is closer to a <b>charcoal trace on a white sheet</b>: a faint guide, a few confident lines. Around it, the designer takes
            up the pen and the ink and draws their own work.
          </p>
          <div className="pt-4">
            <LinkButton href="/" variant="blue" size="md" arrow="→">Start from a trace</LinkButton>
          </div>
        </Section>

        <section className="border-t border-line pt-8 text-xs leading-relaxed text-muted">
          <div className="mb-2 font-semibold uppercase tracking-[0.12em]">Sources</div>
          <ul className="space-y-1">
            <li>Google Fonts public metadata (fonts.google.com/metadata/fonts), families by subset, November 2026.</li>
            <li>Luc Devroye, Type Design Information Page — global type catalogue and Cambodian type index (luc.devroye.org).</li>
            <li>TypeDrawers, &ldquo;How many fonts are there?&rdquo; — discussion of global font-count estimates.</li>
            <li>VectorCraft — open-source vector editor (github.com/vectorcraft-app/vectorcraft).</li>
          </ul>
        </section>
      </main>
      {/* section index on the right, same scroll-spy as How it works */}
      <nav className="hidden pt-20 lg:block sm:pt-24">
        <Toc items={TOC} />
      </nav>
      </div>
    </div>
  );
}
