// POST /api/assistant/chat: one chat turn, answered as a stream of Server-Sent Events
// (wire format in lib/assistant/protocol.ts).
//
// Work is ordered cheapest first, so abuse is turned away before it costs anything:
//   kill switch → body size + JSON → tenant + origin → body validation → IP/session/budget gates
//   → prompt → spend reservation → streamed model reply → spend settlement → one log line (no
//   content, no PII).
// Failures before the stream starts are JSON (ApiErrorBody); once streaming they are `error`
// events. The server keeps no conversation: the browser sends the history with every turn.
import { after } from "next/server";
import { encodeEvent, SSE_CONTENT_TYPE } from "@/lib/assistant/protocol";
import type {
  ApiErrorBody,
  ChatErrorCode,
  ChatRequestBody,
  ChatStreamEvent,
  QuoteFormAction,
  TenantConfig,
} from "@/lib/assistant/types";
import { getTenant } from "@/lib/assistant/tenants";
import {
  buildSystem,
  buildTools,
  getKnowledgeVersion,
  parseQuoteToolInput,
  QUOTE_TOOL_NAME,
  toModelMessages,
} from "@/lib/assistant/server/prompt";
import { resolveRegion } from "@/lib/assistant/server/region";
import { canDeliverLeads, getAssistantEnv, resolveAiSettings, resolveLimits } from "@/lib/assistant/server/env";
import { validateChatBody } from "@/lib/assistant/server/validate";
import {
  checkChatAllowance,
  clientIp,
  hashId,
  isOriginAllowed,
  rateLimitSubject,
} from "@/lib/assistant/server/guard";
import { getStore, type KVStore } from "@/lib/assistant/server/store";
import { ProviderFailure, streamReply, type ProviderEvent } from "@/lib/assistant/server/provider";
import { estimateCostUsd, estimateInputUsage, type UsageTokens } from "@/lib/assistant/server/costs";
import {
  logEvent,
  recordTokens,
  reserveSpend,
  settleSpend,
  toMicroUsd,
  type SpendReservation,
} from "@/lib/assistant/server/usage";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 64 * 1024;
// The reply must end with an `error` event of ours, not be cut off by the platform at maxDuration.
const STREAM_DEADLINE_CAP_MS = (maxDuration - 5) * 1000;
// "auto" routing: long or many-question messages go to the advanced model.
const AUTO_ROUTE_MIN_CHARS = 400;
const AUTO_ROUTE_MIN_QUESTIONS = 3;
// A comment frame every 15 s keeps the stream alive while the model thinks: the widget gives up
// after 45 s without a byte, and the first word can take longer than that. Decoders skip it.
const HEARTBEAT_MS = 15_000;
const HEARTBEAT_FRAME = ": ping\n\n";

const encoder = new TextEncoder();

type ReplyRequest = Omit<Parameters<typeof streamReply>[0], "signal">;
type EndEvent = Extract<ProviderEvent, { type: "end" }>;

interface ReplyContext {
  request: Request;
  startedAt: number;
  tenant: TenantConfig;
  chat: ChatRequestBody;
  region: string;
  store: KVStore;
  /** User messages left in this session after this one. */
  remaining: number;
  kbVersion: string;
  reply: ReplyRequest;
  /** The reply's worst case, reserved against the budget; settled to the real cost at the end. */
  spend: SpendReservation;
  /** Called once the reply is settled and logged: releases the after() that waits for it. */
  onSettled: () => void;
}

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  try {
    return await handle(request, startedAt);
  } catch (error) {
    // A bug in our own code or data (prompt, tenant config). Only the error name is logged: a
    // message could quote the visitor's input.
    logEvent({ route: "chat", rejected: "internal", errorName: errorName(error) });
    return errorResponse(500, "unavailable");
  }
}

