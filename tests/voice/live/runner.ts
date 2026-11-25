// Plays the live scenarios through the SAME server code the site uses for a text conversation in
// mode "local": the session, turn and end handlers of lib/voice/server/handlers.ts, called
// in-process with Request objects (as the tests do), with every store in memory and the demo
// calendars in memory. Nothing listens on a port.
//
//   paid run:  the real model (createAnthropicModel, the brain of the site), metered call by call;
//   dry run:   the rule-based fake model of the site (createMockBrain, VOICE_BRAIN=mock) with fake
//              token counts, so the whole tool, the files and the ceiling can be proved without a
//              key and without network.
//
// E-mails never leave the machine: the handlers get an e-mail service whose sender only keeps the
// message in memory (deps.sendEmail), and fetch is replaced for the whole run by a guard that lets
// through only requests to the Anthropic API, and only in a paid run. Every request it sees is
// recorded, and a blocked one fails a check.
//
// Money: before every model call the call's worst case is compared with what is left under the
// ceiling, and the call is not made when it might pass it; after every call the cost of the tokens
// the API reported is added. Once the ceiling is reached the run stops, says so, and writes what it
// has.
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import type { UsageTokens } from "@/lib/assistant/server/costs";
import { createMemoryStore, type KVStore } from "@/lib/assistant/server/store";
import { getCalendar, resetCalendarsForTests } from "@/lib/voice/calendar";
import { addDays, weekdayOf, zonedParts } from "@/lib/voice/hours";
import { BrainFailure, createAnthropicModel, turnSystem, turnTools, type BrainModel, type ModelEvent } from "@/lib/voice/server/brain";
import { createMockBrain } from "@/lib/voice/server/brain-mock";
import { DEFAULT_VOICE_MAX_OUTPUT_TOKENS, getVoiceEnv, resetVoiceEnvForTests } from "@/lib/voice/server/env";
import { handleEndRequest, handleSessionRequest, handleTurnRequest, type VoiceDeps } from "@/lib/voice/server/handlers";
import type { VoiceSessionState } from "@/lib/voice/server/state";
import type { SendEmail } from "@/lib/voice/server/summary";
import { verifySessionToken } from "@/lib/voice/server/token";
import { getVoiceTenant } from "@/lib/voice/tenants";
import type { CallSummary, SessionGrant, TurnStreamEvent, VoiceTenantConfig } from "@/lib/voice/types";
import {
  protectedShingles,
  runChecks,
  type CapturedEmail,
  type CheckResult,
  type NetworkAttempt,
  type PlayRecord,
  type ToolCallRecord,
  type TurnRecord,
} from "./checks";
import { LIVE_CHF_PER_USD, PRICE_SOURCE, callWorstCaseUsd, costUsd, priceOf, usdToChf } from "./prices";
import { writeIndex, writeScenarioReport, type ModelCallRecord, type ScenarioReport } from "./report";
import type { LiveScenario } from "./scenarios";

/**
 * The clock of every conversation starts here: Wednesday 2 December 2026, 10:00 in Zurich. Fixed,
 * so that the dates of the plan hold whatever day the run happens (scenario 26: "Dienstag, den
 * dritten Dezember" must not be a Tuesday). It advances with real time, plus MS_PER_LINE for every
 * line, as if the caller took that long to speak (which also keeps a scripted caller under the
 * per-session limit of turn requests in a few seconds).
 */
export const SIM_START_MS = Date.UTC(2026, 11, 2, 9, 0, 0);
const MS_PER_LINE = 8_000;
const SITE = "https://site.example";
/** The only origin a paid run may reach. */
const MODEL_API_ORIGIN = "https://api.anthropic.com";
/** Tokens a tool round may add (brain.ts TOOL_RESULT_TOKENS_PER_ROUND): for the upper estimate. */
const TOOL_ROUND_TOKENS = 1500;
/** Model calls per caller turn at most (brain.ts MAX_TOOL_ROUNDS + 1). */
const CALLS_PER_TURN = 4;

