import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ServicePage from "@/components/service-page";
import JsonLd from "@/components/json-ld";
import { serviceGraph } from "@/lib/json-ld";
import { SERVICE_SLUGS, type ServiceSlug } from "@/lib/site";
import { isLocale } from "@/lib/i18n";
import { pageMetadata } from "@/lib/seo";
import { SERVICE_META } from "@/lib/site-data";

const isServiceSlug = (x: string): x is ServiceSlug =>
  (SERVICE_SLUGS as readonly string[]).includes(x);

// Generate the [slug] segments for each locale produced by the parent [lang] layout.
export function generateStaticParams() {
  return SERVICE_SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}): Promise<Metadata> {
  const { lang, slug } = await params;
  if (!isLocale(lang) || !isServiceSlug(slug)) return {};
  const m = SERVICE_META[lang][slug];
  return pageMetadata(lang, {
    title: m.title,
    description: m.description,
    basePath: `/servizi/${slug}`,
  });
}

export default async function Page({
  params,
}: {
  params: Promise<{ lang: string; slug: string }>;
}) {
  const { lang, slug } = await params;
  if (!isLocale(lang) || !isServiceSlug(slug)) notFound();
  return (
    <>
      <JsonLd data={serviceGraph(slug, lang)} />
      <ServicePage slug={slug} lang={lang} />
    </>
  );
}
