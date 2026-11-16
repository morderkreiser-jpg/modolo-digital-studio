"""M6 (ZüriKey on the flicked phone) numeric gates, FILM-HERO-SPEC §1.5e / A6 / A7.

  python -I m6_gates.py [workdir=work/m6b_zk_phone] [out.json]

Per plate frame 0..69 (= loop f275..f344), measured on the PLATE (6279147 @ 2.20 s) against the final corner track:
  angle   |angle(page top edge) - angle(bezel inner top edge)|  (deg). Page top edge = the quad's TL->TR (grow does not
          change angles). Bezel inner top edge = a line fitted to sub-pixel 50 % crossings of luma profiles across the
          real panel edge on the two ears (t 0.12-0.20 and 0.80-0.88), skipping profiles near skin.
  edge    distance between the page edge (un-grown quad edges) and the real panel edge, per edge the median of the
          signed sub-pixel offsets, reported in OUTPUT px of the 720x1280 master (plate px * 0.5 * 720/crop_w).
  wedge   plate-screen pixels left visible: inside the plate's blank screen (luma key >= 0.9, eroded 3 px), outside
          the finger matte (skin: BT.601 luma >= 30 and S >= 0.14, opened 7 px, dilated 7 px so the finger's soft ~6-px
          edge, which the saturation key chokes by design, counts as finger), where the composite site mask m < 0.5
          (at composite resolution 1080x1920).
  finger  composite site mask inside hand-drawn finger polygons (plate frames 5, 7, 40): max must be <= 0.05.
Pass: angle <= 0.5 deg, edge <= 0.5 px, wedge = 0 px, finger <= 0.05, on every frame.
"""
import sys, os, json, subprocess, math
import numpy as np, cv2

WD = sys.argv[1] if len(sys.argv) > 1 else "work/m6b_zk_phone"
OUTJ = sys.argv[2] if len(sys.argv) > 2 else "out/m6_gates.json"
PLATE, START, NF = "../pexels/clips/6279147/6279147.mp4", 2.2, 70
PW, PH = 2160, 3840
CROP0, CROP1 = [90, 160, 900, 1600], [105, 180, 870, 1547]   # M6 crop in the 9:16 edit (composite px)
KEYLO, KEYHI = 50.0, 160.0
FINGER = {   # plate px, inside the finger with a margin, only where it covers the screen (look/finger_f05/07/40.png)
    5: [(1190, 2445), (1300, 2492), (1400, 2562), (1478, 2622), (1478, 2722), (1435, 2722), (1345, 2650), (1255, 2560), (1195, 2490)],
    7: [(1190, 2445), (1300, 2492), (1400, 2562), (1478, 2622), (1478, 2722), (1435, 2722), (1345, 2650), (1255, 2560), (1195, 2490)],
    40: [(1350, 1285), (1400, 1300), (1480, 1335), (1482, 1495), (1460, 1468), (1405, 1408), (1362, 1352), (1345, 1315)],
}
def lum(f): return f.astype(np.float32) @ np.array([0.299, 0.587, 0.114], np.float32)
def satur(f):
    x = f.astype(np.float32); mx = x.max(-1); mn = x.min(-1)
    return np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-3), 0.0)
def ease(t): return t * t * (3 - 2 * t)

