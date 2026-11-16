"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Plus, Send } from "lucide-react";
import type { Locale } from "@/lib/i18n";
import type { Region } from "@/lib/region";
import { SITE } from "@/lib/site";
import { useRegion } from "@/components/use-region";
import type { ContactCopy } from "@/content/home/contact";
import { typo } from "@/components/home/typo";

type Props = {
  lang: Locale;
  copy: ContactCopy;
  privacyHref: string;
  /** WhatsApp links for the error alert, tag Formular (PREFILL.formError), per region. */
  errorWa: Record<Region, string>;
};

/** "Name*" → "Name" + a visual asterisk; the input itself carries `required`. */
function Label({ text }: { text: string }) {
  if (!text.endsWith("*")) return <>{text}</>;
  return (
    <>
      {text.slice(0, -1)}
      <span aria-hidden="true" className="text-[var(--gilt)]">*</span>
    </>
  );
}

const FIELD =
  "block w-full scroll-mt-[calc(var(--nav-h,80px)+16px)] rounded-[12px] border border-[#17130e]/55 bg-[#fbf8f2] px-4 text-[16px] text-[#17130e] transition-colors placeholder:text-[#17130e]/60 hover:border-[#17130e]/70 focus:border-[#b5893f] aria-[invalid=true]:border-red-700";
const LABEL = "mb-2 block text-[14px] font-medium text-[#17130e]/85";

/**
 * The e-mail form of 07 · Kontakt, as a client island. Behaviour and API contract are exactly
 * today's (moved from the old components/home/contact.tsx):
 * multipart POST /api/contact with nome, email, azienda, messaggio, servizi (chips joined with ", "),
 * lang and the _gotcha honeypot; Accept: application/json; any 2xx = sent. Name and a valid e-mail
 * are required (inline, localized errors, aria-invalid, cleared on typing); focus moves to the success
 * message; a failure shows an alert with a WhatsApp link (tag Formular, region-aware) and a mailto.
 */
