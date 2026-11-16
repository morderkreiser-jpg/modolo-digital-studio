// Pricing/contact region of a chat or lead request, resolved the way the site does it
// (proxy.ts, app/api/contact/route.ts): an explicit cookie first, then the Vercel geo header,
// then the tenant default. Only ids listed in tenant.regions.ids are ever returned, so the
// result is safe to use as a cache key and as a lookup key.
import type { TenantConfig } from "@/lib/assistant/types";

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1 || part.slice(0, eq).trim() !== name) continue;
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value; // malformed escape: compare the raw value, it can only match a literal id
    }
  }
  return null;
}

export function resolveRegion(tenant: TenantConfig, request: Request): string {
  const { regions } = tenant;
  const known = (value: string | null | undefined): value is string =>
    typeof value === "string" && regions.ids.includes(value);

  if (regions.cookie) {
    const fromCookie = readCookie(request.headers.get("cookie"), regions.cookie);
    if (known(fromCookie)) return fromCookie;
  }

  const country = request.headers.get("x-vercel-ip-country")?.trim().toUpperCase();
  if (country && /^[A-Z]{2}$/.test(country) && regions.byCountry && Object.hasOwn(regions.byCountry, country)) {
    const fromCountry = regions.byCountry[country];
    if (known(fromCountry)) return fromCountry;
  }

  return regions.default;
}
