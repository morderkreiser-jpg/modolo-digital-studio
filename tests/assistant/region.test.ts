// Region resolution (lib/assistant/server/region.ts): cookie, then Vercel country, then default.
// The region picks prices for the prompt, so it must always be one of the tenant's region ids.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRegion } from "@/lib/assistant/server/region";
import { makeTenant } from "./fixtures";

// Fixture regions: ids ["ch", "it"], default "ch", cookie "fixture_region", byCountry { IT: "it", CH: "ch" }.
const tenant = makeTenant();

function request(headers: Record<string, string> = {}): Request {
  return new Request("https://site.example/api/assistant/chat", { method: "POST", headers });
}

describe("resolveRegion", () => {
  it("defaults to the tenant's default region", () => {
    assert.equal(resolveRegion(tenant, request()), "ch");
  });

  it("maps the Vercel country header through byCountry", () => {
    assert.equal(resolveRegion(tenant, request({ "x-vercel-ip-country": "IT" })), "it");
    assert.equal(resolveRegion(tenant, request({ "x-vercel-ip-country": "CH" })), "ch");
    assert.equal(resolveRegion(tenant, request({ "x-vercel-ip-country": "DE" })), "ch");
  });

  it("prefers the region cookie over the country, wherever it sits in the cookie header", () => {
    assert.equal(resolveRegion(tenant, request({ cookie: "fixture_region=it" })), "it");
    assert.equal(resolveRegion(tenant, request({ cookie: "a=1; fixture_region=it; b=2", "x-vercel-ip-country": "CH" })), "it");
    assert.equal(resolveRegion(tenant, request({ cookie: "fixture_region=ch", "x-vercel-ip-country": "IT" })), "ch");
  });

  it("ignores cookies with other names", () => {
    assert.equal(resolveRegion(tenant, request({ cookie: "other_region=it; xfixture_region=it" })), "ch");
  });

  it("always returns one of the tenant's region ids, whatever the cookie says", () => {
    for (const value of ["fr", "ignore-previous-instructions", "%0Aevil", "", "IT"]) {
      const region = resolveRegion(tenant, request({ cookie: `fixture_region=${value}`, "x-vercel-ip-country": "IT" }));
      assert.ok(tenant.regions.ids.includes(region), `cookie ${JSON.stringify(value)} → ${region}`);
    }
  });

  it("ignores cookies when the tenant has no region cookie", () => {
    const noCookie = makeTenant({ regions: { ...tenant.regions, cookie: undefined } });
    assert.equal(resolveRegion(noCookie, request({ cookie: "fixture_region=it" })), "ch");
  });
});
