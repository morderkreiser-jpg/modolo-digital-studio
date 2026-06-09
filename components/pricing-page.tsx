"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, Check, MessageCircle } from "lucide-react";
import SiteNav from "@/components/site-nav";
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
  REGIONS,
  DEFAULT_REGION,
  REGION_COOKIE,
  isRegion,
  type Region,
} from "@/lib/pricing";

// The pricing region lives in the MDS_REGION cookie (set by proxy.ts geo, or the toggle).
// Read it via useSyncExternalStore so SSR uses the default and the client reflects the cookie
// without a hydration mismatch or a setState-in-effect.
function readRegion(): Region {
  if (typeof document === "undefined") return DEFAULT_REGION;
  const m = document.cookie.match(/(?:^|;\s*)MDS_REGION=(ch|it)/);
  return m && isRegion(m[1]) ? m[1] : DEFAULT_REGION;
}
function subscribeRegion(onChange: () => void) {
  window.addEventListener("mds-region", onChange);
  return () => window.removeEventListener("mds-region", onChange);
}
// Persist the currency choice and notify subscribers. Module-level (not in the component) so
// it stays a plain browser side effect.
function rememberRegion(r: Region) {
  document.cookie = `${REGION_COOKIE}=${r}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  window.dispatchEvent(new Event("mds-region"));
}

const POPULAR: Record<Locale, string> = { en: "Popular", de: "Beliebt", it: "Consigliato" };
const FOOT: Record<Locale, { home: string; imprint: string; privacy: string }> = {
  en: { home: "Home", imprint: "Legal Notice", privacy: "Privacy Policy" },
  de: { home: "Home", imprint: "Impressum", privacy: "Datenschutz" },
  it: { home: "Home", imprint: "Note legali", privacy: "Privacy" },
};

// Thousands separator per display locale (English comma, Swiss German apostrophe, Italian dot)
// so the separator is unambiguous in each language. Formatted manually rather than via Intl so
// the result is byte-identical on server and client regardless of the runtime's ICU data.
const THOUSANDS: Record<Locale, string> = { en: ",", de: "'", it: "." };
function groupThousands(n: number, sep: string): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export default function PricingPage({
  lang,
  initialRegion = DEFAULT_REGION,
}: {
  lang: Locale;
  initialRegion?: Region;
}) {
  // SSR uses initialRegion (resolved server-side from geo/cookie); the client then reflects the
  // MDS_REGION cookie via the store — same value, so no hydration mismatch and no price flash.
  const region = useSyncExternalStore(subscribeRegion, readRegion, () => initialRegion);
  const ui = PRICING_UI[lang];
  const foot = FOOT[lang];
  const year = new Date().getFullYear();
  const whatsapp = `https://wa.me/${(region === "it" ? SITE.phoneIt : SITE.phone).replace(/[^0-9]/g, "")}`;
  const sep = THOUSANDS[lang];
  const cur = CURRENCY[region];
  const amount = (n: number) => `${cur} ${groupThousands(n, sep)}`;
  const regionName = region === "it" ? ui.regionIt : ui.regionCh;

  const chooseRegion = (r: Region) => rememberRegion(r);

  const resolve = (s: string) =>
    s.replace("{cur}", cur).replace("{hourly}", groupThousands(HOURLY[region], sep)).replace("{vat}", VAT[region]);

  return (
    <main id="main" tabIndex={-1} className="min-h-screen bg-[#F7F3EC] text-[#1F1B16] overflow-x-hidden outline-none">
      <SiteNav lang={lang} ctaLabel={ui.ctaContact} ctaHref={localizedHref(lang, "/#contatti")} />

      {/* HERO + currency toggle */}
      <section className="relative max-w-6xl mx-auto px-6 lg:px-8 pt-36 pb-10">
        <div className="absolute top-24 right-0 w-[400px] h-[400px] bg-[#B5893F]/[0.05] rounded-full blur-[120px] -z-0" />
        <Link
          href={localizedHref(lang, "/")}
          className="inline-flex items-center gap-2 text-sm text-[#1F1B16]/70 hover:text-[#B5893F] tracking-wider transition-colors mb-10"
        >
          <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
          {ui.back}
        </Link>
        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <h1 className="text-4xl md:text-6xl font-light tracking-tight">
            {ui.heading1}
            <span className="italic font-serif text-[#B5893F]">{ui.headingAccent}</span>
          </h1>
          <div className="flex flex-col items-start md:items-end gap-2">
            <div role="group" aria-label={ui.currencyLabel} className="flex items-center gap-1 border border-[#1F1B16]/12 rounded-full p-0.5 bg-white">
              {REGIONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => chooseRegion(r)}
                  aria-pressed={region === r}
                  className={`px-4 py-2 text-xs tracking-wider uppercase rounded-full transition-colors ${
                    region === r ? "bg-[#8F6B2F] text-white" : "text-[#1F1B16]/70 hover:text-[#1F1B16]"
                  }`}
                >
                  {r === "ch" ? "CHF" : "EUR"}
                </button>
              ))}
            </div>
            <p className="text-xs text-[#1F1B16]/70">{resolve(ui.subtitle)}</p>
            <p className="sr-only" role="status" aria-live="polite">
              {ui.regionNote.replace("{region}", regionName)}
            </p>
          </div>
        </div>
      </section>

      {/* 01 · WEBSITES */}
      <section className="max-w-6xl mx-auto px-6 lg:px-8 py-10">
        <SectionHead num="01" title={WEBSITES.title[lang]} tagline={WEBSITES.tagline[lang]} />
        <div className="grid md:grid-cols-2 gap-6">
          {WEBSITES.items.map((it, i) => (
            <div
              key={i}
              className="group relative p-8 rounded-2xl border border-[#1F1B16]/[0.08] bg-white shadow-[0_4px_30px_rgba(31,27,22,0.04)] hover:border-[#B5893F]/40 hover:shadow-[0_10px_40px_rgba(31,27,22,0.08)] transition-all duration-300 flex flex-col"
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="flex items-center gap-3 flex-wrap">
                  <h3 className="text-xl font-light">{it.name[lang]}</h3>
                  {it.badge && (
                    <span className="text-[10px] tracking-wider uppercase text-[var(--color-gold-ink)] border border-[#B5893F]/30 bg-[#B5893F]/[0.06] px-2 py-0.5 rounded-full">
                      {it.badge[lang]}
                    </span>
                  )}
                </div>
                <div className="text-right whitespace-nowrap">
                  {it.from && <span className="block text-[10px] tracking-wider uppercase text-[#1F1B16]/70">{ui.from}</span>}
                  <span className="text-2xl font-light">{amount(it.price[region])}</span>
                </div>
              </div>
              <p className="text-[#1F1B16]/70 font-light leading-relaxed text-sm mb-4">{it.desc[lang]}</p>
              {it.meta && <p className="text-xs text-[#1F1B16]/70 mt-auto pt-2">{it.meta[lang]}</p>}
            </div>
          ))}
        </div>
      </section>

      {/* 02 · CARE PLANS */}
      <section className="max-w-6xl mx-auto px-6 lg:px-8 py-10">
        <SectionHead num="02" title={CARE.title[lang]} tagline={CARE.tagline[lang]} />
        <div className="grid md:grid-cols-3 gap-6">
          {CARE.plans.map((p, i) => (
            <div
              key={i}
              className={`relative p-8 rounded-2xl border bg-white flex flex-col ${
                p.featured
                  ? "border-[#B5893F]/50 shadow-[0_10px_40px_rgba(31,27,22,0.10)]"
                  : "border-[#1F1B16]/[0.08] shadow-[0_4px_30px_rgba(31,27,22,0.04)]"
              }`}
            >
              {p.featured && (
                <span className="absolute -top-3 left-8 text-[10px] tracking-wider uppercase bg-[#8F6B2F] text-white px-3 py-1 rounded-full">
                  {POPULAR[lang]}
                </span>
              )}
              <h3 className="text-lg font-light mb-2">{p.name}</h3>
              <div className="mb-6 flex items-baseline gap-1">
                <span className="text-3xl font-light">{amount(p.price[region])}</span>
                <span className="text-sm text-[#1F1B16]/70">{ui.perMonth}</span>
              </div>
              <ul className="space-y-3">
                {p.features.map((f, j) => (
                  <li key={j} className="flex items-start gap-3 text-sm text-[#1F1B16]/70 font-light">
                    <Check className="w-4 h-4 text-[#B5893F] flex-shrink-0 mt-0.5" strokeWidth={2} />
                    {f[lang]}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* 03 · BRANDING & CONTENT */}
      <section className="max-w-6xl mx-auto px-6 lg:px-8 py-10">
        <SectionHead num="03" title={BRANDING.title[lang]} tagline={BRANDING.tagline[lang]} />
        <div className="rounded-2xl border border-[#1F1B16]/[0.08] bg-white divide-y divide-[#1F1B16]/[0.06] shadow-[0_4px_30px_rgba(31,27,22,0.04)]">
          {BRANDING.items.map((it, i) => (
            <div key={i} className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-6 p-6">
              <div className="min-w-0">
                <h3 className="font-light mb-1">{it.name[lang]}</h3>
                <p className="text-sm text-[#1F1B16]/70 font-light max-w-xl leading-relaxed">{it.desc[lang]}</p>
                {it.meta && <p className="text-xs text-[#1F1B16]/70 mt-1">{it.meta[lang]}</p>}
              </div>
              <div className="text-left sm:text-right whitespace-nowrap">
                {it.from && <span className="block text-[10px] tracking-wider uppercase text-[#1F1B16]/70">{ui.from}</span>}
                <span className="text-lg font-light">{amount(it.price[region])}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* GOOD TO KNOW */}
      <section className="max-w-6xl mx-auto px-6 lg:px-8 py-10">
        <div className="rounded-2xl border border-[#1F1B16]/[0.08] bg-[#EEE6D8] p-8">
          <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-6 block">{ui.goodToKnow}</span>
          <div className="grid sm:grid-cols-2 gap-x-10 gap-y-3">
            {GOOD_TO_KNOW.map((g, i) => (
              <p key={i} className="text-sm text-[#1F1B16]/70 font-light">
                <span className="font-medium text-[#1F1B16]">{g.label[lang]}</span> — {resolve(g.value[lang])}
              </p>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-6xl mx-auto px-6 lg:px-8 py-12 pb-24">
        <div className="relative overflow-hidden rounded-3xl border border-[#1F1B16]/[0.08] bg-[#EEE6D8] px-8 py-14 text-center">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#B5893F]/[0.06] rounded-full blur-[120px]" />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-light tracking-tight mb-4">{ui.ctaHeading}</h2>
            <p className="text-[#1F1B16]/70 font-light mb-8 max-w-xl mx-auto">{ui.ctaText}</p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href={localizedHref(lang, "/#contatti")}
                className="group inline-flex items-center justify-center gap-2 bg-[#1F1B16] text-[#F7F3EC] px-8 py-4 rounded-full font-medium tracking-wider hover:bg-[#33291E] transition-all duration-300"
              >
                {ui.ctaContact}
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
              <a
                href={whatsapp}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 border border-[#1F1B16]/15 px-8 py-4 rounded-full font-medium tracking-wider hover:border-[#B5893F]/60 hover:text-[#B5893F] transition-all duration-300"
              >
                <MessageCircle className="w-4 h-4" strokeWidth={1.5} />
                {ui.ctaWhatsapp}
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#1F1B16]/[0.08] py-10 px-6 lg:px-8 bg-[#ECE3D3]">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm text-[#1F1B16]/70 tracking-wider">© {year} Modolo Digital Studio</span>
          <div className="flex items-center gap-5 text-xs tracking-wider">
            <Link href={localizedHref(lang, "/")} className="text-[#1F1B16]/70 hover:text-[#B5893F] transition-colors">{foot.home}</Link>
            <Link href={localizedHref(lang, "/impressum")} className="text-[#1F1B16]/70 hover:text-[#B5893F] transition-colors">{foot.imprint}</Link>
            <Link href={localizedHref(lang, "/privacy")} className="text-[#1F1B16]/70 hover:text-[#B5893F] transition-colors">{foot.privacy}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function SectionHead({ num, title, tagline }: { num: string; title: string; tagline: string }) {
  return (
    <div className="flex items-baseline gap-4 mb-10">
      <span aria-hidden="true" className="font-serif italic text-[#B5893F] text-2xl">{num}</span>
      <h2 className="text-2xl md:text-3xl font-light tracking-tight">{title}</h2>
      <span className="text-sm text-[#1F1B16]/70 hidden sm:block ml-auto font-serif italic">{tagline}</span>
    </div>
  );
}
