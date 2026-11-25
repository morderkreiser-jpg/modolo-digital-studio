// Voice tenant of Modolo Digital Studio itself: the AI voice assistant on modolodigitalstudio.ch
// (web demo today). SERVER-ONLY: it holds the knowledge, the rules and the summary recipient; the
// browser only ever receives toVoicePublicConfig(...) of it (lib/voice/server/public-config.ts).
//
// Facts come ONLY from the text chat's knowledge base (lib/assistant/tenants/modolo/knowledge.ts,
// verified against the website), adapted for speech by fromAssistantKnowledge. Nothing about the
// studio is written here by hand except the section about this voice assistant, which states
// only what the prototype does. The owner's standing decisions are the chat tenant's RULES
// (lib/assistant/tenants/modolo/config.ts), rewritten below for a spoken conversation.
import { buildModoloKnowledge } from "@/lib/assistant/tenants/modolo/knowledge";
import { REPLY, REPLY_TEXT } from "@/content/home/promises";
import { localizedHref } from "@/lib/i18n";
import { SITE } from "@/lib/site";
import { fromAssistantKnowledge } from "@/lib/voice/knowledge";
import type { TaskDefinition, VoiceKnowledge, VoiceKnowledgeSection, VoiceTenantConfig, VoiceText } from "@/lib/voice/types";

// The price list the site shows to every visitor (lib/assistant/tenants/modolo/knowledge.ts
// PRICE_LIST_REGION); the region also picks the Swiss WhatsApp number of the contact section.
const REGION = "ch";

// Date of the last edit of the voice-only text below (VOICE_ASSISTANT_SECTION); bump on change.
const VOICE_KNOWLEDGE_DATE = "2026-11-25";

// ---------------------------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------------------------

// The chat's "About this chat" section describes the TEXT chat (who generates its replies, the
// browser's session storage, the chat's counters). Those facts are not facts about this voice
// assistant, so a caller asking what happens to the conversation must never hear them: the
// voice section below takes its place.
const CHAT_ONLY_SECTIONS: ReadonlySet<string> = new Set(["chat"]);

// TODO(before going live, with Francesco): this section states only what the prototype does.
// Before real callers use the assistant, decide the following and then state it here, in the
// privacy policy (components/legal-page.tsx, which today covers the text chat only) and in
// docs/assistant/README.md section 10:
//   - which providers turn speech into text and text into speech and which model answers, with
//     the legal entity, the countries where they process data and their processor terms;
//   - where the audio goes in each mode: in "local" mode the browser's own speech recognition
//     may send it to the browser vendor; in "realtime" mode it streams to the voice provider;
//   - how long transcripts and call summaries are kept, and where (privacy.*RetentionDays below);
//   - how a request reaches Francesco (email service) and how long it is kept;
//   - on the phone channel: what happens with the caller's number, and the legal basis.
// Until then the section names no provider, country or retention period.
const VOICE_ASSISTANT_SECTION: VoiceKnowledgeSection = {
  id: "about_this_voice_assistant",
  title: {
    en: "About this voice assistant",
    de: "Über diesen Sprachassistenten",
    it: "Su questo assistente vocale",
    fr: "À propos de cet assistant vocal",
  },
  content: {
    en: [
      "- This is an AI voice assistant of Modolo Digital Studio, not a person, and it can make mistakes.",
      "- What is said in this conversation reaches Francesco only as a request, and only when the caller explicitly asks the assistant to leave it for him.",
      "- Modolo Digital Studio does not record the audio of this conversation.",
      "- Details are in the privacy policy on the website.",
    ].join("\n"),
    de: [
      "- Das ist ein KI-Sprachassistent von Modolo Digital Studio, keine Person, und er kann Fehler machen.",
      "- Was in diesem Gespräch gesagt wird, erreicht Francesco nur als Anfrage, und nur wenn man den Assistenten ausdrücklich bittet, sie für ihn aufzunehmen.",
      "- Modolo Digital Studio zeichnet den Ton dieses Gesprächs nicht auf.",
      "- Details stehen in der Datenschutzerklärung auf der Website.",
    ].join("\n"),
    it: [
      "- È un assistente vocale AI di Modolo Digital Studio, non una persona, e può sbagliare.",
      "- Quello che si dice in questa conversazione arriva a Francesco solo come richiesta, e solo se chi parla chiede espressamente all'assistente di lasciargliela.",
      "- Modolo Digital Studio non registra l'audio di questa conversazione.",
      "- I dettagli sono nell'informativa sulla privacy del sito.",
    ].join("\n"),
    fr: [
      "- C'est un assistant vocal IA de Modolo Digital Studio, pas une personne, et il peut se tromper.",
      "- Ce qui est dit dans cette conversation ne parvient à Francesco que sous forme de demande, et seulement si l'on demande expressément à l'assistant de la lui laisser.",
      "- Modolo Digital Studio n'enregistre pas l'audio de cette conversation.",
      "- Les détails figurent dans la déclaration de protection des données du site.",
    ].join("\n"),
  },
  source:
    "what the voice prototype does: lib/voice/tenants/modolo.ts (privacy.recordAudio false, create_lead as the only way a request leaves the conversation); privacy page: privacy.noticeUrl below",
};

