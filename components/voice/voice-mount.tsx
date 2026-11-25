// Server entry of the voice widget: decides whether the stage exists at all and hands the browser
// only the public part of the tenant (VoicePublicConfig: no knowledge, rules, numbers or origins).
//
//   voice on                → the tenant's stage, with the modes the server offers right now
//   voice off, scripts given → the written examples still play: a scripted-only stage built from
//                              the scripts' tenant (no microphone, no network, no model)
//   voice off, no scripts    → nothing
//
// Pages are prerendered, so this usually runs at build time: switching voice off hides the stage
// from the next deployment on, while the API routes honour the switch at once and the stage
// explains that it is unavailable meanwhile.
import "server-only";
import { localizedHref, type Locale } from "@/lib/i18n";
import { availableModes, getVoiceEnv, resolveVoiceLimits } from "@/lib/voice/server/env";
import { toVoicePublicConfig } from "@/lib/voice/server/public-config";
import { DEFAULT_VOICE_TENANT_ID, getVoiceTenant } from "@/lib/voice/tenants";
import type { DemoScript, VoicePublicConfig, VoiceTenantConfig } from "@/lib/voice/types";
import VoiceStage from "./voice-stage";

export interface VoiceMountProps {
  /** The page's language (the site has en/de/it); the widget can switch to the tenant's others. */
  locale: Locale;
  tenantId?: string;
  variant?: "stage" | "compact";
  /** Example conversations to offer; only those of the stage's tenant are used. */
  scripts?: DemoScript[];
  /** Where "direct contact" leads; defaults to the contact section of the studio's homepage. */
  contactUrl?: string;
  headingLevel?: 2 | 3;
}

/** A script the stage can play: some lines, each with text. */
function isPlayable(script: DemoScript): boolean {
  return script.lines.some((line) => line.text.trim() !== "");
}

export default function VoiceMount({
  locale,
  tenantId = DEFAULT_VOICE_TENANT_ID,
  variant = "stage",
  scripts,
  contactUrl,
  headingLevel,
}: VoiceMountProps) {
  let config: VoicePublicConfig | null = null;
  let stageScripts: DemoScript[] = [];
  try {
    const env = getVoiceEnv();
    const examples = (scripts ?? []).filter(isPlayable);

    let tenant: VoiceTenantConfig | null;
    if (env.enabled) {
      tenant = getVoiceTenant(tenantId);
      if (!tenant) return null;
      config = toVoicePublicConfig(tenant, {
        locale,
        limits: resolveVoiceLimits(tenant, env),
        modes: availableModes(env),
      });
    } else {
      if (examples.length === 0) return null;
      // The asked-for tenant when the examples are its own, else the tenant the examples belong to.
      const ownerId = examples.some((script) => script.tenantId === tenantId) ? tenantId : examples[0].tenantId;
      tenant = getVoiceTenant(ownerId);
      if (!tenant) return null;
      config = toVoicePublicConfig(tenant, { locale, limits: resolveVoiceLimits(tenant, env), modes: ["scripted"] });
    }
    // Only the tenant's own examples may play on its stage.
    const ownerId = tenant.id;
    stageScripts = examples.filter((script) => script.tenantId === ownerId);
  } catch (error) {
    // An optional widget must never take the page down with it.
    console.error(`[voice] widget not mounted: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  }

  return (
    <VoiceStage
      config={config}
      scripts={stageScripts}
      variant={variant}
      contactUrl={contactUrl ?? localizedHref(locale, "/#contatti")}
      headingLevel={headingLevel}
    />
  );
}
