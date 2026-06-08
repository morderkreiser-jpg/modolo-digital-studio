"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import { ArrowRight, Code2, Palette, Camera, Mail, MapPin, Phone, Send, Sparkles, Clock, Award, Globe2, Store, Briefcase, ShoppingBag, Building2, Target, Heart, Zap, CheckCircle2, ExternalLink, ChevronDown, AlertCircle } from "lucide-react";
import SiteNav from "@/components/site-nav";
import BackToTop from "@/components/back-to-top";
import { localizedHref, type Locale } from "@/lib/i18n";
import { FAQS } from "@/lib/site-data";
import { SITE } from "@/lib/site";

type Lang = Locale;

const translations = {
  en: {
    nav: { services: "Services", pricing: "Pricing", portfolio: "Portfolio", about: "About", faq: "FAQ", contact: "Contact", backToTop: "Back to top" },
    hero: {
      badge: "Digital Studio · Switzerland",
      titleLine1: "Design, code and strategy",
      titleAccent: "for brands that want to stand out.",
      subtitle: "We are a digital studio that transforms the online presence of professionals and businesses across Switzerland.",
      ctaPrimary: "Discover our services",
      ctaSecondary: "Talk to us",
    },
    stats: [
      { value: "100%", label: "Made in Switzerland" },
      { value: "24h", label: "Response time" },
      { value: "Free", label: "First consultation" },
      { value: "Premium", label: "Guaranteed quality" },
    ],
    servicesSection: { label: "What we do", heading1: "Tailored services, ", headingAccent: "real results", learnMore: "Learn more", viewPricing: "View pricing" },
    services: [
      { title: "Web & Development", desc: "Modern, high-performance websites optimized for local SEO. Google Business management to stand out in your area.", tags: ["Web Design", "Development", "Local SEO", "Google Business"] },
      { title: "Brand & Identity", desc: "We build memorable visual identities. From your logo to branded Canva templates, every detail tells your brand's story.", tags: ["Branding", "Visual Identity", "Canva Templates"] },
      { title: "Content & Visual", desc: "Professional photo shoots and social media management in collaboration with Project Visibility, content specialists.", tags: ["Photo Shooting", "Social Media", "Project Visibility"] },
      { title: "Email Marketing", desc: "Newsletters and email marketing that turn contacts into customers. Strategies that grow your business.", tags: ["Newsletter", "Email Marketing", "Automation"] },
    ],
    portfolioSection: { label: "Portfolio", heading1: "Projects that ", headingAccent: "speak for themselves" },
    saporivivi: { tags: ["Complete Website", "Catering & Events", "SEO"], desc: "Complete website for a premium Italian bar catering service. Elegant design, refined user experience and SEO optimization.", cta: "Visit site" },
    portfolioPlaceholders: [
      { cat: "Branding · Concept", title: "Your next project", desc: "There's room for your story. Let's build something memorable together." },
      { cat: "Web Design · Concept", title: "Space available", desc: "We're looking for ambitious brands to collaborate with. You could be next." },
    ],
    portfolioPlaceholderCta: "Let's talk",
    about: {
      label: "About us", heading1: "One studio, ", headingAccent: "one clear vision",
      p1: "Modolo Digital Studio was born from the belief that every business, big or small, deserves a digital presence worthy of its value.",
      p2: "We combine refined design, technical development and strategy to build websites and experiences that not only look beautiful, but truly work. We work with professionals and businesses across Switzerland, and partner with specialists like Project Visibility to cover every need, from content creation to social media management.",
      p3: "We believe in craftsmanship, attention to detail and lasting relationships with our clients.",
    },
    founder: {
      eyebrow: "The founder",
      name: "Francesco Modolo",
      role: "Founder · Web Designer & Developer",
      bio1: "Technology has been my passion since childhood — I started out building PCs from scratch, sourcing every single component myself. That curiosity grew into a craft: for over four years I have been designing and building websites for businesses across Switzerland.",
      bio2: "I work hands-on across the entire process — from code in VS Code to platforms like WordPress and Elementor, reliable hosting such as SiteGround, video editing in DaVinci Resolve, and SEO and Google strategy. The goal is always the same: combine strong creativity with results that genuinely grow your business.",
    },
    values: [
      { title: "Strategy first", desc: "We don't just make pretty websites. We build tools that bring concrete results to your business." },
      { title: "Craftsmanship", desc: "Every project is unique. We give attention to every detail, as if it were our own brand." },
      { title: "Modern technology", desc: "We use the most advanced tools to ensure fast, secure and future-ready websites." },
    ],
    sectorsSection: { label: "Who we work for", heading1: "Sectors we ", headingAccent: "excel in" },
    sectors: ["Restaurants & Hospitality", "Professional Firms", "E-commerce & Retail", "B&B & Accommodation"],
    method: { label: "Our method", heading1: "Three phases, ", headingAccent: "one vision" },
    steps: [
      { num: "01", title: "Strategy", desc: "We analyze your brand, the market and your goals. Every project starts with a clear direction." },
      { num: "02", title: "Design", desc: "We turn strategy into visual identity. Elegance, consistency and personality in every detail." },
      { num: "03", title: "Development", desc: "We launch the project with modern, optimized technologies. Performance, SEO and care for the user experience." },
    ],
    quote: { line1: "We believe every brand has a unique story.", line2: "Our job is to tell it with elegance." },
    faqSection: { label: "Frequently asked questions", heading1: "Everything you ", headingAccent: "want to know" },
    contact: {
      label: "Let's start", heading1: "Ready to ", headingAccent: "stand out", headingEnd: "?",
      subtitle: "Tell us about your project. A free initial consultation to understand how we can help you.",
      emailLabel: "Email", phoneLabel: "Phone", areaLabel: "Area", areaValue: "All of Switzerland",
      formName: "Name", formEmail: "Email", formCompany: "Company", formMessage: "Message",
      phName: "Your name", phEmail: "your@email.com", phCompany: "Company name (optional)", phMessage: "Tell us about your project...",
      btnSend: "Send message", btnSending: "Sending...",
      successTitle: "Message sent!", successDesc: "Thanks for reaching out. We'll get back to you within 24 hours.",
      error: "Something went wrong. Please try again or write to us directly via email.",
      errName: "Please enter your name.",
      errEmailRequired: "Please enter your email.",
      errEmailInvalid: "Please enter a valid email address.",
      errMessage: "Please enter a message.",
    },
    footer: { madeWith: "Made with care in Switzerland", imprint: "Legal Notice", privacy: "Privacy Policy" },
  },
  de: {
    nav: { services: "Leistungen", pricing: "Preise", portfolio: "Portfolio", about: "Über uns", faq: "FAQ", contact: "Kontakt", backToTop: "Nach oben" },
    hero: {
      badge: "Digital Studio · Schweiz",
      titleLine1: "Design, Code und Strategie",
      titleAccent: "für Marken, die sich abheben wollen.",
      subtitle: "Wir sind ein Digital Studio, das die Online-Präsenz von Fachleuten und Unternehmen in der ganzen Schweiz transformiert.",
      ctaPrimary: "Leistungen entdecken",
      ctaSecondary: "Sprich mit uns",
    },
    stats: [
      { value: "100%", label: "Made in Switzerland" },
      { value: "24h", label: "Reaktionszeit" },
      { value: "Gratis", label: "Erstberatung" },
      { value: "Premium", label: "Garantierte Qualität" },
    ],
    servicesSection: { label: "Was wir tun", heading1: "Massgeschneiderte Leistungen, ", headingAccent: "echte Ergebnisse", learnMore: "Mehr erfahren", viewPricing: "Preise ansehen" },
    services: [
      { title: "Web & Entwicklung", desc: "Moderne, performante Websites, optimiert für lokales SEO. Google-Business-Verwaltung, um in deiner Region sichtbar zu werden.", tags: ["Webdesign", "Entwicklung", "Lokales SEO", "Google Business"] },
      { title: "Marke & Identität", desc: "Wir gestalten einprägsame visuelle Identitäten. Vom Logo bis zu gebrandeten Canva-Vorlagen erzählt jedes Detail die Geschichte deiner Marke.", tags: ["Branding", "Visuelle Identität", "Canva-Vorlagen"] },
      { title: "Content & Visual", desc: "Professionelle Fotoshootings und Social-Media-Betreuung in Zusammenarbeit mit Project Visibility, Spezialisten für Content.", tags: ["Fotoshooting", "Social Media", "Project Visibility"] },
      { title: "E-Mail-Marketing", desc: "Newsletter und E-Mail-Marketing, die Kontakte in Kunden verwandeln. Strategien, die dein Geschäft wachsen lassen.", tags: ["Newsletter", "E-Mail-Marketing", "Automation"] },
    ],
    portfolioSection: { label: "Portfolio", heading1: "Projekte, die ", headingAccent: "für sich sprechen" },
    saporivivi: { tags: ["Komplette Website", "Catering & Events", "SEO"], desc: "Komplette Website für einen Premium-Service für italienisches Bar-Catering. Elegantes Design, durchdachte Nutzererfahrung und SEO-Optimierung.", cta: "Website besuchen" },
    portfolioPlaceholders: [
      { cat: "Branding · Concept", title: "Dein nächstes Projekt", desc: "Hier ist Platz für deine Geschichte. Lass uns gemeinsam etwas Unvergessliches schaffen." },
      { cat: "Web Design · Concept", title: "Platz verfügbar", desc: "Wir suchen ambitionierte Marken für eine Zusammenarbeit. Du könntest die nächste sein." },
    ],
    portfolioPlaceholderCta: "Sprechen wir",
    about: {
      label: "Über uns", heading1: "Ein Studio, ", headingAccent: "eine klare Vision",
      p1: "Modolo Digital Studio entstand aus der Überzeugung, dass jedes Unternehmen, ob gross oder klein, eine digitale Präsenz verdient, die seinem Wert gerecht wird.",
      p2: "Wir verbinden raffiniertes Design, technische Entwicklung und Strategie, um Websites und Erlebnisse zu schaffen, die nicht nur schön aussehen, sondern wirklich funktionieren. Wir arbeiten mit Fachleuten und Unternehmen in der ganzen Schweiz und kooperieren mit Spezialisten wie Project Visibility, um jeden Bedarf abzudecken, von der Content-Erstellung bis zur Social-Media-Betreuung.",
      p3: "Wir glauben an handwerkliche Qualität, Liebe zum Detail und langfristige Beziehungen zu unseren Kunden.",
    },
    founder: {
      eyebrow: "Der Gründer",
      name: "Francesco Modolo",
      role: "Gründer · Webdesigner & Entwickler",
      bio1: "Technologie ist seit meiner Kindheit meine Leidenschaft – angefangen habe ich damit, PCs von Grund auf selbst zu bauen und jedes einzelne Bauteil zu bestellen. Aus dieser Neugier wurde ein Handwerk: Seit über vier Jahren gestalte und entwickle ich Websites für Unternehmen in der ganzen Schweiz.",
      bio2: "Ich arbeite über den gesamten Prozess hinweg praktisch mit – von Code in VS Code über Plattformen wie WordPress und Elementor bis zu zuverlässigem Hosting wie SiteGround, Videoschnitt in DaVinci Resolve sowie SEO- und Google-Strategie. Das Ziel ist immer dasselbe: starke Kreativität mit Ergebnissen zu verbinden, die dein Geschäft wirklich wachsen lassen.",
    },
    values: [
      { title: "Strategie zuerst", desc: "Wir machen nicht nur schöne Websites. Wir bauen Werkzeuge, die deinem Unternehmen konkrete Ergebnisse bringen." },
      { title: "Handwerkliche Sorgfalt", desc: "Jedes Projekt ist einzigartig. Wir achten auf jedes Detail, als wäre es unsere eigene Marke." },
      { title: "Moderne Technologie", desc: "Wir nutzen modernste Werkzeuge für schnelle, sichere und zukunftsfähige Websites." },
    ],
    sectorsSection: { label: "Für wen wir arbeiten", heading1: "Branchen, in denen wir ", headingAccent: "glänzen" },
    sectors: ["Restaurants & Hospitality", "Kanzleien & Praxen", "E-Commerce & Retail", "B&B & Unterkünfte"],
    method: { label: "Unsere Methode", heading1: "Drei Phasen, ", headingAccent: "eine Vision" },
    steps: [
      { num: "01", title: "Strategie", desc: "Wir analysieren deine Marke, den Markt und deine Ziele. Jedes Projekt beginnt mit einer klaren Richtung." },
      { num: "02", title: "Design", desc: "Wir verwandeln Strategie in visuelle Identität. Eleganz, Konsistenz und Persönlichkeit in jedem Detail." },
      { num: "03", title: "Entwicklung", desc: "Wir starten das Projekt mit modernen, optimierten Technologien. Performance, SEO und Sorgfalt für die Nutzererfahrung." },
    ],
    quote: { line1: "Wir glauben, dass jede Marke eine einzigartige Geschichte hat.", line2: "Unsere Aufgabe ist es, sie mit Eleganz zu erzählen." },
    faqSection: { label: "Häufige Fragen", heading1: "Alles, was du ", headingAccent: "wissen möchtest" },
    contact: {
      label: "Los geht's", heading1: "Bereit, dich ", headingAccent: "abzuheben", headingEnd: "?",
      subtitle: "Erzähl uns von deinem Projekt. Eine kostenlose Erstberatung, um zu verstehen, wie wir dir helfen können.",
      emailLabel: "E-Mail", phoneLabel: "Telefon", areaLabel: "Gebiet", areaValue: "Ganze Schweiz",
      formName: "Name", formEmail: "E-Mail", formCompany: "Unternehmen", formMessage: "Nachricht",
      phName: "Dein Name", phEmail: "deine@email.com", phCompany: "Firmenname (optional)", phMessage: "Erzähl uns von deinem Projekt...",
      btnSend: "Nachricht senden", btnSending: "Wird gesendet...",
      successTitle: "Nachricht gesendet!", successDesc: "Danke für deine Nachricht. Wir melden uns innerhalb von 24 Stunden.",
      error: "Etwas ist schiefgelaufen. Bitte versuche es erneut oder schreib uns direkt eine E-Mail.",
      errName: "Bitte gib deinen Namen ein.",
      errEmailRequired: "Bitte gib deine E-Mail-Adresse ein.",
      errEmailInvalid: "Bitte gib eine gültige E-Mail-Adresse ein.",
      errMessage: "Bitte gib eine Nachricht ein.",
    },
    footer: { madeWith: "Mit Sorgfalt in der Schweiz erstellt", imprint: "Impressum", privacy: "Datenschutz" },
  },
  it: {
    nav: { services: "Servizi", pricing: "Prezzi", portfolio: "Portfolio", about: "Chi siamo", faq: "FAQ", contact: "Contattaci", backToTop: "Torna su" },
    hero: {
      badge: "Digital Studio · Svizzera",
      titleLine1: "Design, codice e strategia",
      titleAccent: "per brand che vogliono distinguersi.",
      subtitle: "Siamo uno studio digitale che trasforma la presenza online di professionisti e aziende in tutta la Svizzera.",
      ctaPrimary: "Scopri i servizi",
      ctaSecondary: "Parla con noi",
    },
    stats: [
      { value: "100%", label: "Made in Switzerland" },
      { value: "24h", label: "Tempo di risposta" },
      { value: "Gratis", label: "Prima consulenza" },
      { value: "Premium", label: "Qualità garantita" },
    ],
    servicesSection: { label: "Cosa facciamo", heading1: "Servizi su misura, ", headingAccent: "risultati concreti", learnMore: "Scopri di più", viewPricing: "Vedi i prezzi" },
    services: [
      { title: "Web & Sviluppo", desc: "Siti web moderni, performanti e ottimizzati per la SEO locale. Gestione Google Business per emergere sul territorio.", tags: ["Web Design", "Sviluppo", "SEO Locale", "Google Business"] },
      { title: "Brand & Identità", desc: "Costruiamo identità visive memorabili. Dal logo ai template Canva brandizzati, ogni dettaglio racconta il tuo brand.", tags: ["Branding", "Identità Visiva", "Template Canva"] },
      { title: "Contenuti & Visual", desc: "Shooting fotografici professionali e gestione social in collaborazione con Project Visibility, specialisti in contenuti.", tags: ["Shooting", "Social Media", "Project Visibility"] },
      { title: "Email Marketing", desc: "Newsletter ed email marketing che trasformano i contatti in clienti. Strategie che fanno crescere il tuo business.", tags: ["Newsletter", "Email Marketing", "Automation"] },
    ],
    portfolioSection: { label: "Portfolio", heading1: "Progetti che ", headingAccent: "parlano da soli" },
    saporivivi: { tags: ["Sito Web Completo", "Catering & Eventi", "SEO"], desc: "Sito web completo per un servizio premium di bar catering italiano. Design elegante, esperienza utente curata e ottimizzazione SEO.", cta: "Visita il sito" },
    portfolioPlaceholders: [
      { cat: "Branding · Concept", title: "Il tuo prossimo progetto", desc: "C'è spazio per la tua storia. Costruiamo insieme qualcosa di memorabile." },
      { cat: "Web Design · Concept", title: "Spazio disponibile", desc: "Stiamo cercando brand ambiziosi con cui collaborare. Potresti essere il prossimo." },
    ],
    portfolioPlaceholderCta: "Parliamone",
    about: {
      label: "Chi siamo", heading1: "Uno studio, ", headingAccent: "una visione precisa",
      p1: "Modolo Digital Studio nasce dalla convinzione che ogni attività, grande o piccola, meriti una presenza digitale all'altezza del proprio valore.",
      p2: "Uniamo design raffinato, sviluppo tecnico e strategia per costruire siti ed esperienze che non solo appaiono belli, ma funzionano davvero. Lavoriamo con professionisti e aziende in tutta la Svizzera, e collaboriamo con specialisti come Project Visibility per coprire ogni esigenza, dalla creazione di contenuti alla gestione social.",
      p3: "Crediamo nella qualità artigianale, nell'attenzione al dettaglio e in relazioni durature con i nostri clienti.",
    },
    founder: {
      eyebrow: "Il fondatore",
      name: "Francesco Modolo",
      role: "Fondatore · Web Designer & Sviluppatore",
      bio1: "La tecnologia è la mia passione fin da bambino: ho iniziato costruendo PC da zero, ordinando ogni singolo componente. Da quella curiosità è nato un mestiere: da oltre quattro anni progetto e realizzo siti web per aziende in tutta la Svizzera.",
      bio2: "Seguo l'intero processo in prima persona – dal codice in VS Code alle piattaforme come WordPress ed Elementor, fino a hosting affidabili come SiteGround, al montaggio video in DaVinci Resolve e alla strategia SEO e Google. L'obiettivo è sempre lo stesso: unire una forte creatività a risultati che fanno davvero crescere il tuo business.",
    },
    values: [
      { title: "Strategia prima di tutto", desc: "Non facciamo siti belli e basta. Costruiamo strumenti che portano risultati concreti al tuo business." },
      { title: "Cura artigianale", desc: "Ogni progetto è unico. Dedichiamo attenzione a ogni dettaglio, come fosse il nostro stesso brand." },
      { title: "Tecnologia moderna", desc: "Usiamo gli strumenti più avanzati per garantire siti veloci, sicuri e pronti per il futuro." },
    ],
    sectorsSection: { label: "Per chi lavoriamo", heading1: "Settori in cui ", headingAccent: "eccelliamo" },
    sectors: ["Ristoranti & Hospitality", "Studi Professionali", "E-commerce & Retail", "B&B & Strutture Ricettive"],
    method: { label: "Il nostro metodo", heading1: "Tre fasi, ", headingAccent: "una visione" },
    steps: [
      { num: "01", title: "Strategia", desc: "Analizziamo il tuo brand, il mercato e gli obiettivi. Ogni progetto inizia con una direzione chiara." },
      { num: "02", title: "Design", desc: "Trasformiamo la strategia in identità visiva. Eleganza, coerenza e personalità in ogni dettaglio." },
      { num: "03", title: "Sviluppo", desc: "Lanciamo il progetto con tecnologie moderne e ottimizzate. Performance, SEO e cura per l'esperienza utente." },
    ],
    quote: { line1: "Crediamo che ogni brand abbia una storia unica.", line2: "Il nostro lavoro è raccontarla con eleganza." },
    faqSection: { label: "Domande frequenti", heading1: "Tutto quello che ", headingAccent: "vuoi sapere" },
    contact: {
      label: "Iniziamo", heading1: "Pronto a ", headingAccent: "distinguerti", headingEnd: "?",
      subtitle: "Raccontaci il tuo progetto. Una consulenza iniziale gratuita per capire come possiamo aiutarti.",
      emailLabel: "Email", phoneLabel: "Telefono", areaLabel: "Area", areaValue: "Tutta la Svizzera",
      formName: "Nome", formEmail: "Email", formCompany: "Azienda", formMessage: "Messaggio",
      phName: "Il tuo nome", phEmail: "la-tua@email.com", phCompany: "Nome azienda (opzionale)", phMessage: "Raccontaci il tuo progetto...",
      btnSend: "Invia messaggio", btnSending: "Invio in corso...",
      successTitle: "Messaggio inviato!", successDesc: "Grazie per averci scritto. Ti risponderemo entro 24 ore.",
      error: "Si è verificato un errore. Riprova o scrivici direttamente via email.",
      errName: "Inserisci il tuo nome.",
      errEmailRequired: "Inserisci la tua email.",
      errEmailInvalid: "Inserisci un indirizzo email valido.",
      errMessage: "Inserisci un messaggio.",
    },
    footer: { madeWith: "Made with care in Switzerland", imprint: "Note legali", privacy: "Privacy" },
  },
};

