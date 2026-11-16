// Homepage composition root (SPEC §4.0, D14, D22). A SERVER component: every section is either a
// server component or brings its own small client island, and only the current locale's copy
// (content/home/*) reaches the browser.
//
// Order: the nav sits BEFORE <main> so the skip link lands on the hero, not on the nav (A11).
// Hero film (dark) → 01 Arbeiten (cream sheet over the film) → 02 Angebot (panel) → 03 Ablauf
// (cream) → 04 Stimmen (panel) → 05 Über mich (cream, frozen) → 06 FAQ (panel) → 07 Kontakt
// (cream) → footer (panel) → mobile sticky bar.
//
// Contracts that live in this order:
// - Section 01 must stay the hero's NEXT element sibling: the nav and the sticky bar measure the
//   sheet overlap from it (components/site-nav.tsx, useFilmZone).
// - <main> clips horizontally with overflow-x: clip, never hidden: hidden would make <main> a
//   scroll container and break the sticky phone panel of section 01 and the sticky headers.
// - Old in-page ids stay alive for letters, QR codes, inner pages and JSON-LD: #chi-siamo #faq
//   #contatti, plus the empty aliases #portfolio (in 01) and #servizi (in 02).
import type { Locale } from "@/lib/i18n";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import HeroFilm from "@/components/home/hero-film";
import Work from "@/components/home/work";
import Offer from "@/components/home/offer";
import Process from "@/components/home/process";
import Reviews from "@/components/home/reviews";
import About from "@/components/home/about";
import Faq from "@/components/home/faq";
import Contact from "@/components/home/contact";
import StickyBar from "@/components/home/sticky-bar";

export default function Home({ lang }: { lang: Locale }) {
  return (
    <>
      <SiteNav lang={lang} overlay />
      <main
        id="main"
        tabIndex={-1}
        className="relative overflow-x-clip bg-[var(--ink-bg)] text-[var(--ink-text)] outline-none"
      >
        <HeroFilm lang={lang} />
        <Work lang={lang} />
        <Offer lang={lang} />
        <Process lang={lang} />
        <Reviews lang={lang} />
        <About lang={lang} />
        <Faq lang={lang} />
        <Contact lang={lang} />
      </main>
      <SiteFooter lang={lang} />
      <StickyBar lang={lang} />
    </>
  );
}
