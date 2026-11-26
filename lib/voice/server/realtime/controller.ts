// The controller of one realtime call ("call" kind): a state machine over the provider's control
// connection. Server-only, and pure in the sense that matters here: it imports nothing from
// next/*, the routes, the session or the limits code, and no store. Everything it needs (the
// socket, the hang-up, the polls of the store, the charge, the tools, the browser stream, the log,
// the clock) comes in through its options, so the same controller can drive a phone call later
// and the tests can drive it with fakes and a fake clock.
//
// WHAT IT GUARANTEES
//
//   1. A paid call never runs unsupervised: the absolute deadline is armed at the very start, in
//      every state, whether or not the socket opens, the greeting goes out or the browser speaks.
//      The silence backstop, the response cap and the cost cap are armed with it.
//   2. The end runs once (whatever fires first, every later trigger is ignored), always in the
//      same order, each step on its own: tell the browser, stop every timer and poll, (goodbye
//      only) the tail, hang up through the REST hook, close the socket. A failing step never skips
//      the next one, and the hang-up is always called. A hang-up that fails is tried twice more in
//      the background (report.hangUpDone); the report itself does not wait for those retries.
//   3. It never throws and never rejects: a malformed event is ignored, a handler that throws ends
//      the call with "error". A tool still running at the end is not waited for here: it is
//      handed back as report.toolDone, so the caller can drain it before settling.
//   4. Nothing personal leaves it except towards the visitor's own browser (captions): the log
//      lines carry codes and numbers only; no transcript is stored or logged.
//
// The caller (lib/voice/server/call.ts) then drains the tool, settles the measured seconds,
// clears the call id, finishes the session and writes the call_end line.
import type { ControlEvent, ControlSocket, ControllerClock, OpenControlResult } from "@/lib/voice/server/providers/types";
import {
  isVoiceLocale,
  isVoiceToolName,
  type CallStreamEvent,
  type HandoffNotice,
  type ToolCall,
  type ToolOutcome,
  type VoiceLimits,
  type VoiceLocale,
  type VoiceToolName,
} from "@/lib/voice/types";
import { addResponseUsage, addTranscriptionUsage, emptyUsage, usageCostUsd, type UsageTotals } from "./pricing";

export const CONTROL_OPEN_TIMEOUT_MS = 5_000;
export const READBACK_TIMEOUT_MS = 3_000;
export const READY_FALLBACK_MS = 4_000; // greet anyway after about 4 s
export const READY_POLL_MS = 250; // until ready or the greeting
export const READY_LATE_POLL_MS = 1_000; // after a fallback greeting, until ready
export const READY_POLL_STOP_MS = 15_000; // after answerAt: no ready polls any more
export const CLOSED_POLL_MS = 2_000; // the end route hangs up by itself: this poll is the second line
export const GREETING_GUARD_MS = 8_000; // greeting sent → no audio and no response.done
export const GOODBYE_GUARD_MS = 10_000; // re-armed while audio still plays...
export const GOODBYE_CEILING_MS = 30_000; // ...up to this long after the goodbye's response.create
export const GOODBYE_TAIL_MS = 400;
export const CREATE_ANSWER_MS = 8_000; // our response.create with neither response.created nor error: refused
export const HANGUP_RETRY_DELAY_MS = 1_000; // a failed hang-up is tried twice more, this far apart
export const TOOL_DRAIN_MS = 13_000; // ≥ TOOL_LOCK_WAIT_MS + EMAIL_TIMEOUT_MS + 2 000
export const RESEND_DELAY_MS = 250; // a refused response.create with no active response
export const SILENCE_GRACE_SECONDS = 20;
export const SILENCE_BACKSTOP_MIN_SECONDS = 90;
export const CAPTION_THROTTLE_MS = 120; // assistant interim captions at most this often per line
export const CALLER_HOLD_MS = 3_000; // a caller line waiting for an earlier one
export const MAX_OPENAI_ERRORS = 20;

/** The provider's own hang-up is bounded at this; the controller does not wait longer either. */
const HANGUP_WAIT_MS = 3_000;
const HANGUP_RETRIES = 2;
/** The fresh closed check after the socket closed (and before the greeting). */
const FRESH_CLOSED_CHECK_MS = 1_000;
const ASSISTANT_CAPTION_CHARS = 2_000;
const MAX_TOOL_CALL_ID_CHARS = 200;
const CUT_MARK = " …";
/** What a log line may carry as a string value (the pattern of lib/voice/server/log.ts). */
const LOG_VALUE_RE = /^[A-Za-z0-9_.:-]+$/;
const LOG_VALUE_MAX = 64;
/** What the model hears when a tool hook failed in a way it should not have. */
const TOOL_UNAVAILABLE: ToolOutcome = {
  ok: false,
  code: "unavailable",
  say: "The action could not be done right now. Say so plainly and offer to try once more.",
};

export interface CallControllerOptions {
  tenantId: string;
  locale: VoiceLocale;
  /** The whole response.instructions of the greeting (call.ts builds it with greetingInstructions). */
  greetingText: string;
  expected: { instructionsChars: number; toolCount: number };
  limits: Pick<VoiceLimits, "warnBeforeEndSeconds" | "silenceTimeoutSeconds" | "maxTurnChars">;
  answerAt: number;
  deadlineAt: number;
  maxResponses: number;
  maxCallUsd: number;
  model: string;
  host: string;
  transcribeModel: string | null;
  clock: ControllerClock;
  signal: AbortSignal;
  openControl(): Promise<OpenControlResult>;
  /** `skipped`: somebody else already hung the call up; counts as ok. */
  hangUp(): Promise<HangUpResult>;
  pollReady(): Promise<boolean>;
  pollClosed(): Promise<boolean>;
  confirm(): Promise<void>;
  runTool(call: ToolCall): Promise<ToolOutcome>;
  instructionsAt(remainingSeconds: number): string;
  toolOutput(outcome: ToolOutcome): string;
  handoffOf(name: VoiceToolName, outcome: ToolOutcome): HandoffNotice | null;
  emit(event: CallStreamEvent): void;
  log(fields: Record<string, unknown>): void;
}

