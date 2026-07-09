"use client";

import { ReactLenis, useLenis, type LenisRef } from "lenis/react";
import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

if (typeof window !== "undefined") gsap.registerPlugin(ScrollTrigger);

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
    if (lenis) (window as unknown as { __lenis?: unknown }).__lenis = lenis; // handle for tooling/captures
  }, [lenis]);
  return null;
}

export default function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const lenisRef = useRef<LenisRef>(null);

  useEffect(() => {
    const update = (time: number) => {
      lenisRef.current?.lenis?.raf(time * 1000); // read fresh each frame — never bail permanently
    };
    gsap.ticker.add(update);
    gsap.ticker.lagSmoothing(0);
    return () => {
      gsap.ticker.remove(update);
    };
  }, []);

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
