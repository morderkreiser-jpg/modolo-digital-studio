import { NextResponse } from "next/server";
import { reviewTarget } from "@/lib/review-links";

// QR target printed on the Italian card for the ITALIAN market -> the SAN VENDEMIANO profile.
// An Italian-speaking client in Zürich must be given the /bewertung card instead: a review
// lands on whichever profile the link names and cannot be moved afterwards.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(reviewTarget("it"), 307);
}
