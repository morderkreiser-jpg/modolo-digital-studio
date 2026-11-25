// Sales page copy of «Modolo Voice AI», the AI phone assistant (KI-Telefonassistent).
//
// The website has pages in en/de/it. The French text is ready here, but no French page is routed
// yet (see DECISIONS.md D9 in the private project folder).
//
// Every sentence in this file is a promise to a customer. Facts come only from the list of what is
// true today: pilot phase with three businesses in the Winterthur / Zurich region, the demo plays
// written example conversations, the live voice is switched on with the pilot businesses, no price
// list is shown, live transfer is planned, systems beyond calendar and email are «on request, later».
// No statistics, no guarantees of results, no quotes, logos or ratings, no named providers or
// countries, no «Swiss hosting» or compliance claims. Change a fact here only when it is true.
//
// "en" (British spelling) and "fr" (Swiss French, «vous») carry the same facts and structure as "de".
import type { VoiceLocale } from "@/lib/voice/types";

export interface VoiceLandingContent {
  meta: { title: string; description: string };
  hero: { eyebrow: string; title: string; lead: string; primaryCta: string; secondaryCta: string; pilotNote: string };
  demo: { title: string; lead: string; chooserLabel: string; note: string };
  problem: { title: string; lead: string; situations: Array<{ title: string; text: string }> };
  how: { title: string; steps: Array<{ title: string; text: string }> };
  features: { title: string; items: Array<{ title: string; text: string; status: "pilot" | "planned" }> };
  sectors: { title: string; lead: string };
  integrations: { title: string; lead: string; items: Array<{ name: string; text: string; status: "pilot" | "planned" }> };
  limits: { title: string; items: string[] };
  pilot: { title: string; lead: string; youGet: string[]; iAsk: string[]; priceNote: string; cta: string };
  privacy: { title: string; points: string[]; linkLabel: string };
  faq: { title: string; items: Array<{ q: string; a: string }> };
  contact: { title: string; lead: string; cta: string; whatsappPrefill: string; emailSubject: string };
  plans: {
    title: string;
    note: string;
    items: Array<{ name: string; price: string; minutes: string; extra: string; setup: string; text: string }>;
  };
}

/** Shown only when true. The prices are a proposal the owner has not confirmed yet. */
export const VOICE_LANDING_SHOW_PLANS = false;

