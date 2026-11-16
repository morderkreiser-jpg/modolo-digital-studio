import {
  isAssistantLocale,
  type ApiErrorBody,
  type AssistantLocale,
  type LeadResponseBody,
  type TenantConfig,
} from "@/lib/assistant/types";
import { validateLead, type LeadRules } from "@/lib/assistant/lead-schema";
import { canDeliverLeads, getAssistantEnv, resolveLimits } from "@/lib/assistant/server/env";
import { clientIp, hashId, hitWindow, isOriginAllowed, rateLimitSubject } from "@/lib/assistant/server/guard";
import { deliverLead, type LeadRecord } from "@/lib/assistant/server/leads";
import { resolveRegion } from "@/lib/assistant/server/region";
import { getStore } from "@/lib/assistant/server/store";
import { logEvent } from "@/lib/assistant/server/usage";
import { getTenant } from "@/lib/assistant/tenants";

// POST /api/assistant/lead: quote requests sent from the assistant's form.
//
// The model never sees these fields. It can only suggest the form (a tool call in the chat
// stream); the visitor fills it in and the browser posts it here directly.
//
// Order matters (same reasoning as /api/contact): cheap structural checks first; the honeypot and
// the timing trap BEFORE validation and rate limits, so a bot gets a fake success and never uses
// up a quota shared with humans behind the same NAT; the rate limits AFTER validation, so the
// counters only move on requests that would really be delivered.
//
// The ASSISTANT_ENABLED kill switch is deliberately not checked here: it stops AI spend, while a
// visitor who already has the form open should still be able to reach the business.

// Node APIs (node:crypto in guard.ts) and plain fetch to Resend/Upstash.
export const runtime = "nodejs";

