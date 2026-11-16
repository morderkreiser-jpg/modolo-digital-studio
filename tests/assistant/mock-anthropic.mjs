// Dependency-free stand-in for the Anthropic Messages API, used by the assistant's provider tests
// and by the end-to-end script. It speaks the real wire format of `POST /v1/messages` with
// `stream: true` (named SSE events: message_start, content_block_start/delta/stop, message_delta,
// message_stop, plus a ping), so the official SDK parses it exactly as it parses the live API.
//
// The scenario is chosen by a marker in the text of the LAST user message:
//   (none)      thinking block (empty, as with display "omitted") + 3 text deltas, stop "end_turn"
//   [[tool]]    one sentence + tool_use offer_quote_form (input streamed as partial JSON), "tool_use"
//   [[refuse]]  no content, stop "refusal" with stop_details
//   [[midrefuse]]  text deltas first, then stop "refusal": a safety classifier declining mid-answer
//   [[long]]    text deltas, stop "max_tokens"
//   [[slow]]    like the default, with SLOW_DELAY_MS between text deltas
//   [[quiet:MS]]  a thinking block and only `ping` events for MS milliseconds (a model thinking
//               before its first word, max 120000), then the default answer
//   [[hang]]    response headers withheld for HANG_MS (exercises client timeouts), then the default
//   [[500]]     HTTP 500 api_error        [[401]]  HTTP 401 authentication_error
//
// Like the real API it rejects what the 2026-10-21 API version rejects for these models
// (sampling parameters, assistant prefill, unknown model ids), so a regression in the request the
// app builds surfaces as an error instead of passing silently.
//
// GET /__last returns the last POST /v1/messages request as { headers, body } (null before the first).
//
// Standalone:  node tests/assistant/mock-anthropic.mjs        (port: MOCK_PORT, default 4010)
// In tests:    const mock = await startMockServer({ port: 0 }); ...; await mock.close();
import http from "node:http";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const MOCK_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
export const SLOW_DELAY_MS = 1500;
export const HANG_MS = 4000;
/** Interval of the `ping` events in the [[quiet:MS]] scenario. */
export const QUIET_PING_MS = 5000;
const QUIET_MAX_MS = 120_000;

/** Usage reported by every successful stream; distinct values so swapped fields are caught. */
export const MOCK_USAGE = Object.freeze({
  input_tokens: 42,
  output_tokens: 17,
  cache_creation_input_tokens: 600,
  cache_read_input_tokens: 1800,
});

/** Text deltas of the default, [[slow]] and [[long]] scenarios. */
export const MOCK_TEXT_CHUNKS = Object.freeze(["Ciao! ", "Sono un assistente ", "di prova."]);
/** Text deltas sent before the tool call in the [[tool]] scenario. */
export const MOCK_TOOL_TEXT_CHUNKS = Object.freeze(["Trovi il modulo ", "qui sotto."]);
/** Text deltas streamed before the refusal in the [[midrefuse]] scenario. */
export const MOCK_MIDREFUSE_CHUNKS = Object.freeze(["Sure. The first step ", "is to"]);
/** Output tokens reported by the [[midrefuse]] scenario (streamed text is billed). */
export const MOCK_MIDREFUSE_OUTPUT_TOKENS = 14;
export const MOCK_TOOL_NAME = "offer_quote_form";
export const MOCK_TOOL_INPUT = Object.freeze({
  service: "website",
  summary: "Nuovo sito per un salone a Winterthur, con prenotazione online.",
});

const SAMPLING_PARAMS = ["temperature", "top_p", "top_k"];

/** @typedef {{ url: string; port: number; close: () => Promise<void> }} MockServer */
/** @typedef {{ headers: Record<string, string | string[] | undefined>; body: unknown }} RecordedRequest */

/**
 * Start the mock on 127.0.0.1. Use port 0 (the default) to get a free port.
 * @param {{ port?: number; host?: string; log?: boolean }} [options]
 * @returns {Promise<MockServer>}
 */
