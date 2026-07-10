"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, MessageCircle } from "lucide-react";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import { localizedHref, type Locale } from "@/lib/i18n";
import { SITE } from "@/lib/site";
import {
  PRICING_UI,
  WEBSITES,
  CARE,
  BRANDING,
  GOOD_TO_KNOW,
  HOURLY,
  VAT,
  CURRENCY,
  type Region,
} from "@/lib/pricing";

const POPULAR: Record<Locale, string> = { en: "Popular", de: "Beliebt", it: "Consigliato" };
const KICKER: Record<Locale, string> = { en: "Pricing", de: "Preise", it: "Listino" };

// Thousands separator per display locale (English comma, Swiss German apostrophe, Italian dot)
// so the separator is unambiguous in each language. Formatted manually rather than via Intl so
// the result is byte-identical on server and client regardless of the runtime's ICU data.
const THOUSANDS: Record<Locale, string> = { en: ",", de: "'", it: "." };
function groupThousands(n: number, sep: string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

const container = "mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-16";

export default function PricingPage({ lang }: { lang: Locale }) {
  // EUR pricing hidden for now (client request 2026-07-10): CHF only, currency toggle removed.
  // Revert this commit to restore the CH/EUR geo toggle.
  const region: Region = "ch";
  const reduce = useReducedMotion();
  const ui = PRICING_UI[lang];
  const whatsapp = `https://wa.me/${SITE.phone.replace(/[^0-9]/g, "")}`;
  const sep = THOUSANDS[lang];
  const cur = CURRENCY[region];
  const amount = (n: number) => `${cur} ${groupThousands(n, sep)}`;
  const regionName = ui.regionCh;

  const resolve = (s: string) =>
    s.replace("{cur}", cur).replace("{hourly}", groupThousands(HOURLY[region], sep)).replace("{vat}", VAT[region]);

  const rise = reduce ? {} : { initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-8%" }, transition: { duration: 0.6 } };

  return (
    <main id="main" tabIndex={-1} className="relative min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text)] overflow-x-hidden outline-none">
      <SiteNav lang={lang} ctaLabel={ui.ctaContact} ctaHref={localizedHref(lang, "/#contatti")} theme="dark" />
      <div className="mds-grain" aria-hidden />
      
      {/* HERO */}
      <section className={`${container} pt-36 pb-14 md:pb-16`}>
        <Link
          href={localizedHref(lang, "/")}
          className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" strokeWidth={1.5} />
          {ui.back}
        </Link>

        <div className="mt-12 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <div>
            <span className="micro-caps text-[var(--gilt)]">{KICKER[lang]} · {regionName}</span>
            <h1 className="display-space mt-4 text-[#f5efe3]" style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)" }}>
              {ui.heading1}<em className="text-[var(--color-gold)]">{ui.headingAccent}</em>
            </h1>
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            <p className="micro-caps text-[#f5efe3]/55">{resolve(ui.subtitle)}</p>
          </div>
        </div>
      </section>

      {/* 01 · WEBSITES */}
      <section className={`${container} py-12 md:py-16`}>
        <SectionHead num="01" title={WEBSITES.title[lang]} tagline={WEBSITES.tagline[lang]} />
        <div className="grid gap-5 md:grid-cols-2">
          {WEBSITES.items.map((it, i) => (
            <motion.div
              key={i}
              {...rise}
              transition={reduce ? undefined : { duration: 0.55, delay: (i % 2) * 0.06 }}
              className={`relative flex flex-col rounded-[4px] border p-7 md:p-8 ${
                it.featured ? "border-[var(--color-gold)]/55 bg-[var(--ink-panel)]/40" : "border-[color:var(--gold-line)] bg-transparent"
              }`}
            >
              {it.featured && (
                <span className="absolute -top-3 left-7 rounded-full bg-[var(--color-gold)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[#17130E]">
                  {POPULAR[lang]}
                </span>
              )}
              <div className="flex items-start justify-between gap-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <h3 className="display-space text-[#f5efe3]" style={{ fontSize: "clamp(1.35rem, 2.2vw, 1.75rem)" }}>{it.name[lang]}</h3>
                  {it.badge && (
                    <span className="micro-caps rounded-full border border-[var(--color-gold)]/40 px-2 py-0.5 text-[var(--gilt)]">{it.badge[lang]}</span>
                  )}
                </div>
                <div className="whitespace-nowrap text-right">
                  {it.from && <span className="micro-caps block text-[#f5efe3]/50">{ui.from}</span>}
                  <span className="display-space tnum text-[#f5efe3]" style={{ fontSize: "clamp(1.5rem, 2.4vw, 2rem)" }}>{amount(it.price[region])}</span>
                </div>
              </div>
              <p className="mt-4 text-sm font-light leading-relaxed text-[#f5efe3]/70">{it.desc[lang]}</p>
              {it.meta && <p className="micro-caps mt-auto pt-4 text-[#f5efe3]/45">{it.meta[lang]}</p>}
            </motion.div>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-center justify-center gap-2 text-center sm:flex-row sm:gap-3">
          <p className="text-sm font-light text-[#f5efe3]/60">{ui.notSure}</p>
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]">
            <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
            {ui.ctaWhatsapp}
          </a>
        </div>
      </section>

      {/* 02 · CARE PLANS */}
      <section className={`${container} py-12 md:py-16`}>
        <SectionHead num="02" title={CARE.title[lang]} tagline={CARE.tagline[lang]} />
        <div className="grid gap-5 md:grid-cols-3">
          {CARE.plans.map((p, i) => (
            <motion.div
              key={i}
              {...rise}
              transition={reduce ? undefined : { duration: 0.55, delay: i * 0.08 }}
              className={`relative flex flex-col rounded-[4px] border p-7 md:p-8 ${
                p.featured ? "border-[var(--color-gold)]/55 bg-[var(--ink-panel)]/40" : "border-[color:var(--gold-line)] bg-transparent"
              }`}
            >
              {p.featured && (
                <span className="absolute -top-3 left-7 rounded-full bg-[var(--color-gold)] px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-[#17130E]">
                  {POPULAR[lang]}
                </span>
              )}
              <h3 className="display-space text-[#f5efe3]" style={{ fontSize: "1.5rem" }}>{p.name}</h3>
              <div className="mt-3 mb-6 flex items-baseline gap-1.5">
                <span className="display-space tnum text-[#f5efe3]" style={{ fontSize: "clamp(1.75rem, 3vw, 2.5rem)" }}>{amount(p.price[region])}</span>
                <span className="micro-caps text-[#f5efe3]/50">{ui.perMonth}</span>
              </div>
              <ul className="space-y-3 border-t border-[color:var(--gold-line)] pt-6">
                {p.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-3 text-sm font-light text-[#f5efe3]/75">
                    <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[var(--color-gold)]" strokeWidth={2} />
                    {f[lang]}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </section>

      {/* 03 · BRANDING & CONTENT */}
      <section className={`${container} py-12 md:py-16`}>
        <SectionHead num="03" title={BRANDING.title[lang]} tagline={BRANDING.tagline[lang]} />
        <div className="border-b border-[color:var(--gold-line)]">
          {BRANDING.items.map((it, i) => (
            <motion.div
              key={i}
              {...rise}
              transition={reduce ? undefined : { duration: 0.5, delay: i * 0.05 }}
              className="flex flex-col gap-2 border-t border-[color:var(--gold-line)] py-6 sm:flex-row sm:items-baseline sm:justify-between sm:gap-8"
            >
              <div className="min-w-0">
                <h3 className="display-space text-[#f5efe3]" style={{ fontSize: "clamp(1.2rem, 2vw, 1.5rem)" }}>{it.name[lang]}</h3>
                <p className="mt-1.5 max-w-xl text-sm font-light leading-relaxed text-[#f5efe3]/70">{it.desc[lang]}</p>
                {it.meta && <p className="micro-caps mt-2 text-[#f5efe3]/45">{it.meta[lang]}</p>}
              </div>
              <div className="whitespace-nowrap text-left sm:text-right">
                {it.from && <span className="micro-caps block text-[#f5efe3]/50">{ui.from}</span>}
                <span className="display-space tnum text-[#f5efe3]" style={{ fontSize: "clamp(1.25rem, 2vw, 1.6rem)" }}>{amount(it.price[region])}</span>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* GOOD TO KNOW */}
      <section className={`${container} py-12 md:py-16`}>
        <div className="rounded-[4px] bg-[var(--ink-panel)] p-8 md:p-12">
          <span className="micro-caps text-[var(--gilt)]">{ui.goodToKnow}</span>
          <div className="mt-7 grid gap-x-12 gap-y-4 sm:grid-cols-2">
            {GOOD_TO_KNOW.map((g, i) => (
              <p key={i} className="text-sm font-light leading-relaxed text-[#f5efe3]/70">
                <span className="font-medium text-[#f5efe3]">{g.label[lang]}</span> — {resolve(g.value[lang])}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* CTA — the Espresso dark room */}
      <section className="px-6 sm:px-10 lg:px-16 py-20 md:py-28" style={{ background: "var(--espresso)", color: "var(--paper)" }}>
        <div className="mx-auto max-w-[1400px] text-center">
          <h2 className="display-space mx-auto max-w-3xl" style={{ fontSize: "clamp(2rem, 4.5vw, 3.75rem)", color: "var(--paper)" }}>{ui.ctaHeading}</h2>
          <p className="mx-auto mt-6 max-w-xl text-lg font-light" style={{ color: "rgba(251,248,242,0.68)" }}>{ui.ctaText}</p>
          <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
            <Link
              href={localizedHref(lang, "/#contatti")}
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-gold)] px-8 py-4 text-sm font-semibold tracking-wide text-[#17130E] transition-transform duration-300 hover:scale-[1.02]"
            >
              {ui.ctaContact}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full border px-8 py-4 text-sm font-medium tracking-wide transition-colors duration-300"
              style={{ borderColor: "rgba(201,162,90,0.4)", color: "var(--gilt)" }}
            >
              <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
              {ui.ctaWhatsapp}
            </a>
          </div>
        </div>
      </section>

      <SiteFooter lang={lang} marker={KICKER[lang]} />
    </main>
  );
}

function SectionHead({ num, title, tagline }: { num: string; title: string; tagline: string }) {
  return (
    <div className="mb-10 flex items-baseline gap-4 md:mb-12">
      <span aria-hidden="true" className="display-italic leading-none text-[var(--color-gold)]" style={{ fontSize: "clamp(1.25rem, 2vw, 1.75rem)" }}>{num}</span>
      <h2 className="display-space text-[#f5efe3]" style={{ fontSize: "clamp(1.6rem, 3vw, 2.5rem)" }}>{title}</h2>
      <span className="micro-caps ml-auto hidden text-[#f5efe3]/45 sm:block">{tagline}</span>
    </div>
  );
}
