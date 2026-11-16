"""Film v2 assembler (MEDIA/v2/a fork of dir-prova/tools/cut.py, FILM-HERO-SPEC §1.4): edit list (JSON) ->
graded frames -> lossless RGB master (+ optional H.264 preview, storyboard, sample frames).

  python -I cut.py <edit.json> [<preview.mp4> | -] [--master <file.mkv>] [--storyboard sb.jpg] [--only S1,S3]
                   [--poster poster.png] [--frames-out dir] [--crf 17]

Each shot:
  src   {"type":"frames","dir":D}  composites from screenrep_seq.py (f####.png + optional m####.png site masks)
        {"type":"clip","path":P,"in":T}  a plain clip, read 1:1 (every source frame kept, retimed to 25 fps)
  n     number of output frames
  crop  [x,y,w,h] in SOURCE pixels (may run outside the source: the outside is ink, the source edge is feathered)
        optional "crop_end" [x,y,w,h] -> the crop is interpolated (ease in-out) = a slow push / drift
  feather  px (source px) of soft edge where the source meets ink padding (default 120)
  ev    exposure multiplier on the ENVIRONMENT only (site pixels are never touched)
  sat   saturation for the environment grade (default edit.sat)
  wb    [r,g,b] white balance of the ENVIRONMENT only (v2: the screen branch keeps the un-balanced frame, X6)
  site_gain  0.90-1.00 (default 1.00): uniform multiply of the masked site pixels (dimming only, never a colour)
  falloff {"y0","y1","k"} frame-relative: g(y) = 1 - k*smoothstep(y0, y1, y/H); env = INK + (env - INK)*g
        (a baked «lamp falloff» toward ink; applied before halation, so nothing glows out of the darkened zone)
  vig   vignette strength for this shot (overrides the edit-level value)
  blur  list of rects [x,y,w,h,sigma] in source px. Static (mask feather max(1, sigma/3)) unless the shot has
  track [x,y,w,h] (source px, measured on the shot's FIRST frame): then every blur rect follows the phase
        correlation of the grey track rect against the first frame (Hanning window) and its mask is feathered
        with sigma 6 (as dir-marchio plain.py)
  bezel {"track": npy, "t": [t0,t1], "d": [d0,d1], "sigma": s}: tracked blur of a strip below the screen's
        bottom edge (brand text on a laptop bezel), quad corners from screenrep_seq sm_corners.npy
  label text for the storyboard row
Grade = renderlab post.py «Espresso & Creme» environment grade (site pixels untouched), vignette, falloff,
halation/bloom on the environment only. Grain (edit "grain" > 0) goes only into the preview, NEVER into the master.
Upscale guard: output_w / crop_w > 1.25 on any frame -> exit 1 naming the shot (X17); upscales warp with
INTER_CUBIC, downscales as before.

--master <file.mkv> writes the graded frames without grain as lossless RGB (FFV1 level 3, 8-bit RGB = pix_fmt bgr0:
FFV1 has no 8-bit gbrp; tagged BT.709 primaries/transfer, colorspace gbr, full range) and <file>.report.json with
per-shot statistics (G1-v2 inputs):
  id, t0, t1, frames, scale_min, scale_max, env_mean, env_rb_mid, env_p999_rgb, frame_mean, frame_p995_max,
  frame_p999_max, cool_pct_env (+ per-frame [mean, p99.5, p99.9] luma)
  env = pixels whose site mask < 0.05; rb_mid = mean R-B over env pixels with BT.709 luma 25-140;
  luma = 0.2126 R + 0.7152 G + 0.0722 B on the 8-bit (gamma-encoded) values of the master frame.
"""
import sys, os, json, glob, subprocess, math, hashlib, time
import numpy as np, cv2

a = sys.argv[1:]
EDIT_PATH = a[0]
EDIT = json.load(open(EDIT_PATH, encoding="utf-8"))
OUT = a[1] if len(a) > 1 and not a[1].startswith("--") else "-"
def opt(k, d=None):
    return a[a.index("--" + k) + 1] if ("--" + k) in a else d
