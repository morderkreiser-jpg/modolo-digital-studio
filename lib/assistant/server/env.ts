// Server-only configuration of the AI assistant, read from environment variables.
//
// Every value is parsed defensively: trimmed (a pasted trailing newline must not silently change
// behaviour), invalid numbers and enum values are ignored, numeric ranges are clamped. Nothing
// here throws, so a typo in a dashboard can never take the site down: at worst a setting falls
// back to its documented default. getAssistantEnv() reads process.env on every call (cheap), so
// changed variables and tests that mutate process.env take effect without a restart.
import { createHash } from "node:crypto";
import { isValidEmail } from "@/lib/assistant/lead-schema";
import {
  DEFAULT_LIMITS,
  type AssistantLimits,
  type Effort,
  type ModelRouting,
  type TenantConfig,
} from "@/lib/assistant/types";

export interface AssistantEnv {
  /** ASSISTANT_ENABLED is not "false" and ANTHROPIC_API_KEY is set. */
  enabled: boolean;
  disabledReason: "flag" | "no_api_key" | null;
  /** Server only: never serialize, never log. */
  apiKey: string | null;
  model: string;
  advancedModel: string | null;
  /** null → tenant setting → "fast". */
  routing: ModelRouting | null;
  /** null → tenant setting → "low". */
  effort: Effort | null;
  /** null → tenant setting → 2048. */
  maxOutputTokens: number | null;
  timeoutMs: number;
  hashSalt: string;
  adminToken: string | null;
  limits: Partial<AssistantLimits>;
  leadRetentionDays: number | null;
  /** Overrides tenant.leads.notifyEmail. */
  leadTo: string | null;
  /**
   * ASSISTANT_LEAD_COPY=true: also keep each quote request in Upstash until its retention ends.
   * Opt-in, because it puts personal data at one more processor: connecting Upstash for the
   * counters alone must not start storing leads.
   */
  leadCopy: boolean;
  resend: { apiKey: string; from: string } | null;
  store: { kind: "memory" } | { kind: "upstash"; url: string; token: string };
}

const DEFAULT_MODEL = "claude-haiku-5-5";
const DEFAULT_RESEND_FROM = "Modolo Digital Studio <onboarding@resend.dev>";
const DEFAULT_TIMEOUT_MS = 30_000;
// Thinking counts toward max_tokens: in the first test with the real model a 1024 cap left a
// quote-form reply 22 visible characters after ~960 tokens of thinking, and cut one off before
// its form. A higher cap costs nothing on short replies (only tokens produced are billed).
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_ROUTING: ModelRouting = "fast";
const DEFAULT_EFFORT: Effort = "low";

// Thinking tokens count toward max_tokens on the current models, so the floor stays well above a
// typical short answer; the ceiling bounds the cost of a single reply.
const MIN_OUTPUT_TOKENS = 256;
const MAX_OUTPUT_TOKENS = 4096;
const MIN_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 120_000;
const MIN_ADMIN_TOKEN_LENGTH = 24;
const MAX_BUDGET_USD = 1_000_000;
const MAX_REQUESTS_PER_DAY = 10_000_000;
const MAX_SESSION_MESSAGES = 100_000;

const ROUTINGS: readonly ModelRouting[] = ["fast", "advanced", "auto"];
const EFFORTS: readonly Effort[] = ["low", "medium", "high"];
const OFF_VALUES = new Set(["false", "0", "off", "no"]);

