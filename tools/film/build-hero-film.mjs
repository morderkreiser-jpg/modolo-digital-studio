#!/usr/bin/env node
/**
 * Modolo Digital Studio: hero film builder, v2 («PROVA»: the film shows his real websites).
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Masters in (FILM-HERO-SPEC §1.7–§1.13). The look (screen replacement, grade, lamp falloff, tracked blurs) is rendered
 * ONCE in MEDIA by MEDIA\v2\a\tools\cut.py into two lossless RGB masters per variant (copies of every tool and edit
 * list are in tools/film/v2/). This script never grades or crops anything. It:
 *
 *   1. checks the two masters of the chosen variant            P1 345 frames, size, gbrp, sha256 = shots.json
 *   2. checks their G1-v2 statistics (cut.py master reports)    P2 blocking
 *   3. checks that every website the film names answers 200     P3 = G9
 *   4. checks that every site capture is at most 90 days old    P4
 *   5. refuses ZUMOVE unless Marco's written OK is recorded     P5 (data/projects.ts approval gone + --zumove-ok)
 *   6. encodes AV1 + H.264 (BT.709, CRF steps up only while over budget, never past crf_max)
 *   7. cuts the posters from frame 0 of each master (AVIF / WebP / JPG) and checks the poster -> video seam (ΔE76)
 *   8. writes content-hashed files to public/film/ (removing older builds), rewrites lib/film-media.ts,
 *      and writes MEDIA/build/report.json (gates G1, G5, G6, G9, P4, colour tags, poster seam).
 *
 * Usage (ffmpeg 7+ with libsvtav1 + libx264; Python 3 with numpy + Pillow; Node 24):
 *   node tools/film/build-hero-film.mjs --src C:\Users\franc\progetti\modolo-media-src
 *   options
 *     --variant nozu|zu         default: shots.json "variant" (nozu = without ZUMOVE)
 *     --zumove-ok <yyyy-mm-dd>  the date of the ZUMOVE owner's written OK; publishing zu also needs ZUMOVE's
 *                               `approval` field removed in data/projects.ts. Without both, zu is refused.
 *     --preview-out <dir>       build the encodes + posters into <dir> (outside the repo) for review only:
 *                               nothing in public/ or lib/ is touched. The only way to build zu before the OK.
 *     --check-only              run P1-P5 and stop
 *     --skip-hosts              skip P3 (offline). Allowed only together with --preview-out or --check-only.
 *     --shots <file>            another shots.json (default tools/film/shots.json)
 *
 * Every intermediate (encodes, posters, frames) stays in MEDIA\build. Raw clips and ZUMOVE renders never enter the
 * repository (public repo): only the six final encodes, six posters and the grain tile of the published variant do.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const HERE = import.meta.dirname;
const REPO = path.resolve(HERE, "..", "..");

/* ── arguments ─────────────────────────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return def;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};
const SRC = path.resolve(opt("src", "C:/Users/franc/progetti/modolo-media-src"));
const SHOTS_FILE = path.resolve(opt("shots", path.join(HERE, "shots.json")));
const CFG = JSON.parse(fs.readFileSync(SHOTS_FILE, "utf8"));
const VARIANT = opt("variant", CFG.variant ?? "nozu");
const ZUMOVE_OK = opt("zumove-ok", null);
const PREVIEW_OUT = opt("preview-out", null) ? path.resolve(opt("preview-out")) : null;
const CHECK_ONLY = !!opt("check-only", false);
const SKIP_HOSTS = !!opt("skip-hosts", false);

const FPS = CFG.fps;
const VERSION = CFG.version;
const LOOP = CFG.loop_frames;
const ORIENTS = { "16x9": [1920, 1080], "9x16": [720, 1280] };
const BUILD = path.join(SRC, "build");
const OUTDIR = PREVIEW_OUT ?? path.join(BUILD, "v2-" + VARIANT);
const PUBLIC_FILM = path.join(REPO, "public", "film");
const MANIFEST_TS = path.join(REPO, "lib", "film-media.ts");
const REPORT = PREVIEW_OUT ? path.join(PREVIEW_OUT, "report.json") : path.join(BUILD, "report.json");

/* ── small helpers ─────────────────────────────────────────────────────────────────────────── */
const fwd = (p) => p.replace(/\\/g, "/");
const fileSha = (p) => createHash("sha256").update(fs.readFileSync(p)).digest("hex");
const kb = (n) => Math.round((n / 1024) * 10) / 10;
const die = (msg) => { console.error(`\n✗ ${msg}\n`); process.exit(1); };
const inside = (child, parent) => { const r = path.relative(parent, child); return r === "" || (!r.startsWith("..") && !path.isAbsolute(r)); };

