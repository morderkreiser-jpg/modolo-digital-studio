import Image from "next/image";
import Link from "next/link";
import { Star } from "lucide-react";
import { REVIEWS, readsNatively, type ReviewItem, type ReviewLang } from "@/data/reviews";
import { CLIENTS } from "@/data/clients";
import { SITE } from "@/lib/site";
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
//    guardarlo. Ora le quattro voci dicono tutte da dove vengono: quella scritta nella lingua
//    della pagina in oro ("originale"), le altre in grigio ("tradotta"). E' un fatto linguistico,
//    non un premio: per questo puo' stare su una voce senza declassare le altre tre.
//
// 3. Sotto c'e' il link alla scheda Google. Una testimonianza che non si puo' verificare vale
//    quanto una inventata, perche' il lettore non ha modo di distinguerle.
//
// LAYOUT: una sola banda da quattro colonne (>=1280px), senza schede. La griglia sta in
// app/globals.css sotto .mds-voices, scritta a mano come .mds-split-*: il numero di colonne e' la
// sostanza di questo blocco e non puo' dipendere da quali utility il build decide di emettere.
// Le schede con bordo erano la CAUSA del difetto segnalato: obbligano a un'altezza comune, quindi
// la citazione corta si stira e lascia un buco, e la quarta cade da sola sulla riga sotto. Senza
// scatola, la differenza di lunghezza legge come un normale finale di colonna.
//
// Le recensioni NON finiscono nei dati strutturati: vedi la nota in lib/json-ld.ts (regola Google
// sulle recensioni "self-serving" ospitate sul sito dell'azienda recensita).

/** La sezione mostra sempre una banda piena, mai una riga spaiata. Le altre stanno su Google. */
const MAX_SHOWN = 4;

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
  const voices = orderForLocale(REVIEWS, lang).slice(0, MAX_SHOWN);

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
            <ul className="mds-voices">
              {voices.map((r, idx) => {
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
                      {/* Nome e stelle SOPRA la citazione: cosi' le quattro intestazioni sono
                          allineate su una riga sola e l'unico bordo irregolare e' il fondo del
                          testo, dove leggere un finale di colonna e' normale. */}
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
                      <blockquote lang={quoteLang}>{`“${shown}”`}</blockquote>
                    </figure>
                  </li>
                );
              })}
            </ul>

            <div className="mt-12">
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
