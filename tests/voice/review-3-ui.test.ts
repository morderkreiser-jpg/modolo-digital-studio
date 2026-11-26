// Regression tests of the third review round on the widget and the sales page:
//   N3  the stage speaks the page's language, whatever language the example is in
//   N4  a business chosen through the hash stays chosen across a later in-page link
//   N7  the sales page scrolls natively (no Lenis, no GSAP)
//   N2  a written example ends with what the business receives, in the real e-mail format
// The React parts are checked in a browser; here the rules they use.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { rememberHashChoice, selectDemoId, type PickedDemo } from "@/components/voice/landing/demo-choice";
import { stageTitle } from "@/components/voice/stage-text";
import { schedule } from "@/components/voice/transports/scripted";
import { initVoiceState, voiceReducer, type VoiceMachineState } from "@/components/voice/voice-machine";
import { VOICE_LANDING } from "@/content/voice/landing";
import { LOCALES, localizedHref, SLUG_TRANSLATIONS, type Locale } from "@/lib/i18n";
import { afterCallView, scriptCaptionId, scriptIdOfCaption, type DemoAfterCall } from "@/lib/voice/after-call";
import { DEMO_SCRIPTS, DEMO_TENANTS } from "@/lib/voice/demos";
import { formatVoiceString, getVoiceStrings } from "@/lib/voice/i18n";
import { examplesForPage, VOICE_LANDING_PATH } from "@/lib/voice/landing";
import { demoAfterCall } from "@/lib/voice/server/demo-mails";
import { voiceStageSetup } from "@/lib/voice/server/mount-config";
import { renderSummaryEmail, spacedPhone } from "@/lib/voice/server/summary";
import { getVoiceTenant } from "@/lib/voice/tenants";
import { DEFAULT_VOICE_LIMITS, type CallSummary, type DemoScript, type VoiceTenantConfig } from "@/lib/voice/types";

const OFF = { enabled: false, mode: "scripted" as const, lab: false, limits: DEFAULT_VOICE_LIMITS };

function tenantOf(script: DemoScript): VoiceTenantConfig {
  const tenant = getVoiceTenant(script.tenantId);
  assert.ok(tenant, script.id);
  return tenant;
}

function script(id: string): DemoScript {
  const found = DEMO_SCRIPTS.find((candidate) => candidate.id === id);
  assert.ok(found, id);
  return found;
}

/** The stage's state at the end of `played` lines of an example (all of them when omitted). */
function playThrough(example: DemoScript, stopAfterCaptions?: number): VoiceMachineState {
  let state = voiceReducer(initVoiceState({ locale: example.locale }), { type: "START", mode: "scripted" });
  let captions = 0;
  for (const step of schedule(example).steps) {
    if (stopAfterCaptions !== undefined && step.event.type === "CAPTION" && captions === stopAfterCaptions) {
      return voiceReducer(state, { type: "END", reason: "user" });
    }
    state = voiceReducer(state, step.event);
    if (step.event.type === "CAPTION") captions += 1;
  }
  return state;
}

// ---------------------------------------------------------------------------------------------
// N3: the page's language for every control
// ---------------------------------------------------------------------------------------------

describe("review N3: the stage speaks the page's language", () => {
  const germanOnly = DEMO_TENANTS.filter((tenant) => tenant.locales.length === 1 && tenant.locales[0] === "de");

  it("nine demo businesses have German examples only (the case of the finding)", () => {
    assert.deepEqual(
      germanOnly.map((tenant) => tenant.id.replace("demo-", "")).sort(),
      ["carrosserie", "coiffeur", "elektro", "hotel", "immobilien", "kosmetik", "maler", "reinigung", "tattoo"],
    );
  });

  for (const locale of LOCALES) {
    it(`${locale}: every stage of the sales page gets the page's language for its controls`, () => {
      for (const tenant of DEMO_TENANTS) {
        const examples = examplesForPage(DEMO_SCRIPTS, tenant.id, locale);
        const setup = voiceStageSetup({ env: OFF, locale, tenantId: tenant.id, scripts: examples.scripts });
        assert.ok(setup, tenant.id);
        assert.equal(setup.uiLocale, locale, `${tenant.id} on ${locale}`);
        // The conversation keeps the example's language: the captions say it in their lang.
        if (examples.otherLanguage) assert.equal(setup.config.locale, "de", tenant.id);
      }
    });
  }

  it("on the Italian and English pages a German-only stage reads in Italian and English", () => {
    const hotel = getVoiceTenant("demo-hotel");
    assert.ok(hotel);
    for (const [locale, start, fictional] of [
      ["it", "Avvia l'esempio", "Hotel Beispielhof è un'attività inventata."],
      ["en", "Play the example", "Hotel Beispielhof is a made-up business."],
    ] as const) {
      const setup = voiceStageSetup({ env: OFF, locale, tenantId: hotel.id, scripts: examplesForPage(DEMO_SCRIPTS, hotel.id, locale).scripts });
      assert.ok(setup);
      const strings = getVoiceStrings(setup.uiLocale);
      assert.equal(strings.startScripted, start);
      assert.ok(formatVoiceString(strings.fictional, { business: setup.config.businessName }).startsWith(fictional));
      assert.notEqual(strings.transcriptShow, getVoiceStrings("de").transcriptShow);
      assert.notEqual(strings.ended.complete, getVoiceStrings("de").ended.complete);
    }
  });

  it("titles the stage in the page's language, never in the example's", () => {
    const hotel = voiceStageSetup({ env: OFF, locale: "it", tenantId: "demo-hotel", scripts: examplesForPage(DEMO_SCRIPTS, "demo-hotel", "it").scripts });
    assert.ok(hotel);
    assert.equal(stageTitle(hotel.config, "it"), "L'assistente AI di Hotel Beispielhof");
    assert.equal(stageTitle(hotel.config, "en"), "The AI assistant of Hotel Beispielhof");
    assert.equal(stageTitle(hotel.config, "de"), "Der digitale Assistent des Hotels Beispielhof");
    // A business with its own name for the assistant in the page's language keeps it.
    const plumber = voiceStageSetup({ env: OFF, locale: "it", tenantId: "demo-sanitaer", scripts: examplesForPage(DEMO_SCRIPTS, "demo-sanitaer", "it").scripts });
    assert.ok(plumber);
    assert.equal(stageTitle(plumber.config, "it"), "L'assistente digitale di Beispiel Sanitär & Heizung");
  });
});

