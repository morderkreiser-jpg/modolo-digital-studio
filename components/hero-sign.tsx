"use client";

import { motion, useMotionValue, useSpring, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

/**
 * The hero SIGNATURE — a Swiss enamel shop-door card that turns GESCHLOSSEN/CHIUSO → OFFEN/APERTO
 * on load, warming the whole hero from "after-hours" to lit. It IS the headline ("your business
 * looks closed → I reopen it") made physical, in the language a shop owner speaks. Pure DOM/CSS +
 * Framer Motion (no WebGL) — fast, bug-free, and it stays a live object: pointer parallax + click
 * to re-flip. Reduced-motion / touch → the OPEN, warm end-state, statically. Sign text is
 * decorative (aria-hidden); the real <h1> stays the accessible headline.
 */
type Props = {
  closed: string;
  open: string;
  closedHours: string;
  openHours: string;
};

export default function HeroSign({ closed, open, closedHours, openHours }: Props) {
  const reduce = useReducedMotion();
  const [isOpen, setIsOpen] = useState(true); // SSR/default renders OPEN so a scanning visitor never meets a "closed" hero
  const rootRef = useRef<HTMLDivElement>(null);

  // pointer parallax (desktop only) — subtle translate, sprung
  const mx = useSpring(0, { stiffness: 55, damping: 18, mass: 0.6 });
  const my = useSpring(0, { stiffness: 55, damping: 18, mass: 0.6 });

  useEffect(() => {
    if (reduce || typeof window === "undefined") return; // reduced motion: stay OPEN, no play
    if (!window.matchMedia("(min-width: 1024px)").matches) return; // mobile: sign hidden → static OPEN, no play/flicker
    // play the reopening once, on load: start CLOSED, then turn OPEN after a beat of stillness
    setIsOpen(false);
    const t = setTimeout(() => setIsOpen(true), 680);
    return () => clearTimeout(t);
  }, [reduce]);

  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width * 0.76)) / r.width; // relative to the sign's zone
    const dy = (e.clientY - (r.top + r.height * 0.5)) / r.height;
    mx.set(Math.max(-1, Math.min(1, dx)) * 14);
    my.set(Math.max(-1, Math.min(1, dy)) * 10);
  };
  const onLeave = () => { mx.set(0); my.set(0); };

  return (
    <div
      ref={rootRef}
      className="hs-root"
      aria-hidden="true"
      onPointerMove={reduce ? undefined : onMove}
      onPointerLeave={reduce ? undefined : onLeave}
    >
      <style>{CSS}</style>

      {/* cool "after-hours" wash — fades out as it opens */}
      <motion.div className="hs-wash hs-cool" animate={{ opacity: isOpen ? 0 : 1 }} transition={{ duration: 0.7, ease: "easeOut" }} />
      {/* warm gold bloom — blooms up as it opens */}
      <motion.div className="hs-wash hs-warm" animate={{ opacity: isOpen ? 1 : 0 }} transition={{ duration: 0.8, ease: "easeOut" }} />

      {/* faint Swiss registration grid, pinned to the sign */}
      <svg className="hs-grid" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <line x1="760" y1="0" x2="760" y2="700" />
        <line x1="0" y1="352" x2="1000" y2="352" />
        <line x1="620" y1="0" x2="620" y2="700" className="hs-grid-faint" />
        <text x="766" y="26" className="hs-tick">02</text>
        <text x="626" y="26" className="hs-tick">01</text>
        <text x="766" y="372" className="hs-tick">— · —</text>
      </svg>

      {/* the sign — parallax translate wraps a swing (tilt + settle) wraps the flipping plate */}
      <motion.div className="hs-sign" style={{ x: mx, y: my }}>
        <div className="hs-rail" />
        <motion.div
          className="hs-swing"
          onClick={reduce ? undefined : () => setIsOpen((o) => !o)}
          animate={reduce ? undefined : { rotate: isOpen ? [-4.5, 1.6, -0.9, 0.4, -1.4] : -1.4 }}
          transition={{ duration: 1.5, ease: "easeOut", times: [0, 0.28, 0.55, 0.8, 1] }}
        >
          <div className="hs-strand hs-strand-l" /><div className="hs-strand hs-strand-r" />
          <div className="hs-ring hs-ring-l" /><div className="hs-ring hs-ring-r" />
          <motion.div
            className="hs-plate"
            animate={{ rotateY: isOpen ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 90, damping: 13, mass: 0.9 }}
          >
            <div className="hs-face hs-closed">
              <span className="hs-eyelet hs-eyelet-l" /><span className="hs-eyelet hs-eyelet-r" />
              <span className="hs-keyline" />
              <span className="hs-word">{closed}</span>
              <span className="hs-hours">{closedHours}</span>
            </div>
            <div className="hs-face hs-open">
              <span className="hs-eyelet hs-eyelet-l" /><span className="hs-eyelet hs-eyelet-r" />
              <span className="hs-keyline" />
              <span className="hs-word">{open}</span>
              <span className="hs-hours">{openHours}</span>
              <span className="hs-glint" />
            </div>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

const CSS = `
.hs-root { position: absolute; inset: 0; overflow: hidden; }
.hs-wash { position: absolute; inset: 0; pointer-events: none; }
.hs-cool { background: radial-gradient(58% 68% at 76% 46%, rgba(58,66,86,0.12), transparent 68%); }
.hs-warm { background: radial-gradient(46% 60% at 77% 47%, rgba(201,153,47,0.18), rgba(181,137,63,0.07) 48%, transparent 76%); }

.hs-grid { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0.9; }
.hs-grid line { stroke: var(--color-gold); stroke-width: 1; opacity: 0.14; }
.hs-grid line.hs-grid-faint { opacity: 0.07; }
.hs-grid .hs-tick { fill: var(--color-gold-ink); opacity: 0.5; font-size: 13px; letter-spacing: 0.14em; font-family: var(--font-space), sans-serif; }

.hs-sign { position: absolute; right: 15%; top: 50%; transform: translateY(-50%); }
@media (max-width: 1180px) { .hs-sign { right: 8%; } }
/* Single-column mobile: the sign would overlap the text, so drop the sign + grid and let the
   headline carry the "closed → I reopen it" message; keep just the faint warm glow. */
@media (max-width: 1023px) {
  .hs-sign, .hs-grid { display: none; }
}
.hs-rail { position: absolute; left: 50%; top: -54px; width: 210px; height: 2px; transform: translateX(-50%);
  background: linear-gradient(90deg, transparent, rgba(126,93,36,0.55), transparent); }

.hs-swing { position: relative; transform-origin: 50% -54px; cursor: pointer; }

.hs-strand { position: absolute; top: -52px; width: 1.5px; height: 52px; background: rgba(126,93,36,0.5); }
.hs-strand-l { left: calc(50% - 96px); } .hs-strand-r { left: calc(50% + 95px); }
.hs-ring { position: absolute; top: -8px; width: 15px; height: 15px; border-radius: 50%;
  border: 2px solid #a97e2c; background: transparent; }
.hs-ring-l { left: calc(50% - 103px); } .hs-ring-r { left: calc(50% + 88px); }

.hs-plate { position: relative; width: clamp(196px, 21vw, 304px); aspect-ratio: 3 / 2;
  transform-style: preserve-3d; }
.hs-face { position: absolute; inset: 0; border-radius: 16px; backface-visibility: hidden;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  overflow: hidden; }
.hs-keyline { position: absolute; inset: 7px; border-radius: 10px; pointer-events: none; }
.hs-eyelet { position: absolute; top: 12px; width: 11px; height: 11px; border-radius: 50%; }
.hs-eyelet-l { left: 20px; } .hs-eyelet-r { right: 20px; }
.hs-word { font-family: var(--font-space), sans-serif; font-weight: 600; letter-spacing: 0.15em;
  font-size: clamp(1rem, 1.9vw, 1.55rem); line-height: 1; }
.hs-hours { font-family: var(--font-space), sans-serif; font-size: clamp(0.56rem, 0.9vw, 0.72rem);
  letter-spacing: 0.16em; text-transform: uppercase; }

/* CLOSED — cool slate enamel, cream lettering, matte */
.hs-closed { background: linear-gradient(157deg, #302b24, #211d17);
  box-shadow: inset 0 1px 0 rgba(255,247,230,0.10), inset 0 -3px 10px rgba(0,0,0,0.34), 0 22px 40px -20px rgba(35,26,12,0.5); }
.hs-closed .hs-keyline { border: 1px solid rgba(238,230,216,0.28); }
.hs-closed .hs-eyelet { background: #171310; box-shadow: inset 0 1px 2px rgba(0,0,0,0.7); }
.hs-closed .hs-word { color: #eee6d8; }
.hs-closed .hs-hours { color: rgba(238,230,216,0.42); }

/* OPEN — warm parchment enamel, ink lettering, gold keyline. Deeper than the cream field + a
   strong soft shadow so the plate reads as a real object lifting off the page. */
.hs-open { transform: rotateY(180deg);
  background: linear-gradient(158deg, #f1e6cf 0%, #ddc9a4 100%);
  border: 1px solid rgba(126,93,36,0.22);
  box-shadow: inset 0 1.5px 0 rgba(255,252,244,0.85), inset 0 -4px 14px rgba(126,93,36,0.20), 0 32px 52px -16px rgba(96,70,28,0.5); }
.hs-open .hs-keyline { border: 1px solid rgba(181,137,63,0.72); }
.hs-open .hs-eyelet { background: #efe6d6; box-shadow: inset 0 1px 2px rgba(126,93,36,0.4); }
.hs-open .hs-word { color: #17130e; }
.hs-open .hs-hours { color: #7e5d24; }

/* one gold specular glint that lives on the open face */
.hs-glint { position: absolute; top: 0; left: -40%; width: 34%; height: 100%; pointer-events: none;
  background: linear-gradient(105deg, transparent, rgba(255,247,225,0.6), transparent);
  transform: skewX(-14deg); animation: hs-sweep 6.5s ease-in-out 1.4s infinite; }
@keyframes hs-sweep { 0%, 62% { left: -40%; } 78%, 100% { left: 120%; } }

@media (prefers-reduced-motion: reduce) {
  .hs-glint { animation: none; display: none; }
  .hs-swing { cursor: default; }
}
@media (hover: none) {
  .hs-glint { animation-iteration-count: 2; }
}
`;