SB, ONLY, POSTER, FOUT, MASTER = opt("storyboard"), opt("only"), opt("poster"), opt("frames-out"), opt("master")
W, H = EDIT["size"]; FPS = EDIT.get("fps", 25)
GRAIN = EDIT.get("grain", 0.0); SAT0 = EDIT.get("sat", 0.80); VIG0 = EDIT.get("vig", 0.30)
HAL = EDIT.get("hal", 0.07); BLOOM = EDIT.get("bloom", 0.06)
UPSCALE_MAX = EDIT.get("upscale_max", 1.25)
base = os.path.dirname(os.path.abspath(EDIT_PATH))
def P(p): return p if os.path.isabs(p) else os.path.join(base, p)

INK = np.array([23, 19, 14], np.float32) / 255.0
CREAM = np.array([246, 241, 231], np.float32) / 255.0
LW = np.array([0.2126, 0.7152, 0.0722], np.float32)

def grade(x, expo, sat):
    x = np.clip(x * expo, 0, 1)
    lum = x @ LW
    satk = sat * (0.72 + 0.28 * np.clip(lum * 1.6, 0, 1))[..., None]
    x = lum[..., None] + (x - lum[..., None]) * satk
    x = np.clip(x, 0, 1)
    mx = x.max(-1); mn = x.min(-1); ch = (mx - mn)
    bluish = np.clip((x[..., 2] - np.maximum(x[..., 0], x[..., 1]) * 0.92) / (ch + 1e-4), 0, 1) * np.clip(ch * 6, 0, 1)
    greenish = np.clip((x[..., 1] - np.maximum(x[..., 0], x[..., 2]) * 0.97) / (ch + 1e-4), 0, 1) * np.clip(ch * 6, 0, 1)
    bluish = np.maximum(bluish, greenish)
    l2 = (x @ LW)[..., None]
    x = x + (l2 * np.array([1.04, 1.0, 0.94], np.float32) - x) * (0.85 * bluish)[..., None]
    l3 = (x @ LW)[..., None]
    over = np.clip((x.max(-1, keepdims=True) - 0.9) / 0.1, 0, 1)
    x = x + (np.clip(l3, 0, 1) - x) * 0.5 * over
    s = x * x * (3 - 2 * x)
    x = 0.55 * x + 0.45 * s
    x = np.power(np.clip(x, 0, 1), 1.08)
    lum = (x @ LW)[..., None]
    warm_hi = np.array([1.02, 0.995, 0.955], np.float32); warm_lo = np.array([1.05, 0.985, 0.93], np.float32)
    x = x * (warm_lo + (warm_hi - warm_lo) * lum)
    return INK + (CREAM - INK) * np.clip(x, 0, 1)

yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
R2 = (((xx - W / 2) / (W / 2)) ** 2 + ((yy - H / 2) / (H / 2)) ** 2) / 2.0
_vign_cache = {}
def vignette(v):
    if v not in _vign_cache:
        _vign_cache[v] = (1 - v * np.power(np.clip(R2, 0, 1.5), 1.3))[..., None].astype(np.float32)
    return _vign_cache[v]

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / max(1e-6, (e1 - e0)), 0, 1)
    return t * t * (3 - 2 * t)

_fall_cache = {}
def falloff_gain(fo):
    key = (fo["y0"], fo["y1"], fo["k"])
    if key not in _fall_cache:
        yrel = (np.arange(H, dtype=np.float32) + 0.5) / H
        g = 1.0 - fo["k"] * smoothstep(fo["y0"], fo["y1"], yrel)
        _fall_cache[key] = g.astype(np.float32)[:, None, None]
    return _fall_cache[key]

def grain_field(i):
    g = np.random.default_rng(1000 + i).standard_normal((H, W, 3)).astype(np.float32)
    g[..., 1] = g[..., 0] * 0.8 + g[..., 1] * 0.2; g[..., 2] = g[..., 0] * 0.8 + g[..., 2] * 0.2
    g = cv2.GaussianBlur(g, (0, 0), 0.6)
    return g / (g.std() + 1e-6)

def read_clip(path, t0, n):
    pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path], capture_output=True, text=True).stdout)["streams"][0]
    w, h = pr["width"], pr["height"]
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", "%.3f" % t0, "-i", path, "-frames:v", str(n), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    for _ in range(n):
        buf = proc.stdout.read(w * h * 3)
        if len(buf) < w * h * 3: break
        yield np.frombuffer(buf, np.uint8).reshape(h, w, 3), None
    proc.stdout.close(); proc.wait()