// ---------------------------------------------------------------------------------------------
// N4: a business chosen through the hash stays chosen
// ---------------------------------------------------------------------------------------------

describe("review N4: the chooser keeps a business chosen through the hash", () => {
  const ids = ["demo-umzug", "demo-sanitaer", "demo-hotel", "demo-coiffeur"];
  const DEFAULT = "demo-sanitaer";

  /** The chooser's render loop: each hash change goes through rememberHashChoice, as demo-chooser.tsx does. */
  function chooser() {
    let seen = "";
    let picked: PickedDemo | null = null;
    return {
      hash(hash: string): string {
        picked = rememberHashChoice(ids, seen, hash, picked);
        seen = hash;
        return selectDemoId(ids, hash, picked, DEFAULT);
      },
      radio(id: string, hashAfter: string): string {
        picked = { id, hash: hashAfter };
        return this.hash(hashAfter);
      },
    };
  }

  it("a sector link, then the nav's #contact, the hero's #pilot and the stage's contact link: still the hotel", () => {
    const page = chooser();
    assert.equal(page.hash(""), DEFAULT);
    assert.equal(page.hash("demo-hotel"), "demo-hotel");
    assert.equal(page.hash("contact"), "demo-hotel");
    assert.equal(page.hash("pilot"), "demo-hotel");
    assert.equal(page.hash("contact"), "demo-hotel");
    assert.equal(page.hash("faq"), "demo-hotel");
  });

  it("a shared link that names a business, read after hydration, is a choice as well", () => {
    const page = chooser();
    assert.equal(page.hash(""), DEFAULT, "the server and the hydration render see no hash");
    assert.equal(page.hash("demo-coiffeur"), "demo-coiffeur");
    assert.equal(page.hash("demo"), "demo-coiffeur", "the hero's #demo link");
  });

  it("a later trade link, or a radio, still wins", () => {
    const page = chooser();
    page.hash("demo-hotel");
    assert.equal(page.radio("demo-coiffeur", "demo-coiffeur"), "demo-coiffeur");
    assert.equal(page.hash("contact"), "demo-coiffeur");
    assert.equal(page.hash("demo-umzug"), "demo-umzug");
    assert.equal(page.hash("pilot"), "demo-umzug");
    // Back to a hash seen before is a change too (back/forward).
    assert.equal(page.hash("demo-hotel"), "demo-hotel");
  });

  it("a radio whose hash could not be written keeps its choice over the old, unchanged hash", () => {
    const page = chooser();
    page.hash("demo-hotel");
    assert.equal(page.radio("demo-coiffeur", "demo-hotel"), "demo-coiffeur");
    assert.equal(page.hash("demo-hotel"), "demo-coiffeur");
  });

  it("only remembers businesses that are offered, and leaves the choice alone on an unchanged hash", () => {
    const kept: PickedDemo = { id: "demo-umzug", hash: "demo-umzug" };
    assert.equal(rememberHashChoice(ids, "contact", "demo-gone", kept), kept);
    assert.equal(rememberHashChoice(ids, "demo-hotel", "demo-hotel", kept), kept);
    assert.deepEqual(rememberHashChoice(ids, "contact", "demo-hotel", kept), { id: "demo-hotel", hash: "demo-hotel" });
  });
});

