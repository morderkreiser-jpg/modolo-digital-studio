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
  // A second, file-looking URL for the business card's contact file. Some in-app browsers
  // (WhatsApp's in particular) ignore Content-Disposition and save the download under the last
  // path segment: from /api/vcard that produces a file called "vcard" with no extension, which
  // Android will not hand to Contacts. A URL that already ends in .vcf survives that.
  // The path contains a dot, so proxy.ts's matcher skips it and no locale rewrite interferes.
  async rewrites() {
    return [{ source: "/francesco-modolo.vcf", destination: "/api/vcard" }];
  },
};

export default nextConfig;
