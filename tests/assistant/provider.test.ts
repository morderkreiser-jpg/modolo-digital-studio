// Anthropic provider (lib/assistant/server/provider.ts) against the local mock API
// (tests/assistant/mock-anthropic.mjs) through the official SDK: event mapping, error mapping,
// cancellation, timeouts, and the exact request body the app sends.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import { inspect } from "node:util";
import type Anthropic from "@anthropic-ai/sdk";
import { estimateInputUsage } from "@/lib/assistant/server/costs";
import type { ProviderEvent } from "@/lib/assistant/server/provider";
import { collect, setAssistantEnv } from "./fixtures";
import {
  MOCK_MIDREFUSE_CHUNKS,
  MOCK_MIDREFUSE_OUTPUT_TOKENS,
  MOCK_TEXT_CHUNKS,
  MOCK_TOOL_INPUT,
  MOCK_TOOL_TEXT_CHUNKS,
  MOCK_USAGE,
  startMockServer,
} from "./mock-anthropic.mjs";

type ProviderModule = typeof import("@/lib/assistant/server/provider");
type ReplyRequest = Parameters<ProviderModule["streamReply"]>[0];

const SYSTEM: Anthropic.TextBlockParam[] = [
  { type: "text", text: "STATIC rules and knowledge.", cache_control: { type: "ephemeral" } },
  { type: "text", text: "DYNAMIC context: page /it/servizi, 2026-11-15." },
];
const TOOLS: Anthropic.Tool[] = [
  {
    name: "offer_quote_form",
    description: "Show the quote request form.",
    input_schema: {
      type: "object",
      properties: { service: { type: "string", enum: ["website"] }, summary: { type: "string" } },
    },
  },
];
const EXPECTED_USAGE = {
  inputTokens: MOCK_USAGE.input_tokens,
  outputTokens: MOCK_USAGE.output_tokens,
  cacheReadTokens: MOCK_USAGE.cache_read_input_tokens,
  cacheWriteTokens: MOCK_USAGE.cache_creation_input_tokens,
};

// Every user message carries this marker: no log line may ever contain it, nor the API key.
const CONTENT_MARKER = "CONTENT-MARKER-7f3a";
const API_KEY = "test-key";

let provider: ProviderModule;
let server: Awaited<ReturnType<typeof startMockServer>>;
let restoreEnv: () => void;
let logged: string[] = [];

before(async () => {
  server = await startMockServer();
  restoreEnv = setAssistantEnv({ ANTHROPIC_BASE_URL: server.url });
  // Imported only now, in case the module builds its SDK client eagerly from the environment.
  provider = await import("@/lib/assistant/server/provider");
});

after(async () => {
  restoreEnv();
  await server.close();
});

beforeEach(() => {
  logged = [];
  const capture = (...args: unknown[]) => {
    logged.push(args.map((arg) => (typeof arg === "string" ? arg : inspect(arg, { depth: 8 }))).join(" "));
  };
  mock.method(console, "log", capture);
  mock.method(console, "info", capture);
  mock.method(console, "warn", capture);
  mock.method(console, "error", capture);
});

afterEach(() => {
  mock.restoreAll();
  for (const line of logged) {
    assert.ok(!line.includes(API_KEY), `a log line contains the API key: ${line}`);
    assert.ok(!line.includes(CONTENT_MARKER), `a log line contains message content: ${line}`);
  }
});

function reply(text: string, patch: Partial<ReplyRequest> = {}): AsyncGenerator<ProviderEvent> {
  return provider.streamReply({
    apiKey: API_KEY,
    model: "claude-haiku-5-5",
    system: SYSTEM,
    tools: TOOLS,
    messages: [{ role: "user", content: `${CONTENT_MARKER} ${text}` }],
    maxTokens: 1024,
    effort: "low",
    timeoutMs: 10_000,
    signal: new AbortController().signal,
    ...patch,
  });
}

async function lastRequest(): Promise<{ headers: Record<string, string>; body: Record<string, unknown> }> {
  const response = await fetch(`${server.url}/__last`);
  return (await response.json()) as { headers: Record<string, string>; body: Record<string, unknown> };
}

const texts = (events: ProviderEvent[]) => events.flatMap((event) => (event.type === "text" ? [event.text] : []));

function endOf(events: ProviderEvent[]) {
  const ends = events.filter((event) => event.type === "end");
  assert.equal(ends.length, 1, "exactly one end event");
  const end = events.at(-1);
  assert.ok(end && end.type === "end", "the end event comes last");
  return end;
}

function failure(code: string, status?: number | null) {
  return (error: unknown) => {
    assert.ok(error instanceof provider.ProviderFailure, `expected ProviderFailure, got ${String(error)}`);
    assert.ok(error instanceof Error);
    assert.equal(error.code, code);
    if (status !== undefined) assert.equal(error.status, status);
    assert.ok(!String(error.message).includes(API_KEY), "the API key must never appear in errors");
    return true;
  };
}

