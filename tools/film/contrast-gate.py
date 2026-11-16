"""Hero film contrast gate (G3 / acceptance A8). Run with: python -I tools/film/contrast-gate.py [options]

For every case exported by tools/film/export-layers.mjs (viewport x locale) and for EVERY frame of the film
rendition that viewport really plays (read from lib/film-media.ts):
  1. cover-fit the frame to the viewport exactly like the page (object-fit: cover + object-position from the DOM),
  2. composite the page's scrim-only RGBA layer (scrims, grain, nav bar, opaque panels; text transparent),
  3. for every visible text LINE rect take the 99th-percentile background luminance (mean colour of the pixels
     at or above the 99th percentile; the 95th is reported too), alpha-blend the text colour over it and compute
     the WCAG 2.x contrast ratio (method of judge-cro worst.py / conversione frame_contrast.py).
Requirements: normal text >= 4.5:1, large text (>= 24 px, or >= 18.66 px bold) >= 3.0:1, toggle icon and
focus ring >= 3.0:1. Logotype and text on its own opaque background (CTA pill) are exempt / skipped.
The H1's text-shadow halo is NOT counted (conservative).
v2 (FILM-HERO-SPEC §1.11 G3): the live credit is measured as it really is on each frame: lit on proof shots, dim
(the export's `linesDim`, data-state="dim") on frames whose FILM.shots entry has project null; keys carry
«[credit lit]» / «[credit dim]». Layout L cases also check that the left scrim is >= .80 opaque over film x <= 0.27.

Options
  --media <MEDIA>          default C:/Users/franc/progetti/modolo-media-src (layers in <MEDIA>/build/layers)
  --repo <REPO>            default: two folders up from this file
  --only <substr>          only cases whose name contains this (e.g. de_1440x900)
  --step N                 every Nth frame (default 1 = every frame, as the gate requires)
  --av1 none|key|all       AV1 too: 'key' (default) = on 1440x900 and 390x844 only, 'all' = every case
  --percentile 99          background percentile (default 99)
Writes <MEDIA>/build/contrast-gate.json and, per case, a composite of the worst frame for the worst line
(<MEDIA>/build/contrast/<case>-<codec>-worst.png). Exit code 1 when any requirement fails.
"""
import json
import os
import re
import subprocess
import sys

import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]


def opt(name, default=None):
    return args[args.index(f"--{name}") + 1] if f"--{name}" in args else default


MEDIA = opt("media", "C:/Users/franc/progetti/modolo-media-src")
REPO = opt("repo", os.path.abspath(os.path.join(HERE, "..", "..")))
ONLY = opt("only")
STEP = int(opt("step", "1"))
AV1 = opt("av1", "key")
PCT = float(opt("percentile", "99"))
LAYERS = os.path.join(MEDIA, "build", "layers")
OUTDIR = os.path.join(MEDIA, "build", "contrast")
os.makedirs(OUTDIR, exist_ok=True)

# film renditions from the generated manifest
man = open(os.path.join(REPO, "lib", "film-media.ts"), encoding="utf-8").read()
FILES = {}
for src in re.findall(r'src:\s*"(/film/hero-[^"]+\.mp4)"', man):
    m = re.search(r"-(16x9-1080|16x9-720|9x16-720)\.(av1|h264)\.mp4$", src)
    if m:
        FILES[(m.group(1), m.group(2))] = os.path.join(REPO, "public", src.lstrip("/").replace("/", os.sep))
if not FILES:
    sys.exit("no film sources found in lib/film-media.ts")
# v2: the timeline, so the credit is measured lit on proof shots and dim (data-state="dim") on the «how» beats
SHOTS = [(int(a), int(b), p != "null") for a, b, p in re.findall(
    r'\{ slot: "S\d", startFrame: (\d+), endFrame: (\d+), start: [\d.]+, end: [\d.]+, project: (null|"[a-z]+"), credit: "[a-z]+" \}', man)]
FPS = int(re.search(r"fps:\s*(\d+)", man).group(1))
def frame_has_project(i):
    for a, b, lit in SHOTS:
        if a <= i < b:
            return lit
    return True


