import Image from "next/image";
import { ArrowRight } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { ABOUT } from "@/content/home/about";
import Rise from "@/components/home/rise";

// CHI SIAMO — FROZEN (BRIEF §4.1: Francesco rejected two redesigns; only spacing/numbering fixes).
// Markup moved verbatim from components/home.tsx; the CTA reads its own `cta` key (same label).
// SPEC D27 changes only: number from `kicker` (05), role line alpha .48 -> .62 (AA), mobile padding py-16,
// and the framer entrance replaced by the same rise in CSS (components/home/rise.tsx). Server component.
// portrait + who I am, balanced side by side (no empty voids)
export default function About({ lang }: { lang: Locale }) {
  const t = ABOUT[lang];

  return (
    <section id="chi-siamo" className="px-6 sm:px-10 lg:px-16 py-16 md:py-32" style={{ background: "var(--ink-bg)", color: "#17130e" }}>
      <div className="mx-auto max-w-[1240px]">
        <div className="flex flex-col items-center gap-10 md:flex-row md:items-center md:gap-16">
          {/* portrait + identity (left on desktop, below the text on mobile) — a proportionate
              accent, not a dominating block: fixed ~360px so the text carries the section */}
          <Rise className="order-2 w-full max-w-[320px] shrink-0 md:order-1 md:max-w-none md:w-[360px]">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[10px]" style={{ border: "1px solid var(--gold-line)", boxShadow: "0 2px 4px rgba(126,93,36,0.08), 0 30px 60px -28px rgba(126,93,36,0.42)" }}>
              <Image src="/founder-portrait-pro.webp" alt={t.founder.portraitAlt} fill sizes="(max-width: 768px) 80vw, 360px" className="object-cover" />
            </div>
            <div className="mt-5 flex items-baseline justify-between border-t pt-4" style={{ borderColor: "rgba(201,162,90,0.3)" }}>
              <span className="display-space text-lg" style={{ color: "#17130e" }}>{t.founder.name}</span>
              <span className="micro-caps" style={{ color: "var(--gilt)" }}>{t.founder.eyebrow}</span>
            </div>
            <div className="micro-caps mt-2" style={{ color: "rgba(31,27,22,0.62)" }}>{t.founder.role}</div>
          </Rise>

          {/* kicker + heading + who I am (right on desktop, first on mobile) */}
          <Rise delay={0.1} className="order-1 min-w-0 flex-1 md:order-2">
            <span className="micro-caps" style={{ color: "var(--gilt)" }}>{t.kicker} · {t.label}</span>
            <h2 className="display-space mt-4" style={{ fontSize: "clamp(1.9rem, 3.6vw, 3rem)", color: "#17130e" }}>
              <span className="block">{t.heading1}</span>
              <em className="block" style={{ color: "var(--gilt)" }}>{t.headingAccent}</em>
            </h2>
            <p className="mt-6 text-lg font-light leading-relaxed" style={{ color: "rgba(31,27,22,0.74)" }}>{t.p1}</p>
            <p className="mt-5 text-lg font-light leading-relaxed" style={{ color: "rgba(31,27,22,0.74)" }}>{t.founder.bio1}</p>

            <a href="#contatti" className="group mt-8 inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]">
              {t.cta}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={1.6} />
            </a>
          </Rise>
        </div>
      </div>
    </section>
  );
}
