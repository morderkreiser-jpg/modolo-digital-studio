"use client";

import { ReactLenis, type LenisRef } from "lenis/react";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

/**
 * Site-wide momentum scroll substrate. Lenis runs with autoRaf:false and is driven
 * off the single GSAP ticker, so Lenis, ScrollTrigger, framer-motion and the WebGL
 * RAF all read one clock (nothing desyncs). Under prefers-reduced-motion the wheel is
 * left native (no smoothing). Anchor links smooth-scroll via Lenis. Root mode attaches
 * to the document and renders no wrapper element → no hydration shift.
 */
export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const lenisRef = useRef<LenisRef>(null);

  useEffect(() => {
    const lenis = lenisRef.current?.lenis;
    if (!lenis) return;
    (window as unknown as { __lenis?: unknown }).__lenis = lenis; // handle for tooling/captures
    const onScroll = () => ScrollTrigger.update();
    lenis.on("scroll", onScroll);
    const update = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);
    return () => {
      lenis.off("scroll", onScroll);
      gsap.ticker.remove(update);
    };
  }, [reduce]);

  return (
    <ReactLenis
      root
      ref={lenisRef}
      options={{
        autoRaf: false,
        duration: 1.1,
        lerp: reduce ? 1 : 0.1,
        smoothWheel: !reduce,
        anchors: { offset: -80 },
      }}
    >
      {children}
    </ReactLenis>
  );
}
