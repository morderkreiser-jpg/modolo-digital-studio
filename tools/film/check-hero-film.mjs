#!/usr/bin/env node
/**
 * Hero film behaviour check, v2 (FILM-HERO-SPEC §1.10, §1.11 G8/G8b/G9, §2.5; acceptance A18, A19, A26, A27).
 * Runs against the BUILT page (dev server, next start or a preview).
 *
 *   node tools/film/check-hero-film.mjs [--base http://localhost:3420] [--only <case substring>] [--skip-hosts]
 *
 * Cases (v1, kept)
 *   desktop 1440×900 /de, laptop 1024×768 /de, phone 390×844 /de and / : the right rendition plays (AV1 in Chromium),
 *                             no video byte before `load`, LCP = h1 or sub <p>, toggle reads «pause», tap pauses/plays
 *   /it 1440×900              starts at FILM.startAt.it with the it poster (both follow de)
 *   reduced motion · Save-Data · mds-film-paused=1
 *                             no <video> request; toggle reads «play»; pressing it plays; the credit stays on the
 *                             poster's shot (BJ Studio, lit)
 *   keyboard + states         Tab order, Enter/Space, no aria-pressed, off-screen and hidden-tab pause
 * Cases (v2)
 *   G8 credit = shot          page-side requestVideoFrameCallback recorder over one loop at 1440×900 and 390×844, AV1
 *                             (Playwright Chromium) and H.264 (Chrome; the AV1 URL answers with the H.264 bytes, so no
 *                             source error is involved): the visible [data-film-credit]
 *                             has data-project = FILM.shots[filmShotAt(mediaTime)].credit and data-state = lit iff the
 *                             shot has a project, on every presented frame except at most 1 frame after each cut
 *   fallback                  Chrome with the AV1 request aborted: the H.264 <source> must take over and play
 *   pause freezes the credit  pressing pause keeps the credit on the paused frame's shot
 *   resize remount            1440×900 → 390×844 while playing: a new <video> (9:16), the credit back to BJ Studio
 *   G8b                       every project host in the hero HTML is a FILM.projects host; no «zumove» in the hero HTML
 *                             and no -zu- file in public/film while data/projects.ts still marks ZUMOVE `approval`
 *   G9                        every FILM.projects[].url answers 200 (at most one redirect)
 * Exit code 1 if anything deviates. Writes MEDIA/build/check-hero-film.json.
 */
import { chromium } from "file:///C:/Users/franc/progetti/ZUMOVE/node_modules/playwright/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "..", "..");
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i === -1 ? d : argv[i + 1]; };
const BASE = opt("base", process.env.BASE_URL ?? "http://localhost:3420").replace(/\/$/, "");
const ONLY = opt("only", null);
const SKIP_HOSTS = argv.includes("--skip-hosts");

// The generated manifest is plain TypeScript with a type-only import: Node 24 strips the types and imports it.
const { FILM, filmShotAt } = await import(pathToFileURL(path.join(REPO, "lib", "film-media.ts")).href);
const { PROJECTS } = await import(pathToFileURL(path.join(REPO, "data", "projects.ts")).href);
const SRC = (key, codec) => FILM.sources[key].find((s) => s.codec === codec).src;
const START_IT = FILM.startAt.it;
const POSTER_IT = (orient) => FILM.posters[orient][FILM.posterStart.it].avif.src.replace(/\.avif$/, "");
const NAME_PLAY = /Film abspielen|Riproduci video|Play film/;
const NAME_PAUSE = /Film anhalten|Pausa video|Pause film/;
const POSTER_SHOT = (lang) => filmShotAt(FILM.startAt[lang]);
const EXPECT = (i) => ({ project: FILM.shots[i].credit, state: FILM.shots[i].project === null ? "dim" : "lit" });

let problems = 0;
const results = [];
function report(name, checks) {
  const bad = checks.filter((c) => !c.ok);
  problems += bad.length;
  results.push({ name, ok: !bad.length, checks });
  console.log(`\n  ${bad.length ? "✗" : "✓"} ${name}`);
  for (const c of checks) console.log(`      ${c.ok ? "ok " : "XX "} ${c.what}${c.info !== undefined ? `  → ${c.info}` : ""}`);
}

