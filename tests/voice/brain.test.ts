// The turn loop (lib/voice/server/brain.ts) with the rule-based mock brain and with the real
// Anthropic SDK against a local mock of the Messages API: a request taken through a tool round, a
// failing tool, the cap of three tool rounds, the opening turn without any model call, refusals,
// API errors, and what is kept in the session state between turns.
import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, it, mock } from "node:test";
import type Anthropic from "@anthropic-ai/sdk";
import {
  createAnthropicModel,
  MAX_TOOL_ROUNDS,
  runTurn,
  toApiMessages,
  type BrainModel,
  type ModelEvent,
  type ModelRequest,
} from "@/lib/voice/server/brain";
import { createMockBrain, MOCK_REPLY_PREFIX } from "@/lib/voice/server/brain-mock";
import { createSessionState, type VoiceSessionState } from "@/lib/voice/server/state";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import { getDemoTenant } from "@/lib/voice/demos";
import { createMemorySinks, type ToolSinks } from "@/lib/voice/tools/execute";
import { DEFAULT_VOICE_LIMITS, type TurnStreamEvent, type VoiceTenantConfig } from "@/lib/voice/types";
import { createMemoryCalendar } from "@/lib/voice/calendar";
import { startVoiceMock } from "./mock-anthropic.mjs";

/** Wednesday 2 December 2026, 10:00 in Zurich. */
const NOW = Date.UTC(2026, 11, 2, 9, 0, 0);
const SESSION_ID = "brainTestSession000001";
const LEAD_UTTERANCE = "Ich möchte eine Offerte für eine Website. Mein Name ist Anna Muster, meine E-Mail ist anna@example.ch";
const LEAD_INPUT = {
  task: "project_request",
  fields: { service: "website", problem: "Eine neue Website für einen Coiffeursalon." },
  name: "Anna Muster",
  email: "anna@example.ch",
  summary: "Neue Website für einen Coiffeursalon in Winterthur.",
};

function newState(tenant: VoiceTenantConfig = MODOLO_VOICE_TENANT): VoiceSessionState {
  return createSessionState({
    tenantId: tenant.id,
    sessionId: SESSION_ID,
    mode: "local",
    channel: "web",
    locale: tenant.defaultLocale,
    startedAt: NOW,
    reservation: null,
  });
}

async function turn(args: {
  state: VoiceSessionState;
  text: string;
  model: BrainModel | null;
  tenant?: VoiceTenantConfig;
  sinks?: ToolSinks;
  opening?: boolean;
}): Promise<TurnStreamEvent[]> {
  const tenant = args.tenant ?? MODOLO_VOICE_TENANT;
  const events: TurnStreamEvent[] = [];
  for await (const event of runTurn({
    tenant,
    state: args.state,
    text: args.text,
    locale: tenant.defaultLocale,
    opening: args.opening,
    limits: DEFAULT_VOICE_LIMITS,
    model: args.model,
    modelId: "claude-haiku-5-5",
    maxOutputTokens: 400,
    calendar: tenant.calendar ? createMemoryCalendar(tenant.calendar, tenant.hours) : null,
    sinks: args.sinks ?? createMemorySinks(),
    remainingTurns: 10,
    now: () => NOW,
  })) {
    events.push(event);
  }
  return events;
}

function text(events: readonly TurnStreamEvent[]): string {
  return events.map((event) => (event.type === "delta" ? event.text : "")).join("");
}

function toolEvents(events: readonly TurnStreamEvent[]): string[] {
  return events.flatMap((event) => (event.type === "tool" ? [`${event.name}:${event.status}`] : []));
}

function last(events: readonly TurnStreamEvent[]): TurnStreamEvent {
  return events[events.length - 1];
}

/** A model that never answers: for turns that must not call one. */
function forbiddenModel(): BrainModel & { calls: number } {
  return {
    id: "forbidden",
    calls: 0,
    async *stream(): AsyncGenerator<ModelEvent> {
      this.calls += 1;
      throw new Error("the model must not be called");
    },
  };
}

beforeEach(() => {
  // The turn logs one JSON line; keep the test output clean.
  mock.method(console, "log", () => undefined);
});
afterEach(() => mock.restoreAll());

