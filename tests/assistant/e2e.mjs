// Black-box HTTP checks of the assistant API against a running Next.js server whose Anthropic
// client points at the local mock API. Nothing here is meant to reach Anthropic or send an email;
// "Safety" below says what still holds when the server is set up wrong.
//
// 1. Start Next with the assistant aimed at the mock (port 4010) and a 4-message session cap.
//    Git Bash / macOS / Linux:
//      ANTHROPIC_API_KEY=test-key ANTHROPIC_BASE_URL=http://127.0.0.1:4010 ASSISTANT_SESSION_MESSAGE_LIMIT=4 \
//      ASSISTANT_ADMIN_TOKEN= RESEND_API_KEY= ASSISTANT_LEAD_COPY= KV_REST_API_URL= UPSTASH_REDIS_REST_URL= npx next dev
//    PowerShell:
//      $env:ANTHROPIC_API_KEY="test-key"; $env:ANTHROPIC_BASE_URL="http://127.0.0.1:4010"
//      $env:ASSISTANT_SESSION_MESSAGE_LIMIT="4"; $env:ASSISTANT_ADMIN_TOKEN=""; $env:RESEND_API_KEY=""
//      $env:ASSISTANT_LEAD_COPY=""; $env:KV_REST_API_URL=""; $env:UPSTASH_REDIS_REST_URL=""; npx next dev
//    Next fills every variable the shell leaves UNDEFINED from .env files (.env.local included); an
//    empty one keeps the file's value out, so the run checks the "no delivery channel" lead path.
//    PowerShell 7.6 passes "" on as an empty variable; Windows PowerShell 5.1 deletes the variable
//    instead, so there move .env.local aside for the run.
//
// 2. Run:  node tests/assistant/e2e.mjs
//    It starts the mock on MOCK_PORT (default 4010) itself, or reuses a mock already running there
//    (node tests/assistant/mock-anthropic.mjs). BASE_URL defaults to http://localhost:3000.
//
// 3. Optional second run for the lead form checks that need a delivery channel: restart Next with
//    RESEND_API_KEY=re_dummy_e2e (a fake key, so even a mistake cannot send real mail), then run
//      E2E_LEAD_CHANNEL=configured node tests/assistant/e2e.mjs
//
// 4. Optional: start Next with ASSISTANT_ADMIN_TOKEN=<24+ random characters> and run with
//    E2E_ADMIN_TOKEN=<the same value> to check the protected /api/assistant/usage report.
//
// Safety, whatever the server's configuration:
//   - BASE_URL must be this machine (localhost, 127.0.0.1 or [::1]); anything else is refused.
//   - Before any test, one chat carrying a unique marker must reach the mock (its /__last): a
//     server that talks to another endpoint, such as the real paid API, stops the run after that
//     single request.
//   - Every quote request has the privacy box unticked (consent:false), which the server never
//     accepts: no request this script sends can be delivered, even with a real Resend key.
//     postLead() refuses any other body.
//
// Every test uses its own client IP (x-forwarded-for, IPv6 documentation range) and session id, so
// rate-limit buckets never collide, also across repeated runs. Exit code: 0 all passed, 1 failures,
// 2 not run (BASE_URL not local, server or mock not reachable, or the server not using the mock).
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { startMockServer, MOCK_TEXT_CHUNKS } from "./mock-anthropic.mjs";