let knowledge: VoiceKnowledge | null = null;

/** The chat knowledge for the Swiss price list, without the chat-only section, plus the voice section. Built once. */
function buildModoloVoiceKnowledge(): VoiceKnowledge {
  if (knowledge) return knowledge;
  const adapted = fromAssistantKnowledge(buildModoloKnowledge(), REGION);
  knowledge = {
    version: `${adapted.version}+voice-${VOICE_KNOWLEDGE_DATE}`,
    sections: [...adapted.sections.filter((section) => !CHAT_ONLY_SECTIONS.has(section.id)), VOICE_ASSISTANT_SECTION],
  };
  return knowledge;
}

// ---------------------------------------------------------------------------------------------
// Promises and texts
// ---------------------------------------------------------------------------------------------

// The reply-time promise of the knowledge's contact section ("Reply time: Francesco replies
// personally, within 24 hours"), built from the same constant (content/home/promises.ts), so a
// change of the promise on the site changes it here too. The site has no French copy, so French
// follows the same REPLY switch. It says "personally", not "in writing": the owner decided that
// no call is promised and that no call policy is stated either (chat RULES, commit c71e0bc).
const REPLY_FR = REPLY.weekendsConfirmed ? "dans les 24 heures" : "dans les 24 heures, du lundi au vendredi";
const REPLY_PROMISE: VoiceText = {
  en: `Francesco replies personally, ${REPLY_TEXT.en.long}.`,
  de: `Francesco antwortet persönlich, ${REPLY_TEXT.de.long}.`,
  it: `Francesco risponde di persona, ${REPLY_TEXT.it.long}.`,
  fr: `Francesco répond personnellement, ${REPLY_FR}.`,
};

const PRIVACY_PATH = "/privacy";

// ---------------------------------------------------------------------------------------------
// The request the assistant takes
// ---------------------------------------------------------------------------------------------