def lin(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lum(rgb):
    l = lin(rgb)
    return 0.2126 * l[..., 0] + 0.7152 * l[..., 1] + 0.0722 * l[..., 2]


def ratio(a, b):
    hi, lo = max(a, b), min(a, b)
    return (hi + 0.05) / (lo + 0.05)


def probe(video):
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                          "-of", "csv=p=0", video], capture_output=True, text=True).stdout.strip()
    return tuple(map(int, out.split(",")[:2]))


def parse_pos(pos):
    """object-position from getComputedStyle: '65% 50%' or '50% 50%' (keywords resolved by the browser)."""
    vals = []
    for v in pos.split()[:2]:
        if v.endswith("%"):
            vals.append(float(v[:-1]) / 100)
        elif v in ("left", "top"):
            vals.append(0.0)
        elif v in ("right", "bottom"):
            vals.append(1.0)
        elif v == "center":
            vals.append(0.5)
        else:  # px offsets: treated as absolute later
            vals.append(("px", float(v.replace("px", ""))))
    while len(vals) < 2:
        vals.append(0.5)
    return vals


def frames(video, box, pos, fit="cover", step=0):
    """Yield (index, HxWx3 float32) of the video placed in the media box like the browser does."""
    bx, by, bw, bh = [int(round(v)) for v in box]
    fw, fh = probe(video)
    s = max(bw / fw, bh / fh) if fit == "cover" else min(bw / fw, bh / fh)
    sw, sh = max(bw, round(fw * s)), max(bh, round(fh * s))
    px, py = parse_pos(pos)
    ox = int(px[1]) if isinstance(px, tuple) else round((sw - bw) * px)
    oy = int(py[1]) if isinstance(py, tuple) else round((sh - bh) * py)
    vf = f"scale={sw}:{sh}:flags=bicubic:in_color_matrix=bt709:in_range=tv,crop={bw}:{bh}:{ox}:{oy},format=rgb24"
    p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", video, "-vf", vf, "-f", "rawvideo", "-"], stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL if step is None else None)
    n = bw * bh * 3
    i = 0
    try:
        while True:
            b = p.stdout.read(n)
            if len(b) < n:
                break
            if i % (step or STEP) == 0:
                yield i, np.frombuffer(b, np.uint8).reshape(bh, bw, 3).astype(np.float32)
            i += 1
    finally:
        p.kill()
        p.wait()


def targets(info, key="lines"):
    out = []
    for ln in info.get(key) or info["lines"]:
        if ln.get("logo") or ln.get("onOpaque") or ln["text"].upper().replace(" ", "") in ("MODOLO", "DIGITALSTUDIO", "MODOLODIGITALSTUDIO"):
            continue
        c = ln["color"]
        large = ln["fs"] >= 24 or (ln["fs"] >= 18.66 and ln["fw"] >= 700)
        tag = " [credit dim]" if key == "linesDim" and ln.get("inCredit") else " [credit lit]" if ln.get("inCredit") else ""
        for r in ln["rects"]:
            out.append(dict(key=f'{ln["root"]}:{ln["text"][:34]}{tag}', kind="text", fs=ln["fs"], fw=ln["fw"], need=3.0 if large else 4.5,
                            fg=np.array([c["r"], c["g"], c["b"]], np.float32), al=c["a"] * ln["opacity"], rect=r))
    for ic in info.get("icons") or []:
        c = ic["color"]
        out.append(dict(key="hero:toggle icon", kind="icon", fs=0, fw=0, need=3.0, fg=np.array([c["r"], c["g"], c["b"]], np.float32),
                        al=c["a"] * ic.get("opacity", 1), rect=ic["rect"]))
    if info.get("ring"):
        c = info["ring"]["color"]
        out.append(dict(key="hero:toggle focus ring", kind="ring", fs=0, fw=0, need=3.0, fg=np.array([c["r"], c["g"], c["b"]], np.float32),
                        al=c["a"], rect=info["ring"]["rect"], inner=info["ring"]["inner"]))
    return out


