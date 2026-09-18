"use client";

import { ReactLenis, useLenis, type LenisRef } from "lenis/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

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
 * Site-wide momentum scroll substrate. Lenis runs with autoRaf:false and is advanced off the
 * single GSAP ticker, so Lenis, ScrollTrigger, framer-motion and the WebGL RAF share one clock.
 *
 * IMPORTANT: the ticker callback reads lenisRef.current?.lenis EVERY FRAME. An earlier version
 * read the instance once at effect time and bailed if the ref wasn't populated yet — which left
 * Lenis capturing the wheel but never advancing, i.e. the mouse wheel did nothing. Reading the
 * ref each frame recovers as soon as ReactLenis has mounted its instance.
 *
 * Under prefers-reduced-motion the wheel is left native (no smoothing). Root mode attaches to
 * the document and renders no wrapper element → no hydration shift.
 */
function LenisBridge() {
  // useLenis reads the ReactLenis context, so the instance is reliably available here.
  const lenis = useLenis(() => ScrollTrigger.update());
  useEffect(() => {
    if (!lenis) return;
    const w = window as unknown as { __lenis?: unknown };
    w.__lenis = lenis; // handle for tooling/captures
    // Clear it on unmount. Since some routes opt out of Lenis entirely (NATIVE_SCROLL above),
    // navigating to one of them and back used to leave a handle pointing at a destroyed
    // instance — and the .redesign capture scripts drive scrolling through exactly this handle.
    return () => {
      if (w.__lenis === lenis) delete w.__lenis;
    };
  }, [lenis]);
  return null;
}

export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const pathname = usePathname();
  const lenisRef = useRef<LenisRef>(null);
  const native = NATIVE_SCROLL.test(pathname ?? "");

  useEffect(() => {
    if (native) return;
    const update = (time: number) => {
      lenisRef.current?.lenis?.raf(time * 1000); // read fresh each frame — never bail permanently
    };
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(update);
    };
  }, [native]);

  // Not just "don't advance it": ReactLenis must not MOUNT, or it attaches its wheel/touch
  // listeners to the document and the page stops scrolling altogether.
  if (native) return <>{children}</>;

  return (
    <ReactLenis
      root
      ref={lenisRef}
      options={{
        autoRaf: false,
        duration: 1.05,
        lerp: reduce ? 1 : 0.11,
        smoothWheel: !reduce,
        wheelMultiplier: 1,
        anchors: { offset: -80 },
      }}
    >
      <LenisBridge />
      {children}
    </ReactLenis>
  );
}
