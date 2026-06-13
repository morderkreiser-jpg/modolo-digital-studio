import { NextResponse } from "next/server";
import { SITE } from "@/lib/site";
import { isLocale, type Locale } from "@/lib/i18n";
import { isRegion, DEFAULT_REGION, type Region } from "@/lib/region";
import { contactAutoReply } from "@/lib/email";

// Server-side contact handler. Sends the enquiry to SITE.email via Resend when configured
// (set RESEND_API_KEY, and CONTACT_FROM once the domain is verified). Until then it falls
// back to the existing Formspree form, so the form never regresses during the switch-over.
// On the Resend path it also sends the visitor a localized auto-reply (best-effort).
const FORMSPREE_FALLBACK = "https://formspree.io/f/xbdbwlvg";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Fields = { nome: string; email: string; messaggio: string; azienda: string; lang: string; gotcha: string };

// Pricing region of the visitor: explicit cookie choice first, else the Vercel geo country.
function regionFromRequest(request: Request): Region {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(/(?:^|;\s*)MDS_REGION=(ch|it)/);
  if (m && isRegion(m[1])) return m[1];
  return request.headers.get("x-vercel-ip-country") === "IT" ? "it" : DEFAULT_REGION;
}

async function sendEmail(apiKey: string, payload: Record<string, unknown>) {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function readFields(request: Request): Promise<Fields> {
  const ct = request.headers.get("content-type") || "";
  const get = (v: FormDataEntryValue | null | undefined) => (typeof v === "string" ? v : "");
  if (ct.includes("application/json")) {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
    return { nome: s("nome"), email: s("email"), messaggio: s("messaggio"), azienda: s("azienda"), lang: s("lang"), gotcha: s("_gotcha") };
  }
  const f = await request.formData();
  return {
    nome: get(f.get("nome")),
    email: get(f.get("email")),
    messaggio: get(f.get("messaggio")),
    azienda: get(f.get("azienda")),
    lang: get(f.get("lang")),
    gotcha: get(f.get("_gotcha")),
  };
}

export async function POST(request: Request) {
  let fields: Fields;
  try {
    fields = await readFields(request);
  } catch {
    return NextResponse.json({ ok: false, error: "bad-request" }, { status: 400 });
  }

  // Anti-spam honeypot: a filled hidden field means a bot — pretend success, send nothing.
  if (fields.gotcha.trim()) return NextResponse.json({ ok: true });

  const nome = fields.nome.trim().slice(0, 120);
  const email = fields.email.trim().slice(0, 254);
  const azienda = fields.azienda.trim().slice(0, 200);
  const messaggio = fields.messaggio.trim().slice(0, 5000);
  const locale: Locale = isLocale(fields.lang) ? fields.lang : "en";
  const region: Region = regionFromRequest(request);
  if (!nome || !EMAIL_RE.test(email) || !messaggio) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const subject = `New enquiry — ${nome}${azienda ? ` (${azienda})` : ""}`;
  const text = `Name: ${nome}\nEmail: ${email}\nCompany: ${azienda || "—"}\nLanguage: ${locale}\n\n${messaggio}`;

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    const from = process.env.CONTACT_FROM || "Modolo Digital Studio <onboarding@resend.dev>";

    // 1) Notify the studio (reply goes to the visitor).
    const res = await sendEmail(apiKey, { from, to: [SITE.email], reply_to: email, subject, text });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("Resend notify failed", res.status, detail);
      return NextResponse.json({ ok: false, error: "send-failed" }, { status: 502 });
    }

    // 2) Branded, localized auto-reply to the visitor — from the monitored info@ address.
    //    Best-effort: a failure here never fails the request.
    try {
      const replyFrom = `Modolo Digital Studio <${SITE.email}>`;
      const ar = contactAutoReply(locale, region, nome);
      await sendEmail(apiKey, { from: replyFrom, to: [email], reply_to: SITE.email, subject: ar.subject, text: ar.text, html: ar.html });
    } catch (e) {
      console.error("Auto-reply failed", e);
    }

    return NextResponse.json({ ok: true });
  }

  // Fallback while Resend is not configured: forward to Formspree (current behaviour).
  const fd = new FormData();
  fd.set("nome", nome);
  fd.set("email", email);
  fd.set("azienda", azienda);
  fd.set("messaggio", messaggio);
  fd.set("_subject", subject);
  const fs = await fetch(FORMSPREE_FALLBACK, { method: "POST", body: fd, headers: { Accept: "application/json" } });
  if (fs.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: false, error: "fallback-failed" }, { status: 502 });
}
