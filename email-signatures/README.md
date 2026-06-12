# Firme email Zoho — Modolo Digital Studio

Firma brandizzata per le email in uscita da Zoho Mail, con lo stesso stile
dell'auto-reply del sito ([`lib/email.ts`](../lib/email.ts)): logo, colori
avorio/dark/gold, font Helvetica + Georgia corsivo per il ruolo.

| File | Uso |
|------|-----|
| `firma-zoho-ch.html` | Firma **Svizzera** (numero +41, indirizzo Winterthur) — predefinita |
| `firma-zoho-it.html` | Firma **Italia** (numero +39, indirizzo San Vendemiano) |
| `template-card-zoho.html` | Opzionale: email intera dentro la card avorio (da salvare come *Template* Zoho) |

## Installare una firma in Zoho Mail (web)

> Account su data center europeo? Usa **mail.zoho.eu** invece di mail.zoho.com.
> Percorso e pulsanti sono identici.

1. **Impostazioni** (ingranaggio in alto a destra) → nella barra laterale, **Signature**.
2. Clicca **+** per creare una nuova firma e dalle un nome (es. "MDS Svizzera").
3. Nella toolbar dell'editor apri **More Options** (l'icona `…`) → **Insert HTML** /
   **Edit Html**. Si apre un riquadro sorgente: seleziona tutto (Ctrl+A), cancella
   ed **incolla il sorgente** del `<table>…</table>` dal file `.html`. Poi
   **Apply Changes**.
   - *Se non trovi "Insert HTML"*: apri il file `.html` in Chrome, **Ctrl+A → Ctrl+C**,
     torna nel campo firma e **Ctrl+V** (incolli il render, non il codice).
4. **Il logo va inserito a parte** (vedi sotto: Zoho strippa il `<img>` incollato via HTML).
5. Associa la firma all'indirizzo `info@modolodigitalstudio.ch` e, se vuoi,
   spunta l'aggiunta automatica anche alle risposte.
6. **Save**.

Ripeti per la firma IT come seconda firma: in composizione potrai sceglierla
caso per caso (clienti italiani → firma IT).

## Il logo (importante)

Zoho **rimuove il `src` del `<img>` incollato nella casella HTML** in fase di
invio: nell'anteprima dell'editor il logo si vede (usa la tua sessione loggata),
ma nell'email spedita sparisce. Per questo il nome studio è anche in **testo**
(`<strong>Modolo Digital Studio</strong>`): così il brand c'è comunque.

Per avere **anche il logo** in modo affidabile, non affidarti al `<img>` del
sorgente: dopo aver incollato l'HTML, nell'editor **cancella il logo** e
**re-inseriscilo col pulsante Immagine** della toolbar → opzione **per URL/Link**
→ `https://www.modolodigitalstudio.ch/email-logo.png` (larghezza 170). Così Zoho
lo tiene come riferimento pubblico e non lo strippa. (Upload da disco = funziona
ma può diventare un URL interno autenticato che i destinatari non vedono.)

## Verificare (importante)

Manda **un'email di prova a Gmail e a una casella Zoho**, e controlla anche
sull'**app mobile Zoho**: serve a confermare che il logo si carichi (immagine
remota dal dominio) e che il layout regga.

## Note tecniche

- HTML **table-based, stili inline**: l'editor Zoho rimuove `<style>`/CSS esterno.
- Zoho **strippa il `src` del `<img>` incollato via HTML** in invio → logo inserito
  col pulsante Immagine (per URL) e nome studio anche in testo. Niente `data:`/base64.
- Contrasto verificato WCAG AA (indirizzo `#787061` = 4.90:1; gold `#8F6B2F` = 4.87:1).
- Reset Outlook (`mso-table-lspace/rspace`, `mso-line-height-rule:exactly`, divisori a `<div>`).
