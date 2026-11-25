// Mode "scripted" (components/voice/transports/scripted.ts): the pure scheduler that turns an
// example conversation into timed machine events, the loudness the orb gets from it, and the
// transport playing it on real (but very short) timers. Replaying a schedule through the reducer
// must always end the example cleanly, for the hand-written fixture and for every demo script.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  createScriptedTransport,
  levelAt,
  lineDuration,
  schedule,
  SCRIPT_TIMING,
  speechEnvelope,
  type ScriptStep,
} from "@/components/voice/transports/scripted";
import { initVoiceState, voiceReducer, type VoiceEvent, type VoiceTransportEvent } from "@/components/voice/voice-machine";
import { getVoiceStrings } from "@/lib/voice/i18n";
import { DEMO_SCRIPTS } from "@/lib/voice/demos";
import {
  VOICE_LOCALES,
  VOICE_TOOLS,
  type DemoScript,
  type VoicePublicConfig,
} from "@/lib/voice/types";

const SCRIPT: DemoScript = {
  id: "demo-test.de.termin",
  tenantId: "demo-test",
  locale: "de",
  title: "Ein Termin",
  shows: "Ein Termin wird gebucht.",
  lines: [
    { role: "assistant", text: "Grüezi, hier ist der KI-Assistent von Muster Test. Wie kann ich helfen?" },
    { role: "caller", text: "Ich hätte gern einen Termin am Dienstag." },
    {
      role: "assistant",
      text: "Am Dienstag ist um zehn Uhr etwas frei. Passt das?",
      tool: { name: "check_availability", input: { service_id: "x", date: "2026-12-01" }, outcome: "ok" },
    },
    { role: "caller", text: "Ja." },
    { role: "caller", text: "Danke." },
    { role: "assistant", text: "Gern. Auf Wiederhören." },
  ],
};

const captionsOf = (steps: ScriptStep[]) =>
  steps.filter((step): step is ScriptStep & { event: Extract<VoiceTransportEvent, { type: "CAPTION" }> } => step.event.type === "CAPTION");

/** Plays a schedule through the machine, from the start button on. */
function replay(script: DemoScript) {
  const plan = schedule(script);
  let state = voiceReducer(initVoiceState({ locale: script.locale, locales: [script.locale] }), { type: "START", mode: "scripted" });
  const statuses: string[] = [state.status];
  for (const step of plan.steps) {
    state = voiceReducer(state, step.event as VoiceEvent);
    if (statuses[statuses.length - 1] !== state.status) statuses.push(state.status);
  }
  return { plan, state, statuses };
}

