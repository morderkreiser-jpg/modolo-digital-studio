// Builders for schema.org structured data graphs. Plain module (server-importable).
// Each graph is emitted in the locale of the page it is rendered on, so the FAQ rich
// results and entity URLs match what the visitor (and crawler) actually sees.
import { SITE } from "./site";
import { FAQS, SERVICE_META } from "./site-data";
import type { ServiceSlug } from "./site";
import { localizedHref, type Locale } from "./i18n";

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
