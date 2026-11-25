// The voice widget's conversation machine (components/voice/voice-machine.ts), plus the pure
// helpers the live transports feed it with: the turn-stream decoder (transports/http.ts) and the
// speech text helpers (transports/speech-text.ts). No browser, no React, no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  initVoiceState,
  isActive,
  MAX_CAPTIONS,
  recoveryFor,
  timerVisible,
  toEndRequestReason,
  VOICE_END_REASONS,
  VOICE_FAILURE_CODES,
  VOICE_STATUSES,
  voiceReducer,
  type VoiceCaption,
  type VoiceEvent,
  type VoiceMachineState,
} from "@/components/voice/voice-machine";
import { createSseDecoder, isSessionGrant, isTurnStreamEvent } from "@/components/voice/transports/http";
import { isEcho, MAX_UTTERANCE_CHARS, pickVoice, takeSentences, toSpeakable } from "@/components/voice/transports/speech-text";

const LIMITS = { maxCallSeconds: 120, warnBeforeEndSeconds: 20, silenceTimeoutSeconds: 10, maxTurnChars: 300 };

const fresh = (): VoiceMachineState => initVoiceState({ locale: "de", locales: ["de", "it", "en", "fr"], limits: LIMITS });
const run = (state: VoiceMachineState, ...events: VoiceEvent[]) => events.reduce(voiceReducer, state);
const caption = (id: string, role: VoiceCaption["role"], text: string, final = true): VoiceEvent => ({
  type: "CAPTION",
  caption: { id, role, text, final, locale: "de" },
});

/** A local conversation, connected and waiting for the caller. */
function listeningLocal(): VoiceMachineState {
  return run(fresh(), { type: "START", mode: "local" }, { type: "CONSENT", input: "voice" }, { type: "MIC_GRANTED" }, { type: "CONNECTED" });
}

function playingScripted(): VoiceMachineState {
  return run(fresh(), { type: "START", mode: "scripted" }, { type: "CONNECTED" });
}

describe("starting a conversation", () => {
  it("starts idle, with the tenant's limits and no microphone anywhere", () => {
    const state = fresh();
    assert.equal(state.status, "idle");
    assert.equal(state.mode, null);
    assert.equal(state.limits.silenceTimeoutSeconds, 10);
    assert.equal(state.secondsLeft, null);
  });

  it("requests the microphone only after an explicit start and an explicit consent", () => {
    // Nothing a transport could send reaches the microphone step from idle.
    for (const event of [
      { type: "CONSENT", input: "voice" },
      { type: "MIC_GRANTED" },
      { type: "CONNECTING" },
      { type: "CONNECTED" },
      { type: "LISTENING" },
    ] as VoiceEvent[]) {
      assert.equal(voiceReducer(fresh(), event).status, "idle", `${event.type} must not leave idle`);
    }
    const consent = run(fresh(), { type: "START", mode: "local" });
    assert.equal(consent.status, "consent", "a live start asks first");
    assert.equal(voiceReducer(consent, { type: "MIC_GRANTED" }).status, "consent", "no grant before the consent");
    assert.equal(voiceReducer(consent, { type: "CONSENT", input: "voice" }).status, "requesting_mic");
  });

  it("starts an example without consent and without the microphone step", () => {
    const state = run(fresh(), { type: "START", mode: "scripted" });
    assert.equal(state.status, "connecting");
    assert.equal(voiceReducer(state, { type: "MIC_GRANTED" }).status, "connecting");
  });

  it("goes straight to connecting, typed, when the visitor would rather type", () => {
    const state = run(fresh(), { type: "START", mode: "local" }, { type: "CONSENT", input: "text" });
    assert.equal(state.status, "connecting");
    assert.equal(state.typed, true);
  });

  it("cancels the consent back to idle", () => {
    const state = run(fresh(), { type: "START", mode: "realtime" }, { type: "CANCEL" });
    assert.equal(state.status, "idle");
    assert.equal(state.mode, null);
  });

  it("reports a refused microphone as an error with its code", () => {
    const state = run(fresh(), { type: "START", mode: "local" }, { type: "CONSENT", input: "voice" }, { type: "MIC_FAILED", code: "mic_denied" });
    assert.equal(state.status, "error");
    assert.equal(state.errorCode, "mic_denied");
  });

  it("lets a transport go on without the microphone (realtime seam)", () => {
    const state = run(fresh(), { type: "START", mode: "realtime" }, { type: "CONSENT", input: "voice" }, { type: "CONNECTING" });
    assert.equal(state.status, "connecting");
  });

  it("starts the call clock on CONNECTED, with the server's limits", () => {
    const state = run(
      fresh(),
      { type: "START", mode: "local" },
      { type: "CONSENT", input: "voice" },
      { type: "MIC_GRANTED" },
      { type: "CONNECTED", limits: { maxCallSeconds: 90, silenceTimeoutSeconds: 15 } },
    );
    assert.equal(state.status, "listening");
    assert.equal(state.secondsLeft, 90);
    assert.equal(state.limits.silenceTimeoutSeconds, 15);
    assert.equal(state.limits.maxTurnChars, 300, "limits not sent stay as they were");
  });

  it("runs no clock for an example", () => {
    assert.equal(playingScripted().secondsLeft, null);
  });
});