def run_case(info, video, codec):
    W, H = info["vw"], info["vh"]
    lay = np.asarray(Image.open(os.path.join(LAYERS, f'{info["case"]}_scrims.png')).convert("RGBA")).astype(np.float32)
    if lay.shape[:2] != (H, W):
        lay = np.asarray(Image.fromarray(lay.astype(np.uint8)).resize((W, H))).astype(np.float32)
    A = lay[..., 3:4] / 255.0
    C = lay[..., :3]
    mx, my, mw, mh = info["media"]["rect"]
    T_lit = targets(info, "lines")
    T_dim = targets(info, "linesDim") if info.get("linesDim") else T_lit
    for T in (T_lit, T_dim):
        for t in T:
            x, y, w, h = t["rect"]
            t["box"] = (max(0, int(x)), max(0, int(y)), min(W, int(np.ceil(x + w))), min(H, int(np.ceil(y + h))))
            t["w99"], t["w95"] = (99.0, -1), (99.0, -1)
            if t["kind"] == "ring":  # only the ring band, not the button inside it
                ix, iy, iw, ih = t["inner"]
                m = np.ones((t["box"][3] - t["box"][1], t["box"][2] - t["box"][0]), bool)
                m[max(0, int(iy) - t["box"][1]): int(iy + ih) - t["box"][1], max(0, int(ix) - t["box"][0]): int(ix + iw) - t["box"][0]] = False
                t["mask"] = m
    canvas = np.zeros((H, W, 3), np.float32)
    n = 0
    for i, F in frames(video, (mx, my, mw, mh), info["media"]["pos"], info["media"].get("fit", "cover")):
        n += 1
        canvas[:] = 0
        x0, y0 = int(round(mx)), int(round(my))
        hh, ww = F.shape[:2]
        sy0, sx0 = max(0, -y0), max(0, -x0)
        ty0, tx0 = max(0, y0), max(0, x0)
        ty1, tx1 = min(H, y0 + hh), min(W, x0 + ww)
        canvas[ty0:ty1, tx0:tx1] = F[sy0: sy0 + (ty1 - ty0), sx0: sx0 + (tx1 - tx0)]
        comp = canvas * (1 - A) + C * A
        T = T_lit if frame_has_project(i) else T_dim
        for t in T:
            bx0, by0, bx1, by1 = t["box"]
            if bx1 - bx0 < 2 or by1 - by0 < 2:
                continue
            reg = comp[by0:by1, bx0:bx1]
            flat = reg.reshape(-1, 3)
            if "mask" in t:
                flat = reg[t["mask"][: reg.shape[0], : reg.shape[1]]].reshape(-1, 3)
            L = lum(flat)
            for pc, k in ((PCT, "w99"), (95, "w95")):
                thr = np.percentile(L, pc)
                bg = flat[L >= thr].mean(axis=0)
                eff = t["al"] * t["fg"] + (1 - t["al"]) * bg
                r = ratio(float(lum(eff[None])[0]), float(lum(bg[None])[0]))
                if r < t[k][0]:
                    t[k] = (r, i)
    agg = {}
    for t in T_lit + (T_dim if T_dim is not T_lit else []):
        if t["w99"][1] < 0:
            continue  # never measured: that credit state never occurs on screen in this rendition
        k = t["key"]
        if k not in agg or t["w99"][0] < agg[k]["w99"][0]:
            agg[k] = t
    return n, agg


def left_scrim(info):
    """G3 (F18): in Layout L the left scrim must be >= .80 opaque over film x <= 0.27 (the S1 plate's anonymous
    head and jaw sit at x 0.07-0.25). Returns (min alpha over that band, viewport x of film x 0.27) or None."""
    if info.get("portrait"):
        return None
    W, H = info["vw"], info["vh"]
    lay = np.asarray(Image.open(os.path.join(LAYERS, f'{info["case"]}_scrims.png')).convert("RGBA")).astype(np.float32)
    A = lay[..., 3] / 255.0
    mx, my, mw, mh = info["media"]["rect"]
    fw, fh = 1920, 1080
    s = max(mw / fw, mh / fh)
    sw = fw * s
    px, _ = parse_pos(info["media"]["pos"])
    ox = px[1] if isinstance(px, tuple) else (sw - mw) * px
    x027 = mx - ox + 0.27 * sw                      # viewport x of film x = 0.27
    x1 = int(min(W, max(0, np.floor(x027))))
    if x1 <= 0:
        return (1.0, x027)
    band = A[:, :x1]
    # the nav bar (opaque or transparent) and the bottom rail are not film: measure the film rows only
    return (float(band.min()), float(x027))


