// The scenario file of the audio test tool (tests/voice/live/audio-cli.ts): which recordings are
// played to which business, in which language, and which tool call each turn should produce.
//
// The file is JSON, version 1:
//   { "version": 1, "tenant": "modolo", "locale": "de",
//     "scenarios": [ { "id": "S01", "title": "...", "greeting": true,
//                      "turns": [ { "audio": "aufnahmen/s01-1.wav" },
//                                 { "audio": "aufnahmen/s01-2.wav",
//                                   "expect": { "tool": "request_callback", "args": { "phone": "...", "name": "..." } } } ] } ] }
// Audio paths are relative to the scenario file. The file, the recordings and the reports stay
// outside the repository, which is public: the recordings are of real voices.
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getVoiceTenant } from "@/lib/voice/tenants";
import { enabledTools } from "@/lib/voice/tools/definitions";
import { normalizePhone } from "@/lib/voice/tools/validate";
import { isVoiceLocale, isVoiceToolName, type VoiceLocale, type VoiceToolName } from "@/lib/voice/types";

/** The repository's root (this file is tests/voice/live/audio-scenarios.ts), as in cli.ts. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export const SCENARIO_ID_RE = /^[A-Za-z0-9_-]{1,20}$/;
export const MAX_SCENARIOS = 40;
export const MAX_TURNS = 20;
/** A scenario file is a short list, not data: anything bigger is a mistake. */
export const MAX_SCENARIO_FILE_BYTES = 1024 * 1024;
const MAX_TITLE_CHARS = 200;
const MAX_ARG_CHARS = 500;

export interface AudioExpectation {
  tool: VoiceToolName;
  /** Compared after normalisation (see compareArgs); keys may name a nested field ("contact.phone"). */
  args?: Record<string, string>;
}

export interface AudioTurn {
  /** As written in the file. */
  audio: string;
  /** Resolved against the scenario file's folder. */
  file: string;
  expect?: AudioExpectation;
}

export interface AudioScenario {
  id: string;
  title: string;
  /** The assistant greets before the first turn (default true: a real call always starts so). */
  greeting: boolean;
  turns: AudioTurn[];
}

export interface AudioScenarioFile {
  version: 1;
  tenant: string;
  locale: VoiceLocale;
  scenarios: AudioScenario[];
}

export type ScenarioFileResult = { ok: true; file: AudioScenarioFile } | { ok: false; errors: string[] };

/** True when `target` is `root` or inside it ("..rapporti" is a child folder, not the parent). */
export function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  if (relative === "") return true;
  return !(relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative));
}

