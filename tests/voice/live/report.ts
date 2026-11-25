// The Markdown files of a live run: one transcript per scenario and one index. Headings and labels
// in Italian (the owner reads them); what was said stays exactly as it was said.
import { writeFileSync } from "node:fs";
import path from "node:path";
import type { UsageTokens } from "@/lib/assistant/server/costs";
import { pickVoiceText } from "@/lib/voice/knowledge";
import type { CheckResult, PlayRecord } from "./checks";
import { LIVE_CHF_PER_USD, formatChf, formatUsd, usdToChf } from "./prices";

export interface ModelCallRecord {
  /** The caller line the call answered (0 = none). */
  line: number;
  model: string;
  usage: UsageTokens;
  costUsd: number;
  stop: string | null;
  /** What the call could have cost at most, checked against the ceiling before it was made. */
  worstUsd: number;
}

export interface ScenarioReport {
  record: PlayRecord;
  checks: CheckResult[];
  calls: ModelCallRecord[];
  serverLog: string[];
  mode: "dry" | "paid";
  model: string;
}

const STATUS_MARK: Record<CheckResult["status"], string> = {
  superato: "superato",
  fallito: "**FALLITO**",
  "non applicabile": "non applicabile",
};

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

function sumUsage(calls: readonly ModelCallRecord[]): UsageTokens & { costUsd: number } {
  return calls.reduce(
    (total, call) => ({
      inputTokens: total.inputTokens + call.usage.inputTokens,
      outputTokens: total.outputTokens + call.usage.outputTokens,
      cacheReadTokens: total.cacheReadTokens + call.usage.cacheReadTokens,
      cacheWriteTokens: total.cacheWriteTokens + call.usage.cacheWriteTokens,
      costUsd: total.costUsd + call.costUsd,
    }),
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0 },
  );
}

function modeLabel(mode: "dry" | "paid", model: string): string {
  return mode === "paid"
    ? `modello vero \`${model}\``
    : `prova a secco: modello finto del sito (\`VOICE_BRAIN=mock\`, risposte «[Testantwort]»), token finti prezzati come \`${model}\``;
}

