// Lead delivery (lib/assistant/server/leads.ts): the notification email (HTML-escaped, labelled)
// and deliverLead() with fetch stubbed, so nothing ever reaches Resend.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssistantEnv } from "@/lib/assistant/server/env";
import { deliverLead, leadNotificationEmail } from "@/lib/assistant/server/leads";
import type { LeadRecord } from "@/lib/assistant/server/leads";
import { createFakeStore, makeTenant } from "./fixtures";

const tenant = makeTenant(); // default locale "en"; services website/booking/other; ch budgets chf-1500/chf-more
const RESEND_URL = "https://api.resend.com/emails";

function makeEnv(patch: Partial<AssistantEnv> = {}): AssistantEnv {
  return {
    enabled: true,
    disabledReason: null,
    apiKey: "sk-ant-test",
    model: "claude-haiku-5-5",
    advancedModel: null,
    routing: null,
    effort: null,
    maxOutputTokens: null,
    timeoutMs: 30_000,
    hashSalt: "test-salt",
    adminToken: null,
    limits: {},
    leadRetentionDays: null,
    leadTo: null,
    leadCopy: false,
    resend: { apiKey: "re_test_key", from: "Fixture Studio <noreply@fixture.example>" },
    store: { kind: "memory" },
    ...patch,
  };
}

function makeRecord(patch: Partial<LeadRecord> = {}): LeadRecord {
  return {
    id: "lead_0123456789abcdef",
    tenant: tenant.id,
    locale: "it",
    region: "ch",
    page: "/it/servizi",
    createdAt: "2026-11-15T10:30:00.000Z",
    name: "Anna Muster",
    company: "Salone Anna",
    email: "anna@example.ch",
    phone: "+41 79 123 45 67",
    service: "booking",
    budget: "chf-1500",
    description: "Vorrei un sito con le prenotazioni online per il mio salone.",
    consent: true,
    ...patch,
  };
}

interface SentRequest {
  url: string;
  method: string;
  authorization: string | null;
  body: Record<string, unknown>;
  hasSignal: boolean;
}

async function readCall(args: unknown[]): Promise<SentRequest> {
  const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];
  const request = new Request(input, init);
  return {
    url: request.url,
    method: request.method,
    authorization: request.headers.get("authorization"),
    body: JSON.parse(await request.text()) as Record<string, unknown>,
    hasSignal: init?.signal instanceof AbortSignal,
  };
}

/** Resend accepts a string or a list for recipient fields. */
const addresses = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : value === undefined ? [] : [String(value)]);

