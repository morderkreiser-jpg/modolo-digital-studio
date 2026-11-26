// The recording test tool (tests/voice/live/audio-*.ts), proved without a key and without
// network: WAV files are read and resampled, the scenario file is checked, paths inside the
// repository are refused, the paid run needs the owner's flag and a key it never prints, a dry run
// plays every scenario against the fake session and writes the reports, and the cost ceiling stops
// a run before a response that could pass it.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, beforeEach, describe, it } from "node:test";
import { addResponseUsage, emptyUsage, usageCostUsd } from "@/lib/voice/server/realtime/pricing";
import { OPENAI_REALTIME_MODELS } from "@/lib/voice/server/env";
import type { OpenControlResult } from "@/lib/voice/server/providers/types";
import { DEFAULT_MODEL, gateAudioRun, main, parseAudioArgs } from "./live/audio-cli";
import { createFakeRealtimeSocket, FAKE_RESPONSE_USAGE, type FakeRealtimeSocket } from "./live/audio-fake";
import { judge, planAudioRun, responseUpperUsd, runAudio } from "./live/audio-runner";
import { compareArgs, insideRepository, parseScenarioFile, REPO_ROOT, within, type AudioScenarioFile } from "./live/audio-scenarios";
import { CHUNK_BYTES, chunkPcm, decodeWav, encodeWav, MAX_WAV_BYTES, readWavFile, sineWav, TARGET_RATE, type PcmAudio } from "./live/audio-wav";
import { setVoiceEnv, TEST_OPENAI_KEY, TEST_PERSON, TEST_PHONE, TEST_PHONE_SPOKEN } from "./voice-fixtures";
import { toolDefinitions } from "@/lib/voice/tools/definitions";
import { MODOLO_VOICE_TENANT } from "@/lib/voice/tenants/modolo";

const root = mkdtempSync(path.join(tmpdir(), "voice-audio-"));
after(() => rmSync(root, { recursive: true, force: true }));

let restoreEnv: () => void = () => undefined;
beforeEach(() => {
  restoreEnv = setVoiceEnv({});
});
afterEach(() => restoreEnv());

