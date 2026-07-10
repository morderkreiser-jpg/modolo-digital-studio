import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PricingPage from "@/components/pricing-page";
import JsonLd from "@/components/json-ld";
import { pricingGraph } from "@/lib/json-ld";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { PRICING_UI } from "@/lib/pricing";
import type { Region } from "@/lib/region";

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

  // EUR pricing hidden for now (client request 2026-07-10): serve CHF prices to everyone.
  // Revert this commit to restore the geo/cookie-based CH/EUR resolution.
  const region: Region = "ch";

  return (
    <>
      <JsonLd data={pricingGraph(lang, region)} />
      <PricingPage lang={lang} />
    </>
  );
}