const DE: VoiceLandingContent = {
  meta: {
    title: "Modolo Voice AI · KI-Telefonassistent, Winterthur",
    description:
      "Ein KI-Telefonassistent, der für deinen Betrieb abnimmt, wenn du nicht kannst. Pilotphase: Ich suche drei Betriebe in Winterthur und Zürich, die ihn testen.",
  },
  hero: {
    eyebrow: "Modolo Voice AI · Pilotphase",
    title: "Ein KI-Assistent nimmt ab, wenn du nicht kannst.",
    lead: "Du stehst auf der Baustelle, in der Küche oder bei einer Kundin, und das Telefon klingelt. Mein KI-Telefonassistent nimmt für deinen Betrieb ab, sagt gleich, dass er eine KI ist, und notiert die Anfrage Punkt für Punkt. Kurz nach dem Gespräch hast du die Zusammenfassung schriftlich.",
    primaryCta: "Pilotplatz anfragen",
    secondaryCta: "Beispielgespräche ansehen",
    pilotNote: "Pilotphase: Ich suche drei Betriebe in der Region Winterthur und Zürich. Ich richte alles persönlich ein.",
  },
  demo: {
    title: "Ein Anruf, von Anfang bis Ende",
    lead: "Wähle einen Betrieb und lies mit, wie der Assistent das Gespräch führt: vom ersten Satz bis zur Zusammenfassung, die du danach bekommst.",
    chooserLabel: "Beispiel wählen",
    note: "Das sind geschriebene Beispielgespräche, keine Aufnahmen. Die echte Stimme schalte ich bei den Pilotbetrieben ein.",
  },
  problem: {
    title: "Das Telefon klingelt immer im falschen Moment.",
    lead: "Wer anruft, will oft jetzt etwas wissen. Nimmt niemand ab, probieren es manche später nochmals. Andere rufen gleich beim nächsten Betrieb an.",
    situations: [
      {
        title: "Unter dem Lavabo",
        text: "Der Sanitär liegt unter dem Lavabo, die Hände nass. Das Handy vibriert in der Jackentasche, und er kommt nicht dran.",
      },
      {
        title: "19:30, mitten im Service",
        text: "In der Küche kommt ein Bon nach dem anderen. Am Telefon will jemand einen Tisch für sechs, am Samstagabend.",
      },
      {
        title: "Im Treppenhaus",
        text: "Der Zügelmann trägt mit seinem Kollegen ein Sofa in den dritten Stock. Ein Kunde ruft an, weil er nächsten Monat zügeln will.",
      },
      {
        title: "Folien im Haar",
        text: "Die Coiffeuse legt einer Kundin gerade die Folien für die Strähnchen ein. Das Telefon am Empfang klingelt zum dritten Mal.",
      },
    ],
  },
  how: {
    title: "So funktioniert es",
    steps: [
      {
        title: "Du behältst deine Nummer.",
        text: "Bei deinem Telefonanbieter schaltest du eine Umleitung ein: für alle Anrufe, bei besetzt oder wenn niemand abnimmt. Ohne Antwort greift sie im Schweizer Handy- und Festnetz nach etwa 25 Sekunden. Wir richten das zusammen bei dir ein.",
      },
      {
        title: "Der Assistent nimmt ab.",
        text: "Er sagt zuerst, dass er ein KI-Assistent ist und für welchen Betrieb er abnimmt. Dann fragt er der Reihe nach: wer anruft, worum es geht, wo, wann und wie du die Person erreichst.",
      },
      {
        title: "Du liest und rufst zurück.",
        text: "Gleich nach dem Gespräch bekommst du eine schriftliche Zusammenfassung. Wann du zurückrufst, entscheidest du.",
      },
    ],
  },
  features: {
    title: "Was der Assistent kann",
    items: [
      {
        title: "Abnehmen, wenn du nicht kannst",
        text: "Während der Arbeit, wenn besetzt ist oder nach Feierabend. Mit der Umleitung legst du fest, wann er übernimmt.",
        status: "pilot",
      },
      {
        title: "Sagen, dass er eine KI ist",
        text: "Gleich am Anfang, zusammen mit dem Namen deines Betriebs. Er gibt sich nie als Mensch aus.",
        status: "pilot",
      },
      {
        title: "Anfragen sauber aufnehmen",
        text: "Name, Anliegen, Adresse, Wunschtermin und Telefonnummer. Fehlt etwas, fragt er nach.",
        status: "pilot",
      },
      {
        title: "Termine im Kalender",
        text: "Er trägt Termine ein, verschiebt sie oder sagt sie ab. Nach deinen Regeln: welche Leistungen, wie lange, wie kurzfristig.",
        status: "pilot",
      },
      {
        title: "Zusammenfassung nach jedem Anruf",
        text: "Per E-Mail, gleich nach dem Gespräch. Du siehst sofort, wer angerufen hat und worum es geht.",
        status: "pilot",
      },
      {
        title: "Vier Sprachen",
        text: "Deutsch, Italienisch, Englisch und Französisch. Wer Schweizerdeutsch spricht, bekommt die Antwort auf Hochdeutsch. Wie gut der Assistent Dialekt versteht, testen wir in der Pilotphase mit deinen echten Anrufen.",
        status: "pilot",
      },
      {
        title: "Live an dich weiterverbinden",
        text: "Geplant, noch nicht verfügbar. In der Pilotphase nimmt der Assistent die Anfrage auf, und du rufst zurück.",
        status: "planned",
      },
      {
        title: "Anbindung an weitere Systeme",
        text: "Deine Branchensoftware, ein CRM oder WhatsApp Business: auf Anfrage, später.",
        status: "planned",
      },
    ],
  },
  sectors: {
    title: "Für kleine Betriebe mit vollen Tagen",
    lead: "Sanitärinstallateure, Elektriker und andere Handwerker, Zügelfirmen, Reinigungsfirmen, Carrosserien, Restaurants und Hotels, Coiffeure, Kosmetik- und Tattoostudios, Immobilienbüros. Überall dort, wo das Telefon klingelt, während du die Hände voll hast.",
  },
  integrations: {
    title: "Wohin die Anfragen gehen",
    lead: "Die Zusammenfassung per E-Mail funktioniert ab dem ersten Tag. Den Kalender binden wir in der Pilotphase zusammen an. Alles andere kommt später, auf Anfrage.",
    items: [
      {
        name: "Zusammenfassung per E-Mail",
        text: "Nach jedem Anruf, an die Adresse, die du mir gibst. Läuft vom ersten Tag an.",
        status: "pilot",
      },
      {
        name: "Google Kalender",
        text: "Wir binden ihn in der Pilotphase zusammen an. Der Assistent sieht deine freien Zeiten und trägt Termine ein.",
        status: "pilot",
      },
      {
        name: "Outlook-Kalender",
        text: "Wie bei Google: Die Verbindung richten wir in der Pilotphase zusammen ein.",
        status: "pilot",
      },
      {
        name: "Deine eigene Software (Webhook)",
        text: "Die Anfragen gehen direkt in dein Programm. Auf Anfrage, später.",
        status: "planned",
      },
      {
        name: "WhatsApp Business",
        text: "Die Zusammenfassung als WhatsApp-Nachricht. Auf Anfrage, später.",
        status: "planned",
      },
    ],
  },
  limits: {
    title: "Was er nicht macht",
    items: [
      "Er ruft nie jemanden an, um etwas zu verkaufen.",
      "Er gibt sich nicht als Mensch aus.",
      "Er stellt keine Diagnosen und gibt im Notfall keine Anweisungen. Bei Gefahr sagt er, dass man die 112 wählen soll, und gibt die Anfrage an dich weiter.",
      "Er erfindet keine Preise, freien Termine oder Leistungen. Weiss er etwas nicht, sagt er es und nimmt eine Nachricht auf.",
      "Standardmässig zeichnet er den Ton des Gesprächs nicht auf.",
    ],
  },
  pilot: {
    title: "Drei Plätze in der Pilotphase",
    lead: "Ich suche drei Betriebe in der Region Winterthur und Zürich, die den Assistenten mit echten Anrufen ausprobieren. Ich richte alles persönlich ein und bleibe im ersten Monat nah dran.",
    youGet: [
      "Die Einrichtung bei dir vor Ort, zusammen mit mir.",
      "Einen Test mit echten Anrufen, bevor der Assistent für deine Kunden abnimmt.",
      "Einen Assistenten, den ich mit deinen Leistungen, Öffnungszeiten und Regeln vorbereite.",
      "Du behältst deine Nummer und schaltest die Umleitung jederzeit selbst wieder aus.",
    ],
    iAsk: [
      "Ehrliche Rückmeldung, auch wenn etwas nicht klappt.",
      "Die Erlaubnis, im ersten Monat die Zusammenfassungen der Anrufe mit dir durchzugehen.",
      "Am Ende, wenn du magst, eine ehrliche öffentliche Bewertung.",
    ],
    priceNote: "Preis und Bedingungen für die Pilotphase machen wir persönlich ab. Eine Preisliste gibt es noch nicht.",
    cta: "Pilotplatz anfragen",
  },
  privacy: {
    title: "Deine Daten und die deiner Anrufer",
    points: [
      "Standardmässig wird kein Ton aufgezeichnet.",
      "Nach dem Anruf geht die Zusammenfassung an dich.",
      "Vor dem Start bekommst du einen schriftlichen Vertrag zur Auftragsbearbeitung. Darin steht, welche Anbieter das Gespräch verarbeiten und in welchen Ländern sie das tun.",
      "Der Assistent sagt jedem Anrufer am Anfang, dass er mit einer KI spricht.",
    ],
    linkLabel: "Datenschutzerklärung",
  },
  faq: {
    title: "Häufige Fragen",
    items: [
      {
        q: "Behalte ich meine Telefonnummer?",
        a: "Ja. Du schaltest bei deinem Telefonanbieter eine Umleitung ein: für alle Anrufe, bei besetzt oder wenn nach etwa 25 Sekunden niemand abnimmt. Ausschalten kannst du sie jederzeit.",
      },
      {
        q: "Versteht er Schweizerdeutsch?",
        a: "Versprechen kann ich es heute nicht. Wie gut er Dialekt versteht, testen wir in der Pilotphase mit deinen echten Anrufen. Er selbst antwortet auf Hochdeutsch.",
      },
      {
        q: "Was, wenn er etwas nicht weiss?",
        a: "Dann sagt er das und nimmt eine Nachricht auf. Er erfindet keine Preise, freien Termine oder Leistungen. Die Nachricht steht in deiner Zusammenfassung, und du rufst zurück.",
      },
      {
        q: "Wird das Gespräch aufgezeichnet?",
        a: "Den Ton zeichnet er standardmässig nicht auf. Damit er die Anfrage aufnehmen kann, wird das Gespräch während des Anrufs automatisch in Text umgewandelt. Danach bekommst du eine schriftliche Zusammenfassung.",
      },
      {
        q: "Wohin gehen die Daten?",
        a: "An Anbieter, die das Gespräch verarbeiten. Welche das sind und in welchen Ländern sie arbeiten, steht im Vertrag zur Auftragsbearbeitung, den du vor dem Start schriftlich bekommst. Die Zusammenfassung geht an dich.",
      },
      {
        q: "Was kostet es?",
        a: "Preis und Bedingungen für die Pilotphase machen wir persönlich ab. Eine Preisliste gibt es noch nicht.",
      },
      {
        q: "Was passiert bei einem Notfall?",
        a: "Er stellt keine Diagnose und gibt keine Anweisungen. Bei Gefahr sagt er dem Anrufer, dass er die 112 wählen soll, und gibt die Anfrage an dich weiter.",
      },
      {
        q: "Kann er mich direkt verbinden?",
        a: "Noch nicht. In der Pilotphase nimmt er die Anfrage auf, und du rufst zurück. Live weiterverbinden ist geplant.",
      },
      {
        q: "Wie läuft die Einrichtung ab?",
        a: "Ich komme zu dir, und wir richten alles zusammen ein. Danach testen wir mit echten Anrufen, bevor deine Kunden ihn hören.",
      },
      {
        q: "Kann ich wieder aufhören?",
        a: "Ja. Du schaltest die Umleitung bei deinem Telefonanbieter aus, und dein Telefon klingelt wieder wie vorher. Die Bedingungen für die Pilotphase machen wir vorher persönlich ab.",
      },
    ],
  },
  contact: {
    title: "Schreib mir",
    lead: "Erzähl mir kurz, was für einen Betrieb du hast und wann dich das Telefon am meisten stört. Ich melde mich schriftlich innert 24 Stunden.",
    cta: "Per WhatsApp schreiben",
    whatsappPrefill: "Hallo Francesco, ich interessiere mich für die Pilotphase von Modolo Voice AI. Mein Betrieb: ",
    emailSubject: "Pilotphase Modolo Voice AI",
  },
  plans: {
    title: "Preise",
    note: "Vorschlag, noch nicht bestätigt",
    items: [
      {
        name: "Starter",
        price: "CHF 149 pro Monat",
        minutes: "150 Minuten",
        extra: "CHF 0.45 pro weitere Minute",
        setup: "Einrichtung CHF 490",
        text: "Für einen Betrieb mit wenigen Anrufen am Tag.",
      },
      {
        name: "Professional",
        price: "CHF 299 pro Monat",
        minutes: "500 Minuten",
        extra: "CHF 0.40 pro weitere Minute",
        setup: "Einrichtung CHF 790",
        text: "Für einen Betrieb, bei dem das Telefon den ganzen Tag klingelt.",
      },
      {
        name: "Business",
        price: "CHF 599 pro Monat",
        minutes: "1’000 Minuten",
        extra: "CHF 0.35 pro weitere Minute",
        setup: "Einrichtung CHF 990",
        text: "Für Betriebe mit viel Telefon und mehreren Leuten.",
      },
    ],
  },
};

