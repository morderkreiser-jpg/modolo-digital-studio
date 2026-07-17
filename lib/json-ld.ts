// Builders for schema.org structured data graphs. Plain module (server-importable).
// Each graph is emitted in the locale of the page it is rendered on, so the FAQ rich
// results and entity URLs match what the visitor (and crawler) actually sees.
import { SITE } from "./site";
import { FAQS, SERVICE_META } from "./site-data";
import type { ServiceSlug } from "./site";
import { localizedHref, type Locale } from "./i18n";
import { WEBSITES, CARE, BRANDING } from "./pricing";
import { DEFAULT_REGION, type Region } from "./region";
import { LOCAL_AREAS, type CitySlug } from "./local-seo";
import { REVIEWS, AGGREGATE } from "../data/reviews";

// Absolute URL for a locale-aware path. abs("/") -> SITE.url ; abs("/de") -> SITE.url + "/de".
const abs = (path: string) => SITE.url + (path === "/" ? "" : path);

const postalAddress = {
  "@type": "PostalAddress",
  streetAddress: SITE.address.street,
  postalCode: SITE.address.postalCode,
  addressLocality: SITE.address.locality,
  addressRegion: SITE.address.region,
  addressCountry: SITE.address.country,
};

const postalAddressIt = {
  "@type": "PostalAddress",
  streetAddress: SITE.addressIt.street,
  postalCode: SITE.addressIt.postalCode,
  addressLocality: SITE.addressIt.locality,
  addressRegion: SITE.addressIt.region,
  addressCountry: SITE.addressIt.country,
};

const SERVICES_LABEL: Record<Locale, string> = {
  en: "Services",
  de: "Leistungen",
  it: "Servizi",
};

const geoCoordinates = {
  "@type": "GeoCoordinates",
  latitude: SITE.address.geo.latitude,
  longitude: SITE.address.geo.longitude,
};

// TODO(Francesco): confirm real opening hours (or switch to by-appointment) before deploy.
const OPENING_HOURS_CH = [
  {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    opens: "09:00",
    closes: "18:00",
  },
];

// Google Business Profile URL, if configured — appended to sameAs where it belongs.
const googleBusinessSameAs = SITE.googleBusiness ? [SITE.googleBusiness] : [];

// geo + opening hours are only emitted once the Google Business Profile is configured — that's
// when the exact map pin and hours have been confirmed. Until then they're omitted (never wrong):
// set NEXT_PUBLIC_GOOGLE_BUSINESS_URL AND replace the placeholder coords/hours with the real ones.
const verifiedLocalData = SITE.googleBusiness
  ? { geo: geoCoordinates, openingHoursSpecification: OPENING_HOURS_CH }
  : {};

// Emits aggregateRating + review ONLY when data/reviews.ts holds real reviews. Never a
// self-serving empty/fake rating (Google penalizes that), so returns {} while the file is empty.
function aggregateReviewFields() {
  if (!AGGREGATE) return {};
  return {
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: AGGREGATE.ratingValue,
      reviewCount: AGGREGATE.reviewCount,
    },
    review: REVIEWS.map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.author },
      datePublished: r.datePublished,
      reviewRating: { "@type": "Rating", ratingValue: r.rating, bestRating: 5, worstRating: 1 },
      reviewBody: r.body,
    })),
  };
}

export function homeGraph(locale: Locale) {
  const homeUrl = abs(localizedHref(locale, "/"));
  // The Italian business entity (EUR, IT address) only belongs on the Italian pages; on /de and
  // the English root the graph carries just the Swiss entity, keeping the local focus clean.
  const includeIt = locale === "it";
  const businessIt = {
    "@type": "ProfessionalService",
    "@id": `${SITE.url}/#business-it`,
    name: SITE.name,
    url: SITE.url,
    image: `${SITE.url}/og-image.png`,
    telephone: SITE.phoneIt,
    email: SITE.email,
    address: postalAddressIt,
    areaServed: { "@type": "Country", name: "Italy" },
    priceRange: "EUR 900-4800",
    inLanguage: "it",
    parentOrganization: { "@id": `${SITE.url}/#organization` },
  };
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": `${SITE.url}/#organization`,
        name: SITE.name,
        url: SITE.url,
        logo: `${SITE.url}/logo-icon.png`,
        image: `${SITE.url}/og-image.png`,
        email: SITE.email,
        telephone: SITE.phone,
        address: postalAddress,
        location: [
          { "@id": `${SITE.url}/#business-ch` },
          ...(includeIt ? [{ "@id": `${SITE.url}/#business-it` }] : []),
        ],
        sameAs: [SITE.instagram, ...googleBusinessSameAs],
        founder: { "@type": "Person", name: SITE.founder },
      },
      {
        "@type": "ProfessionalService",
        "@id": `${SITE.url}/#business-ch`,
        name: SITE.name,
        url: SITE.url,
        image: `${SITE.url}/og-image.png`,
        telephone: SITE.phone,
        email: SITE.email,
        address: postalAddress,
        ...verifiedLocalData,
        areaServed: { "@type": "Country", name: "Switzerland" },
        priceRange: "CHF 1900-8500",
        inLanguage: locale,
        ...(googleBusinessSameAs.length ? { sameAs: googleBusinessSameAs } : {}),
        ...aggregateReviewFields(),
        parentOrganization: { "@id": `${SITE.url}/#organization` },
      },
      ...(includeIt ? [businessIt] : []),
      {
        "@type": "WebSite",
        "@id": `${homeUrl}#website`,
        url: homeUrl,
        name: SITE.name,
        inLanguage: locale,
        publisher: { "@id": `${SITE.url}/#organization` },
      },
      {
        "@type": "FAQPage",
        "@id": `${homeUrl}#faq`,
        inLanguage: locale,
        mainEntity: FAQS[locale].map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };
}

