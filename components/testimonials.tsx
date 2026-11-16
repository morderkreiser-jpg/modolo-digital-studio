import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import { REVIEWS, readsNatively, type ReviewItem, type ReviewLang } from "@/data/reviews";
import { CLIENTS } from "@/data/clients";
import { googleProfileUrl } from "@/lib/review-links";
import { HTML_LANG, type Locale } from "@/lib/i18n";

// Prova sociale: citazioni vere dei clienti + la banda dei loghi. Non renderizza NULLA finche'
// data/reviews.ts e data/clients.ts sono vuoti, cosi' il sito pubblicato non mostra mai sezioni
// scheletriche.
//
// TRE SCELTE CHE CONTANO PIU' DELLA GRAFICA.
//
// 1. La recensione si legge nella lingua in cui e' STATA SCRITTA, non in quella della pagina.
//    Una recensione in svizzero tedesco, mostrata in dialetto a chi legge il sito in tedesco, e'
//    la prova che nessuna agenzia straniera puo' fabbricare: dice "questo lavora con gente di qui"
//    prima ancora che il lettore arrivi al contenuto. Tradurla in Hochdeutsch la sprecherebbe.
//    Per le altre lingue mostriamo la traduzione, ma DICHIARATA come tale: mai spacciare parole
//    tradotte per parole testuali del cliente.
//
// 2. OGNI citazione dichiara la propria provenienza, non solo quelle tradotte. Prima l'etichetta
//    compariva solo sotto le traduzioni, quindi chi leggeva il dialetto non veniva avvisato di
//    stare leggendo dialetto — e il dialetto scritto lo riconosci solo se ti viene detto di
//    guardarlo. Ora le voci dicono tutte da dove vengono: quella scritta nella lingua della
//    pagina in oro ("originale"), le altre in grigio ("tradotta"). E' un fatto linguistico,
//    non un premio: per questo puo' stare su una voce senza declassare le altre.
//
// 3. Sotto c'e' il link alla scheda Google (googleProfileUrl(): la scheda vera via place_id, non
//    una ricerca Maps). Una testimonianza che non si puo' verificare vale quanto una inventata,
//    perche' il lettore non ha modo di distinguerle.
//
// DUE LAYOUT, nessuna scheda con bordo in entrambi (le schede erano la CAUSA del difetto del
// 3+1 e del buco nella citazione corta: commit 7915b69).
// - variant "band" (default, la home di prima): una banda da quattro colonne (>=1280px), griglia
//   in app/globals.css sotto .mds-voices.
// - variant "row" (home nuova, SPEC §4.4 via components/home/reviews.tsx): tre voci, tre colonne
//   da 1024px; sotto, una riga che scorre di lato con scroll-snap (voce all'86 %, la successiva si
//   intravede), senza JavaScript e senza autoplay. La riga e' una regione focalizzabile con nome,
//   cosi' chi usa la tastiera la puo' scorrere con le frecce.
//
// Le recensioni NON finiscono nei dati strutturati: vedi la nota in lib/json-ld.ts (regola Google
// sulle recensioni "self-serving" ospitate sul sito dell'azienda recensita).

/** La banda mostra sempre una fila piena, mai una riga spaiata. Le altre stanno su Google. */
const MAX_SHOWN = 4;

/** Virgolette della lingua di chi legge (COPY §0): «…» in tedesco svizzero e in italiano, “…” in
 *  inglese. Le virgolette non fanno parte della recensione: il testo dentro resta verbatim. */
const QUOTES: Record<Locale, [string, string]> = { de: ["«", "»"], it: ["«", "»"], en: ["“", "”"] };

/** Tag BCP-47 del testo ORIGINALE, per l'attributo lang del blockquote. */
const QUOTE_LANG: Record<ReviewLang, string> = { gsw: "gsw", de: "de", it: "it", en: "en" };

const UI: Record<
  Locale,
  {
    label: string;
    heading: string;
    accent: string;
    clientsLabel: string;
    verify: string;
    newTab: string;
    stars: (n: number) => string;
    translatedFrom: Partial<Record<ReviewLang, string>>;
    originalIn: Record<ReviewLang, string>;
  }