const browser = await chromium.launch();
let chrome = null;   // H.264 needs a browser with proprietary codecs (Playwright's Chromium has none)
async function chromeBrowser() {
  if (chrome) return chrome;
  for (const channel of ["chrome", "msedge"]) {
    try { chrome = await chromium.launch({ channel }); return chrome; } catch { /* next */ }
  }
  return null;
}

async function open(name, { vp = [1440, 900], url = "/de", reduced = "no-preference", mobile = false, init = null, b = browser, blockAv1 = false, h264AsAv1 = false } = {}) {
  const ctx = await b.newContext({
    viewport: { width: vp[0], height: vp[1] }, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile,
    reducedMotion: reduced, locale: url.startsWith("/it") ? "it-CH" : url === "/" ? "en-GB" : "de-CH",
  });
  if (init) await ctx.addInitScript(init);
  await ctx.addInitScript(() => {
    window.__lcp = [];
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp.push(e); }).observe({ type: "largest-contentful-paint", buffered: true });
    window.__loadAt = null;
    addEventListener("load", () => { window.__loadAt = performance.now(); });
  });
  if (blockAv1) await ctx.route(/\.av1\.mp4(\?|$)/, (route) => route.abort());
  // H.264 decode test without a source error: the AV1 URL answers with the H.264 file of the same rendition
  if (h264AsAv1) await ctx.route(/\.av1\.mp4(\?|$)/, (route) => {
    const key = route.request().url().match(/-(16x9-1080|16x9-720|9x16-720)\.av1\.mp4/)[1];
    return route.fulfill({ path: path.join(REPO, "public", SRC(key, "h264")), contentType: "video/mp4" });
  });
  const page = await ctx.newPage();
  const media = [];
  page.on("request", (r) => { if (/\.(mp4|webm)(\?|$)/.test(r.url())) media.push({ url: r.url().split("/").pop() }); });
  await page.goto(BASE + url, { waitUntil: "load", timeout: 90000 });
  return { ctx, page, media };
}
const videoState = (page) => page.evaluate(() => {
  const v = document.querySelector("section[data-film] video");
  if (!v) return { present: false };
  return { present: true, src: (v.currentSrc || "").split("/").pop(), paused: v.paused, time: +v.currentTime.toFixed(2),
           w: v.videoWidth, h: v.videoHeight, ready: v.readyState, muted: v.muted, loop: v.loop, inline: v.playsInline,
           ariaHidden: v.getAttribute("aria-hidden"), poster: v.getAttribute("poster"), error: v.error ? v.error.code : null };
});
const creditState = (page) => page.evaluate(() => {
  const c = [...document.querySelectorAll("section[data-film] [data-film-credit]")].find((e) => e.checkVisibility());
  return c ? { project: c.getAttribute("data-project"), state: c.getAttribute("data-state"), layout: c.getAttribute("data-film-credit") } : null;
});
const toggle = (page) => page.locator("section[data-film] button").filter({ hasText: /film|video/i }).or(
  page.locator("section[data-film] button[aria-label*='ilm'], section[data-film] button[aria-label*='ideo']")).filter({ visible: true }).first();
/** The toggle's accessible name: aria-label, else its text outside aria-hidden parts (the inactive label of the
 *  two that share one grid cell is aria-hidden, so textContent alone would read both). */
