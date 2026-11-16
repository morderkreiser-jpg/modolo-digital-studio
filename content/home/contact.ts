// Homepage copy: section 07 · Kontakt (COPY.md §12). The form contract is unchanged
// (POST /api/contact: nome, email, azienda, messaggio, servizi, lang, _gotcha); the three
// inline error strings are today's (errName, errEmailRequired, errEmailInvalid), kept on purpose.
// Every string here is plain text, so the server can hand this object to the client form island.
import type { Locale } from "@/lib/i18n";
import { REPLY_TEXT as R } from "./promises";

export type ContactCopy = {
  kicker: string;
  h2: readonly [string, string];
  lead: string;
  button: string; // WhatsApp, tag Kontakt (PREFILL.contact)
  labels: { whatsapp: string; email: string; address: string; google: string };
  address: string;
  googleLink: string; // → googleProfileUrl(), new tab
  regionItLine: string; // region IT only
  formH3: string;
  fields: { name: string; email: string; business: string; message: string };
  placeholders: { name: string; email: string; business: string; message: string };
  chipsLabel: string;
  chips: readonly string[];
  submit: string;
  sending: string;
  note: string;
  privacy: { before: string; link: string; after: string };
  successTitle: string;
  successText: string;
  error: string; // + WhatsApp link (tag Formular, PREFILL.formError) + mailto
  errName: string;
  errEmailRequired: string;
  errEmailInvalid: string;
  newTab: string;
};

export const CONTACT: Record<Locale, ContactCopy> = {
  de: {
    kicker: "07 · Kontakt",
    h2: ["Schreib mir.", "Ich antworte selbst."],
    lead: `Am schnellsten geht es per WhatsApp. Formular und E-Mail kommen auch direkt zu mir. Ich antworte ${R.de.long}.`,
    button: "Per WhatsApp schreiben",
    labels: { whatsapp: "WhatsApp", email: "E-Mail", address: "Adresse", google: "Google-Profil" },
    address: "Modolo Digital Studio, Scheideggstrasse 18, 8400 Winterthur",
    googleLink: "Auf Google Maps ansehen",
    regionItLine: "Italien: Via Toniolo 17, 31020 San Vendemiano (TV)",
    formH3: "Lieber per E-Mail",
    fields: { name: "Name*", email: "E-Mail*", business: "Betrieb (freiwillig)", message: "Nachricht (freiwillig)" },
    placeholders: { name: "Dein Name", email: "deine@email.ch", business: "z. B. Coiffeur Muster", message: "Zwei Zeilen zu deinem Betrieb" },
    chipsLabel: "Worum geht es?",
    chips: ["Google-Profil", "Website mit einer Seite", "Website bis 6 Seiten", "Online-Buchung", "Weiss ich noch nicht"],
    submit: "Nachricht senden",
    sending: "Wird gesendet …",
    note: `Ich antworte dir persönlich ${R.de.long}.`,
    privacy: { before: "Was mit deinen Angaben passiert, steht in der ", link: "Datenschutzerklärung", after: "." },
    successTitle: "Nachricht gesendet.",
    successText: `Danke. Ich melde mich ${R.de.long} bei dir.`,
    error: "Das hat nicht geklappt. Versuche es nochmals oder schreib mir direkt per WhatsApp oder E-Mail:",
    errName: "Bitte gib deinen Namen ein.",
    errEmailRequired: "Bitte gib deine E-Mail-Adresse ein.",
    errEmailInvalid: "Bitte gib eine gültige E-Mail-Adresse ein.",
    newTab: "(öffnet in neuem Tab)",
  },
  it: {
    kicker: "07 · Contatti",
    h2: ["Scrivimi.", "Ti rispondo io."],
    lead: `Il modo più veloce è WhatsApp. Anche modulo ed e-mail arrivano direttamente a me. Rispondo ${R.it.long}.`,
    button: "Scrivimi su WhatsApp",
    labels: { whatsapp: "WhatsApp", email: "E-mail", address: "Indirizzo", google: "Profilo Google" },
    address: "Modolo Digital Studio, Scheideggstrasse 18, 8400 Winterthur",
    googleLink: "Vedi su Google Maps",
    regionItLine: "Italia: Via Toniolo 17, 31020 San Vendemiano (TV)",
    formH3: "Se preferisci l'e-mail",
    fields: { name: "Nome*", email: "E-mail*", business: "Attività (facoltativo)", message: "Messaggio (facoltativo)" },
    placeholders: { name: "Il tuo nome", email: "nome@email.ch", business: "es. Pizzeria Rossi", message: "Due righe sulla tua attività" },
    chipsLabel: "Di cosa si tratta?",
    chips: ["Profilo Google", "Sito di una pagina", "Sito fino a 6 pagine", "Prenotazione online", "Non lo so ancora"],
    submit: "Invia il messaggio",
    sending: "Invio in corso …",
    note: `Ti rispondo io ${R.it.long}.`,
    privacy: { before: "Come tratto i tuoi dati lo trovi nell'", link: "informativa sulla privacy", after: "." },
    successTitle: "Messaggio inviato.",
    successText: `Grazie. Ti rispondo ${R.it.long}.`,
    error: "Qualcosa non ha funzionato. Riprova o scrivimi direttamente su WhatsApp o per e-mail:",
    errName: "Inserisci il tuo nome.",
    errEmailRequired: "Inserisci la tua e-mail.",
    errEmailInvalid: "Inserisci un indirizzo e-mail valido.",
    newTab: "(si apre in una nuova scheda)",
  },
  en: {
    kicker: "07 · Contact",
    h2: ["Write to me.", "I reply personally."],
    lead: `WhatsApp is quickest. The form and e-mail come straight to me too. I reply ${R.en.long}.`,
    button: "Message me on WhatsApp",
    labels: { whatsapp: "WhatsApp", email: "E-mail", address: "Address", google: "Google profile" },
    address: "Modolo Digital Studio, Scheideggstrasse 18, 8400 Winterthur",
    googleLink: "View on Google Maps",
    regionItLine: "Italy: Via Toniolo 17, 31020 San Vendemiano (TV)",
    formH3: "If you prefer e-mail",
    fields: { name: "Name*", email: "E-mail*", business: "Business (optional)", message: "Message (optional)" },
    placeholders: { name: "Your name", email: "you@email.ch", business: "e.g. Salon Muster", message: "Two lines about your business" },
    chipsLabel: "What is it about?",
    chips: ["Google profile", "One-page website", "Website up to 6 pages", "Online booking", "Not sure yet"],
    submit: "Send message",
    sending: "Sending …",
    note: `I reply personally ${R.en.long}.`,
    privacy: { before: "How I handle your data is explained in the ", link: "privacy policy", after: "." },
    successTitle: "Message sent.",
    successText: `Thank you. I'll get back to you ${R.en.long}.`,
    error: "That didn't work. Try again or message me directly on WhatsApp or by e-mail:",
    errName: "Please enter your name.",
    errEmailRequired: "Please enter your e-mail.",
    errEmailInvalid: "Please enter a valid e-mail address.",
    newTab: "(opens in a new tab)",
  },
};
