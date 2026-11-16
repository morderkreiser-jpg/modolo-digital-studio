"""Film v2 master gates and look sheets (FILM-HERO-SPEC §1.5, §1.11; A5, A8, A9, A10, A11, A12, A16).

  python -I master_gates.py <variant> [--out out/gates-<variant>]

Numbers (written to <out>/master_gates.json and printed):
  A5  nails: max BT.709 luma in the nail rects on all 50 frames of S2/M2 (16:9 x 1350-1920 y 810-1080; 9:16 x 380-720
      y 780-1080), must be <= 26
  A9  S1 static: the 75 site-texture frames of S1 (capture bj-d14-hold) are pixel-identical; S1 screen region of the
      master frame-to-frame |diff| per step (only noise + the 0.5 %/s push)
  A13 upscale: max output/crop scale per shot (from the master report), must be <= 1.25
Sheets (LOOK at them):
  nails_300.png      S2 f75/f100/f124 and M2 at 300 % around the pen + the nail rects
  s4_lcd_300_*.png   S4 / M4 LCD + MICRO mark at 300 % on 10 frames each (blur must hide every overlay letter)
  s4_frame_x.png     S4 on 6 frames with lines at x 0.50 and 0.94 (camera and both hands inside)
  bezel_x6_*.png     S1 / S6 bezel strip under the screen lifted x6 on 12 frames each («MacBook Pro» never legible)
  s6_first.png       loop f272-f280 (S5 -> S6 cut; f275 = ZüriKey H1 already visible)
  statusbars.png     M1 f30 / M3 f160 / M6 f280, f300, f330 phone tops at 200 % (21:04 / 21:07 / 21:11, static)
  seams_<o>.png      +-2 frames around every cut and the loop seam (G7)
"""
import sys, os, json, subprocess, glob
import numpy as np, cv2

a = sys.argv[1:]
V = a[0]
OUT = a[a.index("--out") + 1] if "--out" in a else f"out/gates-{V}"
os.makedirs(OUT, exist_ok=True)
M = {"16x9": f"masters/{V}/master-16x9.mkv", "9x16": f"masters/{V}/master-9x16.mkv"}
DIM = {"16x9": (1920, 1080), "9x16": (720, 1280)}
LW = np.array([0.2126, 0.7152, 0.0722], np.float32)

def frames(o, idx):
    """decode exact frames of a master (gbrp -> rgb24, lossless)"""
    W, H = DIM[o]
    idx = sorted(set(idx))
    sel = "+".join(f"eq(n\\,{i})" for i in idx)
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", M[o], "-vf", f"select='{sel}',format=rgb24", "-fps_mode", "passthrough",
                          "-f", "rawvideo", "-"], capture_output=True).stdout
    arr = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)
    return {i: arr[k] for k, i in enumerate(idx)}

def lab(img, text):
    im = img.copy()
    cv2.rectangle(im, (0, 0), (im.shape[1], 22), (0, 0, 0), -1)
    cv2.putText(im, text, (4, 16), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (120, 220, 255), 1, cv2.LINE_AA)
    return im

def save(name, rows):
    w = max(r.shape[1] for r in rows)
    rows = [np.pad(r, ((0, 4), (0, w - r.shape[1]), (0, 0))) for r in rows]
    cv2.imwrite(os.path.join(OUT, name), cv2.cvtColor(np.vstack(rows), cv2.COLOR_RGB2BGR))

res = {}
# ── A5 nails ──────────────────────────────────────────────────────────────────────────────────
RECTS = {"16x9": (1350, 810, 1920, 1080), "9x16": (380, 780, 720, 1080)}
for o in ("16x9", "9x16"):
    F = frames(o, range(75, 125))
    x0, y0, x1, y1 = RECTS[o]
    mx = [float((F[i][y0:y1, x0:x1].astype(np.float32) @ LW).max()) for i in range(75, 125)]
    res[f"A5_nails_{o}"] = {"rect": RECTS[o], "max_luma": round(max(mx), 2), "worst_frame": 75 + int(np.argmax(mx)), "pass": max(mx) <= 26}
    print(f"A5 nails {o}: max luma {max(mx):.2f} @ f{75 + int(np.argmax(mx))} (limit 26)")
