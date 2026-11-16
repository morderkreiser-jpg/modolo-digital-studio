// Registry of the businesses the assistant serves. SERVER-ONLY: a TenantConfig holds the
// knowledge base, the model rules and the lead recipient. Add a tenant by importing its config
// and listing it in TENANTS.
import type { TenantConfig } from "@/lib/assistant/types";
import { MODOLO_TENANT } from "./modolo/config";

export const DEFAULT_TENANT_ID = "modolo";

// A Map rather than an object literal: a lookup by an untrusted id ("__proto__", "constructor")
// can never reach a prototype member.
const TENANTS: ReadonlyMap<string, TenantConfig> = new Map([[MODOLO_TENANT.id, MODOLO_TENANT]]);

/** The tenant whose id equals `id` exactly (no trimming, no case folding), or null. */
export function getTenant(id: unknown): TenantConfig | null {
  return typeof id === "string" ? (TENANTS.get(id) ?? null) : null;
}

export function listTenantIds(): string[] {
  return [...TENANTS.keys()];
}