export function serviceGraph(slug: ServiceSlug, locale: Locale) {
  const s = SERVICE_META[locale][slug];
  const url = abs(localizedHref(locale, `/servizi/${slug}`));
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE.url}/#organization`, name: SITE.name, url: SITE.url, logo: `${SITE.url}/logo-icon.png` },
      {
        "@type": "Service",
        "@id": `${url}#service`,
        name: s.title,
        description: s.description,
        url,
        serviceType: s.title,
        inLanguage: locale,
        provider: { "@id": `${SITE.url}/#organization` },
        areaServed: [
          { "@type": "Country", name: "Switzerland" },
          { "@type": "Country", name: "Italy" },
        ],
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: abs(localizedHref(locale, "/")) },
          { "@type": "ListItem", position: 2, name: SERVICES_LABEL[locale], item: abs(localizedHref(locale, "/#servizi")) },
          { "@type": "ListItem", position: 3, name: s.title, item: url },
        ],
      },
    ],
  };
}

// Structured data for a local-SEO area page (/webdesign/[city]): a ProfessionalService whose
// areaServed is the city/country, so Google connects the page to local intent.
export function localAreaGraph(slug: CitySlug, locale: Locale) {
  const area = LOCAL_AREAS[slug];
  const url = abs(localizedHref(locale, `/webdesign/${slug}`));
  const areaServed =
    area.areaServedType === "Country"
      ? { "@type": "Country", name: area.areaServedName }
      : { "@type": "City", name: area.areaServedName };
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE.url}/#organization`, name: SITE.name, url: SITE.url, logo: `${SITE.url}/logo-icon.png` },
      {
        "@type": "ProfessionalService",
        "@id": `${url}#business`,
        name: `${SITE.name} — ${area.areaServedName}`,
        url,
        image: `${SITE.url}/og-image.png`,
        telephone: SITE.phone,
        email: SITE.email,
        address: postalAddress,
        areaServed,
        priceRange: "CHF 1900-8500",
        inLanguage: locale,
        parentOrganization: { "@id": `${SITE.url}/#organization` },
        founder: { "@type": "Person", name: SITE.founder },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: abs(localizedHref(locale, "/")) },
          { "@type": "ListItem", position: 2, name: area.h1accent[locale], item: url },
        ],
      },
    ],
  };
}

const PRICING_LABEL: Record<Locale, string> = { en: "Pricing", de: "Preise", it: "Prezzi" };

function priceSpec(price: number, from: boolean, recurring: boolean, region: Region) {
  const spec: Record<string, unknown> = {
    "@type": "UnitPriceSpecification",
    priceCurrency: region === "it" ? "EUR" : "CHF",
    valueAddedTaxIncluded: false,
  };
  if (from) spec.minPrice = price;
  else spec.price = price;
  if (recurring) spec.referenceQuantity = { "@type": "QuantitativeValue", value: 1, unitCode: "MON" };
  return spec;
}

function offer(name: string, description: string | undefined, price: number, from: boolean, recurring: boolean, region: Region) {
  return {
    "@type": "Offer",
    name,
    ...(description ? { description } : {}),
    itemOffered: { "@type": "Service", name, ...(description ? { description } : {}) },
    priceSpecification: priceSpec(price, from, recurring, region),
    availability: "https://schema.org/InStock",
    seller: { "@id": `${SITE.url}/#organization` },
  };
}

// Structured data for the /prezzi page. Emits the visitor's resolved pricing region (CHF/EUR;
// defaults to CH), matching the server-rendered HTML; amounts are plain Numbers (page formats).
export function pricingGraph(locale: Locale, region: Region = DEFAULT_REGION) {
  const url = abs(localizedHref(locale, "/prezzi"));
  const items = [
    ...WEBSITES.items.map((it) => offer(it.name[locale], it.desc[locale], it.price[region], it.from, false, region)),
    ...CARE.plans.map((p) => offer(p.name, undefined, p.price[region], false, true, region)),
    ...BRANDING.items.map((it) => offer(it.name[locale], it.desc[locale], it.price[region], it.from, false, region)),
  ];
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": `${SITE.url}/#organization`, name: SITE.name, url: SITE.url, logo: `${SITE.url}/logo-icon.png` },
      {
        "@type": "OfferCatalog",
        "@id": `${url}#pricing`,
        name: `${SITE.name} — ${PRICING_LABEL[locale]}`,
        url,
        inLanguage: locale,
        provider: { "@id": `${SITE.url}/#organization` },
        itemListElement: items,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: abs(localizedHref(locale, "/")) },
          { "@type": "ListItem", position: 2, name: PRICING_LABEL[locale], item: url },
        ],
      },
    ],
  };
}
