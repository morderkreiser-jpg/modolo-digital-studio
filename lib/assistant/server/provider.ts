// The only module that talks to the Anthropic API at runtime. It turns one streamed Messages call
// into a small, provider-neutral event sequence:
//   text* → tool* → end          (tool events only after the stream is complete, one per block)
// and every failure into a ProviderFailure with a stable code.
import Anthropic from "@anthropic-ai/sdk";
import type { Effort } from "@/lib/assistant/types";
import { estimateInputUsage, type UsageTokens } from "./costs";
import { logEvent } from "./usage";

export type ProviderEvent =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown }
  | { type: "end"; stopReason: string | null; model: string; usage: UsageTokens };

export type ProviderFailureCode = "aborted" | "timeout" | "unavailable" | "upstream";

export class ProviderFailure extends Error {
  code: ProviderFailureCode;
  /** HTTP status of the API error, when there was one. */
  status: number | null;
  /**
   * What the failed request is charged to the budget, so interrupted replies never go uncounted.
   * After the API started answering: its usage, with the output of the unfinished reply counted at
   * the maximum (the real count only arrives at the end). When our own abort or deadline cut the
   * request off before that: an input-only estimate (`usageEstimated`), since the API may already
   * have read the prompt. Null when the API answered with an error status (not billed) or the
   * request was never sent.
   */
  usage: UsageTokens | null;
  /** True when `usage` is estimated from the request's size rather than reported by the API. */
  usageEstimated: boolean;

  constructor(
    code: ProviderFailureCode,
    status: number | null = null,
    options: { usage?: UsageTokens | null; usageEstimated?: boolean; cause?: unknown } = {},
  ) {
    super(
      `Assistant provider failure: ${code}${status !== null ? ` (HTTP ${status})` : ""}`,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "ProviderFailure";
    this.code = code;
    this.status = status;
    this.usage = options.usage ?? null;
    this.usageEstimated = this.usage !== null && options.usageEstimated === true;
  }
}

export async function* streamReply(req: {
  apiKey: string;
  model: string;
  system: Anthropic.TextBlockParam[];
  tools: Anthropic.Tool[];
  messages: Anthropic.MessageParam[];
  maxTokens: number;
  effort: Effort;
  timeoutMs: number;
  signal: AbortSignal;
}): AsyncGenerator<ProviderEvent> {
  if (req.signal.aborted) throw new ProviderFailure("aborted");

  // Input-side usage arrives with message_start; the output count only with the final
  // message_delta. Kept so a reply that breaks off midway can still be charged.
  let startUsage: UsageTokens | null = null;
  let finalOutputTokens: number | null = null;
  let stream: ReturnType<Anthropic["messages"]["stream"]> | null = null;

  try {
    // No temperature/top_p/top_k and no thinking parameter: the API version this SDK sends rejects
    // sampling parameters, and these models think adaptively by default; effort is the only knob.
    stream = clientFor(req.apiKey, req.timeoutMs).messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages,
        ...(req.tools.length > 0 ? { tools: req.tools } : {}),
        output_config: { effort: req.effort },
      },
      { signal: req.signal },
    );

    for await (const event of stream) {
      if (event.type === "message_start") {
        startUsage = toUsage(event.message.usage);
      } else if (event.type === "message_delta") {
        finalOutputTokens = event.usage.output_tokens;
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        event.delta.text
      ) {
        yield { type: "text", text: event.delta.text };
      }
    }

    const message = await stream.finalMessage();
    for (const block of message.content) {
      if (block.type === "tool_use") yield { type: "tool", name: block.name, input: block.input };
    }
    yield {
      type: "end",
      stopReason: message.stop_reason ?? null,
      model: message.model || req.model,
      usage: toUsage(message.usage),
    };
  } catch (error) {
    if (startUsage !== null) {
      const outputTokens = finalOutputTokens ?? Math.max(startUsage.outputTokens, req.maxTokens);
      throw toFailure(error, req.signal, { usage: { ...startUsage, outputTokens } });
    }
    // Sent, then cut off by our own abort or deadline before the API reported anything: it may
    // already have read (and billed) the prompt, so the input is charged as estimated, not as zero.
    if (stream !== null && cutOffByUs(error, req.signal)) {
      throw toFailure(error, req.signal, { usage: estimateInputUsage(req), usageEstimated: true });
    }
    throw toFailure(error, req.signal, {});
  } finally {
    // Reached early when the consumer stops iterating: cancel the upstream request.
    if (stream !== null && !stream.ended) stream.abort();
  }
}

// The client for the current (key, timeout) is created on first use and reused; a change of either
// replaces it. The base URL is part of the key because the SDK reads ANTHROPIC_BASE_URL at
// construction (the tests point it at a mock server).
let cached: { apiKey: string; timeoutMs: number; baseUrl: string | undefined; client: Anthropic } | null = null;

function clientFor(apiKey: string, timeoutMs: number): Anthropic {
  const baseUrl = process.env.ANTHROPIC_BASE_URL;
  if (cached && cached.apiKey === apiKey && cached.timeoutMs === timeoutMs && cached.baseUrl === baseUrl) {
    return cached.client;
  }
  // One retry covers a transient 429/5xx/connection error before the stream starts; more would
  // keep the visitor waiting behind a spinner.
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 });
  cached = { apiKey, timeoutMs, baseUrl, client };
  return client;
}

/** Our own abort or deadline, as opposed to an error status the API answered with (not billed). */
function cutOffByUs(error: unknown, signal: AbortSignal): boolean {
  if (error instanceof Anthropic.APIError && typeof error.status === "number") return false;
  return (
    signal.aborted ||
    error instanceof Anthropic.APIUserAbortError ||
    error instanceof Anthropic.APIConnectionTimeoutError
  );
}

function toFailure(
  error: unknown,
  signal: AbortSignal,
  charge: { usage?: UsageTokens; usageEstimated?: boolean },
): ProviderFailure {
  if (error instanceof ProviderFailure) return error;
  const options = { ...charge, cause: error };
  // Our own signal (client gone or the route's deadline) is the reason, whatever shape the SDK
  // gave the error; the caller knows which of the two fired.
  if (signal.aborted || error instanceof Anthropic.APIUserAbortError) {
    return new ProviderFailure("aborted", null, options);
  }
  if (error instanceof Anthropic.APIConnectionTimeoutError) {
    return new ProviderFailure("timeout", null, options);
  }
  if (
    error instanceof Anthropic.AuthenticationError ||
    error instanceof Anthropic.PermissionDeniedError ||
    error instanceof Anthropic.NotFoundError ||
    error instanceof Anthropic.BadRequestError
  ) {
    // Bad key, missing access, unknown model id or a request the API refuses: a configuration
    // problem that retrying cannot fix. Log what identifies it, never the message text.
    logEvent({
      warn: "provider_rejected",
      status: error.status,
      type: error.type,
      errorCode: error.errorCode,
      requestId: error.requestID ?? null,
    });
    return new ProviderFailure("unavailable", error.status, options);
  }
  if (
    error instanceof Anthropic.RateLimitError ||
    error instanceof Anthropic.OverloadedError ||
    error instanceof Anthropic.InternalServerError
  ) {
    return new ProviderFailure("upstream", error.status, options);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return new ProviderFailure("upstream", null, options);
  }
  if (error instanceof Anthropic.APIError) {
    return new ProviderFailure("upstream", typeof error.status === "number" ? error.status : null, options);
  }
  return new ProviderFailure("upstream", null, options);
}

function toUsage(usage: Anthropic.Usage): UsageTokens {
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
  };
}
