"""A6 / A7 look strips of M6 from the 9:16 master at 300 % (FILM-HERO-SPEC §1.5e).

  python -I m6_strips.py <variant> [--out out/gates-<variant>]

m6_top_300_*.png     loop f296-f330 (every 3rd frame): phone top, notch, status bar, ZüriKey header (rigid, no wedge)
m6_finger_300.png    loop f275-f290 (every frame): the finger over the page (no page through the finger)
"""
import sys, os, subprocess
import numpy as np, cv2

a = sys.argv[1:]
V = a[0]
OUT = a[a.index("--out") + 1] if "--out" in a else f"out/gates-{V}"
os.makedirs(OUT, exist_ok=True)
M = f"masters/{V}/master-9x16.mkv"
def frames(idx):
    sel = "+".join(f"eq(n\\,{i})" for i in idx)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", M, "-vf", f"select='{sel}',format=rgb24", "-fps_mode", "passthrough", "-f", "rawvideo", "-"], capture_output=True).stdout
    arr = np.frombuffer(raw, np.uint8).reshape(-1, 1280, 720, 3)
    return {i: arr[k] for k, i in enumerate(sorted(idx))}
def lab(img, t):
    im = img.copy(); cv2.rectangle(im, (0, 0), (im.shape[1], 22), (0, 0, 0), -1)
    cv2.putText(im, t, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (120, 220, 255), 1, cv2.LINE_AA); return im
top = list(range(296, 331, 3))
F = frames(top)
tiles = [lab(cv2.resize(F[i][290:420, 170:570], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC), f"M6 loop f{i} 300 %") for i in top]
for k in range(0, len(tiles), 4):
    cv2.imwrite(os.path.join(OUT, f"m6_top_300_{k // 4}.png"), cv2.cvtColor(np.vstack(tiles[k:k + 4]), cv2.COLOR_RGB2BGR))
fin = list(range(275, 291))
F = frames(fin)
tiles = [lab(cv2.resize(F[i][760:1010, 300:620], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC), f"f{i}") for i in fin]
rows = [np.hstack(tiles[k:k + 4]) for k in range(0, 16, 4)]
for k in range(0, 4, 2):
    cv2.imwrite(os.path.join(OUT, f"m6_finger_300_{k // 2}.png"), cv2.cvtColor(np.vstack(rows[k:k + 2]), cv2.COLOR_RGB2BGR))
print("->", OUT)