function run(cmd, args, { label } = {}) {
  const t = Date.now();
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) {
    console.error(`\n✗ ${label ?? cmd}\n${(r.stderr || r.stdout || "").split("\n").slice(-20).join("\n")}`);
    throw new Error(`${cmd} failed: ${label ?? ""}`);
  }
  if (label) console.log(`  ✓ ${label} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  return r.stdout;
}
const ffmpeg = (args, label) => run("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], { label });
function probe(file) {
  const out = run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries",
    "stream=width,height,r_frame_rate,codec_name,profile,level,pix_fmt,color_space,color_primaries,color_transfer,color_range:format=duration,size",
    "-of", "json", file]);
  const j = JSON.parse(out);
  const s = j.streams[0];
  const [n, d] = s.r_frame_rate.split("/").map(Number);
  return { ...s, fps: n / d, duration: Number(j.format.duration), size: Number(j.format.size) };
}
function countFrames(file) {
  return Number(run("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries",
    "stream=nb_read_frames", "-of", "csv=p=0", file]).trim());
}

/* ── the timeline (one for both orientations and both variants, §1.1) ───────────────────────── */
const TL = [];
{
  let at = 0;
  for (const s of CFG.timeline) { TL.push({ ...s, startFrame: at, endFrame: at + s.frames }); at += s.frames; }
  if (at !== LOOP) die(`timeline has ${at} frames, shots.json loop_frames says ${LOOP}`);
}
const projectOf = (s, v = VARIANT) => s.project[v] ?? null;
/** credit = the shot's own project, or the last one shown before it (the loop wraps: S6 precedes S1). */
function creditOf(i, v = VARIANT) {
  for (let k = 0; k < TL.length; k++) {
    const p = projectOf(TL[(i - k + TL.length) % TL.length], v);
    if (p) return p;
  }
  throw new Error("no shot shows a project");
}

/* ── P5: the ZUMOVE gate ─────────────────────────────────────────────────────────────────────── */
const { PROJECTS } = await import(pathToFileURL(path.join(REPO, "data", "projects.ts")).href);
const byId = new Map(PROJECTS.map((p) => [p.id, p]));
const zumove = byId.get("zumove");
if (!["nozu", "zu"].includes(VARIANT)) die(`--variant must be nozu or zu, got ${VARIANT}`);
if (PREVIEW_OUT && inside(PREVIEW_OUT, REPO)) die(`--preview-out must be outside the repository (got ${PREVIEW_OUT})`);
if (VARIANT === "zu" && !PREVIEW_OUT && !CHECK_ONLY) {
  const reasons = [];
  if (zumove?.approval) reasons.push(`data/projects.ts still marks ZUMOVE "approval: ${zumove.approval}"`);
  if (!ZUMOVE_OK) reasons.push("--zumove-ok <yyyy-mm-dd> (the date of Marco's written OK) is missing");
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ZUMOVE_OK)) || Number.isNaN(Date.parse(ZUMOVE_OK)) || Date.parse(ZUMOVE_OK) > Date.now())
    reasons.push(`--zumove-ok "${ZUMOVE_OK}" is not a past date yyyy-mm-dd`);
  if (reasons.length) die(`P5 ZUMOVE gate: the film with ZUMOVE is NOT published.\n  - ${reasons.join("\n  - ")}\n  Build a review copy outside the repo instead: --variant zu --preview-out <MEDIA folder>`);
}
if (SKIP_HOSTS && !PREVIEW_OUT && !CHECK_ONLY) die("--skip-hosts is only allowed with --preview-out or --check-only (G9 guards what is published)");

/* ── the projects the published film names (film order) ─────────────────────────────────────── */
const FILM_PROJECTS = [];
for (const s of TL) {
  const id = projectOf(s);
  if (id && !FILM_PROJECTS.some((p) => p.id === id)) {
    const p = byId.get(id);
    if (!p) die(`project ${id} of shot ${s.slot} is not in data/projects.ts`);
    if (!p.live) die(`project ${id} is marked live: false in data/projects.ts: re-capture or drop it before publishing`);
    FILM_PROJECTS.push({ id: p.id, host: p.host, url: p.url, kind: p.kind });
  }
}

/* ── P1: the masters ─────────────────────────────────────────────────────────────────────────── */
const VCFG = CFG.variants[VARIANT];
const MASTERS = Object.fromEntries(Object.entries(VCFG.masters).map(([o, rel]) => [o, path.join(SRC, rel)]));
const report = { generated: new Date().toISOString(), version: VERSION, variant: VARIANT, fps: FPS, loopFrames: LOOP,
  preview: !!PREVIEW_OUT, masters: {}, gates: {} };
console.log(`hero film ${VERSION} · variant ${VARIANT} · ${LOOP} frames = ${(LOOP / FPS).toFixed(2)} s · ${TL.map((s) => `${s.slot}/${s.slot916}:${projectOf(s) ?? "-"}`).join(" ")}`);
console.log("\nP1 masters");
for (const [o, file] of Object.entries(MASTERS)) {
  if (!fs.existsSync(file)) die(`P1: missing master ${file} (render it with MEDIA\\v2\\a\\tools\\cut.py --master)`);
  const p = probe(file);
  const [W, H] = ORIENTS[o];
  const problems = [];
  if (p.codec_name !== "ffv1") problems.push(`codec ${p.codec_name} (want ffv1)`);
  // lossless 8-bit RGB: FFV1 has no 8-bit gbrp, its 8-bit RGB layout is bgr0 (cut.py writes that)
  if (!["bgr0", "gbrp"].includes(p.pix_fmt)) problems.push(`pix_fmt ${p.pix_fmt} (want 8-bit RGB: bgr0)`);
  if (p.color_primaries !== "bt709" || p.color_transfer !== "bt709") problems.push(`colour tags ${p.color_primaries}/${p.color_transfer} (want bt709/bt709)`);
  if (p.width !== W || p.height !== H) problems.push(`size ${p.width}x${p.height} (want ${W}x${H})`);
  if (Math.abs(p.fps - FPS) > 1e-6) problems.push(`fps ${p.fps}`);
  const n = countFrames(file);
  if (n !== LOOP) problems.push(`${n} frames (want ${LOOP})`);
  const sha = fileSha(file), rep = file + ".report.json", shaRep = fs.existsSync(rep) ? fileSha(rep) : null;
  if (sha !== VCFG.sha256[o]) problems.push(`sha256 ${sha.slice(0, 12)}… differs from shots.json ${String(VCFG.sha256[o]).slice(0, 12)}…`);
  if (shaRep !== VCFG.sha256[`${o}_report`]) problems.push(`report sha256 differs from shots.json`);
  if (problems.length) die(`P1 master ${o}: ${problems.join("; ")}`);
  report.masters[o] = { file: fwd(file), sha256: sha, frames: n, pix_fmt: p.pix_fmt, size: [p.width, p.height] };
  console.log(`  ✓ ${o} ${path.basename(file)} ${p.width}x${p.height} ${p.pix_fmt} ${n} f sha ${sha.slice(0, 12)}`);
}

/* ── P2: G1-v2 from the master reports (blocking) ─────────────────────────────────────────── */
console.log("\nP2 G1-v2 on the master reports");
const G = CFG.gates;
// Documented per-shot exceptions (shots.json g1_exceptions): a measured value outside the SPEC band that the approved
// look cannot meet within the allowed tuning. Each one is printed as EXC, listed in the report and must be signed off.
const EXC = CFG.g1_exceptions ?? [];
const usedExc = [];
const within = (o, shot, gate, value, ok) => {
  if (ok) return "ok";
  const e = EXC.find((x) => x.orient === o && x.shot === shot && x.gate === gate);
  if (e && value >= (e.min ?? -Infinity) && value <= (e.max ?? Infinity)) { usedExc.push({ ...e, measuredNow: value }); return "EXC"; }
  return "XX";
};
report.gates.G1 = {};
let g1ok = true;
for (const o of Object.keys(MASTERS)) {
  const rep = JSON.parse(fs.readFileSync(MASTERS[o] + ".report.json", "utf8"));
  if (rep.shots.length !== TL.length) die(`P2: ${o} report has ${rep.shots.length} shots, the timeline ${TL.length}`);
  const rows = rep.shots.map((s, i) => {
    const t = TL[i];
    if (s.start_frame !== t.startFrame || s.frames !== t.frames) die(`P2: ${o} shot ${s.id} at ${s.start_frame}+${s.frames}, timeline ${t.startFrame}+${t.frames}`);
    const proof = projectOf(t) !== null;
    const band = proof ? G.rb_mid.proof : G.rb_mid.how;
    const r = {
      shot: s.id, proof,
      env_mean: s.env_mean, env: within(o, s.id, "env_mean", s.env_mean, s.env_mean >= G.env_mean[0] && s.env_mean <= G.env_mean[1]),
      frame_mean: s.frame_mean, mean: within(o, s.id, "frame_mean", s.frame_mean, !proof || s.frame_mean <= G.proof_frame_mean_max[o]),
      frame_p999_max: s.frame_p999_max, p999: within(o, s.id, "frame_p999_max", s.frame_p999_max, s.frame_p999_max <= G.frame_p999_max),
      env_p999_rgb: s.env_p999_rgb, cream: s.env_p999_rgb.every((v, c) => v <= G.env_p999_rgb_max[c]) ? "ok" : "XX",
      rb_mid: s.env_rb_mid, rb_band: band, rb: within(o, s.id, "rb_mid", s.env_rb_mid, s.env_rb_mid >= band[0] && s.env_rb_mid <= band[1]),
      scale_max: s.scale_max, upscale: s.scale_max <= G.upscale_max + 1e-9 ? "ok" : "XX",
      cool_pct_env: s.cool_pct_env,
    };
    r.pass = ["env", "mean", "p999", "cream", "rb", "upscale"].every((k) => r[k] !== "XX");
    r.exceptions = ["env", "mean", "p999", "rb"].filter((k) => r[k] === "EXC");
    return r;
  });
  report.gates.G1[o] = { pass: rows.every((r) => r.pass), shots: rows };
  console.log(`  ${o}   env ${G.env_mean.join("-")} · proof mean ≤ ${G.proof_frame_mean_max[o]} · p99.9 ≤ ${G.frame_p999_max} · env p99.9 ≤ ${G.env_p999_rgb_max.join("/")} · R-B proof ${G.rb_mid.proof.join("-")} how ${G.rb_mid.how.join("-")} · upscale ≤ ${G.upscale_max}`);
  for (const r of rows) {
    console.log(`   ${r.pass ? (r.exceptions.length ? "EX" : "ok") : "XX"} ${r.shot} ${r.proof ? "proof" : "how  "} env ${String(r.env_mean).padStart(6)} ${r.env.padEnd(3)}  mean ${String(r.frame_mean).padStart(6)} ${r.mean.padEnd(3)}  p99.9 ${String(r.frame_p999_max).padStart(6)} ${r.p999.padEnd(3)}  envRGB ${r.env_p999_rgb.join("/")} ${r.cream}  R-B ${String(r.rb_mid).padStart(5)} ${r.rb.padEnd(3)}  up ${r.scale_max} ${r.upscale}  cool ${r.cool_pct_env} %`);
  }
  g1ok &&= report.gates.G1[o].pass;
}
report.gates.G1.exceptions = usedExc;
if (usedExc.length) {
  console.log(`\n  ! ${usedExc.length} documented G1 exception(s) used (shots.json g1_exceptions), each needs sign-off:`);
  for (const e of usedExc) console.log(`    EXC ${e.orient} ${e.shot} ${e.gate} = ${e.measuredNow} (SPEC band missed; allowed ${e.min ?? "-∞"}..${e.max ?? "∞"}): ${e.why}`);
}
if (!g1ok) die("P2: G1-v2 fails on the masters (see the XX above). Re-render the masters within the tuning limits of SPEC §1.2.");

/* ── P3 = G9: every website the film names answers 200 (at most one redirect) ─────────────── */
async function hostCheck(url) {
  let u = url, hops = 0;
  for (;;) {
    const ctl = AbortSignal.timeout(20000);
    let res;
    try { res = await fetch(u, { method: "GET", redirect: "manual", signal: ctl, headers: { "user-agent": "hero-film-build/2 (+status check)" } }); }
    catch (e) { return { url, final: u, status: 0, hops, error: String(e.message ?? e) }; }
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      hops++;
      if (hops > 1) return { url, final: u, status: res.status, hops, error: "more than one redirect" };
      u = new URL(res.headers.get("location"), u).href;
      continue;
    }
    return { url, final: u, status: res.status, hops };
  }
}
console.log("\nP3 = G9 hosts");
if (SKIP_HOSTS) {
  report.gates.G9 = { skipped: true };
  console.log("  ! skipped (--skip-hosts)");
} else {
  const rs = await Promise.all(FILM_PROJECTS.map((p) => hostCheck(p.url)));
  report.gates.G9 = { pass: rs.every((r) => r.status === 200), hosts: rs, at: new Date().toISOString() };
  for (const r of rs) console.log(`  ${r.status === 200 ? "✓" : "✗"} ${r.url} → ${r.status}${r.hops ? ` via ${r.final}` : ""}${r.error ? ` (${r.error})` : ""}`);
  if (!report.gates.G9.pass) die("P3/G9: a website the film names does not answer 200. Never caption a dead site: fix it or set live: false and rebuild.");
}

/* ── P4: capture freshness ─────────────────────────────────────────────────────────────────── */
console.log("\nP4 captures (≤ " + G.capture_max_age_days + " days)");
const used = new Set();
for (const s of TL) for (const [k, c] of Object.entries(s.captures ?? {})) if (k === "16x9" || k === "9x16" || k === VARIANT) used.add(c);
report.gates.P4 = { pass: true, captures: [] };
for (const id of used) {
  const c = CFG.captures[id];
  if (!c?.at) die(`P4: capture ${id} has no date in shots.json`);
  const age = Math.floor((Date.now() - Date.parse(c.at)) / 86400000);
  const ok = age <= G.capture_max_age_days;
  report.gates.P4.captures.push({ id, host: c.host, at: c.at, ageDays: age, pass: ok });
  report.gates.P4.pass &&= ok;
  console.log(`  ${ok ? "✓" : "✗"} ${id.padEnd(13)} ${c.host.padEnd(22)} captured ${c.at} (${age} days)`);
}
if (!report.gates.P4.pass) die("P4: a capture is older than 90 days: re-capture the live site (MEDIA\\v2\\tools\\capture.mjs), re-render the composite and the masters.");
if (CHECK_ONLY) { console.log("\n--check-only: P1-P5 pass."); process.exit(0); }

/* ── encodes (§1.8) ──────────────────────────────────────────────────────────────────────────── */
fs.mkdirSync(OUTDIR, { recursive: true });
const COLOR = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const toYuv = (w, h) => `scale=${w}:${h}:out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p`;
const ENCODES = [
  { key: "16x9-1080", orient: "16x9", codec: "av1" }, { key: "16x9-1080", orient: "16x9", codec: "h264" },
  { key: "16x9-720", orient: "16x9", codec: "av1" }, { key: "16x9-720", orient: "16x9", codec: "h264" },
  { key: "9x16-720", orient: "9x16", codec: "av1" }, { key: "9x16-720", orient: "9x16", codec: "h264" },
];
function encode(e) {
  const spec = CFG.encodes[e.key];
  const out = path.join(OUTDIR, `hero-${e.key}.${e.codec}.mp4`);
  const budget = spec.budget_kb[e.codec] * 1024;
  const start = e.codec === "av1" ? spec.av1_crf : spec.h264_crf;
  const max = e.codec === "av1" ? spec.av1_crf_max : spec.h264_crf_max;
  const tries = [];
  for (let crf = start; crf <= max; crf++) {
    const venc = e.codec === "av1"
      ? ["-c:v", "libsvtav1", "-preset", String(spec.av1_preset), "-crf", String(crf), "-g", String(2 * FPS), "-svtav1-params", CFG.av1_params]
      : ["-c:v", "libx264", "-preset", "slow", "-crf", String(crf), "-profile:v", "high", "-level:v", spec.w * spec.h > 1280 * 720 ? "4.0" : "3.1",
         "-g", String(2 * FPS), "-keyint_min", String(2 * FPS), "-sc_threshold", "0", "-x264-params", CFG.x264_params];
    ffmpeg(["-i", MASTERS[e.orient], "-vf", toYuv(spec.w, spec.h), ...COLOR, "-r", String(FPS), "-fps_mode", "cfr",
      "-an", "-sn", "-dn", "-map_metadata", "-1", ...venc, "-movflags", "+faststart", "-fflags", "+bitexact", out],
      `encode ${e.key}.${e.codec} crf ${crf}`);
    const size = fs.statSync(out).size;
    tries.push({ crf, kb: kb(size) });
    if (size <= budget) { e.crf = crf; e.tries = tries; return out; }
    console.log(`    ${kb(size)} KB > budget ${spec.budget_kb[e.codec]} KB, crf +1`);
  }
  die(`G6: ${e.key}.${e.codec} is over its ${spec.budget_kb[e.codec]} KB budget even at crf_max ${max}. Never ship blurrier text silently: shorten a scroll, calm a push, or ask the orchestrator for budget.`);
}
/** RFC 6381 codecs string from the encoded stream (not from the settings). */
function codecsString(file) {
  const p = probe(file);
  if (p.codec_name === "h264") {
    const prof = { High: 100, Main: 77, Baseline: 66, "Constrained Baseline": 66 }[p.profile] ?? 100;
    const constraint = p.profile === "Constrained Baseline" ? 0x40 : 0;
    const hex = (n) => n.toString(16).toUpperCase().padStart(2, "0");
    return `avc1.${hex(prof)}${hex(constraint)}${hex(p.level)}`;
  }
  if (p.codec_name === "av1") {
    const prof = { Main: 0, High: 1, Professional: 2 }[p.profile] ?? 0;
    let lvl = p.level;   // ffprobe reports seq_level_idx; 31 = "max" (unconstrained): map to the real level by size
    if (lvl === undefined || lvl < 0 || lvl === 31) lvl = Math.max(p.width, p.height) > 1280 ? 8 : 5;
    return `av01.${prof}.${String(lvl).padStart(2, "0")}M.08`;
  }
  throw new Error(`unknown codec ${p.codec_name}`);
}
console.log("\nEncodes (G6)");
const encs = ENCODES.map((e) => { const x = { ...e }; x.file = encode(x); return x; });
for (const e of encs) {
  const n = countFrames(e.file);
  if (n !== LOOP) die(`${e.file}: ${n} frames, expected ${LOOP}`);
}

/* ── posters (§1.9) and grain ────────────────────────────────────────────────────────────────── */
const PY_STILLS = `
import io, sys
from PIL import Image
src, webp, jpg, wq, jq, wb, jb = sys.argv[1:8]
im = Image.open(src).convert("RGB")
def fit(fmt, q0, budget, kw):
    def size(q):
        b = io.BytesIO(); im.save(b, fmt, quality=q, **kw); return b.getvalue()
    q = q0; data = size(q)
    while len(data) > 0.95 * budget and q > 40:
        q -= 2; data = size(q)
    while q + 2 <= 86 and len(data) < 0.70 * budget:
        nxt = size(q + 2)
        if len(nxt) > 0.95 * budget: break
        q += 2; data = nxt
    return q, data
qw, dw = fit("WEBP", int(wq), int(wb), dict(method=6))
qj, dj = fit("JPEG", int(jq), int(jb), dict(progressive=True, optimize=True, subsampling=2))
open(webp, "wb").write(dw); open(jpg, "wb").write(dj)
print(f"webp q{qw} ({len(dw)/1024:.1f} KB) / jpg q{qj} ({len(dj)/1024:.1f} KB)")
`;
/** 128×128 grain tile: 2-bit palette, transparent / ink / cream specks (same bytes as v1). */
const PY_GRAIN = `
import sys, numpy as np
from PIL import Image
out = sys.argv[1]
rng = np.random.default_rng(20261115)
u = rng.random((128, 128))
idx = np.where(u < 0.19, 1, np.where(u < 0.38, 2, 0)).astype(np.uint8)
im = Image.fromarray(idx, "P")
im.putpalette([0, 0, 0, 23, 19, 14, 246, 241, 231] + [0] * (256 - 3) * 3)
im.info["transparency"] = bytes([0, 255, 255] + [255] * 253)
im.save(out, "PNG", optimize=True, bits=2, transparency=bytes([0, 255, 255]))
`;
/* Poster seam: decoded H.264 frame 0 vs the decoded WebP / AVIF / JPG poster, mean ΔE76 (CIE Lab, D65) over a rect. */
const PY_SEAM = `
import sys, json, subprocess, numpy as np
from PIL import Image
w, h = int(sys.argv[1]), int(sys.argv[2]); rect = json.loads(sys.argv[3]); h264, files = sys.argv[4], sys.argv[5:]
def dec(path):
    if path.endswith(".webp") or path.endswith(".jpg"):
        return np.asarray(Image.open(path).convert("RGB"), np.float64)
    vf = "scale=in_color_matrix=bt709:in_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24"
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-frames:v", "1", "-vf", vf, "-f", "rawvideo", "-"], capture_output=True).stdout
    return np.frombuffer(raw[: w * h * 3], np.uint8).reshape(h, w, 3).astype(np.float64)
def lab(rgb):
    c = rgb / 255.0
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.0721750], [0.0193339, 0.1191920, 0.9503041]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > (6 / 29) ** 3, np.cbrt(xyz), xyz / (3 * (6 / 29) ** 2) + 4 / 29)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], -1)
x, y, rw, rh = rect
ref = lab(dec(h264)[y:y + rh, x:x + rw])
out = {}
for f in files:
    d = np.linalg.norm(lab(dec(f)[y:y + rh, x:x + rw]) - ref, axis=-1)
    out[f.rsplit(".", 1)[1]] = {"mean": round(float(d.mean()), 3), "p99": round(float(np.percentile(d, 99)), 3)}