const BASE_URL = (process.env.BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
// Only a dev server on this machine: a deployed site would answer with the real Anthropic API
// (billed per request) and deliver to a real inbox. WHATWG URL keeps IPv6 hostnames bracketed.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
if (!URL.canParse(BASE_URL) || !LOCAL_HOSTNAMES.has(new URL(BASE_URL).hostname)) {
  console.error(`Refusing to run: BASE_URL must point at this machine (localhost, 127.0.0.1 or [::1]), got "${BASE_URL}".`);
  process.exit(2);
}
const MOCK_PORT = Number(process.env.MOCK_PORT || 4010);
const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`; // what the server's ANTHROPIC_BASE_URL must point at
const LEAD_CHANNEL = process.env.E2E_LEAD_CHANNEL === "configured" ? "configured" : "none";
const ADMIN_TOKEN = process.env.E2E_ADMIN_TOKEN ?? ""; // must equal the server's ASSISTANT_ADMIN_TOKEN
const SESSION_LIMIT = 4; // must match ASSISTANT_SESSION_MESSAGE_LIMIT on the server
const ORIGIN = new URL(BASE_URL).origin;
const CHAT = `${BASE_URL}/api/assistant/chat`;
const LEAD = `${BASE_URL}/api/assistant/lead`;
const USAGE = `${BASE_URL}/api/assistant/usage`;
const REQUEST_TIMEOUT_MS = 60_000; // the first request to a route compiles it under `next dev`

const RUN = randomBytes(2).toString("hex");
let ipSeq = 0;
/**
 * A fresh client per call (2001:db8::/32 is reserved for documentation). The server rate-limits
 * IPv6 clients by their /64 prefix (one client controls a whole /64), so every call gets its own
 * /64: the run id in the 3rd group, the sequence number in the 4th.
 */
const freshIp = () => `2001:db8:${RUN}:${(ipSeq += 1).toString(16)}::1`;
const freshSession = () => randomUUID().replace(/-/g, "");

// ---------------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------------

function post(url, body, { ip = freshIp(), origin = ORIGIN, headers = {} } = {}) {
  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": ip,
      ...(origin ? { origin } : {}),
      ...headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

function chatBody(text, patch = {}) {
  return {
    tenant: "modolo",
    sessionId: freshSession(),
    locale: "it",
    page: "/it/servizi",
    messages: [{ role: "user", content: text }],
    ...patch,
  };
}

/** Parse a complete SSE body into the JSON payloads of its `data:` lines. */
function parseSse(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map((frame) =>
      frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n"),
    )
    .filter(Boolean)
    .map((data) => JSON.parse(data));
}

async function chatEvents(text, patch = {}, options = {}) {
  const response = await post(CHAT, chatBody(text, patch), options);
  if (response.status !== 200) assert.fail(`chat status ${response.status}: ${(await response.text()).slice(0, 300)}`);
  assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);
  return { response, events: parseSse(await response.text()) };
}

async function expectJsonError(response, status, error) {
  const text = await response.text();
  assert.equal(response.status, status, `expected ${status} ${error}, got ${response.status}: ${text.slice(0, 300)}`);
  const body = JSON.parse(text);
  assert.equal(body.ok, false);
  assert.equal(body.error, error);
  return body;
}

async function lastUpstreamRequest() {
  const response = await fetch(`${MOCK_URL}/__last`, { signal: AbortSignal.timeout(5000) });
  return response.json();
}

/** Every field valid except the unticked privacy box, so the server rejects it (consent_required). */
const undeliverableLead = () => ({
  name: "E2E Test (please ignore)",
  email: "e2e-test@example.com",
  description: "Automated end-to-end test of the quote form. Please ignore.",
  consent: false,
});

function leadBody(patch = {}) {
  return {
    tenant: "modolo",
    sessionId: freshSession(),
    locale: "it",
    page: "/it",
    lead: undeliverableLead(),
    hp: "",
    elapsedMs: 5000,
    ...patch,
  };
}

/**
 * POST to the lead route. Only consent:false bodies leave this script: lib/assistant/lead-schema.ts
 * rejects anything but `consent === true`, so with or without a delivery channel nothing can reach
 * an inbox. Raw strings (malformed JSON) carry no lead at all.
 */
function postLead(body, options) {
  if (typeof body !== "string" && body?.lead?.consent !== false) {
    throw new Error("e2e safety: a quote request must keep lead.consent === false, so it can never be delivered");
  }
  return post(LEAD, body, options);
}

// ---------------------------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------------------------

const tests = [];
const test = (name, fn, { skip = null } = {}) => tests.push({ name, fn, skip });

test("chat: SSE happy path (start → delta+ → done with remaining)", async () => {
  const { response, events } = await chatEvents("Ciao, quanto costa un sito?");
  assert.match(response.headers.get("cache-control") ?? "", /no-cache/);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.deepEqual(events[0], { type: "start" });
  const deltas = events.filter((event) => event.type === "delta");
  assert.ok(deltas.length >= 1, "at least one delta");
  assert.equal(deltas.map((event) => event.text).join(""), MOCK_TEXT_CHUNKS.join(""));
  assert.deepEqual(events.at(-1), { type: "done", stop: "end", remaining: SESSION_LIMIT - 1 });
});

test("chat: the request sent to Anthropic is cache-safe and uses no rejected parameters", async () => {
  const page = `/it/servizi/e2e-${RUN}`;
  await chatEvents("Che servizi offrite?", { page });
  const { body } = await lastUpstreamRequest();
  for (const forbidden of ["temperature", "top_p", "top_k", "thinking"]) assert.ok(!(forbidden in body), forbidden);
  assert.equal(body.model, "claude-haiku-5-5");
  assert.equal(body.stream, true);
  assert.ok(body.max_tokens >= 1024, `max_tokens ${body.max_tokens}`);
  assert.ok(["low", "medium", "high"].includes(body.output_config?.effort), JSON.stringify(body.output_config));
  assert.equal(body.system.length, 2);
  assert.deepEqual(body.system[0].cache_control, { type: "ephemeral" });
  assert.equal(body.system[1].cache_control, undefined);
  assert.ok(!body.system[0].text.includes(page), "the page path must stay out of the cached block");
  assert.ok(body.system[1].text.includes(page), "the page path belongs in the dynamic block");
  assert.ok(body.tool_choice === undefined || body.tool_choice.type === "auto", "no forced tool_choice");
  assert.equal(body.messages.at(-1).role, "user");
});

test(
  LEAD_CHANNEL === "configured"
    ? "chat: [[tool]] produces an action event and done with stop action"
    : "chat: without a lead delivery channel the quote tool is not offered and no action is sent",
  async () => {
    const { events } = await chatEvents("Vorrei un preventivo per un sito [[tool]]");
    const action = events.find((event) => event.type === "action");
    if (LEAD_CHANNEL === "configured") {
      assert.ok(action, `no action event in ${JSON.stringify(events)}`);
      assert.equal(action.action.kind, "quote_form");
      assert.equal(typeof action.action.summary, "string");
      assert.equal(events.at(-1).type, "done");
      assert.equal(events.at(-1).stop, "action");
      return;
    }
    // Same rule as the widget (lib/assistant/server/env.ts canDeliverLeads): a form that cannot be
    // delivered is neither shown nor offered to the model.
    assert.ok(!action, `unexpected action event in ${JSON.stringify(events)}`);
    assert.equal(events.at(-1).type, "done");
    const last = await (await fetch(`${MOCK_URL}/__last`)).json();
    const tools = last.body?.tools ?? [];
    assert.ok(!tools.some((tool) => tool?.name === "offer_quote_form"), "quote tool offered without a channel");
  },
);

test("chat: a refusal becomes error refused", async () => {
  const { events } = await chatEvents("[[refuse]]");
  assert.ok(!events.some((event) => event.type === "delta"), "no text for a refusal");
  assert.ok(events.some((event) => event.type === "error" && event.code === "refused"), JSON.stringify(events));
});

test("chat: an upstream 500 becomes error upstream, with nothing after it", async () => {
  const { events } = await chatEvents("[[500]]");
  assert.deepEqual(events.at(-1), { type: "error", code: "upstream" });
  assert.ok(!events.some((event) => event.type === "done"));
});

test("chat: invalid bodies are 400 bad_request", async () => {
  await expectJsonError(await post(CHAT, { tenant: "modolo" }), 400, "bad_request");
  await expectJsonError(await post(CHAT, "{not json"), 400, "bad_request");
  await expectJsonError(await post(CHAT, chatBody("Ciao", { tenant: "nobody" })), 400, "bad_request");
  await expectJsonError(await post(CHAT, chatBody("Ciao", { sessionId: "short" })), 400, "bad_request");
  await expectJsonError(await post(CHAT, chatBody("x".repeat(5000))), 400, "bad_request");
});

test("chat: bodies over 64 KB are 413 too_large", async () => {
  const huge = chatBody("Ciao", { padding: "x".repeat(70 * 1024) });
  await expectJsonError(await post(CHAT, huge), 413, "too_large");
});

test("chat: a foreign Origin is 403 forbidden; a filled honeypot too", async () => {
  await expectJsonError(await post(CHAT, chatBody("Ciao"), { origin: "https://evil.example" }), 403, "forbidden");
  await expectJsonError(await post(CHAT, chatBody("Ciao", { hp: "https://spam.example" })), 403, "forbidden");
});

test("chat: GET is 405", async () => {
  const response = await fetch(CHAT, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  assert.equal(response.status, 405);
});

test(`chat: message ${SESSION_LIMIT + 1} of a session is 429 session_limit`, async () => {
  const sessionId = freshSession();
  for (let i = 1; i <= SESSION_LIMIT; i += 1) {
    // A new IP for every message, so only the session counter can trip.
    const { events } = await chatEvents(`Domanda ${i}`, { sessionId });
    assert.deepEqual(events.at(-1), { type: "done", stop: "end", remaining: SESSION_LIMIT - i });
  }
  const body = await expectJsonError(await post(CHAT, chatBody("Ancora una", { sessionId })), 429, "session_limit");
  assert.ok(body.retryAfter === undefined || body.retryAfter >= 1);
});

test("chat: the per-IP minute limit answers 429 rate_limited with Retry-After", async () => {
  const ip = freshIp();
  for (let i = 1; i <= 40; i += 1) {
    const response = await post(CHAT, chatBody(`Messaggio ${i}`), { ip });
    if (response.status === 200) {
      await response.text();
      continue;
    }
    const body = await expectJsonError(response, 429, "rate_limited");
    assert.ok(i > 1, "the very first request must be allowed");
    const retryAfter = Number(response.headers.get("retry-after"));
    assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1 && retryAfter <= 60, `Retry-After: ${response.headers.get("retry-after")}`);
    assert.ok(body.retryAfter >= 1, `body.retryAfter: ${body.retryAfter}`);
    return;
  }
  assert.fail("40 requests from one IP were never rate limited");
});

test("lead: oversize, malformed and foreign-origin requests are refused", async () => {
  await expectJsonError(await postLead(leadBody({ padding: "x".repeat(20 * 1024) })), 413, "too_large");
  await expectJsonError(await postLead("{not json"), 400, "bad_request");
  await expectJsonError(await postLead(leadBody({ tenant: "nobody" })), 400, "bad_request");
  await expectJsonError(await postLead(leadBody(), { origin: "https://evil.example" }), 403, "forbidden");
});

test(
  "lead: without a delivery channel the form is 503 unavailable",
  async () => {
    // The route checks the channel before the fields, so the unticked box still gets 503 here; on a
    // server that does have a channel the same body is a 400, and nothing is delivered either way.
    await expectJsonError(await postLead(leadBody()), 503, "unavailable");
  },
  { skip: LEAD_CHANNEL === "configured" ? "the server has a delivery channel (E2E_LEAD_CHANNEL=configured)" : null },
);

const needsChannel = { skip: LEAD_CHANNEL === "none" ? "needs a delivery channel: see step 3 at the top of this file" : null };

test(
  "lead: invalid fields are 400 invalid with per-field errors",
  async () => {
    const body = await expectJsonError(
      await postLead(leadBody({ lead: { name: "", email: "not-an-email", description: "short", consent: false } })),
      400,
      "invalid",
    );
    assert.equal(body.fields.name, "required");
    assert.equal(body.fields.email, "invalid_email");
    assert.equal(body.fields.description, "too_short");
    assert.equal(body.fields.consent, "consent_required");
  },
  needsChannel,
);

test(
  "lead: a filled honeypot gets a fake success",
  async () => {
    const response = await postLead(leadBody({ hp: "https://spam.example" }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.id, "string");
  },
  needsChannel,
);

test(
  "lead: a form submitted faster than a human could gets a fake success",
  async () => {
    const response = await postLead(leadBody({ elapsedMs: 300 }));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(typeof body.id, "string");
  },
  needsChannel,
);

const getUsage = (authorization) =>
  fetch(USAGE, { headers: authorization ? { authorization } : {}, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });

test(
  "usage: 404 when ASSISTANT_ADMIN_TOKEN is not configured",
  async () => {
    for (const authorization of [null, "Bearer not-the-token-not-the-token"]) {
      assert.equal((await getUsage(authorization)).status, 404);
    }
  },
  { skip: ADMIN_TOKEN ? "E2E_ADMIN_TOKEN is set: the server has an admin token" : null },
);

test(
  "usage: bearer-protected summary, never cached, without secrets",
  async () => {
    for (const authorization of [null, `Bearer ${"x".repeat(ADMIN_TOKEN.length)}`, `Bearer ${ADMIN_TOKEN}x`, ADMIN_TOKEN]) {
      assert.equal((await getUsage(authorization)).status, 401, `authorization: ${authorization === null ? "none" : "wrong"}`);
    }
    const response = await getUsage(`Bearer ${ADMIN_TOKEN}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") ?? "", /no-store/);
    const text = await response.text();
    assert.ok(!text.includes("test-key"), "the usage report must not contain the API key");
    const body = JSON.parse(text);
    assert.equal(body.ok, true);
    assert.equal(body.tenant, "modolo");
    assert.match(body.usage.day, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(body.usage.requestsToday >= 1, "the chat requests above are counted");
    assert.ok(body.usage.costTodayUsd > 0, "their estimated cost is recorded");
    assert.equal(body.limits.maxUserMessagesPerSession, SESSION_LIMIT);
  },
  { skip: ADMIN_TOKEN ? null : "set E2E_ADMIN_TOKEN: see step 4 at the top of this file" },
);

