import type { MetadataRoute } from "next";
import { SITE, SERVICE_SLUGS } from "@/lib/site";
import { LOCALES, localizedHref } from "@/lib/i18n";
import { LOCAL_CITIES } from "@/lib/local-seo";
import { isVoiceLandingOn, VOICE_LANDING_PATH } from "@/lib/voice/landing";

// Absolute URL for a locale-aware path. abs("/") -> SITE.url ; abs("/de") -> SITE.url + "/de".
const abs = (path: string) => SITE.url + (path === "/" ? "" : path);

type ChangeFrequency = NonNullable<MetadataRoute.Sitemap[number]["changeFrequency"]>;

// Locale-agnostic base paths with their crawl hints.
const PAGES: { path: string; changeFrequency: ChangeFrequency; priority: number }[] = [
  { path: "/", changeFrequency: "monthly", priority: 1 },
  { path: "/prezzi", changeFrequency: "monthly", priority: 0.9 },
  ...SERVICE_SLUGS.map((slug) => ({
    path: `/servizi/${slug}`,
    changeFrequency: "monthly" as ChangeFrequency,
    priority: 0.8,
  })),
  ...LOCAL_CITIES.map((city) => ({
    path: `/webdesign/${city}`,
    changeFrequency: "monthly" as ChangeFrequency,
    priority: 0.7,
  })),
  { path: "/impressum", changeFrequency: "yearly", priority: 0.3 },
  { path: "/privacy", changeFrequency: "yearly", priority: 0.3 },
];

function languagesFor(path: string) {
  return {
    en: abs(localizedHref("en", path)),
    de: abs(localizedHref("de", path)),
    it: abs(localizedHref("it", path)),
    // Swiss-first: keep consistent with buildAlternates() in lib/i18n.ts.
    "x-default": abs(localizedHref("de", path)),
  };
}

// The voice sales page is listed only while its switch is on: read here, at call
// time, so the sitemap and the page (which answers 404 when off) can never disagree.
const VOICE_PAGE = { path: VOICE_LANDING_PATH, changeFrequency: "monthly" as ChangeFrequency, priority: 0.8 };

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const pages = isVoiceLandingOn() ? [...PAGES, VOICE_PAGE] : PAGES;
  return pages.flatMap((p) =>
    LOCALES.map((locale) => ({
      url: abs(localizedHref(locale, p.path)),
      lastModified: now,
      changeFrequency: p.changeFrequency,
      priority: p.priority,
      alternates: { languages: languagesFor(p.path) },
    }))
  );
}