print(json.dumps(out))
`;
console.log("\nPosters (frame 0 of each master)");
const P = CFG.posters;
const posterFiles = [];
for (const o of Object.keys(ORIENTS)) {
  const [W, H] = ORIENTS[o];
  const base = path.join(OUTDIR, `poster-${o}-de`);
  ffmpeg(["-i", MASTERS[o], "-frames:v", "1", "-vf", "format=rgb24", "-update", "1", `${base}.png`], `poster ${o} = master frame ${P.frame} (exact PNG)`);
  const bAvif = P.budget_kb[`${o}_avif`] * 1024;
  const avifAt = (crf) => {
    ffmpeg(["-i", `${base}.png`, "-vf", toYuv(W, H), "-frames:v", "1", "-c:v", "libsvtav1", "-preset", "4", "-crf", String(crf),
      "-svtav1-params", "tune=0", ...COLOR, "-f", "avif", `${base}.avif`]);
    return fs.statSync(`${base}.avif`).size;
  };
  // best quality that stays under 85 % of the budget: start CRF from shots.json, at most 12 lower; 9:16 text exception
  let crf = P.avif_crf[o];
  let size = avifAt(crf);
  while (size > bAvif && crf < 63) { crf += 1; size = avifAt(crf); }
  while (crf - 1 >= P.avif_crf[o] - 12 && avifAt(crf - 1) <= 0.85 * bAvif) crf -= 1;
  size = avifAt(crf);
  let avifBudgetKb = P.budget_kb[`${o}_avif`], exception = null;
  if (o === "9x16" && crf > 40) {
    // SPEC §1.9: this poster carries a real site's text and stays on screen under reduced motion / Save-Data
    avifBudgetKb = P.budget_kb["9x16_avif_text_exception"];
    const bx = avifBudgetKb * 1024;
    crf = P.avif_crf[o];
    while (avifAt(crf) > bx && crf < 63) crf += 1;
    while (crf - 1 >= P.avif_crf[o] - 12 && avifAt(crf - 1) <= 0.85 * bx) crf -= 1;
    size = avifAt(crf);
    exception = `9:16 AVIF needed CRF > 40 for 35 KB: budget raised to ${avifBudgetKb} KB (SPEC §1.9)`;
    console.log(`  ! ${exception}`);
  }
  console.log(`  ✓   ${o} avif crf ${crf} (${kb(size)} KB)`);
  const stills = run("python", ["-I", "-c", PY_STILLS, `${base}.png`, `${base}.webp`, `${base}.jpg`,
    String(P.webp_q), String(P.jpg_q), String(P.budget_kb[`${o}_webp`] * 1024), String(P.budget_kb[`${o}_jpg`] * 1024)]).trim();
  console.log(`  ✓   ${o} ${stills}`);
  posterFiles.push({ orient: o, base, avifCrf: crf, avifBudgetKb, exception, stills });
}
const grainPng = path.join(OUTDIR, "grain.png");
run("python", ["-I", "-c", PY_GRAIN, grainPng], { label: "grain tile 128x128" });

console.log("\nPoster seam (decoded H.264 frame 0 vs the posters, mean ΔE76 over the screen)");
report.gates.posterSeam = {};
let seamOk = true;
for (const o of Object.keys(ORIENTS)) {
  const [W, H] = ORIENTS[o];
  const h264 = encs.find((e) => e.orient === o && e.codec === "h264" && (o === "9x16" || e.key === "16x9-1080")).file;
  const pf = posterFiles.find((p) => p.orient === o);
  const res = JSON.parse(run("python", ["-I", "-c", PY_SEAM, String(W), String(H), JSON.stringify(P.seam_rect[o]), h264,
    `${pf.base}.webp`, `${pf.base}.avif`, `${pf.base}.jpg`]));
  const ok = res.webp.mean <= P.seam_max_de && res.avif.mean <= P.seam_max_de;
  seamOk &&= ok;
  report.gates.posterSeam[o] = { rect: P.seam_rect[o], max: P.seam_max_de, ...res, pass: ok };
  console.log(`  ${ok ? "✓" : "✗"} ${o} rect ${P.seam_rect[o].join(",")}: webp ${res.webp.mean} · avif ${res.avif.mean} · jpg ${res.jpg.mean} (max ${P.seam_max_de})`);
}
if (!seamOk) die("poster seam: a poster differs from the video's first frame (ΔE76 above the limit): check the colour conversion");

/* ── colour tags of everything that ships (A2) ─────────────────────────────────────────────── */
console.log("\nColour tags (bt709 / bt709 / bt709 / tv)");
report.gates.colorTags = [];
for (const f of [...encs.map((e) => e.file), ...posterFiles.map((p) => `${p.base}.avif`)]) {
  const p = probe(f);
  const ok = p.color_space === "bt709" && p.color_primaries === "bt709" && p.color_transfer === "bt709" && p.color_range === "tv";
  report.gates.colorTags.push({ file: path.basename(f), color_space: p.color_space, color_primaries: p.color_primaries, color_transfer: p.color_transfer, color_range: p.color_range, pass: ok });
  console.log(`  ${ok ? "✓" : "✗"} ${path.basename(f).padEnd(26)} ${p.color_space}/${p.color_primaries}/${p.color_transfer}/${p.color_range}`);
  if (!ok) die(`colour tags of ${f} are not bt709/bt709/bt709/tv`);
}

/* ── publish: content-hashed names ──────────────────────────────────────────────────────────── */
const files = [
  ...encs.map((e) => ({ kind: "video", key: e.key, codec: e.codec, crf: e.crf, tries: e.tries, from: e.file, codecs: codecsString(e.file),
    name: `hero-${VERSION}-${VARIANT}-<h8>-${e.key}.${e.codec}.mp4`, budgetKb: CFG.encodes[e.key].budget_kb[e.codec] })),
  ...posterFiles.flatMap((p) => ["avif", "webp", "jpg"].map((ext) => ({ kind: "poster", orient: p.orient, start: "de", ext,
    from: `${p.base}.${ext}`, name: `poster-${VERSION}-${VARIANT}-<h8>-${p.orient}-de.${ext}`,
    budgetKb: ext === "avif" ? p.avifBudgetKb : P.budget_kb[`${p.orient}_${ext}`], settings: ext === "avif" ? `crf ${p.avifCrf}` : p.stills, exception: ext === "avif" ? p.exception : null }))),
  { kind: "grain", from: grainPng, name: `grain-${VERSION}-<h8>.png`, budgetKb: 4 },
];
const named = files.map((f) => {
  const h8 = fileSha(f.from).slice(0, 8);
  const name = f.name.replace("<h8>", h8);
  return { ...f, name, h8, bytes: fs.statSync(f.from).size, src: `/film/${name}` };
});
const g6 = named.map((f) => ({ file: f.name, kb: kb(f.bytes), budgetKb: f.budgetKb, crf: f.crf ?? null, pass: f.bytes <= f.budgetKb * 1024 }));
report.files = named.map((f) => ({ kind: f.kind, name: f.name, src: f.src, bytes: f.bytes, kb: kb(f.bytes), budgetKb: f.budgetKb,
  codecs: f.codecs ?? null, crf: f.crf ?? null, tries: f.tries ?? null, settings: f.settings ?? null, exception: f.exception ?? null }));
report.gates.G6 = { pass: g6.every((x) => x.pass), files: g6 };
console.log("\nG6 budgets");
for (const x of g6) console.log(`  ${x.pass ? "ok" : "XX"} ${x.file.padEnd(52)} ${String(x.kb).padStart(7)} KB  (budget ${x.budgetKb}${x.crf !== null ? `, crf ${x.crf}` : ""})`);
if (!report.gates.G6.pass) die("G6: a file is over its budget");

if (PREVIEW_OUT) {
  for (const f of named) fs.copyFileSync(f.from, path.join(PREVIEW_OUT, f.name));
  console.log(`\nPREVIEW ONLY → ${PREVIEW_OUT} (public/ and lib/ untouched)`);
} else {
  fs.mkdirSync(PUBLIC_FILM, { recursive: true });
  const keep = new Set(named.map((f) => f.name));
  for (const f of named) fs.copyFileSync(f.from, path.join(PUBLIC_FILM, f.name));
  console.log("\nPublish → public/film");
  for (const n of fs.readdirSync(PUBLIC_FILM)) {
    if (/^(hero|poster|grain)-v\d+-(?:(?:nozu|zu)-)?[0-9a-f]{8}/.test(n) && !keep.has(n)) {
      fs.unlinkSync(path.join(PUBLIC_FILM, n));
      console.log(`  - removed stale ${n}`);
    }
  }
  for (const n of keep) console.log(`  + ${n}`);
  writeManifest(named);
}

/* ── shipped statistics (informational) and G5 ─────────────────────────────────────────────── */
function frameStats(file, W, H) {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-v", "error", "-i", file, "-vf",
      "scale=in_color_matrix=bt709:in_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24", "-f", "rawvideo", "pipe:1"]);
    const size = W * H * 3; let buf = Buffer.allocUnsafe(size), fill = 0; const frames = []; let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.stdout.on("data", (chunk) => {
      let off = 0;
      while (off < chunk.length) {
        const n = Math.min(size - fill, chunk.length - off);
        chunk.copy(buf, fill, off, off + n); fill += n; off += n;
        if (fill === size) {
          const hy = new Uint32Array(256); let s = 0;
          for (let i = 0; i < size; i += 3) { const y = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]; s += y; hy[y | 0]++; }
          frames.push({ mean: s / (W * H), hy }); fill = 0;
        }
      }
    });
    p.on("close", (code) => (code === 0 ? resolve(frames) : reject(new Error(err))));
  });
}
const pct = (h, N, q) => { let c = 0; for (let v = 0; v < 256; v++) { c += h[v]; if (c >= q * N) return v; } return 255; };
console.log("\nShipped H.264 (informational: mean / p99.5 / p99.9 luma per shot)");
report.shipped = {};
for (const [key, o] of [["16x9-1080", "16x9"], ["9x16-720", "9x16"]]) {
  const f = encs.find((e) => e.key === key && e.codec === "h264").file;
  const [W, H] = [CFG.encodes[key].w, CFG.encodes[key].h];
  const fr = await frameStats(f, W, H);
  report.shipped[`${key}.h264`] = TL.map((s) => {
    const xs = fr.slice(s.startFrame, s.endFrame);
    const r = { slot: o === "16x9" ? s.slot : s.slot916, mean: +(xs.reduce((a, x) => a + x.mean, 0) / xs.length).toFixed(1),
      p995max: Math.max(...xs.map((x) => pct(x.hy, W * H, 0.995))), p999max: Math.max(...xs.map((x) => pct(x.hy, W * H, 0.999))) };
    console.log(`  ${key} ${r.slot} mean ${r.mean} p99.5 ${r.p995max} p99.9 ${r.p999max}`);
    return r;
  });
}
console.log("\nG5 shake.py on the shipped H.264 (max step px at 320 px, every 0.1 s)");
report.gates.G5 = {};
const shakeTool = path.join(SRC, "tools", "shake.py");
for (const [key, o] of [["16x9-1080", "16x9"], ["9x16-720", "9x16"]]) {
  const f = encs.find((e) => e.key === key && e.codec === "h264").file;
  if (!fs.existsSync(shakeTool)) { report.gates.G5[key] = null; continue; }
  report.gates.G5[key] = TL.map((s) => {
    const t0 = s.startFrame / FPS + 0.02, dur = s.frames / FPS - 0.06;
    const out = run("python", ["-I", shakeTool, f, t0.toFixed(2), dur.toFixed(2)]);
    const m = out.match(/steps\(max\|dx\|,\|dy\|\)=\s*(\d+)\s+(\d+)/);
    const r = { slot: o === "16x9" ? s.slot : s.slot916, stepMaxDx: m ? +m[1] : null, stepMaxDy: m ? +m[2] : null };
    console.log(`  ${key} ${r.slot} step dx ${r.stepMaxDx} dy ${r.stepMaxDy}`);
    return r;
  });
}

/* ── report (band-check.mjs and film-strips.py read report.edit) ───────────────────────────── */
report.edit = Object.fromEntries(Object.keys(ORIENTS).map((o) => [o, TL.map((s) => ({
  slot: o === "16x9" ? s.slot : s.slot916, id: s.plates[o], author: CFG.plates[s.plates[o]].author,
  in: s.in[o], srcFps: s.src_fps[o], frames: s.frames, startFrame: s.startFrame,
  loopIn: +(s.startFrame / FPS).toFixed(2), loopOut: +(s.endFrame / FPS).toFixed(2), project: projectOf(s), credit: creditOf(TL.indexOf(s)),
}))]));
report.projects = FILM_PROJECTS;
fs.mkdirSync(path.dirname(REPORT), { recursive: true });
fs.writeFileSync(REPORT, JSON.stringify(report, null, 1));
console.log(`\nreport → ${REPORT}`);

/* ── manifest: lib/film-media.ts (FILM-HERO-SPEC §3.1) ─────────────────────────────────────── */
function writeManifest(pub) {
  const q = (s) => JSON.stringify(s);
  const find = (pred) => pub.find(pred);
  const srcObj = (key, codec) => {
    const f = find((x) => x.kind === "video" && x.key === key && x.codec === codec);
    const p = probe(f.from);
    return `{ src: ${q(f.src)}, type: ${q(`video/mp4; codecs="${f.codecs}"`)}, codec: ${q(codec)}, width: ${p.width}, height: ${p.height}, bytes: ${f.bytes} }`;
  };
  const posterObj = (o) => {
    const g = (ext) => find((x) => x.kind === "poster" && x.orient === o && x.ext === ext);
    const a = g("avif"), w = g("webp"), j = g("jpg");
    const [W, H] = ORIENTS[o];
    return `{
        width: ${W}, height: ${H}, frame: ${P.frame},
        avif: { src: ${q(a.src)}, type: "image/avif", bytes: ${a.bytes} },
        webp: { src: ${q(w.src)}, type: "image/webp", bytes: ${w.bytes} },
        jpg: { src: ${q(j.src)}, type: "image/jpeg", bytes: ${j.bytes} },
      }`;
  };
  const gr = find((x) => x.kind === "grain");
  // credits: the union of the plates of BOTH orientations of the published variant, film order
  const plates = new Map();
  for (const s of TL) for (const [o, id] of [["16x9", s.plates["16x9"]], ["9x16", s.plates["9x16"]]]) {
    const slot = o === "16x9" ? s.slot : s.slot916;
    if (!plates.has(id)) plates.set(id, []);
    plates.get(id).push(slot);
  }
  const credits = [...plates.entries()].map(([id, slots]) => {
    const pl = CFG.plates[id];
    return `    { slot: ${q(slots.join(", "))}, pexelsId: ${q(pl.source === "own" ? "" : id)}, author: ${q(pl.author)}, page: ${q(pl.page ?? "")}, source: ${q(pl.source ?? "pexels")} },`;
  }).join("\n");
  const projects = FILM_PROJECTS.map((p) => `    { id: ${q(p.id)}, host: ${q(p.host)}, url: ${q(p.url)}, kind: ${q(p.kind)} },`).join("\n");
  const shots = TL.map((s, i) => `    { slot: ${q(s.slot)}, startFrame: ${s.startFrame}, endFrame: ${s.endFrame}, start: ${+(s.startFrame / FPS).toFixed(3)}, end: ${+(s.endFrame / FPS).toFixed(3)}, project: ${q(projectOf(s))}, credit: ${q(creditOf(i))} },`).join("\n");
  const ts = `// GENERATED by tools/film/build-hero-film.mjs on ${new Date().toISOString().slice(0, 10)} (film ${VERSION}, variant ${VARIANT}). Do not edit by
