"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import SiteNav from "@/components/site-nav";
import SiteFooter from "@/components/site-footer";
import { localizedHref, type Locale } from "@/lib/i18n";

export type Lang = Locale;
export type LegalKind = "impressum" | "privacy";

type Section = { heading: string; body: string[] };
type Doc = { title: string; date: string; sections: Section[] };

const ui: Record<Lang, { back: string; updated: string; kicker: string }> = {
  en: { back: "Back to homepage", updated: "Last updated", kicker: "Legal" },
  de: { back: "Zurück zur Startseite", updated: "Stand", kicker: "Rechtliches" },
  it: { back: "Torna alla homepage", updated: "Ultimo aggiornamento", kicker: "Note legali" },
};

const content: Record<LegalKind, Record<Lang, Doc>> = {
  impressum: {
    en: {
      title: "Legal Notice",
      date: "June 2026",
      sections: [
        {
          heading: "Responsible for the content of this website",
          body: ["Francesco Modolo\nModolo Digital Studio (sole proprietorship)\nScheideggstrasse 18\n8400 Winterthur\nSwitzerland"],
        },
        {
          heading: "Contact",
          body: ["Email: info@modolodigitalstudio.ch\nPhone: +41 77 223 79 00"],
        },
        {
          heading: "Disclaimer",
          body: [
            "The author assumes no liability for the correctness, accuracy, timeliness, reliability or completeness of the information. Liability claims against the author for material or immaterial damage resulting from access to, use or non-use of the published information, from misuse of the connection or from technical faults are excluded.",
          ],
        },
        {
          heading: "Liability for links",
          body: [
            "References and links to third-party websites lie outside our area of responsibility. We accept no responsibility for such websites. Access to and use of such websites is at the user's own risk.",
          ],
        },
        {
          heading: "Copyright",
          body: [
            "The copyright and all other rights to content, images, photos or other files on this website belong exclusively to Modolo Digital Studio or to the specifically named rights holders. The written consent of the copyright holder must be obtained in advance for the reproduction of any element.",
          ],
        },
      ],
    },
    de: {
      title: "Impressum",
      date: "Juni 2026",
      sections: [
        {
          heading: "Verantwortlich für den Inhalt dieser Website",
          body: ["Francesco Modolo\nModolo Digital Studio (Einzelunternehmen)\nScheideggstrasse 18\n8400 Winterthur\nSchweiz"],
        },
        {
          heading: "Kontakt",
          body: ["E-Mail: info@modolodigitalstudio.ch\nTelefon: +41 77 223 79 00"],
        },
        {
          heading: "Haftungsausschluss",
          body: [
            "Der Autor übernimmt keine Gewähr für die Richtigkeit, Genauigkeit, Aktualität, Zuverlässigkeit und Vollständigkeit der Informationen. Haftungsansprüche gegen den Autor wegen Schäden materieller oder immaterieller Art, die aus dem Zugriff oder der Nutzung bzw. Nichtnutzung der veröffentlichten Informationen, durch Missbrauch der Verbindung oder durch technische Störungen entstanden sind, werden ausgeschlossen.",
          ],
        },
        {
          heading: "Haftung für Links",
          body: [
            "Verweise und Links auf Webseiten Dritter liegen ausserhalb unseres Verantwortungsbereichs. Es wird jegliche Verantwortung für solche Webseiten abgelehnt. Der Zugriff und die Nutzung solcher Webseiten erfolgen auf eigene Gefahr des jeweiligen Nutzers.",
          ],
        },
        {
          heading: "Urheberrecht",
          body: [
            "Die Urheber- und alle anderen Rechte an Inhalten, Bildern, Fotos oder anderen Dateien auf dieser Website gehören ausschliesslich Modolo Digital Studio oder den speziell genannten Rechtsinhabern. Für die Reproduktion jeglicher Elemente ist die schriftliche Zustimmung der Urheberrechtsträger im Voraus einzuholen.",
          ],
        },
      ],
    },
    it: {
      title: "Note legali",
      date: "Giugno 2026",
      sections: [
        {
          heading: "Responsabile del contenuto di questo sito web",
          body: ["Francesco Modolo\nModolo Digital Studio (ditta individuale)\nScheideggstrasse 18\n8400 Winterthur\nSvizzera"],
        },
        {
          heading: "Contatti",
          body: ["E-mail: info@modolodigitalstudio.ch\nTelefono: +41 77 223 79 00"],
        },
        {
          heading: "Esclusione di responsabilità",
          body: [
            "L'autore non si assume alcuna responsabilità in merito alla correttezza, all'accuratezza, all'attualità, all'affidabilità e alla completezza delle informazioni. Sono escluse le pretese di responsabilità nei confronti dell'autore per danni di natura materiale o immateriale derivanti dall'accesso, dall'utilizzo o dal mancato utilizzo delle informazioni pubblicate, da un uso improprio della connessione o da problemi tecnici.",
          ],
        },
        {
          heading: "Responsabilità per i link",
          body: [
            "I riferimenti e i collegamenti a siti web di terzi sono al di fuori del nostro ambito di responsabilità. Si declina ogni responsabilità per tali siti web. L'accesso e l'utilizzo di tali siti avvengono a rischio e pericolo dell'utente.",
          ],
        },
        {
          heading: "Diritto d'autore",
          body: [
            "I diritti d'autore e tutti gli altri diritti relativi a contenuti, immagini, foto o altri file presenti su questo sito appartengono esclusivamente a Modolo Digital Studio o ai titolari dei diritti espressamente indicati. Per la riproduzione di qualsiasi elemento è necessario ottenere preventivamente il consenso scritto del titolare dei diritti.",
          ],
        },
      ],
    },
  },
  privacy: {
    en: {
      title: "Privacy Policy",
      date: "June 2026",
      sections: [
        {
          heading: "Overview and data controller",
          body: [
            "This privacy policy explains what personal data we collect when you visit modolodigitalstudio.ch and how we process it. We treat your data confidentially and in accordance with the Swiss Federal Act on Data Protection (FADP) and, where applicable, the EU General Data Protection Regulation (GDPR).",
            "The controller responsible for data processing on this website is:\nFrancesco Modolo\nModolo Digital Studio\nScheideggstrasse 18, 8400 Winterthur, Switzerland\nEmail: info@modolodigitalstudio.ch",
          ],
        },
        {
          heading: "Hosting and server log files",
          body: [
            "Our website is hosted by Vercel Inc. (340 S Lemon Ave #4133, Walnut, CA 91789, USA). When you visit the site, Vercel automatically collects and stores technical information transmitted by your browser, such as your IP address, browser type and version, operating system, the referring page, and the date and time of access. This data is used solely to operate, secure and ensure the stability of the website. The legal basis is our legitimate interest in a secure and reliable online presence.",
          ],
        },
        {
          heading: "Contact form",
          body: [
            "If you use our contact form, we collect the data you enter — your name, email address, company (optional) and your message — in order to process your enquiry and respond to you. The form is processed through Formspree, Inc. (2000 Lakewood Way, Harahan, LA 70123, USA), which forwards the submitted data to us by email on our behalf. We use this data only to handle your request and do not pass it on to any other third parties.",
          ],
        },
        {
          heading: "Transfer abroad",
          body: [
            "Because Vercel and Formspree are based in the United States, your data may be processed outside Switzerland and the EU. These providers commit to appropriate safeguards (such as standard contractual clauses) to ensure an adequate level of data protection.",
          ],
        },
        {
          heading: "Cookies and analytics",
          body: [
            "This website uses Vercel Analytics and Vercel Speed Insights to measure aggregate traffic and performance. These tools are privacy-friendly: they do not set cookies, do not track you across other websites and do not build personal profiles. We use no advertising or third-party tracking. Fonts are hosted directly on our server (via next/font), so no connection to external font providers such as Google Fonts is established when you load the page.",
          ],
        },
        {
          heading: "Data retention",
          body: [
            "We retain personal data only as long as necessary for the purposes described or as required by law. Enquiries sent via the contact form are kept for as long as needed to process your request and for any subsequent follow-up.",
          ],
        },
        {
          heading: "Your rights",
          body: [
            "Within the limits of applicable law, you have the right to obtain information about the personal data we hold about you and to request its correction, deletion or restriction. You may also object to certain processing. To exercise these rights, please contact us at info@modolodigitalstudio.ch.",
          ],
        },
        {
          heading: "Data security",
          body: [
            "We use technical and organisational security measures to protect your data. This website is encrypted with SSL/TLS (HTTPS) to protect the transmission of your information.",
          ],
        },
        {
          heading: "Changes to this policy",
          body: [
            "We may update this privacy policy to reflect changes to our website or to legal requirements. The version published on this page at any given time applies.",
          ],
        },
      ],
    },
    de: {
      title: "Datenschutzerklärung",
      date: "Juni 2026",
      sections: [
        {
          heading: "Überblick und Verantwortlicher",
          body: [
            "Diese Datenschutzerklärung informiert Sie darüber, welche personenbezogenen Daten wir erheben, wenn Sie modolodigitalstudio.ch besuchen, und wie wir diese verarbeiten. Wir behandeln Ihre Daten vertraulich und im Einklang mit dem Schweizer Datenschutzgesetz (DSG) sowie, soweit anwendbar, der Datenschutz-Grundverordnung der EU (DSGVO).",
            "Verantwortlich für die Datenverarbeitung auf dieser Website ist:\nFrancesco Modolo\nModolo Digital Studio\nScheideggstrasse 18, 8400 Winterthur, Schweiz\nE-Mail: info@modolodigitalstudio.ch",
          ],
        },
        {
          heading: "Hosting und Server-Logfiles",
          body: [
            "Unsere Website wird von der Vercel Inc. (340 S Lemon Ave #4133, Walnut, CA 91789, USA) gehostet. Bei jedem Aufruf der Website erfasst und speichert Vercel automatisch technische Informationen, die Ihr Browser übermittelt, wie IP-Adresse, Browsertyp und -version, Betriebssystem, die zuvor besuchte Seite sowie Datum und Uhrzeit des Zugriffs. Diese Daten dienen ausschliesslich dem Betrieb, der Sicherheit und der Stabilität der Website. Rechtsgrundlage ist unser berechtigtes Interesse an einer sicheren und zuverlässigen Online-Präsenz.",
          ],
        },
        {
          heading: "Kontaktformular",
          body: [
            "Wenn Sie unser Kontaktformular nutzen, erheben wir die von Ihnen eingegebenen Daten – Name, E-Mail-Adresse, Unternehmen (optional) und Ihre Nachricht –, um Ihre Anfrage zu bearbeiten und Ihnen zu antworten. Das Formular wird über Formspree, Inc. (2000 Lakewood Way, Harahan, LA 70123, USA) verarbeitet, das die übermittelten Daten in unserem Auftrag per E-Mail an uns weiterleitet. Wir verwenden diese Daten ausschliesslich zur Bearbeitung Ihres Anliegens und geben sie nicht an weitere Dritte weiter.",
          ],
        },
        {
          heading: "Datenübermittlung ins Ausland",
          body: [
            "Da Vercel und Formspree ihren Sitz in den USA haben, können Ihre Daten ausserhalb der Schweiz und der EU verarbeitet werden. Diese Anbieter verpflichten sich zu angemessenen Garantien (etwa Standardvertragsklauseln), um ein angemessenes Datenschutzniveau sicherzustellen.",
          ],
        },
        {
          heading: "Cookies und Analyse",
          body: [
            "Diese Website nutzt Vercel Analytics und Vercel Speed Insights, um aggregierte Zugriffe und die Performance zu messen. Diese Werkzeuge sind datenschutzfreundlich: Sie setzen keine Cookies, verfolgen dich nicht über andere Websites hinweg und erstellen keine persönlichen Profile. Wir verwenden keine Werbung und kein Tracking durch Dritte. Die Schriftarten werden direkt auf unserem Server gehostet (über next/font), sodass beim Laden der Seite keine Verbindung zu externen Schriftanbietern wie Google Fonts hergestellt wird.",
          ],
        },
        {
          heading: "Speicherdauer",
          body: [
            "Wir speichern personenbezogene Daten nur so lange, wie es für die genannten Zwecke erforderlich ist oder gesetzlich vorgeschrieben wird. Über das Kontaktformular gesendete Anfragen werden so lange aufbewahrt, wie es zur Bearbeitung Ihres Anliegens und für allfällige Rückfragen notwendig ist.",
          ],
        },
        {
          heading: "Ihre Rechte",
          body: [
            "Im Rahmen des geltenden Rechts haben Sie das Recht auf Auskunft über die zu Ihrer Person gespeicherten Daten sowie auf deren Berichtigung, Löschung oder Einschränkung. Zudem können Sie bestimmten Verarbeitungen widersprechen. Zur Ausübung dieser Rechte kontaktieren Sie uns unter info@modolodigitalstudio.ch.",
          ],
        },
        {
          heading: "Datensicherheit",
          body: [
            "Wir setzen technische und organisatorische Sicherheitsmassnahmen ein, um Ihre Daten zu schützen. Diese Website ist mit SSL/TLS (HTTPS) verschlüsselt, um die Übertragung Ihrer Daten zu schützen.",
          ],
        },
        {
          heading: "Änderungen dieser Erklärung",
          body: [
            "Wir können diese Datenschutzerklärung anpassen, um Änderungen an unserer Website oder an rechtlichen Vorgaben Rechnung zu tragen. Es gilt die jeweils auf dieser Seite veröffentlichte Fassung.",
          ],
        },
      ],
    },
    it: {
      title: "Informativa sulla privacy",
      date: "Giugno 2026",
      sections: [
        {
          heading: "Panoramica e titolare del trattamento",
          body: [
            "La presente informativa spiega quali dati personali raccogliamo quando visiti modolodigitalstudio.ch e come li trattiamo. Trattiamo i tuoi dati in modo riservato e nel rispetto della Legge federale svizzera sulla protezione dei dati (LPD) e, ove applicabile, del Regolamento generale dell'UE sulla protezione dei dati (GDPR).",
            "Il titolare del trattamento dei dati di questo sito web è:\nFrancesco Modolo\nModolo Digital Studio\nScheideggstrasse 18, 8400 Winterthur, Svizzera\nE-mail: info@modolodigitalstudio.ch",
          ],
        },
        {
          heading: "Hosting e file di log del server",
          body: [
            "Il nostro sito è ospitato da Vercel Inc. (340 S Lemon Ave #4133, Walnut, CA 91789, USA). A ogni visita, Vercel raccoglie e memorizza automaticamente informazioni tecniche trasmesse dal tuo browser, come indirizzo IP, tipo e versione del browser, sistema operativo, pagina di provenienza e data e ora dell'accesso. Questi dati servono esclusivamente al funzionamento, alla sicurezza e alla stabilità del sito. La base giuridica è il nostro legittimo interesse a una presenza online sicura e affidabile.",
          ],
        },
        {
          heading: "Modulo di contatto",
          body: [
            "Quando utilizzi il nostro modulo di contatto, raccogliamo i dati che inserisci – nome, indirizzo e-mail, azienda (facoltativo) e il tuo messaggio – per gestire la tua richiesta e risponderti. Il modulo è elaborato tramite Formspree, Inc. (2000 Lakewood Way, Harahan, LA 70123, USA), che ci inoltra per e-mail i dati inviati per nostro conto. Utilizziamo questi dati esclusivamente per gestire la tua richiesta e non li comunichiamo ad altri terzi.",
          ],
        },
        {
          heading: "Trasferimento dei dati all'estero",
          body: [
            "Poiché Vercel e Formspree hanno sede negli Stati Uniti, i tuoi dati possono essere trattati al di fuori della Svizzera e dell'UE. Questi fornitori si impegnano ad adottare garanzie adeguate (come le clausole contrattuali tipo) per assicurare un livello di protezione dei dati adeguato.",
          ],
        },
        {
          heading: "Cookie e statistiche",
          body: [
            "Questo sito utilizza Vercel Analytics e Vercel Speed Insights per misurare il traffico aggregato e le prestazioni. Questi strumenti rispettano la privacy: non utilizzano cookie, non ti tracciano su altri siti e non creano profili personali. Non utilizziamo pubblicità né tracciamento di terze parti. I caratteri tipografici sono ospitati direttamente sul nostro server (tramite next/font): di conseguenza, durante il caricamento della pagina non viene stabilita alcuna connessione con fornitori di font esterni come Google Fonts.",
          ],
        },
        {
          heading: "Periodo di conservazione",
          body: [
            "Conserviamo i dati personali solo per il tempo necessario alle finalità indicate o richiesto dalla legge. Le richieste inviate tramite il modulo di contatto vengono conservate per il tempo necessario a gestire la tua richiesta ed eventuali contatti successivi.",
          ],
        },
        {
          heading: "I tuoi diritti",
          body: [
            "Nei limiti della legge applicabile, hai il diritto di ottenere informazioni sui dati personali che ti riguardano e di richiederne la rettifica, la cancellazione o la limitazione. Puoi inoltre opporti a determinati trattamenti. Per esercitare questi diritti, contattaci all'indirizzo info@modolodigitalstudio.ch.",
          ],
        },
        {
          heading: "Sicurezza dei dati",
          body: [
            "Adottiamo misure di sicurezza tecniche e organizzative per proteggere i tuoi dati. Questo sito è cifrato con SSL/TLS (HTTPS) per proteggere la trasmissione delle tue informazioni.",
          ],
        },
        {
          heading: "Modifiche alla presente informativa",
          body: [
            "Possiamo aggiornare la presente informativa per riflettere modifiche al sito o agli obblighi di legge. Si applica la versione di volta in volta pubblicata in questa pagina.",
          ],
        },
      ],
    },
  },
};