/** The nearest folder or file of `target` (itself or a parent) that exists, with links resolved; null when none does. */
function nearestExisting(target: string): string | null {
  let current = target;
  for (;;) {
    if (existsSync(current)) {
      try {
        return realpathSync(current);
      } catch {
        return null;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * True when `target` is inside this repository or inside ANY git working tree (a `.git` folder or
 * file in it or in one of its parents): another checkout may be a copy of the same public
 * repository. The comparison uses the real path of the nearest existing parent, so a link or a
 * junction does not hide where the files would land.
 */
export function insideRepository(target: string): boolean {
  const resolved = path.resolve(target);
  if (within(REPO_ROOT, resolved)) return true;
  const real = nearestExisting(resolved);
  // Nothing of the path can be checked: refused, to be safe.
  if (real === null) return true;
  const realRoot = nearestExisting(REPO_ROOT);
  if (realRoot !== null && within(realRoot, real)) return true;
  let current = real;
  for (;;) {
    if (existsSync(path.join(current, ".git"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Checks a parsed scenario file and resolves its audio paths against `baseDir` (the scenario
 * file's folder). Every problem is listed, in Italian, with where it is.
 */
export function parseScenarioFile(raw: unknown, baseDir: string): ScenarioFileResult {
  const errors: string[] = [];
  if (!isRecord(raw)) return { ok: false, errors: ["Il file degli scenari deve contenere un oggetto JSON."] };
  if (raw.version !== 1) errors.push("«version» deve essere 1.");
  const tenant = getVoiceTenant(raw.tenant);
  if (!tenant) errors.push(`«tenant»: azienda sconosciuta (${JSON.stringify(raw.tenant)}).`);
  const locale = raw.locale;
  if (!isVoiceLocale(locale)) errors.push("«locale»: una lingua tra de, it, en, fr.");
  else if (tenant && !tenant.locales.includes(locale)) errors.push(`«locale»: l'azienda ${tenant.id} non parla ${locale}.`);
  const tools = tenant ? enabledTools(tenant) : null;

  const scenarios: AudioScenario[] = [];
  if (!Array.isArray(raw.scenarios) || raw.scenarios.length === 0 || raw.scenarios.length > MAX_SCENARIOS) {
    errors.push(`«scenarios»: da 1 a ${MAX_SCENARIOS} scenari.`);
  } else {
    const seen = new Set<string>();
    raw.scenarios.forEach((entry: unknown, index: number) => {
      const where = `scenario ${index + 1}`;
      if (!isRecord(entry)) {
        errors.push(`${where}: deve essere un oggetto.`);
        return;
      }
      const id = entry.id;
      if (typeof id !== "string" || !SCENARIO_ID_RE.test(id)) {
        errors.push(`${where}: «id» di 1-20 caratteri tra lettere, cifre, _ e -.`);
        return;
      }
      if (seen.has(id)) errors.push(`${id}: id ripetuto.`);
      seen.add(id);
      const title = typeof entry.title === "string" ? entry.title.trim() : "";
      if (title === "" || title.length > MAX_TITLE_CHARS) errors.push(`${id}: «title» di 1-${MAX_TITLE_CHARS} caratteri.`);
      if (entry.greeting !== undefined && typeof entry.greeting !== "boolean") errors.push(`${id}: «greeting» è true o false.`);
      const turns: AudioTurn[] = [];
      if (!Array.isArray(entry.turns) || entry.turns.length === 0 || entry.turns.length > MAX_TURNS) {
        errors.push(`${id}: «turns» da 1 a ${MAX_TURNS} frasi.`);
      } else {
        entry.turns.forEach((turn: unknown, turnIndex: number) => {
          const at = `${id}, frase ${turnIndex + 1}`;
          if (!isRecord(turn) || typeof turn.audio !== "string" || turn.audio.trim() === "") {
            errors.push(`${at}: «audio» è il percorso di un file WAV.`);
            return;
          }
          const file = path.resolve(baseDir, turn.audio);
          if (insideRepository(file)) errors.push(`${at}: la registrazione è dentro il repository o in un'altra cartella di git (il repository è pubblico): spostala fuori.`);
          const parsed: AudioTurn = { audio: turn.audio, file };
          if (turn.expect !== undefined) {
            const expect = parseExpectation(turn.expect, at, tools, errors);
            if (expect) parsed.expect = expect;
          }
          turns.push(parsed);
        });
      }
      scenarios.push({ id, title, greeting: entry.greeting !== false, turns });
    });
  }
  if (errors.length > 0 || !tenant || !isVoiceLocale(locale)) return { ok: false, errors };
  return { ok: true, file: { version: 1, tenant: tenant.id, locale, scenarios } };
}

function parseExpectation(raw: unknown, at: string, tools: VoiceToolName[] | null, errors: string[]): AudioExpectation | null {
  if (!isRecord(raw)) {
    errors.push(`${at}: «expect» deve essere un oggetto.`);
    return null;
  }
  if (!isVoiceToolName(raw.tool)) {
    errors.push(`${at}: «expect.tool» non è uno strumento conosciuto (${JSON.stringify(raw.tool)}).`);
    return null;
  }
  if (tools && !tools.includes(raw.tool)) errors.push(`${at}: l'azienda non ha lo strumento ${raw.tool}.`);
  const expect: AudioExpectation = { tool: raw.tool };
  if (raw.args !== undefined) {
    if (!isRecord(raw.args)) {
      errors.push(`${at}: «expect.args» deve essere un oggetto di testi.`);
      return null;
    }
    const args: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw.args)) {
      if (typeof value !== "string" || value.length > MAX_ARG_CHARS) errors.push(`${at}: «expect.args.${key}» deve essere un testo (al massimo ${MAX_ARG_CHARS} caratteri).`);
      else args[key] = value;
    }
    expect.args = args;
  }
  return expect;
}

/** Reads and checks a scenario file. The path must be outside the repository. Never throws. */
export function loadScenarioFile(file: string): ScenarioFileResult {
  const resolved = path.resolve(file);
  if (insideRepository(resolved)) return { ok: false, errors: ["Il file degli scenari è dentro il repository o in un'altra cartella di git (il repository è pubblico): tienilo fuori."] };
  let text: string;
  try {
    if (statSync(resolved).size > MAX_SCENARIO_FILE_BYTES) return { ok: false, errors: ["Il file degli scenari è troppo grande (al massimo 1 MB)."] };
    text = readFileSync(resolved, "utf8");
  } catch {
    return { ok: false, errors: ["Il file degli scenari non esiste o non si legge."] };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { ok: false, errors: ["Il file degli scenari non è JSON valido."] };
  }
  return parseScenarioFile(raw, path.dirname(resolved));
}

/** The scenarios named by --solo (all when null); unknown names are returned apart. */
export function pickScenarios(file: AudioScenarioFile, ids: readonly string[] | null): { scenarios: AudioScenario[]; unknown: string[] } {
  if (ids === null) return { scenarios: file.scenarios, unknown: [] };
  const unknown = ids.filter((id) => !file.scenarios.some((scenario) => scenario.id === id));
  return { scenarios: file.scenarios.filter((scenario) => ids.includes(scenario.id)), unknown };
}

// ---------------------------------------------------------------------------------------------
// Expectations
// ---------------------------------------------------------------------------------------------

/** A value as compared: a phone number normalised (when it is one), anything else trimmed and case-folded. */
export function normalizeArg(key: string, value: unknown): string {
  const text = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : value === undefined || value === null ? "" : JSON.stringify(value);
  const last = key.split(".").pop() ?? key;
  if (last === "phone") {
    const phone = normalizePhone(text);
    if (phone !== null) return phone;
  }
  return text.trim().toLocaleLowerCase("de-CH");
}

function lookup(input: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(input, key)) return input[key];
  let current: unknown = input;
  for (const part of key.split(".")) {
    if (!isRecord(current) || !Object.hasOwn(current, part)) return undefined;
    current = current[part];
  }
  return current;
}

/** Every expected argument against the tool call's input; the differences, in Italian. */
export function compareArgs(expected: Readonly<Record<string, string>>, actual: Record<string, unknown>): { ok: boolean; differences: string[] } {
  const differences: string[] = [];
  for (const [key, want] of Object.entries(expected)) {
    const got = lookup(actual, key);
    if (got === undefined) {
      differences.push(`${key}: manca (atteso «${want}»)`);
      continue;
    }
    if (normalizeArg(key, got) !== normalizeArg(key, want)) differences.push(`${key}: «${normalizeArg(key, got)}» invece di «${normalizeArg(key, want)}»`);
  }
  return { ok: differences.length === 0, differences };
}
