// What the voice stage of one tenant offers on a page: the public config and the examples, decided
// on the server (components/voice/voice-mount.tsx is the server component that renders it).
// Kept apart from that component so the decision can be tested without React or "server-only",
// which the node:test runner cannot load.
//
//   voice on                 → the tenant's stage, with the modes the session route grants THAT
//                              tenant: a demo business gets only "scripted" outside the lab
//   voice off, scripts given → the written examples still play: a scripted-only stage built from
//                              the scripts' tenant (no microphone, no network, no model)
//   voice off, no scripts    → nothing
import { DEFAULT_VOICE_TENANT_ID, getVoiceTenant } from "@/lib/voice/tenants";
import type { DemoScript, VoiceLocale, VoicePublicConfig, VoiceTenantConfig } from "@/lib/voice/types";
import { availableModes, resolveVoiceLimits, type VoiceEnv } from "./env";
import { toVoicePublicConfig } from "./public-config";

export interface VoiceStageSetup {
  config: VoicePublicConfig;
  /** The tenant's own playable examples. */
  scripts: DemoScript[];
}

/** A script the stage can play: some lines, each with text. */
function isPlayable(script: DemoScript): boolean {
  return script.lines.some((line) => line.text.trim() !== "");
}

/**
 * The stage of `tenantId` on a page in `locale`, or null when there is nothing to show.
 *
 * The modes are availableModes(env, tenant), exactly what openSession() grants: offered anything
 * more, a demo stage would start a live conversation (consent card, microphone) that the session
 * route then answers with "scripted", and every stage of the sales page would fail with
 * mode_unavailable once voice is switched on for the pilot (review finding N1).
 */
export function voiceStageSetup(args: {
  env: Pick<VoiceEnv, "enabled" | "mode" | "lab" | "limits">;
  locale: VoiceLocale;
  tenantId?: string;
  scripts?: DemoScript[];
}): VoiceStageSetup | null {
  const { env, locale } = args;
  const tenantId = args.tenantId ?? DEFAULT_VOICE_TENANT_ID;
  const examples = (args.scripts ?? []).filter(isPlayable);

  let tenant: VoiceTenantConfig | null;
  let config: VoicePublicConfig;
  if (env.enabled) {
    tenant = getVoiceTenant(tenantId);
    if (!tenant) return null;
    config = toVoicePublicConfig(tenant, { locale, limits: resolveVoiceLimits(tenant, env), modes: availableModes(env, tenant) });
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
  return { config, scripts: examples.filter((script) => script.tenantId === ownerId) };
}