const toggleInfo = async (page) => {
  const t = toggle(page);
  if (!(await t.count())) return null;
  return t.evaluate((b) => {
    const acc = (el) => { let s = ""; for (const c of el.childNodes) { if (c.nodeType === 3) s += c.textContent;
      else if (c.nodeType === 1 && c.getAttribute("aria-hidden") !== "true") s += acc(c); } return s; };
    return { name: (b.getAttribute("aria-label") || acc(b)).replace(/\s+/g, " ").trim(), pressed: b.hasAttribute("aria-pressed") };
  });
};
const videoTimings = (page) => page.evaluate(() => ({
  load: window.__loadAt,
  mp4: performance.getEntriesByType("resource").filter((e) => /\.mp4/.test(e.name)).map((e) => ({ name: e.name.split("/").pop(), start: Math.round(e.startTime) })),
}));
const lcp = (page) => page.evaluate(() => {
  const last = window.__lcp[window.__lcp.length - 1];
  const el = last && last.element;
  const host = el && (el.closest("h1, p") || el);
  return last ? { tag: host ? host.tagName.toLowerCase() : null, text: el ? (el.textContent || "").trim().slice(0, 50) : last.url, time: Math.round(last.startTime) } : null;
});
const run = (name) => !ONLY || name.includes(ONLY);
const bjLit = (cs, lang = "de") => !!cs && cs.project === EXPECT(POSTER_SHOT(lang)).project && cs.state === EXPECT(POSTER_SHOT(lang)).state;

// ── 1-3: the right rendition plays per layout ───────────────────────────────────────────────────
for (const c of [
  { name: "desktop 1440x900 /de", vp: [1440, 900], url: "/de", key: "16x9-1080", lcpCheck: true },
  { name: "laptop 1024x768 /de", vp: [1024, 768], url: "/de", key: "16x9-720" },
  { name: "phone 390x844 /de", vp: [390, 844], url: "/de", key: "9x16-720", mobile: true, lcpCheck: true },
  { name: "phone 390x844 / (en)", vp: [390, 844], url: "/", key: "9x16-720", mobile: true },
]) {
  if (!run(c.name)) continue;
  const { ctx, page } = await open(c.name, { vp: c.vp, url: c.url, mobile: c.mobile });
  await page.waitForTimeout(4500);
  const s = await videoState(page);
  const tm = await videoTimings(page);
  const want = [SRC(c.key, "av1").split("/").pop(), SRC(c.key, "h264").split("/").pop()];
  const checks = [
    { what: "a <video> is mounted after load", ok: s.present },
    { what: `plays the ${c.key} rendition`, ok: s.present && want.includes(s.src), info: s.src },
    { what: "is playing (time advances, not paused)", ok: s.present && !s.paused && s.time > 0.3, info: s.present ? `t=${s.time}s paused=${s.paused} ${s.w}x${s.h}` : "-" },
    { what: "muted, loop, playsinline, aria-hidden, no poster attribute", ok: s.present && s.muted && s.loop && s.inline && s.ariaHidden === "true" && !s.poster },
    { what: "0 video bytes before the load event", ok: tm.mp4.every((m) => tm.load !== null && m.start >= tm.load), info: `load ${Math.round(tm.load)} ms, mp4 at ${tm.mp4.map((m) => m.start).join(", ") || "-"} ms` },
  ];
  const ti = await toggleInfo(page);
  checks.push({ what: "toggle reads «pause» while playing, no aria-pressed", ok: !!ti && NAME_PAUSE.test(ti.name) && !ti.pressed, info: ti ? ti.name : "no toggle" });
  if (c.lcpCheck) {
    const l = await lcp(page);
    checks.push({ what: "LCP element is the h1 or the sub <p> (not the poster)", ok: !!l && (l.tag === "h1" || l.tag === "p"), info: l ? `${l.tag} "${l.text}" @${l.time} ms` : "none" });
  }
  if (c.mobile) {
    await toggle(page).tap();
    await page.waitForTimeout(500);
    const s2 = await videoState(page); const t2 = await toggleInfo(page);
    checks.push({ what: "tap on the toggle pauses, name → «play»", ok: s2.paused && NAME_PLAY.test(t2?.name ?? ""), info: t2?.name });
    await toggle(page).tap();
    await page.waitForTimeout(800);
    const s3 = await videoState(page);
    checks.push({ what: "second tap plays again", ok: !s3.paused });
  }
  report(c.name, checks);
  await ctx.close();
}