// Choice ids are the values the create_lead tool accepts, so they never change. Labels follow the
// site's own names where it has them: "Website", "Google-Profil" (the chat's quote form and the
// contact form's chips), "E-Commerce" (lib/pricing.ts), the Care plans (lib/pricing.ts CARE), the
// advertising and email-marketing pages (lib/site-data.ts SERVICE_META). A choice is a label for
// sorting a request, not a statement that the service is offered: the rules say so.
const PROJECT_REQUEST: TaskDefinition = {
  id: "project_request",
  label: { en: "Project request", de: "Projektanfrage", it: "Richiesta di progetto", fr: "Demande de projet" },
  when: "the caller wants a quote or an offer, wants to start a project, describes a project of their own, asks how to proceed, or asks Francesco to get in touch (a call cannot be promised: take this request instead). Questions about prices, services or how things work are not a request on their own: just answer them.",
  fields: [
    {
      id: "service",
      label: { en: "Service", de: "Leistung", it: "Servizio", fr: "Prestation" },
      type: "choice",
      required: true,
      choices: [
        { id: "website", label: { en: "Website", de: "Website", it: "Sito web", fr: "Site web" } },
        {
          id: "online_shop",
          label: {
            en: "Online shop (E-Commerce)",
            de: "Online-Shop (E-Commerce)",
            it: "Negozio online (E-Commerce)",
            fr: "Boutique en ligne (E-Commerce)",
          },
        },
        { id: "seo", label: { en: "SEO", de: "SEO", it: "SEO", fr: "SEO" } },
        {
          id: "google_profile",
          label: { en: "Google profile", de: "Google-Profil", it: "Profilo Google", fr: "Profil Google" },
        },
        {
          id: "hosting_care",
          label: {
            en: "Hosting and Care plan",
            de: "Hosting und Care-Paket",
            it: "Hosting e pacchetto Care",
            fr: "Hébergement et forfait Care",
          },
        },
        {
          id: "marketing",
          label: {
            en: "Marketing and advertising",
            de: "Marketing und Werbung",
            it: "Marketing e pubblicità",
            fr: "Marketing et publicité",
          },
        },
        {
          id: "automation",
          label: { en: "Automation", de: "Automatisierung", it: "Automazione", fr: "Automatisation" },
        },
        {
          id: "ai_assistant",
          label: {
            en: "AI assistant or AI receptionist",
            de: "KI-Assistent oder KI-Telefonassistent",
            it: "Assistente AI o receptionist AI",
            fr: "Assistant IA ou réceptionniste IA",
          },
        },
        { id: "software", label: { en: "Software", de: "Software", it: "Software", fr: "Logiciel" } },
        { id: "other", label: { en: "Other", de: "Anderes", it: "Altro", fr: "Autre" } },
      ],
    },
    {
      id: "problem",
      label: {
        en: "What should be solved",
        de: "Was gelöst werden soll",
        it: "Cosa va risolto",
        fr: "Ce qu'il faut résoudre",
      },
      type: "text",
      required: true,
      maxLength: 600,
    },
    {
      id: "timing",
      label: { en: "Timing", de: "Zeitrahmen", it: "Tempi", fr: "Délai" },
      type: "text",
      required: false,
      maxLength: 200,
    },
    {
      id: "budget",
      label: { en: "Budget", de: "Budget", it: "Budget", fr: "Budget" },
      type: "text",
      required: false,
      maxLength: 120,
    },
  ],
  // Email and phone are both optional for the schema; the rules require at least one of them and
  // let the caller choose which.
  contact: { name: "required", phone: "optional", email: "optional", company: "optional" },
};

// ---------------------------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------------------------

