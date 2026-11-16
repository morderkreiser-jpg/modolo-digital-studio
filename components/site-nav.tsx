"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useState,
  useEffect,
  useRef,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type SVGProps,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { Menu, X, ChevronDown } from "lucide-react";
import { LOCALES, localizedHref, stripLocale, canonicalizeSlugPath, type Locale } from "@/lib/i18n";
import { NAV_COPY, NAV_LINK_HREF, NAV_DRAWER_HREF } from "@/content/home/nav";
import { PREFILL } from "@/content/home/prefills";
import { waHref } from "@/lib/whatsapp";
import { useRegion } from "@/components/use-region";

type NavLink = { href: string; label: string };

// Language names shown in the dropdown, each in its own language.
const LANG_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch", it: "Italiano" };
const LANG_ROW_H = 40; // px — height of one language row; the gold ruler tick slides in multiples of this.

// Small inline SVG flags (emoji flags don't render on Windows — they show the letters). DE uses
// the SWISS flag on purpose: the German site targets Swiss clients, so it reinforces "local".
function Flag({ code }: { code: Locale }) {
  const cls = "h-[13px] w-[19px] shrink-0 rounded-[2px] overflow-hidden ring-1 ring-black/10";
  if (code === "it")
    return (
      <svg viewBox="0 0 20 14" className={cls} aria-hidden="true">
        <rect width="20" height="14" fill="#fff" />
        <rect width="6.67" height="14" fill="#009246" />
        <rect x="13.33" width="6.67" height="14" fill="#CE2B37" />
      </svg>
    );
  if (code === "de")
    return (
      <svg viewBox="0 0 20 14" className={cls} aria-hidden="true">
        <rect width="20" height="14" fill="#D52B1E" />
        <rect x="8.3" y="2.6" width="3.4" height="8.8" fill="#fff" />
        <rect x="5.4" y="5.3" width="9.2" height="3.4" fill="#fff" />
      </svg>
    );
  return (
    // Union Jack (English)
    <svg viewBox="0 0 20 14" className={cls} aria-hidden="true">
      <rect width="20" height="14" fill="#012169" />
      <path d="M0,0 L20,14 M20,0 L0,14" stroke="#fff" strokeWidth="3" />
      <path d="M0,0 L20,14 M20,0 L0,14" stroke="#C8102E" strokeWidth="1.5" />
      <rect x="8" width="4" height="14" fill="#fff" />
      <rect y="5" width="20" height="4" fill="#fff" />
      <rect x="8.75" width="2.5" height="14" fill="#C8102E" />
      <rect y="5.75" width="20" height="2.5" fill="#C8102E" />
    </svg>
  );
}

/** WhatsApp glyph. Decorative: the link text carries the accessible name. */
export function WhatsAppGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.06c-.25.69-1.45 1.32-2 1.36-.51.04-1.16.06-1.87-.12-.43-.11-.99-.33-1.7-.64-3-1.3-4.96-4.32-5.11-4.52-.15-.2-1.22-1.62-1.22-3.09 0-1.47.77-2.19 1.04-2.49.27-.3.59-.37.79-.37.2 0 .39 0 .57.01.18.01.43-.07.67.51.25.6.84 2.07.91 2.22.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.39-.44.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.03 1.12 1 2.06 1.31 2.36 1.46.3.15.47.12.65-.07.17-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.72.81 2.02.96.3.15.5.22.57.35.07.12.07.72-.18 1.41z" />
    </svg>
  );
}

// Persist the chosen locale so proxy.ts keeps the visitor in it on later visits.
// Module-level (not inside the component) so it stays a plain browser side effect.
function rememberLocale(locale: Locale) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

// Localized accessibility strings that COPY.md does not own (menu / dialog labels).
// (Swiss German spelling: "ss" rather than "ß".)
const NAV_A11Y: Record<Locale, { language: string; siteMenu: string }> = {
  en: { language: "Language", siteMenu: "Site menu" },
  de: { language: "Sprache", siteMenu: "Seitenmenü" },
  it: { language: "Lingua", siteMenu: "Menu del sito" },
};

