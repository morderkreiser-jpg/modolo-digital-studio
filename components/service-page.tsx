"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, MessageCircle } from "lucide-react";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import { localizedHref, type Locale } from "@/lib/i18n";
import { SERVICE_META } from "@/lib/site-data";
import { waHref } from "@/lib/whatsapp";
import { useRegion } from "@/components/use-region";
import { PREFILL } from "@/content/home/prefills";

export type Lang = Locale;
export type Slug = "web" | "brand" | "content" | "ads" | "email";

export const SERVICE_SLUGS: Slug[] = ["web", "brand", "content", "ads", "email"];

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
    ctaPricing: string;
  }
> = {
  // ctaTitle/ctaText = PRICING_UI.ctaHeading/ctaText (COPY §16): the old text repeated the
  // heading's verb ("Tell me about your business." / "Tell me about your project.").
  en: {
    label: "Service",
    includes: "What's included",
    approach: "How I work",
    other: "Other services",
    back: "All services and prices",
    ctaTitle: "Tell me about your business.",
    ctaText: "Write to me with what you need. I'll send you a fixed price, in writing.",
    ctaButton: "Write to me",
    ctaWhatsapp: "WhatsApp",
    ctaPricing: "See pricing",
  },
  de: {
    label: "Leistung",
    includes: "Was enthalten ist",
    approach: "Wie ich arbeite",
    other: "Weitere Leistungen",
    back: "Alle Leistungen und Preise",
    ctaTitle: "Erzähl mir von deinem Betrieb.",
    ctaText: "Schreib mir, was du brauchst. Ich schicke dir einen Fixpreis, schriftlich.",
    ctaButton: "Schreib mir",
    ctaWhatsapp: "WhatsApp",
    ctaPricing: "Preise ansehen",
  },
  it: {
    label: "Servizio",
    includes: "Cosa include",
    approach: "Come lavoro",
    other: "Altri servizi",
    back: "Tutti i servizi e i prezzi",
    ctaTitle: "Raccontami della tua attività.",
    ctaText: "Scrivimi cosa ti serve. Ti mando un prezzo fisso, per iscritto.",
    ctaButton: "Scrivimi",
    ctaWhatsapp: "WhatsApp",
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
        "Websites that load fast on a phone and show what a customer needs to know: what you offer, prices, opening hours, contact. With local SEO, so people nearby find your business.",
      includes: [
        "Custom web design tailored to your brand",
        "High-performance development (fast, secure, mobile-first)",
        "Local SEO optimisation to rank in your area",
        "Google listing linked to the site",
        "Responsive layouts that look great on every device",
        "Care after launch if you want it: from CHF 49 a month",
      ],
      approach: [
        { title: "Strategy first", desc: "I start from your goals, your audience and your market — so every page has a purpose." },
        { title: "Built to perform", desc: "Clean, modern code and best practices for speed, security and search visibility." },
        { title: "Made to last", desc: "Easy to maintain and ready to grow together with your business." },
      ],
    },
    de: {
      title: "Web & Entwicklung",
      intro:
        "Websites, die auf dem Handy schnell laden und zeigen, was ein Kunde wissen muss: Angebot, Preise, Öffnungszeiten, Kontakt. Dazu lokales SEO, damit man deinen Betrieb in der Region findet.",
      includes: [
        "Massgeschneidertes Webdesign, abgestimmt auf deine Marke",
        "Performante Entwicklung (schnell, sicher, mobile-first)",
        "Lokale SEO-Optimierung für deine Region",
        "Google-Eintrag mit der Website verknüpft",
        "Responsive Layouts, die auf jedem Gerät überzeugen",
        "Betreuung nach dem Launch, wenn du willst: ab CHF 49 im Monat",
      ],
      approach: [
        { title: "Strategie zuerst", desc: "Ich starte bei deinen Zielen, deiner Zielgruppe und deinem Markt – damit jede Seite einen Zweck hat." },
        { title: "Auf Leistung gebaut", desc: "Sauberer, moderner Code und Best Practices für Geschwindigkeit, Sicherheit und Sichtbarkeit." },
        { title: "Gemacht, um zu bleiben", desc: "Einfach zu pflegen und bereit, mit deinem Unternehmen zu wachsen." },
      ],
    },
    it: {
      title: "Web & Sviluppo",
      intro:
        "Siti che si aprono veloci sul telefono e mostrano quello che un cliente deve sapere: offerta, prezzi, orari, contatti. Con la SEO locale, perché la tua attività si trovi in zona.",
      includes: [
        "Web design su misura, in linea con il tuo brand",
        "Sviluppo performante (veloce, sicuro, mobile-first)",
        "Ottimizzazione SEO locale per emergere nella tua zona",
        "Scheda Google collegata al sito",
        "Layout responsive, perfetti su ogni dispositivo",
        "Assistenza dopo il lancio, se la vuoi: da CHF 49 al mese",
      ],
      approach: [
        { title: "Prima la strategia", desc: "Parto dai tuoi obiettivi, dal pubblico e dal mercato – così ogni pagina ha uno scopo." },
        { title: "Costruito per rendere", desc: "Codice pulito e moderno, con le migliori pratiche per velocità, sicurezza e visibilità." },
        { title: "Fatto per durare", desc: "Facile da mantenere e pronto a crescere con la tua attività." },
      ],
    },
  },
  brand: {
    en: {
      title: "Brand & Identity",
      intro:
        "A memorable brand is more than a logo. I craft cohesive visual identities — from your logo to colours, typography and branded templates, right through to print-ready business cards and flyers — that tell your story and make you instantly recognisable.",
      includes: [
        "Logo design and full visual identity",
        "Colour palette and typography system",
        "Branded Canva templates for everyday use",
        "Brand guidelines to keep everything consistent",
        "Visual kit for social media",
        "Business cards, flyers and price lists",
        "Print-ready files, sent straight to the printer",
      ],
      approach: [
        { title: "Discover", desc: "I get to know your values, your audience and what makes you different." },
        { title: "Design", desc: "I translate that into a distinctive, coherent visual language." },
        { title: "Deliver", desc: "You get ready-to-use assets and clear guidelines to apply them." },
      ],
    },
    de: {
      title: "Marke & Identität",
      intro:
        "Eine einprägsame Marke ist mehr als ein Logo. Ich gestalte stimmige visuelle Identitäten – vom Logo über Farben, Typografie und gebrandete Vorlagen bis zu druckfertigen Visitenkarten und Flyern –, die deine Geschichte erzählen und dich sofort wiedererkennbar machen.",
      includes: [
        "Logodesign und komplette visuelle Identität",
        "Farbpalette und Typografie-System",
        "Gebrandete Canva-Vorlagen für den Alltag",
        "Markenrichtlinien für durchgängige Konsistenz",
        "Visual-Kit für Social Media",
        "Visitenkarten, Flyer und Preislisten",
        "Druckfertige Daten, direkt für die Druckerei",
      ],
      approach: [
        { title: "Entdecken", desc: "Ich lerne deine Werte, deine Zielgruppe und das, was dich besonders macht, kennen." },
        { title: "Gestalten", desc: "Ich übersetze das in eine unverwechselbare, kohärente visuelle Sprache." },
        { title: "Übergeben", desc: "Du erhältst einsatzbereite Assets und klare Richtlinien zur Anwendung." },
      ],
    },
    it: {
      title: "Brand & Identità",
      intro:
        "Un brand memorabile è molto più di un logo. Creo identità visive coerenti – dal logo a colori, tipografia e template brandizzati, fino a biglietti da visita e flyer pronti per la stampa – che raccontano la tua storia e ti rendono subito riconoscibile.",
      includes: [
        "Design del logo e identità visiva completa",
        "Palette colori e sistema tipografico",
        "Template Canva brandizzati per l'uso quotidiano",
        "Linee guida del brand per la massima coerenza",
        "Kit visivo per i social media",
        "Biglietti da visita, flyer e listini",
        "File pronti per la stampa, da mandare in tipografia",
      ],
      approach: [
        { title: "Scopro", desc: "Conosco i tuoi valori, il tuo pubblico e ciò che ti rende diverso." },
        { title: "Progetto", desc: "Traduco tutto in un linguaggio visivo distintivo e coerente." },
        { title: "Consegno", desc: "Ricevi asset pronti all'uso e linee guida chiare per applicarli." },
      ],
    },
  },
  content: {
    en: {
      title: "Content & Visual",
      intro:
        "Great content makes your brand come alive. I shoot the photos myself; the social media side I run together with Project Visibility. Visuals and stories that engage your audience, made for your business and not bought from a stock library.",
      includes: [
        "Professional photo shoots",
        "Social media management (with Project Visibility)",
        "Content planning and editorial calendar",
        "Visual storytelling for your brand",
        "Optimised images for web and social",
        "Consistent, on-brand content",
      ],
      approach: [
        { title: "Plan", desc: "I define the story to tell and the content that supports your goals." },
        { title: "Produce", desc: "Professional shoots and assets, crafted with care." },
        { title: "Publish", desc: "A consistent presence across your channels, managed for you." },
      ],
    },
    de: {
      title: "Fotos & Social Media",
      intro:
        "Guter Content erweckt deine Marke zum Leben. Die Fotos mache ich selber; die Social-Media-Betreuung führe ich zusammen mit Project Visibility. Visuals und Geschichten für deinen Betrieb, nicht aus einer Bilddatenbank gekauft.",
      includes: [
        "Professionelle Fotoshootings",
        "Social-Media-Betreuung (mit Project Visibility)",
        "Content-Planung und Redaktionskalender",
        "Visuelles Storytelling für deine Marke",
        "Optimierte Bilder für Web und Social",
        "Konsistenter, markengerechter Content",
      ],
      approach: [
        { title: "Planen", desc: "Ich definiere die Geschichte und den Content, der deine Ziele unterstützt." },
        { title: "Produzieren", desc: "Professionelle Shootings und Assets, mit Sorgfalt erstellt." },
        { title: "Veröffentlichen", desc: "Eine konsistente Präsenz auf deinen Kanälen, für dich betreut." },
      ],
    },
    it: {
      title: "Foto e social media",
      intro:
        "I buoni contenuti danno vita al tuo brand. Le foto le faccio io; la parte social la seguo insieme a Project Visibility. Visual e storie fatte per la tua attività, non comprate da una banca di immagini.",
      includes: [
        "Shooting fotografici professionali",
        "Gestione social media (con Project Visibility)",
        "Pianificazione contenuti e calendario editoriale",
        "Visual storytelling per il tuo brand",
        "Immagini ottimizzate per web e social",
        "Contenuti coerenti e in linea con il brand",
      ],
      approach: [
        { title: "Pianifico", desc: "Definisco con te la storia da raccontare e i contenuti che sostengono i tuoi obiettivi." },
        { title: "Produco", desc: "Shooting e asset professionali, curati nel dettaglio." },
        { title: "Pubblico", desc: "Una presenza costante sui tuoi canali, gestita per te." },
      ],
    },
  },
  // Scritta in prima persona, come la home e come la lettera ("Ich arbeite allein"), non con il
  // "wir" che le altre tre pagine hanno ereditato: chi arriva qui dopo una lettera che dice
  // "nessun callcenter, sempre la stessa persona" non deve trovare un "noi".
  // Nessuna promessa di risultato: il budget e la piattaforma non sono sotto il suo controllo.
  ads: {
    en: {
      title: "Advertising",
      intro:
        "Ads only work when what they point at works. I make the creatives, set up the campaign on Google and Meta, and send people to a page built to make them act — not to a homepage where they get lost. You set the budget, and it stays on your own account.",
      includes: [
        "Google Ads and Meta campaign setup",
        "Creatives: graphics, flyers, short video, ad copy",
        "A landing page built for the campaign",
        "Audiences and areas defined with you",
        "Conversion tracking, so you see what came back",
        "Your budget stays on your account, always",
      ],
      approach: [
        { title: "Decide", desc: "We agree what a new customer is worth to you. That number sets the budget, not the other way round." },
        { title: "Build", desc: "Creatives and landing page first. Ads that point at a weak page burn money." },
        { title: "Measure", desc: "A short monthly report in plain words: spend, enquiries, cost per enquiry." },
      ],
    },
    de: {
      title: "Werbung",
      intro:
        "Werbung wirkt nur, wenn das Ziel funktioniert. Ich mache die Sujets, richte die Kampagne bei Google und Meta ein und schicke die Leute auf eine Seite, die zum Handeln führt — nicht auf eine Startseite, wo sie sich verlieren. Das Budget bestimmst du, und es bleibt auf deinem eigenen Konto.",
      includes: [
        "Kampagnen bei Google Ads und Meta einrichten",
        "Material: Sujets, Flyer, kurzes Video, Anzeigentexte",
        "Eine Landingpage, die zur Kampagne passt",
        "Zielgruppen und Gebiet zusammen festgelegt",
        "Messung der Anfragen, damit du siehst, was zurückkommt",
        "Dein Budget bleibt immer auf deinem Konto",
      ],
      approach: [
        { title: "Festlegen", desc: "Wir halten fest, was dir ein neuer Kunde wert ist. Diese Zahl bestimmt das Budget, nicht umgekehrt." },
        { title: "Bauen", desc: "Zuerst Sujets und Landingpage. Werbung auf eine schwache Seite verbrennt Geld." },
        { title: "Messen", desc: "Ein kurzer Monatsbericht in klaren Worten: Ausgaben, Anfragen, Kosten pro Anfrage." },
      ],
    },
    it: {
      title: "Pubblicità",
      intro:
        "La pubblicità funziona solo se funziona quello che c'è dietro. Faccio i materiali, imposto la campagna su Google e Meta e mando le persone su una pagina fatta per farle agire — non sulla home, dove si perdono. Il budget lo decidi tu e resta sul tuo account.",
      includes: [
        "Campagne Google Ads e Meta, impostate da zero",
        "Materiali: grafiche, flyer, video brevi, testi degli annunci",
        "Una landing page costruita per la campagna",
        "Pubblico e zona decisi insieme",
        "Misurazione delle richieste, per vedere cosa è tornato indietro",
        "Il budget resta sempre sul tuo account",
      ],
      approach: [
        { title: "Decidiamo", desc: "Stabiliamo quanto vale per te un cliente nuovo. È quel numero a decidere il budget, non il contrario." },
        { title: "Costruisco", desc: "Prima i materiali e la pagina. La pubblicità che porta su una pagina debole brucia soldi." },
        { title: "Misuro", desc: "Un report mensile corto e in parole chiare: spesa, richieste, costo per richiesta." },
      ],
    },
  },
  email: {
    en: {
      title: "Email Marketing",
      intro:
        "Email is still the channel that turns contacts into customers. I design newsletters and automated campaigns that nurture your audience and grow your business — measurable, on-brand and effective.",
      includes: [
        "Newsletter design and setup",
        "Automated email campaigns and flows",
        "Audience segmentation",
        "On-brand, mobile-friendly templates",
        "Performance tracking and optimisation",
        "Strategy to turn subscribers into clients",
      ],
      approach: [
        { title: "Strategy", desc: "I define who to reach and what to say to drive results." },
        { title: "Automate", desc: "I set up flows that work for you around the clock." },
        { title: "Optimise", desc: "I measure and refine to keep improving conversions." },
      ],
    },
    de: {
      title: "E-Mail-Marketing",
      intro:
        "E-Mail ist nach wie vor der Kanal, der Kontakte in Kunden verwandelt. Ich gestalte Newsletter und automatisierte Kampagnen, die deine Zielgruppe pflegen und dein Geschäft wachsen lassen – messbar, markengerecht und wirksam.",
      includes: [
        "Newsletter-Design und -Einrichtung",
        "Automatisierte E-Mail-Kampagnen und Flows",
        "Zielgruppen-Segmentierung",
        "Markengerechte, mobiloptimierte Vorlagen",
        "Performance-Tracking und Optimierung",
        "Strategie, um Abonnenten zu Kunden zu machen",
      ],
      approach: [
        { title: "Strategie", desc: "Ich lege fest, wen du erreichen willst und was gesagt werden muss." },
        { title: "Automatisieren", desc: "Ich richte Flows ein, die rund um die Uhr für dich arbeiten." },
        { title: "Optimieren", desc: "Ich messe und verfeinere, um die Conversions stetig zu verbessern." },
      ],
    },
    it: {
      title: "E-mail marketing",
      intro:
        "L'email è ancora il canale che trasforma i contatti in clienti. Creo newsletter e campagne automatizzate che coltivano il tuo pubblico e fanno crescere il business – misurabili, in linea col brand ed efficaci.",
      includes: [
        "Design e configurazione della newsletter",
        "Campagne email automatizzate e flussi",
        "Segmentazione del pubblico",
        "Template in linea col brand e ottimizzati per mobile",
        "Monitoraggio dei risultati e ottimizzazione",
        "Strategia per trasformare gli iscritti in clienti",
      ],
      approach: [
        { title: "Strategia", desc: "Definisco chi raggiungere e cosa dire per ottenere risultati." },
        { title: "Automatizzo", desc: "Creo flussi che lavorano per te 24 ore su 24." },
        { title: "Ottimizzo", desc: "Misuro e miglioro per aumentare le conversioni." },
      ],
    },
  },
};