describe("schedule", () => {
  it("starts connected at 0 and ends the example last", () => {
    const plan = schedule(SCRIPT);
    assert.deepEqual(plan.steps[0], { at: 0, event: { type: "CONNECTED" } });
    const last = plan.steps[plan.steps.length - 1];
    assert.deepEqual(last.event, { type: "END", reason: "complete" });
    assert.equal(last.at, plan.durationMs);
  });

  it("keeps the steps in time order", () => {
    const { steps } = schedule(SCRIPT);
    for (let index = 1; index < steps.length; index += 1) assert.ok(steps[index].at >= steps[index - 1].at);
  });

  it("captions every line once, in order, final, with the script's language", () => {
    const captions = captionsOf(schedule(SCRIPT).steps);
    assert.deepEqual(
      captions.map((step) => [step.event.caption.id, step.event.caption.role, step.event.caption.text]),
      SCRIPT.lines.map((line, index) => [`${SCRIPT.id}#${index}`, line.role, line.text]),
    );
    for (const step of captions) {
      assert.equal(step.event.caption.final, true);
      assert.equal(step.event.caption.locale, "de");
    }
  });

  it("gives each line its reading time at about 14 characters per second", () => {
    assert.equal(SCRIPT_TIMING.charsPerSecond, 14);
    assert.equal(lineDuration("x".repeat(140)), 10_000);
    assert.equal(lineDuration("Ja."), SCRIPT_TIMING.minLineMs, "a short line still stays a moment");
    const plan = schedule(SCRIPT);
    plan.windows.forEach((window, index) => {
      assert.equal(window.to - window.from, lineDuration(SCRIPT.lines[index].text));
    });
  });

  it("pauses between speakers, and less between two lines of the same speaker", () => {
    const plan = schedule(SCRIPT);
    const captions = captionsOf(plan.steps);
    for (let index = 1; index < captions.length; index += 1) {
      const gap = captions[index].at - plan.windows[index - 1].to;
      const sameSpeaker = SCRIPT.lines[index].role === SCRIPT.lines[index - 1].role;
      const toolTime = SCRIPT.lines[index].tool ? SCRIPT_TIMING.toolMs : 0;
      assert.equal(gap, (sameSpeaker ? SCRIPT_TIMING.samePauseMs : SCRIPT_TIMING.speakerPauseMs) + toolTime, `before line ${index}`);
    }
  });

  it("shows a tool step before the line that needs it", () => {
    const { steps } = schedule(SCRIPT);
    const started = steps.findIndex((step) => step.event.type === "TOOL" && step.event.status === "started");
    const finished = steps.findIndex((step) => step.event.type === "TOOL" && step.event.status === "ok");
    const line = steps.findIndex((step) => step.event.type === "CAPTION" && step.event.caption.id === `${SCRIPT.id}#2`);
    assert.ok(started !== -1 && started < finished && finished < line);
    assert.equal(steps[started - 1]?.event.type, "THINKING", "the orb thinks while the calendar is checked");
    assert.equal(steps[finished].at - steps[started].at, SCRIPT_TIMING.toolMs);
  });

  it("marks a failed tool as failed", () => {
    const failing: DemoScript = {
      ...SCRIPT,
      lines: [{ role: "assistant", text: "Leider nichts frei.", tool: { name: "check_availability", input: {}, outcome: "failed" } }],
    };
    const statuses = schedule(failing).steps.filter((step) => step.event.type === "TOOL").map((step) => (step.event as { status: string }).status);
    assert.deepEqual(statuses, ["started", "failed"]);
  });

  it("ignores a tool on a caller line and skips empty lines", () => {
    const odd: DemoScript = {
      ...SCRIPT,
      lines: [
        { role: "caller", text: "Hallo", tool: { name: "end_call", input: {}, outcome: "ok" } },
        { role: "assistant", text: "   " },
        { role: "assistant", text: "Grüezi." },
      ],
    };
    const plan = schedule(odd);
    assert.equal(plan.steps.some((step) => step.event.type === "TOOL"), false);
    assert.equal(captionsOf(plan.steps).length, 2);
  });

  it("has a label for every tool step, in every language", () => {
    for (const locale of VOICE_LOCALES) {
      const tools = getVoiceStrings(locale).tools;
      for (const tool of VOICE_TOOLS) assert.ok(tools[tool]?.trim(), `${locale}.${tool}`);
    }
    assert.equal(getVoiceStrings("en").tools.check_availability, "Checking the calendar");
  });

  it("plays through the machine to a clean end", () => {
    const { state, statuses } = replay(SCRIPT);
    assert.equal(state.status, "ended");
    assert.equal(state.endReason, "complete");
    assert.equal(state.captions.length, SCRIPT.lines.length);
    assert.equal(state.activeTool, null, "the tool step is over");
    assert.equal(state.secondsLeft, null, "an example has no clock");
    for (const status of ["connecting", "listening", "speaking", "thinking", "ended"]) {
      assert.ok(statuses.includes(status), `passes through ${status}`);
    }
  });
});

describe("demo scripts", () => {
  it("every demo script plays to a clean end with every line captioned", () => {
    assert.ok(DEMO_SCRIPTS.length > 0);
    for (const script of DEMO_SCRIPTS) {
      const { state, plan } = replay(script);
      const spoken = script.lines.filter((line) => line.text.trim() !== "").length;
      assert.equal(state.status, "ended", script.id);
      assert.equal(state.endReason, "complete", script.id);
      assert.equal(state.captions.length, spoken, script.id);
      // A watchable length: long enough to read, short enough to stay with it.
      assert.ok(plan.durationMs > 5_000 && plan.durationMs < 5 * 60_000, `${script.id}: ${plan.durationMs} ms`);
    }
  });
});