// ---------------------------------------------------------------------------------------------
// Where the film ends. Shared with components/home/sticky-bar.tsx.
//
// Contract with the homepage hero: its <section> carries `data-nav-overlay`. The film "ends" where
// the next in-flow element starts (section 01 is a cream sheet that overlaps the hero by 28/20 px),
// or at an explicit `[data-nav-overlay-end]` sentinel if one exists. One IntersectionObserver on the
// hero with the top root margin pushed down by (nav height + overlap) flips exactly when section 01's
// top edge passes the nav's bottom edge. Without hero markup: scrollY > innerHeight − 64 = past it.

const FILM_SEL = "[data-nav-overlay]";
const FILM_END_SEL = "[data-nav-overlay-end]";

function navHeight(): number {
  const el = document.querySelector<HTMLElement>("[data-site-nav]");
  if (el && el.offsetHeight > 0) return el.offsetHeight;
  return window.matchMedia("(min-width: 768px)").matches ? 80 : 64;
}

function sheetOverlap(hero: HTMLElement): number {
  const bottom = hero.getBoundingClientRect().bottom;
  const explicit = document.querySelector<HTMLElement>(FILM_END_SEL);
  if (explicit) return Math.min(200, Math.max(0, bottom - explicit.getBoundingClientRect().top));
  let next = hero.nextElementSibling;
  while (next && next.getBoundingClientRect().height === 0) next = next.nextElementSibling;
  if (!next) return 0;
  return Math.min(120, Math.max(0, bottom - next.getBoundingClientRect().top));
}

function subscribeScroll(cb: () => void) {
  window.addEventListener("scroll", cb, { passive: true });
  window.addEventListener("resize", cb);
  return () => {
    window.removeEventListener("scroll", cb);
    window.removeEventListener("resize", cb);
  };
}
const subscribeNothing = () => () => {};
const fallbackOnFilm = () => window.scrollY <= window.innerHeight - 64;
const scrolledPastTop = () => window.scrollY > 8;
const serverTrue = () => true;
const serverFalse = () => false;

/** True while the strip right under the nav still shows the hero film. SSR: true. */
export function useFilmZone(enabled = true): boolean {
  const [ioOnFilm, setIoOnFilm] = useState<boolean | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const hero = document.querySelector<HTMLElement>(FILM_SEL);
    if (!hero) return; // fallback store below
    let io: IntersectionObserver | null = null;
    let raf = 0;
    const build = () => {
      io?.disconnect();
      const top = Math.round(navHeight() + sheetOverlap(hero));
      io = new IntersectionObserver(([entry]) => setIoOnFilm(entry.isIntersecting), {
        rootMargin: `-${top}px 0px 0px 0px`,
        threshold: 0,
      });
      io.observe(hero);
    };
    build();
    // Nav height (64 ↔ 80 at 768 px) and the sheet overlap (20 ↔ 28 at PORTRAIT_MQ) change with the
    // viewport: rebuild on resize (an orientation change fires resize too).
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(build);
    };
    window.addEventListener("resize", onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      io?.disconnect();
    };
  }, [enabled]);
  const fallback = useSyncExternalStore(enabled ? subscribeScroll : subscribeNothing, fallbackOnFilm, serverTrue);
  return enabled ? (ioOnFilm ?? fallback) : false;
}

type Mode = "light" | "film-top" | "film-scrolled" | "cream";

