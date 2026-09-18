import Image from "next/image";
import Link from "next/link";
import CardShare from "@/components/card-share";
import { SITE } from "@/lib/site";
import { googleProfileUrl } from "@/lib/review-links";
import { LOCALES, localizedHref, type Locale } from "@/lib/i18n";

// The digital business card — /card · /de/visitenkarte · /it/biglietto.
//
// It stands in for the printed 85×55 card until that arrives, and it is built to the same three
// rules as the cardboard: one typeface (Space Grotesk), gold only as a line, and — the editorial
// rule that keeps this from turning into a landing page over the next three commits — IF A WORD
// IS NOT ON THE PRINTED CARD, IT DOES NOT GO ON THIS PAGE. The only declared exceptions are the
// button labels, the reviews line and the .vcf rescue text: three things a piece of card cannot do.
//
// So: no prices, no contact form, no portfolio thumbnails, no sticky bar, no cookie banner, no
// section of "why choose me". Whoever opens this link has usually just shaken his hand, and has
// exactly three questions — is this him, what does he do, how do I reach him. Nothing else.
//
// Deliberately a SERVER component with one tiny client island (CardShare). No framer-motion, no
// Lenis (see the opt-out in components/smooth-scroll.tsx), no entrance animation, no grain
// overlay — .mds-grain is position:fixed z-35 and would sit exactly on the gold button. On one
// bar of signal inside WhatsApp's in-app browser, an animated entrance is half a second in which
// the primary button exists but cannot be pressed.

type Copy = {
  role: string;
  promise: string;
  reviews: string;
  reviewsCta: string;
  save: string;
  saveHint: string;
  rescueSummary: string;
  rescueIos: string;
  rescueAndroid: string;
  rescueNumber: string;
  whatsapp: string;
  whatsappPrefill: string;
  labelPhone: string;
  labelEmail: string;
  labelAddress: string;
  labelItaly: string;
  servicesLabel: string;
  services: string[];
  priceLine: string;
  qrSummary: string;
  qrHint: string;
  share: string;
  copied: string;
  imprint: string;
  privacy: string;
  backToSite: string;
};

