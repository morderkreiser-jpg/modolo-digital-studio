"""Screen replacement onto a real stock plate (laptop / phone with a blank WHITE or GREEN screen).

Per frame: key the blank screen, fit 4 straight edges to the key contour (sub-pixel corners by line
intersection, so rounded panel corners do not bias them), smooth the corners over time, warp the real site
with a per-frame homography, match the plate's edge softness and sensor noise, keep the plate's own
reflections (screen-blend of the residual highlights for green screens), and write
  <out>/f0000.png ... (composite at the output size)   <out>/m0000.png ... (site mask for post.py)

  python -I screenrep.py <plate.mp4> <site.png> <outdir> --start 2.0 --n 90 [--src-fps 30] [--key white|green]
         [--size 1920x1080] [--crop x,y,w,h (in plate pixels, applied before scaling)] [--debug]
Retiming: n source frames are played one-per-output-frame at 25 fps (30 -> 25 fps = 0.83x, smoother than dropping).

dir-prova fork: <site> may be a DIRECTORY of frames f0000.png... (a real capture sequence, e.g. a page that
animates or scrolls); then --site-from K (first frame) and --site-step S (capture frames per plate frame,
default 1.0) pick the frame for each plate frame; the last frame holds if the sequence runs out.
--site-gain G multiplies the site pixels (exposure only, never a colour change; G<=1).

MEDIA/v2/a fork (FILM-HERO-SPEC §1.4). Both additions are OFF by default; without them the output is bit-identical
to dir-prova's tool (verified on all six DP composites, see v2/a/work/*/cmd.txt).
--rigid    phones are rigid planes. Per frame every corner is marked trusted / untrusted:
           untrusted = no usable fit, or within 6 px of the occluder matte, or > 4 px from the temporal prediction
           (median of the trusted values in +-3 frames, linear trend removed). The occluder matte is the key's
           «not screen» class restricted to what can occlude a phone screen: lit, saturated pixels (BT.601 luma >= 30
           and S >= 0.14, opened with a 7 px disc) - the bezel, the notch and the rounded panel corners are dark and
           neutral and would otherwise put every corner «near an occluder». The edge lines themselves are re-fitted
           (seeded with the tracked quad) on contour points >= 8 px away from the matte, so a finger on an edge no
           longer drags the line. Reference r = nearest frame with 4 trusted corners. With 3 trusted corners the 4th
           = A_k . C_r[missing] (A_k the exact affine mapping r's three corners onto this frame's three); when frames
           with 4 trusted corners exist on both sides, the two predictions are blended by time. With < 3
           trusted, all four corners are interpolated linearly between the nearest frames with >= 3 trusted. Then the
           existing Savitzky-Golay pass. Trusted masks and residuals go to track.json.
--sat-key  saturation term in the white key (X4): m = clip((Y - KEYLO)/(KEYHI - KEYLO), 0, 1) *
           clip(1 - (S - 0.08)/0.06, 0, 1), S = (max - min)/max (0 where max = 0); then a 1 px choke (erode) and a
           Gaussian feather sigma 0.7 px, so a lit fingertip is never keyed as screen (no page through the finger).
"""
import sys, os, json, subprocess
import numpy as np, cv2

a = sys.argv[1:]
plate, site, out = a[0], a[1], a[2]
def opt(k, d):
    if ("--" + k) in a:
        v = a[a.index("--" + k) + 1]
        return type(d)(v) if d is not None else v
    return d
START, N, SRCFPS = opt("start", 0.0), opt("n", 90), opt("src-fps", 30.0)
KEY = opt("key", "white")
OW, OH = [int(v) for v in opt("size", "1920x1080").split("x")]
CROP = opt("crop", None)
DEBUG = ("--debug" in a)
SITE_FROM, SITE_STEP, SITE_GAIN = opt("site-from", 0), opt("site-step", 1.0), opt("site-gain", 1.0)
SITE_MAP = json.load(open(opt("site-map", ""))) if opt("site-map", "") else None  # capture frame index per plate frame
KEYLO, KEYHI = opt("key-lo", 70.0), opt("key-hi", 215.0)
NOTCH = ("--notch" in a)
RIGID = ("--rigid" in a)
SATKEY = ("--sat-key" in a)
os.makedirs(out, exist_ok=True)

