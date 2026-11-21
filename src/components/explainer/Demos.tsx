"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------ shared bits */

function Range({ label, value, min, max, step, onChange, fmt }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  return (
    <label className="block text-xs">
      <span className="flex justify-between gap-2 text-muted">
        <span>{label}</span>
        <span className="font-mono text-ink">{fmt ? fmt(value) : value}</span>
      </span>
      <input type="range" className="mt-1 w-full" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export function DemoFrame({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <figure className="my-8 overflow-hidden rounded-2xl border border-line bg-panel shadow-card">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-3">
        <span className="text-sm font-semibold">▶ {title}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </figcaption>
      <div className="p-5">{children}</div>
    </figure>
  );
}

/* ------------------------------------------------------------------ 1 · Fourier reconstruction */

/** A wobbly "letter-like" closed signal: a rounded square with a notch and a little texture. */
function signal(t: number) {
  const sq = Math.pow(Math.abs(Math.cos(t)) ** 6 + Math.abs(Math.sin(t)) ** 6, -1 / 6); // superellipse radius
  const u = ((t - 0.8 + Math.PI * 2) % (Math.PI * 2)) - Math.PI;
  const notch = -0.35 * Math.exp(-(u * u) * 60);
  const texture = 0.03 * Math.sin(37 * t) + 0.02 * Math.sin(61 * t + 1);
  return sq + notch + texture;
}

export function FourierDemo() {
  const N = 512;
  const [H, setH] = useState(6);
  const data = useMemo(() => {
    const x = Array.from({ length: N }, (_, n) => signal((2 * Math.PI * n) / N));
    // exact DFT of the samples (N is small: O(N²) is fine here)
    const re = new Float64Array(N / 2 + 1), im = new Float64Array(N / 2 + 1);
    for (let k = 0; k <= N / 2; k++) {
      let a = 0, b = 0;
      for (let n = 0; n < N; n++) { const ang = (2 * Math.PI * k * n) / N; a += x[n] * Math.cos(ang); b -= x[n] * Math.sin(ang); }
      re[k] = a; im[k] = b;
    }
    return { x, re, im };
  }, []);
  const rec = useMemo(() => {
    const out = new Float64Array(N);
    for (let n = 0; n < N; n++) {
      let s = data.re[0] / N;
      for (let k = 1; k <= Math.min(H, N / 2); k++) {
        const ang = (2 * Math.PI * k * n) / N;
        const sc = k === N / 2 ? 1 / N : 2 / N;
        s += sc * (data.re[k] * Math.cos(ang) - data.im[k] * Math.sin(ang));
      }
      out[n] = s;
    }
    return out;
  }, [data, H]);
  const err = Math.sqrt(data.x.reduce((s, v, i) => s + (v - rec[i]) ** 2, 0) / N);
  const path = (r: ArrayLike<number>) =>
    Array.from({ length: N }, (_, n) => {
      const t = (2 * Math.PI * n) / N;
      return `${n ? "L" : "M"}${(150 + 95 * r[n] * Math.cos(t)).toFixed(1)} ${(150 - 95 * r[n] * Math.sin(t)).toFixed(1)}`;
    }).join("") + "Z";
  return (
    <DemoFrame title="Rebuild an outline from waves" hint="drag the slider: every harmonic is one more rotating circle">
      <div className="grid items-center gap-6 md:grid-cols-[300px_1fr]">
        <svg viewBox="0 0 300 300" className="mx-auto w-full max-w-[300px]">
          <path d={path(data.x)} fill="none" stroke="var(--muted)" strokeWidth={1} strokeDasharray="3 3" />
          <path d={path(rec)} fill="color-mix(in srgb, var(--accent) 14%, transparent)" stroke="var(--accent)" strokeWidth={2} />
        </svg>
        <div className="space-y-4">
          <Range label="harmonics H" value={H} min={0} max={256} step={1} onChange={setH} />
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-xl bg-sunken p-3"><div className="text-xs text-muted">RMS error</div><div className="font-mono text-lg">{err.toExponential(2)}</div></div>
            <div className="rounded-xl bg-sunken p-3"><div className="text-xs text-muted">numbers stored</div><div className="font-mono text-lg">{1 + 2 * H}</div></div>
          </div>
          <p className="text-sm leading-relaxed text-muted">
            With a handful of harmonics you already get the <b className="text-ink">shape</b>; the notch needs dozens; the fine texture
            needs hundreds. At H = N/2 = 256 the reconstruction hits every sample to machine precision — this is the
            “exact wave function” KHarbonCopy stores for each contour. Watch the ringing near the notch at mid values: that is the
            Gibbs phenomenon.
          </p>
        </div>
      </div>
    </DemoFrame>
  );
}

/* ------------------------------------------------------------------ 2 · the wave function O(φ) on an "o" */

export function WaveDemo() {
  const [w, setW] = useState(10);
  const [c2, setC2] = useState(-8);
  const [tilt, setTilt] = useState(-20);
  const [k4, setK4] = useState(0);
  const O = (phi: number) => w + c2 * Math.cos(2 * (phi - (tilt * Math.PI) / 180)) + k4 * Math.cos(4 * phi);
  const ring = (R: number, sign: 1 | -1) => {
    const N = 240;
    return Array.from({ length: N }, (_, i) => {
      const t = (2 * Math.PI * i) / N;
      // outward normal of the ink: outer contour → radial, counter → towards the centre
      const phi = sign === 1 ? t : t + Math.PI;
      const r = R + sign * O(phi);
      return `${i ? "L" : "M"}${(150 + r * Math.cos(t)).toFixed(1)} ${(150 - r * Math.sin(t) * 1.15).toFixed(1)}`;
    }).join("") + "Z";
  };
  return (
    <DemoFrame title="One function, a whole typographic personality" hint="O(φ) moves every edge along its normal, depending on the edge direction φ">
      <div className="grid items-center gap-6 md:grid-cols-[300px_1fr]">
        <svg viewBox="0 0 300 300" className="mx-auto w-full max-w-[300px]">
          <path d={`M${150 + 95} 150 A95 109 0 1 0 ${150 - 95} 150 A95 109 0 1 0 ${150 + 95} 150 Z M${150 + 55} 150 A55 63 0 1 1 ${150 - 55} 150 A55 63 0 1 1 ${150 + 55} 150 Z`}
            fill="none" stroke="var(--muted)" strokeDasharray="3 3" />
          <path d={ring(95, 1) + ring(55, -1)} fill="color-mix(in srgb, var(--accent) 22%, transparent)" fillRule="evenodd" stroke="var(--accent)" strokeWidth={1.6} />
        </svg>
        <div className="grid gap-4 sm:grid-cols-2">
          <Range label="a₀ · weight" value={w} min={-20} max={30} step={1} onChange={setW} fmt={(v) => `${v} u`} />
          <Range label="a₂ · contrast" value={c2} min={-20} max={20} step={1} onChange={setC2} fmt={(v) => `${v} u`} />
          <Range label="stress axis" value={tilt} min={-60} max={60} step={1} onChange={setTilt} fmt={(v) => `${v}°`} />
          <Range label="a₄ · squareness" value={k4} min={-10} max={10} step={1} onChange={setK4} fmt={(v) => `${v} u`} />
          <p className="text-sm leading-relaxed text-muted sm:col-span-2">
            The constant term is <b className="text-ink">weight</b>; cos 2φ makes vertical strokes thicker than horizontal ones
            (<b className="text-ink">contrast</b>); shifting its phase tilts the <b className="text-ink">stress axis</b> like a broad-nib pen;
            cos 4φ pushes diagonals in or out (<b className="text-ink">squareness</b>). A serif, a grotesque and a slab differ mostly in these few numbers.
          </p>
        </div>
      </div>
    </DemoFrame>
  );
}

/* ------------------------------------------------------------------ 3 · signed distance field */

export function DistanceDemo() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [probe, setProbe] = useState<{ x: number; y: number } | null>({ x: 210, y: 70 });
  // an "L"-like polygon (ink-left, counter-clockwise)
  const poly = useMemo(() => [[60, 40], [110, 40], [110, 200], [230, 200], [230, 250], [60, 250]] as [number, number][], []);
  const nearest = (px: number, py: number) => {
    let best = { d: Infinity, x: 0, y: 0 };
    for (let i = 0; i < poly.length; i++) {
      const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
      const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
      const t = Math.max(0, Math.min(1, ((px - ax) * ex + (py - ay) * ey) / l2));
      const x = ax + ex * t, y = ay + ey * t, d = Math.hypot(px - x, py - y);
      if (d < best.d) best = { d, x, y };
    }
    return best;
  };
  const inside = (px: number, py: number) => {
    let w = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) w = !w;
    }
    return w;
  };
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const img = ctx.createImageData(300, 300);
    for (let y = 0; y < 300; y++)
      for (let x = 0; x < 300; x++) {
        const n = nearest(x + 0.5, y + 0.5);
        const s = inside(x + 0.5, y + 0.5) ? -n.d : n.d;
        const band = Math.abs((s / 12) % 1) < 0.08; // iso-distance lines every 12 px
        const k = (y * 300 + x) * 4;
        const v = Math.max(0, Math.min(1, 0.5 + s / 120));
        img.data[k] = s < 0 ? 211 * (1 - v) + 40 : 47 + 80 * v;
        img.data[k + 1] = s < 0 ? 64 : 91 + 60 * v;
        img.data[k + 2] = s < 0 ? 47 : 211;
        img.data[k + 3] = band ? 255 : 130;
      }
    ctx.putImageData(img, 0, 0);
  }, [poly]); // eslint-disable-line react-hooks/exhaustive-deps
  const n = probe ? nearest(probe.x, probe.y) : null;
  const sd = probe && n ? (inside(probe.x, probe.y) ? -n.d : n.d) : 0;
  return (
    <DemoFrame title="A map of distances" hint="move the pointer: the line is the exact nearest-feature query">
      <div className="grid items-center gap-6 md:grid-cols-[300px_1fr]">
        <div className="relative mx-auto w-full max-w-[300px]">
          <canvas ref={canvas} width={300} height={300} className="block w-full rounded-lg"
            onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setProbe({ x: ((e.clientX - r.left) / r.width) * 300, y: ((e.clientY - r.top) / r.height) * 300 }); }} />
          <svg viewBox="0 0 300 300" className="pointer-events-none absolute inset-0 h-full w-full">
            <polygon points={poly.map((p) => p.join(",")).join(" ")} fill="none" stroke="var(--ink)" strokeWidth={2} />
            {probe && n && <>
              <line x1={probe.x} y1={probe.y} x2={n.x} y2={n.y} stroke="var(--ink)" strokeWidth={1.5} strokeDasharray="4 3" />
              <circle cx={probe.x} cy={probe.y} r={4} fill="var(--ink)" />
              <circle cx={n.x} cy={n.y} r={3} fill="var(--brand-red)" />
            </>}
          </svg>
        </div>
        <div className="space-y-3 text-sm leading-relaxed text-muted">
          <div className="rounded-xl bg-sunken p-3"><div className="text-xs">signed distance</div><div className="font-mono text-lg text-ink">{sd.toFixed(2)} px {sd < 0 ? "(inside the ink)" : "(outside)"}</div></div>
          <p>
            Every pixel knows how far it is from the outline — negative inside, positive outside. KHarbonCopy builds this map once per
            source glyph (storing the <i>id</i> of the nearest segment, not a rounded number) and then answers each of the
            ~millions of queries of an analysis exactly, about 30× faster than searching the outline every time.
          </p>
        </div>
      </div>
    </DemoFrame>
  );
}

