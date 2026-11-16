// The browser-safe subset of a TenantConfig, passed from the server mount to the widget. Built
// field by field (never by spreading the tenant) so that the lead recipient, the knowledge base,
// the model rules and the allowed origins can never leak into the client bundle or the HTML.
import {
  ASSISTANT_CHAT_ENDPOINT,
  ASSISTANT_LEAD_ENDPOINT,
  type AssistantLimits,
  type AssistantLocale,
  type AssistantPublicConfig,
  type TenantConfig,
} from "@/lib/assistant/types";

/** Most starter chips the widget shows per locale (see TenantConfig.starters). */
const MAX_STARTERS = 4;

export function toPublicConfig(
  tenant: TenantConfig,
  opts: {
    locale: AssistantLocale;
    limits: AssistantLimits;
    leadsAvailable: boolean;
    /** Effective retention when an env override applies, so the consent text states what is enforced. */
    retentionDays?: number;
  },
): AssistantPublicConfig {
  const starters: AssistantPublicConfig["starters"] = {};
  for (const locale of tenant.locales) {
    const list = tenant.starters[locale];
    if (list?.length) starters[locale] = list.slice(0, MAX_STARTERS);
  }

  const config: AssistantPublicConfig = {
    tenant: tenant.id,
    locale: tenant.locales.includes(opts.locale) ? opts.locale : tenant.defaultLocale,
    locales: [...tenant.locales],
    branding: tenant.branding,
    welcome: tenant.welcome,
    starters,
    contact: tenant.contact,
    defaultRegion: tenant.regions.default,
    privacyUrl: tenant.privacyUrl,
    hiddenOnPathSegments: [...(tenant.hiddenOnPathSegments ?? [])],
    leads: {
      // The form is only offered when the server can actually deliver what it collects.
      enabled: tenant.leads.enabled && opts.leadsAvailable,
      services: tenant.leads.services,
      budgetOptions: tenant.leads.budgetOptions,
      requireCompany: tenant.leads.requireCompany,
      requirePhone: tenant.leads.requirePhone,
      retentionDays: opts.retentionDays ?? tenant.leads.retentionDays,
    },
    limits: {
      maxMessageChars: opts.limits.maxMessageChars,
      maxUserMessagesPerSession: opts.limits.maxUserMessagesPerSession,
    },
    endpoints: { chat: ASSISTANT_CHAT_ENDPOINT, lead: ASSISTANT_LEAD_ENDPOINT },
  };
  // Optional fields only when the tenant defines them, so the serialized props carry no empty keys.
  if (tenant.contactByRegion) config.contactByRegion = tenant.contactByRegion;
  if (tenant.regions.cookie) config.regionCookie = tenant.regions.cookie;
  if (tenant.strings) config.strings = tenant.strings;
  return config;
}
