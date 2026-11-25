// What the voice widget's transports are built from, tested without a browser: the turn-stream
// decoder and the grant check (transports/http.ts), the speech text helpers (speech-text.ts), the
// speech queue on a fake engine and a fake clock (speech-queue.ts), the phone defaults
// (platform.ts), the live transports against a fake fetch (local.ts, realtime.ts: what they
// send and what they hand back), and the orb's loop pacing (orb-motion.ts).
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  announcedLocale,
  createSseDecoder,
  isSessionGrant,
  isTurnStreamEvent,
  readFailure,
} from "@/components/voice/transports/http";
import { busyRetryDelay, createLocalTransport } from "@/components/voice/transports/local";
import { speechPlatform } from "@/components/voice/transports/platform";
import { createRealtimeTransport } from "@/components/voice/transports/realtime";
import {
  createSpeechQueue,
  SPEECH_TIMING,
  type QueueClock,
  type SpeechCallbacks,
  type SpeechEngine,
} from "@/components/voice/transports/speech-queue";
import {
  detectReplyLocale,
  isEcho,
  MAX_UTTERANCE_CHARS,
  pickVoice,
  takeSentences,
  toSpeakable,
} from "@/components/voice/transports/speech-text";
import { easeLook, lookSettled, orbCadence, targetLook } from "@/components/voice/orb-motion";
import type { VoiceTransportEvent } from "@/components/voice/voice-machine";
import type { VoicePublicConfig } from "@/lib/voice/types";

// ---------------------------------------------------------------------------------------------
// Stream decoding and the session grant
// ---------------------------------------------------------------------------------------------

const GRANT_LIMITS = { maxCallSeconds: 180, warnBeforeEndSeconds: 20, silenceTimeoutSeconds: 25, maxTurnChars: 600 };

function grant(overrides: Record<string, unknown> = {}, limits: Record<string, unknown> = {}) {
  return {
    ok: true,
    sessionToken: "token-1",
    mode: "local",
    locale: "de",
    expiresAt: 1_900_000_000_000,
    limits: { ...GRANT_LIMITS, ...limits },
    ...overrides,
  };
}

describe("turn stream decoding", () => {
  it("decodes data frames, skips ping comments and survives frames split across chunks", () => {
    const decoder = createSseDecoder();
    const events = [
      ...decoder.push(': ping\n\ndata: {"type":"start"}\n\ndata: {"type":"del'),
      ...decoder.push('ta","text":"Grüezi"}\n'),
      ...decoder.push('\n: ping\n\ndata: {"type":"done","ended":false,"remainingTurns":3,"remainingSeconds":95}\n\n'),
      ...decoder.flush(),
    ];
    assert.deepEqual(events, [
      { type: "start" },
      { type: "delta", text: "Grüezi" },
      { type: "done", ended: false, remainingTurns: 3, remainingSeconds: 95 },
    ]);
  });

  it("accepts CRLF line ends, also split between chunks", () => {
    const decoder = createSseDecoder();
    const events = [...decoder.push('data: {"type":"start"}\r'), ...decoder.push('\n\r\n')];
    assert.deepEqual(events, [{ type: "start" }]);
  });

  it("drops malformed JSON and events outside the contract", () => {
    const decoder = createSseDecoder();
    const events = decoder.push(
      [
        "data: not json",
        'data: {"type":"tool","name":"rm_rf","status":"started"}',
        'data: {"type":"error","code":"teapot"}',
        'data: {"type":"tool","name":"check_availability","status":"ok"}',
        'data: {"type":"error","code":"rate_limited","retryAfter":30}',
      ].join("\n\n") + "\n\n",
    );
    assert.deepEqual(events, [
      { type: "tool", name: "check_availability", status: "ok" },
      { type: "error", code: "rate_limited", retryAfter: 30 },
    ]);
  });

  it("validates handoff events", () => {
    assert.equal(isTurnStreamEvent({ type: "handoff", handoff: { kind: "transfer", targetLabel: "Team" } }), true);
    assert.equal(isTurnStreamEvent({ type: "handoff", handoff: { kind: "transfer" } }), false);
    assert.equal(isTurnStreamEvent({ type: "handoff", handoff: { kind: "written" } }), true);
  });

  it("reads the reply language when the server announces it, and only a known one", () => {
    const [start, done] = createSseDecoder().push(
      'data: {"type":"start","locale":"it"}\n\ndata: {"type":"done","ended":false,"remainingTurns":1,"remainingSeconds":9,"locale":"xx"}\n\n',
    );
    assert.equal(announcedLocale(start), "it");
    assert.equal(announcedLocale(done), null, "an unknown language is ignored");
    assert.equal(announcedLocale({ type: "start" }), null, "the contract's plain start event");
    assert.equal(announcedLocale({ type: "delta", text: "x" }), null);
  });
});

