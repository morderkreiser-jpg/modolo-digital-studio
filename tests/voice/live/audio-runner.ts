// Plays recorded callers to the OpenAI realtime model over a direct WebSocket, one session per
// scenario, with the SAME session configuration, prompt and tools the site's calls use
// (buildOpenAiSession, turnSystem with realtime, toolDefinitions) and the same tool code
// (executeTool), with sinks and calendars in memory. Nothing leaves the machine but the audio of
// the recordings, and only in a paid run.
//
//   paid run:  openOpenAiSocket(wss://<host>/v1/realtime?model=<model>) with the key;
//   dry run:   the fake session of audio-fake.ts: no socket, no key, nothing spent.
//
// A turn: the recording's chunks are appended at once, committed, and one response is asked for
// (manual turns); with --vad they are played in real time followed by silence, and the session's
// own turn detection closes the turn. Tool calls run locally, their outputs go back and the model
// answers again, until a response without a tool call; end_call ends the scenario after the
// goodbye.
//
// Money: before every response we ask for, its upper cost (BASE_INPUT_TOKENS of instructions and
// tools, the turn's audio and the scenario's history at the uncached text price, the whole output
// allowance at the audio price) is compared with what is left under the ceiling, and the response
// is not asked for when it might pass it. After every response.done its real cost is added; once
// the ceiling is reached the run stops, says so, and writes what it has.
import { mkdirSync } from "node:fs";
import { getCalendar, resetCalendarsForTests } from "@/lib/voice/calendar";
import { pickVoiceText } from "@/lib/voice/knowledge";
import { MAX_TOOL_ROUNDS, toolResultText, turnSystem } from "@/lib/voice/server/brain";
import { getVoiceEnv, resolveVoiceLimits, type OpenAiRealtimeModel, type OpenAiSettings } from "@/lib/voice/server/env";
import { openOpenAiSocket } from "@/lib/voice/server/providers/openai";
import { buildOpenAiSession, greetingInstructions, turnDetectionOf } from "@/lib/voice/server/providers/openai-session";
import type { ControlEvent, ControlSocket, OpenControlResult } from "@/lib/voice/server/providers/types";
import { addResponseUsage, addTranscriptionUsage, emptyUsage, EU_HOST_UPLIFT, REALTIME_PRICES_USD_PER_MTOK, usageCostUsd, type UsageTotals } from "@/lib/voice/server/realtime/pricing";
import { getVoiceTenant } from "@/lib/voice/tenants";
import { toolDefinitions } from "@/lib/voice/tools/definitions";
import { executeTool, createMemorySinks, type SessionCounters, type ToolContext } from "@/lib/voice/tools/execute";
import type { CallSummary, VoiceLocale, VoiceTenantConfig, VoiceToolDefinition } from "@/lib/voice/types";
import { createFakeRealtimeSocket } from "./audio-fake";
import { writeAudioIndex, writeAudioScenarioReport } from "./audio-report";
import { compareArgs, type AudioScenario, type AudioScenarioFile } from "./audio-scenarios";
import { chunkPcm, CHUNK_MS, silenceChunks, type PcmAudio } from "./audio-wav";

/** Instructions and tools of a response, in tokens, for the upper bound (errs high). */
export const BASE_INPUT_TOKENS = 12_000;
/** Audio input tokens per second of speech, for the upper bound. */
export const AUDIO_TOKENS_PER_SECOND = 10;
export const SOCKET_OPEN_TIMEOUT_MS = 10_000;
export const SESSION_CREATED_TIMEOUT_MS = 10_000;
export const SESSION_UPDATED_TIMEOUT_MS = 10_000;
export const RESPONSE_TIMEOUT_MS = 30_000;
/** How long the caller's transcription may come after the turn's last response. */
export const TRANSCRIPT_WAIT_MS = 5_000;
/** Silence after each recording with --vad: turn detection needs audio that goes on. */
export const VAD_SILENCE_MS = 1_500;
/** With --vad: a second response the session starts by itself within this time is still the turn's. */
export const VAD_SETTLE_MS = 1_500;
/** Responses of one turn at most: the answer plus the tool rounds (as the text turns, brain.ts). */
const RESPONSES_PER_TURN = MAX_TOOL_ROUNDS + 1;

/** Where the prices come from, printed before the run and written into the index. */
export const AUDIO_PRICE_SOURCE =
  "lib/voice/server/realtime/pricing.ts: prezzi di OpenAI letti il 26.11.2026 sulla pagina dei prezzi. Da rileggere prima di una prova successiva.";