export interface HangUpResult {
  ok: boolean;
  httpStatus?: number;
  skipped?: boolean;
}

export type ControllerEndReason =
  | "assistant"
  | "timeout"
  | "silence"
  | "user"
  | "unload"
  | "provider"
  | "control"
  | "tripwire"
  | "limit"
  | "error";

export interface CallEndReport {
  reason: ControllerEndReason;
  confirmedAt: number | null;
  endedAt: number;
  usage: UsageTotals; // pricing.ts
  usd: { usdHigh: number; usdEst: number };
  responses: number;
  foreign: number;
  turns: number;
  tools: number;
  errors: number;
  duplicates: number;
  greetings: number;
  sidebandMs: number;
  readyMs: number;
  greetMs: number;
  minTokLeft: number;
  tripwire: string | null;
  /** Resolves when the tool running at the end has finished (or at once). call.ts awaits it with TOOL_DRAIN_MS. */
  toolDone: Promise<void>;
  /** The first hang-up attempt succeeded (or was skipped because somebody else hung up). */
  hangUpOk: boolean;
  /**
   * Resolves true once a hang-up attempt succeeded, false when the last retry failed too (at once
   * when the first attempt succeeded). Never rejects.
   */
  hangUpDone: Promise<boolean>;
}

type CaptionEvent = Extract<CallStreamEvent, { type: "caption" }>;

type Phase = "opening" | "waiting" | "greeting" | "live" | "goodbye" | "ending" | "ended";

/** A response.create of ours, sent or waiting for the active response to finish. */
interface CreateEntry {
  response?: Record<string, unknown>;
  greeting: boolean;
  goodbye: boolean;
  /** Refused once already: a second refusal gives up on it. */
  retried: boolean;
}

interface ToolEntry {
  responseId: string;
  call: ToolCall;
  outcome: ToolOutcome | null;
}

/** The function calls of one response: their outputs go out together once all ran and it is done. */
interface ToolRound {
  entries: ToolEntry[];
  done: boolean;
}

interface CallerLine {
  itemId: string;
  id: string;
  text: string;
  /** Text of the last frame sent (null: nothing sent yet). */
  sentText: string | null;
  done: boolean;
  finalSent: boolean;
  dropped: boolean;
  /** Waited CALLER_HOLD_MS for an earlier line: may be sent out of order. */
  released: boolean;
  before?: string;
  locale?: VoiceLocale;
  holdTimer: unknown;
}

