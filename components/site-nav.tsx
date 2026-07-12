"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Menu, X, ChevronDown } from "lucide-react";
import { LOCALES, localizedHref, stripLocale, type Locale } from "@/lib/i18n";

type NavLink = { href: string; label: string };

// Language names shown in the dropdown, each in its own language.
const LANG_NAMES: Record<Locale, string> = { en: "English", de: "Deutsch", it: "Italiano" };
const LANG_ROW_H = 40; // px — height of one language row; the gold ruler tick slides in multiples of this.

// Persist the chosen locale so proxy.ts keeps the visitor in it on later visits.
// Module-level (not inside the component) so it stays a plain browser side effect.
function rememberLocale(locale: Locale) {
  document.cookie = `NEXT_LOCALE=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

// Localized accessibility strings for the nav controls, so assistive tech matches <html lang>.
// (Swiss German spelling: "ss" rather than "ß".)
const NAV_A11Y: Record<
  Locale,
  { language: string; switchTo: (code: string) => string; openMenu: string; closeMenu: string; siteMenu: string; home: string }
> = {
  en: {
    language: "Language",
    switchTo: (c) => `Switch language to ${c}`,
    openMenu: "Open menu",
    closeMenu: "Close menu",
    siteMenu: "Site menu",
    home: "Modolo Digital Studio — home",
  },
  de: {
    language: "Sprache",
    switchTo: (c) => `Sprache auf ${c} umstellen`,
    openMenu: "Menü öffnen",
    closeMenu: "Menü schliessen",
    siteMenu: "Seitenmenü",
    home: "Modolo Digital Studio — Startseite",
  },
  it: {
    language: "Lingua",
    switchTo: (c) => `Cambia lingua in ${c}`,
    openMenu: "Apri menu",
    closeMenu: "Chiudi menu",
    siteMenu: "Menu del sito",
    home: "Modolo Digital Studio — home",
  },
};

export default function SiteNav({
  lang,
  links = [],
  ctaHref = "/#contatti",
  ctaLabel,
  theme = "light",
}: {
  lang: Locale;
  links?: NavLink[];
  ctaHref?: string;
  ctaLabel?: string;
  theme?: "light" | "dark";
}) {
  const [open, setOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [langHover, setLangHover] = useState<Locale | null>(null);
  const reduce = useReducedMotion();
  const router = useRouter();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasMenu = links.length > 0;
  const a = NAV_A11Y[lang];

  // Theme-aware styling: the immersive homepage is dark; inner pages stay light.
  const dark = theme === "dark";
  const c = {
    nav: dark ? "bg-[#0b0805]/72 border-[color:var(--gold-line)]" : "bg-[#F7F3EC]/80 border-[#1F1B16]/[0.08]",
    word: dark ? "text-[#f5efe3]" : "text-[#1F1B16]",
    sub: dark ? "text-[var(--gilt)]" : "text-[var(--color-gold-ink)]",
    link: dark ? "text-[#f5efe3]/65 hover:text-[#f5efe3]" : "text-[#1F1B16]/65 hover:text-[#1F1B16]",
    tBorder: dark ? "border-[#f5efe3]/15" : "border-[#1F1B16]/12",
    tActive: dark ? "bg-[var(--color-gold)] text-[#17130E]" : "bg-[#1F1B16] text-[var(--paper)]",
    tIdle: dark ? "text-[#f5efe3]/70 hover:text-[#f5efe3]" : "text-[#1F1B16]/70 hover:text-[#1F1B16]",
    cta: dark
      ? "border-[var(--color-gold)]/50 text-[var(--gilt)] hover:bg-[var(--color-gold)] hover:text-[#17130E] hover:border-[var(--color-gold)]"
      : "border-[#B5893F]/50 text-[var(--color-gold-ink)] hover:bg-[#1F1B16] hover:text-[var(--paper)] hover:border-[#1F1B16]",
    trigger: dark ? "border-[#f5efe3]/15 text-[#f5efe3]" : "border-[#1F1B16]/12 text-[#1F1B16]",
  };

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
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
    window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
  };

  // Switch language by navigating to the localized URL (lang is part of the route now).
  // The cookie lets proxy.ts keep the visitor in this locale on later visits.
  const switchLocale = (target: Locale) => {
    setOpen(false);
    setLangOpen(false);
    if (target === lang) return;
    rememberLocale(target);
    router.push(localizedHref(target, stripLocale(pathname)));
  };

  // Language switcher as the site's "Measure" ruler: a hairline rail with a gold tick that
  // slides to the current (or hovered) language — a signature detail, not a stock dropdown.
  const markedIndex = Math.max(0, LOCALES.indexOf(langHover ?? lang));
  const langMenu = (variant: "sm" | "lg") => (
    <div data-lang-dd className="relative">
      <button
        type="button"
        onClick={() => setLangOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={langOpen}
        aria-label={a.language}
        className={`flex items-center gap-1.5 border ${c.tBorder} rounded-full ${
          variant === "lg" ? "px-3.5 py-2 text-xs" : "px-3 py-1.5 text-[11px]"
        } uppercase tracking-[0.18em] transition-colors ${langOpen ? c.tActive : c.tIdle}`}
        style={{ fontFamily: "var(--font-space), sans-serif" }}
      >
        {lang}
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-300 ${langOpen ? "rotate-180" : ""}`}
          strokeWidth={1.75}
          aria-hidden="true"
        />
      </button>
      <AnimatePresence>
        {langOpen && (
          <motion.div
            role="menu"
            aria-label={a.language}
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            className={`absolute right-0 mt-3 min-w-[11rem] rounded-2xl border p-2 shadow-xl z-[70] ${
              dark ? "bg-[var(--ink-panel)] border-[color:var(--gold-line)]" : "bg-[#F7F3EC] border-[#1F1B16]/10"
            }`}
          >
            <div className="relative">
              {/* the ruler rail */}
              <span
                aria-hidden="true"
                className={`absolute left-1 top-1.5 bottom-1.5 w-px ${dark ? "bg-[#f5efe3]/20" : "bg-[#1F1B16]/15"}`}
              />
              {/* the gold tick that slides to the marked language */}
              <motion.span
                aria-hidden="true"
                className="absolute left-[3px] w-[2px] rounded-full bg-[var(--color-gold)]"
                style={{ top: (LANG_ROW_H - 20) / 2, height: 20 }}
                initial={false}
                animate={{ y: markedIndex * LANG_ROW_H }}
                transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 34 }}
              />
              {LOCALES.map((l) => {
                const active = lang === l;
                return (
                  <button
                    key={l}
                    type="button"
                    role="menuitem"
                    onClick={() => switchLocale(l)}
                    onMouseEnter={() => setLangHover(l)}
                    onMouseLeave={() => setLangHover(null)}
                    onFocus={() => setLangHover(l)}
                    onBlur={() => setLangHover(null)}
                    aria-label={a.switchTo(l.toUpperCase())}
                    aria-current={active ? "true" : undefined}
                    className={`group relative flex h-10 w-full items-center justify-between gap-6 rounded-lg pl-5 pr-3 transition-colors ${
                      active ? (dark ? "text-[var(--gilt)]" : "text-[var(--color-gold-ink)]") : c.tIdle
                    } ${dark ? "hover:bg-[#f5efe3]/[0.06]" : "hover:bg-[#1F1B16]/[0.04]"}`}
                  >
                    <span className={`text-sm tracking-wide ${active ? "font-medium" : "font-light"}`}>{LANG_NAMES[l]}</span>
                    <span
                      className="text-[10px] uppercase tracking-[0.22em] opacity-55"
                      style={{ fontFamily: "var(--font-space), sans-serif" }}
                    >
                      {l}
                    </span>
                  </button>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <>
    <nav className={`fixed top-0 left-0 right-0 z-50 backdrop-blur-xl border-b ${c.nav}`}>
      <div className="max-w-[1400px] mx-auto px-6 sm:px-10 lg:px-16 py-4 sm:py-5 flex items-center justify-between gap-2">
        {/* Logo */}
        <Link href={localizedHref(lang, "/")} aria-label={a.home} onClick={handleLogoClick} className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <Image src={dark ? "/logo-mark-light.png" : "/logo-mark.png"} alt="" width={36} height={36} />
          <span className="flex flex-col leading-tight">
            <span className={`font-light tracking-[0.25em] text-xs sm:text-sm ${c.word}`}>MODOLO</span>
            <span className={`text-[10px] tracking-[0.3em] hidden sm:block ${c.sub}`}>DIGITAL STUDIO</span>
          </span>
        </Link>

        {/* Desktop cluster */}
        <div className="hidden md:flex items-center gap-5">
          {links.map((l) => (
            <a key={l.href} href={l.href} className={`text-sm tracking-wider transition-colors ${c.link}`}>
              {l.label}
            </a>
          ))}
          {langMenu("sm")}
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
          {langMenu("sm")}
          {hasMenu && (
            <button
              ref={triggerRef}
              type="button"
              aria-label={open ? a.closeMenu : a.openMenu}
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen((v) => !v)}
              className={`inline-flex w-10 h-10 items-center justify-center rounded-full border ${c.trigger}`}
            >
              {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          )}
        </div>
      </div>
      </nav>

      {/* Mobile drawer (sibling of <nav>: the nav's backdrop-filter would otherwise
          trap fixed-positioned children inside the navbar's height) */}
      <AnimatePresence>
        {open && hasMenu && (
          <motion.div
            className="fixed inset-0 z-[60] md:hidden"
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
          >
            <div className="absolute inset-0 bg-[#1F1B16]/40 backdrop-blur-sm" onClick={() => setOpen(false)} aria-hidden="true" />
            <motion.div
              ref={panelRef}
              id="mobile-menu"
              role="dialog"
              aria-modal="true"
              aria-label={a.siteMenu}
              className={`absolute top-0 right-0 h-full w-[82%] max-w-sm shadow-2xl flex flex-col p-6 overflow-y-auto ${dark ? "bg-[var(--ink-panel)]" : "bg-[#F7F3EC]"}`}
              initial={reduce ? false : { x: "100%" }}
              animate={{ x: 0 }}
              exit={reduce ? { opacity: 0 } : { x: "100%" }}
              transition={reduce ? { duration: 0 } : { type: "spring", damping: 30, stiffness: 300 }}
            >
              <div className="flex items-center justify-between mb-8">
                <span className={`font-light tracking-[0.25em] text-sm ${c.word}`}>MODOLO</span>
                <button
                  type="button"
                  aria-label={a.closeMenu}
                  onClick={() => setOpen(false)}
                  className={`inline-flex w-10 h-10 items-center justify-center rounded-full border ${c.trigger}`}
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
                    className={`py-3 text-lg font-light tracking-wider border-b transition-colors ${dark ? "text-[#f5efe3]/80 hover:text-[var(--color-gold)] border-[color:var(--gold-line)]" : "text-[#1F1B16]/80 hover:text-[#B5893F] border-[#1F1B16]/[0.06]"}`}
                  >
                    {l.label}
                  </a>
                ))}
              </div>
              {ctaLabel && (
                <a
                  href={ctaHref}
                  onClick={() => setOpen(false)}
                  className={`mt-8 inline-flex items-center justify-center gap-2 px-6 py-4 rounded-full font-medium tracking-wider transition-all ${dark ? "bg-[var(--color-gold)] text-[#17130E] hover:bg-[var(--gilt)]" : "bg-[#1F1B16] text-[#F7F3EC] hover:bg-[#33291E]"}`}
                >
                  {ctaLabel}
                </a>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
