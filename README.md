# NAMURA Wine Studio

A production pipeline for a cinematic **9:16 luxury product film** for **NAMURA (נמורה) – חקלאות גלילית**,
featuring the three 2023 wines **הרועה (HAROEH)**, **הלל (HILLEL)** and **עברי (IVRI)**.

Final deliverable: `output/NAMURA_Reel_1080x1920.mp4` (20 s, 1080×1920, 30 fps, H.264 High, AAC 320 k, −14 LUFS).

---

## Production approach (why this stack)

The environment this was built in has **no GPU** (4 CPU cores) and no system Blender.

| Option | Measured | Verdict |
|---|---|---|
| Blender 5.2 Cycles (`bpy` from PyPI), CPU | ~22 s/frame at 1080×1920 for a *trivial* scene, 24 spp | Photoreal, but a full 20 s film with set + volumetrics would be 8 h+ per iteration |
| Generative AI video | — | Cannot guarantee the Hebrew labels stay letter-perfect; paid APIs not used |
| **Three.js (WebGL2) in headless Chromium → FFmpeg** | ~15 s/frame at 1080×1920 *including* 4–5× motion-blur sub-frames, DOF, bloom | **Chosen**: physically-based shading, full art-direction control, deterministic, fast iteration, resolution-independent |

Product fidelity is solved *before* rendering: the labels are not redrawn. They are extracted from the original
photos and wrapped on 3D bottles, so every Hebrew glyph comes from the real label.

## Pipeline

```
reference/originals/*.jpg ──► pipeline/assets/extract_labels.py ──► studio/public/textures/*_albedo|pbr|bump
                         (cylindrical unwrap, shading removal,      (photo-accurate PBR label maps,
                          glyph-mask re-sharpening, gold-foil masks)  gold foil = real metal in 3D)
pipeline/assets/make_set_textures.py ──► stone, plaster, vine-leaf gobo
studio/src (Three.js) ──► pipeline/render/render.mjs ──► PNG frames ──► pipeline/render/encode.sh ──► MP4
pipeline/audio/score.py ──► build/audio/namura_score.wav ─────────────────────────┘
```

### 1. Label extraction (`pipeline/assets/extract_labels.py`, `label_specs.json`)
- **Cylindrical unwrap**: each label is resampled with `x = xc + R·sinθ`, `y = y_side(v) + sag(v)·cosθ + roll(v)·sinθ`.
  The sag/roll control points were fitted on the label edges and printed horizontal lines in the photo.
- **Shading removal**: the photo's lighting fall-off across the cylinder is measured on flat paper rows and divided out,
  so the 3D lights can relight the label.
- **Glyph rebuild at 3× resolution**: gold foil and printed type are classified (k-means in Lab). The soft photographed
  stroke is inpainted away, and the *same glyph shape* is composited back with a crisp anti-aliased edge.
- **Clean brand mark**: glare on the HAROEH and IVRI photos damaged the NAMURA mark. The identical mark from the HILLEL
  photo, which is clean, is registered into their logo boxes, split into mark + tagline and measured per label.
- **Wrap-around**: the label is extended round the bottle with a *de-texted* mirror of the background, so no mirrored type appears.
- Outputs per wine: `albedo` (sRGB), `pbr` (G = roughness, B = foil metalness), `bump` (HILLEL leaf emboss, paper grain, raised foil).
  Also `namura_logo.png`, the clean foil mark used on the end card.

### 2. 3D studio (`studio/src`)
- `bottles.js`: lathe-turned Bordeaux bottles (75 mm), proportions measured from the collection photo. Includes a black foil
  capsule (HAROEH glossy, IVRI matte) and HILLEL's hand-dipped wax seal with an irregular drip edge. The dark glass has a
  thin **backlit garnet rim** (wine glowing at grazing angles). Gold foil gets a true metallic gold F0.
- `environment.js`: a virtual product-photography environment for reflections, with strip softboxes, a warm key panel
  and back rims. Also a stone plinth, a cellar wall with a **vine-leaf gobo** shadow, spot/area light rig, and volumetric
  light beams with drifting dust noise.
- `post.js`: the cinematic image pipeline:
  - jittered sub-frames over a 180° shutter (real motion blur + anti-aliasing)
  - depth haze and single-pass bokeh depth of field (thin-lens CoC, rack focus)
  - shot transitions (whip-pan smear, light reveal, dissolve)
  - mip-chain bloom, anamorphic streak and chromatic aberration
  - ACES filmic tone curve, warm split-tone grade, vignette, film grain and dither