UG = np.load(os.path.join(WD, "ungrown_corners.npy"))
SM = np.load(os.path.join(WD, "sm_corners.npy"))
open7 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
p = subprocess.Popen(["ffmpeg", "-v", "error", "-ss", "%.3f" % START, "-i", PLATE, "-frames:v", str(NF), "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
rows = []
for i in range(NF):
    f = np.frombuffer(p.stdout.read(PW * PH * 3), np.uint8).reshape(PH, PW, 3)
    q = UG[i]
    x0, y0 = max(0, int(q[:, 0].min()) - 80), max(0, int(q[:, 1].min()) - 80)
    x1, y1 = min(PW, int(q[:, 0].max()) + 80), min(PH, int(q[:, 1].max()) + 80)
    R = f[y0:y1, x0:x1]
    Y = lum(R)
    skin = cv2.morphologyEx(((Y >= 30) & (satur(R) >= 0.14)).astype(np.uint8), cv2.MORPH_OPEN, open7)
    skin_dt = cv2.distanceTransform((1 - skin).astype(np.uint8), cv2.DIST_L2, 5)
    Yb = cv2.GaussianBlur(Y, (0, 0), 0.6)
    def profile_offset(pt, nout):
        """signed offset (px, + = outward) of the 50 % crossing along the outward normal, or None"""
        ss = np.linspace(-10, 10, 201)
        xs = pt[0] - x0 + nout[0] * ss; ys = pt[1] - y0 + nout[1] * ss
        if xs.min() < 1 or ys.min() < 1 or xs.max() > Y.shape[1] - 2 or ys.max() > Y.shape[0] - 2: return None
        prof = cv2.remap(Yb, xs.astype(np.float32)[None, :], ys.astype(np.float32)[None, :], cv2.INTER_LINEAR)[0]
        inner, outer = np.median(prof[:40]), np.median(prof[-40:])
        if inner < 170 or outer > 90: return None
        mid = 0.5 * (inner + outer)
        k = np.where((prof[:-1] >= mid) & (prof[1:] < mid))[0]
        if len(k) != 1: return None
        k = k[0]; a, b = prof[k], prof[k + 1]
        return float(ss[k] + (a - mid) / (a - b) * (ss[1] - ss[0]))
    c = q.mean(0)
    edges = {}
    top_pts = []
    for k, name in enumerate(("top", "right", "bottom", "left")):
        P0, P1 = q[k], q[(k + 1) % 4]
        d = P1 - P0; L = np.linalg.norm(d); u = d / L; n = np.array([-u[1], u[0]])
        if np.dot(n, (P0 + P1) / 2 - c) < 0: n = -n
        ts = np.r_[np.arange(0.12, 0.201, 0.005), np.arange(0.80, 0.881, 0.005)] if name == "top" else np.arange(0.15, 0.851, 0.01)
        offs = []
        for t in ts:
            pt = P0 + d * t
            if skin_dt[int(pt[1] - y0), int(pt[0] - x0)] < 14: continue
            o = profile_offset(pt, n)
            if o is None: continue
            offs.append(o)
            if name == "top": top_pts.append(pt + n * o)
        edges[name] = (np.array(offs), len(ts))
    # bezel top edge angle from the measured points vs the quad's top edge angle
    ang_err = None
    if len(top_pts) >= 10:
        tp = np.array(top_pts, np.float32)
        vx, vy, _, _ = cv2.fitLine(tp, cv2.DIST_HUBER, 0, 0.01, 0.01).ravel()
        a_meas = math.degrees(math.atan2(vy, vx)); a_quad = math.degrees(math.atan2(q[1][1] - q[0][1], q[1][0] - q[0][0]))
        ang_err = abs(((a_meas - a_quad + 90) % 180) - 90)
    tt = ease(i / 69)
    cw = CROP0[2] + (CROP1[2] - CROP0[2]) * tt
    sc = 0.5 * 720.0 / cw
    edge_px = {nm: (round(float(np.median(v)) * sc, 3) if len(v) >= 5 else None, len(v), tot) for nm, (v, tot) in edges.items()}
    # wedge: plate screen left visible (composite mask < 0.5) outside the finger
    full = np.zeros((PH, PW), np.float32); full[y0:y1, x0:x1] = np.clip((Y - KEYLO) / (KEYHI - KEYLO), 0, 1)
    # finger matte = skin plus its soft edge (the plate's finger edge is ~6 px wide; the key chokes it by design)
    skinf = np.zeros((PH, PW), np.uint8); skinf[y0:y1, x0:x1] = cv2.dilate(skin, np.ones((15, 15), np.uint8))
    scr = cv2.erode((full >= 0.9).astype(np.uint8), np.ones((7, 7), np.uint8))
    scr_c = cv2.resize(scr.astype(np.float32), (1080, 1920), interpolation=cv2.INTER_AREA) >= 0.999
    skin_c = cv2.resize(skinf.astype(np.float32), (1080, 1920), interpolation=cv2.INTER_AREA) > 0
    m = cv2.imread(os.path.join(WD, "m%04d.png" % i), cv2.IMREAD_GRAYSCALE).astype(np.float32) / 255
    wmask = scr_c & ~skin_c & (m < 0.5)
    wedge = int(wmask.sum())
    row = {"frame": i, "loop": 275 + i, "angle_deg": None if ang_err is None else round(ang_err, 3), "top_pts": len(top_pts),
           "edge_out_px": edge_px, "wedge_px": wedge}
    if wedge:
        skin_raw_c = cv2.resize(skinf.astype(np.float32), (1080, 1920), interpolation=cv2.INTER_AREA) > 0
        sdt = cv2.distanceTransform((1 - skin_raw_c).astype(np.uint8), cv2.DIST_L2, 5)
        ys, xs = np.where(wmask)
        row["wedge_where"] = [[int(x), int(y), round(float(m[y, x]), 2), round(float(sdt[y, x]), 1)] for x, y in zip(xs[:12], ys[:12])]
    if i in FINGER:
        poly = np.zeros((1920, 1080), np.uint8)
        cv2.fillPoly(poly, [np.round(np.array(FINGER[i], np.float32) * 0.5 * 4).astype(np.int32)], 1, cv2.LINE_8, shift=2)
        pp = np.zeros((PH, PW), np.uint8); cv2.fillPoly(pp, [np.array(FINGER[i], np.int32)], 1)
        Yf = lum(f)[pp > 0]; Sf = satur(f)[pp > 0]
        row["finger"] = {"mask_max": round(float(m[poly > 0].max()), 4), "mask_mean": round(float(m[poly > 0].mean()), 4),
                         "poly_px_plate": int(pp.sum()), "poly_screenlike_share": round(float(((Yf > 200) & (Sf < 0.08)).mean()), 4)}
    rows.append(row)
p.kill()
angs = [r["angle_deg"] for r in rows if r["angle_deg"] is not None]
edge_all = [abs(v[0]) for r in rows for v in r["edge_out_px"].values() if v[0] is not None]
worst_edge = max(((abs(v[0]), r["frame"], nm) for r in rows for nm, v in r["edge_out_px"].items() if v[0] is not None))
fing = {r["frame"]: r["finger"] for r in rows if "finger" in r}
summary = {
    "angle_max_deg": round(max(angs), 3), "angle_frames_measured": len(angs),
    "angle_worst_frame": max(rows, key=lambda r: r["angle_deg"] or -1)["frame"],
    "edge_max_out_px": round(worst_edge[0], 3), "edge_worst": [worst_edge[1], worst_edge[2]],
    "wedge_px_max": max(r["wedge_px"] for r in rows), "wedge_frames": [r["frame"] for r in rows if r["wedge_px"] > 0],
    "finger": fing,
}
summary["pass"] = {"angle": summary["angle_max_deg"] <= 0.5, "edge": summary["edge_max_out_px"] <= 0.5,
                   "wedge": summary["wedge_px_max"] == 0, "finger": all(v["mask_max"] <= 0.05 for v in fing.values())}
os.makedirs(os.path.dirname(OUTJ) or ".", exist_ok=True)
json.dump({"summary": summary, "frames": rows}, open(OUTJ, "w"), indent=1)
print(json.dumps(summary, indent=1))
for r in rows:
    print("f%02d L%d ang %s top %d edges %s wedge %d %s" % (r["frame"], r["loop"], r["angle_deg"], r["top_pts"],
          {k: v[0] for k, v in r["edge_out_px"].items()}, r["wedge_px"], r.get("finger", "")))