/* ------------------------------------------------------------------ 4 · line search with a parabola */

export function LineSearchDemo() {
  const [shape, setShape] = useState(1.6);
  const f = (a: number) => 1 - 0.9 * Math.exp(-((a - shape) ** 2) / 1.4) + 0.04 * a;
  const probes = [0, 1, f(1) < f(0) ? 2 : 0.5];
  const fin = probes.map((a) => ({ a, v: f(a) })).sort((p, q) => p.a - q.a);
  const [p1, p2, p3] = fin;
  const den = (p1.a - p2.a) * (p1.a - p3.a) * (p2.a - p3.a);
  const A = (p3.a * (p2.v - p1.v) + p2.a * (p1.v - p3.v) + p1.a * (p3.v - p2.v)) / den;
  const B = (p3.a * p3.a * (p1.v - p2.v) + p2.a * p2.a * (p3.v - p1.v) + p1.a * p1.a * (p2.v - p3.v)) / den;
  const C = p1.v - A * p1.a * p1.a - B * p1.a;
  const av = A > 0 ? -B / (2 * A) : NaN;
  const X = (a: number) => 30 + a * 90, Y = (v: number) => 230 - v * 190;
  const curve = Array.from({ length: 121 }, (_, i) => { const a = i / 30; return `${i ? "L" : "M"}${X(a)} ${Y(f(a))}`; }).join("");
  const para = Array.from({ length: 121 }, (_, i) => { const a = i / 30; return `${i ? "L" : "M"}${X(a)} ${Y(A * a * a + B * a + C)}`; }).join("");
  return (
    <DemoFrame title="How far should a correction go?" hint="three probes, one parabola, one smart guess">
      <div className="grid items-center gap-6 md:grid-cols-[1fr_280px]">
        <svg viewBox="0 0 420 250" className="w-full">
          <line x1={30} x2={410} y1={230} y2={230} stroke="var(--line)" />
          {[0, 1, 2, 3, 4].map((a) => <text key={a} x={X(a)} y={246} fontSize={11} fill="var(--muted)" textAnchor="middle">α={a}</text>)}
          <path d={curve} fill="none" stroke="var(--muted)" strokeWidth={2} />
          <path d={para} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeDasharray="5 4" />
          {fin.map((p) => <circle key={p.a} cx={X(p.a)} cy={Y(p.v)} r={5} fill="var(--accent)" />)}
          {isFinite(av) && av > 0 && av < 4.3 && <><line x1={X(av)} x2={X(av)} y1={20} y2={230} stroke="var(--brand-red)" strokeDasharray="3 3" /><circle cx={X(av)} cy={Y(f(av))} r={6} fill="var(--brand-red)" /></>}
        </svg>
        <div className="space-y-3 text-sm leading-relaxed text-muted">
          <Range label="where the true minimum is" value={shape} min={0.3} max={3.8} step={0.05} onChange={setShape} />
          <p>
            The error along a correction direction (grey) is unknown, and every evaluation costs a full re-measurement of the font.
            KHarbonCopy probes α = 0, 1 and then 2 or ½, fits the parabola through them (blue) and jumps to its vertex (red).
            Old version: always α = 1, halve on failure — it crawled. Now steps of 2–5× are common.
          </p>
        </div>
      </div>
    </DemoFrame>
  );
}
