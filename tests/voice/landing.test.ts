// The voice sales page (lib/voice/landing.ts, app/sitemap.ts, content/voice/landing.ts): the switch
// that keeps it unpublished, its three public URLs, its metadata, its structured data (no prices,
// no ratings while the plans are hidden), the copy it needs, the language of each example, and
// the sitemap following the switch.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import sitemap from "@/app/sitemap";
import { selectDemoId } from "@/components/voice/landing/demo-choice";
import { LANDING_UI, keepTogether } from "@/components/voice/landing/ui";
import { VOICE_LANDING, VOICE_LANDING_SHOW_PLANS } from "@/content/voice/landing";
import { canonicalizeSlugPath, LOCALES, localizedHref, SLUG_TRANSLATIONS, stripLocale, type Locale } from "@/lib/i18n";
import { SITE } from "@/lib/site";
import { DEMO_SCRIPTS, DEMO_TENANTS } from "@/lib/voice/demos";
import {
  examplesForPage,
  isVoiceLandingOn,
  VOICE_LANDING_PATH,
  voiceLandingGraph,
  voiceLandingMetadata,
} from "@/lib/voice/landing";

const PUBLIC_URL: Record<Locale, string> = {
  en: "/ai-receptionist",
  de: "/de/ki-telefonassistent",
  it: "/it/assistente-telefonico-ai",
};

let saved: string | undefined;

beforeEach(() => {
  saved = process.env.VOICE_LANDING;
  delete process.env.VOICE_LANDING;
});

afterEach(() => {
  if (saved === undefined) delete process.env.VOICE_LANDING;
  else process.env.VOICE_LANDING = saved;
});

describe("the switch (VOICE_LANDING)", () => {
  it("is off by default", () => {
    assert.equal(isVoiceLandingOn({}), false);
    assert.equal(isVoiceLandingOn(), false, "unset in process.env");
  });

  it("accepts true, 1, on and yes, in any case and with spaces", () => {
    for (const value of ["true", "1", "on", "yes", "TRUE", "Yes", " on ", "On"]) {
      assert.equal(isVoiceLandingOn({ VOICE_LANDING: value }), true, JSON.stringify(value));
    }
  });

  it("stays off for anything else", () => {
    for (const value of ["", " ", "false", "0", "off", "no", "ture", "enabled", "y", "2", "true!", "on yes"]) {
      assert.equal(isVoiceLandingOn({ VOICE_LANDING: value }), false, JSON.stringify(value));
    }
  });

  it("reads process.env when no env is passed", () => {
    process.env.VOICE_LANDING = "yes";
    assert.equal(isVoiceLandingOn(), true);
    process.env.VOICE_LANDING = "nope";
    assert.equal(isVoiceLandingOn(), false);
  });
});

describe("the public URLs", () => {
  it("maps the canonical folder to one slug per site language", () => {
    assert.deepEqual(SLUG_TRANSLATIONS["assistente-telefonico-ai"], {
      en: "ai-receptionist",
      de: "ki-telefonassistent",
      it: "assistente-telefonico-ai",
    });
  });

  for (const locale of LOCALES) {
    it(`round-trips ${locale}: ${PUBLIC_URL[locale]}`, () => {
      const href = localizedHref(locale, VOICE_LANDING_PATH);
      assert.equal(href, PUBLIC_URL[locale]);
      // What proxy.ts does with the public URL: strip the prefix, map the slug to the folder.
      assert.equal(canonicalizeSlugPath(stripLocale(href)), VOICE_LANDING_PATH);
      // An in-page anchor keeps the localized path.
      assert.equal(localizedHref(locale, `${VOICE_LANDING_PATH}#contact`), `${PUBLIC_URL[locale]}#contact`);
    });
  }

  it("uses slugs no other page uses", () => {
    const mine = new Set(Object.values(SLUG_TRANSLATIONS["assistente-telefonico-ai"]));
    for (const [canonical, slugs] of Object.entries(SLUG_TRANSLATIONS)) {
      if (canonical === "assistente-telefonico-ai") continue;
      for (const slug of Object.values(slugs)) assert.equal(mine.has(slug), false, `${slug} is also ${canonical}`);
    }
  });
});

