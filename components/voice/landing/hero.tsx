// Hero of the voice sales page: an espresso room set into the cream page under the site's nav,
// like the homepage film without the film. Server component; everything a visitor reads is in the
// first HTML and paints on the first frame (no entrance animation that could hold the title back).
import Link from "next/link";
import { ArrowDown, ArrowLeft } from "lucide-react";
import type { VoiceLandingContent } from "@/content/voice/landing";
import { localizedHref, type Locale } from "@/lib/i18n";
import { LANDING_UI, keepTogether } from "./ui";
import s from "./landing.module.css";

export default function Hero({ lang, copy }: { lang: Locale; copy: VoiceLandingContent }) {
  const hero = copy.hero;
  return (
    <section aria-labelledby="voice-hero-title" className={`${s.section} ${s.dark} ${s.room} ${s.hero}`}>
      <div className={s.inner}>
        <Link href={localizedHref(lang, "/")} className={s.back}>
          <ArrowLeft className={s.backIcon} strokeWidth={1.5} aria-hidden="true" />
          {LANDING_UI[lang].back}
        </Link>

        <p className={s.eyebrow}>{hero.eyebrow}</p>
        <h1 id="voice-hero-title" className={s.h1}>
          {hero.title}
        </h1>

        <div className={s.heroRule} aria-hidden="true" />

        <div className={s.heroGrid}>
          <div className={s.heroMain}>
            <p className={s.heroLead}>{keepTogether(hero.lead)}</p>
            <div className={s.heroActions}>
              {/* To the pilot section: what a pilot place gives and asks, with its own call to action. */}
              <a href="#pilot" className={`${s.btn} ${s.btnCream}`}>
                {hero.primaryCta}
              </a>
              <a href="#demo" className={s.textLink}>
                {hero.secondaryCta}
                <ArrowDown className={s.linkIcon} strokeWidth={1.6} aria-hidden="true" />
              </a>
            </div>
          </div>
          <p className={s.heroNote}>{hero.pilotNote}</p>
        </div>
      </div>
    </section>
  );
}
