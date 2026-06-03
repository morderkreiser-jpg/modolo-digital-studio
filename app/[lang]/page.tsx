import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Home from "@/components/home";
import JsonLd from "@/components/json-ld";
import { homeGraph } from "@/lib/json-ld";
import { isLocale, buildAlternates } from "@/lib/i18n";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lang: string }>;
}): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  // Title/description inherited from the [lang] layout (HOME_META default).
  return { alternates: buildAlternates(lang, "/") };
}

export default async function Page({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  return (
    <>
      <JsonLd data={homeGraph(lang)} />
      <Home lang={lang} />
    </>
  );
}