describe("runTurn with the mock brain", () => {
  it("speaks the greeting on the opening turn without calling any model", async () => {
    const state = newState();
    const model = forbiddenModel();
    const events = await turn({ state, text: "", model, opening: true });
    assert.equal(model.calls, 0);
    assert.equal(text(events), MODOLO_VOICE_TENANT.greeting.de);
    assert.deepEqual(last(events), { type: "done", ended: false, remainingTurns: 10, remainingSeconds: 180 });
    assert.equal(state.greeted, true);
    assert.deepEqual(state.history, [{ messages: [{ role: "assistant", content: MODOLO_VOICE_TENANT.greeting.de }] }]);
    // Asked again (a retried request), the greeting is said again but stored once.
    await turn({ state, text: "", model, opening: true });
    assert.equal(state.history.length, 1);
    assert.equal(model.calls, 0);
  });

  it("takes a request through a tool round and records it", async () => {
    const state = newState();
    const sinks = createMemorySinks();
    const events = await turn({ state, text: LEAD_UTTERANCE, model: createMockBrain({ tenant: MODOLO_VOICE_TENANT, locale: "de", now: () => NOW }), sinks });

    assert.deepEqual(toolEvents(events), ["create_lead:started", "create_lead:ok"]);
    assert.ok(events.some((event) => event.type === "handoff" && event.handoff.kind === "written"));
    assert.equal(last(events).type, "done");
    assert.ok(text(events).startsWith(MOCK_REPLY_PREFIX));
    assert.match(text(events), /Referenz LD-2222/);
    // The text before and after the tool call does not run together in the widget's caption.
    assert.match(text(events), /Anfrage auf\. \[Testantwort\] Die Anfrage/);
    assert.equal(sinks.leads.length, 1);
    const lead = sinks.leads[0] as { taskId: string; fields: Record<string, string>; contact: Record<string, string> };
    assert.equal(lead.taskId, "project_request");
    assert.equal(lead.fields.service, "website");
    assert.deepEqual(lead.contact, { name: "Anna Muster", email: "anna@example.ch" });
    assert.equal(state.outcomes.length, 1);
    assert.equal(state.outcomes[0].kind, "lead");
    assert.equal(state.turns, 1);
    assert.equal(state.counters.leads, 1);

    // Stored: the utterance, the tool call, its result and the reply; the next turn builds on it.
    const stored = state.history[0].messages;
    assert.equal(stored[0].role, "user");
    assert.ok(Array.isArray(stored[1].content) && stored[1].content.some((block) => block.type === "tool_use"));
    assert.ok(Array.isArray(stored[2].content) && stored[2].content[0].type === "tool_result");
    assert.equal(stored[stored.length - 1].role, "assistant");
  });

  it("does not pass the same request on twice across turns (the replay memory is carried)", async () => {
    const state = newState();
    const sinks = createMemorySinks();
    const brain = (): BrainModel => createMockBrain({ tenant: MODOLO_VOICE_TENANT, locale: "de", now: () => NOW });
    await turn({ state, text: LEAD_UTTERANCE, model: brain(), sinks });
    // The state goes through JSON between requests, like the real store.
    const reloaded = JSON.parse(JSON.stringify(state)) as VoiceSessionState;
    // A model that repeats the very same call in a later turn gets the first answer back.
    const repeat: BrainModel = scriptedModel([
      { text: "Ich trage es ein.", tools: [{ name: "create_lead", input: leadInputFrom(sinks) }] },
      { text: "Erledigt." },
    ]);
    const events = await turn({ state: reloaded, text: "Hast du es?", model: repeat, sinks });
    assert.deepEqual(toolEvents(events), ["create_lead:started", "create_lead:ok"]);
    assert.equal(sinks.leads.length, 1, "the sink saw the request once");
    assert.equal(reloaded.outcomes.length, 1, "the outcome is recorded once");
  });

  it("says so when a tool fails, and records nothing", async () => {
    const state = newState();
    const failing: ToolSinks = { ...createMemorySinks(), lead: async () => ({ ok: false, ref: "" }) };
    const events = await turn({ state, text: LEAD_UTTERANCE, model: createMockBrain({ tenant: MODOLO_VOICE_TENANT, locale: "de", now: () => NOW }), sinks: failing });
    assert.deepEqual(toolEvents(events), ["create_lead:started", "create_lead:failed"]);
    assert.equal(events.some((event) => event.type === "handoff"), false);
    assert.match(text(events), /nicht geklappt \(unavailable\)/);
    assert.equal(last(events).type, "done");
    assert.deepEqual(state.outcomes, []);
  });

  it("asks for what is missing before it calls a tool", async () => {
    const state = newState();
    const sinks = createMemorySinks();
    const events = await turn({ state, text: "Ich hätte gern eine Offerte für eine Website.", model: createMockBrain({ tenant: MODOLO_VOICE_TENANT, locale: "de" }), sinks });
    assert.deepEqual(toolEvents(events), []);
    assert.match(text(events), /fehlt noch: der Name und eine Telefonnummer oder E-Mail/);
    assert.equal(sinks.leads.length, 0);
  });

  it("checks the calendar and books a time on a demo tenant", async () => {
    const tenant = getDemoTenant("demo-coiffeur");
    assert.ok(tenant?.calendar);
    const state = newState(tenant);
    const calendar = createMemoryCalendar(tenant.calendar, tenant.hours);
    const run = async (utterance: string): Promise<TurnStreamEvent[]> => {
      const events: TurnStreamEvent[] = [];
      for await (const event of runTurn({
        tenant,
        state,
        text: utterance,
        locale: "de",
        limits: DEFAULT_VOICE_LIMITS,
        model: createMockBrain({ tenant, locale: "de", now: () => NOW }),
        modelId: "claude-haiku-5-5",
        maxOutputTokens: 400,
        calendar,
        sinks: createMemorySinks(),
        remainingTurns: 10,
        now: () => NOW,
      })) {
        events.push(event);
      }
      return events;
    };
    const checked = await run("Ich möchte einen Termin.");
    assert.deepEqual(toolEvents(checked), ["check_availability:started", "check_availability:ok"]);
    assert.match(text(checked), /Frei sind \d\d:\d\d/);
    await run("Mein Name ist Lea Beispiel, Telefon 079 123 45 67");
    const booked = await run("Ja, bitte buchen");
    assert.deepEqual(toolEvents(booked), ["book_appointment:started", "book_appointment:ok"]);
    assert.match(text(booked), /Referenz MV-[2-9A-Z]{4}/);
    assert.equal(state.outcomes[0].kind, "booking");
  });

  it("ends the conversation with end_call: done carries ended: true", async () => {
    const state = newState();
    const events = await turn({ state, text: "Danke, tschüss", model: createMockBrain({ tenant: MODOLO_VOICE_TENANT, locale: "de" }) });
    assert.deepEqual(toolEvents(events), ["end_call:started", "end_call:ok"]);
    const done = last(events);
    assert.equal(done.type, "done");
    assert.equal(done.type === "done" && done.ended, true);
    assert.match(text(events), /Auf Wiederhören/);
  });

  it("stops after three tool rounds and keeps no unanswered tool call", async () => {
    const state = newState();
    const calls: number[] = [];
    // A model that asks for a tool every single time.
    const greedy: BrainModel = {
      id: "greedy",
      async *stream(request: ModelRequest): AsyncGenerator<ModelEvent> {
        calls.push(request.messages.length);
        yield { type: "text", text: "Einen Moment. " };
        yield {
          type: "end",
          content: [
            { type: "text", text: "Einen Moment. " },
            { type: "tool_use", id: `toolu_${calls.length}`, name: "create_lead", input: { task: "project_request" } },
          ],
          stopReason: "tool_use",
          model: "greedy",
          usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
        };
      },
    };
    const events = await turn({ state, text: "Bitte eine Anfrage", model: greedy });
    assert.equal(calls.length, MAX_TOOL_ROUNDS + 1);
    assert.equal(toolEvents(events).filter((event) => event.endsWith(":started")).length, MAX_TOOL_ROUNDS);
    assert.equal(last(events).type, "done");
    assertNoDanglingToolUse(toApiMessages(state.history));
    const stored = state.history[0].messages;
    const final = stored[stored.length - 1];
    assert.equal(final.role, "assistant");
    assert.ok(Array.isArray(final.content) && final.content.every((block) => block.type !== "tool_use"));
  });

  it("says nothing and keeps nothing when no model is configured", async () => {
    const state = newState();
    const events = await turn({ state, text: "Hallo", model: null });
    assert.deepEqual(events, [{ type: "error", code: "unavailable" }]);
    assert.deepEqual(state.history, []);
    assert.equal(state.turns, 0);
  });
});