describe("loudness for the orb", () => {
  it("is silent in the pauses and between 0 and 1 while a line is on", () => {
    const plan = schedule(SCRIPT);
    assert.equal(levelAt(plan, 0), 0, "before the first line");
    assert.equal(levelAt(plan, plan.windows[0].to + 1), 0, "in the pause after it");
    let loudest = 0;
    for (let ms = plan.windows[0].from; ms <= plan.windows[0].to; ms += 25) {
      const level = levelAt(plan, ms);
      assert.ok(level >= 0 && level <= 1);
      loudest = Math.max(loudest, level);
    }
    assert.ok(loudest > 0.3, "a spoken line moves the orb");
  });

  it("is deterministic and bounded", () => {
    for (const elapsed of [-1, 0, 50, 999, 1000, 1001]) {
      const value = speechEnvelope("Grüezi mitenand.", elapsed, 1000);
      assert.equal(value, speechEnvelope("Grüezi mitenand.", elapsed, 1000));
      assert.ok(value >= 0 && value <= 1);
    }
    assert.equal(speechEnvelope("Hallo", 1200, 1000), 0, "after the line");
    assert.equal(speechEnvelope("", 10, 1000), 0);
  });
});

describe("scripted transport", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  const config = (modes: VoicePublicConfig["modes"]): VoicePublicConfig => ({
    tenant: "demo-test",
    kind: "demo",
    businessName: "Muster Test",
    sector: "hairdresser",
    locale: "de",
    locales: ["de"],
    assistantName: { de: "der KI-Assistent von Muster Test" },
    greeting: { de: "Grüezi" },
    privacyUrl: { de: "/de/datenschutz" },
    limits: { maxCallSeconds: 180, warnBeforeEndSeconds: 20, silenceTimeoutSeconds: 25, maxTurnChars: 600 },
    modes,
    endpoints: { session: "/api/voice/session", turn: "/api/voice/turn", end: "/api/voice/end" },
  });

  // Everything a few milliseconds long: the order of events is what is tested.
  const FAST = { charsPerSecond: 1_000_000, speakerPauseMs: 1, samePauseMs: 1, toolMs: 1, leadInMs: 1, minLineMs: 1, tailMs: 1 };

  function play(modes: VoicePublicConfig["modes"]) {
    const requests: unknown[] = [];
    globalThis.fetch = (async (_url: unknown, init?: { body?: unknown }) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: false, error: "unavailable" }), { status: 503 });
    }) as typeof fetch;
    const transport = createScriptedTransport({ config: config(modes), locale: "de", script: SCRIPT, timing: FAST });
    const events: VoiceTransportEvent[] = [];
    const done = new Promise<void>((resolve) => {
      transport.onEvent((event) => {
        events.push(event);
        if (event.type === "END") resolve();
      });
    });
    return { transport, events, done, requests };
  }

  it("emits the whole schedule in order on its timers, with no request when scripted is all there is", async () => {
    const { transport, events, done, requests } = play(["scripted"]);
    transport.start();
    await done;
    assert.deepEqual(
      events,
      schedule(SCRIPT, FAST).steps.map((step) => step.event),
    );
    assert.equal(requests.length, 0, "no network for a scripted-only server");
    transport.stop("complete");
  });

  it("announces the start with a session request when the server offers more, and plays whatever the answer", async () => {
    const { transport, done, requests } = play(["local", "scripted"]);
    transport.start();
    await done;
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0], { tenant: "demo-test", locale: "de", mode: "scripted", hp: "" });
    transport.stop("complete");
  });

  it("emits nothing after stop and keeps quiet", async () => {
    const { transport, events } = play(["scripted"]);
    transport.start();
    transport.stop("user");
    const count = events.length;
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(events.length, count);
    assert.equal(transport.getLevel(), 0);
    assert.equal(transport.sendText("Hallo"), false, "an example takes no input");
  });
});
