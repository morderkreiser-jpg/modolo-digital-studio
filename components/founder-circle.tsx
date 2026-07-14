"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import HeroAtmosphere from "@/components/hero-atmosphere";

/**
 * "Il Cerchio Vivo" — the living portrait of Francesco. At rest it is quietly alive: a warm gold
 * glow blooms behind it on scroll-in, it breathes (soft-light wash + a 2.5% scale), gold dust drifts
 * (desktop), and on a fine pointer the whole plate tilts toward the cursor. The one memorable moment:
 * his trusted circle — three real ROLE tags (functions, never invented names/faces) — sits quietly
 * beside him and brightens, gold threads drawing toward him, when you engage; it settles back when
 * you leave. On touch the tags are a static, always-visible list; under reduced-motion everything is
 * a warm, complete, legible still.
 */
type Role = { role: string; desc: string };

export default function FounderCircle({
  portraitAlt,
  reach,
  circleCaption,
  roles,
}: {
  portraitAlt: string;
  reach: string;
  circleCaption: string;
  roles: Role[];
}) {
  const reduce = useReducedMotion();
  const perspRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const [interactive, setInteractive] = useState(false);
  const [open, setOpen] = useState(true); // default OPEN — SSR / no-JS / keyboard / reduced-motion safe

  // On a real desktop pointer only (wide + hover + fine): start the circle quiet and brighten it on
  // engage. The min-width guard guarantees phones/tablets always render the tags full (discoverable),
  // even if a device mis-reports its pointer type.
  useEffect(() => {
    if (reduce || typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)").matches) return;
    setInteractive(true);
    setOpen(false);
  }, [reduce]);

  // 3D tilt toward the cursor — ported from hero-showcase (the "glued to the screen" feel).
  useEffect(() => {
    if (reduce || typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px) and (hover: hover)").matches) return;
    const wrap = perspRef.current, card = innerRef.current;
    if (!wrap || !card) return;
    let tx = 0, ty = 0, cx = 0, cy = 0, running = false, killed = false;
    const loop = () => {
      if (killed) return;
      cx += (tx - cx) * 0.09; cy += (ty - cy) * 0.09;
      card.style.transform = `rotateX(${cx.toFixed(2)}deg) rotateY(${cy.toFixed(2)}deg)`;
      if (Math.abs(tx - cx) > 0.02 || Math.abs(ty - cy) > 0.02) requestAnimationFrame(loop);
      else running = false;
    };
    const kick = () => { if (!running) { running = true; requestAnimationFrame(loop); } };
    const onMove = (e: PointerEvent) => {
      const r = wrap.getBoundingClientRect();
      tx = -((e.clientY - r.top) / r.height - 0.5) * 5;
      ty = ((e.clientX - r.left) / r.width - 0.5) * 6;
      kick();
    };
    const onLeave = () => { tx = 0; ty = 0; kick(); };
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerleave", onLeave);
    return () => {
      killed = true;
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerleave", onLeave);
      card.style.transform = "";
    };
  }, [reduce]);

  const engage = interactive
    ? {
        onPointerEnter: () => setOpen(true),
        onPointerLeave: () => setOpen(false),
        onFocusCapture: () => setOpen(true),
        onBlurCapture: (e: React.FocusEvent<HTMLDivElement>) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
        },
      }
    : {};

  return (
    <div className="relative" {...engage}>
      {/* ambient gold dust + glow — desktop only, clipped to the stage */}
      <div className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block" aria-hidden>
        <HeroAtmosphere />
      </div>

      {/* mobile: plate on top, tags below · desktop: tags left, plate right */}
      <div className="relative flex flex-col items-center gap-8 md:flex-row md:justify-center md:gap-10 lg:gap-14">
        {/* THE CIRCLE — real functions, never invented names or faces */}
        <ul className="order-2 flex w-full flex-col gap-3 md:order-1 md:w-auto md:gap-9">
          {roles.map((r, i) => (
            <motion.li
              key={i}
              className="flex items-center gap-3 border-t pt-2.5 first:border-t-0 first:pt-0 md:justify-end md:border-t-0 md:pt-0 md:text-right"
              style={{ borderColor: "var(--gold-line)" }}
              initial={false}
              animate={open ? { opacity: 1, x: 0 } : { opacity: 0.34, x: 12 }}
              transition={{ type: "spring", stiffness: 260, damping: 22, delay: open ? i * 0.06 : 0 }}
            >
              {/* mobile connector (left) */}
              <span aria-hidden className="mt-1.5 h-px w-5 shrink-0 self-start md:hidden" style={{ background: "var(--color-gold)" }} />
              <span className="flex flex-1 flex-col md:flex-none md:items-end">
                <span className="micro-caps whitespace-nowrap" style={{ color: "var(--gilt)" }}>{r.role}</span>
                <span className="mt-0.5 text-[13px] font-light leading-snug" style={{ color: "rgba(23,19,14,0.55)" }}>{r.desc}</span>
              </span>
              {/* desktop thread toward the plate */}
              <motion.span
                aria-hidden
                className="hidden h-px w-9 shrink-0 origin-left md:block"
                style={{ background: "linear-gradient(90deg, var(--gilt), var(--color-gold))" }}
                initial={false}
                animate={open ? { scaleX: 1, opacity: 1 } : { scaleX: 0.28, opacity: 0.5 }}
                transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              />
            </motion.li>
          ))}
        </ul>

        {/* THE LIVING PLATE */}
        <div ref={perspRef} className="order-1 w-[74%] max-w-[300px] shrink-0 md:order-2 md:w-[46%]" style={{ perspective: "1100px" }}>
          <div ref={innerRef} className="relative aspect-[4/5]" style={{ transformStyle: "preserve-3d", willChange: "transform" }}>
            {/* glow bloom on arrival */}
            <motion.div
              aria-hidden
              className="pointer-events-none absolute -inset-8 -z-10"
              style={{ background: "radial-gradient(58% 54% at 50% 42%, rgba(201,153,47,0.22), transparent 72%)" }}
              initial={reduce ? false : { opacity: 0, scale: 0.85 }}
              whileInView={reduce ? undefined : { opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
            />
            <div
              className="relative h-full w-full overflow-hidden"
              style={{
                borderRadius: "clamp(26px,4.5vw,48px)",
                border: "1px solid var(--color-gold)",
                boxShadow: "inset 0 0 80px rgba(201,153,47,0.10), 0 2px 4px rgba(126,93,36,0.10), 0 34px 64px -26px rgba(126,93,36,0.46)",
              }}
            >
              <motion.div
                className="absolute inset-0"
                animate={reduce ? undefined : { scale: [1, 1.025, 1] }}
                transition={reduce ? undefined : { duration: 9, repeat: Infinity, ease: "easeInOut" }}
              >
                <Image src="/founder-portrait.webp" alt={portraitAlt} fill sizes="(max-width:768px) 74vw, 30vw" className="object-cover" />
              </motion.div>
              <motion.div
                aria-hidden
                className="absolute inset-0"
                style={{ background: "radial-gradient(72% 62% at 50% 28%, rgba(201,153,47,0.55), transparent 70%)", mixBlendMode: "soft-light" }}
                animate={reduce ? undefined : { opacity: [0.05, 0.16, 0.05] }}
                transition={reduce ? undefined : { duration: 7, repeat: Infinity, ease: "easeInOut" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* presence + circle caption */}
      <div className="relative mt-8 flex flex-col items-center gap-1.5 text-center">
        <span className="inline-flex items-center gap-2 text-sm font-light" style={{ color: "rgba(23,19,14,0.64)" }}>
          <span aria-hidden className="fc-dot inline-block h-[7px] w-[7px] rounded-full" style={{ background: "var(--color-gold-bright)" }} />
          {reach}
        </span>
        <span className="micro-caps" style={{ color: "var(--gilt)" }}>{circleCaption}</span>
      </div>
    </div>
  );
}
