// Regression tests of the closing round (review findings alerts-no-keepalive and typed-field-lang,
// and the browser check's defects R3-B1, R3-B2, R3-B3, R3-B5 and R3-B6; the React and CSS parts are
// measured in a browser as well). Finding S2-11 with two details
// corrected at once is covered next to the booking rules, in tools.test.ts. Nothing here calls a
// real provider or sends email: every sender is a fake, and fetch is replaced where a route would
// reach Resend.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it, mock } from "node:test";
import { getStore } from "@/lib/assistant/server/store";
import {
  AFTER_CALL_BOTTOM_PX,
  AFTER_CALL_HEAD_GAP_PX,
  AFTER_CALL_TOP_PX,
  afterCallScrollTop,
  firstRequestSpan,
} from "@/components/voice/caption-scroll";
import { drawOrb, MIN_ORB_PX, type OrbContext } from "@/components/voice/orb-draw";
import { stillLook, targetLook } from "@/components/voice/orb-motion";
import { DEMO_SCRIPTS, DEMO_TENANTS, getDemoTenant } from "@/lib/voice/demos";
import { ALERT_WAIT_MS, reportSpend, type AlertDelivery } from "@/lib/voice/server/alerts";
import { demoAfterCall } from "@/lib/voice/server/demo-mails";
import { getVoiceEnv } from "@/lib/voice/server/env";
import { reserveTurnSpend } from "@/lib/voice/server/limits";
import { finishSession } from "@/lib/voice/server/session";
import { createSessionState, saveState } from "@/lib/voice/server/state";
import { accountingStoreFor } from "@/lib/voice/server/stores";
import { renderSummaryEmail, spacedPhone, type SendEmail } from "@/lib/voice/server/summary";
import { newSessionId, type SessionClaims } from "@/lib/voice/server/token";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import type { Booking, CallSummary, VoiceTenantConfig } from "@/lib/voice/types";
import { captureLogs, importVoiceRoute, localEnv, post, sessionBody, testDeps } from "./voice-fixtures";

/** Wednesday 2 December 2026, 10:00 in Zurich. */
const T0 = Date.UTC(2026, 11, 2, 9, 0, 0);
const RESEND = { apiKey: "re_test_key", from: "Modolo Digital Studio <test@example.ch>" };
const OWNER = "owner@example.ch";
const ROOT = process.cwd();