// A model id is a short slug ("claude-haiku-5-5", optionally a dated snapshot). Anything else is a
// paste error and is ignored rather than sent to the API.
const MODEL_ID_RE = /^[a-z0-9][a-z0-9._-]{1,99}$/i;
// Plain decimal only: "1e3", "0x10" or "12abc" are treated as typos, not silently reinterpreted.
const DECIMAL_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function getAssistantEnv(): AssistantEnv {
  const apiKey = readString("ANTHROPIC_API_KEY");
  const enabledFlag = readString("ASSISTANT_ENABLED");
  const disabledReason: AssistantEnv["disabledReason"] =
    enabledFlag !== null && OFF_VALUES.has(enabledFlag.toLowerCase())
      ? "flag"
      : apiKey === null
        ? "no_api_key"
        : null;

  return {
    enabled: disabledReason === null,
    disabledReason,
    apiKey,
    model: readModelId("ASSISTANT_MODEL") ?? DEFAULT_MODEL,
    advancedModel: readModelId("ASSISTANT_MODEL_ADVANCED"),
    routing: readEnum("ASSISTANT_MODEL_ROUTING", ROUTINGS),
    effort: readEnum("ASSISTANT_EFFORT", EFFORTS),
    maxOutputTokens: readClamped("ASSISTANT_MAX_OUTPUT_TOKENS", MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
    timeoutMs: readClamped("ASSISTANT_TIMEOUT_MS", MIN_TIMEOUT_MS, MAX_TIMEOUT_MS) ?? DEFAULT_TIMEOUT_MS,
    // Without an explicit salt, derive a stable secret one from the API key so IP hashes cannot be
    // reversed by brute-forcing the IPv4 space; the constant only applies to keyless local dev.
    hashSalt:
      readString("ASSISTANT_HASH_SALT") ??
      (apiKey !== null ? sha256Hex(`mda-salt:${apiKey}`) : "mda-dev-salt"),
    adminToken: readAdminToken(),
    limits: readLimitOverrides(),
    leadRetentionDays: readClamped("ASSISTANT_LEAD_RETENTION_DAYS", 1, 3650),
    leadTo: readEmail("ASSISTANT_LEAD_TO"),
    // Exactly "true" (any case): storing personal data is never switched on by a near miss.
    leadCopy: readString("ASSISTANT_LEAD_COPY")?.toLowerCase() === "true",
    resend: readResend(),
    store: readStore(),
  };
}

/** DEFAULT_LIMITS, overridden by the tenant's limits, overridden by env. */
export function resolveLimits(tenant: TenantConfig, env: AssistantEnv): AssistantLimits {
  const limits: AssistantLimits = { ...DEFAULT_LIMITS };
  for (const key of Object.keys(DEFAULT_LIMITS) as Array<keyof AssistantLimits>) {
    const fromEnv = env.limits[key];
    const fromTenant = tenant.limits?.[key];
    // Key by key, so an explicit `undefined` in a partial override can never erase a default.
    if (isUsableLimit(fromEnv)) limits[key] = fromEnv;
    else if (isUsableLimit(fromTenant)) limits[key] = fromTenant;
  }
  return limits;
}

/**
 * True when a quote request can actually reach the business: by email (Resend) or as a durable
 * copy (Upstash, only with ASSISTANT_LEAD_COPY=true). The single rule shared by the widget (form
 * shown?), the chat route (tool offered to the model?) and the lead route (request accepted?), so
 * the three can never disagree.
 */
export function canDeliverLeads(env: AssistantEnv): boolean {
  return env.resend !== null || (env.store.kind === "upstash" && env.leadCopy);
}

/** Retention actually applied to quote requests, in days: env override first, then the tenant. */
export function resolveLeadRetentionDays(tenant: TenantConfig, env: AssistantEnv): number {
  return env.leadRetentionDays ?? tenant.leads.retentionDays;
}

export function resolveAiSettings(
  tenant: TenantConfig,
  env: AssistantEnv,
): {
  model: string;
  advancedModel: string | null;
  routing: ModelRouting;
  effort: Effort;
  maxOutputTokens: number;
  timeoutMs: number;
} {
  const tenantTokens = tenant.ai.maxOutputTokens;
  const tokens =
    env.maxOutputTokens ??
    (typeof tenantTokens === "number" && Number.isFinite(tenantTokens)
      ? tenantTokens
      : DEFAULT_MAX_OUTPUT_TOKENS);
  return {
    model: env.model,
    advancedModel: env.advancedModel,
    routing: env.routing ?? tenant.ai.routing ?? DEFAULT_ROUTING,
    effort: env.effort ?? tenant.ai.effort ?? DEFAULT_EFFORT,
    maxOutputTokens: clamp(Math.round(tokens), MIN_OUTPUT_TOKENS, MAX_OUTPUT_TOKENS),
    timeoutMs: env.timeoutMs,
  };
}

// ---------------------------------------------------------------------------------------------
// Parsing helpers
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

function readEnum<T extends string>(name: string, allowed: readonly T[]): T | null {
  const value = readString(name)?.toLowerCase();
  return allowed.find((option) => option === value) ?? null;
}

function readModelId(name: string): string | null {
  const value = readString(name);
  return value !== null && MODEL_ID_RE.test(value) ? value : null;
}

function readAdminToken(): string | null {
  const token = readString("ASSISTANT_ADMIN_TOKEN");
  // A short token is guessable: treat it as unset, which keeps the usage endpoint disabled.
  return token !== null && token.length >= MIN_ADMIN_TOKEN_LENGTH ? token : null;
}

function readEmail(name: string): string | null {
  const value = readString(name);
  return value !== null && isValidEmail(value) ? value : null;
}

function readResend(): AssistantEnv["resend"] {
  const apiKey = readString("RESEND_API_KEY");
  if (apiKey === null) return null;
  return { apiKey, from: readString("CONTACT_FROM") ?? DEFAULT_RESEND_FROM };
}

/**
 * Upstash Redis REST credentials. Vercel's KV integration exposes them as KV_REST_API_*, a direct
 * Upstash setup as UPSTASH_REDIS_REST_*; the first complete pair wins. Anything incomplete or
 * malformed means the in-memory store.
 */
function readStore(): AssistantEnv["store"] {
  const pairs: Array<[string, string]> = [
    ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
    ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
  ];
  for (const [urlName, tokenName] of pairs) {
    const url = normalizeRestUrl(readString(urlName));
    const token = readString(tokenName);
    if (url !== null && token !== null) return { kind: "upstash", url, token };
  }
  return { kind: "memory" };
}

function normalizeRestUrl(raw: string | null): string | null {
  if (raw === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  // The bearer token travels with every call: plain http is only acceptable on this machine.
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function readLimitOverrides(): Partial<AssistantLimits> {
  const limits: Partial<AssistantLimits> = {};

  // A negative amount is a typo, not a request to block everything: ignore it. Zero is a valid
  // (if drastic) way to stop all spending.
  const dayBudget = readNumber("ASSISTANT_DAILY_BUDGET_USD");
  if (dayBudget !== null && dayBudget >= 0) limits.tenantBudgetUsdPerDay = Math.min(dayBudget, MAX_BUDGET_USD);

  const monthBudget = readNumber("ASSISTANT_MONTHLY_BUDGET_USD");
  if (monthBudget !== null && monthBudget >= 0) {
    limits.tenantBudgetUsdPerMonth = Math.min(monthBudget, MAX_BUDGET_USD);
  }

  const requests = readNumber("ASSISTANT_DAILY_REQUEST_LIMIT");
  if (requests !== null && requests >= 0) {
    limits.tenantRequestsPerDay = Math.min(Math.floor(requests), MAX_REQUESTS_PER_DAY);
  }

  // At least one message per session, otherwise the widget could never be used at all.
  const sessionMessages = readNumber("ASSISTANT_SESSION_MESSAGE_LIMIT");
  if (sessionMessages !== null && sessionMessages >= 1) {
    limits.maxUserMessagesPerSession = Math.min(Math.floor(sessionMessages), MAX_SESSION_MESSAGES);
  }

  return limits;
}

function isUsableLimit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
