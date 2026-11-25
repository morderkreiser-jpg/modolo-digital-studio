// UI strings of the voice widget (components/voice). Pure module, safe on client and server.
//
// Copy rules, the same as the chat assistant's (lib/assistant/i18n.ts): plain, short sentences;
// the widget always says the visitor is talking to an AI; no marketing words, no exclamation
// marks. German and Italian use the informal "du"/"tu" like the rest of the site, French the
// usual "vous". German is written the Swiss way: "ss", never the sharp s (a test checks it).
//
// Placeholders in braces are filled by formatVoiceString(): {start} the start button's label,
// {business} the business name, {minutes} the call limit, {time} "0:24", {seconds} a count,
// {target} the person a call is passed to.
import type { VoiceLocale, VoiceToolName } from "./types";
import type {
  VoiceEndReason,
  VoiceFailureCode,
  VoiceNoticeCode,
  VoiceStatus,
} from "@/components/voice/voice-machine";

export interface VoiceStrings {
  /** Accessible name of the whole widget. */
  regionLabel: string;
  aiBadge: string;
  /** Title when the tenant gives no assistant name. */
  assistantFallback: string;
  /** The label every conversation carries, per mode. */
  modeScripted: string;
  modeLocal: string;
  modeRealtime: string;
  /** Choice between talking and watching the example, when both are offered. */
  modeChooserLabel: string;
  modeChoiceLive: string;
  modeChoiceScripted: string;
  /** Shown before the start: who you talk to and when the microphone comes on. */
  introLive: string;
  introScripted: string;
  /** Demo tenants are fictional and say so. */
  fictional: string;
  privacyLink: string;
  /** Heading of the greeting preview shown before a live start. */
  greetingLabel: string;
  start: string;
  startScripted: string;
  end: string;
  endLabel: string;
  mute: string;
  playAgain: string;
  newConversation: string;
  examplesLabel: string;
  languageLabel: string;
  /** Consent step between "start" and the browser's microphone prompt. */
  consentTitle: string;
  consentText: string;
  consentLocalNote: string;
  consentAllow: string;
  consentTyped: string;
  cancel: string;
  status: Record<VoiceStatus, string>;
  mutedStatus: string;
  tools: Record<VoiceToolName, string>;
  handoff: { transfer: string; callback: string; written: string };
  timeLeft: string;
  timeLeftAnnounce: string;
  /** Shown (and read out once) shortly before a long silence ends the conversation. */
  silenceWarning: string;
  roleAssistant: string;
  roleCaller: string;
  roleYou: string;
  captionsLabel: string;
  transcriptShow: string;
  transcriptHide: string;
  transcriptTitle: string;
  transcriptEmpty: string;
  typeLabel: string;
  typePlaceholder: string;
  send: string;
  ended: Record<VoiceEndReason, string>;
  notices: Record<VoiceNoticeCode, string>;
  errors: Record<VoiceFailureCode, string>;
  tryLater: string;
  retry: string;
  retryIn: string;
  typeInstead: string;
  watchExample: string;
  contact: string;
  loading: string;
  /**
   * After a written example: what the business receives. A label for the e-mails (shown in the
   * page's language; the e-mails themselves are in the business's), the subject's label, a note
   * when the e-mails are in another language than the page, a sentence for an example after which
   * nothing reaches the business, and a screen-reader hint read with the end of the example.
   */
  afterCallTitle: string;
  /** With its colon (French typography wants a no-break space before it). */
  afterCallSubject: string;
  afterCallLanguage: string;
  afterCallNone: string;
  afterCallFollows: string;
  /** The four languages named in this language ("tedesco"), for afterCallLanguage. */
  languageNames: Record<VoiceLocale, string>;
}

/** Each language named in itself, for the language switch. */
export const VOICE_LANGUAGE_NAMES: Record<VoiceLocale, string> = {
  de: "Deutsch",
  it: "Italiano",
  en: "English",
  fr: "Français",
};

