import type { Metadata } from "next";
import HeroImmersive from "@/components/hero-immersive";

// Local-only direction prototype — keep it out of search.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function PreviewPage() {
  return (
    <main className="min-h-screen bg-[#07070E]">
      <HeroImmersive />
    </main>
  );
}
