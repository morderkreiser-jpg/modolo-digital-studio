// Single source of truth for site-wide constants (NAP, brand, socials).
// Plain module (no "use client") so it can be imported by server code (sitemap, robots, manifest, JSON-LD).

export const SITE = {
  url: "https://www.modolodigitalstudio.ch",
  name: "Modolo Digital Studio",
  shortName: "Modolo",
  description:
    "Design, code, and strategy for brands that want to stand out. A Swiss digital studio.",
  email: "info@modolodigitalstudio.ch",
  phone: "+41772237900", // E.164 — for tel: and schema.org telephone
  phoneDisplay: "+41 77 223 79 00",
  phoneIt: "+393505842579", // Italian WhatsApp/contact number (shown to IT-region visitors)
  phoneItDisplay: "+39 350 584 2579",
  instagram: "https://instagram.com/modolodigitalstudio",
  // Google Business Profile URL (Maps / g.page). Set NEXT_PUBLIC_GOOGLE_BUSINESS_URL in the
  // Vercel env once the profile exists; empty string = omitted from the schema graph.
  googleBusiness: process.env.NEXT_PUBLIC_GOOGLE_BUSINESS_URL ?? "",
  founder: "Francesco Modolo",
  // Swiss address — registered/legal seat (used by Impressum and JSON-LD).
  address: {
    street: "Scheideggstrasse 18",
    postalCode: "8400",
    locality: "Winterthur",
    region: "Zürich",
    country: "CH",
    // TODO(Francesco): replace with the exact pin from the Google Business Profile.
    // Approximate coordinates for 8400 Winterthur — verify before relying on the map marker.
    geo: { latitude: 47.4839, longitude: 8.742 },
  },
  // Italian local contact address (shown to Italy-region visitors).
  addressIt: {
    street: "Via Toniolo 17",
    postalCode: "31020",
    locality: "San Vendemiano",
    region: "TV",
    country: "IT",
  },
  // brand palette
  ivory: "#F7F3EC",
  dark: "#1F1B16",
  gold: "#B5893F",
} as const;

export const SERVICE_SLUGS = ["web", "brand", "content", "email"] as const;
export type ServiceSlug = (typeof SERVICE_SLUGS)[number];
