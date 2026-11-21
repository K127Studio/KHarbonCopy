"use client";
import React from "react";

export function ringsPath(rings: Float32Array[] | undefined): string {
  if (!rings) return "";
  let d = "";
  for (const r of rings) {
    if (r.length < 6) continue;
    d += `M${r[0].toFixed(1)} ${r[1].toFixed(1)}`;
    for (let i = 2; i < r.length; i += 2) d += `L${r[i].toFixed(1)} ${r[i + 1].toFixed(1)}`;
    d += "Z";
  }
  return d;
}

export interface Series {
  x: ArrayLike<number>;
  y: ArrayLike<number>;
  color: string;
  label?: string;
  width?: number;
  dash?: string;
}

const nice = (v: number) => {
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1000 || a < 0.01) return v.toExponential(1);
  return a >= 10 ? v.toFixed(0) : a >= 1 ? v.toFixed(1) : v.toFixed(2);
};

export function LinePlot({
  series, width = 520, height = 200, logX = false, logY = false, xLabel, yLabel, zeroLine = true, yRange,
}: {
  series: Series[]; width?: number; height?: number; logX?: boolean; logY?: boolean; xLabel?: string; yLabel?: string;
  zeroLine?: boolean; yRange?: [number, number];
}) {
  const pad = { l: 44, r: 10, t: 10, b: 26 };
  const tx = (v: number) => (logX ? Math.log10(Math.max(v, 1e-12)) : v);
  const ty = (v: number) => (logY ? Math.log10(Math.max(v, 1e-12)) : v);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const s of series)
    for (let i = 0; i < s.x.length; i++) {
      if (!isFinite(s.y[i]) || !isFinite(s.x[i])) continue;
      x0 = Math.min(x0, tx(s.x[i])); x1 = Math.max(x1, tx(s.x[i]));
      y0 = Math.min(y0, ty(s.y[i])); y1 = Math.max(y1, ty(s.y[i]));
    }
  if (yRange) { y0 = ty(yRange[0]); y1 = ty(yRange[1]); }
  if (!isFinite(x0)) return <svg className="chart" viewBox={`0 0 ${width} ${height}`} />;
  if (x1 === x0) x1 = x0 + 1;
  if (y1 === y0) { y1 += 1; y0 -= 1; }
  const X = (v: number) => pad.l + ((tx(v) - x0) / (x1 - x0)) * (width - pad.l - pad.r);
  const Y = (v: number) => height - pad.b - ((ty(v) - y0) / (y1 - y0)) * (height - pad.t - pad.b);
  const ticks = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + ((b - a) * i) / n);
  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`}>
      <rect x={pad.l} y={pad.t} width={width - pad.l - pad.r} height={height - pad.t - pad.b} fill="none" stroke="var(--line)" />
      {ticks(y0, y1, 4).map((t, i) => (
        <g key={"y" + i}>
          <line x1={pad.l} x2={width - pad.r} y1={Y(logY ? 10 ** t : t)} y2={Y(logY ? 10 ** t : t)} stroke="var(--line)" strokeDasharray="2 3" />
          <text x={pad.l - 4} y={Y(logY ? 10 ** t : t) + 3} textAnchor="end">{nice(logY ? 10 ** t : t)}</text>
        </g>
      ))}
      {ticks(x0, x1, 5).map((t, i) => (
        <text key={"x" + i} x={X(logX ? 10 ** t : t)} y={height - pad.b + 13} textAnchor="middle">{nice(logX ? 10 ** t : t)}</text>
      ))}
      {zeroLine && !logY && y0 < 0 && y1 > 0 && <line x1={pad.l} x2={width - pad.r} y1={Y(0)} y2={Y(0)} stroke="var(--muted)" strokeWidth={0.6} />}
      {series.map((s, k) => {
        let d = "";
        let pen = false;
        for (let i = 0; i < s.x.length; i++) {
          if (!isFinite(s.y[i])) { pen = false; continue; }
          d += `${pen ? "L" : "M"}${X(s.x[i]).toFixed(1)} ${Y(s.y[i]).toFixed(1)}`;
          pen = true;
        }
        return <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.2} strokeDasharray={s.dash} />;
      })}
      {xLabel && <text x={width - pad.r} y={height - 2} textAnchor="end">{xLabel}</text>}
      {yLabel && <text x={4} y={pad.t + 8}>{yLabel}</text>}
      {series.some((s) => s.label) && (
        <g>
          {series.filter((s) => s.label).map((s, i) => (
            <g key={i} transform={`translate(${pad.l + 8 + i * 120}, ${pad.t + 10})`}>
              <line x1={0} x2={14} y1={-3} y2={-3} stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} />
              <text x={18} y={0}>{s.label}</text>
            </g>
          ))}
        </g>
      )}
    </svg>
  );
}

/** O(φ) drawn as a radial offset of a circle: radius = weight, shape = stress/contrast. Several curves overlay. */
export function PolarPlot({ fns, size = 220 }: { fns: { fn: (phi: number) => number; color: string; label?: string }[]; size?: number }) {
  const N = 360;
  const all = fns.map((f) => Array.from({ length: N + 1 }, (_, i) => f.fn((i / N) * 2 * Math.PI)));
  const m = Math.max(1e-6, ...all.flat().map(Math.abs));
  const R = size * 0.28;
  const k = (size * 0.17) / m;
  const c = size / 2;
  const pt = (phi: number, r: number) => `${(c + r * Math.cos(phi)).toFixed(1)} ${(c - r * Math.sin(phi)).toFixed(1)}`;
  return (
    <svg className="chart" viewBox={`0 0 ${size} ${size}`} style={{ maxWidth: size }}>
      <circle cx={c} cy={c} r={R} fill="none" stroke="var(--muted)" strokeDasharray="3 3" />
      <line x1={c - R - 30} x2={c + R + 30} y1={c} y2={c} stroke="var(--line)" />
      <line y1={c - R - 30} y2={c + R + 30} x1={c} x2={c} stroke="var(--line)" />
      {all.map((vals, j) => (
        <path key={j} d={vals.map((v, i) => `${i ? "L" : "M"}${pt((i / N) * 2 * Math.PI, R + v * k)}`).join("") + "Z"}
          fill={j === 0 ? "color-mix(in srgb, var(--accent) 10%, transparent)" : "none"} stroke={fns[j].color} strokeWidth={1.4} />
      ))}
      <text x={c + R + 8} y={c - 4}>φ=0</text>
      <text x={c + 4} y={c - R - 12}>φ=90°</text>
      <text x={4} y={size - 6}>max |O| {m.toFixed(2)} u</text>
      {fns.map((f, j) => f.label && (
        <g key={"l" + j} transform={`translate(${size - 62}, ${12 + j * 12})`}>
          <line x1={0} x2={10} y1={-3} y2={-3} stroke={f.color} strokeWidth={2} />
          <text x={14} y={0}>{f.label}</text>
        </g>
      ))}
    </svg>
  );
}

/** Diverging heatmap of a G×G grid (row-major [v][u], v up). */
export function Heatmap({ G, data, size = 160, title }: { G: number; data: number[]; size?: number; title?: string }) {
  const m = Math.max(1e-9, ...data.map(Math.abs));
  const cell = size / G;
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${size} ${size + 14}`} style={{ maxWidth: size }}>
        {data.map((v, i) => {
          const u = i % G, vv = Math.floor(i / G);
          const t = v / m;
          const col = t >= 0 ? `rgba(211,64,47,${Math.abs(t).toFixed(3)})` : `rgba(47,91,211,${Math.abs(t).toFixed(3)})`;
          return <rect key={i} x={u * cell} y={(G - 1 - vv) * cell} width={cell + 0.3} height={cell + 0.3} fill={col} />;
        })}
        <rect x={0} y={0} width={size} height={size} fill="none" stroke="var(--line)" />
        <text x={2} y={size + 11}>{title} ±{m < 0.1 ? m.toFixed(4) : m.toFixed(3)}</text>
      </svg>
    </figure>
  );
}
