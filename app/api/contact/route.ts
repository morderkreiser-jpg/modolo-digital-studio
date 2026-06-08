import { NextResponse } from "next/server";
import { SITE } from "@/lib/site";

// Server-side contact handler. Sends the enquiry to SITE.email via Resend when configured
// (set RESEND_API_KEY, and CONTACT_FROM once the domain is verified). Until then it falls
// back to the existing Formspree form, so the form never regresses during the switch-over.
const FORMSPREE_FALLBACK = "https://formspree.io/f/xbdbwlvg";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Fields = { nome: string; email: string; messaggio: string; azienda: string; gotcha: string };

async function readFields(request: Request): Promise<Fields> {
  const ct = request.headers.get("content-type") || "";
  const get = (v: FormDataEntryValue | null | undefined) => (typeof v === "string" ? v : "");
  if (ct.includes("application/json")) {
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const s = (k: string) => (typeof b[k] === "string" ? (b[k] as string) : "");
    return { nome: s("nome"), email: s("email"), messaggio: s("messaggio"), azienda: s("azienda"), gotcha: s("_gotcha") };
  }
  const f = await request.formData();
  return {
    nome: get(f.get("nome")),
    email: get(f.get("email")),
    messaggio: get(f.get("messaggio")),
    azienda: get(f.get("azienda")),
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

  const nome = fields.nome.trim();
  const email = fields.email.trim();
  const azienda = fields.azienda.trim();
  const messaggio = fields.messaggio.trim().slice(0, 5000);
  if (!nome || !EMAIL_RE.test(email) || !messaggio) {
    return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
  }

  const subject = `New enquiry — ${nome}${azienda ? ` (${azienda})` : ""}`;
  const text = `Name: ${nome}\nEmail: ${email}\nCompany: ${azienda || "—"}\n\n${messaggio}`;

  const apiKey = process.env.RESEND_API_KEY;
  if (apiKey) {
    // Default from works out-of-the-box if the Resend account is registered with SITE.email;
    // set CONTACT_FROM to a branded address (e.g. noreply@modolodigitalstudio.ch) after verifying the domain.
    const from = process.env.CONTACT_FROM || "Modolo Digital Studio <onboarding@resend.dev>";
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [SITE.email], reply_to: email, subject, text }),
    });
    if (res.ok) return NextResponse.json({ ok: true });
    const detail = await res.text().catch(() => "");
    console.error("Resend send failed", res.status, detail);
    return NextResponse.json({ ok: false, error: "send-failed" }, { status: 502 });
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