const DE: VoiceStrings = {
  regionLabel: "Sprachassistent",
  aiBadge: "KI",
  assistantFallback: "Der KI-Assistent von {business}",
  modeScripted: "Beispielgespräch, ohne Ton",
  modeLocal: "Testmodus mit der Stimme des Browsers",
  modeRealtime: "Gespräch mit einer KI",
  modeChooserLabel: "Wie möchtest du es ausprobieren?",
  modeChoiceLive: "Selbst sprechen",
  modeChoiceScripted: "Beispiel ansehen",
  introLive:
    "Du sprichst mit einer KI, nicht mit einem Menschen. Das Mikrofon wird erst eingeschaltet, wenn du auf «{start}» drückst.",
  introScripted:
    "Ein geschriebenes Beispiel, wie ein Anruf beim KI-Assistenten abläuft. Zum Mitlesen, ohne Ton und ohne Mikrofon.",
  fictional: "{business} ist ein erfundener Betrieb. Namen, Termine und Angaben im Beispiel sind ausgedacht.",
  privacyLink: "Datenschutz",
  greetingLabel: "So meldet sich der Assistent",
  start: "Gespräch starten",
  startScripted: "Beispiel abspielen",
  end: "Beenden",
  endLabel: "Gespräch beenden",
  mute: "Stummschalten",
  playAgain: "Nochmals abspielen",
  newConversation: "Neues Gespräch",
  examplesLabel: "Beispiele",
  languageLabel: "Sprache",
  consentTitle: "Bevor es losgeht",
  consentText:
    "Dein Browser fragt gleich nach dem Mikrofon. Was du sagst, wird in Text umgewandelt und an die KI geschickt. Ein Gespräch dauert höchstens {minutes} Minuten.",
  consentLocalNote:
    "Im Testmodus macht dein Browser die Spracherkennung, je nach Browser über die Server seines Anbieters.",
  consentAllow: "Mikrofon einschalten",
  consentTyped: "Lieber schreiben",
  cancel: "Abbrechen",
  status: {
    idle: "Bereit",
    consent: "Wartet auf dein Okay",
    requesting_mic: "Mikrofon wird angefragt",
    connecting: "Verbindung wird aufgebaut",
    listening: "Hört zu",
    thinking: "Überlegt",
    speaking: "Spricht",
    ended: "Gespräch beendet",
    error: "Unterbrochen",
  },
  mutedStatus: "Mikrofon aus",
  tools: {
    check_availability: "Prüft den Kalender",
    book_appointment: "Trägt den Termin ein",
    cancel_appointment: "Sagt den Termin ab",
    reschedule_appointment: "Verschiebt den Termin",
    create_lead: "Notiert die Anfrage",
    request_callback: "Notiert den Rückruf",
    transfer_call: "Verbindet weiter",
    end_call: "Beendet das Gespräch",
  },
  handoff: {
    transfer: "Weiterleitung an {target}",
    callback: "Rückruf vorgemerkt",
    written: "Schriftliche Antwort vorgemerkt",
  },
  timeLeft: "Noch {time}",
  timeLeftAnnounce: "Noch {seconds} Sekunden.",
  silenceWarning: "Bist du noch da? Ohne Antwort endet das Gespräch in wenigen Sekunden.",
  roleAssistant: "KI-Assistent",
  roleCaller: "Anrufer",
  roleYou: "Du",
  captionsLabel: "Untertitel",
  transcriptShow: "Ganzes Gespräch zeigen",
  transcriptHide: "Gespräch ausblenden",
  transcriptTitle: "Gesprächsverlauf",
  transcriptEmpty: "Bisher wurde nichts gesagt.",
  typeLabel: "Deine Nachricht an die KI",
  typePlaceholder: "Schreib hier, statt zu sprechen",
  send: "Senden",
  ended: {
    user: "Du hast das Gespräch beendet.",
    assistant: "Die KI hat das Gespräch beendet.",
    timeout: "Die Gesprächszeit ist um.",
    silence: "Das Gespräch wurde nach einer langen Pause beendet.",
    error: "Das Gespräch wurde unterbrochen.",
    unload: "Das Gespräch wurde beendet, als du die Seite verlassen hast.",
    complete: "Ende des Beispiels.",
    limit: "Dieses Gespräch hat seine maximale Länge erreicht.",
  },
  notices: {
    no_speech: "Es kam nichts an. Sprich ruhig etwas lauter oder näher am Mikrofon.",
    recognition_unsupported:
      "Dein Browser kann keine Sprache erkennen. Schreib deine Fragen unten ins Feld, die Antworten werden vorgelesen.",
    recognition_network: "Die Spracherkennung deines Browsers ist gerade nicht erreichbar. Schreib deine Fragen unten ins Feld.",
    recognition_unavailable: "Die Spracherkennung ist in deinem Browser ausgeschaltet. Schreib deine Fragen unten ins Feld.",
    audio_capture:
      "Das Mikrofon liefert keinen Ton. Prüf, ob ein anderes Programm es benutzt, oder schreib deine Fragen unten ins Feld.",
    no_synthesis: "Dein Browser kann nicht vorlesen. Die Antworten erscheinen nur als Text.",
  },
  errors: {
    bad_request: "Das Gespräch konnte nicht gestartet werden.",
    too_large: "Diese Nachricht ist zu lang.",
    forbidden: "Das Gespräch wurde nicht angenommen. Lade die Seite neu und versuch es nochmals.",
    rate_limited: "Von hier aus wurden schon mehrere Gespräche geführt.",
    busy: "Gerade laufen zu viele Gespräche gleichzeitig. Versuch es in einer Minute nochmals.",
    budget_exhausted: "Die Testgespräche sind für heute aufgebraucht.",
    session_limit: "Dieses Gespräch hat seine maximale Länge erreicht.",
    expired: "Die Sitzung ist abgelaufen. Starte ein neues Gespräch.",
    unavailable: "Der Sprachassistent ist gerade nicht verfügbar.",
    upstream: "Die KI konnte gerade nicht antworten.",
    timeout: "Die Antwort hat zu lange gedauert.",
    refused: "Darauf kann die KI nicht antworten.",
    turn_in_progress: "Die vorige Antwort ist noch nicht fertig. Versuch es gleich nochmals.",
    mic_denied:
      "Der Zugriff auf das Mikrofon wurde nicht erlaubt. Du kannst ihn in den Einstellungen des Browsers freigeben oder deine Fragen schreiben.",
    mic_unavailable: "Es wurde kein Mikrofon gefunden, oder ein anderes Programm benutzt es gerade.",
    network: "Die Verbindung wurde unterbrochen. Prüf dein Internet und versuch es nochmals.",
    offline: "Du bist anscheinend offline. Prüf deine Verbindung.",
    unsupported: "Dein Browser unterstützt diesen Test nicht.",
    not_available_yet: "Das Live-Gespräch ist noch nicht verfügbar.",
    mode_unavailable: "Diese Art von Gespräch wird gerade nicht angeboten.",
    load_failed: "Der Sprachassistent konnte nicht geladen werden. Prüf die Verbindung und versuch es nochmals.",
  },
  tryLater: "Versuch es bitte später nochmals.",
  retry: "Nochmals versuchen",
  retryIn: "Nochmals in {seconds} s",
  typeInstead: "Lieber schreiben",
  watchExample: "Beispiel ansehen",
  contact: "Direkter Kontakt",
  loading: "Wird geladen",
  afterCallTitle: "Beispiel: Das bekommt der Betrieb per E-Mail",
  afterCallSubject: "Betreff:",
  afterCallLanguage: "Auf {language}, in der Sprache des Betriebs.",
  afterCallNone:
    "Nach diesem Gespräch bekommt der Betrieb keine E-Mail: Es gab keine Anfrage, keinen Termin und keinen Rückrufwunsch.",
  afterCallFollows: "Darunter steht, was der Betrieb per E-Mail bekommt.",
  languageNames: { de: "Deutsch", it: "Italienisch", en: "Englisch", fr: "Französisch" },
};

