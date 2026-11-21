import React from "react";

/** Tilt of a section number: -30° plus a jitter in [-8°, +8°].
 *  Seeded by the number itself, so server and client render the same angle (no hydration mismatch). */
export function numberTilt(n: string): number {
  const x = Math.sin(Number(n) * 12.9898 + 78.233) * 43758.5453;
  const r = x - Math.floor(x); // pseudo-random in [0, 1)
  return Math.round((-18 + (r * 2 - 1) * 8) * 10) / 10;
}

/**
 * Section heading with an oversized, tilted, 25 %-opacity number sitting half behind it and half in the left gutter.
 * The rotated number spans ~±90px vertically (sm: ±100px): the parent section needs ≥ 80px top padding (sm: 96px)
 * to keep it clear of the divider above, and an `overflow-x-clip` ancestor so it never causes horizontal scroll.
 */
export default function SectionHeading({ n, title, sidebarLeft = false }: {
  n: string; title: React.ReactNode;
  /** a sticky index sits just left of the content (≥ lg): pull the number in so it does not run under it */
  sidebarLeft?: boolean;
}) {
  return (
    <div className="relative isolate">
      <span aria-hidden
        className={`pointer-events-none absolute left-0 top-1/2 -z-10 -translate-x-[12%] -translate-y-1/2 select-none font-mono text-[6rem] font-bold leading-none tracking-tighter text-accent opacity-25 sm:-translate-x-[35%] sm:text-[8rem] ${sidebarLeft ? "lg:-translate-x-[2%]" : ""}`}
        style={{ rotate: `${numberTilt(n)}deg` }}>
        {n}
      </span>
      <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
    </div>
  );
}
