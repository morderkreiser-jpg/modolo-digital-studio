import Link from "next/link";
import { ArrowRight, Clock, Plus } from "lucide-react";
import { localizedHref, type Locale } from "@/lib/i18n";
import { waHref } from "@/lib/whatsapp";
import type { Region } from "@/lib/region";
import { GRATIS_CHECK_TOKEN, OFFER, type OfferRung } from "@/content/home/offer";
import { buildPrices } from "@/content/home/prices";
import { PREFILL } from "@/content/home/prefills";
import GratisCheck from "@/components/home/gratis-check";
import { RegionLink } from "@/components/home/region";
import { typo } from "@/components/home/typo";

// .mds-cols-3 (the three columns) lives in globals.css (SPEC §5.6). .mds-rung lines the three cards
// up row by row on desktop (subgrid): step, title + price, text, duration, on-site line, link — so
// the hairlines and links sit at the same height whatever the title length.
const CSS = `@media (min-width:900px){.mds-rung{display:grid;grid-row:span 6;grid-template-rows:subgrid;row-gap:0}
.mds-rung>:last-child{align-self:end}}`;

/** «Vor Ort: CHF 690. Ich komme vorbei, …» → the first sentence carries the price, so it leads. */
function SecondLine({ text, lang }: { text: string; lang: Locale }) {
  const cut = text.indexOf(". ");
  if (cut < 0) return <>{typo(text, lang)}</>;
  return (
    <>
      <span className="font-medium text-[#17130e]">{typo(text.slice(0, cut + 1), lang)}</span>
      {typo(text.slice(cut + 1), lang)}
    </>
  );
}

/**
 * 02 · Angebot & Preise (#angebot, panel). A ladder that starts at CHF 0: rung 0 is the free Google
 * check (client island), rungs 1–3 are the three products with fixed prices from lib/pricing.ts.
 * Server component. Prices are CHF for every visitor; the tiny RegionLink islands pick the CH or IT
 * WhatsApp number from the MDS_REGION cookie. Each rung's link opens WhatsApp with its own tagged prefill.
 */