// hand: run   node tools/film/build-hero-film.mjs --src C:\\Users\\franc\\progetti\\modolo-media-src
// and this file is rewritten with the real hashes, byte sizes, the shot timeline and the credits.
// Every path below is content-hashed (first 8 hex of the file's SHA-256), so /film/* is served immutable.

import type { ProjectId } from "@/data/projects";

/** Layout P (portrait/poster). The <picture>, the video source choice and the CSS use exactly this query. */
export const PORTRAIT_MQ = "(max-width: 767px), (orientation: portrait) and (max-aspect-ratio: 4/5)";

/** Layout L at or above this width loads the 1080p landscape set, below it the 720p set. */
export const LANDSCAPE_1080_MQ = "(min-width: 1280px)";

export type FilmLocale = "de" | "en" | "it";
export type FilmStart = "de" | "it";
export type FilmOrientation = "16x9" | "9x16";

export interface FilmSource {
  /** Public path, content-hashed, served with Cache-Control immutable. */
  src: string;
  /** Full MIME type with codecs string, for <source type>. */
  type: string;
  codec: "av1" | "h264";
  width: number;
  height: number;
  bytes: number;
}

/** AV1 first, H.264 second: render the <source> elements in this order. */
export type FilmSourceSet = readonly [FilmSource, FilmSource];

