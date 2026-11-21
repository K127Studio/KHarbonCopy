import React from "react";

/** Project name: only the initials K, H and C use the brand typeface (opiated).
 *  A hairline gap (em-relative, scales with size) separates brand letters from regular ones. */
export default function Wordmark({ className }: { className?: string }) {
  return (
    <span className={className}>
      <span className="font-brand text-brand-red">K</span>
      <span className="font-brand text-accent mr-[0.04em]">H</span>
      arbon
      <span className="font-brand mx-[0.04em]">C</span>
      opy
    </span>
  );
}
