import Link from "next/link";
import { ArrowLeft, ArrowRight, MessageCircle, MapPin } from "lucide-react";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import { localizedHref, type Locale } from "@/lib/i18n";
import { LOCAL_AREAS, LOCAL_CITIES, type CitySlug } from "@/lib/local-seo";
import { waHref } from "@/lib/whatsapp";
import { PREFILL } from "@/content/home/prefills";
import { REPLY_TEXT } from "@/content/home/promises";
import { buildPrices } from "@/content/home/prices";

// Small localized UI labels for the local-SEO pages (kept here so the page is self-contained).
// The WhatsApp text comes from content/home/prefills.ts (`city`): WhatsApp gives no referrer,
// so the tag inside the pre-filled message is the only way a chat says which page produced it.
// This is a server component, so it always uses the CH number (city pages are CH-targeted).
const UI: Record<Locale, {
  back: string; nav: { pricing: string; portfolio: string; contact: string };
  cta: string; trust: (essential: string) => string; servicesLine: string; viewPricing: string; viewWork: string;
  otherAreas: string; closingText: string; whatsapp: string;
}> = {
  de: {
    back: "Zur Startseite",
    nav: { pricing: "Preise", portfolio: "Arbeiten", contact: "Kontakt" },
    cta: "Offerte zum Fixpreis anfordern",
    trust: (essential) => `Websites ab ${essential} · Fixpreis · kein Pflicht-Abo · Antwort`,
    servicesLine: "Websites, Google-Profile, Branding und Inhalte, mit einer festen Ansprechperson: mir.",
    viewPricing: "Preise ansehen",
    viewWork: "Arbeiten ansehen",
    otherAreas: "Auch tätig in",
    closingText: "Schreib mir zwei Zeilen zu deinem Betrieb. Ich sage dir, ob und wie ich helfen kann und was es kostet.",
    whatsapp: "WhatsApp",
  },
  it: {
    back: "Torna alla home",
    nav: { pricing: "Prezzi", portfolio: "Lavori", contact: "Contatti" },
    cta: "Chiedi un'offerta a prezzo fisso",
    trust: (essential) => `Siti da ${essential} · prezzo fisso · nessun abbonamento obbligatorio · risposta`,
    servicesLine: "Siti, profili Google, branding e contenuti, con una sola persona di riferimento: io.",
    viewPricing: "Vedi i prezzi",
    viewWork: "Guarda i lavori",
    otherAreas: "Attivo anche a",
    closingText: "Scrivimi due righe sulla tua attività. Ti dico se e come posso aiutarti, e quanto costa.",
    whatsapp: "WhatsApp",
  },
  en: {
    back: "Back to home",
    nav: { pricing: "Pricing", portfolio: "Work", contact: "Contact" },
    cta: "Get a fixed-price offer",
    trust: (essential) => `Websites from ${essential} · fixed price · no required subscription · reply`,
    servicesLine: "Websites, Google profiles, branding and content, with one fixed contact: me.",
    viewPricing: "View pricing",
    viewWork: "See my work",
    otherAreas: "Also serving",
    closingText: "Send me two lines about your business. I'll tell you whether and how I can help, and what it costs.",
    whatsapp: "WhatsApp",
  },
};

// German UI terms quoted inside Italian/English copy are marked lang="de" for screen readers.
const GERMAN_TERM = /(Termin buchen)/;
function withGermanTerms(text: string, lang: Locale) {
  if (lang === "de") return text;
  return text.split(GERMAN_TERM).map((part, i) =>
    part === "Termin buchen" ? <span key={i} lang="de">{part}</span> : part,
  );
}

const container = "mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-16";