describe("session grant", () => {
  it("recognises a session grant and nothing else", () => {
    assert.equal(isSessionGrant(grant()), true);
    assert.equal(isSessionGrant(grant({ sessionToken: "" })), false);
    assert.equal(isSessionGrant(grant({ mode: "phone" })), false);
    assert.equal(isSessionGrant(grant({ expiresAt: Number.NaN })), false);
    assert.equal(isSessionGrant({ ok: false, error: "busy" }), false);
  });

  it("accepts every limit the server may send: an end warning of 0 is valid (sicurezza F12)", () => {
    // lib/voice/server/env.ts allows warnBeforeEndSeconds from 0. Refusing such a grant used to
    // drop the token of an admitted session, so it could not even be handed back.
    assert.equal(isSessionGrant(grant({}, { warnBeforeEndSeconds: 0 })), true);
    assert.equal(isSessionGrant(grant({}, { maxCallSeconds: 1800, silenceTimeoutSeconds: 5, maxTurnChars: 50 })), true);
  });

  it("still refuses limits no session can run with", () => {
    assert.equal(isSessionGrant(grant({}, { warnBeforeEndSeconds: -1 })), false);
    assert.equal(isSessionGrant(grant({}, { maxCallSeconds: 0 })), false);
    assert.equal(isSessionGrant(grant({}, { silenceTimeoutSeconds: 0 })), false);
    assert.equal(isSessionGrant(grant({}, { maxTurnChars: Number.POSITIVE_INFINITY })), false);
    assert.equal(isSessionGrant(grant({}, { warnBeforeEndSeconds: "20" })), false);
  });
});

// ---------------------------------------------------------------------------------------------
// Speech text helpers
// ---------------------------------------------------------------------------------------------

describe("sentences for speech", () => {
  it("speaks complete sentences as soon as they are there and keeps the rest", () => {
    const { sentences, rest } = takeSentences("Grüezi, hier ist der Assistent. Wie kann ich hel", false);
    assert.deepEqual(sentences, ["Grüezi, hier ist der Assistent."]);
    assert.equal(rest, "Wie kann ich hel");
  });

  it("does not cut after abbreviations, single letters, ordinals or times", () => {
    const text = "Am 3. Dezember um 14.30 Uhr geht es, z. B. mit Dr. Muster usw. weiter. Passt das?";
    const { sentences, rest } = takeSentences(text, false);
    assert.deepEqual(sentences, ["Am 3. Dezember um 14.30 Uhr geht es, z. B. mit Dr. Muster usw. weiter."]);
    assert.equal(rest, "Passt das?");
    assert.deepEqual(takeSentences(rest, true).sentences, ["Passt das?"]);
  });

  it("waits for more text after a period at the very end", () => {
    assert.deepEqual(takeSentences("Am 3.", false), { sentences: [], rest: "Am 3." });
  });

  it("splits long sentences for the synthesiser", () => {
    const long = `${"Das ist ein sehr langer Satz, ".repeat(12)}und er endet hier.`;
    const { sentences } = takeSentences(long, true);
    assert.ok(sentences.length > 1);
    for (const sentence of sentences) assert.ok(sentence.length <= MAX_UTTERANCE_CHARS, sentence);
    assert.equal(sentences.join(" ").replace(/\s+/g, " "), long.replace(/\s+/g, " ").trim());
  });

  it("removes markdown and links before speaking", () => {
    assert.equal(toSpeakable("**Gerne.** Mehr unter https://example.ch/x - danke"), "Gerne. Mehr unter - danke");
  });
});