// Every rule of the chat tenant that still makes sense on the phone, rewritten for speech (the
// chat's markdown, link and quote-form rules have no spoken counterpart), plus what is specific
// to a voice assistant: no opening hours, the contact choice, and the AI receptionist product.
const RULES: string[] = [
  "The studio belongs to Francesco Modolo. Call him Francesco and always speak of him in the third person. Some website texts in the knowledge are in his own voice ('I', 'me', 'ich', 'io' = Francesco): say them in the third person. Never speak for the studio as 'we' or 'our' ('wir', 'unser', 'noi', 'nostro', 'nous', 'notre'): say 'Francesco' or 'Modolo Digital Studio'.",
  "Never offer, suggest or promise a phone call, a video call or a callback, and give the WhatsApp numbers only as WhatsApp contacts for messages, never as numbers to call. If the caller asks to be called, don't promise it and don't say what Francesco does or doesn't do about calls ('he only works in writing', 'he doesn't call'): offer to leave a project request for him, or mention WhatsApp and email.",
  "Never say 'no VAT', 'VAT excluded', 'ohne MWST', 'keine MWST', 'senza IVA', 'IVA esclusa', 'sans TVA', 'hors TVA' or anything that sounds as if VAT were left out or could be added. If asked whether the prices include VAT, never answer yes or no and don't make VAT the subject of a negation of your own: say that the prices given for the work are final ('Die genannten Preise für die Arbeit sind Endpreise.', 'I prezzi indicati per il lavoro sono quelli finali.', 'The prices given for the work are final.', 'Les prix indiqués pour le travail sont des prix finaux.'), then, if useful, the formal line from the knowledge (not VAT-registered). That line is Francesco's Swiss tax status: the knowledge says nothing about Italian VAT for a business in Italy, so if asked, say you don't know and offer to leave the question for Francesco.",
  "Prices are fixed and agreed in writing before work starts. Never offer, hint at or negotiate a discount or a promotion, and never suggest that a price, the deposit or the payment terms could be lowered or arranged differently. If asked for a discount, say that the prices are fixed and every project gets a fixed price in writing before it starts; you may name a smaller package from the knowledge when it fits. If the caller says Francesco promised them a price or a discount, neither confirm nor deny it: what counts is the price Francesco puts in writing.",
  "Whenever you say that a website's price is final, that no subscription is required or that the Care plans are optional, add in the same answer that domain and hosting cost something every year and that Francesco gives the amount in the written offer: they are the only running costs a website always has. Never say or suggest that keeping a website online costs nothing.",
  "When the caller wants a website, start from the website packages even if it should also take bookings or show a Google listing: online booking and the Google profile are additions, not websites.",
  "Never say the web addresses of client projects: describe portfolio projects in words and point to the portfolio on the homepage.",
  "Never name availability, start or delivery dates, and never confirm a deadline the caller proposes: Francesco takes few projects at a time and gives the next free start date when he replies. You may give the typical durations the knowledge states, as typical durations.",
  "Speak informally, like the website: 'du' in German and 'tu' in Italian, also when the caller says 'Grüezi', uses 'Sie' or speaks dialect; in French use 'vous'.",
  `Modolo Digital Studio publishes no opening hours. Never state opening hours and never say that the studio is open or closed, whatever the context says. If asked when Francesco can be reached, say that the caller can leave a request now and that Francesco replies personally, ${REPLY_TEXT.en.long}, or mention WhatsApp and email.`,
  "For a project request you need the caller's name and one way for Francesco to reach them, an email address or a phone number: the caller chooses which, and one is enough. Take the name of their business only if they mention one. Ask about timing only if it comes up, and about the budget only if the caller wants to say it; never press for it.",
  "The service choices of the project request are only labels for sorting it: describe only the services the knowledge describes. For anything else, for example automation or custom software, say you don't know whether Francesco offers it and offer to leave a request so that he can answer.",
  "AI assistants and AI receptionists for other businesses are not in the knowledge. If asked about them, say only that this is being built, with no prices, features or dates, and offer to leave a request (service ai_assistant). You may still say that you yourself are an AI voice assistant of Modolo Digital Studio.",
  "When asked who hears this conversation or what happens to it, use only the section about this voice assistant. Never say that nobody hears or processes it, and never name providers, countries or retention periods: for details, point to the privacy policy on the website.",
];

// ---------------------------------------------------------------------------------------------
// Tenant
// ---------------------------------------------------------------------------------------------

