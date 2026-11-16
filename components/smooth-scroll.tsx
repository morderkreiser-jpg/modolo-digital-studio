"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { stripLocale } from "@/lib/i18n";

/**
 * Routes that keep the browser's own scrolling.
 *
 * The digital business card is opened almost exclusively inside WhatsApp's in-app browser, on a
 * phone, often on one bar of signal. Momentum scrolling there is not a flourish, it is a page
 * that feels broken: the webview's own gestures fight Lenis, and a site that scrolls strangely
 * is the last thing to hand someone as proof that you build websites. The card is one short
 * column with no scroll-driven anything, so it loses nothing by scrolling natively.
 *
 * Matched on the LAST path segment, against every spelling in SLUG_TRANSLATIONS.biglietto
 * (lib/i18n.ts). Matching whole paths instead would miss the canonical-segment URLs, which Next
 * also serves: /de/biglietto and /it/visitenkarte render the same page as /de/visitenkarte, and
 * momentum scrolling would come back depending only on how the link was written.
 */
const NATIVE_SCROLL = /(^|\/)(card|visitenkarte|biglietto)\/?$/;

/**
 * The homepage scrolls natively too (SPEC §5.7 / D22, Nov 2026): the hero film, the sticky panel of
 * section 01 and the anchors (scroll-margin-top + CSS smooth scrolling in globals.css) need no
 * Lenis, and Lenis + GSAP were the largest part of its JavaScript.
 */
function isNative(pathname: string | null): boolean {
  const p = pathname ?? "";
  return NATIVE_SCROLL.test(p) || stripLocale(p) === "/";
}

/**
 * Momentum scroll for the inner pages. Lenis and GSAP live in their own chunk
 * (components/smooth-scroll-lenis.ts), imported only on a page that uses them, after hydration:
 * the native pages never download it. Renders no element and never wraps the page, so switching
 * between native and Lenis pages remounts nothing.
 */
export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const native = isNative(pathname);

  useEffect(() => {
    if (native) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let stop: (() => void) | null = null;
    let generation = 0;
    const start = () => {
      const mine = ++generation;
      stop?.();
      stop = null;
      void import("./smooth-scroll-lenis").then(({ startLenis }) => {
        if (mine !== generation) return; // superseded or unmounted meanwhile
        stop = startLenis(mq.matches);
      });
    };
    start();
    // Under reduced motion the wheel stays native: restart when the setting changes.
    mq.addEventListener("change", start);
    return () => {
      generation++;
      mq.removeEventListener("change", start);
      stop?.();
      stop = null;
    };
  }, [native]);

  return <>{children}</>;
}
