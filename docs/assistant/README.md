# Assistente AI del sito

Questa guida spiega come funziona l'assistente AI di modolodigitalstudio.ch, come si configura,
quanto costa e cosa controllare quando qualcosa non va. È scritta per Francesco e per chi lavorerà
sul codice dopo di lui.

In breve: un bottone rotondo in basso a destra apre una chat. Le risposte le scrive Claude, il
modello di Anthropic, usando solo le informazioni della knowledge base del sito. Quando un
visitatore vuole un preventivo, la chat gli mostra un modulo che arriva per email a
<info@modolodigitalstudio.ch>.

> Il repository è pubblico su GitHub: questa guida, la configurazione e la knowledge base sono
> leggibili da chiunque. Mai chiavi, password o note interne nei file del progetto.

## Indice

1. [Cosa fa e cosa non fa](#1-cosa-fa-e-cosa-non-fa)
2. [Come funziona](#2-come-funziona)
3. [Mappa dei file](#3-mappa-dei-file)
4. [Variabili d'ambiente](#4-variabili-dambiente)
5. [Benvenuto, domande, colori e regole](#5-benvenuto-domande-colori-e-regole)
6. [La knowledge base](#6-la-knowledge-base)
7. [Aggiungere un nuovo cliente](#7-aggiungere-un-nuovo-cliente)
8. [Costi](#8-costi)
9. [Sicurezza e limiti](#9-sicurezza-e-limiti)
10. [Privacy](#10-privacy)
11. [Richieste di preventivo](#11-richieste-di-preventivo)
12. [Prove in locale](#12-prove-in-locale)
13. [Checklist di pubblicazione](#13-checklist-di-pubblicazione)
14. [Consumi e log](#14-consumi-e-log)
15. [In futuro: il widget su altri siti](#15-in-futuro-il-widget-su-altri-siti)
16. [Problemi frequenti](#16-problemi-frequenti)

---

## 1. Cosa fa e cosa non fa

### Fa

- Risponde alle domande su servizi, prezzi, tempi e modo di lavorare, usando solo i fatti della
  knowledge base (sezione 6).
- Risponde nella lingua dell'ultimo messaggio del visitatore. L'interfaccia è in italiano,
  tedesco e inglese e segue la lingua della pagina; ne ricorda un'altra solo se il visitatore la
  sceglie con i bottoni IT/DE/EN della chat (per quella scheda).
- Dà i prezzi esattamente come la pagina prezzi, che oggi mostra a tutti i prezzi svizzeri in
  franchi. A chi arriva dall'Italia descrive i pacchetti senza importi e propone un preventivo
  personale. Non converte valute.
- Quando il visitatore vuole partire o chiede un'offerta per il suo caso, propone il modulo di
  preventivo dentro la chat, già compilato con il servizio e un breve riassunto.
- Si difende da abusi e da spese fuori controllo: limiti per indirizzo IP, per conversazione e per
  giorno, più un budget giornaliero e mensile che nemmeno una raffica di richieste può sforare
  (sezione 8).
- Sul telefono si apre a tutto schermo, e così su ogni schermo basso (meno di 500 pixel d'altezza:
  un telefono in orizzontale, un portatile con lo zoom alto). Lì il tasto o il gesto Indietro
  chiude la chat invece di far uscire dalla pagina.

### Non fa, di proposito

- Non inventa. Se un'informazione non è nella knowledge base lo dice, e indirizza a Francesco
  (modulo, WhatsApp o email).
- Non si spaccia per una persona: dice di essere un'AI e parla di Francesco in terza persona.
- Non chiede nome, email o telefono in chat. I dati personali passano solo dal modulo, e il modulo
  non passa dall'AI.
- Non promette telefonate, non offre sconti e non scrive "senza IVA": sono regole di Modolo
  (sezione 5).
- Non salva le conversazioni sul nostro server: restano nel browser del visitatore finché la
  scheda è aperta. Anthropic invece conserva per un periodo limitato quello che riceve
  (sezione 10).
- Non manda email automatiche al visitatore, così l'indirizzo dei preventivi non può diventare un
  ripetitore di spam.
- Non passa messaggi a Francesco, non prende appuntamenti, non apre link e non cerca sul web o su
  Google; non ha accesso a calendari, CRM o altri sistemi. Quello che si scrive in chat arriva a
  Francesco solo se il visitatore invia il modulo o gli scrive su WhatsApp o per email, quindi il
  bot non dice mai di aver «passato» o «annotato» qualcosa.
- Non si installa (ancora) su siti esterni come WordPress: vedi la sezione 15.

---

## 2. Come funziona

```text
Browser del visitatore
 └─ widget (components/assistant/*)          conversazione in sessionStorage
     │
     ├─ POST /api/assistant/chat ──►  app/api/assistant/chat/route.ts
     │   ◄── risposta in streaming (SSE)   1. env.ts        interruttore, modelli, limiti
     │                                     2. tenants/      configurazione del cliente (modolo)
     │                                     3. guard.ts      controllo dell'origine
     │                                     4. validate.ts   formato e lunghezze
     │                                     5. guard.ts      limiti IP/conversazione/giorno, budget
     │                                                      (contatori: store.ts, memoria o Upstash)
     │                                     6. prompt.ts     regole, knowledge, strumento preventivo
     │                                     7. prenota sul budget il costo massimo della risposta
     │                                     8. provider.ts   Claude in streaming ──► Anthropic
     │                                     9. costs.ts, usage.ts   costo vero al posto della
     │                                                      prenotazione, contatori, log; con
     │                                                      after() anche se il visitatore se ne va
     │
     └─ POST /api/assistant/lead ──►  app/api/assistant/lead/route.ts
                                           lead-schema.ts → guard.ts → leads.ts
                                           ├─ email via Resend a info@modolodigitalstudio.ch
                                           └─ copia su Upstash con scadenza (solo con Upstash
                                              e ASSISTANT_LEAD_COPY=true)

Pagina: app/[lang]/layout.tsx → <AssistantMount> (server) → <AssistantLauncher> (il bottone)
        il pannello si scarica quando il visitatore si avvicina al bottone o lo apre
```

Le cose da sapere:

- **La conversazione la tiene il browser.** A ogni messaggio il widget rimanda la cronologia in
  testo semplice; al modello arrivano solo gli ultimi messaggi (di base 14). Il server non salva
  contenuti.
- **La chiave di Anthropic resta sul server.** Al browser arriva solo la configurazione pubblica
  (`toPublicConfig`): niente knowledge, regole, indirizzo dei preventivi o origini consentite.
- **Il prompt ha due parti.** Una statica (regole e knowledge per quella lingua e quella regione)
  che Anthropic tiene in cache e fa pagare un decimo; una dinamica e piccola (data, lingua,
  regione, pagina, stato del modulo, messaggi rimasti) che cambia a ogni richiesta.
- **Il modello non vede mai i dati del modulo.** Può solo proporlo, chiamando lo strumento
  `offer_quote_form` con il servizio e un riassunto; il visitatore lo compila e lo invia
  direttamente a `/api/assistant/lead`.
- **Un rifiuto non si trascina.** Se il modello rifiuta una domanda, anche a risposta iniziata, il
  widget toglie il testo a metà e propone una nuova conversazione. La domanda rifiutata resta
  visibile ma non viene più mandata al modello, così non provoca altri rifiuti nelle domande dopo.
- **Le attese lunghe non si interrompono.** Finché il modello ragiona, il server manda al widget un
  segnale vuoto ogni 15 secondi: senza, il widget si arrenderebbe dopo 45 secondi di silenzio,
  prima del server.
- **Il sito non diventa più pesante.** Nella pagina c'è solo il bottone; il resto del widget si
  scarica quando serve.

---

## 3. Mappa dei file

### Condivisi tra browser e server

| File | Cosa contiene |
| --- | --- |
| `lib/assistant/types.ts` | Tipi di tenant, knowledge, limiti e protocollo; i limiti predefiniti (`DEFAULT_LIMITS`). |
| `lib/assistant/protocol.ts` | Formato dello streaming: `encodeEvent` e `ChatStreamDecoder`. |
| `lib/assistant/localize.ts` | Scelta del testo per lingua (`pickText`), segnaposto `{name}`, nomi delle lingue. |
| `lib/assistant/lead-schema.ts` | Validazione del modulo preventivo, uguale nel browser e sul server. |
| `lib/assistant/i18n.ts` | Testi dell'interfaccia del widget in it/de/en, compresi i messaggi d'errore. |

### Clienti (tenant)

| File | Cosa contiene |
| --- | --- |
| `lib/assistant/tenants/index.ts` | Registro dei tenant: `DEFAULT_TENANT_ID`, `getTenant`, `listTenantIds`. |
| `lib/assistant/tenants/modolo/config.ts` | Configurazione di Modolo: benvenuto, domande suggerite, colori, contatti, regioni, servizi e budget del modulo, regole per l'AI, origini consentite. |
| `lib/assistant/tenants/modolo/knowledge.ts` | Knowledge base di Modolo. I prezzi vengono da `lib/pricing.ts`. |

### Server (`lib/assistant/server/`)

| File | Cosa contiene |
| --- | --- |
| `env.ts` | Legge le variabili d'ambiente; unisce limiti e impostazioni AI (codice → tenant → variabili). |
| `store.ts` | Contatori in memoria o su Upstash Redis, con la stessa interfaccia. |
| `guard.ts` | IP del visitatore, hash, controllo dell'origine, limiti e budget. |
| `costs.ts` | Prezzi dei modelli e stima del costo di ogni risposta. |
| `usage.ts` | Registra spesa e token, riepilogo per `/api/assistant/usage`, log strutturati (`logEvent`). |
| `validate.ts` | Controllo della richiesta della chat. |
| `provider.ts` | L'unico file che parla con l'SDK di Anthropic. |
| `knowledge.ts` | Trasforma le sezioni della knowledge in testo per il prompt. |
| `prompt.ts` | Prompt di sistema, strumento `offer_quote_form`, preparazione dei messaggi. |
| `region.ts` | Regione del visitatore: cookie `MDS_REGION`, poi il paese rilevato da Vercel. |
| `public-config.ts` | La parte di configurazione che può andare al browser. |
| `leads.ts` | Email del preventivo e copia su Upstash. |

### Endpoint

| File | Cosa fa |
| --- | --- |
| `app/api/assistant/chat/route.ts` | Chat con risposta in streaming. |
| `app/api/assistant/lead/route.ts` | Riceve il modulo preventivo. |
| `app/api/assistant/usage/route.ts` | Consumi del giorno e del mese, protetto da token. |

### Widget e pagine del sito

| File | Cosa contiene |
| --- | --- |
| `components/assistant/` | Il widget: `assistant-mount.tsx` (server), `assistant-launcher.tsx` (il bottone), il pannello con messaggi, campo di scrittura e modulo, l'hook `use-assistant` e gli stili in `assistant.module.css`. |
| `app/[lang]/layout.tsx` | Monta `<AssistantMount>` su tutte le pagine. |
| `components/back-to-top.tsx` | Il bottone "torna su" sta più in alto, per non coprire quello della chat, e sparisce mentre la chat è aperta. |
| `components/legal-page.tsx` | Informativa privacy, con la sezione sull'assistente. |

### Test e documentazione

| File | Cosa contiene |
| --- | --- |
| `tests/assistant/` | Caricatore che fa girare il TypeScript direttamente con Node, test automatici, server finto di Anthropic (`mock-anthropic.mjs`), prova completa (`e2e.mjs`). |
| `docs/assistant/README.md` | Questa guida. |
| `.env.example` | Modello delle variabili d'ambiente. |

---

## 4. Variabili d'ambiente

### Dove si impostano

- **In locale:** copia `.env.example` in `.env.local` (git lo ignora) e compila solo quello che ti
  serve. `npm run dev` legge il file all'avvio: dopo una modifica, riavvialo.
- **Su Vercel:** progetto → Settings → Environment Variables, ambiente **Production** (e
  **Preview** se vuoi provare sulle anteprime). Una variabile cambiata vale solo dal deploy
  successivo: dopo la modifica fai **Redeploy**.
- Segna come **Sensitive** i segreti: `ANTHROPIC_API_KEY`, `ASSISTANT_ADMIN_TOKEN`,
  `ASSISTANT_HASH_SALT`, `RESEND_API_KEY`.
- Nei campi dei pannelli web scrivi i valori a mano, o controlla che dopo l'incolla non ci siano
  spazi o a-capo in fondo.

### Le variabili

| Variabile | Se non la imposti | Cosa fa |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | assistente spento | Chiave API di Anthropic. È l'unica obbligatoria: senza, il bottone della chat non compare. |
| `ASSISTANT_ENABLED` | acceso (se c'è la chiave) | `false` (anche `0`, `off`, `no`) spegne chat e bottone senza togliere la chiave. |
| `ASSISTANT_MODEL` | `claude-haiku-5-5` | Modello principale, veloce ed economico. |
| `ASSISTANT_MODEL_ADVANCED` | nessuno | Modello avanzato facoltativo: `claude-sonnet-5-5` o `claude-opus-5-5`. Si usa solo con il routing `advanced` o `auto`. |
| `ASSISTANT_MODEL_ROUTING` | `fast` | `fast`: sempre il modello principale. `advanced`: sempre quello avanzato. `auto`: quello avanzato solo per le domande lunghe (oltre 400 caratteri) o con almeno tre punti interrogativi. |
| `ASSISTANT_EFFORT` | `low` | Quanto ragiona il modello prima di rispondere: `low`, `medium`, `high`. Più alto vuol dire più lento e più caro. |
| `ASSISTANT_MAX_OUTPUT_TOKENS` | `2048` | Tetto di token in uscita per risposta (da 256 a 4096), ragionamento interno compreso. Le risposte restano brevi per istruzione: il tetto serve solo a non farle troncare. Con 1024 il ragionamento si mangiava il posto della risposta: nella prova del 16.11.2026 una risposta col modulo è stata tagliata e altre si riducevano a «il modulo è qui sotto». |
| `ASSISTANT_TIMEOUT_MS` | `30000` | Attesa massima di una risposta (da 5000 a 120000 ms). Su Vercel la funzione della chat dura al massimo 60 secondi: oltre 55000 non serve. Il widget aspetta quanto il server, che lo tiene sveglio con un segnale ogni 15 secondi. |
| `ASSISTANT_DAILY_BUDGET_USD` | `1` | Spesa stimata massima per giorno (UTC). Raggiunta, la chat risponde "non disponibile" fino al giorno dopo. `0` blocca tutto. |
| `ASSISTANT_MONTHLY_BUDGET_USD` | `15` | Come sopra, per il mese di calendario (UTC). |
| `ASSISTANT_DAILY_REQUEST_LIMIT` | `1000` | Richieste chat al giorno, tutti i visitatori insieme. |
| `ASSISTANT_SESSION_MESSAGE_LIMIT` | `30` | Messaggi per conversazione (una scheda del browser). |
| `ASSISTANT_HASH_SALT` | ricavato dalla chiave API | Segreto con cui IP ed email diventano hash nei contatori. Consigliato un valore casuale lungo. Se lo cambi, i contatori in corso ripartono da zero: nessun danno. |
| `ASSISTANT_ADMIN_TOKEN` | `/usage` risponde 404 | Token per leggere i consumi (sezione 14). Almeno 24 caratteri, casuale; più corto viene ignorato. |
| `ASSISTANT_LEAD_RETENTION_DAYS` | valore del tenant (Modolo: 365) | Giorni di conservazione dei preventivi (da 1 a 3650): il numero scritto accanto alla casella del modulo e nell'email, e la scadenza delle copie su Upstash. Se lo cambi, cambia anche i 12 mesi dell'informativa. |
| `ASSISTANT_LEAD_COPY` | `false`: nessuna copia | `true` salva su Upstash anche una copia di ogni preventivo, con la scadenza della riga sopra. Serve Upstash; senza `true` Upstash tiene solo i contatori. **Prima di attivarla aggiorna l'informativa** (sezione 10). |
| `ASSISTANT_LEAD_TO` | indirizzo del tenant (Modolo: info@) | Destinatario delle email dei preventivi. Vale per **tutti** i tenant: con più clienti non usarla. |
| `RESEND_API_KEY` | niente email | Chiave di Resend, la stessa del modulo contatti. Senza, i preventivi non partono per email; se manca anche la copia su Upstash (`ASSISTANT_LEAD_COPY`), il modulo preventivo non viene offerto. |
| `CONTACT_FROM` | `Modolo Digital Studio <onboarding@resend.dev>` | Mittente delle email. In produzione deve essere un indirizzo del dominio verificato su Resend (`noreply@modolodigitalstudio.ch`): da `onboarding@resend.dev` le email finiscono nello spam. |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | contatori in memoria | Attivano Upstash Redis per i contatori (sezione 9); le copie dei preventivi solo con `ASSISTANT_LEAD_COPY=true`. Vanno in coppia; in alternativa vale la coppia `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`. Prima di collegarlo aggiorna l'informativa. |
| `ANTHROPIC_BASE_URL` | API vera di Anthropic | **Solo per i test in locale**: manda le chiamate al server finto (sezione 12). Mai su Vercel. |

Ordine di precedenza: i valori scritti nel codice (`DEFAULT_LIMITS` e le impostazioni AI
predefinite) valgono se il tenant non dice altro (`limits` e `ai` in `config.ts`); le variabili
d'ambiente vincono su entrambi, per tutti i tenant. Un valore non valido (un numero scritto male, un
modello con un nome strano) viene ignorato e resta quello predefinito: un errore di battitura non
manda giù il sito.

---

## 5. Benvenuto, domande, colori e regole

Si cambia tutto in `lib/assistant/tenants/modolo/config.ts`.

| Campo | Cosa cambia |
| --- | --- |
| `welcome` | Primo messaggio della chat, per lingua. Non viene mandato al modello. |
| `starters` | Fino a 4 domande suggerite per lingua, visibili finché il visitatore non scrive. |
| `branding.assistantName` | Nome dell'assistente nell'intestazione, per lingua. |
| `branding.logoUrl` | Immagine quadrata dell'avatar. |
| `branding.theme` | `light`, `dark` o `auto` (segue il tema chiaro o scuro del dispositivo). |
| `branding.colors`, `branding.darkColors` | Colori del widget: `accent` (bottone, invio, messaggi del visitatore), `accentText`, `background`, `surface`, `text`, `muted`, `line`, `highlight` (anello di focus), `danger`. Si indicano solo quelli da cambiare. |
| `branding.fontFamily`, `branding.headingFontFamily` | Caratteri del testo e del titolo. |
| `contact`, `contactByRegion` | Email e WhatsApp mostrati quando la chat non può aiutare e dopo l'invio del modulo, anche per regione (per esempio il numero italiano per "it"). |
| `privacyUrl` | Link all'informativa, per lingua: sotto il campo di scrittura e nel modulo. |
| `hiddenOnPathSegments` | Pagine dove il bottone non compare, in base all'ultimo pezzo dell'indirizzo (per esempio `biglietto`). |
| `leads.services`, `leads.budgetOptions` | Voci dei menu "Servizio" e "Budget" del modulo; i budget sono per regione. Gli id dei servizi sono anche le scelte che l'AI può proporre. |
| `leads.requireCompany`, `leads.requirePhone` | Rendono obbligatori azienda o telefono. |
| `leads.notifyEmail`, `leads.retentionDays` | Dove arrivano i preventivi, e per quanti giorni se ne tengono le copie. |
| `ai.rules` | Regole aggiuntive per il modello (vedi sotto). |
| `ai.effort`, `ai.maxOutputTokens`, `ai.routing` | Impostazioni AI del tenant; le variabili d'ambiente le sostituiscono. |
| `limits` | Limiti del tenant: si scrivono solo quelli da cambiare. |
| `strings` | Sostituisce singoli testi dell'interfaccia definiti in `lib/assistant/i18n.ts`. Modolo cambia l'introduzione del modulo e la conferma dopo l'invio, per dire che risponde Francesco di persona. |

Come scriverli:

- **Testi:** sempre in tutte e tre le lingue. Tedesco svizzero (`ss`, mai `ß`). Frasi brevi e
  concrete, niente formule da pubblicità.
- **Colori:** l'oro della casa è una linea o un piccolo accento, mai un riempimento. Testo e
  `muted` devono restare leggibili sullo sfondo (contrasto AA, almeno 4.5 a 1).
- **Regole per l'AI (`ai.rules`):** in inglese, una regola per voce, frase imperativa e concreta,
  per esempio "Never offer or promise phone calls." Quelle di Modolo oggi: Francesco sempre in
  terza persona; Francesco lavora per iscritto, quindi niente telefonate o videochiamate (WhatsApp
  solo per messaggi); mai "no VAT", "senza IVA" o "keine MWST", ma le parole della knowledge
  (prezzo finale, nulla da aggiungere); prezzi fissi concordati per iscritto prima di iniziare,
  nessuno sconto; nessun link ai siti dei clienti; nessuna data di disponibilità o di inizio; "du"
  in tedesco e "tu" in italiano, come il sito, e tedesco svizzero con "ss"; a chi scrive in
  dialetto svizzero tedesco risponde in tedesco standard svizzero, mai in dialetto.
- **Una regola non corregge un fatto sbagliato.** Se il bot sbaglia un prezzo si corregge la
  fonte (knowledge o `lib/pricing.ts`), non si aggiunge una regola.
- Dopo una modifica: `npx tsc --noEmit`, `npm run test:assistant` e una prova in locale
  (sezione 12).

---

## 6. La knowledge base

È l'unica fonte da cui l'assistente prende i fatti. Sta in
`lib/assistant/tenants/modolo/knowledge.ts` ed è un elenco di sezioni:

```ts
{
  id: "esempio",                                   // univoco, senza spazi
  title: { it: "…", de: "…", en: "…" },
  content: { it: "…", de: "…", en: "…" },          // testo valido per tutte le regioni
  byRegion: {                                      // facoltativo: varianti per regione
    ch: { it: "… CHF …", de: "… CHF …", en: "… CHF …" },
    it: { it: "… EUR …", de: "… EUR …", en: "… EUR …" },
  },
  source: "file, pagina o documento da cui viene il fatto", // per chi mantiene: non va al modello
}
```

A ogni richiesta `lib/assistant/server/knowledge.ts` scrive per il modello un blocco `## Titolo`
più il contenuto di ogni sezione, nella lingua e nella regione del visitatore: prima la variante
`byRegion` di quella regione, poi `content`; se manca la lingua, un'altra lingua disponibile. Le
sezioni vuote vengono saltate. Il testo può usare il markdown leggero: elenchi con "- ",
**grassetto** e link `[testo](https://…)`.

**Da dove vengono i testi di Modolo.** Gran parte della knowledge viene generata dai dati del sito,
quindi non si copia a mano:

- pacchetti, prezzi, pacchetti Care e condizioni da `lib/pricing.ts`, gli stessi dati della pagina
  prezzi: se cambi un prezzo lì, dopo il deploy cambiano insieme la pagina e le risposte. Anche la
  riga «i siti partono da…» viene da lì: è il primo pacchetto di `WEBSITES` con prezzo «da»;
- domande frequenti e titoli delle pagine da `lib/site-data.ts` (senza le risposte che citano un
  importo: i prezzi arrivano solo da `lib/pricing.ts`), contatti e indirizzi da `lib/site.ts`, i
  link alle pagine locali da `lib/local-seo.ts`.

Zone servite, portfolio e la riga sulle recensioni sono invece **trascritti** in `knowledge.ts`
(`areaText`, `PORTFOLIO`): `data/reviews.ts` non viene letto. Trascritti sono anche i testi che
esistono solo dentro i componenti del sito (pagine dei servizi, metodo, garanzia) e la frase sui
costi annuali di dominio e hosting, ognuno con il file e la riga d'origine in `source`. Se cambi
quei testi sul sito, aggiorna anche la trascrizione: la chat non se ne accorge da sola.

**Prima persona.** Alcune frasi di `lib/pricing.ts` parlano in prima persona («Parli sempre con
me», «Vengo io da te»). Nella knowledge diventano terza persona con una sostituzione esatta, frase
per frase e lingua per lingua, scritta in `knowledge.ts`. Se cambi una di quelle frasi, un test di
`npm run test:assistant` fallisce: aggiorna la sostituzione.

**Prezzi per regione.** Oggi il sito mostra a tutti i prezzi svizzeri, e la knowledge fa lo stesso:
`PUBLISHED_PRICE_REGIONS` in `knowledge.ts` contiene solo `ch`, e chi arriva dall'Italia riceve i
pacchetti senza importi. Aggiungi `it` appena una qualsiasi pagina, homepage compresa, mostra
importi in euro ai visitatori dall'Italia, e dai all'Italia la sua riga sull'IVA (quella di oggi
descrive la situazione svizzera). Il rifacimento della homepage in corso mostra già gli euro a chi
arriva dall'Italia: va pubblicato nello stesso commit che aggiunge `it`.

**La versione.** Il campo `version` si aggiorna da solo: contiene un'impronta di tutte le sezioni
e finisce in ogni riga di log come `kb`, così sai quale versione ha risposto. Quando modifichi un
testo trascritto, aggiorna anche `KNOWLEDGE_DATE` in cima al file.

**Modificare una sezione:** cambia il testo in tutte e tre le lingue (e in ogni variante
`byRegion`) e aggiorna `source` se la fonte è cambiata.

**Aggiungere una sezione:** aggiungi un oggetto all'elenco `sections` con un `id` nuovo, titolo e
contenuto nelle tre lingue, `byRegion` se il contenuto cambia da Svizzera a Italia, e `source`.
Poi prova in locale con domande che dovrebbero usarla.

### Le regole d'oro

- **Solo fatti verificati**, con la fonte scritta in `source`. Ogni frase della knowledge il bot può
  ripeterla a un cliente come una promessa.
- Niente "di solito", tempi che non puoi garantire, risultati di clienti non dimostrabili, sconti.
- Niente informazioni interne: margini, ragionamenti di vendita, dati di clienti, appunti. Il
  repository è pubblico e il modello può citare qualsiasi riga della knowledge.
- Link solo a pagine che esistono. Il widget rende cliccabili solo i link `https:`, `mailto:`,
  `tel:` e gli indirizzi interni che iniziano con `/`.
- Tienila compatta: viaggia con ogni richiesta. In cache costa poco, ma un testo lungo e
  ripetitivo rende le risposte meno precise.

---

## 7. Aggiungere un nuovo cliente

L'assistente è pensato per più attività (uno studio, un ristorante, un hotel): ogni cliente è un
**tenant**, cioè una configurazione con la sua knowledge.

1. Copia la cartella `lib/assistant/tenants/modolo` in `lib/assistant/tenants/<id-cliente>`
   (minuscole e trattini, per esempio `la-vista`) e rinomina la costante esportata da
   `config.ts` (`MODOLO_TENANT` diventa per esempio `LA_VISTA_TENANT`). La knowledge di Modolo
   legge i dati di questo sito: per un cliente va riscritta da zero.
2. In `config.ts` cambia almeno: `id` (conviene che sia uguale al nome della cartella), lingue
   (`defaultLocale`, `locales`), `branding`, `welcome` e `starters`, `contact`, `privacyUrl`
   (l'informativa del sito del cliente), `regions`, `leads` (servizi e budget del cliente,
   `notifyEmail` del cliente, `retentionDays`), `ai.rules` (le regole del cliente, in inglese)
   e `allowedOrigins`.
3. In `knowledge.ts` scrivi le sezioni del cliente (menu, orari, camere, prezzi…) solo con fatti
   che il cliente ha confermato, ognuno con la sua `source`.
4. Registra il tenant in `lib/assistant/tenants/index.ts`: importa la sua configurazione e
   aggiungila alla mappa `TENANTS`, accanto a quella di Modolo.
5. `allowedOrigins`: gli indirizzi esatti da cui un browser può chiamare l'API, per esempio
   `https://www.dominio-cliente.ch`. Le richieste dal sito stesso sono sempre ammesse; in sviluppo
   anche `localhost`.
6. Controlli: `npx tsc --noEmit`, `npm run test:assistant`, prova in locale.

Da sapere prima di farlo:

- Nella v1 il widget gira solo dentro questo progetto Next.js (`<AssistantMount>` accetta un
  `tenantId`). Per il sito di un cliente servirà l'installazione descritta nella sezione 15.
- Le variabili d'ambiente `ASSISTANT_*` valgono per tutti i tenant dello stesso deploy: budget,
  limiti, modello, e soprattutto `ASSISTANT_LEAD_TO`, che manderebbe a un solo indirizzo i
  preventivi di tutti.
- Contatori e budget sono separati per tenant, ma la fattura di Anthropic è una sola. Per sapere
  quanto spende un cliente usa `/api/assistant/usage?tenant=<id>` (affidabile solo con Upstash,
  sezione 9).
- Il sito del cliente deve avere la sua informativa privacy aggiornata (Anthropic, Resend,
  conservazione dei preventivi). E siccome tratteresti i dati dei suoi visitatori per conto suo,
  valuta con lui un accordo sul trattamento dei dati.

---

## 8. Costi

I modelli si pagano a **token**, pezzetti di parola: una risposta di qualche frase sta sui
150-300 token. Anthropic conta separatamente i token in ingresso (istruzioni, knowledge,
conversazione) e quelli in uscita (la risposta).

### Il modello predefinito: Claude Haiku 5.5

Prezzi Anthropic in USD per milione di token, validi per richieste sotto i 100'000 token (le
nostre restano molto al di sotto):

| Voce | Prezzo per milione di token |
| --- | --- |
| Ingresso | USD 0.10 |
| Uscita | USD 0.50 |
| Ingresso letto dalla cache | USD 0.01 |
| Ingresso scritto in cache | USD 0.125 |

La parte statica del prompt (regole e knowledge) viene messa in cache da Anthropic. Rileggerla
costa un decimo del prezzo normale; scriverla costa un quarto in più, e resta valida 5 minuti
dall'ultimo utilizzo (ogni lettura rinnova il tempo). C'è una cache per lingua e regione.

### Esempio: una risposta con circa 4'000 token in ingresso (3'500 dalla cache) e 250 in uscita

| Voce | Token | Prezzo per milione | Costo |
| --- | ---: | ---: | ---: |
| Prompt statico letto dalla cache | 3'500 | USD 0.01 | USD 0.000035 |
| Parte non in cache (blocco dinamico e conversazione) | 500 | USD 0.10 | USD 0.000050 |
| Risposta | 250 | USD 0.50 | USD 0.000125 |
| **Totale per risposta** | | | **USD 0.00021** |
| **Per 1'000 risposte** | | | **USD 0.21** |

Se la cache è scaduta (nessuna domanda negli ultimi 5 minuti per quella lingua e regione) la
stessa risposta paga la scrittura: 3'500 × USD 0.125 per milione = USD 0.0004375, totale
USD 0.00061, cioè **USD 0.61 ogni 1'000 risposte**. Su un sito piccolo la prima domanda di una
conversazione spesso riscrive la cache e le successive la leggono: conta tra **USD 0.21 e 0.61
ogni 1'000 risposte**.

**Quanto pesa davvero.** La knowledge di Modolo oggi è di circa 13'000 caratteri per lingua: con
regole e istruzioni la parte in cache sarà probabilmente più grande dei 3'500 token dell'esempio.
Anche se fosse il doppio (7'000 token) si resterebbe tra circa **USD 0.25 e 1.05 ogni 1'000
risposte**. Il numero vero lo leggi nei log (sezione 14): `cacheRead` + `cacheWrite` è la parte
in cache, `inTok` il resto dell'ingresso, `outTok` l'uscita. Il conto con Haiku, in USD per
1'000 risposte come quella: (`cacheRead` × 0.01 + `cacheWrite` × 0.125 + `inTok` × 0.10 +
`outTok` × 0.50) / 1'000.

Due cose fanno crescere il conto: le conversazioni lunghe (la cronologia non è in cache) e il
ragionamento interno del modello, che si paga come uscita. Con effort `low` di solito è breve; se
il costo per risposta sale, guarda `outTok` nei log.

**Misura vera (prova con il modello reale, 15-16 novembre 2026, 89 risposte in italiano, tedesco
e inglese).**

| Misura | Valore |
| --- | --- |
| Parte in cache (regole, knowledge, strumento) | circa 10'300 token |
| Uscita per risposta, ragionamento compreso | mediana 413 token |
| Costo per risposta con la cache letta | in media USD 0.00035, cioè circa USD 0.35 ogni 1'000 risposte |
| Costo per risposta su tutte e 89 | in media USD 0.00057, mediana USD 0.00040 |
| Domande difficili (più domande in un messaggio, modulo) | fino a circa USD 0.001-0.0015 |
| Spesa totale della prova | circa USD 0.05 |
| Primo testo visibile | dopo circa 2 secondi (mediana); risposta completa circa 3 secondi |

Su un sito con poco traffico molte conversazioni partono con la cache scaduta: conta circa
**USD 0.5-1 ogni 1'000 risposte**.

### Modelli avanzati (facoltativi), con lo stesso esempio

| Modello | Ingresso / uscita | Cache: lettura / scrittura | 1'000 risposte, cache letta | 1'000 risposte, cache scaduta |
| --- | --- | --- | ---: | ---: |
| `claude-haiku-5-5` (predefinito) | 0.10 / 0.50 | 0.01 / 0.125 | USD 0.21 | USD 0.61 |
| `claude-sonnet-5-5` | 2 / 10 | 0.10 / 2.50 | USD 3.85 | USD 12.25 |
| `claude-opus-5-5` | 4 / 20 | 0.20 / 5 | USD 7.70 | USD 24.50 |

Prezzi in USD per milione di token. Si attivano con `ASSISTANT_MODEL_ADVANCED` e
`ASSISTANT_MODEL_ROUTING`:

- `fast` (predefinito): sempre Haiku. Per domande su servizi, prezzi e tempi basta.
- `advanced`: sempre il modello avanzato. Nell'esempio costa circa 20 volte di più con Sonnet e
  circa 40 volte di più con Opus.
- `auto`: il modello avanzato solo per le domande lunghe o piene di punti interrogativi. Ogni
  modello ha la sua cache, quindi queste domande pagano spesso la scrittura.

Il consiglio: resta su `fast`. Prova un modello avanzato solo se vedi risposte deboli su domande
vere, e confronta i costi nei log.

### I limiti di spesa del sito

- Budget stimato: USD 1 al giorno e USD 15 al mese; in più, 1'000 richieste al giorno. Con Haiku
  USD 1 basta per circa 1'000-4'700 risposte (dipende dalla cache e da quanto pesa la
  knowledge), quindi di solito scatta prima, o insieme, il limite delle richieste. Questi limiti
  fermano gli abusi, non l'uso normale. Con Sonnet USD 1 basta per circa 80-260 risposte, con
  Opus per 40-130: se cambi modello, rivedi i budget.
- La stima usa gli stessi prezzi della tabella (`lib/assistant/server/costs.ts`). Un modello che
  non è in tabella viene stimato al prezzo più alto, così il budget scatta prima, mai dopo.
- **Prenotazione.** Prima di chiamare il modello ogni richiesta prenota sul budget del giorno e del
  mese il suo costo massimo: l'ingresso stimato dai caratteri e l'uscita piena, fino a
  `ASSISTANT_MAX_OUTPUT_TOKENS`. A risposta finita la prenotazione diventa il costo vero. Così una
  raffica di richieste contemporanee non sfora il budget: vicino al limite la chat dice "non
  disponibile" un po' prima, mai dopo.
- **Risposte interrotte.** Se una richiesta è già partita verso Anthropic ma si ferma prima che
  la risposta cominci (il visitatore chiude la pagina, scade il tempo), il sito conta comunque una
  stima dell'ingresso, che Anthropic può aver già elaborato e fatturato; un errore di Anthropic
  invece non si conta. Se la risposta era già cominciata, conta l'uscita come se fosse arrivata al
  tetto. Meglio contare un po' troppo che troppo poco.
- **Il conto si chiude anche se il visitatore se ne va.** La chat registra costo e riga di log con
  `after()` di Next.js: su Vercel la funzione resta viva finché hanno finito, entro i suoi 60
  secondi.
- Il budget del sito **non è un tetto sicuro**: senza Upstash ogni istanza del server conta per
  conto suo (sezione 9).

### Il tetto vero: la Claude Console

Imposta un limite di spesa mensile su Anthropic: è l'unico limite che vale in ogni caso.

1. Nella Claude Console crea un **workspace** dedicato al sito (per esempio "Sito Modolo") e crea
   lì la chiave API che metti su Vercel. Il workspace predefinito non accetta limiti di spesa
   propri, uno dedicato sì.
2. Nelle impostazioni del workspace imposta il suo limite di spesa (per esempio USD 10 al mese).
3. Per sicurezza imposta anche il limite mensile dell'organizzazione: pagina **Spend limits**
   (`platform.claude.com/settings/spend-limits`), accanto a "Monthly spend limit" scegli
   **Set limit** o **Adjust limit**.
4. Raggiunto un limite, Anthropic rifiuta le richieste fino al mese successivo e la chat risponde
   "non disponibile". Lo sblocchi alzando il limite.

La spesa reale, per modello e per chiave, si vede nella pagina **Usage** della Console
(`platform.claude.com/usage`).

---

## 9. Sicurezza e limiti

### I limiti

Valori predefiniti in `DEFAULT_LIMITS` (`lib/assistant/types.ts`). Un tenant può cambiarli in
`limits`, e alcune variabili d'ambiente vincono su tutto.

| Limite | Predefinito | Perché |
| --- | --- | --- |
| Lunghezza di un messaggio | 800 caratteri | Domande vere, non testi incollati. |
| Cronologia accettata | 40 messaggi, 16'000 caratteri | Richieste piccole e prevedibili. |
| Messaggi mandati al modello | gli ultimi 14 | Costo per risposta stabile. |
| Messaggi per conversazione | 30, contatore di 24 ore | Una conversazione non diventa un servizio gratuito. |
| Richieste per IP | 8 al minuto, 60 all'ora, 150 al giorno | Ferma script e copie automatiche. |
| Richieste per tenant | 1'000 al giorno | Tetto complessivo. |
| Budget stimato | USD 1 al giorno, USD 15 al mese | Ferma la spesa anomala (sezione 8). |
| Preventivi | 5 all'ora per IP, 3 al giorno per email | Niente valanghe di email. |
| Dimensione della richiesta | 64 KB chat, 16 KB preventivo | Rifiutate prima di leggerle. |
| Durata di una risposta | 30 secondi | Nessuna risposta appesa. |

Nei limiti per IP, della chat e dei preventivi, un indirizzo IPv4 conta da solo; un indirizzo IPv6
conta insieme alla sua rete /64 (i primi quattro blocchi), perché una connessione di casa o un
telefono ne ha di solito una intera e potrebbe cambiare indirizzo a ogni richiesta.

### Le altre protezioni

- **Origine:** i browser possono chiamare l'API solo dal sito stesso o dagli `allowedOrigins` del
  tenant (in sviluppo anche da `localhost`). Le richieste senza origine, da script, passano questo
  controllo ma restano soggette a tutti i limiti.
- **Trappola per bot:** il campo di scrittura e il modulo hanno un campo nascosto chiamato
  `_gotcha`, come il modulo contatti del sito. Se è compilato la chat rifiuta la richiesta, mentre
  il modulo preventivo risponde "inviato" e non spedisce niente. Lo stesso vale per un modulo
  spedito meno di 1.2 secondi dopo essere comparso. Il nome conta: un campo chiamato `website`
  potrebbe riempirlo un gestore di password, e la richiesta vera sparirebbe senza avviso.
- **IP mai in chiaro:** gli indirizzi IP (e le email nei limiti dei preventivi) vengono salvati
  solo come hash con il segreto `ASSISTANT_HASH_SALT`; il contatore della conversazione usa
  l'identificativo casuale della scheda. I contatori scadono da soli dopo circa 24 ore.
- **Log senza contenuti:** mai testi dei messaggi, nomi, email, telefoni o IP; solo dati tecnici
  come conteggi, tempi, token, costi, lingua e regione.
- **Chiavi solo sul server:** il browser non vede mai la chiave di Anthropic né quella di Resend.
- **Risposte sicure da mostrare:** il widget non interpreta HTML; i link diventano cliccabili solo
  se sono `https:`, `mailto:`, `tel:` o interni al sito.
- **Istruzioni ferme:** il prompt chiede al modello di mantenere le regole per tutta la
  conversazione, anche quando un visitatore insiste, porta una buona ragione o dice che qualcuno
  ha autorizzato un'eccezione.

### Contatori in memoria o su Upstash

- **Memoria (predefinito):** i contatori stanno nella RAM dell'istanza del server che risponde.
  Su Vercel possono girare più istanze insieme, e un'istanza nuova riparte da zero. I limiti
  quindi valgono per istanza e sono approssimativi: frenano gli abusi (come quelli del modulo
  contatti in `lib/rate-limit.ts`), ma non sono una garanzia. Anche i budget giornaliero e mensile
  diventano stime per istanza.
- **Upstash Redis:** i contatori stanno in un database condiviso. Tutte le istanze vedono gli
  stessi numeri, che sopravvivono a riavvii e deploy: limiti e budget diventano affidabili e
  `/api/assistant/usage` mostra i totali veri. Solo con `ASSISTANT_LEAD_COPY=true` i preventivi
  vengono salvati anche in copia, con scadenza automatica.
- **Come si attiva:** Vercel → progetto → Storage → Upstash for Redis (dal Marketplace) → crea il
  database in una regione europea → collegalo al progetto. Le variabili arrivano da sole: in
  Settings → Environment Variables controlla che ci sia una delle due coppie (`KV_REST_API_URL` e
  `KV_REST_API_TOKEN`, oppure `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`), poi fai
  Redeploy. Controlla prima piano e costi nel Marketplace.
- Se Upstash non risponde entro 2 secondi, per mezzo minuto i contatori passano alla memoria e il
  sito lo segnala nei log (`store_fallback`), poi riprova: la chat continua a funzionare. Le copie
  dei preventivi invece non finiscono mai in memoria: in quel caso resta solo l'email.
- **Privacy:** con Upstash i contatori (hash di IP ed email, identificativi delle conversazioni) e,
  con `ASSISTANT_LEAD_COPY=true`, le copie dei preventivi stanno da Upstash, che diventa un
  fornitore. Prima di collegarlo aggiorna l'informativa (sezione 10).

### Regola sul Firewall di Vercel (facoltativa, consigliata)

Una regola di rate limit ferma le raffiche prima ancora che il codice parta, e Vercel non fa
pagare le richieste bloccate.

1. Vercel → progetto → **Firewall** → **Configure** → nuova regola, con un nome come
   "Assistente AI".
2. Condizione: **Request Path**, **Starts with**, valore `/api/assistant/`. Scrivilo a mano:
   copiato da un blocco di codice si porta dietro un a-capo invisibile, e la regola sorveglierebbe
   un indirizzo che non esiste.
3. Azione: **Rate Limit**, finestra fissa di 60 secondi, 30 richieste, conteggio per IP. Per i
   primi giorni scegli **Log**, poi passa a **Too Many Requests (429)**. Il limite è più alto di
   quello dell'app (8 al minuto), così le persone vere vedono il messaggio gentile del widget e il
   Firewall ferma solo le raffiche.
4. Salva e **Publish**: finché non pubblichi, la regola è solo una bozza.
5. Collauda dall'esterno: un pannello verde non è una prova. Con l'azione 429 attiva, da
   PowerShell:

   ```powershell
   1..35 | ForEach-Object { (Invoke-WebRequest -Method Post -Uri https://www.modolodigitalstudio.ch/api/assistant/chat -Body x -SkipHttpErrorCheck).StatusCode }
   ```

   Le prime risposte sono `400` (richiesta non valida, nessun costo), le ultime devono diventare
   `429`. In modalità Log controlla invece Firewall → Traffic.

### Spegnere in fretta

- **In pochi secondi:** nella Claude Console disattiva o elimina la chiave del sito, oppure metti
  la regola del Firewall in **Deny**. Il bottone resta visibile, ma la chat risponde con un
  errore.
- **In modo pulito:** su Vercel imposta `ASSISTANT_ENABLED` = `false` e fai Redeploy. Il bottone
  sparisce.

---

## 10. Privacy

Questi sono i fatti che l'informativa, la knowledge e il widget possono dichiarare, e nient'altro.
Devono dire la stessa cosa in tutti e tre i posti (l'elenco è in fondo alla sezione):

1. **Chi genera le risposte.** I messaggi della chat vanno ad **Anthropic Ireland, Limited
   (Irlanda)**, nostro responsabile del trattamento: secondo i Commercial Terms di Anthropic è
   l'entità di chi ha sede in Svizzera, nello SEE o nel Regno Unito. Anthropic può trattare i dati
   anche negli Stati Uniti. Secondo le sue condizioni commerciali, i dati inviati tramite l'API non
   servono ad addestrare i suoi modelli.
2. **Cosa parte con i messaggi:** la pagina in cui si trova il visitatore (solo il percorso, senza
   parametri), la lingua della chat e la regione dei prezzi (Svizzera o Italia).
3. **Quanto li tiene Anthropic:** per un periodo limitato, secondo le sue condizioni, soprattutto
   per individuare e prevenire abusi; poi li cancella. **Non scrivere un numero di giorni.**
4. **Da noi:** il nostro server non salva la conversazione; il sito la tiene solo nel
   sessionStorage del browser finché la scheda è aperta; i log contengono solo dati tecnici come
   conteggi, tempi e costi stimati.
5. **Contro gli abusi:** le richieste si contano per indirizzo IP, per conversazione e, per i
   preventivi, per email. Si salvano solo valori pseudonimizzati (hash) o l'identificativo casuale
   della conversazione, e questi contatori scadono dopo circa 24 ore.
6. **Preventivi:** arrivano per email a <info@modolodigitalstudio.ch> tramite Resend (come le
   richieste del modulo contatti), con pagina, lingua e regione della chat. Si conservano per il
   tempo necessario a gestire la richiesta e i contatti successivi, al massimo 12 mesi, salvo che
   ne nasca un contratto.
7. **Base giuridica, dove vale il GDPR:** per la chat il legittimo interesse a rispondere alle
   domande sui servizi (art. 6 par. 1 lett. f GDPR); per i preventivi le misure precontrattuali
   chieste dal visitatore (art. 6 par. 1 lett. b GDPR). Per questo la casella del modulo è una
   presa visione dell'informativa ("Ho letto l'informativa…"), non un consenso: resta
   obbligatoria, e nell'email compare come "Privacy notice acknowledged".
8. **Avvertenze:** il visitatore non deve scrivere dati personali delicati nella chat, e
   l'assistente è un'AI che può sbagliare. Lo dice l'avviso sotto il campo di scrittura, con il
   link all'informativa.

**L'informativa del sito** (`components/legal-page.tsx`) ha la sezione "Assistente AI in chat" /
"KI-Chat-Assistent" / "AI chat assistant", subito dopo quella sul modulo di contatto: cinque
paragrafi scritti da questi punti (cosa parte e verso chi, cosa teniamo noi, niente dati delicati,
preventivi, base giuridica). "Trasferimento dei dati all'estero" dice che anche Anthropic può
trattare dati negli Stati Uniti; la data è novembre 2026. **Il testo va riletto da Francesco prima
di pubblicarlo**: non è una consulenza legale.

**Controlla chi ti fattura.** Il responsabile del trattamento è l'entità Anthropic con cui hai il
contratto. Nella Claude Console, alla voce Billing, apri una fattura: se non è intestata ad
Anthropic Ireland, Limited, vanno corrette l'informativa e la knowledge.

### Conservazione dei preventivi, in pratica

- `leads.retentionDays` (Modolo: 365, cioè i 12 mesi dell'informativa) è il numero di giorni
  scritto accanto alla casella del modulo e nell'email, e la scadenza delle eventuali copie su
  Upstash. `ASSISTANT_LEAD_RETENTION_DAYS` lo sostituisce: se lo cambi, cambia anche
  l'informativa.
- Le copie su Upstash (solo con `ASSISTANT_LEAD_COPY=true`) si cancellano da sole alla scadenza.
- **Le email in info@ no: le cancelli tu, una volta al mese.** È la promessa scritta
  nell'informativa e accanto alla casella del modulo.

La pulizia del mese, in Zoho Mail:

1. Nel calendario metti un promemoria che si ripete il primo di ogni mese, per esempio
   "Preventivi della chat: pulizia".
2. Cerca le email con oggetto "New quote request" e ordinale per data.
3. Elimina quelle ricevute più di 11 mesi fa che non sono diventate un contratto, insieme alle tue
   risposte che le citano (nella posta inviata).
4. Svuota il Cestino, così spariscono davvero.

Undici mesi e non dodici: con un controllo al mese, nessuna richiesta supera i 12 mesi promessi.

### Quando l'informativa va aggiornata

- Prima di collegare Upstash: diventa un fornitore che conserva i contatori (hash di IP ed email,
  identificativi delle conversazioni) e, con `ASSISTANT_LEAD_COPY=true`, le copie dei preventivi.
  Va indicato, con la regione del database.
- Se cambi conservazione, modello di un altro fornitore, canale di consegna dei preventivi o
  quello che parte con i messaggi.
- Se la fattura di Anthropic cambia intestazione (vedi sopra).
- Ogni modifica va fatta nelle tre lingue, aggiornando la data, e insieme negli altri posti che
  ripetono questi fatti:
  - la sezione "About this chat" della knowledge (`ABOUT_THIS_CHAT` in
    `lib/assistant/tenants/modolo/knowledge.ts`): è da lì che il bot risponde alle domande sui
    dati;
  - i testi del widget in `lib/assistant/i18n.ts`: la casella del modulo (`form.consent`) e
    l'avviso sotto il campo di scrittura (`disclaimer`);
  - questa sezione della guida.

---

## 11. Richieste di preventivo

1. Il visitatore mostra un'intenzione concreta: vuole un'offerta, vuole partire, descrive il suo
   progetto, chiede come procedere o di essere ricontattato. Il modello risponde prima alle sue
   domande, poi scrive una frase ("il modulo è qui sotto") e chiama lo strumento
   `offer_quote_form` con il servizio più adatto (uno degli id di `leads.services`) e un
   riassunto di 1-3 frasi in prima persona, come se l'avesse scritto il visitatore, senza dati
   personali. La chiamata chiude la risposta: dopo non si può scrivere altro. Il modulo si può
   chiudere ("Non ora") e dopo un ricaricamento della pagina non c'è più. Il bottone "Richiedi un
   preventivo" sotto la chat resta sempre visibile: riapre il modulo o, se è ancora aperto più su
   nella conversazione, ci torna sopra. È lì che il modello manda il visitatore, mai a un modulo
   "qui sopra".
2. Il server controlla quello che il modello ha proposto (servizio valido, riassunto pulito e
   breve) e manda al widget un evento `action`.
3. Il widget mostra il modulo dentro la chat, già compilato con servizio e descrizione, che il
   visitatore può cambiare. Campi: nome, azienda, email, telefono o WhatsApp, servizio,
   descrizione, budget (con le fasce della sua regione) e la casella obbligatoria "Ho letto
   l'informativa…", con il link alla privacy e i giorni di conservazione. È una presa visione, non
   un consenso (sezione 10).
4. Il visitatore invia, e il browser spedisce i dati direttamente a `/api/assistant/lead`. Il
   modello non li vede mai.
5. Il server controlla dimensione, origine, campo trappola e tempo minimo, valida i campi con
   `lead-schema.ts`, applica i limiti (5 all'ora per IP, 3 al giorno per email) e poi consegna:
   - **email via Resend** a `leads.notifyEmail` (Modolo: <info@modolodigitalstudio.ch>), oppure ad
     `ASSISTANT_LEAD_TO` se impostata. Rispondendo all'email scrivi direttamente al visitatore.
     L'email è in inglese, la lingua predefinita del tenant, come quelle del modulo contatti, e
     riporta pagina, lingua, regione, numero della richiesta, data, la riga "Privacy notice
     acknowledged" e la regola di conservazione;
   - **copia su Upstash**, solo con Upstash e `ASSISTANT_LEAD_COPY=true`: un JSON con scadenza di
     `retentionDays` giorni.
6. Se almeno un canale riesce il visitatore vede la conferma. Se falliscono tutti riceve un errore
   con WhatsApp ed email diretti, e nei log compare una riga d'errore.

Il modello non ripropone il modulo se l'ha già mostrato (a meno che glielo chiedano) e dopo un
invio non lo mostra più in quella conversazione. Nessuna email automatica parte verso il
visitatore. Senza `RESEND_API_KEY` né la copia su Upstash (`ASSISTANT_LEAD_COPY=true`) il modulo
non viene offerto. Con la sola copia su Upstash i preventivi resterebbero nel database senza
avvisarti: tieni sempre impostata `RESEND_API_KEY`.

---

## 12. Prove in locale

Servono Node 24 e le dipendenze installate (`npm install`).

### Test automatici (gratis)

```bash
npm run test:assistant
```

Esegue i test di `tests/assistant/` con Node, senza chiamare Anthropic.

### Il sito in locale con il server finto (gratis)

1. In un terminale avvia il finto Anthropic, che ascolta su `http://127.0.0.1:4010` (per un'altra
   porta imposta `MOCK_PORT`):

   ```bash
   node tests/assistant/mock-anthropic.mjs
   ```

2. In `.env.local` metti `ANTHROPIC_API_KEY=test` (basta un valore qualsiasi) e
   `ANTHROPIC_BASE_URL=http://127.0.0.1:4010`.
3. In un secondo terminale `npm run dev`, poi apri <http://localhost:3000>.
4. Per provare i casi particolari, aggiungi al messaggio uno di questi segnali:

   | Nel messaggio | Il finto Anthropic |
   | --- | --- |
   | (niente) | risponde con una frase di prova |
   | `[[tool]]` | scrive una frase e propone il modulo preventivo (compare solo se c'è un canale per i preventivi: `RESEND_API_KEY` o Upstash) |
   | `[[refuse]]` | rifiuta di rispondere |
   | `[[long]]` | si ferma come per una risposta troppo lunga |
   | `[[slow]]` | scrive lentamente |
   | `[[hang]]` | resta in silenzio qualche secondo, poi risponde |
   | `[[500]]` | simula un guasto del servizio |
   | `[[401]]` | simula una chiave non valida |

5. Finito, **togli `ANTHROPIC_BASE_URL` da `.env.local`** e riavvia `npm run dev`, altrimenti
   l'assistente continua a cercare il finto server.

### Il sito in locale con Claude vero (costa)

1. In `.env.local` metti la chiave vera in `ANTHROPIC_API_KEY`, meglio una di un workspace di
   prova con un limite di spesa basso (sezione 8).
2. `npm run dev` e apri <http://localhost:3000>.

Ogni messaggio è una chiamata vera e si paga: poco (sezione 8), ma si paga. Per provare il modulo
preventivo servono anche `RESEND_API_KEY` e `CONTACT_FROM`, e le email partono davvero.

### Prova completa (end-to-end)

`tests/assistant/e2e.mjs` prova il giro completo contro il server finto: istruzioni e opzioni sono
scritte in testa al file. Non fa danni nemmeno se la configuri male: parte solo contro un server su
questo computer (`localhost`, `127.0.0.1` o `[::1]`); prima di ogni prova controlla che il server
usi davvero il finto Anthropic, e se no si ferma dopo una sola domanda; ogni preventivo che spedisce
ha la casella dell'informativa non spuntata, quindi non può essere consegnato.

### Controlli del codice

```bash
npx tsc --noEmit
npx eslint lib/assistant components/assistant app/api/assistant
```

---

## 13. Checklist di pubblicazione

### Prima

- [ ] `npx tsc --noEmit`, `npm run lint` e `npm run test:assistant` senza errori (meglio anche
      `npm run build`).
- [ ] Francesco ha riletto la nuova sezione dell'informativa nelle tre lingue: esce con lo stesso
      deploy.
- [ ] Claude Console: workspace del sito con limite di spesa mensile, chiave API creata lì.
- [ ] Claude Console → Billing: la fattura è intestata ad Anthropic Ireland, Limited (se no,
      sezione 10).
- [ ] Nel calendario il promemoria mensile per la pulizia dei preventivi in Zoho (sezione 10).
- [ ] Vercel → Environment Variables (Production): `ANTHROPIC_API_KEY` (Sensitive). Consigliate:
      `ASSISTANT_HASH_SALT` e `ASSISTANT_ADMIN_TOKEN` (Sensitive), da generare con
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
- [ ] Ci sono già `RESEND_API_KEY` e `CONTACT_FROM` (`noreply@modolodigitalstudio.ch`).
- [ ] `ANTHROPIC_BASE_URL` **non** c'è.
- [ ] Facoltativi: Upstash (e allora informativa aggiornata), regola del Firewall in modalità Log.

### Pubblicazione

- [ ] Il push su `main` va in produzione da solo: fallo solo quando hai deciso di pubblicare.
- [ ] Se hai cambiato variabili su Vercel dopo l'ultimo deploy: Deployments → ultimo deploy di
      produzione → **Redeploy**.

### Dopo, sul sito vero

In una finestra in incognito, da computer e da telefono.

- [ ] Il bottone compare in basso a destra e non copre "torna su".
- [ ] La chat si apre con il benvenuto e le domande suggerite; sotto il campo c'è l'avviso AI con il
      link alla privacy, e il link funziona.
- [ ] Una domanda sui prezzi in italiano, una in tedesco e una in inglese: risposta nella lingua
      giusta e in franchi (dalla Svizzera).
- [ ] Una domanda su qualcosa che non è nella knowledge: dice che non lo sa e propone di scrivere
      a Francesco.
- [ ] Le quattro domande suggerite, in ognuna delle tre lingue: le risposte parlano di Francesco
      in terza persona, mai "io" o "me".
- [ ] In tedesco una domanda in dialetto ("Was choschtet e Websiite?"): risposta in tedesco
      standard svizzero, non in dialetto.
- [ ] "Ist das Hosting inbegriffen?": dice che dominio e hosting costano qualcosa ogni anno e che
      l'importo è nell'offerta.
- [ ] "Wird mein Gespräch gespeichert?": la risposta corrisponde alla sezione 10 (Anthropic
      Ireland, conservazione limitata da parte di Anthropic, niente sul nostro server).
- [ ] "Vorrei un preventivo per…": compare il modulo. Invialo con la tua email: arriva a info@
      (guarda anche nello spam) e "Rispondi" scrive al tuo indirizzo.
- [ ] Apri il modulo, chiudilo ("Jetzt nicht") e chiedi "Kannst du Francesco ausrichten, dass ich
      eine Offerte möchte?": il bot dice che non può passare messaggi e indica il bottone "Offerte
      anfragen" sotto la chat, WhatsApp o l'email. Non dice mai di averlo fatto.
- [ ] Sul telefono la chat è a schermo intero, anche in orizzontale, e si chiude sia con la X sia
      con il tasto o il gesto Indietro, che non fa uscire dal sito.
- [ ] `/api/assistant/usage` con il token: `requestsToday` è salito (sezione 14).
- [ ] Vercel → Logs, cerca `assistant`: righe con `"route":"chat"`, un `costUsd` e, dalla seconda
      domanda nella stessa lingua, `cacheRead` maggiore di zero. Nessuna riga d'errore.

---

## 14. Consumi e log

### L'indirizzo dei consumi

Serve `ASSISTANT_ADMIN_TOKEN`. Da PowerShell:

```powershell
curl.exe -s -H "Authorization: Bearer IL_TUO_TOKEN" https://www.modolodigitalstudio.ch/api/assistant/usage
```

| Campo | Significato |
| --- | --- |
| `usage.day`, `usage.month` | Giorno e mese in corso (UTC). |
| `usage.requestsToday` | Richieste chat di oggi. |
| `usage.costTodayUsd`, `usage.costMonthUsd` | Spesa stimata di oggi e del mese, in USD, comprese le prenotazioni delle risposte ancora in corso (sezione 8). |
| `usage.inputTokensToday`, `usage.outputTokensToday` | Token di oggi: ingresso non in cache e uscita. |
| `usage.store` | `memory` o `upstash`. |
| `limits`, `models` | Limiti e modelli in vigore. |

- Aggiungi `?tenant=<id>` per un altro tenant.
- Senza token configurato l'indirizzo risponde 404, con un token sbagliato 401.
- Con `store: "memory"` i numeri sono solo quelli dell'istanza che ha risposto: indicativi. Il
  conto vero è nella Claude Console (Usage).
- Il token vale come una password: non incollarlo in chat o screenshot. Se esce, cambialo su
  Vercel e fai Redeploy.

### I log su Vercel

Progetto → Logs, cerca `assistant`.

Ogni risposta della chat scrive una riga JSON con `"evt":"assistant"` e `"route":"chat"`:

| Campo | Significato |
| --- | --- |
| `tenant`, `model` | Chi e con quale modello. |
| `inTok`, `outTok` | Token in ingresso non in cache e in uscita. |
| `cacheRead`, `cacheWrite` | Token letti dalla cache e scritti in cache. |
| `costUsd` | Costo stimato della risposta. |
| `ms` | Durata in millisecondi. |
| `stop` | Come si è chiusa la risposta: `end` normale, `action` modulo proposto, `max_tokens` troncata, `refused` rifiuto, `refused_partial` rifiuto arrivato a risposta iniziata, `empty` nessun testo, `client_gone` il visitatore ha chiuso, oppure il codice dell'errore (`timeout`, `upstream`, `unavailable`). |
| `kb` | Versione della knowledge. |
| `turns` | Messaggi nella conversazione. |

Ci sono anche lingua, regione e tempo fino alla prima parola. Le richieste fermate prima di
arrivare al modello (limiti, origine, formato) scrivono una riga con `rejected`, cioè il codice
del rifiuto.

I preventivi scrivono righe con `"route":"lead"` (esito, canali riusciti e falliti, durata); un
canale fallito compare come riga d'errore con il solo codice HTTP o il tipo di errore. Nei log
non ci sono mai testi, nomi, email, telefoni o IP. Vercel li tiene per poco tempo (dipende dal
piano): per lo storico della spesa usa la Console.

Cosa guardare ogni tanto: `costUsd` per risposta, `cacheRead` quasi sempre sopra zero, poche
risposte troncate, nessuna riga d'errore ripetuta.

---

## 15. In futuro: il widget su altri siti

**Non è nella v1.** Oggi l'assistente funziona solo dentro questo sito. Per offrirlo ai clienti su
WordPress, Elementor o un altro sito Next.js, la strada consigliata è questa:

1. **Una pagina del widget** servita da questo progetto, per esempio `/embed/<tenant>`: solo il
   pannello della chat, senza menu né piè di pagina.
2. **Un piccolo script di caricamento** (pochi KB, nessuna dipendenza), da inserire nel sito del
   cliente con una riga come `<script src="https://www.modolodigitalstudio.ch/embed.js"
   data-tenant="la-vista" defer></script>`. Disegna il bottone e apre la pagina del widget in un
   iframe; apertura, chiusura e dimensioni passano con `postMessage`, controllando sempre
   l'origine dei messaggi.
3. **Sicurezza per tenant:** la pagina del widget manda l'intestazione
   `Content-Security-Policy: frame-ancestors https://www.dominio-cliente.ch`, così solo il sito del
   cliente può incorporarla. Lo stesso dominio va in `allowedOrigins` del tenant per le chiamate
   dirette all'API, che in quel caso richiedono anche le intestazioni CORS (oggi non presenti).

Perché un iframe: gli stili del tema WordPress non rompono il widget e il widget non rompe il tema,
non ci sono conflitti tra versioni di React, e la chiave resta comunque sul nostro server. Su
WordPress lo script si inserisce con un plugin per il codice nell'intestazione o con il "Custom
Code" di Elementor Pro; su un sito Next.js con `next/script`.

Resteranno da decidere: come si passa la regione (ogni sito ha la sua logica), la chiave e il
limite di spesa per cliente (oggi la chiave è una sola) e gli accordi sul trattamento dei dati con
ogni cliente.

---

## 16. Problemi frequenti

| Cosa succede | Causa probabile | Cosa fare |
| --- | --- | --- |
| Il bottone della chat non compare | `ANTHROPIC_API_KEY` mancante o vuota, `ASSISTANT_ENABLED` = `false`, oppure la pagina è in `hiddenOnPathSegments` | Controlla le variabili su Vercel, poi Redeploy. |
| Ogni risposta finisce con "non disponibile" (`unavailable`) | Chiave non valida o disattivata, nome del modello sbagliato, limite di spesa della Console raggiunto | Log Vercel: cerca le righe d'errore di `assistant`. Nella Console controlla chiave, Usage e Spend limits. |
| "Troppe richieste" (`rate_limited`) | Limite per IP: normale per i bot. Più persone dietro la stessa rete aziendale condividono l'IP (con IPv6, la stessa rete /64) | Si sblocca da solo. Se succede a persone vere, alza `ipPerMinute`/`ipPerHour` in `limits` del tenant. |
| Limite di messaggi della conversazione (`session_limit`) | 30 messaggi nella stessa scheda | Nuova conversazione, oppure `ASSISTANT_SESSION_MESSAGE_LIMIT`. |
| Non disponibile fino a domani (`budget_exhausted`) | Budget stimato o limite di richieste del giorno o del mese raggiunto | Guarda `/api/assistant/usage`. Traffico vero: alza `ASSISTANT_DAILY_BUDGET_USD`. Abuso: regola del Firewall. |
| Errori `upstream` o `timeout` frequenti | Anthropic sovraccarico o lento, oppure il tetto di spesa del piano Anthropic | Di solito passa da solo. Controlla la Console (Usage e limiti) e, se serve, alza `ASSISTANT_TIMEOUT_MS`. |
| Risposte tagliate a metà (`stop` troncato nei log) | `ASSISTANT_MAX_OUTPUT_TOKENS` troppo basso o effort alto | Porta il tetto a 3072 o 4096. |
| Il bot sbaglia un prezzo o un servizio | Knowledge o `lib/pricing.ts` | Correggi la fonte e pubblica. Non aggiungere una regola per correggere un fatto. |
| Il bot promette cose che non deve | Manca una regola, o la knowledge è ambigua | Aggiungi una regola in `ai.rules` (in inglese), chiarisci la knowledge, riprova. |
| Il modulo preventivo non compare | `leads.enabled` falso, nessun canale (né `RESEND_API_KEY` né la copia su Upstash con `ASSISTANT_LEAD_COPY=true`), oppure già inviato in questa conversazione | Controlla le variabili; prova una nuova conversazione. |
| La chat resta in una lingua diversa da quella della pagina | Il visitatore l'ha scelta con i bottoni IT/DE/EN della chat: vale per quella scheda | Normale. In una scheda nuova la chat segue di nuovo la pagina. |
| Preventivo inviato ma l'email non arriva | `CONTACT_FROM` non verificato su Resend, chiave Resend sbagliata, email nello spam | Log: riga d'errore con `"route":"lead"`. Pannello Resend → Emails. Cartella spam di Zoho. |
| Errore `forbidden` | Chiamata da un dominio che non è il sito né in `allowedOrigins` | Aggiungi l'origine esatta al tenant. |
| `/api/assistant/usage` risponde 404 | `ASSISTANT_ADMIN_TOKEN` mancante o più corto di 24 caratteri | Impostalo e fai Redeploy. |
| `/api/assistant/usage` risponde 401 | Token sbagliato o intestazione mancante | Usa `Authorization: Bearer <token>`. |
| `cacheRead` sempre a zero | Qualcosa che cambia (data, id) è finito nella parte statica del prompt | È un bug da correggere in `prompt.ts`: la parte statica deve restare identica tra le richieste. |
| Il budget finisce subito dopo un cambio di modello | Il modello non è nella tabella prezzi e viene stimato al prezzo più alto | Aggiungi i suoi prezzi in `lib/assistant/server/costs.ts`. |
| I numeri di `/usage` non tornano con la Console | Contatori in memoria, per istanza | Attiva Upstash. Il conto vero resta quello della Console. |
| In locale nessuna risposta, errore di connessione | `ANTHROPIC_BASE_URL` punta al server finto spento | Togli la riga da `.env.local` o avvia il mock. |
| Nei log `store_fallback` | Upstash irraggiungibile: per un po' i contatori sono passati alla memoria | Controlla le variabili di Upstash su Vercel e lo stato del database. |
