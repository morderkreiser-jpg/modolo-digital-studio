"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const HeroCanvas = dynamic(() => import("@/components/hero-canvas"), { ssr: false });

const space = { fontFamily: "var(--font-space)" } as const;

/**
 * IMMERSIVE hero (direction prototype) — dark, neon, WebGL spectacle.
 * A morphing metallic blob with bloom glows on the right; kinetic modern type sits on the left
 * over a readability veil. Reduced-motion users get the ambient glow without the canvas.
 */
export default function HeroImmersive() {
  const reduce = useReducedMotion();
  return (
    <section className="relative flex min-h-svh flex-col justify-center overflow-hidden px-6 sm:px-10 lg:px-16" style={{ background: "#07070E" }}>
      {/* ambient neon glow — present even without WebGL */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(55% 55% at 72% 42%, rgba(90,110,255,0.28), transparent 70%), radial-gradient(45% 45% at 86% 72%, rgba(177,75,255,0.20), transparent 72%)" }}
      />
      {/* the 3D spectacle */}
      {!reduce && (
        <div className="absolute inset-0">
          <HeroCanvas />
        </div>
      )}
      {/* left readability veil */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(90deg, rgba(7,7,14,0.88) 0%, rgba(7,7,14,0.45) 42%, rgba(7,7,14,0) 66%)" }}
      />
      {/* subtle grain to kill banding on the dark gradient */}
      <div className="mds-grain absolute inset-0 opacity-[0.06]" aria-hidden />

      <div className="relative z-10 mx-auto w-full max-w-[1400px] pt-28">
        <div className="mb-9 flex items-center gap-3">
          <span className="h-2 w-2 rounded-full" style={{ background: "#6f8bff", boxShadow: "0 0 14px #6f8bff" }} />
          <span className="text-[0.7rem] font-medium uppercase tracking-[0.28em] text-white/55" style={space}>Studio digitale · Winterthur</span>
        </div>

        <h1 className="font-medium text-white" style={{ ...space, fontSize: "clamp(2.6rem, 7vw, 6.5rem)", lineHeight: 0.98, letterSpacing: "-0.035em" }}>
          Siti, marchi
          <br />
          e contenuti,
          <br />
          <span style={{ background: "linear-gradient(100deg, #6f8bff, #b14bff 46%, #22d3ee)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            costruiti a mano.
          </span>
        </h1>

        <p className="mt-8 max-w-xl text-lg font-light leading-relaxed text-white/60">
          Uno studio indipendente a Winterthur. Esperienze web moderne e immersive, costruite su misura per farti notare davvero.
        </p>

        <div className="mt-11 flex flex-wrap items-center gap-x-8 gap-y-4">
          <a
            href="#contatti"
            className="group inline-flex items-center gap-2 rounded-full px-8 py-4 text-sm font-medium text-white transition-transform duration-300 hover:scale-[1.03]"
            style={{ ...space, background: "linear-gradient(100deg, #4f7bff, #b14bff)", boxShadow: "0 0 34px rgba(120,90,255,0.55)" }}
          >
            Prenota una consulenza
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
          <a href="#portfolio" className="group inline-flex items-center gap-2 text-sm text-white/70 transition-colors hover:text-white" style={space}>
            <span className="relative">
              Guarda i lavori
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-white/70 transition-transform duration-300 group-hover:scale-x-100" />
            </span>
            <ArrowRight className="h-3.5 w-3.5 rotate-90" />
          </a>
        </div>
      </div>
    </section>
  );
}
