"use client";

import { motion, useScroll, useReducedMotion, useSpring, useTransform } from "framer-motion";

/**
 * THE MEASURE — the redesign's structural signature.
 * A single gold hairline in the left margin, like an architect's ruler / print
 * registration mark. It "draws" as you descend the page (scroll-linked, never
 * re-drawn), with a leading tick that marks your position. Reduced-motion users
 * get the fully-drawn static ruler. Purely decorative → aria-hidden, no pointer.
 */
export default function Measure() {
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll();
  const p = useSpring(scrollYProgress, { stiffness: 140, damping: 32, mass: 0.4 });
  const top = useTransform(p, (v) => `${v * 100}%`);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-y-0 z-30 hidden sm:block"
      style={{ left: "clamp(14px, 3.2vw, 46px)" }}
    >
      {/* ruler track (faint, full height) */}
      <div className="absolute inset-y-0 left-0 w-px" style={{ background: "var(--color-gold)", opacity: 0.2 }} />
      {/* ruler gradations — a real measure, not just a progress line */}
      <div
        className="absolute inset-y-0 -left-[3px] w-[7px]"
        style={{ backgroundImage: "repeating-linear-gradient(to bottom, transparent 0 63px, var(--color-gold) 63px 64px)", opacity: 0.22 }}
      />
      {/* the drawn measure (fills top→down with page progress) */}
      <motion.div
        className="absolute left-0 top-0 w-px origin-top"
        style={{ bottom: 0, background: "var(--color-gold)", scaleY: reduce ? 1 : p }}
      />
      {/* top cap tick */}
      <div className="absolute -left-[3px] top-0 h-px w-[7px]" style={{ background: "var(--color-gold)", opacity: 0.7 }} />
      {/* leading position tick (moves down as you scroll) */}
      {!reduce && (
        <motion.div className="absolute -left-[4px] h-px w-[9px]" style={{ top, background: "var(--color-gold)" }} />
      )}
    </div>
  );
}