- `particles.js`: gold dust motes with their own bokeh, brighter inside the light beams.
- `titles.js`: minimal typography in display space. Hebrew reveals **right-to-left**, and the gold has a moving foil sheen.
  Fonts are Frank Ruhl Libre (Hebrew) and Cormorant Garamond (Latin), both OFL.
- `timeline.js`: the shot list. **Edit this to re-cut the film.**

### 3. Sound (`pipeline/audio/score.py`)
Fully synthesised and picture-locked:
- warm string-pad progression: Dm(add9) → B♭maj7 → F/A → montage pulse at 0.7 s beats → A sus/A build → **D major (add9)** resolution
- felt-piano motifs
- sub-drop cinematic hits on the reveals
- spectral whooshes on the whip pans
- inharmonic glass "tings" on foil glints, and a bell sparkle on the logo
- a generated stereo hall reverb

No samples, no licensing issues.

## Shot list (20 s)

| Time | Shot |
|---|---|
| 0.0–3.0 | Macro on HILLEL: rack focus from gold dust to the hot-stamped NAMURA mark, light sweep over the foil and leaf emboss |
| 3.0–6.0 | HILLEL hero reveal: pull-back and rise, top beam ignites, garnet backlight, title **הלל** |
| 6.0–8.0 | Whip to HAROEH: crane up from the stone, warm sweep across the shepherd label, title **הרועה** |
| 8.0–10.0 | Whip to IVRI: orbit in through a raking side beam, title **עברי** |
| 10.0–15.0 | Montage on 0.7 s beats: shepherd illustration · IVRI foil glint · HILLEL shoulder reflections · HAROEH capsule · IVRI type rack-focus · HILLEL wax seal · HILLEL vintage box |
| 15.0–20.0 | The collection, HAROEH · **HILLEL (centre)** · IVRI: pull back into the hero frame, NAMURA gold mark + NAMURA wordmark, fade for a clean loop |

## Running it

```bash
# one-time setup
uv venv -p python3.13 .venv && uv pip install -p .venv/bin/python bpy numpy pillow opencv-python-headless scipy   # bpy optional
npm install
# (Playwright + Chromium must be available; set NODE_PATH to where `playwright` is installed if it's global)

npm run labels                                   # extract label textures from reference/originals
.venv/bin/python pipeline/assets/make_set_textures.py
npm run audio                                    # synthesise the score
npm run build                                    # build the Three.js studio

# look-dev
npm run dev   # then open  http://localhost:5173/?t=4.6&w=540&h=960   (single still)
              #            http://localhost:5173/?play&preview&w=270&h=480
node pipeline/render/render.mjs --w 540 --h 960 --times 1.2,4.6,18.5 --out build/stills
node pipeline/render/render.mjs --w 540 --h 960 --times 7 --q 'rig={"gobo":200,"key":0}'   # light override

# final
node pipeline/render/render.mjs --w 1080 --h 1920 --out build/frames_1080x1920     # resumable: --from N --to M
bash pipeline/render/encode.sh build/frames_1080x1920 output/NAMURA_Reel_1080x1920.mp4
```

### Native 4K
Everything is resolution-independent. All blur and bokeh sizes are authored at 1080p and scaled. On a machine with
a GPU (where WebGL is hardware accelerated), a native 2160×3840 master takes minutes:

```bash
node pipeline/render/render.mjs --w 2160 --h 3840 --out build/frames_4k
bash pipeline/render/encode.sh build/frames_4k output/NAMURA_Reel_2160x3840.mp4
```
On the CPU-only build machine this would take roughly 10–12 h, so the delivered master is native 1080×1920.
Instagram Reels plays back at 1080×1920. `encode.sh ... 30 --upscale4k` can make a Lanczos-upscaled 4K file
for platforms that prefer 4K uploads.

## Notes on product accuracy
- The **original photos** are the source of truth for all label content. Style references were used only for mood and lighting.
- The edited IVRI style reference (`reference/style/ivri_style.png`) contains a typo: **"ובדברה"** instead of the correct
  **"וברברה"** (Barbera) printed on the real label. The film uses the real label.
- The HILLEL varietal is not printed on its front label, so no varietal is shown for it.
