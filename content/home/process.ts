// Homepage copy: section 03 · Ablauf + Garantie (absorbs the old guarantee band). Strings verbatim
// from COPY.md §8. The guarantee wording (first draft redone, second → stop and deposit back,
// design phase only, drafts stay with Francesco) matches his visit kit; do not paraphrase it.
import type { Locale } from "@/lib/i18n";
import { REPLY_TEXT as R } from "./promises";

export type ProcessCopy = {
  kicker: string;
  h2: readonly [string, string];
  steps: readonly { title: string; text: string }[];
  guaranteeTitle: string;
  guaranteeText: string;
  guaranteeFooter: string;
  link: string; // WhatsApp, tag Ablauf (PREFILL.process)
  newTab: string;
};

export const PROCESS: Record<Locale, ProcessCopy> = {
  de: {
    kicker: "03 · Ablauf",
    h2: ["So läuft es ab.", "Das Risiko trage ich."],
    steps: [
      { title: "Du schreibst mir.", text: `Per WhatsApp oder über das Formular. Ich antworte ${R.de.long}. Wenn ich genug weiss, nenne ich dir gleich den Fixpreis.` },
      { title: "Du siehst den Entwurf.", text: "Bevor etwas online geht, zeige ich dir das Design. Du sagst mir, was ich ändern soll." },
      { title: "Online, und alles gehört dir.", text: "Nach der Schlusszahlung gehören dir Domain, Dateien und Zugänge. Betreuung kannst du dazunehmen, musst aber nicht." },
    ],
    guaranteeTitle: "Wenn dir der Entwurf nicht gefällt",
    guaranteeText: "Überzeugt dich der erste Entwurf nicht, mache ich einen neuen. Überzeugt dich auch der zweite nicht, hören wir auf und du bekommst die Anzahlung zurück. Das gilt in der Designphase, bevor die Website online geht. Die Entwürfe bleiben dann bei mir.",
    guaranteeFooter: "Fixpreis, schriftlich vor dem Start. Kein Pflicht-Abo.",
    link: "Per WhatsApp schreiben",
    newTab: "(öffnet in neuem Tab)",
  },
  it: {
    kicker: "03 · Come lavoro",
    h2: ["Come funziona.", "Il rischio è mio."],
    steps: [
      { title: "Mi scrivi.", text: `Su WhatsApp o con il modulo. Rispondo ${R.it.long}. Se so abbastanza, ti dico subito il prezzo fisso.` },
      { title: "Vedi la bozza.", text: "Prima che qualcosa vada online, ti mostro il design. Mi dici tu cosa cambiare." },
      { title: "Online, ed è tutto tuo.", text: "Dopo il saldo, dominio, file e accessi sono tuoi. L'assistenza puoi aggiungerla, ma non sei obbligato." },
    ],
    guaranteeTitle: "Se la bozza non ti piace",
    guaranteeText: "Se la prima bozza non ti convince, ne faccio una nuova. Se non ti convince nemmeno la seconda, ci fermiamo e ti restituisco l'acconto. Vale nella fase di design, prima che il sito vada online. In quel caso le bozze restano a me.",
    guaranteeFooter: "Prezzo fisso, per iscritto prima di iniziare. Nessun abbonamento obbligatorio.",
    link: "Scrivimi su WhatsApp",
    newTab: "(si apre in una nuova scheda)",
  },
  en: {
    kicker: "03 · Process",
    h2: ["How it works.", "I carry the risk."],
    steps: [
      { title: "You write to me.", text: `On WhatsApp or through the form. I reply ${R.en.long}. If I know enough, I tell you the fixed price straight away.` },
      { title: "You see the draft.", text: "Before anything goes live, I show you the design. You tell me what to change." },
      { title: "Live, and it's all yours.", text: "After the final payment, the domain, files and logins are yours. Care is optional; you never have to take it." },
    ],
    guaranteeTitle: "If you don't like the draft",
    guaranteeText: "If the first draft doesn't convince you, I make a new one. If the second doesn't either, we stop and you get your deposit back. This applies in the design phase, before the website goes live. In that case the drafts stay with me.",
    guaranteeFooter: "Fixed price, in writing before we start. No subscription required.",
    link: "Message me on WhatsApp",
    newTab: "(opens in a new tab)",
  },
};