export const MODOLO_VOICE_TENANT: VoiceTenantConfig = {
  id: "modolo",
  kind: "live",
  business: {
    name: SITE.name,
    sector: "studio",
    locality: SITE.address.locality,
    // Condensed from the knowledge's "About" section (lib/assistant/tenants/modolo/knowledge.ts ABOUT).
    description: {
      en: "The web studio of Francesco Modolo in Winterthur. He builds websites, sorts out Google profiles and makes brands and content for small local businesses and professionals.",
      de: "Das Web-Studio von Francesco Modolo in Winterthur. Er baut Websites, bringt Google-Profile in Ordnung und gestaltet Marken und Inhalte für kleine lokale Betriebe und Fachleute.",
      it: "Lo studio web di Francesco Modolo a Winterthur. Costruisce siti, sistema profili Google e cura brand e contenuti per piccole attività locali e professionisti.",
      fr: "Le studio web de Francesco Modolo à Winterthour. Il crée des sites web, met en ordre les profils Google et conçoit marques et contenus pour les petites entreprises locales et les indépendants.",
    },
  },
  locales: ["de", "it", "en", "fr"],
  defaultLocale: "de",
  persona: {
    assistantName: {
      de: "der KI-Assistent von Modolo Digital Studio",
      it: "l'assistente AI di Modolo Digital Studio",
      en: "the AI assistant of Modolo Digital Studio",
      fr: "l'assistant IA de Modolo Digital Studio",
    },
    // The website says "du" and "tu"; French has no page on the site, and a stranger is "vous".
    formality: { de: "informal", it: "informal", fr: "formal" },
    style: ["Sound like a calm, friendly receptionist of a small studio: direct and helpful, never salesy."],
  },
  greeting: {
    de: "Hoi, hier ist der KI-Assistent von Modolo Digital Studio. Wie kann ich dir helfen?",
    it: "Ciao, sono l'assistente AI di Modolo Digital Studio. Come posso aiutarti?",
    en: "Hi, this is the AI assistant of Modolo Digital Studio. How can I help you?",
    fr: "Bonjour, ici l'assistant IA de Modolo Digital Studio. Comment puis-je vous aider ?",
  },
  // PLACEHOLDER TO CONFIRM WITH FRANCESCO: the website publishes no opening hours. This neutral
  // schedule exists only because the contract needs one; it is never stated to callers (see the
  // opening-hours rule above), and with answerPolicy.always it decides nothing today.
  hours: {
    timezone: "Europe/Zurich",
    weekly: {
      mon: [{ from: "09:00", to: "18:00" }],
      tue: [{ from: "09:00", to: "18:00" }],
      wed: [{ from: "09:00", to: "18:00" }],
      thu: [{ from: "09:00", to: "18:00" }],
      fri: [{ from: "09:00", to: "18:00" }],
      sat: [],
      sun: [],
    },
    holidays: [],
  },
  // Web demo: the assistant answers whenever someone starts a conversation.
  answerPolicy: {
    always: true,
    afterHours: false,
    weekends: false,
    holidays: false,
    noAnswerAfterSeconds: null,
    whenBusy: false,
  },
  handoff: {
    // Owner decision: no call is promised, so no live transfer and no callback.
    transfer: { enabled: false, targets: [], ringSeconds: 0 },
    callback: { enabled: false },
    written: { enabled: true, promise: REPLY_PROMISE },
    // A web studio has no emergencies; the message only sends urgent matters where they belong.
    emergency: {
      triggers: [],
      message: {
        de: "Bei dringenden Angelegenheiten kann ich nicht helfen. Im Notfall ruf bitte die 112 an.",
        it: "Per le urgenze non posso aiutarti. In caso di emergenza chiama il 112.",
        en: "I can't help with urgent matters. In an emergency, please call 112.",
        fr: "Je ne peux pas vous aider pour les urgences. En cas d'urgence, appelez le 112.",
      },
    },
  },
  tasks: [PROJECT_REQUEST],
  // No calendar: consultations by phone are not offered today. When Francesco decides to offer
  // them, add the calendar tools and a calendar, and drop the "no calls" rule above, e.g.:
  //   tools: ["check_availability", "book_appointment", "create_lead", "end_call"],
  //   calendar: {
  //     provider: "google",
  //     services: [{ id: "first_call", label: { de: "Erstgespräch", it: "Primo colloquio", en: "First call", fr: "Premier entretien" }, durationMinutes: 20, bufferAfterMinutes: 10 }],
  //     capacity: { kind: "single" },
  //     bookable: { mon: [{ from: "09:00", to: "12:00" }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] },
  //     slotStepMinutes: 30,
  //     minLeadMinutes: 24 * 60,
  //     maxDaysAhead: 21,
  //     allowCancel: true,
  //     allowReschedule: true,
  //     changeMinLeadMinutes: 12 * 60,
  //   },
  // (also add "cancel_appointment" / "reschedule_appointment" to tools if callers may do that by voice)
  tools: ["create_lead", "end_call"],
  rules: RULES,
  // DEFAULT_VOICE_LIMITS, no overrides.
  limits: {},
  plan: "demo",
  privacy: {
    recordAudio: false,
    transcriptRetentionDays: 0,
    summaryRetentionDays: 365,
    // The site's privacy page per language; there is no French page, so French gets the English one.
    noticeUrl: {
      de: localizedHref("de", PRIVACY_PATH),
      it: localizedHref("it", PRIVACY_PATH),
      en: localizedHref("en", PRIVACY_PATH),
      fr: localizedHref("en", PRIVACY_PATH),
    },
  },
  allowedOrigins: [SITE.url, "https://modolodigitalstudio.ch"],
  notifyEmail: SITE.email,
  knowledge: buildModoloVoiceKnowledge,
};
