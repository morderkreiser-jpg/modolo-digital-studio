import type { Metadata } from "next";
import HeroImmersiveLight from "@/components/hero-immersive-light";

// Direction prototype (LIGHT variant, for comparison against the live dark homepage). Noindex.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PreviewPage() {
  return (
    <main className="min-h-screen bg-[#F6F1E7]">
      <HeroImmersiveLight />
    </main>
  );
}
