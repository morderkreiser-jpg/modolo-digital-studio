// The twelve INVENTED demo businesses of Modolo Voice AI and their example conversations.
//
// SERVER-SIDE DATA: a VoiceTenantConfig holds knowledge, rules and transfer numbers (placeholders
// here, but the contract says numbers never reach the browser). Import this module from server
// code only. A page that plays an example conversation loads the script in a server component and
// passes it to the client as a prop; a client menu that only needs the sector names imports
// "@/lib/voice/demos/labels", which carries no tenant data.
//
// The registry of all tenants (lib/voice/tenants) lists DEMO_TENANTS next to the live ones.
import type { DemoScript, VoiceLocale, VoiceTenantConfig } from "@/lib/voice/types";
import { CARROSSERIE_SCRIPTS, CARROSSERIE_TENANT } from "./carrosserie";
import { COIFFEUR_SCRIPTS, COIFFEUR_TENANT } from "./coiffeur";
import { ELEKTRO_SCRIPTS, ELEKTRO_TENANT } from "./elektro";
import { HOTEL_SCRIPTS, HOTEL_TENANT } from "./hotel";
import { IMMOBILIEN_SCRIPTS, IMMOBILIEN_TENANT } from "./immobilien";
import { KOSMETIK_SCRIPTS, KOSMETIK_TENANT } from "./kosmetik";
import { MALER_SCRIPTS, MALER_TENANT } from "./maler";
import { REINIGUNG_SCRIPTS, REINIGUNG_TENANT } from "./reinigung";
import { RESTAURANT_SCRIPTS, RESTAURANT_TENANT } from "./restaurant";
import { SANITAER_SCRIPTS, SANITAER_TENANT } from "./sanitaer";
import { TATTOO_SCRIPTS, TATTOO_TENANT } from "./tattoo";
import { UMZUG_SCRIPTS, UMZUG_TENANT } from "./umzug";

export { DEMO_SECTOR_LABELS } from "./labels";

/** The demo businesses, in the order of a menu: trades first, then hospitality, then appointments. */
export const DEMO_TENANTS: VoiceTenantConfig[] = [
  UMZUG_TENANT,
  REINIGUNG_TENANT,
  SANITAER_TENANT,
  ELEKTRO_TENANT,
  MALER_TENANT,
  CARROSSERIE_TENANT,
  IMMOBILIEN_TENANT,
  RESTAURANT_TENANT,
  HOTEL_TENANT,
  COIFFEUR_TENANT,
  KOSMETIK_TENANT,
  TATTOO_TENANT,
];

/** Every example conversation, grouped by business in the order of DEMO_TENANTS. */
export const DEMO_SCRIPTS: DemoScript[] = [
  ...UMZUG_SCRIPTS,
  ...REINIGUNG_SCRIPTS,
  ...SANITAER_SCRIPTS,
  ...ELEKTRO_SCRIPTS,
  ...MALER_SCRIPTS,
  ...CARROSSERIE_SCRIPTS,
  ...IMMOBILIEN_SCRIPTS,
  ...RESTAURANT_SCRIPTS,
  ...HOTEL_SCRIPTS,
  ...COIFFEUR_SCRIPTS,
  ...KOSMETIK_SCRIPTS,
  ...TATTOO_SCRIPTS,
];

// A Map rather than an object literal: a lookup by an untrusted id ("__proto__") can never reach
// a prototype member.
const DEMO_BY_ID: ReadonlyMap<string, VoiceTenantConfig> = new Map(DEMO_TENANTS.map((tenant) => [tenant.id, tenant]));

/** The demo tenant whose id equals `id` exactly, or null. Never throws. */
export function getDemoTenant(id: unknown): VoiceTenantConfig | null {
  return typeof id === "string" ? (DEMO_BY_ID.get(id) ?? null) : null;
}

/**
 * The example conversations of one business, optionally in one language, in their fixed order.
 * An unknown tenant or a language without scripts gives []. Returns a new array each time.
 */
export function scriptsFor(tenantId: string, locale?: VoiceLocale): DemoScript[] {
  return DEMO_SCRIPTS.filter(
    (script) => script.tenantId === tenantId && (locale === undefined || script.locale === locale),
  );
}
