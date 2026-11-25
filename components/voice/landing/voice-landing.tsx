// The sales page of Modolo Voice AI, composed. Rendered by app/[lang]/assistente-telefonico-ai/
// page.tsx while VOICE_LANDING is on (lib/voice/landing.ts).
//
// A server component: only the current language's copy reaches the browser, and the client code is
// the site nav, the trade chooser and the voice stage it shows (whose heavy parts load on intent).
// Nothing is gated behind JavaScript or an opacity entrance; the site's MotionConfig is not needed
// because nothing here animates on scroll.
//
// Order: hero (espresso) → demo → problem → how it works → features → sectors → integrations →
// limits → pilot (→ plans, only with VOICE_LANDING_SHOW_PLANS) → privacy → FAQ → contact
// (espresso) → footer. The nav sits before <main>, so the skip link lands on the hero (as on the
// homepage).
import SiteFooter from "@/components/site-footer";
import SiteNav from "@/components/site-nav";
import { VOICE_LANDING, VOICE_LANDING_SHOW_PLANS } from "@/content/voice/landing";
import type { Locale } from "@/lib/i18n";
import Demo from "./demo";
import { demoEntries } from "./demo-entries";
import Hero from "./hero";
import { Contact, Faq, Features, How, Integrations, Limits, Pilot, Plans, Privacy, Problem, Sectors } from "./sections";
import s from "./landing.module.css";

export default function VoiceLanding({ lang }: { lang: Locale }) {
  const copy = VOICE_LANDING[lang];
  const entries = demoEntries(lang);

  return (
    <>
      <SiteNav lang={lang} ctaLabel={copy.contact.title} ctaHref="#contact" theme="light" />
      <main id="main" tabIndex={-1} className={s.page}>
        <div className="mds-grain" aria-hidden="true" />
        <Hero lang={lang} copy={copy} />
        <Demo lang={lang} copy={copy} entries={entries} />
        <Problem lang={lang} copy={copy} />
        <How lang={lang} copy={copy} />
        <Features lang={lang} copy={copy} />
        <Sectors lang={lang} copy={copy} entries={entries} />
        <Integrations lang={lang} copy={copy} />
        <Limits lang={lang} copy={copy} />
        <Pilot lang={lang} copy={copy} />
        {VOICE_LANDING_SHOW_PLANS ? <Plans lang={lang} copy={copy} /> : null}
        <Privacy lang={lang} copy={copy} />
        <Faq lang={lang} copy={copy} />
        <Contact lang={lang} copy={copy} />
      </main>
      <SiteFooter lang={lang} />
    </>
  );
}
