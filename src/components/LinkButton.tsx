import React from "react";

/**
 * Pill-shaped link styled as a button — the single style for every link between pages
 * (navbars, calls to action). No client state, so it works in server and client components.
 *
 * Variants:  blue    — go to the tool / primary action
 *            red     — "How it works" and brand calls to action
 *            outline — secondary links (e.g. "Why")
 */
export type LinkButtonVariant = "blue" | "red" | "outline";
export type LinkButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<LinkButtonVariant, string> = {
  blue: "border-transparent bg-accent text-accent-ink shadow-sm hover:brightness-110",
  red: "border-transparent bg-brand-red text-white shadow-sm hover:brightness-110",
  outline: "border-line bg-transparent text-muted hover:border-accent hover:text-ink",
};

const SIZE: Record<LinkButtonSize, string> = {
  /** navbars */
  sm: "gap-1.5 px-3 py-1 text-[11px] font-medium",
  /** inline calls to action */
  md: "gap-2 px-5 py-2.5 text-sm font-semibold",
  /** full-width hero call to action */
  lg: "w-full gap-2 whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-[0.04em] shadow-lg sm:gap-3 sm:px-6 sm:text-base sm:tracking-[0.14em] xl:text-lg",
};

export default function LinkButton({
  href, variant = "blue", size = "sm", external = false, arrow, className = "", children,
}: {
  href: string;
  variant?: LinkButtonVariant;
  size?: LinkButtonSize;
  /** open in a new tab (keeps the tool's state) and show ↗ */
  external?: boolean;
  /** trailing arrow; defaults to ↗ when external, none otherwise */
  arrow?: "→" | "↗" | false;
  className?: string;
  children: React.ReactNode;
}) {
  const mark = arrow === undefined ? (external ? "↗" : false) : arrow;
  return (
    <a
      href={href}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      className={`group inline-flex shrink-0 items-center justify-center rounded-full border text-center transition hover:-translate-y-px active:translate-y-0 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {children}
      {mark && <span aria-hidden className="transition-transform group-hover:translate-x-0.5">{mark}</span>}
    </a>
  );
}