export default function Offer({ lang }: { lang: Locale }) {
  const t = OFFER[lang];
  const pre = PREFILL[lang];
  // CHF for every region (live rule since 2026-07-10, as on /preise): region IT changes only the
  // WhatsApp number, so its prefills carry the CHF amounts too.
  const prices = buildPrices("ch", lang);
  const rungs: OfferRung[] = t.rungs(prices);
  const prefill = [pre.rung1, pre.rung2, pre.rung3];
  const href = (i: number): Record<Region, string> => ({
    ch: waHref(prefill[i](prices), "ch"),
    it: waHref(prefill[i](prices), "it"),
  });

  return (
    <section
      id="angebot"
      aria-labelledby="angebot-title"
      className="scroll-mt-[calc(var(--nav-h,80px)+12px)] bg-[var(--ink-panel)] px-6 py-16 text-[#17130e] sm:px-10 md:py-32 lg:px-16"
    >
      {/* old in-page anchor kept alive for links and QR codes (D20) */}
      <span id="servizi" aria-hidden="true" className="block scroll-mt-[calc(var(--nav-h,80px)+12px)]" />
      <style href="mds-offer" precedence="medium">{CSS}</style>

      <div className="mx-auto max-w-[1400px]">
        <header className="grid gap-6 md:items-end mds-split-5-7">
          <div className="min-w-0">
            <p className="micro-caps text-[var(--gilt)]">{t.kicker}</p>
            <h2 id="angebot-title" className="section-head display-space mt-4" style={{ fontSize: "clamp(1.9rem, 3.7vw, 3.4rem)" }}>
              <span className="block">{t.h2[0]}</span>
              <em className="block not-italic text-[var(--gilt)]">{t.h2[1]}</em>
            </h2>
          </div>
          <p className="max-w-[600px] text-[17px] font-light leading-relaxed text-[#17130e]/78 md:text-lg">{t.lead}</p>
        </header>

        <div className="mt-10 md:mt-16">
          <GratisCheck
            lang={lang}
            copy={t.check}
            named={pre.checkNamed(GRATIS_CHECK_TOKEN)}
            empty={pre.checkEmpty}
            newTab={t.newTab}
          />
        </div>

        <ol className="mds-cols-3 mt-5 list-none p-0 md:mt-6" role="list">
          {rungs.map((r, i) => {
            return (
              <li key={r.step} className="mds-rung flex min-w-0 flex-col rounded-[20px] border border-[color:var(--gold-line)] bg-[var(--ink-bg)] p-5 sm:p-7 lg:p-8">
                <p className="micro-caps text-[var(--gilt)]">{r.step}</p>
                <div className="mt-2 flex items-end justify-between gap-4 self-start md:mt-2.5" style={{ width: "100%" }}>
                  <h3 className="display-space min-w-0 text-[20px] leading-[1.15] md:text-[23px]">{typo(r.h3, lang)}</h3>
                  <p
                    className="display-space shrink-0 whitespace-nowrap text-right text-[20px] font-medium tabular-nums leading-[1.15] md:text-[23px]"
                    style={{ letterSpacing: "-0.02em" }}
                  >
                    {typo(r.price, lang)}
                  </p>
                </div>

                {/* Phones: the text sits behind «Was dazugehört» (page length, SPEC A15); from 768 px it is
                    always shown (.mds-more in globals.css). Title, price, duration and link stay visible. */}
                <details className="mds-more mt-3 border-t border-[color:var(--gold-line)] md:mt-5">
                  <summary className="flex min-h-[44px] items-center justify-between gap-3 text-[14.5px] font-medium text-[#17130e]/80">
                    {t.more}
                    <Plus className="mds-more-icon h-4 w-4 shrink-0 text-[var(--gilt)]" strokeWidth={1.8} aria-hidden="true" />
                  </summary>
                  <p className="pb-1 text-[15px] leading-relaxed text-[#17130e]/78 md:pb-0 md:pt-5">{typo(r.text, lang)}</p>
                </details>

                <p className="mt-3 flex items-start gap-2 text-[14px] leading-snug text-[#17130e]/70 md:mt-4">
                  <Clock className="mt-[2px] h-4 w-4 shrink-0 text-[var(--gilt)]" strokeWidth={1.7} aria-hidden="true" />
                  <span>{typo(r.meta, lang)}</span>
                </p>

                {r.second ? (
                  <p className="mt-3 rounded-[12px] bg-[var(--ink-panel)] px-4 py-3 text-[14px] leading-relaxed text-[#17130e]/78 md:mt-4">
                    <SecondLine text={r.second} lang={lang} />
                  </p>
                ) : (
                  <span aria-hidden="true" className="hidden md:block" />
                )}

                <div className="mt-auto pt-3 md:pt-6">
                  <RegionLink
                    href={href(i)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group inline-flex min-h-[44px] items-center gap-2 text-[15px] font-medium text-[var(--gilt)] underline decoration-[color:var(--gilt)]/30 underline-offset-[5px] transition-colors hover:text-[#17130e] hover:decoration-[#17130e]"
                  >
                    {r.link}
                    <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.8} aria-hidden="true" />
                    <span className="sr-only"> {t.newTab}</span>
                  </RegionLink>
                </div>
              </li>
            );
          })}
        </ol>

        <div className="mt-6 grid gap-1 md:mt-10 md:gap-4 md:items-start mds-split-5-7">
          {/* Phones: extras and payment terms behind one line; always shown from 768 px. */}
          <details className="mds-more md:order-2">
            <summary className="flex min-h-[44px] items-center justify-between gap-3 border-b border-[color:var(--gold-line)] text-[14.5px] font-medium text-[#17130e]/80">
              {t.footnoteSummary}
              <Plus className="mds-more-icon h-4 w-4 shrink-0 text-[var(--gilt)]" strokeWidth={1.8} aria-hidden="true" />
            </summary>
            <p className="pt-3 text-[14px] leading-relaxed text-[#17130e]/74 md:pt-0">
              {typo(t.footnote(prices), lang)}
            </p>
          </details>
          <p className="md:order-1">
            <Link
              href={localizedHref(lang, "/prezzi")}
              prefetch={false}
              className="group inline-flex min-h-[44px] items-center gap-2 text-[15px] font-medium text-[#17130e] underline decoration-[#17130e]/30 underline-offset-[5px] transition-colors hover:text-[var(--gilt)] hover:decoration-[color:var(--gilt)]"
            >
              {t.allPrices}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.8} aria-hidden="true" />
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
