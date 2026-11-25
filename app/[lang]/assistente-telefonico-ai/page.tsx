import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JsonLd from "@/components/json-ld";
import VoiceLanding from "@/components/voice/landing/voice-landing";
import { isLocale } from "@/lib/i18n";
import { isVoiceLandingOn, voiceLandingGraph, voiceLandingMetadata } from "@/lib/voice/landing";

// Sales page of Modolo Voice AI. The folder name is the canonical segment; the public URLs are
// /ai-receptionist, /de/ki-telefonassistent and /it/assistente-telefonico-ai (SLUG_TRANSLATIONS in
// lib/i18n.ts, rewritten by proxy.ts).
//
// Off unless VOICE_LANDING is switched on (DECISIONS.md D12): then the page answers 404, carries
// noindex and stays out of the sitemap. Prerendered like the other pages, so the switch is read at
// build time and a change takes a new deployment.

export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLocale(lang)) return {};
  return voiceLandingMetadata(lang);
}

export default async function Page({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLocale(lang) || !isVoiceLandingOn()) notFound();

  return (
    <>
      <JsonLd data={voiceLandingGraph(lang)} />
      <VoiceLanding lang={lang} />
    </>
  );
}