F169 = frames("16x9", [75, 100, 124]); F916 = frames("9x16", [75, 100, 124])
rows = []
for i in (75, 100, 124):
    f = F169[i].copy(); cv2.rectangle(f, (1350, 810), (1919, 1079), (255, 0, 255), 2)
    pen = cv2.resize(f[300:700, 1250:1750], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)
    rows.append(lab(np.hstack([cv2.resize(f, (960, 540), interpolation=cv2.INTER_AREA), pen[:540, :1500]]), f"S2 f{i}: full (rect = nail gate) | pen + stroke 300 %"))
for i in (75, 100, 124):
    f = F916[i].copy(); cv2.rectangle(f, (380, 780), (719, 1079), (255, 0, 255), 2)
    z = cv2.resize(f[250:700, 150:700], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
    z = np.pad(z, ((0, 1280 - z.shape[0]), (0, 0), (0, 0)))
    rows.append(lab(np.hstack([f, z]), f"M2 f{i}: full | sketch 200 %"))
save("nails_300.png", rows)

# ── A9 S1 static ──────────────────────────────────────────────────────────────────────────────
site = sorted(glob.glob("sites/bj_d_hold/f*.png"))
ref = cv2.imread(site[0]); same = all(np.array_equal(ref, cv2.imread(f)) for f in site)
F = frames("16x9", range(0, 75))
m = cv2.imread("work/s1h_bj_laptop/m0000.png", cv2.IMREAD_GRAYSCALE)
# screen rect at output scale for frame 0 (crop -180,40,3840,2160 -> 0.5x); a safe inner rect of the laptop screen
scr = (1060, 240, 1700, 640)
d = [float(np.abs(F[i][scr[1]:scr[3], scr[0]:scr[2]].astype(np.int16) - F[i - 1][scr[1]:scr[3], scr[0]:scr[2]].astype(np.int16)).mean()) for i in range(1, 75)]
res["A9_S1_static"] = {"site_frames_identical": same, "site_frames": len(site), "screen_step_diff_mean": round(float(np.mean(d)), 3), "screen_step_diff_max": round(max(d), 3)}
print(f"A9 S1: {len(site)} site frames identical={same}; master screen |step diff| mean {np.mean(d):.3f} max {max(d):.3f}")

# ── A13 upscale (from the reports) ─────────────────────────────────────────────────────────────
for o in ("16x9", "9x16"):
    r = json.load(open(M[o] + ".report.json"))
    res[f"A13_upscale_{o}"] = {s["id"]: s["scale_max"] for s in r["shots"]}
    print(f"A13 {o}: " + ", ".join(f"{s['id']} {s['scale_max']}" for s in r["shots"]))

# ── A11 S4 / M4 ───────────────────────────────────────────────────────────────────────────────
pick = [195, 200, 205, 210, 215, 220, 225, 230, 238, 244]
F = frames("16x9", pick)
tiles = [lab(cv2.resize(F[i][380:760, 980:1560], None, fx=3, fy=3, interpolation=cv2.INTER_CUBIC)[:900, :1500], f"S4 f{i} 300 %") for i in pick[:6]]
save("s4_lcd_300_a.png", tiles[:3]); save("s4_lcd_300_b.png", tiles[3:6])
F2 = frames("9x16", pick)
tiles = [lab(cv2.resize(F2[i][330:830, 40:700], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), f"M4 f{i} 200 % (720 master = 1.18-1.23x upscale)") for i in pick[:4]]
save("m4_lcd_200.png", [np.hstack(tiles[:2]), np.hstack(tiles[2:4])])
rows = []
for i in (195, 205, 215, 225, 235, 244):
    f = F[i] if i in F else frames("16x9", [i])[i]
    f = f.copy()
    for xr in (0.50, 0.94):
        cv2.line(f, (int(xr * 1920), 0), (int(xr * 1920), 1079), (0, 255, 255), 2)
    rows.append(lab(cv2.resize(f, (960, 540), interpolation=cv2.INTER_AREA), f"S4 f{i}: lines at x 0.50 / 0.94"))
save("s4_frame_x.png", [np.hstack(rows[:2]), np.hstack(rows[2:4]), np.hstack(rows[4:6])])

# ── A10 bezels lifted x6 ──────────────────────────────────────────────────────────────────────
def lift(img, k=6.0):
    return np.clip(img.astype(np.float32) * k, 0, 255).astype(np.uint8)
F = frames("16x9", list(range(0, 75, 7)) + list(range(275, 345, 6)))
# bezel text centre (from the composites' sm_corners, t 0.37-0.56 / 0.40-0.60, d 16-78 / 10-60 below the screen):
# S1 about (1338, 722) at 1080p, S6 about (1378-1391, 720-727); crops cover +-250 x +-60 px around it, at 200 %
rows = [lab(cv2.resize(lift(F[i][650:800, 1088:1588]), None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), f"S1 f{i} bezel x6 200 %") for i in range(0, 75, 7)]
save("bezel_x6_S1.png", rows[:6]); save("bezel_x6_S1b.png", rows[6:])
rows = [lab(cv2.resize(lift(F[i][660:790, 1130:1630]), None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), f"S6 f{i} bezel x6 200 %") for i in range(275, 345, 6)]
save("bezel_x6_S6.png", rows[:6]); save("bezel_x6_S6b.png", rows[6:])

# ── A8 S6 first frames / A12 status bars / G7 seams ───────────────────────────────────────────
F = frames("16x9", range(272, 281))
save("s6_first.png", [np.hstack([lab(cv2.resize(F[i], (640, 360), interpolation=cv2.INTER_AREA), f"f{i}") for i in range(272, 275)]),
                      np.hstack([lab(cv2.resize(F[i], (640, 360), interpolation=cv2.INTER_AREA), f"f{i}") for i in range(275, 278)]),
                      np.hstack([lab(cv2.resize(F[i], (640, 360), interpolation=cv2.INTER_AREA), f"f{i}") for i in range(278, 281)])])
cv2.imwrite(os.path.join(OUT, "s6_f275_100.png"), cv2.cvtColor(F[275][100:760, 860:1860], cv2.COLOR_RGB2BGR))
F = frames("9x16", [30, 160, 280, 300, 330])
crops = {30: (220, 290, 340, 90), 160: (160, 240, 420, 110), 280: (120, 300, 420, 110), 300: (120, 300, 420, 110), 330: (120, 300, 420, 110)}
rows = []
for i, (x, y, w, h) in crops.items():
    rows.append(lab(cv2.resize(F[i][y:y + h, x:x + w], None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC), f"9:16 f{i} 200 %"))
save("statusbars.png", rows)
for o in ("16x9", "9x16"):
    cuts = [75, 125, 195, 245, 275, 345]
    idx = sorted({(c + k) % 345 for c in cuts for k in (-2, -1, 0, 1)})
    F = frames(o, idx)
    tw = 384 if o == "16x9" else 180
    th = round(tw * DIM[o][1] / DIM[o][0])
    rows = []
    for c in cuts:
        rows.append(np.hstack([lab(cv2.resize(F[(c + k) % 345], (tw, th), interpolation=cv2.INTER_AREA), f"f{(c + k) % 345}") for k in (-2, -1, 0, 1)]))
    if o == "16x9":
        save(f"seams_{o}.png", rows)
    else:
        save(f"seams_{o}.png", [np.hstack(rows[:3]), np.hstack(rows[3:])])
json.dump(res, open(os.path.join(OUT, "master_gates.json"), "w"), indent=1)
print("sheets ->", OUT)
