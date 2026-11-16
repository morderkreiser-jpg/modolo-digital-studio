"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
import { useRegion } from "@/components/use-region";

// Region-aware bits of the hero (SPEC §2.9 «Italy region»). The server renders the CH value; after
// hydration useRegion() reads the MDS_REGION cookie and swaps to the IT value in place. Both values
// are computed on the server, so these islands ship no copy and no price table.

export function RegionText({ ch, it }: { ch: string; it: string }) {
  return <>{useRegion() === "it" ? it : ch}</>;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  hrefCh: string;
  hrefIt: string;
  children: ReactNode;
};

export function RegionLink({ hrefCh, hrefIt, children, ...rest }: LinkProps) {
  return (
    <a href={useRegion() === "it" ? hrefIt : hrefCh} {...rest}>
      {children}
    </a>
  );
}
