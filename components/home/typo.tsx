import { Fragment, type ReactNode } from "react";
import type { Locale } from "@/lib/i18n";
import { REPLY_TEXT, VIDEO_TEXT } from "@/content/home/promises";

// Typography rules from COPY §0 applied at render time, so the copy files stay plain strings:
// - a non-breaking space between CHF/€ and the amount, and between a number and h/Stunden/ore/hours
//   or a counted unit (Wochen/settimane/weeks, Seiten/pagine/pages, Fotos/foto/photos);
// - number ranges stay on one line: «8 bis 10» (no-break spaces), «8–10» (word joiner after the dash);
// - every reply-time and video-time promise shorter than 30 characters («Mo–Fr innert 24 Stunden»)
//   is kept on one line, so «Mo–Fr» never breaks after the dash.
// Server-safe (no hooks); client islands can import it too.

const NB = " ";

const WJ = "⁠"; // word joiner: no line break after the en dash of «8–10»

export function nbsp(s: string): string {
  return s
    .replace(/(CHF|€) (?=\d)/g, `$1${NB}`)
    .replace(/(\d) (bis|–)( ?)(?=\d)/g, (_m, d: string, w: string, sp: string) => `${d}${NB}${w}${sp ? NB : ""}`)
    .replace(/(\d)–(?=\d)/g, `$1–${WJ}`)
    .replace(/(\d) (h|Stunden|ore|hours|Wochen|settimane|weeks|Seiten|pagine|pages|Fotos|foto|photos)\b/g, `$1${NB}$2`);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const keepTogether: Record<Locale, RegExp | null> = (() => {
  const out = {} as Record<Locale, RegExp | null>;
  for (const lang of Object.keys(REPLY_TEXT) as Locale[]) {
    const parts = Array.from(new Set([...Object.values(REPLY_TEXT[lang]), ...Object.values(VIDEO_TEXT[lang])].map(nbsp)))
      .filter((v) => v.length < 30)
      .sort((a, b) => b.length - a.length)
      .map(escapeRe);
    out[lang] = parts.length ? new RegExp(`(${parts.join("|")})`, "g") : null;
  }
  return out;
})();

/** `text` with COPY §0 typography; returns a string when nothing needs a wrapper. */
export function typo(text: string, lang: Locale): ReactNode {
  const s = nbsp(text);
  const re = keepTogether[lang];
  if (!re) return s;
  const parts = s.split(re);
  if (parts.length === 1) return s;
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <span key={i} className="whitespace-nowrap">
        {part}
      </span>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}
