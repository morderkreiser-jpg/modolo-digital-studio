"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";
import { useReducedMotion } from "framer-motion";

gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText);

/**
 * Kinetic heading reveal. Wrap a section header; mark the kicker(s) with
 * data-reveal-fade and the display heading with data-reveal-heading. On scroll-in the
 * kicker eases up, then the Fraunces heading rises line-by-line out of clip masks
 * (SplitText). Split happens after fonts.ready so line breaks are correct. Reduced-motion
 * → renders exactly as authored, fully visible, no split. Runs once.
 */
export default function Reveal({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "header" | "section";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();

  useGSAP(
    () => {
      const root = ref.current;
      if (reduce || !root) return;
      const heading = root.querySelector<HTMLElement>("[data-reveal-heading]");
      const fades = root.querySelectorAll<HTMLElement>("[data-reveal-fade]");
      let split: SplitText | undefined;

      const run = () => {
        if (!ref.current) return;
        const tl = gsap.timeline({ scrollTrigger: { trigger: root, start: "top 86%", once: true } });
        if (fades.length) tl.from(fades, { y: 18, autoAlpha: 0, duration: 0.6, stagger: 0.08, ease: "power2.out" }, 0);
        if (heading) {
          split = SplitText.create(heading, { type: "lines", mask: "lines", autoSplit: true });
          tl.from(split.lines, { yPercent: 112, duration: 0.95, stagger: 0.09, ease: "power3.out" }, 0.08);
        }
        ScrollTrigger.refresh();
      };

      if (document.fonts?.ready) document.fonts.ready.then(run);
      else run();

      return () => split?.revert();
    },
    { scope: ref, dependencies: [reduce] }
  );

  return (
    <Tag ref={ref as React.Ref<HTMLDivElement>} className={className}>
      {children}
    </Tag>
  );
}