export interface FilmPosterImage {
  src: string;
  type: "image/avif" | "image/webp" | "image/jpeg";
  bytes: number;
}

export interface FilmPoster {
  width: number;
  height: number;
  /** Frame of the graded loop this poster was cut from (frame 0 = S1 / M1: BJ Studio's site on the laptop / phone). */
  frame: number;
  avif: FilmPosterImage;
  webp: FilmPosterImage;
  jpg: FilmPosterImage;
}

export interface FilmCredit {
  slot: string;
  pexelsId: string;
  author: string;
  page: string;
  /** "pexels" for licensed stock, "own" for Francesco's footage (with consent on file). */
  source: "pexels" | "own";
}

/** Which film is published: "nozu" (default, no ZUMOVE) or "zu" (only after Marco's written OK). */
export type FilmVariant = "nozu" | "zu";

/** A real website the published film shows on a screen (host, url, kind copied from data/projects.ts at build). */
export interface FilmProject {
  id: ProjectId;
  host: string;
  url: string;
  kind: "client" | "own";
}

/** One shot of the loop. 16:9 and 9:16 share these frame boundaries (the build fails otherwise). */
export interface FilmShot {
  /** 16:9 slot name ("S1"…"S6"); the 9:16 shot at the same index is "M1"…"M6". */
  slot: string;
  /** First frame of the shot (inclusive) and first frame after it (exclusive), at FILM.fps. */
  startFrame: number;
  endFrame: number;
  /** The same boundaries in seconds of the loop. */
  start: number;
  end: number;
  /** The site on screen in this shot; null = a «how» beat (stock hands, camera, key) with no site on screen. */
  project: ProjectId | null;
  /** The site the live credit names during this shot: the shot's own project, or the last one shown before it. */
  credit: ProjectId;
}

