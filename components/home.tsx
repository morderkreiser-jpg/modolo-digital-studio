"use client";

import Image from "next/image";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useState, useRef, useEffect } from "react";
import { ArrowRight, Send, CheckCircle2, ExternalLink, AlertCircle, MessageCircle } from "lucide-react";
import SiteNav from "@/components/site-nav";
import BackToTop from "@/components/back-to-top";
import Magnetic from "@/components/magnetic";
import Reveal from "@/components/reveal";
import Marquee from "@/components/marquee";
import HeroShowcase from "@/components/hero-showcase";
import HeroAtmosphere from "@/components/hero-atmosphere";
import { localizedHref, type Locale } from "@/lib/i18n";
import { FAQS } from "@/lib/site-data";
import { SITE, SERVICE_SLUGS } from "@/lib/site";
import { LOCAL_CITIES, LOCAL_AREAS } from "@/lib/local-seo";
import { useRegion, whatsappHref } from "@/components/use-region";

type Lang = Locale;

const translations = {
  en: {
    nav: { services: "Services", pricing: "Pricing", portfolio: "Portfolio", about: "About", faq: "FAQ", contact: "Contact", backToTop: "Back to top" },
    hero: {
      badge: "Digital Studio · Web · Brand · SEO",
      titleLine1: "Design, code and strategy",
      titleAccent: "for brands that want to stand out.",
      subtitle: "SaporiVivi, ZüriKey, BJ Studio: real websites, hand-built in Winterthur, that get found on Google, get chosen over the competition, and turn searchers into customers who book, call and message. I do the same for restaurants, practices, B&Bs and small local shops across Switzerland — and it's always me building it, and always me replying to you.",
      founderIntro: "I'm Francesco Modolo, web designer and developer in Winterthur. I hand-built the sites you see here myself — and I'm the only person you'll ever talk to.",
      trustBand: "Websites from CHF 1,900, at a fixed price we agree before we start. Free first consultation and a reply within 24 hours — always from me.",
      ctaPrimary: "Book a free consultation",
      ctaSecondary: "See my work",
      meta: "Francesco Modolo · Websites, SEO & marketing · Winterthur, serving all of Switzerland",
      line1: "Your website,",
      line2: "that brings you",
      line3: "real customers.",
      accent: "real customers",
      signClosed: "CLOSED",
      signOpen: "OPEN",
      signClosedHours: "Hours  —:—",
      signOpenHours: "Always open for you",
      ctaWhatsapp: "Message me on WhatsApp",
      chips: ["from CHF 1,900 · fixed price, agreed up front", "first consultation free", "one person, not an agency", "I reply personally, within 24h"],
    },
    stats: [
      { value: "4+", label: "Years building websites" },
      { value: "24h", label: "To hear back from me" },
      { value: "Free", label: "Your first consultation" },
      { value: "100%", label: "Made in Switzerland, by me" },
    ],
    servicesSection: { label: "What I do", heading1: "Get you found, ", headingAccent: "and get you chosen.", sub: "I don't stop at a 'nice website': I handle the whole chain that takes a customer from a Google search to messaging you or booking. And I handle it myself, in person.", learnMore: "Learn more", viewPricing: "View pricing" },
    services: [
      { title: "A website that gets you found and gets visitors to act", desc: "I hand-build a fast, clear website that loads in a flash on a phone and shows up on Google when people nearby search for what you offer. Built so that whoever lands on it books, calls or messages, instead of clicking through to your competitor.", tags: ["Web Design", "Development", "Local SEO", "Google Business"] },
      { title: "A look people can trust", desc: "A logo, colours and a consistent look across your website, menu, social media and shop front. So you come across as the serious, well-run business you really are, and people trust you before they've even met you.", tags: ["Branding", "Visual Identity", "Canva Templates"] },
      { title: "Photos, video and words that convince", desc: "Content that shows what you actually do, with no empty phrases. The material that stops your website and social feeds from looking abandoned and starts making people want to give you a try.", tags: ["Photo Shooting", "Social Media", "Project Visibility"] },
      { title: "Emails and messages that bring customers back", desc: "Someone who's already chosen you once is the easiest customer to win back. I set up newsletters and automated emails that remind people you're there — and fill tables, calendars and carts again.", tags: ["Newsletter", "Email Marketing", "Automation"] },
    ],
    portfolioSection: { label: "Portfolio", heading1: "Three real businesses, ", headingAccent: "built by hand", sub: "ZüriKey, the web app for rental dossiers in Zurich; SaporiVivi, an Italian bar and catering business; BJ Studio, a multilingual beauty studio with WhatsApp booking. Three different businesses, three different problems, each handled from start to finish by me.", indexLabel: "Selected work", closingLine: "Every project here was built by hand, from start to finish.", closingCta: "Let's start yours" },
    saporivivi: { tags: ["Complete Website", "Catering & Events", "SEO"], meta: "Complete Website · Catering", outcome: "A bar-catering service that feels online as premium as it tastes live.", desc: "A complete website for a premium Italian bar-catering service: a cinematic home, a clear menu of services and events, all tuned to be found on Google.", cta: "Visit site" },
    zurikey: { tags: ["Web App", "Product Design", "Development"], meta: "Web App · Zürich", outcome: "The Zürich flat hunt, turned into a dossier landlords actually notice.", desc: "A web app that walks renters through a standout application — profile, documents, affordability score and a flawless German cover letter, ready as a print PDF.", cta: "Visit site", alt: "ZüriKey — rental-dossier web app for Zürich" },
    bjstudio: { tags: ["Website", "WhatsApp Booking", "Local SEO"], meta: "Website · Zürich", outcome: "A Zürich beauty studio you book on WhatsApp — in four languages.", desc: "A multilingual website for a beauty studio: direct WhatsApp booking, a before/after gallery and local SEO to get found nearby.", cta: "Visit site", alt: "BJ Studio de Belleza — beauty studio website in Zürich" },
    about: {
      label: "Who's behind it", heading1: "Not an agency — ", headingAccent: "one person: me.",
      p1: "Modolo Digital Studio isn't an agency with a thousand clients and a switchboard. It's me, Francesco. I take on just a few projects at a time and see each one through personally, from the first call to launch day — so yours never ends up at the bottom of a list and never gets 'passed to the tech department': the person answering you is the person building it.",
      p2: "For over four years I've been building websites for businesses all across Switzerland: I write the code, craft the design, sort out the SEO, shoot and edit the photos and video. And I don't stop at 'looks good': to me a website works when it brings you customers, so I think about the goal first and the design second.",
      p3: "Work with me and you always talk to the person who actually builds your site — from the first idea to the day it goes live.",
    },
    founder: {
      eyebrow: "The founder",
      name: "Francesco Modolo",
      role: "Web Designer & Developer",
      bio1: "As a kid I took computers apart and put them back together just to understand how they worked. Today, for over four years, that passion has been my job: I design and hand-build websites for businesses across Switzerland, and I do everything myself — design, code and SEO. With just one obsession: that your website isn't only beautiful, but actually brings you customers.",
      bio2: "I work hands-on across the entire process — from code in VS Code to platforms like WordPress and Elementor, reliable hosting such as SiteGround, video editing in DaVinci Resolve, and SEO and Google strategy. The goal is always the same: combine strong creativity with results that genuinely grow your business.",
    },
    values: [
      { title: "The goal first, the design second", desc: "I don't just make pretty websites: I build tools meant to bring you real customers." },
      { title: "Craftsmanship", desc: "Every project is unique. I look after every detail as if it were my own brand." },
      { title: "Modern technology", desc: "I use the most advanced tools for fast, secure and future-ready websites." },
    ],
    sectorsSection: { label: "Who I work for", heading1: "Made for restaurants, practices, B&Bs and small shops ", headingAccent: "like yours" },
    sectors: ["Restaurants & Hospitality", "Professional Firms", "E-commerce & Retail", "B&B & Accommodation"],
    method: { label: "My method", heading1: "From your first message ", headingAccent: "to your site going live" },
    steps: [
      { num: "01", title: "We talk, free of charge", desc: "A call or a coffee: you tell me about your business, who you want to reach and what isn't working right now. I tell you straight away whether and how I can help, and what it costs. No commitment — that half hour is yours to keep either way." },
      { num: "02", title: "I show you the design", desc: "I turn what you've told me into a tailor-made design, never a recycled template. You see the drafts, you tell me what to change, and we decide together, detail by detail, until it truly feels like yours." },
      { num: "03", title: "You go live, and I stick around", desc: "I build the site with clean, fast code, put it online and get it found on Google. Then I don't disappear: updates, changes and a single person to message whenever you need something." },
    ],
    quote: { line1: "A beautiful website that brings in no customers is just a cost —", line2: "I build websites that pay for themselves." },
    faqSection: { label: "Frequently asked questions", heading1: "Everything you ", headingAccent: "want to know" },
    contact: {
      label: "Let's start", heading1: "Tell me about your business — ", headingAccent: "the first consultation is on me.", headingEnd: "",
      subtitle: "Send me a couple of lines about what you do and what you'd like to achieve online. I'll get back to you within 24 hours, personally, with a clear direction and a sense of the costs — no commitment, and no selling you things you don't need.",
      whatsapp: "Message us on WhatsApp", whatsappMsg: "Hi Francesco, I'd like to talk about a project.",
      emailLabel: "Email", phoneLabel: "Phone", areaLabel: "Area", areaValue: "All of Switzerland", officesLabel: "Offices", countryCh: "Switzerland", countryIt: "Italy",
      formName: "Name", formEmail: "Email", formCompany: "Company", formMessage: "Message",
      phName: "Your name", phEmail: "your@email.com", phCompany: "Company name", phMessage: "Two lines about your project…",
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
      subtitle: "SaporiVivi, ZüriKey, BJ Studio: echte Websites, von Hand gebaut in Winterthur, die auf Google gefunden und der Konkurrenz vorgezogen werden — und aus Suchenden Kunden machen, die reservieren, anrufen und schreiben. Das mache ich für Restaurants, Praxen, B&Bs und kleine Betriebe in der ganzen Schweiz — gebaut und geantwortet wird immer von mir.",
      founderIntro: "Ich bin Francesco Modolo, Webdesigner und Entwickler in Winterthur. Die Websites, die du hier siehst, habe ich selbst von Hand gebaut — und ich bin die einzige Person, mit der du sprichst.",
      trustBand: "Websites ab CHF 1'900, mit Festpreis, den wir vor dem Start festlegen. Erste Beratung gratis und Antwort innert 24 Stunden — immer von mir persönlich.",
      ctaPrimary: "Gratis-Beratung vereinbaren",
      ctaSecondary: "Meine Arbeiten ansehen",
      meta: "Francesco Modolo · Webdesign, SEO & Marketing · Winterthur, für die ganze Schweiz",
      line1: "Deine Website,",
      line2: "die dir",
      line3: "echte Kunden bringt.",
      accent: "echte Kunden",
      signClosed: "GESCHLOSSEN",
      signOpen: "OFFEN",
      signClosedHours: "Öffnungszeiten  —:—",
      signOpenHours: "Immer für dich da",
      ctaWhatsapp: "Schreib mir auf WhatsApp",
      chips: ["ab CHF 1'900 · Fixpreis, vorher vereinbart", "erste Beratung gratis", "eine Person, keine Agentur", "Antwort von mir, innert 24h"],
    },
    stats: [
      { value: "4+", label: "Jahre im Website-Bau" },
      { value: "24h", label: "Antworte ich dir persönlich" },
      { value: "Gratis", label: "Die erste Beratung" },
      { value: "100%", label: "In der Schweiz gemacht, von mir" },
    ],
    servicesSection: { label: "Was ich mache", heading1: "Gefunden werden ", headingAccent: "und gewählt werden.", sub: "Ich höre nicht bei der «schönen Website» auf: Ich begleite die ganze Kette, die einen Kunden von der Google-Suche bis zur Nachricht oder Reservation führt. Und ich begleite sie selbst, persönlich.", learnMore: "Mehr erfahren", viewPricing: "Preise ansehen" },
    services: [
      { title: "Eine Website, die dich auffindbar macht und Besucher zum Handeln bringt", desc: "Ich baue von Hand eine schnelle, klare Website, die auf dem Handy sofort lädt und bei Google auftaucht, wenn jemand in der Umgebung nach dem sucht, was du anbietest. Gemacht, damit die, die ankommen, reservieren, anrufen oder schreiben, statt zur Konkurrenz weiterzuklicken.", tags: ["Webdesign", "Entwicklung", "Lokales SEO", "Google Business"] },
      { title: "Ein Auftritt, dem man vertraut", desc: "Logo, Farben und ein einheitlicher Look auf Website, Menükarte, Social Media und Schaufenster. So wirkst du wie der seriöse, gepflegte Betrieb, der du wirklich bist — und die Leute vertrauen dir, bevor sie dich überhaupt kennen.", tags: ["Branding", "Visuelle Identität", "Canva-Vorlagen"] },
      { title: "Fotos, Videos und Texte, die überzeugen", desc: "Inhalte, die zeigen, was du wirklich machst, ohne leere Floskeln. Das Material, mit dem Website und Social Media nicht mehr verlassen wirken, sondern Lust machen, dich auszuprobieren.", tags: ["Fotoshooting", "Social Media", "Project Visibility"] },
      { title: "E-Mails und Nachrichten, die Kunden zurückbringen", desc: "Wer dich einmal gewählt hat, ist am leichtesten zurückzugewinnen. Ich richte Newsletter und automatische E-Mails ein, die die Leute daran erinnern, dass es dich gibt — und Tische, Terminkalender und Warenkörbe wieder füllen.", tags: ["Newsletter", "E-Mail-Marketing", "Automation"] },
    ],
    portfolioSection: { label: "Portfolio", heading1: "Drei echte Betriebe, ", headingAccent: "von Hand gebaut", sub: "ZüriKey, die Web-App für Mietdossiers in Zürich; SaporiVivi, italienische Bar und Catering; BJ Studio, mehrsprachiges Beauty-Studio mit Reservation über WhatsApp. Drei verschiedene Betriebe, drei verschiedene Probleme, von A bis Z von mir betreut.", indexLabel: "Ausgewählte Arbeiten", closingLine: "Jedes Projekt hier ist von Hand gebaut — von Anfang bis Ende.", closingCta: "Starten wir deins" },
    saporivivi: { tags: ["Komplette Website", "Catering & Events", "SEO"], meta: "Komplette Website · Catering", outcome: "Ein Bar-Catering, das online so edel wirkt wie live am Glas.", desc: "Eine komplette Website für einen Premium-Service für italienisches Bar-Catering: eine cinematische Startseite, ein klares Menü aus Leistungen und Events – auf Google-Sichtbarkeit getrimmt.", cta: "Website besuchen" },
    zurikey: { tags: ["Web App", "Produktdesign", "Entwicklung"], meta: "Web App · Zürich", outcome: "Die Wohnungssuche in Zürich — als Dossier, das Vermieter wirklich beachten.", desc: "Eine Web-App, die Wohnungssuchende Schritt für Schritt zu einem überzeugenden Dossier führt — Profil, Dokumente, Tragbarkeits-Score und ein perfektes Anschreiben auf Deutsch, druckfertig als PDF.", cta: "Website besuchen", alt: "ZüriKey — Mietdossier-Web-App für Zürich" },
    bjstudio: { tags: ["Website", "WhatsApp-Termine", "Lokales SEO"], meta: "Website · Zürich", outcome: "Ein Zürcher Beauty-Studio, das man per WhatsApp bucht — in vier Sprachen.", desc: "Eine mehrsprachige Website für ein Beauty-Studio: direkte Terminbuchung via WhatsApp, Vorher-Nachher-Galerie und lokales SEO, um in der Nähe gefunden zu werden.", cta: "Website besuchen", alt: "BJ Studio de Belleza — Beauty-Studio-Website in Zürich" },
    about: {
      label: "Wer dahintersteckt", heading1: "Keine Agentur — ", headingAccent: "eine Person: ich.",
      p1: "Modolo Digital Studio ist keine Agentur mit tausend Kunden und einer Telefonzentrale. Es bin ich, Francesco. Ich nehme immer nur wenige Projekte auf einmal an und betreue jedes einzeln, vom ersten Telefonat bis zur fertigen Website — so landet deines nicht am Ende einer Liste und wird nicht «an die technische Abteilung weitergereicht»: Wer dir antwortet, ist der, der es baut.",
      p2: "Seit über vier Jahren baue ich Websites für Betriebe in der ganzen Schweiz: Ich schreibe den Code, gestalte das Design, bringe die SEO in Ordnung, drehe und schneide Fotos und Videos. Und ich höre nicht beim «Schön» auf: Für mich funktioniert eine Website dann, wenn sie dir Kunden bringt — also denke ich zuerst ans Ziel und dann ans Design.",
      p3: "Bei mir sprichst du immer mit der Person, die deine Website wirklich baut — von der ersten Idee bis zum Tag, an dem sie online geht.",
    },
    founder: {
      eyebrow: "Der Gründer",
      name: "Francesco Modolo",
      role: "Webdesigner & Entwickler",
      bio1: "Als Junge habe ich Computer auseinander- und wieder zusammengebaut, einfach um zu verstehen, wie sie funktionieren. Heute, seit über vier Jahren, ist diese Leidenschaft mein Beruf: Ich gestalte und baue von Hand Websites für Betriebe in der ganzen Schweiz und mache alles selbst — Design, Code und SEO. Mit nur einer Besessenheit: dass deine Website nicht nur schön ist, sondern dir echte Kunden bringt.",
      bio2: "Ich arbeite über den gesamten Prozess hinweg praktisch mit — von Code in VS Code über Plattformen wie WordPress und Elementor bis zu zuverlässigem Hosting wie SiteGround, Videoschnitt in DaVinci Resolve sowie SEO- und Google-Strategie. Das Ziel ist immer dasselbe: starke Kreativität mit Ergebnissen zu verbinden, die dein Geschäft wirklich wachsen lassen.",
    },
    values: [
      { title: "Zuerst das Ziel, dann das Design", desc: "Ich mache nicht einfach schöne Websites: Ich baue Werkzeuge, die dir echte Kunden bringen." },
      { title: "Handwerkliche Sorgfalt", desc: "Jedes Projekt ist einzigartig. Ich pflege jedes Detail, als wäre es meine eigene Marke." },
      { title: "Moderne Technologie", desc: "Ich nutze modernste Werkzeuge für schnelle, sichere und zukunftsfähige Websites." },
    ],
    sectorsSection: { label: "Für wen ich arbeite", heading1: "Gemacht für Restaurants, Studios, B&Bs und kleine Läden ", headingAccent: "wie deinen" },
    sectors: ["Restaurants & Hospitality", "Kanzleien & Praxen", "E-Commerce & Retail", "B&B & Unterkünfte"],
    method: { label: "Meine Methode", heading1: "Von der ersten Nachricht ", headingAccent: "bis zu deiner Website online" },
    steps: [
      { num: "01", title: "Wir reden, gratis", desc: "Ein Telefonat oder ein Kaffee: Du erzählst mir von deinem Betrieb, wen du erreichen willst und was heute nicht läuft. Ich sage dir gleich, ob und wie ich dir helfen kann und was es kostet. Keine Verpflichtung — die halbe Stunde bleibt dir so oder so." },
      { num: "02", title: "Ich zeige dir den Entwurf", desc: "Ich verwandle das, was du mir gesagt hast, in ein massgeschneidertes Design — nie eine recycelte Vorlage. Du siehst die Entwürfe, sagst mir, was ich ändern soll, und wir entscheiden zusammen Detail für Detail, bis es sich wirklich nach dir anfühlt." },
      { num: "03", title: "Du gehst online, und ich bleibe an deiner Seite", desc: "Ich baue die Website mit sauberem, schnellem Code, bringe sie online und sorge dafür, dass sie bei Google gefunden wird. Danach verschwinde ich nicht: Updates, Änderungen und eine einzige Person, der du schreibst, wenn du etwas brauchst." },
    ],
    quote: { line1: "Eine schöne Website, die keine Kunden bringt, kostet dich nur Geld —", line2: "ich baue Websites, die sich bezahlt machen." },
    faqSection: { label: "Häufige Fragen", heading1: "Alles, was du ", headingAccent: "wissen möchtest" },
    contact: {
      label: "Los geht's", heading1: "Erzähl mir von deinem Betrieb — ", headingAccent: "die erste Beratung geht auf mich.", headingEnd: "",
      subtitle: "Schreib mir zwei Zeilen dazu, was du machst und was du online erreichen möchtest. Ich antworte dir innert 24 Stunden, persönlich, mit einer klaren Richtung und einer Vorstellung der Kosten — unverbindlich und ohne dir Dinge zu verkaufen, die du nicht brauchst.",
      whatsapp: "Schreib uns auf WhatsApp", whatsappMsg: "Hallo Francesco, ich möchte über ein Projekt sprechen.",
      emailLabel: "E-Mail", phoneLabel: "Telefon", areaLabel: "Gebiet", areaValue: "Ganze Schweiz", officesLabel: "Standorte", countryCh: "Schweiz", countryIt: "Italien",
      formName: "Name", formEmail: "E-Mail", formCompany: "Unternehmen", formMessage: "Nachricht",
      phName: "Dein Name", phEmail: "deine@email.com", phCompany: "Firmenname", phMessage: "Zwei Zeilen zu deinem Projekt…",
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
      subtitle: "SaporiVivi, ZüriKey, BJ Studio: siti veri, fatti a mano a Winterthur, che su Google si fanno trovare e scegliere al posto del concorrente — e trasformano chi cerca in clienti che prenotano, chiamano e scrivono. Lo faccio per ristoranti, studi, B&B e piccole attività in tutta la Svizzera — a costruirlo, e a risponderti, ci sono sempre io.",
      founderIntro: "Sono Francesco Modolo, web designer e sviluppatore a Winterthur. I siti che vedi li ho costruiti io, a mano — e sono l'unica persona con cui parlerai.",
      trustBand: "Siti da CHF 1'900, prezzo fisso deciso prima di iniziare. Prima consulenza gratuita e risposta entro 24 ore, sempre da me.",
      ctaPrimary: "Prenota una consulenza gratuita",
      ctaSecondary: "Guarda i miei lavori",
      meta: "Francesco Modolo · Siti, SEO e marketing · Winterthur, per tutta la Svizzera",
      line1: "Il tuo sito,",
      line2: "che ti porta",
      line3: "clienti veri.",
      accent: "clienti veri",
      signClosed: "CHIUSO",
      signOpen: "APERTO",
      signClosedHours: "Orari  —:—",
      signOpenHours: "Sempre aperto per te",
      ctaWhatsapp: "Scrivimi su WhatsApp",
      chips: ["da CHF 1'900 · prezzo fisso, deciso prima", "prima consulenza gratis", "una persona sola, non un'agenzia", "rispondo io, entro 24h"],
    },
    stats: [
      { value: "4+", label: "Anni a costruire siti" },
      { value: "24h", label: "Ti rispondo io entro" },
      { value: "Gratis", label: "La prima consulenza" },
      { value: "100%", label: "Fatto in Svizzera, da me" },
    ],
    servicesSection: { label: "Cosa faccio", heading1: "Farti trovare, ", headingAccent: "e farti scegliere.", sub: "Non mi fermo al «bel sito»: seguo tutta la catena che porta un cliente dalla ricerca su Google fino a scriverti o prenotare. E la seguo io, di persona.", learnMore: "Scopri di più", viewPricing: "Vedi i prezzi" },
    services: [
      { title: "Un sito che ti fa trovare e fa agire chi arriva", desc: "Costruisco a mano un sito veloce e chiaro, che si carica al volo dal telefono e compare su Google quando in zona cercano quello che offri. Pensato perché chi arriva prenoti, chiami o scriva, invece di andarsene dal concorrente.", tags: ["Web Design", "Sviluppo", "SEO Locale", "Google Business"] },
      { title: "Un'immagine di cui fidarsi", desc: "Logo, colori e un look coerente su sito, menù, social e vetrina. Così sembri l'attività seria e curata che sei davvero, e le persone si fidano di te prima ancora di conoscerti.", tags: ["Branding", "Identità Visiva", "Template Canva"] },
      { title: "Foto, video e testi che convincono", desc: "Contenuti che raccontano cosa fai davvero, senza frasi vuote. Il materiale con cui sito e social smettono di sembrare abbandonati e iniziano a far venire voglia di provarti.", tags: ["Shooting", "Social Media", "Project Visibility"] },
      { title: "Email e messaggi che riportano i clienti", desc: "Chi ti ha già scelto una volta è il cliente più facile da far tornare. Imposto newsletter ed email automatiche che ricordano alla gente che ci sei — e riempiono di nuovo tavoli, agende e carrelli.", tags: ["Newsletter", "Email Marketing", "Automation"] },
    ],
    portfolioSection: { label: "Portfolio", heading1: "Tre attività vere, ", headingAccent: "costruite a mano", sub: "ZüriKey, la web app per i dossier d'affitto a Zurigo; SaporiVivi, bar e catering italiano; BJ Studio, studio di bellezza multilingua con prenotazione via WhatsApp. Tre attività diverse, tre problemi diversi, seguite dall'inizio alla fine da me.", indexLabel: "Lavori selezionati", closingLine: "Ogni progetto qui è stato costruito a mano, dall'inizio alla fine.", closingCta: "Iniziamo il tuo" },
    saporivivi: { tags: ["Sito Web Completo", "Catering & Eventi", "SEO"], meta: "Sito Web Completo · Catering", outcome: "Un bar catering che online trasmette la stessa classe che serve nel bicchiere.", desc: "Sito completo per un servizio di bar catering italiano premium: home cinematografica, menu di servizi ed eventi, tutto ottimizzato per farsi trovare su Google.", cta: "Visita il sito" },
    zurikey: { tags: ["Web App", "Product Design", "Sviluppo"], meta: "Web App · Zurigo", outcome: "La ricerca casa a Zurigo, trasformata in un dossier che i proprietari notano.", desc: "Web app che guida chi cerca casa a costruire una candidatura impeccabile: profilo, documenti, punteggio di sostenibilità e lettera in tedesco, pronti in PDF.", cta: "Visita il sito", alt: "ZüriKey — web app per il dossier d'affitto a Zurigo" },
    bjstudio: { tags: ["Sito Web", "Prenotazioni WhatsApp", "SEO Locale"], meta: "Sito Web · Zurigo", outcome: "Uno studio beauty di Zurigo che si prenota su WhatsApp, in quattro lingue.", desc: "Sito multilingua per uno studio beauty: prenotazione diretta via WhatsApp, galleria prima/dopo e SEO locale per farsi trovare in zona.", cta: "Visita il sito", alt: "BJ Studio de Belleza — sito per uno studio beauty a Zurigo" },
    about: {
      label: "Chi c'è dietro", heading1: "Non un'agenzia — ", headingAccent: "una persona: io.",
      p1: "Modolo Digital Studio non è un'agenzia con mille clienti e un centralino. Sono io, Francesco. Prendo pochi progetti alla volta e li seguo uno per uno, dalla prima chiamata al sito online — così il tuo non finisce in fondo a una lista e non lo «giro all'ufficio tecnico»: chi ti risponde è chi lo sta costruendo.",
      p2: "Da oltre quattro anni costruisco siti per attività in tutta la Svizzera: scrivo il codice, curo il design, sistemo la SEO, giro e monto foto e video. E non mi fermo al «bello»: per me un sito funziona quando ti porta clienti, quindi ragiono prima sull'obiettivo e poi sul design.",
      p3: "Lavorando con me parli sempre con chi il tuo sito lo costruisce davvero — dalla prima idea al giorno in cui va online.",
    },
    founder: {
      eyebrow: "Il fondatore",
      name: "Francesco Modolo",
      role: "Web Designer & Sviluppatore",
      bio1: "Da ragazzino smontavo e rimontavo computer per il gusto di capire come funzionavano. Oggi, da oltre quattro anni, quella passione è il mio lavoro: progetto e costruisco a mano siti per attività in tutta la Svizzera, e seguo tutto io — design, codice e SEO. Con un'ossessione sola: che il tuo sito non sia solo bello, ma ti porti clienti veri.",
      bio2: "Seguo l'intero processo in prima persona — dal codice in VS Code alle piattaforme come WordPress ed Elementor, fino a hosting affidabili come SiteGround, al montaggio video in DaVinci Resolve e alla strategia SEO e Google. L'obiettivo è sempre lo stesso: unire una forte creatività a risultati che fanno davvero crescere il tuo business.",
    },
    values: [
      { title: "Prima l'obiettivo, poi il design", desc: "Non faccio siti belli e basta: costruisco strumenti pensati per portarti clienti veri." },
      { title: "Cura artigianale", desc: "Ogni progetto è unico. Curo ogni dettaglio come fosse il mio stesso brand." },
      { title: "Tecnologia moderna", desc: "Uso gli strumenti più avanzati per siti veloci, sicuri e pronti per il futuro." },
    ],
    sectorsSection: { label: "Per chi lavoro", heading1: "Fatto per ristoranti, studi, B&B e piccoli negozi ", headingAccent: "come il tuo" },
    sectors: ["Ristoranti & Hospitality", "Studi Professionali", "E-commerce & Retail", "B&B & Strutture Ricettive"],
    method: { label: "Il mio metodo", heading1: "Dal primo messaggio ", headingAccent: "al tuo sito online" },
    steps: [
      { num: "01", title: "Parliamo, gratis", desc: "Una chiamata o un caffè: mi racconti la tua attività, chi vuoi raggiungere e cosa oggi non funziona. Ti dico subito se e come posso aiutarti, e quanto costa. Nessun impegno — quella mezz'ora te la tieni comunque." },
      { num: "02", title: "Ti mostro il progetto", desc: "Trasformo quello che mi hai detto in un design su misura, mai un template riciclato. Vedi le bozze, mi dici cosa cambiare, decidiamo insieme dettaglio per dettaglio finché non lo senti davvero tuo." },
      { num: "03", title: "Vai online e ti resto accanto", desc: "Costruisco il sito con codice pulito e veloce, lo metto online e lo faccio trovare su Google. Poi non sparisco: aggiornamenti, modifiche e una sola persona a cui scrivere quando ti serve qualcosa." },
    ],
    quote: { line1: "Un sito bello che non porta clienti è un costo —", line2: "io costruisco siti che si ripagano." },
    faqSection: { label: "Domande frequenti", heading1: "Tutto quello che ", headingAccent: "vuoi sapere" },
    contact: {
      label: "Iniziamo", heading1: "Raccontami la tua attività — ", headingAccent: "la prima consulenza la offro io.", headingEnd: "",
      subtitle: "Scrivimi due righe su cosa fai e cosa vorresti ottenere online. Ti rispondo io entro 24 ore, di persona, con una direzione chiara e un'idea dei costi — senza impegno e senza venderti cose che non ti servono.",
      whatsapp: "Scrivici su WhatsApp", whatsappMsg: "Ciao Francesco, vorrei parlare di un progetto.",
      emailLabel: "Email", phoneLabel: "Telefono", areaLabel: "Area", areaValue: "Tutta la Svizzera", officesLabel: "Sedi", countryCh: "Svizzera", countryIt: "Italia",
      formName: "Nome", formEmail: "Email", formCompany: "Azienda", formMessage: "Messaggio",
      phName: "Il tuo nome", phEmail: "la-tua@email.com", phCompany: "Nome azienda", phMessage: "Due righe sul tuo progetto…",
      needsLabel: "Di cosa hai bisogno?", needs: ["Sito web", "Brand & logo", "Contenuti & social", "Email marketing", "Altro"], optional: "facoltativo", reassurance: "Risposta entro 24h · Senza impegno",
      btnSend: "Richiedi la consulenza gratuita", btnSending: "Invio in corso...",
      successTitle: "Messaggio inviato!", successDesc: "Grazie per averci scritto. Ti risponderemo entro 24 ore.",
      error: "Si è verificato un errore. Riprova o scrivici direttamente via email.",
      errName: "Inserisci il tuo nome.",
      errEmailRequired: "Inserisci la tua email.",
      errEmailInvalid: "Inserisci un indirizzo email valido.",
      errMessage: "Inserisci un messaggio.",
    },
    footer: { madeWith: "Fatto con cura in Svizzera", imprint: "Note legali", privacy: "Privacy" },
  },
};

