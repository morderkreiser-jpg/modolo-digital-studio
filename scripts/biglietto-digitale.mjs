#!/usr/bin/env node
/**
 * Asset del BIGLIETTO DA VISITA ELETTRONICO (la pagina /card · /de/visitenkarte · /it/biglietto).
 *
 * Genera tre cose che non hanno senso calcolare a ogni richiesta e che quindi vengono committate:
 *
 *   1. lib/vcard-photo.ts        la foto del viso in base64, incorporata nel file .vcf: e' cosi'
 *                               che il telefono di chi salva il contatto mostra la sua faccia
 *                               quando chiama. In un modulo TS e non letta da disco perche' una
 *                               route handler su Vercel non ha un filesystem su cui contare.
 *   2. public/qr-biglietto.svg   il QR che la pagina mostra a schermo: si inquadra da un altro
 *                               telefono e porta alla pagina stessa. Punta a /card senza locale,
 *                               cosi' proxy.ts negozia la lingua dal telefono che scansiona.
 *   3. public/og-biglietto-*.png l'anteprima che WhatsApp/iMessage mostrano quando manda il link.
 *                               E' il fronte del biglietto di carta, una per lingua: chi riceve il
 *                               messaggio vede un biglietto da visita prima ancora di aprire nulla.
 *
 * Uso:  node scripts/biglietto-digitale.mjs
 *
 * Il caricatore dei font e' quello corretto documentato in scripts/giro-a-piedi.mjs: Google Fonts
 * serve Space Grotesk come font VARIABILE ai browser moderni (Chrome headless lo scarta e stampa
 * tutto in Arial) — solo uno User-Agent legacy fa cadere Google sul canale con un file per peso.
 * La cache e' condivisa con gli altri script.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import QRCode from 'qrcode'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const OUT_DIR = join(HERE, 'output')
const FONT_CACHE = join(OUT_DIR, '.space-grotesk.json')
const PESI = ['400', '500', '700']

const CREMA = '#FBF8F2'
const INCHIOSTRO = '#17130E'
const ORO = '#B5893F'

/**
 * Il QR punta allo slug INGLESE senza prefisso: proxy.ts negozia Accept-Language, quindi un
 * telefono tedesco che lo inquadra finisce su /de/visitenkarte da solo. Lo slug non si scrive a
 * mano — si legge da lib/i18n.ts: se un giorno cambia, questo script si ferma invece di
 * generare in silenzio un QR stampato che porta a una pagina che non esiste piu'.
 */
function urlBiglietto() {
  const i18n = readFileSync(join(ROOT, 'lib/i18n.ts'), 'utf8')
  const riga = i18n.match(/biglietto:\s*\{([^}]*)\}/)
  const slug = riga?.[1].match(/\ben:\s*"([^"]+)"/)?.[1]
  if (!slug) {
    throw new Error('lib/i18n.ts: non trovo la voce SLUG_TRANSLATIONS.biglietto.en — il QR non si puo\' generare.')
  }
  return `https://www.modolodigitalstudio.ch/${slug}`
}

// Le righe vengono dal biglietto STAMPATO, verbatim. Se cambiano li', vanno cambiate qui:
// le due facce dello stesso oggetto non possono dire cose diverse.
const LINGUE = {
  de: {
    ruolo: 'Damit Ihr Betrieb gefunden wird',
    promessa: 'Sie schreiben, ich antworte selber',
    telefono: '+41 77 223 79 00',
    citta: 'WINTERTHUR',
  },
  it: {
    ruolo: 'Ti faccio trovare dai clienti in zona',
    promessa: 'Mi scriva, rispondo io di persona',
    telefono: '+41 77 223 79 00',
    citta: 'WINTERTHUR',
  },
  en: {
    ruolo: 'Getting your business found',
    promessa: 'Write to me, I answer myself',
    telefono: '+41 77 223 79 00',
    citta: 'WINTERTHUR',
  },
}

const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
].find((p) => existsSync(p))

