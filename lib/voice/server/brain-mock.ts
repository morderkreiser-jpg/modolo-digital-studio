// A deterministic stand-in for the model, for tests and for VOICE_BRAIN=mock in development.
// Server-only. It makes no network call and costs nothing.
//
// It implements the same BrainModel interface as the Anthropic model and is driven by exactly the
// same turn loop (brain.ts): it reads the conversation it is sent, decides from keywords what to
// do, and answers with text and tool calls in the API's block format. So the tools, the caps, the
// state, the stream and the summary all run for real; only the language understanding is fake.
//
// Every reply starts with "[Testantwort]", in every language, so nobody can mistake it for the
// product. What it understands:
//   - a goodbye ("tschüss", "bye", "ciao", "au revoir"...)       → a goodbye and end_call
//   - wanting an appointment, with a calendar                     → check_availability for tomorrow,
//     then, once a name and a phone or email are known and the caller says yes, book_appointment
//   - wanting a quote, an offer or a request, with create_lead    → asks for what is missing (name,
//     phone or email), then create_lead with the tenant's first task
//   - anything else                                               → a short explanation of itself
// It remembers what was collected by reading every caller message of the conversation again.
import type Anthropic from "@anthropic-ai/sdk";
import { addDays, zonedParts } from "@/lib/voice/hours";
import type { TaskField, VoiceLocale, VoiceTenantConfig } from "@/lib/voice/types";
import type { BrainModel, ModelBlock, ModelEvent, ModelRequest } from "./brain";

export const MOCK_REPLY_PREFIX = "[Testantwort]";

interface MockTexts {
  intro: string;
  missing: string;
  name: string;
  contact: string;
  and: string;
  saving: string;
  saved: string;
  checking: string;
  slots: string;
  booking: string;
  booked: string;
  failed: string;
  bye: string;
}

const TEXTS: Record<VoiceLocale, MockTexts> = {
  de: {
    intro: "Das ist eine Testantwort ohne KI-Modell. Für eine Anfrage braucht es einen Namen und eine Telefonnummer oder E-Mail.",
    missing: "Für die Anfrage fehlt noch: {missing}.",
    name: "der Name",
    contact: "eine Telefonnummer oder E-Mail",
    and: " und ",
    saving: "Ich nehme die Anfrage auf.",
    saved: "Die Anfrage ist aufgenommen. Referenz {ref}.",
    checking: "Ich schaue im Kalender nach.",
    slots: "Frei sind {times}.",
    booking: "Ich buche den Termin.",
    booked: "Der Termin ist gebucht. Referenz {ref}.",
    failed: "Das hat nicht geklappt ({code}).",
    bye: "Auf Wiederhören.",
  },
  it: {
    intro: "Questa è una risposta di prova senza modello AI. Per una richiesta servono un nome e un numero di telefono o un'e-mail.",
    missing: "Per la richiesta manca ancora: {missing}.",
    name: "il nome",
    contact: "un numero di telefono o un'e-mail",
    and: " e ",
    saving: "Registro la richiesta.",
    saved: "La richiesta è registrata. Riferimento {ref}.",
    checking: "Controllo il calendario.",
    slots: "Sono liberi questi orari: {times}.",
    booking: "Prenoto l'appuntamento.",
    booked: "L'appuntamento è prenotato. Riferimento {ref}.",
    failed: "Non ha funzionato ({code}).",
    bye: "Arrivederci.",
  },
  en: {
    intro: "This is a test reply without an AI model. A request needs a name and a phone number or email.",
    missing: "The request still needs {missing}.",
    name: "a name",
    contact: "a phone number or email",
    and: " and ",
    saving: "Recording the request.",
    saved: "The request is recorded. Reference {ref}.",
    checking: "Checking the calendar.",
    slots: "These times are free: {times}.",
    booking: "Booking the appointment.",
    booked: "The appointment is booked. Reference {ref}.",
    failed: "That did not work ({code}).",
    bye: "Goodbye.",
  },
  fr: {
    intro: "Ceci est une réponse de test sans modèle d'IA. Une demande a besoin d'un nom et d'un numéro de téléphone ou d'une adresse e-mail.",
    missing: "Il manque encore pour la demande : {missing}.",
    name: "le nom",
    contact: "un numéro de téléphone ou une adresse e-mail",
    and: " et ",
    saving: "J'enregistre la demande.",
    saved: "La demande est enregistrée. Référence {ref}.",
    checking: "Je regarde le calendrier.",
    slots: "Ces horaires sont libres : {times}.",
    booking: "Je réserve le rendez-vous.",
    booked: "Le rendez-vous est réservé. Référence {ref}.",
    failed: "Cela n'a pas fonctionné ({code}).",
    bye: "Au revoir.",
  },
};