describe("voice choice", () => {
  const voices = [
    { lang: "en-US", name: "Samantha", default: true },
    { lang: "de-DE", name: "Anna" },
    { lang: "de_DE", name: "Google Deutsch" },
    { lang: "de-CH", name: "Bubbles" },
    { lang: "it-IT", name: "Alice" },
    { lang: "fr-CA", name: "Amélie" },
    { lang: "fr-FR", name: "Thomas" },
  ];

  it("prefers the Swiss tag, then the regions in order, skipping novelty voices", () => {
    assert.equal(pickVoice(voices, "de")?.name, "Google Deutsch", "de-CH is a novelty voice: de-DE, the better one");
    assert.equal(pickVoice(voices, "fr")?.name, "Thomas", "fr-FR comes before fr-CA");
    assert.equal(pickVoice(voices, "it")?.name, "Alice");
    assert.equal(pickVoice([{ lang: "de-CH", name: "Petra" }, ...voices], "de")?.name, "Petra");
  });

  it("returns null for a language without voices", () => {
    assert.equal(pickVoice([{ lang: "en-GB", name: "Daniel" }], "it"), null);
  });
});

describe("echo filter", () => {
  it("recognises the assistant's own words coming back", () => {
    assert.equal(isEcho("am Dienstag um zehn", "Ich hätte am Dienstag um zehn Uhr noch etwas frei."), true);
  });

  it("lets the caller's own words through", () => {
    assert.equal(isEcho("nein lieber am Freitag", "Ich hätte am Dienstag um zehn Uhr noch etwas frei."), false);
  });
});

describe("language of a reply (interfaccia F7)", () => {
  it("recognises each of the four languages in an ordinary reply", () => {
    assert.equal(detectReplyLocale("Am Donnerstag hätte ich um 14:30 Uhr noch einen Termin frei. Passt Ihnen das?"), "de");
    assert.equal(detectReplyLocale("Sì, sabato abbiamo ancora posto. Per quante persone?"), "it");
    assert.equal(detectReplyLocale("Yes, we have a table for you on Saturday. How many people are you?"), "en");
    assert.equal(detectReplyLocale("Oui, nous avons encore une table samedi. Pour combien de personnes?"), "fr");
  });

  it("does not guess from a word or two, or from a mixed line", () => {
    assert.equal(detectReplyLocale("Gerne."), null);
    assert.equal(detectReplyLocale("Ok."), null);
    assert.equal(detectReplyLocale("Termin, appuntamento."), null);
    assert.equal(detectReplyLocale(""), null);
  });
});

// ---------------------------------------------------------------------------------------------
// The speech queue (interfaccia F1)
// ---------------------------------------------------------------------------------------------

/** Timers on a virtual clock: advance() runs them in time order, nothing waits for real. */
function fakeClock(): QueueClock & { now: () => number; advance: (ms: number) => void } {
  let now = 0;
  let sequence = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  return {
    now: () => now,
    setTimeout(callback, ms) {
      sequence += 1;
      timers.set(sequence, { at: now + Math.max(0, ms), callback });
      return sequence;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      const until = now + ms;
      for (;;) {
        let nextId = -1;
        let nextAt = Number.POSITIVE_INFINITY;
        for (const [id, timer] of timers) {
          if (timer.at <= until && (timer.at < nextAt || (timer.at === nextAt && id < nextId))) {
            nextId = id;
            nextAt = timer.at;
          }
        }
        if (nextId === -1) break;
        const timer = timers.get(nextId);
        timers.delete(nextId);
        now = nextAt;
        timer?.callback();
      }
      now = until;
    },
  };
}

interface FakeEngineOptions {
  /** Speaking pace of the fake voice. */
  charsPerSecond?: number;
  /** Delay between an utterance reaching the head of the engine's queue and its start event. */
  latencyMs?: number;
  /** Speaks nothing and reports nothing (no voice installed). */
  silent?: boolean;
  /** Plays every utterance but never reports its end (Chrome after about 15 s). */
  dropEnds?: boolean;
  /** Claims to be speaking forever and never gets to anything queued. */
  stuck?: boolean;
}

