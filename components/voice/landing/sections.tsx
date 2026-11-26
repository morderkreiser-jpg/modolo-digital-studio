// The sections of the voice sales page after the demo. Server components without client
// JavaScript: every section is labelled by its h2, lists are lists (role="list" because Safari
// drops list semantics once the bullets are styled away), statuses are words, and the FAQ is
// native <details>, readable and searchable without any script.
import Link from "next/link";
import { ArrowRight, ArrowUp } from "lucide-react";
import { FOOTER } from "@/content/home/footer";
import type { VoiceLandingContent } from "@/content/voice/landing";
import { localizedHref, type Locale } from "@/lib/i18n";
import { SITE } from "@/lib/site";
import { waHref } from "@/lib/whatsapp";
import type { DemoEntry } from "./demo-entries";
import { LANDING_UI, keepTogether } from "./ui";
import s from "./landing.module.css";

interface SectionProps {
  lang: Locale;
  copy: VoiceLandingContent;
}

type Status = "pilot" | "planned";

/** The gold measure, the h2 and an optional lead. */
function Head({ id, title, lead, className }: { id: string; title: string; lead?: string; className?: string }) {
  return (
    <div className={className}>
      <span className={s.rule} aria-hidden="true" />
      <h2 id={id} className={s.h2}>
        {title}
      </h2>
      {lead ? <p className={s.lead}>{keepTogether(lead)}</p> : null}
    </div>
  );
}

/** Status as words ("Pilotphase" / "Geplant"); the dot only repeats them. */
function StatusLabel({ status, lang }: { status: Status; lang: Locale }) {
  const ui = LANDING_UI[lang];
  return (
    <p className={s.status} data-status={status}>
      <span className={s.srOnly}>{`${ui.statusPrefix} `}</span>
      {ui.status[status]}
    </p>
  );
}