const IT: VoiceLandingContent = {
  meta: {
    title: "Modolo Voice AI · Assistente telefonico AI, Winterthur",
    description:
      "Un assistente telefonico AI che risponde al posto tuo quando non puoi. Fase pilota: cerco tre attività nella zona di Winterthur e Zurigo che vogliano provarlo.",
  },
  hero: {
    eyebrow: "Modolo Voice AI · Fase pilota",
    title: "Un assistente AI risponde quando tu non puoi.",
    lead: "Sei in cantiere, in cucina o con una cliente, e il telefono squilla. Il mio assistente telefonico AI risponde a nome della tua attività, dice subito che è un'intelligenza artificiale e annota la richiesta punto per punto. Poco dopo la chiamata ti arriva il riassunto scritto.",
    primaryCta: "Chiedi un posto nella fase pilota",
    secondaryCta: "Leggi le chiamate di esempio",
    pilotNote: "Fase pilota: cerco tre attività nella zona di Winterthur e Zurigo. Preparo tutto io, di persona.",
  },
  demo: {
    title: "Una chiamata, dall'inizio alla fine",
    lead: "Scegli un'attività e leggi come risponde l'assistente, dalla prima frase al riassunto che ricevi dopo.",
    chooserLabel: "Scegli un esempio",
    note: "Sono conversazioni scritte come esempio, non registrazioni. La voce vera la attivo con le attività della fase pilota.",
  },
  problem: {
    title: "Il telefono squilla sempre nel momento sbagliato.",
    lead: "Chi chiama spesso vuole sapere qualcosa subito. Se nessuno risponde, qualcuno riprova più tardi e qualcun altro chiama il prossimo della lista.",
    situations: [
      {
        title: "Sotto il lavandino",
        text: "L'idraulico è sdraiato sotto il lavandino, con le mani bagnate. Il cellulare gli vibra nella tasca della giacca e non ci arriva.",
      },
      {
        title: "Le 19:30, in pieno servizio",
        text: "In cucina le comande arrivano una dietro l'altra. Al telefono qualcuno vuole un tavolo per sei, sabato sera.",
      },
      {
        title: "Sulle scale",
        text: "Il traslocatore e un collega portano un divano al terzo piano. Chiama un cliente che il mese prossimo cambia casa.",
      },
      {
        title: "Colpi di sole a metà",
        text: "La parrucchiera sta mettendo le stagnole dei colpi di sole a una cliente. Il telefono alla cassa squilla per la terza volta.",
      },
    ],
  },
  how: {
    title: "Come funziona",
    steps: [
      {
        title: "Tieni il tuo numero.",
        text: "Attivi la deviazione di chiamata del tuo operatore: sempre, quando la linea è occupata o quando nessuno risponde. Sulle reti svizzere, fisse e mobili, se nessuno risponde la deviazione scatta dopo circa 25 secondi. La impostiamo insieme, da te.",
      },
      {
        title: "L'assistente risponde.",
        text: "Prima dice che è un assistente AI e per quale attività risponde. Poi chiede una cosa alla volta: chi è, cosa gli serve, dove, quando e come puoi richiamarlo.",
      },
      {
        title: "Leggi e richiami.",
        text: "Subito dopo la chiamata ricevi un riassunto scritto. Quando richiamare lo decidi tu.",
      },
    ],
  },
  features: {
    title: "Cosa sa fare l'assistente",
    items: [
      {
        title: "Risponde quando tu non puoi",
        text: "Mentre lavori, quando la linea è occupata o dopo la chiusura. Con la deviazione decidi tu quando risponde lui.",
        status: "pilot",
      },
      {
        title: "Dice che è un'intelligenza artificiale",
        text: "Subito, insieme al nome della tua attività. Non si spaccia mai per una persona.",
        status: "pilot",
      },
      {
        title: "Annota le richieste punto per punto",
        text: "Nome, cosa serve, indirizzo, data preferita e numero di telefono. Se manca qualcosa, lo chiede.",
        status: "pilot",
      },
      {
        title: "Appuntamenti in agenda",
        text: "Fissa, sposta o disdice gli appuntamenti secondo le tue regole: quali servizi, quanto durano, con quanto preavviso.",
        status: "pilot",
      },
      {
        title: "Un riassunto dopo ogni chiamata",
        text: "Per e-mail, appena finita la telefonata. Vedi subito chi ha chiamato e cosa vuole.",
        status: "pilot",
      },
      {
        title: "Quattro lingue",
        text: "Tedesco, italiano, inglese e francese. A chi parla svizzero tedesco risponde in tedesco standard. Quanto capisce il dialetto lo verifichiamo nella fase pilota, con le tue chiamate vere.",
        status: "pilot",
      },
      {
        title: "Passarti la chiamata in diretta",
        text: "È in programma, ma oggi non c'è ancora. Nella fase pilota l'assistente annota la richiesta e richiami tu.",
        status: "planned",
      },
      {
        title: "Collegamento ad altri sistemi",
        text: "Il tuo gestionale, un CRM o WhatsApp Business: su richiesta, più avanti.",
        status: "planned",
      },
    ],
  },
  sectors: {
    title: "Per piccole attività con le giornate piene",
    lead: "Idraulici, elettricisti e altri artigiani, ditte di traslochi, imprese di pulizia, carrozzerie, ristoranti e alberghi, parrucchieri, centri estetici e studi di tatuaggi, agenzie immobiliari. Ovunque il telefono squilli mentre hai le mani occupate.",
  },
  integrations: {
    title: "Dove arrivano le richieste",
    lead: "Il riassunto per e-mail funziona dal primo giorno. L'agenda la colleghiamo insieme durante la fase pilota. Il resto arriva più avanti, su richiesta.",
    items: [
      {
        name: "Riassunto per e-mail",
        text: "Dopo ogni chiamata, all'indirizzo che mi dai. Funziona da subito.",
        status: "pilot",
      },
      {
        name: "Google Calendar",
        text: "Lo colleghiamo insieme nella fase pilota. L'assistente vede gli orari liberi e inserisce gli appuntamenti.",
        status: "pilot",
      },
      {
        name: "Calendario Outlook",
        text: "Come per Google: lo colleghiamo insieme nella fase pilota.",
        status: "pilot",
      },
      {
        name: "Il tuo software (webhook)",
        text: "Le richieste arrivano direttamente nel tuo programma. Su richiesta, più avanti.",
        status: "planned",
      },
      {
        name: "WhatsApp Business",
        text: "Il riassunto come messaggio WhatsApp. Su richiesta, più avanti.",
        status: "planned",
      },
    ],
  },
  limits: {
    title: "Cosa non fa",
    items: [
      "Non chiama mai nessuno per vendere qualcosa.",
      "Non si spaccia per una persona.",
      "Non fa diagnosi e non dà istruzioni nelle emergenze. Se c'è un pericolo, dice di chiamare il 112 e ti passa la richiesta.",
      "Non inventa prezzi, disponibilità o servizi. Se non sa una cosa, lo dice e si fa lasciare un messaggio.",
      "Di base non registra l'audio della chiamata.",
    ],
  },
  pilot: {
    title: "Tre posti nella fase pilota",
    lead: "Cerco tre attività nella zona di Winterthur e Zurigo che vogliano provare l'assistente con chiamate vere. Preparo tutto io, di persona, e nel primo mese ti seguo da vicino.",
    youGet: [
      "L'installazione da te, insieme a me.",
      "Una prova con chiamate vere, prima che l'assistente risponda ai tuoi clienti.",
      "Un assistente che preparo con i tuoi servizi, i tuoi orari e le tue regole.",
      "Tieni il tuo numero e puoi disattivare la deviazione da solo, quando vuoi.",
    ],
    iAsk: [
      "Un parere sincero, anche quando qualcosa non va.",
      "Il permesso di rivedere insieme a te i riassunti delle chiamate nel primo mese.",
      "Alla fine, se ti va, una recensione pubblica sincera.",
    ],
    priceNote: "Le condizioni per la fase pilota le concordiamo di persona. Un listino prezzi per ora non c'è.",
    cta: "Chiedi un posto nella fase pilota",
  },
  privacy: {
    title: "I tuoi dati e quelli di chi chiama",
    points: [
      "Di base l'audio non viene registrato.",
      "Dopo la chiamata il riassunto arriva a te.",
      "Prima di iniziare ricevi un contratto scritto sul trattamento dei dati. Lì trovi quali fornitori trattano la conversazione e in quali paesi.",
      "All'inizio di ogni chiamata l'assistente dice che è un'intelligenza artificiale.",
    ],
    linkLabel: "Informativa sulla privacy",
  },
  faq: {
    title: "Domande frequenti",
    items: [
      {
        q: "Posso tenere il mio numero?",
        a: "Sì. Attivi la deviazione di chiamata del tuo operatore: sempre, quando la linea è occupata o quando nessuno risponde. Se nessuno risponde, scatta dopo circa 25 secondi. Puoi disattivarla quando vuoi.",
      },
      {
        q: "Capisce lo svizzero tedesco?",
        a: "Risponde in tedesco standard. Quanto capisce il dialetto lo verifichiamo nella fase pilota, con le tue chiamate vere. Oggi non posso promettertelo.",
      },
      {
        q: "E se non sa una cosa?",
        a: "Lo dice e si fa lasciare un messaggio. Non inventa prezzi, disponibilità o servizi. Il messaggio lo trovi nel riassunto e richiami tu.",
      },
      {
        q: "La chiamata viene registrata?",
        a: "L'audio, di base, non viene registrato. Per annotare la richiesta, durante la chiamata la conversazione viene trascritta automaticamente. Dopo ricevi un riassunto scritto.",
      },
      {
        q: "Dove finiscono i dati?",
        a: "La conversazione la trattano fornitori che ti indico per iscritto prima di iniziare, insieme ai paesi in cui lavorano. È tutto nel contratto sul trattamento dei dati. Il riassunto arriva a te.",
      },
      {
        q: "Quanto costa?",
        a: "Le condizioni per la fase pilota le concordiamo di persona. Un listino prezzi per ora non c'è.",
      },
      {
        q: "E in caso di emergenza?",
        a: "Non fa diagnosi e non dà istruzioni. Se c'è un pericolo, dice a chi chiama di telefonare al 112 e ti passa la richiesta.",
      },
      {
        q: "Può passarmi la chiamata?",
        a: "Non ancora. Nella fase pilota annota la richiesta e richiami tu. Passarti la chiamata in diretta è in programma.",
      },
      {
        q: "Come si parte?",
        a: "Vengo da te e prepariamo tutto insieme. Poi lo proviamo con chiamate vere, prima che lo sentano i tuoi clienti.",
      },
      {
        q: "Posso smettere?",
        a: "Sì. Disattivi la deviazione presso il tuo operatore e il telefono torna a squillare come prima. Le condizioni della fase pilota le concordiamo prima, di persona.",
      },
    ],
  },
  contact: {
    title: "Scrivimi",
    lead: "Raccontami in due righe che attività hai e quando il telefono ti disturba di più. Ti rispondo per iscritto entro 24 ore.",
    cta: "Scrivimi su WhatsApp",
    whatsappPrefill: "Ciao Francesco, mi interessa la fase pilota di Modolo Voice AI. La mia attività: ",
    emailSubject: "Fase pilota Modolo Voice AI",
  },
  plans: {
    title: "Prezzi",
    note: "Proposta, non ancora confermata",
    items: [
      {
        name: "Starter",
        price: "CHF 149 al mese",
        minutes: "150 minuti",
        extra: "CHF 0.45 per ogni minuto in più",
        setup: "Installazione CHF 490",
        text: "Per un'attività con poche chiamate al giorno.",
      },
      {
        name: "Professional",
        price: "CHF 299 al mese",
        minutes: "500 minuti",
        extra: "CHF 0.40 per ogni minuto in più",
        setup: "Installazione CHF 790",
        text: "Per un'attività dove il telefono squilla tutto il giorno.",
      },
      {
        name: "Business",
        price: "CHF 599 al mese",
        minutes: "1’000 minuti",
        extra: "CHF 0.35 per ogni minuto in più",
        setup: "Installazione CHF 990",
        text: "Per attività con molte chiamate e più persone.",
      },
    ],
  },
};