// ── 4: /it start ────────────────────────────────────────────────────────────────────────────────
if (run("/it start")) {
  const { ctx, page } = await open("/it start", { vp: [1440, 900], url: "/it" });
  const poster = await page.evaluate(() => { const i = document.querySelector("section[data-film] picture img"); return i ? i.currentSrc : null; });
  const first = await page.evaluate(() => new Promise((res) => {
    const tick = () => { const v = document.querySelector("section[data-film] video");
      if (v && !v.paused && v.currentTime > 0) return res(+v.currentTime.toFixed(2)); setTimeout(tick, 40); };
    tick(); setTimeout(() => res(null), 9000);
  }));
  report("/it start 1440x900", [
    { what: `the poster is the ${FILM.posterStart.it} poster (frame ${START_IT * FILM.fps})`, ok: !!poster && poster.includes(POSTER_IT("16x9").split("/").pop()), info: poster && poster.split("/").pop() },
    { what: `film starts at ${START_IT} s`, ok: first !== null && first >= START_IT - 0.05 && first < START_IT + 1.5, info: first === null ? "never played" : `first sample t=${first}s` },
  ]);
  await ctx.close();
}

// ── 5-7: no video request when the film must not autoplay; the credit stays on the poster's shot ──
for (const c of [
  { name: "reduced motion /de", reduced: "reduce", optIn: true },
  { name: "Save-Data /de", init: () => { Object.defineProperty(navigator, "connection", { configurable: true,
      value: { saveData: true, effectiveType: "4g", addEventListener() {}, removeEventListener() {} } }); }, optIn: true },
  { name: "localStorage mds-film-paused=1 /de", init: () => { try { localStorage.setItem("mds-film-paused", "1"); } catch {} }, optIn: false },
]) {
  if (!run(c.name)) continue;
  const { ctx, page, media } = await open(c.name, { reduced: c.reduced ?? "no-preference", init: c.init });
  await page.waitForTimeout(3500);
  const s = await videoState(page); const ti = await toggleInfo(page);
  const cs = await creditState(page);
  const checks = [
    { what: "no <video> element and no video request", ok: !s.present && media.length === 0, info: media.map((m) => m.url).join(", ") || "none" },
    { what: "poster visible, toggle reads «play»", ok: !!ti && NAME_PLAY.test(ti.name) && !ti.pressed, info: ti ? ti.name : "no toggle" },
    { what: "credit = the poster's shot (BJ Studio, lit)", ok: bjLit(cs), info: JSON.stringify(cs) },
  ];
  if (c.optIn) {
    await toggle(page).click();
    await page.waitForTimeout(3500);
    const s2 = await videoState(page); const t2 = await toggleInfo(page);
    checks.push({ what: "pressing the toggle mounts and plays (explicit opt-in)", ok: s2.present && !s2.paused && s2.time > 0.2, info: s2.present ? `t=${s2.time}s ${s2.src}` : "no video" });
    checks.push({ what: "name switches to «pause»", ok: NAME_PAUSE.test(t2?.name ?? ""), info: t2?.name });
  }
  report(c.name, checks);
  await ctx.close();
}

