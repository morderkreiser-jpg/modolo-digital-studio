import { Check } from "lucide-react";
import type { Locale } from "@/lib/i18n";

/**
 * Risk-reversal band — the closest honest substitute for the reviews Francesco doesn't have yet.
 * States the three fears a cautious Swiss buyer has (paying for something they dislike, an
 * open-ended bill, being locked in) and removes each in plain language, out loud.
 */
const T: Record<Locale, { kicker: string; head: string; accent: string; points: string[]; note: string }> = {
  it: {
    kicker: "Zero rischi per te",
    head: "Il rischio", accent: "me lo prendo io.",
    points: [
      "Approvi il design prima che scriva una riga di codice. Se la prima proposta non ti convince, la rifaccio. Se non ti convince nemmeno la seconda, ci fermiamo e ti restituisco l'acconto.",
      "Il prezzo fisso lo decidiamo prima e lo metto per iscritto: quello paghi, nessuna sorpresa alla fine.",
      "Il sito è tuo. Nessun vincolo: se un giorno vuoi cambiare, te lo porti via.",
    ],
    note: "Prendo pochi progetti alla volta, per seguirli come si deve — scrivimi e ti dico subito la prima data libera.",
  },
  de: {
    kicker: "Null Risiko für dich",
    head: "Das Risiko", accent: "trage ich.",
    points: [
      "Du genehmigst das Design, bevor ich eine Zeile Code schreibe. Überzeugt dich der erste Entwurf nicht, mache ich einen neuen. Überzeugt auch der zweite nicht, hören wir auf und du bekommst die Anzahlung zurück.",
      "Den Festpreis legen wir vorher fest und ich halte ihn schriftlich fest: den zahlst du, keine Überraschungen am Schluss.",
      "Die Website gehört dir. Keine Bindung: Willst du eines Tages wechseln, nimmst du sie mit.",
    ],
    note: "Ich nehme nur wenige Projekte auf einmal an, um sie richtig zu betreuen — schreib mir und ich sage dir gleich den nächsten freien Termin.",
  },
  en: {
    kicker: "Zero risk for you",
    head: "The risk", accent: "is on me.",
    points: [
      "You approve the design before I write a line of code. If the first draft doesn't convince you, I redo it. If the second one doesn't either, we stop and you get your deposit back.",
      "We agree the fixed price up front and I put it in writing: that's what you pay, no surprises at the end.",
      "The site is yours. No lock-in: if you ever want to move on, you take it with you.",
    ],
    note: "I take on only a few projects at a time, to do each one properly — write to me and I'll tell you the next free start date.",
  },
};

export default function GuaranteeBand({ lang }: { lang: Locale }) {
  const t = T[lang];
  return (
    <section className="bg-[var(--ink-panel)] px-6 sm:px-10 lg:px-16 py-24 md:py-32">
      <div className="mx-auto max-w-[1400px]">
        <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
          <div>
            <span className="micro-caps text-[var(--gilt)]">{t.kicker}</span>
            <h2 className="section-head display-space mt-4 text-[#17130e]">
              <span className="block">{t.head}</span>
              <em className="block text-[var(--gilt)]">{t.accent}</em>
            </h2>
          </div>
          <ul className="flex flex-col justify-center gap-5">
            {t.points.map((p, i) => (
              <li key={i} className="flex items-start gap-4 border-t border-[color:var(--gold-line)] pt-5 first:border-t-0 first:pt-0">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--color-gold)" }}>
                  <Check className="h-3.5 w-3.5 text-[#231a09]" strokeWidth={2.5} />
                </span>
                <span className="text-[15px] font-light leading-relaxed text-[#17130e]/80 md:text-base">{p}</span>
              </li>
            ))}
          </ul>
        </div>
        <p className="mt-12 max-w-2xl text-sm font-light leading-relaxed text-[#17130e]/55">{t.note}</p>
      </div>
    </section>
  );
}
