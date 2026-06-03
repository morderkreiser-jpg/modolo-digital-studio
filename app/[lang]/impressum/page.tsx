import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LegalPage from "@/components/legal-page";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { LEGAL_META } from "@/lib/site-data";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const m = LEGAL_META[lang].impressum;
  return pageMetadata(lang, { title: m.title, description: m.description, basePath: "/impressum" });
}

export default async function Page({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <LegalPage kind="impressum" lang={lang} />;
}
