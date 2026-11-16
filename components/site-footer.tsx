import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { localizedHref, type Locale } from "@/lib/i18n";
import { SERVICE_SLUGS, SITE } from "@/lib/site";
import { SERVICE_META } from "@/lib/site-data";
import { LOCAL_CITIES } from "@/lib/local-seo";
import { googleProfileUrl } from "@/lib/review-links";
import { waHref } from "@/lib/whatsapp";
import { FOOTER } from "@/content/home/footer";
import { PREFILL } from "@/content/home/prefills";
import { ByRegion } from "@/components/home/region";

// Four columns from 1024 px. Below: the NAP block full width, then the three link lists in two
// columns (services left, cities + more stacked right), which keeps the footer short on a phone.
// Authored CSS (not grid utilities) for the same reason as .mds-split-*: the column count is the
// substance of this block.
const CSS = `.mds-footer-grid{display:grid;gap:1.75rem 1.5rem;grid-template-columns:repeat(2,minmax(0,1fr))}
.mds-footer-nap{grid-column:1/-1}
.mds-footer-svc{grid-row:span 2}
@media (min-width:1024px){.mds-footer-grid{grid-template-columns:minmax(0,1.5fr) repeat(3,minmax(0,1fr));gap:2rem}
.mds-footer-nap{grid-column:auto}.mds-footer-svc{grid-row:auto}}`;

const HEAD = "micro-caps text-[var(--gilt)]";
const LINK = "inline-flex min-h-[44px] items-center text-[15px] md:min-h-[32px] text-[#17130e]/78 transition-colors hover:text-[#17130e] hover:underline hover:underline-offset-4";

/**
 * Shared footer (panel) on every page: the homepage and every inner page. NAP identical to the
 * Google Business Profile and the JSON-LD (Winterthur); the Google link opens the place itself
 * (googleProfileUrl), not a Maps search. Region IT adds the Italian address line; the NAP WhatsApp
 * keeps the CH number on purpose. Every Link has prefetch={false}. Bottom padding grows by
 * --mds-sticky-h on phones, so the homepage sticky bar never covers the last line.
 *
 * The top hairline separates it from inner pages whose last band is also panel (pricing, city pages).
 *
 * `marker` is accepted for the inner pages that still pass it and is no longer rendered (SPEC §4.8
 * drops the chapter-marker label); remove it from the callers whenever those files are touched.
 */
export default function SiteFooter({ lang }: { lang: Locale; marker?: string }) {
  const t = FOOTER[lang];
  const services = SERVICE_META[lang];
  const [name, person, address, whatsapp, email] = t.nap;
  const year = String(new Date().getFullYear());

  return (
    <footer
      className="border-t border-[color:var(--gold-line-strong)] bg-[var(--ink-panel)] px-6 pt-12 pb-[calc(2.5rem+var(--mds-sticky-h,0px))] text-[#17130e] sm:px-10 md:pt-20 md:pb-14 lg:px-16"
    >
      <style href="mds-footer" precedence="medium">{CSS}</style>
      <div className="mx-auto max-w-[1400px]">
        <div className="mds-footer-grid">
          <div className="mds-footer-nap min-w-0">
            <div className="flex items-center gap-3">
              <Image src="/logo-mark.png" alt="" width={34} height={34} />
              <span className="display-space text-[19px] leading-tight">{name}</span>
            </div>
            <address className="mt-4 space-y-0.5 text-[15px] not-italic leading-relaxed text-[#17130e]/78">
              <span className="block">{person}</span>
              <span className="block">{address}</span>
              <ByRegion ch={null} it={<span className="block">{t.regionItLine}</span>} />
              <span className="block pt-1.5">
                <a href={waHref(PREFILL[lang].footer, "ch")} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center tabular-nums transition-colors md:min-h-[32px] hover:text-[#17130e] hover:underline hover:underline-offset-4">
                  {whatsapp}
                  <span className="sr-only"> {t.newTab}</span>
                </a>
              </span>
              <span className="block">
                <a href={`mailto:${SITE.email}`} className="inline-flex min-h-[44px] items-center break-all transition-colors md:min-h-[32px] hover:text-[#17130e] hover:underline hover:underline-offset-4">{email}</a>
              </span>
            </address>
            <a
              href={googleProfileUrl()}
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-4 inline-flex min-h-[44px] items-center gap-1.5 text-[15px] font-medium text-[var(--gilt)] underline decoration-[color:var(--gilt)]/30 underline-offset-[5px] transition-colors hover:text-[#17130e] hover:decoration-[#17130e]"
            >
              {t.googleLink}
              <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px" strokeWidth={1.8} aria-hidden="true" />
              <span className="sr-only"> {t.newTab}</span>
            </a>
          </div>

          <nav aria-labelledby="footer-services" className="mds-footer-svc min-w-0">
            <p id="footer-services" className={HEAD}>{t.servicesHeading}</p>
            <ul className="mt-3 md:mt-4">
              {SERVICE_SLUGS.map((slug) => (
                <li key={slug}>
                  <Link href={localizedHref(lang, `/servizi/${slug}`)} prefetch={false} className={LINK}>{services[slug].title}</Link>
                </li>
              ))}
              <li>
                <Link href={localizedHref(lang, "/prezzi")} prefetch={false} className={`${LINK} font-medium text-[#17130e]`}>{t.allPrices}</Link>
              </li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-cities" className="min-w-0">
            <p id="footer-cities" className={HEAD}>{t.citiesHeading}</p>
            <ul className="mt-3 md:mt-4">
              {LOCAL_CITIES.map((city, i) => (
                <li key={city}>
                  <Link href={localizedHref(lang, `/webdesign/${city}`)} prefetch={false} className={LINK}>{t.cities[i]}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-more" className="min-w-0">
            <p id="footer-more" className={HEAD}>{t.moreHeading}</p>
            <ul className="mt-3 md:mt-4">
              <li><Link href={localizedHref(lang, "/impressum")} prefetch={false} className={LINK}>{t.more[0]}</Link></li>
              <li><Link href={localizedHref(lang, "/privacy")} prefetch={false} className={LINK}>{t.more[1]}</Link></li>
              {/* The digital business card: deliberately its only entry point from the site (noindex,
                  not in the nav or the sitemap). */}
              <li><Link href={localizedHref(lang, "/biglietto")} prefetch={false} className={LINK}>{t.more[2]}</Link></li>
              <li>
                <a href={SITE.instagram} target="_blank" rel="noopener noreferrer" className={`group gap-1 ${LINK}`}>
                  {t.more[3]}
                  <ArrowUpRight className="h-3.5 w-3.5 opacity-70" strokeWidth={1.8} aria-hidden="true" />
                  <span className="sr-only"> {t.newTab}</span>
                </a>
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 border-t border-[color:var(--gold-line-strong)] pt-6 md:mt-16">
          <p className="micro-caps tabular-nums text-[#17130e]/66">{t.bottom.replace(/\d{4}/, year)}</p>
        </div>
      </div>
    </footer>
  );
}