const IT: VoiceStrings = {
  regionLabel: "Assistente vocale",
  aiBadge: "AI",
  assistantFallback: "L'assistente AI di {business}",
  modeScripted: "Conversazione di esempio, senza audio",
  modeLocal: "Modalità di prova con la voce del browser",
  modeRealtime: "Conversazione con un'AI",
  modeChooserLabel: "Come vuoi provarlo?",
  modeChoiceLive: "Parla tu",
  modeChoiceScripted: "Guarda un esempio",
  introLive:
    "Parli con un'intelligenza artificiale, non con una persona. Il microfono si accende solo quando premi «{start}».",
  introScripted:
    "Un esempio scritto di come si svolge una telefonata con l'assistente AI. Da leggere, senza audio e senza microfono.",
  fictional: "{business} è un'attività inventata. Nomi, appuntamenti e dati dell'esempio sono di fantasia.",
  privacyLink: "Privacy",
  greetingLabel: "Così risponde l'assistente",
  start: "Inizia la conversazione",
  startScripted: "Avvia l'esempio",
  end: "Termina",
  endLabel: "Termina la conversazione",
  mute: "Silenzia",
  playAgain: "Riproduci di nuovo",
  newConversation: "Nuova conversazione",
  examplesLabel: "Esempi",
  languageLabel: "Lingua",
  consentTitle: "Prima di iniziare",
  consentText:
    "Tra poco il browser ti chiede l'accesso al microfono. Quello che dici viene trasformato in testo e inviato all'AI. Una conversazione dura al massimo {minutes} minuti.",
  consentLocalNote:
    "In modalità di prova il riconoscimento vocale lo fa il browser, a seconda del browser tramite i server del suo fornitore.",
  consentAllow: "Accendi il microfono",
  consentTyped: "Preferisco scrivere",
  cancel: "Annulla",
  status: {
    idle: "Pronto",
    consent: "Aspetta il tuo consenso",
    requesting_mic: "Richiesta del microfono",
    connecting: "Connessione in corso",
    listening: "Ascolta",
    thinking: "Ci pensa",
    speaking: "Parla",
    ended: "Conversazione terminata",
    error: "Interrotta",
  },
  mutedStatus: "Microfono spento",
  tools: {
    check_availability: "Controlla il calendario",
    book_appointment: "Registra l'appuntamento",
    cancel_appointment: "Annulla l'appuntamento",
    reschedule_appointment: "Sposta l'appuntamento",
    create_lead: "Prende nota della richiesta",
    request_callback: "Prende nota della richiamata",
    transfer_call: "Inoltra la chiamata",
    end_call: "Chiude la conversazione",
  },
  handoff: {
    transfer: "Inoltro a {target}",
    callback: "Richiamata annotata",
    written: "Risposta scritta annotata",
  },
  timeLeft: "Ancora {time}",
  timeLeftAnnounce: "Ancora {seconds} secondi.",
  silenceWarning: "Ci sei ancora? Senza risposta la conversazione si chiude tra pochi secondi.",
  roleAssistant: "Assistente AI",
  roleCaller: "Chi chiama",
  roleYou: "Tu",
  captionsLabel: "Sottotitoli",
  transcriptShow: "Mostra tutta la conversazione",
  transcriptHide: "Nascondi la conversazione",
  transcriptTitle: "Trascrizione",
  transcriptEmpty: "Finora non è stato detto niente.",
  typeLabel: "Il tuo messaggio all'AI",
  typePlaceholder: "Scrivi qui invece di parlare",
  send: "Invia",
  ended: {
    user: "Hai terminato la conversazione.",
    assistant: "L'AI ha chiuso la conversazione.",
    timeout: "Il tempo della conversazione è finito.",
    silence: "La conversazione è stata chiusa dopo una lunga pausa.",
    error: "La conversazione si è interrotta.",
    unload: "La conversazione è stata chiusa quando hai lasciato la pagina.",
    complete: "Fine dell'esempio.",
    limit: "Questa conversazione ha raggiunto la lunghezza massima.",
  },
  notices: {
    no_speech: "Non è arrivato niente. Prova a parlare un po' più forte o più vicino al microfono.",
    recognition_unsupported:
      "Il tuo browser non riconosce la voce. Scrivi le domande nel campo qui sotto, le risposte vengono lette ad alta voce.",
    recognition_network:
      "Il riconoscimento vocale del browser al momento non è raggiungibile. Scrivi le domande nel campo qui sotto.",
    recognition_unavailable: "Il riconoscimento vocale è disattivato nel tuo browser. Scrivi le domande nel campo qui sotto.",
    audio_capture:
      "Il microfono non trasmette audio. Controlla che non lo stia usando un altro programma, oppure scrivi nel campo qui sotto.",
    no_synthesis: "Il tuo browser non sa leggere ad alta voce. Le risposte compaiono solo come testo.",
  },
  errors: {
    bad_request: "Non è stato possibile avviare la conversazione.",
    too_large: "Il messaggio è troppo lungo.",
    forbidden: "La conversazione non è stata accettata. Ricarica la pagina e riprova.",
    rate_limited: "Da qui sono già state fatte diverse conversazioni.",
    busy: "In questo momento ci sono troppe conversazioni in corso. Riprova tra un minuto.",
    budget_exhausted: "Le conversazioni di prova per oggi sono finite.",
    session_limit: "Questa conversazione ha raggiunto la lunghezza massima.",
    expired: "La sessione è scaduta. Inizia una nuova conversazione.",
    unavailable: "L'assistente vocale al momento non è disponibile.",
    upstream: "L'AI non è riuscita a rispondere.",
    timeout: "La risposta ha richiesto troppo tempo.",
    refused: "A questo l'AI non può rispondere.",
    turn_in_progress: "La risposta precedente non è ancora finita. Riprova tra poco.",
    mic_denied:
      "L'accesso al microfono non è stato consentito. Puoi abilitarlo nelle impostazioni del browser oppure scrivere le domande.",
    mic_unavailable: "Non è stato trovato nessun microfono, oppure lo sta usando un altro programma.",
    network: "La connessione si è interrotta. Controlla internet e riprova.",
    offline: "Sembra che tu sia offline. Controlla la connessione.",
    unsupported: "Il tuo browser non supporta questa prova.",
    not_available_yet: "La conversazione dal vivo non è ancora disponibile.",
    mode_unavailable: "Questo tipo di conversazione al momento non è disponibile.",
    load_failed: "Non è stato possibile caricare l'assistente vocale. Controlla la connessione e riprova.",
  },
  tryLater: "Riprova più tardi.",
  retry: "Riprova",
  retryIn: "Riprova tra {seconds} s",
  typeInstead: "Preferisco scrivere",
  watchExample: "Guarda un esempio",
  contact: "Contatto diretto",
  loading: "Caricamento",
  afterCallTitle: "Esempio: cosa riceve l'attività per e-mail",
  afterCallSubject: "Oggetto:",
  afterCallLanguage: "In {language}, la lingua dell'attività.",
  afterCallNone:
    "Dopo questa chiamata l'attività non riceve nessuna e-mail: non c'erano richieste, appuntamenti o richiamate.",
  afterCallFollows: "Qui sotto c'è cosa riceve l'attività per e-mail.",
  languageNames: { de: "tedesco", it: "italiano", en: "inglese", fr: "francese" },
};

