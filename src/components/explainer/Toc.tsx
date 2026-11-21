"use client";

import { useEffect, useState } from "react";

/** Sticky table of contents with scroll-spy: the entry of the section currently in view turns white (text-ink). */
export default function Toc({ items }: { items: readonly (readonly [string, string])[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      // a section is "current" once its top passes 30% of the viewport height
      const line = window.innerHeight * 0.3;
      let current: string | null = null;
      for (const [id] of items) {
        const el = document.getElementById(id);
        if (el && el.getBoundingClientRect().top <= line) current = id;
      }
      // at the very bottom the last (often short) section can never reach the line
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) current = items[items.length - 1][0];
      setActive(current);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [items]);

  return (
    <ol className="sticky top-24 space-y-1.5 border-l border-line pl-4 text-sm">
      {items.map(([id, t], i) => {
        const on = id === active;
        return (
          <li key={id}>
            <a
              href={`#${id}`}
              aria-current={on ? "location" : undefined}
              className={`transition-colors duration-200 hover:text-accent ${on ? "text-ink" : "text-muted"}`}
            >
              <span className="mr-2 font-mono text-[11px]">{String(i + 1).padStart(2, "0")}</span>{t}
            </a>
          </li>
        );
      })}
    </ol>
  );
}
