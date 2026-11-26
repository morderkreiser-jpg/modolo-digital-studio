// npm run voice:audio -- --scenari <file.json> --uscita <cartella> (--prova-a-secco | --spesa-approvata)
//                        [--tetto-usd 0.5] [--modello gpt-realtime-2.1] [--solo S01,S02] [--vad]
//
// Plays recorded callers (WAV files) to the OpenAI realtime model with the site's own session,
// prompt and tools, and writes what was heard, said and done. Or the same run against a fake
// session ("--prova-a-secco": no key, no network, nothing spent).
//
// Safety of the paid run:
//   - exactly one of --prova-a-secco and --spesa-approvata (the owner approved the spend) is
//     required; the key is read only with --spesa-approvata: from OPENAI_API_KEY, else from
//     VOICE_PROVIDER_API_KEY when VOICE_PROVIDER is "openai", after loading .env.local when the file
//     exists; it is never printed or written (only the variable's name is printed);
//   - before it starts it prints the scenarios, the turns, the ceiling (the run spends at most the
//     ceiling plus one response) and where the prices come from;
//   - it stops before a response that could pass the ceiling (--tetto-usd, default 0.50 USD), and
//     after the response that reaches it, saying so;
//   - the scenario file, the recordings and the reports must be outside the repository (the
//     repository is public, the recordings are real voices); nothing is written anywhere else.
// Exit codes: 0 done, 1 error, 2 bad arguments or files, 3 paid run refused, 4 stopped by the ceiling.
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { OPENAI_REALTIME_MODELS, resetVoiceEnvForTests, type OpenAiRealtimeModel } from "@/lib/voice/server/env";
import type { OpenControlResult } from "@/lib/voice/server/providers/types";
import { AUDIO_PRICE_SOURCE, planAudioRun, runAudio } from "./audio-runner";
import { insideRepository, loadScenarioFile, pickScenarios, REPO_ROOT } from "./audio-scenarios";
import { readWavFile, type PcmAudio } from "./audio-wav";

export const DEFAULT_ENV_FILE = path.join(REPO_ROOT, ".env.local");
export const DEFAULT_CEILING_USD = 0.5;
/** A ceiling above this is a typo, not a decision for "a few cents". */
export const MAX_CEILING_USD = 5;
export const DEFAULT_MODEL: OpenAiRealtimeModel = OPENAI_REALTIME_MODELS[0];

export interface AudioCliArgs {
  scenarioFile: string | null;
  outDir: string | null;
  dry: boolean;
  approved: boolean;
  ceilingUsd: number;
  model: OpenAiRealtimeModel;
  ids: string[] | null;
  vad: boolean;
  errors: string[];
}

function isModel(value: string): value is OpenAiRealtimeModel {
  return (OPENAI_REALTIME_MODELS as readonly string[]).includes(value);
}

export function parseAudioArgs(argv: readonly string[]): AudioCliArgs {
  const args: AudioCliArgs = {
    scenarioFile: null,
    outDir: null,
    dry: false,
    approved: false,
    ceilingUsd: DEFAULT_CEILING_USD,
    model: DEFAULT_MODEL,
    ids: null,
    vad: false,
    errors: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = (): string | null => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith("--")) {
        args.errors.push(`${arg} vuole un valore.`);
        return null;
      }
      index += 1;
      return next;
    };
    if (arg === "--scenari") args.scenarioFile = value();
    else if (arg === "--uscita") args.outDir = value();
    else if (arg === "--prova-a-secco") args.dry = true;
    else if (arg === "--spesa-approvata") args.approved = true;
    else if (arg === "--vad") args.vad = true;
    else if (arg === "--tetto-usd") {
      const raw = value();
      const ceiling = raw === null ? NaN : Number(raw);
      if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling > MAX_CEILING_USD) args.errors.push(`--tetto-usd: un numero più grande di 0 e al massimo ${MAX_CEILING_USD}.`);
      else args.ceilingUsd = ceiling;
    } else if (arg === "--modello") {
      const raw = value();
      if (raw !== null && isModel(raw)) args.model = raw;
      else if (raw !== null) args.errors.push(`--modello: uno tra ${OPENAI_REALTIME_MODELS.join(", ")}.`);
    } else if (arg === "--solo") {
      const raw = value();
      if (raw !== null) args.ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
    } else args.errors.push(`Argomento sconosciuto: ${arg}`);
  }
  if (args.dry === args.approved) {
    args.errors.push("Serve esattamente una delle due opzioni --prova-a-secco (prova senza costi) e --spesa-approvata (prova vera, a pagamento): non nessuna, non tutte e due.");
  }
  return args;
}

