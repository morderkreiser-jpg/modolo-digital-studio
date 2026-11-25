// A scriptable stand-in for the Anthropic Messages API, for the voice brain's tests. It speaks the
// real streaming wire format (named SSE events), so the official SDK parses it like the live API,
// and each test decides what every call answers:
//
//   const mock = await startVoiceMock({ respond: (body, index) => ({ text: ["Hallo"], tools: [...] }) });
//   process.env.ANTHROPIC_BASE_URL = mock.url; ...; await mock.close();
//
// A reply is { text?: string[], thinking?: boolean, tools?: [{ name, input, id? }], stop?: string,
// status?: number }. Without `stop` it is "tool_use" when there are tools, else "end_turn".
//
// Like the real API it refuses what would be refused there, so a bug in the request the brain
// builds fails the test instead of passing silently: sampling parameters, a conversation that does
// not start and end with a user message, a tool_use without its tool_result (or the reverse), a
// thinking block sent back without its signature. Builds on the conventions of
// tests/assistant/mock-anthropic.mjs (same usage numbers, same error shape).
import http from "node:http";
import { MOCK_USAGE } from "../assistant/mock-anthropic.mjs";

export { MOCK_USAGE };
export const VOICE_MOCK_MODELS = ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"];
const SAMPLING_PARAMS = ["temperature", "top_p", "top_k"];

/**
 * @param {{ respond: (body: Record<string, unknown>, index: number) => Record<string, unknown> }} options
 */
export function startVoiceMock({ respond }) {
  /** @type {Array<Record<string, unknown>>} */
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.startsWith("/v1/messages")) {
      sendError(res, 404, "not_found_error", "No such route");
      return;
    }
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        sendError(res, 400, "invalid_request_error", "Body must be JSON");
        return;
      }
      requests.push(body);
      const problem = requestProblem(body);
      if (problem) {
        sendError(res, 400, "invalid_request_error", problem);
        return;
      }
      let reply;
      try {
        reply = respond(body, requests.length - 1) ?? {};
      } catch (error) {
        sendError(res, 500, "api_error", `Mock respond() failed: ${String(error)}`);
        return;
      }
      if (typeof reply.status === "number" && reply.status >= 400) {
        sendError(res, reply.status, reply.status === 401 ? "authentication_error" : "api_error", "Mock error", {
          "retry-after-ms": "5",
        });
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" });
      for (const frame of frames(reply, String(body.model), requests.length)) res.write(frame);
      res.end();
    });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

/** What the real API would refuse in this request, or null. */
function requestProblem(body) {
  if (typeof body !== "object" || body === null) return "Body must be an object";
  if (body.stream !== true) return "This mock only implements stream: true";
  if (!VOICE_MOCK_MODELS.includes(String(body.model))) return `model: ${String(body.model)}`;
  for (const name of SAMPLING_PARAMS) if (name in body) return `${name}: not supported on this API version`;
  if (!Number.isInteger(body.max_tokens) || body.max_tokens < 1) return "max_tokens must be a positive integer";
  const messages = body.messages;
  if (!Array.isArray(messages) || messages.length === 0) return "messages: at least one message is required";
  if (messages[0].role !== "user") return "messages: the first message must use the user role";
  if (messages[messages.length - 1].role !== "user") return "The conversation must end with a user message";
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const blocks = Array.isArray(message.content) ? message.content : [];
    for (const block of blocks) {
      if (block.type === "thinking" && typeof block.signature !== "string") return "thinking block without signature";
    }
    const uses = message.role === "assistant" ? blocks.filter((block) => block.type === "tool_use").map((block) => block.id) : [];
    if (uses.length > 0) {
      const next = messages[index + 1];
      const results = next && Array.isArray(next.content) ? next.content.filter((block) => block.type === "tool_result") : [];
      const answered = new Set(results.map((block) => block.tool_use_id));
      if (uses.some((id) => !answered.has(id))) return "tool_use ids were found without tool_result blocks immediately after";
    }
    if (message.role === "user") {
      const previous = messages[index - 1];
      const offered = new Set(
        previous && previous.role === "assistant" && Array.isArray(previous.content)
          ? previous.content.filter((block) => block.type === "tool_use").map((block) => block.id)
          : [],
      );
      for (const block of blocks) {
        if (block.type === "tool_result" && !offered.has(block.tool_use_id)) return "unexpected tool_result block";
      }
    }
  }
  return null;
}

function sse(type, payload) {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
}

function frames(reply, model, seq) {
  const out = [];
  const id = `msg_voice_${String(seq).padStart(4, "0")}`;
  out.push(
    sse("message_start", {
      message: {
        id,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: MOCK_USAGE.input_tokens,
          output_tokens: 1,
          cache_creation_input_tokens: MOCK_USAGE.cache_creation_input_tokens,
          cache_read_input_tokens: MOCK_USAGE.cache_read_input_tokens,
        },
      },
    }),
  );
  let index = 0;
  if (reply.thinking) {
    out.push(sse("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } }));
    out.push(sse("content_block_delta", { index, delta: { type: "signature_delta", signature: `c2lnLSR7c2VxfQ==${seq}` } }));
    out.push(sse("content_block_stop", { index }));
    index += 1;
  }
  const text = Array.isArray(reply.text) ? reply.text : [];
  if (text.length > 0) {
    out.push(sse("content_block_start", { index, content_block: { type: "text", text: "", citations: null } }));
    for (const chunk of text) out.push(sse("content_block_delta", { index, delta: { type: "text_delta", text: chunk } }));
    out.push(sse("content_block_stop", { index }));
    index += 1;
  }
  const tools = Array.isArray(reply.tools) ? reply.tools : [];
  tools.forEach((tool, position) => {
    const toolId = tool.id ?? `toolu_voice_${seq}_${position}`;
    out.push(sse("content_block_start", { index, content_block: { type: "tool_use", id: toolId, name: tool.name, input: {} } }));
    const json = JSON.stringify(tool.input ?? {});
    const middle = Math.floor(json.length / 2);
    for (const partial of [json.slice(0, middle), json.slice(middle)]) {
      out.push(sse("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: partial } }));
    }
    out.push(sse("content_block_stop", { index }));
    index += 1;
  });
  const stop = typeof reply.stop === "string" ? reply.stop : tools.length > 0 ? "tool_use" : "end_turn";
  out.push(
    sse("message_delta", {
      delta: { stop_reason: stop, stop_sequence: null },
      usage: {
        input_tokens: MOCK_USAGE.input_tokens,
        cache_creation_input_tokens: MOCK_USAGE.cache_creation_input_tokens,
        cache_read_input_tokens: MOCK_USAGE.cache_read_input_tokens,
        output_tokens: MOCK_USAGE.output_tokens,
      },
    }),
  );
  out.push(sse("message_stop", {}));
  return out;
}

function sendError(res, status, type, message, extraHeaders = {}) {
  res.writeHead(status, { "content-type": "application/json", ...extraHeaders });
  res.end(JSON.stringify({ type: "error", error: { type, message }, request_id: "req_voice_mock_error" }));
}
