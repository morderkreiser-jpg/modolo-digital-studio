import type { Metadata } from "next";
import { notFound } from "next/navigation";
import ServicePage, { type Lang, type Slug } from "@/components/service-page";
import JsonLd from "@/components/json-ld";
import { serviceGraph } from "@/lib/json-ld";

const SLUGS: Slug[] = ["web", "brand", "content", "email"];
const LANGS: Lang[] = ["en", "de", "it"];

const META: Record<Slug, { title: string; description: string }> = {
  web: {
    title: "Web & Development",
    description:
      "Fast, modern websites optimised for local SEO and Google Business. Web design and development for businesses across Switzerland.",
  },
  brand: {
    title: "Brand & Identity",
    description:
      "Memorable visual identities: logo design, colour and typography systems, brand guidelines and branded templates.",
  },
  content: {
    title: "Content & Visual",
    description:
      "Professional photo shoots and social media management to bring your brand to life, in collaboration with Project Visibility.",
  },
  email: {
    title: "Email Marketing",
    description:
      "Newsletters and automated email campaigns that turn contacts into customers and grow your business.",
  },
};

export function generateStaticParams() {
  return SLUGS.map((slug) => ({ slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const m = META[slug as Slug];
  if (!m) return {};
  return {
    title: m.title,
    description: m.description,
    alternates: { canonical: `/servizi/${slug}` },
  };
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { slug } = await params;
  if (!SLUGS.includes(slug as Slug)) notFound();

  const sp = await searchParams;
  const raw = Array.isArray(sp.lang) ? sp.lang[0] : sp.lang;
  const lang: Lang = LANGS.includes(raw as Lang) ? (raw as Lang) : "en";

  return (
    <>
      <JsonLd data={serviceGraph(slug as Slug)} />
      <ServicePage slug={slug as Slug} initialLang={lang} />
    </>
  );
}