async function handle(request: Request, startedAt: number): Promise<Response> {
  const env = getAssistantEnv();
  if (!env.enabled || env.apiKey === null) return reject(503, "unavailable", null);

  const body = await readBody(request);
  if (!body.ok) return reject(body.status, body.code, null);
  let raw: unknown;
  try {
    raw = JSON.parse(body.text);
  } catch {
    return reject(400, "bad_request", null);
  }

  const tenant = getTenant(isRecord(raw) ? raw.tenant : undefined);
  if (!tenant) return reject(400, "bad_request", null);
  if (!isOriginAllowed(request, tenant)) return reject(403, "forbidden", tenant.id);

  const limits = resolveLimits(tenant, env);
  const parsed = validateChatBody(raw, tenant, limits);
  if (!parsed.ok) return reject(parsed.code === "forbidden" ? 403 : 400, parsed.code, tenant.id);
  const chat = parsed.body;

  const ip = clientIp(request);
  const store = getStore();
  const gate = await checkChatAllowance({
    store,
    tenantId: tenant.id,
    limits,
    // IPv6 visitors are counted per /64 (see rateLimitSubject); only the salted hash is stored.
    ipHash: ip ? hashId(rateLimitSubject(ip), env.hashSalt) : null,
    sessionId: chat.sessionId,
  });
  if (!gate.ok) {
    // Budget exhaustion is our capacity running out, not the visitor misbehaving: 503, not 429.
    return reject(gate.code === "budget_exhausted" ? 503 : 429, gate.code, tenant.id, gate.retryAfter);
  }

  const ai = resolveAiSettings(tenant, env);
  const region = resolveRegion(tenant, request);
  // Same rule as the widget: no delivery channel, no quote form — so the model is neither offered
  // the tool nor told about the form (it would announce a form the widget does not show).
  const promptTenant = tenant.leads.enabled && !canDeliverLeads(env) ? withoutLeads(tenant) : tenant;
  const reply: ReplyRequest = {
    apiKey: env.apiKey,
    model: pickModel(ai, chat.messages[chat.messages.length - 1].content),
    system: buildSystem({
      tenant: promptTenant,
      locale: chat.locale,
      region,
      page: chat.page,
      state: chat.state,
      remainingMessages: gate.remaining,
    }),
    tools: buildTools(promptTenant),
    messages: toModelMessages(chat.messages, limits.maxContextMessages),
    maxTokens: ai.maxOutputTokens,
    effort: ai.effort,
    timeoutMs: Math.min(ai.timeoutMs, STREAM_DEADLINE_CAP_MS),
  };
  const kbVersion = getKnowledgeVersion(tenant);

  // Nothing below may fail before the stream owns the reservation, or it would never be settled.
  // The reservation is the reply's worst case (input estimated from its size, plus the whole
  // output allowance), taken atomically before the API is called: replies running at the same
  // time see each other's, so together they can never overshoot the budget.
  const worstCase: UsageTokens = { ...estimateInputUsage(reply), outputTokens: reply.maxTokens };
  const spend = await reserveSpend({
    store,
    tenantId: tenant.id,
    limits,
    micro: toMicroUsd(estimateCostUsd(reply.model, worstCase)),
  });
  if (!spend.ok) return reject(503, spend.code, tenant.id, spend.retryAfter);

  // The widget hangs up as soon as it reads `done` or `error`, a visitor can leave mid-answer, and
  // the platform may stop the function once the response is closed: after() keeps it running
  // until the stream has settled the spend and written its log line.
  let onSettled: () => void = () => undefined;
  const accounting = new Promise<void>((resolve) => {
    onSettled = resolve; // the executor runs at once: from here on onSettled resolves `accounting`
  });
  const stream = replyStream({
    request,
    startedAt,
    tenant: promptTenant,
    chat,
    region,
    store,
    remaining: gate.remaining,
    kbVersion,
    reply,
    spend: spend.reservation,
    onSettled,
  });
  keepAliveUntil(accounting);
  return new Response(stream, {
    headers: {
      "Content-Type": SSE_CONTENT_TYPE,
      // no-transform: compression by a proxy would buffer the stream.
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

// One stable copy per tenant: the static prompt is memoized per tenant object, so a fresh copy per
// request would rebuild it every time (the API-side cache would still hit, but the CPU work is waste).
const leadsDisabledCopies = new WeakMap<TenantConfig, TenantConfig>();
function withoutLeads(tenant: TenantConfig): TenantConfig {
  let copy = leadsDisabledCopies.get(tenant);
  if (copy === undefined) {
    copy = { ...tenant, leads: { ...tenant.leads, enabled: false } };
    leadsDisabledCopies.set(tenant, copy);
  }
  return copy;
}

function pickModel(ai: ReturnType<typeof resolveAiSettings>, lastUserMessage: string): string {
  if (ai.advancedModel === null || ai.routing === "fast") return ai.model;
  if (ai.routing === "advanced") return ai.advancedModel;
  const questions = lastUserMessage.split("?").length - 1;
  return lastUserMessage.length > AUTO_ROUTE_MIN_CHARS || questions >= AUTO_ROUTE_MIN_QUESTIONS
    ? ai.advancedModel
    : ai.model;
}

let afterUnavailableLogged = false;

/**
 * Has the platform keep the function alive until `work` is done. after() throws outside a Next.js
 * request scope (the route run directly by a script): the reply then works as before, just
 * without that guarantee, and the first occurrence is logged.
 */
function keepAliveUntil(work: Promise<void>): void {
  try {
    after(() => work);
  } catch (error) {
    if (afterUnavailableLogged) return;
    afterUnavailableLogged = true;
    logEvent({ route: "chat", warn: "after_unavailable", errorName: errorName(error) });
  }
}

// ---------------------------------------------------------------------------------------------
// The streamed reply
// ---------------------------------------------------------------------------------------------

function replyStream(ctx: ReplyContext): ReadableStream<Uint8Array> {
  // Three ways the model call can be cut short: the visitor leaves (request.signal), the stream is
  // cancelled by the runtime (cancel below), or the deadline passes. Only the last one is reported.
  const deadline = AbortSignal.timeout(ctx.reply.timeoutMs);
  const cancelled = new AbortController();
  const signal = AbortSignal.any([ctx.request.signal, deadline, cancelled.signal]);
  const clientGone = (): boolean => ctx.request.signal.aborted || cancelled.signal.aborted;

  async function pump(controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> {
    let open = true;
    let settled = false; // a `done` or `error` event went out: nothing may follow it

    const writable = (): boolean => open && !settled && !clientGone();
    // Never throws: once the visitor is gone, writes are skipped instead of failing.
    const enqueue = (frame: string): void => {
      try {
        controller.enqueue(encoder.encode(frame));
      } catch {
        open = false;
      }
    };
    const send = (event: ChatStreamEvent): void => {
      if (!writable()) return;
      if (event.type === "done" || event.type === "error") settled = true;
      enqueue(encodeEvent(event));
    };

    let outcome = "internal_error";
    let failure: ProviderFailure | null = null;
    let usage: UsageTokens | null = null;
    let servedModel = ctx.reply.model;
    let costUsd = 0;
    let firstTextAt: number | null = null;
    let internalError: string | undefined;
    let accountingError: string | undefined;
    let heartbeat: ReturnType<typeof setInterval> | undefined;

    // Settles the reservation to the reply's real cost and counts its tokens. Once; never throws.
    let accounted = false;
    const account = async (): Promise<void> => {
      if (accounted) return;
      accounted = true;
      try {
        await Promise.all([
          settleSpend(ctx.store, ctx.spend, toMicroUsd(costUsd)),
          usage === null
            ? null
            : recordTokens({ store: ctx.store, tenantId: ctx.tenant.id, usage, now: ctx.spend.at }),
        ]);
      } catch (error) {
        accountingError = errorName(error);
      }
    };

    try {
      send({ type: "start" });
      heartbeat = setInterval(() => {
        if (writable()) enqueue(HEARTBEAT_FRAME);
      }, HEARTBEAT_MS);

      let streamedChars = 0;
      let end: EndEvent | null = null;
      const toolCalls: Array<{ name: string; input: unknown }> = [];
      try {
        for await (const event of streamReply({ ...ctx.reply, signal })) {
          if (event.type === "text") {
            firstTextAt ??= Date.now();
            streamedChars += event.text.length;
            send({ type: "delta", text: event.text });
          } else if (event.type === "tool") {
            toolCalls.push({ name: event.name, input: event.input });
          } else {
            end = event;
          }
        }
      } catch (error) {
        failure = error instanceof ProviderFailure ? error : new ProviderFailure("upstream", null, { cause: error });
      }

      // The real cost: the API's usage or, for a failed call, what the provider attached (partial
      // usage, or an input-only estimate for a call cut off before the API answered). Nothing for
      // an error status, which is not billed, or a call that was never sent.
      usage = end?.usage ?? failure?.usage ?? null;
      if (end !== null) servedModel = end.model;
      if (usage !== null) costUsd = estimateCostUsd(servedModel, usage);
      // Settled before the widget learns the reply is over, so its next message already meets the
      // real spend; after() covers the visitors who leave earlier.
      await account();

      outcome =
        end !== null
          ? finishReply(end, toolCalls, streamedChars, ctx, send)
          : reportFailure(failure ?? new ProviderFailure("upstream"), deadline, clientGone(), send);
    } catch (error) {
      // Our own code failed mid-stream (e.g. tenant data): end with an error the widget handles.
      internalError = errorName(error);
      send({ type: "error", code: "upstream" });
    } finally {
      clearInterval(heartbeat);
      try {
        // A no-op unless our own code failed before the settlement above.
        await account();
        if (open) {
          open = false;
          try {
            controller.close();
          } catch {
            // Already closed or cancelled by the runtime.
          }
        }
        logEvent({
          route: "chat",
          tenant: ctx.tenant.id,
          model: servedModel,
          locale: ctx.chat.locale,
          region: ctx.region,
          stop: outcome,
          status: failure?.status ?? undefined,
          // How a failed call was charged: usage reported up to the break, or estimated from size.
          partialUsage: failure?.usage && !failure.usageEstimated ? true : undefined,
          estimatedUsage: failure?.usageEstimated ? true : undefined,
          errorName: internalError,
          accountingError,
          inTok: usage?.inputTokens ?? 0,
          outTok: usage?.outputTokens ?? 0,
          cacheRead: usage?.cacheReadTokens ?? 0,
          cacheWrite: usage?.cacheWriteTokens ?? 0,
          costUsd: Math.round(costUsd * 1e8) / 1e8,
          ms: Date.now() - ctx.startedAt,
          ttftMs: firstTextAt === null ? undefined : firstTextAt - ctx.startedAt,
          kb: ctx.kbVersion,
          turns: ctx.chat.messages.length,
          store: ctx.store.kind,
        });
      } finally {
        ctx.onSettled();
      }
    }
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      // Not awaited: `start` returns at once and events flow as pump() enqueues them.
      void pump(controller);
    },
    cancel() {
      cancelled.abort();
    },
  });
}

/** Sends the closing events of a completed model call and returns the outcome to log. */
function finishReply(
  end: EndEvent,
  toolCalls: Array<{ name: string; input: unknown }>,
  streamedChars: number,
  ctx: ReplyContext,
  send: (event: ChatStreamEvent) => void,
): string {
  // A refusal always ends in `error refused`, never `done`, even after text has streamed: a safety
  // classifier can decline mid-answer, and the partial text must not stand as an answer (the
  // widget drops it, so it never goes back to the model either).
  if (end.stopReason === "refusal") {
    send({ type: "error", code: "refused" });
    return streamedChars > 0 ? "refused_partial" : "refused";
  }

  // Tool input is only trusted from a turn that really ended on the tool call: a reply cut by
  // max_tokens may carry a truncated one.
  const action =
    end.stopReason === "tool_use" && ctx.tenant.leads.enabled ? pickQuoteAction(toolCalls, ctx.tenant) : null;

  if (streamedChars === 0 && action === null) {
    // Nothing to show (e.g. the whole token budget went into thinking): an error lets the widget
    // offer a retry and the direct contacts instead of an empty bubble.
    send({ type: "error", code: "upstream" });
    return "empty";
  }
  if (action !== null) send({ type: "action", action });
  const stop: "end" | "max_tokens" | "action" =
    action !== null
      ? "action"
      : end.stopReason === "max_tokens" || end.stopReason === "model_context_window_exceeded"
        ? "max_tokens"
        : "end";
  send({ type: "done", stop, remaining: ctx.remaining });
  return stop;
}

function pickQuoteAction(
  toolCalls: Array<{ name: string; input: unknown }>,
  tenant: TenantConfig,
): QuoteFormAction | null {
  for (const call of toolCalls) {
    if (call.name !== QUOTE_TOOL_NAME) continue;
    const action = parseQuoteToolInput(call.input, tenant);
    if (action !== null) return action;
  }
  return null;
}

/** Reports a failed model call (unless nobody is listening) and returns the outcome to log. */
function reportFailure(
  failure: ProviderFailure,
  deadline: AbortSignal,
  clientGone: boolean,
  send: (event: ChatStreamEvent) => void,
): string {
  if (clientGone) return "client_gone";
  let code: ChatErrorCode;
  if (failure.code === "aborted") code = deadline.aborted ? "timeout" : "upstream";
  else code = failure.code;
  send({ type: "error", code });
  return code;
}

// ---------------------------------------------------------------------------------------------
// Request body and JSON errors
// ---------------------------------------------------------------------------------------------

type BodyRead =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413; code: "bad_request" | "too_large" };

/** Reads at most MAX_BODY_BYTES, whatever the client declared, and stops at the first byte over. */
async function readBody(request: Request): Promise<BodyRead> {
  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) {
    return { ok: false, status: 413, code: "too_large" };
  }
  if (request.body === null) return { ok: true, text: "" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        reader.cancel().catch(() => undefined);
        return { ok: false, status: 413, code: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, status: 400, code: "bad_request" };
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

function reject(status: number, code: ChatErrorCode, tenantId: string | null, retryAfter?: number): Response {
  logEvent({ route: "chat", tenant: tenantId, rejected: code, httpStatus: status });
  return errorResponse(status, code, retryAfter);
}

function errorResponse(status: number, error: ChatErrorCode, retryAfter?: number): Response {
  const body: ApiErrorBody = retryAfter === undefined ? { ok: false, error } : { ok: false, error, retryAfter };
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (retryAfter !== undefined) headers.set("Retry-After", String(retryAfter));
  return Response.json(body, { status, headers });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
