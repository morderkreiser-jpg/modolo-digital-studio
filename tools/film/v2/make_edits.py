"""Writes the four film v2 edit lists (FILM-HERO-SPEC §1.2) next to this file:
  e169_nozu.json  e169_zu.json  e916_nozu.json  e916_zu.json
One source of truth for the shared shots, so the variants can only differ in S3/M3.
Crops are in source/work pixels exactly as in dir-prova (16:9 composites 3840x2160, 9:16 composites 1080x1920).
The S1/S3/S6/M1/M3/M6 crops are Francesco's approved framing: never change them.

  python -I make_edits.py
"""
import json, os, copy

HERE = os.path.dirname(os.path.abspath(__file__))
PX854136 = "../../pexels/v1copy/854136/854136.mp4"
PX9218101 = "../../pexels/clips/9218101/9218101.mp4"
PX8774518 = "../../pexels/clips/8774518/8774518.mp4"

# S4/M4 camera (§1.5c): tracked rects measured on the window's FIRST frame (9218101 @ 1.13 s), source px,
# checked at 150-300 % on frames 0/12/20/25/35/40/49 (MEDIA/v2/a/look/s4/rects_tracked2.png).
S4_TRACK = [740, 350, 260, 170]           # eyecup + hot shoe: tracked, never blurred
S4_BLUR = [
    [650, 445, 50, 50, 6],                # MICRO (Four Thirds) mark on the top plate
    [634, 532, 376, 56, 3.5],             # LCD top strip: battery, Wi-Fi, level meter, 17mm, dot
    [634, 560, 52, 166, 3.5],             # LCD left column: mode label, bottom-left icon
    [938, 580, 68, 200, 4.5],             # LCD right column: flash, ISO AUTO, C-AF, RAW, FHD 30p
    [634, 743, 376, 90, 5.0],             # LCD bottom strip: icon row, histogram, 1:42:04 (sigma 3.5 left a «1:42:04»-shaped smudge on M4 at 300 %)
]

def e169(variant):
    s3dir = "../work/s3d_bj_prices" if variant == "nozu" else "../work/s3e_zu_phone"
    return {
        "title": f"film v2 · 16:9 master 1920x1080 · variant {variant} · 345 f = 13.8 s · 25 fps · hard cuts",
        "fps": 25, "size": [1920, 1080], "grain": 0, "sat": 0.80, "hal": 0.07, "bloom": 0.06, "vig": 0.30,
        "upscale_max": 1.25,
        "shots": [
            {"id": "S1", "label": "PROOF · BJ Studio on a laptop (poster)", "notes": ["Pexels 6279145 (Artem Podrez) 0.40 s +75 f", "capture bj-d14-hold (no hover, no click), gain 0.965"],
             "src": {"type": "frames", "dir": "../work/s1h_bj_laptop"}, "n": 75,
             "crop": [-180, 40, 3840, 2160], "crop_end": [-150, 60, 3780, 2126], "feather": 160, "ev": 0.92, "sat": 0.80,
             "bezel": {"track": "../work/s1h_bj_laptop/sm_corners.npy", "t": [0.37, 0.56], "d": [16, 78], "sigma": 30}},
            {"id": "S2", "label": "HOW · a hand sketches a phone page", "notes": ["Pexels 854136 (Coverr) 12.60 s +50 f", "lamp falloff toward ink hides the nails"],
             "src": {"type": "clip", "path": PX854136, "in": 12.60}, "n": 50,
             "crop": [0, 140, 1670, 939], "crop_end": [30, 160, 1610, 905], "feather": 120, "ev": 0.66, "sat": 0.72,
             "wb": [1.04, 1.0, 0.92], "falloff": {"y0": 0.5556, "y1": 0.7569, "k": 0.97}},
            {"id": "S3", "label": ("PROOF · BJ Studio's price list on a phone" if variant == "nozu" else "PROOF · ZUMOVE on a phone"),
             "notes": ["Pexels 6279154 (Artem Podrez) 4.00 s +70 f", ("capture bj-ph-s1 f40, composite gain 0.95" if variant == "nozu" else "capture zu-ph-hold f75+")],
             "src": {"type": "frames", "dir": s3dir}, "n": 70,
             "crop": [438, 413, 2648, 1490], "crop_end": [470, 430, 2580, 1451], "feather": 120, "ev": 0.95, "sat": 0.70,
             "wb": [0.97, 1.0, 1.03], "site_gain": 0.98 if variant == "nozu" else 1.0},
            {"id": "S4", "label": "HOW · a camera takes the photo (placeholder)", "notes": ["Pexels 9218101 (PNW Production) 1.13 s +50 f", "tracked blur: LCD overlays + mark only"],
             "src": {"type": "clip", "path": PX9218101, "in": 1.13}, "n": 50,
             "crop": [-560, -90, 2240, 1260], "crop_end": [-520, -70, 2160, 1215], "feather": 240, "ev": 0.58, "sat": 0.90,
             "wb": [1.10, 1.0, 0.84], "vig": 0.30, "track": S4_TRACK, "blur": S4_BLUR},
            {"id": "S5", "label": "HOW · one key, struck", "notes": ["Pexels 8774518 (PureRaw) 6.30 s +30 f"],
             "src": {"type": "clip", "path": PX8774518, "in": 6.30}, "n": 30,
             "crop": [-600, 0, 3840, 2160], "crop_end": [-560, 24, 3770, 2121], "feather": 240, "ev": 1.0, "sat": 0.80},
            {"id": "S6", "label": "PROOF · ZüriKey loads (his own web app)", "notes": ["Pexels 6279143 (Artem Podrez) 1.00 s +70 f", "zk-d14-intro frames 6..72 (+72 held x3), gain 0.95"],
             "src": {"type": "frames", "dir": "../work/s6b_zk_pov"}, "n": 70,
             "crop": [-860, -60, 4000, 2250], "crop_end": [-800, -30, 3880, 2183], "feather": 220, "ev": 0.92, "sat": 0.93,
             "wb": [1.11, 1.0, 0.86],   # G1 tuning: start wb [1.07,1,0.90] sat 0.85 gave R-B 25.5; this is the allowed maximum (28.5)
             "bezel": {"track": "../work/s6b_zk_pov/sm_corners.npy", "t": [0.40, 0.60], "d": [10, 60], "sigma": 30}},
        ],
    }

