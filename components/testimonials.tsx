import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import { REVIEWS, readsNatively, type ReviewLang } from "@/data/reviews";
import { CLIENTS } from "@/data/clients";
import { SITE } from "@/lib/site";
import type { Locale } from "@/lib/i18n";

// Prova sociale: citazioni vere dei clienti + la banda dei loghi. Non renderizza NULLA finche'
// data/reviews.ts e data/clients.ts sono vuoti, cosi' il sito pubblicato non mostra mai sezioni
// scheletriche.
//
// DUE SCELTE CHE CONTANO PIU' DELLA GRAFICA.
//
// 1. La recensione si legge nella lingua in cui e' STATA SCRITTA, non in quella della pagina.
//    Una recensione in svizzero tedesco, mostrata in dialetto a chi legge il sito in tedesco, e'
//    la prova che nessuna agenzia straniera puo' fabbricare: dice "questo lavora con gente di qui"
//    prima ancora che il lettore arrivi al contenuto. Tradurla in Hochdeutsch la sprecherebbe.
//    Per le altre lingue mostriamo la traduzione, ma DICHIARATA come tale: mai spacciare parole
//    tradotte per parole testuali del cliente.
//
// 2. Sotto c'e' il link alla scheda Google. Una testimonianza che non si puo' verificare vale
//    quanto una inventata, perche' il lettore non ha modo di distinguerle. Il link e' quello che
//    fa la differenza, e costa una riga.
//
// Le recensioni NON finiscono nei dati strutturati: vedi la nota in lib/json-ld.ts (regola Google
// sulle recensioni "self-serving" ospitate sul sito dell'azienda recensita).

const UI: Record<
  Locale,
  {
    label: string;
    heading: string;
    accent: string;
    clientsLabel: string;
    verify: string;
    translatedFrom: Partial<Record<ReviewLang, string>>;
  }
> = {
  en: {
    label: "What clients say",
    heading: "Real businesses, ",
    accent: "real words.",
    clientsLabel: "Trusted by",
    verify: "Read them on Google",
    translatedFrom: { gsw: "Translated from Swiss German", de: "Translated from German", it: "Translated from Italian" },
  },
  de: {
    label: "Was Kunden sagen",
    heading: "Echte Betriebe, ",
    accent: "echte Worte.",
    clientsLabel: "Sie vertrauen mir",
    verify: "Auf Google nachlesen",
    translatedFrom: { it: "Aus dem Italienischen übersetzt", en: "Aus dem Englischen übersetzt" },
  },
  it: {
    label: "Cosa dicono i clienti",
    heading: "Attività vere, ",
    accent: "parole vere.",
    clientsLabel: "Mi hanno scelto",
    verify: "Leggile su Google",
    translatedFrom: { gsw: "Tradotta dallo svizzero tedesco", de: "Tradotta dal tedesco", en: "Tradotta dall'inglese" },
  },
};

/** La scheda Google, se configurata; altrimenti la ricerca Maps — mai un link morto. */
function googleProfileHref(): string {
  if (SITE.googleBusiness) return SITE.googleBusiness;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${SITE.name} ${SITE.address.locality}`)}`;
}

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
            <span style={{ color: "var(--gilt)" }}>{t.accent}</span>
          </h2>
        </div>

        {hasReviews && (
          <>
            <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {REVIEWS.map((r, idx) => {
                // Originale se la pagina e' nella lingua in cui e' stata scritta; altrimenti la
                // traduzione, dichiarata. Se manca la traduzione resta l'originale: meglio una
                // frase che il lettore non decifra del silenzio, perche' il nome e il link a
                // Google parlano comunque.
                const native = readsNatively(r.bodyLang, lang);
                const translated = !native ? r.translations?.[lang] : undefined;
                const shown = translated ?? r.body;
                const nota = translated ? t.translatedFrom[r.bodyLang] : undefined;

                return (
                  <li
                    key={idx}
                    className="flex flex-col rounded-[10px] border p-6"
                    style={{ borderColor: "var(--gold-line)", background: "var(--ink-bg)" }}
                  >
                    <div className="flex gap-1" style={{ color: "var(--gilt)" }} aria-label={`${r.rating}/5`}>
                      {Array.from({ length: 5 }).map((_, s) => (
                        <Star key={s} className="h-4 w-4" fill={s < r.rating ? "currentColor" : "none"} strokeWidth={1.5} aria-hidden="true" />
                      ))}
                    </div>
                    <blockquote className="mt-4 flex-1 font-light leading-relaxed text-[#17130e]/85">“{shown}”</blockquote>
                    {nota && <span className="mt-3 micro-caps text-[#17130e]/45">{nota}</span>}
                    <div className="mt-5 border-t pt-4" style={{ borderColor: "rgba(201,162,90,0.3)" }}>
                      <span className="display-space block text-[#17130e]">{r.author}</span>
                      {r.company && <span className="micro-caps text-[#17130e]/55">{r.company}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-8">
              <a
                href={googleProfileHref()}
                target="_blank"
                rel="noopener noreferrer"
                className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[#17130e]"
              >
                {t.verify}
                <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
              </a>
            </div>
          </>
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
