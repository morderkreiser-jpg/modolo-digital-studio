"""Prepare a site capture sequence for screen replacement (MEDIA/v2/a fork of dir-prova prep_site.py).

  python -I prep_site.py <capture frames dir> <outdir> --from 0 --n 75 [--step 1]
         [--chrome HOST] [--toolbar-css 64] [--dpr 2] [--keep-css-h 836] [--crop x,y,w,h] [--out-w W --out-h H]
         [--pad-top-css 47 --statusbar <glyphs.png>]

--statusbar PNG (v2, FILM-HERO-SPEC §1.4/§1.5f) composites a transparent status-bar glyph PNG (time, generic
                signal / wifi / battery, no vendor mark; made by statusbar_t.mjs, 1179x141 = 393x47 css at DPR 3)
                into the top --pad-top-css pad of EVERY frame at the same fixed position, so the clock never
                scrolls with the page. Requires --pad-top-css and a glyph PNG exactly as wide as the frame and as
                tall as the pad. The page pixels below the pad are copied 1:1, never edited.
--pad-from-row R  sample the pad colour from page rows R..R+1 instead of 0..1 (ZüriKey's page has a 1-px grey
                hairline in row 0 at scroll 0 that would otherwise turn the whole pad grey until the page scrolls).

--chrome HOST   draws a minimal GENERIC browser bar above the page (neutral grey dots, no vendor marks, a lock
                glyph and the real host name), then the page rows 0..keep-css-h below it, so the screen shows
                the page the way a laptop browser shows it. The page pixels are copied 1:1, never edited.
--keep-css-h    how many CSS px of the page stay under the bar (BJ: the star row starts at 868 css; ZüriKey:
                the WhatsApp bubble starts at 836 css -> 836 keeps both out).
--crop          plain crop in device px (phones: BJ star tips -> 0,0,1179,2520).
"""
import sys, os, glob
from PIL import Image, ImageDraw, ImageFont

a = sys.argv[1:]
src, out = a[0], a[1]
def opt(k, d):
    if ("--" + k) in a:
        v = a[a.index("--" + k) + 1]
        return type(d)(v) if d is not None else v
    return d
FROM, N, STEP = opt("from", 0), opt("n", 75), opt("step", 1.0)
HOST = opt("chrome", None)
TB, DPR, KEEP = opt("toolbar-css", 64), opt("dpr", 2), opt("keep-css-h", 836)
CROP = opt("crop", None)
PADTOP, OUTH = opt("pad-top-css", 0), opt("out-h", 0)
PADROW = opt("pad-from-row", 0)  # v2: sample the pad colour from rows R..R+1 (0 = dir-prova behaviour)
SB = opt("statusbar", None)
SBIM = Image.open(SB).convert("RGBA") if SB else None
if SBIM is not None and not PADTOP:
    sys.exit("--statusbar needs --pad-top-css (the glyphs live in the phone's status-bar pad)")
os.makedirs(out, exist_ok=True)
files = sorted(glob.glob(os.path.join(src, "f[0-9][0-9][0-9][0-9].png")))
FONT = r"C:\Windows\Fonts\segoeui.ttf"

def toolbar(w, host):
    h = TB * DPR
    bar = Image.new("RGB", (w, h), (236, 233, 228))
    d = ImageDraw.Draw(bar)
    d.line([(0, h - 1), (w, h - 1)], fill=(214, 209, 201), width=max(1, DPR))
    r = 6 * DPR
    for k in range(3):  # neutral window dots (not the coloured vendor ones)
        cx = 22 * DPR + k * 20 * DPR; cy = h // 2
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(204, 199, 191))
    # back / forward chevrons, muted
    cy = h // 2; x0 = 104 * DPR
    for k, sgn in enumerate((-1, 1)):
        cx = x0 + k * 26 * DPR
        d.line([(cx + 4 * DPR * (1 if sgn < 0 else -1), cy - 6 * DPR), (cx - 4 * DPR * (1 if sgn < 0 else -1), cy), (cx + 4 * DPR * (1 if sgn < 0 else -1), cy + 6 * DPR)], fill=(150, 144, 136) if k == 0 else (190, 185, 178), width=2 * DPR, joint="curve")
    # address pill, centred
    pw, ph = 420 * DPR, 36 * DPR
    px0 = (w - pw) // 2; py0 = (h - ph) // 2
    d.rounded_rectangle([px0, py0, px0 + pw, py0 + ph], radius=ph // 2, fill=(250, 249, 247), outline=(222, 217, 210), width=DPR)
    f = ImageFont.truetype(FONT, 15 * DPR)
    tw = d.textlength(host, font=f)
    lock_w = 14 * DPR
    tx = px0 + (pw - tw - lock_w - 6 * DPR) / 2 + lock_w + 6 * DPR
    ty = py0 + (ph - 15 * DPR * 1.33) / 2
    # lock glyph: shackle + body
    lx = tx - 6 * DPR - lock_w; ly = py0 + ph // 2
    d.rounded_rectangle([lx + 2 * DPR, ly - 1 * DPR, lx + 12 * DPR, ly + 7 * DPR], radius=2 * DPR, fill=(110, 104, 97))
    d.arc([lx + 4 * DPR, ly - 7 * DPR, lx + 10 * DPR, ly + 1 * DPR], 180, 360, fill=(110, 104, 97), width=int(1.6 * DPR))
    d.text((tx, ty), host, font=f, fill=(70, 64, 58))
    return bar

for j in range(N):
    k = min(len(files) - 1, int(FROM + round(j * STEP)))
    im = Image.open(files[k]).convert("RGB")
    if CROP:
        x, y, w, h = [int(v) for v in CROP.split(",")]
        im = im.crop((x, y, x + w, y + h))
    if PADTOP:
        # phone safe area: the page starts under the status bar; the bar shows the page's own top colour
        ph = PADTOP * DPR; Ht = OUTH or im.height
        top = im.crop((0, PADROW, im.width, PADROW + 2)).resize((im.width, ph), Image.BILINEAR)
        o = Image.new("RGB", (im.width, Ht)); o.paste(top, (0, 0)); o.paste(im.crop((0, 0, im.width, Ht - ph)), (0, ph))
        if SBIM is not None:
            if SBIM.size != (im.width, ph):
                sys.exit(f"--statusbar {SB} is {SBIM.size}, the pad is {(im.width, ph)}")
            o.paste(SBIM, (0, 0), SBIM)  # fixed position: part of the screen, never scrolls
        im = o
    if HOST:
        W = im.width
        page = im.crop((0, 0, W, KEEP * DPR))
        bar = toolbar(W, HOST)
        o = Image.new("RGB", (W, bar.height + page.height))
        o.paste(bar, (0, 0)); o.paste(page, (0, bar.height))
        im = o
    im.save(os.path.join(out, "f%04d.png" % j), compress_level=1)
print("wrote", N, "frames", im.size, "to", out)
