"use client";

import { useSyncExternalStore } from "react";
import { DEFAULT_REGION, isRegion, type Region } from "@/lib/region";

// Read the pricing region from the MDS_REGION cookie (set by proxy.ts geo or the /prezzi toggle).
// SSR uses `initial` (default CH); the client reflects the cookie via the store, with no
// hydration mismatch — same pattern as components/pricing-page.tsx.
function read(): Region {
  if (typeof document === "undefined") return DEFAULT_REGION;
  const m = document.cookie.match(/(?:^|;\s*)MDS_REGION=(ch|it)/);
  return m && isRegion(m[1]) ? m[1] : DEFAULT_REGION;
}

function subscribe(onChange: () => void) {
  window.addEventListener("mds-region", onChange);
  return () => window.removeEventListener("mds-region", onChange);
}

export function useRegion(initial: Region = DEFAULT_REGION): Region {
  return useSyncExternalStore(subscribe, read, () => initial);
}

// wa.me deep link for the region's number (IT visitors get the Italian WhatsApp), with an
// optional pre-filled message.
export function whatsappHref(region: Region, phoneCh: string, phoneIt: string, text?: string): string {
  const num = (region === "it" ? phoneIt : phoneCh).replace(/[^0-9]/g, "");
  return `https://wa.me/${num}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}
