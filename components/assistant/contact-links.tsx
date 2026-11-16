// Direct contact channels (WhatsApp, email, contact page), shown wherever the assistant cannot
// help: errors, the message limit, a failed quote request. Region-aware, because a business can
// answer on a different number per market (e.g. an Italian WhatsApp for visitors from Italy).
import type { ReactNode } from "react";
import type { AssistantStrings } from "@/lib/assistant/i18n";
import { isValidEmail } from "@/lib/assistant/lead-schema";
import { pickText } from "@/lib/assistant/localize";
import type { AssistantLocale, AssistantPublicConfig, PublicContact } from "@/lib/assistant/types";
import { BubbleIcon, LinkIcon, MailIcon } from "./icons";
import { safeLink } from "./markdown";
import { SafeLink, type LinkContext } from "./rich-text";
import styles from "./assistant.module.css";

const REGION_RE = /^[a-z0-9_-]{1,32}$/i;

/** Pricing region of the visitor: the host site's region cookie, else the tenant default. */
export function readRegion(config: AssistantPublicConfig): string {
  const name = config.regionCookie;
  if (!name) return config.defaultRegion;
  for (const part of document.cookie.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1 || part.slice(0, separator).trim() !== name) continue;
    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      if (REGION_RE.test(value)) return value;
    } catch {
      // Malformed percent-encoding: ignore the cookie.
    }
  }
  return config.defaultRegion;
}

/** Tenant contact merged with the region's overrides (field by field). */
export function resolveContact(config: AssistantPublicConfig, region: string): PublicContact {
  const override = config.contactByRegion?.[region];
  return {
    email: override?.email ?? config.contact.email,
    whatsapp: override?.whatsapp ?? config.contact.whatsapp,
    contactUrl: override?.contactUrl ?? config.contact.contactUrl,
  };
}

export function ContactLinks({
  config,
  region,
  locale,
  strings,
  context,
  intro = true,
}: {
  config: AssistantPublicConfig;
  region: string;
  locale: AssistantLocale;
  strings: AssistantStrings;
  context: LinkContext;
  /** Show the "you can also write directly" lead-in (off when the message already says it). */
  intro?: boolean;
}) {
  const contact = resolveContact(config, region);
  const items: ReactNode[] = [];

  const digits = contact.whatsapp?.number.replace(/\D/g, "") ?? "";
  if (contact.whatsapp && digits.length >= 6 && digits.length <= 15) {
    const prefill = pickText(contact.whatsapp.prefill, locale, config.locale);
    const href = `https://wa.me/${digits}${prefill ? `?text=${encodeURIComponent(prefill)}` : ""}`;
    items.push(
      <li key="whatsapp">
        <SafeLink href={href} target="external" context={context} className={styles.contactLink}>
          <BubbleIcon />
          <span>WhatsApp {contact.whatsapp.display}</span>
        </SafeLink>
      </li>,
    );
  }

  if (contact.email && isValidEmail(contact.email)) {
    items.push(
      <li key="email">
        <SafeLink href={`mailto:${contact.email}`} target="direct" context={context} className={styles.contactLink}>
          <MailIcon />
          <span>{contact.email}</span>
        </SafeLink>
      </li>,
    );
  }

  const page = safeLink(pickText(contact.contactUrl, locale, config.locale));
  if (page && page.target !== "direct") {
    items.push(
      <li key="page">
        <SafeLink href={page.href} target={page.target} context={context} className={styles.contactLink}>
          <LinkIcon />
          <span>{strings.contactPage}</span>
        </SafeLink>
      </li>,
    );
  }

  if (items.length === 0) return null;
  return (
    <div className={styles.contacts}>
      {intro ? <p className={styles.contactsIntro}>{strings.contactFallback}</p> : null}
      <ul className={styles.contactList}>{items}</ul>
    </div>
  );
}