const EN: VoiceStrings = {
  regionLabel: "Voice assistant",
  aiBadge: "AI",
  assistantFallback: "The AI assistant of {business}",
  modeScripted: "Example conversation, no sound",
  modeLocal: "Test mode with the browser's voice",
  modeRealtime: "Conversation with an AI",
  modeChooserLabel: "How would you like to try it?",
  modeChoiceLive: "Speak yourself",
  modeChoiceScripted: "Watch an example",
  introLive:
    "You are talking to an AI, not a person. The microphone is only switched on when you press “{start}”.",
  introScripted:
    "A written example of how a call with the AI assistant goes. To read along, with no sound and no microphone.",
  fictional: "{business} is a made-up business. Names, appointments and details in the example are invented.",
  privacyLink: "Privacy",
  greetingLabel: "How the assistant answers",
  start: "Start conversation",
  startScripted: "Play the example",
  end: "End",
  endLabel: "End the conversation",
  mute: "Mute",
  playAgain: "Play again",
  newConversation: "New conversation",
  examplesLabel: "Examples",
  languageLabel: "Language",
  consentTitle: "Before you start",
  consentText:
    "Your browser will ask for the microphone in a moment. What you say is turned into text and sent to the AI. A conversation lasts {minutes} minutes at most.",
  consentLocalNote:
    "In test mode your browser does the speech recognition, depending on the browser through its maker's servers.",
  consentAllow: "Switch on the microphone",
  consentTyped: "I'd rather type",
  cancel: "Cancel",
  status: {
    idle: "Ready",
    consent: "Waiting for your OK",
    requesting_mic: "Asking for the microphone",
    connecting: "Connecting",
    listening: "Listening",
    thinking: "Thinking",
    speaking: "Speaking",
    ended: "Conversation ended",
    error: "Interrupted",
  },
  mutedStatus: "Microphone off",
  tools: {
    check_availability: "Checking the calendar",
    book_appointment: "Booking the appointment",
    cancel_appointment: "Cancelling the appointment",
    reschedule_appointment: "Moving the appointment",
    create_lead: "Noting the request",
    request_callback: "Noting the callback",
    transfer_call: "Passing the call on",
    end_call: "Ending the call",
  },
  handoff: {
    transfer: "Passed on to {target}",
    callback: "Callback noted",
    written: "Written reply noted",
  },
  timeLeft: "{time} left",
  timeLeftAnnounce: "{seconds} seconds left.",
  silenceWarning: "Are you still there? Without an answer the conversation ends in a few seconds.",
  roleAssistant: "AI assistant",
  roleCaller: "Caller",
  roleYou: "You",
  captionsLabel: "Captions",
  transcriptShow: "Show the whole conversation",
  transcriptHide: "Hide the conversation",
  transcriptTitle: "Transcript",
  transcriptEmpty: "Nothing has been said yet.",
  typeLabel: "Your message to the AI",
  typePlaceholder: "Type here instead of speaking",
  send: "Send",
  ended: {
    user: "You ended the conversation.",
    assistant: "The AI ended the conversation.",
    timeout: "The time for this conversation is up.",
    silence: "The conversation ended after a long pause.",
    error: "The conversation was interrupted.",
    unload: "The conversation ended when you left the page.",
    complete: "End of the example.",
    limit: "This conversation has reached its maximum length.",
  },
  notices: {
    no_speech: "Nothing came through. Try speaking a little louder or closer to the microphone.",
    recognition_unsupported:
      "Your browser cannot recognise speech. Type your questions in the field below, the answers are read out.",
    recognition_network: "Your browser's speech recognition cannot be reached right now. Type your questions in the field below.",
    recognition_unavailable: "Speech recognition is switched off in your browser. Type your questions in the field below.",
    audio_capture:
      "The microphone gives no sound. Check whether another program is using it, or type your questions in the field below.",
    no_synthesis: "Your browser cannot read aloud. The answers appear as text only.",
  },
  errors: {
    bad_request: "The conversation could not be started.",
    too_large: "This message is too long.",
    forbidden: "The conversation was not accepted. Reload the page and try again.",
    rate_limited: "Several conversations have already been held from here.",
    busy: "Too many conversations are running at the same time. Try again in a minute.",
    budget_exhausted: "The test conversations for today are used up.",
    session_limit: "This conversation has reached its maximum length.",
    expired: "The session has expired. Start a new conversation.",
    unavailable: "The voice assistant is not available right now.",
    upstream: "The AI could not answer just now.",
    timeout: "The answer took too long.",
    refused: "The AI cannot answer that.",
    turn_in_progress: "The previous answer is not finished yet. Try again in a moment.",
    mic_denied:
      "Access to the microphone was not allowed. You can allow it in your browser's settings or type your questions.",
    mic_unavailable: "No microphone was found, or another program is using it.",
    network: "The connection was interrupted. Check your internet and try again.",
    offline: "You seem to be offline. Check your connection.",
    unsupported: "Your browser does not support this test.",
    not_available_yet: "The live conversation is not available yet.",
    mode_unavailable: "This kind of conversation is not offered right now.",
    load_failed: "The voice assistant could not be loaded. Check your connection and try again.",
  },
  tryLater: "Please try again later.",
  retry: "Try again",
  retryIn: "Try again in {seconds} s",
  typeInstead: "I'd rather type",
  watchExample: "Watch an example",
  contact: "Direct contact",
  loading: "Loading",
  afterCallTitle: "Example: what the business gets by e-mail",
  afterCallSubject: "Subject:",
  afterCallLanguage: "In {language}, the business's language.",
  afterCallNone: "After this call the business gets no e-mail: there was no request, appointment or callback.",
  afterCallFollows: "Below it: what the business gets by e-mail.",
  languageNames: { de: "German", it: "Italian", en: "English", fr: "French" },
};