// ---------------------------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------------------------

async function ensureMock() {
  try {
    return await startMockServer({ port: MOCK_PORT });
  } catch (error) {
    if (error?.code !== "EADDRINUSE") throw error;
    // Something already listens on the port: accept it only if it is the mock.
    const response = await fetch(`${MOCK_URL}/__last`, { signal: AbortSignal.timeout(3000) });
    await response.json();
    console.log(`Using the mock already running on ${MOCK_URL}`);
    return null;
  }
}

/**
 * One chat with a unique marker must show up in the mock's /__last. Run before the tests, so a
 * server pointed anywhere else (the real, billed API included) costs at most this one request.
 * Returns null when the server uses this mock, else what went wrong.
 */
async function probeServerUsesMock() {
  const marker = `e2e-probe-${RUN}-${randomBytes(4).toString("hex")}`;
  const response = await post(CHAT, chatBody(`Ciao ${marker}`));
  const text = await response.text();
  if (response.status !== 200) return `the probe chat got HTTP ${response.status}: ${text.slice(0, 200)}`;
  const last = await lastUpstreamRequest();
  if (JSON.stringify(last?.body?.messages ?? null).includes(marker)) return null;
  return (
    `the mock on ${MOCK_URL} never received the probe chat, so the server's Anthropic client points ` +
    `elsewhere: start Next with ANTHROPIC_BASE_URL=${MOCK_URL} (or another client used the mock at the same moment: run again)`
  );
}