// ── 8: keyboard, tab order, IO pause, visibility pause ──────────────────────────────────────────
if (run("keyboard")) {
  const { ctx, page } = await open("keyboard", { vp: [1440, 900], url: "/de" });
  await page.waitForTimeout(4500);
  const checks = [];
  const sec = page.locator('section[data-film] a[href$="#gratis-check"]').first();
  if (await sec.count()) {
    await sec.focus();
    await page.keyboard.press("Tab");
    const onToggle = await page.evaluate(() => {
      const a = document.activeElement;
      const acc = (el) => { let s = ""; for (const c of el.childNodes) { if (c.nodeType === 3) s += c.textContent;
        else if (c.nodeType === 1 && c.getAttribute("aria-hidden") !== "true") s += acc(c); } return s; };
      return a && a.tagName === "BUTTON" && !!a.closest("section[data-film]") ? (a.getAttribute("aria-label") || acc(a)).trim() : (a ? a.outerHTML.slice(0, 80) : null); });
    checks.push({ what: "Tab after the secondary link lands on the film toggle", ok: !!onToggle && (NAME_PAUSE.test(onToggle) || NAME_PLAY.test(onToggle)), info: onToggle });
  } else checks.push({ what: "secondary link a[href$='#gratis-check'] in the hero", ok: false });
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  let s = await videoState(page); let ti = await toggleInfo(page);
  const stored = await page.evaluate(() => { try { return localStorage.getItem("mds-film-paused"); } catch { return "n/a"; } });
  checks.push({ what: "Enter pauses; name «play»; preference stored", ok: s.paused && NAME_PLAY.test(ti?.name ?? "") && stored === "1", info: `${ti?.name} · stored=${stored}` });
  // the credit freezes on the paused frame's shot
  const frozen = await creditState(page);
  const pausedAt = (await videoState(page)).time;
  await page.waitForTimeout(3000);
  const later = await creditState(page);
  const want = EXPECT(filmShotAt(pausedAt));
  checks.push({ what: "pause freezes the credit on the paused frame's shot", ok: !!frozen && JSON.stringify(frozen) === JSON.stringify(later) && frozen.project === want.project && frozen.state === want.state,
    info: `t=${pausedAt}s ${JSON.stringify(frozen)} → 3 s later ${JSON.stringify(later)}, expected ${JSON.stringify(want)}` });
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);
  s = await videoState(page); ti = await toggleInfo(page);
  const cleared = await page.evaluate(() => { try { return localStorage.getItem("mds-film-paused"); } catch { return "n/a"; } });
  checks.push({ what: "Space plays; name «pause»; preference cleared", ok: !s.paused && NAME_PAUSE.test(ti?.name ?? "") && cleared !== "1", info: `${ti?.name} · stored=${cleared}` });
  checks.push({ what: "no aria-pressed on the toggle", ok: !ti?.pressed });
  await page.evaluate(() => window.scrollTo(0, innerHeight * 2.5));
  await page.waitForTimeout(900);
  s = await videoState(page);
  checks.push({ what: "hero off-screen → paused", ok: s.paused });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1200);
  s = await videoState(page);
  checks.push({ what: "back on screen → playing", ok: !s.paused });
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(500);
  s = await videoState(page);
  checks.push({ what: "tab hidden → paused", ok: s.paused });
  await page.evaluate(() => { Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(900);
  s = await videoState(page);
  checks.push({ what: "tab visible → playing", ok: !s.paused });
  report("keyboard, tab order, pause freezes the credit, off-screen and hidden-tab pause (1440x900 /de)", checks);
  await ctx.close();
}

// ── 9: G8 credit = shot over one loop (rVFC recorder) ───────────────────────────────────────────
async function recordLoop(page, seconds) {
  return page.evaluate((ms) => new Promise((resolve) => {
    const v = document.querySelector("section[data-film] video");
    if (!v || !("requestVideoFrameCallback" in HTMLVideoElement.prototype)) return resolve({ error: v ? "no rVFC" : "no video" });
    const rec = [];
    const read = () => { const c = [...document.querySelectorAll("section[data-film] [data-film-credit]")].find((e) => e.checkVisibility());
      return c ? [c.getAttribute("data-project"), c.getAttribute("data-state")] : [null, null]; };
    let live = true;
    const tick = (_now, meta) => {
      if (!live) return;
      const t = meta.mediaTime;
      // read after the app's own frame callback and React's commit (next animation frame, before the next video frame)
      requestAnimationFrame(() => { const [p, s] = read(); rec.push([t, p, s, meta.presentedFrames]); });
      v.requestVideoFrameCallback(tick);
    };
    v.requestVideoFrameCallback(tick);
    setTimeout(() => { live = false; resolve({ rec, src: (v.currentSrc || "").split("/").pop() }); }, ms);
  }), seconds * 1000);
}
function judgeLoop(rec) {
  const cutFrames = new Set(FILM.shots.map((s) => s.startFrame));
  let bad = 0, tolerated = 0; const examples = []; const seenShots = new Set();
  for (const [t, p, s] of rec) {
    const f = Math.floor(t * FILM.fps + 0.001) % FILM.frames;
    const i = filmShotAt(f / FILM.fps); seenShots.add(i);
    const want = EXPECT(i);
    if (p === want.project && s === want.state) continue;
    if (cutFrames.has(f) || cutFrames.has((f - 1 + FILM.frames) % FILM.frames)) { tolerated++; continue; }
    bad++; if (examples.length < 6) examples.push(`f${f} got ${p}/${s} want ${want.project}/${want.state}`);
  }
  return { frames: rec.length, bad, tolerated, examples, shotsSeen: seenShots.size };
}
for (const c of [
  { name: "G8 credit = shot 1440x900 AV1", vp: [1440, 900], codec: "av1" },
  { name: "G8 credit = shot 390x844 AV1", vp: [390, 844], mobile: true, codec: "av1" },
  { name: "G8 credit = shot 1440x900 H.264 (Chrome; the H.264 bytes served under the AV1 URL)", vp: [1440, 900], codec: "h264" },
  { name: "G8 credit = shot 390x844 H.264 (Chrome; the H.264 bytes served under the AV1 URL)", vp: [390, 844], mobile: true, codec: "h264" },
]) {
  if (!run(c.name) && !run("G8")) continue;
  const b = c.codec === "h264" ? await chromeBrowser() : browser;
  if (!b) { report(c.name, [{ what: "a browser with H.264 (Chrome or Edge channel)", ok: false }]); continue; }
  const { ctx, page } = await open(c.name, { vp: c.vp, url: "/de", mobile: c.mobile, b, h264AsAv1: c.codec === "h264" });
  await page.waitForTimeout(4000);
  const codecNow = await page.evaluate(() => { const v = document.querySelector("section[data-film] video"); return v ? { src: (v.currentSrc || "").split("/").pop(), playing: !v.paused } : null; });
  const r = await recordLoop(page, FILM.durationS + 1.2);
  const checks = [];
  if (r.error) checks.push({ what: "recorder runs", ok: false, info: r.error });
  else {
    const j = judgeLoop(r.rec);
    checks.push({ what: c.codec === "av1" ? "plays the av1 file" : "plays (H.264 bytes under the AV1 URL)", ok: !!codecNow?.playing && r.src.includes(".av1.mp4"), info: JSON.stringify(codecNow) });
    checks.push({ what: "one loop recorded (every shot seen)", ok: j.shotsSeen === FILM.shots.length && j.frames >= FILM.frames * 0.8, info: `${j.frames} frames, ${j.shotsSeen} shots` });
    checks.push({ what: "credit = FILM.shots[filmShotAt(mediaTime)] (project + lit/dim) except ≤ 1 frame after a cut", ok: j.bad === 0, info: `${j.bad} mismatches, ${j.tolerated} tolerated at cuts${j.examples.length ? "; " + j.examples.join("; ") : ""}` });
  }
  report(c.name, checks);
  await ctx.close();
}

// ── 9b: a failed AV1 fetch falls back to the H.264 <source> (network error on the first source) ──
if (run("fallback")) {
  const b = await chromeBrowser();
  if (b) {
    const { ctx, page } = await open("fallback", { vp: [1440, 900], url: "/de", b, blockAv1: true });
    await page.waitForTimeout(5000);
    const s = await videoState(page);
    report("AV1 fetch fails → the H.264 source plays (Chrome, AV1 request aborted)", [
      { what: "the H.264 file is the current source and plays", ok: s.present && /\.h264\.mp4$/.test(s.src) && !s.paused && s.time > 0.3,
        info: s.present ? `${s.src} t=${s.time}s paused=${s.paused}` : "no video" },
    ]);
    await ctx.close();
  }
}

// ── 10: resize remount (1440×900 → 390×844 while playing) ───────────────────────────────────────
if (run("resize")) {
  const { ctx, page } = await open("resize", { vp: [1440, 900], url: "/de" });
  await page.waitForTimeout(4000);
  // wait until a how-beat or ZüriKey is on screen, so a reset to BJ is visible
  await page.evaluate(() => new Promise((res) => { const v = document.querySelector("section[data-film] video");
    const tick = () => (v && v.currentTime > 3.2 ? res() : setTimeout(tick, 50)); tick(); setTimeout(res, 15000); }));
  const before = await page.evaluate(() => { const v = document.querySelector("section[data-film] video"); if (v) v.__old = true; return (v?.currentSrc || "").split("/").pop(); });
  const csBefore = await creditState(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250);
  const csJust = await creditState(page);
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() => { const v = document.querySelector("section[data-film] video"); return v ? { fresh: !v.__old, src: (v.currentSrc || "").split("/").pop(), t: +v.currentTime.toFixed(2) } : null; });
  const csAfter = await creditState(page);
  report("resize remount 1440x900 → 390x844 while playing", [
    { what: "a new <video> element with the 9:16 rendition", ok: !!after && after.fresh && /9x16-720/.test(after.src), info: `${before} → ${JSON.stringify(after)}` },
    { what: "the credit goes back to the poster's shot (BJ Studio, lit) on the remount", ok: bjLit(csJust) || bjLit(csAfter), info: `before ${JSON.stringify(csBefore)} · +250 ms ${JSON.stringify(csJust)} · +2.75 s ${JSON.stringify(csAfter)}` },
    { what: "the visible credit is the phone one (layout P)", ok: csAfter?.layout === "P", info: csAfter?.layout },
  ]);
  await ctx.close();
}

