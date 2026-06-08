// Builders for schema.org structured data graphs. Plain module (server-importable).
// Each graph is emitted in the locale of the page it is rendered on, so the FAQ rich
// results and entity URLs match what the visitor (and crawler) actually sees.
import { SITE } from "./site";
import { FAQS, SERVICE_META } from "./site-data";
import type { ServiceSlug } from "./site";
import { localizedHref, type Locale } from "./i18n";
import { WEBSITES, CARE, BRANDING } from "./pricing";

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

const SERVICES_LABEL: Record<Locale, string> = {
  en: "Services",
  de: "Leistungen",
  it: "Servizi",
};

export function homeGraph(locale: Locale) {
  const homeUrl = abs(localizedHref(locale, "/"));
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
        sameAs: [SITE.instagram],
        founder: { "@type": "Person", name: SITE.founder },
      },
      {
        "@type": "ProfessionalService",
        "@id": `${SITE.url}/#business`,
        name: SITE.name,
        url: SITE.url,
        image: `${SITE.url}/og-image.png`,
        telephone: SITE.phone,
        email: SITE.email,
        address: postalAddress,
        areaServed: { "@type": "Country", name: "Switzerland" },
        priceRange: "$$",
        parentOrganization: { "@id": `${SITE.url}/#organization` },
      },
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
      {
        "@type": "Service",
        "@id": `${url}#service`,
        name: s.title,
        description: s.description,
        url,
        serviceType: s.title,
        inLanguage: locale,
        provider: { "@id": `${SITE.url}/#organization` },
        areaServed: { "@type": "Country", name: "Switzerland" },
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

const PRICING_LABEL: Record<Locale, string> = { en: "Pricing", de: "Preise", it: "Prezzi" };

function priceSpec(price: number, from: boolean, recurring: boolean) {
  const spec: Record<string, unknown> = {
    "@type": "UnitPriceSpecification",
    priceCurrency: "CHF",
    valueAddedTaxIncluded: false,
  };
  if (from) spec.minPrice = price;
  else spec.price = price;
  if (recurring) spec.referenceQuantity = { "@type": "QuantitativeValue", value: 1, unitCode: "MON" };
  return spec;
}

function offer(name: string, description: string | undefined, price: number, from: boolean, recurring: boolean) {
  return {
    "@type": "Offer",
    name,
    ...(description ? { description } : {}),
    itemOffered: { "@type": "Service", name, ...(description ? { description } : {}) },
    priceSpecification: priceSpec(price, from, recurring),
    availability: "https://schema.org/InStock",
    seller: { "@id": `${SITE.url}/#organization` },
  };
}

// Structured data for the /prezzi page. Emits the canonical Swiss/CHF region (what crawlers
// see in the server-rendered HTML); amounts are plain Numbers (the page formats per locale).
export function pricingGraph(locale: Locale) {
  const url = abs(localizedHref(locale, "/prezzi"));
  const items = [
    ...WEBSITES.items.map((it) => offer(it.name[locale], it.desc[locale], it.price.ch, it.from, false)),
    ...CARE.plans.map((p) => offer(p.name, undefined, p.price.ch, false, true)),
    ...BRANDING.items.map((it) => offer(it.name[locale], it.desc[locale], it.price.ch, it.from, false)),
  ];
  return {
    "@context": "https://schema.org",
    "@graph": [
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