pr = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", plate], capture_output=True, text=True).stdout)["streams"][0]
PW, PH = pr["width"], pr["height"]
def read_frames():
    proc = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", "%.3f" % START, "-i", plate, "-frames:v", str(N), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
    for i in range(N):
        buf = proc.stdout.read(PW * PH * 3)
        if len(buf) < PW * PH * 3: break
        yield np.frombuffer(buf, np.uint8).reshape(PH, PW, 3)
    proc.stdout.close(); proc.wait()

def lum(img): return img.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)

def satur(img):
    f = img.astype(np.float32); mx = f.max(-1); mn = f.min(-1)
    return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-3), 0.0).astype(np.float32)

def keymask(img):
    f = img.astype(np.float32)
    if KEY == "green":
        g = f[..., 1] - np.maximum(f[..., 0], f[..., 2])
        return np.clip((g - 25) / 60, 0, 1)
    Y = lum(img)
    m = np.clip((Y - KEYLO) / (KEYHI - KEYLO), 0, 1)
    if SATKEY:
        m = m * np.clip(1 - (satur(img) - 0.08) / 0.06, 0, 1)
        m = cv2.erode(m.astype(np.float32), np.ones((3, 3), np.uint8))   # 1 px choke
        m = cv2.GaussianBlur(m, (0, 0), 0.7)                              # 0.7 px feather
    return m

def order(pts):
    pts = np.array(pts, np.float64)
    c = pts.mean(0)
    ang = np.arctan2(pts[:, 1] - c[1], pts[:, 0] - c[0])
    pts = pts[np.argsort(ang)]  # TL, TR, BR, BL after rotation below
    s = pts.sum(1); i0 = np.argmin(s)
    return np.roll(pts, -i0, axis=0)

def white_contour(img):
    b = (lum(img) > 142.5).astype(np.uint8)
    cnts, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    return max(cnts, key=cv2.contourArea) if cnts else None