/** Fake usage of every call of a dry run (the fake model reports none): plausible orders of magnitude. */
export const DRY_RUN_USAGE: Readonly<UsageTokens> = { inputTokens: 900, outputTokens: 90, cacheReadTokens: 6000, cacheWriteTokens: 0 };

export interface LiveRunOptions {
  mode: "dry" | "paid";
  /** Absolute folder for the reports (checked by the caller: never inside the repository). */
  outDir: string;
  ceilingChf: number;
  scenarios: readonly LiveScenario[];
  /** Paid run only. Never printed, never written. */
  apiKey?: string;
  /** Dry run: the usage each fake call reports (default DRY_RUN_USAGE). */
  fakeUsage?: UsageTokens;
  /** Where the progress lines go (default console.log of the real console). */
  print?: (line: string) => void;
}

export interface LiveRunResult {
  played: number;
  notPlayed: string[];
  totalUsd: number;
  stopped: string | null;
  files: string[];
  reports: ScenarioReport[];
}

export interface RunPlan {
  scenarios: number;
  callerTurns: number;
  upperUsd: number;
  model: string;
  maxOutputTokens: number;
}

// ---------------------------------------------------------------------------------------------
// The environment of the run
// ---------------------------------------------------------------------------------------------

/** Variables that must not leak into the run from the shell or .env.local. */
const CLEARED_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ASSISTANT_HASH_SALT",
  "RESEND_API_KEY",
  "CONTACT_FROM",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "NODE_ENV",
];

const mutableEnv: Record<string, string | undefined> = process.env;

/** Sets exactly the voice configuration of the run; returns the function that restores the old one. */
function applyRunEnv(mode: "dry" | "paid", apiKey: string | undefined): () => void {
  const saved = new Map<string, string | undefined>();
  const keys = new Set([...CLEARED_KEYS, ...Object.keys(mutableEnv).filter((key) => key.startsWith("VOICE_"))]);
  for (const key of keys) {
    saved.set(key, mutableEnv[key]);
    delete mutableEnv[key];
  }
  const vars: Record<string, string> = {
    VOICE_ENABLED: "true",
    VOICE_MODE: "local",
    VOICE_BRAIN: mode === "paid" ? "anthropic" : "mock",
    // Demo businesses get live modes only with the lab switch.
    VOICE_LAB: "true",
    VOICE_SESSION_SECRET: randomBytes(36).toString("base64url"),
    // Room for slow real turns; the scenarios are short anyway.
    VOICE_MAX_CALL_SECONDS: "900",
  };
  if (mode === "paid" && apiKey) vars.ANTHROPIC_API_KEY = apiKey;
  for (const [key, value] of Object.entries(vars)) {
    if (!saved.has(key)) saved.set(key, mutableEnv[key]);
    mutableEnv[key] = value;
  }
  resetVoiceEnvForTests();
  resetCalendarsForTests();
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete mutableEnv[key];
      else mutableEnv[key] = value;
    }
    resetVoiceEnvForTests();
    resetCalendarsForTests();
  };
}

/** Replaces fetch for the run: only the model API, only in a paid run; everything is recorded. */
function guardNetwork(mode: "dry" | "paid", seen: () => NetworkAttempt[]): () => void {
  const original = globalThis.fetch;
  const guarded = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let shown = raw;
    let allowed = false;
    try {
      const url = new URL(raw);
      shown = `${url.origin}${url.pathname}`;
      allowed = mode === "paid" && url.origin === MODEL_API_ORIGIN;
    } catch {
      allowed = false;
    }
    seen().push({ url: shown, allowed });
    if (!allowed) throw new TypeError("Blocked by the live runner: no network outside the model API.");
    return original(input, init);
  };
  globalThis.fetch = guarded as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// ---------------------------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------------------------