/** An engine that plays one utterance after the other, like speechSynthesis. */
function fakeEngine(clock: ReturnType<typeof fakeClock>, options: FakeEngineOptions = {}) {
  const cps = options.charsPerSecond ?? 14;
  const latency = options.latencyMs ?? 50;
  const waiting: Array<{ text: string; callbacks: SpeechCallbacks }> = [];
  let current: { text: string; callbacks: SpeechCallbacks; timer: unknown } | null = null;
  const log: string[] = [];
  let cancels = 0;
  const playNext = () => {
    if (current !== null || waiting.length === 0) return;
    const next = waiting.shift();
    if (!next) return;
    const playing = { ...next, timer: null as unknown };
    current = playing;
    playing.timer = clock.setTimeout(() => {
      log.push(`start ${next.text.slice(0, 12)} @${clock.now()}`);
      next.callbacks.start();
      playing.timer = clock.setTimeout(() => {
        current = null;
        log.push(`end ${next.text.slice(0, 12)} @${clock.now()}`);
        if (!options.dropEnds) next.callbacks.end();
        playNext();
      }, (next.text.length / cps) * 1000);
    }, latency);
  };
  const engine: SpeechEngine = {
    speak(text, callbacks) {
      if (options.silent || options.stuck) return;
      waiting.push({ text, callbacks });
      playNext();
    },
    cancel() {
      cancels += 1;
      const dropped = [...(current ? [current] : []), ...waiting];
      if (current) clock.clearTimeout(current.timer);
      current = null;
      waiting.length = 0;
      dropped.forEach((item, index) => item.callbacks.error(index === 0 ? "interrupted" : "canceled"));
    },
    speaking() {
      return options.stuck === true || current !== null;
    },
  };
  return { engine, log, cancels: () => cancels };
}

function queueWith(clock: ReturnType<typeof fakeClock>, engine: SpeechEngine) {
  const calls = { started: 0, drained: [] as number[], broken: 0 };
  const queue = createSpeechQueue({
    engine,
    clock,
    onStart: () => {
      calls.started += 1;
    },
    onDrained: () => {
      calls.drained.push(clock.now());
    },
    onBroken: () => {
      calls.broken += 1;
    },
  });
  return { queue, calls };
}

