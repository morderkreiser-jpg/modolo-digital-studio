// The files of an audio run: per scenario `<id>.md` (to read) and `<id>.json` (the same data, for
// comparisons), and `indice.md`. Nothing else is written, and only into the owner's folder: the
// transcripts are of real voices. Headings and labels in Italian (the owner reads them); what was
// said stays exactly as it was transcribed.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { UsageTotals } from "@/lib/voice/server/realtime/pricing";
import type { AudioMode, AudioScenarioResult, TurnResult } from "./audio-runner";

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\n+/g, " ");
}

function quoteBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
}

function fence(text: string, language = ""): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${language}\n${text}\n${ticks}`;
}

function usd(value: number): string {
  return value.toFixed(6);
}

function ms(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

function modeLabel(mode: AudioMode, model: string, host: string): string {
  return mode === "paid"
    ? `modello vero \`${model}\` su \`${host}\`, A PAGAMENTO`
    : `prova a secco: sessione finta (nessuna connessione, nessuna chiave, nessun costo), token finti prezzati come \`${model}\``;
}

function turnLabel(vad: boolean): string {
  return vad ? "rilevamento automatico della fine della frase (--vad), audio in tempo reale" : "fine della frase data dallo strumento (commit manuale)";
}

function usageLine(usage: UsageTotals): string {
  return `testo in ${usage.inTok} (in cache ${usage.inCachedTok}), audio in ${usage.inAuTok} (in cache ${usage.inCachedAuTok}), testo out ${usage.outTok}, audio out ${usage.outAuTok}, ragionamento ${usage.reasonTok}, trascrizione ${usage.transcribeSec.toFixed(1)} s${
    usage.transcribeInTok + usage.transcribeOutTok > 0 ? ` e ${usage.transcribeInTok} token in entrata, ${usage.transcribeOutTok} in uscita` : ""
  }`;
}

function turnSection(turn: TurnResult, mode: AudioScenarioResult["mode"]): string[] {
  const out: string[] = [];
  if (turn.index === 0) {
    out.push("### Saluto", "");
  } else {
    out.push(`### Frase ${turn.index}: \`${turn.audio}\` (${turn.seconds.toFixed(1)} s)`, "");
    out.push(`**Chiamante (${mode === "dry" ? "trascrizione finta della prova a secco" : "trascrizione di OpenAI"}):**`, "", turn.callerTranscript === null || turn.callerTranscript === "" ? "> (nessuna trascrizione)" : quoteBlock(turn.callerTranscript), "");
  }
  for (const call of turn.toolCalls) {
    out.push(`*Strumento \`${call.name}\`, esito: ${call.code}${call.endCall ? " (chiude la conversazione)" : ""}*`, "");
    out.push("Argomenti:", "", fence(JSON.stringify(call.args, null, 2), "json"), "");
  }
  out.push(`**Assistente${turn.index === 0 ? " (saluto)" : ""}:**`, "");
  out.push(turn.assistantTranscripts.length === 0 ? "> (nessuna risposta parlata)" : turn.assistantTranscripts.map(quoteBlock).join("\n>\n"), "");
  if (turn.expectation) {
    out.push(`- Atteso: \`${turn.expectation.tool}\`${turn.expectation.args ? ` con ${JSON.stringify(turn.expectation.args)}` : ""}: ${turn.expectation.passed ? "superato" : "**FALLITO**"} (${turn.expectation.detail})`);
  }
  if (turn.index > 0) {
    out.push(`- Dalla fine della frase al primo audio della risposta: ${ms(turn.commitToAudioMs)}`);
    out.push(`- Dalla fine della frase alla trascrizione completa: ${ms(turn.commitToTranscriptMs)}`);
  }
  out.push(`- Risposte: ${turn.responses}; costo ${usd(turn.usdHigh)} USD (massimo) / ${usd(turn.usdEst)} USD (stima); controllo del tetto prima della risposta: fino a ${usd(turn.upperUsd)} USD`);
  out.push(`- Token: ${usageLine(turn.usage)}`);
  for (const note of turn.notes) out.push(`- Nota: ${note}`);
  out.push("");
  return out;
}