def e916(variant):
    s3dir = "../work/s3d_bj_prices" if variant == "nozu" else "../work/s3e_zu_phone"
    return {
        "title": f"film v2 · 9:16 master 720x1280 · variant {variant} · same cut list, phone-first framing",
        "fps": 25, "size": [720, 1280], "grain": 0, "sat": 0.80, "hal": 0.07, "bloom": 0.06, "vig": 0.26,
        "upscale_max": 1.25,
        "shots": [
            {"id": "M1", "label": "PROOF · BJ Studio on a phone (poster)", "notes": ["Pexels 6279146 (Artem Podrez) 3.00 s +75 f", "bj-ph-hold + status bar 21:04"],
             "src": {"type": "frames", "dir": "../work/m1b_bj_phone"}, "n": 75,
             "crop": [0, 0, 1080, 1920], "crop_end": [27, 30, 1026, 1824], "feather": 120, "ev": 0.72, "sat": 0.78},  # G1 tuning: sat 0.80 gave R-B 52.4 (> 52)
            {"id": "M2", "label": "HOW · sketch", "notes": ["854136 12.60 s, lamp falloff toward ink"],
             "src": {"type": "clip", "path": PX854136, "in": 12.60}, "n": 50,
             "crop": [868, 190, 608, 1080], "crop_end": [880, 205, 584, 1038], "feather": 90, "ev": 0.62, "sat": 0.72,
             "wb": [1.04, 1.0, 0.92], "falloff": {"y0": 0.4688, "y1": 0.6016, "k": 0.97}},
            {"id": "M3", "label": ("PROOF · BJ Studio's price list on a phone" if variant == "nozu" else "PROOF · ZUMOVE on a phone"),
             "notes": ["6279154 4.00 s", ("bj-ph-s1 f40 + 21:07" if variant == "nozu" else "zu-ph-hold f75+ + 21:07")],
             "src": {"type": "frames", "dir": s3dir}, "n": 70,
             "crop": [1865, 300, 900, 1600], "crop_end": [1880, 320, 870, 1547], "feather": 120, "ev": 0.72 if variant == "nozu" else 0.78, "sat": 0.70,
             # G1 tuning: nozu frame mean 100.6 (> 95) at gain 0.947 / ev 0.78 -> gain 0.90 / ev 0.72 = 94.99 (both at the allowed limit);
             # zu frame p99.9 253 (> 241) at gain 1.0 -> 0.95 = 241.0
             "wb": [0.97, 1.0, 1.03], "site_gain": 0.90 if variant == "nozu" else 0.95},
            {"id": "M4", "label": "HOW · camera (placeholder)", "notes": ["9218101 1.13 s, tracked blur: LCD overlays + mark only"],
             "src": {"type": "clip", "path": PX9218101, "in": 1.13}, "n": 50,
             "crop": [540, 150, 608, 1080], "crop_end": [552, 170, 584, 1038], "feather": 90, "ev": 0.66, "sat": 0.90,
             "wb": [1.10, 1.0, 0.84], "track": S4_TRACK, "blur": S4_BLUR},
            {"id": "M5", "label": "HOW · key strike", "notes": ["8774518 6.30 s"],
             "src": {"type": "clip", "path": PX8774518, "in": 6.30}, "n": 30,
             "crop": [1350, 330, 1215, 2160], "crop_end": [1380, 360, 1160, 2062], "feather": 160, "ev": 1.0, "sat": 0.80},
            {"id": "M6", "label": "PROOF · ZüriKey, a finger flicks the page", "notes": ["Pexels 6279147 (Artem Podrez) 2.20 s +70 f", "rigid corners, saturation key, status bar 21:11"],
             "src": {"type": "frames", "dir": "../work/m6b_zk_phone"}, "n": 70,
             "crop": [90, 160, 900, 1600], "crop_end": [105, 180, 870, 1547], "feather": 120, "ev": 0.74, "sat": 0.80,
             "site_gain": 1.0},
        ],
    }

if __name__ == "__main__":
    for name, e in (("e169_nozu", e169("nozu")), ("e169_zu", e169("zu")), ("e916_nozu", e916("nozu")), ("e916_zu", e916("zu"))):
        assert sum(s["n"] for s in e["shots"]) == 345, name
        with open(os.path.join(HERE, name + ".json"), "w", encoding="utf-8") as fh:
            json.dump(e, fh, indent=1, ensure_ascii=False)
        print("wrote", name + ".json")
