// Server entry of the AI assistant: decides whether the widget exists at all and hands the
// browser only the public part of the tenant configuration (no knowledge base, no recipient
// address, no model settings). Rendered once by the [lang] root layout.
//
// The site's pages are prerendered, so this runs at build time: switching the assistant off
// (ASSISTANT_ENABLED=false) hides the launcher from the next deployment on, while the API
// routes honour the switch immediately and the widget explains it is unavailable meanwhile.
import "server-only";
import { getStrings } from "@/lib/assistant/i18n";
import {
  canDeliverLeads,
  getAssistantEnv,
  resolveLeadRetentionDays,
  resolveLimits,
} from "@/lib/assistant/server/env";
import { toPublicConfig } from "@/lib/assistant/server/public-config";
import { DEFAULT_TENANT_ID, getTenant } from "@/lib/assistant/tenants";
import { ASSISTANT_LOCALES, type AssistantLocale, type AssistantPublicConfig } from "@/lib/assistant/types";
import AssistantLauncher, { type LauncherLabels } from "./assistant-launcher";

function launcherLabels(config: AssistantPublicConfig): Record<AssistantLocale, LauncherLabels> {
  const labels = {} as Record<AssistantLocale, LauncherLabels>;
  for (const locale of ASSISTANT_LOCALES) {
    const strings = getStrings(locale, config.strings);
    labels[locale] = { open: strings.launcherOpen, close: strings.launcherClose, loadError: strings.launcherLoadError };
  }
  return labels;
}

export default function AssistantMount({
  locale,
  tenantId = DEFAULT_TENANT_ID,
}: {
  locale: AssistantLocale;
  tenantId?: string;
}) {
  const env = getAssistantEnv();
  if (!env.enabled) return null;

  let config: AssistantPublicConfig | null = null;
  try {
    const tenant = getTenant(tenantId);
    if (!tenant) return null;
    // Quote requests need somewhere to go: email (Resend) or the persistent store.
    config = toPublicConfig(tenant, {
      locale,
      limits: resolveLimits(tenant, env),
      leadsAvailable: tenant.leads.enabled && canDeliverLeads(env),
      retentionDays: resolveLeadRetentionDays(tenant, env),
    });
  } catch (error) {
    // An optional widget must never take the page down with it.
    console.error(`[assistant] widget not mounted: ${error instanceof Error ? error.message : "unknown error"}`);
    return null;
  }

  return <AssistantLauncher config={config} labels={launcherLabels(config)} />;
}