async function main() {
  let mock = null;
  try {
    mock = await ensureMock();
  } catch (error) {
    console.error(`Cannot start or reach the mock Anthropic API on ${MOCK_URL}: ${error?.message ?? error}`);
    process.exit(2);
  }
  try {
    await fetch(BASE_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    console.error(`Cannot reach the Next.js server at ${BASE_URL} (${error?.message ?? error}). See the instructions at the top of this file.`);
    await mock?.close();
    process.exit(2);
  }
  const problem = await probeServerUsesMock().catch((error) => `the probe chat failed: ${error?.message ?? error}`);
  if (problem) {
    console.error(`Stopped before any test: ${problem}. See the instructions at the top of this file.`);
    await mock?.close();
    process.exit(2);
  }

  console.log(`Assistant e2e against ${BASE_URL} (mock ${MOCK_URL}, lead channel: ${LEAD_CHANNEL})\n`);
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const { name, fn, skip } of tests) {
    if (skip) {
      skipped += 1;
      console.log(`  SKIP  ${name}  (${skip})`);
      continue;
    }
    const started = Date.now();
    try {
      await fn();
      passed += 1;
      console.log(`  PASS  ${name}  (${Date.now() - started} ms)`);
    } catch (error) {
      failed += 1;
      console.log(`  FAIL  ${name}\n        ${String(error?.message ?? error).split("\n").join("\n        ")}`);
    }
  }
  await mock?.close();
  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  process.exit(failed > 0 ? 1 : 0);
}

await main();
