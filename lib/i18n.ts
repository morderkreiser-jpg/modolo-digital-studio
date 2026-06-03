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

// OpenGraph `og:locale` codes per locale.
export const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  de: "de_DE",
  it: "it_IT",
};

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

// (Accept-Language negotiation was intentionally removed: proxy.ts redirects only on an
// explicit NEXT_LOCALE cookie, never on request headers, to keep the canonical English URL
// reachable by crawlers and first-time visitors.)

// `alternates` block for Metadata: canonical of the current locale + hreflang for all
// locales + x-default. Relative paths are resolved to absolute URLs via `metadataBase`.
export function buildAlternates(locale: Locale, basePath: string = "/") {
  return {
    canonical: localizedHref(locale, basePath),
    languages: {
      en: localizedHref("en", basePath),
      de: localizedHref("de", basePath),
      it: localizedHref("it", basePath),
      "x-default": localizedHref("en", basePath),
    },
  };
}