// ---------------------------------------------------------------------------------------------
// N7: native scrolling on the sales page
// ---------------------------------------------------------------------------------------------

describe("review N7: the sales page scrolls natively", () => {
  const source = readFileSync(path.join(process.cwd(), "components", "smooth-scroll.tsx"), "utf8");
  const literal = /const NATIVE_SCROLL = \/(.+)\/;/.exec(source);
  assert.ok(literal, "NATIVE_SCROLL is a regular expression literal");
  const nativeScroll = new RegExp(literal[1]);

  it("matches every public and canonical URL of the page, in every language", () => {
    const slugs = Object.values(SLUG_TRANSLATIONS["assistente-telefonico-ai"]);
    assert.equal(slugs.length, 3);
    for (const locale of LOCALES) {
      assert.match(localizedHref(locale, VOICE_LANDING_PATH), nativeScroll, locale);
      for (const slug of slugs) {
        assert.match(`/${locale}/${slug}`, nativeScroll, `/${locale}/${slug}`);
        assert.match(`/${slug}/`, nativeScroll, `/${slug}/`);
      }
    }
  });

  it("still matches the business card, and leaves the other inner pages to Lenis", () => {
    for (const pathname of ["/card", "/de/visitenkarte", "/it/biglietto"]) assert.match(pathname, nativeScroll);
    for (const locale of LOCALES) {
      for (const page of ["/prezzi", "/servizi", "/privacy", "/offerta"]) {
        assert.doesNotMatch(localizedHref(locale, page), nativeScroll, `${locale} ${page}`);
      }
    }
    assert.doesNotMatch("/de/ki-telefonassistent-alt", nativeScroll);
  });
});

// ---------------------------------------------------------------------------------------------
// N2: what the business receives after an example
// ---------------------------------------------------------------------------------------------