describe("speech queue", () => {
  it("lets a short sentence wait behind a long one without switching speech off (the reviewer's case)", () => {
    // A streamed reply queues both sentences at once. The old code started the short sentence's
    // 6.7 s safety timer at queue time, while the long one still had 2 s to play: speech was
    // switched off for the rest of the call and LISTENING came while the question was still spoken.
    const reply =
      "Am Donnerstag, dem 3. Dezember, hätte ich um 14:30 Uhr oder um 16:00 Uhr noch einen Termin für einen Herrenhaarschnitt frei. Passt Ihnen einer davon?";
    const { sentences } = takeSentences(reply, true);
    assert.equal(sentences.length, 2);
    assert.ok(sentences[0].length > 120 && sentences[1].length < 30);

    const clock = fakeClock();
    const { engine, log } = fakeEngine(clock);
    const { queue, calls } = queueWith(clock, engine);
    for (const sentence of sentences) queue.speak(sentence);
    assert.equal(queue.pending(), 2);

    clock.advance(60_000);
    // Both sentences at 14 characters a second, each after the fake engine's 50 ms start latency.
    const spoken = ((sentences[0].length + sentences[1].length) / 14) * 1000 + 2 * 50;
    assert.equal(calls.broken, 0, "speech stays on");
    assert.equal(queue.works(), true);
    assert.equal(calls.started, 2);
    assert.equal(calls.drained.length, 1, "drained once");
    assert.ok(Math.abs(calls.drained[0] - spoken) < 1, `drained at ${calls.drained[0]} ms, the question ends at ${spoken} ms`);
    assert.equal(log.length, 4);
    assert.equal(queue.pending(), 0);
  });

  it("gives a slow first voice time to load", () => {
    const clock = fakeClock();
    const { engine } = fakeEngine(clock, { latencyMs: SPEECH_TIMING.startDeadlineMs - 500 });
    const { queue, calls } = queueWith(clock, engine);
    queue.speak("Grüezi, hier ist der KI-Assistent.");
    clock.advance(30_000);
    assert.equal(calls.broken, 0);
    assert.equal(calls.drained.length, 1);
  });

  it("reports speech as broken once when nothing ever plays, then speaks no more", () => {
    const clock = fakeClock();
    const silent = fakeEngine(clock, { silent: true });
    let asked = 0;
    const engine: SpeechEngine = {
      ...silent.engine,
      speak(text, callbacks) {
        asked += 1;
        silent.engine.speak(text, callbacks);
      },
    };
    const { queue, calls } = queueWith(clock, engine);
    queue.speak("Erster Satz.");
    queue.speak("Zweiter Satz.");
    clock.advance(SPEECH_TIMING.startDeadlineMs - 1);
    assert.equal(calls.broken, 0, "not before the deadline");
    clock.advance(1);
    assert.equal(calls.broken, 1);
    assert.deepEqual(calls.drained, [SPEECH_TIMING.startDeadlineMs], "the reply is not left hanging");
    assert.equal(queue.works(), false);
    assert.equal(queue.pending(), 0);
    queue.speak("Dritter Satz.");
    clock.advance(60_000);
    assert.equal(asked, 2, "nothing more is handed to the engine");
    assert.equal(calls.broken, 1, "said once");
  });

  it("finishes sentences whose end is never reported, without switching speech off", () => {
    const clock = fakeClock();
    const { engine } = fakeEngine(clock, { dropEnds: true });
    const { queue, calls } = queueWith(clock, engine);
    queue.speak("Ein Satz, dessen Ende die Maschine verschweigt.");
    queue.speak("Und noch einer.");
    clock.advance(60_000);
    assert.equal(calls.broken, 0);
    assert.equal(calls.started, 2, "the second sentence still played");
    assert.equal(calls.drained.length, 1);
    assert.equal(queue.pending(), 0);
  });

  it("waits while the engine is busy, then resets a stuck engine without calling speech broken", () => {
    const clock = fakeClock();
    const stuck = fakeEngine(clock, { stuck: true });
    const { queue, calls } = queueWith(clock, stuck.engine);
    queue.speak("Hallo.");
    const giveUpAt = SPEECH_TIMING.startDeadlineMs * (SPEECH_TIMING.maxStartWaits + 1);
    clock.advance(giveUpAt - 1);
    assert.equal(calls.drained.length, 0, "still waiting while something plays");
    clock.advance(1);
    assert.deepEqual(calls.drained, [giveUpAt]);
    assert.equal(calls.broken, 0);
    assert.equal(queue.works(), true, "the next reply tries again");
    assert.equal(stuck.cancels(), 1, "the engine was reset");
  });

  it("ignores a start that arrives for a sentence it already gave up on", () => {
    const clock = fakeClock();
    let late: SpeechCallbacks | null = null;
    const engine: SpeechEngine = {
      speak(_text, callbacks) {
        late = callbacks;
      },
      cancel() {},
      speaking: () => true,
    };
    const { queue, calls } = queueWith(clock, engine);
    queue.speak("Hallo.");
    clock.advance(60_000);
    assert.equal(calls.drained.length, 1);
    (late as SpeechCallbacks | null)?.start();
    (late as SpeechCallbacks | null)?.end();
    assert.equal(calls.started, 0, "no SPEAKING after the reply was closed");
    assert.equal(calls.drained.length, 1);
  });

  it("cancels at once and quietly (barge-in, end of the call)", () => {
    const clock = fakeClock();
    const { engine } = fakeEngine(clock);
    const { queue, calls } = queueWith(clock, engine);
    queue.speak("Ein Satz, der unterbrochen wird.");
    queue.speak("Und einer, der nie kommt.");
    clock.advance(500);
    assert.equal(calls.started, 1);
    queue.cancel();
    assert.equal(queue.pending(), 0);
    clock.advance(60_000);
    assert.deepEqual(calls.drained, [], "the caller's turn is the transport's to start, not the queue's");
    assert.equal(calls.broken, 0, "interrupted and canceled are our own doing");
    assert.equal(queue.works(), true);
  });

  it("switches speech off when the engine reports a real failure", () => {
    const clock = fakeClock();
    const engine: SpeechEngine = {
      speak(_text, callbacks) {
        clock.setTimeout(() => callbacks.error("synthesis-failed"), 10);
      },
      cancel() {},
      speaking: () => false,
    };
    const { queue, calls } = queueWith(clock, engine);
    queue.speak("Hallo.");
    clock.advance(100);
    assert.equal(calls.broken, 1);
    assert.equal(calls.drained.length, 1);
    assert.equal(queue.works(), false);
  });

  it("treats an engine that throws as broken, without throwing itself", () => {
    const clock = fakeClock();
    const engine: SpeechEngine = {
      speak() {
        throw new Error("no voices");
      },
      cancel() {
        throw new Error("nothing");
      },
      speaking: () => false,
    };
    const { queue, calls } = queueWith(clock, engine);
    assert.doesNotThrow(() => queue.speak("Hallo."));
    assert.equal(calls.broken, 1);
    assert.doesNotThrow(() => queue.cancel());
  });
});

