// Sector names in the four voice languages, for the demo menus ("Restaurant", "Ristorante"...).
//
// SAFE TO IMPORT FROM CLIENT COMPONENTS: plain strings and a type import only. It lives apart from
// the demo tenants on purpose: a "use client" menu that imports these labels never pulls the
// tenants' knowledge, rules or transfer numbers into the browser bundle.
import type { VoiceSector, VoiceText } from "@/lib/voice/types";

export const DEMO_SECTOR_LABELS: Record<VoiceSector, VoiceText> = {
  studio: { de: "Webstudio", it: "Studio web", en: "Web studio", fr: "Studio web" },
  moving: { de: "Umzüge", it: "Traslochi", en: "Moving", fr: "Déménagements" },
  cleaning: { de: "Reinigung", it: "Pulizie", en: "Cleaning", fr: "Nettoyage" },
  plumbing: {
    de: "Sanitär und Heizung",
    it: "Idraulica e riscaldamento",
    en: "Plumbing and heating",
    fr: "Sanitaire et chauffage",
  },
  electrical: { de: "Elektroinstallationen", it: "Impianti elettrici", en: "Electrician", fr: "Électricité" },
  trades: { de: "Maler und Gipser", it: "Pittura e gessatura", en: "Painting and plastering", fr: "Peinture et plâtrerie" },
  bodyshop: { de: "Carrosserie", it: "Carrozzeria", en: "Body shop", fr: "Carrosserie" },
  realestate: { de: "Immobilien", it: "Immobiliare", en: "Real estate", fr: "Immobilier" },
  restaurant: { de: "Restaurant", it: "Ristorante", en: "Restaurant", fr: "Restaurant" },
  hotel: { de: "Hotel", it: "Albergo", en: "Hotel", fr: "Hôtel" },
  hairdresser: { de: "Coiffeur", it: "Parrucchiere", en: "Hairdresser", fr: "Coiffeur" },
  beauty: { de: "Kosmetikstudio", it: "Centro estetico", en: "Beauty studio", fr: "Institut de beauté" },
  tattoo: { de: "Tattoo-Studio", it: "Studio di tatuaggi", en: "Tattoo studio", fr: "Salon de tatouage" },
};