describe("runTurn with the Anthropic SDK against a mock API", () => {
  let server: Awaited<ReturnType<typeof startVoiceMock>>;
  let replies: Array<Record<string, unknown> | ((body: Record<string, unknown>) => Record<string, unknown>)> = [];
  const savedBaseUrl = process.env.ANTHROPIC_BASE_URL;

  before(async () => {
    server = await startVoiceMock({
      respond: (body: Record<string, unknown>) => {
        const next = replies.shift() ?? { text: ["(no reply scripted)"] };
        return typeof next === "function" ? next(body) : next;
      },
    });
    process.env.ANTHROPIC_BASE_URL = server.url;
  });
  after(async () => {
    await server.close();
    if (savedBaseUrl === undefined) delete process.env.ANTHROPIC_BASE_URL;
    else process.env.ANTHROPIC_BASE_URL = savedBaseUrl;
  });
  beforeEach(() => {
    server.requests.length = 0;
    replies = [];
  });

  const model = (): BrainModel => createAnthropicModel("sk-ant-test-key");
  /** The body of the n-th request the mock API received. */
  const recorded = (index: number): RecordedRequest => server.requests[index] as unknown as RecordedRequest;

  it("creates a lead through a tool round and sends the thinking back within the turn only", async () => {
    replies = [
      { thinking: true, text: ["Gut, ich nehme das auf. "], tools: [{ name: "create_lead", input: LEAD_INPUT }] },
      { text: ["Die Anfrage ist bei Francesco, ", "die Referenz ist LD-2222."] },
      { text: ["Gern geschehen."] },
    ];
    const state = newState();
    const sinks = createMemorySinks();
    const events = await turn({ state, text: "Ich möchte eine neue Website.", model: model(), sinks });

    assert.deepEqual(toolEvents(events), ["create_lead:started", "create_lead:ok"]);
    assert.equal(text(events), "Gut, ich nehme das auf. Die Anfrage ist bei Francesco, die Referenz ist LD-2222.");
    assert.equal(last(events).type, "done");
    assert.equal(sinks.leads.length, 1);
    assert.equal(server.requests.length, 2);

    const first = recorded(0);
    assert.equal(first.model, "claude-haiku-5-5");
    assert.equal(first.max_tokens, 400);
    assert.deepEqual(first.output_config, { effort: "low" });
    for (const name of ["temperature", "top_p", "top_k", "thinking"]) assert.equal(name in first, false);
    assert.deepEqual(first.system[0].cache_control, { type: "ephemeral" });
    assert.match(first.system[0].text, /Modolo Digital Studio/);
    assert.match(first.system[1].text, /# Context of this conversation/);
    assert.equal(first.system[1].cache_control, undefined);
    assert.deepEqual(
      first.tools.map((tool) => tool.name),
      // Modolo lists request_callback: it takes a callback wish when the caller asks for one.
      ["create_lead", "request_callback", "end_call"],
    );

    // Round two: the assistant's blocks unchanged (thinking with its signature), then the results.
    const second = recorded(1);
    const [utterance, assistant, results] = second.messages;
    assert.deepEqual(utterance, { role: "user", content: "Ich möchte eine neue Website." });
    assert.equal(blockAt(assistant, 0).type, "thinking");
    assert.equal(typeof blockAt(assistant, 0).signature, "string");
    assert.equal(blockAt(assistant, 2).type, "tool_use");
    assert.equal(blockAt(results, 0).type, "tool_result");
    assert.equal(blockAt(results, 0).tool_use_id, blockAt(assistant, 2).id);
    assert.equal(blockAt(results, 0).is_error, false);
    assert.match(String(blockAt(results, 0).content), /"ok":true/);
    assert.match(String(blockAt(results, 0).content), /LD-2222/);
    assert.deepEqual(second.system, first.system, "the system prompt is identical within a turn");

    // The next turn re-sends the history WITHOUT thinking blocks (they are valid within a turn only).
    await turn({ state, text: "Danke.", model: model(), sinks });
    const third = recorded(2);
    const blocks = third.messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []));
    assert.equal(
      blocks.some((block) => block.type === "thinking"),
      false,
    );
    assert.equal(third.messages.length, 5);
    assert.deepEqual(third.messages[4], { role: "user", content: "Danke." });
  });

  it("hands a failing tool's result back as an error and lets the model say so", async () => {
    replies = [
      { text: ["Ich trage das ein. "], tools: [{ name: "create_lead", input: LEAD_INPUT }] },
      { text: ["Das hat leider nicht geklappt."] },
    ];
    const failing: ToolSinks = { ...createMemorySinks(), lead: async () => ({ ok: false, ref: "" }) };
    const events = await turn({ state: newState(), text: "Website bitte.", model: model(), sinks: failing });
    assert.deepEqual(toolEvents(events), ["create_lead:started", "create_lead:failed"]);
    const result = blockAt(recorded(1).messages[2], 0);
    assert.equal(result.is_error, true);
    assert.match(String(result.content), /did not go through/);
    assert.match(text(events), /nicht geklappt/);
  });

  it("refuses a tool of another tenant: it does not exist here", async () => {
    replies = [
      { text: ["Ich schaue nach. "], tools: [{ name: "check_availability", input: { service: "women_cut", date: "2026-12-03" } }] },
      { text: ["Das kann ich hier nicht."] },
    ];
    const events = await turn({ state: newState(), text: "Einen Termin bitte.", model: model() });
    assert.deepEqual(toolEvents(events), ["check_availability:started", "check_availability:failed"]);
    assert.match(String(blockAt(recorded(1).messages[2], 0).content), /"code":"not_enabled"/);
  });

  it("caps the turn at three tool rounds against the real wire format", async () => {
    const invalid = { name: "create_lead", input: { task: "project_request" } };
    replies = Array.from({ length: 6 }, () => ({ text: ["Moment. "], tools: [invalid] }));
    const state = newState();
    const events = await turn({ state, text: "Anfrage bitte.", model: model() });
    assert.equal(server.requests.length, MAX_TOOL_ROUNDS + 1);
    assert.equal(toolEvents(events).filter((event) => event.endsWith(":failed")).length, MAX_TOOL_ROUNDS);
    assert.equal(last(events).type, "done");
    // The next turn's request is valid for the API: no tool call without its result.
    replies = [{ text: ["Gut."] }];
    const next = await turn({ state, text: "Weiter.", model: model() });
    assert.equal(last(next).type, "done");
  });

  it("ends a refused turn with 'refused' and keeps nothing of it", async () => {
    replies = [{ text: ["Sure, the first"], stop: "refusal" }];
    const state = newState();
    const events = await turn({ state, text: "Etwas Verbotenes.", model: model() });
    assert.deepEqual(last(events), { type: "error", code: "refused" });
    assert.deepEqual(state.history, []);
  });

  it("maps an API error to 'upstream' and a bad key to 'unavailable'", async () => {
    replies = [{ status: 500 }, { status: 500 }];
    const failed = await turn({ state: newState(), text: "Hallo", model: model() });
    assert.deepEqual(last(failed), { type: "error", code: "upstream" });
    replies = [{ status: 401 }];
    const rejected = await turn({ state: newState(), text: "Hallo", model: model() });
    assert.deepEqual(last(rejected), { type: "error", code: "unavailable" });
  });
});

