"""Contact strips for the hero film (human sign-off; gates G2, G7 and the grade look).

python -I tools/film/film-strips.py <MEDIA> <mode> [options]

  shots   [--src master|<file>]        one row per shot, 6 frames (first .. last), both orientations
  seams                                every cut incl. the loop seam: last frame | first frame, both orientations
  frames  <orient> <slot> [x y w h]    every frame of one shot at 100 % (optional native crop) -> grid sheets
  bob     <orient> <slot>              per-frame global motion of one shot; residual after a smooth fit (G5)

Input is the lossless graded master unless --src names an encode (or "shipped" = the published H.264): film v2 reads
the FFV1 master of each orientation from MEDIA/build/report.json "masters" (v1 read MEDIA/build/concat-<orient>.txt).
Output: MEDIA/build/strips/*.jpg. Labels: loop frame, loop time, source time.
"""
import json
import os
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

MEDIA = sys.argv[1]
MODE = sys.argv[2]
REST = sys.argv[3:]
BUILD = os.path.join(MEDIA, "build")
OUT = os.path.join(BUILD, "strips")
os.makedirs(OUT, exist_ok=True)
TAG = REST[REST.index("--tag") + 1] if "--tag" in REST else ""   # variant: report-<tag>.json, concat-<tag>-<o>.txt
REP = json.load(open(os.path.join(BUILD, f"report{'-' + TAG if TAG else ''}.json"), encoding="utf-8"))
FPS = REP["fps"]
DIMS = {"16x9": (1920, 1080), "9x16": (720, 1280)}
try:
    FONT = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 16)
except OSError:
    FONT = ImageFont.load_default()


def opt(name, default=None):
    if f"--{name}" in REST:
        return REST[REST.index(f"--{name}") + 1]
    return default


def shipped(orient):
    """Path of the shipped H.264 file for an orientation (from report.json 'files')."""
    key = "16x9-1080" if orient == "16x9" else "9x16-720"
    repo = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
    f = next(x for x in REP["files"] if x["name"].endswith(f"-{key}.h264.mp4"))
    return os.path.join(repo, "public", "film", f["name"])


def grab(orient, frames, src=None, size=None):
    """Return {frame_index: HxWx3 uint8} for the requested loop frames (BT.709 decode)."""
    frames = sorted(set(frames))
    W, H = DIMS[orient]
    if src == "shipped":
        src = shipped(orient)
    if src and src != "master":
        p = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
                            "-of", "csv=p=0", src], capture_output=True, text=True).stdout.strip().split(",")
        W, H = int(p[0]), int(p[1])
        inp = ["-i", src]
    elif REP.get("masters"):   # v2: one lossless RGB master per orientation (FFV1 gbrp), named in report.json
        inp = ["-i", REP["masters"][orient]["file"]]
    else:
        inp = ["-f", "concat", "-safe", "0", "-i", os.path.join(BUILD, f"concat{'-' + TAG if TAG else ''}-{orient}.txt")]
    sel = "+".join(f"eq(n\\,{f})" for f in frames)
    vf = f"select='{sel}',scale=in_color_matrix=bt709:in_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24"
    raw = subprocess.run(["ffmpeg", "-v", "error", *inp, "-vf", vf, "-fps_mode", "passthrough", "-f", "rawvideo", "-"],
                         capture_output=True).stdout
    n = len(raw) // (W * H * 3)
    arr = np.frombuffer(raw[: n * W * H * 3], np.uint8).reshape(n, H, W, 3)
    if n != len(frames):
        print(f"! asked {len(frames)} frames, got {n}")
    return {f: arr[i] for i, f in enumerate(frames[:n])}, (W, H)


def label(im, text):
    d = ImageDraw.Draw(im)
    d.rectangle([0, 0, im.width, 20], fill=(0, 0, 0))
    d.text((4, 2), text, fill=(255, 220, 120), font=FONT)
    return im


def src_time(shot, local):
    return shot["in"] + local / shot["srcFps"]