let folders = 0;
function folder(name: string): string {
  folders += 1;
  const dir = path.join(root, `${folders}-${name}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** An example scenario, with placeholder data only. */
function exampleScenarios(): Record<string, unknown> {
  return {
    version: 1,
    tenant: "modolo",
    locale: "de",
    scenarios: [
      {
        id: "S01",
        title: "Rückruf mit buchstabiertem Namen",
        greeting: true,
        turns: [
          { audio: "aufnahmen/s01-1.wav" },
          { audio: "aufnahmen/s01-2.wav", expect: { tool: "request_callback", args: { phone: TEST_PHONE, name: TEST_PERSON } } },
        ],
      },
    ],
  };
}

/** A scenario folder outside the repository with the example file and two short sine recordings. */
function writeExample(dir: string, content: Record<string, unknown> = exampleScenarios()): string {
  mkdirSync(path.join(dir, "aufnahmen"), { recursive: true });
  writeFileSync(path.join(dir, "aufnahmen", "s01-1.wav"), sineWav({ seconds: 1, rate: 16_000, channels: 1 }));
  writeFileSync(path.join(dir, "aufnahmen", "s01-2.wav"), sineWav({ seconds: 1.5, rate: 48_000, channels: 2, hz: 220 }));
  const file = path.join(dir, "szenarien.json");
  writeFileSync(file, JSON.stringify(content, null, 2));
  return file;
}

function collect(): { lines: string[]; print: (line: string) => void } {
  const lines: string[] = [];
  return { lines, print: (line) => void lines.push(line) };
}

function loadExample(dir: string): { file: AudioScenarioFile; audio: Map<string, PcmAudio> } {
  writeExample(dir);
  const parsed = parseScenarioFile(exampleScenarios(), dir);
  assert.ok(parsed.ok);
  const audio = new Map<string, PcmAudio>();
  for (const turn of parsed.file.scenarios.flatMap((scenario) => scenario.turns)) {
    const wav = readWavFile(turn.file);
    assert.ok(wav.ok);
    audio.set(turn.file, wav);
  }
  return { file: parsed.file, audio };
}

describe("WAV files", () => {
  it("reads 16-bit mono and stereo WAV files and resamples them to 24 kHz", () => {
    const mono = decodeWav(sineWav({ seconds: 1, rate: 16_000, channels: 1 }));
    assert.ok(mono.ok);
    assert.equal(mono.sourceRate, 16_000);
    assert.equal(mono.sourceChannels, 1);
    assert.equal(mono.seconds, 1);
    assert.equal(mono.pcm.length, TARGET_RATE * 2);

    const stereo = decodeWav(sineWav({ seconds: 0.5, rate: 48_000, channels: 2 }));
    assert.ok(stereo.ok);
    assert.equal(stereo.sourceChannels, 2);
    assert.equal(stereo.pcm.length, (TARGET_RATE / 2) * 2);

    // The tone survives the resampling: sample n of the 24 kHz signal is the 440 Hz sine at n / 24 000 s.
    for (const index of [0, 7, 100, 5_000, 11_000]) {
      const expected = 8000 * Math.sin((2 * Math.PI * 440 * index) / TARGET_RATE);
      assert.ok(Math.abs(stereo.pcm.readInt16LE(index * 2) - expected) < 200, `sample ${index}`);
    }

    // The two channels are averaged into one.
    const left = new Int16Array([1000, -1000, 1000, -1000]);
    const mixed = new Int16Array(8);
    for (let index = 0; index < 4; index += 1) {
      mixed[index * 2] = left[index];
      mixed[index * 2 + 1] = 0;
    }
    const averaged = decodeWav(encodeWav(mixed, TARGET_RATE, 2));
    assert.ok(averaged.ok);
    assert.deepEqual([0, 1, 2, 3].map((index) => averaged.pcm.readInt16LE(index * 2)), [500, -500, 500, -500]);

    // 100 ms chunks of 4 800 bytes.
    const chunks = chunkPcm(mono.pcm);
    assert.equal(CHUNK_BYTES, 4_800);
    assert.equal(chunks.length, 10);
    assert.ok(chunks.every((chunk) => chunk.length === CHUNK_BYTES));
  });

  it("refuses other WAV formats and files that are too long", () => {
    assert.match((decodeWav(Buffer.from("not a wave file at all")) as { reason: string }).reason, /non è un file WAV/);

    const eightBit = sineWav({ seconds: 0.1, rate: 8_000, channels: 1 });
    eightBit.writeUInt16LE(8, 34);
    assert.match((decodeWav(eightBit) as { reason: string }).reason, /PCM a 16 bit/);

    const float = sineWav({ seconds: 0.1, rate: 8_000, channels: 1 });
    float.writeUInt16LE(3, 20);
    assert.match((decodeWav(float) as { reason: string }).reason, /PCM a 16 bit/);

    const surround = encodeWav(new Int16Array(30), 8_000, 1);
    surround.writeUInt16LE(3, 22);
    assert.match((decodeWav(surround) as { reason: string }).reason, /canali/);

    const long = decodeWav(sineWav({ seconds: 31, rate: 8_000, channels: 1 }));
    assert.equal(long.ok, false);
    assert.match((long as { reason: string }).reason, /al massimo 30 s/);
    assert.equal(decodeWav(sineWav({ seconds: 30, rate: 8_000, channels: 1 })).ok, true);

    const huge = Buffer.alloc(MAX_WAV_BYTES + 1);
    huge.write("RIFF", 0, "ascii");
    huge.write("WAVE", 8, "ascii");
    assert.match((decodeWav(huge) as { reason: string }).reason, /più grande di 10 MB/);

    const dir = folder("wav");
    writeFileSync(path.join(dir, "big.wav"), huge);
    assert.match((readWavFile(path.join(dir, "big.wav")) as { reason: string }).reason, /più grande di 10 MB/);
    assert.match((readWavFile(path.join(dir, "missing.wav")) as { reason: string }).reason, /non esiste/);
  });
});

describe("scenario file", () => {
  it("validates the scenario file and its expectations", () => {
    const dir = folder("scenarios");
    const good = parseScenarioFile(exampleScenarios(), dir);
    assert.ok(good.ok);
    assert.equal(good.file.tenant, "modolo");
    assert.equal(good.file.scenarios[0].greeting, true);
    assert.equal(good.file.scenarios[0].turns[0].file, path.join(dir, "aufnahmen", "s01-1.wav"));
    assert.deepEqual(good.file.scenarios[0].turns[1].expect, { tool: "request_callback", args: { phone: TEST_PHONE, name: TEST_PERSON } });

    const refused = (change: (content: Record<string, unknown>) => void, pattern: RegExp): void => {
      const content = exampleScenarios();
      change(content);
      const result = parseScenarioFile(content, dir);
      assert.equal(result.ok, false, String(pattern));
      assert.ok(!result.ok && result.errors.some((error) => pattern.test(error)), `${pattern}: ${JSON.stringify(result)}`);
    };
    const first = (content: Record<string, unknown>): Record<string, unknown> => (content.scenarios as Record<string, unknown>[])[0];
    const turns = (content: Record<string, unknown>): Record<string, unknown>[] => first(content).turns as Record<string, unknown>[];
    refused((content) => (content.version = 2), /version/);
    refused((content) => (content.tenant = "no-such-business"), /azienda sconosciuta/);
    refused((content) => (content.locale = "es"), /locale/);
    refused((content) => (first(content).id = "S 01"), /id/);
    refused((content) => (first(content).id = "S".repeat(21)), /id/);
    refused((content) => (content.scenarios = [first(content), { ...first(content) }]), /id ripetuto/);
    refused((content) => (content.scenarios = []), /da 1 a 40/);
    refused((content) => (content.scenarios = Array.from({ length: 41 }, (_, index) => ({ ...first(content), id: `S${index}` }))), /da 1 a 40/);
    refused((content) => (first(content).turns = []), /da 1 a 20/);
    refused((content) => (first(content).turns = Array.from({ length: 21 }, () => ({ audio: "a.wav" }))), /da 1 a 20/);
    refused((content) => (first(content).title = ""), /title/);
    refused((content) => (first(content).greeting = "yes"), /greeting/);
    refused((content) => (turns(content)[0].audio = 12), /audio/);
    refused((content) => (turns(content)[1].expect = { tool: "order_pizza" }), /non è uno strumento conosciuto/);
    refused((content) => (turns(content)[1].expect = { tool: "book_appointment" }), /non ha lo strumento book_appointment/);
    refused((content) => (turns(content)[1].expect = { tool: "request_callback", args: { phone: 780000044 } }), /deve essere un testo/);
    refused((content) => (turns(content)[1].expect = { tool: "request_callback", args: ["phone"] }), /oggetto di testi/);
    assert.equal(parseScenarioFile([], dir).ok, false);
  });
});

describe("paths, flags and the key", () => {
  it("refuses a scenario file, an audio file or an output folder inside the repository", async () => {
    const dir = folder("inside");
    const scenarios = writeExample(dir);
    const out = path.join(dir, "out");

    const insideFile = collect();
    assert.equal(await main(["--scenari", path.join(REPO_ROOT, "szenarien.json"), "--uscita", out, "--prova-a-secco"], { print: insideFile.print }), 2);
    assert.match(insideFile.lines.join("\n"), /file degli scenari è dentro il repository/);

    const insideOut = collect();
    assert.equal(await main(["--scenari", scenarios, "--uscita", path.join(REPO_ROOT, "tmp-audio-out"), "--prova-a-secco"], { print: insideOut.print }), 2);
    assert.match(insideOut.lines.join("\n"), /cartella dei risultati è dentro il repository/);

    const content = exampleScenarios();
    ((content.scenarios as Record<string, unknown>[])[0].turns as Record<string, unknown>[])[0].audio = path.join(REPO_ROOT, "public", "s01-1.wav");
    const leaking = path.join(folder("inside-audio"), "szenarien.json");
    writeFileSync(leaking, JSON.stringify(content));
    const insideAudio = collect();
    assert.equal(await main(["--scenari", leaking, "--uscita", out, "--prova-a-secco"], { print: insideAudio.print }), 2);
    assert.match(insideAudio.lines.join("\n"), /registrazione è dentro il repository/);

    const missing = collect();
    assert.equal(await main(["--uscita", out, "--prova-a-secco"], { print: missing.print }), 2);
    assert.match(missing.lines.join("\n"), /Manca --scenari/);
    // Nothing was written.
    assert.deepEqual(readdirSync(dir).sort(), ["aufnahmen", "szenarien.json"]);
  });

  it("refuses a child folder of the repository whose name starts with two dots", async () => {
    // The path test itself, without the walk up to a .git entry: a segment test, not a prefix test.
    assert.equal(within(REPO_ROOT, path.join(REPO_ROOT, "..rapporti")), true);
    assert.equal(within(REPO_ROOT, path.join(REPO_ROOT, "..rapporti", "out")), true);
    assert.equal(within(REPO_ROOT, path.join(REPO_ROOT, "..", "rapporti")), false);
    assert.equal(within(REPO_ROOT, path.dirname(REPO_ROOT)), false);
    assert.equal(insideRepository(path.join(REPO_ROOT, "..rapporti")), true);
    assert.equal(insideRepository(path.join(REPO_ROOT, "..rapporti", "out")), true);

    const dir = folder("dots");
    const run = collect();
    assert.equal(await main(["--scenari", writeExample(dir), "--uscita", path.join(REPO_ROOT, "..rapporti"), "--prova-a-secco"], { print: run.print }), 2);
    assert.match(run.lines.join("\n"), /cartella dei risultati è dentro il repository/);
  });

  it("refuses a path inside another git checkout", async () => {
    const checkout = folder("other-checkout");
    // A worktree or a submodule has a .git file instead of a folder: an empty one is enough.
    writeFileSync(path.join(checkout, ".git"), "");
    assert.equal(insideRepository(checkout), true);
    assert.equal(insideRepository(path.join(checkout, "rapporti", "nuovi")), true, "a folder that does not exist yet");
    const withFolder = folder("other-checkout-folder");
    mkdirSync(path.join(withFolder, ".git"));
    assert.equal(insideRepository(path.join(withFolder, "out")), true);
    // A plain folder is fine.
    assert.equal(insideRepository(path.join(folder("plain"), "out")), false);

    const dir = folder("to-checkout");
    const scenarios = writeExample(dir);
    const run = collect();
    assert.equal(await main(["--scenari", scenarios, "--uscita", path.join(checkout, "rapporti"), "--prova-a-secco"], { print: run.print }), 2);
    assert.match(run.lines.join("\n"), /cartella dei risultati è dentro il repository o in un'altra cartella di git/);
    assert.deepEqual(readdirSync(checkout), [".git"], "nothing was written there");

    // A scenario file and a recording inside the other checkout are refused too.
    const inCheckout = writeExample(checkout);
    const fileRun = collect();
    assert.equal(await main(["--scenari", inCheckout, "--uscita", path.join(dir, "out"), "--prova-a-secco"], { print: fileRun.print }), 2);
    assert.match(fileRun.lines.join("\n"), /file degli scenari è dentro il repository/);
    const content = exampleScenarios();
    ((content.scenarios as Record<string, unknown>[])[0].turns as Record<string, unknown>[])[0].audio = path.join(checkout, "aufnahmen", "s01-1.wav");
    assert.ok(!parseScenarioFile(content, dir).ok);
  });

  it("takes the key from OPENAI_API_KEY, and from VOICE_PROVIDER_API_KEY only for the provider openai", async () => {
    const noFile = path.join(folder("keys"), "no.env");
    const gateWith = (vars: Parameters<typeof setVoiceEnv>[0]): ReturnType<typeof gateAudioRun> => {
      const restore = setVoiceEnv(vars);
      try {
        return gateAudioRun({ approved: true, envFile: noFile });
      } finally {
        restore();
      }
    };
    const otherVendor = "other-vendor-placeholder-key";
    // Another vendor's key (or a leftover) in the generic variable never goes to OpenAI.
    assert.equal(gateWith({ VOICE_PROVIDER_API_KEY: otherVendor }).ok, false);
    assert.equal(gateWith({ VOICE_PROVIDER: "mock", VOICE_PROVIDER_API_KEY: otherVendor }).ok, false);
    assert.deepEqual(gateWith({ VOICE_PROVIDER: "openai", VOICE_PROVIDER_API_KEY: TEST_OPENAI_KEY }), { ok: true, apiKey: TEST_OPENAI_KEY, keySource: "VOICE_PROVIDER_API_KEY" });
    assert.deepEqual(gateWith({ VOICE_PROVIDER: "openai", VOICE_PROVIDER_API_KEY: otherVendor, OPENAI_API_KEY: TEST_OPENAI_KEY }), {
      ok: true,
      apiKey: TEST_OPENAI_KEY,
      keySource: "OPENAI_API_KEY",
    });
    assert.deepEqual(gateWith({ VOICE_PROVIDER_API_KEY: otherVendor, OPENAI_API_KEY: TEST_OPENAI_KEY }), { ok: true, apiKey: TEST_OPENAI_KEY, keySource: "OPENAI_API_KEY" });

    // The start-up text names the variable, never the key.
    const dir = folder("key-source");
    const restore = setVoiceEnv({ VOICE_PROVIDER: "openai", VOICE_PROVIDER_API_KEY: TEST_OPENAI_KEY });
    try {
      const run = collect();
      const keys: string[] = [];
      const connect = async (_url: string, key: string): Promise<OpenControlResult> => {
        keys.push(key);
        return { ok: true, socket: createFakeRealtimeSocket({ expectations: [undefined, undefined], tools: toolDefinitions(MODOLO_VOICE_TENANT) }) };
      };
      assert.equal(await main(["--scenari", writeExample(dir), "--uscita", path.join(dir, "out"), "--spesa-approvata", "--tetto-usd", "5"], { envFile: noFile, print: run.print, connect }), 0);
      assert.deepEqual(keys, [TEST_OPENAI_KEY]);
      assert.match(run.lines.join("\n"), /letta da VOICE_PROVIDER_API_KEY: non viene mostrata/);
      assert.ok(!run.lines.join("\n").includes(TEST_OPENAI_KEY));
    } finally {
      restore();
    }
  });

  it("requires exactly one of the dry-run and the approval flag", async () => {
    for (const argv of [[], ["--prova-a-secco", "--spesa-approvata"]]) {
      const parsed = parseAudioArgs(["--scenari", "x.json", "--uscita", "out", ...argv]);
      assert.ok(parsed.errors.some((error) => error.includes("--prova-a-secco") && error.includes("--spesa-approvata")), JSON.stringify(parsed.errors));
      const run = collect();
      assert.equal(await main(["--scenari", "x.json", "--uscita", "out", ...argv], { print: run.print }), 2);
      assert.match(run.lines.join("\n"), /--prova-a-secco.*--spesa-approvata/);
    }
    assert.deepEqual(parseAudioArgs(["--prova-a-secco"]).errors, []);
    assert.deepEqual(parseAudioArgs(["--spesa-approvata"]).errors, []);
    // The defaults and their bounds.
    const defaults = parseAudioArgs(["--prova-a-secco"]);
    assert.equal(defaults.ceilingUsd, 0.5);
    assert.equal(defaults.model, OPENAI_REALTIME_MODELS[0]);
    assert.equal(DEFAULT_MODEL, "gpt-realtime-2.1");
    assert.equal(parseAudioArgs(["--prova-a-secco", "--modello", "gpt-realtime-2.1-mini"]).model, "gpt-realtime-2.1-mini");
    assert.ok(parseAudioArgs(["--prova-a-secco", "--modello", "gpt-4o"]).errors.length > 0);
    assert.equal(parseAudioArgs(["--prova-a-secco", "--tetto-usd", "5"]).ceilingUsd, 5);
    for (const ceiling of ["0", "5.01", "-1", "abc"]) assert.ok(parseAudioArgs(["--prova-a-secco", "--tetto-usd", ceiling]).errors.length > 0, ceiling);
    assert.deepEqual(parseAudioArgs(["--prova-a-secco", "--solo", "S01, S02"]).ids, ["S01", "S02"]);
    assert.ok(parseAudioArgs(["--prova-a-secco", "--unknown"]).errors.some((error) => error.includes("--unknown")));
  });

  it("refuses a paid run without a key, and never prints the key", async () => {
    const dir = folder("paid");
    const scenarios = writeExample(dir);
    const out = path.join(dir, "out");
    const noKey = collect();
    assert.equal(await main(["--scenari", scenarios, "--uscita", out, "--spesa-approvata"], { envFile: path.join(dir, "no.env"), print: noKey.print }), 3);
    assert.match(noKey.lines.join("\n"), /manca la chiave di OpenAI/);
    assert.deepEqual(readdirSync(dir).sort(), ["aufnahmen", "szenarien.json"]);

    const envFile = path.join(dir, "test.env");
    writeFileSync(envFile, `OPENAI_API_KEY=${TEST_OPENAI_KEY}\n`);
    // Without the flag nothing is read.
    assert.equal(gateAudioRun({ approved: false, envFile }).ok, false);
    assert.equal(process.env.OPENAI_API_KEY, undefined);

    // With the flag and the key, the paid run opens its socket with the key, and nobody sees it.
    const opened: Array<{ url: string; key: string }> = [];
    const sockets: FakeRealtimeSocket[] = [];
    const connect = async (url: string, key: string): Promise<OpenControlResult> => {
      opened.push({ url, key });
      const socket = createFakeRealtimeSocket({ expectations: [undefined, undefined], tools: toolDefinitions(MODOLO_VOICE_TENANT) });
      sockets.push(socket);
      return { ok: true, socket };
    };
    const paid = collect();
    assert.equal(await main(["--scenari", scenarios, "--uscita", out, "--spesa-approvata", "--tetto-usd", "5"], { envFile, print: paid.print, connect }), 0);
    assert.deepEqual(opened, [{ url: "wss://api.openai.com/v1/realtime?model=gpt-realtime-2.1", key: TEST_OPENAI_KEY }]);
    assert.match(paid.lines.join("\n"), /A PAGAMENTO/);
    assert.match(paid.lines.join("\n"), /letta da OPENAI_API_KEY/);
    assert.ok(!paid.lines.join("\n").includes(TEST_OPENAI_KEY));
    for (const name of readdirSync(out)) assert.ok(!readFileSync(path.join(out, name), "utf8").includes(TEST_OPENAI_KEY), name);
    assert.ok(!JSON.stringify(sockets[0].sent).includes(TEST_OPENAI_KEY));
    assert.equal(sockets[0].closedWith, 1000);
  });
});

describe("a dry run", () => {
  it("plays a dry run end to end without network and writes the reports", async (t) => {
    // Any attempt at the network fails the test.
    const blocked = (): never => {
      throw new Error("network used in a dry run");
    };
    t.mock.method(globalThis, "fetch", blocked);
    const holder = globalThis as { WebSocket?: unknown };
    const originalSocket = holder.WebSocket;
    holder.WebSocket = blocked;
    t.after(() => {
      holder.WebSocket = originalSocket;
    });

    const dir = folder("dry");
    const scenarios = writeExample(dir);
    const out = path.join(dir, "ergebnisse");
    const run = collect();
    assert.equal(await main(["--scenari", scenarios, "--uscita", out, "--prova-a-secco"], { envFile: path.join(dir, "never-read.env"), print: run.print }), 0);
    const printed = run.lines.join("\n");
    assert.match(printed, /prova a secco/);
    assert.match(printed, /Scenari: 1; frasi registrate: 2/);
    // No theoretical maximum of every possible response: the ceiling is what bounds the run.
    assert.doesNotMatch(printed, /Stima massima/);
    assert.match(printed, /Tetto di spesa: 0.5 USD\. .*non spende mai più del tetto, al massimo il costo di una risposta in più/);
    assert.match(printed, /Prezzi: lib\/voice\/server\/realtime\/pricing\.ts/);

    // Exactly the three files, nowhere else.
    assert.deepEqual(readdirSync(out).sort(), ["S01.json", "S01.md", "indice.md"]);
    assert.deepEqual(readdirSync(dir).sort(), ["aufnahmen", "ergebnisse", "szenarien.json"]);
    const index = readFileSync(path.join(out, "indice.md"), "utf8");
    assert.match(index, /a secco/);
    assert.match(index, /\| S01 \| Rückruf mit buchstabiertem Namen \| 2 di 2 \| 1 di 1 \|/);
    const markdown = readFileSync(path.join(out, "S01.md"), "utf8");
    assert.match(markdown, /prova a secco/);
    assert.match(markdown, /### Saluto/);
    assert.match(markdown, /trascrizione finta della frase 2/);
    assert.match(markdown, /Strumento `request_callback`, esito: ok/);
    assert.match(markdown, /superato/);

    const json = JSON.parse(readFileSync(path.join(out, "S01.json"), "utf8"));
    assert.equal(json.mode, "dry");
    assert.equal(json.model, "gpt-realtime-2.1");
    assert.equal(json.error, null);
    assert.equal(json.turns.length, 2);
    assert.equal(json.turns[0].expectation, null);
    assert.equal(json.turns[1].expectation.passed, true);
    assert.equal(json.turns[1].toolCalls[0].name, "request_callback");
    assert.equal(json.turns[1].toolCalls[0].args.phone, TEST_PHONE);
    assert.equal(json.turns[1].responses, 2, "the tool call and the answer after its output");
    assert.equal(typeof json.turns[0].commitToAudioMs, "number");
    assert.equal(typeof json.turns[0].commitToTranscriptMs, "number");
    assert.ok(json.usdHigh > 0);
    assert.equal(json.outcomes.length, 1);
  });

  it("sends the site's session over the websocket, with the tenant's languages, and plays the turns", async () => {
    const { file, audio } = loadExample(folder("session"));
    const plan = planAudioRun({ file, scenarios: file.scenarios, audio, model: "gpt-realtime-2.1-mini", vad: false });
    const session = plan.session as { model: string; audio: { input: Record<string, unknown>; output: Record<string, unknown> }; tools: unknown[] };
    assert.equal(session.model, "gpt-realtime-2.1-mini");
    assert.deepEqual(session.audio.input.format, { type: "audio/pcm", rate: 24000 });
    assert.equal(session.audio.input.turn_detection, null);
    assert.deepEqual(session.audio.input.transcription, { model: "gpt-transcribe", languages: ["de", "it", "en", "fr"] });
    assert.equal(session.tools.length, toolDefinitions(MODOLO_VOICE_TENANT).length);
    assert.ok(plan.upperUsd > 0);
    assert.equal(plan.turns, 2);

    const vad = planAudioRun({ file, scenarios: file.scenarios, audio, model: DEFAULT_MODEL, vad: true }).session as typeof session;
    assert.deepEqual(vad.audio.input.turn_detection, { type: "semantic_vad", eagerness: "low", create_response: true, interrupt_response: true });
    assert.deepEqual(vad.audio.input.format, { type: "audio/pcm", rate: 24000 });

    const sockets: FakeRealtimeSocket[] = [];
    const result = await runAudio({
      mode: "paid",
      apiKey: TEST_OPENAI_KEY,
      outDir: folder("session-out"),
      file,
      scenarios: file.scenarios,
      audio,
      model: DEFAULT_MODEL,
      ceilingUsd: 5,
      vad: false,
      print: () => undefined,
      connect: async () => {
        const socket = createFakeRealtimeSocket({ expectations: file.scenarios[0].turns.map((turn) => turn.expect), tools: toolDefinitions(MODOLO_VOICE_TENANT) });
        sockets.push(socket);
        return { ok: true, socket };
      },
    });
    assert.equal(result.stopped, null);
    const types = sockets[0].sent.map((event) => event.type);
    assert.equal(types[0], "session.update");
    assert.equal(types[1], "response.create", "the greeting first");
    const greeting = sockets[0].sent[1] as { response: { instructions: string } };
    assert.match(greeting.response.instructions, /^Speak exactly this greeting, word for word, in Swiss Standard German/);
    // Turn 1: its 10 chunks of 100 ms, the commit, one response.
    const firstCommit = types.indexOf("input_audio_buffer.commit");
    assert.deepEqual(types.slice(2, firstCommit), Array(10).fill("input_audio_buffer.append"));
    assert.equal(types[firstCommit + 1], "response.create");
    // Turn 2: the tool's output goes back, then the instructions learn the outcome, then the next response.
    const output = sockets[0].sent.find((event) => event.type === "conversation.item.create") as { item: { type: string; output: string } };
    assert.equal(output.item.type, "function_call_output");
    assert.equal(JSON.parse(output.item.output).ok, true);
    assert.deepEqual(types.slice(-3), ["conversation.item.create", "session.update", "response.create"]);
  });
});

describe("the ceiling and the expectations", () => {
  it("stops at the ceiling before a response that could pass it", async () => {
    const { file, audio } = loadExample(folder("ceiling"));
    // Room for the greeting, not for the first turn's response.
    const greetingUpper = responseUpperUsd({ model: DEFAULT_MODEL, host: "api.openai.com", maxOutputTokens: 1024, turnAudioSeconds: 0, historyTokens: 0 });
    const fake = emptyUsage();
    addResponseUsage(fake, FAKE_RESPONSE_USAGE);
    const greetingCost = usageCostUsd(DEFAULT_MODEL, fake, null, "api.openai.com").usdHigh;
    const historyTokens = fake.inTok + fake.inAuTok + fake.outTok + fake.outAuTok;
    const turnUpper = responseUpperUsd({ model: DEFAULT_MODEL, host: "api.openai.com", maxOutputTokens: 1024, turnAudioSeconds: 1, historyTokens });
    const ceiling = (greetingUpper + greetingCost + turnUpper) / 2;
    assert.ok(greetingUpper < ceiling && greetingCost + turnUpper > ceiling);

    const sockets: FakeRealtimeSocket[] = [];
    const outDir = folder("ceiling-out");
    const result = await runAudio({
      mode: "paid",
      apiKey: TEST_OPENAI_KEY,
      outDir,
      file,
      scenarios: file.scenarios,
      audio,
      model: DEFAULT_MODEL,
      ceilingUsd: ceiling,
      vad: false,
      print: () => undefined,
      connect: async () => {
        const socket = createFakeRealtimeSocket({ expectations: [], tools: [] });
        sockets.push(socket);
        return { ok: true, socket };
      },
    });
    assert.match(result.stopped ?? "", /^Tetto di spesa: la risposta successiva poteva costare/);
    assert.equal(sockets[0].sent.filter((event) => event.type === "response.create").length, 1, "only the greeting was asked for");
    assert.ok(result.spentUsd <= ceiling);
    assert.equal(result.results[0].ceilingHit, true);
    assert.match(readFileSync(path.join(outDir, "indice.md"), "utf8"), /Fermata dal tetto: Tetto di spesa/);

    // The command says so and exits with 4.
    const dir = folder("ceiling-cli");
    const run = collect();
    const code = await main(["--scenari", writeExample(dir), "--uscita", path.join(dir, "out"), "--prova-a-secco", "--tetto-usd", String(ceiling)], { print: run.print });
    assert.equal(code, 4);
    assert.match(run.lines.join("\n"), /FERMATA DAL TETTO/);
  });

  it("with turn detection, takes no further response once the ceiling is reached, and closes the socket", async () => {
    // One recording that turn detection splits in two: speech, a pause, speech again.
    const dir = folder("vad-ceiling");
    mkdirSync(path.join(dir, "aufnahmen"), { recursive: true });
    const half = TARGET_RATE / 2;
    const samples = new Int16Array(half * 3);
    for (let index = 0; index < samples.length; index += 1) {
      if (index < half || index >= half * 2) samples[index] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * index) / TARGET_RATE));
    }
    writeFileSync(path.join(dir, "aufnahmen", "split.wav"), encodeWav(samples, TARGET_RATE, 1));
    const parsed = parseScenarioFile(
      {
        version: 1,
        tenant: "modolo",
        locale: "de",
        scenarios: [{ id: "S01", title: "Zwei Antworten", greeting: false, turns: [{ audio: "aufnahmen/split.wav" }, { audio: "aufnahmen/split.wav" }] }],
      },
      dir,
    );
    assert.ok(parsed.ok);
    const wav = readWavFile(parsed.file.scenarios[0].turns[0].file);
    assert.ok(wav.ok);
    const audio = new Map<string, PcmAudio>([[parsed.file.scenarios[0].turns[0].file, wav]]);

    // Room for the turn's first response; that response alone reaches the ceiling.
    const ceiling = responseUpperUsd({ model: DEFAULT_MODEL, host: "api.openai.com", maxOutputTokens: 1024, turnAudioSeconds: wav.seconds, historyTokens: 0 });
    const responseUsage = { input_token_details: { text_tokens: 1000, audio_tokens: 0 }, output_token_details: { text_tokens: 100, audio_tokens: 10_000 } };
    const big = emptyUsage();
    addResponseUsage(big, responseUsage);
    const responseCost = usageCostUsd(DEFAULT_MODEL, big, null, "api.openai.com").usdHigh;
    assert.ok(responseCost >= ceiling);

    const sockets: FakeRealtimeSocket[] = [];
    const result = await runAudio({
      mode: "paid",
      apiKey: TEST_OPENAI_KEY,
      outDir: folder("vad-ceiling-out"),
      file: parsed.file,
      scenarios: parsed.file.scenarios,
      audio,
      model: DEFAULT_MODEL,
      ceilingUsd: ceiling,
      vad: true,
      print: () => undefined,
      sleep: async () => undefined,
      connect: async () => {
        const socket = createFakeRealtimeSocket({ expectations: [], tools: [], responseUsage });
        sockets.push(socket);
        return { ok: true, socket };
      },
    });
    assert.equal(sockets[0].responses, 2, "the fake session answered the one recording twice");
    const scenario = result.results[0];
    assert.equal(scenario.turns.length, 1, "the second recording was not played");
    assert.equal(scenario.turns[0].responses, 1, "the second answer was not taken");
    assert.ok(!scenario.turns[0].notes.some((note) => note.includes("un'altra risposta")));
    assert.ok(result.spentUsd < responseCost * 2);
    assert.match(result.stopped ?? "", /^Tetto di spesa raggiunto/);
    assert.equal(scenario.ceilingHit, true);
    assert.equal(scenario.error, null);
    assert.equal(sockets[0].closedWith, 1000);
    // Only the first recording's audio and its trailing silence were sent.
    assert.equal(sockets[0].sent.filter((event) => event.type === "input_audio_buffer.append").length, 15 + 15);
  });

  it("counts the caller's transcription billed in seconds or in tokens", async () => {
    const { file, audio } = loadExample(folder("transcribe"));
    const run = async (transcriptionUsage?: Record<string, unknown>) =>
      runAudio({
        mode: "paid",
        apiKey: TEST_OPENAI_KEY,
        outDir: folder("transcribe-out"),
        file,
        scenarios: file.scenarios,
        audio,
        model: DEFAULT_MODEL,
        ceilingUsd: 5,
        vad: false,
        print: () => undefined,
        connect: async () => ({ ok: true, socket: createFakeRealtimeSocket({ expectations: [], tools: [], ...(transcriptionUsage ? { transcriptionUsage } : {}) }) }),
      });

    const seconds = await run({ type: "duration", seconds: 3 });
    assert.equal(seconds.results[0].usage.transcribeSec, 6);
    assert.equal(seconds.results[0].usage.transcribeInTok, 0);

    // The shape of a token-billed transcription model (example numbers).
    const tokens = await run({ type: "tokens", total_tokens: 120, input_tokens: 100, input_token_details: { text_tokens: 0, audio_tokens: 100 }, output_tokens: 20 });
    const usage = tokens.results[0].usage;
    assert.equal(usage.transcribeSec, 0);
    assert.equal(usage.transcribeInTok, 200);
    assert.equal(usage.transcribeOutTok, 40);
    const transcription = { ...emptyUsage(), transcribeInTok: 200, transcribeOutTok: 40 };
    const none = await run({ type: "tokens" });
    const expected = usageCostUsd(DEFAULT_MODEL, transcription, "gpt-transcribe", "api.openai.com").usdHigh;
    assert.ok(expected > 0);
    assert.ok(Math.abs(tokens.results[0].usdHigh - none.results[0].usdHigh - expected) < 1e-12);
    const markdown = readFileSync(tokens.files.find((name) => name.endsWith("S01.md")) ?? "", "utf8");
    assert.match(markdown, /200 token in entrata, 40 in uscita/);
  });

  it("compares the expected tool arguments after normalising the phone number", () => {
    assert.deepEqual(compareArgs({ phone: TEST_PHONE, name: TEST_PERSON }, { phone: TEST_PHONE_SPOKEN, name: "  testperson EINS " }), { ok: true, differences: [] });
    assert.equal(compareArgs({ phone: TEST_PHONE_SPOKEN }, { phone: TEST_PHONE }).ok, true);
    // Another number (a landline of the same placeholder digits): a difference.
    assert.equal(compareArgs({ phone: TEST_PHONE }, { phone: "044 000 00 44" }).ok, false);
    assert.equal(compareArgs({ name: TEST_PERSON }, { name: "Testperson Zwei" }).ok, false);
    assert.equal(compareArgs({ "contact.phone": TEST_PHONE }, { contact: { phone: TEST_PHONE_SPOKEN } }).ok, true);
    assert.match(compareArgs({ phone: TEST_PHONE }, {}).differences[0], /phone: manca/);

    const call = { callId: "call_1", name: "request_callback", args: { phone: TEST_PHONE_SPOKEN, name: TEST_PERSON, topic: "Test" }, ok: true, code: "ok", endCall: false };
    assert.equal(judge({ tool: "request_callback", args: { phone: TEST_PHONE } }, [call])?.passed, true);
    assert.equal(judge({ tool: "request_callback", args: { phone: "044 000 00 44" } }, [call])?.passed, false);
    assert.match(judge({ tool: "create_lead" }, [call])?.detail ?? "", /chiamato request_callback invece di create_lead/);
    assert.match(judge({ tool: "end_call" }, [])?.detail ?? "", /nessuno strumento chiamato/);
    assert.equal(judge(undefined, [call]), null);
  });
});