// A complete lead is ~6 KB at most (2000-character description + short fields); 16 KB leaves
// room for multi-byte text while capping the work a flood can force on us.
const MAX_BODY_BYTES = 16 * 1024;
// Even a prefilled form takes a human more than a second; scripts post instantly.
const MIN_FILL_MS = 1200;
const HOUR_SECONDS = 3600;
const DAY_SECONDS = 86_400;
// The page the visitor was on: an absolute path on this site (as location.pathname gives it,
// printable ASCII), at most 200 characters. Anything else is dropped, not rejected.
const PAGE_RE = /^\/(?!\/)[\x21-\x7E]{0,199}$/;
const QUERY_OR_FRAGMENT_RE = /[?#]/;

function reply(body: LeadResponseBody, status = 200, headers: Record<string, string> = {}): Response {
  // Per-request answers that may carry a lead id: never cached anywhere.
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function refuse(status: number, error: ApiErrorBody["error"]): Response {
  return reply({ ok: false, error }, status);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The body as text, or null as soon as it grows past `maxBytes` (Content-Length can be absent). */
async function readCapped(request: Request, maxBytes: number): Promise<string | null> {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
}

// The hidden field is invisible to people: any text in it means a script filled every input.
function honeypotFilled(value: unknown): boolean {
  return typeof value === "string" && value.trim() !== "";
}

// Only a reported, impossibly short fill time counts. A missing value is let through, so a
// client-side bug can never turn every real lead into a silent fake success.
function filledTooFast(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value < MIN_FILL_MS;
}

function pickLocale(value: unknown, tenant: TenantConfig): AssistantLocale {
  return isAssistantLocale(value) && tenant.locales.includes(value) ? value : tenant.defaultLocale;
}

function cleanPage(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  // Path only: a query string can carry click ids (gclid, fbclid) or other identifiers, and the
  // record is emailed and may be stored for the whole retention period.
  const path = value.split(QUERY_OR_FRAGMENT_RE, 1)[0];
  return PAGE_RE.test(path) ? path : undefined;
}

export async function POST(request: Request): Promise<Response> {
  const started = Date.now();

  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) return refuse(413, "too_large");
  let text: string | null;
  try {
    text = await readCapped(request, MAX_BODY_BYTES);
  } catch {
    // The client aborted the upload or sent a broken stream.
    return refuse(400, "bad_request");
  }
  if (text === null) return refuse(413, "too_large");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return refuse(400, "bad_request");
  }
  if (!isRecord(raw)) return refuse(400, "bad_request");

  const tenant = getTenant(raw.tenant);
  if (!tenant) return refuse(400, "bad_request");

  // One line per request that reached a tenant: outcome, ids and timing, never a field value.
  const log = (outcome: string, extra: Record<string, string> = {}) =>
    logEvent({ route: "lead", tenant: tenant.id, outcome, ...extra, ms: Date.now() - started });

  if (!isOriginAllowed(request, tenant)) {
    log("forbidden");
    return refuse(403, "forbidden");
  }

  const env = getAssistantEnv();
  if (!tenant.leads.enabled || !canDeliverLeads(env)) {
    log("unavailable");
    return refuse(503, "unavailable");
  }

  // Same id format as a real lead, so the response does not tell a bot it was caught.
  const honeypot = honeypotFilled(raw.hp);
  if (honeypot || filledTooFast(raw.elapsedMs)) {
    log("filtered", { reason: honeypot ? "honeypot" : "too_fast" });
    return reply({ ok: true, id: crypto.randomUUID() });
  }

  // Budget ids of EVERY region are accepted. The form picks its list from the region cookie, while
  // the server can only fall back to the geo header: with cookies blocked the two can differ, and a
  // visitor must never be stuck on a field whose options they cannot change. The email shows the
  // label of whichever list the id belongs to.
  const region = resolveRegion(tenant, request);
  const rules: LeadRules = {
    services: tenant.leads.services.map((option) => option.id),
    budgets: [...new Set(Object.values(tenant.leads.budgetOptions).flatMap((list) => list.map((option) => option.id)))],
    requireCompany: tenant.leads.requireCompany,
    requirePhone: tenant.leads.requirePhone,
  };
  const result = validateLead(raw.lead, rules);
  if (!result.ok) {
    log("invalid", { fields: Object.keys(result.fields).join(",") });
    return reply({ ok: false, error: "invalid", fields: result.fields }, 400);
  }
  const lead = result.value;

  const store = getStore();
  const limits = resolveLimits(tenant, env);
  const limited = (retryAfter: number, scope: string) => {
    log("rate_limited", { scope });
    return reply({ ok: false, error: "rate_limited", retryAfter }, 429, { "Retry-After": String(retryAfter) });
  };
  // Hashed keys only: the store never sees a raw IP or address. No IP (local dev, an unexpected
  // proxy) means no IP limit, never one bucket shared by everyone. An IPv6 visitor is counted by
  // its /64 (rateLimitSubject), which one sender controls whole. Keys carry the tenant id, so the
  // businesses served by one deployment never share these limits.
  const ip = clientIp(request);
  if (ip) {
    const byIp = await hitWindow(
      store,
      `lead:${tenant.id}:ip:${hashId(rateLimitSubject(ip), env.hashSalt)}`,
      limits.leadsPerIpPerHour,
      HOUR_SECONDS,
    );
    if (!byIp.allowed) return limited(byIp.retryAfter, "ip");
  }
  // Per address, whatever the source IP: one sender (or a script reusing an address) cannot flood
  // the business inbox from many machines.
  const byEmail = await hitWindow(
    store,
    `lead:${tenant.id}:email:${hashId(lead.email, env.hashSalt)}`,
    limits.leadsPerEmailPerDay,
    DAY_SECONDS,
  );
  if (!byEmail.allowed) return limited(byEmail.retryAfter, "email");

  const record: LeadRecord = {
    ...lead,
    id: crypto.randomUUID(),
    tenant: tenant.id,
    locale: pickLocale(raw.locale, tenant),
    region,
    page: cleanPage(raw.page),
    createdAt: new Date().toISOString(),
  };
  const { delivered, failed } = await deliverLead({ record, tenant, env, store });
  log(delivered.length > 0 ? "delivered" : "delivery_failed", {
    delivered: delivered.join(","),
    failed: failed.join(","),
  });
  if (delivered.length === 0) return refuse(502, "delivery_failed");
  return reply({ ok: true, id: record.id });
}
