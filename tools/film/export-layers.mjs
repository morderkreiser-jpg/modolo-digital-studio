#!/usr/bin/env node
/**
 * Hero film: export the layers that the contrast gate (G3, contrast-gate.py) composites over every frame.
 * Runs against the BUILT page (next start / the preview / the dev server), never a mock in production.
 *
 *   node tools/film/export-layers.mjs [--base http://localhost:3420] [--out <MEDIA>/build/layers]
 *        [--vp 1920x1080,1440x900,...] [--locales de,it,en] [--hide "<css selector>"]
 *
 * Per viewport × locale it writes (method of judge-cro layer.mjs):
 *   <case>.json        every visible text LINE rect over the hero (hero + nav), with colour, alpha, size,
 *                      weight, whether it sits on its own opaque background; the toggle icon and its
 *                      focus ring (3:1 targets); the media box (rect, object-fit, object-position) and
 *                      which film rendition this viewport plays (PORTRAIT_MQ, 1280 px rule from lib/film-media.ts).
 *                      v2: the live credit is exported twice: `lines` as rendered (data-state="lit" on the poster's
 *                      shot) and `linesDim` with data-state="dim" set on the visible [data-film-credit] (the state it
 *                      takes during the «how» beats); contrast-gate.py uses linesDim on frames whose shot has no project.
 *   <case>_scrims.png  RGBA: scrims + grain + every non-media layer, text and icons transparent, media hidden
 *   <case>_text.png    RGBA: the same with text visible (for composites / visual sign-off)
 * The page is loaded with prefers-reduced-motion: reduce, so no <video> mounts and the layout is static;
 * the poster <picture> and any <video> inside the hero are hidden for the screenshots.
 */
import { chromium } from "file:///C:/Users/franc/progetti/ZUMOVE/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const BASE = opt("base", process.env.BASE_URL ?? "http://localhost:3420").replace(/\/$/, "");
const MEDIA = opt("media", "C:/Users/franc/progetti/modolo-media-src");
const OUT = path.resolve(opt("out", path.join(MEDIA, "build", "layers")));
const VPS = opt("vp", "1920x1080,1440x900,1366x768,1280x720,1024x768,768x1024,430x932,412x915,390x844,375x667,360x640,375x553")
  .split(",").map((s) => s.split("x").map(Number));
const LOCALES = opt("locales", "de,it,en").split(",");
const HIDE = opt("hide", "nextjs-portal, [data-consent-banner], #consent-banner, .consent-banner, [data-sticky-bar]");
const PATHS = { de: "/de", it: "/it", en: "/" };
fs.mkdirSync(OUT, { recursive: true });

// The two media queries come from the generated manifest (single source of truth).
const manifest = fs.readFileSync(path.join(REPO, "lib", "film-media.ts"), "utf8");
const PORTRAIT_MQ = manifest.match(/PORTRAIT_MQ\s*=\s*"([^"]+)"/)[1];
const L1080_MQ = manifest.match(/LANDSCAPE_1080_MQ\s*=\s*"([^"]+)"/)[1];

