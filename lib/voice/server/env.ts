// Server-only configuration of Modolo Voice AI, read from environment variables.
//
// Same rules as the chat assistant (lib/assistant/server/env.ts): every value is trimmed, invalid
// numbers and enum values are ignored, numeric ranges are clamped, and nothing here throws, so a
// typo in a dashboard can never take the site down. At worst a setting falls back to its
// documented default, and for voice every fallback points the safe way: off, "scripted", lower.
//
// Unlike the chat env, the result is read ONCE and cached: the session secret may be generated
// at runtime (outside production), and it must stay the same for every token of the process.
// Tests call resetVoiceEnvForTests() after changing process.env.
//
// The effective mode is decided here, once, so that the session route, the public config and the
// lab page can never disagree about what the server offers:
//   VOICE_ENABLED=false (default) → the feature is off; routes answer "unavailable".
//   VOICE_MODE picks ONE live mode ("local" or "realtime"); "scripted" is always the fallback.
//   A live mode whose requirements are missing degrades to "scripted", never to the other one:
//   "local" uses the browser's own speech recognition, which sends audio to the browser vendor,
//   so it is never offered to visitors just because the realtime provider is missing.
//   In production every live mode also needs the shared store (Upstash): "realtime" bills real
//   money per minute and "local" real model tokens per turn, and per-instance memory counters
//   would let every instance spend the budget again. The session lock, the turn cap and the
//   conversation itself would live in one instance too (review finding S2-3).
//   In production "local" also needs the real model: VOICE_BRAIN=mock answers "[Testantwort]" to
//   visitors while its requests still reach the business by email (review finding S2-10).
//   Demo tenants get live modes only with VOICE_LAB on (availableModes with the tenant): their
//   live conversations exist to be shown on the owner's laptop, not to visitors of the public site.
import { createHash, randomBytes } from "node:crypto";
import { isValidEmail } from "@/lib/assistant/lead-schema";
import { getAssistantEnv } from "@/lib/assistant/server/env";
import { DEFAULT_VOICE_LIMITS, type VoiceLimits, type VoiceMode, type VoiceTenantConfig } from "@/lib/voice/types";
import { logVoiceEvent } from "./log";
import { MIN_WEBHOOK_SECRET_LENGTH } from "./webhook";

export const VOICE_BRAINS = ["anthropic", "mock"] as const;
export type VoiceBrain = (typeof VOICE_BRAINS)[number];

/** Realtime voice providers. Real ones (with their API key) are added next to "mock". */
export const VOICE_PROVIDER_IDS = ["none", "mock"] as const;
export type VoiceProviderId = (typeof VOICE_PROVIDER_IDS)[number];

/** Why the requested VOICE_MODE could not be honoured (for one log line, never shown to visitors). */
export type VoiceModeDegradation = "no_provider" | "no_provider_key" | "no_brain" | "no_secret" | "no_shared_store";

/** Ceilings across ALL tenants together, checked in the same reservation as each tenant's own. */
export interface VoiceGlobalLimits {
  /** Conversation minutes per UTC day, every tenant together. */
  minutesPerDay: number;
  /** Estimated spend per UTC month in CHF, every tenant together. */
  budgetChfPerMonth: number;
}

