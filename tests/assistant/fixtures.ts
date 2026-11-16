// Shared fixtures for the assistant tests: a complete fake tenant, limits, environment isolation
// and an inspectable key-value store. Built only from the public contract (lib/assistant/types.ts
// and the documented module signatures), never from the implementations under test.
import { DEFAULT_LIMITS } from "@/lib/assistant/types";
import type { AssistantLimits, KnowledgeBase, TenantConfig } from "@/lib/assistant/types";
import type { KVStore } from "@/lib/assistant/server/store";

let tenantSeq = 0;

/**
 * A realistic tenant that is not Modolo. Each call gets a unique id and knowledge version, so
 * prompt blocks memoized per tenant id never leak from one test into another.
 */
export function makeTenant(overrides: Partial<TenantConfig> = {}): TenantConfig {
  tenantSeq += 1;
  const knowledge: KnowledgeBase = {
    version: `fixture-kb-${tenantSeq}`,
    sections: [
      {
        id: "pricing",
        title: { en: "Prices", de: "Preise", it: "Prezzi" },
        content: { en: "Website from 1000 (default).", de: "Website ab 1000 (Standard).", it: "Sito da 1000 (predefinito)." },
        byRegion: {
          ch: { en: "Website: CHF 1200.", de: "Website: CHF 1200.", it: "Sito: CHF 1200." },
          it: { en: "Website: EUR 900.", de: "Website: EUR 900.", it: "Sito: EUR 900." },
        },
        source: "fixture-maintainer-note",
      },
      {
        id: "services",
        title: { en: "Services", de: "Leistungen", it: "Servizi" },
        content: { en: "Websites and online booking.", de: "Websites und Online-Buchung.", it: "Siti e prenotazioni online." },
      },
    ],
  };
  return {
    id: `fixture-${tenantSeq}`,
    defaultLocale: "en",
    locales: ["en", "de", "it"],
    branding: {
      name: "Fixture Studio",
      assistantName: { en: "Fixture assistant", de: "Fixture-Assistent", it: "Assistente Fixture" },
      logoUrl: "/fixture-logo.png",
      theme: "light",
    },
    welcome: { en: "Hello! How can I help?", de: "Hallo! Wie kann ich helfen?", it: "Ciao! Come posso aiutarti?" },
    starters: { en: ["What does a website cost?"], de: ["Was kostet eine Website?"], it: ["Quanto costa un sito?"] },
    contact: {
      email: "hello@fixture.example",
      whatsapp: { number: "+41790000000", display: "+41 79 000 00 00" },
      contactUrl: { en: "/en#contact", de: "/de#contact", it: "/it#contact" },
    },
    contactByRegion: { it: { whatsapp: { number: "+390000000000", display: "+39 000 000 0000" } } },
    privacyUrl: { en: "/en/privacy", de: "/de/privacy", it: "/it/privacy" },
    hiddenOnPathSegments: ["card"],
    regions: {
      ids: ["ch", "it"],
      default: "ch",
      cookie: "fixture_region",
      byCountry: { IT: "it", CH: "ch" },
      labels: {
        ch: { en: "Switzerland (prices in CHF)", de: "Switzerland (prices in CHF)", it: "Switzerland (prices in CHF)" },
        it: { en: "Italy (prices in EUR)", de: "Italy (prices in EUR)", it: "Italy (prices in EUR)" },
      },
    },
    leads: {
      enabled: true,
      services: [
        { id: "website", label: { en: "Website", de: "Website", it: "Sito web" } },
        { id: "booking", label: { en: "Online booking", de: "Online-Buchung", it: "Prenotazioni online" } },
        { id: "other", label: { en: "Something else", de: "Etwas anderes", it: "Altro" } },
      ],
      budgetOptions: {
        default: [{ id: "small", label: { en: "Up to 1000", de: "Bis 1000", it: "Fino a 1000" } }],
        ch: [
          { id: "chf-1500", label: { en: "Up to CHF 1500", de: "Bis CHF 1500", it: "Fino a CHF 1500" } },
          { id: "chf-more", label: { en: "More than CHF 1500", de: "Mehr als CHF 1500", it: "Oltre CHF 1500" } },
        ],
      },
      requireCompany: false,
      requirePhone: false,
      notifyEmail: "leads-inbox@fixture.example",
      retentionDays: 365,
    },
    ai: { rules: ["Fixture rule: never promise phone calls."] },
    allowedOrigins: ["https://www.fixture.example"],
    knowledge: () => knowledge,
    ...overrides,
  };
}