const DISCIPLINES = ["Websites", "Branding", "Content", "Foto", "Video", "Reels", "Social", "SEO", "Ads"];

export default function Home({ lang }: { lang: Lang }) {
  const [formStatus, setFormStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const reduce = useReducedMotion();
  const successRef = useRef<HTMLDivElement>(null);
  const t = translations[lang];
  // Wrap the gold accent phrase within a headline line, wherever it falls.
  const heroGold = (line: string) => {
    const a = t.hero.accent;
    const i = a ? line.indexOf(a) : -1;
    if (i < 0) return line;
    return (<>{line.slice(0, i)}<span className="gold-grad">{a}</span>{line.slice(i + a.length)}</>);
  };
  const region = useRegion();
  const whatsapp = whatsappHref(region, SITE.phone, SITE.phoneIt, t.contact.whatsappMsg);

  // Portfolio as a curated monograph — real, borderless site captures.
  const PROJECTS = [
    { num: "01", name: "ZüriKey", href: "https://zurikey.ch", data: t.zurikey,
      media: { kind: "video" as const, src: "/portfolio-zurikey.mp4", poster: "/portfolio-zurikey-poster.webp", aria: t.zurikey.alt } },
    { num: "02", name: "SaporiVivi", href: "https://saporivivi.ch", data: t.saporivivi,
      media: { kind: "video" as const, src: "/portfolio-saporivivi-v4.mp4", poster: "/portfolio-saporivivi-v4-poster.webp", aria: "SaporiVivi — Italian luxury bar catering website" } },
    { num: "03", name: "BJ Studio", href: "https://bjstudiodebelleza.ch", data: t.bjstudio,
      media: { kind: "image" as const, src: "/portfolio-bjstudio-poster.webp", aria: t.bjstudio.alt } },
  ];

  // Hero proof — the real client sites shown live in the browser frame (SaporiVivi first: the
  // restaurant is the most relatable to the core audience, and the static/mobile frame).
  const SHOWCASE = [
    { name: "SaporiVivi", host: "saporivivi.ch", poster: "/portfolio-saporivivi-hero.webp", href: "https://saporivivi.ch", caption: t.saporivivi.meta },
    { name: "ZüriKey", host: "zurikey.ch", poster: "/portfolio-zurikey-poster.webp", href: "https://zurikey.ch", caption: t.zurikey.meta },
    { name: "BJ Studio", host: "bjstudiodebelleza.ch", poster: "/portfolio-bjstudio-poster.webp", href: "https://bjstudiodebelleza.ch", caption: t.bjstudio.meta },
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
    <main id="main" tabIndex={-1} className="relative min-h-screen overflow-x-hidden bg-[var(--ink-bg)] text-[var(--ink-text)] outline-none">
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
        theme="light"
      />

      {/* analog grain over the dark field */}
      <div className="mds-grain" aria-hidden />

      {/* HERO — proof-first: the offer on the left, real client sites shown live on the right */}
      <section className="relative flex min-h-svh items-center overflow-hidden px-6 sm:px-10 lg:px-16 pt-32 pb-20">
        <div aria-hidden className="pointer-events-none absolute inset-0" style={{ background: "radial-gradient(52% 56% at 84% 50%, rgba(201,153,47,0.10), transparent 72%)" }} />
        <HeroAtmosphere />

        <div className="relative z-10 mx-auto grid w-full max-w-[1400px] items-center gap-12 md:grid-cols-[1.05fr_0.95fr] lg:gap-16">
          {/* LEFT — the offer */}
          <div>
            <div className="mb-7 flex items-center gap-3 mds-in" style={{ animationDelay: "0.05s" }}>
              <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: "#b5893f" }} />
              {/* Break only at the "·" separators, never inside a segment, so no 1–2 words
                  ever wrap alone (e.g. "…la Svizzera" on its own line). */}
              <span className="micro-caps text-[#17130e]/55">
                {t.hero.meta.split(" · ").flatMap((seg, i) =>
                  i === 0
                    ? [<span key={`m${i}`} className="whitespace-nowrap">{seg}</span>]
                    : [<span key={`sp${i}`}>{" "}</span>, <span key={`m${i}`} className="whitespace-nowrap">· {seg}</span>]
                )}
              </span>
            </div>

            <h1 className="display-space text-[#17130e] mds-in" style={{ fontSize: "clamp(2.4rem, 5.2vw, 4.6rem)", animationDelay: "0.12s" }}>
              {heroGold(t.hero.line1)}<br />{heroGold(t.hero.line2)}<br />{heroGold(t.hero.line3)}
            </h1>

            <p className="mds-in mt-7 max-w-xl text-base font-light leading-relaxed text-[#17130e]/62 sm:text-lg" style={{ animationDelay: "0.32s" }}>{t.hero.subtitle}</p>

            <div className="mds-in mt-6 flex items-center gap-3" style={{ animationDelay: "0.42s" }}>
              <span className="relative h-12 w-12 shrink-0 overflow-hidden rounded-full ring-1 ring-[#17130e]/10 shadow-[0_3px_12px_-4px_rgba(23,19,14,0.4)]" style={{ background: "#e8dec9" }}>
                <Image src="/founder-avatar.webp" alt="Francesco Modolo" fill sizes="48px" className="object-cover" />
              </span>
              <span className="text-sm font-light leading-snug text-[var(--gilt)]">{t.hero.founderIntro}</span>
            </div>

            <div className="mds-in mt-8 flex flex-wrap items-center gap-x-6 gap-y-4" style={{ animationDelay: "0.5s" }}>
              <Magnetic strength={0.4}>
                <a href="#contatti" className="gold-glow group inline-flex items-center gap-2 rounded-full px-8 py-4 text-sm font-semibold text-[#17130E] transition-transform duration-300 hover:scale-[1.03]" style={{ background: "linear-gradient(100deg, #e8c877, #b5893f)", fontFamily: "var(--font-space)" }}>
                  {t.hero.ctaPrimary}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </a>
              </Magnetic>
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-2 text-sm tracking-wide text-[#17130e]/70 transition-colors hover:text-[#17130e]">
                <MessageCircle className="h-4 w-4 text-[var(--gilt)]" strokeWidth={1.6} />
                {t.hero.ctaWhatsapp}
              </a>
            </div>

            <div className="mds-in mt-8 flex flex-wrap gap-x-5 gap-y-2.5 border-t border-[color:var(--gold-line)] pt-6" style={{ animationDelay: "0.58s" }}>
              {t.hero.chips.map((c) => (
                <span key={c} className="inline-flex items-center gap-1.5 text-xs font-medium tracking-wide text-[#17130e]/70">
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--gilt)]" strokeWidth={2} />
                  {c}
                </span>
              ))}
            </div>
          </div>

          {/* RIGHT — the proof: real client sites, live */}
          <div className="flex justify-center md:justify-end">
            <HeroShowcase items={SHOWCASE} />
          </div>
        </div>
      </section>

      {/* DISCIPLINE MARQUEE — Fraunces ticker, coupled to Lenis scroll velocity */}
      <Marquee items={DISCIPLINES} />

      {/* STATS — editorial data row on Bone; tabular figures, hairline dividers, no icon boxes */}
      <section className="bg-[var(--ink-panel)] px-6 sm:px-10 lg:px-16 py-14 md:py-20">
        <div className="mx-auto max-w-[1400px]">
          <div className="grid grid-cols-2 md:grid-cols-4">
            {t.stats.map((stat, i) => (
              <motion.div
                key={i}
                initial={reduce ? false : { opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className={`py-4 md:px-8 ${i % 2 === 1 ? "border-l border-[color:var(--gold-line)] pl-5" : ""} ${i >= 2 ? "mt-6 md:mt-0" : ""} ${i === 2 ? "md:border-l md:pl-8" : ""}${i === 0 ? " md:pl-0" : ""}${i === t.stats.length - 1 ? " md:pr-0" : ""}`}
              >
                <div className="display-space tnum text-[#17130e]" style={{ fontSize: "clamp(2rem, 4.5vw, 3.25rem)" }}>{stat.value}</div>
                <div className="micro-caps mt-2.5 text-[#17130e]/55">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* SERVIZI — numbered index table (Klim/Order register), not cards */}
      <section id="servizi" className="bg-[var(--ink-bg)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
        <div className="mx-auto max-w-[1400px]">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: 0.7 }}
            className="mb-12 flex flex-col gap-6 md:mb-16 md:flex-row md:items-end md:justify-between"
          >
            <div>
              <span className="micro-caps text-[var(--gilt)]">01 · {t.servicesSection.label}</span>
              <h2 className="display-space mt-4 text-[#17130e]" style={{ fontSize: "clamp(2.25rem, 5.5vw, 4.5rem)" }}>
                {t.servicesSection.heading1}<em className="text-[var(--color-gold)]">{t.servicesSection.headingAccent}</em>
              </h2>
              <p className="mt-6 max-w-2xl text-base font-light leading-relaxed text-[#17130e]/60 md:text-lg">{t.servicesSection.sub}</p>
            </div>
            <span className="micro-caps tnum text-[#17130e]/40">01 / 04</span>
          </motion.div>

          <div className="border-b border-[color:var(--gold-line)]">
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
                  className="group flex flex-col gap-3 border-t border-[color:var(--gold-line)] py-6 transition-colors hover:bg-[var(--ink-panel)]/40 md:flex-row md:items-baseline md:gap-8 md:px-2 md:py-8"
                >
                  <span className="micro-caps tnum text-[var(--gilt)] md:w-10">0{i + 1}</span>
                  <h3 className="display-space text-[#17130e] transition-colors duration-300 group-hover:text-[var(--gilt)] md:flex-1" style={{ fontSize: "clamp(1.6rem, 3.4vw, 2.75rem)" }}>{service.title}</h3>
                  <div className="micro-caps flex flex-wrap gap-y-1 text-[#17130e]/65 md:max-w-[18rem] md:justify-end md:text-right">
                    {service.tags.map((tag, ti) => (
                      <span key={tag} className="inline-flex items-center">
                        {tag}
                        {ti < service.tags.length - 1 && <span aria-hidden="true" className="mx-2.5 text-[var(--color-gold)]/50">·</span>}
                      </span>
                    ))}
                  </div>
                  <ArrowRight className="hidden h-5 w-5 shrink-0 text-[var(--gilt)] transition-transform duration-300 group-hover:translate-x-1 md:block" strokeWidth={1.4} />
                </Link>
              </motion.div>
            ))}
          </div>

          <div className="mt-10">
            <Link href={localizedHref(lang, "/prezzi")} className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]">
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
      <section id="portfolio" className="bg-[var(--ink-bg)] px-6 sm:px-10 lg:px-16 py-24 md:py-36">
        <div className="mx-auto max-w-[1400px]">
          <Reveal className="mb-14 flex flex-col gap-6 md:mb-20 md:flex-row md:items-end md:justify-between">
            <div>
              <span data-reveal-fade className="micro-caps inline-block text-[var(--gilt)]">02 · {t.portfolioSection.label}</span>
              <h2 data-reveal-heading className="display-space mt-4 text-[#17130e]" style={{ fontSize: "clamp(2.25rem, 5.5vw, 4.5rem)" }}>
                {t.portfolioSection.heading1}<em className="text-[var(--color-gold)]">{t.portfolioSection.headingAccent}</em>
              </h2>
              <p data-reveal-fade className="mt-6 max-w-2xl text-base font-light leading-relaxed text-[#17130e]/60">{t.portfolioSection.sub}</p>
            </div>
            <span data-reveal-fade className="micro-caps tnum inline-block text-[#17130e]/40">{t.portfolioSection.indexLabel} — 01 / 03</span>
          </Reveal>

          <div className="space-y-24 md:space-y-36">
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
                className="group block border-t border-[var(--color-gold)]/25 pt-8 md:pt-10"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <div className="flex items-baseline gap-4 md:gap-7">
                    <span aria-hidden="true" className="display-italic leading-none text-[var(--color-gold)]" style={{ fontSize: "clamp(1.5rem, 3vw, 2.75rem)" }}>{p.num}</span>
                    <h3 className="display-space leading-none text-[#17130e]" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>{p.name}</h3>
                  </div>
                  <span className="micro-caps hidden text-[var(--gilt)] sm:block">{p.data.meta}</span>
                </div>

                {/* the cinematic hook — the one line that sells the project */}
                <p className="display-space mt-5 max-w-3xl text-[#17130e] md:mt-7" style={{ fontSize: "clamp(1.3rem, 2.8vw, 2.2rem)", lineHeight: 1.16 }}>{p.data.outcome}</p>

                <div className="relative mt-8 aspect-[1280/674] overflow-hidden rounded-[4px] bg-[#17130E] md:mt-10">
                  {p.media.kind === "video" ? (
                    <video src={p.media.src} poster={p.media.poster} autoPlay muted loop playsInline preload="metadata" aria-label={p.media.aria} className={`absolute inset-0 h-full w-full object-cover ${reduce ? "" : "transition-transform duration-[1200ms] ease-out group-hover:scale-[1.045]"}`} />
                  ) : (
                    <Image src={p.media.src} alt={p.media.aria} fill sizes="(max-width: 1024px) 100vw, 1300px" className={`object-cover object-top ${reduce ? "" : "transition-transform duration-[1200ms] ease-out group-hover:scale-[1.045]"}`} />
                  )}
                  <span className="pointer-events-none absolute bottom-4 right-4 flex translate-y-2 items-center gap-2 rounded-full px-4 py-2 text-sm tracking-wide text-[#17130e] opacity-0 backdrop-blur transition-all duration-300 group-hover:translate-y-0 group-hover:opacity-100" style={{ background: "rgba(31,27,22,0.94)" }}>
                    {p.data.cta} <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.6} />
                  </span>
                </div>

                <div className="mt-7 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                  <p className="max-w-lg text-sm font-light leading-relaxed text-[#17130e]/60">{p.data.desc}</p>
                  <div className="flex flex-col items-start gap-3 md:items-end">
                    <div className="micro-caps flex flex-wrap gap-y-1 text-[#17130e]/60">
                      {p.data.tags.map((tag, ti) => (
                        <span key={ti} className="inline-flex items-center">
                          <span className={ti === 0 ? "text-[var(--gilt)]" : ""}>{tag}</span>
                          {ti < p.data.tags.length - 1 && <span aria-hidden="true" className="mx-2.5 text-[var(--color-gold)]/50">·</span>}
                        </span>
                      ))}
                    </div>
                    <span className="inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors group-hover:text-[var(--color-gold)]">
                      {p.data.cta}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={1.6} />
                    </span>
                  </div>
                </div>
              </motion.a>
            ))}
          </div>

          {/* Closing bookend — routes intent to contact */}
          <motion.div initial={reduce ? false : { opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.6 }} className="mt-20 border-t border-[color:var(--gold-line)] pt-10">
            <p className="max-w-xl font-light text-[#17130e]/60">{t.portfolioSection.closingLine}</p>
            <a href="#contatti" className="group mt-4 inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]">
              <span>{t.portfolioSection.closingCta}</span>
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </a>
          </motion.div>
        </div>
      </section>

      {/* CHI SIAMO — the ESPRESSO Night room: the one dark surface, the emotional peak */}
      <section id="chi-siamo" className="px-6 sm:px-10 lg:px-16 py-24 md:py-36" style={{ background: "var(--ink-panel)", color: "#17130e" }}>
        <div className="mx-auto max-w-[1400px]">
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-12%" }}
            transition={{ duration: 0.7 }}
            className="mb-14 max-w-3xl md:mb-20"
          >
            <span className="micro-caps" style={{ color: "var(--gilt)" }}>03 · {t.about.label}</span>
            <h2 className="display-space mt-5" style={{ fontSize: "clamp(2.25rem, 5.5vw, 4.5rem)", color: "#17130e" }}>
              {t.about.heading1}<em style={{ color: "var(--gilt)" }}>{t.about.headingAccent}</em>
            </h2>
            <p className="mt-6 text-lg font-light leading-relaxed" style={{ color: "rgba(31,27,22,0.68)" }}>{t.about.p1}</p>
          </motion.div>

          <div className="grid gap-10 mds-split-4-8">
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.8 }}
              className="min-w-0"
            >
              <div className="relative aspect-[4/5] overflow-hidden rounded-[4px]" style={{ background: "linear-gradient(to bottom, #241d14, #17130e)" }}>
                <Image src="/founder-2.webp" alt="Francesco Modolo — Fondatore di Modolo Digital Studio" fill sizes="(max-width: 768px) 100vw, 33vw" className="object-contain object-bottom" />
              </div>
              <div className="mt-5 flex items-baseline justify-between border-t pt-4" style={{ borderColor: "rgba(201,162,90,0.3)" }}>
                <span className="display-space text-lg" style={{ color: "#17130e" }}>{t.founder.name}</span>
                <span className="micro-caps" style={{ color: "var(--gilt)" }}>{t.founder.eyebrow}</span>
              </div>
              <div className="micro-caps mt-2" style={{ color: "rgba(31,27,22,0.48)" }}>{t.founder.role}</div>
            </motion.div>

            <motion.div
              initial={reduce ? false : { opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-10%" }}
              transition={{ duration: 0.8, delay: 0.1 }}
              className="min-w-0"
            >
              <p className="text-lg font-light leading-relaxed" style={{ color: "rgba(31,27,22,0.72)" }}>{t.founder.bio1}</p>

              <p className="display-space mt-10" style={{ fontSize: "clamp(1.4rem, 2.6vw, 2.1rem)", lineHeight: 1.3, color: "#17130e" }}>{t.about.p3}</p>

              <a href="#contatti" className="group mt-10 inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]">
                {t.hero.ctaPrimary}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" strokeWidth={1.6} />
              </a>
            </motion.div>
          </div>
        </div>
      </section>

      {/* SETTORI — ticked index of sectors, no icon-cards */}
      <section className="bg-[var(--ink-panel)] px-6 sm:px-10 lg:px-16 py-20 md:py-28">
        <div className="mx-auto max-w-[1400px]">
          <div className="mb-10 md:mb-12">
            <span className="micro-caps text-[var(--gilt)]">04 · {t.sectorsSection.label}</span>
            <h2 className="display-space mt-3 text-[#17130e]" style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)" }}>
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
                className="flex items-baseline gap-4 border-t border-[color:var(--gold-line-strong)] py-5"
              >
                <span className="micro-caps tnum text-[var(--gilt)]">0{i + 1}</span>
                <span className="text-lg font-light text-[#17130e]/80">{name}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* METODO — three phases as ticked stations measured by the ruler */}
      <section id="metodo" className="bg-[var(--ink-bg)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
        <div className="mx-auto max-w-[1400px]">
          <div className="mb-16 md:mb-24">
            <span className="micro-caps text-[var(--gilt)]">05 · {t.method.label}</span>
            <h2 className="display-space mt-4 text-[#17130e]" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
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
                  <span aria-hidden="true" className="display-italic leading-none text-[var(--color-gold)]" style={{ fontSize: "clamp(1.1rem, 2.5vw, 2rem)" }}>{step.num}</span>
                  <h3 className="display-space text-[#17130e]" style={{ fontSize: "clamp(1.5rem, 3vw, 2.25rem)" }}>{step.title}</h3>
                </div>
                <p className="mt-4 font-light leading-relaxed text-[#17130e]/65">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* QUOTE — large Fraunces pull-quote, pure type */}
      <section className="bg-[var(--ink-panel)] px-6 sm:px-10 lg:px-16 py-28 md:py-40">
        <motion.blockquote
          initial={reduce ? false : { opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: 0.8 }}
          className="mx-auto max-w-[1100px]"
        >
          <span className="mb-8 block h-px w-16 bg-[var(--color-gold)]" aria-hidden="true" />
          <p className="display-space text-[#17130e]" style={{ fontSize: "clamp(1.75rem, 4.4vw, 3.5rem)", lineHeight: 1.16 }}>
            {t.quote.line1} <em className="text-[var(--color-gold)]">{t.quote.line2}</em>
          </p>
        </motion.blockquote>
      </section>

      {/* FAQ — hairline-divided index accordion */}
      <section id="faq" className="bg-[var(--ink-bg)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
        <div className="mx-auto max-w-[920px]">
          <header className="mb-12 md:mb-16">
            <span className="micro-caps text-[var(--gilt)]">06 · {t.faqSection.label}</span>
            <h2 className="display-space mt-4 text-[#17130e]" style={{ fontSize: "clamp(2rem, 5vw, 4rem)" }}>
              {t.faqSection.heading1}<em className="text-[var(--color-gold)]">{t.faqSection.headingAccent}</em>
            </h2>
          </header>

          <div className="border-b border-[color:var(--gold-line)]">
            {FAQS[lang].map((faq, i) => {
              const isOpen = openFaq === i;
              return (
                <div key={i} className="border-t border-[color:var(--gold-line)]">
                  <h3>
                    <button type="button" id={`faq-q-${i}`} aria-expanded={isOpen} aria-controls={`faq-a-${i}`} onClick={() => setOpenFaq(isOpen ? null : i)} className="group flex w-full items-start justify-between gap-6 py-6 text-left">
                      <span className="text-lg font-light text-[#17130e] transition-colors group-hover:text-[var(--gilt)] md:text-xl">{faq.q}</span>
                      <span aria-hidden="true" className="relative mt-[7px] block h-3.5 w-3.5 shrink-0">
                        <span className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2" style={{ background: "var(--color-gold-ink)" }} />
                        <span className={`absolute left-1/2 top-0 h-full w-px -translate-x-1/2 transition-transform duration-300 ${isOpen ? "scale-y-0" : "scale-y-100"}`} style={{ background: "var(--color-gold-ink)" }} />
                      </span>
                    </button>
                  </h3>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div id={`faq-a-${i}`} role="region" aria-labelledby={`faq-q-${i}`} initial={reduce ? false : { height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }} transition={{ duration: reduce ? 0 : 0.3, ease: "easeInOut" }}>
                        <p className="max-w-2xl pb-7 pr-8 font-light leading-relaxed text-[#17130e]/65">{faq.a}</p>
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
      <section id="contatti" className="bg-[var(--ink-bg)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
        <div className="mx-auto max-w-[1400px]">
          <motion.div initial={reduce ? false : { opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-12%" }} transition={{ duration: 0.7 }} className="mb-14 max-w-3xl md:mb-20">
            <span className="micro-caps text-[var(--gilt)]">07 · {t.contact.label}</span>
            <h2 className="display-space mt-4 text-[#17130e]" style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)" }}>
              {t.contact.heading1}<em className="text-[var(--color-gold)]">{t.contact.headingAccent}</em>{t.contact.headingEnd}
            </h2>
            <p className="mt-6 max-w-2xl text-lg font-light leading-relaxed text-[#17130e]/70">{t.contact.subtitle}</p>
          </motion.div>

          <div className="grid gap-12 mds-split-5-7">
            <div className="min-w-0">
              <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-3 text-[#17130e] transition-colors hover:text-[var(--gilt)]">
                <MessageCircle className="h-5 w-5 text-[var(--gilt)]" strokeWidth={1.5} />
                <span className="relative text-base tracking-wide">
                  {t.contact.whatsapp}
                  <span className="absolute -bottom-1 left-0 h-px w-full origin-left scale-x-0 bg-[var(--color-gold)]/60 transition-transform duration-300 group-hover:scale-x-100" />
                </span>
              </a>

              <dl className="mt-10 space-y-7 border-t border-[color:var(--gold-line)] pt-8">
                <div>
                  <dt className="micro-caps text-[#17130e]/70">{t.contact.emailLabel}</dt>
                  <dd className="mt-1"><a href={`mailto:${SITE.email}`} className="text-[#17130e]/85 transition-colors hover:text-[var(--gilt)]">{SITE.email}</a></dd>
                </div>
                <div>
                  <dt className="micro-caps text-[#17130e]/70">{t.contact.phoneLabel}</dt>
                  <dd className="mt-1"><a href={`tel:${SITE.phone}`} className="tnum text-[#17130e]/85 transition-colors hover:text-[var(--gilt)]">{SITE.phoneDisplay}</a></dd>
                </div>
                <div>
                  <dt className="micro-caps text-[#17130e]/70">{t.contact.officesLabel}</dt>
                  <dd className="mt-1 space-y-1 text-sm leading-relaxed text-[#17130e]/70">
                    <div><span className="text-[var(--gilt)]">{t.contact.countryCh}</span> — {SITE.address.street}, {SITE.address.postalCode} {SITE.address.locality}</div>
                    <div><span className="text-[var(--gilt)]">{t.contact.countryIt}</span> — {SITE.addressIt.street}, {SITE.addressIt.postalCode} {SITE.addressIt.locality}</div>
                  </dd>
                </div>
              </dl>
            </div>

            <div className="min-w-0">
              {formStatus === "success" ? (
                <div ref={successRef} tabIndex={-1} role="status" aria-live="polite" className="flex h-full flex-col items-center justify-center rounded-[4px] border border-[var(--color-gold)]/30 bg-[var(--ink-panel)]/50 p-12 text-center outline-none">
                  <CheckCircle2 className="mb-6 h-14 w-14 text-[var(--gilt)]" strokeWidth={1.2} />
                  <h3 className="display-space text-2xl text-[#17130e]">{t.contact.successTitle}</h3>
                  <p className="mt-3 font-light text-[#17130e]/65">{t.contact.successDesc}</p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} noValidate className="space-y-6">
                  {/* anti-spam honeypot (hidden from users; the server rejects submissions that fill it — see /api/contact) */}
                  <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
                  <div>
                    <span className="micro-caps mb-3 block text-[#17130e]/70">{t.contact.needsLabel}</span>
                    <div className="flex flex-wrap gap-2">
                      {t.contact.needs.map((n) => {
                        const active = needs.includes(n);
                        return (
                          <button key={n} type="button" aria-pressed={active} onClick={() => toggleNeed(n)} className={`rounded-full border px-4 py-2 text-sm tracking-wide transition-all ${active ? "border-[var(--color-gold)] bg-[var(--color-gold)] text-[#17130E]" : "border-[#17130e]/20 text-[#17130e]/75 hover:border-[var(--color-gold)]/60 hover:text-[#17130e]"}`}>{n}</button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div>
                      <label htmlFor="contact-name" className="micro-caps mb-2 block text-[#17130e]/70">{t.contact.formName} *</label>
                      <input id="contact-name" type="text" name="nome" required aria-invalid={fieldErrors.name ? true : undefined} aria-describedby={fieldErrors.name ? "contact-name-err" : undefined} onChange={() => fieldErrors.name && setFieldErrors((p) => ({ ...p, name: undefined }))} className="w-full border-b border-[#17130e]/20 bg-transparent py-2.5 text-[#17130e] placeholder-[#17130e]/40 transition-colors focus:border-[var(--color-gold)] focus:outline-none" placeholder={t.contact.phName} />
                      {fieldErrors.name && <p id="contact-name-err" role="alert" className="mt-2 text-sm text-red-700">{fieldErrors.name}</p>}
                    </div>
                    <div>
                      <label htmlFor="contact-email" className="micro-caps mb-2 block text-[#17130e]/70">{t.contact.formEmail} *</label>
                      <input id="contact-email" type="email" name="email" required aria-invalid={fieldErrors.email ? true : undefined} aria-describedby={fieldErrors.email ? "contact-email-err" : undefined} onChange={() => fieldErrors.email && setFieldErrors((p) => ({ ...p, email: undefined }))} className="w-full border-b border-[#17130e]/20 bg-transparent py-2.5 text-[#17130e] placeholder-[#17130e]/40 transition-colors focus:border-[var(--color-gold)] focus:outline-none" placeholder={t.contact.phEmail} />
                      {fieldErrors.email && <p id="contact-email-err" role="alert" className="mt-2 text-sm text-red-700">{fieldErrors.email}</p>}
                    </div>
                  </div>
                  <div>
                    <label htmlFor="contact-company" className="micro-caps mb-2 block text-[#17130e]/70">{t.contact.formCompany} <span className="normal-case tracking-normal text-[#17130e]/60">({t.contact.optional})</span></label>
                    <input id="contact-company" type="text" name="azienda" className="w-full border-b border-[#17130e]/20 bg-transparent py-2.5 text-[#17130e] placeholder-[#17130e]/40 transition-colors focus:border-[var(--color-gold)] focus:outline-none" placeholder={t.contact.phCompany} />
                  </div>
                  <div>
                    <label htmlFor="contact-message" className="micro-caps mb-2 block text-[#17130e]/70">{t.contact.formMessage} <span className="normal-case tracking-normal text-[#17130e]/60">({t.contact.optional})</span></label>
                    <textarea id="contact-message" name="messaggio" rows={3} className="w-full resize-none border-b border-[#17130e]/20 bg-transparent py-2.5 text-[#17130e] placeholder-[#17130e]/40 transition-colors focus:border-[var(--color-gold)] focus:outline-none" placeholder={t.contact.phMessage} />
                  </div>
                  {formStatus === "error" && (
                    <div role="alert" className="flex items-start gap-3 rounded-[4px] border border-red-300 bg-red-50 p-4 text-red-800">
                      <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
                      <p className="text-sm font-light">{t.contact.error}</p>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-6 pt-2">
                    <button type="submit" disabled={formStatus === "sending"} className="group inline-flex items-center gap-2 rounded-full px-8 py-4 text-sm font-semibold tracking-wide text-[#17130E] transition-transform duration-300 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-60" style={{ background: "linear-gradient(100deg, #e8c877, #b5893f)" }}>
                      {formStatus === "sending" ? t.contact.btnSending : t.contact.btnSend}
                      {formStatus !== "sending" && <Send className="h-4 w-4 transition-transform group-hover:translate-x-1" />}
                    </button>
                    <p className="micro-caps text-[#17130e]/70">{t.contact.reassurance}</p>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER — the Espresso bookend; the Measure terminates in a final tick */}
      <footer className="px-6 sm:px-10 lg:px-16 py-14 md:py-16" style={{ background: "var(--ink-panel)", color: "#17130e" }}>
        <div className="mx-auto max-w-[1400px]">
          <div className="flex items-center gap-3 border-t pt-8" style={{ borderColor: "rgba(201,162,90,0.25)" }}>
            <span aria-hidden="true" className="h-px w-8" style={{ background: "var(--gilt)" }} />
            <span className="micro-caps" style={{ color: "var(--gilt)" }}>Fin — 08</span>
          </div>
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2">
            <span className="micro-caps" style={{ color: "rgba(31,27,22,0.4)" }}>Webdesign</span>
            {LOCAL_CITIES.map((c) => (
              <Link key={c} href={localizedHref(lang, `/webdesign/${c}`)} className="micro-caps transition-colors text-[color:rgba(31,27,22,0.6)] hover:text-[#17130e]">
                {LOCAL_AREAS[c].navLabel[lang]}
              </Link>
            ))}
          </div>
          <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="flex items-center gap-3">
              <Image src="/logo-mark.png" alt="Modolo Digital Studio" width={30} height={30} />
              <span className="micro-caps tnum" style={{ color: "rgba(31,27,22,0.55)" }}>© {new Date().getFullYear()} Modolo Digital Studio</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              <Link href={localizedHref(lang, "/impressum")} className="micro-caps transition-colors text-[color:rgba(31,27,22,0.6)] hover:text-[#17130e]">{t.footer.imprint}</Link>
              <Link href={localizedHref(lang, "/privacy")} className="micro-caps transition-colors text-[color:rgba(31,27,22,0.6)] hover:text-[#17130e]">{t.footer.privacy}</Link>
              <a href="https://instagram.com/modolodigitalstudio" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="text-[color:rgba(31,27,22,0.6)] transition-colors hover:text-[#17130e]">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                  <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                  <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
                </svg>
              </a>
              <span aria-hidden="true" className="hidden h-3 w-px md:inline-block" style={{ background: "rgba(31,27,22,0.2)" }} />
              <span className="micro-caps" style={{ color: "var(--gilt)" }}>{t.footer.madeWith}</span>
            </div>
          </div>
        </div>
      </footer>
      <BackToTop label={t.nav.backToTop} />
    </main>
  );
}