describe("review N2: an example ends with what the business receives", () => {
  const all = new Map<string, DemoAfterCall>(DEMO_SCRIPTS.map((example) => [example.id, demoAfterCall(example, tenantOf(example))]));

  it("ties each step to a caption the player shows", () => {
    for (const example of DEMO_SCRIPTS) {
      const captionIds = new Set(
        schedule(example).steps.flatMap((step) => (step.event.type === "CAPTION" ? [step.event.caption.id] : [])),
      );
      for (const step of all.get(example.id)?.steps ?? []) assert.ok(captionIds.has(step.captionId), `${example.id}: ${step.captionId}`);
      for (const id of captionIds) assert.equal(scriptIdOfCaption(id), example.id);
    }
    assert.equal(scriptIdOfCaption(scriptCaptionId("demo-x.de.slug", 12)), "demo-x.de.slug");
    assert.equal(scriptIdOfCaption("local-caption-3"), null);
  });

  it("writes one e-mail per request or callback, and one summary of the rest, like the real assistant", () => {
    for (const example of DEMO_SCRIPTS) {
      const afterCall = all.get(example.id);
      assert.ok(afterCall, example.id);
      const steps = example.lines.flatMap((line) => (line.tool && line.role === "assistant" ? [line.tool] : []));
      const requests = steps.filter((step) => (step.name === "create_lead" || step.name === "request_callback") && step.outcome === "ok").length;
      const rest = steps.filter(
        (step) =>
          (["book_appointment", "reschedule_appointment", "cancel_appointment"].includes(step.name) && step.outcome === "ok") ||
          step.name === "transfer_call",
      ).length;
      const last = afterCall.steps.at(-1);
      assert.equal(last?.mails.length ?? 0, requests + (rest > 0 ? 1 : 0), example.id);
      assert.equal(afterCall.locale, tenantOf(example).defaultLocale, `${example.id}: in the business's language`);
      for (const mail of afterCall.mails) assert.ok(mail.subject.length > 0 && mail.text.length > 0, example.id);
    }
  });

  it("is the real formatter's e-mail, without the start, the length and the session the script cannot know", () => {
    const example = script("demo-sanitaer.de.rohrbruch-in-der-nacht");
    const tenant = tenantOf(example);
    const afterCall = all.get(example.id);
    assert.ok(afterCall);
    assert.equal(afterCall.mails.length, 1);
    const [mail] = afterCall.mails;
    const ref = /LD-[2-9A-HJ-NP-Z]{4}/.exec(mail.subject)?.[0];
    assert.ok(ref, mail.subject);

    const step = example.lines.find((line) => line.tool?.name === "create_lead")?.tool;
    assert.ok(step);
    const input = step.input as { task: string; fields: Record<string, string>; name: string; phone: string };
    const summary: CallSummary = {
      tenant: tenant.id,
      sessionId: "golden-session",
      channel: "phone",
      startedAt: "2026-02-03T09:15:00.000Z",
      durationSeconds: 0,
      locale: "de",
      outcomes: [{ kind: "lead", taskId: input.task, ref, fields: input.fields, contact: { name: input.name, phone: input.phone } }],
      noOutcome: false,
    };
    const real = renderSummaryEmail(summary, tenant, { request: true });
    assert.equal(mail.subject, real.subject);
    const expected = real.text
      .split("\n")
      .filter((line) => !line.includes("golden-session") && !line.includes("03.02.2026"))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    assert.equal(mail.text, expected);
    assert.equal(real.text.trimEnd().split("\n").length - mail.text.split("\n").length, 2, "exactly the start and the session are left out");
  });

  it("invents nothing: no time, length or session, and every detail comes from the script's tool input", () => {
    for (const example of DEMO_SCRIPTS) {
      const afterCall = all.get(example.id);
      const text = afterCall?.mails.map((mail) => `${mail.subject}\n${mail.text}`).join("\n") ?? "";
      assert.doesNotMatch(text, /example-[ab]|05\.01\.2026|21\.08\.2027|2026-01-05|2027-08-21/, example.id);
      for (const line of example.lines) {
        const tool = line.tool;
        if (!tool || tool.outcome !== "ok" || !["create_lead", "request_callback", "book_appointment"].includes(tool.name)) continue;
        for (const key of ["name", "phone", "contact", "topic"]) {
          const value = tool.input[key];
          // A phone number is printed with spaces (summary.ts spacedPhone, browser check R3-B3).
          if (typeof value === "string") assert.ok(text.includes(spacedPhone(value)), `${example.id}: ${key} "${value}"`);
        }
      }
    }
  });

  it("names the booking reference the assistant reads out", () => {
    const booked = all.get("demo-restaurant.de.samstag-ausgebucht");
    assert.match(booked?.mails[0]?.subject ?? "", /MV-5T9B/);
    const moved = all.get("demo-coiffeur.de.termin-verschieben");
    assert.match(moved?.mails[0]?.text ?? "", /MV-3F8L/);
    assert.match(moved?.mails[0]?.text ?? "", /11\.12\.2026 16:30/);
  });

  it("shows the e-mails the business has when the example stops, and says so when there are none", () => {
    const hotel = script("demo-hotel.de.spaete-ankunft");
    const afterCall = all.get(hotel.id);
    const view = (state: VoiceMachineState) =>
      afterCallView(afterCall, state.captions.map((caption) => caption.id), state.endReason === "complete");

    const whole = view(playThrough(hotel));
    assert.equal(whole?.kind, "mails");
    assert.equal(whole?.kind === "mails" ? whole.mails.length : 0, 3, "the arrival, the callback and the summary with the transfer");
    assert.equal(whole?.kind === "mails" ? whole.locale : null, "de");

    assert.equal(view(playThrough(hotel, 3)), null, "stopped before the first request: nothing reached the business");
    const halfway = view(playThrough(hotel, 7));
    assert.equal(halfway?.kind === "mails" ? halfway.mails.length : 0, 1, "stopped after the arrival notice");

    const tattoo = script("demo-tattoo.de.erst-mit-18");
    assert.deepEqual(all.get(tattoo.id)?.steps, []);
    assert.deepEqual(afterCallView(all.get(tattoo.id), playThrough(tattoo).captions.map((c) => c.id), true), { kind: "none" });
    assert.equal(afterCallView(all.get(tattoo.id), [], false), null, "stopped early: no claim either way");
    assert.equal(afterCallView(undefined, [], true), null, "no data: nothing shown");
  });

  it("travels with every stage that plays examples, keyed by script", () => {
    for (const locale of LOCALES) {
      for (const tenant of DEMO_TENANTS) {
        const scripts = examplesForPage(DEMO_SCRIPTS, tenant.id, locale).scripts;
        const setup = voiceStageSetup({ env: OFF, locale, tenantId: tenant.id, scripts });
        assert.ok(setup);
        assert.deepEqual(Object.keys(setup.afterCalls).sort(), setup.scripts.map((s) => s.id).sort(), `${tenant.id} ${locale}`);
      }
    }
  });

  it("has its labels in de, it, en and fr, and the page promises the e-mail again", () => {
    for (const locale of ["de", "it", "en", "fr"] as const) {
      const strings = getVoiceStrings(locale);
      assert.match(strings.afterCallTitle, /e-mail/i, locale);
      assert.ok(strings.afterCallLanguage.includes("{language}"), locale);
      assert.equal(Object.keys(strings.languageNames).length, 4, locale);
    }
    for (const locale of [...LOCALES, "fr"] as Array<Locale | "fr">) {
      assert.match(VOICE_LANDING[locale].demo.lead, /e-mail/i, `${locale}: the demo lead says the example runs to the e-mail`);
    }
  });
});
