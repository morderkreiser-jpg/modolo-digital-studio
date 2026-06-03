import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PricingPage from "@/components/pricing-page";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { PRICING_UI } from "@/lib/pricing";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  const ui = PRICING_UI[lang];
  return pageMetadata(lang, {
    title: ui.metaTitle,
    description: ui.metaDescription,
    basePath: "/prezzi",
  });
}

export default async function Page({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return <PricingPage lang={lang} />;
}