const serviceIcons = [Code2, Palette, Camera, Mail];
const serviceSlugs = ["web", "brand", "content", "email"];
const statIcons = [Globe2, Clock, Sparkles, Award];
const sectorIcons = [Store, Briefcase, ShoppingBag, Building2];
const valueIcons = [Target, Heart, Zap];

export default function Home({ lang }: { lang: Lang }) {
  const [formStatus, setFormStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const reduce = useReducedMotion();
  const successRef = useRef<HTMLDivElement>(null);
  const t = translations[lang];

  // Move focus to the success panel so screen-reader and keyboard users are told the message sent.
  useEffect(() => {
    if (formStatus === "success") successRef.current?.focus();
  }, [formStatus]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (formStatus === "sending") return;
    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("lang", lang);
    const name = (data.get("nome") as string)?.trim();
    const email = (data.get("email") as string)?.trim();
    const message = (data.get("messaggio") as string)?.trim();
    const errs: { name?: string; email?: string; message?: string } = {};
    if (!name) errs.name = t.contact.errName;
    if (!email) errs.email = t.contact.errEmailRequired;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = t.contact.errEmailInvalid;
    if (!message) errs.message = t.contact.errMessage;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setFormStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        setFormStatus("success");
        form.reset();
      } else {
        setFormStatus("error");
      }
    } catch {
      setFormStatus("error");
    }
  };

  return (
    <main id="main" tabIndex={-1} className="min-h-screen bg-[#F7F3EC] text-[#1F1B16] overflow-x-hidden outline-none">
      {/* NAVBAR */}
      <SiteNav
        lang={lang}
        links={[
          { href: "#servizi", label: t.nav.services },
          { href: localizedHref(lang, "/prezzi"), label: t.nav.pricing },
          { href: "#portfolio", label: t.nav.portfolio },
          { href: "#chi-siamo", label: t.nav.about },
          { href: "#faq", label: t.nav.faq },
        ]}
        ctaHref="#contatti"
        ctaLabel={t.nav.contact}
      />

      {/* HERO */}
      <section className="relative min-h-screen flex items-center justify-center px-6 lg:px-12 pt-32 pb-20">
        <div className="absolute inset-0 bg-gradient-to-br from-[#F7F3EC] via-[#FFFFFF] to-[#EFE7D9]" />
        <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #B5893F 1px, transparent 0)', backgroundSize: '60px 60px' }} />
        <motion.div animate={reduce ? undefined : { opacity: [0.25, 0.4, 0.25] }} transition={reduce ? undefined : { duration: 6, repeat: Infinity, ease: "easeInOut" }} className="absolute top-1/3 left-1/4 w-[500px] h-[500px] bg-[#B5893F]/[0.07] rounded-full blur-[120px]" />
        <motion.div animate={reduce ? undefined : { opacity: [0.15, 0.3, 0.15] }} transition={reduce ? undefined : { duration: 8, repeat: Infinity, ease: "easeInOut", delay: 2 }} className="absolute bottom-1/4 right-1/4 w-[400px] h-[400px] bg-[#B5893F]/[0.05] rounded-full blur-[100px]" />

        <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1 }} className="relative z-10 text-center max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.1 }} className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-[#B5893F]/30 bg-[#B5893F]/[0.08] mb-10">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#B5893F] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#B5893F]"></span>
            </span>
            <span className="text-xs tracking-[0.2em] text-[var(--color-gold-ink)] uppercase">{t.hero.badge}</span>
          </motion.div>

          <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.2, delay: 0.2 }} className="mb-12 flex justify-center">
            <Image src="/logo-full.png" alt="Modolo Digital Studio" width={500} height={250} priority />
          </motion.div>

          <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.5 }} className="text-4xl md:text-6xl lg:text-7xl font-light tracking-tight mb-8 leading-[1.1]">
            {t.hero.titleLine1}<br />
            <span className="text-[#B5893F] italic font-serif">{t.hero.titleAccent}</span>
          </motion.h1>

          <motion.p initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.8 }} className="text-lg md:text-xl text-[#1F1B16]/55 max-w-2xl mx-auto mb-12 font-light leading-relaxed">
            {t.hero.subtitle}
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 1.1 }} className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <a href="#servizi" className="group bg-[#1F1B16] text-[#F7F3EC] px-8 py-4 rounded-full font-medium tracking-wider hover:bg-[#33291E] transition-all duration-300 flex items-center gap-2 shadow-[0_8px_30px_rgba(31,27,22,0.12)] hover:shadow-[0_12px_40px_rgba(31,27,22,0.2)]">
              {t.hero.ctaPrimary}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </a>
            <a href="#contatti" className="border border-[#1F1B16]/15 px-8 py-4 rounded-full font-medium tracking-wider hover:border-[#B5893F]/60 hover:text-[#B5893F] transition-all duration-300">
              {t.hero.ctaSecondary}
            </a>
          </motion.div>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 2 }} className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <motion.div animate={reduce ? undefined : { y: [0, 8, 0] }} transition={reduce ? undefined : { duration: 2, repeat: Infinity, ease: "easeInOut" }} className="w-[1px] h-12 bg-gradient-to-b from-transparent via-[#B5893F]/40 to-transparent" />
        </motion.div>
      </section>

      {/* STATS */}
      <section className="py-20 px-6 lg:px-12 border-y border-[#1F1B16]/[0.07] bg-[#EEE6D8]">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {t.stats.map((stat, i) => {
              const Icon = statIcons[i];
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }} className="text-center group">
                  <Icon className="w-6 h-6 text-[#B5893F] mx-auto mb-4 group-hover:scale-110 transition-transform" strokeWidth={1.2} />
                  <div className="text-2xl md:text-3xl font-light mb-2">{stat.value}</div>
                  <div className="text-xs md:text-sm text-[#1F1B16]/70 tracking-wider">{stat.label}</div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* SERVIZI */}
      <section id="servizi" className="py-32 px-6 lg:px-12 relative">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="mb-20 text-center">
            <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4 block">{t.servicesSection.label}</span>
            <h2 className="text-4xl md:text-5xl font-light tracking-tight">
              {t.servicesSection.heading1}<span className="italic font-serif text-[#B5893F]">{t.servicesSection.headingAccent}</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-2 gap-6">
            {t.services.map((service, i) => {
              const Icon = serviceIcons[i];
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.1 }} className="group relative p-8 lg:p-10 rounded-2xl border border-[#1F1B16]/[0.08] bg-white shadow-[0_4px_30px_rgba(31,27,22,0.04)] hover:border-[#B5893F]/40 hover:shadow-[0_10px_40px_rgba(31,27,22,0.08)] transition-all duration-500 overflow-hidden">
                  <div className="absolute -top-20 -right-20 w-40 h-40 bg-[#B5893F]/0 group-hover:bg-[#B5893F]/[0.06] rounded-full blur-2xl transition-all duration-700" />
                  <div className="relative">
                    <div className="inline-flex p-3 rounded-xl bg-[#B5893F]/10 mb-6 group-hover:bg-[#B5893F]/20 transition-colors">
                      <Icon className="w-7 h-7 text-[#B5893F]" strokeWidth={1.3} />
                    </div>
                    <h3 className="text-2xl font-light mb-4">{service.title}</h3>
                    <p className="text-[#1F1B16]/55 mb-6 leading-relaxed font-light">{service.desc}</p>
                    <div className="flex flex-wrap gap-2">
                      {service.tags.map((tag) => (
                        <span key={tag} className="text-xs tracking-wider text-[#1F1B16]/70 border border-[#1F1B16]/12 px-3 py-1.5 rounded-full group-hover:border-[#B5893F]/30 transition-colors">{tag}</span>
                      ))}
                    </div>
                    <Link href={localizedHref(lang, `/servizi/${serviceSlugs[i]}`)} className="mt-6 inline-flex items-center gap-2 text-sm text-[var(--color-gold-ink)] tracking-wider hover:gap-3 transition-all">
                      {t.servicesSection.learnMore}
                      <ArrowRight className="w-4 h-4" />
                    </Link>
                  </div>
                </motion.div>
              );
            })}
          </div>

          <div className="mt-12 text-center">
            <Link href={localizedHref(lang, "/prezzi")} className="group inline-flex items-center gap-2 border border-[#1F1B16]/15 px-8 py-4 rounded-full font-medium tracking-wider hover:border-[#B5893F]/60 hover:text-[#B5893F] transition-all duration-300">
              {t.servicesSection.viewPricing}
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
            </Link>
          </div>
        </div>
      </section>

      {/* PORTFOLIO */}
      <section id="portfolio" className="py-32 px-6 lg:px-12 bg-[#EEE6D8] border-y border-[#1F1B16]/[0.07] relative">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="mb-20 text-center">
            <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4 block">{t.portfolioSection.label}</span>
            <h2 className="text-4xl md:text-5xl font-light tracking-tight">
              {t.portfolioSection.heading1}<span className="italic font-serif text-[#B5893F]">{t.portfolioSection.headingAccent}</span>
            </h2>
          </motion.div>

          <motion.a
            href="https://saporivivi.ch"
            target="_blank"
            rel="noopener noreferrer"
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.8 }}
            className="group block relative rounded-3xl overflow-hidden border border-[#1F1B16]/[0.08] shadow-[0_10px_50px_rgba(31,27,22,0.08)] hover:border-[#B5893F]/40 transition-all duration-500 bg-[#1F1B16]"
          >
            <div className="relative aspect-[16/10] md:aspect-[21/9] overflow-hidden">
              <Image src="/portfolio-saporivivi.webp" alt="SaporiVivi - Italian Luxury Bar Catering" fill sizes="(max-width: 1280px) 100vw, 1216px" className="object-cover object-top group-hover:scale-105 transition-transform duration-700" />
              <div className="hidden md:block absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
            </div>
            <div className="relative md:absolute md:bottom-0 md:left-0 md:right-0 p-6 md:p-12 bg-[#1F1B16] md:bg-transparent">
              <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6">
                <div>
                  <div className="flex flex-wrap gap-2 mb-4">
                    <span className="text-xs tracking-wider text-[#E8C98A] border border-[#E8C98A]/40 bg-[#B5893F]/20 px-3 py-1.5 rounded-full">{t.saporivivi.tags[0]}</span>
                    <span className="text-xs tracking-wider text-white/80 border border-white/30 px-3 py-1.5 rounded-full">{t.saporivivi.tags[1]}</span>
                    <span className="text-xs tracking-wider text-white/80 border border-white/30 px-3 py-1.5 rounded-full">{t.saporivivi.tags[2]}</span>
                  </div>
                  <h3 className="text-3xl md:text-4xl font-light mb-2 text-white">SaporiVivi</h3>
                  <p className="text-white/70 font-light max-w-xl">{t.saporivivi.desc}</p>
                </div>
                <div className="flex items-center gap-2 text-[#E8C98A] whitespace-nowrap group-hover:gap-3 transition-all">
                  <span className="text-sm tracking-wider">{t.saporivivi.cta}</span>
                  <ExternalLink className="w-4 h-4" strokeWidth={1.5} />
                </div>
              </div>
            </div>
          </motion.a>

          <div className="grid md:grid-cols-2 gap-6 mt-6">
            {t.portfolioPlaceholders.map((p, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.1 }} className="group relative rounded-2xl border border-dashed border-[#1F1B16]/15 hover:border-[#B5893F]/40 bg-white/40 p-10 flex flex-col items-center justify-center text-center min-h-[280px] transition-all duration-500">
                <span className="text-xs tracking-wider text-[var(--color-gold-ink)] uppercase mb-4">{p.cat}</span>
                <h3 className="text-2xl font-light mb-3 text-[#1F1B16]/80">{p.title}</h3>
                <p className="text-[#1F1B16]/70 font-light text-sm max-w-xs mb-6">{p.desc}</p>
                <a href="#contatti" className="text-sm text-[var(--color-gold-ink)] tracking-wider flex items-center gap-2 group-hover:gap-3 transition-all">
                  {t.portfolioPlaceholderCta} <ArrowRight className="w-4 h-4" />
                </a>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CHI SIAMO */}
      <section id="chi-siamo" className="py-32 px-6 lg:px-12 relative overflow-hidden">
        <div className="absolute top-1/2 right-0 w-[400px] h-[400px] bg-[#B5893F]/[0.05] rounded-full blur-[100px]" />
        <div className="max-w-7xl mx-auto relative">
          {/* FOUNDER */}
          <div className="grid lg:grid-cols-5 gap-10 lg:gap-16 items-center mb-24">
            <motion.div initial={reduce ? false : { opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="lg:col-span-2">
              <div className="relative aspect-[4/5] rounded-3xl overflow-hidden border border-[#1F1B16]/[0.08] bg-gradient-to-b from-[#EFE7D9] to-[#F7F3EC] shadow-[0_10px_50px_rgba(31,27,22,0.08)]">
                <Image src="/founder.webp" alt="Francesco Modolo — Founder of Modolo Digital Studio" fill sizes="(max-width: 1024px) 100vw, 40vw" className="object-contain object-bottom" />
              </div>
            </motion.div>
            <motion.div initial={reduce ? false : { opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="lg:col-span-3">
              <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4 block">{t.founder.eyebrow}</span>
              <h2 className="text-3xl md:text-4xl font-light tracking-tight mb-1">{t.founder.name}</h2>
              <p className="text-[var(--color-gold-ink)] font-serif italic mb-6">{t.founder.role}</p>
              <p className="text-[#1F1B16]/65 font-light leading-relaxed mb-4 text-lg">{t.founder.bio1}</p>
              <p className="text-[#1F1B16]/55 font-light leading-relaxed">{t.founder.bio2}</p>
            </motion.div>
          </div>

          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
              <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4 block">{t.about.label}</span>
              <h2 className="text-4xl md:text-5xl font-light tracking-tight mb-8">
                {t.about.heading1}<span className="italic font-serif text-[#B5893F]">{t.about.headingAccent}</span>
              </h2>
              <p className="text-[#1F1B16]/65 leading-relaxed font-light mb-6 text-lg">{t.about.p1}</p>
              <p className="text-[#1F1B16]/55 leading-relaxed font-light mb-6">{t.about.p2}</p>
              <p className="text-[#1F1B16]/55 leading-relaxed font-light">{t.about.p3}</p>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="space-y-6">
              {t.values.map((value, i) => {
                const Icon = valueIcons[i];
                return (
                  <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.15 }} className="flex gap-5 p-6 rounded-2xl border border-[#1F1B16]/[0.08] bg-white shadow-[0_4px_30px_rgba(31,27,22,0.04)] hover:border-[#B5893F]/30 transition-all duration-300">
                    <div className="flex-shrink-0 inline-flex p-3 rounded-xl bg-[#B5893F]/10 h-fit">
                      <Icon className="w-6 h-6 text-[#B5893F]" strokeWidth={1.3} />
                    </div>
                    <div>
                      <h3 className="text-xl font-light mb-2">{value.title}</h3>
                      <p className="text-[#1F1B16]/55 font-light leading-relaxed text-sm">{value.desc}</p>
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          </div>
        </div>
      </section>

      {/* SETTORI */}
      <section className="py-24 px-6 lg:px-12 bg-[#EEE6D8] border-y border-[#1F1B16]/[0.07]">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="text-center mb-16">
            <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4 block">{t.sectorsSection.label}</span>
            <h2 className="text-3xl md:text-4xl font-light tracking-tight">
              {t.sectorsSection.heading1}<span className="italic font-serif text-[#B5893F]">{t.sectorsSection.headingAccent}</span>
            </h2>
          </motion.div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {t.sectors.map((name, i) => {
              const Icon = sectorIcons[i];
              return (
                <motion.div key={i} initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.1 }} className="group p-6 rounded-xl border border-[#1F1B16]/[0.08] bg-white hover:border-[#B5893F]/40 hover:shadow-[0_8px_30px_rgba(31,27,22,0.06)] transition-all duration-300 text-center">
                  <Icon className="w-8 h-8 text-[#B5893F] mx-auto mb-4 group-hover:scale-110 transition-all" strokeWidth={1.2} />
                  <p className="text-sm text-[#1F1B16]/65 font-light">{name}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* METODO */}
      <section id="metodo" className="py-32 px-6 lg:px-12 relative">
        <div className="max-w-7xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="mb-20 text-center">
            <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4 block">{t.method.label}</span>
            <h2 className="text-4xl md:text-5xl font-light tracking-tight">
              {t.method.heading1}<span className="italic font-serif text-[#B5893F]">{t.method.headingAccent}</span>
            </h2>
          </motion.div>

          <div className="grid md:grid-cols-3 gap-12 relative">
            <div className="hidden md:block absolute top-12 left-[16.66%] right-[16.66%] h-[1px] bg-gradient-to-r from-transparent via-[#B5893F]/30 to-transparent" />
            {t.steps.map((step, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6, delay: i * 0.15 }} className="relative text-center md:text-left">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full border border-[#B5893F]/40 bg-[#F7F3EC] text-[#B5893F] font-serif italic text-2xl mb-6 relative z-10">{step.num}</div>
                <h3 className="text-2xl font-light mb-4">{step.title}</h3>
                <p className="text-[#1F1B16]/55 font-light leading-relaxed">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* QUOTE */}
      <section className="py-32 px-6 lg:px-12 bg-[#EEE6D8] border-y border-[#1F1B16]/[0.07]">
        <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="max-w-4xl mx-auto text-center">
          <Sparkles className="w-8 h-8 text-[#B5893F] mx-auto mb-8" strokeWidth={1.2} />
          <p className="text-2xl md:text-4xl font-light leading-relaxed italic font-serif">
            &ldquo;{t.quote.line1}<br />
            <span className="text-[#B5893F]">{t.quote.line2}</span>&rdquo;
          </p>
        </motion.div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-32 px-6 lg:px-12 relative overflow-hidden">
        <div className="absolute top-0 left-1/4 w-[400px] h-[400px] bg-[#B5893F]/[0.04] rounded-full blur-[120px]" />
        <div className="max-w-3xl mx-auto relative">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="mb-16 text-center">
            <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4 block">{t.faqSection.label}</span>
            <h2 className="text-4xl md:text-5xl font-light tracking-tight">
              {t.faqSection.heading1}<span className="italic font-serif text-[#B5893F]">{t.faqSection.headingAccent}</span>
            </h2>
          </motion.div>

          <div className="space-y-4">
            {FAQS[lang].map((faq, i) => {
              const isOpen = openFaq === i;
              return (
                <motion.div key={i} initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: i * 0.05 }} className="rounded-2xl border border-[#1F1B16]/[0.08] bg-white shadow-[0_4px_30px_rgba(31,27,22,0.04)] overflow-hidden">
                  <h3>
                    <button type="button" id={`faq-q-${i}`} aria-expanded={isOpen} aria-controls={`faq-a-${i}`} onClick={() => setOpenFaq(isOpen ? null : i)} className="w-full flex items-center justify-between gap-4 p-6 text-left hover:bg-[#B5893F]/[0.03] transition-colors">
                      <span className="text-lg font-light">{faq.q}</span>
                      <ChevronDown className={`w-5 h-5 text-[#B5893F] flex-shrink-0 transition-transform duration-300 ${isOpen ? "rotate-180" : ""}`} strokeWidth={1.5} aria-hidden="true" />
                    </button>
                  </h3>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: reduce ? 0 : 0.3, ease: "easeInOut" }}>
                        <p className="px-6 pb-6 text-[#1F1B16]/55 font-light leading-relaxed">{faq.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CONTATTI + FORM */}
      <section id="contatti" className="py-32 px-6 lg:px-12 relative overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] bg-[#B5893F]/[0.05] rounded-full blur-[120px]" />

        <div className="relative max-w-5xl mx-auto">
          <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="text-center mb-16">
            <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-6 block">{t.contact.label}</span>
            <h2 className="text-4xl md:text-6xl font-light tracking-tight mb-6">
              {t.contact.heading1}<span className="italic font-serif text-[#B5893F]">{t.contact.headingAccent}</span>{t.contact.headingEnd}
            </h2>
            <p className="text-lg md:text-xl text-[#1F1B16]/55 font-light max-w-2xl mx-auto">{t.contact.subtitle}</p>
          </motion.div>

          <div className="grid lg:grid-cols-5 gap-12">
            <motion.div initial={{ opacity: 0, x: -30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="lg:col-span-2 space-y-8">
              <a href={`mailto:${SITE.email}`} className="flex items-start gap-4 group">
                <div className="inline-flex p-3 rounded-xl bg-[#B5893F]/10 group-hover:bg-[#B5893F]/20 transition-colors">
                  <Mail className="w-5 h-5 text-[#B5893F]" strokeWidth={1.3} />
                </div>
                <div>
                  <div className="text-xs text-[#1F1B16]/70 tracking-wider uppercase mb-1">{t.contact.emailLabel}</div>
                  <div className="text-[#1F1B16]/75 group-hover:text-[#B5893F] transition-colors">{SITE.email}</div>
                </div>
              </a>
              <a href={`tel:${SITE.phone}`} className="flex items-start gap-4 group">
                <div className="inline-flex p-3 rounded-xl bg-[#B5893F]/10 group-hover:bg-[#B5893F]/20 transition-colors">
                  <Phone className="w-5 h-5 text-[#B5893F]" strokeWidth={1.3} />
                </div>
                <div>
                  <div className="text-xs text-[#1F1B16]/70 tracking-wider uppercase mb-1">{t.contact.phoneLabel}</div>
                  <div className="text-[#1F1B16]/75 group-hover:text-[#B5893F] transition-colors">{SITE.phoneDisplay}</div>
                </div>
              </a>
              <div className="flex items-start gap-4">
                <div className="inline-flex p-3 rounded-xl bg-[#B5893F]/10">
                  <MapPin className="w-5 h-5 text-[#B5893F]" strokeWidth={1.3} />
                </div>
                <div>
                  <div className="text-xs text-[#1F1B16]/70 tracking-wider uppercase mb-1">{t.contact.areaLabel}</div>
                  <div className="text-[#1F1B16]/75">{t.contact.areaValue}</div>
                </div>
              </div>
            </motion.div>

            <motion.div initial={{ opacity: 0, x: 30 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }} className="lg:col-span-3">
              {formStatus === "success" ? (
                <div ref={successRef} tabIndex={-1} role="status" aria-live="polite" className="h-full flex flex-col items-center justify-center text-center p-12 rounded-2xl border border-[#B5893F]/30 bg-[#B5893F]/[0.07] outline-none">
                  <CheckCircle2 className="w-16 h-16 text-[#B5893F] mb-6" strokeWidth={1.2} />
                  <h3 className="text-2xl font-light mb-3">{t.contact.successTitle}</h3>
                  <p className="text-[#1F1B16]/55 font-light">{t.contact.successDesc}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate className="space-y-5 p-8 rounded-2xl border border-[#1F1B16]/[0.08] bg-white shadow-[0_8px_40px_rgba(31,27,22,0.06)]">
                  {/* anti-spam honeypot (hidden from users; Formspree ignores submissions that fill it) */}
                  <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
                  <input type="hidden" name="_subject" value="New enquiry — Modolo Digital Studio" />
                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label htmlFor="contact-name" className="text-xs text-[#1F1B16]/70 tracking-wider uppercase mb-2 block">{t.contact.formName} *</label>
                      <input id="contact-name" type="text" name="nome" required aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? "contact-name-err" : undefined} onChange={() => fieldErrors.name && setFieldErrors((p) => ({ ...p, name: undefined }))} className="w-full bg-[#F7F3EC] border border-[#1F1B16]/12 rounded-xl px-4 py-3 text-[#1F1B16] placeholder-[#1F1B16]/35 focus:border-[#B5893F]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6B2F] transition-colors" placeholder={t.contact.phName} />
                      {fieldErrors.name && <p id="contact-name-err" role="alert" className="mt-2 text-sm text-red-700">{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <label htmlFor="contact-email" className="text-xs text-[#1F1B16]/70 tracking-wider uppercase mb-2 block">{t.contact.formEmail} *</label>
                      <input id="contact-email" type="email" name="email" required aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={fieldErrors.email ? "contact-email-err" : undefined} onChange={() => fieldErrors.email && setFieldErrors((p) => ({ ...p, email: undefined }))} className="w-full bg-[#F7F3EC] border border-[#1F1B16]/12 rounded-xl px-4 py-3 text-[#1F1B16] placeholder-[#1F1B16]/35 focus:border-[#B5893F]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6B2F] transition-colors" placeholder={t.contact.phEmail} />
                      {fieldErrors.email && <p id="contact-email-err" role="alert" className="mt-2 text-sm text-red-700">{fieldErrors.email}</p>}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="contact-company" className="text-xs text-[#1F1B16]/70 tracking-wider uppercase mb-2 block">{t.contact.formCompany}</label>
                    <input id="contact-company" type="text" name="azienda" className="w-full bg-[#F7F3EC] border border-[#1F1B16]/12 rounded-xl px-4 py-3 text-[#1F1B16] placeholder-[#1F1B16]/35 focus:border-[#B5893F]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6B2F] transition-colors" placeholder={t.contact.phCompany} />
                  </div>
                  <div>
                    <label htmlFor="contact-message" className="text-xs text-[#1F1B16]/70 tracking-wider uppercase mb-2 block">{t.contact.formMessage} *</label>
                    <textarea id="contact-message" name="messaggio" required rows={4} aria-invalid={fieldErrors.message ? true : undefined} aria-describedby={fieldErrors.message ? "contact-message-err" : undefined} onChange={() => fieldErrors.message && setFieldErrors((p) => ({ ...p, message: undefined }))} className="w-full bg-[#F7F3EC] border border-[#1F1B16]/12 rounded-xl px-4 py-3 text-[#1F1B16] placeholder-[#1F1B16]/35 focus:border-[#B5893F]/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6B2F] transition-colors resize-none" placeholder={t.contact.phMessage} />
                    {fieldErrors.message && <p id="contact-message-err" role="alert" className="mt-2 text-sm text-red-700">{fieldErrors.message}</p>}
                  </div>
                  {formStatus === "error" && (
                    <div role="alert" className="flex items-start gap-3 p-4 rounded-2xl border border-red-300 bg-red-50 text-red-800">
                      <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" strokeWidth={1.5} aria-hidden="true" />
                      <p className="text-sm font-light">{t.contact.error}</p>
                    </div>
                  )}
                  <button type="submit" disabled={formStatus === "sending"} className="group w-full bg-[#1F1B16] text-[#F7F3EC] px-8 py-4 rounded-xl font-medium tracking-wider hover:bg-[#33291E] transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed">
                    {formStatus === "sending" ? t.contact.btnSending : t.contact.btnSend}
                    {formStatus !== "sending" && <Send className="w-4 h-4 group-hover:translate-x-1 transition-transform" />}
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-[#1F1B16]/[0.08] py-12 px-6 lg:px-12 bg-[#ECE3D3]">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <Image src="/logo-icon.png" alt="Modolo Digital Studio" width={28} height={28} />
            <span className="text-sm text-[#1F1B16]/70 tracking-wider">© {new Date().getFullYear()} Modolo Digital Studio</span>
          </div>
          <div className="flex items-center gap-5 sm:gap-6">
            <Link href={localizedHref(lang, "/impressum")} className="text-xs text-[#1F1B16]/70 hover:text-[#B5893F] tracking-wider transition-colors">{t.footer.imprint}</Link>
            <Link href={localizedHref(lang, "/privacy")} className="text-xs text-[#1F1B16]/70 hover:text-[#B5893F] tracking-wider transition-colors">{t.footer.privacy}</Link>
            <a href="https://instagram.com/modolodigitalstudio" target="_blank" rel="noopener noreferrer" className="text-[#1F1B16]/70 hover:text-[#B5893F] transition-colors" aria-label="Instagram">
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
              </svg>
            </a>
            <span className="text-xs text-[#1F1B16]/65 tracking-[0.2em] uppercase">{t.footer.madeWith}</span>
          </div>
        </div>
      </footer>
      <BackToTop label={t.nav.backToTop} />
    </main>
  );
}