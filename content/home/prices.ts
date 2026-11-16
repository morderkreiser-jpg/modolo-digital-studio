import type { Locale } from "@/lib/i18n";
import { CURRENCY, type Region } from "@/lib/region";
import { WEBSITES, CARE, HOURLY } from "@/lib/pricing";

// Every price shown on the homepage, already formatted, built from lib/pricing.ts so the
// homepage can never drift from /preise. Formatting is done by hand instead of Intl because
// Node and the browsers disagree on the Swiss thousands mark (ASCII ' vs U+2019), which would
// cause a hydration mismatch. CHF always uses U+2019 ("CHF 1’690"); EUR follows the reading
// language ("€ 2.400" in de/it, "€ 2,400" in en). A non-breaking space joins currency and amount.

export type Prices = {
  start: string; // Google-Profil Start
  onSite: string; // Google-Profil vor Ort
  booking: string; // Online-Buchung einrichten
  essential: string; // Website, eine Seite
  business: string; // Website, bis 6 Seiten
  signature: string; // Website, massgeschneidert
  care: string; // Care · Light (per month)
  hourly: string;
};

function group(n: number, sep: string): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function formatPrice(amount: number, region: Region, locale: Locale): string {
  const sep = region === "ch" ? "’" : locale === "en" ? "," : ".";
  return `${CURRENCY[region]} ${group(amount, sep)}`;
}

export function buildPrices(region: Region, locale: Locale): Prices {
  const it = WEBSITES.items;
  const f = (n: number) => formatPrice(n, region, locale);
  return {
    start: f(it[0].price[region]),
    onSite: f(it[1].price[region]),
    booking: f(it[2].price[region]),
    essential: f(it[3].price[region]),
    business: f(it[4].price[region]),
    signature: f(it[5].price[region]),
    care: f(CARE.plans[0].price[region]),
    hourly: f(HOURLY[region]),
  };
}