interface Meter {
  ceilingUsd: number;
  spentUsd: number;
  stopped: string | null;
}

/** The model as the handlers get it: every call priced, the ceiling enforced before and after. */
function meteredModel(args: {
  inner: BrainModel;
  meter: Meter;
  calls: ModelCallRecord[];
  fakeUsage: UsageTokens | null;
  line: () => number;
}): BrainModel {
  const { inner, meter, calls, fakeUsage } = args;
  return {
    id: inner.id,
    async *stream(request): AsyncGenerator<ModelEvent> {
      if (meter.stopped !== null) throw new BrainFailure("unavailable");
      const worst = callWorstCaseUsd({
        model: request.model,
        system: request.system,
        tools: request.tools,
        messages: request.messages,
        maxTokens: request.maxTokens,
      });
      if (meter.spentUsd + worst > meter.ceilingUsd) {
        meter.stopped = `Tetto di spesa: la chiamata successiva poteva costare fino a ${usdToChf(worst).toFixed(4)} CHF e avrebbe potuto superare il tetto (spesi ${usdToChf(meter.spentUsd).toFixed(4)} CHF di ${usdToChf(meter.ceilingUsd).toFixed(4)}). Chiamata non fatta.`;
        throw new BrainFailure("unavailable");
      }
      const charge = (model: string, usage: UsageTokens, stop: string | null): void => {
        const cost = costUsd(model, usage);
        meter.spentUsd += cost;
        calls.push({ line: args.line(), model, usage: { ...usage }, costUsd: cost, stop, worstUsd: worst });
        if (meter.spentUsd >= meter.ceilingUsd && meter.stopped === null) {
          meter.stopped = `Tetto di spesa raggiunto: spesi ${usdToChf(meter.spentUsd).toFixed(4)} CHF, tetto ${usdToChf(meter.ceilingUsd).toFixed(4)} CHF.`;
        }
      };
      try {
        for await (const event of inner.stream(request)) {
          if (event.type === "end") {
            // The fake model answers as "mock": priced as the configured model, for a realistic figure.
            const model = event.model === "mock" ? request.model : event.model;
            charge(model, fakeUsage ?? event.usage, event.stopReason);
          }
          yield event;
        }
      } catch (error) {
        // A call that broke off midway is still charged with what the API reported.
        if (error instanceof BrainFailure && error.usage) charge(request.model, error.usage, `errore: ${error.code}`);
        throw error;
      }
    },
  };
}

/**
 * The most the run can cost: every caller turn makes the most model calls a turn allows, each
 * with the whole prompt as a cache write, the whole history as uncached input (each earlier turn
 * counted with its longest possible reply and tool rounds) and the whole output allowance.
 */
export function planRun(scenarios: readonly LiveScenario[]): RunPlan {
  const env = getVoiceEnv();
  const model = env.model;
  const maxOut = env.maxOutputTokens || DEFAULT_VOICE_MAX_OUTPUT_TOKENS;
  let upperUsd = 0;
  let callerTurns = 0;
  for (const scenario of scenarios) {
    const tenant = getVoiceTenant(scenario.tenant);
    if (!tenant) continue;
    const system = turnSystem({ tenant, state: { channel: "web", outcomes: [] }, locale: scenario.locale, now: new Date(SIM_START_MS), remainingSeconds: 900 });
    const promptTokens = Math.ceil((system.reduce((sum, block) => sum + block.text.length, 0) + JSON.stringify(turnTools(tenant)).length) / 3);
    let historyTokens = 0;
    for (const line of scenario.lines) {
      callerTurns += 1;
      const lineTokens = Math.ceil((line.length + 40) / 3);
      for (let round = 0; round < CALLS_PER_TURN; round += 1) {
        upperUsd += costUsd(model, {
          inputTokens: historyTokens + lineTokens + round * (maxOut + TOOL_ROUND_TOKENS),
          outputTokens: maxOut,
          cacheReadTokens: 0,
          cacheWriteTokens: promptTokens,
        });
      }
      historyTokens += lineTokens + CALLS_PER_TURN * maxOut + (CALLS_PER_TURN - 1) * TOOL_ROUND_TOKENS;
    }
  }
  return { scenarios: scenarios.length, callerTurns, upperUsd, model, maxOutputTokens: maxOut };
}

