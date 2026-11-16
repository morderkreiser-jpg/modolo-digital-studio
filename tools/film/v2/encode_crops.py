"""A15 screen sharpness + final contact sheets from the SHIPPED encodes (FILM-HERO-SPEC §1.11, A15, A16).

  python -I encode_crops.py <variant> <public_film_dir_or_preview_dir> [--out out/encode-<variant>]

For S1 / S3 / S6 (16:9 1080: master | AV1 | H.264) and M1 / M3 / M6 (9:16 720: master | AV1 | H.264) it writes
100 % crops of the site text side by side (BJ serif, «60 CHF», ZüriKey H1, score bars), plus a 200 % version, and
contact sheets of every shot of the final 1080 H.264, 720 H.264 and 9:16 H.264 (6 frames per shot). Decodes use
the BT.709 matrix of the files' tags.
"""
import sys, os, glob, subprocess, json
import numpy as np, cv2

a = sys.argv[1:]
V, PUB = a[0], a[1]
OUT = a[a.index("--out") + 1] if "--out" in a else f"out/encode-{V}"
os.makedirs(OUT, exist_ok=True)
def find(key, codec):
    f = sorted(glob.glob(os.path.join(PUB, f"hero-v2-{V}-*-{key}.{codec}.mp4")))
    if not f: sys.exit(f"no {key}.{codec} in {PUB}")
    return f[0]
MASTER = {"16x9": f"masters/{V}/master-16x9.mkv", "9x16": f"masters/{V}/master-9x16.mkv"}

def decode(path, idx, W, H, rgb_in=False):
    idx = sorted(set(idx))
    sel = "+".join(f"eq(n\\,{i})" for i in idx)
    vf = f"select='{sel}'," + ("format=rgb24" if rgb_in else f"scale={W}:{H}:in_color_matrix=bt709:in_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=rgb24")
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-vf", vf, "-fps_mode", "passthrough", "-f", "rawvideo", "-"], capture_output=True).stdout
    arr = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    return {i: arr[k] for k, i in enumerate(idx)}

def lab(img, text):
    im = img.copy()
    cv2.rectangle(im, (0, 0), (im.shape[1], 20), (0, 0, 0), -1)
    cv2.putText(im, text, (4, 15), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (120, 220, 255), 1, cv2.LINE_AA)
    return im

# crops: (frame, x, y, w, h) at the file's own resolution
C169 = {"S1 BJ serif f37": (37, 1180, 300, 440, 260), "S3 prices f160": (160, 1200, 560, 330, 320), "S6 H1 + score bars f330": (330, 1270, 280, 560, 300)}
C916 = {"M1 BJ f37": (37, 250, 520, 290, 300), "M3 prices f160": (160, 200, 760, 330, 330), "M6 ZüriKey f330": (330, 180, 360, 360, 300)}
for o, crops, key, (W, H) in (("16x9", C169, "16x9-1080", (1920, 1080)), ("9x16", C916, "9x16-720", (720, 1280))):
    idx = [c[0] for c in crops.values()]
    fm = decode(MASTER[o], idx, W, H, rgb_in=True)
    fa = decode(find(key, "av1"), idx, W, H)
    fh = decode(find(key, "h264"), idx, W, H)
    rows, rows2 = [], []
    for name, (i, x, y, w, h) in crops.items():
        tiles = [lab(f[i][y:y + h, x:x + w], f"{name} {src}") for f, src in ((fm, "master"), (fa, "AV1"), (fh, "H.264"))]
        rows.append(np.hstack([np.pad(t, ((0, 0), (0, 6), (0, 0))) for t in tiles]))
        tiles2 = [lab(cv2.resize(f[i][y:y + h, x:x + w], None, fx=2, fy=2, interpolation=cv2.INTER_NEAREST), f"{name} {src} 200 %") for f, src in ((fa, "AV1"), (fh, "H.264"))]
        rows2.append(np.hstack([np.pad(t, ((0, 0), (0, 6), (0, 0))) for t in tiles2]))
    w = max(r.shape[1] for r in rows)
    cv2.imwrite(os.path.join(OUT, f"text100_{o}.png"), cv2.cvtColor(np.vstack([np.pad(r, ((0, 6), (0, w - r.shape[1]), (0, 0))) for r in rows]), cv2.COLOR_RGB2BGR))
    for k, r in enumerate(rows2):
        cv2.imwrite(os.path.join(OUT, f"text200_{o}_{k}.png"), cv2.cvtColor(r, cv2.COLOR_RGB2BGR))

# contact sheets of the final encodes: 6 frames per shot
SHOTS = [("S1", 0, 75), ("S2", 75, 125), ("S3", 125, 195), ("S4", 195, 245), ("S5", 245, 275), ("S6", 275, 345)]
for key, (W, H), tw in (("16x9-1080", (1920, 1080), 320), ("16x9-720", (1280, 720), 320), ("9x16-720", (720, 1280), 150)):
    f = find(key, "h264")
    picks = {s: [a0 + round(k * (b0 - a0 - 1) / 5) for k in range(6)] for s, a0, b0 in SHOTS}
    F = decode(f, [i for v in picks.values() for i in v], W, H)
    th = round(tw * H / W)
    rows = []
    for s, ids in picks.items():
        rows.append(np.hstack([np.pad(lab(cv2.resize(F[i], (tw, th), interpolation=cv2.INTER_AREA), f"{s} f{i}"), ((0, 4), (0, 4), (0, 0))) for i in ids]))
    if key == "9x16-720":
        sheet = np.vstack([np.hstack(rows[:3]) if False else np.vstack(rows)])
    else:
        sheet = np.vstack(rows)
    cv2.imwrite(os.path.join(OUT, f"contact_{key}_h264.jpg"), cv2.cvtColor(sheet, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_JPEG_QUALITY, 90])
print("->", OUT)
