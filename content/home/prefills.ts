import type { Prices } from "./prices";

const DE_START = "Grüezi Francesco, ich möchte mit meinem Betrieb online besser gefunden werden. Was wäre der erste Schritt?";
const IT_START = "Ciao Francesco, ho un'attività e vorrei farmi trovare meglio online. Qual è il primo passo?";
const EN_START = "Hello Francesco, I run a business and would like to be easier to find online. What would be the first step?";

export const PREFILL = {
  de: {
    hero: "Grüezi Francesco, ich hätte gern so eine Website für meinen Betrieb. Was wäre der erste Schritt? (Website · Start)", // continues the H1 «Websites wie diese.»
    nav: "Grüezi Francesco, ich hätte eine Frage. (Website · Menü)",        // nav button + drawer row
    sticky: `${DE_START} (Website · Leiste)`,
    work: "Grüezi Francesco, ich habe die Beispiele auf der Website gesehen und möchte etwas Ähnliches für meinen Betrieb. (Website · Arbeiten)",
    checkNamed: (name: string) => `Grüezi Francesco, das ist mein Betrieb: «${name}». Ich hätte gern das Gratis-Video, wie er auf Google aussieht. (Website · Google-Check)`,
    checkEmpty: "Grüezi Francesco, ich hätte gern das Gratis-Video, wie mein Betrieb auf Google aussieht (Website · Google-Check). Mein Betrieb heisst: ",
    rung1: (p: Prices) => `Grüezi Francesco, mich interessiert das Google-Profil (${p.start}, vor Ort ${p.onSite}). (Website · Angebot Google-Profil)`,
    rung2: (p: Prices) => `Grüezi Francesco, mich interessiert eine Website mit einer Seite (ab ${p.essential}). (Website · Angebot Eine Seite)`,
    rung3: (p: Prices) => `Grüezi Francesco, mich interessiert eine Website mit bis zu 6 Seiten (ab ${p.business}). (Website · Angebot bis 6 Seiten)`,
    process: `${DE_START} (Website · Ablauf)`,
    contact: "Grüezi Francesco, ich möchte etwas für meinen Betrieb besprechen. (Website · Kontakt)",
    footer: "Grüezi Francesco, ich möchte etwas für meinen Betrieb besprechen. (Website · Fusszeile)", // NAP number in the shared footer
    formError: "Grüezi Francesco, das Formular auf der Website hat nicht geklappt. Ich möchte etwas für meinen Betrieb besprechen. (Website · Formular)",
    pricing: "Grüezi Francesco, ich habe die Preise angeschaut und hätte eine Frage. (Website · Preise)",
    city: (city: string) => `Grüezi Francesco, ich habe die Seite «Webdesign ${city}» gesehen und interessiere mich für eine Website. (Website · ${city})`, // Winterthur | Zürich | Schweiz
    service: (s: string) => `Grüezi Francesco, ich interessiere mich für «${s}». (Website · Leistung ${s})`,
  },
  it: {
    hero: "Ciao Francesco, vorrei un sito così per la mia attività. Qual è il primo passo? (sito · inizio)",
    nav: "Ciao Francesco, avrei una domanda. (sito · menu)",
    sticky: `${IT_START} (sito · barra)`,
    work: "Ciao Francesco, ho visto i lavori sul sito e vorrei qualcosa di simile per la mia attività. (sito · lavori)",
    checkNamed: (name: string) => `Ciao Francesco, la mia attività è «${name}». Vorrei il video gratuito su come appare su Google. (sito · check Google)`,
    checkEmpty: "Ciao Francesco, vorrei il video gratuito su come appare la mia attività su Google (sito · check Google). La mia attività si chiama: ",
    rung1: (p: Prices) => `Ciao Francesco, mi interessa il profilo Google (${p.start}, con visita ${p.onSite}). (sito · offerta profilo Google)`,
    rung2: (p: Prices) => `Ciao Francesco, mi interessa un sito di una pagina (da ${p.essential}). (sito · offerta una pagina)`,
    rung3: (p: Prices) => `Ciao Francesco, mi interessa un sito fino a 6 pagine (da ${p.business}). (sito · offerta 6 pagine)`,
    process: `${IT_START} (sito · come lavoro)`,
    contact: "Ciao Francesco, vorrei parlarti della mia attività. (sito · contatti)",
    footer: "Ciao Francesco, vorrei parlarti della mia attività. (sito · piè di pagina)",
    formError: "Ciao Francesco, il modulo sul sito non ha funzionato. Vorrei parlarti della mia attività. (sito · modulo)",
    pricing: "Ciao Francesco, ho guardato i prezzi e avrei una domanda. (sito · prezzi)",
    city: (city: string) => `Ciao Francesco, ho visto la pagina «Web design ${city}» e mi interessa un sito. (sito · ${city})`, // Winterthur | Zurigo | Svizzera
    service: (s: string) => `Ciao Francesco, mi interessa «${s}». (sito · servizio ${s})`,
  },
  en: {
    hero: "Hello Francesco, I'd like a website like the ones on your site, for my business. What would be the first step? (website · start)",
    nav: "Hello Francesco, I have a question. (website · menu)",
    sticky: `${EN_START} (website · bar)`,
    work: "Hello Francesco, I saw the examples on the website and would like something similar for my business. (website · work)",
    checkNamed: (name: string) => `Hello Francesco, my business is “${name}”. I'd like the free video on how it looks on Google. (website · Google check)`,
    checkEmpty: "Hello Francesco, I'd like the free video on how my business looks on Google (website · Google check). My business is called: ",
    rung1: (p: Prices) => `Hello Francesco, I'm interested in the Google profile (${p.start}, on site ${p.onSite}). (website · offer Google profile)`,
    rung2: (p: Prices) => `Hello Francesco, I'm interested in a one-page website (from ${p.essential}). (website · offer one page)`,
    rung3: (p: Prices) => `Hello Francesco, I'm interested in a website of up to 6 pages (from ${p.business}). (website · offer 6 pages)`,
    process: `${EN_START} (website · process)`,
    contact: "Hello Francesco, I'd like to talk about my business. (website · contact)",
    footer: "Hello Francesco, I'd like to talk about my business. (website · footer)",
    formError: "Hello Francesco, the form on the website didn't work. I'd like to talk about my business. (website · form)",
    pricing: "Hello Francesco, I've looked at the prices and have a question. (website · prices)",
    city: (city: string) => `Hello Francesco, I saw the “Web design ${city}” page and I'm interested in a website. (website · ${city})`,
    service: (s: string) => `Hello Francesco, I'm interested in “${s}”. (website · service ${s})`,
  },
} as const;
// Visitenkarte (/biglietto): unchanged on purpose (deliberate «Sie»).
// Region IT: number = SITE.phoneIt; prices stay CHF (offer.tsx builds Prices for region "ch" only). local-page.tsx keeps the CH number.