describe("turn-taking", () => {
  it("moves listening → thinking → speaking → listening", () => {
    let state = listeningLocal();
    state = run(state, { type: "THINKING" });
    assert.equal(state.status, "thinking");
    state = run(state, { type: "SPEAKING" });
    assert.equal(state.status, "speaking");
    state = run(state, { type: "LISTENING" });
    assert.equal(state.status, "listening");
  });

  it("goes back to listening when the caller interrupts the assistant", () => {
    const state = run(listeningLocal(), { type: "THINKING" }, { type: "SPEAKING" }, { type: "INTERRUPT" });
    assert.equal(state.status, "listening");
    assert.equal(state.silentSeconds, 0);
  });

  it("ignores an interruption when the assistant is not speaking", () => {
    assert.equal(run(listeningLocal(), { type: "INTERRUPT" }).status, "listening");
    assert.equal(run(listeningLocal(), { type: "THINKING" }, { type: "INTERRUPT" }).status, "thinking");
  });

  it("shows the running tool and clears it when it finishes", () => {
    let state = run(listeningLocal(), { type: "THINKING" }, { type: "TOOL", name: "check_availability", status: "started" });
    assert.equal(state.activeTool, "check_availability");
    state = run(state, { type: "TOOL", name: "check_availability", status: "ok" });
    assert.equal(state.activeTool, null);
  });

  it("keeps the handoff notice", () => {
    const state = run(listeningLocal(), { type: "HANDOFF", handoff: { kind: "callback" } });
    assert.deepEqual(state.handoff, { kind: "callback" });
  });
});

describe("captions", () => {
  it("replaces an interim line by its final version", () => {
    let state = run(listeningLocal(), caption("c-1", "caller", "Ich möchte", false));
    state = run(state, caption("c-1", "caller", "Ich möchte einen Termin", true));
    assert.equal(state.captions.length, 1);
    assert.equal(state.captions[0].text, "Ich möchte einen Termin");
    assert.equal(state.captions[0].final, true);
  });

  it("never reopens a finished line with a late interim result", () => {
    const state = run(listeningLocal(), caption("c-1", "caller", "Ja"), caption("c-1", "caller", "J", false));
    assert.equal(state.captions[0].text, "Ja");
    assert.equal(state.captions[0].final, true);
  });

  it("skips empty lines", () => {
    assert.equal(run(listeningLocal(), caption("c-1", "caller", "   ", false)).captions.length, 0);
  });

  it("keeps at most MAX_CAPTIONS lines, dropping the oldest", () => {
    let state = listeningLocal();
    for (let index = 0; index < MAX_CAPTIONS + 5; index += 1) state = voiceReducer(state, caption(`l-${index}`, "assistant", `Zeile ${index}`));
    assert.equal(state.captions.length, MAX_CAPTIONS);
    assert.equal(state.captions[0].id, "l-5");
  });

  it("finalizes the lines on screen when the conversation ends", () => {
    const state = run(listeningLocal(), caption("c-1", "caller", "Ich hätte", false), { type: "END", reason: "user" });
    assert.equal(state.captions[0].final, true);
  });

  it("clears the no-speech hint when the caller speaks", () => {
    const state = run(listeningLocal(), { type: "NOTICE", notice: "no_speech" }, caption("c-1", "caller", "Hallo", false));
    assert.equal(state.notice, null);
  });
});

