import { SITE } from "@/lib/site";
import { VCARD_PHOTO_JPEG_BASE64 } from "@/lib/vcard-photo";

// The "save my number" half of the digital business card (/card · /de/visitenkarte · /it/biglietto).
//
// Everything else on that page is a link someone can lose: a WhatsApp thread scrolls away, a
// browser tab gets closed. The address book is the only place a contact survives, so this route
// is the one that actually has to work — on a stranger's phone, in whatever in-app browser
// WhatsApp happens to open.
//
// vCard 3.0, deliberately, not 4.0: 3.0 is what iOS/macOS Contacts, Google Contacts and Outlook
// have exported (and therefore read best) for fifteen years, Outlook never supported 4.0 at all,
// and iCloud is documented to reject 4.0 files outright. The way 4.0 fails is not "one field
// missing", it is "the file does not open" — and the page is worthless if the file does not open.
//
// Also reachable at /francesco-modolo.vcf via a rewrite in next.config.ts: some in-app browsers
// ignore Content-Disposition, and a saved file called "vcard" with no extension is one Android
// cannot hand to Contacts.
export const dynamic = "force-dynamic";

const CRLF = "\r\n";

/**
 * Escape a vCard TEXT value (RFC 2426 §2.4.2): backslash first, then newline, comma, semicolon.
 * Backslash must come first or it re-escapes the ones just inserted.
 *
 * NOT applied to URL (a URI value — escaping it breaks the link), to TEL (E.164 digits), to the
 * base64 PHOTO (data, not text), or to the structural semicolons that separate the components of
 * N and ADR. And the colon is deliberately NOT escaped: the RFC paragraph that demands it applies
 * only to nested-vCard values, and `\:` is not in the text grammar's escape list — several
 * parsers would show the backslash literally.
 */
