import type { Metadata } from "next";
import LegalPage, { type Lang } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How Modolo Digital Studio collects and processes personal data, in accordance with the Swiss FADP and the EU GDPR.",
};

const langs: Lang[] = ["en", "de", "it"];

export default async function PrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  const lang: Lang = langs.includes(raw as Lang) ? (raw as Lang) : "en";
  return <LegalPage kind="privacy" initialLang={lang} />;
}