export const FILM = {
  version: ${q(VERSION)},
  fps: ${FPS},
  frames: ${LOOP},
  durationS: ${+(LOOP / FPS).toFixed(2)},
  /** Where each locale's film starts: video.currentTime = startAt[locale] on loadedmetadata, before play() (0 = no seek). */
  startAt: { de: ${CFG.start_at.de}, en: ${CFG.start_at.en}, it: ${CFG.start_at.it} } as const satisfies Record<FilmLocale, number>,
  /** Which poster start each locale uses (all three open on frame 0, BJ Studio). */
  posterStart: { de: "de", en: "de", it: "de" } as const satisfies Record<FilmLocale, FilmStart>,
  /** The published film (widened on purpose: comparisons with "zu" must type-check). */
  variant: ${q(VARIANT)} as FilmVariant,
  /** The websites the published film shows, in film order. The credit, its screen-reader sentence and the Impressum
   *  name exactly these, never the whole list in data/projects.ts. */
  projects: [
${projects}
  ] as readonly FilmProject[],
  /** The timeline (SPEC §1.1): hard cuts on these frames, both orientations. */
  shots: [
${shots}
  ] as readonly FilmShot[],
  sources: {
    "16x9-1080": [
      ${srcObj("16x9-1080", "av1")},
      ${srcObj("16x9-1080", "h264")},
    ],
    "16x9-720": [
      ${srcObj("16x9-720", "av1")},
      ${srcObj("16x9-720", "h264")},
    ],
    "9x16-720": [
      ${srcObj("9x16-720", "av1")},
      ${srcObj("9x16-720", "h264")},
    ],
  } satisfies Record<string, FilmSourceSet>,
  posters: {
    "16x9": {
      de: ${posterObj("16x9")},
      it: ${posterObj("16x9")},
    },
    "9x16": {
      de: ${posterObj("9x16")},
      it: ${posterObj("9x16")},
    },
  } satisfies Record<FilmOrientation, Record<FilmStart, FilmPoster>>,
  /** Static grain tile, 128×128, drawn at opacity .16 with mix-blend-mode soft-light. */
  grain: { src: ${q(gr.src)}, width: 128, height: 128, bytes: ${gr.bytes} },
  /** Stock footage (hands and rooms) for the Impressum; union of both orientations. The websites on the screens are the
   *  studio's own work and are listed in \`projects\`. */
  credits: [
${credits}
  ] satisfies readonly FilmCredit[],
  license: ${q(CFG.license)},
} as const;

/** Poster set for a locale and orientation (en and it use the de start). */
export function filmPoster(locale: FilmLocale, orientation: FilmOrientation): FilmPoster {
  return FILM.posters[orientation][FILM.posterStart[locale]];
}

/** Index into FILM.shots of the frame shown at \`seconds\` of the loop (frame-based, so it switches exactly on the cut).
 *  \`seconds\` is a presented frame's mediaTime (requestVideoFrameCallback) or currentTime (fallback); the 1 ms epsilon
 *  absorbs float error (3 * 0.04 = 0.11999…). */
export function filmShotAt(seconds: number): number {
  const frame = Math.floor(seconds * FILM.fps + 0.001);
  let i = 0;
  while (i + 1 < FILM.shots.length && FILM.shots[i + 1].startFrame <= frame) i++;
  return i;
}
`;
  fs.writeFileSync(MANIFEST_TS, ts);
  console.log(`  ✓ wrote ${path.relative(REPO, MANIFEST_TS)}`);
}
