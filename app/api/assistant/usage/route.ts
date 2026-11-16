// GET /api/assistant/usage?tenant=<id>: admin-only snapshot of the assistant's estimated spend
// and traffic today and this month, with the effective limits and model settings.
//
//   curl -H "Authorization: Bearer $ASSISTANT_ADMIN_TOKEN" https://<site>/api/assistant/usage
//
// Answers 404 unless ASSISTANT_ADMIN_TOKEN is configured. Never returns secrets.
import { createHash, timingSafeEqual } from "node:crypto";
import type { ApiErrorBody, ChatErrorCode } from "@/lib/assistant/types";
import { DEFAULT_TENANT_ID, getTenant } from "@/lib/assistant/tenants";
import { getAssistantEnv, resolveAiSettings, resolveLimits } from "@/lib/assistant/server/env";
import { getStore } from "@/lib/assistant/server/store";
import { getUsageSummary, logEvent } from "@/lib/assistant/server/usage";

export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  // The request is read before anything else, which also keeps this handler request-time under
  // any caching mode (it must never be prerendered into a static 404).
  const authorization = request.headers.get("authorization");
  const tenantId = new URL(request.url).searchParams.get("tenant") || DEFAULT_TENANT_ID;

  const env = getAssistantEnv();
  if (env.adminToken === null) return errorResponse(404, "unavailable");
  if (!hasBearerToken(authorization, env.adminToken)) {
    logEvent({ route: "usage", rejected: "unauthorized" });
    return errorResponse(401, "forbidden", { "WWW-Authenticate": 'Bearer realm="assistant-usage"' });
  }

  const tenant = getTenant(tenantId);
  if (!tenant) return errorResponse(400, "bad_request");

  const ai = resolveAiSettings(tenant, env);
  return Response.json(
    {
      ok: true,
      tenant: tenant.id,
      enabled: env.enabled,
      usage: await getUsageSummary(getStore(), tenant.id),
      limits: resolveLimits(tenant, env),
      models: {
        model: ai.model,
        advancedModel: ai.advancedModel,
        routing: ai.routing,
        effort: ai.effort,
        maxOutputTokens: ai.maxOutputTokens,
        timeoutMs: ai.timeoutMs,
      },
    },
    { headers: NO_STORE },
  );
}

function hasBearerToken(header: string | null, expected: string): boolean {
  const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header ?? "");
  if (!match) return false;
  // Comparing fixed-length digests keeps timingSafeEqual's equal-length requirement and leaks
  // neither the token's content nor its length through timing.
  const given = createHash("sha256").update(match[1]).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(given, wanted);
}

function errorResponse(status: number, error: ChatErrorCode, headers: Record<string, string> = {}): Response {
  const body: ApiErrorBody = { ok: false, error };
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}