// ---------------------------------------------------------------------------------------------
// Phones (interfaccia F5, defensive)
// ---------------------------------------------------------------------------------------------

describe("speech platform", () => {
  it("keeps the meter stream and listening while speaking on desktop browsers", () => {
    const desktop = [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
    ];
    for (const userAgent of desktop) {
      assert.deepEqual(speechPlatform({ userAgent, platform: "MacIntel", maxTouchPoints: 0 }), {
        holdsMeterStream: true,
        listensWhileSpeaking: true,
      });
    }
    assert.equal(speechPlatform(null).holdsMeterStream, true, "no navigator: nothing to be careful about");
  });

  it("holds no second microphone stream and does not listen over the answer on phones", () => {
    const phones = [
      { userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36" },
      { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" },
      // An iPad that asks for desktop pages says "Macintosh", but has a touch screen.
      { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15", platform: "MacIntel", maxTouchPoints: 5 },
    ];
    for (const facts of phones) {
      assert.deepEqual(speechPlatform(facts), { holdsMeterStream: false, listensWhileSpeaking: false }, facts.userAgent);
    }
  });
});

// ---------------------------------------------------------------------------------------------
// The live transports against a fake fetch
// ---------------------------------------------------------------------------------------------

const CONFIG: VoicePublicConfig = {
  tenant: "demo-test",
  kind: "demo",
  businessName: "Muster Test",
  sector: "hairdresser",
  locale: "de",
  locales: ["de", "it"],
  assistantName: { de: "der KI-Assistent von Muster Test" },
  greeting: { de: "Grüezi" },
  privacyUrl: { de: "/de/datenschutz" },
  limits: GRANT_LIMITS,
  modes: ["local", "scripted"],
  endpoints: { session: "/api/voice/session", turn: "/api/voice/turn", end: "/api/voice/end" },
};

interface Call {
  url: string;
  body: unknown;
  signal: AbortSignal | null;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const stream = (events: unknown[]) =>
  new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });

/**
 * Replaces fetch: the session answer is held until the test releases it; the rest via `turn`.
 * Like a browser's fetch, an aborted signal rejects a request that has not been answered yet.
 */
function fakeServer(turn: () => Response = () => json({ ok: true })) {
  const calls: Call[] = [];
  let release: (response: Response) => void = () => undefined;
  const sessionAnswer = new Promise<Response>((resolve) => {
    release = resolve;
  });
  const abortable = (answer: Promise<Response>, signal: AbortSignal | null) =>
    new Promise<Response>((resolve, reject) => {
      const abort = () => reject(new DOMException("The operation was aborted.", "AbortError"));
      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
      answer.then(resolve, reject);
    });
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const signal = init?.signal ?? null;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null, signal });
    if (url === CONFIG.endpoints.session) return abortable(sessionAnswer, signal);
    if (url === CONFIG.endpoints.turn) return turn();
    return json({ ok: true });
  }) as typeof fetch;
  return {
    calls,
    answerSession: (response: Response) => release(response),
    ends: () => calls.filter((call) => call.url === CONFIG.endpoints.end).map((call) => call.body),
  };
}

/** Lets the transport's promises run (fetch answers, body reads, stream decoding). */
async function settle(): Promise<void> {
  for (let round = 0; round < 10; round += 1) await new Promise((resolve) => setTimeout(resolve, 0));
}

function collect(transport: { onEvent: (listener: (event: VoiceTransportEvent) => void) => () => void }) {
  const events: VoiceTransportEvent[] = [];
  transport.onEvent((event) => events.push(event));
  return events;
}

