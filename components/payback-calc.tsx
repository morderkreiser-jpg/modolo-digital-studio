"use client";

import { useState } from "react";
import type { Locale } from "@/lib/i18n";

/**
 * Payback calculator — replaces the old repetitive pull-quote with something interactive that turns
 * "a website pays for itself" from a slogan into a real number. The visitor sets, on their own
 * reality, how many extra customers a month a site could bring and what a customer is worth; it
 * shows how fast a CHF 1'900 site pays back. Honest, conservative, no invented promises.
 */
const PRICE = 1900;

const T: Record<Locale, {
  kicker: string; head: string; accent: string; intro: string;
  custLabel: string; valLabel: string; resultLabel: string; weeks: string; months: string;
  after: string; note: string; perMonth: string;
}> = {
  it: {
    kicker: "Facciamo due conti",
    head: "Un sito non è un costo,", accent: "è un investimento.",
    intro: "Sposta i cursori sulla tua realtà e guarda in quanto tempo si ripaga un sito da CHF 1'900.",
    custLabel: "Clienti in più al mese", valLabel: "Quanto vale in media un cliente",
    resultLabel: "Si ripaga in circa", weeks: "settimane", months: "mesi",
    after: "Da lì in poi, è tutto guadagno — mese dopo mese.",
    note: "Stima prudente. I numeri li scegli tu, niente promesse gonfiate.", perMonth: "al mese",
  },
  de: {
    kicker: "Rechnen wir kurz",
    head: "Eine Website ist kein Kostenpunkt,", accent: "sondern eine Investition.",
    intro: "Stell die Regler auf deine Realität ein und sieh, wie schnell sich eine Website ab CHF 1'900 rechnet.",
    custLabel: "Zusätzliche Kunden pro Monat", valLabel: "Was ein Kunde im Schnitt wert ist",
    resultLabel: "Bezahlt sich in etwa", weeks: "Wochen", months: "Monaten",
    after: "Ab da ist alles Gewinn — Monat für Monat.",
    note: "Vorsichtige Schätzung. Die Zahlen wählst du, keine geschönten Versprechen.", perMonth: "pro Monat",
  },
  en: {
    kicker: "Let's do the maths",
    head: "A website isn't a cost,", accent: "it's an investment.",
    intro: "Set the sliders to your own reality and see how fast a website from CHF 1'900 pays for itself.",
    custLabel: "Extra customers a month", valLabel: "What a customer is worth on average",
    resultLabel: "Pays for itself in about", weeks: "weeks", months: "months",
    after: "After that, it's all profit — month after month.",
    note: "A conservative estimate. You pick the numbers — no inflated promises.", perMonth: "a month",
  },
};

function group(n: number) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, "'"); }

export default function PaybackCalc({ lang }: { lang: Locale }) {
  const t = T[lang];
  const [cust, setCust] = useState(2);
  const [val, setVal] = useState(120);
  const monthly = cust * val;
  const months = monthly > 0 ? PRICE / monthly : 0;
  const weeks = Math.max(1, Math.round(months * 4.345));
  const showMonths = weeks >= 9;
  const bigNum = showMonths ? Math.max(1, Math.round(months)) : weeks;
  const unit = showMonths ? t.months : t.weeks;

  return (
    <section className="bg-[var(--ink-panel)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
      <div className="mx-auto max-w-[1100px]">
        <span className="micro-caps text-[var(--gilt)]">{t.kicker}</span>
        <h2 className="display-space mt-4 text-[#17130e]" style={{ fontSize: "clamp(2rem, 5vw, 3.75rem)" }}>
          {t.head} <em className="text-[var(--color-gold)]">{t.accent}</em>
        </h2>
        <p className="mt-5 max-w-2xl font-light leading-relaxed text-[#17130e]/65">{t.intro}</p>

        <div className="mt-12 grid items-stretch gap-6 md:grid-cols-[1.1fr_0.9fr] md:gap-10">
          <div className="flex flex-col justify-center gap-10">
            <label className="block">
              <div className="flex items-baseline justify-between">
                <span className="micro-caps text-[#17130e]/70">{t.custLabel}</span>
                <span className="display-space tnum text-[#17130e]" style={{ fontSize: "1.4rem" }}>{cust}</span>
              </div>
              <input type="range" min={1} max={8} step={1} value={cust} onChange={(e) => setCust(+e.target.value)}
                className="mds-range mt-3 w-full" aria-label={t.custLabel}
                style={{ ["--fill" as string]: `${((cust - 1) / 7) * 100}%` }} />
            </label>
            <label className="block">
              <div className="flex items-baseline justify-between">
                <span className="micro-caps text-[#17130e]/70">{t.valLabel}</span>
                <span className="display-space tnum text-[#17130e]" style={{ fontSize: "1.4rem" }}>CHF {group(val)}</span>
              </div>
              <input type="range" min={30} max={600} step={10} value={val} onChange={(e) => setVal(+e.target.value)}
                className="mds-range mt-3 w-full" aria-label={t.valLabel}
                style={{ ["--fill" as string]: `${((val - 30) / 570) * 100}%` }} />
            </label>
          </div>

          <div className="flex flex-col justify-center rounded-[6px] border border-[color:var(--gold-line)] bg-[var(--ink-bg)] p-8 text-center md:p-10">
            <span className="micro-caps text-[var(--gilt)]">{t.resultLabel}</span>
            <div aria-live="polite" className="display-space mt-2 leading-none text-[#17130e]" style={{ fontSize: "clamp(3rem, 8vw, 5rem)" }}>
              <span className="tnum">{bigNum}</span> <span className="gold-grad">{unit}</span>
            </div>
            <p className="mt-4 font-light leading-relaxed text-[#17130e]/70">{t.after}</p>
          </div>
        </div>

        <p className="micro-caps mt-6 text-[#17130e]/40">{t.note}</p>
      </div>

      <style>{`
        .mds-range { -webkit-appearance: none; appearance: none; height: 3px; border-radius: 3px;
          background: linear-gradient(var(--color-gold), var(--color-gold)) no-repeat, rgba(126,93,36,0.22);
          background-size: var(--fill, 30%) 100%; outline: none; cursor: pointer; }
        .mds-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px;
          border-radius: 50%; background: var(--color-gold); border: 3px solid #fbf8f2;
          box-shadow: 0 3px 10px -2px rgba(126,93,36,0.6); }
        .mds-range::-moz-range-thumb { width: 18px; height: 18px; border-radius: 50%; background: var(--color-gold);
          border: 3px solid #fbf8f2; box-shadow: 0 3px 10px -2px rgba(126,93,36,0.6); }
      `}</style>
    </section>
  );
}