// ---------------------------------------------------------------------------------------------
// One scenario
// ---------------------------------------------------------------------------------------------

/** A store that remembers the last state each session saved (the end of a call removes it). */
function recordingStore(inner: KVStore, states: Map<string, VoiceSessionState>): KVStore {
  return {
    kind: inner.kind,
    incrBy: (key, by, ttl) => inner.incrBy(key, by, ttl),
    get: (key) => inner.get(key),
    async set(key, value, ttl) {
      if (key.startsWith("mva:state:")) {
        try {
          states.set(key.slice("mva:state:".length), JSON.parse(value) as VoiceSessionState);
        } catch {
          // not ours to judge
        }
      }
      return inner.set(key, value, ttl);
    },
  };
}

function post(pathname: string, body: unknown): Request {
  return new Request(`${SITE}${pathname}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

async function readEvents(response: Response): Promise<TurnStreamEvent[]> {
  const text = await response.text();
  const events: TurnStreamEvent[] = [];
  for (const frame of text.split("\n\n")) {
    const data = frame
      .split("\n")
      .filter((row) => row.startsWith("data:"))
      .map((row) => row.slice(5).trim())
      .join("\n");
    if (data) events.push(JSON.parse(data) as TurnStreamEvent);
  }
  return events;
}

/** The tool calls of the history entries after the first `seen` ones, with their results. */
function toolCallsOf(state: VoiceSessionState | undefined, seen: number): ToolCallRecord[] {
  if (!state) return [];
  const calls: ToolCallRecord[] = [];
  const byId = new Map<string, ToolCallRecord>();
  for (const turn of state.history.slice(seen)) {
    for (const message of turn.messages) {
      if (typeof message.content === "string") continue;
      for (const block of message.content) {
        if (block.type === "tool_use") {
          const call: ToolCallRecord = { id: block.id, name: block.name, input: block.input, result: null, ok: null };
          calls.push(call);
          byId.set(block.id, call);
        } else if (block.type === "tool_result") {
          const call = byId.get(block.tool_use_id);
          if (!call) continue;
          call.result = block.content;
          try {
            call.ok = (JSON.parse(block.content) as { ok?: unknown }).ok === true;
          } catch {
            call.ok = block.is_error ? false : null;
          }
        }
      }
    }
  }
  return calls;
}

function hhmm(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

interface SetupResult {
  values: Record<string, string>;
  notes: string[];
  after: () => Promise<CheckResult[]>;
}

async function prepare(scenario: LiveScenario, tenant: VoiceTenantConfig, now: number): Promise<SetupResult> {
  const today = zonedParts(new Date(now), tenant.hours.timezone).date;
  if (scenario.setup === "busy_time_tomorrow") {
    const calendar = getCalendar(tenant);
    const service = tenant.calendar?.services.find((candidate) => candidate.id === "men_cut") ?? tenant.calendar?.services[0];
    const date = addDays(today, 1);
    const weekday = weekdayOf(date);
    if (!calendar || !service || weekday === null) return { values: {}, notes: ["Preparazione non riuscita: nessun calendario."], after: async () => [] };
    const found = await calendar.findSlots({ serviceId: service.id, date, now: new Date(now) });
    const free = new Set(found.ok ? found.value.map((slot) => hhmm(zonedParts(new Date(slot.start), tenant.hours.timezone).minutes)) : []);
    let busy: string | null = null;
    for (const range of tenant.hours.weekly[weekday]) {
      const [fromH, fromM] = range.from.split(":").map(Number);
      const [toH, toM] = range.to.split(":").map(Number);
      for (let minute = fromH * 60 + fromM; minute + service.durationMinutes <= toH * 60 + toM; minute += 30) {
        if (minute >= 10 * 60 && !free.has(hhmm(minute))) {
          busy = hhmm(minute);
          break;
        }
      }
      if (busy) break;
    }
    const value = busy ?? "10:00";
    return {
      values: { BESETZT: value },
      notes: [`Orario già preso domani (${date}) nel calendario di prova per ${service.id}: ${value}${busy ? "" : " (nessun orario preso trovato: usato 10:00)"}.`],
      after: async () => [],
    };
  }
  if (scenario.setup === "restaurant_booking") {
    const restaurant = getVoiceTenant("demo-restaurant");
    const calendar = restaurant ? getCalendar(restaurant) : null;
    if (!restaurant || !calendar) return { values: {}, notes: ["Preparazione non riuscita: ristorante assente."], after: async () => [] };
    let date = addDays(today, 1);
    while (weekdayOf(date) !== "sat") date = addDays(date, 1);
    const slots = await calendar.findSlots({ serviceId: "table", date, partySize: 2, partOfDay: "evening", now: new Date(now) });
    const slot = slots.ok ? slots.value[0] : undefined;
    const request = { serviceId: "table", name: "Anna Muster", contact: "+41791234567", partySize: 2, idempotencyKey: "live-runner-setup-restaurant-0001" };
    const booked = slot ? await calendar.book({ ...request, start: slot.start, now: new Date(now) }) : null;
    if (!slot || !booked || !booked.ok) {
      return { values: { RIF_RISTORANTE: "MV-2222" }, notes: ["Preparazione: nessun tavolo prenotabile nel ristorante; usato un riferimento inesistente."], after: async () => [] };
    }
    const ref = booked.value.ref;
    return {
      values: { RIF_RISTORANTE: ref },
      notes: [`Prenotato prima della conversazione un tavolo per 2 in demo-restaurant, ${date}, riferimento ${ref}.`],
      after: async () => {
        // The same request with the same key answers with the same booking while it stands.
        const again = await calendar.book({ ...request, start: slot.start, now: new Date(now) });
        const intact = again.ok && again.value.ref === ref && again.value.status === "confirmed";
        return [
          intact
            ? { label: "Calendario del ristorante intatto dopo la conversazione", status: "superato", detail: `${ref} ancora confermato` }
            : { label: "Calendario del ristorante intatto dopo la conversazione", status: "fallito", detail: `${ref} non è più confermato` },
        ];
      },
    };
  }
  return { values: {}, notes: [], after: async () => [] };
}

function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{([A-Z_]+)\}/g, (whole, key: string) => values[key] ?? whole);
}

async function playScenario(args: {
  scenario: LiveScenario;
  mode: "dry" | "paid";
  apiKey?: string;
  meter: Meter;
  fakeUsage: UsageTokens | null;
  network: NetworkAttempt[];
}): Promise<{ record: PlayRecord; calls: ModelCallRecord[]; serverLog: string[] }> {
  const { scenario, meter } = args;
  const tenant = getVoiceTenant(scenario.tenant);
  if (!tenant) throw new Error(`Unknown tenant ${scenario.tenant}`);
  resetCalendarsForTests();

  const realStart = Date.now();
  let offset = 0;
  const clock = (): number => SIM_START_MS + (Date.now() - realStart) + offset;
  const states = new Map<string, VoiceSessionState>();
  const store = recordingStore(createMemoryStore(), states);
  const emails: CapturedEmail[] = [];
  const calls: ModelCallRecord[] = [];
  const pending: Promise<unknown>[] = [];
  let currentLine = 0;
  const sendEmail: SendEmail = async (email) => {
    emails.push({ from: email.from, to: email.to, ...(email.replyTo ? { replyTo: email.replyTo } : {}), subject: email.subject, text: email.text });
    return true;
  };
  const deps: VoiceDeps = {
    store,
    accountingStore: store,
    now: clock,
    // An e-mail service whose only sender is the memory above: the handlers render every e-mail as
    // the business would get it, and sendEmail keeps it. The key is not a key.
    resend: { apiKey: "live-runner-no-key", from: "Modolo Voice AI (prova dal vivo) <prova@example.invalid>" },
    sendEmail,
    keepAlive: (work) => {
      pending.push(work);
      return true;
    },
    model: (forTenant, locale) =>
      meteredModel({
        inner: args.mode === "paid" ? createAnthropicModel(args.apiKey ?? "") : createMockBrain({ tenant: forTenant, locale, now: clock }),
        meter,
        calls,
        fakeUsage: args.fakeUsage,
        line: () => currentLine,
      }),
  };

  const setup = await prepare(scenario, tenant, clock());
  const lines = scenario.lines.map((line) => fill(line, setup.values));
  const record: PlayRecord = {
    scenario,
    tenant,
    lines,
    values: setup.values,
    setupNotes: setup.notes,
    setupChecks: [],
    turns: [],
    outcomes: [],
    emails,
    network: args.network,
    stoppedEarly: null,
    ceilingHit: false,
  };

  // The voice log lines (ids, codes, counts, never content) are kept for the report, not printed.
  const serverLog: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...items: unknown[]) => void serverLog.push(items.map(String).join(" "));
  console.warn = (...items: unknown[]) => void serverLog.push(items.map(String).join(" "));
  try {
    const opened = await handleSessionRequest(post("/api/voice/session", { tenant: tenant.id, locale: scenario.locale, mode: "local", page: "/voice-lab", hp: "" }), deps);
    const grant = (await opened.json()) as SessionGrant | { ok: false; error: string };
    if (grant.ok !== true || grant.mode !== "local") {
      record.stoppedEarly = `La sessione non si è aperta: ${grant.ok === true ? `modo ${grant.mode}` : grant.error}`;
      return { record, calls, serverLog };
    }
    const token = grant.sessionToken;
    const secret = getVoiceEnv().sessionSecret ?? "";
    const verified = verifySessionToken(token, secret, clock());
    const sessionId = verified.ok ? verified.claims.sid : "";
    let seenHistory = 0;
    let ended = false;

    const turn = async (line: number, text: string): Promise<void> => {
      currentLine = line;
      const response = await handleTurnRequest(
        post("/api/voice/turn", line === 0 ? { sessionToken: token, opening: true, text: "", locale: scenario.locale } : { sessionToken: token, text, locale: scenario.locale }),
        deps,
      );
      const entry: TurnRecord = { line, caller: line === 0 ? null : text, reply: "", toolEvents: [], handoffs: [], toolCalls: [], error: null, ended: false };
      if (!(response.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        entry.error = `richiesta rifiutata, HTTP ${response.status} ${body.error ?? ""}`.trim();
      } else {
        for (const event of await readEvents(response)) {
          if (event.type === "delta") entry.reply += event.text;
          else if (event.type === "tool") entry.toolEvents.push(`${event.name}: ${event.status}`);
          else if (event.type === "handoff") entry.handoffs.push(JSON.stringify(event.handoff));
          else if (event.type === "error") entry.error = `evento di errore: ${event.code}`;
          else if (event.type === "done") entry.ended = event.ended;
        }
      }
      await Promise.allSettled(pending.splice(0));
      const state = states.get(sessionId);
      entry.toolCalls = toolCallsOf(state, seenHistory);
      seenHistory = state?.history.length ?? seenHistory;
      record.turns.push(entry);
      if (entry.ended) ended = true;
    };

    await turn(0, "");
    for (let index = 0; index < lines.length; index += 1) {
      if (meter.stopped !== null) {
        record.ceilingHit = true;
        record.stoppedEarly = `Fermato prima della frase ${index + 1}: ${meter.stopped}`;
        break;
      }
      if (ended) {
        record.stoppedEarly = `L'assistente ha chiuso la conversazione dopo la frase ${index}; le frasi seguenti non sono state dette.`;
        break;
      }
      offset += MS_PER_LINE;
      await turn(index + 1, lines[index]);
      if (meter.stopped !== null) record.ceilingHit = true;
    }
    if (!ended) {
      await handleEndRequest(post("/api/voice/end", { sessionToken: token, reason: "user" }), deps);
      await Promise.allSettled(pending.splice(0));
    }
    record.outcomes = (states.get(sessionId)?.outcomes ?? []) as CallSummary["outcomes"];
    record.setupChecks = await setup.after();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
  return { record, calls, serverLog };
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

