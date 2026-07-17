import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Prefer AVIF (smaller than WebP) for the heavier photographic assets.
    formats: ["image/avif", "image/webp"],
  },
  // Permanent (308, treated as 301 by Google) redirects from the legacy Italian slugs to the
  // localized ones. These run BEFORE the proxy, so the proxy only ever sees the new URLs.
  async redirects() {
    return [
      // English (unprefixed): legacy IT slugs -> localized EN slugs.
      { source: "/servizi/:slug", destination: "/services/:slug", permanent: true },
      { source: "/prezzi", destination: "/pricing", permanent: true },
      // German: legacy IT slugs -> localized DE slugs.
      { source: "/de/servizi/:slug", destination: "/de/leistungen/:slug", permanent: true },
      { source: "/de/prezzi", destination: "/de/preise", permanent: true },
      { source: "/de/privacy", destination: "/de/datenschutz", permanent: true },
      // Italian keeps its slugs; EN /privacy is already canonical — no redirect needed.
    ];
  },
};

export default nextConfig;