interface AssistantLine {
  id: string;
  /** The response the line belongs to (from its delta or done event). */
  responseId: string | null;
  text: string;
  sent: boolean;
  closed: boolean;
  /** Already sent with the cut mark: a barge-in marks a line once. */
  cut: boolean;
  lastSentAt: number;
  timer: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function cap(text: string, max: number): string {
  return text.length > max ? text.slice(0, Math.max(0, max)) : text;
}

function logValue(value: string | null): string {
  return value !== null && value.length <= LOG_VALUE_MAX && LOG_VALUE_RE.test(value) ? value : "other";
}

function errorName(error: unknown): string {
  const name = error instanceof Error ? error.name : null;
  return name !== null && name.length <= LOG_VALUE_MAX && LOG_VALUE_RE.test(name) ? name : "Error";
}

function isOutcome(value: unknown): value is ToolOutcome {
  const v = record(value);
  return v !== null && typeof v.ok === "boolean" && typeof v.say === "string";
}

/**
 * Runs one realtime call from the open answer to the hang-up. Resolves after the end sequence's
 * steps (a)-(e); never rejects.
 */
export function runCallController(options: CallControllerOptions): Promise<CallEndReport> {
  return new Promise<CallEndReport>((resolve) => {
    const { clock } = options;
    const now = (): number => {
      try {
        return finite(clock.now(), Date.now());
      } catch {
        return Date.now();
      }
    };

    let phase: Phase = "opening";
    let ending = false;
    let reason: ControllerEndReason = "error";
    let endedAt = 0;
    let socket: ControlSocket | null = null;
    let eventSeq = 0;

    // Counts and timings of the report.
    const usage = emptyUsage();
    let responses = 0;
    let foreign = 0;
    let turns = 0;
    let tools = 0;
    let errors = 0;
    let duplicates = 0;
    let greetings = 0;
    let sidebandMs = -1;
    let readyMs = -1;
    let greetMs = -1;
    let minTokLeft = -1;
    let tripwireCode: string | null = null;
    let confirmedAt: number | null = null;
    let confirmation: Promise<void> | null = null;

    // Session updates and the read-back.
    let pendingUpdates = 0;
    const ourUpdates = new Set<string>();
    let readbackChecked = false;
    let readbackOk = false;
    let readbackTimer: unknown = null;

    // Readiness and the greeting.
    let readySeen = false;
    let fallbackDue = false;
    let greetStarted = false;
    /** A response came before our greeting (the caller spoke first): no greeting at all. */
    let greetingSkipped = false;
    let greetingSentAt: number | null = null;
    let greetingByFallback = false;
    let lastGreetingAt = 0;
    let awaitingGreetingId = false;
    let greetingResponseId: string | null = null;
    let greetingAudio = false;
    let greetingLost = false;
    let greetingTimer: unknown = null;

    // Responses, audio and our response.create events.
    let responseActive: string | null = null;
    /** Our response.create sent, its response.created not seen yet. */
    let inFlight: string | null = null;
    const createQueue: CreateEntry[] = [];
    const ourCreates = new Map<string, CreateEntry>();
    const countedResponses = new Set<string>();
    let anonymousResponses = 0;
    let audioPlaying: string | null = null;

    // Tools and the goodbye.
    const toolQueue: ToolEntry[] = [];
    const rounds = new Map<string, ToolRound>();
    const seenToolCalls = new Set<string>();
    let running: Promise<void> | null = null;
    let endRequested = false;
    let goodbyeArmed = false;
    let awaitingGoodbyeId = false;
    let goodbyeResponseId: string | null = null;
    let goodbyeAudio = false;
    let goodbyeCreatedAt = 0;

    /** Between the caller's speech_started and speech_stopped. */
    let speechActive = false;

    // Captions.
    const callerLines: CallerLine[] = [];
    let callerSeq = 0;
    const assistantLines = new Map<string, AssistantLine>();
    let assistantSeq = 0;

    // Polls, timers, logs.
    let readyPending = false;
    let closedPending = false;
    let silenceTimer: unknown = null;
    const timers = new Set<unknown>();
    const loggedSteps = new Set<string>();
    const loggedErrorCodes = new Set<string>();

    const silenceMs =
      Math.max(finite(options.limits.silenceTimeoutSeconds, 0) + SILENCE_GRACE_SECONDS, SILENCE_BACKSTOP_MIN_SECONDS) * 1000;
    const maxTurnChars = Math.max(1, finite(options.limits.maxTurnChars, ASSISTANT_CAPTION_CHARS));

    // -------------------------------------------------------------------------------------------
    // Small helpers
    // -------------------------------------------------------------------------------------------

    function log(fields: Record<string, unknown>): void {
      try {
        options.log({ ...fields, tenant: options.tenantId });
      } catch {
        // A log line is never worth a call.
      }
    }

    function logStep(kind: string, error: unknown): void {
      if (loggedSteps.has(kind)) return;
      loggedSteps.add(kind);
      log({ warn: "call_step_failed", kind, errorName: errorName(error) });
    }

    function emit(event: CallStreamEvent): void {
      if (ending) return;
      try {
        options.emit(event);
      } catch {
        // The stream is gone; the abort signal or the deadline ends the call.
      }
    }

    /** "listening" is never sent while the caller is speaking: the browser would count silence. */
    function emitListening(): void {
      if (!speechActive) emit({ type: "status", status: "listening" });
    }

    /** A timer of the call: skipped once the call ends, cleared with every other one at the end. */
    function later(ms: number, fn: () => void): unknown {
      const handle: unknown = clock.setTimeout(() => {
        timers.delete(handle);
        if (ending) return;
        guard(fn);
      }, Math.max(0, ms));
      timers.add(handle);
      return handle;
    }

    function cancel(handle: unknown): void {
      if (handle === null || handle === undefined) return;
      timers.delete(handle);
      try {
        clock.clearTimeout(handle);
      } catch {
        // Nothing to clear.
      }
    }

    /** Runs a handler; anything it throws ends the call with "error". */
    function guard(fn: () => void): void {
      try {
        fn();
      } catch {
        end("error");
      }
    }

    /** Resolves with the promise's value, or with `fallback` after `ms` or on a rejection. */
    function bounded<T>(work: () => Promise<T>, ms: number, fallback: T): Promise<T> {
      return new Promise<T>((done) => {
        let settled = false;
        let handle: unknown = null;
        const settle = (value: T) => {
          if (settled) return;
          settled = true;
          if (handle !== null) {
            try {
              clock.clearTimeout(handle);
            } catch {
              // Already fired.
            }
          }
          done(value);
        };
        try {
          handle = clock.setTimeout(() => settle(fallback), ms);
        } catch {
          // Without a timer the work's own bound applies.
        }
        try {
          work().then(settle, () => settle(fallback));
        } catch {
          settle(fallback);
        }
      });
    }

    function sleep(ms: number): Promise<void> {
      return new Promise<void>((done) => {
        try {
          clock.setTimeout(done, ms);
        } catch {
          done();
        }
      });
    }

    async function safePoll(poll: () => Promise<boolean>): Promise<boolean> {
      try {
        return (await poll()) === true;
      } catch (error) {
        logStep("poll", error);
        return false;
      }
    }

    function freshClosed(): Promise<boolean> {
      return bounded(() => safePoll(() => options.pollClosed()), FRESH_CLOSED_CHECK_MS, false);
    }

    function secondsLeft(): number {
      return Math.max(0, Math.floor((options.deadlineAt - now()) / 1000));
    }

    function nextEventId(): string {
      eventSeq += 1;
      return `mva_${eventSeq}`;
    }

    function send(event: ControlEvent): boolean {
      if (socket === null || ending) return false;
      try {
        return socket.send(event) === true;
      } catch {
        return false;
      }
    }

    function toolBusy(): boolean {
      return running !== null || toolQueue.length > 0 || rounds.size > 0;
    }

    function createBusy(): boolean {
      return responseActive !== null || inFlight !== null || createQueue.length > 0;
    }

    // -------------------------------------------------------------------------------------------
    // The end
    // -------------------------------------------------------------------------------------------

    function end(why: ControllerEndReason): void {
      if (ending) return;
      // What the browser is told, decided before `ending` mutes emit().
      let last: CallStreamEvent | null = null;
      if (why === "provider" || why === "control" || why === "error") last = { type: "error", code: "upstream" };
      else if (why === "tripwire") last = { type: "ended", reason: "error" };
      else if (why !== "unload") last = { type: "ended", reason: why };
      // (a) tell the browser, if the stream still takes it.
      if (last !== null) emit(last);
      ending = true;
      phase = "ending";
      reason = why;
      endedAt = now();
      void finish();
    }

    function hangUpOnce(): Promise<unknown> {
      return bounded<unknown>(() => options.hangUp(), HANGUP_WAIT_MS, null);
    }

    function hungUp(result: unknown): boolean {
      const r = record(result);
      return r !== null && (r.ok === true || r.skipped === true);
    }

    /** After a failed first attempt: two more, HANGUP_RETRY_DELAY_MS apart; one warning if all failed. */
    async function retryHangUp(first: unknown): Promise<boolean> {
      let last = first;
      try {
        for (let attempt = 0; attempt < HANGUP_RETRIES; attempt += 1) {
          await sleep(HANGUP_RETRY_DELAY_MS);
          last = await hangUpOnce();
          if (hungUp(last)) return true;
        }
      } catch {
        // sleep() and bounded() never reject.
      }
      const status = record(last)?.httpStatus;
      const httpStatus = typeof status === "number" && Number.isFinite(status) ? status : undefined;
      log({
        warn: "call_hangup_failed",
        ...(httpStatus !== undefined ? { httpStatus } : {}),
        code: httpStatus !== undefined ? "upstream" : "timeout",
      });
      return false;
    }

    async function finish(): Promise<void> {
      const toolDone: Promise<void> = running ?? Promise.resolve();
      let hangUpOk = false;
      let hangUpDone: Promise<boolean> = Promise.resolve(false);
      try {
        // (b) stop every timer and poll; no tool starts any more.
        try {
          for (const handle of [...timers]) cancel(handle);
          toolQueue.length = 0;
          createQueue.length = 0;
          options.signal.removeEventListener("abort", onAbort);
        } catch {
          // Every timer callback checks `ending` anyway.
        }
        // (c) let the goodbye's last syllable reach the caller.
        if (reason === "assistant") {
          try {
            await sleep(GOODBYE_TAIL_MS);
          } catch {
            // Go on with the hang-up.
          }
        }
        // (d) hang up through the provider's REST call, bounded; when it fails, the retries run in
        // the background (report.hangUpDone) and do not hold the report.
        try {
          const first = await hangUpOnce();
          hangUpOk = hungUp(first);
          hangUpDone = hangUpOk ? Promise.resolve(true) : retryHangUp(first);
        } catch {
          // bounded() never rejects; still, the retries are not skipped.
          hangUpDone = retryHangUp(null);
        }
        // (e) close our socket (not awaited: closing takes seconds).
        try {
          socket?.close(1000);
        } catch {
          // Idempotent and never throws by contract.
        }
      } finally {
        phase = "ended";
        resolve(report(toolDone, hangUpOk, hangUpDone));
      }
    }

    function report(toolDone: Promise<void>, hangUpOk: boolean, hangUpDone: Promise<boolean>): CallEndReport {
      let usd = { usdHigh: 0, usdEst: 0 };
      try {
        usd = usageCostUsd(options.model, usage, options.transcribeModel, options.host);
      } catch {
        // Priced as zero; the usage itself is still reported.
      }
      return {
        reason,
        confirmedAt,
        endedAt,
        usage: { ...usage },
        usd,
        responses,
        foreign,
        turns,
        tools,
        errors,
        duplicates,
        greetings,
        sidebandMs,
        readyMs,
        greetMs,
        minTokLeft,
        tripwire: tripwireCode,
        toolDone,
        hangUpOk,
        hangUpDone,
      };
    }

    function tripwire(code: string): void {
      if (ending) return;
      tripwireCode = code;
      log({ warn: "call_tripwire", code });
      end("tripwire");
    }

    function onAbort(): void {
      end("unload");
    }

    // -------------------------------------------------------------------------------------------
    // Timers armed at the start
    // -------------------------------------------------------------------------------------------

    function activity(): void {
      cancel(silenceTimer);
      silenceTimer = later(silenceMs, () => {
        silenceTimer = null;
        if (responseActive !== null || inFlight !== null || audioPlaying !== null || running !== null || toolQueue.length > 0) {
          activity();
          return;
        }
        end("silence");
      });
    }

    function sendInstructionsUpdate(): void {
      if (socket === null || ending) return;
      const id = nextEventId();
      const event = { type: "session.update", event_id: id, session: { type: "realtime", instructions: options.instructionsAt(secondsLeft()) } };
      if (!send(event)) return;
      ourUpdates.add(id);
      pendingUpdates += 1;
    }

    // -------------------------------------------------------------------------------------------
    // Opening the control socket and the read-back
    // -------------------------------------------------------------------------------------------

    async function open(): Promise<void> {
      let result: OpenControlResult;
      try {
        result = await bounded<OpenControlResult>(
          () => options.openControl(),
          CONTROL_OPEN_TIMEOUT_MS,
          { ok: false, code: "timeout" },
        );
      } catch {
        result = { ok: false, code: "upstream" };
      }
      if (!result || result.ok !== true) {
        const code = result && result.ok === false ? logValue(str(result.code)) : "upstream";
        if (ending) return;
        log({ warn: "call_control_failed", code });
        end("control");
        return;
      }
      const opened = result.socket;
      if (ending) {
        // The call ended while the socket was opening (deadline, abort): close it at once.
        try {
          opened.close(1000);
        } catch {
          // Never throws by contract.
        }
        return;
      }
      guard(() => {
        socket = opened;
        sidebandMs = Math.max(0, now() - options.answerAt);
        opened.onEvent((event) => onSocketEvent(event));
        opened.onClose(() => onSocketClose());
        if (ending) return;
        phase = "waiting";
        // The read-back: an empty update answered with the whole effective session.
        const id = nextEventId();
        if (send({ type: "session.update", event_id: id, session: { type: "realtime" } })) {
          ourUpdates.add(id);
          pendingUpdates += 1;
        }
        readbackTimer = later(READBACK_TIMEOUT_MS, () => {
          readbackTimer = null;
          if (readbackOk) return;
          log({ warn: "call_control_failed", code: "no_readback" });
          end("control");
        });
        readyTick();
        later(CLOSED_POLL_MS, closedTick);
      });
    }

    function onSocketClose(): void {
      if (ending) return;
      // A closed socket does not end the provider's call by itself: we hang up. Whether the
      // visitor ended it decides what the browser is told.
      void freshClosed().then((closed) => {
        if (!ending) guard(() => end(closed ? "user" : "provider"));
      });
    }

    function onSessionUpdated(event: ControlEvent): void {
      if (pendingUpdates <= 0) {
        tripwire("foreign_update");
        return;
      }
      pendingUpdates -= 1;
      if (readbackChecked) return; // the echo of an instructions update: nothing to check
      readbackChecked = true;
      const session = record(event.session) ?? {};
      if (session.tracing !== null) {
        tripwire("readback_tracing");
        return;
      }
      if (typeof session.instructions !== "string" || session.instructions.length !== options.expected.instructionsChars) {
        tripwire("readback_instructions");
        return;
      }
      if (!Array.isArray(session.tools) || session.tools.length !== options.expected.toolCount) {
        tripwire("readback_tools");
        return;
      }
      readbackOk = true;
      cancel(readbackTimer);
      readbackTimer = null;
      if (greetingSkipped) {
        if (phase === "waiting") phase = "live";
      } else {
        void tryGreet();
      }
    }

    // -------------------------------------------------------------------------------------------
    // Polls
    // -------------------------------------------------------------------------------------------

    function wantReadyPolls(): boolean {
      if (readySeen || greetingSkipped) return false;
      if (greetingSentAt === null) return true;
      return greetingByFallback && now() < options.answerAt + READY_POLL_STOP_MS;
    }

    function readyTick(): void {
      if (ending || !wantReadyPolls()) return;
      if (!readyPending) void pollReadyOnce();
      later(greetingSentAt === null ? READY_POLL_MS : READY_LATE_POLL_MS, readyTick);
    }

    async function pollReadyOnce(): Promise<void> {
      readyPending = true;
      const ready = await safePoll(() => options.pollReady());
      readyPending = false;
      if (ending || !ready || readySeen) return;
      guard(() => {
        readySeen = true;
        readyMs = Math.max(0, now() - options.answerAt);
        if (phase === "waiting") void tryGreet();
        else if (greetingLost && greetings < 2) repeatGreeting();
      });
    }

    function closedTick(): void {
      if (ending) return;
      if (!closedPending) void pollClosedOnce();
      later(CLOSED_POLL_MS, closedTick);
    }

    async function pollClosedOnce(): Promise<void> {
      closedPending = true;
      const closed = await safePoll(() => options.pollClosed());
      closedPending = false;
      if (closed && !ending) end("user");
    }

    // -------------------------------------------------------------------------------------------
    // Confirmation and the greeting
    // -------------------------------------------------------------------------------------------

    /** The confirmation point: charges the call once, whatever came first. */
    function confirmOnce(): Promise<void> {
      if (confirmation !== null) return confirmation;
      confirmedAt ??= now();
      emit({ type: "remaining", seconds: secondsLeft() });
      confirmation = (async () => {
        try {
          await options.confirm();
        } catch (error) {
          // confirmedAt is set: the settlement charges the measured seconds anyway.
          logStep("confirm", error);
        }
      })();
      return confirmation;
    }

    async function tryGreet(): Promise<void> {
      if (ending || phase !== "waiting" || greetStarted || greetingSkipped || !readbackOk) return;
      if (!readySeen && !fallbackDue) return;
      greetStarted = true;
      const closed = await freshClosed();
      if (ending) return;
      if (closed) {
        end("user");
        return;
      }
      if (greetingSkipped) return; // the caller spoke first meanwhile: that response confirmed the call
      guard(() => {
        // Charged right before the greeting. Not awaited: a slow store must not hold the greeting,
        // and a failed charge is settled from confirmedAt anyway.
        void confirmOnce();
        greetingByFallback = !readySeen;
        phase = "greeting";
        sendGreeting();
        greetingTimer = later(GREETING_GUARD_MS, () => {
          greetingTimer = null;
          if (phase !== "greeting") return;
          log({ warn: "call_greeting_silent" });
          phase = "live";
          emitListening();
        });
        // After a fallback greeting the running ready poll goes on, slower (readyTick), so that a
        // lost greeting can be repeated.
      });
    }

    function sendGreeting(): void {
      greetings += 1;
      greetingSentAt ??= now();
      sendCreate({ response: { instructions: options.greetingText }, greeting: true, goodbye: false, retried: false });
    }

    function repeatGreeting(): void {
      greetingLost = false;
      greetingAudio = false;
      sendGreeting();
    }

    // -------------------------------------------------------------------------------------------
    // response.create: one at a time, queued while a response is active, re-sent once if refused
    // -------------------------------------------------------------------------------------------

    function sendCreate(entry: CreateEntry): void {
      if (ending || socket === null) return;
      if (responseActive !== null || inFlight !== null) {
        createQueue.push(entry);
        return;
      }
      const id = nextEventId();
      const event: ControlEvent = { type: "response.create", event_id: id };
      if (entry.response !== undefined) event.response = entry.response;
      if (!send(event)) return;
      ourCreates.set(id, entry);
      inFlight = id;
      // Neither response.created nor an error: treated as refused, so the queue goes on.
      later(CREATE_ANSWER_MS, () => {
        if (inFlight === id) onOurEventRefused(id);
      });
      if (entry.greeting) {
        awaitingGreetingId = true;
        lastGreetingAt = now();
      }
      if (entry.goodbye && !goodbyeArmed) {
        goodbyeArmed = true;
        phase = "goodbye";
        awaitingGoodbyeId = true;
        goodbyeCreatedAt = now();
        armGoodbyeGuard(GOODBYE_GUARD_MS);
      }
    }

    /**
     * The goodbye's backstop. A goodbye queued behind earlier audio gets no started event, so while
     * audio still plays the guard waits once more, up to GOODBYE_CEILING_MS after its create.
     */
    function armGoodbyeGuard(ms: number): void {
      later(ms, () => {
        if (phase !== "goodbye") return;
        const left = goodbyeCreatedAt + GOODBYE_CEILING_MS - now();
        if (audioPlaying !== null && left > 0) {
          armGoodbyeGuard(Math.min(GOODBYE_GUARD_MS, left));
          return;
        }
        end("assistant");
      });
    }

    function flushCreates(): void {
      if (ending || responseActive !== null || inFlight !== null) return;
      const next = createQueue.shift();
      if (next !== undefined) sendCreate(next);
    }

    function onOurEventRefused(eventId: string): void {
      if (ourUpdates.delete(eventId)) {
        // That update will never be echoed.
        pendingUpdates = Math.max(0, pendingUpdates - 1);
        return;
      }
      const entry = ourCreates.get(eventId);
      if (entry === undefined) return;
      ourCreates.delete(eventId);
      if (inFlight === eventId) inFlight = null;
      if (entry.greeting) awaitingGreetingId = false;
      if (!entry.retried) {
        entry.retried = true;
        if (responseActive !== null) createQueue.unshift(entry);
        else later(RESEND_DELAY_MS, () => sendCreate(entry));
      }
      flushCreates();
    }

    // -------------------------------------------------------------------------------------------
    // Tools
    // -------------------------------------------------------------------------------------------

    function onFunctionCall(event: ControlEvent): void {
      const callId = str(event.call_id);
      if (callId === null || callId.length < 1 || callId.length > MAX_TOOL_CALL_ID_CHARS) return;
      if (seenToolCalls.has(callId)) return;
      seenToolCalls.add(callId);
      let input: unknown = {};
      const args = str(event.arguments);
      if (args !== null) {
        try {
          const parsed: unknown = JSON.parse(args);
          if (record(parsed) !== null) input = parsed;
        } catch {
          // Unparseable arguments: the tool's own validation asks the caller again.
        }
      }
      const responseId = str(event.response_id) ?? responseActive ?? "none";
      const entry: ToolEntry = { responseId, call: { id: callId, name: str(event.name) ?? "", input }, outcome: null };
      let round = rounds.get(responseId);
      if (round === undefined) {
        round = { entries: [], done: countedResponses.has(responseId) };
        rounds.set(responseId, round);
      }
      round.entries.push(entry);
      toolQueue.push(entry);
      runNext();
    }

    function runNext(): void {
      if (running !== null || ending) return;
      const entry = toolQueue.shift();
      if (entry === undefined) return;
      tools += 1;
      const name = entry.call.name;
      // Only our own tool names reach the browser; any other still gets an output for the model.
      const known: VoiceToolName | null = isVoiceToolName(name) ? name : null;
      if (known !== null) emit({ type: "tool", name: known, status: "started" });
      activity();
      running = (async () => {
        let outcome: ToolOutcome;
        try {
          const result: unknown = await options.runTool(entry.call);
          outcome = isOutcome(result) ? result : TOOL_UNAVAILABLE;
        } catch {
          outcome = TOOL_UNAVAILABLE;
        }
        entry.outcome = outcome;
        running = null;
        // At the end nothing more goes out: the tool only had to finish its own work.
        if (ending) return;
        guard(() => {
          if (known !== null) {
            emit({ type: "tool", name: known, status: outcome.ok ? "ok" : "failed" });
            const handoff = options.handoffOf(known, outcome);
            if (handoff !== null && handoff !== undefined) emit({ type: "handoff", handoff });
          }
          if (outcome.ok && outcome.endCall === true) endRequested = true;
          else if (outcome.ok && name !== "end_call") sendInstructionsUpdate();
          activity();
          flushRound(entry.responseId);
          runNext();
        });
      })();
    }

    /** Once every call of a response ran and the response is done: its outputs, then one response.create. */
    function flushRound(responseId: string): void {
      const round = rounds.get(responseId);
      if (round === undefined || !round.done || round.entries.some((entry) => entry.outcome === null)) return;
      rounds.delete(responseId);
      if (ending) return;
      for (const entry of round.entries) {
        const output = options.toolOutput(entry.outcome as ToolOutcome);
        send({
          type: "conversation.item.create",
          event_id: nextEventId(),
          item: { type: "function_call_output", call_id: entry.call.id, output },
        });
      }
      sendCreate({ greeting: false, goodbye: endRequested && !goodbyeArmed, retried: false });
    }

    // -------------------------------------------------------------------------------------------
    // Captions
    // -------------------------------------------------------------------------------------------

    function callerLine(itemId: string): CallerLine {
      let line = callerLines.find((candidate) => candidate.itemId === itemId);
      if (line === undefined) {
        callerSeq += 1;
        line = { itemId, id: `c-${callerSeq}`, text: "", sentText: null, done: false, finalSent: false, dropped: false, released: false, holdTimer: null };
        callerLines.push(line);
      }
      return line;
    }

    function callerMaySend(line: CallerLine): boolean {
      if (line.released) return true;
      for (const earlier of callerLines) {
        if (earlier === line) return true;
        if (earlier.sentText === null && !earlier.dropped) return false;
      }
      return true;
    }

    function pushCaller(line: CallerLine): void {
      if (line.dropped || line.finalSent || line.text === "" || !callerMaySend(line)) return;
      if (!line.done && line.sentText === line.text) return;
      const frame: CaptionEvent = { type: "caption", id: line.id, role: "caller", text: line.text, final: line.done };
      if (line.before !== undefined) frame.before = line.before;
      if (line.done && line.locale !== undefined) frame.locale = line.locale;
      emit(frame);
      line.sentText = line.text;
      if (line.done) {
        line.finalSent = true;
        cancel(line.holdTimer);
        line.holdTimer = null;
      }
    }

    /** Sends whatever the order now allows, earliest line first. */
    function flushCallers(): void {
      for (const line of callerLines) pushCaller(line);
    }

    function dropCaller(line: CallerLine): void {
      if (line.dropped || line.finalSent) return;
      line.dropped = true;
      line.done = true;
      cancel(line.holdTimer);
      line.holdTimer = null;
      if (line.sentText !== null) emit({ type: "caption", id: line.id, role: "caller", text: "", final: true });
      line.finalSent = true;
      flushCallers();
    }

    function onTranscriptionDelta(event: ControlEvent): void {
      const itemId = str(event.item_id);
      const delta = str(event.delta);
      if (itemId === null || delta === null) return;
      const line = callerLine(itemId);
      if (line.dropped || line.done) return;
      line.text = cap(line.text + delta, maxTurnChars);
      flushCallers();
    }

    function onTranscriptionCompleted(event: ControlEvent): void {
      const itemId = str(event.item_id);
      if (itemId === null) return;
      const line = callerLine(itemId);
      addTranscriptionUsage(usage, event.usage);
      if (line.dropped || line.done) return;
      const text = cap((str(event.transcript) ?? "").trim(), maxTurnChars);
      if (text === "") {
        dropCaller(line);
        return;
      }
      const languages = event.languages;
      if (Array.isArray(languages) && languages.length > 0) {
        const code = record(languages[0])?.code;
        if (isVoiceLocale(code)) line.locale = code;
      }
      line.text = text;
      line.done = true;
      flushCallers();
      if (!line.finalSent && line.holdTimer === null) {
        line.holdTimer = later(CALLER_HOLD_MS, () => {
          line.holdTimer = null;
          line.released = true;
          flushCallers();
        });
      }
    }

    function onTranscriptionFailed(event: ControlEvent): void {
      const itemId = str(event.item_id);
      if (itemId === null) return;
      dropCaller(callerLine(itemId));
    }

    function assistantLine(itemId: string, responseId: string | null): AssistantLine {
      let line = assistantLines.get(itemId);
      if (line === undefined) {
        assistantSeq += 1;
        line = { id: `a-${assistantSeq}`, responseId: null, text: "", sent: false, closed: false, cut: false, lastSentAt: 0, timer: null };
        assistantLines.set(itemId, line);
        // The caller's words came before this reply even when their transcription comes later.
        for (const caller of callerLines) {
          if (caller.sentText === null && !caller.dropped && caller.before === undefined) caller.before = line.id;
        }
      }
      line.responseId ??= responseId;
      return line;
    }

    function sendAssistant(line: AssistantLine, final: boolean): void {
      cancel(line.timer);
      line.timer = null;
      emit({ type: "caption", id: line.id, role: "assistant", text: line.text, final });
      line.sent = true;
      line.lastSentAt = now();
      if (final) line.closed = true;
    }

    function onAssistantDelta(event: ControlEvent): void {
      const itemId = str(event.item_id) ?? str(event.response_id);
      const delta = str(event.delta);
      if (itemId === null || delta === null) return;
      const line = assistantLine(itemId, str(event.response_id));
      if (line.closed) return;
      line.text = cap(line.text + delta, ASSISTANT_CAPTION_CHARS);
      if (line.text === "") return;
      const wait = line.sent ? line.lastSentAt + CAPTION_THROTTLE_MS - now() : 0;
      if (wait <= 0) {
        sendAssistant(line, false);
      } else if (line.timer === null) {
        line.timer = later(wait, () => {
          line.timer = null;
          if (!line.closed) sendAssistant(line, false);
        });
      }
    }

    function onAssistantDone(event: ControlEvent): void {
      const itemId = str(event.item_id) ?? str(event.response_id);
      if (itemId === null) return;
      const transcript = str(event.transcript);
      const existing = assistantLines.get(itemId);
      if (existing === undefined && (transcript === null || transcript.trim() === "")) return;
      const line = assistantLine(itemId, str(event.response_id));
      if (line.closed) return; // cut by a barge-in: the transcript of what was never heard is ignored
      if (transcript !== null && transcript !== "") line.text = cap(transcript, ASSISTANT_CAPTION_CHARS);
      if (line.text === "" && !line.sent) {
        line.closed = true;
        return;
      }
      sendAssistant(line, true);
    }

    /**
     * A barge-in: every line of the cut response is sent final with the cut mark, also when it was
     * already final (its transcript usually ends before its audio does), and only once. Lines of
     * other responses are left alone. Without any response id, the open lines are cut.
     */
    function cutAssistantLines(responseId: string | null): void {
      for (const line of assistantLines.values()) {
        if (line.cut) continue;
        if (responseId !== null ? line.responseId !== responseId : line.closed) continue;
        line.cut = true;
        if (line.text === "" && !line.sent) {
          line.closed = true;
          continue;
        }
        line.text = `${cap(line.text, ASSISTANT_CAPTION_CHARS - CUT_MARK.length)}${CUT_MARK}`;
        sendAssistant(line, true);
      }
    }

    // -------------------------------------------------------------------------------------------
    // Responses and audio
    // -------------------------------------------------------------------------------------------

    function responseIdOf(event: ControlEvent): string | null {
      return str(record(event.response)?.id);
    }

    function onResponseCreated(event: ControlEvent): void {
      let id = responseIdOf(event);
      if (id === null) {
        anonymousResponses += 1;
        id = `anonymous-${anonymousResponses}`;
      }
      responseActive = id;
      inFlight = null;
      activity();
      if (greetingSentAt === null && (phase === "opening" || phase === "waiting")) {
        // The caller spoke before our greeting: the model already answers, so that response is the
        // confirmation point and the greeting is never sent.
        foreign += 1;
        greetingSkipped = true;
        void confirmOnce();
        if (readbackOk) phase = "live";
        return;
      }
      if (awaitingGreetingId) {
        awaitingGreetingId = false;
        greetingResponseId = id;
        greetingAudio = false;
      } else if (awaitingGoodbyeId) {
        awaitingGoodbyeId = false;
        goodbyeResponseId = id;
      }
    }

    function onResponseDone(event: ControlEvent): void {
      const response = record(event.response) ?? {};
      const id = str(response.id);
      if (id !== null) {
        if (countedResponses.has(id)) {
          duplicates += 1;
          return;
        }
        countedResponses.add(id);
      }
      addResponseUsage(usage, response.usage);
      responses += 1;
      responseActive = null;

      if (responses > options.maxResponses) {
        end("limit");
        return;
      }
      // The estimate, not the high figure: the high one prices the cached re-read of the prompt in
      // every response at the full price and would cut ordinary calls.
      if (usageCostUsd(options.model, usage, options.transcribeModel, options.host).usdEst > options.maxCallUsd) {
        end("limit");
        return;
      }

      if (id !== null && id === greetingResponseId && !greetingAudio) {
        cancel(greetingTimer);
        greetingTimer = null;
        if (phase === "greeting") phase = "live";
        // A greeting generated before the browser listened is lost (and billed): say it once more
        // as soon as the browser is ready.
        if (greetingByFallback && greetings < 2) {
          greetingLost = true;
          if (readySeen) repeatGreeting();
        }
      }

      if (phase === "goodbye" && id !== null && id === goodbyeResponseId) {
        const audioTokens = record(record(response.usage)?.output_token_details)?.audio_tokens;
        const noAudio = typeof audioTokens !== "number" || audioTokens <= 0;
        if (noAudio || (response.status === "cancelled" && !goodbyeAudio)) {
          end("assistant");
          return;
        }
      }

      if (id !== null) {
        const round = rounds.get(id);
        if (round !== undefined) {
          round.done = true;
          flushRound(id);
        }
      }
      flushCreates();
      if (phase !== "goodbye" && audioPlaying === null && !toolBusy() && !createBusy()) {
        emitListening();
      }
    }

    function isGoodbyeAudio(responseId: string | null): boolean {
      if (phase !== "goodbye") return false;
      if (goodbyeResponseId === null) return false;
      return responseId === goodbyeResponseId || (responseId === null && goodbyeAudio);
    }

    function onAudioStarted(event: ControlEvent): void {
      const responseId = str(event.response_id);
      audioPlaying = responseId ?? "unknown";
      activity();
      const isGreeting =
        phase === "greeting"
          ? responseId === null || greetingResponseId === null || responseId === greetingResponseId
          : responseId !== null && responseId === greetingResponseId;
      if (isGreeting) {
        greetingAudio = true;
        greetingLost = false;
        if (greetMs < 0) greetMs = Math.max(0, now() - lastGreetingAt);
        if (phase === "greeting") {
          cancel(greetingTimer);
          greetingTimer = null;
          phase = "live";
        }
      }
      if (phase === "goodbye" && goodbyeResponseId !== null && (responseId === null || responseId === goodbyeResponseId)) {
        goodbyeAudio = true;
      }
      emit({ type: "status", status: "speaking" });
    }

    function onAudioStopped(event: ControlEvent): void {
      const responseId = str(event.response_id);
      audioPlaying = null;
      activity();
      if (isGoodbyeAudio(responseId)) {
        end("assistant");
        return;
      }
      if (phase === "goodbye") return;
      if (!toolBusy() && !createBusy()) emitListening();
      else emit({ type: "status", status: "thinking" });
    }

    function onAudioCleared(event: ControlEvent): void {
      const responseId = str(event.response_id);
      // Without an id on the event, the response whose audio was playing is the one cut.
      const cutId = responseId ?? (audioPlaying !== null && audioPlaying !== "unknown" ? audioPlaying : null);
      audioPlaying = null;
      activity();
      cutAssistantLines(cutId);
      emit({ type: "interrupted" });
      if (isGoodbyeAudio(responseId)) end("assistant");
    }

    function onError(event: ControlEvent): void {
      errors += 1;
      const error = record(event.error) ?? {};
      const code = logValue(str(error.code));
      if (!loggedErrorCodes.has(code)) {
        loggedErrorCodes.add(code);
        log({ warn: "call_openai_error", code });
      }
      const eventId = str(error.event_id);
      if (eventId !== null) onOurEventRefused(eventId);
      if (errors > MAX_OPENAI_ERRORS) end("error");
    }

    function onRateLimits(event: ControlEvent): void {
      const limits = event.rate_limits;
      if (!Array.isArray(limits)) return;
      for (const entry of limits) {
        const limit = record(entry);
        if (limit === null || limit.name !== "tokens") continue;
        const remaining = limit.remaining;
        if (typeof remaining !== "number" || !Number.isFinite(remaining)) continue;
        minTokLeft = minTokLeft < 0 ? remaining : Math.min(minTokLeft, remaining);
      }
    }

    function onItemAdded(event: ControlEvent): void {
      const item = record(event.item);
      if (item === null || item.type !== "message" || item.role !== "user" || !Array.isArray(item.content)) return;
      // We never create a user text item: one that appears was sent by someone else.
      if (item.content.some((part) => record(part)?.type === "input_text")) tripwire("foreign_item");
    }

    function onSocketEvent(event: ControlEvent): void {
      if (ending) return;
      guard(() => {
        const e = record(event);
        if (e === null) return;
        switch (e.type) {
          case "session.updated":
            return onSessionUpdated(e);
          case "input_audio_buffer.speech_started":
            speechActive = true;
            activity();
            emit({ type: "activity", speech: "started" });
            return;
          case "input_audio_buffer.speech_stopped":
            speechActive = false;
            activity();
            emit({ type: "activity", speech: "stopped" });
            if (audioPlaying === null) emit({ type: "status", status: "thinking" });
            return;
          case "input_audio_buffer.committed": {
            turns += 1;
            const itemId = str(e.item_id);
            if (itemId !== null) callerLine(itemId);
            return;
          }
          case "conversation.item.input_audio_transcription.delta":
            return onTranscriptionDelta(e);
          case "conversation.item.input_audio_transcription.completed":
            return onTranscriptionCompleted(e);
          case "conversation.item.input_audio_transcription.failed":
            return onTranscriptionFailed(e);
          case "response.created":
            return onResponseCreated(e);
          case "conversation.item.added":
          case "conversation.item.created":
            return onItemAdded(e);
          case "response.output_audio_transcript.delta":
            return onAssistantDelta(e);
          case "response.output_audio_transcript.done":
            return onAssistantDone(e);
          case "response.function_call_arguments.done":
            return onFunctionCall(e);
          case "response.done":
            return onResponseDone(e);
          case "output_audio_buffer.started":
            return onAudioStarted(e);
          case "output_audio_buffer.stopped":
            return onAudioStopped(e);
          case "output_audio_buffer.cleared":
            return onAudioCleared(e);
          case "rate_limits.updated":
            return onRateLimits(e);
          case "error":
            return onError(e);
          default:
            // response.content_part.*, response.output_audio.done, conversation.item.truncated, ...
            return;
        }
      });
    }

    // -------------------------------------------------------------------------------------------
    // Start: every bound is armed before anything can go wrong
    // -------------------------------------------------------------------------------------------

    guard(() => {
      const start = now();
      later(options.deadlineAt - start, () => end("timeout"));
      const warnSeconds = finite(options.limits.warnBeforeEndSeconds, 0);
      const warnAt = options.deadlineAt - warnSeconds * 1000;
      if (warnSeconds > 0 && warnAt > start) later(warnAt - start, () => sendInstructionsUpdate());
      later(options.answerAt + READY_FALLBACK_MS - start, () => {
        fallbackDue = true;
        void tryGreet();
      });
      activity();
      if (options.signal.aborted) {
        end("unload");
        return;
      }
      options.signal.addEventListener("abort", onAbort, { once: true });
      void open();
    });
  });
}