export interface VoiceEnv {
  /** VOICE_ENABLED is on. Off by default: the feature stays dark until it is switched on. */
  enabled: boolean;
  /** The mode the server actually runs, after degradation. */
  mode: VoiceMode;
  /** What VOICE_MODE asked for. */
  requestedMode: VoiceMode;
  degradedReason: VoiceModeDegradation | null;
  brain: VoiceBrain;
  /** Server only: never serialize, never log. */
  anthropicApiKey: string | null;
  model: string;
  maxOutputTokens: number;
  /**
   * HMAC key of the session tokens (at least 32 characters). null only in production without
   * VOICE_SESSION_SECRET: then only "scripted" is offered. Server only: never serialize, never log.
   */
  sessionSecret: string | null;
  sessionSecretSource: "env" | "generated" | "missing";
  provider: VoiceProviderId;
  /** VOICE_PROVIDER_API_KEY, for the real providers. Server only: never serialize, never log. */
  providerApiKey: string | null;
  /**
   * VOICE_PROVIDER_WEBHOOK_SECRET: the secret a voice provider signs its tool calls with (see
   * webhook.ts), at least MIN_WEBHOOK_SECRET_LENGTH characters. null = the tool webhook route does
   * not exist (404). Server only: never serialize, never log.
   */
  providerWebhookSecret: string | null;
  /** VOICE_COST_CHF_PER_MINUTE, or null for the per-mode default: see voiceCostChfPerMinute(). */
  costChfPerMinute: number | null;
  /**
   * VOICE_CHF_PER_USD: the fixed, conservative rate model costs (priced in USD) are charged at.
   * Deliberately above the market rate: the spend counters must err high.
   */
  chfPerUsd: number;
  /** VOICE_GLOBAL_MINUTES_PER_DAY and VOICE_GLOBAL_BUDGET_CHF_PER_MONTH. */
  global: VoiceGlobalLimits;
  /** VOICE_ALERT_EMAIL: where the spend alerts go (alerts.ts). Server only. */
  alertEmail: string | null;
  /**
   * VOICE_DEV_OUTBOX, outside production only: without an email service, the emails of live
   * tenants go to an in-memory outbox printed on the server console (outbox.ts) and count as
   * delivered. Always false in production, whatever the variable says.
   */
  devOutbox: boolean;
  /** VOICE_LAB: the internal test page exists. */
  lab: boolean;
  /** Env overrides of the main limits; resolveVoiceLimits() merges and clamps them. */
  limits: Partial<VoiceLimits>;
  /**
   * Salt for hashId() of IP subjects. Shared with the chat (ASSISTANT_HASH_SALT) when set, so one
   * secret covers both; otherwise derived from a configured secret so hashes are stable across
   * instances and cannot be reversed by brute-forcing the IPv4 space.
   */
  hashSalt: string;
  production: boolean;
}

export const DEFAULT_VOICE_MODEL = "claude-haiku-5-5";
// The allowance of one model call. It holds the model's thinking as well as the spoken reply and
// the tool input: the model thinks before it answers, and what it thinks counts as output. With
// 400 tokens, about one call in twenty of the first conversations with the real model ended at
// the limit, with the reply cut in the middle or with nothing said at all. The reply itself stays
// short because the prompt asks for it; the ceiling bounds the cost and the wait of one call.
// The longest call of the later runs used 910 tokens, hence a default well above that.
export const DEFAULT_VOICE_MAX_OUTPUT_TOKENS = 1500;
const MIN_VOICE_OUTPUT_TOKENS = 400;
const MAX_VOICE_OUTPUT_TOKENS = 2000;
export const MIN_SESSION_SECRET_LENGTH = 32;
/**
 * Estimated CHF per conversation minute when VOICE_COST_CHF_PER_MINUTE is not set. "local" has no
 * minute price of its own: the browser's speech is free, and the model's real cost is charged per
 * turn (limits.ts reserveTurnSpend), so a minute rate would count the model twice.
 */
export const DEFAULT_COST_CHF_PER_MINUTE: Readonly<Record<VoiceMode, number>> = {
  scripted: 0,
  local: 0,
  realtime: 0.25,
};
// Anything above this per minute is a typo (no provider costs that much), not a price.
const MAX_COST_CHF_PER_MINUTE = 10;
/** CHF charged per USD of model cost. The franc has traded below 0.92 per dollar for years. */
export const DEFAULT_CHF_PER_USD = 0.9;
// Below this an exchange rate is a typo that would undercount the spend; above it, nonsense.
const MIN_CHF_PER_USD = 0.5;
const MAX_CHF_PER_USD = 2;
/**
 * Defaults of the ceilings across all tenants: room for Modolo's own receptionist (30 minutes a
 * day, 30 CHF a month by default) and a little lab use, and no more.
 */
