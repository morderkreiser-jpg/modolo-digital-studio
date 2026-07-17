import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import { REVIEWS } from "@/data/reviews";
import { CLIENTS } from "@/data/clients";
import type { Locale } from "@/lib/i18n";

// Social proof: real client quotes + a "trusted by" logo band. Renders NOTHING until
// data/reviews.ts and/or data/clients.ts hold real content, so the live site is unaffected
// until Francesco fills them in. The same reviews power the schema.org Review markup.
const UI: Record<Locale, { label: string; heading: string; accent: string; clientsLabel: string }> = {
  en: { label: "What clients say", heading: "Real businesses, ", accent: "real words.", clientsLabel: "Trusted by" },
  de: { label: "Was Kunden sagen", heading: "Echte Betriebe, ", accent: "echte Worte.", clientsLabel: "Sie vertrauen mir" },
  it: { label: "Cosa dicono i clienti", heading: "Attività vere, ", accent: "parole vere.", clientsLabel: "Mi hanno scelto" },
};

export default function Testimonials({ lang }: { lang: Locale }) {
  const hasReviews = REVIEWS.length > 0;
  const hasClients = CLIENTS.length > 0;
  if (!hasReviews && !hasClients) return null;

  const t = UI[lang];

  return (
    <section id="stimmen" className="bg-[var(--ink-panel)] px-6 sm:px-10 lg:px-16 py-24 md:py-32" style={{ color: "#17130e" }}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 md:mb-20">
          <span className="micro-caps" style={{ color: "var(--gilt)" }}>{t.label}</span>
          <h2 className="display-space mt-4 text-3xl leading-[1.05] md:text-5xl">
            {t.heading}
            <span style={{ color: "var(--color-gold)" }}>{t.accent}</span>
          </h2>
        </div>

        {hasReviews && (
          <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {REVIEWS.map((r, idx) => (
              <li
                key={idx}
                className="flex flex-col rounded-[10px] border p-6"
                style={{ borderColor: "var(--gold-line)", background: "var(--ink-bg)" }}
              >
                <div className="flex gap-1" style={{ color: "var(--color-gold)" }} aria-label={`${r.rating}/5`}>
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star key={s} className="h-4 w-4" fill={s < r.rating ? "currentColor" : "none"} strokeWidth={1.5} aria-hidden="true" />
                  ))}
                </div>
                <blockquote className="mt-4 flex-1 font-light leading-relaxed text-[#17130e]/85">“{r.body}”</blockquote>
                <div className="mt-5 border-t pt-4" style={{ borderColor: "rgba(201,162,90,0.3)" }}>
                  <span className="display-space block text-[#17130e]">{r.author}</span>
                  <span className="micro-caps text-[#17130e]/55">{r.company}</span>
                </div>
              </li>
            ))}
          </ul>
        )}

        {hasClients && (
          <div className={hasReviews ? "mt-16" : ""}>
            <span className="micro-caps block text-center text-[#17130e]/45">{t.clientsLabel}</span>
            <ul className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-6">
              {CLIENTS.map((c) => {
                const mark = c.logo ? (
                  <Image src={c.logo} alt={c.name} width={140} height={40} className="h-8 w-auto object-contain opacity-70 grayscale transition hover:opacity-100 hover:grayscale-0" />
                ) : (
                  <span className="display-space text-lg text-[#17130e]/55 transition-colors hover:text-[#17130e]">{c.name}</span>
                );
                return (
                  <li key={c.name}>
                    {c.href ? (
                      <Link href={c.href} target="_blank" rel="noopener noreferrer" aria-label={c.name}>
                        {mark}
                      </Link>
                    ) : (
                      mark
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
