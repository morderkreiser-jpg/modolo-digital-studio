// Section 04 · Stimmen (SPEC §4.4, D19, D30). Server component, wraps components/testimonials.tsx.
//
// Three verbatim Google reviews from data/reviews.ts (Andrea Gonaj stays on Google only), per-locale
// order from content/home/reviews.ts, the Swiss German original on /de with lang="gsw", translations
// labelled as translations. The link opens the real Google profile (googleProfileUrl(), place_id),
// not a Maps search. The dated «4,5 ★ aus 8» line shows only while GOOGLE_RATING.show is true
// (false until Francesco has read and answered the four newer reviews).
// Never in JSON-LD: no Review / AggregateRating markup anywhere (Google's self-serving rule).
import type { Locale } from "@/lib/i18n";
import Testimonials from "@/components/testimonials";
import { REVIEWS_SECTION, REVIEWS_PICK } from "@/content/home/reviews";
import { GOOGLE_RATING } from "@/content/home/promises";

export default function Reviews({ lang }: { lang: Locale }) {
  const t = REVIEWS_SECTION[lang];
  const pick = REVIEWS_PICK[lang];
  return (
    <Testimonials
      lang={lang}
      variant="row"
      limit={3}
      exclude={pick.exclude}
      order={pick.order}
      heading={{ kicker: t.kicker, h2: t.h2 }}
      linkLabel={GOOGLE_RATING.show ? t.ratingLine : t.link}
      rowLabel={t.rowLabel}
    />
  );
}