export function scenarioMarkdown(report: ScenarioReport): string {
  const { record, checks, calls } = report;
  const { scenario, tenant } = record;
  const failed = checks.filter((check) => check.status === "fallito").length;
  const passed = checks.filter((check) => check.status === "superato").length;
  const out: string[] = [];
  out.push(`# ${scenario.id}: ${scenario.title}`, "");
  out.push(`- Fonte: ${scenario.source}`);
  out.push(`- Azienda: ${tenant.business.name} (\`${tenant.id}\`, ${tenant.kind === "demo" ? "inventata" : "vera"})`);
  out.push(`- Lingua di partenza: ${scenario.locale}; canale: ${scenario.channel}`);
  out.push(`- Modo: ${modeLabel(report.mode, report.model)}`);
  out.push(`- Controlli automatici: ${passed} superati, ${failed} falliti, ${checks.length - passed - failed} non applicabili`);
  if (record.stoppedEarly) out.push(`- Interrotto: ${record.stoppedEarly}`);
  out.push("");

  if (record.setupNotes.length > 0) {
    out.push("## Preparazione", "", ...record.setupNotes.map((note) => `- ${note}`), "");
  }

  out.push("## Conversazione", "");
  for (const turn of record.turns) {
    if (turn.caller !== null) out.push(`**Chiamante (frase ${turn.line}):**`, "", quoteBlock(turn.caller), "");
    for (const call of turn.toolCalls) {
      out.push(`*Strumento \`${call.name}\`, esito: ${call.ok === true ? "ok" : call.ok === false ? "non ok" : "sconosciuto"}*`, "");
      out.push("Argomenti:", "", fence(JSON.stringify(call.input, null, 2), "json"), "");
      out.push("Risposta dello strumento al modello:", "", fence(call.result ?? "(non conservata)", "json"), "");
    }
    if (turn.toolCalls.length === 0 && turn.toolEvents.length > 0) out.push(`*Strumenti (solo nome ed esito): ${turn.toolEvents.join(", ")}*`, "");
    if (turn.handoffs.length > 0) out.push(`*Passaggio annunciato al widget: ${turn.handoffs.join(", ")}*`, "");
    const who = turn.line === 0 ? "Assistente (saluto)" : "Assistente";
    out.push(`**${who}:**`, "", turn.reply.trim() === "" ? "> (nessuna risposta)" : quoteBlock(turn.reply.trim()), "");
    if (turn.error) out.push(`*Errore: ${turn.error}*`, "");
    if (turn.ended) out.push("*L'assistente ha chiuso la conversazione (end_call).*", "");
  }

  out.push("## Che cosa è stato registrato", "");
  out.push(record.outcomes.length === 0 ? "Niente." : fence(JSON.stringify(record.outcomes, null, 2), "json"), "");

  out.push("## E-mail che l'azienda avrebbe ricevuto", "");
  if (record.emails.length === 0) {
    out.push(tenant.kind === "demo" ? "Nessuna: un'azienda inventata non riceve e-mail, le richieste restano nella demo." : "Nessuna.", "");
  } else {
    record.emails.forEach((email, index) => {
      out.push(`### E-mail ${index + 1} (trattenuta in memoria, non spedita)`, "");
      out.push(`- A: ${email.to}`, `- Da: ${email.from}`, ...(email.replyTo ? [`- Rispondi a: ${email.replyTo}`] : []), `- Oggetto: ${email.subject}`, "");
      out.push(fence(email.text), "");
    });
  }

  out.push("## Controlli automatici", "", "| Controllo | Esito | Dettaglio |", "| --- | --- | --- |");
  for (const check of checks) out.push(`| ${cell(check.label)} | ${STATUS_MARK[check.status]} | ${cell(check.detail)} |`);
  out.push("");

  out.push("## Da giudicare a mano", "", ...scenario.manual.map((line) => `- ${line}`));
  const emergency = pickVoiceText(tenant.handoff.emergency.message, scenario.locale, tenant.defaultLocale);
  if (scenario.checks.some((check) => check.kind === "emergency_message")) out.push(`- Messaggio di emergenza configurato: «${emergency}»`);
  out.push("");

  out.push("## Token e costo", "");
  if (calls.length === 0) {
    out.push("Nessuna chiamata al modello.", "");
  } else {
    out.push("| Frase | Modello | Input | Output | Lettura cache | Scrittura cache | Fine | Costo USD | Massimo previsto USD |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const call of calls) {
      out.push(
        `| ${call.line} | ${call.model} | ${call.usage.inputTokens} | ${call.usage.outputTokens} | ${call.usage.cacheReadTokens} | ${call.usage.cacheWriteTokens} | ${call.stop ?? ""} | ${formatUsd(call.costUsd)} | ${formatUsd(call.worstUsd)} |`,
      );
    }
    const total = sumUsage(calls);
    out.push(
      `| **Totale** | | ${total.inputTokens} | ${total.outputTokens} | ${total.cacheReadTokens} | ${total.cacheWriteTokens} | | ${formatUsd(total.costUsd)} | |`,
      "",
      `Costo in franchi: ${formatChf(usdToChf(total.costUsd))} CHF (cambio prudente ${LIVE_CHF_PER_USD} CHF per USD).${report.mode === "dry" ? " Token finti: la prova a secco non spende nulla." : ""}`,
      "",
    );
  }

  out.push("## Registro del server", "", "Righe del registro della voce durante la conversazione (solo codici e conteggi, mai il contenuto).", "");
  out.push(report.serverLog.length === 0 ? "Vuoto." : fence(report.serverLog.join("\n")), "");
  return out.join("\n");
}

export function writeScenarioReport(outDir: string, report: ScenarioReport): string {
  const file = path.join(outDir, `${report.record.scenario.id}.md`);
  writeFileSync(file, scenarioMarkdown(report), "utf8");
  return file;
}