export function audioScenarioMarkdown(result: AudioScenarioResult): string {
  const out: string[] = [];
  const expected = result.turns.filter((turn) => turn.expectation !== null);
  const passed = expected.filter((turn) => turn.expectation?.passed).length;
  out.push(`# ${result.id}: ${result.title}`, "");
  out.push(`- Modo: ${modeLabel(result.mode, result.model, result.host)}`);
  out.push(`- Azienda: \`${result.tenant}\`; lingua della sessione: ${result.locale}`);
  out.push(`- Turni: ${turnLabel(result.vad)}`);
  out.push(`- Frasi fatte sentire: ${result.turns.length} di ${result.turnsTotal}`);
  out.push(`- Attese rispettate: ${passed} di ${expected.length}`);
  if (result.endedByAssistant) out.push("- L'assistente ha chiuso la conversazione (end_call) e ha salutato.");
  if (result.stoppedEarly) out.push(`- Interrotto: ${result.stoppedEarly}`);
  if (result.error) out.push(`- **Errore:** ${result.error}`);
  out.push("");

  out.push("## Conversazione", "");
  if (result.greeting) out.push(...turnSection(result.greeting, result.mode));
  for (const turn of result.turns) out.push(...turnSection(turn, result.mode));

  out.push("## Che cosa è stato registrato", "");
  out.push(result.outcomes.length === 0 ? "Niente." : fence(JSON.stringify(result.outcomes, null, 2), "json"), "");

  out.push("## Token e costo", "");
  out.push(`- Token: ${usageLine(result.usage)}`);
  out.push(`- Costo: ${usd(result.usdHigh)} USD al prezzo massimo (ogni token come non in cache), ${usd(result.usdEst)} USD di stima${result.mode === "dry" ? ". Token finti: la prova a secco non spende nulla." : "."}`);
  out.push(`- Errori mandati da OpenAI: ${result.openAiErrors.length === 0 ? "nessuno" : result.openAiErrors.join(", ")}`);
  out.push(`- Risposte arrivate due volte (contate una): ${result.duplicates}`, "");

  out.push("## Registro del server", "", "Righe del registro della voce durante la prova (solo codici e conteggi, mai il contenuto).", "");
  out.push(result.serverLog.length === 0 ? "Vuoto." : fence(result.serverLog.join("\n")), "");
  return out.join("\n");
}

/** Writes `<id>.md` and `<id>.json`; returns both paths. */
export function writeAudioScenarioReport(outDir: string, result: AudioScenarioResult): string[] {
  const markdown = path.join(outDir, `${result.id}.md`);
  const json = path.join(outDir, `${result.id}.json`);
  writeFileSync(markdown, audioScenarioMarkdown(result), "utf8");
  writeFileSync(json, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return [markdown, json];
}

export interface AudioIndexInput {
  results: readonly AudioScenarioResult[];
  notPlayed: readonly string[];
  mode: AudioMode;
  model: string;
  host: string;
  vad: boolean;
  ceilingUsd: number;
  spentUsd: number;
  stopped: string | null;
  startedAt: Date;
  priceSource: string;
}

function average(values: number[]): string {
  return values.length === 0 ? "—" : `${Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)} ms`;
}

export function audioIndexMarkdown(input: AudioIndexInput): string {
  const out: string[] = [];
  out.push(`# Prova con le registrazioni${input.mode === "dry" ? " (a secco)" : ""}: indice`, "");
  out.push(`- Iniziata: ${input.startedAt.toISOString()}`);
  out.push(`- Modo: ${modeLabel(input.mode, input.model, input.host)}`);
  out.push(`- Turni: ${turnLabel(input.vad)}`);
  out.push(`- Prezzi: ${input.priceSource}`);
  out.push(`- Tetto di spesa: ${input.ceilingUsd} USD; speso: ${usd(input.spentUsd)} USD al prezzo massimo${input.mode === "dry" ? " (finti)" : ""}`);
  out.push(`- Fermata dal tetto: ${input.stopped ?? "no"}`);
  out.push(`- Scenari giocati: ${input.results.length}; non giocati: ${input.notPlayed.length === 0 ? "nessuno" : input.notPlayed.join(", ")}`, "");

  out.push(
    "| Scenario | Titolo | Frasi | Attese rispettate | Primo audio (media) | Trascrizione (media) | Costo USD | Esito | File |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  let passedAll = 0;
  let expectedAll = 0;
  for (const result of input.results) {
    const expected = result.turns.filter((turn) => turn.expectation !== null);
    const passed = expected.filter((turn) => turn.expectation?.passed).length;
    passedAll += passed;
    expectedAll += expected.length;
    const audio = result.turns.map((turn) => turn.commitToAudioMs).filter((value): value is number => value !== null);
    const transcript = result.turns.map((turn) => turn.commitToTranscriptMs).filter((value): value is number => value !== null);
    const outcome = result.error ? `errore: ${result.error}` : result.ceilingHit ? "fermato dal tetto" : result.endedByAssistant ? "chiusa dall'assistente" : "completo";
    out.push(
      `| ${result.id} | ${cell(result.title)} | ${result.turns.length} di ${result.turnsTotal} | ${passed} di ${expected.length} | ${average(audio)} | ${average(transcript)} | ${usd(result.usdHigh)} | ${cell(outcome)} | [${result.id}.md](${result.id}.md) |`,
    );
  }
  out.push("", `Totale attese: ${passedAll} rispettate di ${expectedAll}.`, "");

  const failures = input.results.flatMap((result) =>
    result.turns.filter((turn) => turn.expectation && !turn.expectation.passed).map((turn) => `- ${result.id}, frase ${turn.index}: ${turn.expectation?.detail}`),
  );
  out.push("## Attese non rispettate", "", ...(failures.length === 0 ? ["Nessuna."] : failures), "");
  out.push(
    "## Che cosa resta da fare a mano",
    "",
    "Le trascrizioni sono quelle di OpenAI: possono sbagliare anche quando il modello ha capito bene. Ascolta le registrazioni dove un'attesa è fallita, e giudica a orecchio tono, lingua e la rilettura di nomi e numeri.",
    "",
  );
  return out.join("\n");
}

export function writeAudioIndex(outDir: string, input: AudioIndexInput): string {
  const file = path.join(outDir, "indice.md");
  writeFileSync(file, audioIndexMarkdown(input), "utf8");
  return file;
}