/** Space Grotesk in base64, un file per peso. Vedi la nota in testa al file. */
async function spaceGrotesk() {
  if (existsSync(FONT_CACHE)) {
    const c = JSON.parse(readFileSync(FONT_CACHE, 'utf8'))
    const distinti = new Set(PESI.map((p) => c[p]?.uri).filter(Boolean)).size
    if (PESI.every((p) => c[p]) && distinti === PESI.length) return c
    console.log('  cache font incompleta — la riscarico')
  }
  const UA = 'Mozilla/5.0 (compatible; MSIE 9.0; Windows NT 6.1; Trident/5.0)'
  const css = await fetch(
    `https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@${PESI.join(';')}&display=swap`,
    { headers: { 'User-Agent': UA } },
  ).then((r) => r.text())

  const MIME = { woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf' }
  const FORMATO = { woff: 'woff', woff2: 'woff2', ttf: 'truetype' }
  const faces = {}
  for (const block of css.split('@font-face').slice(1)) {
    const weight = block.match(/font-weight:\s*(\d+)/)?.[1]
    const url = block.match(/url\((https:[^)]+\.(ttf|woff2?))\)/)?.[1]
    const ext = block.match(/url\(https:[^)]+\.(ttf|woff2?)\)/)?.[1]
    if (!weight || !url || faces[weight] || !PESI.includes(weight)) continue
    const buf = Buffer.from(await fetch(url, { headers: { 'User-Agent': UA } }).then((r) => r.arrayBuffer()))
    faces[weight] = { uri: `data:${MIME[ext]};base64,${buf.toString('base64')}`, format: FORMATO[ext] }
  }
  const mancanti = PESI.filter((p) => !faces[p])
  if (mancanti.length) throw new Error(`Space Grotesk: pesi mancanti ${mancanti.join(', ')} — serve rete la prima volta.`)
  if (new Set(PESI.map((p) => faces[p].uri)).size !== PESI.length) {
    throw new Error('Space Grotesk: i tre pesi sono lo stesso file (font variabile). Serve lo UA legacy.')
  }
  mkdirSync(OUT_DIR, { recursive: true })
  writeFileSync(FONT_CACHE, JSON.stringify(faces))
  return faces
}

// ---------------------------------------------------------------- 1. foto del contatto

async function fotoContatto() {
  // 400x400 ~ 10 KB: abbastanza nitida per la schermata di chiamata di un telefono e abbastanza
  // piccola da non gonfiare il .vcf (alcuni client tagliano i file grossi). iOS ritaglia la foto
  // del contatto a cerchio, quindi il viso al centro.
  //
  // BASELINE, non progressiva (`progressive: false`, niente mozjpeg): nessun fallimento di JPEG
  // progressivi in rubrica risulta documentato, ma una baseline e' esattamente quello che
  // esporterebbe il telefono stesso e qui il conservativo non costa niente.
  // `.rotate()` senza argomenti applica l'orientamento EXIF e poi lo butta via, cosi' la faccia
  // non puo' arrivare storta in rubrica e nel file non resta nessun metadato.
  const jpeg = await sharp(join(ROOT, 'public/founder-avatar.webp'))
    .rotate()
    .resize(400, 400, { fit: 'cover' })
    .jpeg({ quality: 82, progressive: false, mozjpeg: false, chromaSubsampling: '4:2:0' })
    .toBuffer()

  const b64 = jpeg.toString('base64')
  const file = `// GENERATO da scripts/biglietto-digitale.mjs — non modificare a mano.
//
// Il viso di Francesco, 400x400 JPEG (~${Math.round(jpeg.length / 1024)} KB), incorporato nel file .vcf che
// la pagina del biglietto fa scaricare. Sta in un modulo TypeScript e non in public/ perche' la
// route handler che compone il .vcf gira su Vercel, dove leggere un file da process.cwd() non e'
// garantito: una costante importata finisce nel bundle e non puo' mancare.
//
// Rigenerare con:  node scripts/biglietto-digitale.mjs

export const VCARD_PHOTO_JPEG_BASE64 =
  "${b64}";
`
  writeFileSync(join(ROOT, 'lib/vcard-photo.ts'), file)
  console.log(`  lib/vcard-photo.ts — ${Math.round(jpeg.length / 1024)} KB di JPEG, ${b64.length} caratteri base64`)
}

