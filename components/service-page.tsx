"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2, Code2, Palette, Camera, Mail } from "lucide-react";
import SiteNav from "@/components/site-nav";
import { localizedHref, type Locale } from "@/lib/i18n";

export type Lang = Locale;
export type Slug = "web" | "brand" | "content" | "email";

export const SERVICE_SLUGS: Slug[] = ["web", "brand", "content", "email"];

const ICONS: Record<Slug, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  web: Code2,
  brand: Palette,
  content: Camera,
  email: Mail,
};

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
    home: string;
    imprint: string;
    privacy: string;
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
    home: "Home",
    imprint: "Legal Notice",
    privacy: "Privacy Policy",
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
    home: "Home",
    imprint: "Impressum",
    privacy: "Datenschutz",
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
    home: "Home",
    imprint: "Note legali",
    privacy: "Privacy",
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

export default function ServicePage({ slug, lang }: { slug: Slug; lang: Lang }) {
  const u = ui[lang];
  const s = content[slug][lang];
  const Icon = ICONS[slug];
  const others = SERVICE_SLUGS.filter((x) => x !== slug);
  const year = new Date().getFullYear();

  return (
    <main id="main" tabIndex={-1} className="min-h-screen bg-[#F7F3EC] text-[#1F1B16] overflow-x-hidden outline-none">
      {/* NAVBAR */}
      <SiteNav lang={lang} ctaLabel={u.ctaButton} ctaHref={localizedHref(lang, "/#contatti")} />

      {/* HERO */}
      <section className="relative max-w-5xl mx-auto px-6 lg:px-8 pt-36 pb-16">
        <div className="absolute top-24 right-0 w-[400px] h-[400px] bg-[#B5893F]/[0.05] rounded-full blur-[120px] -z-0" />
        <Link href={localizedHref(lang, "/#servizi")} className="inline-flex items-center gap-2 text-sm text-[#1F1B16]/65 hover:text-[#B5893F] tracking-wider transition-colors mb-10">
          <ArrowLeft className="w-4 h-4" strokeWidth={1.5} />
          {u.back}
        </Link>
        <div className="relative">
          <div className="inline-flex p-4 rounded-2xl bg-[#B5893F]/10 mb-8">
            <Icon className="w-8 h-8 text-[#B5893F]" strokeWidth={1.3} />
          </div>
          <span className="block text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4">{u.label}</span>
          <h1 className="text-4xl md:text-6xl font-light tracking-tight mb-6">{s.title}</h1>
          <p className="text-lg md:text-xl text-[#1F1B16]/60 font-light leading-relaxed max-w-3xl">{s.intro}</p>
        </div>
      </section>

      {/* INCLUDES */}
      <section className="max-w-5xl mx-auto px-6 lg:px-8 py-12">
        <h2 className="text-2xl md:text-3xl font-light tracking-tight mb-10">{u.includes}</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          {s.includes.map((item, i) => (
            <div key={i} className="flex items-start gap-4 p-5 rounded-2xl border border-[#1F1B16]/[0.08] bg-white shadow-[0_4px_30px_rgba(31,27,22,0.04)]">
              <CheckCircle2 className="w-5 h-5 text-[#B5893F] flex-shrink-0 mt-0.5" strokeWidth={1.5} />
              <span className="text-[#1F1B16]/70 font-light leading-relaxed">{item}</span>
            </div>
          ))}
        </div>
      </section>

      {/* APPROACH */}
      <section className="max-w-5xl mx-auto px-6 lg:px-8 py-12">
        <h2 className="text-2xl md:text-3xl font-light tracking-tight mb-10">{u.approach}</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {s.approach.map((step, i) => (
            <div key={i}>
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full border border-[#B5893F]/40 text-[#B5893F] font-serif italic text-lg mb-5">
                {String(i + 1).padStart(2, "0")}
              </div>
              <h3 className="text-xl font-light mb-3">{step.title}</h3>
              <p className="text-[#1F1B16]/65 font-light leading-relaxed text-sm">{step.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-5xl mx-auto px-6 lg:px-8 py-12">
        <div className="relative overflow-hidden rounded-3xl border border-[#1F1B16]/[0.08] bg-[#EEE6D8] px-8 py-14 text-center">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-[#B5893F]/[0.06] rounded-full blur-[120px]" />
          <div className="relative">
            <h2 className="text-3xl md:text-4xl font-light tracking-tight mb-4">{u.ctaTitle}</h2>
            <p className="text-[#1F1B16]/60 font-light mb-8 max-w-xl mx-auto">{u.ctaText}</p>
            <Link href={localizedHref(lang, "/#contatti")} className="group inline-flex items-center gap-2 bg-[#1F1B16] text-[#F7F3EC] px-8 py-4 rounded-full font-medium tracking-wider hover:bg-[#33291E] transition-all duration-300">
              {u.ctaButton}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* OTHER SERVICES */}
      <section className="max-w-5xl mx-auto px-6 lg:px-8 py-12 pb-24">
        <h2 className="text-2xl md:text-3xl font-light tracking-tight mb-10">{u.other}</h2>
        <div className="grid sm:grid-cols-3 gap-4">
          {others.map((o) => {
            const OIcon = ICONS[o];
            return (
              <Link
                key={o}
                href={localizedHref(lang, `/servizi/${o}`)}
                className="group flex items-center gap-4 p-6 rounded-2xl border border-[#1F1B16]/[0.08] bg-white hover:border-[#B5893F]/40 hover:shadow-[0_8px_30px_rgba(31,27,22,0.06)] transition-all duration-300"
              >
                <div className="inline-flex p-3 rounded-xl bg-[#B5893F]/10 group-hover:bg-[#B5893F]/20 transition-colors">
                  <OIcon className="w-5 h-5 text-[#B5893F]" strokeWidth={1.3} />
                </div>
                <span className="font-light leading-tight">{content[o][lang].title}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#1F1B16]/[0.08] py-10 px-6 lg:px-8 bg-[#ECE3D3]">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-sm text-[#1F1B16]/70 tracking-wider">© {year} Modolo Digital Studio</span>
          <div className="flex items-center gap-5 text-xs tracking-wider">
            <Link href={localizedHref(lang, "/")} className="text-[#1F1B16]/70 hover:text-[#B5893F] transition-colors">{u.home}</Link>
            <Link href={localizedHref(lang, "/impressum")} className="text-[#1F1B16]/70 hover:text-[#B5893F] transition-colors">{u.imprint}</Link>
            <Link href={localizedHref(lang, "/privacy")} className="text-[#1F1B16]/70 hover:text-[#B5893F] transition-colors">{u.privacy}</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