export interface IndexInput {
  reports: readonly ScenarioReport[];
  notPlayed: readonly string[];
  mode: "dry" | "paid";
  model: string;
  knownModel: boolean;
  ceilingChf: number;
  spentUsd: number;
  stopped: string | null;
  startedAt: Date;
  priceSource: string;
  fakeUsage: UsageTokens | null;
}

export function indexMarkdown(input: IndexInput): string {
  const out: string[] = [];
  out.push("# Prova dal vivo dell'assistente vocale: indice", "");
  out.push(`- Iniziata: ${input.startedAt.toISOString()}`);
  out.push(`- Modo: ${modeLabel(input.mode, input.model)}`);
  if (!input.knownModel) out.push(`- Attenzione: il modello \`${input.model}\` non è nella tabella dei prezzi; prezzato come il più caro.`);
  out.push(`- Prezzi: ${input.priceSource}`);
  if (input.fakeUsage) {
    out.push(
      `- Token finti per ogni chiamata: input ${input.fakeUsage.inputTokens}, output ${input.fakeUsage.outputTokens}, lettura cache ${input.fakeUsage.cacheReadTokens}, scrittura cache ${input.fakeUsage.cacheWriteTokens}`,
    );
  }
  out.push(`- Tetto di spesa: ${input.ceilingChf} CHF; speso: ${formatChf(usdToChf(input.spentUsd))} CHF (${formatUsd(input.spentUsd)} USD)`);
  out.push(`- Fermata dal tetto: ${input.stopped ?? "no"}`);
  out.push(`- Scenari giocati: ${input.reports.length}; non giocati: ${input.notPlayed.length === 0 ? "nessuno" : input.notPlayed.join(", ")}`);
  out.push("- E-mail: nessuna è uscita dal computer; quelle che l'azienda avrebbe ricevuto sono nei singoli file.", "");

  out.push("| Scenario | Titolo | Azienda | Lingua | Frasi dette | Superati | Falliti | Non appl. | Costo CHF | File |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  let passedAll = 0;
  let failedAll = 0;
  for (const report of input.reports) {
    const { record, checks } = report;
    const passed = checks.filter((check) => check.status === "superato").length;
    const failed = checks.filter((check) => check.status === "fallito").length;
    passedAll += passed;
    failedAll += failed;
    const said = record.turns.filter((turn) => turn.caller !== null).length;
    const cost = usdToChf(report.calls.reduce((sum, call) => sum + call.costUsd, 0));
    out.push(
      `| ${record.scenario.id} | ${cell(record.scenario.title)} | \`${record.tenant.id}\` | ${record.scenario.locale} | ${said} di ${record.lines.length} | ${passed} | ${failed} | ${checks.length - passed - failed} | ${formatChf(cost)} | [${record.scenario.id}.md](${record.scenario.id}.md) |`,
    );
  }
  out.push("", `Totale controlli: ${passedAll} superati, ${failedAll} falliti.`, "");

  const failures = input.reports.flatMap((report) =>
    report.checks.filter((check) => check.status === "fallito").map((check) => `- ${report.record.scenario.id}: ${check.label} (${check.detail})`),
  );
  out.push("## Controlli falliti", "", ...(failures.length === 0 ? ["Nessuno."] : failures), "");
  out.push(
    "## Che cosa resta da fare a mano",
    "",
    "Ogni file ha la sezione «Da giudicare a mano» con la frase che dice che cosa deve succedere: tono, lingua, domande fatte al momento giusto, rifiuti in una frase. I controlli automatici non vedono numeri, importi e date detti a parole, né istruzioni riassunte o tradotte.",
    "",
  );
  return out.join("\n");
}

export function writeIndex(outDir: string, input: IndexInput): string {
  const file = path.join(outDir, "indice.md");
  writeFileSync(file, indexMarkdown(input), "utf8");
  return file;
}