export function startMockServer({ port = 0, host = "127.0.0.1", log = false } = {}) {
  /** @type {RecordedRequest | null} */
  let last = null;
  let seq = 0;
  // Every in-flight response owns a controller, so close() can stop pending delays at once.
  /** @type {Set<AbortController>} */
  const inFlight = new Set();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://mock.local");
    if (req.method === "GET" && url.pathname === "/__last") {
      sendJson(res, 200, last);
      return;
    }
    if (req.method !== "POST" || url.pathname !== "/v1/messages") {
      sendError(res, 404, "not_found_error", `No route for ${req.method} ${url.pathname}`);
      return;
    }

    const controller = new AbortController();
    inFlight.add(controller);
    res.on("close", () => {
      controller.abort();
      inFlight.delete(controller);
    });

    readBody(req)
      .then(async (raw) => {
        seq += 1;
        /** @type {unknown} */
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch {
          body = raw;
        }
        last = { headers: { ...req.headers }, body };
        const scenario = await respond(req, res, body, seq, controller.signal);
        if (log) console.log(`[mock-anthropic] #${seq} ${scenario} -> ${res.statusCode}`);
      })
      .catch((error) => {
        // Aborted delays (client gone, server closing) are expected; anything else is a mock bug.
        if (!controller.signal.aborted && !res.headersSent) {
          sendError(res, 500, "api_error", `Mock failure: ${String(error)}`);
        } else if (!res.writableEnded) {
          res.destroy();
        }
      });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolve({
        url: `http://${host}:${actualPort}`,
        port: actualPort,
        close: () =>
          new Promise((done) => {
            for (const controller of inFlight) controller.abort();
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/**
 * Validate like the real API, then stream the scenario. Returns the scenario name (for logs).
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 * @param {unknown} body
 * @param {number} seq
 * @param {AbortSignal} signal
 */
async function respond(req, res, body, seq, signal) {
  // SDK 1.x sends the API key as "Authorization: Bearer <key>"; older clients used x-api-key.
  const bearer = /^Bearer \S+/.test(String(req.headers.authorization ?? ""));
  if (!req.headers["x-api-key"] && !bearer) {
    sendError(res, 401, "authentication_error", "An API key is required (x-api-key or Authorization: Bearer)");
    return "no_api_key";
  }
  if (!req.headers["anthropic-version"]) {
    sendError(res, 400, "invalid_request_error", "anthropic-version header is required");
    return "no_version";
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    sendError(res, 400, "invalid_request_error", "Request body must be a JSON object");
    return "bad_json";
  }
  const params = /** @type {Record<string, unknown>} */ (body);
  const problem = requestProblem(params);
  if (problem) {
    sendError(res, problem.status, problem.type, problem.message);
    return "rejected";
  }

  const text = lastUserText(params.messages);
  const model = String(params.model);
  const hasQuoteTool =
    Array.isArray(params.tools) &&
    params.tools.some((tool) => typeof tool === "object" && tool !== null && tool.name === MOCK_TOOL_NAME);

  if (text.includes("[[500]]")) {
    // retry-after-ms keeps the SDK's automatic retry of 5xx responses fast in tests.
    sendError(res, 500, "api_error", "Internal server error (mock)", { "retry-after-ms": "5" });
    return "500";
  }
  if (text.includes("[[401]]")) {
    sendError(res, 401, "authentication_error", "invalid x-api-key (mock)");
    return "401";
  }
  if (text.includes("[[hang]]")) await delay(HANG_MS, undefined, { signal });

  const maxTokens = Number(params.max_tokens);
  const id = `msg_mock_${String(seq).padStart(4, "0")}`;
  const quiet = /\[\[quiet:(\d{1,6})\]\]/.exec(text);
  /** @type {Array<{ frame: string; wait?: number }>} */
  let frames;
  let scenario;
  if (text.includes("[[refuse]]")) {
    scenario = "refuse";
    frames = refusalFrames(id, model);
  } else if (text.includes("[[midrefuse]]")) {
    scenario = "midrefuse";
    frames = midRefusalFrames(id, model);
  } else if (quiet) {
    scenario = "quiet";
    frames = quietFrames(id, model, Math.min(Number(quiet[1]), QUIET_MAX_MS));
  } else if (text.includes("[[tool]]") && hasQuoteTool) {
    scenario = "tool";
    frames = toolFrames(id, model, seq);
  } else if (text.includes("[[long]]")) {
    scenario = "long";
    frames = textFrames(id, model, { stopReason: "max_tokens", outputTokens: maxTokens, wait: 0 });
  } else if (text.includes("[[slow]]")) {
    scenario = "slow";
    frames = textFrames(id, model, { stopReason: "end_turn", outputTokens: MOCK_USAGE.output_tokens, wait: SLOW_DELAY_MS });
  } else {
    scenario = text.includes("[[hang]]") ? "hang" : "default";
    frames = textFrames(id, model, { stopReason: "end_turn", outputTokens: MOCK_USAGE.output_tokens, wait: 0 });
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    "request-id": `req_mock_${seq}`,
  });
  res.flushHeaders();
  for (const { frame, wait } of frames) {
    if (wait) await delay(wait, undefined, { signal });
    if (res.destroyed) return scenario;
    res.write(frame);
  }
  res.end();
  return scenario;
}

/** @param {Record<string, unknown>} params */
function requestProblem(params) {
  if (params.stream !== true) {
    return { status: 400, type: "invalid_request_error", message: "This mock only implements stream: true" };
  }
  if (!MOCK_MODELS.includes(String(params.model))) {
    return { status: 404, type: "not_found_error", message: `model: ${String(params.model)}` };
  }
  for (const name of SAMPLING_PARAMS) {
    if (name in params) {
      return { status: 400, type: "invalid_request_error", message: `${name}: not supported on this API version` };
    }
  }
  if (!Number.isInteger(params.max_tokens) || Number(params.max_tokens) < 1) {
    return { status: 400, type: "invalid_request_error", message: "max_tokens: must be a positive integer" };
  }
  const messages = params.messages;
  if (!Array.isArray(messages) || messages.length === 0) {
    return { status: 400, type: "invalid_request_error", message: "messages: at least one message is required" };
  }
  const lastMessage = messages[messages.length - 1];
  if (typeof lastMessage !== "object" || lastMessage === null || lastMessage.role !== "user") {
    return {
      status: 400,
      type: "invalid_request_error",
      message: "This model does not support assistant message prefill. The conversation must end with a user message.",
    };
  }
  return null;
}

/** Text of the last user message (string content or its text blocks). */
function lastUserText(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (typeof message !== "object" || message === null || message.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((block) => typeof block === "object" && block !== null && block.type === "text")
        .map((block) => String(block.text))
        .join("\n");
    }
    return "";
  }
  return "";
}

/** One SSE frame in the API's format: a named event plus its JSON payload. */
function sse(type, payload) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function messageStart(id, model) {
  return sse("message_start", {
    message: {
      id,
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      stop_details: null,
      container: null,
      diagnostics: null,
      usage: {
        input_tokens: MOCK_USAGE.input_tokens,
        output_tokens: 1,
        cache_creation_input_tokens: MOCK_USAGE.cache_creation_input_tokens,
        cache_read_input_tokens: MOCK_USAGE.cache_read_input_tokens,
        cache_creation: {
          ephemeral_5m_input_tokens: MOCK_USAGE.cache_creation_input_tokens,
          ephemeral_1h_input_tokens: 0,
        },
        server_tool_use: null,
        service_tier: "standard",
        inference_geo: null,
        output_tokens_details: null,
        speed: null,
      },
    },
  });
}

/**
 * @param {string} stopReason
 * @param {number} outputTokens
 * @param {unknown} [stopDetails]
 */
function messageEnd(stopReason, outputTokens, stopDetails = null) {
  return [
    sse("message_delta", {
      delta: { stop_reason: stopReason, stop_sequence: null, stop_details: stopDetails, container: null },
      usage: {
        input_tokens: MOCK_USAGE.input_tokens,
        cache_creation_input_tokens: MOCK_USAGE.cache_creation_input_tokens,
        cache_read_input_tokens: MOCK_USAGE.cache_read_input_tokens,
        output_tokens: outputTokens,
        server_tool_use: null,
        output_tokens_details: null,
      },
    }),
    sse("message_stop", {}),
  ];
}

/** Adaptive thinking with display "omitted": an empty thinking block that carries only a signature. */
function thinkingBlock(index) {
  return [
    sse("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } }),
    sse("content_block_delta", { index, delta: { type: "signature_delta", signature: "bW9jay1zaWduYXR1cmU=" } }),
    sse("content_block_stop", { index }),
  ];
}

function textBlock(index, chunks, wait) {
  return [
    { frame: sse("content_block_start", { index, content_block: { type: "text", text: "", citations: null } }) },
    ...chunks.map((text, i) => ({
      frame: sse("content_block_delta", { index, delta: { type: "text_delta", text } }),
      wait: i === 0 ? 0 : wait,
    })),
    { frame: sse("content_block_stop", { index }) },
  ];
}

/**
 * @param {string} id
 * @param {string} model
 * @param {{ stopReason: string; outputTokens: number; wait: number }} options
 */
function textFrames(id, model, { stopReason, outputTokens, wait }) {
  return [
    { frame: messageStart(id, model) },
    { frame: sse("ping", {}) },
    ...thinkingBlock(0).map((frame) => ({ frame })),
    ...textBlock(1, MOCK_TEXT_CHUNKS, wait),
    ...messageEnd(stopReason, outputTokens).map((frame) => ({ frame })),
  ];
}

function toolFrames(id, model, seq) {
  // The input arrives as partial JSON split mid-token, exactly as the API streams it.
  const json = JSON.stringify(MOCK_TOOL_INPUT);
  const cuts = [0, 7, 19, 33, json.length];
  const parts = cuts.slice(1).map((end, i) => json.slice(cuts[i], end));
  return [
    { frame: messageStart(id, model) },
    ...textBlock(0, MOCK_TOOL_TEXT_CHUNKS, 0),
    {
      frame: sse("content_block_start", {
        index: 1,
        content_block: { type: "tool_use", id: `toolu_mock_${seq}`, name: MOCK_TOOL_NAME, input: {} },
      }),
    },
    ...parts.map((partial_json) => ({
      frame: sse("content_block_delta", { index: 1, delta: { type: "input_json_delta", partial_json } }),
    })),
    { frame: sse("content_block_stop", { index: 1 }) },
    ...messageEnd("tool_use", MOCK_USAGE.output_tokens).map((frame) => ({ frame })),
  ];
}

function refusalFrames(id, model) {
  const details = { type: "refusal", category: null, explanation: "Declined by the mock safety classifier." };
  return [{ frame: messageStart(id, model) }, ...messageEnd("refusal", 0, details).map((frame) => ({ frame }))];
}

/** Classifiers can decline after part of the answer has streamed; that text is billed. */
function midRefusalFrames(id, model) {
  const details = { type: "refusal", category: "cyber", explanation: "Declined mid-answer by the mock safety classifier." };
  return [
    { frame: messageStart(id, model) },
    ...textBlock(0, MOCK_MIDREFUSE_CHUNKS, 0),
    ...messageEnd("refusal", MOCK_MIDREFUSE_OUTPUT_TOKENS, details).map((frame) => ({ frame })),
  ];
}

/** While the model thinks, the API sends nothing but `ping` events (thinking display "omitted"). */
function quietFrames(id, model, quietMs) {
  const pings = Math.max(1, Math.ceil(quietMs / QUIET_PING_MS));
  const wait = Math.ceil(quietMs / pings);
  return [
    { frame: messageStart(id, model) },
    { frame: sse("content_block_start", { index: 0, content_block: { type: "thinking", thinking: "", signature: "" } }) },
    ...Array.from({ length: pings }, () => ({ frame: sse("ping", {}), wait })),
    { frame: sse("content_block_delta", { index: 0, delta: { type: "signature_delta", signature: "bW9jay1zaWduYXR1cmU=" } }) },
    { frame: sse("content_block_stop", { index: 0 }) },
    ...textBlock(1, MOCK_TEXT_CHUNKS, 0),
    ...messageEnd("end_turn", MOCK_USAGE.output_tokens).map((frame) => ({ frame })),
  ];
}

/** @param {http.IncomingMessage} req */
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** @param {http.ServerResponse} res */
function sendJson(res, status, value, extraHeaders = {}) {
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(JSON.stringify(value));
}

/** @param {http.ServerResponse} res */
function sendError(res, status, type, message, extraHeaders = {}) {
  sendJson(res, status, { type: "error", error: { type, message }, request_id: "req_mock_error" }, extraHeaders);
}

// Run standalone when executed directly (not when imported by a test).
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath.toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const port = Number(process.env.MOCK_PORT || 4010);
  const mock = await startMockServer({ port, log: true });
  console.log(`[mock-anthropic] listening on ${mock.url} (Ctrl+C to stop)`);
  const stop = () => {
    mock.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