export type AudioMode = "dry" | "paid";

export interface ToolCallResult {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  /** "ok", or the outcome's error code. */
  code: string;
  endCall: boolean;
}

export interface ExpectationResult {
  tool: string;
  args?: Record<string, string>;
  passed: boolean;
  detail: string;
}

export interface TurnResult {
  /** 0 = the greeting, then 1, 2, ... */
  index: number;
  /** The recording as written in the scenario file ("" for the greeting). */
  audio: string;
  seconds: number;
  commitToAudioMs: number | null;
  commitToTranscriptMs: number | null;
  callerTranscript: string | null;
  assistantTranscripts: string[];
  toolCalls: ToolCallResult[];
  expectation: ExpectationResult | null;
  responses: number;
  usage: UsageTotals;
  usdHigh: number;
  usdEst: number;
  /** The largest upper bound checked against the ceiling before a response of this turn. */
  upperUsd: number;
  notes: string[];
}

export interface AudioScenarioResult {
  id: string;
  title: string;
  tenant: string;
  locale: VoiceLocale;
  mode: AudioMode;
  model: string;
  host: string;
  vad: boolean;
  greeting: TurnResult | null;
  turns: TurnResult[];
  turnsTotal: number;
  endedByAssistant: boolean;
  stoppedEarly: string | null;
  ceilingHit: boolean;
  error: string | null;
  outcomes: CallSummary["outcomes"];
  openAiErrors: string[];
  duplicates: number;
  usage: UsageTotals;
  usdHigh: number;
  usdEst: number;
  serverLog: string[];
}

export interface AudioPlan {
  scenarios: number;
  turns: number;
  upperUsd: number;
  model: OpenAiRealtimeModel;
  host: string;
  maxOutputTokens: number;
  settings: OpenAiSettings;
  /** The session.update of the run (the instructions as of the start). */
  session: Record<string, unknown>;
}

export interface AudioRunOptions {
  mode: AudioMode;
  /** Absolute folder for the reports (checked by the caller: never inside the repository). */
  outDir: string;
  file: AudioScenarioFile;
  scenarios: readonly AudioScenario[];
  /** The decoded recordings, by resolved path. */
  audio: ReadonlyMap<string, PcmAudio>;
  model: OpenAiRealtimeModel;
  ceilingUsd: number;
  vad: boolean;
  /** Paid run only. Never printed, never written. */
  apiKey?: string;
  /** Paid run: how the socket is opened (default openOpenAiSocket). Tests pass a fake. */
  connect?: (url: string, apiKey: string) => Promise<OpenControlResult>;
  print?: (line: string) => void;
  now?: () => number;
  /** The pause between chunks with --vad (default a real timer). */
  sleep?: (ms: number) => Promise<void>;
}

export interface AudioRunResult {
  played: number;
  notPlayed: string[];
  spentUsd: number;
  stopped: string | null;
  failed: number;
  files: string[];
  results: AudioScenarioResult[];
}

// ---------------------------------------------------------------------------------------------
// Session, prices, plan
// ---------------------------------------------------------------------------------------------