const browser = await chromium.launch();
const index = [];
for (const [w, h] of VPS) {
  for (const loc of LOCALES) {
    const name = `${loc}_${w}x${h}`;
    const mobile = w < 768;
    const ctx = await browser.newContext({
      viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
      reducedMotion: "reduce", locale: { de: "de-CH", it: "it-CH", en: "en-GB" }[loc],
    });
    const page = await ctx.newPage();
    const url = BASE + PATHS[loc];
    await page.goto(url, { waitUntil: "load", timeout: 90000 });
    await page.evaluate(() => document.fonts.ready);
    await page.addStyleTag({ content: `${HIDE}{display:none!important}` });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(500);

    const info = await page.evaluate(({ PORTRAIT_MQ, L1080_MQ }) => {
      const hero = document.querySelector("section[data-film]") || document.querySelector("main section");
      const creditEl = [...document.querySelectorAll("section[data-film] [data-film-credit]")].find((e) => e.checkVisibility());
      if (!hero) return { error: "no hero section[data-film]" };
      const hr = hero.getBoundingClientRect();
      const nav = document.querySelector("header") || document.querySelector("nav");
      const roots = [hero, nav].filter(Boolean);
      const parseC = (s) => { const m = s && s.match(/rgba?\(([^)]+)\)/); if (!m) return null;
        const v = m[1].split(/[ ,/]+/).filter(Boolean).map(parseFloat); return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
      const opaqueBehind = (el, root) => { for (let e = el; e && e !== root.parentElement; e = e.parentElement) {
          const cs = getComputedStyle(e);
          if (cs.backgroundImage && cs.backgroundImage.includes("gradient") && !e.matches("section[data-film]")) return true;
          const c = parseC(cs.backgroundColor); if (c && c.a >= 0.9 && !e.matches("section[data-film]")) return true; } return false; };
      const opac = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= parseFloat(getComputedStyle(e).opacity || 1); return o; };
      const srOnly = (el) => { for (let e = el; e; e = e.parentElement) { const cs = getComputedStyle(e);
          if (cs.clip && cs.clip.startsWith("rect(0") || cs.clipPath === "inset(50%)" || (parseFloat(cs.width) <= 1 && cs.overflow === "hidden")) return true; } return false; };
      const isLogo = (el) => !!el.closest('[data-logo], a[aria-label*="MODOLO" i], a[href="/"]:has(img), a[href="/de"]:has(img), a[href="/it"]:has(img)');
      const collect = () => {
        const lines = [];
        const seen = new Set();
        for (const root of roots) {
          const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
          let n;
          while ((n = tw.nextNode())) {
            if (!n.textContent.trim() || seen.has(n)) continue;
            seen.add(n);
            const el = n.parentElement; const cs = getComputedStyle(el);
            if (cs.visibility === "hidden" || cs.display === "none" || el.closest("[hidden],[aria-hidden='true'] svg")) continue;
            if (srOnly(el)) continue;
            const r = document.createRange(); r.selectNodeContents(n);
            const rects = [...r.getClientRects()].filter((q) => q.width > 2 && q.height > 2 && q.top >= 0 && q.bottom <= innerHeight && q.left >= 0 && q.right <= innerWidth
              && q.top >= hr.top - 1 && q.bottom <= hr.bottom + 1);
            if (!rects.length) continue;
            const c = parseC(cs.color);
            lines.push({
              root: root === hero ? "hero" : "nav", tag: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : ""),
              text: n.textContent.trim().replace(/\s+/g, " ").slice(0, 48), fs: parseFloat(cs.fontSize), fw: parseInt(cs.fontWeight, 10),
              color: c, opacity: opac(el), onOpaque: opaqueBehind(el, root), logo: isLogo(el), inH1: !!el.closest("h1"),
              inCredit: !!el.closest("[data-film-credit]"),
              rects: rects.map((q) => [q.left, q.top, q.width, q.height]),
            });
          }
        }
        return lines;
      };
      const lines = collect();
      // the credit as it looks during the «how» beats (data-state="dim"): same rows, lower opacity
      let linesDim = null;
      if (creditEl) {
        const prev = creditEl.getAttribute("data-state");
        creditEl.setAttribute("data-state", "dim");
        linesDim = collect();
        if (prev === null) creditEl.removeAttribute("data-state"); else creditEl.setAttribute("data-state", prev);
      }
      // non-text 3:1 targets: the film toggle's icon and focus ring
      const toggle = [...hero.querySelectorAll("button")].find((b) => b.checkVisibility() && b.getBoundingClientRect().width > 0
        && /film|video|anhalten|abspielen|pausa|riproduci|ferma|avvia/i.test(b.getAttribute("aria-label") || b.textContent || ""));
      const icons = [];
      let ring = null;
      if (toggle) {
        for (const s of toggle.querySelectorAll("svg")) {
          const q = s.getBoundingClientRect(); const c = parseC(getComputedStyle(s).color);
          if (q.width > 2) icons.push({ text: "toggle icon", color: c, opacity: opac(s), rect: [q.left, q.top, q.width, q.height] });
        }
        toggle.focus({ focusVisible: true });
        const cs = getComputedStyle(toggle);
        const q = toggle.getBoundingClientRect();
        const ow = parseFloat(cs.outlineWidth) || 0, oo = parseFloat(cs.outlineOffset) || 0;
        if (cs.outlineStyle !== "none" && ow > 0) {
          const pad = oo + ow;
          ring = { text: "toggle focus ring", color: parseC(cs.outlineColor), width: ow,
                   rect: [q.left - pad, q.top - pad, q.width + 2 * pad, q.height + 2 * pad], inner: [q.left - oo, q.top - oo, q.width + 2 * oo, q.height + 2 * oo] };
        }
        toggle.blur();
      }
      const media = hero.querySelector("picture img") || hero.querySelector("video") || hero.querySelector("img");
      const mr = media.getBoundingClientRect(); const mcs = getComputedStyle(media);
      const portrait = matchMedia(PORTRAIT_MQ).matches;
      const set = portrait ? "9x16-720" : matchMedia(L1080_MQ).matches ? "16x9-1080" : "16x9-720";
      return {
        url: location.href, vw: innerWidth, vh: innerHeight, hero: [hr.left, hr.top, hr.width, hr.height],
        portrait, set, media: { tag: media.tagName.toLowerCase(), rect: [mr.left, mr.top, mr.width, mr.height], fit: mcs.objectFit, pos: mcs.objectPosition, src: media.currentSrc || media.src },
        toggleFound: !!toggle, lines, linesDim, credit: creditEl ? { layout: creditEl.getAttribute("data-film-credit"), project: creditEl.getAttribute("data-project"), state: creditEl.getAttribute("data-state") } : null,
        icons, ring,
      };
    }, { PORTRAIT_MQ, L1080_MQ });

    if (info.error) { console.log(`✗ ${name}: ${info.error}`); await ctx.close(); continue; }
    info.case = name; info.locale = loc;
    fs.writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(info, null, 1));

    // layers: media hidden, page transparent; blend-mode layers cannot be captured on alpha -> warn + hide
    const blends = await page.evaluate(() => { const out = [];
      for (const e of document.querySelectorAll("section[data-film] *, header *")) { const m = getComputedStyle(e).mixBlendMode;
        if (m !== "normal") { out.push(`${e.tagName.toLowerCase()}.${String(e.className).split(" ")[0]} ${m}`); e.style.display = "none"; } }
      return out; });
    if (blends.length) console.log(`  ! ${name}: mix-blend-mode layers hidden in the export: ${blends.join(", ")}`);
    await page.addStyleTag({ content: `html,body{background:transparent!important} section[data-film]{background:transparent!important}
      section[data-film] picture, section[data-film] video, section[data-film] picture img{visibility:hidden!important}` });
    // every ancestor of the hero must be transparent too (v2: <main> paints the page's cream background, which made
    // the whole layer opaque and the film invisible to the gate)
    await page.evaluate(() => { for (let e = document.querySelector("section[data-film]"); e; e = e.parentElement) e.style.setProperty("background", "transparent", "important"); });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `${name}_text.png`), omitBackground: true });
    await page.addStyleTag({ content: `*,*::before,*::after{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;
      text-decoration-color:transparent!important;caret-color:transparent!important;outline-color:transparent!important}
      section[data-film] svg, header svg{visibility:hidden!important} section[data-film] img, header img{visibility:hidden!important}` });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(OUT, `${name}_scrims.png`), omitBackground: true });
    index.push({ case: name, set: info.set, portrait: info.portrait, lines: info.lines.length, toggle: info.toggleFound, ring: !!info.ring, media: info.media });
    console.log(`✓ ${name.padEnd(14)} ${info.set.padEnd(10)} lines ${String(info.lines.length).padStart(3)}  toggle ${info.toggleFound ? "yes" : "NO"}  ring ${info.ring ? "yes" : "no"}  media ${info.media.tag} ${info.media.fit} ${info.media.pos}`);
    await ctx.close();
  }
}
await browser.close();
fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ base: BASE, generated: new Date().toISOString(), cases: index }, null, 1));
console.log(`\nlayers → ${OUT}`);
