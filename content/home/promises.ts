import type { Locale } from "@/lib/i18n";

/** Replies (WhatsApp, form, e-mail): Francesco confirmed on 16.11.2026 that he answers within 24 h on
 *  Saturdays and Sundays too, so every reply promise drops the weekday limit. */
export const REPLY = { weekendsConfirmed: true } as const;

/** The free Google-check VIDEO is a separate promise: it stays weekdays-only until Francesco confirms that
 *  he also records and sends it on weekends (SPEC Q1). Flip to true and the offer sentence follows. */
export const VIDEO = { weekendsConfirmed: false } as const;

const REPLY_VARIANTS = {
  weekdays: {
    de: { short: "Mo–Fr innert 24 h", mid: "Mo–Fr innert 24 Stunden", long: "Mo–Fr innert 24 Stunden" },
    it: { short: "lun–ven entro 24 h", mid: "lun–ven entro 24 ore", long: "entro 24 ore, dal lunedì al venerdì" },
    en: { short: "Mon–Fri within 24 h", mid: "Mon–Fri within 24 hours", long: "within 24 hours, Monday to Friday" },
  },
  always: {
    de: { short: "innert 24 h", mid: "innert 24 Stunden", long: "innert 24 Stunden" },
    it: { short: "entro 24 h", mid: "entro 24 ore", long: "entro 24 ore" },
    en: { short: "within 24 h", mid: "within 24 hours", long: "within 24 hours" },
  },
} as const;

type PromiseText = Record<Locale, { short: string; mid: string; long: string }>;

/** How fast Francesco replies (hero chip, contact, process, local pages). */
export const REPLY_TEXT: PromiseText = REPLY.weekendsConfirmed ? REPLY_VARIANTS.always : REPLY_VARIANTS.weekdays;

/** When the free Google-check video arrives (section 02, rung 0). */
export const VIDEO_TEXT: PromiseText = VIDEO.weekendsConfirmed ? REPLY_VARIANTS.always : REPLY_VARIANTS.weekdays;

/** Off until Francesco has read and answered the 4 newer reviews; re-verify the numbers on the day it goes on. */
export const GOOGLE_RATING = { value: "4,5", valueEn: "4.5", count: 8, verifiedOn: "2026-11-14", show: false } as const;
