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
4. Associa la firma all'indirizzo `info@modolodigitalstudio.ch` e, se vuoi,
   spunta l'aggiunta automatica anche alle risposte.
5. **Save**.

Ripeti per la firma IT come seconda firma: in composizione potrai sceglierla
caso per caso (clienti italiani → firma IT).

## Verificare (importante)

Manda **un'email di prova a Gmail e a una casella Zoho**, e controlla anche
sull'**app mobile Zoho**: serve a confermare che il logo si carichi (immagine
remota dal dominio) e che il layout regga.

## Note tecniche

- HTML **table-based, stili inline**: l'editor Zoho rimuove `<style>`/CSS esterno.
- Niente immagini `data:`/base64 (Zoho le strippa) — il logo è un URL pubblico HTTPS.
- Contrasto verificato WCAG AA (indirizzo `#787061` = 4.90:1; gold `#8F6B2F` = 4.87:1).
- Reset Outlook (`mso-table-lspace/rspace`, `mso-line-height-rule:exactly`, divisori a `<div>`).
