import Link from "next/link";
import { ArrowLeft, ArrowRight, MessageCircle, MapPin } from "lucide-react";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import { localizedHref, type Locale } from "@/lib/i18n";
import { LOCAL_AREAS, LOCAL_CITIES, type CitySlug } from "@/lib/local-seo";
import { SITE } from "@/lib/site";

const SITE_PHONE_DIGITS = SITE.phone.replace(/[^0-9]/g, "");

// Small localized UI labels for the local-SEO pages (kept here so the page is self-contained).
const UI: Record<Locale, {
  back: string; nav: { pricing: string; portfolio: string; contact: string };
  cta: string; trust: string; servicesLine: string; viewPricing: string; viewWork: string;
  otherAreas: string; closingText: string; whatsapp: string;
}> = {
  de: {
    back: "Zur Startseite",
    nav: { pricing: "Preise", portfolio: "Portfolio", contact: "Kontakt" },
    cta: "Gratis-Beratung vereinbaren",
    trust: "Websites ab CHF 1'900 · Festpreis · gratis Erstberatung · Antwort in 24 h",
    servicesLine: "Websites, lokales SEO, Branding und Inhalte — alles aus einer Hand, von mir.",
    viewPricing: "Preise ansehen",
    viewWork: "Arbeiten ansehen",
    otherAreas: "Auch tätig in",
    closingText: "Eine kurze, unverbindliche Beratung — du erzählst mir von deinem Betrieb, ich sage dir ehrlich, ob und wie ich helfen kann.",
    whatsapp: "WhatsApp",
  },
  it: {
    back: "Torna alla home",
    nav: { pricing: "Prezzi", portfolio: "Portfolio", contact: "Contatti" },
    cta: "Prenota una consulenza gratuita",
    trust: "Siti da CHF 1'900 · prezzo fisso · prima consulenza gratuita · risposta in 24 h",
    servicesLine: "Siti, SEO locale, branding e contenuti — tutto da un'unica persona, io.",
    viewPricing: "Vedi i prezzi",
    viewWork: "Guarda i lavori",
    otherAreas: "Attivo anche a",
    closingText: "Una chiacchierata breve e senza impegno — mi racconti la tua attività e ti dico onestamente se e come posso aiutarti.",
    whatsapp: "WhatsApp",
  },
  en: {
    back: "Back to home",
    nav: { pricing: "Pricing", portfolio: "Portfolio", contact: "Contact" },
    cta: "Book a free consultation",
    trust: "Websites from CHF 1,900 · fixed price · free first consultation · reply within 24 h",
    servicesLine: "Websites, local SEO, branding and content — all from one person: me.",
    viewPricing: "View pricing",
    viewWork: "See my work",
    otherAreas: "Also serving",
    closingText: "A short, no-obligation chat — you tell me about your business and I tell you honestly whether and how I can help.",
    whatsapp: "WhatsApp",
  },
};

const container = "mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-16";

export default function LocalPage({ slug, lang }: { slug: CitySlug; lang: Locale }) {
  const area = LOCAL_AREAS[slug];
  const u = UI[lang];
  const others = LOCAL_CITIES.filter((c) => c !== slug);
  const contactHref = localizedHref(lang, "/#contatti");

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

        <p className="mt-10 max-w-3xl border-t border-[color:var(--gold-line)] pt-5 text-sm font-light leading-relaxed text-[#17130e]/60">{u.trust}</p>
      </section>

      {/* WHY LOCAL */}
      <section className={`${container} py-12 md:py-16`}>
        <div className="rounded-[4px] bg-[var(--ink-panel)] p-8 md:p-12">
          <h2 className="display-space text-[#17130e]" style={{ fontSize: "clamp(1.6rem, 3.4vw, 2.75rem)" }}>{area.localTitle[lang]}</h2>
          <p className="mt-5 max-w-3xl text-lg font-light leading-relaxed text-[#17130e]/70">{area.localBody[lang]}</p>
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
        <span className="micro-caps text-[#17130e]/40">{u.otherAreas}</span>
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
              href={`https://wa.me/${SITE_PHONE_DIGITS}`}
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
