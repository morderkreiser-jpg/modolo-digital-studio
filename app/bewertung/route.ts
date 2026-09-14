import { NextResponse } from "next/server";
import { reviewTarget } from "@/lib/review-links";

// QR target printed on the German/English review cards -> the WINTERTHUR profile.
// 307, never 308: a permanent redirect is cached by the phone that scanned it, and the whole
// reason this route exists is that the destination must stay changeable.
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.redirect(reviewTarget("ch"), 307);
}