def read_frames(d, n, start=0):
    for i in range(start, start + n):
        f = os.path.join(d, "f%04d.png" % i)
        if not os.path.exists(f):
            sys.exit(f"missing composite frame {f} (a short composite would silently hold its last frame)")
        img = cv2.cvtColor(cv2.imread(f), cv2.COLOR_BGR2RGB)
        mp = os.path.join(d, "m%04d.png" % i)
        m = cv2.imread(mp, cv2.IMREAD_GRAYSCALE) if os.path.exists(mp) else None
        yield img, m

def ease(t): return t * t * (3 - 2 * t)

def frame_crop(img, rect, feather, outw, outh):
    """crop [x,y,w,h] (float, source px; may exceed the source) -> outw x outh, outside = 0 (ink after grade).
    Only the part of the source inside the crop is converted; big downscales are pre-filtered with INTER_AREA;
    upscales (v2) are warped with INTER_CUBIC."""
    h0, w0 = img.shape[:2]
    x, y, w, h = rect
    sx0 = max(0, int(math.floor(x)) - 2); sy0 = max(0, int(math.floor(y)) - 2)
    sx1 = min(w0, int(math.ceil(x + w)) + 2); sy1 = min(h0, int(math.ceil(y + h)) + 2)
    sub = img[sy0:sy1, sx0:sx1].astype(np.float32)
    if feather > 0 and (x < 0 or y < 0 or x + w > w0 or y + h > h0):
        ys = np.arange(sy0, sy1, dtype=np.float32)[:, None]; xs = np.arange(sx0, sx1, dtype=np.float32)[None, :]
        ramp = np.ones((sy1 - sy0, sx1 - sx0), np.float32); F = float(feather)
        if y < 0: ramp *= np.clip((ys + 0.5) / F, 0, 1)
        if y + h > h0: ramp *= np.clip((h0 - ys - 0.5) / F, 0, 1)
        if x < 0: ramp *= np.clip((xs + 0.5) / F, 0, 1)
        if x + w > w0: ramp *= np.clip((w0 - xs - 0.5) / F, 0, 1)
        sub = sub * (ramp[..., None] if sub.ndim == 3 else ramp)
    sx, sy = outw / w, outh / h
    kx = ky = 1.0
    if min(sx, sy) < 0.7:  # pre-filter the downscale (warpAffine has no area filter)
        nw, nh = max(1, int(round(sub.shape[1] * sx))), max(1, int(round(sub.shape[0] * sy)))
        kx, ky = nw / sub.shape[1], nh / sub.shape[0]
        sub = cv2.resize(sub, (nw, nh), interpolation=cv2.INTER_AREA)
    M = np.array([[sx / kx, 0, -(x - sx0) * sx], [0, sy / ky, -(y - sy0) * sy]], np.float64)
    interp = cv2.INTER_CUBIC if min(sx, sy) > 1.0 else cv2.INTER_LINEAR
    return cv2.warpAffine(sub, M, (outw, outh), flags=interp, borderMode=cv2.BORDER_CONSTANT, borderValue=0)

def apply_blur(img, rects):
    """static rects (v1 behaviour): mask feather max(1, sigma/3)."""
    out = img.copy()
    for x, y, w, h, s in rects:
        x, y, w, h = int(x), int(y), int(w), int(h)
        pad = int(3 * s)
        X0, Y0 = max(0, x - pad), max(0, y - pad); X1, Y1 = min(img.shape[1], x + w + pad), min(img.shape[0], y + h + pad)
        reg = img[Y0:Y1, X0:X1].astype(np.float32)
        bl = cv2.GaussianBlur(reg, (0, 0), s)
        m = np.zeros(reg.shape[:2], np.float32); m[y - Y0:y - Y0 + h, x - X0:x - X0 + w] = 1
        m = cv2.GaussianBlur(m, (0, 0), max(1.0, s / 3))[..., None]
        out[Y0:Y1, X0:X1] = np.clip(reg * (1 - m) + bl * m, 0, 255).astype(np.uint8)
    return out