export const DEFAULT_VOICE_GLOBAL_LIMITS: Readonly<VoiceGlobalLimits> = {
  minutesPerDay: 60,
  budgetChfPerMonth: 50,
};
const GLOBAL_LIMIT_RANGES: Readonly<Record<keyof VoiceGlobalLimits, { min: number; max: number }>> = {
  minutesPerDay: { min: 0, max: 100_000 },
  budgetChfPerMonth: { min: 0, max: 100_000 },
};

/**
 * Sane range of every limit, applied after the tenant and env overrides. Zero is accepted where it
 * means "nothing allowed" (a drastic but valid way to stop sessions or spending); the fields
 * without which a session cannot work at all have a floor above zero.
 */
export const VOICE_LIMIT_RANGES: Readonly<Record<keyof VoiceLimits, { min: number; max: number; integer: boolean }>> = {
  maxCallSeconds: { min: 30, max: 1800, integer: true },
  warnBeforeEndSeconds: { min: 0, max: 120, integer: true },
  silenceTimeoutSeconds: { min: 5, max: 120, integer: true },
  maxTurnsPerSession: { min: 1, max: 200, integer: true },
  maxTurnChars: { min: 50, max: 4000, integer: true },
  sessionsPerIpPerHour: { min: 0, max: 1000, integer: true },
  sessionsPerIpPerDay: { min: 0, max: 10_000, integer: true },
  maxConcurrentSessions: { min: 0, max: 1000, integer: true },
  minutesPerDay: { min: 0, max: 100_000, integer: true },
  minutesPerMonth: { min: 0, max: 1_000_000, integer: true },
  budgetChfPerMonth: { min: 0, max: 100_000, integer: false },
  toolCallsPerSession: { min: 0, max: 100, integer: true },
  bookingsPerSession: { min: 0, max: 20, integer: true },
  leadsPerSession: { min: 0, max: 20, integer: true },
};

const MODES: readonly VoiceMode[] = ["scripted", "local", "realtime"];
const ON_VALUES = new Set(["true", "1", "on", "yes"]);
// Providers that work without an API key. Every real provider needs one.
const KEYLESS_PROVIDERS: ReadonlySet<VoiceProviderId> = new Set(["none", "mock"]);
const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{1,99}$/i;
// Plain decimal only: "1e3", "0x10" or "12abc" are typos, not numbers to reinterpret.
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

// Parked on globalThis so dev HMR (module re-evaluation) keeps the generated secret: a new one
// would invalidate every session token already handed out.
const DEV_SECRET = Symbol.for("mva.voice.dev-session-secret");
type SecretHolder = { [DEV_SECRET]?: { secret: string; warned: boolean } };
const FALLBACK_SALT = Symbol.for("mva.voice.fallback-salt");
type SaltHolder = { [FALLBACK_SALT]?: string };

let cached: VoiceEnv | null = null;

/** The voice configuration, parsed once per process (see the header). Never throws. */
export function getVoiceEnv(): VoiceEnv {
  return (cached ??= readVoiceEnv());
}

/** Forgets the cached configuration and the generated secret and salt, as if the process restarted. */
export function resetVoiceEnvForTests(): void {
  cached = null;
  const holder = globalThis as typeof globalThis & SecretHolder & SaltHolder;
  delete holder[DEV_SECRET];
  delete holder[FALLBACK_SALT];
}

/**
 * DEFAULT_VOICE_LIMITS, overridden by the tenant's limits, overridden by env; then every number is
 * clamped to VOICE_LIMIT_RANGES. Key by key, so an explicit `undefined` or a NaN in a partial
 * override can never erase a default.
 */
