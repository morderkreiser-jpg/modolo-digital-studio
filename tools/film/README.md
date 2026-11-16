# Hero film tooling (film v2 «PROVA»)

Everything that makes the homepage film: his real websites (BJ Studio, ZüriKey; ZUMOVE only after Marco's written OK)
on laptops and phones in one warm room, with stock hands that sketch, photograph and type. 13.8 s loop, 25 fps,
345 frames, hard cuts, one timeline for 16:9 and 9:16.

The raw footage is NOT in this repository (the repo is public, and re-publishing unaltered stock clips is not
allowed). It lives in `C:\Users\franc\progetti\modolo-media-src\` (called MEDIA below). Only the final, graded,
compressed files of the published variant go to `public/film/`. ZUMOVE renders never enter the repository.

## How the film is made (two stages)

| Stage | Where | What |
|---|---|---|
| 1. Look | MEDIA `v2\a\` | Live-site captures → site textures (`tools\prep_site.py`, status bars from `tools\statusbar_notch.mjs`) → screen replacement on the stock plates (`tools\screenrep_seq.py`, commands in `work\<shot>\cmd.txt`, all of them in `tools\run_composites.sh`) → grade, lamp falloff, tracked blurs, edit (`tools\cut.py` + `edit\*.json`) → two **lossless masters** per variant (`masters\<variant>\master-{16x9,9x16}.mkv`, FFV1 RGB, BT.709) with a statistics report each. |
| 2. Ship | this repo | `build-hero-film.mjs` checks the masters, encodes, cuts posters, publishes `public/film/*` and rewrites `lib/film-media.ts`. It never grades anything. |

Copies of every stage-1 tool and edit list are in `tools/film/v2/` (text only; their sha256 are in `shots.json`).

| File | What it does |
|---|---|
| `shots.json` | The film: timeline (6 shots, which site each one shows), plates and their authors, capture dates, the masters of each variant and their sha256, encode settings and budgets, poster settings, G1 gates and the documented G1 exceptions. |
| `build-hero-film.mjs` | Builds the shipped set from the masters: checks P1–P5, 6 videos (AV1 + H.264), 6 posters, grain tile, `lib/film-media.ts`, `MEDIA\build\report.json`. |
| `check-hero-film.mjs` | On the running page: plays, pauses, reduced motion / Save-Data, keyboard, the live credit follows the film frame by frame (G8), hosts named in the hero (G8b), every credited site answers 200 (G9). |
| `export-layers.mjs`, `contrast-gate.py` | Gate G3: text contrast over every frame of the film on the built page (credit lit and dim), left scrim. |
| `band-check.mjs` | Gate G4: on phones, does each shot show its subject between the title and the credit? |
| `film-strips.py` | Contact sheets for checking by eye (shots, seams, every frame of a shot, stability). |
| `v2/` | Stage-1 tools and edit lists (provenance). |

## Rebuild

1. If a site changed (or a capture is older than 90 days, the build refuses that): re-capture it with
   `MEDIA\v2\tools\capture.mjs`, re-run its line of `MEDIA\v2\a\tools\run_composites.sh` and update the capture date
   in `shots.json` → `captures`.
2. Masters (MEDIA, about 6 min for all four, in parallel):
   ```
   cd C:\Users\franc\progetti\modolo-media-src\v2\a
   python -I edit\make_edits.py
   python -I tools\cut.py edit\e169_nozu.json - --master masters\nozu\master-16x9.mkv --storyboard out\storyboard-16x9-nozu.jpg
   python -I tools\cut.py edit\e916_nozu.json - --master masters\nozu\master-9x16.mkv --storyboard out\storyboard-9x16-nozu.jpg
   (the same with _zu for the ZUMOVE variant)
   python -I tools\master_gates.py nozu        (nails, S4 blur, bezels, status bars, seams: LOOK at out\gates-nozu\)
   python -I tools\pin_masters.py              (writes the masters' sha256 + copies the tools into tools/film/v2)
   ```
3. Ship (about 6 min):
   ```
   node tools/film/build-hero-film.mjs --src C:\Users\franc\progetti\modolo-media-src
   ```
   It stops (exit 1) when a master is not the pinned one, when a G1 value is outside its band (apart from the
   documented `g1_exceptions`), when a credited website does not answer 200, when a capture is older than 90 days,
   when a file is over its budget at its highest allowed CRF, when a poster differs from the video's first frame, or
   when ZUMOVE would be published without Marco's OK. Old film files in `public/film/` are removed automatically;
   `lib/film-media.ts` is rewritten (never edit it by hand).
4. Page checks (dev server or `next start`):
   ```
   node tools/film/check-hero-film.mjs --base http://localhost:3420
   node tools/film/export-layers.mjs --base http://localhost:3420
   python -I tools/film/contrast-gate.py
   node tools/film/band-check.mjs --base http://localhost:3420
   python -I tools/film/film-strips.py C:\Users\franc\progetti\modolo-media-src shots --src shipped
   ```
5. Once a month: `node tools/film/check-hero-film.mjs --only G9` (a credited site that went down must leave the film:
   set `live: false` in `data/projects.ts` and rebuild).

## Switching to the film with ZUMOVE (after Marco's written OK)

Nothing about ZUMOVE can reach the site by accident: the build refuses `--variant zu` unless both conditions hold, the
page itself refuses to build if the manifest shows ZUMOVE while `data/projects.ts` still has the `approval` flag, and
the check script fails on any `-zu-` file in `public/film`.

1. Keep Marco's written OK (e-mail or signed note) with the client file.
2. In `data/projects.ts` remove `approval: "NEEDS_MARCO_OK"` from ZUMOVE (and decide how section 01 shows it).
3. Run
   ```
   node tools/film/build-hero-film.mjs --src C:\Users\franc\progetti\modolo-media-src --variant zu --zumove-ok 2026-12-01
   ```
   (the date of his OK). The credit, its screen-reader sentence and the Impressum pick up zumove.ch from
   `lib/film-media.ts` by themselves; their strings already exist.
4. Run the page checks above.

Before the OK, a review copy can be built outside the repo only:
`node tools/film/build-hero-film.mjs --variant zu --preview-out C:\Users\franc\progetti\modolo-media-src\v2\a\preview\zu`.

## Putting in your own Canon R5 II take (S4 camera, S2 sketch)

S4 (a camera takes the photo) and S2 (a hand sketches a phone page) are stock placeholders. Your own takes make the
film truer: then the hands may really be yours.

**Before filming.** Written consent from every shop owner whose shop or hands appear; no faces; no shop names you can
read unless the shop is a client who agrees. For S4: switch the camera's screen overlays off with INFO, so nothing has
to be blurred.

**Camera.** 4K UHD, 25p (PAL), shutter 1/50, manual ISO and white balance, warm lamp light (evening room, like the
other shots), tripod, IBIS on, manual focus, picture style Neutral (not Canon Log). Film horizontally with the subject
right of centre (the text sits on the left) and room above and below, so a vertical slice still works on phones.
Every take 10–12 s: 2 s still, the action, 2 s still. Three takes.

- **S4:** your hands holding a camera, photographing a real client's shop or product on a «Google-Profil vor Ort»
  visit; cut on the shutter (the screen blacks out).
- **S2:** your hand sketching BJ Studio's price-list page on paper, phone outline with a notch (it cuts to the real
  phone in S3).

**Swapping it in.**
1. Copy the clip to `MEDIA\own\<yyyy-mm-dd>-<what>\` and the consent PDFs to `MEDIA\own\<...>\consent\`.
2. In `MEDIA\v2\a\edit\make_edits.py` change the S4 (and M4) entry: `"src": {"type": "clip", "path":
   "../../own/<...>/C0012.MP4", "in": <second where the 2 s window starts>}`, a new `crop` (16:9: the camera at
   x 0.52–0.92 of the frame, no upscale above 1.25×; 9:16: the camera and the LCD in the upper half), `ev` so that G1
   passes, and remove `track` / `blur` (nothing to hide). Keep `n` (50 frames) so the timeline stays 13.8 s.
3. In `tools/film/shots.json` change the S4 `plates` to an own id (for example `"own-2027-03-04-camera"`) and add it
   under `plates` with `"author": "Francesco Modolo", "source": "own"`. Credits and the Impressum follow by themselves.
4. Re-render the masters, run `master_gates.py`, `pin_masters.py`, the build and the page checks (steps 2–4 above).

Never mirror a shot that contains writing, and never use blur to hide something readable that is the subject: choose a
different moment or a different take.
