import { ArrowUpRight, MessageCircle } from "lucide-react";
import { localizedHref, type Locale } from "@/lib/i18n";
import { SITE } from "@/lib/site";
import { waHref } from "@/lib/whatsapp";
import { googleProfileUrl } from "@/lib/review-links";
import { CONTACT } from "@/content/home/contact";
import { PREFILL } from "@/content/home/prefills";
import ContactForm from "@/components/home/contact-form";
import { ByRegion, RegionLink } from "@/components/home/region";

const DT = "micro-caps text-[#17130e]/66";
const DD = "mt-0.5 text-[16px] leading-relaxed text-[#17130e] md:mt-1";
const DD_LINK = "relative py-0.5 after:absolute after:inset-x-0 after:-inset-y-[7px] after:content-[''] underline decoration-[#17130e]/25 underline-offset-[5px] transition-colors hover:text-[var(--gilt)] hover:decoration-[color:var(--gilt)]";

/**
 * 07 · Kontakt (#contatti, cream — the id stays: letters, QR codes and inner pages link to it).
 * WhatsApp first (gold, tag Kontakt), the e-mail form for people who prefer it. The number is
 * labelled «WhatsApp» and links to wa.me, never tel: (no phone-call promise). Region IT: the IT
 * number and the Italian address line. Server component; the form is a client island
 * (components/home/contact-form.tsx), the region switches are ByRegion / RegionLink.
 */
export default function Contact({ lang }: { lang: Locale }) {
  const t = CONTACT[lang];
  const pre = PREFILL[lang];
  const wa = { ch: waHref(pre.contact, "ch"), it: waHref(pre.contact, "it") };
  const waError = { ch: waHref(pre.formError, "ch"), it: waHref(pre.formError, "it") };
  const cut = t.address.indexOf(", ");
  const address = cut > 0 ? [t.address.slice(0, cut + 1), t.address.slice(cut + 2)] : [t.address];

  return (
    <section
      id="contatti"
      aria-labelledby="contatti-title"
      className="scroll-mt-[calc(var(--nav-h,80px)+12px)] bg-[var(--ink-bg)] px-6 py-16 text-[#17130e] sm:px-10 md:py-32 lg:px-16"
    >
      <div className="mx-auto max-w-[1400px]">
        <header className="max-w-[760px]">
          <p className="micro-caps text-[var(--gilt)]">{t.kicker}</p>
          <h2 id="contatti-title" className="section-head display-space mt-4">
            <span className="block">{t.h2[0]}</span>
            <em className="block not-italic text-[var(--gilt)]">{t.h2[1]}</em>
          </h2>
          <p className="mt-6 max-w-[620px] text-[17px] font-light leading-relaxed text-[#17130e]/78 md:text-lg">{t.lead}</p>
        </header>

        <div className="mt-8 grid gap-6 md:mt-16 md:gap-y-0 mds-split-5-7">
          <div className="min-w-0">
            <RegionLink
              href={wa}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-[58px] w-full items-center justify-center gap-3 rounded-full px-8 text-[16px] font-semibold text-[#17130e] shadow-[0_14px_32px_-14px_rgba(126,93,36,0.8)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-[0_18px_36px_-14px_rgba(126,93,36,0.9)] sm:w-auto"
              style={{ background: "linear-gradient(100deg, #e8c877, #b5893f)" }}
            >
              <MessageCircle className="h-5 w-5" strokeWidth={1.9} aria-hidden="true" />
              {t.button}
              <span className="sr-only"> {t.newTab}</span>
            </RegionLink>

            <dl className="mt-6 border-t border-[color:var(--gold-line-strong)] md:mt-8">
              <div className="border-b border-[color:var(--gold-line-strong)] py-3 md:py-5">
                <dt className={DT}>{t.labels.whatsapp}</dt>
                <dd className={`${DD} tabular-nums`}>
                  <ByRegion
                    ch={<a href={wa.ch} target="_blank" rel="noopener noreferrer" className={`inline-block ${DD_LINK}`}>{SITE.phoneDisplay}<span className="sr-only"> {t.newTab}</span></a>}
                    it={<a href={wa.it} target="_blank" rel="noopener noreferrer" className={`inline-block ${DD_LINK}`}>{SITE.phoneItDisplay}<span className="sr-only"> {t.newTab}</span></a>}
                  />
                </dd>
              </div>
              <div className="border-b border-[color:var(--gold-line-strong)] py-3 md:py-5">
                <dt className={DT}>{t.labels.email}</dt>
                <dd className={DD}>
                  <a href={`mailto:${SITE.email}`} className={`inline-block break-all ${DD_LINK}`}>{SITE.email}</a>
                </dd>
              </div>
              <div className="border-b border-[color:var(--gold-line-strong)] py-3 md:py-5">
                <dt className={DT}>{t.labels.address}</dt>
                <dd className={DD}>
                  <address className="not-italic">
                    {address.map((line) => (
                      <span key={line} className="block">{line}</span>
                    ))}
                    <ByRegion ch={null} it={<span className="mt-2 block text-[15px] text-[#17130e]/78">{t.regionItLine}</span>} />
                  </address>
                </dd>
              </div>
              <div className="border-b border-[color:var(--gold-line-strong)] py-3 md:py-5">
                <dt className={DT}>{t.labels.google}</dt>
                <dd className={DD}>
                  <a href={googleProfileUrl()} target="_blank" rel="noopener noreferrer" className={`group inline-flex items-center gap-1.5 ${DD_LINK}`}>
                    {t.googleLink}
                    <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px" strokeWidth={1.8} aria-hidden="true" />
                    <span className="sr-only"> {t.newTab}</span>
                  </a>
                </dd>
              </div>
            </dl>
          </div>

          <div className="min-w-0">
            <ContactForm lang={lang} copy={t} privacyHref={localizedHref(lang, "/privacy")} errorWa={waError} />
          </div>
        </div>
      </div>
    </section>
  );
}
