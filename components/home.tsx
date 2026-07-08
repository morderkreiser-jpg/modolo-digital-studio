"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import { ArrowRight, Send, CheckCircle2, ExternalLink, AlertCircle, MessageCircle } from "lucide-react";
import SiteNav from "@/components/site-nav";
import BackToTop from "@/components/back-to-top";
import Measure from "@/components/measure";
import { localizedHref, type Locale } from "@/lib/i18n";
import { FAQS } from "@/lib/site-data";
import { SITE, SERVICE_SLUGS } from "@/lib/site";
import { useRegion, whatsappHref } from "@/components/use-region";

type Lang = Locale;

const translations = {
  en: {
    nav: { services: "Services", pricing: "Pricing", portfolio: "Portfolio", about: "About", faq: "FAQ", contact: "Contact", backToTop: "Back to top" },
    hero: {
      badge: "Digital Studio · Web · Brand · SEO",
      titleLine1: "Design, code and strategy",
      titleAccent: "for brands that want to stand out.",
      subtitle: "An independent studio in Winterthur — websites, brands and content tailored to each business, for professionals and small companies across Switzerland. Built by hand, cared for as if they were our own.",
      ctaPrimary: "Book a free consultation",
      ctaSecondary: "See the work",
      meta: "Digital studio · Winterthur",
      line1: "Websites, brands",
      line2: "and stories,",
      line3pre: "built ",
      line3accent: "by hand",
      line3post: ".",
    },
    stats: [
      { value: "100%", label: "Made in Switzerland" },
      { value: "24h", label: "Response time" },
      { value: "Free", label: "First consultation" },
      { value: "4+", label: "Years of experience" },
    ],
    servicesSection: { label: "What we do", heading1: "Tailored services, ", headingAccent: "real results", learnMore: "Learn more", viewPricing: "View pricing" },
    services: [
      { title: "Web & Development", desc: "Modern, high-performance websites optimized for local SEO. Google Business management to stand out in your area.", tags: ["Web Design", "Development", "Local SEO", "Google Business"] },
      { title: "Brand & Identity", desc: "We build memorable visual identities. From your logo to branded Canva templates, every detail tells your brand's story.", tags: ["Branding", "Visual Identity", "Canva Templates"] },
      { title: "Content & Visual", desc: "Professional photo shoots and social media management in collaboration with Project Visibility, content specialists.", tags: ["Photo Shooting", "Social Media", "Project Visibility"] },
      { title: "Email Marketing", desc: "Newsletters and email marketing that turn contacts into customers. Strategies that grow your business.", tags: ["Newsletter", "Email Marketing", "Automation"] },
    ],
    portfolioSection: { label: "Portfolio", heading1: "Projects that ", headingAccent: "speak for themselves", indexLabel: "Selected work", closingLine: "A few projects at a time, each followed one by one.", closingCta: "Start your project" },
    saporivivi: { tags: ["Complete Website", "Catering & Events", "SEO"], meta: "Complete Website · Catering", desc: "Complete website for a premium Italian bar catering service. Elegant design, refined user experience and SEO optimization.", cta: "Visit site" },
    zurikey: { tags: ["Web App", "Product Design", "Development"], meta: "Web App · Zürich", desc: "A web app that helps Zürich renters build a standout rental application — profile, documents, affordability score and a flawless German cover letter, ready as a print PDF.", cta: "Visit site", alt: "ZüriKey — rental-dossier web app for Zürich" },
    bjstudio: { tags: ["Website", "WhatsApp Booking"], meta: "Website · Zürich", desc: "Multilingual website (4 languages) for a Zürich beauty studio, with WhatsApp booking, a before/after gallery and local SEO.", cta: "Visit site", alt: "BJ Studio de Belleza — beauty studio website in Zürich" },
    about: {
      label: "About us", heading1: "One studio, ", headingAccent: "one clear vision",
      p1: "Modolo Digital Studio is an independent studio — not an agency juggling a hundred clients. A few projects at a time, each followed one by one. Because every business deserves a site worthy of its value, not a recycled template.",
      p2: "We combine refined design, technical development and strategy to build websites and experiences that not only look beautiful, but truly work. We work with professionals and businesses across Switzerland, and partner with specialists like Project Visibility to cover every need, from content creation to social media management.",
      p3: "No inflated promises: clean code, real attention to detail and a direct relationship. Work with us and you always talk to the person who actually builds your site.",
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
    toolsLabel: "Tools & technologies",
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
      whatsapp: "Message us on WhatsApp", whatsappMsg: "Hi Francesco, I'd like to talk about a project.",
      emailLabel: "Email", phoneLabel: "Phone", areaLabel: "Area", areaValue: "All of Switzerland", officesLabel: "Offices", countryCh: "Switzerland", countryIt: "Italy",
      formName: "Name", formEmail: "Email", formCompany: "Company", formMessage: "Message",
      phName: "Your name", phEmail: "your@email.com", phCompany: "Company name (optional)", phMessage: "Two lines about your project (optional)…",
      needsLabel: "What do you need?", needs: ["Website", "Brand & logo", "Content & social", "Email marketing", "Other"], optional: "optional", reassurance: "Reply within 24h · No obligation",
      btnSend: "Request a free consultation", btnSending: "Sending...",
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
      badge: "Digital Studio · Web · Brand · SEO",
      titleLine1: "Design, Code und Strategie",
      titleAccent: "für Marken, die sich abheben wollen.",
      subtitle: "Ein unabhängiges Studio in Winterthur — massgeschneiderte Websites, Marken und Inhalte für Fachleute und kleine Unternehmen in der ganzen Schweiz. Von Hand gebaut, gepflegt, als wären es unsere eigenen.",
      ctaPrimary: "Kostenlose Beratung buchen",
      ctaSecondary: "Arbeiten ansehen",
      meta: "Digital Studio · Winterthur",
      line1: "Websites, Marken",
      line2: "und Inhalte,",
      line3pre: "",
      line3accent: "von Hand",
      line3post: " gebaut.",
    },
    stats: [
      { value: "100%", label: "Made in Switzerland" },
      { value: "24h", label: "Reaktionszeit" },
      { value: "Gratis", label: "Erstberatung" },
      { value: "4+", label: "Jahre Erfahrung" },
    ],
    servicesSection: { label: "Was wir tun", heading1: "Massgeschneiderte Leistungen, ", headingAccent: "echte Ergebnisse", learnMore: "Mehr erfahren", viewPricing: "Preise ansehen" },
    services: [
      { title: "Web & Entwicklung", desc: "Moderne, performante Websites, optimiert für lokales SEO. Google-Business-Verwaltung, um in deiner Region sichtbar zu werden.", tags: ["Webdesign", "Entwicklung", "Lokales SEO", "Google Business"] },
      { title: "Marke & Identität", desc: "Wir gestalten einprägsame visuelle Identitäten. Vom Logo bis zu gebrandeten Canva-Vorlagen erzählt jedes Detail die Geschichte deiner Marke.", tags: ["Branding", "Visuelle Identität", "Canva-Vorlagen"] },
      { title: "Content & Visual", desc: "Professionelle Fotoshootings und Social-Media-Betreuung in Zusammenarbeit mit Project Visibility, Spezialisten für Content.", tags: ["Fotoshooting", "Social Media", "Project Visibility"] },
      { title: "E-Mail-Marketing", desc: "Newsletter und E-Mail-Marketing, die Kontakte in Kunden verwandeln. Strategien, die dein Geschäft wachsen lassen.", tags: ["Newsletter", "E-Mail-Marketing", "Automation"] },
    ],
    portfolioSection: { label: "Portfolio", heading1: "Projekte, die ", headingAccent: "für sich sprechen", indexLabel: "Ausgewählte Arbeiten", closingLine: "Wenige Projekte auf einmal, eines nach dem anderen begleitet.", closingCta: "Starten wir dein Projekt" },
    saporivivi: { tags: ["Komplette Website", "Catering & Events", "SEO"], meta: "Komplette Website · Catering", desc: "Komplette Website für einen Premium-Service für italienisches Bar-Catering. Elegantes Design, durchdachte Nutzererfahrung und SEO-Optimierung.", cta: "Website besuchen" },
    zurikey: { tags: ["Web App", "Produktdesign", "Entwicklung"], meta: "Web App · Zürich", desc: "Eine Web-App, die Wohnungssuchenden in Zürich hilft, ein überzeugendes Mietdossier zu erstellen — Profil, Dokumente, Tragbarkeits-Score und ein perfektes Anschreiben auf Deutsch, druckfertig als PDF.", cta: "Website besuchen", alt: "ZüriKey — Mietdossier-Web-App für Zürich" },
    bjstudio: { tags: ["Website", "WhatsApp-Termine"], meta: "Website · Zürich", desc: "Mehrsprachige Website (4 Sprachen) für ein Beauty-Studio in Zürich, mit Terminbuchung via WhatsApp, Vorher-Nachher-Galerie und lokalem SEO.", cta: "Website besuchen", alt: "BJ Studio de Belleza — Beauty-Studio-Website in Zürich" },
    about: {
      label: "Über uns", heading1: "Ein Studio, ", headingAccent: "eine klare Vision",
      p1: "Modolo Digital Studio ist ein unabhängiges Studio – keine Agentur mit hundert Kunden. Wenige Projekte gleichzeitig, jedes einzeln betreut. Weil jedes Unternehmen eine Website verdient, die seinem Wert gerecht wird — keine Vorlage von der Stange.",
      p2: "Wir verbinden raffiniertes Design, technische Entwicklung und Strategie, um Websites und Erlebnisse zu schaffen, die nicht nur schön aussehen, sondern wirklich funktionieren. Wir arbeiten mit Fachleuten und Unternehmen in der ganzen Schweiz und kooperieren mit Spezialisten wie Project Visibility, um jeden Bedarf abzudecken, von der Content-Erstellung bis zur Social-Media-Betreuung.",
      p3: "Keine aufgeblasenen Versprechen: sauberer Code, echte Liebe zum Detail und ein direkter Draht. Bei uns sprichst du immer mit der Person, die deine Website tatsächlich baut.",
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
    toolsLabel: "Tools & Technologien",
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
      whatsapp: "Schreib uns auf WhatsApp", whatsappMsg: "Hallo Francesco, ich möchte über ein Projekt sprechen.",
      emailLabel: "E-Mail", phoneLabel: "Telefon", areaLabel: "Gebiet", areaValue: "Ganze Schweiz", officesLabel: "Standorte", countryCh: "Schweiz", countryIt: "Italien",
      formName: "Name", formEmail: "E-Mail", formCompany: "Unternehmen", formMessage: "Nachricht",
      phName: "Dein Name", phEmail: "deine@email.com", phCompany: "Firmenname (optional)", phMessage: "Zwei Zeilen zu deinem Projekt (optional)…",
      needsLabel: "Was brauchst du?", needs: ["Website", "Marke & Logo", "Content & Social", "E-Mail-Marketing", "Anderes"], optional: "optional", reassurance: "Antwort in 24 Std · Unverbindlich",
      btnSend: "Kostenlose Beratung anfragen", btnSending: "Wird gesendet...",
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
      badge: "Studio digitale · Web · Brand · SEO",
      titleLine1: "Design, codice e strategia",
      titleAccent: "per brand che vogliono distinguersi.",
      subtitle: "Uno studio indipendente a Winterthur — siti, brand e contenuti su misura per professionisti e piccole attività in tutta la Svizzera. Fatti a mano, curati come se fossero nostri.",
      ctaPrimary: "Prenota una consulenza gratuita",
      ctaSecondary: "Guarda i lavori",
      meta: "Studio digitale · Winterthur",
      line1: "Siti, marchi",
      line2: "e contenuti,",
      line3pre: "costruiti ",
      line3accent: "a mano",
      line3post: ".",
    },
    stats: [
      { value: "100%", label: "Made in Switzerland" },
      { value: "24h", label: "Tempo di risposta" },
      { value: "Gratis", label: "Prima consulenza" },
      { value: "4+", label: "Anni di esperienza" },
    ],
    servicesSection: { label: "Cosa facciamo", heading1: "Servizi su misura, ", headingAccent: "risultati concreti", learnMore: "Scopri di più", viewPricing: "Vedi i prezzi" },
    services: [
      { title: "Web & Sviluppo", desc: "Siti web moderni, performanti e ottimizzati per la SEO locale. Gestione Google Business per emergere sul territorio.", tags: ["Web Design", "Sviluppo", "SEO Locale", "Google Business"] },
      { title: "Brand & Identità", desc: "Costruiamo identità visive memorabili. Dal logo ai template Canva brandizzati, ogni dettaglio racconta il tuo brand.", tags: ["Branding", "Identità Visiva", "Template Canva"] },
      { title: "Contenuti & Visual", desc: "Shooting fotografici professionali e gestione social in collaborazione con Project Visibility, specialisti in contenuti.", tags: ["Shooting", "Social Media", "Project Visibility"] },
      { title: "Email Marketing", desc: "Newsletter ed email marketing che trasformano i contatti in clienti. Strategie che fanno crescere il tuo business.", tags: ["Newsletter", "Email Marketing", "Automation"] },
    ],
    portfolioSection: { label: "Portfolio", heading1: "Progetti che ", headingAccent: "parlano da soli", indexLabel: "Lavori selezionati", closingLine: "Pochi progetti alla volta, seguiti uno per uno.", closingCta: "Iniziamo il tuo progetto" },
    saporivivi: { tags: ["Sito Web Completo", "Catering & Eventi", "SEO"], meta: "Sito Web Completo · Catering", desc: "Sito web completo per un servizio premium di bar catering italiano. Design elegante, esperienza utente curata e ottimizzazione SEO.", cta: "Visita il sito" },
    zurikey: { tags: ["Web App", "Product Design", "Sviluppo"], meta: "Web App · Zurigo", desc: "Web app che aiuta chi cerca casa a Zurigo a creare un dossier d'affitto impeccabile: profilo, documenti, punteggio di sostenibilità e lettera in tedesco, pronti in PDF.", cta: "Visita il sito", alt: "ZüriKey — web app per il dossier d'affitto a Zurigo" },
    bjstudio: { tags: ["Sito Web", "Prenotazioni WhatsApp"], meta: "Sito Web · Zurigo", desc: "Sito multilingua (4 lingue) per uno studio beauty a Zurigo, con prenotazione via WhatsApp, galleria prima/dopo e SEO locale.", cta: "Visita il sito", alt: "BJ Studio de Belleza — sito per uno studio beauty a Zurigo" },
    about: {
      label: "Chi siamo", heading1: "Uno studio, ", headingAccent: "una visione precisa",
      p1: "Modolo Digital Studio è uno studio indipendente, non un'agenzia con mille clienti: pochi progetti alla volta, seguiti uno per uno. Perché ogni attività merita un sito all'altezza del suo valore — non un modello riciclato.",
      p2: "Uniamo design raffinato, sviluppo tecnico e strategia per costruire siti ed esperienze che non solo appaiono belli, ma funzionano davvero. Lavoriamo con professionisti e aziende in tutta la Svizzera, e collaboriamo con specialisti come Project Visibility per coprire ogni esigenza, dalla creazione di contenuti alla gestione social.",
      p3: "Niente promesse gonfiate: codice pulito, cura vera del dettaglio e un rapporto diretto. Lavorando con noi parli sempre con chi il tuo sito lo costruisce davvero.",
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
    toolsLabel: "Strumenti & tecnologie",
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
      whatsapp: "Scrivici su WhatsApp", whatsappMsg: "Ciao Francesco, vorrei parlare di un progetto.",
      emailLabel: "Email", phoneLabel: "Telefono", areaLabel: "Area", areaValue: "Tutta la Svizzera", officesLabel: "Sedi", countryCh: "Svizzera", countryIt: "Italia",
      formName: "Nome", formEmail: "Email", formCompany: "Azienda", formMessage: "Messaggio",
      phName: "Il tuo nome", phEmail: "la-tua@email.com", phCompany: "Nome azienda (opzionale)", phMessage: "Due righe sul tuo progetto (facoltativo)…",
      needsLabel: "Di cosa hai bisogno?", needs: ["Sito web", "Brand & logo", "Contenuti & social", "Email marketing", "Altro"], optional: "facoltativo", reassurance: "Risposta entro 24h · Senza impegno",
      btnSend: "Richiedi la consulenza gratuita", btnSending: "Invio in corso...",
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

const TOOLS = ["Next.js", "React", "Tailwind CSS", "WordPress", "Framer", "Figma", "SEO", "Google Business"];
const DISCIPLINES = ["Websites", "Branding", "Content", "Foto", "Video", "Reels", "Social", "SEO", "Ads"];

export default function Home({ lang }: { lang: Lang }) {
  const [formStatus, setFormStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const reduce = useReducedMotion();
  const successRef = useRef<HTMLDivElement>(null);
  const t = translations[lang];
  const region = useRegion();
  const whatsapp = whatsappHref(region, SITE.phone, SITE.phoneIt, t.contact.whatsappMsg);

  // Portfolio as a curated monograph — real, borderless site captures.
  const PROJECTS = [
    { num: "01", name: "ZüriKey", href: "https://zurikey.ch", data: t.zurikey,
      media: { kind: "video" as const, src: "/portfolio-zurikey.mp4", poster: "/portfolio-zurikey-poster.webp", aria: t.zurikey.alt } },
    { num: "02", name: "SaporiVivi", href: "https://saporivivi.ch", data: t.saporivivi,
      media: { kind: "video" as const, src: "/portfolio-saporivivi-v4.mp4", poster: "/portfolio-saporivivi-v4-poster.webp", aria: "SaporiVivi — Italian luxury bar catering website" } },
    { num: "03", name: "BJ Studio", href: "https://bjstudiodebelleza.vercel.app", data: t.bjstudio,
      media: { kind: "image" as const, src: "/portfolio-bjstudio-poster.webp", aria: t.bjstudio.alt } },
  ];

  // Move focus to the success panel so screen-reader and keyboard users are told the message sent.
  useEffect(() => {
    if (formStatus === "success") successRef.current?.focus();
  }, [formStatus]);

  const [needs, setNeeds] = useState<string[]>([]);
  const toggleNeed = (n: string) => setNeeds((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (formStatus === "sending") return;
    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("lang", lang);
    data.set("servizi", needs.join(", "));
    const name = (data.get("nome") as string)?.trim();
    const email = (data.get("email") as string)?.trim();
    const errs: { name?: string; email?: string } = {};
    if (!name) errs.name = t.contact.errName;
    if (!email) errs.email = t.contact.errEmailRequired;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = t.contact.errEmailInvalid;
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
        setNeeds([]);
      } else {
        setFormStatus("error");
      }
    } catch {
      setFormStatus("error");
    }
  };

  return (
    <main id="main" tabIndex={-1} className="relative min-h-screen bg-[var(--paper)] text-[#1F1B16] overflow-x-hidden outline-none">
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

      {/* Redesign signature + analog grain */}
      <div className="mds-grain" aria-hidden />
      <Measure />

      {/* HERO — type-led, left-aligned; the Measure runs down the left margin */}
      <section className="relative flex min-h-svh flex-col justify-center px-6 sm:px-10 lg:px-16 pt-36 pb-20">
        <div className="mx-auto w-full max-w-[1400px]">
          <div className="mb-9 flex items-baseline justify-between mds-in" style={{ animationDelay: "0.05s" }}>
            <span className="micro-caps text-[var(--color-gold-ink)]">{t.hero.meta}</span>
            <span className="micro-caps tnum text-[#1F1B16]/40">01 / 09</span>
          </div>

          <h1 className="display-type text-[#1F1B16]" style={{ fontSize: "clamp(2.6rem, 8.6vw, 8rem)" }}>
            <span className="mds-line"><span style={{ animationDelay: "0.12s" }}>{t.hero.line1}</span></span>
            <span className="mds-line"><span style={{ animationDelay: "0.21s" }}>{t.hero.line2}</span></span>
            <span className="mds-line">
              <span style={{ animationDelay: "0.3s" }}>
                {t.hero.line3pre}
                <em className="text-[var(--color-gold)]" style={{ fontVariationSettings: '"opsz" 64, "SOFT" 45' }}>{t.hero.line3accent}</em>
                {t.hero.line3post}
              </span>
            </span>
          </h1>

          <div className="mt-9 grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
            <p className="max-w-xl text-base font-light leading-relaxed text-[#1F1B16]/70 sm:text-lg mds-in" style={{ animationDelay: "0.5s" }}>
              {t.hero.subtitle}
            </p>
            <div className="flex flex-wrap items-center gap-x-7 gap-y-4 mds-in" style={{ animationDelay: "0.58s" }}>
              <a href="#contatti" className="group inline-flex items-center gap-2 rounded-full bg-[#1F1B16] px-7 py-3.5 text-sm font-medium tracking-wide text-[var(--paper)] transition-colors duration-300 hover:bg-[#33291E]">
                {t.hero.ctaPrimary}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </a>
              <a href="#portfolio" className="group inline-flex items-center gap-2 text-sm tracking-wide text-[#1F1B16]/75 transition-colors hover:text-[#1F1B16]">
                <span className="relative">
                  {t.hero.ctaSecondary}
                  <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[var(--color-gold)] transition-transform duration-300 group-hover:scale-x-100" />
                </span>
                <ArrowRight className="h-3.5 w-3.5 rotate-90 transition-transform group-hover:translate-y-0.5" />
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* DISCIPLINE MARQUEE — oversized Fraunces ticker; proves the full range */}
      <section aria-hidden className="marquee-mask select-none overflow-hidden border-y border-[color:var(--line)] py-5 md:py-7">
        <div className="marquee-track">
          {[0, 1].map((dup) => (
            <div key={dup} className="flex shrink-0 items-center">
              {DISCIPLINES.map((d, i) => (
                <span key={`${dup}-${i}`} className="flex items-center">
                  <span className="display-type px-6 text-[#1F1B16]/85 md:px-9" style={{ fontSize: "clamp(1.75rem, 4vw, 3.25rem)" }}>{d}</span>
                  <span className="inline-block h-1.5 w-1.5 shrink-0 rotate-45" style={{ background: "var(--color-gold)" }} />
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* STATS — editorial data row on Bone; tabular figures, hairline dividers, no icon boxes */}
      <section className="bg-[var(--bone)] px-6 sm:px-10 lg:px-16 py-14 md:py-20">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid grid-cols-2 md:grid-cols-4">
            {t.stats.map((stat, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className={`py-4 md:px-8 ${i % 2 === 1 ? "border-l border-[color:var(--line)] pl-5" : ""} ${i >= 2 ? "mt-6 md:mt-0" : ""} ${i === 2 ? "md:border-l md:pl-8" : ""}`}
              >
                <div className="display-type tnum text-[#1F1B16]" style={{ fontSize: "clamp(2rem, 4.5vw, 3.25rem)" }}>{stat.value}</div>
                <div className="micro-caps mt-2.5 text-[#1F1B16]/55">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVIZI — numbered index table (Klim/Order register), not cards */}
      <section id="servizi" className="bg-[var(--paper)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
        <div className="mx-auto max-w-[1400px]">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: 0.7 }}
            className="mb-12 flex flex-col gap-6 md:mb-16 md:flex-row md:items-end md:justify-between"
          >
            <div>
              <span className="micro-caps text-[var(--color-gold-ink)]">01 · {t.servicesSection.label}</span>
              <h2 className="display-type mt-4 text-[#1F1B16]" style={{ fontSize: "clamp(2.25rem, 5.5vw, 4.5rem)" }}>
                {t.servicesSection.heading1}<em className="text-[var(--color-gold)]">{t.servicesSection.headingAccent}</em>
              </h2>
            </div>
            <span className="micro-caps tnum text-[#1F1B16]/40">01 — 04</span>
          </motion.div>

          <div className="border-b border-[color:var(--line)]">
            {t.services.map((service, i) => (
              <motion.div
                key={i}
                initial={reduce ? false : { opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-8%" }}
                transition={{ duration: 0.5, delay: i * 0.06 }}
              >
                <Link
                  href={localizedHref(lang, `/servizi/${SERVICE_SLUGS[i]}`)}
                  className="group flex flex-col gap-3 border-t border-[color:var(--line)] py-6 transition-colors hover:bg-[var(--bone)]/40 md:flex-row md:items-baseline md:gap-8 md:px-2 md:py-8"
                >
                  <span className="micro-caps tnum text-[var(--color-gold-ink)] md:w-10">0{i + 1}</span>
                  <h3 className="display-type text-[#1F1B16] transition-colors duration-300 group-hover:text-[var(--color-gold-ink)] md:flex-1" style={{ fontSize: "clamp(1.6rem, 3.4vw, 2.75rem)" }}>{service.title}</h3>
                  <div className="micro-caps flex flex-wrap gap-x-3 gap-y-1 text-[#1F1B16]/45 md:max-w-[18rem] md:justify-end md:text-right">
                    {service.tags.map((tag) => (
                      <span key={tag}>{tag}</span>
                    ))}
                  </div>
                  <ArrowRight className="hidden h-5 w-5 shrink-0 text-[var(--color-gold-ink)] transition-transform duration-300 group-hover:translate-x-1 md:block" strokeWidth={1.4} />
                </Link>
              </motion.div>
            ))}
          </div>

          <div className="mt-10">
            <Link href={localizedHref(lang, "/prezzi")} className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--color-gold-ink)] transition-colors hover:text-[var(--color-gold)]">
              <span className="relative">
                {t.servicesSection.viewPricing}
                <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[var(--color-gold)] transition-transform duration-300 group-hover:scale-x-100" />
              </span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </div>
      </section>

      {/* PORTFOLIO — monograph; the Measure motif becomes the row rules */}
      <section id="portfolio" className="bg-[var(--paper)] px-6 sm:px-10 lg:px-16 py-24 md:py-36">
        <div className="mx-auto max-w-[1400px]">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: 0.7 }}
            className="mb-14 flex flex-col gap-6 md:mb-20 md:flex-row md:items-end md:justify-between"
          >
            <div>
              <span className="micro-caps text-[var(--color-gold-ink)]">02 · {t.portfolioSection.label}</span>
              <h2 className="display-type mt-4 text-[#1F1B16]" style={{ fontSize: "clamp(2.25rem, 5.5vw, 4.5rem)" }}>
                {t.portfolioSection.heading1}<em className="text-[var(--color-gold)]">{t.portfolioSection.headingAccent}</em>
              </h2>
            </div>
            <span className="micro-caps tnum text-[#1F1B16]/40">{t.portfolioSection.indexLabel} — 01/03</span>
          </motion.div>

          <div className="space-y-16 md:space-y-24">
            {PROJECTS.map((p) => (
              <motion.a
                key={p.num}
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                initial={reduce ? false : { opacity: 0, y: 40 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-10%" }}
                transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
                className="group block border-t border-[var(--color-gold)]/25 pt-6 md:pt-8"
              >
                <div className="mb-6 flex items-baseline justify-between gap-4 md:mb-8">
                  <div className="flex items-baseline gap-4 md:gap-7">
                    <span aria-hidden="true" className="display-italic leading-none text-[var(--color-gold)]" style={{ fontSize: "clamp(1.5rem, 3vw, 2.75rem)" }}>{p.num}</span>
                    <h3 className="display-type leading-none text-[#1F1B16] transition-colors duration-500 group-hover:text-[var(--color-gold-ink)]" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>{p.name}</h3>
                  </div>
                  <span className="micro-caps hidden text-[var(--color-gold-ink)] sm:block">{p.data.meta}</span>
                </div>

                <div className="relative aspect-[1280/674] overflow-hidden rounded-[4px] bg-[#17130E]">
                  {p.media.kind === "video" ? (
                    <video src={p.media.src} poster={p.media.poster} autoPlay muted loop playsInline preload="metadata" aria-label={p.media.aria} className={`absolute inset-0 h-full w-full object-cover ${reduce ? "" : "transition-transform duration-[900ms] ease-out group-hover:scale-[1.04]"}`} />
                  ) : (
                    <Image src={p.media.src} alt={p.media.aria} fill sizes="(max-width: 1024px) 100vw, 1300px" className={`object-cover object-top ${reduce ? "" : "transition-transform duration-[900ms] ease-out group-hover:scale-[1.04]"}`} />
                  )}
                  <span className="pointer-events-none absolute bottom-4 right-4 flex translate-y-2 items-center gap-2 rounded-full px-4 py-2 text-sm tracking-wide text-[#1F1B16] opacity-0 backdrop-blur transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100" style={{ background: "rgba(251,248,242,0.94)" }}>
                    {p.data.cta} <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.6} />
                  </span>
                </div>

                <div className="mt-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
                  <p className="max-w-xl font-light leading-relaxed text-[#1F1B16]/65">{p.data.desc}</p>
                  <div className="micro-caps flex flex-wrap gap-x-4 gap-y-1 text-[#1F1B16]/45">
                    {p.data.tags.map((tag, ti) => (
                      <span key={ti} className={ti === 0 ? "text-[var(--color-gold-ink)]" : ""}>{tag}</span>
                    ))}
                  </div>
                </div>
              </motion.a>
            ))}
          </div>

          {/* Closing bookend — routes intent to contact */}
          <motion.div initial={reduce ? false : { opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="mt-20 border-t border-[color:var(--line)] pt-10">
            <p className="max-w-xl font-light text-[#1F1B16]/60">{t.portfolioSection.closingLine}</p>
            <a href="#contatti" className="group mt-4 inline-flex items-center gap-2 text-sm tracking-wide text-[var(--color-gold-ink)] transition-colors hover:text-[var(--color-gold)]">
              <span>{t.portfolioSection.closingCta}</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          </motion.div>
        </div>
      </section>

      {/* CHI SIAMO — the ESPRESSO Night room: the one dark surface, the emotional peak */}
      <section id="chi-siamo" className="px-6 sm:px-10 lg:px-16 py-24 md:py-36" style={{ background: "var(--espresso)", color: "var(--paper)" }}>
        <div className="mx-auto max-w-[1400px]">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: 0.7 }}
            className="mb-14 max-w-3xl md:mb-20"
          >
            <span className="micro-caps" style={{ color: "var(--gilt)" }}>03 · {t.about.label}</span>
            <h2 className="display-type mt-5" style={{ fontSize: "clamp(2rem, 5.2vw, 4.5rem)", color: "var(--paper)" }}>
              {t.about.heading1}<em style={{ color: "var(--gilt)" }}>{t.about.headingAccent}</em>
            </h2>
            <p className="mt-6 text-lg font-light leading-relaxed" style={{ color: "rgba(251,248,242,0.68)" }}>{t.about.p1}</p>
          </motion.div>

          <div className="grid gap-10 md:grid-cols-12 md:gap-16">
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.8 }}
              className="md:col-span-4"
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-[4px]" style={{ background: "linear-gradient(to bottom, #241d14, #17130e)" }}>
                <Image src="/founder-2.webp" alt="Francesco Modolo — Fondatore di Modolo Digital Studio" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-contain object-bottom" />
              </div>
              <div className="mt-5 flex items-baseline justify-between border-t pt-4" style={{ borderColor: "rgba(201,162,90,0.3)" }}>
                <span className="display-type text-lg" style={{ color: "var(--paper)" }}>{t.founder.name}</span>
                <span className="micro-caps" style={{ color: "var(--gilt)" }}>{t.founder.eyebrow}</span>
              </div>
              <div className="micro-caps mt-2" style={{ color: "rgba(251,248,242,0.48)" }}>{t.founder.role}</div>
            </motion.div>

            <motion.div
              initial={reduce ? false : { opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="md:col-span-8"
            >
              <div className="grid gap-6 text-base font-light leading-relaxed md:grid-cols-2" style={{ color: "rgba(251,248,242,0.66)" }}>
                <p>{t.founder.bio1}</p>
                <p>{t.founder.bio2}</p>
              </div>

              <div className="mt-12 border-t" style={{ borderColor: "rgba(201,162,90,0.25)" }}>
                {t.values.map((value, i) => (
                  <div key={i} className="flex gap-6 border-b py-5" style={{ borderColor: "rgba(201,162,90,0.14)" }}>
                    <span aria-hidden="true" className="display-italic leading-none" style={{ color: "var(--gilt)", fontSize: "1.5rem" }}>0{i + 1}</span>
                    <div>
                      <h3 className="display-type text-lg" style={{ color: "var(--paper)" }}>{value.title}</h3>
                      <p className="mt-1 text-sm font-light" style={{ color: "rgba(251,248,242,0.5)" }}>{value.desc}</p>
                    </div>
                  </div>
                ))}
              </div>

              <p className="display-type mt-12" style={{ fontSize: "clamp(1.35rem, 2.4vw, 2rem)", lineHeight: 1.3, color: "var(--paper)" }}>{t.about.p3}</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* SETTORI — ticked index of sectors, no icon-cards */}
      <section className="bg-[var(--bone)] px-6 sm:px-10 lg:px-16 py-20 md:py-28">
        <div className="mx-auto max-w-[1400px]">
          <div className="mb-10 md:mb-12">
            <span className="micro-caps text-[var(--color-gold-ink)]">04 · {t.sectorsSection.label}</span>
            <h2 className="display-type mt-3 text-[#1F1B16]" style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)" }}>
              {t.sectorsSection.heading1}<em className="text-[var(--color-gold)]">{t.sectorsSection.headingAccent}</em>
            </h2>
          </div>
          <div className="grid gap-x-10 sm:grid-cols-2 lg:grid-cols-4">
            {t.sectors.map((name, i) => (
              <motion.div
                key={i}
                initial={reduce ? false : { opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-8%" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="flex items-baseline gap-4 border-t border-[color:var(--line-strong)] py-5"
              >
                <span className="micro-caps tnum text-[var(--color-gold-ink)]">0{i + 1}</span>
                <span className="text-lg font-light text-[#1F1B16]/80">{name}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* TOOLS — editorial inline list in the display face */}
      <section className="bg-[var(--paper)] px-6 sm:px-10 lg:px-16 py-16 md:py-20">
        <div className="mx-auto max-w-[1400px]">
          <span className="micro-caps text-[var(--color-gold-ink)]">{t.toolsLabel}</span>
          <div className="mt-6 flex flex-wrap items-center gap-x-8 gap-y-2">
            {TOOLS.map((tool) => (
              <span key={tool} className="display-type text-[#1F1B16]/70" style={{ fontSize: "clamp(1.1rem, 2vw, 1.6rem)" }}>{tool}</span>
            ))}
          </div>
        </div>
      </section>

      {/* METODO — three phases as ticked stations measured by the ruler */}
      <section id="metodo" className="bg-[var(--paper)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
        <div className="mx-auto max-w-[1400px]">
          <div className="mb-12 md:mb-16">
            <span className="micro-caps text-[var(--color-gold-ink)]">05 · {t.method.label}</span>
            <h2 className="display-type mt-4 text-[#1F1B16]" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
              {t.method.heading1}<em className="text-[var(--color-gold)]">{t.method.headingAccent}</em>
            </h2>
          </div>
          <div className="grid gap-y-10 md:grid-cols-3 md:gap-x-12">
            {t.steps.map((step, i) => (
              <motion.div
                key={i}
                initial={reduce ? false : { opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-8%" }}
                transition={{ duration: 0.6, delay: i * 0.12 }}
                className="border-t border-[var(--color-gold)]/30 pt-6"
              >
                <div className="flex items-baseline gap-4">
                  <span aria-hidden="true" className="display-italic leading-none text-[var(--color-gold)]" style={{ fontSize: "clamp(1.5rem, 2.5vw, 2rem)" }}>{step.num}</span>
                  <h3 className="display-type text-[#1F1B16]" style={{ fontSize: "clamp(1.5rem, 3vw, 2.25rem)" }}>{step.title}</h3>
                </div>
                <p className="mt-4 font-light leading-relaxed text-[#1F1B16]/65">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* QUOTE — large Fraunces pull-quote, pure type */}
      <section className="bg-[var(--bone)] px-6 sm:px-10 lg:px-16 py-28 md:py-40">
        <motion.blockquote
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.8 }}
          className="mx-auto max-w-[1100px]"
        >
          <span className="mb-8 block h-px w-16 bg-[var(--color-gold)]" aria-hidden="true" />
          <p className="display-type text-[#1F1B16]" style={{ fontSize: "clamp(1.75rem, 4.4vw, 3.5rem)", lineHeight: 1.16 }}>
            {t.quote.line1} <em className="text-[var(--color-gold)]">{t.quote.line2}</em>
          </p>
        </motion.blockquote>
      </section>

      {/* FAQ — hairline-divided index accordion */}
      <section id="faq" className="bg-[var(--paper)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
        <div className="mx-auto max-w-[920px]">
          <header className="mb-12 md:mb-16">
            <span className="micro-caps text-[var(--color-gold-ink)]">06 · {t.faqSection.label}</span>
            <h2 className="display-type mt-4 text-[#1F1B16]" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
              {t.faqSection.heading1}<em className="text-[var(--color-gold)]">{t.faqSection.headingAccent}</em>
            </h2>
          </header>

          <div className="border-b border-[color:var(--line)]">
            {FAQS[lang].map((faq, i) => {
              const isOpen = openFaq === i;
              return (
                <div key={i} className="border-t border-[color:var(--line)]">
                  <h3>
                    <button type="button" id={`faq-q-${i}`} aria-expanded={isOpen} aria-controls={`faq-a-${i}`} onClick={() => setOpenFaq(isOpen ? null : i)} className="group flex w-full items-center justify-between gap-6 py-6 text-left">
                      <span className="text-lg font-light text-[#1F1B16] transition-colors group-hover:text-[var(--color-gold-ink)] md:text-xl">{faq.q}</span>
                      <span aria-hidden="true" className="relative block h-3.5 w-3.5 shrink-0">
                        <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2" style={{ background: "var(--color-gold-ink)" }} />
                        <span className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 transition-transform duration-300 ${isOpen ? "scale-y-0" : "scale-y-100"}`} style={{ background: "var(--color-gold-ink)" }} />
                      </span>
                    </button>
                  </h3>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: reduce ? 0 : 0.3, ease: "easeInOut" }}>
                        <p className="max-w-2xl pb-7 pr-8 font-light leading-relaxed text-[#1F1B16]/65">{faq.a}</p>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CONTATTI — restyled to the system; the working form/Resend pipeline is preserved */}
      <section id="contatti" className="bg-[var(--paper)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
        <div className="mx-auto max-w-[1400px]">
          <motion.div initial={reduce ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-12%" }} transition={{ duration: 0.7 }} className="mb-14 max-w-3xl md:mb-20">
            <span className="micro-caps text-[var(--color-gold-ink)]">07 · {t.contact.label}</span>
            <h2 className="display-type mt-4 text-[#1F1B16]" style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)" }}>
              {t.contact.heading1}<em className="text-[var(--color-gold)]">{t.contact.headingAccent}</em>{t.contact.headingEnd}
            </h2>
            <p className="mt-6 max-w-2xl text-lg font-light leading-relaxed text-[#1F1B16]/70">{t.contact.subtitle}</p>
          </motion.div>

          <div className="grid gap-12 md:grid-cols-12 md:gap-16">
            <div className="md:col-span-5">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-3 text-[#1F1B16]">
                <MessageCircle className="h-5 w-5 text-[var(--color-gold-ink)]" strokeWidth={1.5} />
                <span className="relative text-base tracking-wide">
                  {t.contact.whatsapp}
                  <span className="absolute -bottom-1 left-0 h-px w-full origin-left bg-[var(--color-gold)]/50 transition-transform duration-300 group-hover:scale-x-0" />
                </span>
              </a>

              <dl className="mt-10 space-y-7 border-t border-[color:var(--line)] pt-8">
                <div>
                  <dt className="micro-caps text-[#1F1B16]/45">{t.contact.emailLabel}</dt>
                  <dd className="mt-1"><a href={`mailto:${SITE.email}`} className="text-[#1F1B16]/85 transition-colors hover:text-[var(--color-gold-ink)]">{SITE.email}</a></dd>
                </div>
                <div>
                  <dt className="micro-caps text-[#1F1B16]/45">{t.contact.phoneLabel}</dt>
                  <dd className="mt-1"><a href={`tel:${SITE.phone}`} className="tnum text-[#1F1B16]/85 transition-colors hover:text-[var(--color-gold-ink)]">{SITE.phoneDisplay}</a></dd>
                </div>
                <div>
                  <dt className="micro-caps text-[#1F1B16]/45">{t.contact.officesLabel}</dt>
                  <dd className="mt-2 space-y-1 text-sm leading-relaxed text-[#1F1B16]/70">
                    <div><span className="text-[var(--color-gold-ink)]">{t.contact.countryCh}</span> — {SITE.address.street}, {SITE.address.postalCode} {SITE.address.locality}</div>
                    <div><span className="text-[var(--color-gold-ink)]">{t.contact.countryIt}</span> — {SITE.addressIt.street}, {SITE.addressIt.postalCode} {SITE.addressIt.locality}</div>
                  </dd>
                </div>
              </dl>
            </div>

            <div className="md:col-span-7">
              {formStatus === "success" ? (
                <div ref={successRef} tabIndex={-1} role="status" aria-live="polite" className="flex h-full flex-col items-center justify-center rounded-[4px] border border-[var(--color-gold)]/30 bg-[var(--bone)]/50 p-12 text-center outline-none">
                  <CheckCircle2 className="mb-6 h-14 w-14 text-[var(--color-gold-ink)]" strokeWidth={1.2} />
                  <h3 className="display-type text-2xl text-[#1F1B16]">{t.contact.successTitle}</h3>
                  <p className="mt-3 font-light text-[#1F1B16]/65">{t.contact.successDesc}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate className="space-y-6">
                  {/* anti-spam honeypot (hidden from users; the server rejects submissions that fill it — see /api/contact) */}
                  <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
                  <div>
                    <span className="micro-caps mb-3 block text-[#1F1B16]/45">{t.contact.needsLabel}</span>
                    <div className="flex flex-wrap gap-2">
                      {t.contact.needs.map((n) => {
                        const active = needs.includes(n);
                        return (
                          <button key={n} type="button" aria-pressed={active} onClick={() => toggleNeed(n)} className={`rounded-full border px-4 py-2 text-sm tracking-wide transition-all ${active ? "border-[#1F1B16] bg-[#1F1B16] text-[var(--paper)]" : "border-[#1F1B16]/15 text-[#1F1B16]/75 hover:border-[var(--color-gold)]/60 hover:text-[#1F1B16]"}`}>{n}</button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className="micro-caps mb-2 block text-[#1F1B16]/45">{t.contact.formName} *</label>
                      <input id="contact-name" type="text" name="nome" required aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? "contact-name-err" : undefined} onChange={() => fieldErrors.name && setFieldErrors((p) => ({ ...p, name: undefined }))} className="w-full border-b border-[#1F1B16]/20 bg-transparent py-2.5 text-[#1F1B16] placeholder-[#1F1B16]/40 transition-colors focus:border-[var(--color-gold)] focus:outline-none" placeholder={t.contact.phName} />
                      {fieldErrors.name && <p id="contact-name-err" role="alert" className="mt-2 text-sm text-red-700">{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <label htmlFor="contact-email" className="micro-caps mb-2 block text-[#1F1B16]/45">{t.contact.formEmail} *</label>
                      <input id="contact-email" type="email" name="email" required aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={fieldErrors.email ? "contact-email-err" : undefined} onChange={() => fieldErrors.email && setFieldErrors((p) => ({ ...p, email: undefined }))} className="w-full border-b border-[#1F1B16]/20 bg-transparent py-2.5 text-[#1F1B16] placeholder-[#1F1B16]/40 transition-colors focus:border-[var(--color-gold)] focus:outline-none" placeholder={t.contact.phEmail} />
                      {fieldErrors.email && <p id="contact-email-err" role="alert" className="mt-2 text-sm text-red-700">{fieldErrors.email}</p>}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="contact-company" className="micro-caps mb-2 block text-[#1F1B16]/45">{t.contact.formCompany}</label>
                    <input id="contact-company" type="text" name="azienda" className="w-full border-b border-[#1F1B16]/20 bg-transparent py-2.5 text-[#1F1B16] placeholder-[#1F1B16]/40 transition-colors focus:border-[var(--color-gold)] focus:outline-none" placeholder={t.contact.phCompany} />
                  </div>
                  <div>
                    <label htmlFor="contact-message" className="micro-caps mb-2 block text-[#1F1B16]/45">{t.contact.formMessage} <span className="normal-case tracking-normal text-[#1F1B16]/35">({t.contact.optional})</span></label>
                    <textarea id="contact-message" name="messaggio" rows={3} className="w-full resize-none border-b border-[#1F1B16]/20 bg-transparent py-2.5 text-[#1F1B16] placeholder-[#1F1B16]/40 transition-colors focus:border-[var(--color-gold)] focus:outline-none" placeholder={t.contact.phMessage} />
                  </div>
                  {formStatus === "error" && (
                    <div role="alert" className="flex items-start gap-3 rounded-[4px] border border-red-300 bg-red-50 p-4 text-red-800">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <p className="text-sm font-light">{t.contact.error}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-6 pt-2">
                    <button type="submit" disabled={formStatus === "sending"} className="group inline-flex items-center gap-2 rounded-full bg-[#1F1B16] px-8 py-4 text-sm font-medium tracking-wide text-[var(--paper)] transition-colors duration-300 hover:bg-[#33291E] disabled:cursor-not-allowed disabled:opacity-60">
                      {formStatus === "sending" ? t.contact.btnSending : t.contact.btnSend}
                      {formStatus !== "sending" && <Send className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
                    </button>
                    <p className="micro-caps text-[#1F1B16]/45">{t.contact.reassurance}</p>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER — the Espresso bookend; the Measure terminates in a final tick */}
      <footer className="px-6 sm:px-10 lg:px-16 py-14 md:py-16" style={{ background: "var(--espresso)", color: "var(--paper)" }}>
        <div className="mx-auto max-w-[1400px]">
          <div className="flex items-center gap-3 border-t pt-8" style={{ borderColor: "rgba(201,162,90,0.25)" }}>
            <span aria-hidden="true" className="h-px w-8" style={{ background: "var(--gilt)" }} />
            <span className="micro-caps" style={{ color: "var(--gilt)" }}>Fin — 08</span>
          </div>
          <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="flex items-center gap-3">
              <Image src="/logo-mark.png" alt="Modolo Digital Studio" width={30} height={30} />
              <span className="micro-caps tnum" style={{ color: "rgba(251,248,242,0.55)" }}>© {new Date().getFullYear()} Modolo Digital Studio</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link href={localizedHref(lang, "/impressum")} className="micro-caps transition-colors" style={{ color: "rgba(251,248,242,0.6)" }}>{t.footer.imprint}</Link>
              <Link href={localizedHref(lang, "/privacy")} className="micro-caps transition-colors" style={{ color: "rgba(251,248,242,0.6)" }}>{t.footer.privacy}</Link>
              <a href="https://instagram.com/modolodigitalstudio" target="_blank" rel="noopener noreferrer" aria-label="Instagram" style={{ color: "rgba(251,248,242,0.6)" }}>
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                </svg>
              </a>
              <span className="micro-caps" style={{ color: "var(--gilt)" }}>{t.footer.madeWith}</span>
            </div>
          </div>
        </div>
      </footer>
      <BackToTop label={t.nav.backToTop} />
    </main>
  );
}