> = {
  en: {
    label: "What clients say",
    heading: "Real businesses, ",
    accent: "real words.",
    clientsLabel: "Trusted by",
    verify: "Read them on Google",
    newTab: "(opens in a new tab)",
    stars: (n) => `${n} out of 5 stars`,
    translatedFrom: { gsw: "Translated from Swiss German", de: "Translated from German", it: "Translated from Italian" },
    originalIn: { gsw: "Original in Swiss German", de: "Original in German", it: "Original in Italian", en: "Original in English" },
  },
  de: {
    label: "Was Kunden sagen",
    heading: "Echte Betriebe, ",
    accent: "echte Worte.",
    clientsLabel: "Sie vertrauen mir",
    verify: "Auf Google nachlesen",
    newTab: "(öffnet in neuem Tab)",
    stars: (n) => `${n} von 5 Sternen`,
    translatedFrom: { it: "Aus dem Italienischen übersetzt", en: "Aus dem Englischen übersetzt" },
    originalIn: { gsw: "Original auf Schwiizerdütsch", de: "Original auf Deutsch", it: "Original auf Italienisch", en: "Original auf Englisch" },
  },
  it: {
    label: "Cosa dicono i clienti",
    heading: "Attività vere, ",
    accent: "parole vere.",
    clientsLabel: "Mi hanno scelto",
    verify: "Leggile su Google",
    newTab: "(si apre in una nuova scheda)",
    stars: (n) => `${n} stelle su 5`,
    translatedFrom: { gsw: "Tradotta dallo svizzero tedesco", de: "Tradotta dal tedesco", en: "Tradotta dall'inglese" },
    originalIn: { gsw: "Testo originale in svizzero tedesco", de: "Testo originale in tedesco", it: "Testo originale in italiano", en: "Testo originale in inglese" },
  },
};

/**
 * Prima le recensioni SCRITTE nella lingua della pagina. Su /de vuol dire che l'artigiano di
 * Winterthur legge per prima cosa il dialetto; su /it che l'italiano legge per prime le italiane.
 * La regola si ribalta da sola cambiando lingua, quindi nessuna voce e' "in evidenza" in modo
 * permanente — ed e' il motivo per cui l'enfasi NON va mai legata a idx === 0: su /it e /en
 * finirebbe per caso sulla citazione piu' corta. Array.prototype.sort e' stabile (ES2019), quindi
 * dentro ogni gruppo resta l'ordine cronologico di data/reviews.ts.
 */
function orderForLocale(reviews: readonly ReviewItem[], lang: Locale): ReviewItem[] {
  return [...reviews].sort(
    (a, b) => Number(readsNatively(b.bodyLang, lang)) - Number(readsNatively(a.bodyLang, lang)),
  );
}

/** Ordine esplicito per autore (chi non e' in lista resta dopo, nell'ordine per lingua). */
function applyOrder(reviews: ReviewItem[], order?: readonly string[]): ReviewItem[] {
  if (!order?.length) return reviews;
  const rank = (r: ReviewItem) => {
    const i = order.indexOf(r.author);
    return i === -1 ? order.length : i;
  };
  return [...reviews].sort((a, b) => rank(a) - rank(b));
}

// Riga a scorrimento della variante "row". Scritta a mano (come .mds-voices) e caricata una volta
// sola in <head> da React (href + precedence). --g = margine laterale della sezione, perche' la
// riga esce fino al bordo dello schermo e la prima voce resta allineata al testo.
const ROW_CSS = `
/* Two fixed lines on phones: at the global 1.9rem minimum «Nachzulesen auf Google.» is 345 px in a
   342 px column (390 px phone) and wraps to a third line; 7.5vw keeps both lines whole down to 360. */
@media (max-width:420px){.mds-h2-fit{font-size:min(1.9rem,7.5vw)}}
.mds-vrow-scroller{--g:24px;margin-inline:calc(-1 * var(--g));overflow-x:auto;overscroll-behavior-x:contain;scroll-snap-type:x mandatory;scroll-padding-inline:var(--g);scrollbar-width:none}
.mds-vrow-scroller::-webkit-scrollbar{display:none}
@media (min-width:640px){.mds-vrow-scroller{--g:40px}}
.mds-vrow{display:flex;gap:20px;width:max-content;margin:0;padding:0 var(--g) 4px;list-style:none}
.mds-vrow > li{flex:none;width:min(calc((100vw - 2 * var(--g)) * .86),440px);scroll-snap-align:start}
@media (min-width:1024px){
  .mds-vrow-scroller{margin-inline:0;overflow:visible;scroll-snap-type:none}
  .mds-vrow{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));align-items:start;gap:3rem 2.5rem;width:auto;padding:0}
  .mds-vrow > li{width:auto}
}
`;

export type TestimonialsProps = {
  lang: Locale;
  /** "band" = the previous homepage band (default); "row" = SPEC §4.4 (3 voices, swipe row on phones). */
  variant?: "band" | "row";
  /** How many voices (default 4). */
  limit?: number;
  /** Authors that stay on Google but not on this page. */
  exclude?: readonly string[];
  /** Explicit author order; anyone not listed follows in the per-language order. */
  order?: readonly string[];
  /** Section heading (kicker + two-line h2). Without it the band keeps its old heading. */
  heading?: { kicker: string; h2: readonly [string, string] };
  /** Label of the Google link (the arrow and the «new tab» note are added here). */
  linkLabel?: string;
  /** Accessible name of the swipe row (variant "row"). */
  rowLabel?: string;
};

