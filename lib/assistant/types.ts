// Shared, framework-agnostic types for the AI assistant ("Modolo Assistant").
//
// SAFE TO IMPORT FROM CLIENT AND SERVER: types and plain constants only, no Node or Next APIs,
// no secrets. Everything that touches the Anthropic API key, the store or the knowledge base
// lives under lib/assistant/server/ and must never be imported by a "use client" module.
//
// The module is written to be reusable for other businesses (restaurants, hotels, studios):
// one TenantConfig per business, selected by id. Today there is a single tenant ("modolo").

// ---------------------------------------------------------------------------------------------
// Locales & localized text
// ---------------------------------------------------------------------------------------------

/** UI/answer languages the widget ships strings for. Add a locale here + in i18n.ts to extend. */
export const ASSISTANT_LOCALES = ["en", "de", "it"] as const;
export type AssistantLocale = (typeof ASSISTANT_LOCALES)[number];

export function isAssistantLocale(value: unknown): value is AssistantLocale {
  return typeof value === "string" && (ASSISTANT_LOCALES as readonly string[]).includes(value);
}

/** A string per locale. Missing locales fall back (see localize.ts → pickText). */
export type LocalizedText = Partial<Record<AssistantLocale, string>>;

// ---------------------------------------------------------------------------------------------
// Knowledge base (server-only at runtime, but the shape is shared so tenants are plain data)
// ---------------------------------------------------------------------------------------------

/**
 * One block of business knowledge. The knowledge base is a list of sections so that any kind of
 * business can be described (a studio's price list, a restaurant's menu and opening hours, a
 * hotel's rooms...) without changing code. Content is plain text with light markdown
 * ("- " bullets, **bold**, [label](url) links) and is rendered for ONE locale and ONE region.
 */
export interface KnowledgeSection {
  /** Stable id, e.g. "pricing", "services", "faq", "contact". */
  id: string;
  title: LocalizedText;
  /** Default content per locale (used when no regional variant exists). */
  content: LocalizedText;
  /** Optional per-region variants of `content` (e.g. CHF prices for "ch", EUR for "it"). */
  byRegion?: Record<string, LocalizedText>;
  /** Maintainer note: where the facts come from. Never sent to the model. */
  source?: string;
}

export interface KnowledgeBase {
  /** Bump when the content changes; it is logged with each request for traceability. */
  version: string;
  sections: KnowledgeSection[];
}

// ---------------------------------------------------------------------------------------------
// Tenant (business) configuration
// ---------------------------------------------------------------------------------------------

export type ThemeMode = "light" | "dark" | "auto";

/** CSS colour tokens of the widget. Any CSS colour string. */
export interface ThemeColors {
  /** Primary action colour (launcher, send button, user bubble). */
  accent: string;
  /** Text/icon colour on top of `accent`. */
  accentText: string;
  /** Panel background. */
  background: string;
  /** Raised surfaces: assistant bubbles, inputs, chips. */
  surface: string;
  /** Main text. */
  text: string;
  /** Secondary text (timestamps, hints, disclaimers). Must keep AA contrast on background. */
  muted: string;
  /** Hairlines and borders. */
  line: string;
  /** Decorative highlight (focus ring, small accents). */
  highlight: string;
  /** Error text/borders. */
  danger: string;
}

export interface TenantBranding {
  /** Business name as shown in the header, e.g. "Modolo Digital Studio". */
  name: string;
  /** How the assistant introduces itself, e.g. "Assistente di Modolo Digital Studio". */
  assistantName: LocalizedText;
  /** Square image used as avatar (relative URL on the host site or absolute https URL). */
  logoUrl?: string;
  theme: ThemeMode;
  /** Light palette overrides (merged over the widget defaults). */
  colors?: Partial<ThemeColors>;
  /** Dark palette overrides (used when theme is "dark", or "auto" + OS dark mode). */
  darkColors?: Partial<ThemeColors>;
  /** CSS font-family for body text. Default: inherit from the host page. */
  fontFamily?: string;
  /** CSS font-family for the header title. Default: same as fontFamily. */
  headingFontFamily?: string;
}

/** Contact channels shown in fallbacks ("write to us directly") and on the success screen. */
export interface PublicContact {
  email?: string;
  /** WhatsApp number in E.164 (+41...), plus how to display it. */
  whatsapp?: { number: string; display: string; prefill?: LocalizedText };
  /** Link to the site's own contact section/page. */
  contactUrl?: LocalizedText;
}

export interface LeadOption {
  id: string;
  label: LocalizedText;
}

export type ModelRouting = "fast" | "advanced" | "auto";
export type Effort = "low" | "medium" | "high";

