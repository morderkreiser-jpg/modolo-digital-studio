// Registry of the businesses the voice assistant serves: Modolo Digital Studio itself and the
// fictional demo businesses of the sales demos. SERVER-ONLY: a VoiceTenantConfig holds the
// knowledge, the rules, the transfer numbers and the summary recipient. Add a tenant by importing
// its config and listing it in ALL_TENANTS.
import { DEMO_TENANTS } from "@/lib/voice/demos";
import type { VoiceTenantConfig } from "@/lib/voice/types";
import { MODOLO_VOICE_TENANT } from "./modolo";

export const DEFAULT_VOICE_TENANT_ID = "modolo";

const ALL_TENANTS: readonly VoiceTenantConfig[] = [MODOLO_VOICE_TENANT, ...DEMO_TENANTS];

// A Map rather than an object literal: a lookup by an untrusted id ("__proto__", "constructor")
// can never reach a prototype member. A duplicate id would silently shadow a tenant (and its
// numbers and rules), so it stops the module from loading instead: the tests catch it first.
function buildRegistry(tenants: readonly VoiceTenantConfig[]): ReadonlyMap<string, VoiceTenantConfig> {
  const registry = new Map<string, VoiceTenantConfig>();
  for (const tenant of tenants) {
    if (registry.has(tenant.id)) throw new Error(`voice tenant id "${tenant.id}" is registered twice`);
    registry.set(tenant.id, tenant);
  }
  return registry;
}

const TENANTS = buildRegistry(ALL_TENANTS);

/** The tenant whose id equals `id` exactly (no trimming, no case folding), or null. */
export function getVoiceTenant(id: unknown): VoiceTenantConfig | null {
  return typeof id === "string" ? (TENANTS.get(id) ?? null) : null;
}

export function listVoiceTenantIds(): string[] {
  return [...TENANTS.keys()];
}
