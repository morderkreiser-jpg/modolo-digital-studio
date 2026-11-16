// Status bar glyphs for NOTCHED phones (fork of dir-marchio statusbar_t.mjs, film v2): time on the left ear, a narrower
// icon cluster on the right ear (the notch of plates 6279146/6279147/6279154 spans css 89-304 of 393, measured with
// notch_measure.py), so no glyph hides behind the notch. Generic signal / wifi / battery, no vendor mark.
// Transparent PNGs at DPR 3: 1179 x 141 (393 x 47 CSS).
//   node statusbar_notch.mjs <outdir> <HH:MM>
import { chromium } from "file:///C:/Users/franc/progetti/ZUMOVE/node_modules/playwright/index.mjs";
import { join } from "node:path";
const [outDir, T] = process.argv.slice(2);
const html = (c) => `<!doctype html><html><head><style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:transparent;width:393px;height:47px;overflow:hidden;font-family:"Segoe UI",system-ui,sans-serif}
.bar{position:relative;width:393px;height:47px;color:${c}}
.time{position:absolute;left:33px;top:9px;font-size:16.5px;font-weight:600;letter-spacing:-.1px;line-height:20px}
.icons{position:absolute;right:18px;top:13px;height:13px;display:flex;gap:4px;align-items:center}
svg{display:block}
</style></head><body><div class="bar">
<div class="time">__T__</div>
<div class="icons">
 <svg width="16" height="10.7" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx=".9" fill="${c}"/><rect x="5" y="5.5" width="3" height="6.5" rx=".9" fill="${c}"/><rect x="10" y="3" width="3" height="9" rx=".9" fill="${c}"/><rect x="15" y="0" width="3" height="12" rx=".9" fill="${c}"/></svg>
 <svg width="14" height="10.5" viewBox="0 0 16 12"><path d="M8 11.6l2.4-2.5a3.4 3.4 0 0 0-4.8 0z" fill="${c}"/><path d="M3.9 7.4a5.8 5.8 0 0 1 8.2 0l1.5-1.6a8 8 0 0 0-11.2 0z" fill="${c}"/><path d="M.6 4.1a10.4 10.4 0 0 1 14.8 0L16 3.4l.0-.0A12.6 12.6 0 0 0 0 3.4z" fill="${c}"/></svg>
 <svg width="24" height="11.6" viewBox="0 0 27 13"><rect x=".5" y=".5" width="23" height="12" rx="3.6" fill="none" stroke="${c}" stroke-opacity=".4"/><rect x="2" y="2" width="17" height="9" rx="2.2" fill="${c}"/><path d="M25 4.4v4.2a2.2 2.2 0 0 0 0-4.2z" fill="${c}" fill-opacity=".45"/></svg>
</div></div></body></html>`;
const b = await chromium.launch({ args: ["--force-color-profile=srgb"] });
const p = await b.newPage({ viewport: { width: 393, height: 47 }, deviceScaleFactor: 3 });
for (const [name, c] of [["sb_dark", "#111111"], ["sb_light", "#ffffff"]]) {
  await p.setContent(html(c).replace("__T__", T));
  await p.screenshot({ path: join(outDir, name + "_" + T.replace(":", "") + ".png"), omitBackground: true });
}
await b.close();
console.log("ok");
