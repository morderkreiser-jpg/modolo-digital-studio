import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LocalPage from "@/components/local-page";
import JsonLd from "@/components/json-ld";
import { localAreaGraph } from "@/lib/json-ld";
import { LOCAL_CITIES, LOCAL_AREAS, isCitySlug } from "@/lib/local-seo";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";

// One local-SEO page per area, per locale, produced by the parent [lang] layout.
export function generateStaticParams() {
  return LOCAL_CITIES.map((city) => ({ city }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; city: string }>;
}): Promise<Metadata> {
  const { lang, city } = await params;
  if (!isLocale(lang) || !isCitySlug(city)) return {};
  const area = LOCAL_AREAS[city];
  return pageMetadata(lang, {
    title: area.metaTitle[lang],
    description: area.metaDescription[lang],
    basePath: `/webdesign/${city}`,
  });
}

export default async function Page({
  params,
}: {
  params: Promise<{ lang: string; city: string }>;
}) {
  const { lang, city } = await params;
  if (!isLocale(lang) || !isCitySlug(city)) notFound();
  return (
    <>
      <JsonLd data={localAreaGraph(city, lang)} />
      <LocalPage slug={city} lang={lang} />
    </>
  );
}
