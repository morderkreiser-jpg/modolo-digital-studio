import type { Metadata } from "next";
import { SITE } from "./site";
import { OG_LOCALE, LOCALES, localizedHref, buildAlternates, type Locale } from "./i18n";

// Complete Metadata for a non-home page.
// Next REPLACES the whole `openGraph` / `twitter` object when a child segment defines it
// (nested fields are not deep-merged), so every page must supply image/locale/siteName
// itself rather than relying on inheriting the [lang] layout's defaults.
export function pageMetadata(
  locale: Locale,
  opts: { title: string; description: string; basePath: string }
): Metadata {
  const { title, description, basePath } = opts;
  return {
    title,
    description,
    alternates: buildAlternates(locale, basePath),
    openGraph: {
      type: "website",
      locale: OG_LOCALE[locale],
      alternateLocale: LOCALES.filter((l) => l !== locale).map((l) => OG_LOCALE[l]),
      url: localizedHref(locale, basePath),
      siteName: SITE.name,
      title,
      description,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: SITE.name }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: ["/og-image.png"],
    },
  };
}
