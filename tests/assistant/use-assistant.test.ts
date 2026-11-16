// The widget's conversation state (components/assistant/use-assistant.ts), through its pure
// reducer and storage helpers: no React rendering, no network. sessionStorage is an in-memory
// stand-in on a fake `window`.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  assistantReducer,
  assistantStorageKey,
  initAssistantState,
  saveAssistantState,
  toHistory,
  type AssistantAction,
  type AssistantState,
  type ChatMessage,
} from "@/components/assistant/use-assistant";
import type { AssistantPublicConfig } from "@/lib/assistant/types";

const CONFIG: AssistantPublicConfig = {
  tenant: "test",
  locale: "en",
  locales: ["en", "de", "it"],
  branding: { name: "Test Studio", assistantName: { en: "Test assistant" }, theme: "light" },
  welcome: { en: "Hi!" },
  starters: {},
  contact: { email: "info@example.com" },
  defaultRegion: "ch",
  privacyUrl: { en: "/privacy" },
  hiddenOnPathSegments: [],
  leads: { enabled: true, services: [], budgetOptions: {}, requireCompany: false, requirePhone: false, retentionDays: 365 },
  limits: { maxMessageChars: 800, maxUserMessagesPerSession: 30 },
  endpoints: { chat: "/api/assistant/chat", lead: "/api/assistant/lead" },
};
const KEY = assistantStorageKey(CONFIG.tenant);

let storage = new Map<string, string>();