/** A path the tool reads or writes, resolved; refused when missing or inside the repository. */
export function checkOutsideRepo(target: string | null, what: { missing: string; inside: string }): { ok: true; path: string } | { ok: false; reason: string } {
  if (target === null || target.trim() === "") return { ok: false, reason: what.missing };
  const resolved = path.resolve(target);
  if (insideRepository(resolved)) return { ok: false, reason: what.inside };
  return { ok: true, path: resolved };
}

const SCENARIO_PATH_TEXTS = {
  missing: "Manca --scenari <file.json>: il file degli scenari va dato sempre, fuori dal repository.",
  inside: "Il file degli scenari è dentro il repository o in un'altra cartella di git (il repository è pubblico): tienilo fuori, insieme alle registrazioni.",
};
const OUT_DIR_TEXTS = {
  missing: "Manca --uscita <cartella>: la cartella dei risultati va data sempre, fuori dal repository.",
  inside: "La cartella dei risultati è dentro il repository o in un'altra cartella di git (il repository è pubblico): scegline una fuori.",
};

/** The variable the key of a paid run came from (its name is printed, never the key). */
export type AudioKeySource = "OPENAI_API_KEY" | "VOICE_PROVIDER_API_KEY";

/**
 * The gate of the paid run: the owner's flag first (nothing is read without it), then the key from
 * the environment, after loading the env file when it exists: OPENAI_API_KEY, else
 * VOICE_PROVIDER_API_KEY when VOICE_PROVIDER is "openai". The key is returned, never printed.
 */
export function gateAudioRun(options: { approved: boolean; envFile: string }): { ok: true; apiKey: string; keySource: AudioKeySource } | { ok: false; reason: string } {
  if (!options.approved) {
    return { ok: false, reason: "Prova a pagamento rifiutata: manca --spesa-approvata (il sì esplicito alla spesa). Per una prova senza costi: --prova-a-secco." };
  }
  if (existsSync(options.envFile)) {
    try {
      // Node's own loader: variables already set in the shell are kept. Nothing of it is printed.
      process.loadEnvFile(options.envFile);
    } catch {
      return { ok: false, reason: "Il file delle variabili esiste ma non si legge." };
    }
    // The VOICE_OPENAI_* settings of the file apply to the run.
    resetVoiceEnvForTests();
  }
  // The tool always talks to OpenAI: its own variable first; the generic one only when it is set
  // for OpenAI, so that another vendor's key is never sent there.
  const openAiKey = process.env.OPENAI_API_KEY?.trim() ?? "";
  if (openAiKey !== "") return { ok: true, apiKey: openAiKey, keySource: "OPENAI_API_KEY" };
  const providerKey = process.env.VOICE_PROVIDER === "openai" ? (process.env.VOICE_PROVIDER_API_KEY?.trim() ?? "") : "";
  if (providerKey !== "") return { ok: true, apiKey: providerKey, keySource: "VOICE_PROVIDER_API_KEY" };
  return {
    ok: false,
    reason:
      "Prova a pagamento rifiutata: manca la chiave di OpenAI. Mettila in OPENAI_API_KEY (nell'ambiente o nel file .env.local); VOICE_PROVIDER_API_KEY vale solo se anche VOICE_PROVIDER è openai.",
  };
}

export interface AudioMainOptions {
  envFile?: string;
  print?: (line: string) => void;
  /** Tests only: how a paid run opens its socket (default the real WebSocket). */
  connect?: (url: string, apiKey: string) => Promise<OpenControlResult>;
  /** Tests only: the pause between chunks with --vad. */
  sleep?: (ms: number) => Promise<void>;
}