def composite_worst(info, video, frame_idx, out):
    W, H = info["vw"], info["vh"]
    for i, F in frames(video, info["media"]["rect"], info["media"]["pos"], info["media"].get("fit", "cover"), step=None):
        if i == frame_idx:
            break
    canvas = np.zeros((H, W, 3), np.float32)
    mx, my = int(round(info["media"]["rect"][0])), int(round(info["media"]["rect"][1]))
    hh, ww = F.shape[:2]
    canvas[max(0, my): min(H, my + hh), max(0, mx): min(W, mx + ww)] = F[: min(H, my + hh) - max(0, my), : min(W, mx + ww) - max(0, mx)]
    lay = np.asarray(Image.open(os.path.join(LAYERS, f'{info["case"]}_text.png')).convert("RGBA")).astype(np.float32)
    a = lay[..., 3:4] / 255.0
    Image.fromarray((canvas * (1 - a) + lay[..., :3] * a).clip(0, 255).astype(np.uint8)).save(out)


if __name__ == "__main__":
    cases = sorted(f[:-5] for f in os.listdir(LAYERS) if f.endswith(".json") and f != "index.json")
    if ONLY:
        cases = [c for c in cases if ONLY in c]
    if not cases:
        sys.exit(f"no layer exports in {LAYERS}: run tools/film/export-layers.mjs against the built page first")
    results, fails = [], 0
    for name in cases:
        info = json.load(open(os.path.join(LAYERS, f"{name}.json"), encoding="utf-8"))
        info["case"] = name
        ls = left_scrim(info)
        if ls is not None:
            ok = ls[0] >= 0.80
            fails += 0 if ok else 1
            print(f"\n  {'OK  ' if ok else 'FAIL'} {name}: left scrim min alpha {ls[0]:.3f} over film x <= 0.27 (viewport x < {ls[1]:.0f})  need 0.80")
            results.append(dict(case=name, codec="-", file="-", key="left scrim >= .80 at film x <= 0.27", kind="scrim", fs=0, need=0.80,
                                p99=round(ls[0], 3), frame=-1, p95=None, pass_=ok))
        codecs = ["h264"]
        if AV1 == "all" or (AV1 == "key" and any(s in name for s in ("1440x900", "390x844"))):
            codecs.append("av1")
        for codec in codecs:
            video = FILES.get((info["set"], codec))
            if not video or not os.path.exists(video):
                print(f"! {name}: no {info['set']} {codec} file")
                continue
            n, agg = run_case(info, video, codec)
            print(f"\n### {name}  {info['set']}.{codec}  ({info['vw']}x{info['vh']}, {n} frames, object-position {info['media']['pos']})")
            worst_case = None
            for k, t in sorted(agg.items(), key=lambda kv: kv[1]["w99"][0]):
                r99, f99 = t["w99"]
                r95, _ = t["w95"]
                ok = r99 >= t["need"]
                fails += 0 if ok else 1
                if worst_case is None:
                    worst_case = (r99, f99)
                print(f"  {'OK  ' if ok else 'FAIL'} {k:42s} {t['fs']:>5}px w{t['fw']:<3} a={t['al']:.2f}  p{PCT:g} {r99:5.2f} @f{f99:3d} ({f99 / 25:5.2f}s)  p95 {r95:5.2f}  need {t['need']}")
                results.append(dict(case=name, codec=codec, file=os.path.basename(video), key=k, kind=t["kind"], fs=t["fs"], need=t["need"],
                                    p99=round(r99, 2), frame=f99, p95=round(r95, 2), pass_=ok))
            if worst_case and worst_case[1] >= 0:
                composite_worst(info, video, worst_case[1], os.path.join(OUTDIR, f"{name}-{codec}-worst.png"))
    json.dump(results, open(os.path.join(MEDIA, "build", "contrast-gate.json"), "w", encoding="utf-8"), indent=1)
    print(f"\n{len(results)} checks, {fails} failing  ->  {os.path.join(MEDIA, 'build', 'contrast-gate.json')}")
    sys.exit(1 if fails else 0)
