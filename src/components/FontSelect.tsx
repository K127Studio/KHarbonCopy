"use client";
import React, { useEffect, useRef, useState } from "react";
import { cx } from "./ui";

export interface FontOption {
  id: string;
  label: string;
  /** small grey text after the label (category, style…) */
  meta?: string;
  /** font file used for the preview */
  url: string;
  /** preview text rendered in the font itself */
  sample: string;
}

/** url → registered FontFace family (shared by every FontSelect on the page) */
const faces = new Map<string, Promise<string | null>>();
let seq = 0;
function useFace(url: string | undefined, enabled: boolean) {
  const [family, setFamily] = useState<string | null>(null);
  useEffect(() => {
    if (!url || !enabled) return;
    let alive = true;
    let p = faces.get(url);
    if (!p) {
      const name = `fs-preview-${++seq}`;
      p = new FontFace(name, `url("${url}")`, { display: "swap" }).load().then((f) => { document.fonts.add(f); return name; }).catch(() => null);
      faces.set(url, p);
    }
    p.then((n) => { if (alive) setFamily(n); });
    return () => { alive = false; };
  }, [url, enabled]);
  return family;
}

function Preview({ opt, active, big }: { opt: FontOption; active: boolean; big?: boolean }) {
  const family = useFace(opt.url, active);
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className={cx("truncate transition-opacity", family ? "opacity-100" : "opacity-40")}
        style={{ fontFamily: family ?? undefined, fontSize: big ? 20 : 19, lineHeight: 1.3 }}>{opt.sample}</span>
      <span className="truncate font-sans text-[11px] leading-tight text-muted">
        <span className="text-ink">{opt.label}</span>{opt.meta ? ` · ${opt.meta}` : ""}{!family && active ? " · loading…" : ""}
      </span>
    </span>
  );
}

/** Select whose button and options are rendered in the font they represent (fonts load on demand). */
export default function FontSelect({ label, value, options, onChange }: {
  label: string; value: string; options: FontOption[]; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.id === value) ?? options[0];
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={ref} className="relative flex flex-col gap-1 text-xs text-muted">
      {label}
      <button type="button" onClick={() => setOpen((v) => !v)}
        className={cx("flex w-full flex-1 items-center gap-2 rounded-lg border bg-sunken px-2.5 py-1.5 text-left text-ink outline-none transition",
          open ? "border-accent" : "border-line hover:border-muted")}>
        {current ? <Preview opt={current} active big /> : <span className="flex-1">—</span>}
        <span className="shrink-0 text-muted">▾</span>
      </button>
      {open && (
        <ul className="scroll-thin absolute left-0 top-full z-40 mt-1 max-h-96 w-[max(100%,320px)] overflow-y-auto rounded-xl border border-line bg-panel p-1 shadow-card">
          {options.map((o) => (
            <li key={o.id}>
              <button type="button" onClick={() => { onChange(o.id); setOpen(false); }}
                className={cx("flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-ink transition",
                  o.id === value ? "bg-accent/10" : "hover:bg-sunken")}>
                <Preview opt={o} active={open} />
                {o.id === value && <span className="shrink-0 text-accent">✓</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