export default function SiteNav({
  lang,
  links = [],
  ctaHref = "/#contatti",
  ctaLabel,
  overlay = false,
}: {
  lang: Locale;
  /** Inner pages only. In `overlay` mode the homepage links come from content/home/nav.ts. */
  links?: NavLink[];
  ctaHref?: string;
  ctaLabel?: string;
  /** Inner pages pass "light" (the only palette for the solid bar). Kept for call-site compatibility. */
  theme?: "light";
  /**
   * Homepage only: transparent over the hero film → solid espresso once scrolled (still over the
   * film) → today's cream bar after the film. Brings its own links, WhatsApp pill and drawer.
   */
  overlay?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [langHover, setLangHover] = useState<Locale | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const region = useRegion();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasMenu = overlay || links.length > 0;
  const a = NAV_A11Y[lang];
  const t = NAV_COPY[lang];

  const onFilm = useFilmZone(overlay);
  const scrolled = useSyncExternalStore(overlay ? subscribeScroll : subscribeNothing, scrolledPastTop, serverFalse);
  const mode: Mode = !overlay ? "light" : onFilm ? (scrolled ? "film-scrolled" : "film-top") : "cream";
  const film = mode === "film-top" || mode === "film-scrolled";

  // Inner pages: exactly today's light bar. Homepage (overlay): film palette over the hero, the same
  // light bar after it. The drawer and the language panel always use the light palette.
  const c = {
    nav: "bg-[#F7F3EC]/80 border-[#1F1B16]/[0.08]",
    word: "text-[#1F1B16]",
    sub: "text-[var(--color-gold-ink)]",
    link: "text-[#1F1B16]/65 hover:text-[#1F1B16]",
    tBorder: "border-[#1F1B16]/12",
    tActive: "bg-[#1F1B16] text-[var(--paper)]",
    tIdle: "text-[#1F1B16]/70 hover:text-[#1F1B16]",
    cta: "border-[#B5893F]/50 text-[var(--color-gold-ink)] hover:bg-[#1F1B16] hover:text-[var(--paper)] hover:border-[#1F1B16]",
    trigger: "border-[#1F1B16]/12 text-[#1F1B16]",
  };
  const o = {
    nav:
      mode === "film-top"
        ? "bg-transparent border-transparent"
        : mode === "film-scrolled"
          ? "bg-[#17130e] border-[#f6f1e7]/[0.08]"
          : "bg-[#F7F3EC]/80 border-[#1F1B16]/[0.08] backdrop-blur-xl",
    word: film ? "text-[#f6f1e7] font-normal" : "text-[#1F1B16] font-light",
    sub: film ? "text-[#e8c877]" : "text-[var(--color-gold-ink)]",
    link: film
      ? "text-[#f6f1e7]/[0.92] hover:text-[#f6f1e7] decoration-[#e8c877]"
      : "text-[#1F1B16]/75 hover:text-[#1F1B16] decoration-[#b5893f]",
    tBorder: film ? "border-[#f6f1e7]/30" : "border-[#1F1B16]/12",
    tActive: film ? "bg-[#f6f1e7] text-[#17130e]" : "bg-[#1F1B16] text-[var(--paper)]",
    tIdle: film ? "text-[#f6f1e7]/[0.92] hover:text-[#f6f1e7]" : "text-[#1F1B16]/75 hover:text-[#1F1B16]",
    trigger: film ? "border-[#f6f1e7]/30 text-[#f6f1e7]" : "border-[#1F1B16]/12 text-[#1F1B16]",
    // The global ring (#7e5d24) is 3:1 on espresso and lost on a mid-tone frame: gold ring on the film.
    focus: film ? "focus-visible:outline-[#e8c877] focus-visible:outline-offset-[3px]" : "",
    // Extra legibility over bright frames while the bar is transparent (the hero owns the top scrim).
    shadow: mode === "film-top" ? "[text-shadow:0_1px_14px_rgb(23_19_14/0.55)]" : "",
  };
  const fade = "transition-colors duration-200 motion-reduce:transition-none";
  const wa = waHref(PREFILL[lang].nav, region);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // The homepage sticky bar hides while the menu is open.
    window.dispatchEvent(new Event("mds:menu-open"));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        const f = panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (f.length === 0) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    panelRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener("keydown", onKey);
      window.dispatchEvent(new Event("mds:menu-close"));
      trigger?.focus();
    };
  }, [open]);

  // Close the language ruler on an outside click or Escape.
  useEffect(() => {
    if (!langOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest?.("[data-lang-dd]")) setLangOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLangOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [langOpen]);

  // Logo click: on the home page the link points to the route we're already on, and
  // Next.js <Link> keeps the scroll position when the Page is still in the viewport — so the
  // tap feels dead (it never returns to the top, as reported on mobile). Intercept it and
  // smooth-scroll to the top ourselves. On any other page, fall through and let the Link
  // navigate home (Next scrolls to the top there, since the home Page isn't yet in view).
  const handleLogoClick = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    if (stripLocale(pathname) !== "/") return;
    e.preventDefault();
    setOpen(false);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  // Switch language by navigating to the localized URL (lang is part of the route now).
  // The cookie lets proxy.ts keep the visitor in this locale on later visits.
  const switchLocale = (target: Locale) => {
    setOpen(false);
    setLangOpen(false);
    if (target === lang) return;
    rememberLocale(target);
    // usePathname returns the localized public path (e.g. /de/leistungen/web); canonicalize
    // the slug before re-localizing it for the target locale.
    router.push(localizedHref(target, canonicalizeSlugPath(stripLocale(pathname))));
  };

  // Language switcher as the site's "Measure" ruler: a hairline rail with a gold tick that
  // slides to the current (or hovered) language — a signature detail, not a stock dropdown.
  // CSS transitions only (no framer on the homepage); the panel stays mounted and is inert when closed.
  const markedIndex = Math.max(0, LOCALES.indexOf(langHover ?? lang));
  const langMenu = () => (
    <div data-lang-dd className="relative">
      <button
        type="button"
        onClick={() => setLangOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={langOpen}
        aria-label={t.langButtonAria}
        className={
          overlay
            ? `relative flex h-10 items-center gap-1.5 border ${o.tBorder} rounded-full px-3 text-[11px] md:px-3.5 md:text-xs uppercase tracking-[0.18em] ${fade} ${
                langOpen ? o.tActive : o.tIdle
              } ${o.focus} after:absolute after:inset-x-0 after:-inset-y-[2px] after:content-['']`
            : `relative flex items-center gap-1.5 border ${c.tBorder} rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.18em] transition-colors after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] ${
                langOpen ? c.tActive : c.tIdle
              }`
        }
        style={{ fontFamily: "var(--font-space), sans-serif" }}
      >
        <Flag code={lang} />
        {lang}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-300 ${langOpen ? "rotate-180" : ""}`}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </button>
      <div
        role="menu"
        aria-label={a.language}
        inert={!langOpen}
        className={`absolute right-0 mt-3 min-w-[11rem] rounded-2xl border p-2 shadow-xl z-[70] bg-[#F7F3EC] border-[#1F1B16]/10 transition-[opacity,translate,visibility] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          langOpen ? "visible opacity-100 translate-y-0" : "invisible opacity-0 -translate-y-2"
        }`}
      >
        <div className="relative">
          {/* the ruler rail */}
          <span aria-hidden="true" className="absolute left-1 top-1.5 bottom-1.5 w-px bg-[#1F1B16]/15" />
          {/* the gold tick that slides to the marked language */}
          <span
            aria-hidden="true"
            className="absolute left-[3px] w-[2px] rounded-full bg-[var(--color-gold)] transition-transform duration-300 ease-[cubic-bezier(0.34,1.4,0.64,1)] motion-reduce:transition-none"
            style={{ top: (LANG_ROW_H - 20) / 2, height: 20, transform: `translateY(${markedIndex * LANG_ROW_H}px)` }}
          />
          {LOCALES.map((l) => {
            const active = lang === l;
            return (
              <button
                key={l}
                type="button"
                role="menuitem"
                lang={l}
                onClick={() => switchLocale(l)}
                onMouseEnter={() => setLangHover(l)}
                onMouseLeave={() => setLangHover(null)}
                onFocus={() => setLangHover(l)}
                onBlur={() => setLangHover(null)}
                aria-current={active ? "true" : undefined}
                className={`group relative flex h-10 w-full items-center justify-between gap-6 rounded-lg pl-5 pr-3 transition-colors ${
                  active ? "text-[var(--color-gold-ink)]" : c.tIdle
                } hover:bg-[#1F1B16]/[0.04]`}
              >
                <span className="flex items-center gap-2.5">
                  <Flag code={l} />
                  <span className={`text-sm tracking-wide ${active ? "font-medium" : "font-light"}`}>{LANG_NAMES[l]}</span>
                </span>
                {/* the code repeats the name: hidden from AT; ink ≥ .62 for AA at 10 px */}
                <span
                  aria-hidden="true"
                  className={`text-[10px] uppercase tracking-[0.22em] ${active ? "" : "text-[#1F1B16]/[0.62]"}`}
                  style={{ fontFamily: "var(--font-space), sans-serif" }}
                >
                  {l}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );

  // Logo link: the visible wordmark is the accessible name (no aria-label → no label/content
  // mismatch), with a real space between the two words (a text node: not rendered between flex
  // items, so nothing moves) and an sr-only ", Startseite".
  const logo = (
    <Link
      href={localizedHref(lang, "/")}
      onClick={handleLogoClick}
      className={`flex items-center gap-2 sm:gap-3 flex-shrink-0 ${overlay ? `${o.focus} ${o.shadow}` : ""}`}
    >
      {overlay ? (
        // Both marks are rendered and cross-faded (a src swap would fetch on first scroll and flicker).
        <span className="relative block h-9 w-9 shrink-0">
          <Image
            src="/logo-mark-light.png"
            alt=""
            width={36}
            height={36}
            loading="eager"
            className={`absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${film ? "opacity-100" : "opacity-0"}`}
          />
          <Image
            src="/logo-mark.png"
            alt=""
            width={36}
            height={36}
            loading="eager"
            className={`absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${film ? "opacity-0" : "opacity-100"}`}
          />
        </span>
      ) : (
        <Image src="/logo-mark.png" alt="" width={36} height={36} loading="eager" />
      )}
      <span className="flex flex-col leading-tight">
        <span className={`tracking-[0.25em] text-xs sm:text-sm ${overlay ? `${o.word} ${fade}` : `font-light ${c.word}`}`}>
          MODOLO
        </span>{" "}
        <span className={`text-[10px] tracking-[0.3em] sr-only sm:not-sr-only ${overlay ? `${o.sub} ${fade}` : c.sub}`}>
          DIGITAL STUDIO
        </span>
      </span>
      <span className="sr-only">{t.logoSrOnly}</span>
    </Link>
  );

  const burger = (
    <button
      ref={triggerRef}
      type="button"
      aria-label={open ? t.burgerClose : t.burgerOpen}
      aria-expanded={open}
      aria-controls="mobile-menu"
      onClick={() => setOpen((v) => !v)}
      className={
        overlay
          ? `relative inline-flex lg:hidden w-10 h-10 items-center justify-center rounded-full border ${o.trigger} ${fade} ${o.focus} after:absolute after:-inset-[2px] after:rounded-full after:content-['']`
          : `relative inline-flex w-10 h-10 items-center justify-center rounded-full border ${c.trigger} after:absolute after:-inset-[2px] after:rounded-full after:content-['']`
      }
    >
      {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
    </button>
  );

  return (
    <>
      {overlay ? (
        <nav
          data-site-nav
          data-nav-mode={film ? "film" : "light"}
          className={`fixed top-0 left-0 right-0 z-50 h-16 md:h-20 border-b transition-[background-color,border-color] duration-200 motion-reduce:transition-none ${o.nav}`}
        >
          <div className="h-full px-5 min-[600px]:px-6 md:px-8 lg:px-10 xl:px-16 flex items-center justify-between gap-3">
            {logo}

            {/* One right cluster, one language menu. Links from 1024 px (at 768 the German row wraps);
                WhatsApp pill from 768 px; below 1024 px the burger opens the drawer (WhatsApp first). */}
            <div className="flex items-center gap-2.5 md:gap-4 xl:gap-6">
              <ul className={`hidden lg:flex items-center gap-6 xl:gap-7 ${o.shadow}`}>
                {(Object.keys(NAV_LINK_HREF) as (keyof typeof NAV_LINK_HREF)[]).map((k) => (
                  <li key={k}>
                    <a
                      href={NAV_LINK_HREF[k]}
                      className={`whitespace-nowrap text-sm font-medium tracking-wide underline-offset-[7px] decoration-1 hover:underline ${o.link} ${fade} ${o.focus}`}
                    >
                      {t.links[k]}
                    </a>
                  </li>
                ))}
              </ul>
              {langMenu()}
              <a
                href={wa}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${t.whatsappVisible}${t.whatsappSrOnly}`}
                className={`relative isolate hidden md:inline-flex h-10 items-center gap-2 overflow-hidden rounded-full border px-4 text-sm font-medium tracking-wide whitespace-nowrap ${fade} ${
                  film
                    ? "border-[#f6f1e7]/50 text-[#f6f1e7] hover:border-[#f6f1e7] hover:bg-[#f6f1e7]/10"
                    : "border-transparent text-[#17130e] hover:shadow-[0_6px_18px_-6px_rgb(126_93_36/0.55)]"
                } ${o.focus}`}
              >
                <span
                  aria-hidden="true"
                  className={`absolute inset-0 -z-10 bg-[linear-gradient(100deg,#e8c877,#b5893f)] transition-opacity duration-200 motion-reduce:transition-none ${
                    film ? "opacity-0" : "opacity-100"
                  }`}
                />
                <WhatsAppGlyph className="h-4 w-4 shrink-0" />
                {/* Name = "WhatsApp-Nachricht schreiben" (COPY §17). An sr-only span after the visible
                    word makes Chrome insert a space ("WhatsApp -Nachricht"), so the name is an
                    aria-label that starts with the visible text (label-in-name holds). */}
                <span>{t.whatsappVisible}</span>
              </a>
              {burger}
            </div>
          </div>
        </nav>
      ) : (
        <nav data-site-nav data-nav-mode="light" className={`fixed top-0 left-0 right-0 z-50 backdrop-blur-xl border-b ${c.nav}`}>
          <div className="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-16 py-4 sm:py-5 flex items-center justify-between gap-2">
            {logo}

            {/* Desktop cluster */}
            <div className="hidden md:flex items-center gap-5">
              {links.map((l) => (
                <a key={l.href} href={l.href} className={`text-sm tracking-wider transition-colors ${c.link}`}>
                  {l.label}
                </a>
              ))}
              {langMenu()}
              {ctaLabel && (
                <a
                  href={ctaHref}
                  className={`text-sm tracking-wider border px-5 py-2 rounded-full transition-all duration-300 whitespace-nowrap ${c.cta}`}
                >
                  {ctaLabel}
                </a>
              )}
            </div>

            {/* Mobile cluster */}
            <div className="flex md:hidden items-center gap-2">
              {ctaLabel && !hasMenu && (
                <a
                  href={ctaHref}
                  className={`text-[11px] tracking-wider border px-3 py-1.5 rounded-full transition-all whitespace-nowrap ${c.cta}`}
                >
                  {ctaLabel}
                </a>
              )}
              {langMenu()}
              {hasMenu && burger}
            </div>
          </div>
        </nav>
      )}

      {/* Mobile drawer (sibling of <nav>: the bar's backdrop-filter would otherwise trap fixed
          children inside the bar's height). Always mounted, inert and hidden while closed, so it can
          slide out with plain CSS. Light palette in every mode. */}
      {hasMenu && (
        <div
          className={`fixed inset-0 z-[60] ${overlay ? "lg:hidden" : "md:hidden"} ${open ? "visible" : "invisible"}`}
          style={{ transition: open ? "visibility 0s" : "visibility 0s linear 320ms" }}
          inert={!open}
        >
          <div
            className={`absolute inset-0 transition-opacity duration-200 motion-reduce:transition-none ${
              overlay ? "bg-[#17130e]/50" : "bg-[#1F1B16]/40 backdrop-blur-sm"
            } ${open ? "opacity-100" : "opacity-0"}`}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
          <div
            ref={panelRef}
            id="mobile-menu"
            role="dialog"
            aria-modal="true"
            aria-label={a.siteMenu}
            className={`absolute top-0 right-0 h-full ${overlay ? "w-[86%]" : "w-[82%]"} max-w-sm shadow-2xl flex flex-col ${overlay ? "px-5 py-6" : "p-6"} overflow-y-auto bg-[#F7F3EC] transition-transform duration-[320ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${
              open ? "translate-x-0" : "translate-x-full"
            }`}
          >
            {overlay ? (
              <>
                <div className="flex items-center justify-between mb-6">
                  <span className="font-light tracking-[0.25em] text-sm text-[#1F1B16]">MODOLO</span>
                  <button
                    type="button"
                    aria-label={t.burgerClose}
                    onClick={() => setOpen(false)}
                    className="inline-flex w-11 h-11 items-center justify-center rounded-full border border-[#1F1B16]/12 text-[#1F1B16]"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <a
                  href={wa}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex min-h-14 items-center justify-center gap-2 rounded-full bg-[linear-gradient(100deg,#e8c877,#b5893f)] px-4 py-3 text-[15px] min-[380px]:text-base font-medium text-[#17130e] shadow-[0_8px_22px_-10px_rgb(126_93_36/0.6)]"
                >
                  <WhatsAppGlyph className="h-5 w-5 shrink-0" />
                  {t.drawer[0]}
                </a>
                <ul className="mt-4 flex flex-col">
                  {NAV_DRAWER_HREF.map((href, i) => (
                    <li key={href}>
                      <a
                        href={href}
                        onClick={() => setOpen(false)}
                        className="block py-3 text-lg font-light tracking-wider border-b border-[#1F1B16]/[0.06] text-[#1F1B16]/80 transition-colors hover:text-[var(--gilt)]"
                      >
                        {t.drawer[i + 1]}
                      </a>
                    </li>
                  ))}
                </ul>
                <div className="mt-auto pt-8">
                  <p className="mb-3 text-[11px] uppercase tracking-[0.2em] text-[#1F1B16]/[0.62]" aria-hidden="true">
                    {a.language}
                  </p>
                  <div role="group" aria-label={a.language} className="grid grid-cols-3 gap-2">
                    {LOCALES.map((l) => {
                      const active = l === lang;
                      return (
                        <button
                          key={l}
                          type="button"
                          lang={l}
                          onClick={() => switchLocale(l)}
                          aria-current={active ? "true" : undefined}
                          className={`h-11 rounded-full border px-1 text-[13px] tracking-wide transition-colors ${
                            active
                              ? "border-[#1F1B16] bg-[#1F1B16] text-[var(--paper)] font-medium"
                              : "border-[#1F1B16]/15 text-[#1F1B16]/80 hover:border-[#1F1B16]/40"
                          }`}
                        >
                          {LANG_NAMES[l]}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between mb-8">
                  <span className={`font-light tracking-[0.25em] text-sm ${c.word}`}>MODOLO</span>
                  <button
                    type="button"
                    aria-label={t.burgerClose}
                    onClick={() => setOpen(false)}
                    className={`relative inline-flex w-10 h-10 items-center justify-center rounded-full border ${c.trigger} after:absolute after:-inset-[2px] after:rounded-full after:content-['']`}
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex flex-col">
                  {links.map((l) => (
                    <a
                      key={l.href}
                      href={l.href}
                      onClick={() => setOpen(false)}
                      className="py-3 text-lg font-light tracking-wider border-b transition-colors text-[#1F1B16]/80 hover:text-[#B5893F] border-[#1F1B16]/[0.06]"
                    >
                      {l.label}
                    </a>
                  ))}
                </div>
                {ctaLabel && (
                  <a
                    href={ctaHref}
                    onClick={() => setOpen(false)}
                    className="mt-8 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full font-medium tracking-wider transition-all bg-[#1F1B16] text-[#F7F3EC] hover:bg-[#33291E]"
                  >
                    {ctaLabel}
                  </a>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