describe("local transport", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("hands back a session the server admits after the visitor stopped (sicurezza F8)", async () => {
    const server = fakeServer();
    const transport = createLocalTransport({ config: CONFIG, locale: "de", input: "text" });
    const events = collect(transport);
    transport.start();
    assert.equal(server.calls.length, 1, "the session is being asked for");
    transport.stop("user");
    assert.equal(server.calls[0].signal?.aborted, false, "stopping does not cut the request: its answer is needed");
    server.answerSession(json(grant()));
    await settle();
    assert.deepEqual(server.ends(), [{ sessionToken: "token-1", reason: "user" }]);
    assert.deepEqual(events, [], "nothing reaches the widget after stop");
  });

  it("sends nothing back when the session was refused anyway", async () => {
    const server = fakeServer();
    const transport = createLocalTransport({ config: CONFIG, locale: "de", input: "text" });
    transport.start();
    transport.stop("unload");
    server.answerSession(json({ ok: false, error: "busy", retryAfter: 30 }, 503));
    await settle();
    assert.deepEqual(server.ends(), []);
  });

  it("runs a grant whose end warning is 0, and ends it with its token (sicurezza F12)", async () => {
    const server = fakeServer(() =>
      stream([
        { type: "start" },
        { type: "delta", text: "Grüezi, hier ist der KI-Assistent. " },
        { type: "delta", text: "Wie kann ich helfen?" },
        { type: "done", ended: false, remainingTurns: 5, remainingSeconds: 170 },
      ]),
    );
    const transport = createLocalTransport({ config: CONFIG, locale: "de", input: "text" });
    const events = collect(transport);
    transport.start();
    server.answerSession(json(grant({}, { warnBeforeEndSeconds: 0 })));
    await settle();
    assert.equal(events.some((event) => event.type === "FAIL"), false, JSON.stringify(events));
    const connected = events.find((event) => event.type === "CONNECTED");
    assert.deepEqual(connected, { type: "CONNECTED", limits: { ...GRANT_LIMITS, warnBeforeEndSeconds: 0 } });
    assert.deepEqual(
      events.map((event) => event.type).filter((type) => type !== "CAPTION"),
      ["CONNECTED", "THINKING", "REMAINING", "LISTENING"],
      "the greeting is shown (no speech engine here) and the caller's turn starts",
    );
    const turn = server.calls.find((call) => call.url === CONFIG.endpoints.turn);
    assert.deepEqual(turn?.body, { sessionToken: "token-1", text: "", locale: "de", opening: true });
    transport.stop("user");
    assert.deepEqual(server.ends(), [{ sessionToken: "token-1", reason: "user" }]);
  });

  it("captions a reply in the language it is written in (interfaccia F7)", async () => {
    const server = fakeServer(() =>
      stream([
        { type: "start" },
        { type: "delta", text: "Sì, sabato abbiamo ancora posto. " },
        { type: "delta", text: "Per quante persone?" },
        { type: "done", ended: false, remainingTurns: 5, remainingSeconds: 170 },
      ]),
    );
    const transport = createLocalTransport({ config: CONFIG, locale: "de", input: "text" });
    const events = collect(transport);
    transport.start();
    server.answerSession(json(grant()));
    await settle();
    const captions = events.filter((event) => event.type === "CAPTION");
    const last = captions[captions.length - 1];
    assert.equal(last?.type === "CAPTION" && last.caption.final, true);
    assert.equal(last?.type === "CAPTION" ? last.caption.locale : null, "it");
    transport.stop("user");
  });

  it("sends a turn again when the server is still finishing the previous one (409 turn_in_progress)", async () => {
    // After a barge-in the cut-off turn may still hold the server's one-turn-per-session lock.
    let turns = 0;
    const server = fakeServer(() => {
      turns += 1;
      return turns === 1
        ? json({ ok: false, error: "turn_in_progress" }, 409)
        : stream([{ type: "start" }, { type: "delta", text: "Grüezi." }, { type: "done", ended: false, remainingTurns: 5, remainingSeconds: 170 }]);
    });
    const transport = createLocalTransport({ config: CONFIG, locale: "de", input: "text" });
    const events = collect(transport);
    transport.start();
    server.answerSession(json(grant()));
    await settle();
    await new Promise((resolve) => setTimeout(resolve, busyRetryDelay(undefined, 1) + 50));
    await settle();
    assert.equal(turns, 2);
    assert.equal(events.some((event) => event.type === "FAIL"), false, JSON.stringify(events));
    assert.equal(events[events.length - 1]?.type, "LISTENING");
    transport.stop("user");
  });

  it("takes the reply language from the server when it announces one", async () => {
    const server = fakeServer(() =>
      stream([
        { type: "start", locale: "it" },
        { type: "delta", text: "Ok." },
        { type: "done", ended: false, remainingTurns: 5, remainingSeconds: 170 },
      ]),
    );
    const transport = createLocalTransport({ config: CONFIG, locale: "de", input: "text" });
    const events = collect(transport);
    transport.start();
    server.answerSession(json(grant()));
    await settle();
    const caption = events.find((event) => event.type === "CAPTION");
    assert.equal(caption?.type === "CAPTION" ? caption.caption.locale : null, "it");
    transport.stop("user");
  });
});

