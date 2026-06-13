import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import PricingPage from "@/components/pricing-page";
import JsonLd from "@/components/json-ld";
import { pricingGraph } from "@/lib/json-ld";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { PRICING_UI } from "@/lib/pricing";
import { isRegion, DEFAULT_REGION, REGION_COOKIE, type Region } from "@/lib/region";

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

  // Resolve the pricing region on the server so the prerendered HTML already matches the
  // visitor (no CHF->EUR flash; an IT visitor/crawler sees EUR): explicit cookie choice first,
  // otherwise the Vercel geo country header. Reading cookies()/headers() makes this page dynamic.
  const cookieRegion = (await cookies()).get(REGION_COOKIE)?.value;
  let region: Region = DEFAULT_REGION;
  if (isRegion(cookieRegion)) region = cookieRegion;
  else if ((await headers()).get("x-vercel-ip-country") === "IT") region = "it";

  return (
    <>
      <JsonLd data={pricingGraph(lang, region)} />
      <PricingPage lang={lang} initialRegion={region} />
    </>
  );
}
