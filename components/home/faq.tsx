import type { Locale } from "@/lib/i18n";
import { FAQS } from "@/lib/site-data";
import { FAQ_SECTION } from "@/content/home/faq-section";
import { typo } from "@/components/home/typo";

// Native <details>/<summary>: keyboard (Tab, Enter, Space) and screen readers work without any
// JavaScript, and closed answers stay in the DOM, so search engines and the browser's find-in-page
// read them. The open/close height transition is CSS only (::details-content + interpolate-size,
// Chromium 131+; other browsers simply open without animation). Reduced motion: the global rule in
// globals.css already zeroes transition durations.
const CSS = `.mds-faq{interpolate-size:allow-keywords}
.mds-faq summary{list-style:none;cursor:pointer}
.mds-faq summary::-webkit-details-marker{display:none}
.mds-faq details::details-content{block-size:0;overflow-y:clip;transition:block-size .32s cubic-bezier(.2,.7,.2,1),content-visibility .32s allow-discrete}
.mds-faq details[open]::details-content{block-size:auto}
.mds-faq-v{transition:transform .32s cubic-bezier(.2,.7,.2,1)}
.mds-faq details[open] .mds-faq-v{transform:scaleY(0)}
.mds-faq summary:hover .mds-faq-q{color:var(--gilt)}`;

/**
 * 06 · FAQ (#faq, panel). The questions are FAQS (lib/site-data.ts), the same array that feeds the
 * FAQPage JSON-LD, so the page and the structured data cannot drift. All closed by default.
 * Server component, no framer.
 */
export default function Faq({ lang }: { lang: Locale }) {
  const t = FAQ_SECTION[lang];

  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="scroll-mt-[calc(var(--nav-h,80px)+12px)] bg-[var(--ink-panel)] px-6 py-16 text-[#17130e] sm:px-10 md:py-32 lg:px-16"
    >
      <style href="mds-faq" precedence="medium">{CSS}</style>
      <div className="mx-auto grid max-w-[1400px] gap-10 md:gap-y-0 mds-split-5-7">
        <header className="min-w-0">
          <p className="micro-caps text-[var(--gilt)]">{t.kicker}</p>
          <h2 id="faq-title" className="section-head display-space mt-4" style={{ fontSize: "clamp(1.9rem, 3.7vw, 3.4rem)" }}>
            <span className="block">{t.h2[0]}</span>
            <em className="block not-italic text-[var(--gilt)]">{t.h2[1]}</em>
          </h2>
        </header>

        <div className="mds-faq min-w-0 border-b border-[color:var(--gold-line-strong)]">
          {FAQS[lang].map((f) => (
            <details key={f.q} className="border-t border-[color:var(--gold-line-strong)]">
              <summary className="flex min-h-[44px] items-start justify-between gap-6 rounded-[6px] py-5 md:py-6">
                <h3 className="mds-faq-q display-space text-[18px] font-medium leading-snug transition-colors md:text-[20px]" style={{ letterSpacing: "-0.01em" }}>
                  {f.q}
                </h3>
                <span aria-hidden="true" className="relative mt-[6px] block h-3.5 w-3.5 shrink-0 md:mt-[7px]">
                  <span className="absolute left-0 top-1/2 h-[1.5px] w-full -translate-y-1/2 bg-[var(--gilt)]" />
                  <span className="mds-faq-v absolute left-1/2 top-0 h-full w-[1.5px] -translate-x-1/2 bg-[var(--gilt)]" />
                </span>
              </summary>
              <p className="max-w-[640px] pb-6 pr-8 text-[16px] leading-relaxed text-[#17130e]/78 md:pb-7">{typo(f.a, lang)}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
