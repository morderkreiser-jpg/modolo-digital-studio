import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import VoiceMount from "@/components/voice/voice-mount";
import { isLocale, localizedHref } from "@/lib/i18n";
import { DEMO_SCRIPTS, DEMO_SECTOR_LABELS, DEMO_TENANTS } from "@/lib/voice/demos";
import { availableModes, getVoiceEnv } from "@/lib/voice/server/env";
import { voiceEmailTransport } from "@/lib/voice/server/summary";

// Internal workbench of the voice widget: the Modolo stage and every demo business with its
// example conversations, side by side with what the server is configured to offer. Not linked
// from anywhere, never indexed, and a 404 unless VOICE_LAB is switched on.
//
// Rendered per request (connection()): the flag is read when the page is asked for, so switching
// it off takes effect without a rebuild, and the page is never prerendered into the deployment.
// The demo to show is a plain link (?demo=<id>): no client code beyond the stages themselves.
export const metadata: Metadata = {
  title: "Voice lab",
  robots: { index: false, follow: false, nocache: true },
};

export default async function VoiceLabPage({
  params,
  searchParams,
}: {
  params: Promise<{ lang: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { lang } = await params;
  if (!isLocale(lang)) notFound();
  await connection();
  const env = getVoiceEnv();
  if (!env.lab) notFound();

  const query = await searchParams;
  const demoId = typeof query.demo === "string" ? query.demo : null;
  const demo = DEMO_TENANTS.find((tenant) => tenant.id === demoId) ?? null;
  const demoScripts = demo ? DEMO_SCRIPTS.filter((script) => script.tenantId === demo.id) : [];
  const base = localizedHref(lang, "/voice-lab");

  // What the server offers, without a single secret: names and switches only.
  const facts: Array<[string, string]> = [
    ["VOICE_ENABLED", env.enabled ? "on" : "off"],
    ["Mode offered", env.enabled ? availableModes(env).join(", ") : "none (examples only)"],
    ["Mode asked for", env.requestedMode],
    ["Degraded because", env.degradedReason ?? "-"],
    ["Brain", env.brain],
    ["Realtime provider", env.provider],
    [
      "Dev outbox",
      !env.devOutbox
        ? "off"
        : voiceEmailTransport() === "dev_outbox"
          ? "on: requests and summaries are printed on the server console, nothing is sent"
          : "on, unused: Resend is configured",
    ],
  ];

  return (
    <main id="main" lang="en" className="mx-auto w-full max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
      <header className="mb-10">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[var(--gilt)]">Internal</p>
        <h1 className="mt-2 font-[family-name:var(--font-space)] text-3xl font-semibold tracking-tight text-[var(--espresso)]">
          Voice lab
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-[#5a5048]">
          Workbench for the voice widget. Nothing here is linked or indexed. The demo businesses are invented.
        </p>
        <dl className="mt-6 grid max-w-2xl grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm">
          {facts.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-[#5a5048]">{label}</dt>
              <dd className="m-0 font-mono text-[var(--espresso)]">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      <section aria-labelledby="lab-modolo" className="mb-16">
        <h2 id="lab-modolo" className="mb-4 text-lg font-semibold text-[var(--espresso)]">
          Modolo Digital Studio
        </h2>
        {env.enabled ? (
          <VoiceMount locale={lang} headingLevel={3} />
        ) : (
          <p className="text-sm text-[#5a5048]">Voice is off (VOICE_ENABLED): this stage only exists with voice on.</p>
        )}
      </section>

      <section aria-labelledby="lab-demos">
        <h2 id="lab-demos" className="mb-4 text-lg font-semibold text-[var(--espresso)]">
          Demo businesses
        </h2>
        <nav aria-label="Demo businesses" className="mb-8">
          <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2 lg:grid-cols-3">
            {DEMO_TENANTS.map((tenant) => {
              const count = DEMO_SCRIPTS.filter((script) => script.tenantId === tenant.id).length;
              const current = tenant.id === demo?.id;
              return (
                <li key={tenant.id}>
                  <a
                    href={`${base}?demo=${encodeURIComponent(tenant.id)}#lab-stage`}
                    aria-current={current ? "page" : undefined}
                    className={`flex min-h-11 flex-col rounded-xl border px-4 py-3 text-sm no-underline transition-colors ${
                      current
                        ? "border-[var(--espresso)] bg-[var(--bone)]"
                        : "border-[var(--line-strong)] hover:border-[var(--espresso)]"
                    }`}
                  >
                    <span className="font-medium text-[var(--espresso)]">{tenant.business.name}</span>
                    <span className="text-[#5a5048]">
                      {DEMO_SECTOR_LABELS[tenant.business.sector]?.en ?? tenant.business.sector} · {count}{" "}
                      {count === 1 ? "example" : "examples"}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div id="lab-stage" className="scroll-mt-8">
          {demo ? (
            <VoiceMount key={demo.id} locale={lang} tenantId={demo.id} scripts={demoScripts} headingLevel={3} />
          ) : (
            <p className="text-sm text-[#5a5048]">Choose a business to see its example conversations.</p>
          )}
        </div>
      </section>
    </main>
  );
}
