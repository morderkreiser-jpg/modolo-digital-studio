"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, MessageCircle } from "lucide-react";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import { localizedHref, type Locale } from "@/lib/i18n";
import { SITE } from "@/lib/site";
import { useRegion, whatsappHref } from "@/components/use-region";

export type Lang = Locale;
export type Slug = "web" | "brand" | "content" | "email";

export const SERVICE_SLUGS: Slug[] = ["web", "brand", "content", "email"];

const ui: Record<
  Lang,
  {
    label: string;
    includes: string;
    approach: string;
    other: string;
    back: string;
    ctaTitle: string;
    ctaText: string;
    ctaButton: string;
    ctaWhatsapp: string;
    whatsappMsg: string;
    ctaPricing: string;
  }
> = {
  en: {
    label: "Service",
    includes: "What's included",
    approach: "How we work",
    other: "Other services",
    back: "All services",
    ctaTitle: "Ready to stand out?",
    ctaText: "Tell us about your project — the first consultation is free.",
    ctaButton: "Talk to us",
    ctaWhatsapp: "WhatsApp",
    whatsappMsg: "Hi Francesco, I'd like to talk about a project.",
    ctaPricing: "See pricing",
  },
  de: {
    label: "Leistung",
    includes: "Was enthalten ist",
    approach: "Wie wir arbeiten",
    other: "Weitere Leistungen",
    back: "Alle Leistungen",
    ctaTitle: "Bereit, dich abzuheben?",
    ctaText: "Erzähl uns von deinem Projekt – die Erstberatung ist kostenlos.",
    ctaButton: "Sprich mit uns",
    ctaWhatsapp: "WhatsApp",
    whatsappMsg: "Hallo Francesco, ich möchte über ein Projekt sprechen.",
    ctaPricing: "Preise ansehen",
  },
  it: {
    label: "Servizio",
    includes: "Cosa include",
    approach: "Come lavoriamo",
    other: "Altri servizi",
    back: "Tutti i servizi",
    ctaTitle: "Pronto a distinguerti?",
    ctaText: "Raccontaci il tuo progetto – la prima consulenza è gratuita.",
    ctaButton: "Parla con noi",
    ctaWhatsapp: "WhatsApp",
    whatsappMsg: "Ciao Francesco, vorrei parlare di un progetto.",
    ctaPricing: "Vedi i prezzi",
  },
};

type Service = {
  title: string;
  intro: string;
  includes: string[];
  approach: { title: string; desc: string }[];
};

