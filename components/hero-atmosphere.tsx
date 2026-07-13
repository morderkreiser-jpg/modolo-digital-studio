"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Hero "atelier vivo" atmosphere — the ambient layer that makes the hero feel alive: slow-drifting
 * gold dust + a soft gold glow. On desktop (fine pointer) both follow the cursor; on touch there is
 * no cursor, so the glow drifts on its own gentle path and the dust just floats — the effect works
 * on phones too, only lighter (fewer particles, capped resolution) and paused whenever the hero is
 * scrolled out of view (battery/perf). Pure 2D canvas, no WebGL. Reduced-motion → nothing at all.
 */
export default function HeroAtmosphere() {
  const reduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (reduce || typeof window === "undefined") return;
    const root = rootRef.current, glow = glowRef.current, canvas = canvasRef.current;
    if (!root || !glow || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, fine ? 2 : 1.5);
    type P = { x: number; y: number; r: number; v: number; o: number; ph: number };
    let W = 1, H = 1, rw = 1, rh = 1, parts: P[] = [];
    let killed = false, running = false, visible = true, tk = 0;
    let mx = 0.72, my = 0.4, gx = 0, gy = 0;

    const setGlow = () => { glow.style.transform = `translate3d(${gx.toFixed(1)}px, ${gy.toFixed(1)}px, 0) translate(-50%, -50%)`; };

    const build = () => {
      const rect = root.getBoundingClientRect();
      rw = rect.width; rh = rect.height;
      W = canvas.width = Math.max(1, Math.round(rw * dpr));
      H = canvas.height = Math.max(1, Math.round(rh * dpr));
      canvas.style.width = rw + "px";
      canvas.style.height = rh + "px";
      const N = Math.round(fine ? Math.min(58, rw / 24) : Math.min(26, rw / 22));
      parts = Array.from({ length: N }, () => ({
        x: Math.random(), y: Math.random(), r: (Math.random() * 1.6 + 0.6) * dpr,
        v: Math.random() * 0.0005 + 0.0002, o: Math.random() * 0.5 + 0.3, ph: Math.random() * 6.2832,
      }));
      gx = rw * (fine ? 0.78 : 0.5); gy = rh * 0.42; setGlow();
    };
    build();
    const onResize = () => build();
    window.addEventListener("resize", onResize);

    let onMove: ((e: PointerEvent) => void) | null = null;
    if (fine) {
      onMove = (e: PointerEvent) => {
        const rect = root.getBoundingClientRect();
        const x = e.clientX - rect.left, y = e.clientY - rect.top;
        if (x < -140 || y < -140 || x > rect.width + 140 || y > rect.height + 140) return;
        mx = x / rect.width; my = y / rect.height; gx = x; gy = y; setGlow();
      };
      window.addEventListener("pointermove", onMove, { passive: true });
    }

    const draw = () => {
      if (killed || !visible) { running = false; return; }
      tk += 0.006;
      if (!fine) {
        // no cursor on touch: the glow wanders on its own slow path
        const tgx = rw * (0.5 + 0.34 * Math.sin(tk * 0.6));
        const tgy = rh * (0.42 + 0.22 * Math.sin(tk * 0.43 + 1.7));
        gx += (tgx - gx) * 0.04; gy += (tgy - gy) * 0.04; setGlow();
        mx = gx / rw; my = gy / rh;
      }
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        p.y -= p.v;
        if (p.y < -0.03) { p.y = 1.03; p.x = Math.random(); }
        const dx = (mx - p.x) * 14 * dpr, dy = (my - p.y) * 14 * dpr;
        const x = p.x * W + Math.sin(tk * 2 + p.ph) * 6 * dpr + dx * 0.3;
        const y = p.y * H + dy * 0.3;
        ctx.beginPath();
        ctx.arc(x, y, p.r, 0, 6.2832);
        ctx.fillStyle = `rgba(201,153,47,${(p.o * (0.5 + 0.5 * Math.sin(tk * 3 + p.ph))).toFixed(3)})`;
        ctx.fill();
      }
      requestAnimationFrame(draw);
    };
    const start = () => { if (!running && !killed && visible) { running = true; requestAnimationFrame(draw); } };
    start();

    // pause when the hero leaves the viewport (saves battery/CPU, especially on phones)
    const io = new IntersectionObserver((ents) => { visible = ents[0].isIntersecting; if (visible) start(); }, { threshold: 0 });
    io.observe(root);

    return () => {
      killed = true;
      window.removeEventListener("resize", onResize);
      if (onMove) window.removeEventListener("pointermove", onMove);
      io.disconnect();
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