export function resolveVoiceLimits(tenant: Pick<VoiceTenantConfig, "limits">, env: Pick<VoiceEnv, "limits">): VoiceLimits {
  const limits: VoiceLimits = { ...DEFAULT_VOICE_LIMITS };
  for (const key of Object.keys(DEFAULT_VOICE_LIMITS) as Array<keyof VoiceLimits>) {
    const fromEnv = env.limits[key];
    const fromTenant = tenant.limits?.[key];
    if (isUsableNumber(fromEnv)) limits[key] = fromEnv;
    else if (isUsableNumber(fromTenant)) limits[key] = fromTenant;
    const range = VOICE_LIMIT_RANGES[key];
    const value = range.integer ? Math.round(limits[key]) : limits[key];
    limits[key] = clamp(value, range.min, range.max);
  }
  // The end warning must come before the cut, with a few seconds of conversation left to say it.
  limits.warnBeforeEndSeconds = Math.min(limits.warnBeforeEndSeconds, Math.max(0, limits.maxCallSeconds - 10));
  return limits;
}

/**
 * Modes the server offers right now, best first. Always ends with "scripted". With a tenant, the
 * modes offered to THAT tenant: a demo business gets only "scripted" unless VOICE_LAB is on. The
 * session route always passes the tenant; a page that shows a tenant's widget must too, or it
 * offers a mode the session route then answers with "scripted".
 */
export function availableModes(
  env: Pick<VoiceEnv, "mode"> & Partial<Pick<VoiceEnv, "lab">>,
  tenant?: Pick<VoiceTenantConfig, "kind">,
): VoiceMode[] {
  if (env.mode === "scripted") return ["scripted"];
  if (tenant?.kind === "demo" && env.lab !== true) return ["scripted"];
  return [env.mode, "scripted"];
}

/**
 * Estimated CHF per minute of a session in `mode`, for the budget reservation. "scripted" costs
 * nothing, and neither does a minute of "local": its only cost is the model's, charged per turn,
 * so VOICE_COST_CHF_PER_MINUTE (the provider's price) applies to "realtime" only. Priced, the
 * lease of every abandoned local session would sit on the month's spend (review finding S2-2).
 */
export function voiceCostChfPerMinute(env: Pick<VoiceEnv, "costChfPerMinute">, mode: VoiceMode): number {
  if (mode !== "realtime") return 0;
  return env.costChfPerMinute ?? DEFAULT_COST_CHF_PER_MINUTE[mode];
}

// ---------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------

function readVoiceEnv(): VoiceEnv {
  const production = process.env.NODE_ENV === "production";
  const anthropicApiKey = readString("ANTHROPIC_API_KEY");
  const brain = readEnum("VOICE_BRAIN", VOICE_BRAINS) ?? "anthropic";
  const provider = readEnum("VOICE_PROVIDER", VOICE_PROVIDER_IDS) ?? "none";
  const providerApiKey = readString("VOICE_PROVIDER_API_KEY");
  const requestedMode = readEnum("VOICE_MODE", MODES) ?? "scripted";
  const secret = readSessionSecret(production);

  const degradedReason = degradation(requestedMode, {
    secretOk: secret.value !== null,
    provider,
    providerKeyOk: KEYLESS_PROVIDERS.has(provider) || providerApiKey !== null,
    // The mock brain is for tests and development only (see the header).
    brainOk: brain === "mock" ? !production : anthropicApiKey !== null,
    sharedStoreOk: !production || sharedStoreConfigured(),
  });
  const mode: VoiceMode = degradedReason === null ? requestedMode : "scripted";
  const enabled = readFlag("VOICE_ENABLED");
  // The development outbox would tell callers "passed on" while nothing leaves the server: never
  // in production.
  const devOutboxAsked = readFlag("VOICE_DEV_OUTBOX");
  const devOutbox = devOutboxAsked && !production;

  // One line per process, and only when it matters: a switched-on feature running below what was
  // asked for. Names of the missing pieces only, never values.
  if (enabled && degradedReason !== null) {
    logVoiceEvent({ warn: "voice_mode_degraded", requested: requestedMode, mode, reason: degradedReason });
  }
  if (devOutboxAsked) logVoiceEvent({ warn: production ? "voice_dev_outbox_ignored" : "voice_dev_outbox_on" });

  return {
    enabled,
    mode,
    requestedMode,
    degradedReason,
    brain,
    anthropicApiKey,
    model: readModelId("VOICE_MODEL") ?? DEFAULT_VOICE_MODEL,
    maxOutputTokens:
      readClamped("VOICE_MAX_OUTPUT_TOKENS", MIN_VOICE_OUTPUT_TOKENS, MAX_VOICE_OUTPUT_TOKENS) ??
      DEFAULT_VOICE_MAX_OUTPUT_TOKENS,
    sessionSecret: secret.value,
    sessionSecretSource: secret.source,
    provider,
    providerApiKey,
    providerWebhookSecret: readWebhookSecret(),
    costChfPerMinute: readCost(),
    chfPerUsd: readClampedDecimal("VOICE_CHF_PER_USD", MIN_CHF_PER_USD, MAX_CHF_PER_USD) ?? DEFAULT_CHF_PER_USD,
    global: readGlobalLimits(),
    alertEmail: readEmail("VOICE_ALERT_EMAIL"),
    devOutbox,
    lab: readFlag("VOICE_LAB"),
    limits: readLimitOverrides(),
    hashSalt: readHashSalt(secret, anthropicApiKey),
    production,
  };
}

