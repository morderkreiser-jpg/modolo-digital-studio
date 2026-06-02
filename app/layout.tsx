import type { Metadata } from "next";
import { Poppins, Lora } from "next/font/google";
import "./globals.css";

// Poppins: font principale (navbar, body, titoli, UI)
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});

// Lora: SOLO in corsivo, come accento elegante (tagline, citazioni, frasi speciali)
const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  style: ["italic"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.modolodigitalstudio.ch"),
  title: {
    default: "Modolo Digital Studio | Web Design & Development in Switzerland",
    template: "%s | Modolo Digital Studio",
  },
  description:
    "We are a digital studio transforming the online presence of professionals and businesses across Switzerland. Design, code, and strategy for brands that want to stand out.",
  keywords: [
    "web design Switzerland",
    "web development Switzerland",
    "digital studio",
    "SEO",
    "branding",
    "Google Business",
    "Modolo Digital Studio",
  ],
  authors: [{ name: "Modolo Digital Studio" }],
  creator: "Modolo Digital Studio",
  alternates: {
    canonical: "https://www.modolodigitalstudio.ch",
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    url: "https://www.modolodigitalstudio.ch",
    siteName: "Modolo Digital Studio",
    title: "Modolo Digital Studio | Web Design & Development in Switzerland",
    description:
      "Design, code, and strategy for brands that want to stand out. A Swiss digital studio.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Modolo Digital Studio",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Modolo Digital Studio | Web Design & Development in Switzerland",
    description:
      "Design, code, and strategy for brands that want to stand out. A Swiss digital studio.",
    images: ["/og-image.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${lora.variable} h-full antialiased scroll-smooth`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}