const EN: VoiceLandingContent = {
  meta: {
    title: "Modolo Voice AI · AI phone assistant, Winterthur",
    description:
      "An AI phone assistant that answers for your business when you can't. Pilot phase: I'm looking for three businesses in Winterthur and Zürich to try it.",
  },
  hero: {
    eyebrow: "Modolo Voice AI · Pilot phase",
    title: "An AI assistant picks up when you can't.",
    lead: "You're on a building site, in the kitchen or with a client, and the phone rings. My AI phone assistant picks up for your business, says straight away that it's an AI, and takes down the request point by point. Shortly after the call, you have it in writing.",
    primaryCta: "Ask for a pilot place",
    secondaryCta: "Read the example calls",
    pilotNote: "Pilot phase: I'm looking for three businesses around Winterthur and Zürich. I set everything up myself.",
  },
  demo: {
    title: "One call, start to finish",
    lead: "Pick a business and read how the assistant handles the call, from its first words to the summary you get afterwards.",
    chooserLabel: "Choose an example",
    note: "These are written examples, not recordings. I'll switch on the real voice with the businesses in the pilot.",
  },
  problem: {
    title: "The phone always rings at the wrong moment.",
    lead: "People who call often want to know something now. If nobody answers, some try again later, and some ring the next business on the list.",
    situations: [
      {
        title: "Under the sink",
        text: "The plumber is lying under a sink with wet hands. His phone buzzes in his jacket pocket, and he can't reach it.",
      },
      {
        title: "19:30, mid-service",
        text: "In the kitchen, the tickets keep coming. On the phone, someone wants a table for six on Saturday evening.",
      },
      {
        title: "In the stairwell",
        text: "The removal man and his colleague are carrying a sofa up to the third floor. A customer rings because he's moving house next month.",
      },
      {
        title: "Foils in a client's hair",
        text: "The hairdresser is putting foils in a client's hair for highlights. The phone at reception rings for the third time.",
      },
    ],
  },
  how: {
    title: "How it works",
    steps: [
      {
        title: "You keep your number.",
        text: "You turn on call forwarding with your phone provider: for every call, when the line is busy, or when nobody answers. On Swiss mobile and landline networks, forwarding on no answer kicks in after about 25 seconds. We set it up together at your place.",
      },
      {
        title: "The assistant answers.",
        text: "First it says it's an AI assistant and which business it's answering for. Then it asks one thing at a time: who is calling, what they need, where, when, and how you can reach them.",
      },
      {
        title: "You read it and call back.",
        text: "Right after the call, you get a written summary. You decide when to call back.",
      },
    ],
  },
  features: {
    title: "What the assistant can do",
    items: [
      {
        title: "Answering when you can't",
        text: "While you work, when the line is busy, or after closing time. With your call forwarding, you decide when it takes over.",
        status: "pilot",
      },
      {
        title: "Saying it's an AI",
        text: "Right at the start, together with the name of your business. It never pretends to be a person.",
        status: "pilot",
      },
      {
        title: "Taking down requests in order",
        text: "Name, what they need, address, preferred date and phone number. If something is missing, it asks.",
        status: "pilot",
      },
      {
        title: "Appointments in your calendar",
        text: "It books, moves or cancels appointments following your rules: which services, how long they take, how much notice you need.",
        status: "pilot",
      },
      {
        title: "A summary after every call",
        text: "By e-mail, right after the conversation. You see at once who called and what they want.",
        status: "pilot",
      },
      {
        title: "Four languages",
        text: "German, Italian, English and French. Callers who speak Swiss German get answers in Standard German. We'll test how well it understands dialect during the pilot, with your real calls.",
        status: "pilot",
      },
      {
        title: "Putting callers through to you",
        text: "Planned, not available yet. In the pilot, the assistant takes the request and you call back.",
        status: "planned",
      },
      {
        title: "Links to other systems",
        text: "Your industry software, a CRM or WhatsApp Business: on request, later.",
        status: "planned",
      },
    ],
  },
  sectors: {
    title: "For small businesses with busy days",
    lead: "Plumbers, electricians and other tradespeople, removal firms, cleaning companies, body shops, restaurants and hotels, hairdressers, beauty and tattoo studios, estate agents. Anywhere the phone rings while your hands are full.",
  },
  integrations: {
    title: "Where the requests go",
    lead: "The e-mail summary works from day one. We set up your calendar together during the pilot. Everything else comes later, on request.",
    items: [
      {
        name: "E-mail summary",
        text: "After every call, to the address you give me. Works from the start.",
        status: "pilot",
      },
      {
        name: "Google Calendar",
        text: "We set it up together during the pilot. The assistant sees your free slots and puts appointments in.",
        status: "pilot",
      },
      {
        name: "Outlook calendar",
        text: "As with Google, we set it up together during the pilot.",
        status: "pilot",
      },
      {
        name: "Your own software (webhook)",
        text: "Requests go straight into your program. On request, later.",
        status: "planned",
      },
      {
        name: "WhatsApp Business",
        text: "The summary as a WhatsApp message. On request, later.",
        status: "planned",
      },
    ],
  },
  limits: {
    title: "What it doesn't do",
    items: [
      "It never calls anyone to sell something.",
      "It doesn't pretend to be a person.",
      "It makes no diagnoses and gives no instructions in an emergency. If there is any danger, it tells the caller to ring 112 and passes the request on to you.",
      "It doesn't make up prices, free slots or services. If it doesn't know something, it says so and takes a message.",
      "By default, it doesn't record the audio of the call.",
    ],
  },
  pilot: {
    title: "Three places in the pilot",
    lead: "I'm looking for three businesses around Winterthur and Zürich to try the assistant with real calls. I set everything up myself and keep a close eye on things during the first month.",
    youGet: [
      "Setup at your place, together with me.",
      "A test with real calls before the assistant answers your customers.",
      "An assistant I brief on your services, opening hours and rules.",
      "You keep your number and can turn the forwarding off yourself at any time.",
    ],
    iAsk: [
      "Honest feedback, even when something doesn't work.",
      "Permission to go through the call summaries with you during the first month.",
      "At the end, if you're willing, an honest public review.",
    ],
    priceNote: "We agree the pilot terms in person. There is no price list yet.",
    cta: "Ask for a pilot place",
  },
  privacy: {
    title: "Your data and your callers' data",
    points: [
      "By default, no audio is recorded.",
      "After the call, the summary goes to you.",
      "Before we start, you get a written data processing agreement. It lists which providers handle the conversation and in which countries.",
      "At the start of every call, the assistant tells the caller they are speaking to an AI.",
    ],
    linkLabel: "Privacy policy",
  },
  faq: {
    title: "Frequently asked questions",
    items: [
      {
        q: "Do I keep my phone number?",
        a: "Yes. You turn on call forwarding with your phone provider: for every call, when the line is busy, or when nobody answers. Forwarding on no answer kicks in after about 25 seconds. You can turn it off whenever you like.",
      },
      {
        q: "Does it understand Swiss German?",
        a: "It answers in Standard German. We'll test how well it understands dialect during the pilot, with your real calls. I can't promise that today.",
      },
      {
        q: "What if it doesn't know something?",
        a: "It says so and takes a message. It doesn't make up prices, free slots or services. You'll find the message in your summary and call back.",
      },
      {
        q: "Is the call recorded?",
        a: "The audio isn't recorded by default. To take down the request, the conversation is transcribed automatically during the call. Afterwards, you get a written summary.",
      },
      {
        q: "Where does the data go?",
        a: "Before we start, I tell you in writing which providers handle the conversation and which countries they work in. It's all in the data processing agreement. The summary goes to you.",
      },
      {
        q: "What does it cost?",
        a: "We agree the pilot terms in person. There is no price list yet.",
      },
      {
        q: "What happens in an emergency?",
        a: "It makes no diagnosis and gives no instructions. If there is any danger, it tells the caller to ring 112 and passes the request on to you.",
      },
      {
        q: "Can it put callers through to me?",
        a: "Not yet. In the pilot, it takes the request and you call back. Putting callers through live is planned.",
      },
      {
        q: "How does setup work?",
        a: "I come to you and we set everything up together. Then we test with real calls before your customers hear it.",
      },
      {
        q: "Can I stop using it?",
        a: "Yes. You turn off the forwarding with your phone provider, and your phone rings just as it did before. We agree the pilot terms in person beforehand.",
      },
    ],
  },
  contact: {
    title: "Write to me",
    lead: "Tell me briefly what kind of business you run and when the phone gets in your way most. I'll reply in writing within 24 hours.",
    cta: "Message me on WhatsApp",
    whatsappPrefill: "Hi Francesco, I'm interested in the Modolo Voice AI pilot. My business: ",
    emailSubject: "Modolo Voice AI pilot",
  },
  plans: {
    title: "Prices",
    note: "Proposal, not yet confirmed",
    items: [
      {
        name: "Starter",
        price: "CHF 149 per month",
        minutes: "150 minutes",
        extra: "CHF 0.45 per extra minute",
        setup: "Setup CHF 490",
        text: "For a business with only a few calls a day.",
      },
      {
        name: "Professional",
        price: "CHF 299 per month",
        minutes: "500 minutes",
        extra: "CHF 0.40 per extra minute",
        setup: "Setup CHF 790",
        text: "For a business where the phone rings all day.",
      },
      {
        name: "Business",
        price: "CHF 599 per month",
        minutes: "1’000 minutes",
        extra: "CHF 0.35 per extra minute",
        setup: "Setup CHF 990",
        text: "For businesses with lots of calls and several staff.",
      },
    ],
  },
};