def shots(src=None):
    for orient in ("16x9", "9x16"):
        edit = REP["edit"][orient]
        want = {}
        for s in edit:
            n = s["frames"]
            for k in range(6):
                want[s["startFrame"] + round(k * (n - 1) / 5)] = s
        got, (W, H) = grab(orient, list(want), src)
        cw = 400 if orient == "16x9" else 216
        ch = round(cw * H / W)
        rows = []
        for s in edit:
            idx = [s["startFrame"] + round(k * (s["frames"] - 1) / 5) for k in range(6)]
            row = Image.new("RGB", (6 * (cw + 4), ch + 24), (40, 40, 40))
            d = ImageDraw.Draw(row)
            d.text((4, 3), f"{s['slot']} {s['id']}  loop {s['loopIn']:.2f}-{s['loopOut']:.2f} s  in {s['in']} s @ {s['srcFps']:.3g} fps",
                   fill=(255, 255, 255), font=FONT)
            for k, f in enumerate(idx):
                im = Image.fromarray(got[f]).resize((cw, ch), Image.LANCZOS)
                label(im, f"f{f} {f / FPS:.2f}s src {src_time(s, f - s['startFrame']):.2f}")
                row.paste(im, (k * (cw + 4), 24))
            rows.append(row)
        sheet = Image.new("RGB", (rows[0].width, sum(r.height + 6 for r in rows)), (0, 0, 0))
        y = 0
        for r in rows:
            sheet.paste(r, (0, y))
            y += r.height + 6
        tag = "master" if not src or src == "master" else "shipped" if src == "shipped" else os.path.basename(src).replace(".mp4", "")
        out = os.path.join(OUT, f"shots-{orient}-{tag}{'-' + TAG if TAG else ''}.jpg")
        sheet.save(out, quality=88)
        print(out, sheet.size)


def seams(src=None):
    for orient in ("16x9", "9x16"):
        edit = REP["edit"][orient]
        total = sum(s["frames"] for s in edit)
        pairs = []
        for i, s in enumerate(edit):
            nxt = edit[(i + 1) % len(edit)]
            pairs.append((s["startFrame"] + s["frames"] - 1, nxt["startFrame"] % total, s, nxt))
        got, (W, H) = grab(orient, [p[0] for p in pairs] + [p[1] for p in pairs], src)
        cw = 560 if orient == "16x9" else 300
        ch = round(cw * H / W)
        rows = []
        for a, b, s, nxt in pairs:
            row = Image.new("RGB", (2 * cw + 10, ch), (255, 0, 0))
            row.paste(label(Image.fromarray(got[a]).resize((cw, ch), Image.LANCZOS), f"{s['slot']} last f{a}"), (0, 0))
            row.paste(label(Image.fromarray(got[b]).resize((cw, ch), Image.LANCZOS), f"{nxt['slot']} first f{b}"), (cw + 10, 0))
            rows.append(row)
        if orient == "16x9":
            sheet = Image.new("RGB", (rows[0].width, len(rows) * (ch + 8)), (0, 0, 0))
            for i, r in enumerate(rows):
                sheet.paste(r, (0, i * (ch + 8)))
        else:
            sheet = Image.new("RGB", (len(rows) * (rows[0].width + 12), ch), (0, 0, 0))
            for i, r in enumerate(rows):
                sheet.paste(r, (i * (rows[0].width + 12), 0))
        out = os.path.join(OUT, f"seams-{orient}{'-shipped' if src == 'shipped' else ''}{'-' + TAG if TAG else ''}.jpg")
        sheet.save(out, quality=88)
        print(out, sheet.size)