// Register, per language, follows the PRINTED card, not the homepage:
//   DE = Sie ("Sie schreiben, ich antworte selber"), IT = Lei ("Mi scriva, rispondo io di
//   persona"), EN = plain direct address.
// The homepage says du/tu. That divergence is deliberate here — this page is the twin of the
// cardboard, and the cardboard was signed off last, on 15 Sep 2026.
//
// `role`, `promise`, `servicesLabel`, `services` and `priceLine` are VERBATIM from the print
// files. Do not improve them here: the two objects have to match word for word, or the client
// who has both notices the seam.
const COPY: Record<Locale, Copy> = {
  de: {
    role: "Damit Ihr Betrieb gefunden wird",
    promise: "Sie schreiben, ich antworte selber",
    reviews: "Vier Google-Bewertungen, alle fünf Sterne",
    reviewsCta: "Auf Google nachlesen",
    save: "Kontakt speichern",
    saveHint: "Landet mit Foto, Nummer und Adresse in Ihren Kontakten.",
    rescueSummary: "Nichts passiert?",
    rescueIos: "Auf dem iPhone öffnet sich zuerst eine Vorschau: oben auf «Teilen» tippen und «Zu Kontakten hinzufügen» wählen.",
    rescueAndroid: "Auf Android die heruntergeladene Datei antippen.",
    rescueNumber: "Oder einfach die Nummer speichern:",
    whatsapp: "Auf WhatsApp schreiben",
    whatsappPrefill: "Guten Tag Francesco, ich habe Ihre Visitenkarte. Ich hätte eine Frage zu meinem Betrieb.",
    labelPhone: "TELEFON",
    labelEmail: "E-MAIL",
    labelAddress: "ADRESSE",
    labelItaly: "IN ITALIEN",
    servicesLabel: "WAS ICH MACHE",
    services: ["Webseiten", "Google-Eintrag", "Werbung im Internet", "Fotos und Videos", "Flyer und Drucksachen"],
    priceLine: "Den Preis machen wir vorher ab.",
    qrSummary: "QR-Code zeigen",
    qrHint: "Mit der Handykamera scannen — die Karte öffnet sich auf dem anderen Handy.",
    share: "Karte teilen",
    copied: "Link kopiert",
    imprint: "Impressum",
    privacy: "Datenschutz",
    backToSite: "modolodigitalstudio.ch",
  },
  it: {
    role: "Ti faccio trovare dai clienti in zona",
    promise: "Mi scriva, rispondo io di persona",
    reviews: "Quattro recensioni su Google, tutte 5 stelle",
    reviewsCta: "Le legga su Google",
    save: "Salva il contatto",
    saveHint: "Finisce in rubrica con foto, numero e indirizzo.",
    rescueSummary: "Non succede niente?",
    rescueIos: "Su iPhone si apre prima un'anteprima: tocchi «Condividi» in alto e scelga «Aggiungi ai contatti».",
    rescueAndroid: "Su Android tocchi il file scaricato.",
    rescueNumber: "Oppure salvi direttamente il numero:",
    whatsapp: "Mi scriva su WhatsApp",
    whatsappPrefill: "Buongiorno Francesco, ho il suo biglietto. Vorrei parlarle della mia attività.",
    labelPhone: "TELEFONO",
    labelEmail: "EMAIL",
    labelAddress: "INDIRIZZO",
    labelItaly: "IN ITALIA",
    servicesLabel: "COSA FACCIO",
    services: ["Siti web", "Scheda Google", "Pubblicità online", "Foto e video", "Flyer e stampati"],
    priceLine: "Il prezzo lo decidiamo prima.",
    qrSummary: "Mostra il QR",
    qrHint: "Lo inquadri con la fotocamera: questa pagina si apre sul suo telefono.",
    share: "Condivida il biglietto",
    copied: "Link copiato",
    imprint: "Note legali",
    privacy: "Privacy",
    backToSite: "modolodigitalstudio.ch",
  },
  en: {
    role: "Getting your business found",
    promise: "Write to me, I answer myself",
    reviews: "Four Google reviews, all five stars",
    reviewsCta: "Read them on Google",
    save: "Save my contact",
    saveHint: "Lands in your contacts with photo, number and address.",
    rescueSummary: "Nothing happened?",
    rescueIos: "On iPhone a preview opens first: tap “Share” at the top and choose “Add to Contacts”.",
    rescueAndroid: "On Android, tap the downloaded file.",
    rescueNumber: "Or just save the number:",
    whatsapp: "Message me on WhatsApp",
    whatsappPrefill: "Hello Francesco, I have your card. I would like to talk about my business.",
    labelPhone: "PHONE",
    labelEmail: "EMAIL",
    labelAddress: "ADDRESS",
    labelItaly: "IN ITALY",
    servicesLabel: "WHAT I DO",
    services: ["Websites", "Google listing", "Online advertising", "Photos and video", "Flyers and print"],
    priceLine: "We agree the price before I start.",
    qrSummary: "Show the QR code",
    qrHint: "Scan it with a phone camera — the card opens on the other phone.",
    share: "Share this card",
    copied: "Link copied",
    imprint: "Legal Notice",
    privacy: "Privacy Policy",
    backToSite: "modolodigitalstudio.ch",
  },
};

