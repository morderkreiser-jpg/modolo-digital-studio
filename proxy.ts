import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  DEFAULT_LOCALE,
  isLocale,
  localizedHref,
  canonicalizeSlugPath,
  type Locale,
} from "@/lib/i18n";
import { REGION_COOKIE, DEFAULT_REGION } from "@/lib/region";

// Locale routing (Next 16 renamed "middleware" → "proxy").
// URL scheme: default locale (en) is served WITHOUT a prefix at the root; de/it are prefixed.
// Public slugs are localized (/de/leistungen, /pricing, ...) while the physical route folders
// stay canonical (servizi/prezzi/privacy); canonicalizeSlugPath maps public → physical.
//   /              -> negotiate, else rewrite to /en          (clean English URL)
//   /pricing       -> rewrite to /en/prezzi
//   /de/leistungen -> rewrite to /de/servizi                  (public slug → physical folder)
//   /en, /en/...   -> 308 redirect to the unprefixed equivalent (canonicalize the default locale)
// First visit with NO stored choice: Accept-Language decides. German (de/de-CH) is the primary
// experience on the .ch domain; anything else (incl. crawlers with no header) stays on English,
// which remains the clean-URL fallback / x-default. An EXPLICIT choice (NEXT_LOCALE cookie,
// even =en) always suppresses negotiation.

const COOKIE = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

// Best supported locale from an Accept-Language header, honouring q-values. Returns
// DEFAULT_LOCALE (en) when nothing matches, so English stays the negotiation fallback.
function negotiateLocale(header: string | null): Locale {
  if (!header) return DEFAULT_LOCALE;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      const weight = q ? Number.parseFloat(q.split("=")[1]) : 1;
      return { base: tag.trim().toLowerCase().split("-")[0], weight: Number.isNaN(weight) ? 0 : weight };
    })
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  for (const { base } of ranked) {
    if (isLocale(base)) return base; // "de-ch" -> "de", "it-it" -> "it", "en-us" -> "en"
  }
  return DEFAULT_LOCALE;
}

// Set the pricing-region cookie from the visitor's country (Vercel geo header) on first
// visit, unless they already have one (an explicit currency-toggle choice persists).
// IT visitors -> Italian/EUR prices; everyone else -> Swiss/CHF.
function ensureRegion(request: NextRequest, res: NextResponse) {
  if (!request.cookies.get(REGION_COOKIE)) {
    const country = request.headers.get("x-vercel-ip-country");
    res.cookies.set(REGION_COOKIE, country === "IT" ? "it" : DEFAULT_REGION, {
      path: "/",
      maxAge: ONE_YEAR,
      sameSite: "lax",
    });
  }
  return res;
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split("/")[1];

  // 1) Canonicalize the default locale: /en or /en/... -> strip the prefix.
  if (firstSegment === DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = pathname.slice(DEFAULT_LOCALE.length + 1) || "/";
    const res = NextResponse.redirect(url, 308);
    res.cookies.set(COOKIE, DEFAULT_LOCALE, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
    return res;
  }

  // 2) Explicitly-prefixed non-default locale (/de, /it): map the public slug to the physical
  //    folder and serve, remembering the choice. /de/leistungen -> rewrite to /de/servizi.
  if (isLocale(firstSegment)) {
    const rest = pathname.slice(firstSegment.length + 1) || "/"; // drop "/de"
    const canon = canonicalizeSlugPath(rest); // /leistungen/web -> /servizi/web
    const url = request.nextUrl.clone();
    url.pathname = `/${firstSegment}${canon === "/" ? "" : canon}`;
    const res = canon === rest ? NextResponse.next() : NextResponse.rewrite(url);
    res.cookies.set(COOKIE, firstSegment, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
    return ensureRegion(request, res);
  }

  // 3) Unprefixed path = default-locale (en) territory.
  const cookieLocale = request.cookies.get(COOKIE)?.value;

  // 3a) Explicit stored choice (de/it) -> redirect to its localized, prefixed URL.
  if (isLocale(cookieLocale) && cookieLocale !== DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = localizedHref(cookieLocale, canonicalizeSlugPath(pathname));
    return NextResponse.redirect(url, 307);
  }

  // 3b) No stored choice -> negotiate Accept-Language (German primary on .ch). Redirect only to
  //     a prefixed locale (/de|/it), which re-enters via case 1/2, never case 3 — so no loop.
  if (!cookieLocale) {
    const preferred = negotiateLocale(request.headers.get("accept-language"));
    if (preferred !== DEFAULT_LOCALE) {
      const url = request.nextUrl.clone();
      url.pathname = localizedHref(preferred, canonicalizeSlugPath(pathname));
      return NextResponse.redirect(url, 307); // 307 temporary: never pins "/" → /de in a cache
    }
  }

  // 3c) Fallback: serve English on the clean URL by rewriting to the internal /en tree.
  const canon = canonicalizeSlugPath(pathname); // /pricing -> /prezzi
  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${canon === "/" ? "" : canon}`;
  return ensureRegion(request, NextResponse.rewrite(url));
}

export const config = {
  // Run on everything except Next internals, API routes and files with an extension
  // (/_next/*, /sitemap.xml, /robots.txt, /og-image.png, /favicon.ico, ...).
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