export default function LocalPage({ slug, lang }: { slug: CitySlug; lang: Locale }) {
  const area = LOCAL_AREAS[slug];
  const u = UI[lang];
  const others = LOCAL_CITIES.filter((c) => c !== slug);
  const contactHref = localizedHref(lang, "/#contatti");
  const prices = buildPrices("ch", lang);
  const whatsapp = waHref(PREFILL[lang].city(area.navLabel[lang]), "ch");

  return (
    <main id="main" tabIndex={-1} className="relative min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text)] overflow-x-hidden outline-none">
      <SiteNav
        lang={lang}
        links={[
          { href: localizedHref(lang, "/prezzi"), label: u.nav.pricing },
          { href: localizedHref(lang, "/#portfolio"), label: u.nav.portfolio },
        ]}
        ctaHref={contactHref}
        ctaLabel={u.nav.contact}
        theme="light"
      />
      <div className="mds-grain" aria-hidden />

      {/* HERO */}
      <section className={`${container} pt-36 pb-16 md:pb-20`}>
        <Link
          href={localizedHref(lang, "/")}
          className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]"
        >
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" strokeWidth={1.5} />
          {u.back}
        </Link>

        <div className="mt-10 flex items-center gap-3">
          <MapPin className="h-4 w-4 text-[var(--gilt)]" strokeWidth={1.6} aria-hidden="true" />
          <span className="micro-caps text-[var(--gilt)]">{area.eyebrow[lang]}</span>
        </div>

        <h1 className="page-h1 display-space mt-5 max-w-4xl text-[#17130e]">
          {area.h1[lang]}
          <em className="gold-grad not-italic">{area.h1accent[lang]}</em>
        </h1>

        <p className="mt-8 max-w-2xl text-lg font-light leading-relaxed text-[#17130e]/70">{area.intro[lang]}</p>

        <div className="mt-9 flex flex-wrap items-center gap-x-7 gap-y-4">
          <a
            href={contactHref}
            className="gold-glow group inline-flex items-center gap-2 rounded-full px-8 py-4 text-sm font-semibold text-[#17130E] transition-transform duration-300 hover:scale-[1.03]"
            style={{ background: "linear-gradient(100deg, #e8c877, #b5893f)", fontFamily: "var(--font-space)" }}
          >
            {u.cta}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </a>
          <Link href={localizedHref(lang, "/#portfolio")} className="group inline-flex items-center gap-2 text-sm tracking-wide text-[#17130e]/70 transition-colors hover:text-[#17130e]">
            {u.viewWork}
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>

        <p className="mt-10 max-w-3xl border-t border-[color:var(--gold-line)] pt-5 text-sm font-light leading-relaxed text-[#17130e]/60">
          {u.trust(prices.essential)} <span className="whitespace-nowrap">{REPLY_TEXT[lang].short}</span>
        </p>
      </section>

      {/* WHY LOCAL */}
      <section className={`${container} py-12 md:py-16`}>
        <div className="rounded-[4px] bg-[var(--ink-panel)] p-8 md:p-12">
          <h2 className="display-space text-[#17130e]" style={{ fontSize: "clamp(1.6rem, 3.4vw, 2.75rem)" }}>{area.localTitle[lang]}</h2>
          <p className="mt-5 max-w-3xl text-lg font-light leading-relaxed text-[#17130e]/70">{withGermanTerms(area.localBody[lang], lang)}</p>
          <p className="mt-8 max-w-2xl font-light leading-relaxed text-[#17130e]/60">{u.servicesLine}</p>
          <div className="mt-6">
            <Link href={localizedHref(lang, "/prezzi")} className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]">
              {u.viewPricing}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* OTHER AREAS — internal links */}
      <section className={`${container} py-8`}>
        <span className="micro-caps text-[#17130e]/70">{u.otherAreas}</span>
        <div className="mt-4 flex flex-wrap gap-3">
          {others.map((c) => (
            <Link
              key={c}
              href={localizedHref(lang, `/webdesign/${c}`)}
              className="inline-flex items-center gap-2 rounded-full border border-[color:var(--gold-line-strong)] px-5 py-2.5 text-sm text-[#17130e]/80 transition-colors hover:border-[var(--color-gold)] hover:text-[#17130e]"
            >
              <MapPin className="h-3.5 w-3.5 text-[var(--gilt)]" strokeWidth={1.6} aria-hidden="true" />
              {LOCAL_AREAS[c].navLabel[lang]}
            </Link>
          ))}
        </div>
      </section>

      {/* CTA — Espresso room */}
      <section className="px-6 sm:px-10 lg:px-16 py-20 md:py-28" style={{ background: "var(--ink-panel)", color: "#17130e" }}>
        <div className="mx-auto max-w-[1400px] text-center">
          <h2 className="section-head display-space mx-auto max-w-3xl text-[#17130e]">{area.ctaHeading[lang]}</h2>
          <p className="mx-auto mt-6 max-w-xl text-lg font-light" style={{ color: "rgba(31,27,22,0.68)" }}>{u.closingText}</p>
          <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
            <a
              href={contactHref}
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-gold)] px-8 py-4 text-sm font-semibold tracking-wide text-[#17130E] transition-transform duration-300 hover:scale-[1.02]"
            >
              {u.cta}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
            <a
              href={whatsapp}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-full border px-8 py-4 text-sm font-medium tracking-wide transition-colors duration-300"
              style={{ borderColor: "rgba(201,162,90,0.4)", color: "var(--gilt)" }}
            >
              <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
              {u.whatsapp}
            </a>
          </div>
        </div>
      </section>

      <SiteFooter lang={lang} marker={area.eyebrow[lang]} />
    </main>
  );
}
