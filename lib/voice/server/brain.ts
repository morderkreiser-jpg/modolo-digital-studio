// The text brain of a voice session ("local" mode): one caller utterance in, the spoken reply out,
// with tool rounds in between. Server-only.
//
//   caller text → [model call → tool_use? → executeTool for each call → tool results]×(≤3)
//               → model call → reply text → done
//
// The reply streams as "delta" events while the model writes; tools announce themselves with
// "tool" events (name and outcome only, never inputs) and "handoff" events when a request, a
// callback or a transfer was really handed on. Everything the model can DO goes through
// executeTool (lib/voice/tools/execute.ts), which checks the tenant, the caps and every input.
//
// Two models implement BrainModel: the Anthropic Messages API (streaming, through the installed
// SDK), and brain-mock.ts, a rule-based stand-in for tests and VOICE_BRAIN=mock. Both run through
// exactly the same loop below.
//
// Limits of one turn: at most MAX_TOOL_ROUNDS tool rounds, a hard deadline of TURN_DEADLINE_MS for
// everything, and env.maxOutputTokens per model call. Nothing here logs or throws content: the log
// line has ids, codes, counts and token usage; failures end the turn with an "error" event.
//
// Money: the route reserves the turn's worst case (turnWorstCaseUsd) on the spend counters before
// runTurn starts, and runTurn reports what the model calls really cost (settleSpend) before its
// last event, so a turn that the budget cannot pay for never reaches the model.
import Anthropic from "@anthropic-ai/sdk";
import { estimateCostUsd, estimateInputUsage, type UsageTokens } from "@/lib/assistant/server/costs";
import { formatClockTime, isOpenAt, nextOpening, zonedParts } from "@/lib/voice/hours";
import { pickVoiceText } from "@/lib/voice/knowledge";
import { buildVoiceSystem } from "@/lib/voice/prompt";
import { toolDefinitions } from "@/lib/voice/tools/definitions";
import {
  executeTool,
  exportToolMemory,
  importToolMemory,
  type SessionCaps,
  type ToolContext,
  type ToolSinks,
} from "@/lib/voice/tools/execute";
import { withoutPhoneNumbers } from "@/lib/voice/tools/validate";
import {
  isVoiceToolName,
  type CalendarProvider,
  type CallSummary,
  type HandoffNotice,
  type ToolOutcome,
  type TurnStreamEvent,
  type VoiceErrorCode,
  type VoiceLimits,
  type VoiceLocale,
  type VoiceTenantConfig,
  type VoiceToolDefinition,
} from "@/lib/voice/types";
import { logVoiceEvent } from "./log";
import type { BrainBlock, BrainMessage, StoredTurn, VoiceSessionState } from "./state";

/** Tool rounds per caller turn. A fourth request for tools is not carried out. */
export const MAX_TOOL_ROUNDS = 3;
/** The whole turn (every model call and every tool) must end within this. */
export const TURN_DEADLINE_MS = 20_000;
/**
 * Effort of the model's adaptive thinking. A spoken reply is short and every second of thinking
 * is a second of silence on the line, so the lowest level; the tools and the prompt carry the rest.
 */
const VOICE_EFFORT = "low" as const;

// ---------------------------------------------------------------------------------------------
// The model seam
// ---------------------------------------------------------------------------------------------

/** A content block of a model response, in the form it is sent back within the same turn. */
export type ModelBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown };

export interface ModelRequest {
  model: string;
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  signal: AbortSignal;
}

export type ModelEvent =
  | { type: "text"; text: string }
  | { type: "end"; content: ModelBlock[]; stopReason: string | null; model: string; usage: UsageTokens };

/** One model call, streamed: text deltas, then exactly one "end". Failures throw BrainFailure. */
export interface BrainModel {
  readonly id: string;
  stream(request: ModelRequest): AsyncGenerator<ModelEvent>;
}

export type BrainFailureCode = "aborted" | "timeout" | "unavailable" | "upstream";

