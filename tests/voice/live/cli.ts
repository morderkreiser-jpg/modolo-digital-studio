// npm run voice:live -- --uscita <cartella> [--prova-a-secco | --spesa-approvata] [--tetto-chf 1] [--scenari S06,F01]
//
// The first conversations of the voice prototype with the real model, or the same run against the site's fake model ("--prova-a-secco", no key,
// no network, nothing spent).
//
// Safety of the paid run:
//   - it refuses to start without --spesa-approvata (the owner approved the spend) and without
//     ANTHROPIC_API_KEY in the environment; it loads .env.local itself when the file exists, and
//     never prints or writes a value from it;
//   - before it starts it prints how many scenarios and turns it plays and an upper estimate of
//     the cost;
//   - it measures the tokens the API reports and stops the whole run at the ceiling (--tetto-chf,
//     default 1 franc), saying so;
//   - the reports go to the folder given with --uscita, which must be outside the repository (the
//     repository is public); nothing is written anywhere else.
// The token prices are in prices.ts: check them against the pricing page before the paid run.
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRICE_SOURCE, usdToChf } from "./prices";
import { planRun, runLive, withRunEnv } from "./runner";
import { findScenarios, LIVE_SCENARIOS } from "./scenarios";

/** The repository's root (this file is tests/voice/live/cli.ts). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const DEFAULT_ENV_FILE = path.join(REPO_ROOT, ".env.local");
export const DEFAULT_CEILING_CHF = 1;
/** A ceiling above this is a typo, not a decision for "a few cents". */
export const MAX_CEILING_CHF = 10;

export interface CliArgs {
  outDir: string | null;
  dry: boolean;
  approved: boolean;
  ceilingChf: number;
  ids: string[] | null;
  errors: string[];
}

export function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = { outDir: null, dry: false, approved: false, ceilingChf: DEFAULT_CEILING_CHF, ids: null, errors: [] };
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
    if (arg === "--uscita") args.outDir = value();
    else if (arg === "--prova-a-secco") args.dry = true;
    else if (arg === "--spesa-approvata") args.approved = true;
    else if (arg === "--tetto-chf") {
      const raw = value();
      const ceiling = raw === null ? NaN : Number(raw);
      if (!Number.isFinite(ceiling) || ceiling <= 0 || ceiling > MAX_CEILING_CHF) args.errors.push(`--tetto-chf: un numero tra 0 e ${MAX_CEILING_CHF}.`);
      else args.ceilingChf = ceiling;
    } else if (arg === "--scenari") {
      const raw = value();
      if (raw !== null) args.ids = raw.split(",").map((id) => id.trim()).filter(Boolean);
    } else args.errors.push(`Argomento sconosciuto: ${arg}`);
  }
  if (args.dry && args.approved) args.errors.push("--prova-a-secco e --spesa-approvata insieme: scegline uno.");
  return args;
}

/** The output folder, resolved; refused when missing or inside the repository. */
export function checkOutDir(outDir: string | null): { ok: true; dir: string } | { ok: false; reason: string } {
  if (outDir === null || outDir.trim() === "") return { ok: false, reason: "Manca --uscita <cartella>: la cartella dei risultati va data sempre, fuori dal repository." };
  const dir = path.resolve(outDir);
  const relative = path.relative(REPO_ROOT, dir);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return { ok: false, reason: "La cartella dei risultati è dentro il repository, che è pubblico: scegline una fuori." };
  }
  return { ok: true, dir };
}

/**
 * The gate of the paid run: the owner's flag first (nothing is read without it), then the key from
 * the environment, after loading the env file when it exists. The key is returned, never printed.
 */
export function gatePaidRun(options: { approved: boolean; envFile: string }): { ok: true; apiKey: string } | { ok: false; reason: string } {
  if (!options.approved) {
    return { ok: false, reason: "Prova a pagamento rifiutata: manca --spesa-approvata (il sì di Francesco alla spesa). Per una prova senza costi: --prova-a-secco." };
  }
  if (existsSync(options.envFile)) {
    try {
      // Node's own loader: variables already set in the shell are kept. Nothing of it is printed.
      process.loadEnvFile(options.envFile);
    } catch {
      return { ok: false, reason: "Il file delle variabili esiste ma non si legge." };
    }
  }
  const key = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (key === "") return { ok: false, reason: "Prova a pagamento rifiutata: ANTHROPIC_API_KEY non c'è nell'ambiente né nel file .env.local." };
  return { ok: true, apiKey: key };
}

/** The whole command. Returns the exit code. */
export async function main(argv: readonly string[], options: { envFile?: string; print?: (line: string) => void } = {}): Promise<number> {
  const print = options.print ?? ((line: string) => console.log(line));
  const args = parseArgs(argv);
  if (args.errors.length > 0) {
    for (const error of args.errors) print(error);
    return 2;
  }
  const out = checkOutDir(args.outDir);
  if (!out.ok) {
    print(out.reason);
    return 2;
  }
  const scenarios = findScenarios(args.ids);
  if (scenarios.length === 0) {
    print(`Nessuno scenario con questi nomi. Scenari: ${LIVE_SCENARIOS.map((scenario) => scenario.id).join(", ")}`);
    return 2;
  }

  let apiKey: string | undefined;
  if (!args.dry) {
    const gate = gatePaidRun({ approved: args.approved, envFile: options.envFile ?? DEFAULT_ENV_FILE });
    if (!gate.ok) {
      print(gate.reason);
      return 3;
    }
    apiKey = gate.apiKey;
  }
  const mode = args.dry ? "dry" : "paid";
  const plan = withRunEnv(mode, apiKey, () => planRun(scenarios));

  print(`Prova dal vivo dell'assistente vocale: ${mode === "paid" ? `MODELLO VERO ${plan.model}, A PAGAMENTO` : "prova a secco (modello finto, nessuna rete, nessun costo)"}`);
  print(`Scenari: ${plan.scenarios}; frasi del chiamante (turni con il modello): ${plan.callerTurns}; più un saluto per scenario, senza modello.`);
  print(
    `Stima massima del costo: ${usdToChf(plan.upperUsd).toFixed(4)} CHF (${plan.upperUsd.toFixed(4)} USD), se ogni turno facesse 4 chiamate con ${plan.maxOutputTokens} token di risposta e il prompt sempre scritto nella cache. Il costo vero è di solito una piccola parte.`,
  );
  print(`Tetto di spesa: ${args.ceilingChf} CHF. La prova si ferma da sola prima di una chiamata che potrebbe superarlo, e dopo la chiamata che lo raggiunge.`);
  print(`Prezzi: ${PRICE_SOURCE}`);
  if (mode === "paid") print("La chiave dell'API è stata letta dall'ambiente: non viene mostrata né scritta.");
  print(`Risultati in: ${out.dir}`);

  const result = await runLive({ mode, outDir: out.dir, ceilingChf: args.ceilingChf, scenarios, apiKey, print });
  print(`Fatto: ${result.played} scenari giocati, speso ${usdToChf(result.totalUsd).toFixed(4)} CHF${mode === "dry" ? " (finti)" : ""}.`);
  if (result.stopped) print(`FERMATA DAL TETTO: ${result.stopped} Non giocati: ${result.notPlayed.join(", ") || "nessuno"}.`);
  print(`Indice: ${result.files[result.files.length - 1]}`);
  return result.stopped ? 4 : 0;
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