const container = "mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-16";
const pad = (n: number) => String(n).padStart(2, "0");

export default function ServicePage({ slug, lang }: { slug: Slug; lang: Lang }) {
  const u = ui[lang];
  const s = content[slug][lang];
  const region = useRegion();
  // Tagged prefill (content/home/prefills.ts) naming this service, so the chat says where it came from.
  const whatsapp = waHref(PREFILL[lang].service(SERVICE_META[lang][slug].title), region);
  const others = SERVICE_SLUGS.filter((x) => x !== slug);
  const num = pad(SERVICE_SLUGS.indexOf(slug) + 1);

  // Same props on the server and in the browser. Switching them off with useReducedMotion() left the
  // server's opacity:0 in place for reduced-motion visitors (the hook is null on the server), so the
  // blocks never appeared. MotionConfig reducedMotion="user" in the root layout already drops the
  // slide for those visitors and keeps only the fade.
  const rise = { initial: { opacity: 0, y: 22 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-8%" }, transition: { duration: 0.6 } };

  return (
    <main id="main" tabIndex={-1} className="relative min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text)] overflow-x-hidden outline-none">
      <SiteNav lang={lang} ctaLabel={u.ctaButton} ctaHref={localizedHref(lang, "/#contatti")} theme="light" />
      <div className="mds-grain" aria-hidden />
      
      {/* HERO */}
      <section className={`${container} pt-36 pb-14 md:pb-20`}>
        <Link href={localizedHref(lang, "/prezzi")} className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" strokeWidth={1.5} />
          {u.back}
        </Link>
        <div className="mt-12 flex items-baseline justify-between gap-4">
          <span className="micro-caps text-[var(--gilt)]">{num} · {u.label}</span>
          <span className="micro-caps tnum text-[#17130e]/70">{num} / {pad(SERVICE_SLUGS.length)}</span>
        </div>
        <h1 className="page-h1 display-space mt-5 text-[#17130e]">{s.title}</h1>
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
            <motion.div key={i} {...rise} transition={{ duration: 0.45, delay: (i % 2) * 0.05 }} className="flex items-start gap-4 border-t border-[color:var(--gold-line)] py-5">
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
            <motion.div key={i} {...rise} transition={{ duration: 0.6, delay: i * 0.1 }} className="border-t border-[var(--color-gold)]/30 pt-6">
              <div className="flex items-baseline gap-4">
                <span aria-hidden="true" className="display-italic leading-none text-[var(--gilt)]" style={{ fontSize: "clamp(1.1rem, 2vw, 1.6rem)" }}>{pad(i + 1)}</span>
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
          <h2 className="section-head display-space mx-auto max-w-3xl text-[#17130e]">{u.ctaTitle}</h2>
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
