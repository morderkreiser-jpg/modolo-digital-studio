// Where the printed QR codes land.
//
// The cards carry /bewertung (Winterthur) and /recensione (San Vendemiano), NOT the Google URL
// itself. Three reasons, and they are the difference between a card that lasts and dead paper:
//
//   - the `g.page/r/…/review` short-link format is undocumented and Google has retired link
//     schemes before (generic goo.gl links stopped resolving on 25 Aug 2025). A printed card
//     outlives a URL scheme;
//   - the target can be re-pointed without reprinting — a merged listing, a second location, a
//     re-verified profile all become an env change instead of a discarded run;
//   - it is the only place a scan can ever be counted. The Google link tells us nothing.
//
// A review lands on whichever profile the link names and CANNOT be moved afterwards, so the two
// routes are deliberately separate and must never be collapsed into one.
import { SITE } from "@/lib/site";

export type ReviewProfile = "ch" | "it";

const LOCALITY: Record<ReviewProfile, string> = {
  ch: SITE.address.locality,
  it: SITE.addressIt.locality,
};

/**
 * The review URL for a profile. Prefers the configured Google link; falls back to a Maps search
 * for the business so a scanned card is never a dead end.
 *
 * Set in the Vercel project (Production + Preview), then redeploy:
 *   GOOGLE_REVIEW_CH = https://g.page/r/…/review     (profilo Winterthur)
 *   GOOGLE_REVIEW_IT = https://g.page/r/…/review     (profilo San Vendemiano)
 *
 * Read per request rather than at module scope: the value must be changeable by editing the
 * environment, which is the whole point of routing the QR through our own domain.
 */
export function reviewTarget(profile: ReviewProfile): string {
  const configured = (profile === "ch" ? process.env.GOOGLE_REVIEW_CH : process.env.GOOGLE_REVIEW_IT)?.trim();
  if (configured) return configured;

  // Fallback: the profile's own Maps entry. One extra tap ("Write a review") rather than a 404 —
  // worse than the direct link, and infinitely better than a card that goes nowhere.
  const query = encodeURIComponent(`${SITE.name} ${LOCALITY[profile]}`);
  return `https://www.google.com/maps/search/?api=1&query=${query}`;
}

/** True when the real review link is configured — used by the health check. */
export function isReviewLinkConfigured(profile: ReviewProfile): boolean {
  const v = (profile === "ch" ? process.env.GOOGLE_REVIEW_CH : process.env.GOOGLE_REVIEW_IT)?.trim();
  return Boolean(v);
}