// ── 11: G8b hosts named by the hero + ZUMOVE gate ───────────────────────────────────────────────
if (run("G8b")) {
  const zumove = PROJECTS.find((p) => p.id === "zumove");
  const checks = [];
  for (const [lang, url] of [["de", "/de"], ["it", "/it"], ["en", "/"]]) {
    const res = await fetch(BASE + url);
    const html = await res.text();
    const m = html.match(/<section[^>]*data-film[\s\S]*?<\/section>/);
    const hero = m ? m[0] : "";
    const named = PROJECTS.filter((p) => hero.includes(p.host)).map((p) => p.host);
    const allowed = new Set(FILM.projects.map((p) => p.host));
    checks.push({ what: `${url}: hero found in the server HTML`, ok: !!hero, info: `${hero.length} chars` });
    checks.push({ what: `${url}: every project host in the hero is a FILM.projects host`, ok: named.every((h) => allowed.has(h)), info: named.join(", ") || "none" });
    if (zumove?.approval) checks.push({ what: `${url}: no «zumove» in the hero while ZUMOVE has approval "${zumove.approval}"`, ok: !/zumove/i.test(hero) });
  }
  const zuFiles = fs.readdirSync(path.join(REPO, "public", "film")).filter((n) => /-zu-/.test(n));
  if (zumove?.approval) {
    checks.push({ what: "no -zu- file in public/film while ZUMOVE has approval", ok: zuFiles.length === 0, info: zuFiles.join(", ") || "none" });
    checks.push({ what: "the published variant is nozu while ZUMOVE has approval", ok: FILM.variant === "nozu", info: FILM.variant });
  }
  report("G8b hosts in the hero + ZUMOVE gate", checks);
}