describe("streamReply: events", () => {
  it("streams text deltas progressively, then ends with stop reason, model and usage", async () => {
    const events = await collect(reply("Ciao"));
    assert.ok(texts(events).length >= 2, "deltas are forwarded as they arrive, not buffered");
    assert.equal(texts(events).join(""), MOCK_TEXT_CHUNKS.join(""));
    assert.ok(!events.some((event) => event.type === "tool"));
    assert.deepEqual(endOf(events), { type: "end", stopReason: "end_turn", model: "claude-haiku-5-5", usage: EXPECTED_USAGE });
  });

  it("emits one tool event with the parsed input after the text, and ends with tool_use", async () => {
    const events = await collect(reply("Vorrei un preventivo [[tool]]"));
    assert.equal(texts(events).join(""), MOCK_TOOL_TEXT_CHUNKS.join(""));
    const tools = events.filter((event) => event.type === "tool");
    assert.equal(tools.length, 1);
    assert.deepEqual(tools[0], { type: "tool", name: "offer_quote_form", input: MOCK_TOOL_INPUT });
    const lastText = events.map((event) => event.type).lastIndexOf("text");
    assert.ok(events.indexOf(tools[0]) > lastText, "the tool event follows the text");
    assert.equal(endOf(events).stopReason, "tool_use");
  });

  it("reports a refusal through the end event, with no text", async () => {
    const events = await collect(reply("[[refuse]]"));
    assert.deepEqual(texts(events), []);
    assert.equal(endOf(events).stopReason, "refusal");
  });

  it("reports a refusal that comes after streamed text, with the usage of that text", async () => {
    const events = await collect(reply("[[midrefuse]]"));
    assert.equal(texts(events).join(""), MOCK_MIDREFUSE_CHUNKS.join(""));
    const end = endOf(events);
    assert.equal(end.stopReason, "refusal");
    assert.equal(end.usage.outputTokens, MOCK_MIDREFUSE_OUTPUT_TOKENS, "streamed output is billed");
  });

  it("waits through a thinking phase that sends only pings, then streams the answer", async () => {
    const events = await collect(reply("[[quiet:300]]"));
    assert.equal(texts(events).join(""), MOCK_TEXT_CHUNKS.join(""));
    assert.equal(endOf(events).stopReason, "end_turn");
  });

  it("reports a truncated answer as max_tokens", async () => {
    const events = await collect(reply("[[long]]"));
    const end = endOf(events);
    assert.equal(end.stopReason, "max_tokens");
    assert.equal(end.usage.outputTokens, 1024);
  });
});

describe("streamReply: request body", () => {
  it("sends exactly what the 2026-10-21 API accepts, with the cache breakpoint on system[0] only", async () => {
    await collect(reply("Ciao"));
    const { headers, body } = await lastRequest();
    for (const forbidden of ["temperature", "top_p", "top_k", "thinking"]) {
      assert.ok(!(forbidden in body), `request must not send ${forbidden}`);
    }
    assert.equal(body.model, "claude-haiku-5-5");
    assert.equal(body.max_tokens, 1024);
    assert.equal(body.stream, true);
    assert.deepEqual(body.output_config, { effort: "low" });
    assert.deepEqual(body.system, SYSTEM);
    const system = body.system as Array<{ cache_control?: unknown }>;
    assert.deepEqual(system[0].cache_control, { type: "ephemeral" });
    assert.equal(system[1].cache_control, undefined);
    assert.deepEqual(
      (body.tools as Array<{ name: string }>).map((tool) => tool.name),
      ["offer_quote_form"],
    );
    assert.ok(body.tool_choice === undefined || JSON.stringify(body.tool_choice) === '{"type":"auto"}', "no forced tool_choice");
    const messages = body.messages as Array<{ role: string }>;
    assert.equal(messages.at(-1)?.role, "user", "no assistant prefill");
    assert.ok(headers.authorization === `Bearer ${API_KEY}` || headers["x-api-key"] === API_KEY, "the request key is used");
    assert.ok(headers["anthropic-version"], "the SDK sets the API version");
  });

  it("passes effort and max tokens through for the advanced settings", async () => {
    await collect(reply("Ciao", { model: "claude-sonnet-5-5", effort: "high", maxTokens: 2048 }));
    const { body } = await lastRequest();
    assert.equal(body.model, "claude-sonnet-5-5");
    assert.deepEqual(body.output_config, { effort: "high" });
    assert.equal(body.max_tokens, 2048);
    assert.ok(!("thinking" in body));
  });

  it("omits tools when there are none (leads disabled)", async () => {
    await collect(reply("Ciao [[tool]]", { tools: [] }));
    const { body } = await lastRequest();
    assert.ok(body.tools === undefined || (Array.isArray(body.tools) && body.tools.length === 0));
  });
});

