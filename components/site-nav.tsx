"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { Menu, X } from "lucide-react";

export type Lang = "en" | "de" | "it";
type NavLink = { href: string; label: string };

export default function SiteNav({
  lang,
  setLang,
  links = [],
  ctaHref = "/#contatti",
  ctaLabel,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  links?: NavLink[];
  ctaHref?: string;
  ctaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const hasMenu = links.length > 0;

  useEffect(() => {
    if (!open) return;
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
      triggerRef.current?.focus();
    };
  }, [open]);

  const langToggle = (variant: "sm" | "lg") => (
    <div role="group" aria-label="Language" className="flex items-center gap-0.5 border border-[#1F1B16]/12 rounded-full p-0.5">
      {(["en", "de", "it"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => setLang(l)}
          aria-label={`Switch language to ${l.toUpperCase()}`}
          aria-current={lang === l ? "true" : undefined}
          className={`${
            variant === "lg" ? "px-3 py-1.5 text-xs" : "px-1.5 sm:px-2 py-1 text-[10px] sm:text-[11px]"
          } rounded-full tracking-wider uppercase transition-colors ${
            lang === l ? "bg-[#B5893F] text-white" : "text-[#1F1B16]/45 hover:text-[#1F1B16]"
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );

  return (
    <>
    <nav className="fixed top-0 left-0 right-0 z-50 backdrop-blur-xl bg-[#F7F3EC]/80 border-b border-[#1F1B16]/[0.08]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-4 sm:py-5 flex items-center justify-between gap-2">
        {/* Logo */}
        <Link href="/" aria-label="Modolo Digital Studio — home" className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          <Image src="/logo-icon.png" alt="" width={36} height={36} />
          <span className="flex flex-col leading-tight">
            <span className="font-light tracking-[0.25em] text-xs sm:text-sm">MODOLO</span>
            <span className="text-[10px] tracking-[0.3em] text-[var(--color-gold-ink)] hidden sm:block">DIGITAL STUDIO</span>
          </span>
        </Link>

        {/* Desktop cluster */}
        <div className="hidden md:flex items-center gap-5">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="text-sm tracking-wider text-[#1F1B16]/60 hover:text-[#1F1B16] transition-colors">
              {l.label}
            </a>
          ))}
          {langToggle("sm")}
          {ctaLabel && (
            <a
              href={ctaHref}
              className="text-sm tracking-wider border border-[#B5893F]/50 text-[var(--color-gold-ink)] px-5 py-2 rounded-full hover:bg-[#B5893F] hover:text-white hover:border-[#B5893F] transition-all duration-300 whitespace-nowrap"
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
              className="text-[11px] tracking-wider border border-[#B5893F]/50 text-[var(--color-gold-ink)] px-3 py-1.5 rounded-full hover:bg-[#B5893F] hover:text-white transition-all whitespace-nowrap"
            >
              {ctaLabel}
            </a>
          )}
          {langToggle("sm")}
          {hasMenu && (
            <button
              ref={triggerRef}
              type="button"
              aria-label={open ? "Close menu" : "Open menu"}
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpen((v) => !v)}
              className="inline-flex w-10 h-10 items-center justify-center rounded-full border border-[#1F1B16]/12 text-[#1F1B16]"
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
              aria-label="Site menu"
              className="absolute top-0 right-0 h-full w-[82%] max-w-sm bg-[#F7F3EC] shadow-2xl flex flex-col p-6 overflow-y-auto"
              initial={reduce ? false : { x: "100%" }}
              animate={{ x: 0 }}
              exit={reduce ? { opacity: 0 } : { x: "100%" }}
              transition={reduce ? { duration: 0 } : { type: "spring", damping: 30, stiffness: 300 }}
            >
              <div className="flex items-center justify-between mb-8">
                <span className="font-light tracking-[0.25em] text-sm">MODOLO</span>
                <button
                  type="button"
                  aria-label="Close menu"
                  onClick={() => setOpen(false)}
                  className="inline-flex w-10 h-10 items-center justify-center rounded-full border border-[#1F1B16]/12"
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
                    className="py-3 text-lg font-light tracking-wider text-[#1F1B16]/80 hover:text-[#B5893F] border-b border-[#1F1B16]/[0.06] transition-colors"
                  >
                    {l.label}
                  </a>
                ))}
              </div>
              {ctaLabel && (
                <a
                  href={ctaHref}
                  onClick={() => setOpen(false)}
                  className="mt-8 inline-flex items-center justify-center gap-2 bg-[#1F1B16] text-[#F7F3EC] px-6 py-4 rounded-full font-medium tracking-wider hover:bg-[#33291E] transition-all"
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
