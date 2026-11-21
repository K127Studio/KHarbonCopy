"use client";
import React, { useEffect, useState } from "react";
import LinkButton from "./LinkButton";

interface Curiosity {
  id: number;
  category: string;
  fact: string;
}

let cache: Curiosity[] | null = null;
/** index of the next curiosity to show: shared by every overlay of the session, so the Khmer
 *  generation continues where the analysis stopped instead of repeating the same facts */
let cursor = 0;
const ROTATE_MS = 12000;

/** "stage · g" progress messages: the glyph being processed is shown big, in brand red */
export function ProgressMsg({ msg, glyphClass = "" }: { msg: string; glyphClass?: string }) {
  const m = /^(.*?) · (\S)$/u.exec(msg);
  if (!m) return <>{msg}</>;
  return <>{m[1]} — <span className={`font-semibold text-brand-red ${glyphClass}`}>{m[2]}</span></>;
}

/** Full-screen overlay for the long phases (analysis, Khmer generation) cycling through curiosities. */
export default function LoadingOverlay({ title, msg, frac, estimate }: { title: string; msg: string; frac: number; estimate?: number }) {
  const [facts, setFacts] = useState<Curiosity[]>(cache ?? []);
  const [i, setI] = useState(() => cursor);
  const [visible, setVisible] = useState(true);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (cache) return;
    fetch("/curiosities.json")
      .then((r) => r.json())
      .then((d: Curiosity[]) => {
        // shuffle once per session so every run starts somewhere new
        cache = d.map((x) => [Math.random(), x] as const).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
        setFacts(cache);
      })
      .catch(() => setFacts([]));
  }, []);

  useEffect(() => {
    if (!facts.length) return;
    const t = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setI((k) => (k + 1) % facts.length); setVisible(true); }, 500);
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [facts.length]);
  // remember where we are; the next overlay starts from the fact after the last one shown
  useEffect(() => {
    if (facts.length) cursor = (i + 1) % facts.length;
  }, [i, facts.length]);

  useEffect(() => {
    const t0 = Date.now();
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  const f = facts.length ? facts[i % facts.length] : undefined;
  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
  // remaining time: blend the a-priori estimate with the observed progress rate
  let remaining: number | null = null;
  if (estimate && estimate > 0) {
    const byRate = frac > 0.05 ? (elapsed / frac) * (1 - frac) : Infinity;
    remaining = Math.max(0, Math.min(estimate - elapsed, isFinite(byRate) ? (byRate + Math.max(0, estimate - elapsed)) / 2 : Infinity));
    if (!isFinite(remaining)) remaining = Math.max(0, estimate - elapsed);
  }

  return (
    <div className="fixed inset-0 z-30 flex flex-col bg-bg/90 backdrop-blur-md">
      {/* status bar */}
      <div className="mx-auto mt-10 w-full max-w-5xl px-6">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/logo.png" alt="" className="h-12 w-auto shrink-0" />
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold tracking-tight">{title}</div>
            <div className="truncate font-mono text-sm text-muted"><ProgressMsg msg={msg} glyphClass="text-base" /></div>
          </div>
          <div className="shrink-0 text-right font-mono text-xs text-muted">
            <div className="text-2xl font-semibold text-ink">{frac > 0 ? `${Math.round(frac * 100)}%` : "…"}</div>
            <div>
              elapsed {fmt(elapsed)}
              {remaining != null && <> · ~{fmt(remaining)} left</>}
            </div>
          </div>
        </div>
        <div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-line">
          {frac > 0
            ? <div className="h-full rounded-full bg-accent transition-all duration-500" style={{ width: `${Math.round(frac * 100)}%` }} />
            : <div className="absolute inset-y-0 w-1/3 rounded-full bg-accent" style={{ animation: "indeterminate 1.1s ease-in-out infinite" }} />}
        </div>
      </div>

      {/* curiosity */}
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 pb-16">
        {f && (
          <div className={`transition-opacity duration-500 ${visible ? "opacity-100" : "opacity-0"}`}>
            <div className="mb-5 flex items-center gap-3">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">Did you know?</span>
              <span className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs font-medium text-accent">{f.category}</span>
            </div>
            <p className="text-2xl font-medium leading-snug tracking-tight text-ink sm:text-3xl lg:text-4xl lg:leading-[1.25]">{f.fact}</p>
          </div>
        )}
        {facts.length > 1 && (
          <div className="mt-10 flex items-center gap-1.5">
            {Array.from({ length: Math.min(facts.length, 16) }, (_, k) => (
              <span key={k} className={`h-1 rounded-full transition-all duration-500 ${k === i % Math.min(facts.length, 16) ? "w-8 bg-accent" : "w-1.5 bg-line"}`} />
            ))}
            <span className="ml-3 font-mono text-[11px] text-muted">{(i % facts.length) + 1} / {facts.length}</span>
          </div>
        )}
        <LinkButton href="/how-it-works" variant="red" size="md" external className="mt-10 w-fit">
          While you wait: how Fourier series, distance fields and line searches shape your font
        </LinkButton>
      </div>
    </div>
  );
}