describe("streamReply: failures", () => {
  it("maps HTTP 500 (after the SDK's retry) to upstream", async () => {
    await assert.rejects(collect(reply("[[500]]")), failure("upstream", 500));
  });

  it("maps 401 to unavailable (misconfiguration)", async () => {
    await assert.rejects(collect(reply("[[401]]")), failure("unavailable", 401));
  });

  it("maps an unknown model id (404) to unavailable", async () => {
    await assert.rejects(collect(reply("Ciao", { model: "claude-nope-1" })), failure("unavailable", 404));
  });

  it("maps a request the API rejects (400) to unavailable", async () => {
    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: `${CONTENT_MARKER} Ciao` },
      { role: "assistant", content: `${CONTENT_MARKER} Prefill` },
    ];
    await assert.rejects(collect(reply("", { messages })), failure("unavailable", 400));
  });

  it("stops promptly with aborted when the signal is aborted mid-stream", async () => {
    const controller = new AbortController();
    const seen: ProviderEvent[] = [];
    const started = Date.now();
    await assert.rejects(async () => {
      for await (const event of reply("[[slow]]", { signal: controller.signal })) {
        seen.push(event);
        if (event.type === "text") controller.abort();
      }
    }, failure("aborted"));
    assert.equal(texts(seen).length, 1, "nothing is emitted after the abort");
    assert.ok(Date.now() - started < 1200, "the abort must not wait for the next (1.5 s) delta");
  });

  it("fails fast with aborted when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(collect(reply("Ciao", { signal: controller.signal })), failure("aborted"));
  });

  it("maps a server that does not answer within timeoutMs to timeout", { timeout: 8000 }, async () => {
    const started = Date.now();
    await assert.rejects(collect(reply("[[hang]]", { timeoutMs: 300 })), failure("timeout"));
    assert.ok(Date.now() - started < 3500, "the timeout must fire well before the mock answers (4 s)");
  });
});

describe("streamReply: what an interrupted request is charged", () => {
  /** The failure a request ended with (asserting that it did fail). */
  async function failureOf(events: AsyncGenerator<ProviderEvent>, during?: (event: ProviderEvent) => void) {
    try {
      for await (const event of events) during?.(event);
    } catch (error) {
      assert.ok(error instanceof provider.ProviderFailure, `expected ProviderFailure, got ${String(error)}`);
      return error;
    }
    return assert.fail("the request was expected to fail");
  }

  /** The input-only estimate of the request reply(text) sends. */
  function estimateFor(text: string) {
    return estimateInputUsage({ system: SYSTEM, messages: [{ role: "user", content: `${CONTENT_MARKER} ${text}` }] });
  }

  it("charges an input-only estimate when our abort cuts the request off before message_start", async () => {
    const controller = new AbortController();
    const pending = failureOf(reply("[[hang]] abort-before-start", { signal: controller.signal }));
    setTimeout(() => controller.abort(), 250); // the mock withholds its headers for 4 s
    const error = await pending;
    assert.equal(error.code, "aborted");
    assert.equal(error.usageEstimated, true);
    assert.deepEqual(error.usage, estimateFor("[[hang]] abort-before-start"));
    assert.equal(error.usage?.outputTokens, 0);
    assert.equal(error.usage?.cacheReadTokens, 0);
    assert.ok((error.usage?.cacheWriteTokens ?? 0) > 0 && (error.usage?.inputTokens ?? 0) > 0);
    const { body } = await lastRequest();
    assert.ok(JSON.stringify(body).includes("abort-before-start"), "the prompt had reached the API");
  });

  it("charges an input-only estimate when our deadline expires before message_start", { timeout: 8000 }, async () => {
    const error = await failureOf(reply("[[hang]] deadline", { timeoutMs: 300 }));
    assert.equal(error.code, "timeout");
    assert.equal(error.usageEstimated, true);
    assert.deepEqual(error.usage, estimateFor("[[hang]] deadline"));
  });

  it("charges the reported input with the output at its maximum when aborted after message_start", async () => {
    const controller = new AbortController();
    const error = await failureOf(reply("[[slow]]", { signal: controller.signal }), (event) => {
      if (event.type === "text") controller.abort();
    });
    assert.equal(error.code, "aborted");
    assert.equal(error.usageEstimated, false);
    assert.deepEqual(error.usage, { ...EXPECTED_USAGE, outputTokens: 1024 });
  });

  it("charges nothing for an error status the API answered with (not billed)", async () => {
    for (const marker of ["[[500]]", "[[401]]"]) {
      const error = await failureOf(reply(marker));
      assert.equal(error.usage, null, marker);
      assert.equal(error.usageEstimated, false, marker);
    }
  });

  it("charges nothing for a request that was never sent", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await failureOf(reply("Ciao", { signal: controller.signal }));
    assert.equal(error.code, "aborted");
    assert.equal(error.usage, null);
    assert.equal(error.usageEstimated, false);
  });
});