def frames(orient, slot, crop=None, src=None):
    s = next(x for x in REP["edit"][orient] if x["slot"] == slot)
    idx = list(range(s["startFrame"], s["startFrame"] + s["frames"]))
    got, (W, H) = grab(orient, idx, src)
    x, y, w, h = crop if crop else (0, 0, W, H)
    cols = max(1, min(8, 1920 // w))
    per = cols * max(1, min(6, 1600 // h))
    for page in range(0, len(idx), per):
        chunk = idx[page: page + per]
        rows = (len(chunk) + cols - 1) // cols
        sheet = Image.new("RGB", (cols * (w + 4), rows * (h + 4)), (255, 0, 0))
        for i, f in enumerate(chunk):
            im = Image.fromarray(got[f][y: y + h, x: x + w])
            label(im, f"f{f} src {src_time(s, f - s['startFrame']):.2f}")
            sheet.paste(im, ((i % cols) * (w + 4), (i // cols) * (h + 4)))
        tag = f"{x}_{y}_{w}x{h}" if crop else "full"
        out = os.path.join(OUT, f"frames-{orient}-{slot}-{tag}-p{page // per}.jpg")
        sheet.save(out, quality=92)
        print(out, sheet.size)


def bob(orient, slot, region=None, src=None):
    """Phase correlation between consecutive frames (whole frame or a region) scaled to 480 px wide;
    cumulative path; residual vs. a quadratic (smooth camera move); steps also given at the 320-px scale
    of MEDIA/tools/shake.py so they compare with G5's '<= 1 px per step'."""
    s = next(x for x in REP["edit"][orient] if x["slot"] == slot)
    idx = list(range(s["startFrame"], s["startFrame"] + s["frames"]))
    got, (W, H) = grab(orient, idx, src)
    x0, y0, rw, rh = region if region else (0, 0, W, H)
    sc = 480 / rw
    g = [np.asarray(Image.fromarray(got[f][y0:y0 + rh, x0:x0 + rw]).convert("L").resize((480, round(rh * sc)), Image.BILINEAR), np.float32) for f in idx]
    win = np.outer(np.hanning(g[0].shape[0]), np.hanning(g[0].shape[1]))

    def pc(a, b):
        A = np.fft.fft2((a - a.mean()) * win)
        B = np.fft.fft2((b - b.mean()) * win)
        R = A * np.conj(B)
        R /= np.abs(R) + 1e-6
        r = np.fft.ifft2(R).real
        yy, xx = np.unravel_index(r.argmax(), r.shape)
        # sub-pixel parabola
        def sub(c, n, ax):
            l = r[(yy, (xx - 1) % r.shape[1])] if ax else r[((yy - 1) % r.shape[0], xx)]
            m = r[yy, xx]
            rr = r[(yy, (xx + 1) % r.shape[1])] if ax else r[((yy + 1) % r.shape[0], xx)]
            den = l - 2 * m + rr
            return c + (0.5 * (l - rr) / den if den != 0 else 0)
        fy, fx = sub(yy, r.shape[0], 0), sub(xx, r.shape[1], 1)
        if fy > r.shape[0] / 2:
            fy -= r.shape[0]
        if fx > r.shape[1] / 2:
            fx -= r.shape[1]
        return fx, fy

    steps = np.array([pc(g[i], g[i + 1]) for i in range(len(g) - 1)])
    path = np.vstack([[0, 0], np.cumsum(steps, axis=0)]) / sc   # in output pixels
    t = np.arange(len(path))
    res = []
    for k in (0, 1):
        fit = np.polyval(np.polyfit(t, path[:, k], 2), t)
        res.append(path[:, k] - fit)
    res = np.array(res).T
    acc = np.diff(path, 2, axis=0)
    st = np.abs(steps) / sc * (320 / W)          # per-frame steps at shake.py's 320-px scale
    print(f"{orient} {slot} region {region or 'full'}: frames {len(path)}; path end dx {path[-1, 0]:.1f} dy {path[-1, 1]:.1f} px (output scale)")
    print(f"  max step per frame at 320 px: dx {st[:, 0].max():.2f}  dy {st[:, 1].max():.2f}   (output px: {np.abs(steps[:, 0]).max() / sc:.1f} / {np.abs(steps[:, 1]).max() / sc:.1f})")
    print(f"  residual vs quadratic: max |dx| {np.abs(res[:, 0]).max():.2f}  max |dy| {np.abs(res[:, 1]).max():.2f}  rms {np.sqrt((res ** 2).mean()):.2f} px")
    print(f"  frame-to-frame acceleration: max |ddx| {np.abs(acc[:, 0]).max():.2f}  max |ddy| {np.abs(acc[:, 1]).max():.2f} px/frame^2")
    print("  dy steps:", " ".join(f"{v / sc:+.1f}" for v in steps[:, 1]))
    return dict(res_max=[float(np.abs(res[:, 0]).max()), float(np.abs(res[:, 1]).max())])


if MODE == "shots":
    shots(opt("src"))
elif MODE == "seams":
    seams(opt("src"))
elif MODE == "frames":
    o, sl = REST[0], REST[1]
    cr = tuple(map(int, REST[2:6])) if len(REST) >= 6 and not REST[2].startswith("--") else None
    frames(o, sl, cr, opt("src"))
elif MODE == "bob":
    rg = tuple(map(int, REST[2:6])) if len(REST) >= 6 and not REST[2].startswith("--") else None
    bob(REST[0], REST[1], rg, opt("src"))
else:
    print(__doc__)
