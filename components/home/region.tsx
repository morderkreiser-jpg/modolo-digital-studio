"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useRegion } from "@/components/use-region";
import type { Region } from "@/lib/region";

// The two smallest possible client islands for region-aware content inside server sections.
// The server renders both variants (they are already-formatted strings or server JSX), the client
// only picks one from the MDS_REGION cookie. SSR and hydration use CH (useRegion's server
// snapshot), then IT visitors switch: no hydration mismatch, and only the current locale's copy
// travels to the browser.

/** Renders `ch` or `it` depending on the visitor's pricing region. */
export function ByRegion({ ch, it }: { ch: ReactNode; it: ReactNode }) {
  const region = useRegion();
  return <>{region === "it" ? it : ch}</>;
}

/** An <a> whose href depends on the region (WhatsApp: CH vs IT number, CHF vs EUR prefill). */
export function RegionLink({
  href,
  children,
  ...rest
}: { href: Record<Region, string>; children: ReactNode } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href" | "children">) {
  const region = useRegion();
  return (
    <a href={href[region]} {...rest}>
      {children}
    </a>
  );
}
