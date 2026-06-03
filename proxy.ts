import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { DEFAULT_LOCALE, isLocale } from "@/lib/i18n";
import { REGION_COOKIE, DEFAULT_REGION } from "@/lib/region";

// Locale routing (Next 16 renamed "middleware" → "proxy").
// URL scheme: default locale (en) is served WITHOUT a prefix at the root; de/it are prefixed.
//   /              -> rewrite to /en        (clean English URL, no redirect)
//   /servizi/web   -> rewrite to /en/servizi/web
//   /de, /it ...   -> pass through
//   /en, /en/...   -> 308 redirect to the unprefixed equivalent (canonicalize)
// A returning visitor's EXPLICIT choice (NEXT_LOCALE cookie) redirects unprefixed → /de|/it.
// We deliberately do NOT redirect on Accept-Language: bouncing the canonical English URL on a
// request header would push crawlers/first-time visitors off it and hurt SEO.

const COOKIE = "NEXT_LOCALE";
const ONE_YEAR = 60 * 60 * 24 * 365;

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

  // 2) Explicitly-prefixed non-default locale (/de, /it): serve as-is, remember the choice.
  if (isLocale(firstSegment)) {
    const res = NextResponse.next();
    res.cookies.set(COOKIE, firstSegment, { path: "/", maxAge: ONE_YEAR, sameSite: "lax" });
    return ensureRegion(request, res);
  }

  // 3) Unprefixed path = default-locale (en) territory.
  // Honour only an explicit prior choice (cookie) — never Accept-Language (see header note).
  const cookieLocale = request.cookies.get(COOKIE)?.value;
  if (isLocale(cookieLocale) && cookieLocale !== DEFAULT_LOCALE) {
    const url = request.nextUrl.clone();
    url.pathname = `/${cookieLocale}${pathname === "/" ? "" : pathname}`;
    return NextResponse.redirect(url, 307);
  }

  // Default: serve English on the clean URL by rewriting to the internal /en tree.
  const url = request.nextUrl.clone();
  url.pathname = `/${DEFAULT_LOCALE}${pathname === "/" ? "" : pathname}`;
  return ensureRegion(request, NextResponse.rewrite(url));
}

export const config = {
  // Run on everything except Next internals, API routes and files with an extension
  // (/_next/*, /sitemap.xml, /robots.txt, /og-image.png, /favicon.ico, ...).
  matcher: ["/((?!_next|api|.*\\..*).*)"],
};
