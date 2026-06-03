"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { localeFromPathname, localizedHref, type Locale } from "@/lib/i18n";

const T: Record<Locale, { eyebrow: string; title: string; body: string; retry: string; home: string }> = {
  en: {
    eyebrow: "Something went wrong",
    title: "An unexpected error occurred",
    body: "Please try again. If the problem persists, contact us at info@modolodigitalstudio.ch.",
    retry: "Try again",
    home: "Homepage",
  },
  de: {
    eyebrow: "Etwas ist schiefgelaufen",
    title: "Ein unerwarteter Fehler ist aufgetreten",
    body: "Bitte versuche es erneut. Wenn das Problem bestehen bleibt, schreib uns an info@modolodigitalstudio.ch.",
    retry: "Erneut versuchen",
    home: "Startseite",
  },
  it: {
    eyebrow: "Si è verificato un errore",
    title: "Si è verificato un errore imprevisto",
    body: "Riprova. Se il problema persiste, scrivici a info@modolodigitalstudio.ch.",
    retry: "Riprova",
    home: "Homepage",
  },
};

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const lang = localeFromPathname(usePathname());
  const t = T[lang];

  useEffect(() => {
    // Surface the error to the console / monitoring.
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#F7F3EC] text-[#1F1B16] px-6 text-center">
      <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4">{t.eyebrow}</span>
      <h1 className="text-4xl md:text-6xl font-light tracking-tight mb-4">{t.title}</h1>
      <p className="text-[#1F1B16]/55 font-light max-w-md mb-10">{t.body}</p>
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={reset}
          className="inline-flex items-center justify-center gap-2 bg-[#1F1B16] text-[#F7F3EC] px-8 py-4 rounded-full font-medium tracking-wider hover:bg-[#33291E] transition-all"
        >
          {t.retry}
        </button>
        <Link
          href={localizedHref(lang, "/")}
          className="inline-flex items-center justify-center gap-2 border border-[#1F1B16]/15 px-8 py-4 rounded-full font-medium tracking-wider hover:border-[#B5893F]/60 hover:text-[#B5893F] transition-all"
        >
          {t.home}
        </Link>
      </div>
    </main>
  );
}
