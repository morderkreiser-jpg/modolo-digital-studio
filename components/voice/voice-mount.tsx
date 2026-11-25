// Server entry of the voice widget: decides whether the stage exists at all and hands the browser
// only the public part of the tenant (VoicePublicConfig: no knowledge, rules, numbers or origins).
//
//   voice on                → the tenant's stage, with the modes the session route grants that
//                              tenant (a demo business: "scripted" only, unless VOICE_LAB)
//   voice off, scripts given → the written examples still play: a scripted-only stage built from
//                              the scripts' tenant (no microphone, no network, no model)
//   voice off, no scripts    → nothing
//
// The decision itself is lib/voice/server/mount-config.ts (voiceStageSetup), tested there.
//
// Pages are prerendered, so this usually runs at build time: switching voice off hides the stage
// from the next deployment on, while the API routes honour the switch at once and the stage
// explains that it is unavailable meanwhile.
import "server-only";
import { localizedHref, type Locale } from "@/lib/i18n";
import { getVoiceEnv } from "@/lib/voice/server/env";
import { voiceStageSetup, type VoiceStageSetup } from "@/lib/voice/server/mount-config";
import type { DemoScript } from "@/lib/voice/types";
import VoiceStage from "./voice-stage";

export interface VoiceMountProps {
  /**
   * The page's language (the site has en/de/it). The stage's controls and notices are always in
   * it; the conversation can switch to the tenant's other languages, and an example plays in its own.
   */
  locale: Locale;
  tenantId?: string;
  variant?: "stage" | "compact";
  /** Example conversations to offer; only those of the stage's tenant are used. */
  scripts?: DemoScript[];
  /** Where "direct contact" leads; defaults to the contact section of the studio's homepage. */
  contactUrl?: string;
  headingLevel?: 2 | 3;
}

export default function VoiceMount({ locale, tenantId, variant = "stage", scripts, contactUrl, headingLevel }: VoiceMountProps) {
  let setup: VoiceStageSetup | null;
  try {
    setup = voiceStageSetup({ env: getVoiceEnv(), locale, tenantId, scripts });
  } catch (error) {
    // An optional widget must never take the page down with it.
    console.error(`[voice] widget not mounted: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  }
  if (setup === null) return null;

  return (
    <VoiceStage
      config={setup.config}
      scripts={setup.scripts}
      uiLocale={setup.uiLocale}
      afterCalls={setup.afterCalls}
      variant={variant}
      contactUrl={contactUrl ?? localizedHref(locale, "/#contatti")}
      headingLevel={headingLevel}
    />
  );
}
