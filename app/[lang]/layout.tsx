import type { Metadata } from "next";
import { Poppins, Fraunces, Space_Grotesk } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { notFound } from "next/navigation";
import "../globals.css";
import { SITE } from "@/lib/site";
import { LOCALES, OG_LOCALE, HTML_LANG, isLocale, localizedHref, type Locale } from "@/lib/i18n";
import { HOME_META } from "@/lib/site-data";
import MotionProvider from "@/components/motion-provider";
import SmoothScroll from "@/components/smooth-scroll";

// Localized label for the skip-to-content link (first focusable element on every page).
const SKIP_LABEL: Record<Locale, string> = {
  en: "Skip to content",
  de: "Zum Inhalt springen",
  it: "Vai al contenuto",
};

// Per-locale meta keywords. (Ignored by Google, but kept coherent per language instead of
// English on every page; the German set targets the Winterthur/Zürich local market.)
const KEYWORDS: Record<Locale, string[]> = {
  en: [
    "web design Switzerland",
    "web development Winterthur",
    "web studio Zurich",
    "SEO",
    "branding",
    "Google Business Profile",
    "Modolo Digital Studio",
  ],
  de: [
    "Webdesign Winterthur",
    "Webagentur Zürich",
    "Webdesigner Winterthur",
    "Website erstellen lassen Schweiz",
    "SEO",
    "Branding",
    "Google Unternehmensprofil",
    "Modolo Digital Studio",
  ],
  it: [
    "web design Svizzera",
    "sviluppo siti Winterthur",
    "web agency Zurigo",
    "SEO",
    "branding",
    "Google Business",
    "Modolo Digital Studio",
  ],
};

// Poppins: font principale (navbar, body, titoli, UI)
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Fraunces: variable editorial serif — used ONLY for the small italic craft accents
// (step numbers, dashes) below the fold. Italic-only + preload:false keeps its ~270 KB off
// the critical path so it never competes with the LCP hero image; it swaps in on scroll.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  axes: ["opsz", "SOFT"],
  style: "italic",
  preload: false,
  display: "swap",
});

// Space Grotesk: modern techy grotesk — the display voice for the "immersive" direction.
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

// Prerender one tree per locale; reject anything else (e.g. /fr) with a 404.
export function generateStaticParams() {
  return LOCALES.map((lang) => ({ lang }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const meta = HOME_META[lang];
  const alternateLocale = LOCALES.filter((l) => l !== lang).map((l) => OG_LOCALE[l]);

  return {
    metadataBase: new URL(SITE.url),
    title: { default: meta.title, template: "%s | Modolo Digital Studio" },
    description: meta.description,
    keywords: KEYWORDS[lang],
    authors: [{ name: SITE.name }],
    creator: SITE.name,
    openGraph: {
      type: "website",
      locale: OG_LOCALE[lang],
      alternateLocale,
      url: localizedHref(lang, "/"),
      siteName: SITE.name,
      title: meta.title,
      description: meta.description,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: SITE.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: meta.title,
      description: meta.description,
      images: ["/og-image.png"],
    },
    robots: { index: true, follow: true },
    verification: { google: "0w87FfEDbhXnZEhQt5J_MfS05dlYnG08oTs0zzuej4U" },
  };
}

export default async function LangLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();

  return (
    <html
      lang={HTML_LANG[lang]}
      className={`${poppins.variable} ${fraunces.variable} ${spaceGrotesk.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-[#1F1B16] focus:px-5 focus:py-3 focus:text-sm focus:font-medium focus:text-[#F7F3EC] focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F7F3EC]"
        >
          {SKIP_LABEL[lang]}
        </a>
        <MotionProvider>
          <SmoothScroll>{children}</SmoothScroll>
        </MotionProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