describe("metadata", () => {
  it("is noindex while the switch is off", () => {
    for (const locale of LOCALES) {
      const meta = voiceLandingMetadata(locale, false);
      assert.deepEqual(meta.robots, { index: false, follow: false });
      assert.equal(meta.alternates, undefined);
    }
    // The default reads the switch: off here.
    assert.deepEqual(voiceLandingMetadata("de").robots, { index: false, follow: false });
  });

  it("is indexable, canonical and has hreflang for en/de/it when on", () => {
    for (const locale of LOCALES) {
      const meta = voiceLandingMetadata(locale, true);
      assert.deepEqual(meta.robots, { index: true, follow: true });
      assert.deepEqual(meta.title, { absolute: VOICE_LANDING[locale].meta.title });
      assert.equal(meta.description, VOICE_LANDING[locale].meta.description);
      assert.equal(meta.alternates?.canonical, PUBLIC_URL[locale]);
      assert.deepEqual(meta.alternates?.languages, {
        en: PUBLIC_URL.en,
        de: PUBLIC_URL.de,
        it: PUBLIC_URL.it,
        "x-default": PUBLIC_URL.de,
      });
    }
  });
});

/** Every key anywhere in a JSON value, lower-cased. */
function allKeys(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, out);
  } else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.push(key.toLowerCase());
      allKeys(item, out);
    }
  }
  return out;
}

type GraphNode = Record<string, unknown> & { "@type": string };

function nodes(locale: Locale): GraphNode[] {
  const graph = JSON.parse(JSON.stringify(voiceLandingGraph(locale))) as { "@graph": GraphNode[] };
  return graph["@graph"];
}