const BYE = /\b(tschüss|tschüs|ade|adieu|bye|goodbye|ciao|arrivederci|au revoir|auf wiederhören|auf wiedersehen)\b/iu;
const LEAD_WORDS =
  /(offerte|angebot|anfrage|auftrag|quote|offer|request|preventivo|richiesta|offerta|devis|demande|projekt|project|progetto|projet)/iu;
const BOOKING_WORDS = /(termin|appointment|appuntamento|rendez-vous|reservation|reservierung|prenot|réserv|tisch|table|tavolo)/iu;
const YES = /\b(ja|yes|sì|si|oui|gerne|genau|buchen|book|prenota|réserve|ok)\b/iu;
const NAME = /(?:ich heisse|ich heiße|mein name ist|my name is|mi chiamo|je m'appelle|name:)\s+([\p{L}][\p{L}'-]*(?:\s+[\p{L}][\p{L}'-]*)?)/iu;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /\+?\d[\d ]{7,}\d/;

/** The mock for one turn of `tenant`, answering in `locale`. */
export function createMockBrain(options: { tenant: VoiceTenantConfig; locale: VoiceLocale; now?: () => number }): BrainModel {
  const { tenant } = options;
  const texts = TEXTS[options.locale] ?? TEXTS.de;
  const clock = options.now ?? Date.now;

  return {
    id: "mock",
    async *stream(request: ModelRequest): AsyncGenerator<ModelEvent> {
      const decision = decide(request, tenant, texts, clock());
      const text = `${MOCK_REPLY_PREFIX} ${decision.text}`;
      // Two deltas, like a real stream, so the delta path is exercised too.
      const cut = text.indexOf(" ", MOCK_REPLY_PREFIX.length + 1);
      for (const part of cut > 0 ? [text.slice(0, cut), text.slice(cut)] : [text]) {
        if (request.signal.aborted) return;
        yield { type: "text", text: part };
      }
      const content: ModelBlock[] = [{ type: "text", text }];
      const calls = countToolUses(request.messages);
      if (decision.tool) content.push({ type: "tool_use", id: `toolu_mock_${calls + 1}`, name: decision.tool.name, input: decision.tool.input });
      yield {
        type: "end",
        content,
        stopReason: decision.tool ? "tool_use" : "end_turn",
        model: "mock",
        usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      };
    },
  };
}

interface Decision {
  text: string;
  tool?: { name: string; input: Record<string, unknown> };
}

function decide(request: ModelRequest, tenant: VoiceTenantConfig, texts: MockTexts, now: number): Decision {
  const tools = new Set(request.tools.map((tool) => tool.name));
  const last = request.messages[request.messages.length - 1];

  // Tool results came back: say what happened.
  const results = last?.role === "user" ? toolResults(last) : [];
  if (results.length > 0) return { text: results.map((result) => describeResult(result, request.messages, texts)).join(" ") };

  const said = callerTexts(request.messages);
  const current = said[said.length - 1] ?? "";
  if (BYE.test(current) && tools.has("end_call")) {
    return { text: texts.bye, tool: { name: "end_call", input: { reason: "caller_done" } } };
  }

  const all = said.join("\n");
  const name = NAME.exec(all)?.[1]?.trim();
  const email = EMAIL.exec(all)?.[0];
  const phone = PHONE.exec(all)?.[0]?.trim();

  if (tools.has("check_availability") && tenant.calendar && BOOKING_WORDS.test(all)) {
    const check = lastCheck(request.messages);
    if (check === null) {
      const service = tenant.calendar.services[0]?.id ?? "";
      const input: Record<string, unknown> = { service, date: tomorrow(tenant, now) };
      if (tenant.calendar.capacity.kind === "seats") input.party_size = 2;
      return { text: texts.checking, tool: { name: "check_availability", input } };
    }
    const contact = phone ?? email;
    if (!name || !contact) return { text: missingText(texts, !name, !contact) };
    if (YES.test(current) && tools.has("book_appointment") && check.start) {
      const input: Record<string, unknown> = { service: check.service, start: check.start, name, contact };
      if (check.partySize !== undefined) input.party_size = check.partySize;
      return { text: texts.booking, tool: { name: "book_appointment", input } };
    }
    return { text: missingText(texts, false, false) };
  }

  // One request per conversation is enough for a test: after it, the mock only explains itself.
  if (tools.has("create_lead") && tenant.tasks.length > 0 && LEAD_WORDS.test(all) && !succeeded("create_lead", request.messages)) {
    const task = tenant.tasks[0];
    const needName = task.contact.name === "required" && !name;
    const phoneNeeded = task.contact.phone === "required" && !phone;
    const emailNeeded = task.contact.email === "required" && !email;
    const eitherNeeded = task.contact.phone !== "required" && task.contact.email !== "required" && !phone && !email;
    if (needName || phoneNeeded || emailNeeded || eitherNeeded) {
      return { text: missingText(texts, needName, phoneNeeded || emailNeeded || eitherNeeded) };
    }
    const description = said.find((text) => LEAD_WORDS.test(text)) ?? current;
    const fields: Record<string, string> = {};
    for (const field of task.fields) if (field.required) fields[field.id] = fieldValue(field, description, all, tenant, now, { name, phone, email });
    const input: Record<string, unknown> = { task: task.id, fields, summary: "Testanfrage des Mock-Modells, kein echtes Gespräch." };
    if (name && task.contact.name !== "none") input.name = name;
    if (phone && task.contact.phone !== "none") input.phone = phone;
    if (email && task.contact.email !== "none") input.email = email;
    return { text: texts.saving, tool: { name: "create_lead", input } };
  }

  return { text: texts.intro };
}

function missingText(texts: MockTexts, name: boolean, contact: boolean): string {
  const parts = [name ? texts.name : "", contact ? texts.contact : ""].filter(Boolean);
  return parts.length === 0 ? texts.intro : texts.missing.replace("{missing}", parts.join(texts.and));
}

/** A plausible value for a required task field, built from what the caller said. */
function fieldValue(
  field: TaskField,
  description: string,
  all: string,
  tenant: VoiceTenantConfig,
  now: number,
  known: { name?: string; phone?: string; email?: string },
): string {
  const max = field.maxLength ?? 200;
  switch (field.type) {
    case "choice": {
      const choices = field.choices ?? [];
      const lower = all.toLowerCase();
      const named = choices.find(
        (choice) => lower.includes(choice.id.replace(/_/g, " ")) || Object.values(choice.label).some((label) => label && lower.includes(label.toLowerCase())),
      );
      return (named ?? choices.find((choice) => choice.id === "other") ?? choices[0])?.id ?? "";
    }
    case "integer":
      return String(field.min ?? 1);
    case "date":
      return tomorrow(tenant, now);
    case "time":
      return "10:00";
    case "boolean":
      return "no";
    case "phone":
      return known.phone ?? "";
    case "email":
      return known.email ?? "";
    case "name":
      return known.name ?? "";
    default:
      return description.slice(0, max);
  }
}

function tomorrow(tenant: VoiceTenantConfig, now: number): string {
  return addDays(zonedParts(new Date(now), tenant.hours.timezone).date, 1);
}

// ---------------------------------------------------------------------------------------------
// Reading the conversation
// ---------------------------------------------------------------------------------------------

/** Every caller utterance, oldest first (text only, never tool results). */
function callerTexts(messages: readonly Anthropic.MessageParam[]): string[] {
  const texts: string[] = [];
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (typeof message.content === "string") {
      if (message.content.trim()) texts.push(message.content);
      continue;
    }
    for (const block of message.content) if (block.type === "text" && block.text.trim()) texts.push(block.text);
  }
  return texts;
}

interface ToolResultView {
  name: string;
  ok: boolean;
  code?: string;
  data?: Record<string, unknown>;
}

function toolResults(message: Anthropic.MessageParam): Array<{ toolUseId: string; result: ToolResultView | null }> {
  if (typeof message.content === "string") return [];
  const results: Array<{ toolUseId: string; result: ToolResultView | null }> = [];
  for (const block of message.content) {
    if (block.type !== "tool_result") continue;
    results.push({ toolUseId: block.tool_use_id, result: parseResult(typeof block.content === "string" ? block.content : "") });
  }
  return results;
}

function parseResult(text: string): ToolResultView | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    return {
      name: "",
      ok: value.ok === true,
      code: typeof value.code === "string" ? value.code : undefined,
      data: typeof value.data === "object" && value.data !== null ? (value.data as Record<string, unknown>) : undefined,
    };
  } catch {
    return null;
  }
}