export default function LegalPage({ kind, lang }: { kind: LegalKind; lang: Lang }) {
  const doc = content[kind][lang];
  const u = ui[lang];

  return (
    <main id="main" tabIndex={-1} className="relative min-h-screen bg-[var(--ink-bg)] text-[var(--ink-text)] outline-none">
      <SiteNav lang={lang} theme="dark" />
      <div className="mds-grain" aria-hidden />
      
      {/* CONTENT */}
      <section className="mx-auto max-w-[1400px] px-6 sm:px-10 lg:px-16 pt-36 pb-20 md:pb-28">
        <Link href={localizedHref(lang, "/")} className="group inline-flex items-center gap-2 text-sm tracking-wide text-[var(--gilt)] transition-colors hover:text-[var(--color-gold)]">
          <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" strokeWidth={1.5} />
          {u.back}
        </Link>

        <div className="mt-12 max-w-3xl">
          <span className="micro-caps text-[var(--gilt)]">{u.kicker}</span>
          <h1 className="display-space mt-4 text-[#f5efe3]" style={{ fontSize: "clamp(2.25rem, 5vw, 4rem)" }}>{doc.title}</h1>
          <p className="micro-caps mt-5 text-[#f5efe3]/45">{u.updated} · {doc.date}</p>
        </div>

        <div className="mt-14 max-w-3xl border-b border-[color:var(--gold-line)]">
          {doc.sections.map((s, i) => (
            <div key={i} className="border-t border-[color:var(--gold-line)] py-8">
              <h2 className="flex gap-4 text-[#f5efe3]">
                <span aria-hidden="true" className="micro-caps tnum shrink-0 pt-1.5 text-[var(--gilt)]">{String(i + 1).padStart(2, "0")}</span>
                <span className="display-space" style={{ fontSize: "clamp(1.25rem, 2.2vw, 1.6rem)" }}>{s.heading}</span>
              </h2>
              <div className="mt-3 pl-0 sm:pl-10">
                {s.body.map((p, j) => (
                  <p key={j} className="mb-3 whitespace-pre-line font-light leading-relaxed text-[#f5efe3]/70 last:mb-0">
                    {p}
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      <SiteFooter lang={lang} marker={u.kicker} />
    </main>
  );
}
