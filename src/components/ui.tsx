"use client";
import React, { useRef, useState } from "react";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

export function Card({ title, subtitle, step, right, children, className, id }: {
  title?: React.ReactNode; subtitle?: React.ReactNode; step?: number; right?: React.ReactNode; children: React.ReactNode; className?: string; id?: string;
}) {
  return (
    <section id={id} className={cx("scroll-mt-24 rounded-2xl border border-line bg-panel p-5 shadow-card sm:p-6", className)}>
      {(title || right) && (
        <header className="mb-5 flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div className="flex items-start gap-3">
            {step != null && (
              <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-accent text-xs font-bold text-accent-ink">{step}</span>
            )}
            <div>
              <h2 className="text-base font-semibold tracking-tight">{title}</h2>
              {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
            </div>
          </div>
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

/** Horizontal step indicator for the 4-screen workflow (completed / available steps are clickable). */
export function Stepper({ steps, current, onSelect }: {
  steps: { label: string; done: boolean; enabled: boolean }[]; current: number; onSelect: (i: number) => void;
}) {
  return (
    <ol className="flex items-center gap-1.5 text-[11px]">
      {steps.map((s, i) => (
        <li key={s.label} className="flex items-center gap-1.5">
          {i > 0 && <span className={cx("h-px w-3 sm:w-6", i <= current ? "bg-accent" : "bg-line")} />}
          <button
            disabled={!s.enabled}
            onClick={() => onSelect(i)}
            className={cx(
              "flex items-center gap-1.5 rounded-full border px-2 py-1 transition disabled:cursor-not-allowed disabled:opacity-45",
              i === current ? "border-accent bg-accent text-accent-ink shadow-sm" : s.done ? "border-accent/30 bg-accent/10 text-accent hover:bg-accent/15" : "border-line text-muted hover:text-ink",
            )}>
            <span className={cx("grid size-4 place-items-center rounded-full text-[9px] font-bold",
              i === current ? "bg-accent-ink/20" : s.done ? "bg-accent text-accent-ink" : "bg-sunken")}>
              {s.done && i !== current ? "✓" : i + 1}
            </span>
            <span className="hidden sm:inline">{s.label}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** Big number with label. */
export function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className="rounded-xl border border-line bg-sunken/60 px-3.5 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-muted">{label}</div>
      <div className={cx("mt-1 font-mono text-xl font-semibold tracking-tight",
        tone === "good" && "text-good", tone === "warn" && "text-warn", tone === "bad" && "text-src")}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

/** Inline proportional bar (0..1). */
export function Bar({ value, tone = "accent" }: { value: number; tone?: "accent" | "src" | "good" }) {
  const v = Math.max(0, Math.min(1, isFinite(value) ? value : 0));
  return (
    <span className="inline-block h-1.5 w-16 overflow-hidden rounded-full bg-line align-middle">
      <span className={cx("block h-full rounded-full", tone === "accent" && "bg-accent", tone === "src" && "bg-src", tone === "good" && "bg-good")} style={{ width: `${v * 100}%` }} />
    </span>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2.5 mt-6 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted first:mt-0">{children}</h3>;
}

export function Button({ variant = "default", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "default" | "primary" | "ghost" }) {
  return (
    <button
      {...p}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40",
        variant === "primary" && "bg-accent text-accent-ink shadow-sm hover:brightness-110",
        variant === "default" && "border border-line bg-panel hover:border-muted hover:bg-sunken",
        variant === "ghost" && "text-muted hover:text-ink",
        className,
      )}
    />
  );
}

export function Select({ label, children, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {/* flex-1: next to a taller control (FontSelect) in a grid row, both end up the same height */}
      <select {...p} className="min-h-[38px] flex-1 rounded-lg border border-line bg-sunken px-2.5 py-2 text-sm text-ink outline-none focus:border-accent">
        {children}
      </select>
    </label>
  );
}

export function TextField({ label, multiline, ...p }: { label: string; multiline?: boolean; value: string; onChange: (v: string) => void; maxLength?: number; rows?: number }) {
  const cls = "w-full rounded-lg border border-line bg-sunken px-2.5 py-2 text-sm text-ink outline-none focus:border-accent";
  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      {multiline ? (
        <textarea rows={p.rows ?? 2} value={p.value} onChange={(e) => p.onChange(e.target.value)} className={cls} />
      ) : (
        <input type="text" value={p.value} maxLength={p.maxLength} onChange={(e) => p.onChange(e.target.value)} className={cls} />
      )}
    </label>
  );
}

export function Slider({ label, value, min, max, step, onChange, fmt, hint }: {
  label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string; hint?: string;
}) {
  return (
    <label className="block text-xs" title={hint}>
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate text-muted">{label}</span>
        <span className="shrink-0 font-mono text-[11px] text-ink">{fmt ? fmt(value) : value}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} className="mt-1 w-full" />
    </label>
  );
}

export function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="size-3.5 accent-[var(--accent)]" />
      {label}
    </label>
  );
}

export function Tabs<T extends string | number>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-line bg-sunken p-1">
      {items.map((it) => (
        <button
          key={String(it.id)}
          onClick={() => onChange(it.id)}
          className={cx("rounded-md px-2.5 py-1 text-xs transition", value === it.id ? "bg-panel font-semibold text-ink shadow-sm" : "text-muted hover:text-ink")}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Grid that shows as many items as fit in the available space and pages the rest
 * (no scrollbars): the cell size is fixed, the column and row counts follow the container.
 * The mouse wheel also turns pages.
 */
export function PagedGrid<T>({ items, render, minW, itemH, gap = 10, page, onPage }: {
  items: T[]; render: (item: T) => React.ReactNode; minW: number; itemH: number; gap?: number; page: number; onPage: (p: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [dim, setDim] = React.useState({ cols: 1, rows: 1 });
  const lastWheel = React.useRef(0);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setDim({
      cols: Math.max(1, Math.floor((el.clientWidth + gap) / (minW + gap))),
      rows: Math.max(1, Math.floor((el.clientHeight + gap) / (itemH + gap))),
    });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [minW, itemH, gap]);
  const per = dim.cols * dim.rows;
  const pages = Math.max(1, Math.ceil(items.length / per));
  const p = Math.min(Math.max(0, page), pages - 1);
  const turn = (d: number) => onPage(Math.min(pages - 1, Math.max(0, p + d)));
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden"
        onWheel={(e) => {
          const now = Date.now();
          if (pages < 2 || now - lastWheel.current < 350 || Math.abs(e.deltaY) < 8) return;
          lastWheel.current = now;
          turn(e.deltaY > 0 ? 1 : -1);
        }}>
        <div className="grid" style={{ gridTemplateColumns: `repeat(${dim.cols}, minmax(0, 1fr))`, gridAutoRows: itemH, gap }}>
          {items.slice(p * per, (p + 1) * per).map(render)}
        </div>
      </div>
      {pages > 1 && (
        <div className="flex shrink-0 items-center justify-center gap-1 text-xs">
          <button onClick={() => turn(-1)} disabled={p === 0} className="rounded-md px-2 py-1 text-muted hover:text-ink disabled:opacity-30">‹</button>
          {Array.from({ length: pages }, (_, k) => (
            <button key={k} onClick={() => onPage(k)}
              className={cx("min-w-7 rounded-md px-2 py-1 font-mono transition", k === p ? "bg-accent/15 font-semibold text-ink" : "text-muted hover:text-ink")}>
              {k + 1}
            </button>
          ))}
          <button onClick={() => turn(1)} disabled={p === pages - 1} className="rounded-md px-2 py-1 text-muted hover:text-ink disabled:opacity-30">›</button>
          <span className="ml-2 text-muted">{items.length} items · scroll to turn pages</span>
        </div>
      )}
    </div>
  );
}

export function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <React.Fragment key={k}>
          <dt className="text-muted">{k}</dt>
          <dd className="font-mono">{v}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

export function DataTable({ head, rows, highlight, struck }: { head: string[]; rows: React.ReactNode[][]; highlight?: number; struck?: (i: number) => boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} className={cx("whitespace-nowrap border-b border-line px-2 py-1.5 font-medium text-muted", i === 0 ? "text-left" : "text-right")}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={cx(i === highlight && "bg-sunken font-semibold", struck?.(i) && "text-muted line-through")}>
              {r.map((c, j) => (
                <td key={j} className={cx("whitespace-nowrap border-b border-line px-2 py-1", j === 0 ? "text-left" : "text-right font-mono")}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function DropZone({ onFile, label, sub, accept, compact, fill }: { onFile: (f: File) => void; label: string; sub?: string; accept: string; compact?: boolean; fill?: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      className={cx(
        "cursor-pointer rounded-xl border-2 border-dashed text-center transition",
        fill && "flex min-h-0 flex-1 flex-col items-center justify-center",
        compact ? "px-3 py-3 text-xs" : "px-6 py-8 text-sm",
        over ? "border-accent bg-accent/5 text-accent" : "border-line bg-sunken/40 text-muted hover:border-accent/50 hover:bg-accent/5",
      )}
    >
      {fill && <div className="mb-3 grid size-12 place-items-center rounded-full bg-accent/10 text-xl text-accent">↑</div>}
      <div className="font-medium text-ink">{label}</div>
      {sub && <div className="mt-1 text-xs">{sub}</div>}
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
    </div>
  );
}

export function Callout({ tone = "warn", children }: { tone?: "warn" | "error" | "info"; children: React.ReactNode }) {
  return (
    <div className={cx(
      "rounded-lg border px-3 py-2 text-xs leading-relaxed",
      tone === "warn" && "border-warn/40 bg-warn/10 text-ink",
      tone === "error" && "border-src/40 bg-src/10 text-ink",
      tone === "info" && "border-line bg-sunken text-muted",
    )}>
      {children}
    </div>
  );
}