export class BrainFailure extends Error {
  code: BrainFailureCode;
  status: number | null;
  /** What the failed call is charged, when the API reported (or we could estimate) anything. */
  usage: UsageTokens | null;

  constructor(code: BrainFailureCode, status: number | null = null, options: { usage?: UsageTokens | null; cause?: unknown } = {}) {
    super(`Voice brain failure: ${code}${status !== null ? ` (HTTP ${status})` : ""}`, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "BrainFailure";
    this.code = code;
    this.status = status;
    this.usage = options.usage ?? null;
  }
}

/** The Anthropic Messages API as a BrainModel. One client per (key, base URL), reused. */
export function createAnthropicModel(apiKey: string): BrainModel {
  return {
    id: "anthropic",
    async *stream(req: ModelRequest): AsyncGenerator<ModelEvent> {
      if (req.signal.aborted) throw new BrainFailure("aborted");
      // Input usage comes with message_start, the output count only at the end: kept so a call that
      // breaks off midway is still logged with what it cost.
      let startUsage: UsageTokens | null = null;
      let stream: ReturnType<Anthropic["messages"]["stream"]> | null = null;
      try {
        // No temperature/top_p/top_k and no thinking parameter: the API version this SDK sends
        // rejects sampling parameters, and these models think adaptively by default; effort is the
        // one knob (same settings as lib/assistant/server/provider.ts).
        stream = clientFor(apiKey).messages.stream(
          {
            model: req.model,
            max_tokens: req.maxTokens,
            system: req.system,
            messages: req.messages,
            ...(req.tools.length > 0 ? { tools: req.tools } : {}),
            output_config: { effort: VOICE_EFFORT },
          },
          { signal: req.signal },
        );
        for await (const event of stream) {
          if (event.type === "message_start") {
            startUsage = toUsage(event.message.usage);
          } else if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
            yield { type: "text", text: event.delta.text };
          }
        }
        const message = await stream.finalMessage();
        yield {
          type: "end",
          content: toModelBlocks(message.content),
          stopReason: message.stop_reason ?? null,
          model: message.model || req.model,
          usage: toUsage(message.usage),
        };
      } catch (error) {
        throw toFailure(error, req.signal, startUsage);
      } finally {
        // Reached early when the consumer stops iterating: cancel the upstream request.
        if (stream !== null && !stream.ended) stream.abort();
      }
    },
  };
}

let cachedClient: { apiKey: string; baseUrl: string | undefined; client: Anthropic } | null = null;

function clientFor(apiKey: string): Anthropic {
  // The SDK reads ANTHROPIC_BASE_URL when it is constructed (tests point it at a mock server).
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  if (cachedClient && cachedClient.apiKey === apiKey && cachedClient.baseUrl === baseUrl) return cachedClient.client;
  // One retry covers a transient 429/5xx before the stream starts; the turn deadline (passed as
  // the signal) bounds the whole thing anyway.
  const client = new Anthropic({ apiKey, timeout: TURN_DEADLINE_MS, maxRetries: 1 });
  cachedClient = { apiKey, baseUrl, client };
  return client;
}

function toModelBlocks(content: Anthropic.ContentBlock[]): ModelBlock[] {
  const blocks: ModelBlock[] = [];
  for (const block of content) {
    if (block.type === "text") blocks.push({ type: "text", text: block.text });
    else if (block.type === "thinking") blocks.push({ type: "thinking", thinking: block.thinking, signature: block.signature });
    else if (block.type === "redacted_thinking") blocks.push({ type: "redacted_thinking", data: block.data });
    else if (block.type === "tool_use") blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
    // No server tools are declared, so no other block can appear.
  }
  return blocks;
}