describe("ending", () => {
  it("ends the conversation with reason timeout when the clock reaches zero", () => {
    let state = run(listeningLocal(), { type: "THINKING" });
    state = run(state, { type: "TICK", seconds: 60 });
    assert.equal(state.secondsLeft, 60);
    state = run(state, { type: "TICK", seconds: 60 });
    assert.equal(state.status, "ended");
    assert.equal(state.endReason, "timeout");
    assert.equal(state.secondsLeft, 0);
  });

  it("ends the conversation with reason silence after the silence limit", () => {
    let state = listeningLocal();
    for (let second = 0; second < 9; second += 1) state = run(state, { type: "TICK" });
    assert.equal(state.status, "listening");
    state = run(state, { type: "TICK" });
    assert.equal(state.status, "ended");
    assert.equal(state.endReason, "silence");
  });

  it("restarts the silence count on caller activity", () => {
    let state = listeningLocal();
    for (let second = 0; second < 9; second += 1) state = run(state, { type: "TICK" });
    state = run(state, { type: "ACTIVITY" }, { type: "TICK" }, { type: "TICK" });
    assert.equal(state.status, "listening");
    assert.equal(state.silentSeconds, 2);
  });

  it("does not count silence while the assistant thinks or speaks", () => {
    let state = run(listeningLocal(), { type: "THINKING" });
    for (let second = 0; second < 20; second += 1) state = run(state, { type: "TICK" });
    assert.equal(state.status, "thinking");
    assert.equal(state.silentSeconds, 0);
  });

  it("lets the server lower the seconds left, never raise them", () => {
    let state = run(listeningLocal(), { type: "REMAINING", seconds: 45 });
    assert.equal(state.secondsLeft, 45);
    state = run(state, { type: "REMAINING", seconds: 100 });
    assert.equal(state.secondsLeft, 45);
  });

  it("shows the timer only in the last 30 seconds of a live call", () => {
    let state = listeningLocal();
    assert.equal(timerVisible(state), false);
    state = run(state, { type: "REMAINING", seconds: 30 });
    assert.equal(timerVisible(state), true);
  });

  it("ignores ticks for an example", () => {
    const state = run(playingScripted(), { type: "TICK", seconds: 999 });
    assert.equal(state.status, "listening");
  });

  it("treats ended and error as terminal until reset", () => {
    const ended = run(listeningLocal(), { type: "END", reason: "user" });
    const failed = run(listeningLocal(), { type: "FAIL", code: "upstream" });
    const afterwards: VoiceEvent[] = [
      { type: "START", mode: "local" },
      { type: "CONNECTED" },
      { type: "LISTENING" },
      { type: "SPEAKING" },
      caption("late", "assistant", "Noch etwas"),
      { type: "MUTE", muted: true },
      { type: "TICK", seconds: 5 },
      { type: "END", reason: "assistant" },
      { type: "FAIL", code: "timeout" },
      { type: "TYPED" },
    ];
    for (const terminal of [ended, failed]) {
      for (const event of afterwards) {
        assert.equal(voiceReducer(terminal, event), terminal, `${terminal.status} must ignore ${event.type}`);
      }
      const reset = voiceReducer(terminal, { type: "RESET" });
      assert.equal(reset.status, "idle");
      assert.equal(reset.captions.length, 0);
      assert.equal(reset.errorCode, null);
      assert.equal(reset.endReason, null);
      assert.equal(reset.run, terminal.run + 1);
    }
  });

  it("keeps the retry delay of a failure", () => {
    const state = run(listeningLocal(), { type: "FAIL", code: "busy", retryAfter: 12.2 });
    assert.equal(state.retryAfter, 13);
  });

  it("ignores a failure before anything started", () => {
    assert.equal(voiceReducer(fresh(), { type: "FAIL", code: "network" }).status, "idle");
  });
});

describe("mute", () => {
  it("is possible in a live conversation", () => {
    const state = run(listeningLocal(), { type: "MUTE", muted: true });
    assert.equal(state.muted, true);
    assert.equal(run(state, { type: "MUTE", muted: false }).muted, false);
  });

  it("is impossible in an example, before the start, without a microphone and after the end", () => {
    assert.equal(run(playingScripted(), { type: "MUTE", muted: true }).muted, false, "scripted");
    assert.equal(run(fresh(), { type: "MUTE", muted: true }).muted, false, "idle");
    const typed = run(fresh(), { type: "START", mode: "local" }, { type: "CONSENT", input: "text" }, { type: "CONNECTED" });
    assert.equal(run(typed, { type: "MUTE", muted: true }).muted, false, "typed input has no microphone");
    const ended = run(listeningLocal(), { type: "END", reason: "user" });
    assert.equal(run(ended, { type: "MUTE", muted: true }).muted, false, "ended");
  });

  it("is dropped by a fallback to typing", () => {
    const state = run(listeningLocal(), { type: "MUTE", muted: true }, { type: "TYPED" });
    assert.equal(state.typed, true);
    assert.equal(state.muted, false);
  });
});

describe("language", () => {
  it("switches to the tenant's languages only", () => {
    const state = initVoiceState({ locale: "de", locales: ["de", "it"], limits: LIMITS });
    assert.equal(voiceReducer(state, { type: "SET_LOCALE", locale: "it" }).locale, "it");
    assert.equal(voiceReducer(state, { type: "SET_LOCALE", locale: "fr" }), state);
  });

  it("falls back to the first allowed language when the initial one is not allowed", () => {
    assert.equal(initVoiceState({ locale: "fr", locales: ["de", "it"] }).locale, "de");
  });
});