const content: Record<Slug, Record<Lang, Service>> = {
  web: {
    en: {
      title: "Web & Development",
      intro:
        "Fast, modern websites built to convert — designed around your brand and optimised to be found locally. From the first sketch to launch and beyond, we build digital foundations that truly work for your business.",
      includes: [
        "Custom web design tailored to your brand",
        "High-performance development (fast, secure, mobile-first)",
        "Local SEO optimisation to rank in your area",
        "Google Business profile setup and optimisation",
        "Responsive layouts that look great on every device",
        "Ongoing support and maintenance after launch",
      ],
      approach: [
        { title: "Strategy first", desc: "We start from your goals, your audience and your market — so every page has a purpose." },
        { title: "Built to perform", desc: "Clean, modern code and best practices for speed, security and search visibility." },
        { title: "Made to last", desc: "Easy to maintain and ready to grow together with your business." },
      ],
    },
    de: {
      title: "Web & Entwicklung",
      intro:
        "Schnelle, moderne Websites, die konvertieren – gestaltet rund um deine Marke und optimiert, um lokal gefunden zu werden. Vom ersten Entwurf bis zum Launch und darüber hinaus bauen wir digitale Grundlagen, die für dein Unternehmen wirklich funktionieren.",
      includes: [
        "Massgeschneidertes Webdesign, abgestimmt auf deine Marke",
        "Performante Entwicklung (schnell, sicher, mobile-first)",
        "Lokale SEO-Optimierung für deine Region",
        "Einrichtung und Optimierung deines Google-Business-Profils",
        "Responsive Layouts, die auf jedem Gerät überzeugen",
        "Laufender Support und Wartung nach dem Launch",
      ],
      approach: [
        { title: "Strategie zuerst", desc: "Wir starten bei deinen Zielen, deiner Zielgruppe und deinem Markt – damit jede Seite einen Zweck hat." },
        { title: "Auf Leistung gebaut", desc: "Sauberer, moderner Code und Best Practices für Geschwindigkeit, Sicherheit und Sichtbarkeit." },
        { title: "Gemacht, um zu bleiben", desc: "Einfach zu pflegen und bereit, mit deinem Unternehmen zu wachsen." },
      ],
    },
    it: {
      title: "Web & Sviluppo",
      intro:
        "Siti web veloci e moderni, costruiti per convertire – progettati attorno al tuo brand e ottimizzati per essere trovati sul territorio. Dal primo schizzo al lancio e oltre, costruiamo basi digitali che funzionano davvero per la tua attività.",
      includes: [
        "Web design su misura, in linea con il tuo brand",
        "Sviluppo performante (veloce, sicuro, mobile-first)",
        "Ottimizzazione SEO locale per emergere nella tua zona",
        "Configurazione e ottimizzazione del profilo Google Business",
        "Layout responsive, perfetti su ogni dispositivo",
        "Assistenza e manutenzione continua dopo il lancio",
      ],
      approach: [
        { title: "Prima la strategia", desc: "Partiamo dai tuoi obiettivi, dal pubblico e dal mercato – così ogni pagina ha uno scopo." },
        { title: "Costruito per rendere", desc: "Codice pulito e moderno, con le migliori pratiche per velocità, sicurezza e visibilità." },
        { title: "Fatto per durare", desc: "Facile da mantenere e pronto a crescere con la tua attività." },
      ],
    },
  },
  brand: {
    en: {
      title: "Brand & Identity",
      intro:
        "A memorable brand is more than a logo. We craft cohesive visual identities — from your logo to colours, typography and branded templates — that tell your story and make you instantly recognisable.",
      includes: [
        "Logo design and full visual identity",
        "Colour palette and typography system",
        "Branded Canva templates for everyday use",
        "Brand guidelines to keep everything consistent",
        "Visual kit for social media",
        "Stationery and marketing materials",
      ],
      approach: [
        { title: "Discover", desc: "We get to know your values, your audience and what makes you different." },
        { title: "Design", desc: "We translate that into a distinctive, coherent visual language." },
        { title: "Deliver", desc: "You get ready-to-use assets and clear guidelines to apply them." },
      ],
    },
    de: {
      title: "Marke & Identität",
      intro:
        "Eine einprägsame Marke ist mehr als ein Logo. Wir gestalten stimmige visuelle Identitäten – vom Logo über Farben und Typografie bis zu gebrandeten Vorlagen –, die deine Geschichte erzählen und dich sofort wiedererkennbar machen.",
      includes: [
        "Logodesign und komplette visuelle Identität",
        "Farbpalette und Typografie-System",
        "Gebrandete Canva-Vorlagen für den Alltag",
        "Markenrichtlinien für durchgängige Konsistenz",
        "Visual-Kit für Social Media",
        "Geschäftsausstattung und Marketingmaterialien",
      ],
      approach: [
        { title: "Entdecken", desc: "Wir lernen deine Werte, deine Zielgruppe und das, was dich besonders macht, kennen." },
        { title: "Gestalten", desc: "Wir übersetzen das in eine unverwechselbare, kohärente visuelle Sprache." },
        { title: "Übergeben", desc: "Du erhältst einsatzbereite Assets und klare Richtlinien zur Anwendung." },
      ],
    },
    it: {
      title: "Brand & Identità",
      intro:
        "Un brand memorabile è molto più di un logo. Creiamo identità visive coerenti – dal logo a colori, tipografia e template brandizzati – che raccontano la tua storia e ti rendono subito riconoscibile.",
      includes: [
        "Design del logo e identità visiva completa",
        "Palette colori e sistema tipografico",
        "Template Canva brandizzati per l'uso quotidiano",
        "Linee guida del brand per la massima coerenza",
        "Kit visivo per i social media",
        "Materiali di cancelleria e marketing",
      ],
      approach: [
        { title: "Scopriamo", desc: "Conosciamo i tuoi valori, il tuo pubblico e ciò che ti rende diverso." },
        { title: "Progettiamo", desc: "Traduciamo tutto in un linguaggio visivo distintivo e coerente." },
        { title: "Consegniamo", desc: "Ricevi asset pronti all'uso e linee guida chiare per applicarli." },
      ],
    },
  },
  content: {
    en: {
      title: "Content & Visual",
      intro:
        "Great content makes your brand come alive. Through professional photography and social media management — in collaboration with Project Visibility — we produce visuals and stories that engage your audience.",
      includes: [
        "Professional photo shoots",
        "Social media management (with Project Visibility)",
        "Content planning and editorial calendar",
        "Visual storytelling for your brand",
        "Optimised images for web and social",
        "Consistent, on-brand content",
      ],
      approach: [
        { title: "Plan", desc: "We define the story to tell and the content that supports your goals." },
        { title: "Produce", desc: "Professional shoots and assets, crafted with care." },
        { title: "Publish", desc: "A consistent presence across your channels, managed for you." },
      ],
    },
    de: {
      title: "Content & Visual",
      intro:
        "Guter Content erweckt deine Marke zum Leben. Mit professioneller Fotografie und Social-Media-Betreuung – in Zusammenarbeit mit Project Visibility – produzieren wir Visuals und Geschichten, die deine Zielgruppe begeistern.",
      includes: [
        "Professionelle Fotoshootings",
        "Social-Media-Betreuung (mit Project Visibility)",
        "Content-Planung und Redaktionskalender",
        "Visuelles Storytelling für deine Marke",
        "Optimierte Bilder für Web und Social",
        "Konsistenter, markengerechter Content",
      ],
      approach: [
        { title: "Planen", desc: "Wir definieren die Geschichte und den Content, der deine Ziele unterstützt." },
        { title: "Produzieren", desc: "Professionelle Shootings und Assets, mit Sorgfalt erstellt." },
        { title: "Veröffentlichen", desc: "Eine konsistente Präsenz auf deinen Kanälen, für dich betreut." },
      ],
    },
    it: {
      title: "Contenuti & Visual",
      intro:
        "I buoni contenuti danno vita al tuo brand. Con shooting fotografici professionali e gestione social – in collaborazione con Project Visibility – produciamo visual e storie che coinvolgono il tuo pubblico.",
      includes: [
        "Shooting fotografici professionali",
        "Gestione social media (con Project Visibility)",
        "Pianificazione contenuti e calendario editoriale",
        "Visual storytelling per il tuo brand",
        "Immagini ottimizzate per web e social",
        "Contenuti coerenti e in linea con il brand",
      ],
      approach: [
        { title: "Pianifichiamo", desc: "Definiamo la storia da raccontare e i contenuti che sostengono i tuoi obiettivi." },
        { title: "Produciamo", desc: "Shooting e asset professionali, curati nel dettaglio." },
        { title: "Pubblichiamo", desc: "Una presenza costante sui tuoi canali, gestita per te." },
      ],
    },
  },
  email: {
    en: {
      title: "Email Marketing",
      intro:
        "Email is still the channel that turns contacts into customers. We design newsletters and automated campaigns that nurture your audience and grow your business — measurable, on-brand and effective.",
      includes: [
        "Newsletter design and setup",
        "Automated email campaigns and flows",
        "Audience segmentation",
        "On-brand, mobile-friendly templates",
        "Performance tracking and optimisation",
        "Strategy to turn subscribers into clients",
      ],
      approach: [
        { title: "Strategy", desc: "We define who to reach and what to say to drive results." },
        { title: "Automate", desc: "We set up flows that work for you around the clock." },
        { title: "Optimise", desc: "We measure and refine to keep improving conversions." },
      ],
    },
    de: {
      title: "E-Mail-Marketing",
      intro:
        "E-Mail ist nach wie vor der Kanal, der Kontakte in Kunden verwandelt. Wir gestalten Newsletter und automatisierte Kampagnen, die deine Zielgruppe pflegen und dein Geschäft wachsen lassen – messbar, markengerecht und wirksam.",
      includes: [
        "Newsletter-Design und -Einrichtung",
        "Automatisierte E-Mail-Kampagnen und Flows",
        "Zielgruppen-Segmentierung",
        "Markengerechte, mobiloptimierte Vorlagen",
        "Performance-Tracking und Optimierung",
        "Strategie, um Abonnenten zu Kunden zu machen",
      ],
      approach: [
        { title: "Strategie", desc: "Wir definieren, wen wir erreichen und was wir sagen, um Ergebnisse zu erzielen." },
        { title: "Automatisieren", desc: "Wir richten Flows ein, die rund um die Uhr für dich arbeiten." },
        { title: "Optimieren", desc: "Wir messen und verfeinern, um die Conversions stetig zu verbessern." },
      ],
    },
    it: {
      title: "Email Marketing",
      intro:
        "L'email è ancora il canale che trasforma i contatti in clienti. Creiamo newsletter e campagne automatizzate che coltivano il tuo pubblico e fanno crescere il business – misurabili, in linea col brand ed efficaci.",
      includes: [
        "Design e configurazione della newsletter",
        "Campagne email automatizzate e flussi",
        "Segmentazione del pubblico",
        "Template in linea col brand e ottimizzati per mobile",
        "Monitoraggio dei risultati e ottimizzazione",
        "Strategia per trasformare gli iscritti in clienti",
      ],
      approach: [
        { title: "Strategia", desc: "Definiamo chi raggiungere e cosa dire per ottenere risultati." },
        { title: "Automatizziamo", desc: "Creiamo flussi che lavorano per te 24 ore su 24." },
        { title: "Ottimizziamo", desc: "Misuriamo e miglioriamo per aumentare le conversioni." },
      ],
    },
  },
};

