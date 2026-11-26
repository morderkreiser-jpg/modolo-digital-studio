// The browser-safe subset of a VoiceTenantConfig, passed from the server to the voice widget.
// Built field by field (never by spreading the tenant) so that the knowledge, the rules, the
// transfer numbers, the summary recipient and the allowed origins can never leak into the client
// bundle or the HTML. Localized texts are copied key by key for the tenant's own languages only,
// so nothing that happens to sit on those objects travels with them.
//
// Like lib/assistant/server/public-config.ts, this module imports only the contract's types and
// constants: it carries no secret even if it were bundled, and the server-only guard lives in
// the server component that calls it ("server-only" cannot be loaded by the node:test runner).
import {
  VOICE_CALL_ENDPOINT,
  VOICE_END_ENDPOINT,
  VOICE_READY_ENDPOINT,
  VOICE_REALTIME_CALL_MAX_SECONDS,
  VOICE_SESSION_ENDPOINT,
  VOICE_TURN_ENDPOINT,
  type VoiceLimits,
  type VoiceLocale,
  type VoiceMode,
  type VoicePublicConfig,
  type VoiceTenantConfig,
  type VoiceText,
} from "@/lib/voice/types";

const MODES: ReadonlySet<VoiceMode> = new Set(["scripted", "local", "realtime"]);

/** Own string entries of `text` for `locales` only. */
function copyText(text: VoiceText | undefined, locales: readonly VoiceLocale[]): VoiceText {
  const out: VoiceText = {};
  if (!text || typeof text !== "object") return out;
  for (const locale of locales) {
    const value = Object.hasOwn(text, locale) ? text[locale] : undefined;
    if (typeof value === "string" && value) out[locale] = value;
  }
  return out;
}

export function toVoicePublicConfig(
  tenant: VoiceTenantConfig,
  options: { locale: VoiceLocale; limits: VoiceLimits; modes: VoiceMode[] },
): VoicePublicConfig {
  const locales = [...tenant.locales];
  // Unknown modes are dropped and duplicates collapse; the order (best first) is kept.
  const modes = [...new Set(options.modes.filter((mode) => MODES.has(mode)))];
  const realtime = modes.includes("realtime");
  // A realtime call is cut at what the call route can hold, so the consent card's minutes match
  // the server's call length (the same formula as call.ts, callSecondsFor).
  const maxCallSeconds = realtime
    ? Math.max(30, Math.min(options.limits.maxCallSeconds, VOICE_REALTIME_CALL_MAX_SECONDS))
    : options.limits.maxCallSeconds;
  return {
    tenant: tenant.id,
    kind: tenant.kind,
    businessName: tenant.business.name,
    sector: tenant.business.sector,
    locale: locales.includes(options.locale) ? options.locale : tenant.defaultLocale,
    locales,
    assistantName: copyText(tenant.persona.assistantName, locales),
    greeting: copyText(tenant.greeting, locales),
    privacyUrl: copyText(tenant.privacy.noticeUrl, locales),
    limits: {
      maxCallSeconds,
      warnBeforeEndSeconds: options.limits.warnBeforeEndSeconds,
      silenceTimeoutSeconds: options.limits.silenceTimeoutSeconds,
      maxTurnChars: options.limits.maxTurnChars,
    },
    modes,
    endpoints: {
      session: VOICE_SESSION_ENDPOINT,
      turn: VOICE_TURN_ENDPOINT,
      end: VOICE_END_ENDPOINT,
      ...(realtime ? { call: VOICE_CALL_ENDPOINT, ready: VOICE_READY_ENDPOINT } : {}),
    },
  };
}