function degradation(
  requested: VoiceMode,
  state: { secretOk: boolean; provider: VoiceProviderId; providerKeyOk: boolean; brainOk: boolean; sharedStoreOk: boolean },
): VoiceModeDegradation | null {
  if (requested === "scripted") return null;
  if (requested === "realtime") {
    if (state.provider === "none") return "no_provider";
    if (!state.providerKeyOk) return "no_provider_key";
  } else if (!state.brainOk) {
    return "no_brain";
  }
  // Every live mode hands out signed session tokens.
  if (!state.secretOk) return "no_secret";
  // Every live mode spends real money and keeps its counters, its lock and its state in the store.
  return state.sharedStoreOk ? null : "no_shared_store";
}

/** True when the chat's store configuration points at Upstash (the shared, persistent store). */
function sharedStoreConfigured(): boolean {
  try {
    return getAssistantEnv().store.kind === "upstash";
  } catch {
    return false;
  }
}

function readGlobalLimits(): VoiceGlobalLimits {
  const read = (name: string, key: keyof VoiceGlobalLimits): number => {
    // Like the per-tenant overrides: a negative amount is a typo and keeps the default.
    const value = readNumber(name);
    if (value === null || value < 0) return DEFAULT_VOICE_GLOBAL_LIMITS[key];
    return clamp(value, GLOBAL_LIMIT_RANGES[key].min, GLOBAL_LIMIT_RANGES[key].max);
  };
  return {
    minutesPerDay: Math.round(read("VOICE_GLOBAL_MINUTES_PER_DAY", "minutesPerDay")),
    budgetChfPerMonth: read("VOICE_GLOBAL_BUDGET_CHF_PER_MONTH", "budgetChfPerMonth"),
  };
}

/**
 * VOICE_SESSION_SECRET when it is long enough. Without one, production has no secret (live modes
 * are switched off, see degradation()); development and tests get a random one per process, with
 * a single warning, so the feature can be tried without any setup.
 */
function readSessionSecret(production: boolean): { value: string | null; source: VoiceEnv["sessionSecretSource"] } {
  const configured = readString("VOICE_SESSION_SECRET");
  if (configured !== null && configured.length >= MIN_SESSION_SECRET_LENGTH) {
    return { value: configured, source: "env" };
  }
  if (production) return { value: null, source: "missing" };

  const holder = globalThis as typeof globalThis & SecretHolder;
  const dev = (holder[DEV_SECRET] ??= { secret: randomBytes(32).toString("base64url"), warned: false });
  if (!dev.warned) {
    dev.warned = true;
    logVoiceEvent({
      warn: "voice_session_secret_generated",
      reason: configured === null ? "missing" : "too_short",
    });
  }
  return { value: dev.secret, source: "generated" };
}

