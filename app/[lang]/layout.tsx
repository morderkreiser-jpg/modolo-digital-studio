import type { Metadata } from "next";
import { Hanken_Grotesk, Fraunces } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { notFound } from "next/navigation";
import "../globals.css";
import { SITE } from "@/lib/site";
import { LOCALES, OG_LOCALE, isLocale, localizedHref, type Locale } from "@/lib/i18n";
import { HOME_META } from "@/lib/site-data";
import MotionProvider from "@/components/motion-provider";

// Localized label for the skip-to-content link (first focusable element on every page).
const SKIP_LABEL: Record<Locale, string> = {
  en: "Skip to content",
  de: "Zum Inhalt springen",
  it: "Vai al contenuto",
};

// Hanken Grotesk: clean, modern grotesque for body and UI.
const hanken = Hanken_Grotesk({
  variable: "--font-hanken",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Fraunces: high-contrast editorial serif for display headings and elegant italic accents.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  style: ["normal", "italic"],
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
    keywords: [
      "web design Switzerland",
      "web development Switzerland",
      "digital studio",
      "SEO",
      "branding",
      "Google Business",
      "Modolo Digital Studio",
    ],
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
      lang={lang}
      className={`${hanken.variable} ${fraunces.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-[100] focus:rounded-full focus:bg-[#1F1B16] focus:px-5 focus:py-3 focus:text-sm focus:font-medium focus:text-[#F7F3EC] focus:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F7F3EC]"
        >
          {SKIP_LABEL[lang]}
        </a>
        <MotionProvider>{children}</MotionProvider>
        <div className="mds-grain" aria-hidden="true" />
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
