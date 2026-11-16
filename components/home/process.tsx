import { ArrowRight, Check } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import { waHref } from "@/lib/whatsapp";
import { PROCESS } from "@/content/home/process";
import { PREFILL } from "@/content/home/prefills";
import { RegionLink } from "@/components/home/region";
import { typo } from "@/components/home/typo";

/**
 * 03 · Ablauf (#ablauf, cream). Three steps and the guarantee (absorbs the old guarantee band),
 * two sections before the contact: «what happens, and what if I don't like it?».
 * Server component; the only island is the region-aware WhatsApp link (tag Ablauf).
 */
export default function Process({ lang }: { lang: Locale }) {
  const t = PROCESS[lang];
  const text = PREFILL[lang].process;
  const href = { ch: waHref(text, "ch"), it: waHref(text, "it") };

  return (
    <section
      id="ablauf"
      aria-labelledby="ablauf-title"
      className="scroll-mt-[calc(var(--nav-h,80px)+12px)] bg-[var(--ink-bg)] px-6 py-16 text-[#17130e] sm:px-10 md:py-32 lg:px-16"
    >
      <div className="mx-auto grid max-w-[1400px] gap-8 md:gap-y-0 mds-split-5-7">
        <header className="min-w-0 md:sticky md:top-[calc(var(--nav-h,80px)+32px)] md:self-start">
          <p className="micro-caps text-[var(--gilt)]">{t.kicker}</p>
          <h2 id="ablauf-title" className="section-head display-space mt-4" style={{ fontSize: "clamp(1.9rem, 3.7vw, 3.4rem)" }}>
            <span className="block">{t.h2[0]}</span>
            <em className="block not-italic text-[var(--gilt)]">{t.h2[1]}</em>
          </h2>
        </header>

        <div className="min-w-0">
          <ol className="list-none p-0" role="list">
            {t.steps.map((s, i) => (
              <li key={s.title} className="flex gap-4 border-t border-[color:var(--gold-line-strong)] py-4 first:border-t-0 first:pt-0 md:gap-8 md:py-8">
                <span
                  aria-hidden="true"
                  className="display-space w-10 shrink-0 font-medium tabular-nums leading-[1.2] text-[var(--gilt)] md:w-14"
                  style={{ fontSize: "clamp(1.25rem, 2vw, 1.75rem)", letterSpacing: "-0.02em" }}
                >
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <h3 className="display-space text-[20px] leading-[1.2] md:text-[24px]">{s.title}</h3>
                  <p className="mt-2 max-w-[620px] text-[15px] leading-relaxed text-[#17130e]/78 md:mt-2.5 md:text-[16px]">{typo(s.text, lang)}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="mt-4 rounded-[20px] bg-[var(--ink-panel)] p-5 sm:p-8 md:mt-8 md:p-10">
            <div className="flex items-center gap-3 md:items-start md:gap-5">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#b5893f] text-[#17130e]">
                <Check className="h-4 w-4" strokeWidth={2.5} />
              </span>
              <h3 className="display-space min-w-0 text-[20px] leading-[1.2] md:pt-0.5 md:text-[24px]">{t.guaranteeTitle}</h3>
            </div>
            <div className="md:pl-[52px]">
              <p className="mt-3 text-[15px] leading-relaxed text-[#17130e]/80 md:text-[16px]">{t.guaranteeText}</p>
              <p className="mt-4 border-t border-[color:var(--gold-line-strong)] pt-3.5 text-[14px] font-medium md:mt-5 md:pt-4 leading-relaxed text-[#17130e]/78">
                {t.guaranteeFooter}
              </p>
            </div>
          </div>

          <p className="mt-4 md:mt-8">
            <RegionLink
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex min-h-[44px] items-center gap-2 text-[15.5px] font-medium text-[var(--gilt)] underline decoration-[color:var(--gilt)]/30 underline-offset-[5px] transition-colors hover:text-[#17130e] hover:decoration-[#17130e]"
            >
              {t.link}
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only"> {t.newTab}</span>
            </RegionLink>
          </p>
        </div>
      </div>
    </section>
  );
}
