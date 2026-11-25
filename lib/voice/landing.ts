// The sales page of Modolo Voice AI: its on/off switch, its metadata and its structured data.
//
//   /ai-receptionist · /de/ki-telefonassistent · /it/assistente-telefonico-ai
//   (route folder app/[lang]/assistente-telefonico-ai, public slugs in lib/i18n.ts)
//
// The page promises a product that is a prototype today (DECISIONS.md D12), so it is OFF unless
// VOICE_LANDING is clearly switched on: off, the route answers 404 and the sitemap leaves it out,
// and merging the branch publishes nothing by accident. The page and the sitemap are prerendered,
// so the switch is read when the site is built: changing it takes a new deployment.
//
// Plain module (no "server-only", no Next runtime imports): app/sitemap.ts and the node:test suite
// import it. It holds only what the page shows anyway.
import type { Metadata } from "next";
import { VOICE_LANDING } from "@/content/voice/landing";
import { localizedHref, type Locale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { SITE } from "@/lib/site";
import type { DemoScript, VoiceLocale } from "@/lib/voice/types";

/** The canonical (route folder) path; localizedHref turns it into each language's public URL. */
export const VOICE_LANDING_PATH = "/assistente-telefonico-ai";

/** The product's name: the same in every language, like the site's own name. */
export const VOICE_PRODUCT_NAME = "Modolo Voice AI";

// The same words as the voice switches in lib/voice/server/env.ts: a near miss ("ture", "enabled")
// leaves the page off rather than publishing it.
const ON_VALUES: ReadonlySet<string> = new Set(["true", "1", "on", "yes"]);

/**
 * True only when VOICE_LANDING is "true", "1", "on" or "yes" (any case, spaces trimmed).
 * Anything else, or nothing, keeps the page off. Never throws.
 */
export function isVoiceLandingOn(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const raw = env.VOICE_LANDING;
  return typeof raw === "string" && ON_VALUES.has(raw.trim().toLowerCase());
}

/**
 * Metadata of the page in one language. Off: noindex (the page itself answers 404).
 * On: the site's usual page metadata (canonical + hreflang for en/de/it + x-default, Open Graph).
 */
export function voiceLandingMetadata(locale: Locale, on: boolean = isVoiceLandingOn()): Metadata {
  if (!on) return { robots: { index: false, follow: false } };
  const meta = VOICE_LANDING[locale].meta;
  return {
    ...pageMetadata(locale, { title: meta.title, description: meta.description, basePath: VOICE_LANDING_PATH }),
    // The copy's title already names the product; the layout's " | Modolo Digital Studio" suffix
    // would push it past what a results page shows.
    title: { absolute: meta.title },
    robots: { index: true, follow: true },
  };
}

// What the service is, in the page's language (the words of the copy's meta titles).
const SERVICE_TYPE: Record<Locale, string> = {
  de: "KI-Telefonassistent",
  it: "Assistente telefonico AI",
  en: "AI phone assistant",
};

// Absolute URL for a locale-aware path, as in lib/json-ld.ts.
const abs = (path: string) => SITE.url + (path === "/" ? "" : path);

/**
 * schema.org graph of the page: the Service (provided by the organisation every other page
 * describes, same @id), the breadcrumb and the FAQ built from the copy's ten questions.
 *
 * Deliberately absent: offers, prices, ratings and reviews. There is no price list yet (the plans
 * block is a proposal the owner has not confirmed, and stays out of structured data even when it is
 * shown), and reviews hosted on the reviewed business's own site never qualify (see lib/json-ld.ts).
 */
export function voiceLandingGraph(locale: Locale) {
  const copy = VOICE_LANDING[locale];
  const url = abs(localizedHref(locale, VOICE_LANDING_PATH));
  const organizationId = `${SITE.url}/#organization`;
  return {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Organization", "@id": organizationId, name: SITE.name, url: SITE.url, logo: `${SITE.url}/logo-icon.png` },
      {
        "@type": "Service",
        "@id": `${url}#service`,
        name: VOICE_PRODUCT_NAME,
        serviceType: SERVICE_TYPE[locale],
        description: copy.meta.description,
        url,
        inLanguage: locale,
        provider: { "@id": organizationId },
        // The pilot region, as the copy states it.
        areaServed: [
          { "@type": "City", name: "Winterthur" },
          { "@type": "City", name: "Zürich" },
        ],
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: abs(localizedHref(locale, "/")) },
          { "@type": "ListItem", position: 2, name: VOICE_PRODUCT_NAME, item: url },
        ],
      },
      {
        "@type": "FAQPage",
        "@id": `${url}#faq`,
        inLanguage: locale,
        mainEntity: copy.faq.items.map((item) => ({
          "@type": "Question",
          name: item.q,
          acceptedAnswer: { "@type": "Answer", text: item.a },
        })),
      },
    ],
  };
}

export interface PageExamples {
  /** The example conversations to play, all in one language. */
  scripts: DemoScript[];
  /** Their language, or null when the business has none to offer. */
  locale: VoiceLocale | null;
  /** True when that language is not the page's: the page must say so. */
  otherLanguage: boolean;
}

/**
 * The example conversations of one demo business for a page in `locale`: the ones in the page's
 * language when the business has them, else the German ones (every demo business has German
 * examples; most have only those). Pure: the caller passes the scripts (server-side data).
 */
export function examplesForPage(all: readonly DemoScript[], tenantId: string, locale: Locale): PageExamples {
  const own = all.filter((script) => script.tenantId === tenantId);
  const same = own.filter((script) => script.locale === locale);
  if (same.length > 0) return { scripts: same, locale, otherLanguage: false };
  const german = own.filter((script) => script.locale === "de");
  if (german.length > 0) return { scripts: german, locale: "de", otherLanguage: true };
  return { scripts: [], locale: null, otherLanguage: false };
}