// French: the usual "vous", and a no-break space before "?" as French typography wants.
const FR: VoiceStrings = {
  regionLabel: "Assistant vocal",
  aiBadge: "IA",
  assistantFallback: "L'assistant IA de {business}",
  modeScripted: "Exemple de conversation, sans son",
  modeLocal: "Mode test avec la voix du navigateur",
  modeRealtime: "Conversation avec une IA",
  modeChooserLabel: "Comment voulez-vous l'essayer ?",
  modeChoiceLive: "Parler vous-même",
  modeChoiceScripted: "Voir un exemple",
  introLive:
    "Vous parlez avec une intelligence artificielle, pas avec une personne. Le micro ne s'allume que lorsque vous appuyez sur « {start} ».",
  introScripted:
    "Un exemple écrit du déroulement d'un appel avec l'assistant IA. À lire, sans son et sans micro.",
  fictional: "{business} est une entreprise inventée. Les noms, rendez-vous et détails de l'exemple sont fictifs.",
  privacyLink: "Protection des données",
  greetingLabel: "Comment l'assistant répond",
  start: "Démarrer la conversation",
  startScripted: "Lancer l'exemple",
  end: "Terminer",
  endLabel: "Terminer la conversation",
  mute: "Couper le micro",
  playAgain: "Rejouer",
  newConversation: "Nouvelle conversation",
  examplesLabel: "Exemples",
  languageLabel: "Langue",
  consentTitle: "Avant de commencer",
  consentText:
    "Votre navigateur va demander l'accès au micro. Ce que vous dites est transformé en texte et envoyé à l'IA. Une conversation dure au maximum {minutes} minutes.",
  consentLocalNote:
    "En mode test, la reconnaissance vocale est faite par votre navigateur, selon le navigateur via les serveurs de son fournisseur.",
  consentAllow: "Allumer le micro",
  consentTyped: "Je préfère écrire",
  cancel: "Annuler",
  status: {
    idle: "Prêt",
    consent: "Attend votre accord",
    requesting_mic: "Demande d'accès au micro",
    connecting: "Connexion en cours",
    listening: "Écoute",
    thinking: "Réfléchit",
    speaking: "Parle",
    ended: "Conversation terminée",
    error: "Interrompue",
  },
  mutedStatus: "Micro coupé",
  tools: {
    check_availability: "Consulte l'agenda",
    book_appointment: "Inscrit le rendez-vous",
    cancel_appointment: "Annule le rendez-vous",
    reschedule_appointment: "Déplace le rendez-vous",
    create_lead: "Note la demande",
    request_callback: "Note le rappel",
    transfer_call: "Transfère l'appel",
    end_call: "Termine l'appel",
  },
  handoff: {
    transfer: "Transfert à {target}",
    callback: "Rappel noté",
    written: "Réponse écrite notée",
  },
  timeLeft: "Encore {time}",
  timeLeftAnnounce: "Encore {seconds} secondes.",
  silenceWarning: "Vous êtes toujours là ? Sans réponse, la conversation se termine dans quelques secondes.",
  roleAssistant: "Assistant IA",
  roleCaller: "Appelant",
  roleYou: "Vous",
  captionsLabel: "Sous-titres",
  transcriptShow: "Afficher toute la conversation",
  transcriptHide: "Masquer la conversation",
  transcriptTitle: "Transcription",
  transcriptEmpty: "Rien n'a encore été dit.",
  typeLabel: "Votre message à l'IA",
  typePlaceholder: "Écrivez ici au lieu de parler",
  send: "Envoyer",
  ended: {
    user: "Vous avez terminé la conversation.",
    assistant: "L'IA a terminé la conversation.",
    timeout: "Le temps de la conversation est écoulé.",
    silence: "La conversation s'est terminée après une longue pause.",
    error: "La conversation a été interrompue.",
    unload: "La conversation s'est terminée lorsque vous avez quitté la page.",
    complete: "Fin de l'exemple.",
    limit: "Cette conversation a atteint sa durée maximale.",
  },
  notices: {
    no_speech: "Rien n'est arrivé. Parlez un peu plus fort ou plus près du micro.",
    recognition_unsupported:
      "Votre navigateur ne reconnaît pas la voix. Écrivez vos questions dans le champ ci-dessous, les réponses sont lues à voix haute.",
    recognition_network:
      "La reconnaissance vocale de votre navigateur est injoignable pour le moment. Écrivez vos questions dans le champ ci-dessous.",
    recognition_unavailable:
      "La reconnaissance vocale est désactivée dans votre navigateur. Écrivez vos questions dans le champ ci-dessous.",
    audio_capture:
      "Le micro ne transmet aucun son. Vérifiez qu'aucun autre programme ne l'utilise, ou écrivez dans le champ ci-dessous.",
    no_synthesis: "Votre navigateur ne sait pas lire à voix haute. Les réponses s'affichent uniquement en texte.",
  },
  errors: {
    bad_request: "La conversation n'a pas pu démarrer.",
    too_large: "Ce message est trop long.",
    forbidden: "La conversation n'a pas été acceptée. Rechargez la page et réessayez.",
    rate_limited: "Plusieurs conversations ont déjà eu lieu depuis cet endroit.",
    busy: "Trop de conversations ont lieu en même temps. Réessayez dans une minute.",
    budget_exhausted: "Les conversations de test sont épuisées pour aujourd'hui.",
    session_limit: "Cette conversation a atteint sa durée maximale.",
    expired: "La session a expiré. Démarrez une nouvelle conversation.",
    unavailable: "L'assistant vocal n'est pas disponible pour le moment.",
    upstream: "L'IA n'a pas pu répondre pour le moment.",
    timeout: "La réponse a pris trop de temps.",
    refused: "L'IA ne peut pas répondre à cela.",
    turn_in_progress: "La réponse précédente n'est pas encore terminée. Réessayez dans un instant.",
    mic_denied:
      "L'accès au micro n'a pas été autorisé. Vous pouvez l'autoriser dans les réglages du navigateur ou écrire vos questions.",
    mic_unavailable: "Aucun micro n'a été trouvé, ou un autre programme l'utilise.",
    network: "La connexion a été interrompue. Vérifiez votre accès à internet et réessayez.",
    offline: "Vous semblez être hors ligne. Vérifiez votre connexion.",
    unsupported: "Votre navigateur ne prend pas en charge ce test.",
    not_available_yet: "La conversation en direct n'est pas encore disponible.",
    mode_unavailable: "Ce type de conversation n'est pas proposé pour le moment.",
    load_failed: "L'assistant vocal n'a pas pu être chargé. Vérifiez votre connexion et réessayez.",
  },
  tryLater: "Veuillez réessayer plus tard.",
  retry: "Réessayer",
  retryIn: "Réessayer dans {seconds} s",
  typeInstead: "Je préfère écrire",
  watchExample: "Voir un exemple",
  contact: "Contact direct",
  loading: "Chargement",
  afterCallTitle: "Exemple : ce que l'entreprise reçoit par e-mail",
  afterCallSubject: "Objet :",
  afterCallLanguage: "En {language}, la langue de l'entreprise.",
  afterCallNone: "Après cet appel, l'entreprise ne reçoit aucun e-mail : il n'y avait ni demande, ni rendez-vous, ni rappel.",
  afterCallFollows: "Juste en dessous : ce que l'entreprise reçoit par e-mail.",
  languageNames: { de: "allemand", it: "italien", en: "anglais", fr: "français" },
};

const TABLES: Record<VoiceLocale, VoiceStrings> = { de: DE, it: IT, en: EN, fr: FR };

/** The widget's strings for one language. Unknown values fall back to German (the main market). */
export function getVoiceStrings(locale: VoiceLocale): VoiceStrings {
  return TABLES[locale] ?? DE;
}

/** Fills {name} placeholders. Unknown placeholders stay visible, so a missing value is noticed. */
export function formatVoiceString(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  );
}
