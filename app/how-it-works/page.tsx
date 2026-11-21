import type { Metadata } from "next";
import Wordmark from "@/components/Wordmark";
import Toc from "@/components/explainer/Toc";
import { DistanceDemo, FourierDemo, LineSearchDemo, WaveDemo } from "@/components/explainer/Demos";

const howDescription =
  "Inside KHarbonCopy: how outlines become Fourier series, how distance fields measure stroke thickness, and how robust regression and line searches turn a Latin style into a Khmer font — with interactive demos.";

export const metadata: Metadata = {
  title: { absolute: "KHarbonCopy | How it works — the maths behind the style transfer" },
  description: howDescription,
  keywords: ["Fourier series", "distance field", "robust regression", "line search", "font outlines", "Khmer typography"],
  alternates: { canonical: "/how-it-works" },
  openGraph: {
    type: "article",
    siteName: "KHarbonCopy",
    images: [{ url: "/images/logo.png", alt: "KHarbonCopy logo" }],
    title: "KHarbonCopy | How it works — the maths behind the style transfer",
    description: howDescription,
    url: "/how-it-works",
  },
  twitter: {
    card: "summary",
    images: ["/images/logo.png"],
    title: "KHarbonCopy | How it works — the maths behind the style transfer",
    description: howDescription,
  },
};

/* ------------------------------------------------------------------ building blocks */

function Section({ id, n, title, kicker, children }: { id: string; n: string; title: string; kicker: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line py-14 first:border-t-0">
      <div className="mb-1 font-mono text-xs text-accent">{n}</div>
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-3 max-w-3xl text-lg leading-relaxed text-muted">{kicker}</p>
      <div className="prose-k mt-8 max-w-3xl space-y-5 text-[15.5px] leading-[1.75] text-ink/90">{children}</div>
    </section>
  );
}

function Formula({ children, note }: { children: React.ReactNode; note?: string }) {
  return (
    <div className="my-6 overflow-x-auto rounded-xl border border-line bg-sunken/70 px-5 py-4">
      <div className="whitespace-nowrap text-center font-mono text-[15px] text-ink">{children}</div>
      {note && <div className="mt-2 text-center text-xs text-muted">{note}</div>}
    </div>
  );
}

function Curiosity({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <aside className="my-6 rounded-2xl border border-brand-red/25 bg-brand-red/5 p-5">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-brand-red">Curiosity · {title}</div>
      <div className="text-[15px] leading-relaxed text-ink/90">{children}</div>
    </aside>
  );
}

function Why({ children }: { children: React.ReactNode }) {
  return (
    <aside className="my-6 rounded-2xl border border-accent/25 bg-accent/5 p-5">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">Why this and not something else</div>
      <div className="text-[15px] leading-relaxed text-ink/90">{children}</div>
    </aside>
  );
}

function Critique({ children }: { children: React.ReactNode }) {
  return (
    <aside className="my-6 rounded-2xl border border-warn/30 bg-warn/5 p-5">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-warn">Honest limitation</div>
      <div className="text-[15px] leading-relaxed text-ink/90">{children}</div>
    </aside>
  );
}

const TOC = [
  ["pipeline", "The pipeline"],
  ["outlines", "Outlines as signals"],
  ["distance", "Finding correspondences"],
  ["affine", "Global geometry"],
  ["wave", "The wave function O(φ, v)"],
  ["robust", "Robust statistics"],
  ["refinement", "Iterative refinement"],
  ["corners", "Corners"],
  ["slices", "Slice fields"],
  ["texture", "Texture & spectra"],
  ["transfer", "Transfer to Khmer"],
  ["fontfile", "Writing the font file"],
  ["limits", "What we would improve"],
] as const;

/* ------------------------------------------------------------------ page */

