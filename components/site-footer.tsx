import Image from "next/image";
import Link from "next/link";
import { localizedHref, type Locale } from "@/lib/i18n";

const T: Record<Locale, { imprint: string; privacy: string; madeWith: string }> = {
  en: { imprint: "Legal Notice", privacy: "Privacy Policy", madeWith: "Made with care in Switzerland" },
  de: { imprint: "Impressum", privacy: "Datenschutz", madeWith: "Mit Sorgfalt in der Schweiz erstellt" },
  it: { imprint: "Note legali", privacy: "Privacy", madeWith: "Fatto con cura in Svizzera" },
};

/**
 * Shared Espresso footer — the redesign's dark bookend. Used on the inner pages so navigating
 * off the homepage stays in one visual world. `marker` is the small gilt tick label at the top
 * (the homepage uses its own "Fin — 08" chapter marker inline instead of this component).
 */
export default function SiteFooter({ lang, marker }: { lang: Locale; marker?: string }) {
  const t = T[lang];
  const year = new Date().getFullYear();
  return (
    <footer className="px-6 sm:px-10 lg:px-16 py-14 md:py-16" style={{ background: "var(--ink-deep)", color: "#17130e" }}>
      <div className="mx-auto max-w-[1400px]">
        <div className="flex items-center gap-3 border-t pt-8" style={{ borderColor: "rgba(201,162,90,0.25)" }}>
          <span aria-hidden="true" className="h-px w-8" style={{ background: "var(--gilt)" }} />
          {marker && <span className="micro-caps" style={{ color: "var(--gilt)" }}>{marker}</span>}
        </div>
        <div className="mt-8 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo-mark.png" alt="Modolo Digital Studio" width={30} height={30} />
            <span className="micro-caps tnum" style={{ color: "rgba(31,27,22,0.55)" }}>© {year} Modolo Digital Studio</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href={localizedHref(lang, "/impressum")} className="micro-caps transition-colors text-[color:rgba(31,27,22,0.6)] hover:text-[#17130e]">{t.imprint}</Link>
            <Link href={localizedHref(lang, "/privacy")} className="micro-caps transition-colors text-[color:rgba(31,27,22,0.6)] hover:text-[#17130e]">{t.privacy}</Link>
            <a href="https://instagram.com/modolodigitalstudio" target="_blank" rel="noopener noreferrer" aria-label="Instagram" className="text-[color:rgba(31,27,22,0.6)] transition-colors hover:text-[#17130e]">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
                <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
                <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
              </svg>
            </a>
            <span aria-hidden="true" className="hidden h-3 w-px md:inline-block" style={{ background: "rgba(31,27,22,0.2)" }} />
            <span className="micro-caps" style={{ color: "var(--gilt)" }}>{t.madeWith}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