// The contact details do NOT follow geolocation, and that is a decision, not an oversight.
//
// A saved contact is permanent: if a mis-read IP pins +39 as the main number in a Winterthur
// plumber's address book, nothing on this page will ever correct it. So every language shows the
// Swiss number and the Winterthur address — the business line, the WhatsApp inbox and the Google
// profile are all Swiss — and the Italian page adds the Italian number as a clearly labelled
// SECOND row rather than swapping the first. Nobody has to guess, and the page and the .vcf can
// never disagree.
const MAPS_CH = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  `${SITE.address.street}, ${SITE.address.postalCode} ${SITE.address.locality}`,
)}`;

function Star() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-3 w-3" aria-hidden="true">
      <path d="M12 2.5l2.9 5.9 6.5.95-4.7 4.58 1.11 6.47L12 17.35l-5.81 3.05 1.11-6.47-4.7-4.58 6.5-.95z" />
    </svg>
  );
}

/** One hairline contact row: caps label above, the value below, nothing that looks like a button. */
function Row({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <a
      href={href}
      className="flex min-h-[60px] flex-col justify-center gap-0.5 border-t px-1 py-3 transition-colors hover:bg-[#17130e]/[0.035]"
      style={{ borderColor: "var(--gold-line)" }}
    >
      <span className="card-caps" style={{ color: "var(--gilt)" }}>{label}</span>
      <span className="tnum text-[16px] font-medium" style={{ fontFamily: "var(--font-space)", color: "#17130e" }}>
        {value}
      </span>
    </a>
  );
}

function GoldButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      // No `download` attribute on purpose: Content-Disposition already forces the download, and
      // for same-origin links the attribute OVERRIDES it — which would silently defeat the
      // ?inline=1 switch in app/api/vcard/route.ts, the whole point of which is to be tried on a
      // real phone. A webview that ignores the header would not honour the attribute either.
      className="gold-glow flex w-full items-center justify-center gap-2 rounded-full px-6 py-4 text-sm font-semibold text-[#17130E]"
      style={{ background: "linear-gradient(100deg, #e8c877, #b5893f)", fontFamily: "var(--font-space)" }}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {children}
    </a>
  );
}

function Qr({ hint }: { hint: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border p-5" style={{ borderColor: "var(--gold-line)", background: "var(--paper)" }}>
      {/* Plain <img>, not next/image: the SVG is 1.5 KB, has no raster to optimize, and must be
          crisp at any size — running it through the optimizer would only add a round trip. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/qr-biglietto.svg" alt="" width={188} height={188} className="h-[188px] w-[188px]" />
      <p className="text-center text-[12px] leading-relaxed" style={{ color: "rgba(23,19,14,0.62)" }}>{hint}</p>
    </div>
  );
}

export default function BusinessCard({ lang }: { lang: Locale }) {
  const t = COPY[lang];
  const wa = `https://wa.me/${SITE.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(t.whatsappPrefill)}`;
  // NOT /api/vcard: the rewrite in next.config.ts exists precisely so the path ends in .vcf,
  // for the in-app browsers that name a download after the last path segment instead of reading
  // Content-Disposition. Linking to /api/vcard would have left that safety net unconnected.
  const vcard = `/francesco-modolo.vcf?lang=${lang}`;
  const cardUrl = SITE.url + localizedHref(lang, "/biglietto");
  const year = new Date().getFullYear();

  return (
    <main id="main" tabIndex={-1} className="min-h-screen w-full pt-6 pb-8 outline-none" style={{ background: "var(--ink-bg)", color: "#17130e" }}>
      <div className="mx-auto flex w-full max-w-[420px] flex-col gap-4 px-4">

        {/* ---- the card itself: the printed front, alive ---- */}
        <section className="rounded-2xl border p-[22px]" style={{ borderColor: "var(--gold-line)", background: "var(--paper)", boxShadow: "0 18px 40px -26px rgba(23,19,14,0.45)" }}>
          <div className="flex items-center gap-3">
            <Image src="/logo-mark.png" alt="" width={34} height={34} className="h-[34px] w-[34px]" priority />
            <span className="card-caps" style={{ color: "var(--gilt)" }}>MODOLO DIGITAL STUDIO</span>
          </div>

          <div className="mt-6 flex items-center gap-4">
            {/* The face, untreated, on the cream it was already shot against. It is the identity
                check — five minutes after a handshake the unspoken question is "is this the same
                guy", and a monogram never answers it. (What Francesco rejected for print was the
                twelve photographic TREATMENTS, not the existence of a portrait: this is the same
                avatar the homepage already uses.) */}
            <Image
              src="/founder-avatar.webp"
              alt=""
              width={128}
              height={128}
              priority
              sizes="64px"
              className="h-16 w-16 flex-none rounded-full object-cover ring-1 ring-[#17130e]/10"
            />
            <div className="min-w-0">
              <h1 className="display-space text-[22px] leading-tight" style={{ color: "#17130e" }}>{SITE.founder}</h1>
              <p className="mt-1 text-[14px] leading-snug" style={{ color: "rgba(23,19,14,0.72)" }}>{t.role}</p>
            </div>
          </div>

          <p className="mt-5 border-t pt-4 text-[13px]" style={{ borderColor: "var(--gold-line)", color: "var(--gilt)" }}>
            {t.promise}
          </p>
        </section>

        {/* ---- proof, BEFORE the ask ---- */}
        {/* Links to the profile so the four reviews can be READ. Never to /bewertung: that route
            opens the review composer, and asking a stranger to rate you before you have done
            anything for them is the one move that makes four real reviews look worse than none. */}
        <a
          href={googleProfileUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 px-2 text-center text-[13px]"
          style={{ color: "rgba(23,19,14,0.72)" }}
        >
          <span className="flex items-center gap-0.5" style={{ color: "var(--gilt)" }} aria-hidden="true">
            <Star /><Star /><Star /><Star /><Star />
          </span>
          <span>{t.reviews}</span>
          <span className="underline underline-offset-2" style={{ color: "var(--gilt)" }}>{t.reviewsCta}</span>
        </a>

        {/* ---- the one thing this page exists to make happen ---- */}
        <div className="mt-1">
          <GoldButton href={vcard}>{t.save}</GoldButton>
          <p className="mt-2 px-2 text-center text-[11px] leading-relaxed" style={{ color: "rgba(23,19,14,0.6)" }}>
            {t.saveHint}
          </p>

          {/* The rescue. iOS 13 and later never save a .vcf on the first tap — a preview opens and
              the user has to go through the share sheet — and downloads inside WhatsApp's iOS
              webview are unreliable. So the page says what to do, and gives the plain number as
              the fallback that survives the .vcf failing completely. <details>, so it costs
              nothing to the people for whom it just worked. */}
          <details className="mt-3">
            {/* A quiet line of text, not a bordered pill: an empty-looking button between the
                gold CTA and WhatsApp reads as a third action and competes with both. */}
            <summary className="card-summary card-caps mx-auto w-fit cursor-pointer list-none underline underline-offset-4" style={{ color: "rgba(23,19,14,0.72)" }}>
              {t.rescueSummary}
            </summary>
            <div className="mt-3 flex flex-col gap-2 rounded-xl border px-4 py-3 text-[12px] leading-relaxed" style={{ borderColor: "var(--gold-line)", color: "rgba(23,19,14,0.72)" }}>
              <p>{t.rescueIos}</p>
              <p>{t.rescueAndroid}</p>
              <p className="pt-1">
                {t.rescueNumber}{" "}
                <a href={`tel:${SITE.phone}`} className="tnum font-medium underline underline-offset-2" style={{ color: "#17130e" }}>
                  {SITE.phoneDisplay}
                </a>
              </p>
            </div>
          </details>
        </div>

        {/* ---- the obvious choice for whoever does not save contacts ---- */}
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="flex w-full items-center justify-center gap-2 rounded-full border px-6 py-4 text-sm font-medium"
          style={{ borderColor: "rgba(23,19,14,0.18)", background: "var(--paper)", color: "#17130e", fontFamily: "var(--font-space)" }}
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" style={{ color: "var(--gilt)" }} aria-hidden="true">
            <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.87 9.87 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm5.8 14.06c-.25.69-1.45 1.32-2 1.36-.51.04-1.16.06-1.87-.12-.43-.11-.99-.33-1.7-.64-3-1.3-4.96-4.32-5.11-4.52-.15-.2-1.22-1.62-1.22-3.09 0-1.47.77-2.19 1.04-2.49.27-.3.59-.37.79-.37.2 0 .39 0 .57.01.18.01.43-.07.67.51.25.6.84 2.07.91 2.22.07.15.12.32.02.52-.1.2-.15.32-.3.5-.15.17-.31.39-.44.52-.15.15-.3.31-.13.61.17.3.76 1.25 1.63 2.03 1.12 1 2.06 1.31 2.36 1.46.3.15.47.12.65-.07.17-.2.75-.87.95-1.17.2-.3.4-.25.67-.15.27.1 1.72.81 2.02.96.3.15.5.22.57.35.07.12.07.72-.18 1.41z" />
          </svg>
          {t.whatsapp}
        </a>

        {/* ---- the details, shaped like the address book the phone already taught them to read ---- */}
        <div className="mt-2 flex flex-col">
          <Row label={t.labelPhone} value={SITE.phoneDisplay} href={`tel:${SITE.phone}`} />
          <Row label={t.labelEmail} value={SITE.email} href={`mailto:${SITE.email}`} />
          <Row
            label={t.labelAddress}
            value={`${SITE.address.street} · ${SITE.address.postalCode} ${SITE.address.locality}`}
            href={MAPS_CH}
          />
          {/* Italian page only: a second, labelled line. Never a swap of the first one. */}
          {lang === "it" && (
            <Row
              label={t.labelItaly}
              value={`${SITE.phoneItDisplay} · ${SITE.addressIt.locality}`}
              href={`tel:${SITE.phoneIt}`}
            />
          )}
        </div>

        {/* ---- the back of the card, verbatim ---- */}
        <section className="mt-6">
          <h2 className="card-caps" style={{ color: "var(--gilt)" }}>{t.servicesLabel}</h2>
          <ul className="mt-2 flex flex-col">
            {/* Inert on purpose: on the cardboard these are not links, and every link here is an
                exit from the only page that has one thing to make happen. */}
            {t.services.map((s) => (
              <li key={s} className="border-t py-3 text-[15px]" style={{ borderColor: "var(--gold-line)", color: "rgba(23,19,14,0.9)" }}>
                {s}
              </li>
            ))}
          </ul>
        </section>

        <p className="my-6 text-center text-[17px]" style={{ fontFamily: "var(--font-space)", fontWeight: 500, color: "var(--gilt)" }}>
          {t.priceLine}
        </p>

        {/* ---- the QR: closed on a phone, always open on a screen he is holding up ---- */}
        <details className="mds-qr-fold rounded-xl border px-4 py-3" style={{ borderColor: "var(--gold-line)" }}>
          <summary className="card-summary card-caps cursor-pointer list-none text-center" style={{ color: "var(--gilt)" }}>
            {t.qrSummary}
          </summary>
          <div className="mt-4">
            <Qr hint={t.qrHint} />
          </div>
        </details>
        <div className="mds-qr-static">
          <Qr hint={t.qrHint} />
        </div>

        {/* Repeated ONCE, last, after the price line. Not a sticky bar: WhatsApp's in-app browser
            fights with a fixed bottom bar, and the page is short enough not to need one. */}
        <div className="mt-2">
          <GoldButton href={vcard}>{t.save}</GoldButton>
        </div>

        <div className="mt-4 flex justify-center">
          <CardShare url={cardUrl} label={t.share} copied={t.copied} />
        </div>

        {/* ---- foot ---- */}
        <footer className="mt-8 flex flex-col items-center gap-3 border-t pt-6 pb-4 text-center" style={{ borderColor: "var(--gold-line)" }}>
          <Link href={localizedHref(lang, "/")} className="text-[12px] underline underline-offset-2" style={{ color: "var(--gilt)" }}>
            {t.backToSite}
          </Link>
          <div className="flex items-center gap-3">
            {LOCALES.map((l) => (
              <Link
                key={l}
                href={localizedHref(l, "/biglietto")}
                aria-current={l === lang ? "page" : undefined}
                className={l === lang ? "card-caps underline underline-offset-4" : "card-caps"}
                style={{ color: l === lang ? "var(--gilt)" : "rgba(31,27,22,0.72)" }}
              >
                {l}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-4">
            <Link href={localizedHref(lang, "/impressum")} className="card-caps" style={{ color: "rgba(31,27,22,0.72)" }}>{t.imprint}</Link>
            <Link href={localizedHref(lang, "/privacy")} className="card-caps" style={{ color: "rgba(31,27,22,0.72)" }}>{t.privacy}</Link>
          </div>
          <span className="card-caps tnum" style={{ color: "rgba(31,27,22,0.72)" }}>© {year} Modolo Digital Studio</span>
        </footer>
      </div>
    </main>
  );
}
