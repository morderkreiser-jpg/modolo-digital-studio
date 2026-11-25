// Shared contract of Modolo Voice AI (the AI receptionist).
//
// SAFE TO IMPORT FROM CLIENT AND SERVER: types and plain constants only, no Node or Next APIs, no
// secrets. Everything that touches API keys, the store, tool execution or the knowledge base lives
// under lib/voice/server/ and must never be imported by a "use client" module.
//
// One VoiceTenantConfig per business. Tenants are plain data in code for now (like the chat
// assistant in lib/assistant); the same shape maps 1:1 onto database rows when the product becomes
// a multi-tenant SaaS (see ARCHITECTURE.md in the private project folder).
//
// Vocabulary used across the module:
//   session  — one conversation (a web demo or, later, a phone call)
//   turn     — one caller utterance and the assistant's reply to it
//   task     — something the assistant collects in a structured way (a quote request, a reservation)
//   tool     — a server-side action with a strict schema; the model can do nothing else
//   handoff  — passing the caller on to a person: live transfer, callback promise or written follow-up

// ---------------------------------------------------------------------------------------------
// Locales & localized text
// ---------------------------------------------------------------------------------------------

/**
 * Languages the receptionist speaks. The website itself has pages in en/de/it only; French exists
 * in the voice module because callers do not care which pages the site has.
 */
export const VOICE_LOCALES = ["de", "it", "en", "fr"] as const;
export type VoiceLocale = (typeof VOICE_LOCALES)[number];

export function isVoiceLocale(value: unknown): value is VoiceLocale {
  return typeof value === "string" && (VOICE_LOCALES as readonly string[]).includes(value);
}

/** A string per locale. Missing locales fall back to the tenant's default locale, then to any. */
export type VoiceText = Partial<Record<VoiceLocale, string>>;

/** BCP 47 tags for speech engines and the `lang` attribute. Swiss variants where they exist. */
export const VOICE_LANG_TAG: Record<VoiceLocale, string> = {
  de: "de-CH",
  it: "it-CH",
  en: "en-GB",
  fr: "fr-CH",
};

// ---------------------------------------------------------------------------------------------
// Business hours, holidays, answer policy
// ---------------------------------------------------------------------------------------------

/** "HH:MM", 24-hour clock, in the tenant's time zone. "24:00" is allowed as the end of a range. */
export type ClockTime = string;

