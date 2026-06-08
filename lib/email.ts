// Branded, email-client-safe HTML for the contact auto-reply (tables + inline styles, one
// optimized logo, the rest text → good text-to-image ratio for deliverability). Server-only.
// The footer address follows the visitor's pricing region: Italian visitors see the Italian
// local address, everyone else the Swiss one. Text is in the visitor's locale.
import { SITE } from "./site";
import { localizedHref, type Locale } from "./i18n";
import type { Region } from "./region";

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

const COPY: Record<
  Locale,
  { subject: string; greeting: string; intro: string; signoff: string; role: string; cta: string }
> = {
  en: {
    subject: "Thanks for reaching out — Modolo Digital Studio",
    greeting: "Hi",
    intro: "Thanks for contacting Modolo Digital Studio. We've received your message and will personally get back to you within 24 hours.",
    signoff: "Talk soon,",
    role: "Founder · Web Designer & Developer",
    cta: "See our work",
  },
  de: {
    subject: "Danke für deine Nachricht — Modolo Digital Studio",
    greeting: "Hallo",
    intro: "Danke für deine Nachricht an Modolo Digital Studio. Wir haben sie erhalten und melden uns innerhalb von 24 Stunden persönlich bei dir.",
    signoff: "Bis bald,",
    role: "Gründer · Webdesigner & Entwickler",
    cta: "Unsere Arbeiten ansehen",
  },
  it: {
    subject: "Grazie per averci scritto — Modolo Digital Studio",
    greeting: "Ciao",
    intro: "Grazie per aver scritto a Modolo Digital Studio. Abbiamo ricevuto il tuo messaggio e ti risponderemo personalmente entro 24 ore.",
    signoff: "A presto,",
    role: "Fondatore · Web Designer & Sviluppatore",
    cta: "Vedi i nostri lavori",
  },
};

// Local street address shown per pricing region (single source: lib/site.ts).
const ADDRESS: Record<Region, string> = {
  ch: `${SITE.address.street} · ${SITE.address.postalCode} ${SITE.address.locality}`,
  it: `${SITE.addressIt.street} · ${SITE.addressIt.postalCode} ${SITE.addressIt.locality}`,
};
// Country name per region, in the visitor's language.
const COUNTRY: Record<Region, Record<Locale, string>> = {
  ch: { en: "Switzerland", de: "Schweiz", it: "Svizzera" },
  it: { en: "Italy", de: "Italien", it: "Italia" },
};

const LOGO = `${SITE.url}/email-logo.png`;
const SANS = "'Helvetica Neue',Helvetica,Arial,sans-serif";
const SERIF = "Georgia,'Times New Roman',serif";

export function contactAutoReply(
  locale: Locale,
  region: Region,
  name: string,
): { subject: string; text: string; html: string } {
  const c = COPY[locale];
  const safeName = escapeHtml(name);
  const portfolioUrl = SITE.url + localizedHref(locale, "/#portfolio");
  const addr = `${ADDRESS[region]} · ${COUNTRY[region][locale]}`;

  const text =
    `${c.greeting} ${name},\n\n${c.intro}\n\n${c.cta}: ${portfolioUrl}\n\n${c.signoff}\n` +
    `${SITE.founder} — ${c.role}\n${SITE.email} · ${SITE.phoneDisplay}\nmodolodigitalstudio.ch · ${SITE.instagram}\n${addr}`;

  const html = `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${c.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#F7F3EC;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${c.intro}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F7F3EC;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #ece3d3;border-radius:16px;">
<tr><td align="center" style="padding:40px 40px 18px;">
<img src="${LOGO}" alt="Modolo Digital Studio" width="190" style="display:block;width:190px;max-width:55%;height:auto;border:0;outline:none;text-decoration:none;">
</td></tr>
<tr><td style="padding:0 40px;"><div style="height:1px;line-height:1px;font-size:1px;background-color:#ece3d3;">&nbsp;</div></td></tr>
<tr><td style="padding:26px 40px 6px;font-family:${SANS};color:#1F1B16;font-size:16px;line-height:1.65;">
<p style="margin:0 0 16px;">${c.greeting} ${safeName},</p>
<p style="margin:0;">${c.intro}</p>
</td></tr>
<tr><td align="center" style="padding:22px 40px 6px;">
<a href="${portfolioUrl}" style="display:inline-block;background-color:#1F1B16;color:#F7F3EC;font-family:${SANS};font-size:14px;font-weight:600;text-decoration:none;padding:13px 30px;border-radius:999px;letter-spacing:0.03em;">${c.cta}</a>
</td></tr>
<tr><td style="padding:18px 40px 32px;font-family:${SANS};color:#1F1B16;">
<div style="height:1px;line-height:1px;font-size:1px;background-color:#ece3d3;margin:8px 0 20px;">&nbsp;</div>
<p style="margin:0 0 4px;font-size:15px;color:#1F1B16;">${c.signoff}</p>
<p style="margin:0;font-size:17px;color:#1F1B16;"><strong>${SITE.founder}</strong></p>
<p style="margin:3px 0 14px;font-family:${SERIF};font-style:italic;font-size:14px;color:#8F6B2F;">${c.role}</p>
<p style="margin:0;font-size:13px;line-height:1.9;color:#1F1B16;">
<a href="mailto:${SITE.email}" style="color:#8F6B2F;text-decoration:none;">${SITE.email}</a><br>
<a href="tel:${SITE.phone}" style="color:#1F1B16;text-decoration:none;">${SITE.phoneDisplay}</a><br>
<a href="${SITE.url}" style="color:#8F6B2F;text-decoration:none;">modolodigitalstudio.ch</a><br>
<a href="${SITE.instagram}" style="color:#8F6B2F;text-decoration:none;">Instagram</a>
</p>
</td></tr>
<tr><td align="center" style="padding:16px 24px 28px;font-family:${SANS};color:#a39c90;font-size:12px;line-height:1.6;">
<strong style="color:#8a8478;">Modolo Digital Studio</strong><br>${addr}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject: c.subject, text, html };
}