export default function ContactForm({ lang, copy: t, privacyHref, errorWa }: Props) {
  const [formStatus, setFormStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({});
  const [needs, setNeeds] = useState<string[]>([]);
  const successRef = useRef<HTMLDivElement>(null);
  const region = useRegion();

  // Move focus to the success panel so screen-reader and keyboard users are told the message sent.
  useEffect(() => {
    if (formStatus === "success") successRef.current?.focus();
  }, [formStatus]);

  const toggleNeed = (n: string) => setNeeds((p) => (p.includes(n) ? p.filter((x) => x !== n) : [...p, n]));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (formStatus === "sending") return;
    const form = e.currentTarget;
    const data = new FormData(form);
    data.set("lang", lang);
    data.set("servizi", needs.join(", "));
    const name = (data.get("nome") as string)?.trim();
    const email = (data.get("email") as string)?.trim();
    const errs: { name?: string; email?: string } = {};
    if (!name) errs.name = t.errName;
    if (!email) errs.email = t.errEmailRequired;
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errs.email = t.errEmailInvalid;
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      // The errors sit next to the fields, which may be above the viewport: bring the first one into view.
      document.getElementById(errs.name ? "contact-name" : "contact-email")?.focus();
      return;
    }
    setFieldErrors({});
    setFormStatus("sending");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        body: data,
        headers: { Accept: "application/json" },
      });
      if (res.ok) {
        setFormStatus("success");
        form.reset();
        setNeeds([]);
      } else {
        setFormStatus("error");
      }
    } catch {
      setFormStatus("error");
    }
  };

  if (formStatus === "success") {
    return (
      <div
        ref={successRef}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="flex min-h-[360px] flex-col items-center justify-center rounded-[20px] bg-[var(--ink-panel)] p-8 text-center outline-none sm:p-12"
      >
        <CheckCircle2 className="mb-5 h-12 w-12 text-[var(--gilt)]" strokeWidth={1.4} aria-hidden="true" />
        <h3 className="display-space text-[26px] leading-tight text-[#17130e]">{t.successTitle}</h3>
        <p className="mt-3 max-w-[420px] text-[16px] leading-relaxed text-[#17130e]/78">{typo(t.successText, lang)}</p>
      </div>
    );
  }

  const waNumber = region === "it" ? SITE.phoneItDisplay : SITE.phoneDisplay;

  return (
    <div className="sm:rounded-[20px] sm:bg-[var(--ink-panel)] sm:p-8 md:p-10">
      {/* Phones: WhatsApp comes first, the e-mail form opens from one row («Lieber per E-Mail»), which
          keeps the page short (SPEC A15). From 768 px the form is always shown under its h3
          (.mds-more / .mds-more-head in globals.css). Only one of the two h3 is ever rendered. */}
      <h3 className="mds-more-head display-space text-[22px] leading-tight text-[#17130e] md:text-[26px]">{t.formH3}</h3>
      <details className="mds-more">
      <summary className="flex min-h-[56px] items-center justify-between gap-4 border-y border-[color:var(--gold-line-strong)] py-3">
        <h3 className="display-space text-[20px] leading-tight text-[#17130e]">{t.formH3}</h3>
        <Plus className="mds-more-icon h-5 w-5 shrink-0 text-[var(--gilt)]" strokeWidth={1.8} aria-hidden="true" />
      </summary>
      <form onSubmit={handleSubmit} noValidate className="mt-5 space-y-4 md:mt-6 md:space-y-5">
        {/* anti-spam honeypot (hidden from users; the server rejects submissions that fill it — see /api/contact) */}
        <input type="text" name="_gotcha" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" />
        <div className="grid gap-4 sm:grid-cols-2 md:gap-5">
          <div>
            <label htmlFor="contact-name" className={LABEL}><Label text={t.fields.name} /></label>
            <input
              id="contact-name"
              type="text"
              name="nome"
              required
              autoComplete="name"
              aria-invalid={fieldErrors.name ? true : undefined}
              aria-describedby={fieldErrors.name ? "contact-name-err" : undefined}
              onChange={() => fieldErrors.name && setFieldErrors((p) => ({ ...p, name: undefined }))}
              className={`${FIELD} h-[52px]`}
              placeholder={t.placeholders.name}
            />
            {fieldErrors.name && <p id="contact-name-err" role="alert" className="mt-2 text-[14px] text-red-700">{fieldErrors.name}</p>}
          </div>
          <div>
            <label htmlFor="contact-email" className={LABEL}><Label text={t.fields.email} /></label>
            <input
              id="contact-email"
              type="email"
              name="email"
              required
              autoComplete="email"
              inputMode="email"
              aria-invalid={fieldErrors.email ? true : undefined}
              aria-describedby={fieldErrors.email ? "contact-email-err" : undefined}
              onChange={() => fieldErrors.email && setFieldErrors((p) => ({ ...p, email: undefined }))}
              className={`${FIELD} h-[52px]`}
              placeholder={t.placeholders.email}
            />
            {fieldErrors.email && <p id="contact-email-err" role="alert" className="mt-2 text-[14px] text-red-700">{fieldErrors.email}</p>}
          </div>
        </div>

        <div>
          <label htmlFor="contact-company" className={LABEL}>{t.fields.business}</label>
          <input id="contact-company" type="text" name="azienda" autoComplete="organization" className={`${FIELD} h-[52px]`} placeholder={t.placeholders.business} />
        </div>

        <div role="group" aria-labelledby="contact-needs-label">
          <span id="contact-needs-label" className={LABEL}>{t.chipsLabel}</span>
          <div className="flex flex-wrap gap-1.5 md:gap-2">
            {t.chips.map((n) => {
              const active = needs.includes(n);
              return (
                <button
                  key={n}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleNeed(n)}
                  className={`min-h-[44px] rounded-full border px-3 text-[13.5px] transition-colors min-[380px]:px-3.5 min-[380px]:text-[14px] md:px-4 ${
                    active
                      ? "border-[#b5893f] bg-[#b5893f] text-[#17130e]"
                      : "border-[color:var(--gold-line-strong)] bg-[#fbf8f2] text-[#17130e]/80 hover:border-[#b5893f] hover:text-[#17130e]"
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <label htmlFor="contact-message" className={LABEL}>{t.fields.message}</label>
          <textarea id="contact-message" name="messaggio" rows={3} className={`${FIELD} resize-y py-3`} placeholder={t.placeholders.message} />
        </div>

        {formStatus === "error" && (
          <div role="alert" className="flex items-start gap-3 rounded-[12px] border border-red-300 bg-red-50 p-4 text-red-800">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" strokeWidth={1.6} aria-hidden="true" />
            <p className="text-[14px] leading-relaxed">
              {t.error}{" "}
              <a href={errorWa[region]} target="_blank" rel="noopener noreferrer" className="whitespace-nowrap font-medium underline underline-offset-2">
                {waNumber}
                <span className="sr-only"> {t.newTab}</span>
              </a>
              {" · "}
              <a href={`mailto:${SITE.email}`} className="font-medium underline underline-offset-2">{SITE.email}</a>
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center sm:gap-5">
          <button
            type="submit"
            disabled={formStatus === "sending"}
            className="group inline-flex h-[54px] shrink-0 items-center justify-center gap-2 rounded-full px-8 text-[16px] font-semibold text-[#17130e] shadow-[0_12px_28px_-14px_rgba(126,93,36,0.75)] transition-[transform,box-shadow] duration-200 hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-70"
            style={{ background: "linear-gradient(100deg, #e8c877, #b5893f)" }}
          >
            {formStatus === "sending" ? t.sending : t.submit}
            {formStatus !== "sending" && <Send className="h-4 w-4 transition-transform group-hover:translate-x-0.5" strokeWidth={1.8} aria-hidden="true" />}
          </button>
          <p className="text-[14px] leading-snug text-[#17130e]/74">{typo(t.note, lang)}</p>
        </div>
        <p className="text-[13.5px] leading-relaxed text-[#17130e]/72">
          {t.privacy.before}
          <Link href={privacyHref} prefetch={false} className="underline underline-offset-2 transition-colors hover:text-[#17130e]">
            {t.privacy.link}
          </Link>
          {t.privacy.after}
        </p>
      </form>
      </details>
    </div>
  );
}