/** Abuse, size and cost limits. Every field can be overridden per tenant and by env (see env.ts). */
export interface AssistantLimits {
  /** Max characters of a single user message. */
  maxMessageChars: number;
  /** Max messages accepted in one request body (whole client-side history). */
  maxHistoryMessages: number;
  /** Max total characters across the accepted history. */
  maxTotalChars: number;
  /** Most recent messages actually forwarded to the model (older ones are dropped). */
  maxContextMessages: number;
  /** User messages allowed per browser session (sessionId). */
  maxUserMessagesPerSession: number;
  /** Chat requests per IP per minute / hour / day. */
  ipPerMinute: number;
  ipPerHour: number;
  ipPerDay: number;
  /** Chat requests per tenant per UTC day (all visitors together). */
  tenantRequestsPerDay: number;
  /** Estimated API spend caps per tenant, in USD (UTC day / UTC calendar month). */
  tenantBudgetUsdPerDay: number;
  tenantBudgetUsdPerMonth: number;
  /** Lead (quote request) submissions per IP per hour, and per email address per day. */
  leadsPerIpPerHour: number;
  leadsPerEmailPerDay: number;
}

/** Defaults tuned for a small business site: generous for humans, tight for scripts. */
export const DEFAULT_LIMITS: AssistantLimits = {
  maxMessageChars: 800,
  maxHistoryMessages: 40,
  maxTotalChars: 16_000,
  maxContextMessages: 14,
  maxUserMessagesPerSession: 30,
  ipPerMinute: 8,
  ipPerHour: 60,
  ipPerDay: 150,
  tenantRequestsPerDay: 1_000,
  tenantBudgetUsdPerDay: 1,
  tenantBudgetUsdPerMonth: 15,
  leadsPerIpPerHour: 5,
  leadsPerEmailPerDay: 3,
};

export interface TenantRegions {
  /** All region ids this tenant prices for, e.g. ["ch", "it"]. */
  ids: string[];
  default: string;
  /** Cookie the host site uses to remember the visitor's region (optional). */
  cookie?: string;
  /** ISO country (from the x-vercel-ip-country header) → region id, e.g. { IT: "it" }. */
  byCountry?: Record<string, string>;
  /** Human label per region, used in the prompt ("Switzerland, prices in CHF"). */
  labels: Record<string, LocalizedText>;
}

/**
 * Full configuration of one business. Lives on the SERVER (it holds the knowledge base and the
 * lead recipient). The browser only ever receives `AssistantPublicConfig` (see toPublicConfig).
 */
export interface TenantConfig {
  id: string;
  defaultLocale: AssistantLocale;
  locales: AssistantLocale[];
  branding: TenantBranding;
  /** First message shown when a conversation starts (not sent to the model). */
  welcome: LocalizedText;
  /** Suggested first questions (max 4 per locale). */
  starters: Partial<Record<AssistantLocale, string[]>>;
  contact: PublicContact;
  /** Region-specific contact overrides (e.g. Italian WhatsApp number for "it"). */
  contactByRegion?: Record<string, Partial<PublicContact>>;
  /** Privacy policy URL per locale — linked from the widget disclaimer and the consent box. */
  privacyUrl: LocalizedText;
  /** Hide the launcher when the LAST path segment matches one of these (e.g. "biglietto"). */
  hiddenOnPathSegments?: string[];
  regions: TenantRegions;
  leads: {
    enabled: boolean;
    /** Services selectable in the quote form; ids are also the enum of the AI tool. */
    services: LeadOption[];
    /** Budget ranges per region id ("default" = fallback). */
    budgetOptions: Record<string, LeadOption[]>;
    requireCompany: boolean;
    requirePhone: boolean;
    /** Where quote requests are emailed (server-only; never sent to the browser). */
    notifyEmail: string;
    /** How long stored copies of leads are kept (days). Shown in the privacy notice. */
    retentionDays: number;
  };
  ai: {
    /** Extra business-specific rules for the model, in English (e.g. "never promise calls"). */
    rules: string[];
    effort?: Effort;
    maxOutputTokens?: number;
    routing?: ModelRouting;
  };
  limits?: Partial<AssistantLimits>;
  /** Origins allowed to call the API from a browser (in addition to same-origin requests). */
  allowedOrigins: string[];
  /** Built lazily on the server; plain data so another business can replace it wholesale. */
  knowledge: () => KnowledgeBase;
  /** Optional overrides of the default UI strings (see i18n.ts). */
  strings?: Partial<Record<AssistantLocale, Partial<Record<string, string>>>>;
}