const container = "mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-16";
const pad = (n: number) => String(n).padStart(2, "0");

export default function ServicePage({ slug, lang }: { slug: Slug; lang: Lang }) {
  const u = ui[lang];
  const s = content[slug][lang];
  const reduce = useReducedMotion();
  const region = useRegion();
  const whatsapp = whatsappHref(region, SITE.phone, SITE.phoneIt, u.whatsappMsg);
  const others = SERVICE_SLUGS.filter((x) => x !== slug);
  const num = pad(SERVICE_SLUGS.indexOf(slug) + 1);

  const rise = reduce ? {} : { initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-8%" }, transition: { duration: 0.6 } };

  return (
    <main id="main" tabIndex={-1} className="relative min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text)] overflow-x-hidden outline-none">
      <SiteNav lang={lang} ctaLabel={u.ctaButton} ctaHref={localizedHref(lang, "/#contatti")} theme="light" />
      <div className="mds-grain" aria-hidden />
      
      {/* HERO */}
      <section className={`${container} pt-36 pb-14 md:pb-20`}>
        <Link href={localizedHref(lang, "/#servizi")} className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" strokeWidth={1.5} />
          {u.back}
        </Link>
        <div className="mt-12 flex items-baseline justify-between gap-4">
          <span className="micro-caps text-[var(--gilt)]">{num} · {u.label}</span>
          <span className="micro-caps tnum text-[#17130e]/40">{num} / {pad(SERVICE_SLUGS.length)}</span>
        </div>
        <h1 className="display-space mt-5 text-[#17130e]" style={{ fontSize: "clamp(2.5rem, 6.4vw, 5.5rem)" }}>{s.title}</h1>
        <p className="mt-7 max-w-3xl text-lg font-light leading-relaxed text-[#17130e]/65 md:text-xl">{s.intro}</p>
      </section>

      {/* INCLUDES */}
      <section className={`${container} py-12 md:py-16`}>
        <div className="mb-10 flex items-baseline gap-4 md:mb-12">
          <span aria-hidden="true" className="display-italic leading-none text-[var(--color-gold)]" style={{ fontSize: "clamp(1.25rem, 2vw, 1.75rem)" }}>—</span>
          <h2 className="display-space text-[#17130e]" style={{ fontSize: "clamp(1.6rem, 3vw, 2.5rem)" }}>{u.includes}</h2>
        </div>
        <div className="grid border-b border-[color:var(--gold-line)] sm:grid-cols-2 sm:gap-x-12">
          {s.includes.map((item, i) => (
            <motion.div key={i} {...rise} transition={reduce ? undefined : { duration: 0.45, delay: (i % 2) * 0.05 }} className="flex items-start gap-4 border-t border-[color:var(--gold-line)] py-5">
              <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-[var(--color-gold)]" strokeWidth={1.6} />
              <span className="font-light leading-relaxed text-[#17130e]/80">{item}</span>
            </motion.div>
          ))}
        </div>
      </section>

      {/* APPROACH */}
      <section className={`${container} py-12 md:py-16`}>
        <div className="mb-10 flex items-baseline gap-4 md:mb-14">
          <span aria-hidden="true" className="display-italic leading-none text-[var(--color-gold)]" style={{ fontSize: "clamp(1.25rem, 2vw, 1.75rem)" }}>—</span>
          <h2 className="display-space text-[#17130e]" style={{ fontSize: "clamp(1.6rem, 3vw, 2.5rem)" }}>{u.approach}</h2>
        </div>
        <div className="grid gap-y-10 md:grid-cols-3 md:gap-x-12">
          {s.approach.map((step, i) => (
            <motion.div key={i} {...rise} transition={reduce ? undefined : { duration: 0.6, delay: i * 0.1 }} className="border-t border-[var(--color-gold)]/30 pt-6">
              <div className="flex items-baseline gap-4">
                <span aria-hidden="true" className="display-italic leading-none text-[var(--color-gold)]" style={{ fontSize: "clamp(1.1rem, 2vw, 1.6rem)" }}>{pad(i + 1)}</span>
                <h3 className="display-space text-[#17130e]" style={{ fontSize: "clamp(1.35rem, 2.4vw, 1.9rem)" }}>{step.title}</h3>
              </div>
              <p className="mt-4 font-light leading-relaxed text-[#17130e]/65">{step.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* CTA — the Espresso dark room */}
      <section className="px-6 sm:px-10 lg:px-16 py-20 md:py-28" style={{ background: "var(--ink-panel)", color: "#17130e" }}>
        <div className="mx-auto max-w-[1400px] text-center">
          <h2 className="display-space mx-auto max-w-3xl" style={{ fontSize: "clamp(2rem, 4.5vw, 3.75rem)", color: "#17130e" }}>{u.ctaTitle}</h2>
          <p className="mx-auto mt-6 max-w-xl text-lg font-light" style={{ color: "rgba(31,27,22,0.68)" }}>{u.ctaText}</p>
          <div className="mt-10 flex flex-col justify-center gap-4 sm:flex-row">
            <Link href={localizedHref(lang, "/#contatti")} className="group inline-flex items-center justify-center gap-2 rounded-full bg-[var(--color-gold)] px-8 py-4 text-sm font-semibold tracking-wide text-[#17130E] transition-transform duration-300 hover:scale-[1.02]">
              {u.ctaButton}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center gap-2 rounded-full border px-8 py-4 text-sm font-medium tracking-wide transition-colors duration-300" style={{ borderColor: "rgba(201,162,90,0.4)", color: "var(--gilt)" }}>
              <MessageCircle className="h-4 w-4" strokeWidth={1.5} />
              {u.ctaWhatsapp}
            </a>
          </div>
          <Link href={localizedHref(lang, "/prezzi")} className="group mt-8 inline-flex items-center gap-2 text-sm tracking-wide" style={{ color: "var(--gilt)" }}>
            {u.ctaPricing}
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </section>

      {/* OTHER SERVICES — hairline index */}
      <section className={`${container} py-16 md:py-20`}>
        <span className="micro-caps text-[var(--gilt)]">{u.other}</span>
        <div className="mt-6 border-b border-[color:var(--gold-line)]">
          {others.map((o) => (
            <Link
              key={o}
              href={localizedHref(lang, `/servizi/${o}`)}
              className="group flex items-baseline justify-between gap-6 border-t border-[color:var(--gold-line)] py-6 transition-colors hover:bg-[var(--ink-panel)]/40 md:px-2"
            >
              <div className="flex items-baseline gap-4 md:gap-7">
                <span className="micro-caps tnum text-[var(--gilt)]">{pad(SERVICE_SLUGS.indexOf(o) + 1)}</span>
                <h3 className="display-space text-[#17130e] transition-colors group-hover:text-[var(--gilt)]" style={{ fontSize: "clamp(1.35rem, 2.6vw, 2rem)" }}>{content[o][lang].title}</h3>
              </div>
              <ArrowRight className="h-5 w-5 flex-shrink-0 text-[var(--gilt)] transition-transform group-hover:translate-x-1" strokeWidth={1.4} />
            </Link>
          ))}
        </div>
      </section>

      <SiteFooter lang={lang} marker={u.label} />
    </main>
  );
}