// ---------------------------------------------------------------- 2. QR della pagina

async function qr() {
  // Livello di correzione M: il QR viene mostrato su uno schermo, non stampato su carta ruvida —
  // non serve la ridondanza alta, e meno moduli = piu' leggibile da lontano e con luce scarsa.
  const url = urlBiglietto()
  const svg = await QRCode.toString(url, {
    type: 'svg',
    errorCorrectionLevel: 'M',
    margin: 0,
    color: { dark: INCHIOSTRO, light: '#0000' },
  })
  writeFileSync(join(ROOT, 'public/qr-biglietto.svg'), svg)
  console.log(`  public/qr-biglietto.svg — ${url}`)
}

// ---------------------------------------------------------------- 3. anteprime OG

function paginaOg(lingua, faces, monogramma) {
  const t = LINGUE[lingua]
  const face = (w) => `@font-face{font-family:SG;font-style:normal;font-weight:${w};src:url(${faces[w].uri}) format('${faces[w].format}');}`
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${PESI.map(face).join('\n')}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px}
body{background:${CREMA};font-family:SG,sans-serif;color:${INCHIOSTRO};
  display:flex;flex-direction:column;justify-content:center;padding:0 96px;position:relative}
.testa{display:flex;align-items:center;gap:22px;margin-bottom:56px}
.testa img{width:74px;height:74px;object-fit:contain}
.studio{font-size:20px;font-weight:500;letter-spacing:.22em}
.nome{font-size:76px;font-weight:700;letter-spacing:-.02em;line-height:1}
.ruolo{font-size:30px;font-weight:400;margin-top:16px;color:rgba(23,19,14,.78)}
.filetto{width:96px;height:3px;background:${ORO};margin:44px 0 40px}
.righe{font-size:27px;font-weight:400;line-height:1.62;color:rgba(23,19,14,.9)}
.citta{position:absolute;right:96px;bottom:74px;font-size:19px;font-weight:500;letter-spacing:.22em;color:${ORO}}
.promessa{position:absolute;right:96px;top:74px;font-size:21px;font-weight:500;color:rgba(23,19,14,.6)}
</style></head><body>
<div class="testa"><img src="${monogramma}" alt=""><span class="studio">MODOLO DIGITAL STUDIO</span></div>
<div class="nome">Francesco Modolo</div>
<div class="ruolo">${t.ruolo}</div>
<div class="filetto"></div>
<div class="righe">${t.telefono}<br>info@modolodigitalstudio.ch<br>modolodigitalstudio.ch</div>
<div class="promessa">${t.promessa}</div>
<div class="citta">${t.citta}</div>
</body></html>`
}

function anteprimeOg(faces) {
  if (!CHROME) {
    console.log('  Chrome non trovato: salto le anteprime OG (le altre due cose sono a posto).')
    return
  }
  const monogramma = `data:image/png;base64,${readFileSync(join(ROOT, 'public/logo-mark.png')).toString('base64')}`
  mkdirSync(OUT_DIR, { recursive: true })

  for (const lingua of Object.keys(LINGUE)) {
    const html = join(OUT_DIR, `.og-biglietto-${lingua}.html`)
    const png = join(ROOT, 'public', `og-biglietto-${lingua}.png`)
    writeFileSync(html, paginaOg(lingua, faces, monogramma))
    execFileSync(CHROME, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars',
      '--window-size=1200,630',
      `--screenshot=${png}`,
      // I font sono gia' dentro l'HTML in base64: il ritardo serve solo a dare a Chrome il tempo
      // di applicarli prima dello scatto, non a scaricare nulla.
      '--virtual-time-budget=3000',
      `file:///${html.replace(/\\/g, '/')}`,
    ], { stdio: 'pipe' })
    rmSync(html, { force: true })
    console.log(`  public/og-biglietto-${lingua}.png`)
  }
}

// ----------------------------------------------------------------

console.log('Biglietto da visita elettronico — asset:')
const faces = await spaceGrotesk()
await fotoContatto()
await qr()
anteprimeOg(faces)
console.log('Fatto.')
