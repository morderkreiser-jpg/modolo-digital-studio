"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { SITE } from "@/lib/site";
import type { Locale } from "@/lib/i18n";

/**
 * Free personal video review — the lead magnet that flips "book a call" (effort + commitment) into
 * "get a free expert opinion on me" (pure gain). The visitor drops their business name/URL and gets
 * a WhatsApp chat prefilled with the request; Francesco records a short screen video (he already
 * edits video) showing what a customer sees on Google + the first 3 fixes. Almost impossible for an
 * agency to replicate, and it proves competence better than any form.
 */
const T: Record<Locale, {
  kicker: string; head: string; accent: string; desc: string; placeholder: string; button: string;
  waMsg: (biz: string) => string;
}> = {
  it: {
    kicker: "Provami senza impegno",
    head: "Vuoi vedere come appari", accent: "su Google adesso?",
    desc: "Scrivimi il nome della tua attività (o il tuo sito). Entro 24 ore ti registro un breve video — senza paroloni — con cosa vede un cliente quando ti cerca, e le 3 cose che sistemerei per prime. Gratis, nessun impegno.",
    placeholder: "Nome della tua attività o sito",
    button: "Richiedi il video gratis",
    waMsg: (b) => b ? `Ciao Francesco! La mia attività è "${b}". Mi mandi la video-recensione gratuita di come appaio su Google?` : "Ciao Francesco! Vorrei la video-recensione gratuita di come appare la mia attività su Google.",
  },
  de: {
    kicker: "Teste mich unverbindlich",
    head: "Willst du sehen, wie du", accent: "gerade bei Google aussiehst?",
    desc: "Schreib mir den Namen deines Betriebs (oder deine Website). Innert 24 Stunden nehme ich dir ein kurzes Video auf — ohne Fachchinesisch — mit dem, was ein Kunde sieht, wenn er dich sucht, und den 3 Dingen, die ich zuerst ändern würde. Gratis, unverbindlich.",
    placeholder: "Name deines Betriebs oder deine Website",
    button: "Gratis-Video anfragen",
    waMsg: (b) => b ? `Hoi Francesco! Mein Betrieb ist "${b}". Schickst du mir das Gratis-Video, wie ich bei Google aussehe?` : "Hoi Francesco! Ich hätte gerne das Gratis-Video, wie mein Betrieb bei Google aussieht.",
  },
  en: {
    kicker: "Try me, no strings",
    head: "Want to see how you", accent: "look on Google right now?",
    desc: "Send me your business name (or your website). Within 24 hours I'll record you a short video — no jargon — showing what a customer sees when they search for you, and the 3 things I'd fix first. Free, no obligation.",
    placeholder: "Your business name or website",
    button: "Request the free video",
    waMsg: (b) => b ? `Hi Francesco! My business is "${b}". Could you send me the free video review of how I look on Google?` : "Hi Francesco! I'd like the free video review of how my business looks on Google.",
  },
};

export default function VideoReview({ lang }: { lang: Locale }) {
  const t = T[lang];
  const [biz, setBiz] = useState("");
  const phone = SITE.phone.replace(/[^0-9]/g, "");
  const wa = `https://wa.me/${phone}?text=${encodeURIComponent(t.waMsg(biz.trim()))}`;

  return (
    <section className="bg-[var(--ink-panel)] px-6 sm:px-10 lg:px-16 py-20 md:py-28">
      <div className="mx-auto max-w-[1000px] rounded-[8px] border border-[color:var(--gold-line)] bg-[var(--ink-bg)] p-8 sm:p-12 md:p-16">
        <span className="micro-caps text-[var(--gilt)]">{t.kicker}</span>
        <h2 className="section-head display-space mt-4 text-[#17130e]">
          {t.head} <em className="text-[var(--color-gold)]">{t.accent}</em>
        </h2>
        <p className="mt-5 max-w-2xl font-light leading-relaxed text-[#17130e]/68">{t.desc}</p>

        <form className="mt-8 flex flex-col gap-3 sm:flex-row" onSubmit={(e) => { e.preventDefault(); window.open(wa, "_blank", "noopener"); }}>
          <input
            type="text"
            value={biz}
            onChange={(e) => setBiz(e.target.value)}
            placeholder={t.placeholder}
            aria-label={t.placeholder}
            className="flex-1 rounded-full border border-[color:var(--gold-line-strong)] bg-[#fbf8f2] px-6 py-4 text-[#17130e] outline-none transition-colors placeholder:text-[#17130e]/40 focus:border-[var(--color-gold)]"
          />
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-2 rounded-full px-7 py-4 text-sm font-semibold tracking-wide text-[#231a09] transition-transform duration-300 hover:scale-[1.02]"
            style={{ background: "linear-gradient(120deg,#d9ab45,#c9992f 46%,#a97e2c)", boxShadow: "0 14px 34px -12px rgba(181,137,63,0.7)" }}
          >
            <MessageCircle className="h-4 w-4" strokeWidth={1.8} />
            {t.button}
          </a>
        </form>
      </div>
    </section>
  );
}