export function makeLimits(overrides: Partial<AssistantLimits> = {}): AssistantLimits {
  return { ...DEFAULT_LIMITS, ...overrides };
}

/** Every environment variable the assistant reads (contract §6), plus the SDK base URL. */
export const ASSISTANT_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_BASE_URL",
  "ASSISTANT_ENABLED",
  "ASSISTANT_MODEL",
  "ASSISTANT_MODEL_ADVANCED",
  "ASSISTANT_MODEL_ROUTING",
  "ASSISTANT_EFFORT",
  "ASSISTANT_MAX_OUTPUT_TOKENS",
  "ASSISTANT_TIMEOUT_MS",
  "ASSISTANT_DAILY_BUDGET_USD",
  "ASSISTANT_MONTHLY_BUDGET_USD",
  "ASSISTANT_DAILY_REQUEST_LIMIT",
  "ASSISTANT_SESSION_MESSAGE_LIMIT",
  "ASSISTANT_HASH_SALT",
  "ASSISTANT_ADMIN_TOKEN",
  "ASSISTANT_LEAD_RETENTION_DAYS",
  "ASSISTANT_LEAD_TO",
  "ASSISTANT_LEAD_COPY",
  "RESEND_API_KEY",
  "CONTACT_FROM",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
] as const;

export type AssistantEnvKey = (typeof ASSISTANT_ENV_KEYS)[number];

// Next types NODE_ENV as read-only; tests need to flip it, so they write through a plain view.
const mutableEnv: Record<string, string | undefined> = process.env;

/**
 * Make the assistant's environment exactly `vars` (every other assistant variable unset), so the
 * developer's own shell can never leak into a test. Returns a function that restores the previous state.
 */
export function setAssistantEnv(vars: Partial<Record<AssistantEnvKey, string>> = {}): () => void {
  const saved = new Map<string, string | undefined>();
  for (const key of ASSISTANT_ENV_KEYS) {
    saved.set(key, mutableEnv[key]);
    delete mutableEnv[key];
  }
  for (const [key, value] of Object.entries(vars)) mutableEnv[key] = value;
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete mutableEnv[key];
      else mutableEnv[key] = value;
    }
  };
}

/** Set NODE_ENV for the duration of `fn`, then restore it (even when `fn` throws). */
export function withNodeEnv<T>(value: "production" | "development" | "test", fn: () => T): T {
  const previous = mutableEnv.NODE_ENV;
  mutableEnv.NODE_ENV = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous;
  }
}

export interface StoreCall {
  op: "incrBy" | "get" | "set";
  key: string;
  by?: number;
  value?: string;
  ttlSeconds?: number;
}

/**
 * A KVStore with Redis-like semantics (incrBy creates the key) that records every call, so tests
 * can check the exact keys and TTLs a module uses. TTLs are recorded, not enforced: tests move
 * time by injecting `now`, and every windowed key carries its own bucket id.
 */
export function createFakeStore(kind: "memory" | "upstash" = "memory", options: { setResult?: boolean } = {}) {
  const data = new Map<string, string>();
  const calls: StoreCall[] = [];
  const store: KVStore = {
    kind,
    async incrBy(key, by, ttlSeconds) {
      calls.push({ op: "incrBy", key, by, ttlSeconds });
      const next = Number(data.get(key) ?? "0") + by;
      data.set(key, String(next));
      return next;
    },
    async get(key) {
      calls.push({ op: "get", key });
      return data.get(key) ?? null;
    },
    async set(key, value, ttlSeconds) {
      calls.push({ op: "set", key, value, ttlSeconds });
      if (options.setResult === false) return false;
      data.set(key, value);
      return true;
    },
  };
  return { store, data, calls };
}

/** Text of an Anthropic message content (string, or the text of its text blocks). */
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block): block is { type: "text"; text: string } => {
      return typeof block === "object" && block !== null && block.type === "text" && typeof block.text === "string";
    })
    .map((block) => block.text)
    .join("\n\n");
}

/** Deterministic PRNG (mulberry32) so "random" chunking is reproducible across runs. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Collect every value of an async iterable (rejects with the iterable's error). */
export async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}