describe("leadNotificationEmail", () => {
  it("HTML-escapes every value that came from the visitor", () => {
    const record = makeRecord({
      name: '<script>alert("name")</script>',
      company: 'ACME" onmouseover="alert(1)',
      phone: "<b>+41</b> 79 123 45 67",
      description: "<img src=x onerror=alert(1)>\nSecond line & more",
      page: '/it/"><svg onload=alert(1)>',
    });
    const { subject, text, html } = leadNotificationEmail(record, tenant);
    assert.ok(subject.trim().length > 0 && text.trim().length > 0 && html.trim().length > 0);
    for (const raw of ["<script", "<img", "<svg", "<b>+41</b>", '" onmouseover="']) {
      assert.ok(!html.includes(raw), `unescaped ${raw} in the HTML`);
    }
    assert.ok(html.includes("&lt;script&gt;"), "escaped name");
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"), "escaped description");
    assert.ok(html.includes("Second line &amp; more"), "ampersands escaped");
  });

  it("shows service and budget with their labels in the tenant's default locale", () => {
    const { text, html } = leadNotificationEmail(makeRecord(), tenant);
    for (const body of [text, html]) {
      assert.ok(body.includes("Online booking"), "service label (en)");
      assert.ok(body.includes("Up to CHF 1500"), "regional budget label (en)");
    }
    const german = makeTenant({ defaultLocale: "de" });
    const de = leadNotificationEmail(makeRecord({ tenant: german.id }), german);
    assert.ok(de.text.includes("Online-Buchung") && de.text.includes("Bis CHF 1500"), de.text);
  });

  it("includes the contact details, the request, its id and the page it came from", () => {
    const record = makeRecord();
    const { text, html } = leadNotificationEmail(record, tenant);
    for (const value of [record.name, record.email, record.id, "/it/servizi", "Salone Anna", "+41 79 123 45 67"]) {
      assert.ok(text.includes(value), `text is missing ${value}`);
    }
    // The HTML may legitimately entity-encode characters such as "/" or "+", so only plain values are checked there.
    for (const value of [record.name, record.email, record.id, "Salone Anna", "prenotazioni online per il mio salone"]) {
      assert.ok(html.includes(value), `html is missing ${value}`);
    }
  });

  it("records the checkbox as an acknowledged privacy notice, not as consent, in each language", () => {
    const cases = [
      { locale: "en", row: "Privacy notice acknowledged: Yes", label: "Privacy notice acknowledged" },
      { locale: "de", row: "Datenschutzerklärung zur Kenntnis genommen: Ja", label: "Datenschutzerklärung zur Kenntnis genommen" },
      { locale: "it", row: "Informativa privacy letta: Sì", label: "Informativa privacy letta" },
    ] as const;
    for (const { locale, row, label } of cases) {
      const localized = makeTenant({ defaultLocale: locale });
      const { text, html } = leadNotificationEmail(makeRecord({ tenant: localized.id }), localized);
      assert.ok(text.split("\n").includes(row), `${locale}: missing "${row}" in\n${text}`);
      assert.ok(html.includes(label), `${locale}: label missing from the HTML`);
      assert.doesNotMatch(text, /consent|Einwilligung|Consenso/i, `${locale}: no consent wording is left`);
    }
  });
});