TRACK_FEATHER = 6.0
def apply_tracked_blur(img, rects, dx, dy):
    """rects measured on the shot's first frame, shifted by the tracked (dx, dy); mask feather sigma 6."""
    out = img.astype(np.float32)
    H0, W0 = img.shape[:2]
    for x, y, w, h, s in rects:
        X, Y = x + dx, y + dy
        pad = int(3 * max(s, TRACK_FEATHER)) + 4
        X0, Y0 = max(0, int(math.floor(X)) - pad), max(0, int(math.floor(Y)) - pad)
        X1, Y1 = min(W0, int(math.ceil(X + w)) + pad), min(H0, int(math.ceil(Y + h)) + pad)
        reg = out[Y0:Y1, X0:X1]
        bl = cv2.GaussianBlur(reg, (0, 0), s)
        m = np.zeros(reg.shape[:2], np.float32)
        cv2.rectangle(m, (int(round(X)) - X0, int(round(Y)) - Y0), (int(round(X + w)) - X0, int(round(Y + h)) - Y0), 1.0, -1)
        m = cv2.GaussianBlur(m, (0, 0), TRACK_FEATHER)[..., None]
        out[Y0:Y1, X0:X1] = reg * (1 - m) + bl * m
    return np.clip(out + 0.5, 0, 255).astype(np.uint8)