export interface TimeRange {
  from: ClockTime;
  to: ClockTime;
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type WeeklySchedule = Record<Weekday, TimeRange[]>;

export interface BusinessHours {
  /** IANA zone. Europe/Zurich for the Swiss market. */
  timezone: string;
  /** Opening hours per weekday; an empty list means closed. */
  weekly: WeeklySchedule;
  /** Whole days closed (YYYY-MM-DD in the tenant's zone). */
  holidays: Array<{ date: string; label?: VoiceText }>;
  /** Days with different hours ([] = closed). Wins over `weekly` and `holidays`. */
  exceptions?: Array<{ date: string; ranges: TimeRange[]; label?: VoiceText }>;
}

/**
 * When the AI answers a PHONE call. The switches combine; `always` overrides the rest. The
 * carrier-side forwarding the customer has to set up follows from them (lib/voice/hours.ts).
 */
export interface AnswerPolicy {
  /** The AI answers every call. */
  always: boolean;
  /** Outside the opening hours, closed days included. */
  afterHours: boolean;
  /** On Saturdays and Sundays, also while the business is open. */
  weekends: boolean;
  /** On the tenant's holidays. */
  holidays: boolean;
  /** While open: after this many seconds without an answer (conditional forwarding). null = never. */
  noAnswerAfterSeconds: number | null;
  /** While open: when the line is busy (busy forwarding / overflow). */
  whenBusy: boolean;
}

// ---------------------------------------------------------------------------------------------
// Handoff to people
// ---------------------------------------------------------------------------------------------

export interface HandoffTarget {
  /** Stable id used by the transfer tool, e.g. "owner", "dispatch". */
  id: string;
  /** How the assistant names this person or team to the caller. */
  label: VoiceText;
  /** E.164. SERVER-ONLY: never sent to the browser, never spoken, never given to the model. */
  number: string;
  /** When this target takes transfers (tenant zone). Omitted = whenever the business is open. */
  available?: WeeklySchedule;
}

export interface HandoffRules {
  /** Live transfer of a phone call. Not available on the web channel. */
  transfer: { enabled: boolean; targets: HandoffTarget[]; ringSeconds: number };
  /** A person calls back. `promise` is the only wording the assistant may use about timing. */
  callback: { enabled: boolean; promise?: VoiceText };
  /** A person answers in writing (email or messaging). */
  written: { enabled: boolean; promise?: VoiceText };
  /**
   * Urgent or dangerous situations (gas smell, water spraying on electrics, a medical problem...).
   * The assistant gives the message, names the emergency numbers and offers a transfer if enabled.
   * It never diagnoses and never gives instructions beyond the message.
   */
  emergency: { triggers: string[]; message: VoiceText };
}

// ---------------------------------------------------------------------------------------------
// Tasks: what the assistant collects
// ---------------------------------------------------------------------------------------------

export type TaskFieldType =
  | "text"
  | "name"
  | "phone"
  | "email"
  | "date"
  | "time"
  | "integer"
  | "boolean"
  | "choice"
  | "address"
  | "locality";

export interface TaskField {
  /** Stable id, snake_case, unique within the task. Becomes a property of the tool input. */
  id: string;
  label: VoiceText;
  type: TaskFieldType;
  required: boolean;
  /** For type "choice". */
  choices?: Array<{ id: string; label: VoiceText }>;
  /** The assistant must read the value back and get a yes before storing it. */
  confirm?: boolean;
  /** Longest accepted value (characters). Default 200. */
  maxLength?: number;
  /** For "integer": inclusive bounds. */
  min?: number;
  max?: number;
}

export type ContactNeed = "required" | "optional" | "none";

export interface TaskDefinition {
  /** Stable id, snake_case. */
  id: string;
  label: VoiceText;
  /** When the assistant starts this task. English, for the system prompt. */
  when: string;
  fields: TaskField[];
  /** Contact details the task needs. Ask only for what is necessary. */
  contact: { name: ContactNeed; phone: ContactNeed; email: ContactNeed; company: ContactNeed };
}

// ---------------------------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------------------------

export interface CalendarService {
  id: string;
  label: VoiceText;
  durationMinutes: number;
  bufferBeforeMinutes?: number;
  bufferAfterMinutes?: number;
}

export type CalendarCapacity =
  /** One resource: a booking blocks its time (a consultation, a haircut with one stylist). */
  | { kind: "single" }
  /** Seats shared by parallel bookings (a restaurant): `turnMinutes` is how long a table is held. */
  | { kind: "seats"; total: number; maxPartySize: number; turnMinutes: number };

export interface CalendarConfig {
  /** "memory" is the built-in deterministic calendar (demos, tests). The others are adapters. */
  provider: "memory" | "google" | "microsoft";
  services: CalendarService[];
  capacity: CalendarCapacity;
  /** When appointments may START (tenant zone). Omitted = the opening hours. */
  bookable?: WeeklySchedule;
  /** Grid of possible start times in minutes: 15, 30 or 60. */
  slotStepMinutes: number;
  /** No booking sooner than this from now. */
  minLeadMinutes: number;
  /** No booking further ahead than this. */
  maxDaysAhead: number;
  allowCancel: boolean;
  allowReschedule: boolean;
  /** Cancelling or moving by voice is refused closer to the start than this. */
  changeMinLeadMinutes: number;
}

/** A free start time. `start`/`end` are ISO 8601 with the zone offset, e.g. 2026-12-03T14:30:00+01:00. */
export interface Slot {
  serviceId: string;
  start: string;
  end: string;
}

export interface Booking {
  /** Short human-readable reference the caller can note down, e.g. "MV-7K2Q". */
  ref: string;
  serviceId: string;
  start: string;
  end: string;
  name: string;
  /** Phone or email as given by the caller. */
  contact: string;
  partySize?: number;
  notes?: string;
  status: "confirmed" | "cancelled";
  createdAt: string;
}

export type CalendarErrorCode =
  | "conflict" // the slot was taken in the meantime
  | "outside_hours"
  | "too_soon"
  | "too_far"
  | "too_late_to_change"
  | "not_found"
  | "not_allowed"
  | "invalid"
  | "unavailable"; // the calendar backend did not answer: never report a booking as done

export type CalendarResult<T> = { ok: true; value: T } | { ok: false; code: CalendarErrorCode };

/**
 * A calendar backend. Implementations must be idempotent on `idempotencyKey`: repeating a call
 * with the same key returns the first result instead of creating a second booking.
 */
export interface CalendarProvider {
  findSlots(query: {
    serviceId: string;
    /** YYYY-MM-DD in the tenant's zone. */
    date: string;
    partySize?: number;
    partOfDay?: "morning" | "afternoon" | "evening";
    /** Injected clock, for tests. */
    now?: Date;
  }): Promise<CalendarResult<Slot[]>>;
  book(request: {
    serviceId: string;
    start: string;
    name: string;
    contact: string;
    partySize?: number;
    notes?: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<CalendarResult<Booking>>;
  cancel(request: { ref: string; name: string; now?: Date }): Promise<CalendarResult<Booking>>;
  reschedule(request: {
    ref: string;
    name: string;
    newStart: string;
    idempotencyKey: string;
    now?: Date;
  }): Promise<CalendarResult<Booking>>;
}

// ---------------------------------------------------------------------------------------------
// Tools: the only actions the model can take
// ---------------------------------------------------------------------------------------------

export const VOICE_TOOLS = [
  "check_availability",
  "book_appointment",
  "cancel_appointment",
  "reschedule_appointment",
  "create_lead",
  "request_callback",
  "transfer_call",
  "end_call",
] as const;
export type VoiceToolName = (typeof VOICE_TOOLS)[number];

export function isVoiceToolName(value: unknown): value is VoiceToolName {
  return typeof value === "string" && (VOICE_TOOLS as readonly string[]).includes(value);
}

/** Provider-neutral tool definition: a JSON Schema object with additionalProperties: false. */
export interface VoiceToolDefinition {
  name: VoiceToolName;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
    additionalProperties: false;
  };
}

export interface ToolCall {
  /** Id given by the model provider; echoed back with the result. */
  id: string;
  name: string;
  input: unknown;
}

export type ToolErrorCode =
  | "invalid_input" // failed schema or field validation; `say` tells the model what to ask again
  | "not_enabled" // the tenant does not use this tool
  | "not_available" // no free slot, nobody takes the transfer, callbacks not offered...
  | "conflict"
  | "not_found"
  | "limit_reached" // per-session cap (bookings, leads, tool calls)
  | "forbidden" // wrong channel or tenant
  | "unavailable"; // a backend failed: the assistant must say it could not complete the action

/**
 * What a tool returns to the model. `say` is a short, factual line in English the model phrases
 * for the caller in their language; it never contains instructions other than what to tell or ask.
 */
export type ToolOutcome =
  | { ok: true; say: string; data?: Record<string, unknown>; endCall?: boolean }
  | { ok: false; code: ToolErrorCode; say: string };

export type VoiceChannel = "web" | "phone";

// ---------------------------------------------------------------------------------------------
// Limits, privacy, plans
// ---------------------------------------------------------------------------------------------

/** Abuse and cost limits of one tenant. Every field can be overridden per tenant and by env. */
export interface VoiceLimits {
  /** Hard cut of one conversation, in seconds. */
  maxCallSeconds: number;
  /** The assistant announces the end this many seconds before the cut. */
  warnBeforeEndSeconds: number;
  /** Hang up after this much silence. */
  silenceTimeoutSeconds: number;
  /** Caller turns per session (text-turn mode). */
  maxTurnsPerSession: number;
  /** Characters of one caller turn (text fallback, transcripts). */
  maxTurnChars: number;
  /** New sessions per IP. */
  sessionsPerIpPerHour: number;
  sessionsPerIpPerDay: number;
  /** Conversations running at the same time, per tenant. */
  maxConcurrentSessions: number;
  /** Conversation minutes per tenant (UTC day / UTC month). */
  minutesPerDay: number;
  minutesPerMonth: number;
  /** Estimated spend ceiling per tenant and month, in CHF. Reaching it stops new sessions. */
  budgetChfPerMonth: number;
  /** Per-session caps on actions. */
  toolCallsPerSession: number;
  bookingsPerSession: number;
  leadsPerSession: number;
}

/** Defaults for a PUBLIC web demo: generous for a curious visitor, useless for a script. */
export const DEFAULT_VOICE_LIMITS: VoiceLimits = {
  maxCallSeconds: 180,
  warnBeforeEndSeconds: 20,
  silenceTimeoutSeconds: 25,
  maxTurnsPerSession: 24,
  maxTurnChars: 600,
  sessionsPerIpPerHour: 3,
  sessionsPerIpPerDay: 6,
  maxConcurrentSessions: 2,
  minutesPerDay: 30,
  minutesPerMonth: 300,
  budgetChfPerMonth: 30,
  toolCallsPerSession: 12,
  bookingsPerSession: 2,
  leadsPerSession: 2,
};

export interface VoicePrivacy {
  /** Audio is not recorded unless a tenant turns it on after the legal check. Default false. */
  recordAudio: boolean;
  /** Days transcripts are kept. 0 = not kept at all. */
  transcriptRetentionDays: number;
  /** Days call summaries (the structured result of a call) are kept. */
  summaryRetentionDays: number;
  /** Link to the privacy notice per locale, shown before the microphone is requested. */
  noticeUrl: VoiceText;
}

export const VOICE_PLANS = ["demo", "starter", "professional", "business"] as const;
export type VoicePlanId = (typeof VOICE_PLANS)[number];

// ---------------------------------------------------------------------------------------------
// Knowledge
// ---------------------------------------------------------------------------------------------

/** One block of verified business knowledge. Plain text; rendered for ONE locale. */
export interface VoiceKnowledgeSection {
  id: string;
  title: VoiceText;
  content: VoiceText;
  /** Maintainer note: where the facts come from. Never sent to the model. */
  source?: string;
}

export interface VoiceKnowledge {
  version: string;
  sections: VoiceKnowledgeSection[];
}

// ---------------------------------------------------------------------------------------------
// Tenant (business) configuration
// ---------------------------------------------------------------------------------------------

export const VOICE_SECTORS = [
  "studio",
  "moving",
  "cleaning",
  "plumbing",
  "electrical",
  "trades",
  "bodyshop",
  "realestate",
  "restaurant",
  "hotel",
  "hairdresser",
  "beauty",
  "tattoo",
] as const;
export type VoiceSector = (typeof VOICE_SECTORS)[number];

export type Formality = "formal" | "informal";

/**
 * Full configuration of one business. Lives on the SERVER: it holds the knowledge, the rules and
 * the transfer numbers. The browser only ever receives VoicePublicConfig.
 */
export interface VoiceTenantConfig {
  /** Stable id: lowercase letters, digits and dashes. Demo tenants start with "demo-". */
  id: string;
  /** "demo" tenants are fictional businesses: their data is invented and says so. */
  kind: "live" | "demo";
  business: {
    name: string;
    sector: VoiceSector;
    /** Town, as spoken ("Winterthur"). */
    locality: string;
    /** One or two sentences: what the business does. */
    description: VoiceText;
  };
  locales: VoiceLocale[];
  defaultLocale: VoiceLocale;
  persona: {
    /** How the assistant names itself, e.g. "der digitale Assistent von Muster Umzüge". */
    assistantName: VoiceText;
    /** "Sie" or "du" (formal/informal) per language. */
    formality: Partial<Record<VoiceLocale, Formality>>;
    /** Extra style rules for the model, in English. */
    style: string[];
  };
  /**
   * First thing said. Must state that the caller is talking to an AI assistant; tests enforce it
   * for every locale of the tenant.
   */
  greeting: VoiceText;
  hours: BusinessHours;
  answerPolicy: AnswerPolicy;
  handoff: HandoffRules;
  tasks: TaskDefinition[];
  /** Tools this tenant uses. A tool that is not listed does not exist for the model. */
  tools: VoiceToolName[];
  calendar?: CalendarConfig;
  /** Business rules for the model, in English ("never quote a fixed price for a move"). */
  rules: string[];
  limits?: Partial<VoiceLimits>;
  plan: VoicePlanId;
  privacy: VoicePrivacy;
  /** Origins allowed to open web sessions (in addition to same-origin requests). */
  allowedOrigins: string[];
  /** Where call summaries are emailed (server-only). Demo tenants have none. */
  notifyEmail?: string;
  /** Built lazily on the server. */
  knowledge: () => VoiceKnowledge;
}

/** The serializable subset of a tenant that may reach the browser. No knowledge, rules or numbers. */
export interface VoicePublicConfig {
  tenant: string;
  kind: "live" | "demo";
  businessName: string;
  sector: VoiceSector;
  /** Initial language of the widget. */
  locale: VoiceLocale;
  locales: VoiceLocale[];
  assistantName: VoiceText;
  greeting: VoiceText;
  privacyUrl: VoiceText;
  limits: Pick<VoiceLimits, "maxCallSeconds" | "warnBeforeEndSeconds" | "silenceTimeoutSeconds" | "maxTurnChars">;
  /** Modes the server offers right now, best first. */
  modes: VoiceMode[];
  endpoints: { session: string; turn: string; end: string };
}

// ---------------------------------------------------------------------------------------------
// Sessions and the HTTP protocol
// ---------------------------------------------------------------------------------------------

/**
 * How a web conversation runs.
 *   scripted — a written example conversation played back with captions. No microphone, no
 *              network, no model. Always labelled as an example.
 *   local    — the browser's own speech recognition and speech synthesis around our text brain.
 *              A development and test harness: free, but not the product's voice quality.
 *   realtime — the real product: streaming audio to a voice provider over WebRTC, with a
 *              short-lived token minted by our server. Needs a provider account.
 */
export type VoiceMode = "scripted" | "local" | "realtime";

export const VOICE_SESSION_ENDPOINT = "/api/voice/session";
export const VOICE_TURN_ENDPOINT = "/api/voice/turn";
export const VOICE_END_ENDPOINT = "/api/voice/end";

export type VoiceErrorCode =
  | "bad_request"
  | "too_large"
  | "forbidden" // origin not allowed, honeypot, bad or foreign session token
  | "rate_limited" // per-IP session limits
  | "busy" // too many conversations at the same time
  | "budget_exhausted" // the tenant's minutes or spend ceiling is reached
  | "session_limit" // turns or seconds of this session are used up
  | "expired" // the session token is no longer valid
  | "unavailable" // voice disabled / not configured / provider down
  | "upstream"
  | "timeout"
  | "refused";

export interface VoiceApiError {
  ok: false;
  error: VoiceErrorCode;
  retryAfter?: number;
}

/** POST /api/voice/session */
export interface SessionRequestBody {
  tenant: string;
  locale: VoiceLocale;
  /** The mode the widget wants; the server may answer with a lesser one it can offer. */
  mode: VoiceMode;
  /** Path of the page (context only), max 200 chars. */
  page?: string;
  /** Honeypot: must be empty. */
  hp?: string;
}

export interface SessionGrant {
  ok: true;
  /** Opaque, signed by the server, bound to tenant + mode + expiry. Sent back with every call. */
  sessionToken: string;
  mode: VoiceMode;
  locale: VoiceLocale;
  /** Unix ms. After this the token is refused. */
  expiresAt: number;
  limits: Pick<VoiceLimits, "maxCallSeconds" | "warnBeforeEndSeconds" | "silenceTimeoutSeconds" | "maxTurnChars">;
  /** Present in "realtime" mode only: what the provider SDK needs. Never an API key. */
  realtime?: { provider: string; token: string; expiresAt: number; params?: Record<string, string> };
}

/** POST /api/voice/turn (mode "local"): one caller utterance in, the reply as Server-Sent Events. */
export interface TurnRequestBody {
  sessionToken: string;
  /** What the caller said (recognised speech or typed text). Empty string only with `opening`. */
  text: string;
  /** Language the recogniser was set to; the model still answers in the language actually used. */
  locale: VoiceLocale;
  /** True for the very first request of a session: the assistant speaks its greeting. */
  opening?: boolean;
}

export type HandoffNotice =
  | { kind: "transfer"; targetLabel: string }
  | { kind: "callback" }
  | { kind: "written" };

export type TurnStreamEvent =
  | { type: "start" }
  /** A piece of the reply, to be spoken and shown as a caption. */
  | { type: "delta"; text: string }
  /** A tool started or finished. Only the name and the outcome: never inputs or personal data. */
  | { type: "tool"; name: VoiceToolName; status: "started" | "ok" | "failed" }
  | { type: "handoff"; handoff: HandoffNotice }
  | {
      type: "done";
      /** True when the assistant ended the conversation. */
      ended: boolean;
      remainingTurns: number;
      remainingSeconds: number;
    }
  | { type: "error"; code: VoiceErrorCode; retryAfter?: number };

/** POST /api/voice/end: the widget reports that the conversation is over. */
export interface EndRequestBody {
  sessionToken: string;
  /** Why it ended, for the log. */
  reason: "user" | "assistant" | "timeout" | "silence" | "error" | "unload";
}

// ---------------------------------------------------------------------------------------------
// Call summaries (what the business receives after a conversation)
// ---------------------------------------------------------------------------------------------

export interface CallSummary {
  tenant: string;
  sessionId: string;
  channel: VoiceChannel;
  startedAt: string;
  durationSeconds: number;
  locale: VoiceLocale;
  /** What happened, in the order it happened. */
  outcomes: Array<
    | { kind: "lead"; taskId: string; ref: string; fields: Record<string, string>; contact: Record<string, string> }
    | { kind: "booking"; booking: Booking }
    | { kind: "cancellation"; ref: string }
    | { kind: "callback"; name: string; phone: string; topic: string; preferredTime?: string }
    | { kind: "transfer"; targetId: string; connected: boolean }
    | { kind: "emergency_notice" }
  >;
  /** True when the caller left without any outcome above. */
  noOutcome: boolean;
}

// ---------------------------------------------------------------------------------------------
// Example conversations (mode "scripted" and the sales demos)
// ---------------------------------------------------------------------------------------------

export interface DemoScriptLine {
  role: "assistant" | "caller";
  text: string;
  /**
   * A tool the assistant calls BEFORE saying this line. The input must validate against the
   * tenant's tool schemas (tests replay every script through the real validators).
   */
  tool?: { name: VoiceToolName; input: Record<string, unknown>; outcome: "ok" | "failed" };
}

export interface DemoScript {
  /** Unique: "<tenant id>.<locale>.<slug>". */
  id: string;
  tenantId: string;
  locale: VoiceLocale;
  /** Short title shown above the example, in the script's language. */
  title: string;
  /** The business problem this conversation shows, one sentence, in the script's language. */
  shows: string;
  lines: DemoScriptLine[];
}