function toUsage(usage: Anthropic.Usage): UsageTokens {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/** Same mapping as the chat provider: our own abort first, then configuration, then transient. */
function toFailure(error: unknown, signal: AbortSignal, usage: UsageTokens | null): BrainFailure {
  if (error instanceof BrainFailure) return error;
  const options = { usage, cause: error };
  if (signal.aborted || error instanceof Anthropic.APIUserAbortError) return new BrainFailure("aborted", null, options);
  if (error instanceof Anthropic.APIConnectionTimeoutError) return new BrainFailure("timeout", null, options);
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.BadRequestError
  ) {
    // Bad key, missing access, unknown model or a request the API refuses: retrying cannot fix it.
    // What identifies it is logged, never the message text.
    logVoiceEvent({ warn: "voice_model_rejected", status: error.status, type: error.type, requestId: error.requestID ?? null });
    return new BrainFailure("unavailable", error.status, options);
  }
  if (error instanceof Anthropic.APIError) {
    return new BrainFailure("upstream", typeof error.status === "number" ? error.status : null, options);
  }
  return new BrainFailure("upstream", null, options);
}

// ---------------------------------------------------------------------------------------------
// One turn
// ---------------------------------------------------------------------------------------------

export interface RunTurnArgs {
  tenant: VoiceTenantConfig;
  /** The session's state, mutated in place (history, counters, outcomes). The caller saves it. */
  state: VoiceSessionState;
  /** What the caller said. "" with `opening`. */
  text: string;
  locale: VoiceLocale;
  /** The first request of a session: the greeting is spoken, no model is called. */
  opening?: boolean;
  limits: VoiceLimits;
  /** null only works for the opening turn. */
  model: BrainModel | null;
  modelId: string;
  maxOutputTokens: number;
  calendar: CalendarProvider | null;
  sinks: ToolSinks;
  /** Caller turns left after this one (from admitTurn), reported in "done". */
  remainingTurns: number;
  /** The session's tool caps in the shared store (atomic across parallel requests). */
  caps?: SessionCaps;
  /**
   * Called once, before the last event, with what this turn's model calls cost (USD), so the
   * route can settle the reservation it made. Awaited; a failure in it is ignored.
   */
  settleSpend?: (costUsd: number) => Promise<void>;
  signal?: AbortSignal;
  now?: () => number;
  deadlineMs?: number;
}

/**
 * The system blocks of a turn, exactly as runTurn sends them: the static part is cached (tools
 * render before it, so they are inside the cached prefix), the per-turn part follows the breakpoint.
 */
export function turnSystem(args: {
  tenant: VoiceTenantConfig;
  state: Pick<VoiceSessionState, "channel" | "outcomes">;
  locale: VoiceLocale;
  now: Date;
  remainingSeconds: number;
  /** The prompt variant of a live speech-to-speech session (lib/voice/prompt.ts). */
  realtime?: boolean;
}): Anthropic.TextBlockParam[] {
  const { tenant, now } = args;
  const open = isOpenAt(tenant.hours, now);
  const system = buildVoiceSystem({
    tenant,
    locale: args.locale,
    channel: args.state.channel,
    now,
    isOpen: open,
    nextOpeningText: open ? undefined : nextOpeningText(tenant, now),
    remainingSeconds: args.remainingSeconds,
    outcomesSoFar: describeOutcomes(args.state.outcomes, tenant),
    realtime: args.realtime,
  });
  return [
    { type: "text", text: system.staticText, cache_control: { type: "ephemeral" } },
    { type: "text", text: system.dynamicText },
  ];
}

/** The tools of a turn, as the API takes them. */
export function turnTools(tenant: VoiceTenantConfig): Anthropic.Tool[] {
  return toolDefinitions(tenant).map(toAnthropicTool);
}

/**
 * Tokens a tool round may add to the next call's input on top of the previous reply: its results
 * (a list of free times is the longest, about 1'500 characters). Generous on purpose.
 */
const TOOL_RESULT_TOKENS_PER_ROUND = 1500;

/**
 * The most one turn can cost (USD): every call of the turn (MAX_TOOL_ROUNDS + 1) sends the whole
 * prompt as a cache write (the dearest way to pay for it), the history and the utterance, and
 * writes the whole output allowance; each tool round adds the previous reply and its results to
 * the next call. Errs high, like the chat's reservation: the budget must never be passed.
 */