export async function runLive(options: LiveRunOptions): Promise<LiveRunResult> {
  const print = options.print ?? ((line: string) => console.log(line));
  if (options.mode === "paid" && !options.apiKey) throw new Error("A paid run needs an API key.");
  const network: NetworkAttempt[] = [];
  const restoreEnv = applyRunEnv(options.mode, options.apiKey);
  let currentNetwork: NetworkAttempt[] = network;
  const restoreFetch = guardNetwork(options.mode, () => currentNetwork);
  mkdirSync(options.outDir, { recursive: true });

  const meter: Meter = { ceilingUsd: options.ceilingChf / LIVE_CHF_PER_USD, spentUsd: 0, stopped: null };
  const fakeUsage = options.mode === "dry" ? (options.fakeUsage ?? DRY_RUN_USAGE) : null;
  const reports: ScenarioReport[] = [];
  const notPlayed: string[] = [];
  const files: string[] = [];
  const startedAt = new Date();
  const model = getVoiceEnv().model;
  try {
    for (const scenario of options.scenarios) {
      if (meter.stopped !== null) {
        notPlayed.push(scenario.id);
        continue;
      }
      print(`  ${scenario.id} ${scenario.title} ...`);
      currentNetwork = [];
      const { record, calls, serverLog } = await playScenario({ scenario, mode: options.mode, apiKey: options.apiKey, meter, fakeUsage, network: currentNetwork });
      network.push(...currentNetwork);
      const tenant = record.tenant;
      const checks = runChecks(record, protectedShingles(tenant, scenario.locale, new Date(SIM_START_MS)));
      const report: ScenarioReport = { record, checks, calls, serverLog, mode: options.mode, model };
      const file = writeScenarioReport(options.outDir, report);
      files.push(file);
      reports.push(report);
      const failed = checks.filter((check) => check.status === "fallito").length;
      const costChf = usdToChf(calls.reduce((sum, call) => sum + call.costUsd, 0));
      print(`     ${checks.length - failed} controlli superati o non applicabili, ${failed} falliti, ${costChf.toFixed(4)} CHF`);
      if (meter.stopped !== null) print(`  FERMATO: ${meter.stopped}`);
    }
  } finally {
    restoreFetch();
    restoreEnv();
  }
  const indexFile = writeIndex(options.outDir, {
    reports,
    notPlayed,
    mode: options.mode,
    model,
    knownModel: priceOf(model).known,
    ceilingChf: options.ceilingChf,
    spentUsd: meter.spentUsd,
    stopped: meter.stopped,
    startedAt,
    priceSource: PRICE_SOURCE,
    fakeUsage,
  });
  files.push(indexFile);
  return { played: reports.length, notPlayed, totalUsd: meter.spentUsd, stopped: meter.stopped, files, reports };
}

/** The voice env of the run, for planRun() before the run starts (restores afterwards). */
export function withRunEnv<T>(mode: "dry" | "paid", apiKey: string | undefined, work: () => T): T {
  const restore = applyRunEnv(mode, apiKey);
  try {
    return work();
  } finally {
    restore();
  }
}