export function Problem({ copy }: SectionProps) {
  const problem = copy.problem;
  return (
    <section aria-labelledby="voice-problem-title" className={`${s.section} ${s.bone}`}>
      <div className={s.inner}>
        <div className={s.headRow}>
          <Head id="voice-problem-title" title={problem.title} />
          <p className={s.lead}>{problem.lead}</p>
        </div>
        <ul className={s.scenes} role="list">
          {problem.situations.map((situation) => (
            <li key={situation.title} className={s.scene}>
              <h3 className={s.h3}>{situation.title}</h3>
              <p className={s.body}>{situation.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function How({ copy }: SectionProps) {
  const how = copy.how;
  return (
    <section aria-labelledby="voice-how-title" className={`${s.section} ${s.paper}`}>
      <div className={s.inner}>
        <Head id="voice-how-title" title={how.title} />
        {/* An ordered list already says "step 1 of 3"; the large numbers are for the eye only. */}
        <ol className={s.steps} role="list">
          {how.steps.map((step, index) => (
            <li key={step.title} className={s.step}>
              <span className={s.stepNum} aria-hidden="true">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className={s.h3}>{step.title}</h3>
              <p className={s.body}>{keepTogether(step.text)}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function Features({ lang, copy }: SectionProps) {
  const features = copy.features;
  return (
    <section aria-labelledby="voice-features-title" className={`${s.section} ${s.paper}`}>
      <div className={s.inner}>
        <Head id="voice-features-title" title={features.title} />
        <ul className={s.features} role="list">
          {features.items.map((item) => (
            <li key={item.title} className={s.feature} data-status={item.status}>
              <h3 className={s.h3}>{item.title}</h3>
              <StatusLabel status={item.status} lang={lang} />
              <p className={s.body}>{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** The twelve trades; each one links to its example in the demo chooser (#demo-…). */
export function Sectors({ lang, copy, entries }: SectionProps & { entries: DemoEntry[] }) {
  const ui = LANDING_UI[lang];
  return (
    <section aria-labelledby="voice-sectors-title" className={`${s.section} ${s.bone}`}>
      <div className={`${s.inner} ${s.split}`}>
        <Head id="voice-sectors-title" title={copy.sectors.title} lead={copy.sectors.lead} className={s.splitHead} />
        <div className={s.splitBody}>
          <ul className={s.sectorList} role="list">
            {entries.map((entry) => {
              const tag =
                entry.examples.otherLanguage && entry.examples.locale ? entry.examples.locale.toUpperCase() : null;
              return (
                <li key={entry.id} className={s.sectorItem}>
                  <a href={`#${entry.id}`} className={s.sectorLink}>
                    <span className={s.sectorName}>{entry.label}</span>
                    <span className={s.srOnly}>{`, ${ui.exampleCall}${tag ? `, ${ui.inGerman}` : ""}`}</span>
                    <span className={s.sectorMeta} aria-hidden="true">
                      {tag ? <span className={s.langTag}>{tag}</span> : null}
                      <ArrowUp className={s.arrow} strokeWidth={1.5} />
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Integrations({ lang, copy }: SectionProps) {
  const integrations = copy.integrations;
  return (
    <section aria-labelledby="voice-integrations-title" className={`${s.section} ${s.paper}`}>
      <div className={`${s.inner} ${s.split}`}>
        <Head
          id="voice-integrations-title"
          title={integrations.title}
          lead={integrations.lead}
          className={s.splitHead}
        />
        <div className={s.splitBody}>
          <ul className={s.rows} role="list">
            {integrations.items.map((item) => (
              <li key={item.name} className={s.row} data-status={item.status}>
                <h3 className={`${s.h3} ${s.rowName}`}>{item.name}</h3>
                <p className={s.rowText}>{item.text}</p>
                <div className={s.rowStatus}>
                  <StatusLabel status={item.status} lang={lang} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Limits({ copy }: SectionProps) {
  return (
    <section aria-labelledby="voice-limits-title" className={`${s.section} ${s.paper}`}>
      <div className={`${s.inner} ${s.split}`}>
        <Head id="voice-limits-title" title={copy.limits.title} className={s.splitHead} />
        <div className={s.splitBody}>
          <ul className={s.limits} role="list">
            {copy.limits.items.map((item) => (
              <li key={item} className={s.limit}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

export function Pilot({ lang, copy }: SectionProps) {
  const ui = LANDING_UI[lang];
  const pilot = copy.pilot;
  return (
    <section id="pilot" aria-labelledby="voice-pilot-title" className={`${s.section} ${s.bone}`}>
      <div className={s.inner}>
        <div className={s.headRow}>
          <Head id="voice-pilot-title" title={pilot.title} />
          <p className={s.lead}>{pilot.lead}</p>
        </div>

        <div className={s.pilotLists}>
          <div className={s.pilotList}>
            <h3 className={s.h3}>{ui.youGet}</h3>
            <ul className={s.ticks} role="list">
              {pilot.youGet.map((item) => (
                <li key={item} className={s.tick}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className={s.pilotList}>
            <h3 className={s.h3}>{ui.iAsk}</h3>
            <ul className={s.ticks} role="list">
              {pilot.iAsk.map((item) => (
                <li key={item} className={s.tick}>
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className={s.pilotFoot}>
          <p className={s.priceNote}>{pilot.priceNote}</p>
          <a href="#contact" className={`${s.btn} ${s.btnInk}`}>
            {pilot.cta}
          </a>
        </div>
      </div>
    </section>
  );
}

/**
 * The plans. Rendered only while VOICE_LANDING_SHOW_PLANS is true (content/voice/landing.ts);
 * the note under them comes from the copy.
 */
export function Plans({ copy }: SectionProps) {
  const plans = copy.plans;
  return (
    <section id="plans" aria-labelledby="voice-plans-title" className={`${s.section} ${s.bone}`}>
      <div className={s.inner}>
        <span className={s.rule} aria-hidden="true" />
        <h2 id="voice-plans-title" className={s.h2}>
          {plans.title}
        </h2>
        <p className={s.plansNote}>{plans.note}</p>
        <ul className={s.plans} role="list">
          {plans.items.map((plan) => (
            <li key={plan.name} className={s.plan}>
              <h3 className={s.h3}>{plan.name}</h3>
              <p className={s.planPrice}>{keepTogether(plan.price)}</p>
              <ul className={s.planFacts} role="list">
                <li>{keepTogether(plan.minutes)}</li>
                <li>{keepTogether(plan.extra)}</li>
                <li>{keepTogether(plan.setup)}</li>
              </ul>
              <p className={s.body}>{plan.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function Privacy({ lang, copy }: SectionProps) {
  const privacy = copy.privacy;
  return (
    <section aria-labelledby="voice-privacy-title" className={`${s.section} ${s.paper}`}>
      <div className={`${s.inner} ${s.split}`}>
        <Head id="voice-privacy-title" title={privacy.title} className={s.splitHead} />
        <div className={s.splitBody}>
          <ul className={s.points} role="list">
            {privacy.points.map((point) => (
              <li key={point} className={s.point}>
                {point}
              </li>
            ))}
          </ul>
          <Link href={localizedHref(lang, "/privacy")} prefetch={false} className={`${s.textLink} ${s.afterList}`}>
            {privacy.linkLabel}
            <ArrowRight className={s.linkIcon} strokeWidth={1.6} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </section>
  );
}

export function Faq({ copy }: SectionProps) {
  const faq = copy.faq;
  return (
    <section id="faq" aria-labelledby="voice-faq-title" className={`${s.section} ${s.paper}`}>
      <div className={`${s.inner} ${s.split}`}>
        <Head id="voice-faq-title" title={faq.title} className={s.splitHead} />
        {/* The same ten questions feed the FAQPage structured data (lib/voice/landing.ts). */}
        <div className={`${s.splitBody} ${s.faq}`}>
          {faq.items.map((item) => (
            <details key={item.q} className={s.faqItem}>
              <summary className={s.faqSummary}>
                <h3 className={s.faqQ}>{item.q}</h3>
                <span className={s.faqIcon} aria-hidden="true" />
              </summary>
              <p className={s.faqA}>{keepTogether(item.a)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Contact({ lang, copy }: SectionProps) {
  const ui = LANDING_UI[lang];
  const contact = copy.contact;
  // The pilot is in the Winterthur / Zürich region: the Swiss number for every visitor, whatever
  // the region cookie says (the Italian number serves the web studio's clients in Italy). A fixed
  // link also keeps the page static.
  const whatsapp = waHref(contact.whatsappPrefill, "ch");
  const mailto = `mailto:${SITE.email}?subject=${encodeURIComponent(contact.emailSubject)}`;
  return (
    <section id="contact" aria-labelledby="voice-contact-title" className={`${s.section} ${s.dark} ${s.room} ${s.roomLast}`}>
      <div className={`${s.inner} ${s.split}`}>
        <Head id="voice-contact-title" title={contact.title} lead={contact.lead} className={s.splitHead} />
        <div className={`${s.splitBody} ${s.contactActions}`}>
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className={`${s.btn} ${s.btnCream}`}>
            <WhatsAppGlyph className={s.btnIcon} />
            {contact.cta}
            <span className={s.srOnly}>{` ${FOOTER[lang].newTab}`}</span>
          </a>
          <ul className={s.contactLinks} role="list">
            <li>
              <a href={mailto} className={s.textLink}>
                {SITE.email}
              </a>
            </li>
            <li>
              <Link href={localizedHref(lang, "/#contatti")} className={s.textLink}>
                {ui.contactForm}
                <ArrowRight className={s.linkIcon} strokeWidth={1.6} aria-hidden="true" />
              </Link>
            </li>
          </ul>
        </div>
      </div>
    </section>
  );
}

/** WhatsApp glyph (the site's, as in components/site-nav.tsx). Decorative: the text names the link. */
function WhatsAppGlyph({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true" focusable="false">
      <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.06c-.25.69-1.45 1.32-2 1.36-.51.04-1.16.06-1.87-.12-.43-.11-.99-.33-1.7-.64-3-1.3-4.96-4.32-5.11-4.52-.15-.2-1.22-1.62-1.22-3.09 0-1.47.77-2.19 1.04-2.49.27-.3.59-.37.79-.37.2 0 .39 0 .57.01.18.01.43-.07.67.51.25.6.84 2.07.91 2.22.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.39-.44.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.03 1.12 1 2.06 1.31 2.36 1.46.3.15.47.12.65-.07.17-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.72.81 2.02.96.3.15.5.22.57.35.07.12.07.72-.18 1.41z" />
    </svg>
  );
}