export function turnWorstCaseUsd(args: {
  modelId: string;
  maxOutputTokens: number;
  system: readonly Anthropic.TextBlockParam[];
  tools: readonly Anthropic.Tool[];
  messages: readonly Anthropic.MessageParam[];
}): number {
  const input = estimateInputUsage({ system: args.system, messages: args.messages });
  const toolTokens = Math.ceil(JSON.stringify(args.tools).length / 3);
  const output = Number.isFinite(args.maxOutputTokens) && args.maxOutputTokens > 0 ? args.maxOutputTokens : 0;
  const calls = MAX_TOOL_ROUNDS + 1;
  // Call k carries k earlier rounds: 0 + 1 + ... + (calls - 1) rounds in all.
  const growth = ((calls * (calls - 1)) / 2) * (output + TOOL_RESULT_TOKENS_PER_ROUND);
  return estimateCostUsd(args.modelId, {
    inputTokens: calls * input.inputTokens + growth,
    outputTokens: calls * output,
    cacheReadTokens: 0,
    cacheWriteTokens: calls * (input.cacheWriteTokens + toolTokens),
  });
}

/**
 * Runs one turn and yields its events, ending with exactly one "done" or "error" (none when the
 * visitor left: nobody is listening). Never throws. The state is updated before the last event.
 */