function readHashSalt(secret: { value: string | null; source: VoiceEnv["sessionSecretSource"] }, apiKey: string | null): string {
  const shared = readString("ASSISTANT_HASH_SALT");
  if (shared !== null) return shared;
  // Only a CONFIGURED secret gives the same salt on every instance; the generated one is per
  // process, which is acceptable in development only.
  if (secret.value !== null) return sha256Hex(`mva-salt:${secret.value}`);
  if (apiKey !== null) return sha256Hex(`mva-salt:${apiKey}`);
  // Production without any secret: scripted only, IP counters per process. A random salt keeps the
  // stored hashes irreversible; the price is that each instance counts on its own.
  const holder = globalThis as typeof globalThis & SaltHolder;
  return (holder[FALLBACK_SALT] ??= randomBytes(32).toString("hex"));
}

function readLimitOverrides(): Partial<VoiceLimits> {
  const overrides: Array<[keyof VoiceLimits, string]> = [
    ["maxCallSeconds", "VOICE_MAX_CALL_SECONDS"],
    ["minutesPerDay", "VOICE_MINUTES_PER_DAY"],
    ["minutesPerMonth", "VOICE_MINUTES_PER_MONTH"],
    ["budgetChfPerMonth", "VOICE_BUDGET_CHF_PER_MONTH"],
    ["maxConcurrentSessions", "VOICE_MAX_CONCURRENT"],
  ];
  const limits: Partial<VoiceLimits> = {};
  for (const [key, name] of overrides) {
    // A negative amount is a typo, not a request to block everything: ignore it. Out-of-range
    // positive values are clamped later by resolveVoiceLimits().
    const value = readNumber(name);
    if (value !== null && value >= 0) limits[key] = value;
  }
  return limits;
}

/** A short secret is treated as none: the route stays off rather than verify against a weak key. */
function readWebhookSecret(): string | null {
  const value = readString("VOICE_PROVIDER_WEBHOOK_SECRET");
  return value !== null && value.length >= MIN_WEBHOOK_SECRET_LENGTH ? value : null;
}

function readCost(): number | null {
  const value = readNumber("VOICE_COST_CHF_PER_MINUTE");
  // Zero would switch the spend ceiling off without anyone noticing: treated as a typo too.
  return value !== null && value > 0 && value <= MAX_COST_CHF_PER_MINUTE ? value : null;
}

// ---------------------------------------------------------------------------------------------
// Parsing helpers (same rules as the chat env)
// ---------------------------------------------------------------------------------------------

function readString(name: string): string | null {
  const raw = process.env[name];
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

function readNumber(name: string): number | null {
  const raw = readString(name);
  if (raw === null || !DECIMAL_RE.test(raw)) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function readClamped(name: string, min: number, max: number): number | null {
  const value = readNumber(name);
  return value === null ? null : clamp(Math.round(value), min, max);
}

function readClampedDecimal(name: string, min: number, max: number): number | null {
  const value = readNumber(name);
  return value === null ? null : clamp(value, min, max);
}

function readEnum<T extends string>(name: string, allowed: readonly T[]): T | null {
  const value = readString(name)?.toLowerCase();
  return allowed.find((option) => option === value) ?? null;
}

/** A switch that is off unless clearly switched on: a near miss leaves the feature off. */
function readFlag(name: string): boolean {
  const value = readString(name)?.toLowerCase();
  return value !== undefined && ON_VALUES.has(value);
}

function readModelId(name: string): string | null {
  const value = readString(name);
  return value !== null && MODEL_ID_RE.test(value) ? value : null;
}

function readEmail(name: string): string | null {
  const value = readString(name);
  return value !== null && isValidEmail(value) ? value : null;
}

function isUsableNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
