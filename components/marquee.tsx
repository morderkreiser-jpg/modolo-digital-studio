"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { useLenis } from "lenis/react";
import { useReducedMotion } from "framer-motion";

gsap.registerPlugin(useGSAP);

/**
 * Discipline marquee, physically coupled to the page. A GSAP loop drifts the (doubled)
 * track by -50% forever; Lenis scroll velocity speeds it up and skews it a touch, so the
 * ticker feels tied to the scroll instead of running on its own clock (Obys). Reduced-motion
 * → a plain static row, no animation. Content is duplicated for the seamless -50% wrap.
 */
export default function Marquee({ items }: { items: string[] }) {
  const scope = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const tween = useRef<gsap.core.Tween | null>(null);
  const reduce = useReducedMotion();

  useGSAP(
    () => {
      if (reduce || !trackRef.current) return;
      tween.current = gsap.to(trackRef.current, { xPercent: -50, duration: 26, ease: "none", repeat: -1 });
    },
    { scope, dependencies: [reduce] }
  );

  useLenis(({ velocity }: { velocity: number }) => {
    if (reduce || !tween.current || !trackRef.current) return;
    const v = Math.min(Math.abs(velocity) / 18, 4);
    tween.current.timeScale(1 + v);
    gsap.to(trackRef.current, { skewX: gsap.utils.clamp(-5, 5, velocity * 0.05), duration: 0.5, ease: "power2.out", overwrite: "auto" });
  });

  return (
    <section aria-hidden className="marquee-mask select-none overflow-hidden border-y border-[color:var(--line)] py-5 md:py-7" ref={scope}>
      <div ref={trackRef} className="flex w-max will-change-transform">
        {[0, 1].map((dup) => (
          <div key={dup} className="flex shrink-0 items-center">
            {items.map((d, i) => (
              <span key={`${dup}-${i}`} className="flex items-center">
                <span className="display-type px-6 text-[#1F1B16]/85 md:px-9" style={{ fontSize: "clamp(1.75rem, 4vw, 3.25rem)" }}>{d}</span>
                <span className="inline-block h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: "var(--color-gold)" }} />
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