export async function* runTurn(args: RunTurnArgs): AsyncGenerator<TurnStreamEvent> {
  const clock = args.now ?? Date.now;
  const startedAt = clock();
  const { tenant, state, limits } = args;
  const callEndsAt = state.startedAt + limits.maxCallSeconds * 1000;
  const remainingSeconds = (): number => Math.max(0, Math.floor((callEndsAt - clock()) / 1000));
  state.locale = args.locale;

  if (args.opening) {
    const greeting = pickVoiceText(tenant.greeting, args.locale, tenant.defaultLocale).trim();
    if (!state.greeted) {
      state.greeted = true;
      if (greeting) state.history.push({ messages: [{ role: "assistant", content: greeting }] });
    }
    if (greeting) yield { type: "delta", text: greeting };
    logVoiceEvent({ op: "turn", tenant: tenant.id, opening: true, calls: 0, ms: clock() - startedAt });
    yield { type: "done", ended: false, remainingTurns: args.remainingTurns, remainingSeconds: remainingSeconds() };
    return;
  }

  // Our deadline, the visitor leaving, or the runtime cancelling: whichever comes first.
  const deadline = AbortSignal.timeout(args.deadlineMs ?? TURN_DEADLINE_MS);
  const signal = args.signal ? AbortSignal.any([args.signal, deadline]) : deadline;
  const clientGone = (): boolean => args.signal?.aborted === true;

  // ONE counters object for the whole turn (execute.ts keys its replay memory on it), restored with
  // the memory of the earlier turns.
  const counters = state.counters;
  importToolMemory(counters, state.toolMemory);
  const ctx: ToolContext = {
    tenant,
    sessionId: state.sessionId,
    locale: args.locale,
    channel: state.channel,
    now: new Date(startedAt),
    limits,
    counters,
    ...(args.caps ? { caps: args.caps } : {}),
    calendar: args.calendar,
    sinks: args.sinks,
    record: (outcome) => {
      state.outcomes.push(outcome);
    },
  };

  const usage: UsageTokens = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let servedModel = args.modelId;
  let calls = 0;
  let toolCount = 0;
  let firstTextAt: number | null = null;
  let streamedChars = 0;
  let ended = false;
  let outcome = "internal_error";
  let terminal: TurnStreamEvent | null = null;

  // This turn's messages, thinking blocks included: they are valid within the turn only (state.ts).
  const turnMessages: Anthropic.MessageParam[] = [{ role: "user", content: args.text }];
  // How many of turnMessages are complete and may be kept: the utterance plus whole tool rounds.
  let keep = 0;

  try {
    if (args.model === null) throw new BrainFailure("unavailable");
    const request = {
      model: args.modelId,
      system: turnSystem({ tenant, state, locale: args.locale, now: new Date(startedAt), remainingSeconds: remainingSeconds() }),
      tools: turnTools(tenant),
      maxTokens: args.maxOutputTokens,
      signal,
    };
    const history = toApiMessages(state.history);

    let lastText = "";
    for (let round = 0; ; round += 1) {
      calls += 1;
      let end: Extract<ModelEvent, { type: "end" }> | null = null;
      let roundStarted = false;
      try {
        for await (const event of args.model.stream({ ...request, messages: [...history, ...turnMessages] })) {
          if (event.type === "text") {
            firstTextAt ??= clock();
            // The widget joins every delta of a turn into one reply: text written before a tool
            // call and text written after it would otherwise run into each other ("ein.Erledigt").
            const gap = !roundStarted && lastText !== "" && !/\s$/.test(lastText) && !/^\s/.test(event.text) ? " " : "";
            roundStarted = true;
            streamedChars += event.text.length;
            lastText = event.text;
            yield { type: "delta", text: gap + event.text };
          } else {
            end = event;
          }
        }
      } catch (error) {
        const failure = error instanceof BrainFailure ? error : new BrainFailure("upstream", null, { cause: error });
        if (failure.usage) addUsage(usage, failure.usage);
        throw failure;
      }
      if (end === null) throw new BrainFailure("upstream");
      addUsage(usage, end.usage);
      servedModel = end.model;

      // A refusal can come mid-answer: the partial text of this call must not stand, and the call
      // is not kept. Completed tool rounds before it stay (their actions happened).
      if (end.stopReason === "refusal") {
        outcome = streamedChars > 0 ? "refused_partial" : "refused";
        terminal = { type: "error", code: "refused" };
        break;
      }

      const toolUses = end.content.filter((block): block is Extract<ModelBlock, { type: "tool_use" }> => block.type === "tool_use");
      // Tool input is trusted only from a call that really ended on the tool call: one cut by
      // max_tokens may carry a truncated input.
      if (end.stopReason !== "tool_use" || toolUses.length === 0 || round >= MAX_TOOL_ROUNDS) {
        if (end.stopReason === "tool_use" && toolUses.length > 0) outcome = "tool_rounds_exhausted";
        else outcome = end.stopReason === "max_tokens" ? "max_tokens" : "end";
        // Unanswered tool calls must not enter the history: the next request would be refused.
        const spoken = end.content.filter((block) => block.type !== "tool_use");
        if (spoken.some((block) => block.type === "text" && block.text.trim() !== "")) {
          turnMessages.push({ role: "assistant", content: spoken });
          keep = turnMessages.length;
        }
        break;
      }

      // A tool round: run every call of the response, in order, then hand all results back at once.
      turnMessages.push({ role: "assistant", content: end.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const call of toolUses) {
        toolCount += 1;
        const known = isVoiceToolName(call.name) ? call.name : null;
        if (known) yield { type: "tool", name: known, status: "started" };
        const result = await executeTool(ctx, { id: call.id, name: call.name, input: call.input });
        if (known) yield { type: "tool", name: known, status: result.ok ? "ok" : "failed" };
        const handoff = result.ok && known ? handoffOf(known, result, tenant, args.locale) : null;
        if (handoff) yield { type: "handoff", handoff };
        if (result.ok && result.endCall) ended = true;
        results.push({ type: "tool_result", tool_use_id: call.id, content: toolResultText(result), is_error: !result.ok });
      }
      turnMessages.push({ role: "user", content: results });
      keep = turnMessages.length;
      // end_call: the goodbye was said before it; another model call would only talk on.
      if (ended) {
        outcome = "ended";
        break;
      }
    }

    if (terminal === null) {
      if (streamedChars === 0 && !ended) {
        // Nothing to say (e.g. the whole allowance went into thinking): an error lets the widget
        // offer a retry instead of an empty caption.
        outcome = outcome === "end" ? "empty" : outcome;
        terminal = { type: "error", code: "upstream" };
      } else {
        terminal = { type: "done", ended, remainingTurns: args.remainingTurns, remainingSeconds: remainingSeconds() };
      }
    }
  } catch (error) {
    const failure = error instanceof BrainFailure ? error : null;
    if (failure === null) {
      // Our own code failed (tenant data, a bug): only the error's name is logged.
      outcome = `internal:${error instanceof Error ? error.name : typeof error}`;
      terminal = { type: "error", code: "upstream" };
    } else if (clientGone()) {
      outcome = "client_gone";
      terminal = null;
    } else {
      const code: VoiceErrorCode =
        failure.code === "aborted" ? (deadline.aborted ? "timeout" : "upstream") : failure.code;
      outcome = code;
      terminal = { type: "error", code };
    }
  }

  // The state the next turn builds on: the utterance and the complete rounds, without thinking.
  if (keep > 0) {
    state.history.push(toStoredTurn(turnMessages.slice(0, keep)));
    state.turns += 1;
  }
  state.toolMemory = exportToolMemory(counters);
  const costUsd = estimateCostUsd(servedModel, usage);
  // Before the last event: the next turn's reservation must already see this turn's real cost.
  if (args.settleSpend) {
    try {
      await args.settleSpend(costUsd);
    } catch {
      // The reservation then stays charged in full: the safe direction.
    }
  }
  logVoiceEvent({
    op: "turn",
    tenant: tenant.id,
    brain: args.model?.id ?? "none",
    model: servedModel,
    locale: args.locale,
    stop: outcome,
    calls,
    tools: toolCount,
    ended: ended || undefined,
    inTok: usage.inputTokens,
    outTok: usage.outputTokens,
    cacheRead: usage.cacheReadTokens,
    cacheWrite: usage.cacheWriteTokens,
    costUsd: Math.round(costUsd * 1e8) / 1e8,
    ms: clock() - startedAt,
    ttftMs: firstTextAt === null ? undefined : firstTextAt - startedAt,
  });
  if (terminal !== null) yield terminal;
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function toAnthropicTool(definition: VoiceToolDefinition): Anthropic.Tool {
  return { name: definition.name, description: definition.description, input_schema: definition.inputSchema };
}

/**
 * The stored history as API messages. A conversation must start with the caller: the greeting
 * (stored as the first assistant message) is left out here, since the static prompt already tells
 * the model it was said.
 */
export function toApiMessages(history: readonly StoredTurn[]): Anthropic.MessageParam[] {
  const messages: Anthropic.MessageParam[] = [];
  for (const turn of history) {
    for (const message of turn.messages) {
      if (messages.length === 0 && message.role !== "user") continue;
      messages.push({ role: message.role, content: typeof message.content === "string" ? message.content : message.content.map(toBlockParam) });
    }
  }
  return messages;
}

function toBlockParam(block: BrainBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return { type: "tool_result", tool_use_id: block.tool_use_id, content: block.content, ...(block.is_error ? { is_error: true } : {}) };
  }
}

/** This turn's messages as stored: text, tool calls and results only; thinking is dropped. */
function toStoredTurn(messages: readonly Anthropic.MessageParam[]): StoredTurn {
  const stored: BrainMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (typeof message.content === "string") {
      stored.push({ role: message.role, content: message.content });
      continue;
    }
    const blocks: BrainBlock[] = [];
    for (const block of message.content) {
      if (block.type === "text") {
        if (block.text.trim() !== "") blocks.push({ type: "text", text: block.text });
      } else if (block.type === "tool_use") {
        blocks.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      } else if (block.type === "tool_result") {
        const content = typeof block.content === "string" ? block.content : "";
        blocks.push({ type: "tool_result", tool_use_id: block.tool_use_id, content, ...(block.is_error ? { is_error: true } : {}) });
      }
    }
    if (blocks.length > 0) stored.push({ role: message.role, content: blocks });
  }
  return { messages: stored };
}