def apply_bezel(img, q, t, d, sigma):
    """blur a strip below the bottom edge BL->BR of the tracked quad (q = TL,TR,BR,BL)."""
    BL, BR = q[3], q[2]
    e = BR - BL; L = np.linalg.norm(e); u = e / L; nrm = np.array([-u[1], u[0]])
    if nrm[1] < 0: nrm = -nrm
    pts = [BL + u * L * t[0] + nrm * d[0], BL + u * L * t[1] + nrm * d[0], BL + u * L * t[1] + nrm * d[1], BL + u * L * t[0] + nrm * d[1]]
    pts = np.array(pts)
    x0, y0 = np.floor(pts.min(0)).astype(int) - 60; x1, y1 = np.ceil(pts.max(0)).astype(int) + 60
    x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(img.shape[1], x1), min(img.shape[0], y1)
    reg = img[y0:y1, x0:x1].astype(np.float32)
    # blur along the edge direction only (keeps the bezel's top-to-bottom gradient): rotate, 1-D blur, rotate back
    ang = math.degrees(math.atan2(u[1], u[0]))
    c = ((x1 - x0) / 2, (y1 - y0) / 2)
    R = cv2.getRotationMatrix2D(c, ang, 1.0); Ri = cv2.getRotationMatrix2D(c, -ang, 1.0)
    rr = cv2.warpAffine(reg, R, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    k = int(sigma * 3) * 2 + 1
    rr = cv2.GaussianBlur(rr, (k, 1), sigma)
    bl = cv2.warpAffine(rr, Ri, (x1 - x0, y1 - y0), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    m = np.zeros(reg.shape[:2], np.float32)
    cv2.fillPoly(m, [np.round((pts - [x0, y0]) * 4).astype(np.int32)], 1.0, lineType=cv2.LINE_AA, shift=2)
    m = cv2.GaussianBlur(m, (0, 0), 6)[..., None]
    out = img.copy(); out[y0:y1, x0:x1] = np.clip(reg * (1 - m) + bl * m, 0, 255).astype(np.uint8)
    return out

class ShotStats:
    """Accumulates the G1-v2 statistics of one shot on the final 8-bit frames (before grain)."""
    def __init__(self):
        self.n = 0; self.env_sum = 0.0; self.env_cnt = 0; self.rb_sum = 0.0; self.rb_cnt = 0
        self.hist = [np.zeros(256, np.int64) for _ in range(3)]; self.cool = 0
        self.frames = []
    def add(self, o, mm2d):
        f = o.astype(np.float32)
        Y = f @ LW
        env = mm2d < 0.05
        Ye = Y[env]; fe = f[env]
        self.env_sum += float(Ye.sum()); self.env_cnt += int(Ye.size)
        mid = (Ye >= 25) & (Ye <= 140)
        self.rb_sum += float((fe[mid, 0] - fe[mid, 2]).sum()); self.rb_cnt += int(mid.sum())
        oe = o[env]
        for c in range(3): self.hist[c] += np.bincount(oe[:, c], minlength=256)
        self.cool += int(((Ye > 25) & ((fe[:, 2] > fe[:, 0] + 6) | (fe[:, 1] > fe[:, 0] + 6))).sum())
        p995, p999 = np.percentile(Y, [99.5, 99.9])
        self.frames.append([round(float(Y.mean()), 2), round(float(p995), 2), round(float(p999), 2)])
        self.n += 1
    def pct(self, h, q):
        c = np.cumsum(h); t = q * c[-1]
        return int(np.searchsorted(c, t))
    def result(self):
        fr = np.array(self.frames)
        return {
            "env_mean": round(self.env_sum / max(1, self.env_cnt), 2),
            "env_rb_mid": round(self.rb_sum / max(1, self.rb_cnt), 2),
            "env_p999_rgb": [self.pct(h, 0.999) for h in self.hist],
            "frame_mean": round(float(fr[:, 0].mean()), 2),
            "frame_p995_max": round(float(fr[:, 1].max()), 2),
            "frame_p999_max": round(float(fr[:, 2].max()), 2),
            "frame_p999_max_at": int(fr[:, 2].argmax()),
            "cool_pct_env": round(100.0 * self.cool / max(1, self.env_cnt), 3),
            "env_px_share": round(self.env_cnt / max(1, self.n * W * H), 4),
            "per_frame": self.frames,
        }

def render_shot(sh, gi0, sink):
    src = sh["src"]; n = sh["n"]
    feather = sh.get("feather", 120)
    ev = sh.get("ev", 1.0); sat = sh.get("sat", SAT0)
    wb = np.array(sh["wb"], np.float32) if sh.get("wb") else None
    site_gain = float(sh.get("site_gain", 1.0))
    if not (0.90 - 1e-9 <= site_gain <= 1.0 + 1e-9):
        sys.exit(f"{sh['id']}: site_gain {site_gain} outside 0.90-1.00 (dimming only)")
    VIGN = vignette(float(sh.get("vig", VIG0)))
    FALL = falloff_gain(sh["falloff"]) if sh.get("falloff") else None
    rect0 = sh["crop"]; rect1 = sh.get("crop_end", rect0)
    # upscale guard (X17): output_w / crop_w over the whole shot
    scales = []
    for k in range(n):
        tt = ease(k / max(1, n - 1))
        rw = rect0[2] + (rect1[2] - rect0[2]) * tt
        scales.append(W / rw)
    if max(scales) > UPSCALE_MAX + 1e-9:
        print(f"UPSCALE GUARD: shot {sh['id']} scales up {max(scales):.3f}x (> {UPSCALE_MAX}x)", flush=True)
        sys.exit(1)
    track = np.load(P(sh["bezel"]["track"])) if "bezel" in sh else None
    it = read_frames(P(src["dir"]), n, src.get("start", 0)) if src["type"] == "frames" else read_clip(P(src["path"]), src["in"], n)
    trk = sh.get("track"); ref = None; shifts = []
    st = ShotStats()
    frames_kept = []
    count = 0
    for k, (img, m) in enumerate(it):
        if track is not None:
            bz = sh["bezel"]; ti = min(len(track) - 1, k + src.get("start", 0))
            img = apply_bezel(img, track[ti], bz["t"], bz["d"], bz.get("sigma", 28))
        if sh.get("blur"):
            if trk:
                tx, ty, tw, th = trk
                g = cv2.cvtColor(img[ty:ty + th, tx:tx + tw], cv2.COLOR_RGB2GRAY).astype(np.float32)
                if ref is None:
                    ref = g; dx = dy = 0.0
                else:
                    (dx, dy), _ = cv2.phaseCorrelate(ref, g, cv2.createHanningWindow(g.shape[::-1], cv2.CV_32F))
                shifts.append((round(float(dx), 2), round(float(dy), 2)))
                img = apply_tracked_blur(img, sh["blur"], dx, dy)
            else:
                img = apply_blur(img, sh["blur"])
        if sh.get("flip"):
            img = np.ascontiguousarray(img[:, ::-1])
            if m is not None: m = np.ascontiguousarray(m[:, ::-1])
        tt = ease(k / max(1, n - 1))
        rect = [r0 + (r1 - r0) * tt for r0, r1 in zip(rect0, rect1)]
        f = np.clip(frame_crop(img, rect, feather, W, H) / 255.0, 0, 1)
        fe = np.clip(f * wb, 0, 1) if wb is not None else f      # white balance: environment branch only (X6)
        mm2 = np.clip(frame_crop(m.astype(np.float32), rect, 0, W, H) / 255.0, 0, 1) if m is not None else np.zeros((H, W), np.float32)
        mm = mm2[..., None]
        env = grade(fe, ev, sat) * VIGN
        if FALL is not None:
            env = INK + (env - INK) * FALL
        comp = mm * (f * site_gain) + (1 - mm) * env             # screens: un-balanced, un-graded, only dimmed
        if HAL > 0 or BLOOM > 0:
            lum = comp @ LW
            br = np.clip(lum - 0.70, 0, None)[..., None] * comp / np.maximum(lum[..., None], 1e-4)
            small = cv2.resize(br, (W // 4, H // 4), interpolation=cv2.INTER_AREA)
            b1 = cv2.resize(cv2.GaussianBlur(small, (0, 0), 5), (W, H)); b2 = cv2.resize(cv2.GaussianBlur(small, (0, 0), 18), (W, H))
            glow = BLOOM * (0.55 * b1 + 0.45 * b2) + HAL * b1 * np.array([1.0, 0.62, 0.36], np.float32)
            comp = comp + glow * (1 - mm)
        clean = (np.clip(comp, 0, 1) * 255 + 0.5).astype(np.uint8)
        st.add(clean, mm2)
        prev = clean
        if GRAIN > 0:
            lum = np.clip(comp @ LW, 0, 1)[..., None]
            amp = GRAIN * 0.30 * (0.55 + 0.45 * np.sqrt(np.clip(4 * lum * (1 - lum), 0, 1)))
            prev = (np.clip(comp + grain_field(gi0 + k) * amp, 0, 1) * 255 + 0.5).astype(np.uint8)
        sink(clean, prev, k)
        if k in (0, n // 3, (2 * n) // 3, n - 1):
            frames_kept.append((k, prev))
        count += 1
    if count != n:
        sys.exit(f"{sh['id']}: got {count} frames, expected {n}")
    res = st.result()
    res.update({"scale_min": round(min(scales), 4), "scale_max": round(max(scales), 4)})
    if shifts:
        res["track_shift_max"] = [round(max(abs(s[0]) for s in shifts), 2), round(max(abs(s[1]) for s in shifts), 2)]
        res["track_shifts"] = shifts
    return res, frames_kept

shots = EDIT["shots"]
if ONLY: shots = [s for s in shots if s["id"] in ONLY.split(",")]
ff = None
if OUT != "-":
    ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-vf", "scale=out_color_matrix=bt709:out_range=tv:flags=lanczos+accurate_rnd+full_chroma_int,format=yuv420p",
                           "-c:v", "libx264", "-preset", "slow", "-crf", str(opt("crf", EDIT.get("crf", 17))), "-g", "50",
                           "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
                           "-movflags", "+faststart", "-an", OUT], stdin=subprocess.PIPE)
fm = None
if MASTER:
    os.makedirs(os.path.dirname(os.path.abspath(MASTER)), exist_ok=True)
    # FFV1 has no 8-bit gbrp (it would silently become bgr0); bgr0 IS its lossless 8-bit RGB layout. ffmpeg 9 takes
    # the colour tags from the frames, so they are set with setparams (the -color_* options alone are dropped).
    fm = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{W}x{H}", "-r", str(FPS), "-i", "-",
                           "-vf", "setparams=color_primaries=bt709:color_trc=bt709:colorspace=gbr:range=pc",
                           "-c:v", "ffv1", "-level", "3", "-g", "1", "-slices", "16", "-slicecrc", "1", "-pix_fmt", "bgr0",
                           "-fflags", "+bitexact", MASTER], stdin=subprocess.PIPE)
if FOUT: os.makedirs(FOUT, exist_ok=True)
board = []; gi = 0; t = 0.0; report = []
t_start = time.time()
for sh in shots:
    def sink(clean, prev, k, sh=sh, gi=gi):
        if fm: fm.stdin.write(clean.tobytes())
        if ff: ff.stdin.write(prev.tobytes())
        if FOUT and (k == 0 or k == sh["n"] - 1 or k == sh["n"] // 2):
            cv2.imwrite(os.path.join(FOUT, "%s_%03d.png" % (sh["id"], k)), cv2.cvtColor(clean, cv2.COLOR_RGB2BGR))
        if POSTER and gi == 0 and k == 0:
            cv2.imwrite(POSTER, cv2.cvtColor(clean, cv2.COLOR_RGB2BGR))
    res, kept = render_shot(sh, gi, sink)
    entry = {"id": sh["id"], "t0": round(t, 2), "t1": round(t + sh["n"] / FPS, 2), "start_frame": gi, "frames": sh["n"]}
    entry.update(res)
    report.append(entry)
    board.append((sh, [(img, gi + k, (gi + k) / FPS) for k, img in kept], t))
    gi += sh["n"]; t += sh["n"] / FPS
    brief = {k: v for k, v in entry.items() if k not in ("per_frame", "track_shifts")}
    print(sh["id"], sh["n"], "frames", json.dumps(brief), "%.0f s" % (time.time() - t_start), flush=True)
if ff: ff.stdin.close(); ff.wait()
if fm: fm.stdin.close(); fm.wait()
print("rendered", gi, "frames", round(gi / FPS, 2), "s")
def sha_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()
meta = {"edit": os.path.abspath(EDIT_PATH), "edit_sha256": sha_file(EDIT_PATH), "tool_sha256": sha_file(os.path.abspath(__file__)),
        "size": [W, H], "fps": FPS, "frames": gi, "grain_in_master": 0, "shots": report}
if MASTER:
    meta["master"] = os.path.abspath(MASTER)
    json.dump(meta, open(MASTER + ".report.json", "w", encoding="utf-8"), indent=1)
    print("master", MASTER, os.path.getsize(MASTER), "bytes; report", MASTER + ".report.json")
if OUT != "-":
    json.dump(meta, open(os.path.splitext(OUT)[0] + "_report.json", "w", encoding="utf-8"), indent=1)
    print("preview", OUT, os.path.getsize(OUT), "bytes")

if SB:
    from PIL import Image, ImageDraw, ImageFont
    portrait = H > W
    tw = 300 if portrait else 440
    th = int(tw * H / W)
    lab_h = 30; head = 26; gap = 8; side = 290
    try:
        fnt = ImageFont.truetype(r"C:\Windows\Fonts\segoeui.ttf", 15); fntb = ImageFont.truetype(r"C:\Windows\Fonts\segoeuib.ttf", 16)
    except Exception:
        fnt = fntb = ImageFont.load_default()
    rows = len(board)
    S = Image.new("RGB", (side + 4 * (tw + gap), rows * (th + lab_h + gap) + head), (17, 15, 12))
    d = ImageDraw.Draw(S)
    d.text((10, 4), EDIT.get("title", os.path.basename(EDIT_PATH)), font=fntb, fill=(232, 200, 119))
    for r, (sh, picks, t0) in enumerate(board):
        y = head + r * (th + lab_h + gap)
        lines = [sh["id"] + "  " + sh.get("label", ""), "%.2f–%.2f s · %d f" % (t0, t0 + sh["n"] / FPS, sh["n"])] + sh.get("notes", [])
        yy0 = y + 4
        for k2, ln in enumerate(lines):
            words = ln.split(" "); cur = ""
            for wd in words:
                if d.textlength(cur + " " + wd, font=fnt) > side - 16 and cur:
                    d.text((10, yy0), cur, font=fntb if k2 == 0 else fnt, fill=(246, 241, 231) if k2 == 0 else (200, 190, 175)); yy0 += 19; cur = wd
                else:
                    cur = (cur + " " + wd).strip()
            d.text((10, yy0), cur, font=fntb if k2 == 0 else fnt, fill=(246, 241, 231) if k2 == 0 else (200, 190, 175)); yy0 += 21
        for c, (img, fi, ts) in enumerate(picks):
            im = Image.fromarray(img).resize((tw, th), Image.LANCZOS)
            x = side + c * (tw + gap)
            S.paste(im, (x, y))
            d.text((x + 4, y + th + 6), "f%d · %.2f s" % (fi, ts), font=fnt, fill=(232, 200, 119))
    S.save(SB, quality=90)
    print("storyboard", SB, S.size)