/** Runs `work` with console.log/warn collected into `sink` (the voice log lines are not printed). */
function quietly<T>(sink: string[], work: () => T): T {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...items: unknown[]) => void sink.push(items.map(String).join(" "));
  console.warn = (...items: unknown[]) => void sink.push(items.map(String).join(" "));
  try {
    return work();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

/** quietly() for asynchronous work: the console is given back once `work` has settled. */
async function quietlyAsync<T>(sink: string[], work: () => Promise<T>): Promise<T> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...items: unknown[]) => void sink.push(items.map(String).join(" "));
  console.warn = (...items: unknown[]) => void sink.push(items.map(String).join(" "));
  try {
    return await work();
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

/** The site's OpenAI settings with the run's model. */
export function audioSettings(model: OpenAiRealtimeModel, sink: string[] = []): OpenAiSettings {
  return quietly(sink, () => ({ ...getVoiceEnv().openai, model }));
}

/** The instructions of a call, as call.ts builds them: the realtime prompt, blocks joined. */
export function instructionsFor(tenant: VoiceTenantConfig, locale: VoiceLocale, outcomes: CallSummary["outcomes"], now: Date, remainingSeconds: number): string {
  return turnSystem({ tenant, state: { channel: "web", outcomes }, locale, now, remainingSeconds, realtime: true })
    .map((block) => block.text)
    .join("\n\n");
}

/** The tenant's languages with the session's first, without duplicates. */
export function sessionLocales(tenant: VoiceTenantConfig, locale: VoiceLocale): VoiceLocale[] {
  return [locale, ...tenant.locales.filter((entry) => entry !== locale)];
}

/**
 * The session.update of a scenario: the websocket form (raw PCM, manual turns); with `vad` the
 * turn detection of the site's calls (env.openai.turn) instead of manual turns.
 */
export function audioSession(args: {
  settings: OpenAiSettings;
  tenant: VoiceTenantConfig;
  locale: VoiceLocale;
  instructions: string;
  tools: VoiceToolDefinition[];
  vad: boolean;
}): Record<string, unknown> {
  const input = { settings: args.settings, instructions: args.instructions, tools: args.tools, locale: args.locale, locales: sessionLocales(args.tenant, args.locale) };
  const session = buildOpenAiSession({ ...input, transport: "websocket" });
  if (args.vad) {
    // The configured turn detection of the site's calls; the PCM format stays the websocket one.
    const audio = session.audio as { input: Record<string, unknown> };
    audio.input.turn_detection = turnDetectionOf(args.settings.turn);
  }
  return session;
}

function priceOf(model: string): (typeof REALTIME_PRICES_USD_PER_MTOK)[string] {
  return REALTIME_PRICES_USD_PER_MTOK[model] ?? REALTIME_PRICES_USD_PER_MTOK["gpt-realtime-2.1"];
}

/**
 * The most one response can cost before it is asked for: instructions and tools, the turn's audio
 * and the scenario's history so far at the uncached text price, plus the whole output allowance at
 * the audio price (the dearest output). On the EU host with its uplift.
 */
export function responseUpperUsd(args: { model: string; host: string; maxOutputTokens: number; turnAudioSeconds: number; historyTokens: number }): number {
  const price = priceOf(args.model);
  const input = BASE_INPUT_TOKENS + args.turnAudioSeconds * AUDIO_TOKENS_PER_SECOND + args.historyTokens;
  const usd = (input * price.textIn) / 1e6 + (args.maxOutputTokens * price.audioOut) / 1e6;
  return args.host === "eu.api.openai.com" ? usd * EU_HOST_UPLIFT : usd;
}

function tokensOf(usage: UsageTotals): number {
  return usage.inTok + usage.inAuTok + usage.outTok + usage.outAuTok;
}

function addUsage(total: UsageTotals, part: UsageTotals): void {
  for (const key of Object.keys(total) as Array<keyof UsageTotals>) total[key] += part[key];
}

/**
 * What the run will do and cost at most: per scenario the greeting and, per turn, the answer and
 * every tool round, each response with the whole output allowance and the history grown by the
 * whole of every response before it.
 */
export function planAudioRun(args: { file: AudioScenarioFile; scenarios: readonly AudioScenario[]; audio: ReadonlyMap<string, PcmAudio>; model: OpenAiRealtimeModel; vad: boolean }): AudioPlan {
  const tenant = getVoiceTenant(args.file.tenant);
  if (!tenant) throw new Error(`Unknown tenant ${args.file.tenant}`);
  const sink: string[] = [];
  const settings = audioSettings(args.model, sink);
  const limits = quietly(sink, () => resolveVoiceLimits(tenant, getVoiceEnv()));
  const instructions = instructionsFor(tenant, args.file.locale, [], new Date(), limits.maxCallSeconds);
  const session = audioSession({ settings, tenant, locale: args.file.locale, instructions, tools: toolDefinitions(tenant, { speech: true }), vad: args.vad });
  const maxOut = settings.maxOutputTokens;
  let upperUsd = 0;
  let turns = 0;
  for (const scenario of args.scenarios) {
    let history = 0;
    const respond = (seconds: number): void => {
      upperUsd += responseUpperUsd({ model: args.model, host: settings.host, maxOutputTokens: maxOut, turnAudioSeconds: seconds, historyTokens: history });
      history += BASE_INPUT_TOKENS + seconds * AUDIO_TOKENS_PER_SECOND + maxOut;
    };
    if (scenario.greeting) respond(0);
    for (const turn of scenario.turns) {
      turns += 1;
      const seconds = args.audio.get(turn.file)?.seconds ?? 0;
      for (let round = 0; round < RESPONSES_PER_TURN; round += 1) respond(seconds);
    }
  }
  return { scenarios: args.scenarios.length, turns, upperUsd, model: args.model, host: settings.host, maxOutputTokens: maxOut, settings, session };
}

// ---------------------------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------------------------

interface Arrival {
  event: ControlEvent;
  at: number;
}

/** The socket's events in arrival order, each with the time it came; read one at a time. */
class Inbox {
  private readonly items: Arrival[] = [];
  private waiter: (() => void) | null = null;
  closedWith: number | null = null;

  // No parameter properties: Node runs this file with type stripping only.
  constructor(socket: ControlSocket, now: () => number) {
    socket.onEvent((event) => {
      this.items.push({ event, at: now() });
      this.wake();
    });
    socket.onClose(({ code }) => {
      this.closedWith = code;
      this.wake();
    });
  }

  private wake(): void {
    const waiter = this.waiter;
    this.waiter = null;
    waiter?.();
  }

  /** The next event; "closed" once the socket closed and nothing is left; null after `timeoutMs`. */
  async next(timeoutMs: number): Promise<Arrival | "closed" | null> {
    const until = Date.now() + Math.max(0, timeoutMs);
    for (;;) {
      const item = this.items.shift();
      if (item) return item;
      if (this.closedWith !== null) return "closed";
      const left = until - Date.now();
      if (left <= 0) return null;
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          this.waiter = null;
          resolve();
        }, left);
        this.waiter = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    }
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function emptyTurn(index: number, audio: string, seconds: number): TurnResult {
  return {
    index,
    audio,
    seconds,
    commitToAudioMs: null,
    commitToTranscriptMs: null,
    callerTranscript: null,
    assistantTranscripts: [],
    toolCalls: [],
    expectation: null,
    responses: 0,
    usage: emptyUsage(),
    usdHigh: 0,
    usdEst: 0,
    upperUsd: 0,
    notes: [],
  };
}

interface Meter {
  ceilingUsd: number;
  spentUsd: number;
  stopped: string | null;
}

function usd(value: number): string {
  return value.toFixed(4);
}

// ---------------------------------------------------------------------------------------------
// One scenario
// ---------------------------------------------------------------------------------------------

interface PlayArgs {
  scenario: AudioScenario;
  file: AudioScenarioFile;
  tenant: VoiceTenantConfig;
  audio: ReadonlyMap<string, PcmAudio>;
  mode: AudioMode;
  model: OpenAiRealtimeModel;
  settings: OpenAiSettings;
  vad: boolean;
  meter: Meter;
  open: (url: string) => Promise<OpenControlResult>;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

async function playScenario(args: PlayArgs): Promise<AudioScenarioResult> {
  const { scenario, tenant, settings, meter, now } = args;
  const locale = args.file.locale;
  const result: AudioScenarioResult = {
    id: scenario.id,
    title: scenario.title,
    tenant: tenant.id,
    locale,
    mode: args.mode,
    model: args.model,
    host: settings.host,
    vad: args.vad,
    greeting: null,
    turns: [],
    turnsTotal: scenario.turns.length,
    endedByAssistant: false,
    stoppedEarly: null,
    ceilingHit: false,
    error: null,
    outcomes: [],
    openAiErrors: [],
    duplicates: 0,
    usage: emptyUsage(),
    usdHigh: 0,
    usdEst: 0,
    serverLog: [],
  };
  resetCalendarsForTests();
  const limits = quietly(result.serverLog, () => resolveVoiceLimits(tenant, getVoiceEnv()));
  const tools = toolDefinitions(tenant, { speech: true });
  const counters: SessionCounters = { toolCalls: 0, bookings: 0, leads: 0 };
  const calendar = getCalendar(tenant);
  const sinks = createMemorySinks();
  const instructions = (): string => instructionsFor(tenant, locale, result.outcomes, new Date(now()), limits.maxCallSeconds);
  const toolContext = (): ToolContext => ({
    tenant,
    sessionId: `audio-${scenario.id}`,
    locale,
    channel: "web",
    now: new Date(now()),
    limits,
    counters,
    calendar,
    sinks,
    speech: true,
    record: (outcome) => {
      result.outcomes.push(outcome);
    },
  });

  const opened = await args.open(`wss://${settings.host}/v1/realtime?model=${args.model}`);
  if (!opened.ok) {
    result.error = `La connessione a OpenAI non si è aperta (${opened.code}).`;
    return result;
  }
  const socket = opened.socket;
  const inbox = new Inbox(socket, now);
  const seenResponses = new Set<string>();
  const itemTurn = new Map<string, TurnResult>();
  /** When each turn's audio was committed (by us, or by the session's turn detection). */
  const commitAt = new Map<TurnResult, number>();
  let committing: TurnResult | null = null;
  let historyTokens = 0;
  let endRequested = false;

  const send = (event: ControlEvent): boolean => {
    if (socket.send(event)) return true;
    result.error ??= "La connessione a OpenAI si è chiusa: evento non inviato.";
    return false;
  };

  const charge = (turn: TurnResult, part: UsageTotals, transcribeModel: string | null): void => {
    const cost = usageCostUsd(args.model, part, transcribeModel, settings.host);
    addUsage(turn.usage, part);
    addUsage(result.usage, part);
    turn.usdHigh += cost.usdHigh;
    turn.usdEst += cost.usdEst;
    result.usdHigh += cost.usdHigh;
    result.usdEst += cost.usdEst;
    // The ceiling is held against the upper figure: it errs high.
    meter.spentUsd += cost.usdHigh;
    if (meter.spentUsd >= meter.ceilingUsd && meter.stopped === null) {
      meter.stopped = `Tetto di spesa raggiunto: spesi ${usd(meter.spentUsd)} USD, tetto ${usd(meter.ceilingUsd)} USD.`;
    }
  };

  /** Everything that is not tied to the response being waited for. */
  const observe = ({ event, at }: Arrival): void => {
    const type = text(event.type);
    if (type === "error") {
      const error = record(event.error);
      const code = text(error?.code) || text(error?.type) || "sconosciuto";
      result.openAiErrors.push(/^[A-Za-z0-9_.:-]{1,80}$/.test(code) ? code : "altro");
    } else if (type === "input_audio_buffer.committed") {
      const turn = committing;
      const itemId = text(event.item_id);
      if (turn && itemId) {
        itemTurn.set(itemId, turn);
        // With turn detection the session commits: the turn's clock starts here.
        if (args.vad && !commitAt.has(turn)) commitAt.set(turn, at);
      }
    } else if (type === "conversation.item.input_audio_transcription.completed") {
      const turn = itemTurn.get(text(event.item_id));
      if (!turn) return;
      turn.callerTranscript = (turn.callerTranscript ? `${turn.callerTranscript} ` : "") + text(event.transcript).trim();
      const started = commitAt.get(turn);
      if (started !== undefined && turn.commitToTranscriptMs === null) turn.commitToTranscriptMs = at - started;
      // Billed in seconds ({type: "duration"}) or in tokens ({type: "tokens"}), as the call controller counts it.
      const part = emptyUsage();
      addTranscriptionUsage(part, event.usage);
      if (part.transcribeSec + part.transcribeInTok + part.transcribeOutTok > 0) charge(turn, part, settings.transcribe);
    } else if (type === "conversation.item.input_audio_transcription.failed") {
      const turn = itemTurn.get(text(event.item_id));
      if (turn) {
        turn.notes.push("trascrizione del chiamante non riuscita");
        turn.callerTranscript ??= "";
      }
    }
  };

  /** Reads events until `done` holds; false after `timeoutMs` or when the socket closed. */
  const pumpUntil = async (done: (arrival: Arrival) => boolean, timeoutMs: number): Promise<Arrival | null> => {
    const until = Date.now() + timeoutMs;
    for (;;) {
      const item = await inbox.next(until - Date.now());
      if (item === null) return null;
      if (item === "closed") {
        result.error ??= `La connessione a OpenAI si è chiusa (codice ${inbox.closedWith}).`;
        return null;
      }
      observe(item);
      if (done(item)) return item;
    }
  };

  interface FunctionCall {
    callId: string;
    name: string;
    arguments: string;
  }

  /** Waits for the next response.done we have not counted; records what the response said and did. */
  const awaitResponse = async (turn: TurnResult): Promise<{ calls: FunctionCall[] } | null> => {
    const calls: FunctionCall[] = [];
    const until = Date.now() + RESPONSE_TIMEOUT_MS;
    for (;;) {
      const item = await inbox.next(until - Date.now());
      if (item === null) {
        result.error ??= `Nessuna risposta completa di OpenAI entro ${RESPONSE_TIMEOUT_MS / 1000} s.`;
        return null;
      }
      if (item === "closed") {
        result.error ??= `La connessione a OpenAI si è chiusa (codice ${inbox.closedWith}).`;
        return null;
      }
      observe(item);
      const { event, at } = item;
      const type = text(event.type);
      if (type === "response.output_audio.delta") {
        const started = commitAt.get(turn);
        if (started !== undefined && turn.commitToAudioMs === null) turn.commitToAudioMs = at - started;
      } else if (type === "response.output_audio_transcript.done") {
        const said = text(event.transcript).trim();
        if (said) turn.assistantTranscripts.push(said);
      } else if (type === "response.function_call_arguments.done") {
        const callId = text(event.call_id);
        if (callId && !calls.some((call) => call.callId === callId)) calls.push({ callId, name: text(event.name), arguments: text(event.arguments) });
      } else if (type === "response.done") {
        const response = record(event.response);
        const id = text(response?.id);
        if (id && seenResponses.has(id)) {
          result.duplicates += 1;
          continue;
        }
        if (id) seenResponses.add(id);
        turn.responses += 1;
        const part = emptyUsage();
        addResponseUsage(part, response?.usage);
        historyTokens += tokensOf(part);
        charge(turn, part, null);
        // A call the argument events did not show is still in the response's output.
        for (const output of Array.isArray(response?.output) ? response.output : []) {
          const entry = record(output);
          if (entry?.type !== "function_call") continue;
          const callId = text(entry.call_id);
          if (callId && !calls.some((call) => call.callId === callId)) calls.push({ callId, name: text(entry.name), arguments: text(entry.arguments) });
        }
        const status = text(response?.status);
        if (status && status !== "completed") turn.notes.push(`risposta con stato ${status}`);
        return { calls };
      }
    }
  };

  /** Asks for one response, unless it could pass the ceiling. */
  const respond = async (turn: TurnResult, create: ControlEvent): Promise<{ calls: FunctionCall[] } | null> => {
    if (!admit(turn)) return null;
    if (!send(create)) return null;
    return awaitResponse(turn);
  };

  /** The ceiling check before a response: false (and the run stops) when it could pass it. */
  const admit = (turn: TurnResult): boolean => {
    if (meter.stopped !== null) return false;
    const upper = responseUpperUsd({ model: args.model, host: settings.host, maxOutputTokens: settings.maxOutputTokens, turnAudioSeconds: turn.seconds, historyTokens });
    turn.upperUsd = Math.max(turn.upperUsd, upper);
    if (meter.spentUsd + upper > meter.ceilingUsd) {
      meter.stopped = `Tetto di spesa: la risposta successiva poteva costare fino a ${usd(upper)} USD e avrebbe potuto superare il tetto (spesi ${usd(meter.spentUsd)} USD di ${usd(meter.ceilingUsd)}). Risposta non chiesta.`;
      result.ceilingHit = true;
      return false;
    }
    return true;
  };

  /** Runs the response's tool calls, sends their outputs; true when one asked to end the call. */
  const runTools = async (turn: TurnResult, calls: FunctionCall[]): Promise<boolean> => {
    let changed = false;
    let end = false;
    for (const call of calls) {
      let input: Record<string, unknown> = {};
      try {
        input = record(JSON.parse(call.arguments)) ?? {};
      } catch {
        turn.notes.push(`argomenti di ${call.name} non leggibili`);
      }
      const outcome = await quietlyAsync(result.serverLog, () => executeTool(toolContext(), { id: call.callId, name: call.name, input }));
      turn.toolCalls.push({
        callId: call.callId,
        name: call.name,
        args: input,
        ok: outcome.ok,
        code: outcome.ok ? "ok" : outcome.code,
        endCall: outcome.ok && outcome.endCall === true,
      });
      if (outcome.ok && outcome.endCall) end = true;
      else if (outcome.ok) changed = true;
      send({ type: "conversation.item.create", item: { type: "function_call_output", call_id: call.callId, output: toolResultText(outcome) } });
    }
    // As the site's calls do: the instructions learn what was done (their echo is not waited for).
    if (changed) send({ type: "session.update", session: { type: "realtime", instructions: instructions() } });
    return end;
  };

  /** The rest of a turn after its first response: tool rounds until a response without a call. */
  const finishTurn = async (turn: TurnResult, first: { calls: FunctionCall[] } | null): Promise<void> => {
    let response = first;
    let rounds = 0;
    while (response && response.calls.length > 0) {
      rounds += 1;
      if (rounds > MAX_TOOL_ROUNDS) {
        turn.notes.push(`più di ${MAX_TOOL_ROUNDS} giri di strumenti di fila: fermato qui`);
        break;
      }
      if (await runTools(turn, response.calls)) endRequested = true;
      response = await respond(turn, { type: "response.create" });
      if (endRequested && response) {
        // That response was the goodbye.
        result.endedByAssistant = true;
        break;
      }
    }
  };

  try {
    const created = await pumpUntil(({ event }) => event.type === "session.created" || event.type === "error", SESSION_CREATED_TIMEOUT_MS);
    if (created === null || created.event.type !== "session.created") {
      result.error ??= `OpenAI non ha aperto la sessione entro ${SESSION_CREATED_TIMEOUT_MS / 1000} s.`;
      return result;
    }
    const session = audioSession({ settings, tenant, locale, instructions: instructions(), tools, vad: args.vad });
    if (!send({ type: "session.update", session })) return result;
    const updated = await pumpUntil(({ event }) => event.type === "session.updated" || event.type === "error", SESSION_UPDATED_TIMEOUT_MS);
    if (updated === null || updated.event.type !== "session.updated") {
      result.error ??= `OpenAI non ha accettato la configurazione della sessione${updated ? ` (${result.openAiErrors[result.openAiErrors.length - 1]})` : ""}.`;
      return result;
    }

    const greeting = pickVoiceText(tenant.greeting, locale, tenant.defaultLocale).trim();
    if (scenario.greeting && greeting) {
      const turn = emptyTurn(0, "", 0);
      result.greeting = turn;
      await respond(turn, { type: "response.create", response: { instructions: greetingInstructions(greeting, locale) } });
    }

    for (let index = 0; index < scenario.turns.length; index += 1) {
      if (result.error !== null) break;
      if (meter.stopped !== null) {
        result.ceilingHit = true;
        result.stoppedEarly = `Fermato prima della frase ${index + 1}: ${meter.stopped}`;
        break;
      }
      if (result.endedByAssistant) {
        result.stoppedEarly = `L'assistente ha chiuso la conversazione dopo la frase ${index}; le frasi seguenti non sono state fatte sentire.`;
        break;
      }
      const spec = scenario.turns[index];
      const pcm = args.audio.get(spec.file);
      const turn = emptyTurn(index + 1, spec.audio, pcm?.seconds ?? 0);
      result.turns.push(turn);
      if (!pcm) {
        turn.notes.push("registrazione non caricata");
        continue;
      }
      committing = turn;
      const chunks = chunkPcm(pcm.pcm);
      if (!args.vad) {
        for (const chunk of chunks) if (!send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") })) break;
        if (!send({ type: "input_audio_buffer.commit" })) break;
        commitAt.set(turn, now());
        await finishTurn(turn, await respond(turn, { type: "response.create" }));
      } else {
        // The session answers by itself: the ceiling is checked before the audio is played.
        if (!admit(turn)) continue;
        for (const chunk of [...chunks, ...silenceChunks(VAD_SILENCE_MS)]) {
          if (!send({ type: "input_audio_buffer.append", audio: chunk.toString("base64") })) break;
          await args.sleep(CHUNK_MS);
        }
        await finishTurn(turn, await awaitResponse(turn));
        // Turn detection may have split the turn: a response the session starts soon after is still
        // this turn's, unless the ceiling has been reached.
        while (result.error === null && !result.endedByAssistant && meter.stopped === null) {
          const more = await pumpUntil(({ event }) => event.type === "response.created", VAD_SETTLE_MS);
          if (more === null) break;
          turn.notes.push("la sessione ha dato un'altra risposta alla stessa frase");
          await finishTurn(turn, await awaitResponse(turn));
        }
        if (meter.stopped !== null) {
          // The session would go on answering the audio already sent: no further response is
          // taken, and closing the socket ends them on the server.
          socket.close(1000);
          turn.expectation = judge(spec.expect, turn.toolCalls);
          result.ceilingHit = true;
          break;
        }
      }
      if (turn.callerTranscript === null && result.error === null) {
        await pumpUntil(() => turn.callerTranscript !== null, TRANSCRIPT_WAIT_MS);
        if (turn.callerTranscript === null) turn.notes.push(`trascrizione del chiamante non arrivata entro ${TRANSCRIPT_WAIT_MS / 1000} s`);
      }
      turn.expectation = judge(spec.expect, turn.toolCalls);
      if (meter.stopped !== null) result.ceilingHit = true;
    }
  } catch (error) {
    // Our own code only: the key is never part of a message.
    result.error ??= `Errore: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
  } finally {
    socket.close(1000);
  }
  if (result.ceilingHit && result.stoppedEarly === null && meter.stopped !== null) result.stoppedEarly = meter.stopped;
  return result;
}

/** The turn's expectation against its tool calls. */
export function judge(expect: AudioScenario["turns"][number]["expect"], calls: readonly ToolCallResult[]): ExpectationResult | null {
  if (!expect) return null;
  const base = { tool: expect.tool, ...(expect.args ? { args: expect.args } : {}) };
  const same = calls.filter((call) => call.name === expect.tool);
  if (same.length === 0) {
    const names = calls.map((call) => call.name);
    return { ...base, passed: false, detail: names.length === 0 ? `nessuno strumento chiamato (atteso ${expect.tool})` : `chiamato ${names.join(", ")} invece di ${expect.tool}` };
  }
  if (!expect.args) return { ...base, passed: true, detail: `${expect.tool} chiamato` };
  const compared = same.map((call) => compareArgs(expect.args ?? {}, call.args));
  if (compared.some((entry) => entry.ok)) return { ...base, passed: true, detail: `${expect.tool} chiamato con gli argomenti attesi` };
  return { ...base, passed: false, detail: compared[0].differences.join("; ") };
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

export async function runAudio(options: AudioRunOptions): Promise<AudioRunResult> {
  const print = options.print ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  if (options.mode === "paid" && !options.apiKey) throw new Error("A paid run needs an API key.");
  const tenant = getVoiceTenant(options.file.tenant);
  if (!tenant) throw new Error(`Unknown tenant ${options.file.tenant}`);
  mkdirSync(options.outDir, { recursive: true });

  const settings = audioSettings(options.model);
  const meter: Meter = { ceilingUsd: options.ceilingUsd, spentUsd: 0, stopped: null };
  const results: AudioScenarioResult[] = [];
  const notPlayed: string[] = [];
  const files: string[] = [];
  const startedAt = new Date();
  const tools = toolDefinitions(tenant, { speech: true });

  for (const scenario of options.scenarios) {
    if (meter.stopped !== null) {
      notPlayed.push(scenario.id);
      continue;
    }
    print(`  ${scenario.id} ${scenario.title} ...`);
    const open =
      options.mode === "dry"
        ? async (): Promise<OpenControlResult> => ({ ok: true, socket: createFakeRealtimeSocket({ expectations: scenario.turns.map((turn) => turn.expect), tools }) })
        : (url: string): Promise<OpenControlResult> => {
            const key = options.apiKey ?? "";
            return options.connect ? options.connect(url, key) : openOpenAiSocket(url, key, { timeoutMs: SOCKET_OPEN_TIMEOUT_MS });
          };
    const result = await playScenario({
      scenario,
      file: options.file,
      tenant,
      audio: options.audio,
      mode: options.mode,
      model: options.model,
      settings,
      vad: options.vad,
      meter,
      open,
      now,
      sleep,
    });
    results.push(result);
    files.push(...writeAudioScenarioReport(options.outDir, result));
    const expected = result.turns.filter((turn) => turn.expectation !== null);
    const passed = expected.filter((turn) => turn.expectation?.passed).length;
    print(`     ${result.turns.length} di ${result.turnsTotal} frasi, attese rispettate ${passed} di ${expected.length}, ${usd(result.usdHigh)} USD${options.mode === "dry" ? " (finti)" : ""}`);
    if (result.error) print(`     ERRORE: ${result.error}`);
    if (meter.stopped !== null) print(`  FERMATO: ${meter.stopped}`);
  }

  files.push(
    writeAudioIndex(options.outDir, {
      results,
      notPlayed,
      mode: options.mode,
      model: options.model,
      host: settings.host,
      vad: options.vad,
      ceilingUsd: options.ceilingUsd,
      spentUsd: meter.spentUsd,
      stopped: meter.stopped,
      startedAt,
      priceSource: AUDIO_PRICE_SOURCE,
    }),
  );
  return { played: results.length, notPlayed, spentUsd: meter.spentUsd, stopped: meter.stopped, failed: results.filter((entry) => entry.error !== null).length, files, results };
}
