"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Hero "atelier vivo" atmosphere — the ambient layer that makes the hero feel alive: slow-drifting
 * gold dust + a soft gold glow that follows the cursor. Pure 2D canvas (no WebGL), ~40 particles,
 * gated to desktop + real pointer + motion-on and torn down on unmount, so phones and reduced-motion
 * users get nothing (zero perf cost there). Sits behind the hero content (pointer-events: none).
 */
export default function HeroAtmosphere() {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (reduce || typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px) and (hover: hover)").matches) return;
    const root = rootRef.current, glow = glowRef.current, canvas = canvasRef.current;
    if (!root || !glow || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let W = 1, H = 1, killed = false, raf = 0, tk = 0, mx = 0.72, my = 0.4;
    type P = { x: number; y: number; r: number; v: number; o: number; ph: number };
    let parts: P[] = [];

    const build = () => {
      const rect = root.getBoundingClientRect();
      W = canvas.width = Math.max(1, Math.round(rect.width * dpr));
      H = canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      const N = Math.round(Math.min(60, rect.width / 24));
      parts = Array.from({ length: N }, () => ({
        x: Math.random(), y: Math.random(), r: (Math.random() * 1.7 + 0.6) * dpr,
        v: Math.random() * 0.0005 + 0.0002, o: Math.random() * 0.5 + 0.3, ph: Math.random() * 6.2832,
      }));
    };
    build();
    const onResize = () => build();
    window.addEventListener("resize", onResize);

    const onMove = (e: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      if (x < -120 || y < -120 || x > rect.width + 120 || y > rect.height + 120) return;
      mx = x / rect.width; my = y / rect.height;
      glow.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    };
    window.addEventListener("pointermove", onMove, { passive: true });

    const draw = () => {
      if (killed) return;
      tk += 0.006;
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.y -= p.v;
        if (p.y < -0.03) { p.y = 1.03; p.x = Math.random(); }
        const dx = (mx - p.x) * 16 * dpr, dy = (my - p.y) * 16 * dpr;
        const x = p.x * W + Math.sin(tk * 2 + p.ph) * 6 * dpr + dx * 0.3;
        const y = p.y * H + dy * 0.3;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, 6.2832);
        ctx.fillStyle = `rgba(201,153,47,${(p.o * (0.5 + 0.5 * Math.sin(tk * 3 + p.ph))).toFixed(3)})`;
        ctx.fill();
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);

    return () => {
      killed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("pointermove", onMove);
    };
  }, [reduce]);

  return (
    <div ref={rootRef} aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        ref={glowRef}
        className="absolute left-0 top-0 h-[540px] w-[540px]"
        style={{
          background: "radial-gradient(circle, rgba(201,153,47,0.15), rgba(201,153,47,0.05) 42%, transparent 66%)",
          transform: "translate3d(78%, 42%, 0) translate(-50%, -50%)",
          transition: "transform 0.28s ease-out",
          willChange: "transform",
        }}
      />
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
}