/** What the model reads back from a tool: the outcome as compact JSON (its "say" is the key line). */
export function toolResultText(outcome: ToolOutcome): string {
  return outcome.ok
    ? JSON.stringify({ ok: true, say: outcome.say, ...(outcome.data ? { data: outcome.data } : {}) })
    : JSON.stringify({ ok: false, code: outcome.code, say: outcome.say });
}

export function handoffOf(name: string, outcome: ToolOutcome, tenant: VoiceTenantConfig, locale: VoiceLocale): HandoffNotice | null {
  if (!outcome.ok) return null;
  if (name === "create_lead") return { kind: "written" };
  if (name === "request_callback") return { kind: "callback" };
  if (name === "transfer_call") {
    const targetId = typeof outcome.data?.target === "string" ? outcome.data.target : "";
    const target = tenant.handoff.transfer.targets.find((candidate) => candidate.id === targetId);
    // The label only: the number never leaves the server, not even inside a carelessly written label.
    const label = target ? withoutPhoneNumbers(pickVoiceText(target.label, locale, tenant.defaultLocale)) || target.id : targetId;
    return { kind: "transfer", targetLabel: label };
  }
  return null;
}

const WEEKDAY_NAMES = { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" } as const;

/** "Monday 2026-12-07 09:00" in the tenant's zone, or undefined when nothing opens soon. */
function nextOpeningText(tenant: VoiceTenantConfig, now: Date): string | undefined {
  const next = nextOpening(tenant.hours, now);
  if (next === null) return undefined;
  const parts = zonedParts(next, tenant.hours.timezone);
  return `${WEEKDAY_NAMES[parts.weekday]} ${parts.date} ${formatClockTime(parts.minutes)}`;
}

/**
 * Short English lines of what this call already did, for the per-turn prompt: references and ids
 * only. The details the caller gave are in the history already and need not be repeated here.
 */
export function describeOutcomes(outcomes: CallSummary["outcomes"], tenant: VoiceTenantConfig): string[] {
  const lines: string[] = [];
  for (const outcome of outcomes) {
    switch (outcome.kind) {
      case "lead":
        lines.push(`request ${outcome.taskId} stored, reference ${outcome.ref}`);
        break;
      case "booking": {
        const start = Date.parse(outcome.booking.start);
        const when = Number.isFinite(start) ? localStart(new Date(start), tenant) : outcome.booking.start;
        lines.push(`appointment ${outcome.booking.serviceId} booked for ${when}, reference ${outcome.booking.ref}`);
        break;
      }
      case "reschedule": {
        const start = Date.parse(outcome.booking.start);
        const when = Number.isFinite(start) ? localStart(new Date(start), tenant) : outcome.booking.start;
        lines.push(`appointment ${outcome.booking.ref} moved to ${when}`);
        break;
      }
      case "cancellation":
        lines.push(`appointment ${outcome.ref} cancelled`);
        break;
      case "callback":
        lines.push("callback request passed on");
        break;
      case "transfer":
        lines.push(`transfer to ${outcome.targetId} ${outcome.connected ? "connected" : "not answered"}`);
        break;
      case "emergency_notice":
        lines.push("emergency message given");
        break;
    }
  }
  return lines;
}

function localStart(at: Date, tenant: VoiceTenantConfig): string {
  const parts = zonedParts(at, tenant.hours.timezone);
  return `${parts.date} ${formatClockTime(parts.minutes)}`;
}

function addUsage(total: UsageTokens, add: UsageTokens): void {
  total.inputTokens += finite(add.inputTokens);
  total.outputTokens += finite(add.outputTokens);
  total.cacheReadTokens += finite(add.cacheReadTokens);
  total.cacheWriteTokens += finite(add.cacheWriteTokens);
}

function finite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