function describeResult(
  entry: { toolUseId: string; result: ToolResultView | null },
  messages: readonly Anthropic.MessageParam[],
  texts: MockTexts,
): string {
  const result = entry.result;
  if (result === null) return texts.failed.replace("{code}", "unreadable");
  if (!result.ok) return texts.failed.replace("{code}", result.code ?? "failed");
  const name = toolNameOf(entry.toolUseId, messages);
  const data = result.data ?? {};
  if (name === "check_availability") {
    const slots = Array.isArray(data.slots) ? (data.slots as Array<{ time?: unknown }>) : [];
    const times = slots.slice(0, 2).map((slot) => String(slot.time ?? "")).filter(Boolean);
    return texts.slots.replace("{times}", times.join(texts.and));
  }
  if (name === "book_appointment") return texts.booked.replace("{ref}", String(data.reference ?? ""));
  if (name === "create_lead") return texts.saved.replace("{ref}", String(data.reference ?? ""));
  return texts.saved.replace("{ref}", String(data.reference ?? "-"));
}

function toolNameOf(toolUseId: string, messages: readonly Anthropic.MessageParam[]): string {
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") continue;
    for (const block of message.content) if (block.type === "tool_use" && block.id === toolUseId) return block.name;
  }
  return "";
}

/** The latest successful check_availability: its service, first free start and party size. */
function lastCheck(messages: readonly Anthropic.MessageParam[]): { service: string; start?: string; partySize?: number } | null {
  let found: { service: string; start?: string; partySize?: number } | null = null;
  for (const message of messages) {
    if (message.role !== "user" || typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type !== "tool_result" || toolNameOf(block.tool_use_id, messages) !== "check_availability") continue;
      const result = parseResult(typeof block.content === "string" ? block.content : "");
      if (!result?.ok || !result.data) continue;
      const slots = Array.isArray(result.data.slots) ? (result.data.slots as Array<{ start?: unknown }>) : [];
      const partySize = toolInputOf(block.tool_use_id, messages)?.party_size;
      found = {
        service: String(result.data.service ?? ""),
        start: typeof slots[0]?.start === "string" ? slots[0].start : undefined,
        partySize: typeof partySize === "number" ? partySize : undefined,
      };
    }
  }
  return found;
}

function toolInputOf(toolUseId: string, messages: readonly Anthropic.MessageParam[]): Record<string, unknown> | null {
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type === "tool_use" && block.id === toolUseId && typeof block.input === "object" && block.input !== null) {
        return block.input as Record<string, unknown>;
      }
    }
  }
  return null;
}

function succeeded(tool: string, messages: readonly Anthropic.MessageParam[]): boolean {
  for (const message of messages) {
    if (message.role !== "user" || typeof message.content === "string") continue;
    for (const block of message.content) {
      if (block.type !== "tool_result" || toolNameOf(block.tool_use_id, messages) !== tool) continue;
      if (parseResult(typeof block.content === "string" ? block.content : "")?.ok) return true;
    }
  }
  return false;
}

function countToolUses(messages: readonly Anthropic.MessageParam[]): number {
  let count = 0;
  for (const message of messages) {
    if (message.role !== "assistant" || typeof message.content === "string") continue;
    for (const block of message.content) if (block.type === "tool_use") count += 1;
  }
  return count;
}