beforeEach(() => {
  storage = new Map();
  Reflect.set(globalThis, "window", {
    sessionStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => void storage.set(key, String(value)),
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "window");
});

const question = (id: string, text: string): ChatMessage => ({ id, role: "user", text, status: "done" });
const run = (state: AssistantState, ...actions: AssistantAction[]) => actions.reduce(assistantReducer, state);
const send = (id: string, text: string): AssistantAction => ({ type: "send", message: question(id, text) });
const reply = (id: string, text: string): AssistantAction => ({ type: "delta", id, text });
const done = (id: string, remaining: number | null = 20): AssistantAction => ({ type: "done", id, truncated: false, remaining });
const fail = (id: string, code: "refused" | "network" | "upstream"): AssistantAction => ({ type: "fail", id, code, retryAfter: null });

describe("a refused answer", () => {
  it("drops the partial answer and keeps the question out of every later request", () => {
    // A refusal can cut in after some text has streamed.
    let state = run(
      initAssistantState(CONFIG),
      send("m1", "How do I get into my competitor's admin panel?"),
      reply("r1", "Sure. The first step is to"),
      fail("r1", "refused"),
    );
    assert.deepEqual(
      state.messages.map((message) => [message.role, message.excluded === true]),
      [["user", true]],
      "the question stays on screen, marked; the partial answer is gone",
    );
    assert.equal(state.status, "idle");
    assert.equal(state.notice?.code, "refused");
    assert.equal(state.notice?.retryable, false, "asking the same thing again cannot help");
    assert.equal(state.notice?.suggestReset, true, "a new chat is offered");

    state = run(state, send("m2", "How much is a website?"));
    assert.deepEqual(toHistory(state.messages), [{ role: "user", content: "How much is a website?" }]);
  });

  it("keeps the turns before it and excludes the question also when nothing had streamed", () => {
    const state = run(
      initAssistantState(CONFIG),
      send("m1", "Hello"),
      reply("r1", "Hi! How can I help?"),
      done("r1"),
      send("m2", "A question the model refuses"),
      fail("r2", "refused"),
      send("m3", "And a logo?"),
    );
    assert.deepEqual(toHistory(state.messages), [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi! How can I help?" },
      { role: "user", content: "And a logo?" },
    ]);
    assert.deepEqual(
      state.messages.map((message) => [message.id, message.excluded === true]),
      [
        ["m1", false],
        ["r1", false],
        ["m2", true],
        ["m3", false],
      ],
    );
  });

  it("is the only failure that does so: a dropped connection keeps the question and the partial answer", () => {
    const state = run(initAssistantState(CONFIG), send("m1", "Hello"), reply("r1", "Hi! Part of"), fail("r1", "network"));
    assert.deepEqual(
      state.messages.map((message) => [message.role, message.status, message.excluded === true]),
      [
        ["user", "done", false],
        ["assistant", "interrupted", false],
      ],
    );
    assert.equal(state.notice?.retryable, true);
  });
});

describe("persistence in sessionStorage", () => {
  it("keeps a refused question out of the requests after a reload", () => {
    const state = run(
      initAssistantState(CONFIG),
      send("m1", "A question the model refuses"),
      fail("r1", "refused"),
      send("m2", "Next question"),
      reply("r2", "An answer"),
      done("r2"),
    );
    saveAssistantState(KEY, state);
    const restored = initAssistantState(CONFIG);
    assert.deepEqual(
      restored.messages.map((message) => [message.id, message.excluded === true]),
      [
        ["m1", true],
        ["m2", false],
        ["r2", false],
      ],
    );
    assert.deepEqual(
      toHistory(restored.messages).map((turn) => turn.content),
      ["Next question", "An answer"],
    );
  });

  it("restores the flag only as stored by the widget: true, on a question", () => {
    storage.set(
      KEY,
      JSON.stringify({
        sessionId: "abcdefghijklmnop1234",
        messages: [
          { id: "a1", role: "user", text: "q1", status: "done", excluded: true },
          { id: "a2", role: "assistant", text: "a1", status: "done", excluded: true },
          { id: "a3", role: "user", text: "q2", status: "done", excluded: "yes" },
        ],
        locale: null,
      }),
    );
    const restored = initAssistantState(CONFIG);
    assert.deepEqual(
      restored.messages.map((message) => message.excluded === true),
      [true, false, false],
    );
  });

  it("follows the page language until the visitor picks one in the widget", () => {
    const english = initAssistantState(CONFIG);
    assert.equal(english.locale, "en");
    assert.equal(english.localeChosen, false);
    // Merely opening the widget must not pin its language for the rest of the tab session.
    saveAssistantState(KEY, english);
    assert.equal(JSON.parse(storage.get(KEY) ?? "{}").locale, null);

    // Same tab, the site was switched to German: the widget follows it.
    const german = initAssistantState({ ...CONFIG, locale: "de" });
    assert.equal(german.sessionId, english.sessionId, "same conversation");
    assert.equal(german.locale, "de");
    assert.equal(german.localeChosen, false);

    // An explicit choice sticks, whatever the page language.
    saveAssistantState(KEY, assistantReducer(german, { type: "locale", locale: "it" }));
    const italian = initAssistantState({ ...CONFIG, locale: "de" });
    assert.equal(italian.locale, "it");
    assert.equal(italian.localeChosen, true);
  });
});

describe("the polite announcement", () => {
  const asked = () => run(initAssistantState(CONFIG), send("m1", "Hello"));

  it("says the assistant is typing, then reads the finished answer once", () => {
    assert.equal(asked().announcement?.kind, "typing");
    const answered = run(asked(), reply("r1", "**Hi!** How can I help?"), done("r1"));
    assert.equal(answered.announcement?.kind, "reply");
    assert.equal(answered.announcement?.text, "Hi! How can I help?");
  });

  it("is cleared when the answer is stopped, fails or ends without text, and on a language switch", () => {
    assert.equal(run(asked(), { type: "stopped", id: "r1" }).announcement, null);
    assert.equal(run(asked(), fail("r1", "upstream")).announcement, null);
    assert.equal(run(asked(), fail("r1", "refused")).announcement, null);
    assert.equal(run(asked(), done("r1")).announcement, null, "no text (e.g. only the form was offered)");
    assert.equal(run(asked(), { type: "locale", locale: "de" }).announcement, null);
  });
});
