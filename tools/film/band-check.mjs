#!/usr/bin/env node
/**
 * Hero film: mobile band check (gate G4). Runs against the BUILT page.
 *
 *   node tools/film/band-check.mjs [--base http://localhost:3420] [--sizes 390x844,375x667,360x640,375x553]
 *        [--locales de,it,en] [--media C:\Users\franc\progetti\modolo-media-src]
 *
 * For every shot of the 9:16 edit it takes 3 frames (first, middle, last) from the SHIPPED 9:16 H.264
 * (path from lib/film-media.ts, timing from MEDIA/build/report.json), puts each one into the real page as the
 * poster (Layout P, prefers-reduced-motion so no video mounts), and screenshots the first viewport at every
 * size and locale. Output, one contact strip per size for human sign-off:
 *   MEDIA/build/band/band-<w>x<h>.png   rows = shots, columns = locale x (first, middle, last)
 * Pass (signed in the review, FILM-HERO-SPEC G4): every proof shot shows the device top (site header / logo row) inside
 * the band; the how-beats show pen + sketch, camera LCD, key. The band rectangle is outlined in the strip (computed from
 * the DOM: bottom of the h1 to the top of the visible live credit, or of the sub when there is no credit), so
 * "subject in the band" can be judged at a glance.
 */
import { chromium } from "file:///C:/Users/franc/progetti/ZUMOVE/node_modules/playwright/index.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const BASE = opt("base", process.env.BASE_URL ?? "http://localhost:3420").replace(/\/$/, "");
const MEDIA = opt("media", "C:/Users/franc/progetti/modolo-media-src");
const SIZES = opt("sizes", "390x844,375x667,360x640,375x553").split(",").map((s) => s.split("x").map(Number));
const LOCALES = opt("locales", "de,it,en").split(",");
const PATHS = { de: "/de", it: "/it", en: "/" };
const OUT = path.join(MEDIA, "build", "band");
const FR = path.join(OUT, "frames");
fs.mkdirSync(FR, { recursive: true });

const manifest = fs.readFileSync(path.join(REPO, "lib", "film-media.ts"), "utf8");
const video = path.join(REPO, "public", manifest.match(/src:\s*"\/(film\/hero-[^"]+-9x16-720\.h264\.mp4)"/)[1]);
const report = JSON.parse(fs.readFileSync(path.join(MEDIA, "build", "report.json"), "utf8"));
const edit = report.edit["9x16"];

// 1. frames from the shipped file (exact frame numbers, BT.709 decode)
const picks = [];
for (const s of edit) {
  for (const [k, f] of [["first", s.startFrame], ["mid", s.startFrame + Math.floor(s.frames / 2)], ["last", s.startFrame + s.frames - 1]]) {
    const file = path.join(FR, `f${String(f).padStart(3, "0")}.jpg`);
    if (!fs.existsSync(file)) {
      const r = spawnSync("ffmpeg", ["-v", "error", "-y", "-i", video, "-vf",
        `select=eq(n\\,${f}),scale=in_color_matrix=bt709:in_range=tv:flags=lanczos+full_chroma_int`, "-frames:v", "1", "-q:v", "2", file]);
      if (r.status !== 0) throw new Error(String(r.stderr));
    }
    picks.push({ slot: s.slot, id: s.id, which: k, frame: f, file });
  }
}

// 2. the real page with each frame as its poster
const browser = await chromium.launch();
const shots = [];
for (const [w, h] of SIZES) {
  for (const loc of LOCALES) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true,
      reducedMotion: "reduce", locale: { de: "de-CH", it: "it-CH", en: "en-GB" }[loc] });
    const page = await ctx.newPage();
    await page.route("**/__band/**", (route) => route.fulfill({ path: path.join(FR, path.basename(new URL(route.request().url()).pathname)), contentType: "image/jpeg" }));
    await page.goto(BASE + PATHS[loc], { waitUntil: "load", timeout: 90000 });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: "nextjs-portal,[data-consent-banner],#consent-banner,.consent-banner{display:none!important}" });
    const band = await page.evaluate(() => {
      const hero = document.querySelector("section[data-film]");
      const h1 = hero?.querySelector("h1");
      const credit = hero ? [...hero.querySelectorAll("[data-film-credit]")].find((e) => e.checkVisibility()) : null;
      const sub = hero?.querySelector("h1 ~ p, p");
      const low = credit ?? sub;
      if (!hero || !h1 || !low) return null;
      return { top: h1.getBoundingClientRect().bottom, bottom: low.getBoundingClientRect().top };
    });
    for (const p of picks) {
      await page.evaluate(async (src) => {
        const pic = document.querySelector("section[data-film] picture");
        const img = pic ? pic.querySelector("img") : document.querySelector("section[data-film] img");
        if (pic) for (const s of pic.querySelectorAll("source")) s.remove();
        img.removeAttribute("srcset"); img.removeAttribute("sizes");
        img.src = src;
        await img.decode();
      }, `/__band/${path.basename(p.file)}`);
      const file = path.join(OUT, `${w}x${h}`, `${loc}-f${String(p.frame).padStart(3, "0")}.png`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      await page.screenshot({ path: file });
      shots.push({ ...p, w, h, loc, png: file, band });
    }
    await ctx.close();
    console.log(`✓ ${w}x${h} ${loc}: ${picks.length} frames${band ? `, band y ${Math.round(band.top)}–${Math.round(band.bottom)} (${Math.round(band.bottom - band.top)} px)` : ", band NOT found"}`);
  }
}

// 3. one strip per size: rows = shots, columns = locale × first/mid/last (half size)
for (const [w, h] of SIZES) {
  const rows = edit.map((s) => {
    const cells = LOCALES.flatMap((loc) => ["first", "mid", "last"].map((k) => shots.find((x) => x.w === w && x.loc === loc && x.slot === s.slot && x.which === k)));
    return `<div class="row"><div class="lab">${s.slot}<br>${s.id}</div>${cells.map((c) => `<figure><img src="${pathToFileURL(c.png).href}">${c.band
      ? `<i style="top:${c.band.top / 2}px;height:${(c.band.bottom - c.band.top) / 2}px"></i>` : ""}<figcaption>${c.loc} f${c.frame} ${c.which}</figcaption></figure>`).join("")}</div>`;
  }).join("");
  const html = `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#222;font:11px/1.2 Consolas,monospace;color:#eee}
    .row{display:flex;gap:6px;padding:6px}.lab{width:56px;color:#e8c877}figure{margin:0;position:relative;width:${w / 2}px}
    img{width:${w / 2}px;height:${h / 2}px;display:block}i{position:absolute;left:0;right:0;border-top:1px dashed #0f0;border-bottom:1px dashed #0f0}
    figcaption{padding-top:2px}</style><h3 style="margin:6px">G4 band check ${w}x${h} — green dashes = film band (h1 bottom → credit top)</h3>${rows}`;
  const hf = path.join(OUT, `band-${w}x${h}.html`);
  fs.writeFileSync(hf, html);
  const ctx = await browser.newContext({ viewport: { width: Math.ceil(60 + LOCALES.length * 3 * (w / 2 + 6)), height: 400 } });
  const page = await ctx.newPage();
  await page.goto(pathToFileURL(hf).href, { waitUntil: "load" });
  await page.screenshot({ path: path.join(OUT, `band-${w}x${h}.png`), fullPage: true });
  await ctx.close();
  console.log(`strip → ${path.join(OUT, `band-${w}x${h}.png`)}`);
}
await browser.close();
