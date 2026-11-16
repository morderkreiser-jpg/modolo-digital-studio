// Mobile sticky bar copy (COPY.md §5). The primary label is the single word «WhatsApp» in every
// locale (measured: longer labels wrap in the 64 % button at 390 and 360 px). `whatsapp + whatsappSrOnly`
// is the accessible name, e.g. "WhatsApp-Nachricht schreiben" (rendered as an aria-label that starts with
// the visible word: an sr-only span would make Chrome insert a space). The WhatsApp icon is aria-hidden.
export const STICKY = {
  de: { whatsapp: "WhatsApp", whatsappSrOnly: "-Nachricht schreiben", prices: "Preise" },
  it: { whatsapp: "WhatsApp", whatsappSrOnly: ": scrivimi", prices: "Prezzi" },
  en: { whatsapp: "WhatsApp", whatsappSrOnly: ": message me", prices: "Prices" },
} as const;

/** «Preise» lands on the offer ladder, whose first rung is the free Google check (SPEC D13). */
export const STICKY_PRICES_HREF = "#angebot";