function esc(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Fold a content line to 75 OCTETS (RFC 2425 §5.8.1), continuation lines starting with a single
 * space — which itself counts toward the 75, hence 74 octets of payload after the first line.
 *
 * Octets, not characters: "für" is 3 characters and 4 bytes, and a cut that lands inside a UTF-8
 * sequence puts a broken glyph in someone's address book. The loop backs off while the next byte
 * is a continuation byte (0b10xxxxxx) so a multi-octet character always stays contiguous.
 *
 * In practice only PHOTO (~13.5 KB of base64, ~183 physical lines) needs this, but folding every
 * line keeps one rule instead of two.
 */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;

  const out: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    const limit = out.length === 0 ? 75 : 74;
    let end = Math.min(start + limit, bytes.length);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((out.length === 0 ? "" : " ") + bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return out.join(CRLF);
}

type Lang = "de" | "it" | "en";

// The role line, verbatim from the printed card, so the contact someone saves says exactly what
// the cardboard in their pocket says.
const TITLE: Record<Lang, string> = {
  de: "Damit Ihr Betrieb gefunden wird",
  it: "Ti faccio trovare dai clienti in zona",
  en: "Getting your business found",
};

const NOTE: Record<Lang, string> = {
  de: "Webseiten, Google-Eintrag und Werbung für kleine Betriebe. Den Preis machen wir vorher ab.",
  it: "Siti web, scheda Google e pubblicità per piccole attività. Il prezzo lo decidiamo prima.",
  en: "Websites, Google listing and advertising for small businesses. We agree the price before I start.",
};

export function GET(request: Request) {
  const url = new URL(request.url);
  const p = url.searchParams.get("lang");
  const lang: Lang = p === "de" || p === "it" ? p : "en";

  // The Swiss number is always the preferred one, on every language — it is the business line,
  // the WhatsApp inbox and the number on the Google profile. Nothing here reads geolocation: a
  // saved contact is permanent, and a mis-read IP that pins +39 as a Winterthur client's main
  // number is a mistake this page can never undo. The Italian number rides along only on the
  // Italian card, exactly as the page shows it.
  const a = SITE.address;
  const ai = SITE.addressIt;

  const lines = [
    "BEGIN:VCARD",
    // VERSION must stay on the second line: 4.0 requires it and many simple parsers assume it.
    "VERSION:3.0",
    // N is Family;Given;Additional;Prefix;Suffix — all five components, even empty, or iOS files
    // the entry under a blank surname.
    `N:${esc("Modolo")};${esc("Francesco")};;;`,
    `FN:${esc(SITE.founder)}`,
    `ORG:${esc(SITE.name)}`,
    `TITLE:${esc(TITLE[lang])}`,
    `TEL;TYPE=CELL,VOICE,PREF:${SITE.phone}`,
    ...(lang === "it" ? [`TEL;TYPE=WORK,VOICE:${SITE.phoneIt}`] : []),
    `EMAIL;TYPE=INTERNET,PREF:${SITE.email}`,
    `URL:${SITE.url}`,
    // ADR is PO;Extended;Street;Locality;Region;PostalCode;Country — seven components, always.
    // The Region component is left empty on purpose: a Swiss postal address does not carry the
    // canton, and leaving "Zürich" out also keeps this line pure ASCII.
    `ADR;TYPE=WORK:;;${esc(a.street)};${esc(a.locality)};;${esc(a.postalCode)};${esc("Schweiz")}`,
    // Second address only on the Italian card, and typed HOME rather than WORK — two ADRs both
    // labelled "work" show up on an iPhone as two indistinguishable entries.
    ...(lang === "it"
      ? [`ADR;TYPE=HOME:;;${esc(ai.street)};${esc(ai.locality)};${esc(ai.region)};${esc(ai.postalCode)};${esc("Italia")}`]
      : []),
    `NOTE:${esc(NOTE[lang])}`,
    // vCard 3.0 syntax: lowercase `b`, and TYPE=JPEG without the image/ prefix (that is 4.0's
    // MEDIATYPE). A `data:` URI here would be 4.0 and can make the photo vanish.
    `PHOTO;ENCODING=b;TYPE=JPEG:${VCARD_PHOTO_JPEG_BASE64}`,
    // REV is what tells a phone that re-saving the card is an UPDATE rather than a duplicate.
    // ⚠️ Bump this by hand whenever anything above changes — lib/site.ts, the TITLE/NOTE strings
    // here, OR a re-run of scripts/biglietto-digitale.mjs, which rewrites the photo in
    // lib/vcard-photo.ts without touching this line. Otherwise the people who already saved the
    // contact never get the new details.
    "REV:2026-09-18T00:00:00Z",
    "END:VCARD",
  ];

  // The trailing CRLF is not decoration: the grammar ends with "END:VCARD" CRLF, and some Android
  // parsers drop the last property without it.
  const body = lines.map(fold).join(CRLF) + CRLF;
  const bytes = new TextEncoder().encode(body);

  // attachment vs inline is a REAL open question and is not settled here.
  //
  // What is settled: no browser ever renders a vCard as raw text — Chromium and WebKit both list
  // text/vcard among the text/* types they refuse to display — so the header protects against
  // nothing, it only picks the route: download-then-open, or preview-then-share-sheet.
  // What is not settled: which of the two costs fewer taps on current iOS. On iOS 13+ neither is
  // one tap (a preview opens and the user must go through the share sheet), which is why the page
  // carries the instruction.
  // So: `attachment` is the default because it is unambiguous on desktop and Android, and
  // `?inline=1` flips it — open both on a real phone, from inside WhatsApp, and keep the winner.
  const disposition = url.searchParams.get("inline") === "1" ? "inline" : "attachment";

  return new Response(bytes, {
    headers: {
      "Content-Type": "text/vcard; charset=utf-8",
      "Content-Disposition": `${disposition}; filename="Francesco-Modolo.vcf"`,
      // Counted in bytes, never body.length — "für" and "pubblicità" are one character and two
      // octets each, and a short Content-Length truncates the file.
      "Content-Length": String(bytes.byteLength),
      // The body varies with ?lang. `private` keeps an operator or corporate proxy from handing
      // one visitor's variant to another.
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
