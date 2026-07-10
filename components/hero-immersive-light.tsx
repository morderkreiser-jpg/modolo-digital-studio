"use client";

import dynamic from "next/dynamic";
import { useReducedMotion } from "framer-motion";
import { ArrowRight } from "lucide-react";

const HeroCanvasLight = dynamic(() => import("@/components/hero-canvas-light"), { ssr: false });

const space = { fontFamily: "var(--font-space)" } as const;

/**
 * LIGHT immersive hero — cream field, dark ink type, a reflective gold blob floating on the right.
 * The "immersive" feel comes from the real 3D + reflections rather than glow. Reduced-motion users
 * get a soft warm wash without the canvas.
 */
export default function HeroImmersiveLight() {
  const reduce = useReducedMotion();
  return (
    <section className="relative flex min-h-svh flex-col justify-center overflow-hidden px-6 sm:px-10 lg:px-16" style={{ background: "#F6F1E7" }}>
      {/* soft warm wash behind the object */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(52% 52% at 72% 45%, rgba(181,137,63,0.14), transparent 70%)" }}
      />
      {/* the reflective gold object */}
      {!reduce && (
        <div className="absolute inset-0">
          <HeroCanvasLight />
        </div>
      )}
      {/* left readability veil so the ink type stays crisp over the object */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: "linear-gradient(90deg, rgba(246,241,231,0.92) 0%, rgba(246,241,231,0.55) 42%, rgba(246,241,231,0) 66%)" }}
      />
      <div className="mds-grain absolute inset-0 opacity-[0.05]" aria-hidden />

      <div className="relative z-10 mx-auto w-full max-w-[1400px] pt-28">
        <div className="mb-9 flex items-center gap-3">
          <span className="h-2 w-2 rounded-full" style={{ background: "#B5893F" }} />
          <span className="text-[0.7rem] font-medium uppercase tracking-[0.28em] text-[#17130E]/55" style={space}>Studio digitale · Winterthur</span>
        </div>

        <h1 className="font-medium text-[#17130E]" style={{ ...space, fontSize: "clamp(2.6rem, 7vw, 6.5rem)", lineHeight: 0.98, letterSpacing: "-0.035em" }}>
          Siti, marchi
          <br />
          e contenuti,
          <br />
          <span style={{ background: "linear-gradient(100deg, #c9992f, #b5893f 45%, #7e5d24)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            costruiti a mano.
          </span>
        </h1>

        <p className="mt-8 max-w-xl text-lg font-light leading-relaxed text-[#17130E]/65">
          Uno studio indipendente a Winterthur. Esperienze web moderne e curate, costruite su misura per farti notare davvero.
        </p>

        <div className="mt-11 flex flex-wrap items-center gap-x-8 gap-y-4">
          <a
            href="#contatti"
            className="group inline-flex items-center gap-2 rounded-full bg-[#17130E] px-8 py-4 text-sm font-medium text-[#F6F1E7] transition-colors duration-300 hover:bg-[#332616]"
            style={space}
          >
            Prenota una consulenza
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
          <a href="#portfolio" className="group inline-flex items-center gap-2 text-sm text-[#17130E]/70 transition-colors hover:text-[#17130E]" style={space}>
            <span className="relative">
              Guarda i lavori
              <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[#B5893F] transition-transform duration-300 group-hover:scale-x-100" />
            </span>
            <ArrowRight className="h-3.5 w-3.5 rotate-90" />
          </a>
        </div>
      </div>
    </section>
  );
}
