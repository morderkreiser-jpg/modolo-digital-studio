"""Pin the film v2 masters and tools into the repo (run after every re-render of the masters).

  python -I pin_masters.py [--repo C:/Users/franc/progetti/modolo-digital-studio]

1. copies the text tools and edit lists that made the masters into <repo>/tools/film/v2/ (no media),
2. writes the sha256 of each master, each master report and each copied tool into <repo>/tools/film/shots.json
   (variants.<v>.sha256 and tools_sha256), so build-hero-film.mjs refuses any master that differs (P1).
"""
import sys, os, json, hashlib, shutil

HERE = os.path.dirname(os.path.abspath(__file__))
W = os.path.dirname(HERE)                    # MEDIA/v2/a
MEDIA = os.path.dirname(os.path.dirname(W))   # MEDIA
a = sys.argv[1:]
REPO = a[a.index("--repo") + 1] if "--repo" in a else "C:/Users/franc/progetti/modolo-digital-studio"
SHOTS = os.path.join(REPO, "tools", "film", "shots.json")
DEST = os.path.join(REPO, "tools", "film", "v2")

def sha(p):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

TOOLS = ["cut.py", "screenrep_seq.py", "prep_site.py", "statusbar_notch.mjs", "run_composites.sh", "m6_gates.py", "m6_strips.py",
         "master_gates.py", "encode_crops.py", "pin_masters.py"]
EDITS = ["e169_nozu.json", "e169_zu.json", "e916_nozu.json", "e916_zu.json", "make_edits.py"]
os.makedirs(DEST, exist_ok=True)
cfg = json.load(open(SHOTS, encoding="utf-8"))
tools_sha = {}
for name in TOOLS:
    shutil.copyfile(os.path.join(HERE, name), os.path.join(DEST, name)); tools_sha[name] = sha(os.path.join(DEST, name))
for name in EDITS:
    shutil.copyfile(os.path.join(W, "edit", name), os.path.join(DEST, name)); tools_sha[name] = sha(os.path.join(DEST, name))
cfg["tools_sha256"] = tools_sha
for v, vc in cfg["variants"].items():
    for o, rel in vc["masters"].items():
        p = os.path.join(MEDIA, rel)
        if not os.path.exists(p):
            print("missing", p); continue
        vc["sha256"][o] = sha(p)
        vc["sha256"][o + "_report"] = sha(p + ".report.json")
        print(v, o, vc["sha256"][o][:16], "report", vc["sha256"][o + "_report"][:16])
# text-level update keeps the hand-made layout of shots.json readable: the two "sha256" lines (nozu, then zu) and
# the "tools_sha256" block are rewritten in place
import re
txt = open(SHOTS, encoding="utf-8").read()
lines = []
for v in ("nozu", "zu"):
    s = cfg["variants"][v]["sha256"]
    lines.append('"sha256": { ' + ", ".join(f'"{k}": "{s[k]}"' for k in ("16x9", "9x16", "16x9_report", "9x16_report")) + " }")
it = iter(lines)
txt = re.sub(r'"sha256": \{[^}]*\}', lambda m: next(it), txt, count=2)
tools_block = '"tools_sha256": {\n' + ",\n".join(f'    "{k}": "{v}"' for k, v in tools_sha.items()) + "\n  }"
txt = re.sub(r'"tools_sha256": \{[^}]*\}', lambda m: tools_block, txt, count=1)
json.loads(txt)  # still valid JSON
assert json.loads(txt)["variants"]["nozu"]["sha256"] == cfg["variants"]["nozu"]["sha256"]
open(SHOTS, "w", encoding="utf-8").write(txt)
print("pinned ->", SHOTS, "| tools ->", DEST)
