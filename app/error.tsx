"use client";

import { useEffect } from "react";
import Link from "next/link";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error to the console / monitoring.
    console.error(error);
  }, [error]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-[#F7F3EC] text-[#1F1B16] px-6 text-center">
      <span className="text-[var(--color-gold-ink)] text-xs tracking-[0.3em] uppercase mb-4">Something went wrong</span>
      <h1 className="text-4xl md:text-6xl font-light tracking-tight mb-4">An unexpected error occurred</h1>
      <p className="text-[#1F1B16]/55 font-light max-w-md mb-10">
        Please try again. If the problem persists, contact us at info@modolodigitalstudio.ch.
      </p>
      <div className="flex flex-col sm:flex-row gap-4">
        <button
          onClick={reset}
          className="inline-flex items-center justify-center gap-2 bg-[#1F1B16] text-[#F7F3EC] px-8 py-4 rounded-full font-medium tracking-wider hover:bg-[#33291E] transition-all"
        >
          Try again
        </button>
        <Link
          href="/"
          className="inline-flex items-center justify-center gap-2 border border-[#1F1B16]/15 px-8 py-4 rounded-full font-medium tracking-wider hover:border-[#B5893F]/60 hover:text-[#B5893F] transition-all"
        >
          Homepage
        </Link>
      </div>
    </main>
  );
}
