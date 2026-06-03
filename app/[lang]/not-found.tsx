"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { localeFromPathname, localizedHref, type Locale } from "@/lib/i18n";

const T: Record<Locale, { eyebrow: string; title: string; body: string; cta: string }> = {
  en: {
    eyebrow: "Error 404",
    title: "Page not found",
    body: "The page you are looking for doesn't exist or has been moved.",
    cta: "Back to homepage",
  },
  de: {
    eyebrow: "Fehler 404",
    title: "Seite nicht gefunden",
    body: "Die gesuchte Seite existiert nicht oder wurde verschoben.",
    cta: "Zurück zur Startseite",
  },
  it: {
    eyebrow: "Errore 404",
    title: "Pagina non trovata",
    body: "La pagina che cerchi non esiste o è stata spostata.",
    cta: "Torna alla homepage",
  },
};

export default function NotFound() {
  const lang = localeFromPathname(usePathname());
  const t = T[lang];
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#F7F3EC] text-[#1F1B16] px-6 text-center">
      <Image src="/logo-icon.png" alt="Modolo Digital Studio" width={56} height={56} className="mb-8" />
      <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4">{t.eyebrow}</span>
      <h1 className="text-5xl md:text-7xl font-light tracking-tight mb-4">{t.title}</h1>
      <p className="text-[#1F1B16]/55 font-light max-w-md mb-10">{t.body}</p>
      <Link
        href={localizedHref(lang, "/")}
        className="inline-flex items-center gap-2 bg-[#1F1B16] text-[#F7F3EC] px-8 py-4 rounded-full font-medium tracking-wider hover:bg-[#33291E] transition-all"
      >
        {t.cta}
      </Link>
    </main>
  );
}