describe("one turn at a time", () => {
  it("reads a 409 as turn_in_progress, with or without the server's JSON", async () => {
    assert.deepEqual(await readFailure(json({ ok: false, error: "turn_in_progress", retryAfter: 2 }, 409)), {
      code: "turn_in_progress",
      retryAfter: 2,
    });
    assert.equal((await readFailure(new Response("<html>conflict</html>", { status: 409 }))).code, "turn_in_progress");
    assert.equal(isTurnStreamEvent({ type: "error", code: "turn_in_progress" }), true);
  });

  it("waits as the server asks, within bounds, and backs off without an answer", () => {
    assert.equal(busyRetryDelay(2, 1), 2_000);
    assert.equal(busyRetryDelay(100, 1), 5_000, "never longer than 5 s per wait");
    assert.equal(busyRetryDelay(0.01, 1), 250, "never a busy loop");
    assert.equal(busyRetryDelay(undefined, 1), 400);
    assert.equal(busyRetryDelay(undefined, 3), 1_200);
    assert.equal(busyRetryDelay(undefined, 50), 2_000);
  });
});

describe("realtime transport", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("hands back a session the server admits after the visitor stopped (sicurezza F8)", async () => {
    const server = fakeServer();
    const transport = createRealtimeTransport({ config: { ...CONFIG, modes: ["realtime", "scripted"] }, locale: "de" });
    transport.start();
    transport.stop("user");
    assert.equal(server.calls[0].signal?.aborted, false);
    server.answerSession(json(grant({ mode: "realtime" })));
    await settle();
    assert.deepEqual(server.ends(), [{ sessionToken: "token-1", reason: "user" }]);
  });

  it("hands the session back once when the connection cannot be made yet", async () => {
    const server = fakeServer();
    const transport = createRealtimeTransport({ config: { ...CONFIG, modes: ["realtime", "scripted"] }, locale: "de" });
    const events = collect(transport);
    transport.start();
    server.answerSession(json(grant({ mode: "realtime" })));
    await settle();
    assert.deepEqual(events.map((event) => event.type), ["CONNECTING", "FAIL"]);
    transport.stop("error");
    transport.stop("error");
    assert.deepEqual(server.ends(), [{ sessionToken: "token-1", reason: "error" }]);
  });
});

// ---------------------------------------------------------------------------------------------
// The orb's loop (interfaccia F10)
// ---------------------------------------------------------------------------------------------

describe("orb pacing", () => {
  it("runs at full rate in a conversation and while a change is still easing in", () => {
    for (const status of ["listening", "thinking", "speaking", "connecting", "consent"] as const) {
      assert.equal(orbCadence(status, true, false), "full", status);
    }
    assert.equal(orbCadence("ended", false, false), "full", "the dimming is still under way");
  });

  it("breathes slowly when idle, and stops once an ended or failed orb has dimmed", () => {
    assert.equal(orbCadence("idle", true, false), "slow");
    assert.equal(orbCadence("ended", true, false), "stop");
    assert.equal(orbCadence("error", true, false), "stop");
    assert.equal(orbCadence("speaking", false, true), "still", "reduced motion: still frames only");
  });

  it("settles within a few seconds of the end, so the loop really stops", () => {
    let look = targetLook("speaking", 0.8, false);
    const goal = targetLook("ended", 0, false);
    assert.equal(lookSettled(look, goal, 0), false);
    let frames = 0;
    while (!lookSettled(look, goal, 0) && frames < 60 * 10) {
      look = easeLook(look, goal, 1 / 60);
      frames += 1;
    }
    assert.ok(frames < 60 * 5, `settled after ${frames} frames`);
    assert.equal(lookSettled(look, goal, 0.3), false, "a level still dying down keeps it running");
  });
});