def detect(img):
    m = keymask(img)
    if KEY == "white":  # detection always at the default level (Y > 142); KEYLO/KEYHI only shape the composite mask
        b = (lum(img) > 142.5).astype(np.uint8)
    else:
        b = (m > 0.5).astype(np.uint8)
    cnts, _ = cv2.findContours(b, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(cnts, key=cv2.contourArea)
    peri = cv2.arcLength(c, True)
    hull = cv2.convexHull(c)
    ap = None
    for eps in (0.01, 0.015, 0.02, 0.03, 0.04, 0.05, 0.065, 0.08):
        cand = cv2.approxPolyDP(hull, eps * peri, True).reshape(-1, 2)
        if len(cand) == 4: ap = cand; break
    if ap is None: return None, m
    q = order(ap)
    # refine: fit a line to the contour points of each edge (middle 80 %), intersect neighbours
    P = c.reshape(-1, 2).astype(np.float64)
    lines = []
    for k in range(4):
        p0, p1 = q[k], q[(k + 1) % 4]
        d = p1 - p0; L = np.linalg.norm(d); u = d / L; nrm = np.array([-u[1], u[0]])
        rel = P - p0
        t = rel @ u; dist = np.abs(rel @ nrm)
        sel = (t > 0.15 * L) & (t < 0.85 * L) & (dist < 45)
        if NOTCH and k == 0:  # phone with a notch: fit the top edge on the two "ears" only
            sel = (((t > 0.08 * L) & (t < 0.22 * L)) | ((t > 0.78 * L) & (t < 0.92 * L))) & (dist < 90)
            above = (rel @ nrm)  # keep the outermost (highest) points of each ear
            if sel.sum() > 40:
                thr = np.percentile(above[sel], 50)
                sel = sel & (above <= thr + 6) if np.mean(above[sel]) < 0 else sel & (above >= thr - 6)
        pts = P[sel].astype(np.float32)
        if len(pts) < 20: return None, m
        vx, vy, x0, y0 = cv2.fitLine(pts, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        for _ in range(3):  # refit on inliers: a notch or a finger on an edge deviates by many px
            nn = np.array([-vy, vx]); dd = np.abs((pts - [x0, y0]) @ nn)
            keep = dd < max(1.5, np.percentile(dd, 60) * 2.5)
            if keep.sum() < 20: break
            vx, vy, x0, y0 = cv2.fitLine(pts[keep], cv2.DIST_L2, 0, 0.01, 0.01).ravel()
        lines.append((np.array([x0, y0]), np.array([vx, vy])))
    out = []
    for k in range(4):
        (a0, da), (b0, db) = lines[(k - 1) % 4], lines[k]
        A = np.array([da, -db]).T
        s = np.linalg.solve(A, b0 - a0)
        out.append(a0 + s[0] * da)
    # contour points sit on the 50 % key level; push the corners half a pixel outward is not needed (key mid-level)
    return np.array(out), m

# ---- --rigid: occluder matte, occlusion-aware edge re-fit -----------------------------------------------------
OCC_LMIN, OCC_SMIN, OCC_NEAR, EDGE_CLEAR, TEMP_TOL = 30.0, 0.14, 6.0, 8.0, 4.0
_open7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
def occ_matte(img):
    """lit, saturated pixels (skin) = what can occlude the screen; the screen, bezel and notch are neutral."""
    occ = ((lum(img) >= OCC_LMIN) & (satur(img) >= OCC_SMIN)).astype(np.uint8)
    return cv2.morphologyEx(occ, cv2.MORPH_OPEN, _open7)

def fit_line(pts):
    vx, vy, x0, y0 = cv2.fitLine(pts.astype(np.float32), cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
    for _ in range(3):
        nn = np.array([-vy, vx]); dd = np.abs((pts - [x0, y0]) @ nn)
        keep = dd < max(1.0, np.percentile(dd, 60) * 2.5)
        if keep.sum() < 20: break
        vx, vy, x0, y0 = cv2.fitLine(pts[keep].astype(np.float32), cv2.DIST_L2, 0, 0.01, 0.01).ravel()
    nn = np.array([-vy, vx]); res = np.abs((pts - [x0, y0]) @ nn)
    return (np.array([x0, y0], np.float64), np.array([vx, vy], np.float64)), float(np.median(res))

def refit(P, Pclear, seed, band):
    """Edge lines from contour points near the seed quad's edges, never from points near an occluder.
    Returns (quad or None, per-edge support [(npts, span)])."""
    lines, sup = [], []
    for k in range(4):
        p0, p1 = seed[k], seed[(k + 1) % 4]
        d = p1 - p0; L = np.linalg.norm(d); u = d / L; nrm = np.array([-u[1], u[0]])
        rel = P - p0; t = rel @ u; dist = rel @ nrm
        if NOTCH and k == 0:
            sel = ((t > 0.11 * L) & (t < 0.21 * L)) | ((t > 0.79 * L) & (t < 0.89 * L))
        else:
            sel = (t > 0.12 * L) & (t < 0.88 * L)
        sel &= (np.abs(dist) < band) & Pclear
        if sel.sum() < 30:
            lines.append(None); sup.append((int(sel.sum()), 0.0)); continue
        ln, _ = fit_line(P[sel])
        lines.append(ln); sup.append((int(sel.sum()), float((t[sel].max() - t[sel].min()) / L)))
    if any(l is None for l in lines): return None, sup
    q = []
    for k in range(4):
        (a0, da), (b0, db) = lines[(k - 1) % 4], lines[k]
        s = np.linalg.solve(np.array([da, -db]).T, b0 - a0)
        q.append(a0 + s[0] * da)
    return np.array(q), sup

corners = []
mid_frame = None
RIG = []  # per frame: (contour points, occluder distance map, roi origin)
for i, f in enumerate(read_frames()):
    q, _ = detect(f)
    corners.append(q)
    if i == N // 2: mid_frame = f.copy()
    if RIGID:
        c = white_contour(f)
        Pc = c.reshape(-1, 2).astype(np.float64)
        x0r, y0r = max(0, int(Pc[:, 0].min()) - 120), max(0, int(Pc[:, 1].min()) - 120)
        x1r, y1r = min(PW, int(Pc[:, 0].max()) + 120), min(PH, int(Pc[:, 1].max()) + 120)
        RIG.append((Pc, occ_matte(f[y0r:y1r, x0r:x1r]), (x0r, y0r)))
N = len(corners)
print("plate frames", N, PW, PH)
ok = [q is not None for q in corners]
print("detected", sum(ok), "of", N)
C = np.array([q if q is not None else np.full((4, 2), np.nan) for q in corners])
RAWDET = C.copy()
rigid_log = None
if RIGID:
    def quad_dt(i, quad, erode=3):
        """distance to the occluder matte restricted to the screen: inside the quad, eroded by 3 px (the warm
        reflections on the bezel just outside the panel are not occluders)."""
        Pc, occ, (x0r, y0r) = RIG[i]
        poly = np.zeros(occ.shape, np.uint8)
        cv2.fillPoly(poly, [np.round((np.asarray(quad) - [x0r, y0r]) * 4).astype(np.int32)], 1, cv2.LINE_8, shift=2)
        if erode: poly = cv2.erode(poly, np.ones((2 * erode + 1, 2 * erode + 1), np.uint8))
        return cv2.distanceTransform((1 - (occ & poly)).astype(np.uint8), cv2.DIST_L2, 5)
    def dt_at(i, pts, dt):
        _, occ, (x0r, y0r) = RIG[i]
        xs = np.clip(np.round(pts[:, 0] - x0r).astype(int), 0, dt.shape[1] - 1)
        ys = np.clip(np.round(pts[:, 1] - y0r).astype(int), 0, dt.shape[0] - 1)
        inside = (pts[:, 0] >= x0r) & (pts[:, 0] < x0r + dt.shape[1]) & (pts[:, 1] >= y0r) & (pts[:, 1] < y0r + dt.shape[0])
        return np.where(inside, dt[ys, xs], 1e6)
    # 1. seeds: raw detections that agree with their neighbours (robust median of +-3 frames, < 8 px)
    med = np.full_like(C, np.nan)
    for i in range(N):
        w = C[max(0, i - 3): i + 4]
        med[i] = np.nanmedian(w, axis=0)
    seed_ok = np.array([ok[i] and np.nanmax(np.linalg.norm(C[i] - med[i], axis=1)) < 8 for i in range(N)])
    if not seed_ok.any(): sys.exit("--rigid: no clean seed frame")
    # 2. occlusion-aware re-fit, tracked outward from the clean seeds (each frame seeded by its neighbour's fit)
    FIT = [None] * N; SUP = [None] * N
    def refit_frame(i, seed):
        Pc = RIG[i][0]
        clear = dt_at(i, Pc, quad_dt(i, seed)) >= EDGE_CLEAR
        q, sup = refit(Pc, clear, seed, 15.0)
        for _ in range(2):
            if q is None: break
            clear = dt_at(i, Pc, quad_dt(i, q)) >= EDGE_CLEAR
            q2, sup2 = refit(Pc, clear, q, 6.0)
            if q2 is None: break
            q, sup = q2, sup2
        return q, sup
    for i in range(N):
        if seed_ok[i]: FIT[i], SUP[i] = refit_frame(i, C[i])
    for sweep in (range(N), range(N - 1, -1, -1)):
        prev = None
        for i in sweep:
            if FIT[i] is not None: prev = FIT[i]; continue
            if prev is None: continue
            FIT[i], SUP[i] = refit_frame(i, prev)
            if FIT[i] is not None: prev = FIT[i]
    F = np.array([q if q is not None else np.full((4, 2), np.nan) for q in FIT])
    # 3. trust: usable fit on both adjacent edges, no occluder within 6 px, within 4 px of the temporal prediction
    trusted = np.zeros((N, 4), bool); occd = np.full((N, 4), np.nan)
    for i in range(N):
        if FIT[i] is None: continue
        dd = dt_at(i, F[i], quad_dt(i, F[i])); occd[i] = dd
        for k in range(4):
            e_prev, e_next = SUP[i][(k - 1) % 4], SUP[i][k]
            good_edges = e_prev[0] >= 30 and e_next[0] >= 30 and e_prev[1] >= 0.15 and e_next[1] >= 0.15
            trusted[i, k] = good_edges and dd[k] > OCC_NEAR
    tempdev = np.zeros((N, 4))
    for _ in range(3):
        newt = trusted.copy()
        for i in range(N):
            for k in range(4):
                if not trusted[i, k]: continue
                js = [j for j in range(max(0, i - 3), min(N, i + 4)) if j != i and trusted[j, k]]
                if len(js) < 2: continue
                tj = np.array(js, np.float64); vj = F[js, k]
                # median of the trusted neighbours after removing the local linear trend (unbiased at the ends)
                A = np.vstack([tj - i, np.ones_like(tj)]).T
                coef, *_ = np.linalg.lstsq(A, vj, rcond=None)
                resid = vj - A @ coef
                pred = coef[1] + np.median(resid, axis=0)
                tempdev[i, k] = float(np.linalg.norm(F[i, k] - pred))
                if tempdev[i, k] > TEMP_TOL: newt[i, k] = False
        if (newt == trusted).all(): break
        trusted = newt
    # 4. rigid fill
    G = F.copy()
    full = [i for i in range(N) if trusted[i].all()]
    if not full:
        for i in range(0, N, 5):
            print("  diag f%02d fit %s sup %s occ %s tdev %s" % (i, None if FIT[i] is None else np.round(F[i], 1).tolist(), SUP[i],
                  np.round(occd[i], 1).tolist(), np.round(tempdev[i], 1).tolist()))
        sys.exit("--rigid: no frame with 4 trusted corners")
    filled_from = [None] * N
    def affine_pred(r, i, idx, miss):
        Aff = cv2.getAffineTransform(F[r][idx].astype(np.float32), F[i][idx].astype(np.float32))
        return Aff @ np.array([F[r][miss][0], F[r][miss][1], 1.0])
    for i in range(N):
        nt = int(trusted[i].sum())
        if nt == 3:
            idx = [k for k in range(4) if trusted[i, k]]; miss = [k for k in range(4) if not trusted[i, k]][0]
            lo = max([j for j in full if j < i], default=None); hi = min([j for j in full if j > i], default=None)
            if lo is not None and hi is not None:
                # references on both sides: blend the two affine predictions by time (cancels the slow
                # perspective drift that a single, distant reference would extrapolate)
                w = (i - lo) / (hi - lo)
                G[i, miss] = (1 - w) * affine_pred(lo, i, idx, miss) + w * affine_pred(hi, i, idx, miss)
                filled_from[i] = ("affine2", lo, hi, miss)
            else:
                r = lo if hi is None else hi
                G[i, miss] = affine_pred(r, i, idx, miss)
                filled_from[i] = ("affine", r, miss)
    ge3 = [i for i in range(N) if trusted[i].sum() >= 3]
    for i in range(N):
        if trusted[i].sum() >= 3: continue
        lo = max([j for j in ge3 if j < i], default=None); hi = min([j for j in ge3 if j > i], default=None)
        if lo is None and hi is None: sys.exit("--rigid: no frame with >= 3 trusted corners")
        if lo is None: G[i] = G[hi]
        elif hi is None: G[i] = G[lo]
        else:
            w = (i - lo) / (hi - lo); G[i] = G[lo] * (1 - w) + G[hi] * w
        filled_from[i] = ("interp", lo, hi)
    rigid_log = {"trusted": trusted.astype(int).tolist(), "occ_dist": np.round(np.nan_to_num(occd, nan=-1), 1).tolist(),
                 "temporal_dev": np.round(tempdev, 2).tolist(), "fit": np.round(np.nan_to_num(F, nan=-1), 3).tolist(),
                 "support": SUP, "filled": filled_from, "seed_ok": seed_ok.astype(int).tolist()}
    print("rigid: seeds", int(seed_ok.sum()), "| frames with 4 / 3 / <3 trusted corners:",
          sum(1 for i in range(N) if trusted[i].sum() == 4), sum(1 for i in range(N) if trusted[i].sum() == 3),
          sum(1 for i in range(N) if trusted[i].sum() < 3))
    for i in range(N):
        if not trusted[i].all():
            print("  f%02d trusted %s occ_dist %s tdev %s %s" % (i, "".join("TL TR BR BL".split()[k] if trusted[i, k] else "--" for k in range(4)),
                  np.round(occd[i], 1).tolist(), np.round(tempdev[i], 1).tolist(), filled_from[i]))
    C = G
# robust temporal fit: Savitzky-Golay (window 7, quadratic) re-fitted 3x, rejecting detections that sit far
# from the fit (a finger on an edge, a hull vertex flipping) -- follows real hand motion without lag
RAWC = C.copy()
kern = np.array([-2, 3, 6, 7, 6, 3, -2], np.float64) / 21.0
def sg_fit(A):
    out = np.empty_like(A)
    idx = np.arange(N)
    for k in range(4):
        for d in range(2):
            s_ = A[:, k, d]; good = ~np.isnan(s_)
            s_ = np.interp(idx, idx[good], s_[good])
            pad = np.pad(s_, (3, 3), mode="reflect", reflect_type="odd")
            out[:, k, d] = np.convolve(pad, kern[::-1], mode="valid")
    return out
work = RAWC.copy()
for thr in (12.0, 7.0, 4.5):
    fit = sg_fit(work)
    dev = np.nanmax(np.linalg.norm(RAWC - fit, axis=2), axis=1)
    work = RAWC.copy(); work[dev > thr] = np.nan
C = sg_fit(work)
print("outlier frames rejected:", int(np.isnan(work[:, 0, 0]).sum()))
if RIGID:
    sgres = np.linalg.norm(RAWC - C, axis=2)
    print("rigid: max |filled track - smoothed| per corner (px):", np.round(sgres.max(0), 2).tolist())
    rigid_log["sg_residual_max"] = np.round(sgres.max(0), 3).tolist()
GROW, GROW_TOP = opt("grow", 0.0), opt("grow-top", 0.0)
UNGROWN = C.copy()
if GROW or GROW_TOP:
    # push every edge outward (top edge by GROW_TOP): the site then covers the plate's bright screen rim
    def grow(q):
        q = np.asarray(q, np.float64); c = q.mean(0); L = []
        for k in range(4):
            p0, p1 = q[k], q[(k + 1) % 4]; d = (p1 - p0) / np.linalg.norm(p1 - p0); n = np.array([d[1], -d[0]])
            if np.dot(n, (p0 + p1) / 2 - c) < 0: n = -n
            off = GROW_TOP if k == 0 else GROW
            L.append((p0 + n * off, d))
        out = []
        for k in range(4):
            (a0, da), (b0, db) = L[(k - 1) % 4], L[k]
            s_ = np.linalg.solve(np.array([da, -db]).T, b0 - a0); out.append(a0 + s_[0] * da)
        return np.array(out)
    C = np.array([grow(q) for q in C])
RAW = np.array([q if q is not None else C[i] for i, q in enumerate(corners)]); np.save(os.path.join(out, "raw_corners.npy"), RAW); np.save(os.path.join(out, "sm_corners.npy"), C)
if RIGID: np.save(os.path.join(out, "ungrown_corners.npy"), UNGROWN)
raw_jitter = np.nanmax(np.abs(np.array([q if q is not None else C[i] for i, q in enumerate(corners)]) - C))
print("corner jitter vs smoothed (px):", round(float(raw_jitter), 3), "corners f0:", C[0].round(1).tolist())

# site texture(s), pre-scaled (INTER_AREA) to ~1.15x the quad size
qw = max(np.linalg.norm(C[:, 1] - C[:, 0], axis=1).max(), np.linalg.norm(C[:, 2] - C[:, 3], axis=1).max())
qh = max(np.linalg.norm(C[:, 3] - C[:, 0], axis=1).max(), np.linalg.norm(C[:, 2] - C[:, 1], axis=1).max())
import glob as _glob
if os.path.isdir(site):
    SITE_FILES = sorted(_glob.glob(os.path.join(site, "f[0-9][0-9][0-9][0-9].png")))
else:
    SITE_FILES = [site]
_cache = {}
def site_tex(i):
    if SITE_MAP is not None and len(SITE_FILES) > 1:
        k = int(SITE_MAP[min(i, len(SITE_MAP) - 1)])
    else:
        k = min(len(SITE_FILES) - 1, int(SITE_FROM + round(i * SITE_STEP))) if len(SITE_FILES) > 1 else 0
    if k in _cache: return _cache[k]
    S0 = cv2.cvtColor(cv2.imread(SITE_FILES[k]), cv2.COLOR_BGR2RGB)
    sc = min(1.0, 1.15 * qw / S0.shape[1])
    S1 = cv2.resize(S0, (round(S0.shape[1] * sc), round(S0.shape[0] * sc)), interpolation=cv2.INTER_AREA)
    if SITE_GAIN != 1.0: S1 = np.clip(S1.astype(np.float32) * SITE_GAIN, 0, 255).astype(np.uint8)
    _cache.clear(); _cache[k] = S1
    return S1
S = site_tex(0); sh, sw = S.shape[:2]
print("quad", round(qw), "x", round(qh), "site tex", sw, sh, "aspect quad", round(qw / qh, 4), "site", round(sw / sh, 4), "frames", len(SITE_FILES))

# edge softness of the plate: 10-90 % rise width across the top edge (sub-pixel profile)
def edge_sigma(img, q):
    Y = lum(img)
    p0, p1 = (q[3], q[0]) if NOTCH else (q[0], q[1])  # phones: the top edge crosses the notch, use the left edge
    xs = np.linspace(0.3, 0.7, 9)
    widths = []
    for t in xs:
        p = p0 + (p1 - p0) * t
        d = p1 - p0; nrm = np.array([d[1], -d[0]]) / np.linalg.norm(d)  # pointing outwards (up / left)
        prof = []
        for s in np.linspace(-8, 8, 161):
            x, y = p + nrm * s
            prof.append(cv2.getRectSubPix(Y, (1, 1), (float(x), float(y)))[0, 0])
        prof = np.array(prof)
        lo, hi = prof.min(), prof.max()
        n = (prof - lo) / max(1e-3, hi - lo)
        i10 = np.argmin(np.abs(n - 0.9)); i90 = np.argmin(np.abs(n - 0.1))
        widths.append(abs(i90 - i10) * 0.1)
    w = float(np.median(widths))
    return w / 2.563, w  # gaussian sigma from 10-90 % width
sig, w1090 = edge_sigma(mid_frame, C[N // 2])
if opt("sigma", -1.0) >= 0: sig = opt("sigma", -1.0)
print("plate edge 10-90 %% width %.2f px -> sigma %.2f px" % (w1090, sig))

# sensor noise of the plate: std of the high-pass in a flat dark region (below-left of the screen)
def noise_std(img):
    Y = lum(img)
    hp = Y - cv2.GaussianBlur(Y, (0, 0), 2.0)
    h, w = Y.shape
    reg = hp[int(h * 0.06):int(h * 0.30), int(w * 0.02):int(w * 0.18)]
    return float(reg.std())
nstd = noise_std(mid_frame)
print("plate noise std (8-bit, high-pass):", round(nstd, 2))

rng = np.random.default_rng(7)
dbg = []
for i, f in enumerate(read_frames()):
    q = C[i].astype(np.float32)
    S = site_tex(i); sh, sw = S.shape[:2]
    src = np.array([[0, 0], [sw, 0], [sw, sh], [0, sh]], np.float32)
    Hm = cv2.getPerspectiveTransform(src, q)
    MARG = 260 if KEY == "green" else 24   # green: room for despill on the hand around the screen
    x0, y0 = np.floor(q.min(0)).astype(int) - MARG; x1, y1 = np.ceil(q.max(0)).astype(int) + MARG
    x0, y0 = max(0, x0), max(0, y0); x1, y1 = min(PW, x1), min(PH, y1)
    T = np.array([[1, 0, -x0], [0, 1, -y0], [0, 0, 1]], np.float64) @ Hm
    warped = cv2.warpPerspective(S, T, (x1 - x0, y1 - y0), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE).astype(np.float32)
    # match the plate's optics: same edge softness (the plate edge already includes lens + compression)
    if sig > 0.35: warped = cv2.GaussianBlur(warped, (0, 0), max(0.0, (sig ** 2 - 0.35 ** 2)) ** 0.5)
    # match sensor noise (luma-correlated, a touch of chroma)
    if nstd > 0.2:
        g = rng.standard_normal(warped.shape[:2]).astype(np.float32)
        g = cv2.GaussianBlur(g, (0, 0), 0.7); g /= (g.std() + 1e-6)
        warped += (g * nstd * 0.9)[..., None]
    # mask = the plate's own key (exact panel shape incl. rounded corners and real edge softness), inside the quad
    km = keymask(f[y0:y1, x0:x1])
    poly = np.zeros((y1 - y0, x1 - x0), np.uint8)
    cv2.fillPoly(poly, [np.round((q - [x0, y0]) * 4).astype(np.int32)], 255, lineType=cv2.LINE_AA, shift=2)
    poly = cv2.dilate(poly, np.ones((7, 7), np.uint8)).astype(np.float32) / 255
    m = (km * poly)[..., None]
    region = f[y0:y1, x0:x1].astype(np.float32)
    if KEY == "green":
        # keep the plate's real reflections: residual luminance above the smooth key colour, screen-blended
        Y = lum(f[y0:y1, x0:x1]); base = cv2.GaussianBlur(Y, (0, 0), 25)
        refl = np.clip(Y - base, 0, None)[..., None] / 255
        warped = 255 - (255 - warped) * (1 - refl * 0.8)
    if KEY == "green":
        r_, g_, b_ = region[..., 0], region[..., 1], region[..., 2]
        # skin / metal near a green screen: cap green at the warmer of (R - 12) and the R/B average + 8
        lim = np.maximum(np.minimum(r_ - 12, 0.5 * (r_ + b_) + 8), b_)
        spill = np.clip(g_ - lim, 0, None)
        near = cv2.GaussianBlur(poly, (0, 0), 260) if poly.max() > 0 else poly
        region = region.copy(); region[..., 1] = g_ - spill * np.clip(near * 4, 0, 1)
    comp = region * (1 - m) + warped * m
    full = f.copy()
    full[y0:y1, x0:x1] = np.clip(comp + 0.5, 0, 255).astype(np.uint8)
    mfull = np.zeros((PH, PW), np.float32); mfull[y0:y1, x0:x1] = m[..., 0]
    if CROP:
        cx, cy, cw, ch = [int(v) for v in CROP.split(",")]
        full = full[cy:cy + ch, cx:cx + cw]; mfull = mfull[cy:cy + ch, cx:cx + cw]
    o = cv2.resize(full, (OW, OH), interpolation=cv2.INTER_AREA)
    mo = cv2.resize(mfull, (OW, OH), interpolation=cv2.INTER_AREA)
    cv2.imwrite(os.path.join(out, "f%04d.png" % i), cv2.cvtColor(o, cv2.COLOR_RGB2BGR), [cv2.IMWRITE_PNG_COMPRESSION, 1])
    cv2.imwrite(os.path.join(out, "m%04d.png" % i), np.clip(mo * 255 + 0.5, 0, 255).astype(np.uint8))
    if DEBUG and i in (0, N // 2):
        d = f.copy()
        for k in range(4):
            cv2.circle(d, tuple(np.round(q[k]).astype(int)), 6, (255, 0, 0), 2)
        cv2.imwrite(os.path.join(out, "dbg_corners_%04d.jpg" % i), cv2.cvtColor(d, cv2.COLOR_RGB2BGR))
tj = {"corners": C.round(3).tolist(), "edge_sigma": sig, "noise_std": nstd, "site": site, "plate": plate, "start": START, "n": N}
if RIGID or SATKEY:
    tj.update({"rigid": rigid_log, "sat_key": SATKEY, "argv": a})
json.dump(tj, open(os.path.join(out, "track.json"), "w"))
print("wrote", N, "frames to", out)