// ── 12: G9 every website the film names answers 200 ─────────────────────────────────────────────
if (run("G9") && !SKIP_HOSTS) {
  const checks = [];
  for (const p of FILM.projects) {
    let u = p.url, hops = 0, status = 0, err = null;
    for (;;) {
      try {
        const r = await fetch(u, { redirect: "manual", signal: AbortSignal.timeout(20000), headers: { "user-agent": "hero-film-check/2 (+status check)" } });
        status = r.status;
        if (status >= 300 && status < 400 && r.headers.get("location") && hops < 2) { hops++; u = new URL(r.headers.get("location"), u).href; continue; }
      } catch (e) { err = String(e.message ?? e); }
      break;
    }
    checks.push({ what: `${p.url} answers 200 (≤ 1 redirect)`, ok: status === 200 && hops <= 1, info: `${status}${hops ? ` via ${u}` : ""}${err ? ` ${err}` : ""}` });
  }
  report("G9 hosts", checks);
}

await browser.close();
if (chrome) await chrome.close();
fs.mkdirSync("C:/Users/franc/progetti/modolo-media-src/build", { recursive: true });
fs.writeFileSync("C:/Users/franc/progetti/modolo-media-src/build/check-hero-film.json", JSON.stringify({ base: BASE, at: new Date().toISOString(), problems, results }, null, 1));
console.log(problems ? `\n  ${problems} deviation(s).\n` : "\n  Behaviour as specified.\n");
process.exit(problems ? 1 : 0);