describe("deliverLead", () => {
  it("emails the business through Resend and reports delivered: email", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ id: "re_mock_1" }));
    const record = makeRecord();
    const { store } = createFakeStore("memory");
    const result = await deliverLead({ record, tenant, env: makeEnv(), store });
    assert.deepEqual(result, { delivered: ["email"], failed: [] });
    assert.equal(fetchMock.mock.callCount(), 1, "exactly one email: no auto-reply to the visitor");
    const sent = await readCall(fetchMock.mock.calls[0].arguments);
    assert.equal(sent.url, RESEND_URL);
    assert.equal(sent.method, "POST");
    assert.equal(sent.authorization, "Bearer re_test_key");
    assert.ok(sent.hasSignal, "the Resend call needs a timeout signal (contract: 10 s)");
    assert.equal(sent.body.from, "Fixture Studio <noreply@fixture.example>");
    assert.deepEqual(addresses(sent.body.to), [tenant.leads.notifyEmail]);
    assert.deepEqual(addresses(sent.body.reply_to), [record.email]);
    assert.ok(typeof sent.body.subject === "string" && sent.body.subject.length > 0);
    for (const field of ["to", "cc", "bcc"]) {
      assert.ok(!addresses(sent.body[field]).includes(record.email), `the visitor must never be a recipient (${field})`);
    }
  });

  it("sends to ASSISTANT_LEAD_TO instead of the tenant inbox when set", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({ id: "re_mock_2" }));
    const { store } = createFakeStore("memory");
    await deliverLead({ record: makeRecord(), tenant, env: makeEnv({ leadTo: "override@fixture.example" }), store });
    const sent = await readCall(fetchMock.mock.calls[0].arguments);
    assert.deepEqual(addresses(sent.body.to), ["override@fixture.example"]);
  });

  it("reports failed: email when Resend answers with an error status", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ name: "internal_server_error" }, { status: 500 }));
    const { store } = createFakeStore("memory");
    const result = await deliverLead({ record: makeRecord(), tenant, env: makeEnv(), store });
    assert.deepEqual(result, { delivered: [], failed: ["email"] });
  });

  it("reports failed: email on network errors instead of throwing", async (t) => {
    t.mock.method(globalThis, "fetch", async () => {
      throw new TypeError("fetch failed");
    });
    const { store } = createFakeStore("memory");
    const result = await deliverLead({ record: makeRecord(), tenant, env: makeEnv(), store });
    assert.deepEqual(result, { delivered: [], failed: ["email"] });
  });

  it("never stores the lead in a memory store (no PII in process memory)", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ id: "re_mock_3" }));
    const { store, calls } = createFakeStore("memory");
    const result = await deliverLead({ record: makeRecord(), tenant, env: makeEnv(), store });
    assert.deepEqual(result, { delivered: ["email"], failed: [] });
    assert.deepEqual(calls.filter((call) => call.op === "set"), []);
    assert.ok(!calls.some((call) => call.key.includes("lead")), JSON.stringify(calls));
  });

  it("keeps no copy in Upstash without ASSISTANT_LEAD_COPY (privacy by default)", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ id: "re_mock_7" }));
    const { store, calls } = createFakeStore("upstash");
    const result = await deliverLead({ record: makeRecord(), tenant, env: makeEnv(), store });
    assert.deepEqual(result, { delivered: ["email"], failed: [] });
    assert.deepEqual(calls, [], "Upstash connected for the counters alone must not receive the lead");
  });

  it("delivers nothing (and stores nothing) without Resend and without the opt-in", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({}));
    const { store, calls } = createFakeStore("upstash");
    const result = await deliverLead({ record: makeRecord(), tenant, env: makeEnv({ resend: null }), store });
    assert.deepEqual(result, { delivered: [], failed: [] });
    assert.equal(fetchMock.mock.callCount(), 0);
    assert.deepEqual(calls, []);
  });

  it("stores a JSON copy in an Upstash store for the tenant's retention period", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ id: "re_mock_4" }));
    const record = makeRecord();
    const { store, calls } = createFakeStore("upstash");
    const result = await deliverLead({ record, tenant, env: makeEnv({ leadCopy: true }), store });
    assert.deepEqual([...result.delivered].sort(), ["email", "store"]);
    assert.deepEqual(result.failed, []);
    const sets = calls.filter((call) => call.op === "set");
    assert.equal(sets.length, 1);
    assert.equal(sets[0].key, `mda:lead:${tenant.id}:${record.id}`);
    assert.equal(sets[0].ttlSeconds, 365 * 86_400);
    const stored = JSON.parse(String(sets[0].value)) as Record<string, unknown>;
    assert.equal(stored.id, record.id);
    assert.equal(stored.email, record.email);
    assert.equal(stored.name, record.name);
  });

  it("uses ASSISTANT_LEAD_RETENTION_DAYS over the tenant's retention", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ id: "re_mock_5" }));
    const { store, calls } = createFakeStore("upstash");
    await deliverLead({ record: makeRecord(), tenant, env: makeEnv({ leadRetentionDays: 30, leadCopy: true }), store });
    assert.equal(calls.find((call) => call.op === "set")?.ttlSeconds, 30 * 86_400);
  });

  it("delivers to the store alone when Resend is not configured", async (t) => {
    const fetchMock = t.mock.method(globalThis, "fetch", async () => Response.json({}));
    const { store } = createFakeStore("upstash");
    const result = await deliverLead({ record: makeRecord(), tenant, env: makeEnv({ resend: null, leadCopy: true }), store });
    assert.deepEqual(result, { delivered: ["store"], failed: [] });
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it("reports failed: store when the Upstash write fails", async (t) => {
    t.mock.method(globalThis, "fetch", async () => Response.json({ id: "re_mock_6" }));
    const { store } = createFakeStore("upstash", { setResult: false });
    const result = await deliverLead({ record: makeRecord(), tenant, env: makeEnv({ leadCopy: true }), store });
    assert.deepEqual(result, { delivered: ["email"], failed: ["store"] });
  });
});