export default function Testimonials({
  lang,
  variant = "band",
  limit = MAX_SHOWN,
  exclude = [],
  order,
  heading,
  linkLabel,
  rowLabel,
}: TestimonialsProps) {
  const t = UI[lang];
  const pool = REVIEWS.filter((r) => !exclude.includes(r.author));
  const voices = applyOrder(orderForLocale(pool, lang), order).slice(0, limit);
  const hasReviews = voices.length > 0;
  const hasClients = CLIENTS.length > 0;
  if (!hasReviews && !hasClients) return null;

  const row = variant === "row";

  const items = voices.map((r, idx) => {
    // Originale se la pagina e' nella lingua in cui e' stata scritta; altrimenti la
    // traduzione, dichiarata. Se manca la traduzione resta l'originale — e l'etichetta
    // dice comunque il vero, perche' in quel caso stampa "originale in <lingua>",
    // non "tradotta".
    const native = readsNatively(r.bodyLang, lang);
    const translated = native ? undefined : r.translations?.[lang];
    const shown = translated ?? r.body;
    const provenance = translated ? t.translatedFrom[r.bodyLang] : t.originalIn[r.bodyLang];
    // lang = la lingua del testo MOSTRATO: serve allo screen reader e alla sillabazione.
    const quoteLang = translated ? HTML_LANG[lang] : QUOTE_LANG[r.bodyLang];

    return (
      <li key={`${r.author}-${idx}`} className="mds-voice">
        <figure className="mds-voice-fig">
          {/* Nome e stelle SOPRA la citazione: cosi' le intestazioni sono allineate su una riga
              sola e l'unico bordo irregolare e' il fondo del testo, dove leggere un finale di
              colonna e' normale. */}
          <figcaption>
            <span className="mds-voice-stars" role="img" aria-label={t.stars(r.rating)}>
              {Array.from({ length: 5 }).map((_, s) => (
                <Star key={s} className="h-4 w-4" fill={s < r.rating ? "currentColor" : "none"} strokeWidth={1.5} aria-hidden="true" />
              ))}
            </span>
            <span className="mds-voice-name display-space">{r.author}</span>
            {r.company && <span className="mds-voice-company micro-caps">{r.company}</span>}
            <span className={native ? "mds-voice-lang mds-voice-lang-native micro-caps" : "mds-voice-lang micro-caps"}>
              {provenance}
            </span>
          </figcaption>
          <blockquote lang={quoteLang}>{`${QUOTES[lang][0]}${shown}${QUOTES[lang][1]}`}</blockquote>
        </figure>
      </li>
    );
  });

  const googleLink = (
    <a
      href={googleProfileUrl()}
      target="_blank"
      rel="noopener noreferrer"
      className={
        row
          ? "group inline-flex min-h-11 items-center gap-2 text-[15px] font-medium tracking-wide text-[var(--gilt)] transition-colors hover:text-[#17130e]"
          : "group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[#17130e]"
      }
    >
      {linkLabel ?? t.verify}
      <span aria-hidden="true" className="transition-transform group-hover:translate-x-1">→</span>
      <span className="sr-only">{t.newTab}</span>
    </a>
  );

  if (row) {
    return (
      <section
        id="stimmen"
        aria-labelledby={heading ? "stimmen-title" : undefined}
        className="bg-[var(--ink-panel)] px-6 py-16 sm:px-10 md:py-32 lg:px-16"
        style={{ color: "#17130e" }}
      >
        <style href="mds-vrow" precedence="default">
          {ROW_CSS}
        </style>
        <div className="mx-auto max-w-[1400px]">
          <div className="mb-8 md:mb-16">
            <p className="micro-caps text-[var(--gilt)]">{heading?.kicker ?? t.label}</p>
            <h2 id="stimmen-title" className="section-head mds-h2-fit display-space mt-4">
              {heading ? (
                <>
                  <span className="block">{heading.h2[0]}</span>
                  <em className="block not-italic text-[var(--gilt)]">{heading.h2[1]}</em>
                </>
              ) : (
                <>
                  {t.heading}
                  <span className="text-[var(--gilt)]">{t.accent}</span>
                </>
              )}
            </h2>
          </div>

          {hasReviews && (
            <>
              <div className="mds-vrow-scroller" role="region" aria-label={rowLabel ?? t.label} tabIndex={0}>
                <ul className="mds-vrow">{items}</ul>
              </div>
              <div className="mt-6 md:mt-14">{googleLink}</div>
            </>
          )}
        </div>
      </section>
    );
  }

  return (
    <section id="stimmen" className="bg-[var(--ink-panel)] px-6 sm:px-10 lg:px-16 py-24 md:py-32" style={{ color: "#17130e" }}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 md:mb-20">
          <span className="micro-caps" style={{ color: "var(--gilt)" }}>{heading?.kicker ?? t.label}</span>
          <h2 className="display-space mt-4 text-3xl leading-[1.05] md:text-5xl">
            {heading ? (
              <>
                <span className="block">{heading.h2[0]}</span>
                <span className="block" style={{ color: "var(--gilt)" }}>{heading.h2[1]}</span>
              </>
            ) : (
              <>
                {t.heading}
                <span style={{ color: "var(--gilt)" }}>{t.accent}</span>
              </>
            )}
          </h2>
        </div>

        {hasReviews && (
          <>
            <ul className="mds-voices">{items}</ul>
            <div className="mt-12">{googleLink}</div>
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