// French: «vous», Swiss French usage, a no-break space before : ; ? ! (as in lib/voice/i18n.ts).
// One name for the place: «Winterthour», the French exonym.
const FR: VoiceLandingContent = {
  meta: {
    title: "Modolo Voice AI · Assistant téléphonique IA, Winterthour",
    description:
      "Un assistant téléphonique IA décroche pour votre entreprise quand vous êtes pris. Phase pilote : je cherche trois entreprises à Winterthour et Zurich.",
  },
  hero: {
    eyebrow: "Modolo Voice AI · Phase pilote",
    title: "Un assistant IA décroche quand vous êtes pris.",
    lead: "Vous êtes sur un chantier, en cuisine ou avec une cliente, et le téléphone sonne. Mon assistant téléphonique IA décroche pour votre entreprise, dit tout de suite que c'est une IA et note la demande point par point. Peu après l'appel, vous avez le résumé par écrit.",
    primaryCta: "Demander une place pilote",
    secondaryCta: "Voir les exemples d'appels",
    pilotNote: "Phase pilote : je cherche trois entreprises dans la région de Winterthour et de Zurich. J'installe tout moi-même.",
  },
  demo: {
    title: "Un appel, du début à la fin",
    lead: "Choisissez une entreprise et lisez comment l'assistant mène la conversation, de la première phrase au résumé que vous recevez ensuite.",
    chooserLabel: "Choisir un exemple",
    note: "Ces conversations sont des exemples écrits, pas des enregistrements. J'active la vraie voix avec les entreprises du pilote.",
  },
  problem: {
    title: "Le téléphone sonne toujours au mauvais moment.",
    lead: "Qui appelle veut souvent une réponse tout de suite. Si personne ne décroche, certains rappellent plus tard, d'autres essaient ailleurs.",
    situations: [
      {
        title: "Sous le lavabo",
        text: "L'installateur sanitaire est couché sous le lavabo, les mains mouillées. Son portable vibre dans la poche de sa veste, et il n'arrive pas à l'attraper.",
      },
      {
        title: "19h30, en plein service",
        text: "En cuisine, les bons tombent les uns après les autres. Au téléphone, quelqu'un veut une table pour six, samedi soir.",
      },
      {
        title: "Dans la cage d'escalier",
        text: "Le déménageur et son collègue montent un canapé au troisième étage. Un client appelle parce qu'il déménage le mois prochain.",
      },
      {
        title: "Mèches en cours",
        text: "La coiffeuse pose les papillotes pour les mèches d'une cliente. À la réception, le téléphone sonne pour la troisième fois.",
      },
    ],
  },
  how: {
    title: "Comment ça marche",
    steps: [
      {
        title: "Vous gardez votre numéro.",
        text: "Chez votre opérateur, vous activez un renvoi d'appel : toujours, quand la ligne est occupée ou quand personne ne répond. Dans ce dernier cas, sur les réseaux suisses fixes et mobiles, le renvoi se déclenche après environ 25 secondes. Nous le réglons ensemble, chez vous.",
      },
      {
        title: "L'assistant décroche.",
        text: "Il dit d'abord qu'il est un assistant IA et pour quelle entreprise il répond. Puis il demande dans l'ordre : qui appelle, de quoi il s'agit, où, quand et comment vous pouvez joindre la personne.",
      },
      {
        title: "Vous lisez et vous rappelez.",
        text: "Juste après l'appel, vous recevez un résumé écrit. C'est vous qui décidez quand rappeler.",
      },
    ],
  },
  features: {
    title: "Ce que fait l'assistant",
    items: [
      {
        title: "Répondre quand vous ne pouvez pas",
        text: "Pendant que vous travaillez, quand la ligne est occupée ou après la fermeture. Avec le renvoi d'appel, vous décidez quand il prend le relais.",
        status: "pilot",
      },
      {
        title: "Dire que c'est une IA",
        text: "Dès le début, avec le nom de votre entreprise. Il ne se fait jamais passer pour une personne.",
        status: "pilot",
      },
      {
        title: "Noter chaque demande point par point",
        text: "Nom, demande, adresse, date souhaitée et numéro de téléphone. S'il manque quelque chose, il le demande.",
        status: "pilot",
      },
      {
        title: "Rendez-vous dans l'agenda",
        text: "Il fixe, déplace ou annule des rendez-vous selon vos règles : quelles prestations, quelle durée, quel préavis.",
        status: "pilot",
      },
      {
        title: "Un résumé après chaque appel",
        text: "Par e-mail, juste après la conversation. Vous voyez tout de suite qui a appelé et ce que la personne veut.",
        status: "pilot",
      },
      {
        title: "Quatre langues",
        text: "Allemand, italien, anglais et français. Si on lui parle suisse allemand, il répond en bon allemand. Nous testerons pendant le pilote, avec vos vrais appels, s'il comprend bien le dialecte.",
        status: "pilot",
      },
      {
        title: "Vous passer l'appel en direct",
        text: "Prévu, pas encore disponible. Pendant le pilote, l'assistant note la demande et vous rappelez.",
        status: "planned",
      },
      {
        title: "Connexion à d'autres systèmes",
        text: "Votre logiciel métier, un CRM ou WhatsApp Business : sur demande, plus tard.",
        status: "planned",
      },
    ],
  },
  sectors: {
    title: "Pour les petites entreprises aux journées chargées",
    lead: "Installateurs sanitaires, électriciens et autres artisans, déménageurs, entreprises de nettoyage, carrosseries, restaurants et hôtels, salons de coiffure, instituts de beauté et studios de tatouage, agences immobilières. Partout où le téléphone sonne pendant que vous avez les mains prises.",
  },
  integrations: {
    title: "Où arrivent les demandes",
    lead: "Le résumé par e-mail fonctionne dès le premier jour. Nous connectons l'agenda ensemble pendant le pilote. Le reste viendra plus tard, sur demande.",
    items: [
      {
        name: "Résumé par e-mail",
        text: "Après chaque appel, à l'adresse que vous me donnez. Fonctionne dès le départ.",
        status: "pilot",
      },
      {
        name: "Google Agenda",
        text: "Nous le connectons ensemble pendant le pilote. L'assistant voit les créneaux libres et inscrit les rendez-vous.",
        status: "pilot",
      },
      {
        name: "Calendrier Outlook",
        text: "Comme pour Google : nous le connectons ensemble pendant le pilote.",
        status: "pilot",
      },
      {
        name: "Votre propre logiciel (webhook)",
        text: "Les demandes arrivent directement dans votre programme. Sur demande, plus tard.",
        status: "planned",
      },
      {
        name: "WhatsApp Business",
        text: "Le résumé sous forme de message WhatsApp. Sur demande, plus tard.",
        status: "planned",
      },
    ],
  },
  limits: {
    title: "Ce qu'il ne fait pas",
    items: [
      "Il n'appelle jamais personne pour vendre quelque chose.",
      "Il ne se fait pas passer pour une personne.",
      "Il ne pose aucun diagnostic et ne donne aucune consigne en cas d'urgence. S'il y a un danger, il dit d'appeler le 112 et vous transmet la demande.",
      "Il n'invente ni prix, ni créneaux libres, ni prestations. S'il ne sait pas quelque chose, il le dit et prend un message.",
      "Par défaut, il n'enregistre pas l'audio de l'appel.",
    ],
  },
  pilot: {
    title: "Trois places pour la phase pilote",
    lead: "Je cherche trois entreprises de la région de Winterthour et de Zurich qui veulent essayer l'assistant avec de vrais appels. J'installe tout moi-même et je vous suis de près pendant le premier mois.",
    youGet: [
      "L'installation chez vous, avec moi.",
      "Un test avec de vrais appels, avant que l'assistant réponde à vos clients.",
      "Un assistant que je prépare avec vos prestations, vos horaires et vos règles.",
      "Vous gardez votre numéro et pouvez désactiver le renvoi vous-même, quand vous voulez.",
    ],
    iAsk: [
      "Un retour honnête, même quand quelque chose ne marche pas.",
      "L'autorisation de relire avec vous les résumés des appels pendant le premier mois.",
      "À la fin, si vous le voulez bien, un avis public honnête.",
    ],
    priceNote: "Nous fixons ensemble les conditions du pilote, de vive voix. Il n'y a pas encore de liste de prix.",
    cta: "Demander une place pilote",
  },
  privacy: {
    title: "Vos données et celles de vos appelants",
    points: [
      "Par défaut, l'audio n'est pas enregistré.",
      "Après l'appel, le résumé vous est envoyé.",
      "Avant de commencer, vous recevez un contrat écrit de sous-traitance des données. Il indique quels prestataires traitent la conversation et dans quels pays.",
      "Au début de chaque appel, l'assistant dit à la personne qu'elle parle avec une IA.",
    ],
    linkLabel: "Protection des données",
  },
  faq: {
    title: "Questions fréquentes",
    items: [
      {
        q: "Est-ce que je garde mon numéro ?",
        a: "Oui. Chez votre opérateur, vous activez un renvoi d'appel : toujours, quand la ligne est occupée ou quand personne ne répond. Dans ce dernier cas, le renvoi se déclenche après environ 25 secondes. Vous pouvez le désactiver quand vous voulez.",
      },
      {
        q: "Comprend-il le suisse allemand ?",
        a: "Il répond en bon allemand. Nous testerons pendant le pilote, avec vos vrais appels, s'il comprend bien le dialecte. Aujourd'hui, je ne peux pas vous le promettre.",
      },
      {
        q: "Et s'il ne sait pas quelque chose ?",
        a: "Il le dit et prend un message. Il n'invente ni prix, ni créneaux libres, ni prestations. Le message figure dans votre résumé, et vous rappelez.",
      },
      {
        q: "La conversation est-elle enregistrée ?",
        a: "Par défaut, l'audio n'est pas enregistré. Pour noter la demande, la conversation est transcrite automatiquement pendant l'appel. Ensuite, vous recevez un résumé écrit.",
      },
      {
        q: "Où vont les données ?",
        a: "La conversation est traitée par des prestataires que je vous nomme par écrit avant de commencer, avec les pays où ils travaillent. Tout figure dans le contrat de sous-traitance des données. Le résumé vous est envoyé.",
      },
      {
        q: "Combien ça coûte ?",
        a: "Nous fixons ensemble les conditions du pilote, de vive voix. Il n'y a pas encore de liste de prix.",
      },
      {
        q: "Et en cas d'urgence ?",
        a: "Il ne pose aucun diagnostic et ne donne aucune consigne. S'il y a un danger, il dit à la personne d'appeler le 112 et vous transmet la demande.",
      },
      {
        q: "Peut-il me passer l'appel ?",
        a: "Pas encore. Pendant le pilote, il note la demande et vous rappelez. Le transfert en direct est prévu.",
      },
      {
        q: "Comment se passe l'installation ?",
        a: "Je viens chez vous et nous installons tout ensemble. Ensuite, nous testons avec de vrais appels, avant que vos clients l'entendent.",
      },
      {
        q: "Puis-je arrêter ?",
        a: "Oui. Vous désactivez le renvoi chez votre opérateur, et votre téléphone sonne comme avant. Les conditions du pilote, nous les fixons ensemble avant, de vive voix.",
      },
    ],
  },
  contact: {
    title: "Écrivez-moi",
    lead: "Dites-moi en deux mots ce que fait votre entreprise et à quel moment le téléphone vous dérange le plus. Je vous réponds par écrit dans les 24 heures.",
    cta: "Écrire sur WhatsApp",
    whatsappPrefill: "Bonjour Francesco, la phase pilote de Modolo Voice AI m'intéresse. Mon entreprise : ",
    emailSubject: "Phase pilote Modolo Voice AI",
  },
  plans: {
    title: "Prix",
    note: "Proposition, pas encore confirmée",
    items: [
      {
        name: "Starter",
        price: "CHF 149 par mois",
        minutes: "150 minutes",
        extra: "CHF 0.45 par minute supplémentaire",
        setup: "Installation CHF 490",
        text: "Pour une entreprise qui reçoit peu d'appels par jour.",
      },
      {
        name: "Professional",
        price: "CHF 299 par mois",
        minutes: "500 minutes",
        extra: "CHF 0.40 par minute supplémentaire",
        setup: "Installation CHF 790",
        text: "Pour une entreprise où le téléphone sonne toute la journée.",
      },
      {
        name: "Business",
        price: "CHF 599 par mois",
        minutes: "1’000 minutes",
        extra: "CHF 0.35 par minute supplémentaire",
        setup: "Installation CHF 990",
        text: "Pour les entreprises qui reçoivent beaucoup d'appels et comptent plusieurs employés.",
      },
    ],
  },
};

export const VOICE_LANDING: Record<VoiceLocale, VoiceLandingContent> = { de: DE, it: IT, en: EN, fr: FR };