// ---------------------------------------------------------------------------------------------

type RecordedBlock = { type: string } & Record<string, unknown>;
interface RecordedMessage {
  role: string;
  content: string | RecordedBlock[];
}
/** What the brain sent to the Messages API, as the mock recorded it. */
interface RecordedRequest extends Record<string, unknown> {
  model: string;
  max_tokens: number;
  output_config?: unknown;
  system: Array<{ type: string; text: string; cache_control?: unknown }>;
  tools: Array<{ name: string }>;
  messages: RecordedMessage[];
}

function blockAt(message: RecordedMessage, index: number): RecordedBlock {
  assert.ok(Array.isArray(message.content), "content is a list of blocks");
  return message.content[index];
}

function scriptedModel(steps: Array<{ text: string; tools?: Array<{ name: string; input: unknown }> }>): BrainModel {
  let index = 0;
  return {
    id: "scripted",
    async *stream(): AsyncGenerator<ModelEvent> {
      const step = steps[Math.min(index, steps.length - 1)];
      index += 1;
      yield { type: "text", text: step.text };
      const tools = (step.tools ?? []).map((tool, position) => ({
        type: "tool_use" as const,
        id: `toolu_scripted_${index}_${position}`,
        name: tool.name,
        input: tool.input,
      }));
      yield {
        type: "end",
        content: [{ type: "text", text: step.text }, ...tools],
        stopReason: tools.length > 0 ? "tool_use" : "end_turn",
        model: "scripted",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
}

/** The create_lead input the mock brain sent, as the sink received it. */
function leadInputFrom(sinks: ReturnType<typeof createMemorySinks>): Record<string, unknown> {
  const lead = sinks.leads[0] as { taskId: string; fields: Record<string, string>; contact: Record<string, string>; summary: string };
  return { task: lead.taskId, fields: lead.fields, ...lead.contact, summary: lead.summary };
}

function assertNoDanglingToolUse(messages: Anthropic.MessageParam[]): void {
  messages.forEach((message, index) => {
    if (message.role !== "assistant" || typeof message.content === "string") return;
    const uses = message.content.filter((block) => block.type === "tool_use").map((block) => (block as { id: string }).id);
    if (uses.length === 0) return;
    const next = messages[index + 1];
    const answered = new Set(
      next && typeof next.content !== "string"
        ? next.content.filter((block) => block.type === "tool_result").map((block) => (block as { tool_use_id: string }).tool_use_id)
        : [],
    );
    for (const id of uses) assert.ok(answered.has(id), `tool_use ${id} has no result`);
  });
}
