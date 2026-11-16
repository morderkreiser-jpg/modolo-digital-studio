// Shared footer copy (components/site-footer.tsx, every page), COPY.md §13.
// NAP = identical to the Google Business Profile and the JSON-LD (Winterthur). Region IT adds the
// Italian address line, but the NAP WhatsApp keeps the CH number on purpose (NAP must match Google).
import type { Locale } from "@/lib/i18n";

export type FooterCopy = {
  nap: readonly [name: string, person: string, address: string, whatsapp: string, email: string];
  googleLink: string; // → googleProfileUrl(), new tab
  regionItLine: string;
  servicesHeading: string; // links = SERVICE_META[lang][slug].title, then allPrices
  allPrices: string;
  citiesHeading: string;
  cities: readonly [winterthur: string, zuerich: string, schweiz: string]; // LOCAL_CITIES order
  moreHeading: string;
  more: readonly [imprint: string, privacy: string, card: string, instagram: string];
  bottom: string;
  newTab: string;
};

export const FOOTER: Record<Locale, FooterCopy> = {
  de: {
    nap: ["Modolo Digital Studio", "Francesco Modolo", "Scheideggstrasse 18, 8400 Winterthur", "WhatsApp +41 77 223 79 00", "info@modolodigitalstudio.ch"],
    googleLink: "Google-Profil ansehen",
    regionItLine: "Italien: Via Toniolo 17, 31020 San Vendemiano (TV)",
    servicesHeading: "Leistungen",
    allPrices: "Alle Preise",
    citiesHeading: "Wo ich arbeite",
    cities: ["Winterthur", "Zürich", "Schweiz"],
    moreHeading: "Weiteres",
    more: ["Impressum", "Datenschutz", "Visitenkarte", "Instagram"],
    bottom: "© 2026 Modolo Digital Studio",
    newTab: "(öffnet in neuem Tab)",
  },
  it: {
    nap: ["Modolo Digital Studio", "Francesco Modolo", "Scheideggstrasse 18, 8400 Winterthur", "WhatsApp +41 77 223 79 00", "info@modolodigitalstudio.ch"],
    googleLink: "Vedi il profilo Google",
    regionItLine: "Italia: Via Toniolo 17, 31020 San Vendemiano (TV)",
    servicesHeading: "Servizi",
    allPrices: "Tutti i prezzi",
    citiesHeading: "Dove lavoro",
    cities: ["Winterthur", "Zurigo", "Svizzera"],
    moreHeading: "Altro",
    more: ["Note legali", "Privacy", "Biglietto da visita", "Instagram"],
    bottom: "© 2026 Modolo Digital Studio",
    newTab: "(si apre in una nuova scheda)",
  },
  en: {
    nap: ["Modolo Digital Studio", "Francesco Modolo", "Scheideggstrasse 18, 8400 Winterthur", "WhatsApp +41 77 223 79 00", "info@modolodigitalstudio.ch"],
    googleLink: "View the Google profile",
    regionItLine: "Italy: Via Toniolo 17, 31020 San Vendemiano (TV)",
    servicesHeading: "Services",
    allPrices: "All prices",
    citiesHeading: "Where I work",
    cities: ["Winterthur", "Zürich", "Switzerland"],
    moreHeading: "More",
    more: ["Legal notice", "Privacy", "Business card", "Instagram"],
    bottom: "© 2026 Modolo Digital Studio",
    newTab: "(opens in a new tab)",
  },
};
