"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

/**
 * Hero PROOF — the real client sites shown LIVE inside a browser frame: the actual domain in the
 * URL bar + a green "Live" dot, the whole frame a clickable link to the live site. It cross-fades
 * through the three real Swiss businesses on every device, and on touch you can also SWIPE to flip
 * through them (dots below show where you are). Desktop adds a cursor-following 3D tilt. Pure
 * DOM/CSS + next/image posters (tiny webp, no WebGL/video) → fast, mobile-safe. Reduced-motion →
 * a single static frame, no motion.
 */
export type ShowcaseItem = { name: string; host: string; poster: string; href: string; caption: string };

export default function HeroShowcase({ items, browseLabel }: { items: ShowcaseItem[]; browseLabel: string }) {
  const reduce = useReducedMotion();
  const n = items.length;
  const [i, setI] = useState(0);
  const pausedRef = useRef(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLAnchorElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragRef = useRef({ x: 0, moved: false, down: false });

  // Auto cross-fade on every device (paused on desktop hover); manual actions re-arm the timer.
  const arm = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (reduce) return;
    timerRef.current = setInterval(() => {
      if (!pausedRef.current) setI((v) => (v + 1) % n);
    }, 4800);
  }, [reduce, n]);

  useEffect(() => {
    arm();
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [arm]);

  const goTo = useCallback((idx: number) => { setI(((idx % n) + n) % n); arm(); }, [arm, n]);

  // 3D tilt — the frame follows the cursor like a real object. Desktop + real pointer + motion only.
  useEffect(() => {
    if (reduce || typeof window === "undefined") return;
    if (!window.matchMedia("(min-width: 768px) and (hover: hover)").matches) return;
    const wrap = wrapRef.current, card = cardRef.current;
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
      tx = -((e.clientY - r.top) / r.height - 0.5) * 7;
      ty = ((e.clientX - r.left) / r.width - 0.5) * 9;
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

  const active = items[i];

  return (
    <div className="hsw-wrap mds-in" ref={wrapRef} style={{ animationDelay: "0.4s" }}>
      <style>{CSS}</style>
      <a
        className="hsw-card"
        ref={cardRef}
        href={active.href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Sito live di ${active.name} — ${active.host}`}
        onMouseEnter={() => { pausedRef.current = true; }}
        onMouseLeave={() => { pausedRef.current = false; }}
        onPointerDown={(e) => { dragRef.current = { x: e.clientX, moved: false, down: true }; }}
        onPointerMove={(e) => { if (dragRef.current.down && Math.abs(e.clientX - dragRef.current.x) > 8) dragRef.current.moved = true; }}
        onPointerUp={(e) => {
          const d = dragRef.current; d.down = false;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 40) goTo(i + (dx < 0 ? 1 : -1));
        }}
        onClick={(e) => { if (dragRef.current.moved) e.preventDefault(); }}
      >
        <div className="hsw-bar" aria-hidden="true">
          <span className="hsw-tl" /><span className="hsw-tl" /><span className="hsw-tl" />
          <span className="hsw-url"><span className="hsw-live" />{active.host}</span>
        </div>
        <div className="hsw-body">
          {items.map((it, idx) => (
            <Image
              key={it.href}
              src={it.poster}
              alt={it.name}
              fill
              sizes="(max-width: 768px) 92vw, 620px"
              // Next 16: priority is deprecated. For a cross-fade stack (one poster visible),
              // fetchPriority="high" flags the LCP candidate without preloading all three.
              fetchPriority={idx === 0 ? "high" : undefined}
              className="hsw-shot"
              style={{ opacity: idx === i ? 1 : 0 }}
            />
          ))}
        </div>
      </a>
      <div className="hsw-foot">
        <div className="hsw-caption" aria-hidden="true">
          <span className="hsw-name">{active.name}</span>
          <span className="hsw-sep">·</span>
          <span className="hsw-cap">{active.caption}</span>
        </div>
        <div className="hsw-dots" role="group" aria-label={browseLabel}>
          {items.map((it, idx) => (
            <button
              key={it.href}
              type="button"
              className={`hsw-dot${idx === i ? " on" : ""}`}
              aria-label={it.name}
              aria-current={idx === i}
              onClick={() => goTo(idx)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const CSS = `
.hsw-wrap { width: 100%; max-width: 620px; perspective: 1200px; }
.hsw-card { display: block; border-radius: 12px; overflow: hidden; text-decoration: none;
  border: 1px solid var(--gold-line); background: #fbf8f2; touch-action: pan-y;
  box-shadow: 0 2px 4px rgba(126,93,36,0.08), 0 26px 50px -22px rgba(126,93,36,0.42);
  transition: box-shadow 0.4s; will-change: transform; transform-style: preserve-3d; }
.hsw-card:hover { box-shadow: 0 6px 12px rgba(126,93,36,0.12), 0 40px 70px -20px rgba(126,93,36,0.55); }
.hsw-card:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: 3px; }

.hsw-bar { display: flex; align-items: center; gap: 8px; padding: 0 14px; height: 42px;
  background: #efe6d6; border-bottom: 1px solid var(--gold-line); }
.hsw-tl { width: 10px; height: 10px; border-radius: 50%; background: rgba(126,93,36,0.28); }
.hsw-url { margin-left: 12px; flex: 1; display: flex; align-items: center; gap: 8px;
  height: 26px; padding: 0 14px; border-radius: 13px; background: #fbf8f2;
  border: 1px solid var(--gold-line);
  font-family: var(--font-space), ui-monospace, monospace; font-size: 12.5px; letter-spacing: 0.01em;
  color: #5b5142; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.hsw-live { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: #3fae6a;
  box-shadow: 0 0 7px rgba(63,174,106,0.7); }

.hsw-body { position: relative; width: 100%; aspect-ratio: 1280 / 700; background: #17130e; }
.hsw-shot { object-fit: cover; object-position: top center; transition: opacity 1.1s ease-in-out; }

.hsw-foot { margin-top: 16px; display: flex; align-items: center; justify-content: space-between; gap: 14px; }
@media (max-width: 767px) { .hsw-foot { flex-direction: column; align-items: flex-start; gap: 12px; } }
.hsw-caption { display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  font-family: var(--font-space), sans-serif; }
.hsw-name { font-weight: 600; font-size: 14px; color: #17130e; letter-spacing: 0.01em; }
.hsw-sep { color: var(--gold-line-strong); }
.hsw-cap { font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--gilt); }

.hsw-dots { display: flex; align-items: center; gap: 2px; }
.hsw-dot { width: 22px; height: 22px; padding: 0; border: 0; background: transparent; cursor: pointer;
  display: grid; place-items: center; -webkit-tap-highlight-color: transparent; }
.hsw-dot::before { content: ""; width: 8px; height: 8px; border-radius: 50%;
  background: rgba(126,93,36,0.30); transition: background 0.3s, transform 0.3s; }
.hsw-dot.on::before { background: var(--color-gold); transform: scale(1.3); }
.hsw-dot:hover::before { background: rgba(126,93,36,0.55); }
.hsw-dot:focus-visible { outline: 2px solid var(--gold-bright); outline-offset: 1px; border-radius: 50%; }
`;