export default function HowItWorks() {
  return (
    <div className="min-h-dvh font-sans">
      <header className="sticky top-0 z-10 border-b border-line bg-panel/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <a href="/" className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/logo.png" alt="KHarbonCopy logo" className="h-8 w-auto" />
            <Wordmark className="text-lg font-semibold tracking-tight" />
          </a>
          <span className="flex items-center gap-4 text-xs text-muted"><span className="hidden sm:inline">The mathematics behind the tool · MIT License</span><a href="/why" className="transition hover:text-accent">Why we built it</a></span>
        </div>
      </header>

      {/* hero */}
      <div className="mx-auto max-w-6xl px-5 pb-6 pt-16">
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-accent">How it works</div>
        <h1 className="mt-3 max-w-4xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl">
          A typeface is a <span className="text-brand-red">signal</span>.<br />Its style is a set of <span className="text-accent">waves</span>.
        </h1>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-muted">
          <Wordmark className="font-semibold text-ink" /> never looks at pixels. It reads every outline as a continuous curve, compares it with a
          reference typeface point by point, and describes the difference with a few dozen numbers: Fourier coefficients, Legendre
          polynomials, corner kernels, spectra. Those numbers are then replayed on a Khmer typeface. This page explains each step,
          why it was chosen, where it came from — and where it still falls short.
        </p>
        <div className="mt-8 flex flex-wrap gap-2 text-xs">
          {["Fourier 1807", "Legendre 1782", "Levenberg 1944", "Huber 1964", "Savitzky–Golay 1964", "Efron 1979", "Welch 1967", "Danielsson 1980", "Schneider 1990"].map((t) => (
            <span key={t} className="rounded-full border border-line bg-panel px-3 py-1 text-muted">{t}</span>
          ))}
        </div>
      </div>

      <div className="mx-auto grid max-w-6xl gap-10 px-5 pb-24 lg:grid-cols-[220px_1fr]">
        <nav className="hidden lg:block">
          <Toc items={TOC} />
        </nav>

        <main className="min-w-0">
          <Section id="pipeline" n="01" title="The pipeline" kicker="Explain the source as ‘reference + a few transformations’, then apply the same transformations to Khmer.">
            <p>
              The idea is a <b>differential</b> description. Describing a typeface from scratch would need thousands of control points;
              describing <i>how it differs</i> from the closest of 24 bundled references (ranked automatically at upload) needs very
              few. Each stage explains part of what the previous one left, and the error is re-measured after every stage:
            </p>
            <ol className="list-decimal space-y-1 pl-6">
              <li><b>Global affine</b> — slant, width, vertical zones.</li>
              <li><b>Wave function O(φ, v)</b> — how far each edge moves along its normal, as a function of its direction and height.</li>
              <li><b>Corner kernels</b> — fillet radius and residual profile per corner type.</li>
              <li><b>Slice fields</b> — smooth warp and thickness maps measured on scanlines.</li>
              <li><b>Texture</b> — the intrinsic roughness spectrum of the source.</li>
            </ol>
            <Why>
              Each stage is a model with <i>few</i> parameters measured on <i>many</i> glyphs. That is what makes it transferable: a parameter
              that only makes sense for the letter “g” cannot be applied to “ក”, but “vertical strokes are 22 % thicker than horizontal ones”
              can. Everything glyph-specific is deliberately left in the residual.
            </Why>
          </Section>

          <Section id="outlines" n="02" title="Outlines as signals" kicker="From Bézier curves to an evenly sampled, closed periodic signal.">
            <p>
              Font outlines are quadratic (TrueType) or cubic (PostScript) Bézier curves. We flatten them with <b>adaptive de Casteljau
              subdivision</b> until the polyline is within 0.01 units of the true curve (1/100 000 of the em), merge overlapping contours with
              an exact integer polygon union (Clipper, 1/1024-unit grid), and resample every contour at a constant arc-length step,
              always keeping a sample exactly on each corner.
            </p>
            <Formula note="a contour becomes a periodic function of arc length s, period L">x(s), y(s), n(s) · s ∈ [0, L)</Formula>
            <Curiosity title="de Casteljau's secret">
              Paul de Casteljau invented his algorithm at Citroën in 1959, Pierre Bézier at Renault in the early 60s. Citroën kept it
              secret, so the curves got Bézier's name. Every letter you are reading is still drawn with their maths.
            </Curiosity>
            <FourierDemo />
            <p>
              Once a contour is a periodic signal, the deviation between source and reference along it — d(s) — is also periodic, and a
              periodic signal can be written <i>exactly</i> as a sum of sines and cosines. For contours whose sample count is not a power of
              two we use <b>Bluestein's chirp-z algorithm</b>, which computes the exact DFT of any length N in O(N log N) by turning it into a
              convolution.
            </p>
          </Section>

          <Section id="distance" n="03" title="Finding correspondences" kicker="For every point of the reference: where is the matching point of the source?">
            <p>
              This is the most-repeated operation: an analysis with 28 passes runs it tens of millions of times. Originally each query cast a
              ray along the normal through a uniform grid (Amanatides–Woo traversal). Now every source glyph gets a <b>signed distance field</b>.
            </p>
            <DistanceDemo />
            <p>
              The grid (2 units) does not store distances — it stores the <b>index of the nearest outline segment</b>, propagated with a
              two-pass vector distance transform. A query reads the 4 surrounding cells, checks those segments and their ±3 neighbours,
              and returns the <i>exact</i> distance. Measured on 110 000 random points: maximum error 0.04 units, sign always right
              (pseudo-normals at vertices), ~4 µs per query.
            </p>
            <Formula note="nearest-point distance projected on the sample normal: exact for straight edges">d = −SD(p) / cos θ,   θ = ∠(n_sample, n_nearest)</Formula>
            <Why>
              The projection by 1/cos θ is not cosmetic. The first version used the raw nearest distance; the optimiser then stalled,
              because moving a point along its normal by δ changes its nearest distance by only δ·cos θ. Measurement and correction
              have to live in the same geometry. When the nearest wall faces the wrong way (the other side of a thin stroke) we fall back
              to the exact ray.
            </Why>
            <Curiosity title="distance fields everywhere">
              Danielsson described the vector distance transform in 1980 for medical images. Valve's 2007 paper on distance-field text
              rendering made it famous in games — every crisp label in a modern game engine is a distance field.
            </Curiosity>
          </Section>

          <Section id="affine" n="04" title="Global geometry" kicker="Slant, width and vertical zones — measured robustly, then checked.">
            <p>
              <b>Slant</b> is the length-weighted median of the angles of long near-vertical straight runs. <b>Width</b> is the median of
              (w<sub>src</sub> − Δstem)/w<sub>ref</sub>: the intercept is pinned to the measured stem difference, because a heavier font is wider
              for a reason that is <i>not</i> width. <b>Vertical zones</b> (baseline, x-height, caps, descenders) are mapped on the centres of the
              horizontal strokes, so weight stays out of the vertical map.
            </p>
            <p>
              Since MatchaCih showed that a zone map can hurt (huge x-height vs Lato), three variants are now scored before refining — full,
              no zone map, slant only — after removing the uniform weight difference, and the best one wins.
            </p>
            <p>
              <b>Which reference?</b> Before any of this, the source is ranked against all 24 bundled references (four per category, chosen
              to be as different as possible: geometric vs humanist, high vs low contrast, condensed vs wide). For each one the weight
              axis is first searched — a 5-point grid then bisection on the relative stem (stem / x-height), which is monotone in{" "}
              <code>wght</code> — so boldness is matched before shape is compared. Thirteen probe letters (H O n o a e g s b d p R k) are then
              mapped with the same slant/width/zone affine, sampled every 4 units and measured against the source's distance fields.
              The score is the mean |d − median d|: removing the median removes the uniform weight offset, so what is left is design.
              Unmatched samples count at the full search range, so a reference cannot win by matching less.
            </p>
            <Formula note="lower = closer design · u = unmatched samples, R = search range">score = ( Σ<sub>matched</sub> |d<sub>i</sub> − med d| + u·R ) / N</Formula>
            <Why>
              A reference of the same category can still be the wrong one: a geometric sans explaining a humanist sans wastes most of the
              wave function on describing the wrong skeleton. Picking the nearest reference leaves the model to describe <i>style</i>. Sanity
              check: uploading a bundled font (e.g. Bitter Thin) ranks itself first with a score of 0.8 units, the runner-up at ~24.
            </Why>
            <Curiosity title="why medians">
              A single broken glyph can drag a mean anywhere; a median needs half the data to be wrong. Its breakdown point is 50 %, the best
              possible — Laplace already preferred it in 1774.
            </Curiosity>
          </Section>

          <Section id="wave" n="05" title="The wave function O(φ, v)" kicker="Twenty-five Fourier terms times three Legendre polynomials describe weight, contrast, stress and how they change with height.">
            <p>
              Let φ be the direction of an edge's outward normal and v its height (0 = baseline, 1 = x-height). The core of the style model is
            </p>
            <Formula note="K = 12 harmonics, D = 2 · 75 numbers">O(φ, v) = Σ<sub>d=0..D</sub> P<sub>d</sub>(2v−1) · [ a<sub>d0</sub> + Σ<sub>k=1..K</sub> a<sub>dk</sub> cos kφ + b<sub>dk</sub> sin kφ ]</Formula>
            <WaveDemo />
            <p>
              The Fourier part is natural because φ is an angle: the function must be periodic, and Fourier series are the most compact
              periodic basis. The Legendre part (P<sub>0</sub> = 1, P<sub>1</sub> = x, P<sub>2</sub> = (3x² − 1)/2) adds height dependence: on
              ChemyRetro the diagnostic showed that “O depends on height” explains 15 % of the remaining error, while curvature and stroke
              width explain under 4 %. Legendre polynomials are orthogonal on [−1, 1], so the height terms do not fight each other.
            </p>
            <Why>
              <b>Smoothness prior (Tikhonov).</b> Square letters only have horizontal and vertical edges, so nothing constrains the diagonals:
              the least-squares system is underdetermined there and produced coefficients of ±250 that cancelled at 0° and 90° but exploded
              at 45° — the “ears” in the corners. We add one penalty row per coefficient with weight ∝ k²(1 + 2d): among all functions that fit
              the data, the smoothest one is chosen. This is ridge regression with a derivative norm, exactly the idea behind smoothing splines.
            </Why>
            <Curiosity title="the heat equation">
              Joseph Fourier introduced his series in 1807 to solve heat diffusion. The Academy (Lagrange included) refused to believe that
              a discontinuous function could be a sum of smooth sines — the Gibbs ringing you saw above is exactly where they were right
              to be suspicious.
            </Curiosity>
          </Section>

          <Section id="robust" n="06" title="Robust statistics" kicker="Fonts are full of outliers: a different ‘g’, a missing spur, a serif where the reference has none.">
            <p>
              Every fit is a <b>Huber regression</b> solved by iteratively reweighted least squares: residuals smaller than δ count
              quadratically, larger ones linearly — the estimator behaves like a mean for clean data and like a median for dirty data.
              δ is set from the median absolute deviation (scale = 1.4826·MAD, consistent with σ for Gaussian noise).
            </p>
            <Formula>ρ(r) = r²/2 if |r| ≤ δ,   δ|r| − δ²/2 otherwise</Formula>
            <p>
              The weighted normal equations are solved by <b>Cholesky decomposition plus one step of iterative refinement</b> on the true
              residual, on a flat Float64 matrix. With the smoothness prior the system is well conditioned, so this recovers QR-level
              accuracy at a fraction of the cost.
            </p>
            <p>
              Aggregating per-glyph results uses <b>consistency gating</b>: a coefficient c with across-glyph standard error se is shrunk to
              c·c²/(c² + se²). Terms on which glyphs agree survive; terms that describe one letter fade out — the same spirit as
              James–Stein shrinkage.
            </p>
            <p>
              The standard error comes from a <b>bootstrap over glyphs</b>: 400 resamples (with replacement) of the per-glyph wave functions,
              the median recomputed on each. The spread of those 400 medians is the SE that drives the gate, and the 2.5 / 97.5 percentiles
              give a 95 % confidence interval shown next to every coefficient. Because the gate feeds the transfer, uncertain terms are
              damped automatically on Khmer.
            </p>
            <Curiosity title="pulling yourself up by your bootstraps">
              Bradley Efron introduced the bootstrap in 1979: pretend your sample <i>is</i> the population and resample it. It replaced pages of
              asymptotic formulas with a loop — and works for the median, whose standard error has no simple closed form.
            </Curiosity>
            <Why>
              The first refinement used a near-L1 threshold (δ = 0.02·scale). It is maximally robust but its corrections were weak, so the
              line search could not use them and the loop stopped after 3 passes. δ = 0.1·scale keeps the robustness and gives usable
              directions — one of the fixes that made the refinement reach the end.
            </Why>
            <Curiosity title="Huber in 1964">
              Peter Huber's paper “Robust estimation of a location parameter” founded robust statistics. He showed his estimator is the
              best possible against the worst contamination of a Gaussian — a minimax result, game theory applied to noise.
            </Curiosity>
          </Section>

          <Section id="refinement" n="07" title="Iterative refinement" kicker="Every pass: fit a correction, find how far to go, accept only if the error falls.">
            <p>
              Refinement is <b>coordinate descent</b> over two blocks (the wave function, the corner kernels), first on all glyphs together
              (the transferable model), then on each glyph alone (the diagnostic fit, aggregated back with consistency gating).
            </p>
            <LineSearchDemo />
            <ul className="list-disc space-y-2 pl-6">
              <li><b>Line search.</b> α = 1, then 2 and 4 (or ½, ¼, 0.1), then the vertex of the parabola through the best three points.</li>
              <li><b>Smooth objective.</b> Acceptance does not use the raw mean |d| any more. Every matched sample gets a Cauchy weight
                1/(1 + z²) from its distance to the running median (z in units of the spike threshold), and the loss is Charbonnier
                √(d² + 1) − 1, L1-like but differentiable at zero. No sample is ever switched on or off by a hard rule, so tiny moves
                give tiny changes in the loss.</li>
              <li><b>Five directions.</b> Near-L1, Huber, and three <b>Levenberg–Marquardt</b> steps with λ = 0.3, 3, 30. LM adds rows
                √(λ·Σ J<sub>ij</sub>²)·e<sub>j</sub> to the system, i.e. solves (JᵀJ + λ·diag JᵀJ)Δ = Jᵀr: small λ is Gauss–Newton, large λ a
                short scaled-gradient step. The line search runs on each and the best wins.</li>
              <li><b>Bidirectional check.</b> After each pass the distance from the <i>source</i> outline to the transformed reference is
                measured too. If it grows (&gt; 0.2 %), the pass is reverted and its direction blocked for the next pass: a step cannot
                “improve” by drifting away from source ink that the reference does not reach. The dashed curve in the loss chart is this
                reverse distance.</li>
              <li><b>Random exploration.</b> If both fail, seeded Gaussian perturbations (amplitude ∝ 1/k² per harmonic) are tried; the
                amplitude grows after success and halves after failure — a (1+1)-evolution strategy with the 1/5-rule spirit.</li>
              <li><b>Monotone loss.</b> A step is accepted only if the mean error falls and coverage stays within 0.5 % of where it started.
                The loss curve can only go down or stay flat; every configured pass runs.</li>
              <li><b>Multi-resolution.</b> 60 % of the passes sample every 2 units, the last ones at the configured step (e.g. 0.5): the
                corrections are smooth, so coarse samples find the same direction ~4× faster.</li>
            </ul>
            <Curiosity title="Armijo and the parabola">
              Line searches go back to Armijo (1966); fitting a parabola through three points is older still — it is how Newton and
              Simpson thought about minima. It is the cheapest way to get curvature information when gradients are unavailable.
            </Curiosity>
            <Curiosity title="Levenberg, then Marquardt">
              Kenneth Levenberg published the damping idea in 1944 while working at an army arsenal; Donald Marquardt rediscovered it in
              1963 at DuPont and added the diagonal scaling. The method is still the default curve fitter of almost every scientific library.
            </Curiosity>
            <Critique>
              The weights are smooth, but the correspondences themselves are not: a sample can still jump to a different source edge when
              the outline moves past a junction. A truly differentiable loss would integrate over a soft-min of candidate edges. The
              bidirectional term is a check, not yet a term of the loss.
            </Critique>
          </Section>

          <Section id="corners" n="08" title="Corners" kicker="A fillet radius from geometry, the rest as a smoothed residual profile.">
            <p>
              For a corner with interior angle α, a circular fillet of radius ρ touches the two edges at distance T = ρ / tan(α/2) from the apex,
              and the deviation along an edge at arc distance s is
            </p>
            <Formula>δ(s) = ρ − √(ρ² − (T − |s|)²)   for |s| &lt; T</Formula>
            <p>
              ρ is fitted by a coarse scan plus <b>golden-section search</b> on the median profile of each angle bin (convex/concave ×
              five turning-angle ranges). What the fillet cannot explain — ink traps, flares, spurs — stays as a residual profile,
              consistency-gated per position, Gaussian-smoothed and cosine-tapered to zero at the window ends (the earlier step at the edges
              of the window was the source of the jagged Khmer outlines).
            </p>
            <p>
              <b>Stroke terminals.</b> Corners alone miss what happens <i>between</i> them at the end of a stroke. A terminal is detected as two
              consecutive convex corners (turn ≥ 50°) about one stroke width apart — the cap. The residual is read along the arc from
              u = −0.5 to 1.5 with u normalised by the cap width, so one profile fits a hairline end and a heavy stem end. Profiles are
              median-aggregated over all terminals (41 bins), consistency-gated, smoothed, tapered and clamped to ±15 % of the stem, then
              replayed on every Khmer cap scaled by its own width (slider “stroke ends ×”). Flares, wedge cuts and rounded ends travel this way.
            </p>
            <Curiosity title="the golden ratio as an algorithm">
              Golden-section search shrinks the bracket by 0.618 per evaluation and reuses one point every time — Kiefer proved in 1953
              that no other strategy does better in the worst case for unimodal functions.
            </Curiosity>
          </Section>

          <Section id="slices" n="09" title="Slice fields" kicker="Cut the glyph into horizontal and vertical slices, compare runs of ink, interpolate between slices.">
            <p>
              Each scanline is intersected exactly with the outline (non-zero winding) giving runs of ink. Runs of source and reference are
              matched by a small <b>dynamic-programming alignment</b> (the Needleman–Wunsch idea from genetics), then each matched pair gives a
              centre shift (warp) and a width change (thickness). Values are interpolated <i>along</i> each slice and then <i>across</i> slices
              with <b>PCHIP</b> (Fritsch–Carlson monotone cubic: no overshoot), evaluated with Catmull–Rom bicubics.
            </p>
            <Why>
              Thickness from horizontal slices sees a diagonal stroke as w/|n<sub>x</sub>|; from vertical slices as w/|n<sub>y</sub>|. Blending the
              two estimates with weights n<sub>x</sub>² and n<sub>y</sub>² (they sum to one) gives |n|³ terms and avoids double counting.
            </Why>
          </Section>

          <Section id="texture" n="10" title="Texture & spectra" kicker="Roughness is measured on the source alone, then described by its power spectrum.">
            <p>
              Comparing against a reference mixes design differences into “texture”. So roughness is measured <i>intrinsically</i>: the outline
              is smoothed with a quartic <b>Savitzky–Golay</b> filter along the arc (it preserves curvature, so clean Bézier fonts give ≈ 0),
              corners and tight curves are excluded, and the residual becomes a long “tape”. Its spectrum is estimated with <b>Welch's
              method</b> (Hann windows, 50 % overlap) and summarised by RMS, skewness, kurtosis, correlation length and notch statistics.
            </p>
            <Formula note="one-sided PSD of a windowed segment">S(f<sub>k</sub>) = 2·h·|X<sub>k</sub>|² / Σ w<sub>n</sub>²</Formula>
            <p>Transfer can either replay the real tape (cross-faded) or synthesise new texture with the same spectrum and random phases.</p>
            <Curiosity title="a smoother from chemistry">
              Savitzky and Golay published their filter in 1964 for noisy spectroscopy data. It became one of the most cited papers in
              <i> Analytical Chemistry</i> — and the journal later had to publish corrections to its coefficient tables.
            </Curiosity>
          </Section>

          <Section id="transfer" n="11" title="Transfer to Khmer" kicker="Same transformations, new letters — while protecting what makes Khmer Khmer.">
            <ul className="list-disc space-y-2 pl-6">
              <li><b>Weight & contrast.</b> The source's relative stem (stem / x-height) is mapped to the Khmer consonant body; a variable Khmer
                font is instanced at the closest <code>wght</code>, the remainder is solved exactly as a uniform offset plus a cos 2φ term that hits
                the target vertical and horizontal stems.</li>
              <li><b>Wave function</b> evaluated with the Khmer height (0 = baseline, 1 = top of the consonant body), harmonics damped by
                1/(1 + (k/k₀)⁴) so that square-letter terms do not ripple on Khmer curves.</li>
              <li><b>Khmer zones.</b> Height is piecewise: the consonant body maps to [0, 1]; below the baseline the subscript/coeng zone maps
                onto the source descender zone, above the body the vowel/sign zone onto the source ascender zone. Zone limits are measured on
                the whole Khmer font (25th percentile of glyph bottoms, 75th of tops), so a height-dependent weight change in Latin
                descenders lands on Khmer subscripts, not on the middle of a consonant.</li>
              <li><b>Negative space.</b> For every sample, rays measure the whitespace in front and the stroke behind; ink may fill at most 35 % of any
                counter, slot or gap, and every stroke keeps at least 45 %. The limits are eroded and smoothed along the contour so that the
                clamped outline stays smooth.</li>
              <li><b>Smoother & despeckle.</b> The structural displacement is Gaussian-low-passed along the contour, never across a true corner;
                islands and pin-holes smaller than (0.2·stem)² are removed.</li>
              <li><b>Curves.</b> Schneider's least-squares cubic fitting with Newton reparameterisation, then the cu2qu conversion to TrueType
                quadratics within a set tolerance.</li>
            </ul>
            <Critique>
              Mapping “relative weight” through the x-height assumes Latin and Khmer proportions correspond. Designers often draw Khmer stems
              relatively lighter; the weight slider exists because this mapping is a heuristic, not a law.
            </Critique>
          </Section>

          <Section id="fontfile" n="12" title="Writing the font file" kicker="A real TrueType font, with Khmer shaping intact.">
            <p>
              Outlines are encoded into <code>glyf</code>/<code>loca</code> with compressed flags; metrics, <code>maxp</code>, <code>head</code>,
              <code>hhea</code>, <code>post</code>, <code>OS/2</code> and a new <code>name</code> table are rewritten. <code>GSUB</code> is kept
              untouched, and every <code>GPOS</code> anchor (mark-to-base, mark-to-mark, ligatures, cursive) is moved through the same geometric
              transform as its glyph — including variation deltas from the <code>ItemVariationStore</code> when the Khmer source is variable —
              so subscript consonants and vowels still stack where they should.
            </p>
          </Section>

          <Section id="limits" n="13" title="What we would improve" kicker="A self-critical list — the next steps, roughly in order of value.">
            <p className="text-muted">
              Done since the first version of this list: smooth acceptance objective + Levenberg–Marquardt directions, bidirectional check,
              stroke terminals, piecewise Khmer zones, bootstrap confidence intervals, and reference choice by ranking all 24 references.
            </p>
            <ol className="list-decimal space-y-3 pl-6">
              <li><b>Soft correspondences.</b> Weights are smooth now, matches are not. A soft-min over nearby source edges (or integrating the
                distance field along the outline) would give a fully differentiable loss and analytic Jacobians.</li>
              <li><b>Reverse distance inside the loss.</b> The source → reference distance is a veto today. Adding it as a weighted term would let
                the optimiser trade both directions instead of rejecting whole passes.</li>
              <li><b>A real skeleton.</b> Terminals are found from corner pairs. A medial-axis transform would give stroke direction and width
                profiles along every stroke — stress and modulation as functions of the stroke, not of the edge.</li>
              <li><b>Ranking on the full model.</b> The ranking uses a fast affine-only score on 13 letters. Ranking the top 3 by the stage-2 error
                (after the wave function) would catch references that look far but explain well.</li>
              <li><b>Per-zone Khmer statistics.</b> Zone limits are percentiles over the font; using the actual Unicode classes (subscript forms,
                above/below vowels) from GSUB would be exact.</li>
              <li><b>GPU / WASM.</b> Distance queries and normal equations are embarrassingly parallel; WebGPU or a WASM SIMD build would cut the
                remaining minutes to seconds.</li>
            </ol>
            <p className="text-muted">
              Built in the open under the MIT License. Bundled fonts keep their own licenses (SIL Open Font License / Apache 2.0).
            </p>
          </Section>
        </main>
      </div>
    </div>
  );
}