/** The serializable subset of TenantConfig that is sent to the browser. No secrets. */
export interface AssistantPublicConfig {
  tenant: string;
  /** Initial UI locale (the page language). */
  locale: AssistantLocale;
  locales: AssistantLocale[];
  branding: TenantBranding;
  welcome: LocalizedText;
  starters: Partial<Record<AssistantLocale, string[]>>;
  contact: PublicContact;
  contactByRegion?: Record<string, Partial<PublicContact>>;
  regionCookie?: string;
  defaultRegion: string;
  privacyUrl: LocalizedText;
  hiddenOnPathSegments: string[];
  leads: {
    enabled: boolean;
    services: LeadOption[];
    budgetOptions: Record<string, LeadOption[]>;
    requireCompany: boolean;
    requirePhone: boolean;
    retentionDays: number;
  };
  limits: Pick<AssistantLimits, "maxMessageChars" | "maxUserMessagesPerSession">;
  endpoints: { chat: string; lead: string };
  strings?: Partial<Record<AssistantLocale, Partial<Record<string, string>>>>;
}

// ---------------------------------------------------------------------------------------------
// Chat API: request body and streamed events
// ---------------------------------------------------------------------------------------------

export const ASSISTANT_CHAT_ENDPOINT = "/api/assistant/chat";
export const ASSISTANT_LEAD_ENDPOINT = "/api/assistant/lead";

/** Plain-text conversation turn as kept by the browser and sent back each request. */
export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatRequestBody {
  tenant: string;
  /** Random id generated by the browser per tab session: [A-Za-z0-9_-]{16,64}. */
  sessionId: string;
  /** Current UI language. */
  locale: AssistantLocale;
  /** Path of the page the visitor is on (context for the answer), max 200 chars. */
  page?: string;
  /** Whole conversation (oldest first). Must end with a user turn. */
  messages: ChatTurn[];
  /** Conversation flags the model should know about. */
  state?: { quoteFormShown?: boolean; leadSubmitted?: boolean };
  /** Honeypot: must be empty. */
  hp?: string;
}

/** Shown to the visitor when the model decides a quote request makes sense. */
export interface QuoteFormAction {
  kind: "quote_form";
  /** One of tenant.leads.services ids, or undefined. */
  service?: string;
  /** Short editable summary of the visitor's need (prefills the description field). */
  summary?: string;
}

export type ChatErrorCode =
  | "bad_request" // malformed body / validation failed
  | "too_large" // body over the size cap
  | "forbidden" // origin not allowed / honeypot
  | "rate_limited" // per-IP limits
  | "session_limit" // per-session message cap reached
  | "budget_exhausted" // tenant daily/monthly spend or request cap reached
  | "unavailable" // assistant disabled / not configured / provider down
  | "upstream" // provider error
  | "timeout" // provider took too long
  | "refused"; // the model declined to answer (safety)

/** Events of the text/event-stream returned by POST /api/assistant/chat (one JSON per `data:`). */
export type ChatStreamEvent =
  | { type: "start" }
  | { type: "delta"; text: string }
  | { type: "action"; action: QuoteFormAction }
  | {
      type: "done";
      /** "end" normal, "max_tokens" truncated answer, "action" ended on the form. */
      stop: "end" | "max_tokens" | "action";
      /** User messages still allowed in this session. */
      remaining: number;
    }
  | { type: "error"; code: ChatErrorCode; retryAfter?: number };

/** JSON body of every non-2xx response of the assistant endpoints. */
export interface ApiErrorBody {
  ok: false;
  error: ChatErrorCode | LeadErrorCode;
  retryAfter?: number;
  fields?: Partial<Record<LeadField, LeadFieldError>>;
}

// ---------------------------------------------------------------------------------------------
// Leads (quote requests)
// ---------------------------------------------------------------------------------------------

export const LEAD_FIELDS = [
  "name",
  "company",
  "email",
  "phone",
  "service",
  "description",
  "budget",
  "consent",
] as const;
export type LeadField = (typeof LEAD_FIELDS)[number];

export interface LeadInput {
  name: string;
  company?: string;
  email: string;
  phone?: string;
  service?: string;
  description: string;
  budget?: string;
  consent: boolean;
}

export type LeadFieldError =
  | "required"
  | "too_short"
  | "too_long"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_option"
  | "consent_required";

export type LeadErrorCode =
  | "invalid" // field validation failed (see `fields`)
  | "bad_request"
  | "forbidden"
  | "rate_limited"
  | "unavailable" // leads disabled or no delivery channel configured
  | "delivery_failed"; // every delivery channel failed

export interface LeadRequestBody {
  tenant: string;
  sessionId: string;
  locale: AssistantLocale;
  page?: string;
  lead: LeadInput;
  /** Honeypot: must be empty. */
  hp?: string;
  /** Milliseconds between the form being shown and submitted (bots submit instantly). */
  elapsedMs?: number;
}

export type LeadResponseBody = { ok: true; id: string } | ApiErrorBody;
