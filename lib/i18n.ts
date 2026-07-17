// Single source of truth for locales and URL helpers.
// Pure module (no "use client", no Next-only imports) so it is safe to import from
// proxy.ts, server pages, generateMetadata, JSON-LD builders AND client components.
//
// URL scheme: the default locale (en) lives WITHOUT a prefix at the site root
// (/, /servizi/web, /impressum); de/it are prefixed (/de, /de/servizi/web). This
// preserves the already-indexed English URLs. proxy.ts enforces the scheme.

export const LOCALES = ["en", "de", "it"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(value: string | undefined | null): value is Locale {
  return value != null && (LOCALES as readonly string[]).includes(value);
}

// OpenGraph `og:locale` codes per locale. de_CH targets German-speaking Switzerland.
export const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  de: "de_CH",
  it: "it_IT",
};

// `lang` attribute for the <html> element per locale (regional variant for Swiss German).
export const HTML_LANG: Record<Locale, string> = {
  en: "en",
  de: "de-CH",
  it: "it",
};

// Localized URL slugs. Physical route folders stay canonical (servizi/prezzi/privacy);
// this maps each canonical folder name to the public slug shown per locale.
// Keep in sync with the folder names under app/[lang]/*.
export const SLUG_TRANSLATIONS: Record<string, Record<Locale, string>> = {
  servizi: { en: "services", de: "leistungen", it: "servizi" },
  prezzi: { en: "pricing", de: "preise", it: "prezzi" },
  privacy: { en: "privacy", de: "datenschutz", it: "privacy" },
};

// Reverse lookup: any public slug -> canonical folder segment.
const CANONICAL_SEGMENT: Record<string, string> = Object.fromEntries(
  Object.entries(SLUG_TRANSLATIONS).flatMap(([canon, byLocale]) =>
    Object.values(byLocale).map((slug) => [slug, canon]),
  ),
);

function replaceFirstSegment(pathname: string, next: string): string {
  const parts = pathname.split("/"); // ["", seg, ...rest]
  if (parts.length > 1) parts[1] = next;
  return parts.join("/");
}

// Canonical folder -> localized public slug for a locale (identity when unmapped).
function localizeFirstSegment(locale: Locale, pathname: string): string {
  const seg = pathname.split("/")[1] ?? "";
  const translated = SLUG_TRANSLATIONS[seg]?.[locale];
  return translated ? replaceFirstSegment(pathname, translated) : pathname;
}

// Public (localized) path -> canonical path used by the physical routes (identity when unmapped).
export function canonicalizeSlugPath(pathname: string): string {
  const seg = pathname.split("/")[1] ?? "";
  const canon = CANONICAL_SEGMENT[seg];
  return canon && canon !== seg ? replaceFirstSegment(pathname, canon) : pathname;
}

// Build a public href for a locale-agnostic base path.
//   localizedHref("en", "/")             -> "/"
//   localizedHref("de", "/")             -> "/de"
//   localizedHref("en", "/servizi/web")  -> "/servizi/web"
//   localizedHref("de", "/servizi/web")  -> "/de/servizi/web"
//   localizedHref("de", "/#contatti")    -> "/de#contatti"
//   localizedHref(_,    "#servizi")      -> "#servizi"   (same-page anchor, locale-agnostic)
export function localizedHref(locale: Locale, path: string = "/"): string {
  if (path.startsWith("#")) return path; // same-page anchor

  const hashIndex = path.indexOf("#");
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  let pathname = hashIndex >= 0 ? path.slice(0, hashIndex) : path;

  if (pathname === "") pathname = "/";
  if (!pathname.startsWith("/")) pathname = "/" + pathname;
  pathname = localizeFirstSegment(locale, pathname); // /servizi/web -> /leistungen/web (de)

  if (locale === DEFAULT_LOCALE) {
    return pathname + hash;
  }
  const prefixed = pathname === "/" ? `/${locale}` : `/${locale}${pathname}`;
  return prefixed + hash;
}

// Remove a leading locale prefix from a pathname, returning the locale-agnostic base path.
//   "/de/servizi/web" -> "/servizi/web"   "/de" -> "/"   "/servizi/web" -> "/servizi/web"
export function stripLocale(pathname: string): string {
  const segments = pathname.split("/"); // e.g. ["", "de", "servizi", "web"]
  if (isLocale(segments[1])) {
    const rest = "/" + segments.slice(2).join("/");
    return rest === "/" ? "/" : rest.replace(/\/+$/, "");
  }
  return pathname || "/";
}

// Locale implied by a pathname's first segment (DEFAULT_LOCALE when unprefixed).
export function localeFromPathname(pathname: string): Locale {
  const seg = pathname.split("/")[1];
  return isLocale(seg) ? seg : DEFAULT_LOCALE;
}

// Accept-Language negotiation lives in proxy.ts (negotiateLocale): on a first visit with no
// NEXT_LOCALE cookie, de/de-CH -> /de (German is the primary experience on the .ch domain);
// English stays the clean-URL fallback / x-default. An explicit NEXT_LOCALE cookie always
// suppresses negotiation.

// `alternates` block for Metadata: canonical of the current locale + hreflang for all
// locales + x-default. Relative paths are resolved to absolute URLs via `metadataBase`.
export function buildAlternates(locale: Locale, basePath: string = "/") {
  return {
    canonical: localizedHref(locale, basePath),
    languages: {
      en: localizedHref("en", basePath),
      de: localizedHref("de", basePath),
      it: localizedHref("it", basePath),
      // Swiss-first: the language-neutral fallback points at German, not English.
      "x-default": localizedHref("de", basePath),
    },
  };
}