let restoreEnv: () => void = () => undefined;
let logs: string[] = [];
beforeEach(() => {
  logs = captureLogs();
});
afterEach(() => {
  restoreEnv();
  restoreEnv = () => undefined;
  mock.restoreAll();
  mock.timers.reset();
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The JSON log lines with these fields. */
function logLines(match: Record<string, unknown>): Array<Record<string, unknown>> {
  return logs
    .map((line) => {
      try {
        return JSON.parse(line) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((line): line is Record<string, unknown> => line !== null && Object.entries(match).every(([key, value]) => line[key] === value));
}

// ---------------------------------------------------------------------------------------------
// alerts-no-keepalive: a spend alert is never left to a function that may end with its response
// ---------------------------------------------------------------------------------------------

describe("review alerts-no-keepalive: every route that charges spend keeps its alert email alive", () => {
  it("the session, tool and turn routes hand a keepAlive to their handlers", () => {
    for (const route of ["session", "tool", "turn"]) {
      const source = readFileSync(path.join(ROOT, "app", "api", "voice", route, "route.ts"), "utf8");
      assert.match(source, new RegExp(`const keepAlive = routeKeepAlive\\("${route}"\\);`), route);
      assert.match(source, /return handle\w+Request\(request, \{ keepAlive \}\);/, route);
    }
  });

  it("through the session route: the 100% alert of a refused admission is sent before the response", async () => {
    restoreEnv = localEnv({ VOICE_BUDGET_CHF_PER_MONTH: "0.01", VOICE_ALERT_EMAIL: OWNER, RESEND_API_KEY: RESEND.apiKey, CONTACT_FROM: RESEND.from });
    // The month is nearly spent (the route uses the production store: the memory store and its
    // accounting companion), so a new conversation cannot pay for its first turn.
    const spent = await reserveTurnSpend({
      store: accountingStoreFor(getStore()),
      tenantId: "modolo",
      sessionId: "b".repeat(32),
      limits: { budgetChfPerMonth: 0.01 },
      micro: 9_000,
    });
    assert.ok(spent.ok);
    // Resend, replaced: the email takes a while, as a real one does.
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
    let finished = 0;
    mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown> });
      await pause(40);
      finished += 1;
      return new Response("{}", { status: 200 });
    });

    const { POST } = await importVoiceRoute("session");
    const response = await POST(post("/api/voice/session", sessionBody(), { "x-real-ip": "198.51.100.9" }));
    assert.equal(response.status, 503);
    // Sent, and finished, before the route answered: a platform that ends the function with its
    // response cannot cut it off any more (outside a request after() is not available: the route's
    // keepAlive says so, and the alert waits instead).
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "https://api.resend.com/emails");
    assert.deepEqual(requests[0].body.to, [OWNER]);
    assert.match(String(requests[0].body.subject), /tetto di spesa del mese raggiunto \(tenant modolo/);
    assert.equal(finished, 1, "the alert email was awaited");
    assert.equal(logLines({ op: "session", warn: "after_unavailable" }).length, 1, "the route handed its keepAlive over");
  });

  function slowEmail(ms: number): { send: SendEmail; sent: () => number; done: () => number } {
    let sent = 0;
    let done = 0;
    return {
      send: async () => {
        sent += 1;
        await pause(ms);
        done += 1;
        return true;
      },
      sent: () => sent,
      done: () => done,
    };
  }

  const spend = (delivery: AlertDelivery) =>
    reportSpend({ store: getFreshStore(), tenantId: "modolo", month: "2026-12", spend: { beforeChf: 0, afterChf: 16 }, budgetChf: 30, delivery });

  function getFreshStore() {
    return testDeps().store;
  }

  it("without a keepAlive, or one that could not take it, the alert email is awaited", async () => {
    for (const keepAlive of [undefined, () => false]) {
      const email = slowEmail(30);
      await spend({ alertEmail: OWNER, resend: RESEND, send: email.send, ...(keepAlive ? { keepAlive } : {}) });
      assert.equal(email.done(), 1, String(keepAlive));
    }
  });

  it("with a keepAlive that takes it, the alert email is not awaited, and the work is handed over", async () => {
    for (const answer of [true, undefined]) {
      const email = slowEmail(40);
      const handed: Promise<unknown>[] = [];
      await spend({
        alertEmail: OWNER,
        resend: RESEND,
        send: email.send,
        keepAlive: (work) => {
          handed.push(work);
          return answer;
        },
      });
      assert.equal(email.done(), 0, `answer ${answer}`);
      assert.equal(handed.length, 1);
      await Promise.all(handed);
      assert.equal(email.done(), 1);
    }
  });

  it("an awaited alert email that never answers holds the request ALERT_WAIT_MS at most", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    let settled = false;
    const pending = spend({ alertEmail: OWNER, resend: RESEND, send: () => new Promise<boolean>(() => undefined) }).then(() => {
      settled = true;
    });
    for (let index = 0; index < 20; index++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(settled, false);
    mock.timers.tick(ALERT_WAIT_MS);
    await pending;
    assert.equal(settled, true);
  });
});

// ---------------------------------------------------------------------------------------------
// typed-field-lang: the typed reply carries the conversation's language
// ---------------------------------------------------------------------------------------------

describe("review typed-field-lang: the typed reply is marked with the conversation's language", () => {
  const source = readFileSync(path.join(ROOT, "components", "voice", "voice-stage.tsx"), "utf8");

  it("sets lang on the field from the conversation's locale, while the stage keeps the page's", () => {
    const field = /<input\s+ref=\{inputRef\}[\s\S]*?\/>/.exec(source)?.[0] ?? "";
    assert.ok(field.includes("id={inputId}"), "the typed field");
    assert.ok(field.includes("lang={VOICE_LANG_TAG[locale]}"), field);
    // locale is the conversation's (it follows the language switch), uiLocale the page's.
    assert.match(source, /const locale = state\.locale;/);
    assert.match(source, /const tag = VOICE_LANG_TAG\[uiLocale\];/);
  });
});

// ---------------------------------------------------------------------------------------------
// R3-B1: the orb never draws a negative radius
// ---------------------------------------------------------------------------------------------

describe("browser check R3-B1: an orb on a canvas of 0 px draws nothing and throws nothing", () => {
  /** A 2D context that refuses a negative radius the way a browser does (IndexSizeError). */
  function strictContext(): OrbContext & { arcs: number } {
    const gradient = { addColorStop: () => undefined } as unknown as CanvasGradient;
    const context = {
      arcs: 0,
      fillStyle: "" as CanvasRenderingContext2D["fillStyle"],
      strokeStyle: "" as CanvasRenderingContext2D["strokeStyle"],
      lineWidth: 1,
      lineCap: "butt" as CanvasLineCap,
      clearRect: () => undefined,
      beginPath: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      arc(_x: number, _y: number, radius: number) {
        if (!(radius >= 0)) throw new RangeError(`IndexSizeError: The radius provided (${radius}) is negative.`);
        context.arcs += 1;
      },
      createRadialGradient(_x0: number, _y0: number, r0: number, _x1: number, _y1: number, r1: number) {
        if (!(r0 >= 0 && r1 >= 0)) throw new RangeError("IndexSizeError: negative radius");
        return gradient;
      },
      createLinearGradient: () => gradient,
    };
    return context;
  }

  it("skips a canvas too small to draw on, at every pixel ratio, in every state", () => {
    for (const dpr of [1, 1.5, 2]) {
      for (const size of [1, 2, 3, MIN_ORB_PX * dpr - 1]) {
        for (const status of ["idle", "listening", "thinking", "speaking", "ended"] as const) {
          const context = strictContext();
          const frame = { look: targetLook(status, 1, false), level: 1, time: 1, angle: 1, breathe: true };
          assert.doesNotThrow(() => drawOrb(context, size, size, dpr, frame), `${size} px at ${dpr}`);
          assert.equal(context.arcs, 0);
        }
      }
    }
  });

  it("draws the orb on a canvas of a real size", () => {
    for (const dpr of [1, 2]) {
      for (const size of [MIN_ORB_PX * dpr, 40, 360]) {
        const context = strictContext();
        drawOrb(context, size, size, dpr, { look: stillLook("thinking", false), level: 0.45, time: 0, angle: -Math.PI / 3, breathe: false });
        assert.ok(context.arcs > 3, `${size} px at ${dpr}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// R3-B2: the request first, and a caption box that shows it
// ---------------------------------------------------------------------------------------------

describe("browser check R3-B2: at the end of an example the request is in view", () => {
  const LEAD: CallSummary["outcomes"][number] = {
    kind: "lead",
    taskId: "project_request",
    ref: "LD-7K2Q",
    fields: { service: "website", problem: "Eine neue Website" },
    contact: { name: "Anna Muster", phone: "+41791234567" },
  };

  it("the email puts what the caller wants before the facts about the call", () => {
    const summary: CallSummary = {
      tenant: "modolo",
      sessionId: "s-1",
      channel: "phone",
      startedAt: new Date(T0).toISOString(),
      durationSeconds: 75,
      locale: "de",
      outcomes: [LEAD],
      noOutcome: false,
    };
    for (const options of [{}, { request: true }, { late: true }]) {
      const { text } = renderSummaryEmail(summary, MODOLO_VOICE_TENANT, options);
      const lines = text.split("\n");
      assert.equal(lines[1], "", JSON.stringify(options));
      assert.match(lines[2], /^1\. Anfrage: Projektanfrage, Referenz LD-7K2Q$/);
      const request = lines.findIndex((line) => line.startsWith("1. "));
      for (const fact of ["Beginn: 02.12.2026 10:00", "Sprache:", "Kanal:", "Sitzung:"]) {
        assert.ok(lines.findIndex((line) => line.startsWith(fact)) > request, `${fact} after the request`);
      }
      assert.ok(text.trimEnd().endsWith("Bitte vor einer Zusage prüfen."));
    }
    const none = renderSummaryEmail({ ...summary, outcomes: [], noOutcome: true }, MODOLO_VOICE_TENANT).text.split("\n");
    assert.equal(none[2], "Das Gespräch endete ohne Anfrage, Termin oder Rückrufwunsch.");
    assert.equal(none[3], "");
  });

  it("finds the first request of every example's e-mail, with the caller's name and number in it", () => {
    let checked = 0;
    for (const script of DEMO_SCRIPTS) {
      const tenant = DEMO_TENANTS.find((candidate) => candidate.id === script.tenantId);
      assert.ok(tenant, script.id);
      const lead = script.lines.find((line) => line.tool?.name === "create_lead" && line.tool.outcome === "ok")?.tool;
      if (!lead) continue;
      const [mail] = demoAfterCall(script, tenant).mails;
      const span = firstRequestSpan(mail.text);
      assert.ok(span, script.id);
      const block = mail.text.slice(span.start, span.end);
      assert.match(block, /^1\. /, script.id);
      assert.ok(!block.includes("\n\n"), script.id);
      const input = lead.input as { name?: string; phone?: string };
      if (input.name) assert.ok(block.includes(input.name), `${script.id}: name`);
      if (input.phone) assert.ok(block.includes(spacedPhone(input.phone)), `${script.id}: phone`);
      assert.ok(mail.text.indexOf("Sprache:") > span.end || !mail.text.includes("Sprache:"), script.id);
      checked += 1;
    }
    assert.ok(checked >= 5, `${checked} examples with a request`);
    assert.equal(firstRequestSpan("Das Gespräch endete ohne Anfrage.\n\nSprache: Deutsch"), null);
  });

  it("scrolls the box to the end mark, or further until the first request's last line is in view", () => {
    const view = 280;
    // The request fits under the end mark: the end mark comes to the top, as before.
    assert.equal(afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 470 }, viewHeight: view }), 300 - AFTER_CALL_TOP_PX);
    // It would end under the faded bottom edge: the box goes on until it is in view, whole.
    const top = afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 560 }, viewHeight: view });
    assert.equal(top, 560 + AFTER_CALL_BOTTOM_PX - view);
    assert.ok(400 - top >= AFTER_CALL_TOP_PX, "its first line below the faded top edge");
    // Taller than the box (a long description on a phone): its end, the caller's name and number.
    assert.equal(afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 900 }, viewHeight: view }), 900 + AFTER_CALL_BOTTOM_PX - view);
    // No request (a summary of bookings only, or nothing): the end mark.
    assert.equal(afterCallScrollTop({ endMark: 300, request: null, viewHeight: view }), 300 - AFTER_CALL_TOP_PX);
    assert.equal(afterCallScrollTop({ endMark: 10, request: null, viewHeight: view }), 0);
  });

  it("past the end mark, a request that fits starts right under the pinned label of the e-mails", () => {
    const view = 280;
    const head = 40;
    // Everything in view at the end mark: nothing changes, the label is not pinned there.
    assert.equal(afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 470 }, viewHeight: view, head }), 300 - AFTER_CALL_TOP_PX);
    // It would end under the box: it now starts under the label, whole, instead of ending at the edge.
    const top = afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 560 }, viewHeight: view, head });
    assert.equal(top, 400 - head - AFTER_CALL_HEAD_GAP_PX);
    assert.ok(560 + AFTER_CALL_BOTTOM_PX <= top + view, "its last line above the faded bottom edge");
    assert.ok(top > 560 + AFTER_CALL_BOTTOM_PX - view, "further than the old rule went");
    // The room under the label is the box less the label, the gap and the bottom edge: a request
    // of exactly that height still starts under the label, one pixel more shows its end instead.
    const room = view - head - AFTER_CALL_HEAD_GAP_PX - AFTER_CALL_BOTTOM_PX;
    assert.equal(afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 400 + room }, viewHeight: view, head }), 400 - head - AFTER_CALL_HEAD_GAP_PX);
    assert.equal(
      afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 401 + room }, viewHeight: view, head }),
      401 + room + AFTER_CALL_BOTTOM_PX - view,
    );
    // A taller label (two lines, or with the note on the language) leaves less room.
    assert.equal(afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 560 }, viewHeight: view, head: 62 }), 400 - 62 - AFTER_CALL_HEAD_GAP_PX);
    assert.equal(afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 590 }, viewHeight: view, head: 62 }), 590 + AFTER_CALL_BOTTOM_PX - view);
    // Without a label height the rule is the old one.
    assert.equal(afterCallScrollTop({ endMark: 300, request: { top: 400, bottom: 560 }, viewHeight: view, head: 0 }), 560 + AFTER_CALL_BOTTOM_PX - view);
  });

  it("the label of the e-mails is pinned to the top of the box, and that edge does not fade over it", () => {
    const css = readFileSync(path.join(ROOT, "components", "voice", "voice-stage.module.css"), "utf8");
    assert.match(css, /\.captions\[data-reserve\] \.afterHead \{[^}]*position: sticky;[^}]*top: 0;/);
    // Opaque: the card's surface over the stage's colour, or the e-mail would show through it.
    assert.match(css, /\.captions\[data-reserve\] \.afterHead \{[^}]*background: linear-gradient\(var\(--mv-surface\), var\(--mv-surface\)\), var\(--mv-bg\);/);
    // The fade under the pinned label is shorter than the air kept over the request's first line.
    const fade = /\.captions\[data-reserve\]\[data-pinned\] \.afterHead::after \{[^}]*height: (\d+)px;/.exec(css);
    assert.ok(fade, "the fade under the pinned label");
    assert.ok(Number(fade[1]) < AFTER_CALL_HEAD_GAP_PX, `fade ${fade[1]}px, gap ${AFTER_CALL_HEAD_GAP_PX}px`);
    assert.match(css, /\.captions\[data-reserve\]\[data-scrolled\]\[data-pinned\] \{[^}]*mask-image: none;/);
    assert.match(css, /\.captions\[data-reserve\]\[data-scrolled\]\[data-pinned\]\[data-more\] \{[^}]*mask-image: linear-gradient\(to top, transparent 0, #000 2rem\)/);
    // The rules that lift the fade come after the ones that set it (same weight: the later wins).
    assert.ok(css.indexOf("[data-scrolled][data-pinned] {") > css.indexOf(".captions[data-reserve][data-scrolled][data-more] {"));
    const stage = readFileSync(path.join(ROOT, "components", "voice", "voice-stage.tsx"), "utf8");
    assert.match(stage, /data-after-head=""/);
    assert.match(stage, /head: box\.querySelector<HTMLElement>\("\[data-after-head\]"\)\?\.getBoundingClientRect\(\)\.height \?\? 0/);
    assert.match(stage, /box\.toggleAttribute\("data-pinned", card !== null && card\.getBoundingClientRect\(\)\.top < box\.getBoundingClientRect\(\)\.top\)/);
  });

  it("the box fades at its bottom edge while more lies below it", () => {
    const css = readFileSync(path.join(ROOT, "components", "voice", "voice-stage.module.css"), "utf8");
    assert.match(css, /\.captions\[data-reserve\]\[data-more\] \{[^}]*mask-image: linear-gradient\(to top, transparent 0, #000 2rem\)/);
    assert.match(css, /\.captions\[data-reserve\]\[data-scrolled\]\[data-more\] \{[^}]*calc\(100% - 2rem\), transparent 100%\)/);
    const stage = readFileSync(path.join(ROOT, "components", "voice", "voice-stage.tsx"), "utf8");
    assert.match(stage, /box\.toggleAttribute\("data-more", box\.scrollHeight - box\.scrollTop - box\.clientHeight > MORE_BELOW_PX\)/);
  });
});

// ---------------------------------------------------------------------------------------------
// R3-B3: dates and phone numbers as people write them
// ---------------------------------------------------------------------------------------------

describe("browser check R3-B3: dates and phone numbers in the email are easy to read", () => {
  it("writes phone numbers with spaces: Swiss ones the Swiss way, others after the country code", () => {
    assert.equal(spacedPhone("+41790000060"), "+41 79 000 00 60");
    assert.equal(spacedPhone("+41521234567"), "+41 52 123 45 67");
    assert.equal(spacedPhone("+41800123456"), "+41 800 123 456");
    // Only service numbers have a prefix of three digits: 081 is the area code of Graubünden
    // (final review: it was grouped like an 0800 number).
    assert.equal(spacedPhone("+41812345678"), "+41 81 234 56 78");
    assert.equal(spacedPhone("+41848123456"), "+41 848 123 456");
    assert.equal(spacedPhone("+41901234567"), "+41 901 234 567");
    assert.equal(spacedPhone("+41441234567"), "+41 44 123 45 67");
    assert.equal(spacedPhone("+393331234567"), "+39 3331234567");
    assert.equal(spacedPhone("+4915112345678"), "+49 15112345678");
    assert.equal(spacedPhone("+12125551234"), "+1 2125551234");
    assert.equal(spacedPhone("+4231234567"), "+423 1234567");
    assert.equal(spacedPhone("+35312345678"), "+353 12345678");
    // Not a number in E.164: left as it is.
    for (const other of ["anna@example.ch", "079 123 45 67", "+41 79 000 00 60", "Anna"]) assert.equal(spacedPhone(other), other);
  });

  it("formats a date of a request like a booking's start, and every phone number", () => {
    const hotel = getDemoTenant("demo-hotel") as VoiceTenantConfig;
    const booking: Booking = {
      ref: "MV-5T9B",
      serviceId: "table",
      start: "2026-12-12T20:45:00+01:00",
      end: "2026-12-12T22:45:00+01:00",
      name: "Daniel Baumann",
      contact: "+41790000060",
      partySize: 4,
      status: "confirmed",
      createdAt: new Date(T0).toISOString(),
    };
    const summary: CallSummary = {
      tenant: hotel.id,
      sessionId: "s-2",
      channel: "phone",
      startedAt: new Date(T0).toISOString(),
      durationSeconds: 61,
      locale: "it",
      outcomes: [
        {
          kind: "lead",
          taskId: "room_request",
          ref: "LD-AAAA",
          fields: { arrival_date: "2026-12-18", departure_date: "2026-12-20", guests: "2", room_type: "double" },
          contact: { name: "Giulia Rossi", phone: "+393331234567", email: "giulia@example.it" },
        },
        { kind: "callback", name: "Thomas Meier", phone: "+41760000078", topic: "Rechnung" },
        { kind: "booking", booking },
        { kind: "booking", booking: { ...booking, ref: "MV-6T9B", contact: "daniel@example.ch" } },
      ],
      noOutcome: false,
    };
    const { text } = renderSummaryEmail(summary, hotel);
    assert.match(text, /\n {3}Anreise: 18\.12\.2026\n/);
    assert.match(text, /\n {3}Abreise: 20\.12\.2026\n/);
    assert.doesNotMatch(text, /2026-12-1[0-9]/);
    assert.match(text, /\n {3}Telefon: \+39 3331234567\n/);
    assert.match(text, /\n {3}E-Mail: giulia@example\.it\n/);
    assert.match(text, /\n {3}Telefon: \+41 76 000 00 78\n/);
    assert.match(text, /\n {3}Beginn: 12\.12\.2026 20:45\n {3}Name: Daniel Baumann\n {3}Kontakt: \+41 79 000 00 60\n/);
    assert.match(text, /\n {3}Kontakt: daniel@example\.ch\n/);
    // The tenant's language decides the date's format; English keeps the international one.
    const english = renderSummaryEmail(summary, { ...hotel, defaultLocale: "en" }).text;
    assert.match(english, /\n {3}[^\n]*: 2026-12-18\n/);
  });
});

// ---------------------------------------------------------------------------------------------
// R3-B5: the ring of the trade chooser after an arrow key, in WebKit too
// ---------------------------------------------------------------------------------------------

describe("browser check R3-B5: the focused trade keeps its ring when the arrows move it", () => {
  it("draws the ring on :focus while the chooser is used with keys, and a pointer clears that", () => {
    const css = readFileSync(path.join(ROOT, "components", "voice", "landing", "landing.module.css"), "utf8");
    const rule = /\.choiceInput:focus-visible \+ \.choiceBody,\s*\.chooser\[data-keys\] \.choiceInput:focus \+ \.choiceBody \{\s*outline: 2px solid/.exec(css);
    assert.ok(rule, "the ring rule covers :focus under data-keys");
    const chooser = readFileSync(path.join(ROOT, "components", "voice", "landing", "demo-chooser.tsx"), "utf8");
    assert.match(chooser, /onKeyDown=\{\(event\) => event\.currentTarget\.setAttribute\("data-keys", ""\)\}/);
    assert.match(chooser, /onPointerDown=\{\(event\) => event\.currentTarget\.removeAttribute\("data-keys"\)\}/);
  });
});

// ---------------------------------------------------------------------------------------------
// R3-B6: the end log of a call whose requests all went out at once
// ---------------------------------------------------------------------------------------------

describe("browser check R3-B6: the end log says when the requests had already gone out", () => {
  async function endWith(outcomes: CallSummary["outcomes"]): Promise<{ line: Record<string, unknown>; emails: number }> {
    restoreEnv = localEnv();
    let emails = 0;
    const deps = testDeps({
      now: () => T0 + 60_000,
      resend: RESEND,
      sendEmail: async () => {
        emails += 1;
        return true;
      },
    });
    const sid = newSessionId();
    const state = createSessionState({ tenantId: "modolo", sessionId: sid, mode: "local", channel: "web", locale: "de", startedAt: T0, reservation: null });
    state.outcomes.push(...outcomes);
    assert.ok(await saveState(deps.store, sid, state, 3600));
    const iat = Math.floor(T0 / 1000);
    const claims: SessionClaims = { v: 1, tid: "modolo", sid, mode: "local", loc: "de", ch: "web", iat, exp: iat + 600 };
    assert.equal(await finishSession({ claims, reason: "user", env: getVoiceEnv(), deps, now: T0 + 60_000 }), true);
    const [line] = logLines({ op: "end" });
    assert.ok(line, logs.join("\n"));
    return { line, emails };
  }

  it("requests only: 'requests_only', and no summary is sent", async () => {
    const { line, emails } = await endWith([{ kind: "lead", taskId: "project_request", ref: "LD-7K2Q", fields: {}, contact: { name: "Anna" } }]);
    assert.equal(line.outcomes, 1);
    assert.equal(line.delivery, "requests_only");
    assert.equal(emails, 0);
  });

  it("nothing at all is still 'no_outcome', and a booking is summed up and sent", async () => {
    assert.equal((await endWith([])).line.delivery, "no_outcome");
    logs.length = 0;
    restoreEnv();
    const booking: Booking = {
      ref: "MV-AAAA",
      serviceId: "x",
      start: "2026-12-04T09:00:00+01:00",
      end: "2026-12-04T10:00:00+01:00",
      name: "Anna",
      contact: "+41780000044",
      status: "confirmed",
      createdAt: new Date(T0).toISOString(),
    };
    const sent = await endWith([{ kind: "booking", booking }]);
    assert.equal(sent.line.delivery, "sent");
    assert.equal(sent.emails, 1);
  });
});