describe("structured data", () => {
  for (const locale of LOCALES) {
    it(`${locale}: survives JSON unchanged and carries Service, BreadcrumbList and FAQPage`, () => {
      const graph = voiceLandingGraph(locale);
      const json = JSON.stringify(graph);
      assert.deepEqual(JSON.parse(json), graph, "no undefined, functions or NaN that JSON would drop");
      assert.equal(graph["@context"], "https://schema.org");
      const types = nodes(locale).map((node) => node["@type"]);
      for (const type of ["Organization", "Service", "BreadcrumbList", "FAQPage"]) assert.ok(types.includes(type), type);
    });

    it(`${locale}: the service is provided by the site's organisation`, () => {
      const organization = nodes(locale).find((node) => node["@type"] === "Organization");
      const service = nodes(locale).find((node) => node["@type"] === "Service");
      assert.equal(organization?.["@id"], `${SITE.url}/#organization`);
      assert.deepEqual(service?.provider, { "@id": `${SITE.url}/#organization` });
      assert.equal(service?.url, `${SITE.url}${PUBLIC_URL[locale]}`);
      assert.equal(service?.inLanguage, locale);
    });

    it(`${locale}: the FAQ is the copy's ten questions, in order`, () => {
      const faq = nodes(locale).find((node) => node["@type"] === "FAQPage");
      const questions = faq?.mainEntity as Array<{ name: string; acceptedAnswer: { text: string } }>;
      assert.equal(questions.length, 10);
      assert.deepEqual(
        questions.map((question) => [question.name, question.acceptedAnswer.text]),
        VOICE_LANDING[locale].faq.items.map((item) => [item.q, item.a]),
      );
    });

    it(`${locale}: the breadcrumb ends at this page`, () => {
      const crumbs = nodes(locale).find((node) => node["@type"] === "BreadcrumbList")?.itemListElement as Array<{
        position: number;
        item: string;
      }>;
      assert.deepEqual(
        crumbs.map((crumb) => crumb.position),
        [1, 2],
      );
      assert.equal(crumbs[1].item, `${SITE.url}${PUBLIC_URL[locale]}`);
    });
  }

  it("has no price, offer, rating or review anywhere while the plans are hidden", () => {
    assert.equal(VOICE_LANDING_SHOW_PLANS, false, "the plans are a proposal and stay hidden");
    for (const locale of LOCALES) {
      const graph = voiceLandingGraph(locale);
      const keys = allKeys(graph);
      for (const key of keys) assert.doesNotMatch(key, /price|offer|rating|review|currency/, `${locale}: key ${key}`);
      const json = JSON.stringify(graph);
      assert.doesNotMatch(json, /"@type":"(Offer|AggregateOffer|AggregateRating|Review|Rating|PriceSpecification)/);
      assert.doesNotMatch(json, /\bCHF\b|\bEUR\b|€/, `${locale}: no amount of money`);
    }
  });

  it("escapes nothing the JSON-LD component cannot carry", () => {
    // components/json-ld.tsx replaces "<" so no string can close the script tag; check there is
    // nothing else to worry about: the text is plain.
    for (const locale of LOCALES) assert.doesNotMatch(JSON.stringify(voiceLandingGraph(locale)), /<\/?script/i);
  });
});

describe("the copy", () => {
  it("exists for the three site languages (and French, unrouted)", () => {
    for (const locale of [...LOCALES, "fr"] as const) assert.ok(VOICE_LANDING[locale], locale);
  });

  for (const locale of LOCALES) {
    it(`${locale}: has every block the page renders`, () => {
      const copy = VOICE_LANDING[locale];
      assert.equal(copy.faq.items.length, 10);
      assert.equal(copy.features.items.length, 8);
      assert.equal(copy.integrations.items.length, 5);
      assert.equal(copy.problem.situations.length, 4);
      assert.equal(copy.how.steps.length, 3);
      assert.equal(copy.privacy.points.length, 4);
      assert.ok(copy.limits.items.length >= 1);
      assert.ok(copy.pilot.youGet.length >= 1 && copy.pilot.iAsk.length >= 1);
      for (const item of [...copy.features.items, ...copy.integrations.items]) {
        assert.ok(item.status === "pilot" || item.status === "planned");
      }
      // Distinct keys: the page uses titles and questions as React keys.
      assert.equal(new Set(copy.faq.items.map((item) => item.q)).size, 10);
      assert.equal(new Set(copy.features.items.map((item) => item.title)).size, 8);
      assert.equal(new Set(copy.limits.items).size, copy.limits.items.length);
      assert.equal(new Set([...copy.pilot.youGet, ...copy.pilot.iAsk]).size, copy.pilot.youGet.length + copy.pilot.iAsk.length);
      assert.equal(new Set(copy.privacy.points).size, 4);
      assert.ok(copy.contact.whatsappPrefill.trim().length > 0 && copy.contact.emailSubject.trim().length > 0);
    });
  }

  it("has the page's own labels in the three site languages, German in Swiss spelling", () => {
    for (const locale of LOCALES) {
      const ui = LANDING_UI[locale];
      for (const [key, value] of Object.entries(ui)) {
        const texts = typeof value === "string" ? [value] : Object.values(value as Record<string, string>);
        for (const text of texts) assert.ok(text.trim().length > 0, `${locale}.${key}`);
      }
    }
    assert.doesNotMatch(JSON.stringify(LANDING_UI.de), /ß/);
    assert.doesNotMatch(JSON.stringify(LANDING_UI), /!/, "no exclamation marks");
  });

  it("only changes spaces when it keeps a number with its unit", () => {
    const text = "Nach etwa 25 Sekunden, innert 24 Stunden, CHF 149 pro Monat.";
    const kept = keepTogether(text);
    assert.equal(kept.replace(/ /g, " "), text);
    assert.match(kept, /25 Sekunden/);
    assert.match(kept, /24 Stunden/);
    assert.match(kept, /CHF 149/);
  });
});

describe("the examples each page plays", () => {
  it("plays every demo business in every site language", () => {
    for (const locale of LOCALES) {
      for (const tenant of DEMO_TENANTS) {
        const examples = examplesForPage(DEMO_SCRIPTS, tenant.id, locale);
        assert.ok(examples.scripts.length > 0, `${tenant.id} on ${locale}`);
        assert.ok(examples.scripts.every((script) => script.tenantId === tenant.id && script.locale === examples.locale));
      }
    }
  });

  it("uses the page's language when the business has it, else German, and says which", () => {
    for (const locale of LOCALES) {
      for (const tenant of DEMO_TENANTS) {
        const own = DEMO_SCRIPTS.some((script) => script.tenantId === tenant.id && script.locale === locale);
        const examples = examplesForPage(DEMO_SCRIPTS, tenant.id, locale);
        if (own) {
          assert.equal(examples.locale, locale);
          assert.equal(examples.otherLanguage, false);
        } else {
          assert.equal(examples.locale, "de");
          assert.equal(examples.otherLanguage, true, `${tenant.id} on ${locale} must be marked`);
        }
      }
    }
    // The German page never needs the note.
    for (const tenant of DEMO_TENANTS) assert.equal(examplesForPage(DEMO_SCRIPTS, tenant.id, "de").otherLanguage, false);
  });

  it("gives nothing for an unknown business", () => {
    assert.deepEqual(examplesForPage(DEMO_SCRIPTS, "nobody", "it"), { scripts: [], locale: null, otherLanguage: false });
  });
});

describe("which business the chooser shows", () => {
  const ids = ["demo-umzug", "demo-sanitaer", "demo-hotel", "demo-coiffeur"];

  it("shows the default without a hash or a choice, as the server renders it", () => {
    assert.equal(selectDemoId(ids, "", null, "demo-sanitaer"), "demo-sanitaer");
    assert.equal(selectDemoId(ids, "faq", null, "demo-sanitaer"), "demo-sanitaer");
  });

  it("follows a hash that names a business (a trade link, a shared link)", () => {
    assert.equal(selectDemoId(ids, "demo-hotel", null, "demo-sanitaer"), "demo-hotel");
  });

  it("keeps the visitor's choice while the hash is the one it left, or names no business", () => {
    const picked = { id: "demo-coiffeur", hash: "demo-coiffeur" };
    assert.equal(selectDemoId(ids, "demo-coiffeur", picked, "demo-sanitaer"), "demo-coiffeur");
    assert.equal(selectDemoId(ids, "contact", picked, "demo-sanitaer"), "demo-coiffeur");
    // The URL could not be written (throttled): the choice still holds over the old hash.
    assert.equal(selectDemoId(ids, "demo-hotel", { id: "demo-coiffeur", hash: "demo-hotel" }, "demo-sanitaer"), "demo-coiffeur");
  });

  it("lets a later trade link win over an earlier choice", () => {
    assert.equal(selectDemoId(ids, "demo-umzug", { id: "demo-coiffeur", hash: "demo-coiffeur" }, "demo-sanitaer"), "demo-umzug");
  });

  it("never returns a business that is not offered", () => {
    assert.equal(selectDemoId(ids, "", { id: "demo-gone", hash: "" }, "demo-sanitaer"), "demo-sanitaer");
    assert.equal(selectDemoId(ids, "", null, "demo-missing"), "demo-umzug");
  });
});

describe("the sitemap", () => {
  const voiceUrls = () =>
    sitemap()
      .map((entry) => entry.url)
      .filter((url) => Object.values(PUBLIC_URL).some((path) => url === `${SITE.url}${path}`));

  it("leaves the page out while the switch is off", () => {
    assert.deepEqual(voiceUrls(), []);
    const all = JSON.stringify(sitemap());
    assert.doesNotMatch(all, /ai-receptionist|ki-telefonassistent|assistente-telefonico-ai/);
  });

  it("lists it in the three languages, with hreflang, when on", () => {
    process.env.VOICE_LANDING = "true";
    assert.deepEqual(voiceUrls().sort(), Object.values(PUBLIC_URL).map((path) => `${SITE.url}${path}`).sort());
    const entry = sitemap().find((item) => item.url === `${SITE.url}${PUBLIC_URL.de}`);
    assert.deepEqual(entry?.alternates?.languages, {
      en: `${SITE.url}${PUBLIC_URL.en}`,
      de: `${SITE.url}${PUBLIC_URL.de}`,
      it: `${SITE.url}${PUBLIC_URL.it}`,
      "x-default": `${SITE.url}${PUBLIC_URL.de}`,
    });
  });

  it("keeps every other page whatever the switch", () => {
    const off = sitemap().length;
    process.env.VOICE_LANDING = "on";
    assert.equal(sitemap().length, off + LOCALES.length);
  });
});
