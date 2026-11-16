"use client";

import { useSyncExternalStore } from "react";

// Browser state read as external stores (useSyncExternalStore): no effect, no extra render pass,
// and a fixed server value so the server HTML and the first client render always agree.
// Ported from kibou/lib/browser-state.ts; the server values are chosen so that nothing that
// moves (no <video>) is ever part of the server HTML.

const noop = () => () => {};

export function useMediaQuery(query: string, serverValue = false): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => serverValue,
  );
}

/** On the server we assume "reduced motion": no film starts before the browser has had its say. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)", true);
}

/** false during SSR and hydration, true afterwards. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

type ConnectionLike = EventTarget & { saveData?: boolean; effectiveType?: string };

function connection(): ConnectionLike | undefined {
  return (navigator as Navigator & { connection?: ConnectionLike }).connection;
}

function subscribeConnection(onChange: () => void) {
  const c = connection();
  if (!c || typeof c.addEventListener !== "function") return () => {};
  c.addEventListener("change", onChange);
  return () => c.removeEventListener("change", onChange);
}

/** The visitor asked the browser to save data (Chrome / Android «Data Saver», Save-Data header). */
export function useSaveData(): boolean {
  return useSyncExternalStore(subscribeConnection, () => Boolean(connection()?.saveData), () => false);
}

/** Network Information API says the connection is slow-2g, 2g or 3g (Chromium only; elsewhere false). */
export function useSlowConnection(): boolean {
  return useSyncExternalStore(
    subscribeConnection,
    () => /^(slow-2g|2g|3g)$/.test(connection()?.effectiveType ?? ""),
    () => false,
  );
}

/** document.visibilityState === "visible" (true on the server). */
export function usePageVisible(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      document.addEventListener("visibilitychange", onChange);
      return () => document.removeEventListener("visibilitychange", onChange);
    },
    () => document.visibilityState === "visible",
    () => true,
  );
}
