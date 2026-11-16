// Quote request card shown inside the conversation. The visitor's details never pass through the
// model: the model only suggests the form (service + an editable summary); the visitor submits
// it straight to the lead endpoint, validated with the same rules the server applies.
import { memo, useEffect, useId, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type { AssistantStrings } from "@/lib/assistant/i18n";
import { LEAD_LIMITS, validateLead, type LeadFieldErrors, type LeadRules } from "@/lib/assistant/lead-schema";
import { interpolate, pickText } from "@/lib/assistant/localize";
import {
  LEAD_FIELDS,
  type AssistantLocale,
  type AssistantPublicConfig,
  type LeadErrorCode,
  type LeadField,
  type LeadFieldError,
  type LeadRequestBody,
} from "@/lib/assistant/types";
import { ContactLinks } from "./contact-links";
import { CheckIcon, QuoteIcon } from "./icons";
import { safeLink } from "./markdown";
import { fillSlots, SafeLink, type LinkContext } from "./rich-text";
import type { QuoteFormState } from "./use-assistant";
import styles from "./assistant.module.css";

/** Delivery waits on an email provider (10 s server timeout); give it headroom, then fail. */
const LEAD_TIMEOUT_MS = 25_000;

const LEAD_ERROR_CODES: ReadonlySet<string> = new Set<LeadErrorCode>([
  "invalid",
  "bad_request",
  "forbidden",
  "rate_limited",
  "unavailable",
  "delivery_failed",
]);
const FIELD_ERRORS: ReadonlySet<string> = new Set<LeadFieldError>([
  "required",
  "too_short",
  "too_long",
  "invalid_email",
  "invalid_phone",
  "invalid_option",
  "consent_required",
]);

interface Values {
  name: string;
  company: string;
  email: string;
  phone: string;
  service: string;
  description: string;
  budget: string;
  consent: boolean;
}

type TextField = Exclude<keyof Values, "consent">;

type SubmitState =
  | { kind: "idle" }
  | { kind: "invalid" }
  | { kind: "sending" }
  | { kind: "error"; code: Exclude<LeadErrorCode, "invalid"> | "network" }
  | { kind: "success"; name: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function codeForStatus(status: number): Exclude<LeadErrorCode, "invalid"> {
  if (status === 400 || status === 413) return "bad_request";
  if (status === 403) return "forbidden";
  if (status === 429) return "rate_limited";
  if (status === 503) return "unavailable";
  return "delivery_failed";
}

/** Field errors from the server, keeping only known fields and codes. */
function serverFieldErrors(value: unknown): LeadFieldErrors {
  const fields: LeadFieldErrors = {};
  if (!isRecord(value)) return fields;
  for (const field of LEAD_FIELDS) {
    const code = value[field];
    if (typeof code === "string" && FIELD_ERRORS.has(code)) fields[field] = code as LeadFieldError;
  }
  return fields;
}

// Memoized: the conversation re-renders on every streamed frame, the form has no reason to.
export const QuoteForm = memo(function QuoteForm({
  config,
  strings,
  locale,
  sessionId,
  region,
  form,
  linkContext,
  onDismiss,
  onSubmitted,
}: {
  config: AssistantPublicConfig;
  strings: AssistantStrings;
  locale: AssistantLocale;
  sessionId: string;
  region: string;
  form: QuoteFormState;
  linkContext: LinkContext;
  onDismiss: () => void;
  onSubmitted: () => void;
}) {
  const t = strings.form;
  const services = config.leads.services;
  const budgets = config.leads.budgetOptions[region] ?? config.leads.budgetOptions.default ?? [];
  const rules: LeadRules = {
    services: services.map((option) => option.id),
    budgets: budgets.map((option) => option.id),
    requireCompany: config.leads.requireCompany,
    requirePhone: config.leads.requirePhone,
  };

  const [values, setValues] = useState<Values>(() => ({
    name: "",
    company: "",
    email: "",
    phone: "",
    service: form.service && services.some((option) => option.id === form.service) ? form.service : "",
    description: (form.summary ?? "").slice(0, LEAD_LIMITS.descriptionMax),
    budget: "",
    consent: false,
  }));
  const [errors, setErrors] = useState<LeadFieldErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [status, setStatus] = useState<SubmitState>({ kind: "idle" });

  const baseId = useId();
  const titleId = `${baseId}-title`;
  const fieldRefs = useRef<Partial<Record<LeadField, HTMLElement | null>>>({});
  const honeypotRef = useRef<HTMLInputElement>(null);
  const successRef = useRef<HTMLHeadingElement>(null);

  // Move focus to the confirmation, so keyboard and screen-reader users land on the outcome.
  useEffect(() => {
    if (status.kind === "success") successRef.current?.focus({ preventScroll: true });
  }, [status.kind]);

  const focusFirstError = (fields: LeadFieldErrors) => {
    const first = LEAD_FIELDS.find((field) => fields[field]);
    if (first) fieldRefs.current[first]?.focus();
  };

  // After the first submit attempt, errors follow the visitor's corrections field by field.
  const revalidate = (field: LeadField, next: Values) => {
    if (!attempted) return;
    const result = validateLead(next, rules);
    const error = result.ok ? undefined : result.fields[field];
    setErrors((previous) => {
      if (previous[field] === error) return previous;
      const updated = { ...previous };
      if (error) updated[field] = error;
      else delete updated[field];
      return updated;
    });
  };

  const onText =
    (field: TextField) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      const next = { ...values, [field]: event.target.value };
      setValues(next);
      // Selects have no meaningful blur: check them as soon as they change.
      if (event.target instanceof HTMLSelectElement) revalidate(field, next);
    };

  const onConsent = (event: ChangeEvent<HTMLInputElement>) => {
    const next = { ...values, consent: event.target.checked };
    setValues(next);
    revalidate("consent", next);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (status.kind === "sending") return;
    setAttempted(true);
    const result = validateLead(values, rules);
    if (!result.ok) {
      setErrors(result.fields);
      setStatus({ kind: "invalid" });
      focusFirstError(result.fields);
      return;
    }
    setErrors({});
    setStatus({ kind: "sending" });

    const honeypot = honeypotRef.current?.value ?? "";
    const page = window.location.pathname;
    const body: LeadRequestBody = {
      tenant: config.tenant,
      sessionId,
      locale,
      ...(page.startsWith("/") && page.length <= 200 ? { page } : {}),
      lead: result.value,
      elapsedMs: Math.max(0, Date.now() - form.shownAt),
      ...(honeypot ? { hp: honeypot } : {}),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LEAD_TIMEOUT_MS);
    try {
      const response = await fetch(config.endpoints.lead, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
        cache: "no-store",
        credentials: "same-origin",
      });
      let data: unknown = null;
      try {
        data = await response.json();
      } catch {
        // Non-JSON error page: the status code decides below.
      }
      if (response.ok && isRecord(data) && data.ok === true) {
        setStatus({ kind: "success", name: result.value.name });
        onSubmitted();
        return;
      }
      const error = isRecord(data) ? data.error : undefined;
      const fields = error === "invalid" ? serverFieldErrors(isRecord(data) ? data.fields : undefined) : {};
      if (Object.keys(fields).length > 0) {
        setErrors(fields);
        setStatus({ kind: "invalid" });
        focusFirstError(fields);
        return;
      }
      // "invalid" without usable field errors cannot be shown inline: treat it as a bad request.
      const code =
        typeof error === "string" && error !== "invalid" && LEAD_ERROR_CODES.has(error)
          ? (error as Exclude<LeadErrorCode, "invalid">)
          : codeForStatus(response.status);
      setStatus({ kind: "error", code });
    } catch {
      setStatus({ kind: "error", code: "network" });
    } finally {
      clearTimeout(timer);
    }
  };

  if (status.kind === "success") {
    return (
      <section className={styles.formCard} data-quote-card="" aria-labelledby={titleId}>
        <div className={styles.formSuccess} role="status">
          <span className={styles.successMark} aria-hidden="true">
            <CheckIcon />
          </span>
          <h3 ref={successRef} id={titleId} className={styles.formTitle} tabIndex={-1}>
            {t.successTitle}
          </h3>
          <p className={styles.formIntro}>
            {interpolate(t.successText, { name: status.name, business: config.branding.name })}
          </p>
        </div>
      </section>
    );
  }

  const sending = status.kind === "sending";
  const privacy = safeLink(pickText(config.privacyUrl, locale, config.locale));
  const consentText = interpolate(t.consent, { days: config.leads.retentionDays });
  // The policy's name sits inside the sentence ("I have read the {privacy}."): without a usable
  // URL it stays as plain words, so the sentence never has a hole.
  const consentLabel = fillSlots(consentText, {
    privacy:
      privacy && privacy.target !== "direct" ? (
        <SafeLink href={privacy.href} target="external" context={linkContext} className={styles.inlineLink}>
          {t.privacyLink}
        </SafeLink>
      ) : (
        t.privacyLink
      ),
  });

  const describedBy = (field: LeadField, hintId?: string) =>
    [hintId, errors[field] ? `${baseId}-${field}-error` : undefined].filter(Boolean).join(" ") || undefined;

  const errorText = (field: LeadField) => {
    const error = errors[field];
    return error ? (
      <p id={`${baseId}-${field}-error`} className={styles.fieldError}>
        {strings.fieldErrors[error]}
      </p>
    ) : null;
  };

  const label = (field: LeadField, text: string, optional: boolean): ReactNode => (
    <label htmlFor={`${baseId}-${field}`} className={styles.fieldLabel}>
      {text}
      {optional ? <span className={styles.optional}> ({t.optional})</span> : null}
    </label>
  );

  const control = (field: LeadField) => ({
    id: `${baseId}-${field}`,
    name: field,
    "aria-invalid": errors[field] ? true : undefined,
    ref: (element: HTMLElement | null) => {
      fieldRefs.current[field] = element;
    },
  });

  const statusMessage =
    status.kind === "invalid"
      ? strings.leadErrors.invalid
      : status.kind === "error"
        ? status.code === "network"
          ? t.networkError
          : strings.leadErrors[status.code]
        : null;

  return (
    <section className={styles.formCard} data-quote-card="" aria-labelledby={titleId}>
      <div className={styles.formHead}>
        <span className={styles.formMark} aria-hidden="true">
          <QuoteIcon />
        </span>
        <div>
          <h3 id={titleId} className={styles.formTitle}>
            {t.title}
          </h3>
          <p className={styles.formIntro}>{interpolate(t.intro, { business: config.branding.name })}</p>
        </div>
      </div>

      <form className={styles.form} onSubmit={submit} noValidate data-testid="assistant-quote-form">
        <div className={styles.field}>
          {label("name", t.name, false)}
          <input
            {...control("name")}
            className={styles.textInput}
            type="text"
            autoComplete="name"
            required
            maxLength={LEAD_LIMITS.nameMax}
            value={values.name}
            onChange={onText("name")}
            onBlur={() => revalidate("name", values)}
            aria-describedby={describedBy("name")}
          />
          {errorText("name")}
        </div>

        <div className={styles.field}>
          {label("company", t.company, !config.leads.requireCompany)}
          <input
            {...control("company")}
            className={styles.textInput}
            type="text"
            autoComplete="organization"
            required={config.leads.requireCompany}
            maxLength={LEAD_LIMITS.companyMax}
            value={values.company}
            onChange={onText("company")}
            onBlur={() => revalidate("company", values)}
            aria-describedby={describedBy("company")}
          />
          {errorText("company")}
        </div>

        <div className={styles.field}>
          {label("email", t.email, false)}
          <input
            {...control("email")}
            className={styles.textInput}
            type="email"
            inputMode="email"
            autoComplete="email"
            spellCheck={false}
            required
            maxLength={LEAD_LIMITS.emailMax}
            value={values.email}
            onChange={onText("email")}
            onBlur={() => revalidate("email", values)}
            aria-describedby={describedBy("email")}
          />
          {errorText("email")}
        </div>

        <div className={styles.field}>
          {label("phone", t.phone, !config.leads.requirePhone)}
          <input
            {...control("phone")}
            className={styles.textInput}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            required={config.leads.requirePhone}
            maxLength={LEAD_LIMITS.phoneMax}
            value={values.phone}
            onChange={onText("phone")}
            onBlur={() => revalidate("phone", values)}
            aria-describedby={describedBy("phone")}
          />
          {errorText("phone")}
        </div>

        {services.length > 0 ? (
          <div className={styles.field}>
            {label("service", t.service, true)}
            <select
              {...control("service")}
              className={styles.select}
              value={values.service}
              onChange={onText("service")}
              aria-describedby={describedBy("service")}
            >
              <option value="">{t.servicePlaceholder}</option>
              {services.map((option) => (
                <option key={option.id} value={option.id}>
                  {pickText(option.label, locale, config.locale) || option.id}
                </option>
              ))}
            </select>
            {errorText("service")}
          </div>
        ) : null}

        <div className={styles.field}>
          {label("description", t.description, false)}
          <textarea
            {...control("description")}
            className={styles.textArea}
            rows={4}
            required
            maxLength={LEAD_LIMITS.descriptionMax}
            value={values.description}
            onChange={onText("description")}
            onBlur={() => revalidate("description", values)}
            aria-describedby={describedBy("description", `${baseId}-description-hint`)}
          />
          <p id={`${baseId}-description-hint`} className={styles.fieldHint}>
            {t.descriptionHint}
          </p>
          {errorText("description")}
        </div>

        {budgets.length > 0 ? (
          <div className={styles.field}>
            {label("budget", t.budget, true)}
            <select
              {...control("budget")}
              className={styles.select}
              value={values.budget}
              onChange={onText("budget")}
              aria-describedby={describedBy("budget")}
            >
              <option value="">{t.budgetPlaceholder}</option>
              {budgets.map((option) => (
                <option key={option.id} value={option.id}>
                  {pickText(option.label, locale, config.locale) || option.id}
                </option>
              ))}
            </select>
            {errorText("budget")}
          </div>
        ) : null}

        <div className={styles.consent}>
          <input
            {...control("consent")}
            className={styles.checkbox}
            type="checkbox"
            required
            checked={values.consent}
            onChange={onConsent}
            aria-describedby={describedBy("consent")}
          />
          <label htmlFor={`${baseId}-consent`} className={styles.consentLabel}>
            {consentLabel}
          </label>
          {errorText("consent")}
        </div>

        {/* "_gotcha": a name no autofill profile maps to; a filled trap silently drops the request. */}
        <div className={styles.honeypot} aria-hidden="true">
          <label>
            {t.honeypot}
            <input ref={honeypotRef} type="text" name="_gotcha" tabIndex={-1} autoComplete="off" defaultValue="" />
          </label>
        </div>

        {statusMessage ? (
          <div className={styles.formStatus} role="alert">
            <p>{statusMessage}</p>
            {status.kind === "error" ? (
              <ContactLinks
                config={config}
                region={region}
                locale={locale}
                strings={strings}
                context={linkContext}
              />
            ) : null}
          </div>
        ) : null}

        <div className={styles.formActions}>
          <button
            type="submit"
            className={styles.primaryButton}
            aria-disabled={sending || undefined}
            data-busy={sending || undefined}
            data-testid="assistant-quote-submit"
          >
            {sending ? <span className={styles.spinner} aria-hidden="true" /> : null}
            {sending ? t.sending : t.submit}
          </button>
          <button type="button" className={styles.ghostButton} onClick={onDismiss} disabled={sending}>
            {t.dismiss}
          </button>
        </div>
      </form>
    </section>
  );
});