/** The whole command. Returns the exit code. */
export async function main(argv: readonly string[], options: AudioMainOptions = {}): Promise<number> {
  const print = options.print ?? ((line: string) => console.log(line));
  const args = parseAudioArgs(argv);
  if (args.errors.length > 0) {
    for (const error of args.errors) print(error);
    return 2;
  }
  const scenarioPath = checkOutsideRepo(args.scenarioFile, SCENARIO_PATH_TEXTS);
  if (!scenarioPath.ok) {
    print(scenarioPath.reason);
    return 2;
  }
  const out = checkOutsideRepo(args.outDir, OUT_DIR_TEXTS);
  if (!out.ok) {
    print(out.reason);
    return 2;
  }
  const loaded = loadScenarioFile(scenarioPath.path);
  if (!loaded.ok) {
    print("Il file degli scenari non va bene:");
    for (const error of loaded.errors) print(`  - ${error}`);
    return 2;
  }
  const picked = pickScenarios(loaded.file, args.ids);
  if (picked.unknown.length > 0 || picked.scenarios.length === 0) {
    print(`Nessuno scenario con questi nomi: ${picked.unknown.join(", ") || "(vuoto)"}. Scenari: ${loaded.file.scenarios.map((scenario) => scenario.id).join(", ")}`);
    return 2;
  }

  // Every recording is read and checked before anything starts, in both modes.
  const audio = new Map<string, PcmAudio>();
  const wavErrors: string[] = [];
  for (const scenario of picked.scenarios) {
    for (const turn of scenario.turns) {
      if (audio.has(turn.file)) continue;
      const wav = readWavFile(turn.file);
      if (wav.ok) audio.set(turn.file, wav);
      else wavErrors.push(`${scenario.id}, ${turn.audio}: ${wav.reason}`);
    }
  }
  if (wavErrors.length > 0) {
    print("Registrazioni non utilizzabili:");
    for (const error of wavErrors) print(`  - ${error}`);
    return 2;
  }

  let apiKey: string | undefined;
  let keySource: AudioKeySource | null = null;
  if (!args.dry) {
    const gate = gateAudioRun({ approved: args.approved, envFile: options.envFile ?? DEFAULT_ENV_FILE });
    if (!gate.ok) {
      print(gate.reason);
      return 3;
    }
    apiKey = gate.apiKey;
    keySource = gate.keySource;
  }
  const mode = args.dry ? "dry" : "paid";
  const plan = planAudioRun({ file: loaded.file, scenarios: picked.scenarios, audio, model: args.model, vad: args.vad });

  print(
    `Prova con le registrazioni: ${mode === "paid" ? `MODELLO VERO ${plan.model} su ${plan.host}, A PAGAMENTO` : `prova a secco (sessione finta, nessuna rete, nessun costo; prezzi di ${plan.model})`}`,
  );
  print(`Scenari: ${plan.scenarios}; frasi registrate: ${plan.turns}; turni: ${args.vad ? "rilevamento automatico (--vad), in tempo reale" : "commit manuale"}.`);
  print(
    `Tetto di spesa: ${args.ceilingUsd} USD. La prova si ferma da sola quando arriva al tetto: in tutto non spende mai più del tetto, al massimo il costo di una risposta in più.`,
  );
  print(`Prezzi: ${AUDIO_PRICE_SOURCE}`);
  if (mode === "paid") print(`La chiave dell'API è stata letta da ${keySource}: non viene mostrata né scritta.`);
  print(`Risultati in: ${out.path}`);

  const result = await runAudio({
    mode,
    outDir: out.path,
    file: loaded.file,
    scenarios: picked.scenarios,
    audio,
    model: args.model,
    ceilingUsd: args.ceilingUsd,
    vad: args.vad,
    apiKey,
    connect: options.connect,
    sleep: options.sleep,
    print,
  });
  print(`Fatto: ${result.played} scenari giocati, speso ${result.spentUsd.toFixed(4)} USD${mode === "dry" ? " (finti)" : ""}.`);
  if (result.stopped) print(`FERMATA DAL TETTO: ${result.stopped} Non giocati: ${result.notPlayed.join(", ") || "nessuno"}.`);
  if (result.failed > 0) print(`Scenari con un errore: ${result.failed} (vedi i singoli file).`);
  print(`Indice: ${result.files[result.files.length - 1]}`);
  if (result.stopped) return 4;
  return result.failed > 0 ? 1 : 0;
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      // Only the error's name and message of our own code; the key is never part of it.
      console.error(`Errore: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`);
      process.exitCode = 1;
    },
  );
}
