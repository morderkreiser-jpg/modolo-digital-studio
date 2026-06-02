import type { Metadata } from "next";
import LegalPage, { type Lang } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Legal Notice",
  description:
    "Legal notice and provider identification for Modolo Digital Studio, Scheideggstrasse 18, 8400 Winterthur, Switzerland.",
};

const langs: Lang[] = ["en", "de", "it"];

export default async function ImpressumPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  const lang: Lang = langs.includes(raw as Lang) ? (raw as Lang) : "en";
  return <LegalPage kind="impressum" initialLang={lang} />;
}
