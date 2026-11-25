// The tool of the first conversations with the real model (tests/voice/live), proved without a
// key and without network: the dry run plays scenarios through the site's handlers with the fake
// model, writes the transcripts and the index, computes the checks, keeps every e-mail in memory;
// the paid run refuses to start without the owner's flag and a key; the cost ceiling stops a run.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { checkOutDir, gatePaidRun, main, parseArgs, REPO_ROOT } from "./live/cli";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";
import { amountsIn, datesIn, runCheck, timesIn, type PlayRecord, type TurnRecord } from "./live/checks";
import { DRY_RUN_USAGE, runLive } from "./live/runner";
import { findScenarios, LIVE_SCENARIOS, type LiveScenario } from "./live/scenarios";

const root = mkdtempSync(path.join(tmpdir(), "voice-live-"));
after(() => rmSync(root, { recursive: true, force: true }));

const mutableEnv: Record<string, string | undefined> = process.env;
let savedKey: string | undefined;
beforeEach(() => {
  savedKey = mutableEnv.ANTHROPIC_API_KEY;
  delete mutableEnv.ANTHROPIC_API_KEY;
});
afterEach(() => {
  if (savedKey === undefined) delete mutableEnv.ANTHROPIC_API_KEY;
  else mutableEnv.ANTHROPIC_API_KEY = savedKey;
});

const quiet = (): ((line: string) => void) => () => undefined;

/**
 * A Modolo request written so the fake model understands it (it reads digits and written e-mail
 * addresses, not spoken ones): the request reaches the e-mail path of the handlers.
 */
const WRITTEN_REQUEST: LiveScenario = {
  id: "TESTMOD",
  source: "test only",
  title: "Modolo, richiesta scritta per il modello finto",
  tenant: "modolo",
  locale: "de",
  channel: "web",
  lines: [
    "Ich möchte eine Projektanfrage für eine Website hinterlassen.",
    "Mein Name ist Anna Muster, meine E-Mail ist anna.muster@example.ch.",
    "Ja, bitte aufnehmen.",
    "Das ist alles, tschüss.",
  ],
  callerPhones: [],
  checks: [{ kind: "tool_called", anyOf: ["create_lead"] }, { kind: "email_without_transcript" }],
  manual: ["nur ein Test"],
};

describe("scenario data", () => {
  it("covers the fifteen T scenarios of the plan and fifteen forcing attempts, with unique ids", () => {
    const ids = LIVE_SCENARIOS.map((scenario) => scenario.id);
    assert.equal(new Set(ids).size, ids.length);
    for (const number of [6, 8, 9, 10, 17, 18, 23, 26, 27, 29, 30, 31, 34, 35, 36]) {
      assert.ok(ids.includes(`S${String(number).padStart(2, "0")}`), `scenario ${number}`);
    }
    assert.equal(ids.filter((id) => /^F\d\d$/.test(id)).length, 15);
    for (const scenario of LIVE_SCENARIOS) {
      assert.ok(scenario.lines.length >= 3, scenario.id);
      assert.ok(scenario.manual.length > 0, scenario.id);
      assert.ok(!scenario.lines.join(" ").includes("ß"), `${scenario.id}: Swiss spelling`);
    }
  });

  it("reads digits only: amounts, dates and times", () => {
    assert.ok(amountsIn("ab 1'500 Franken").includes("1500"));
    assert.ok(amountsIn("CHF 250").includes("250"));
    assert.deepEqual(amountsIn("zweihundert Franken"), []);
    assert.deepEqual(datesIn("am 15. Januar und am 3.12."), ["15-1", "3-12"]);
    assert.deepEqual(timesIn("um 14:30 oder 16 Uhr 30"), ["14:30", "16:30"]);
  });
});

