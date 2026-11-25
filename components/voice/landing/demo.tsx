// Demo section of the voice sales page: the written example conversations of the twelve invented
// businesses, played by the voice widget's stage. Server component.
//
// Each business gets its own VoiceMount, rendered here on the server; the client chooser shows one
// at a time. VoiceMount decides what the stage offers: with voice off (today) it plays the written
// examples only, no microphone, no network, no cost.
//
// Language: the examples in the page's language when the business has them, else the German ones
// (examplesForPage). The stage then runs in German, so the page says so in words, next to the
// trade and above the stage, not only with a language code.
import VoiceMount from "@/components/voice/voice-mount";
import type { VoiceLandingContent } from "@/content/voice/landing";
import { localizedHref, type Locale } from "@/lib/i18n";
import { VOICE_LANDING_PATH } from "@/lib/voice/landing";
import DemoChooser, { type DemoChoice } from "./demo-chooser";
import { DEFAULT_DEMO_ID, type DemoEntry } from "./demo-entries";
import { LANDING_UI } from "./ui";
import s from "./landing.module.css";

export default function Demo({ lang, copy, entries }: { lang: Locale; copy: VoiceLandingContent; entries: DemoEntry[] }) {
  const ui = LANDING_UI[lang];
  // The stage's "direct contact" link stays on this page, at its own contact section.
  const contactUrl = localizedHref(lang, `${VOICE_LANDING_PATH}#contact`);

  const choices: DemoChoice[] = entries.map((entry) => {
    const tag = entry.examples.otherLanguage && entry.examples.locale ? entry.examples.locale.toUpperCase() : null;
    return {
      id: entry.id,
      label: entry.label,
      languageTag: tag,
      // examplesForPage falls back to German only, so these two sentences say "German".
      languageSr: tag ? ui.inGerman : null,
      languageNote: tag ? ui.germanOnly : null,
      stage: (
        <VoiceMount
          locale={lang}
          tenantId={entry.id}
          scripts={entry.examples.scripts}
          headingLevel={3}
          contactUrl={contactUrl}
        />
      ),
    };
  });

  const note = <p className={s.demoNote}>{copy.demo.note}</p>;

  return (
    <section id="demo" aria-labelledby="voice-demo-title" className={`${s.section} ${s.paper}`}>
      <div className={`${s.inner} ${s.demoGrid}`}>
        <div className={s.demoIntro}>
          <span className={s.rule} aria-hidden="true" />
          <h2 id="voice-demo-title" className={s.h2}>
            {copy.demo.title}
          </h2>
          <p className={s.lead}>{copy.demo.lead}</p>
        </div>
        {choices.length > 0 ? (
          <DemoChooser
            name="voice-demo"
            legend={copy.demo.chooserLabel}
            choices={choices}
            defaultId={DEFAULT_DEMO_ID}
            note={note}
          />
        ) : (
          note
        )}
      </div>
    </section>
  );
}
