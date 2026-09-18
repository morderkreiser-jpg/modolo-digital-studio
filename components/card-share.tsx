"use client";

import { useState } from "react";

/**
 * The only client-side JavaScript on the business card. Everything else on that page — the
 * WhatsApp link, the QR panel, the contact rows — is static HTML or a <details>, because the
 * page has to paint inside WhatsApp's in-app browser on a Swiss building site, not in a lab.
 *
 * What it buys: the person who received the card can pass it on. That is how a paper card
 * actually spreads — one tradesman hands it to another — and it is the one thing a link can do
 * that cardboard cannot.
 *
 * Degrades in the right direction: no Web Share, no clipboard, no problem — the label just
 * stays put and the URL is visible in the address bar anyway.
 */
export default function CardShare({
  url,
  label,
  copied,
}: {
  url: string;
  label: string;
  copied: string;
}) {
  const [done, setDone] = useState(false);

  async function share() {
    if (typeof navigator !== "undefined" && navigator.share) {
      // The native sheet is better than a copied link: it offers WhatsApp first, which is where
      // this card travels. A dismissed sheet rejects — that is a user choice, not an error.
      try {
        await navigator.share({ url });
        return;
      } catch {
        return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setDone(true);
      window.setTimeout(() => setDone(false), 2400);
    } catch {
      /* Clipboard blocked (insecure context, or an in-app browser that withholds it): the
         address bar still shows the URL, so there is nothing useful to say here. */
    }
  }

  return (
    <button
      type="button"
      onClick={share}
      className="card-caps inline-flex items-center gap-2 rounded-full border px-4 py-2 transition-colors"
      style={{ borderColor: "var(--gold-line)", color: "var(--gilt)" }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" />
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
      </svg>
      <span aria-live="polite">{done ? copied : label}</span>
    </button>
  );
}