describe("robustness", () => {
  it("never throws and always lands on a known state, whatever the order of events", () => {
    const events: VoiceEvent[] = [
      { type: "START", mode: "local" },
      { type: "START", mode: "scripted" },
      { type: "START", mode: "realtime" },
      { type: "CONSENT", input: "voice" },
      { type: "CONSENT", input: "text" },
      { type: "CANCEL" },
      { type: "MIC_GRANTED" },
      { type: "MIC_FAILED", code: "mic_unavailable" },
      { type: "CONNECTING" },
      { type: "CONNECTED", limits: { maxCallSeconds: Number.NaN } },
      { type: "LISTENING" },
      { type: "THINKING" },
      { type: "SPEAKING" },
      { type: "INTERRUPT" },
      caption("x", "caller", "Hallo", false),
      { type: "TOOL", name: "book_appointment", status: "started" },
      { type: "TOOL", name: "book_appointment", status: "failed" },
      { type: "HANDOFF", handoff: { kind: "transfer", targetLabel: "Inhaber" } },
      { type: "NOTICE", notice: "no_synthesis" },
      { type: "TYPED" },
      { type: "ACTIVITY" },
      { type: "TICK", seconds: 3 },
      { type: "TICK", seconds: -4 },
      { type: "REMAINING", seconds: Number.POSITIVE_INFINITY },
      { type: "MUTE", muted: true },
      { type: "END", reason: "silence" },
      { type: "FAIL", code: "refused" },
      { type: "SET_LOCALE", locale: "en" },
      { type: "RESET" },
    ];
    // A deterministic pseudo-random walk: the same sequence on every run.
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };
    let state = fresh();
    for (let step = 0; step < 5000; step += 1) {
      state = voiceReducer(state, events[next() % events.length]);
      assert.ok((VOICE_STATUSES as readonly string[]).includes(state.status));
      assert.ok(state.limits.maxCallSeconds > 0, "a NaN limit never gets in");
      if (state.secondsLeft !== null) assert.ok(Number.isFinite(state.secondsLeft) && state.secondsLeft >= 0);
    }
  });

  it("reports which states count as active", () => {
    assert.equal(isActive("idle"), false);
    assert.equal(isActive("consent"), true);
    assert.equal(isActive("speaking"), true);
    assert.equal(isActive("ended"), false);
    assert.equal(isActive("error"), false);
  });
});

describe("recovery", () => {
  it("offers at least one way forward for every failure, in every mode", () => {
    for (const code of VOICE_FAILURE_CODES) {
      for (const mode of ["scripted", "local", "realtime", null] as const) {
        for (const hasScripts of [true, false]) {
          for (const hasContact of [true, false]) {
            const actions = recoveryFor(code, { mode, hasScripts, hasContact });
            assert.ok(actions.length > 0, `${code} in ${mode}`);
            assert.equal(new Set(actions).size, actions.length, "no duplicates");
            if (!hasContact) assert.ok(!actions.includes("contact"));
            if (mode === "scripted" || !hasScripts) assert.ok(!actions.includes("watch_example"));
            if (mode !== "local") assert.ok(!actions.includes("type_instead"));
          }
        }
      }
    }
  });

  it("offers typing when the microphone is refused in local mode", () => {
    assert.deepEqual(recoveryFor("mic_denied", { mode: "local", hasScripts: false, hasContact: false }), ["retry", "type_instead"]);
  });

  it("offers the example when the live voice is not available", () => {
    assert.deepEqual(recoveryFor("not_available_yet", { mode: "realtime", hasScripts: true, hasContact: true }), [
      "watch_example",
      "contact",
    ]);
  });

  it("maps the widget's end reasons onto the contract's", () => {
    for (const reason of VOICE_END_REASONS) {
      assert.ok(["user", "assistant", "timeout", "silence", "error", "unload"].includes(toEndRequestReason(reason)));
    }
    assert.equal(toEndRequestReason("limit"), "assistant");
  });
});

// ---------------------------------------------------------------------------------------------
// What the live transports feed the machine with
// ---------------------------------------------------------------------------------------------

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

  it("recognises a session grant and nothing else", () => {
    const grant = {
      ok: true,
      sessionToken: "t",
      mode: "local",
      locale: "de",
      expiresAt: 1,
      limits: { maxCallSeconds: 180, warnBeforeEndSeconds: 20, silenceTimeoutSeconds: 25, maxTurnChars: 600 },
    };
    assert.equal(isSessionGrant(grant), true);
    assert.equal(isSessionGrant({ ...grant, sessionToken: "" }), false);
    assert.equal(isSessionGrant({ ...grant, mode: "phone" }), false);
    assert.equal(isSessionGrant({ ok: false, error: "busy" }), false);
  });
});

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
