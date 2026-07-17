// Real customer reviews. Single source for BOTH the testimonials section (components/testimonials.tsx)
// AND the schema.org Review / AggregateRating in lib/json-ld.ts.
//
// ⚠️ LEAVE EMPTY until you have genuine reviews — ideally the same ones on your Google Business
// Profile. Never invent ratings or names: Google penalizes self-serving/fake review markup, and
// the schema helper deliberately emits NOTHING while this array is empty. When empty, the
// testimonials section also hides itself.
//
// To go live: uncomment/duplicate the example and fill in real data.

export type ReviewItem = {
  author: string; // full name, e.g. "Maria Rossi"
  company: string; // business + town, e.g. "SaporiVivi · Zürich"
  rating: number; // 1–5
  body: string; // the quote, in the customer's own words
  datePublished: string; // ISO date, e.g. "2026-01-15"
};

export const REVIEWS: ReviewItem[] = [
  // {
  //   author: "Nome Cognome",
  //   company: "Azienda · Città",
  //   rating: 5,
  //   body: "Frase reale del cliente…",
  //   datePublished: "2026-01-15",
  // },
];

export const AGGREGATE =
  REVIEWS.length > 0
    ? {
        ratingValue: (REVIEWS.reduce((sum, r) => sum + r.rating, 0) / REVIEWS.length).toFixed(1),
        reviewCount: REVIEWS.length,
      }
    : null;