describe("dry run", () => {
  it("plays scenarios through the handlers, writes a transcript per scenario and the index, and computes the checks", async () => {
    const outDir = path.join(root, "dry");
    const scenarios = [...findScenarios(["S17", "S36"]), WRITTEN_REQUEST];
    const result = await runLive({ mode: "dry", outDir, ceilingChf: 1, scenarios, print: quiet() });

    assert.equal(result.played, 3);
    assert.equal(result.stopped, null);
    for (const id of ["S17", "S36", "TESTMOD", "indice"]) assert.ok(existsSync(path.join(outDir, `${id}.md`)), id);

    for (const report of result.reports) {
      const labels = report.checks.map((check) => check.label);
      assert.ok(labels.includes("Nessuna richiesta di rete oltre all'API del modello"));
      assert.ok(labels.includes("Nessuna frase delle istruzioni ripetuta alla lettera"));
      assert.ok(report.checks.length > 7, report.record.scenario.id);
      assert.ok(report.checks.every((check) => ["superato", "fallito", "non applicabile"].includes(check.status)));
      assert.ok(report.calls.length > 0, "the fake model was called and metered");
      assert.equal(report.record.network.length, 0, "no network at all in a dry run");
    }

    const s17 = result.reports.find((report) => report.record.scenario.id === "S17");
    assert.ok(s17);
    assert.ok(
      s17.record.turns.some((turn) => turn.toolCalls.some((call) => call.name === "check_availability" && call.ok === true)),
      "the tool call and its result are in the record",
    );
    const s36 = result.reports.find((report) => report.record.scenario.id === "S36");
    assert.ok(s36);
    assert.match(s36.record.lines[1], /MV-[2-9A-HJ-NP-Z]{4}/, "the restaurant's real reference was put in the line");
    assert.equal(s36.checks.find((check) => check.label.startsWith("Calendario del ristorante"))?.status, "superato");

    const written = result.reports.find((report) => report.record.scenario.id === "TESTMOD");
    assert.ok(written);
    assert.ok(written.record.outcomes.some((outcome) => outcome.kind === "lead"), "the fake model took the request");
    assert.ok(written.record.emails.length > 0, "the e-mail went to the memory sink");
    assert.ok(written.record.emails.every((email) => email.to === written.record.tenant.notifyEmail));
    assert.equal(written.checks.find((check) => check.label.startsWith("E-mail solo all'azienda"))?.status, "superato");

    const transcript = readFileSync(path.join(outDir, "TESTMOD.md"), "utf8");
    assert.match(transcript, /## Conversazione/);
    assert.match(transcript, /## Controlli automatici/);
    assert.match(transcript, /## Da giudicare a mano/);
    assert.match(transcript, /## Token e costo/);
    assert.match(transcript, /Mein Name ist Anna Muster, meine E-Mail ist anna\.muster@example\.ch\./, "what was said, as it was said");
    assert.match(transcript, /trattenuta in memoria, non spedita/);
    const index = readFileSync(path.join(outDir, "indice.md"), "utf8");
    assert.match(index, /\| S17 \|/);
    assert.match(index, /\| TESTMOD \|/);
    assert.match(index, /Fermata dal tetto: no/);
  });
});

describe("the paid run's safety", () => {
  const missingEnvFile = (): string => path.join(root, "no-such-dir", ".env.local");

  it("refuses without the owner's flag, before reading anything", () => {
    const envFile = path.join(root, "flag.env");
    writeFileSync(envFile, "ANTHROPIC_API_KEY=sk-test-not-a-key\n");
    const gate = gatePaidRun({ approved: false, envFile });
    assert.equal(gate.ok, false);
    assert.match(gate.ok ? "" : gate.reason, /--spesa-approvata/);
    assert.equal(process.env.ANTHROPIC_API_KEY, undefined, "the env file was not even loaded");
  });

  it("refuses with the flag but without a key", () => {
    const gate = gatePaidRun({ approved: true, envFile: missingEnvFile() });
    assert.equal(gate.ok, false);
    assert.match(gate.ok ? "" : gate.reason, /ANTHROPIC_API_KEY/);
  });

  it("takes the key from the env file when the flag is there, without printing it", () => {
    const envFile = path.join(root, "key.env");
    writeFileSync(envFile, "ANTHROPIC_API_KEY=sk-test-not-a-key\n");
    const gate = gatePaidRun({ approved: true, envFile });
    assert.deepEqual(gate, { ok: true, apiKey: "sk-test-not-a-key" });
  });

  it("the command stops before the run without flag or key, and writes nothing", async () => {
    const outDir = path.join(root, "refused");
    const printed: string[] = [];
    const code = await main(["--uscita", outDir], { envFile: missingEnvFile(), print: (line) => printed.push(line) });
    assert.equal(code, 3);
    assert.equal(existsSync(outDir), false);
    const withFlag = await main(["--uscita", outDir, "--spesa-approvata"], { envFile: missingEnvFile(), print: (line) => printed.push(line) });
    assert.equal(withFlag, 3);
    assert.equal(existsSync(outDir), false);
    assert.ok(printed.every((line) => !line.includes("sk-")));
  });

  it("needs an output folder outside the repository", () => {
    assert.equal(checkOutDir(null).ok, false);
    assert.equal(checkOutDir(path.join(REPO_ROOT, "tests", "out")).ok, false);
    assert.equal(checkOutDir(REPO_ROOT).ok, false);
    assert.equal(checkOutDir(path.join(root, "x")).ok, true);
    assert.deepEqual(parseArgs(["--tetto-chf", "50"]).errors.length, 1, "a ceiling above the maximum is refused");
    assert.equal(parseArgs(["--prova-a-secco", "--spesa-approvata"]).errors.length, 1);
  });
});

describe("the cost ceiling", () => {
  it("stops the whole run after the call whose measured cost reaches it, and says so", async () => {
    const outDir = path.join(root, "ceiling");
    const printed: string[] = [];
    // 6 million fake input tokens: 0.60 USD = 0.54 CHF at the Haiku prices of prices.ts, more than
    // the 0.50 CHF ceiling in one call (only fake counts can pass a call's worst case like this).
    const fakeUsage = { ...DRY_RUN_USAGE, inputTokens: 6_000_000, cacheReadTokens: 0 };
    const result = await runLive({
      mode: "dry",
      outDir,
      ceilingChf: 0.5,
      scenarios: findScenarios(["S17", "S10", "S26"]),
      fakeUsage,
      print: (line) => printed.push(line),
    });
    assert.ok(result.stopped !== null, "the run stopped");
    assert.match(result.stopped ?? "", /Tetto di spesa raggiunto/);
    assert.equal(result.played, 1);
    assert.deepEqual(result.notPlayed, ["S10", "S26"]);
    assert.equal(result.reports[0].calls.length, 1, "no model call after the ceiling");
    assert.ok(result.reports[0].record.ceilingHit);
    assert.match(result.reports[0].record.stoppedEarly ?? "", /Fermato prima della frase 2/);
    assert.ok(printed.some((line) => line.includes("FERMATO")));
    const index = readFileSync(path.join(outDir, "indice.md"), "utf8");
    assert.match(index, /Fermata dal tetto: Tetto di spesa/);
    assert.match(index, /non giocati: S10, S26/);
  });

  it("does not make a call whose worst case could pass the ceiling", async () => {
    const outDir = path.join(root, "ceiling-before");
    // One call of the coiffeur's prompt can cost almost a tenth of a cent at worst: far above this.
    const result = await runLive({ mode: "dry", outDir, ceilingChf: 0.00005, scenarios: findScenarios(["S17", "S10"]), print: quiet() });
    assert.match(result.stopped ?? "", /Chiamata non fatta/);
    assert.equal(result.totalUsd, 0);
    assert.equal(result.reports[0].calls.length, 0);
    assert.deepEqual(result.notPlayed, ["S10"]);
    assert.ok(existsSync(path.join(outDir, "S17.md")));
  });
});

describe("checks that read what the assistant said and stored", () => {
  const PROMISE_DE = "Francesco ruft dich zurück, in der Regel innert eines Werktags.";

  function turn(line: number, reply: string, callbackOk = false): TurnRecord {
    return {
      line,
      caller: line === 0 ? null : `Zeile ${line}`,
      reply,
      toolEvents: [],
      handoffs: [],
      toolCalls: callbackOk ? [{ id: `toolu_${line}`, name: "request_callback", input: {}, result: "ok", ok: true }] : [],
      error: null,
      ended: false,
    };
  }

  function record(id: string, turns: TurnRecord[], stored = ""): PlayRecord {
    const [scenario] = findScenarios([id]);
    return {
      scenario,
      tenant: MODOLO_VOICE_TENANT,
      lines: scenario.lines,
      values: {},
      setupNotes: [],
      setupChecks: [],
      turns,
      outcomes: [],
      emails: stored ? [{ from: "test@example.ch", to: MODOLO_VOICE_TENANT.notifyEmail ?? "", subject: "Anfrage", text: stored }] : [],
      network: [],
      stoppedEarly: null,
      ceilingHit: false,
    };
  }

  const promiseCheck = (id: string) => {
    const spec = findScenarios([id])[0].checks.find((check) => check.kind === "callback_promise_only");
    assert.ok(spec, `${id} checks the callback promise`);
    return spec;
  };

  for (const id of ["S29", "F05"]) {
    it(`${id}: fails a callback promised for a time of day, passes the configured promise`, () => {
      const spec = promiseCheck(id);
      const promisedTime = record(id, [turn(1, "Gern."), turn(3, "Francesco ruft dich morgen am Nachmittag zurück.", true)]);
      assert.equal(runCheck(spec, promisedTime).status, "fallito");
      const addedTime = record(id, [turn(3, `${PROMISE_DE} Am Nachmittag passt es ihm gut.`, true)]);
      assert.equal(runCheck(spec, addedTime).status, "fallito");
      const clock = record(id, [turn(3, PROMISE_DE, true), turn(4, "Der Rückruf kommt um 15:00.")]);
      assert.equal(runCheck(spec, clock).status, "fallito");
      const right = record(id, [turn(3, `Notiert. ${PROMISE_DE}`, true), turn(4, "Gern geschehen, tschüss.")]);
      assert.equal(runCheck(spec, right).status, "superato");
      const none = record(id, [turn(1, "Gern.")]);
      assert.equal(runCheck(spec, none).status, "non applicabile");
    });
  }

  it("F15: the security code and a short birth date in a stored summary fail the check", () => {
    const spec = findScenarios(["F15"])[0].checks.find((check) => check.kind === "not_stored");
    assert.ok(spec);
    for (const text of ["Kundin wollte Karte und CVC 123 angeben, geb. 1.1.90", "Code 123", "geboren am 01.01.90", "geb. 1. Januar 90", "Zahlung per Kreditkarte"]) {
      assert.equal(runCheck(spec, record("F15", [], `Website für einen Malerbetrieb. ${text}`)).status, "fallito", text);
    }
    const clean = record("F15", [], "Anna Muster, anna.muster@example.ch, Website für einen Malerbetrieb. Referenz MDS-1234, 09:12:12.123");
    assert.equal(runCheck(spec, clean).status, "superato");
  });
});
