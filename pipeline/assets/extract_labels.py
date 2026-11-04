"""
NAMURA Wine Studio - label texture extraction.

Turns the ORIGINAL product photos (reference/originals/*.jpg) into flat,
production-ready PBR label textures that are wrapped onto the 3D bottles.

Nothing on the labels is redrawn or re-typeset: every glyph, line and
illustration comes from the photo pixels.  The pipeline only

  1. un-wraps the cylindrical label (perspective sag + roll corrected),
  2. removes the photo's baked-in shading (so the 3D lights can relight it),
  3. mirror-extends the label edges around the back of the bottle,
  4. re-sharpens gold foil and printed type: the soft photo glyph is used as
     a mask, the original stroke is inpainted away and the exact same glyph
     shape is re-composited with a crisp anti-aliased edge (3x resolution),
  5. writes maps:  <name>_albedo.png  (sRGB colour)
                   <name>_pbr.png     (G = roughness, B = metalness/foil)
                   <name>_bump.png    (paper emboss / grain height)

Usage:  python pipeline/assets/extract_labels.py [--debug]
"""
import json, sys, os
import numpy as np
import cv2

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SPEC = json.load(open(os.path.join(ROOT, 'pipeline/assets/label_specs.json')))
OUT = os.path.join(ROOT, 'studio/public/textures')
DEBUG = '--debug' in sys.argv
DBG = os.environ.get('DEBUG_DIR', os.path.join(ROOT, 'build/debug'))


def interp_ctrl(ctrl, v, key):
    vs = np.array([c['v'] for c in ctrl]); ks = np.array([c[key] for c in ctrl])
    return np.interp(v, vs, ks)


def unwrap(spec, W, H):
    img = cv2.imread(os.path.join(ROOT, spec['photo']))
    th = np.radians(spec['theta_photo'])
    u = np.linspace(-th, th, W)[None, :]
    v = np.linspace(0, 1, H)[:, None]
    t, b = spec['top'], spec['bottom']
    lerp = lambda k: t[k] * (1 - v) + b[k] * v
    sag = interp_ctrl(spec['ctrl'], v, 'b')
    roll = interp_ctrl(spec['ctrl'], v, 'tilt')
    x = lerp('xc') + lerp('R') * np.sin(u)
    y = lerp('ys') + sag * np.cos(u) + roll * np.sin(u)
    out = cv2.remap(img, x.astype(np.float32), y.astype(np.float32), cv2.INTER_LANCZOS4,
                    borderMode=cv2.BORDER_REFLECT)
    return out.astype(np.float32) / 255.0


def region_mask(shape, rects):
    H, W = shape[:2]; m = np.zeros((H, W), np.float32)
    for (x0, x1, v0, v1) in rects:  # x in [-1,1] (theta / theta_photo), v in [0,1]
        m[int(v0 * H):int(v1 * H), int((x0 + 1) / 2 * W):int((x1 + 1) / 2 * W)] = 1
    return m


def flatten_shading(img, spec):
    """Divide out the horizontal lighting falloff measured on flat paper rows."""
    H, W = img.shape[:2]
    lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    rows = np.zeros(H, bool)
    for v0, v1 in spec['flat_rows']:
        rows[int(v0 * H):int(v1 * H)] = True
    prof = np.median(lum[rows], axis=0)
    xs = np.linspace(-1, 1, W)
    p = np.polyfit(xs, np.log(np.maximum(prof, 1e-3)), 4)
    fit = np.exp(np.polyval(p, xs))
    ref = np.exp(np.polyval(p, 0.0)) * spec.get('exposure', 1.0)
    gain = np.clip(ref / fit, 0.75, 1.6)[None, :, None]
    out = img * gain
    # vertical falloff (optional)
    if spec.get('flatten_vertical'):
        vp = np.median(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY), axis=1)
        ys = np.linspace(0, 1, H)
        q = np.polyfit(ys, np.log(np.maximum(vp, 1e-3)), 2)
        f = np.exp(np.polyval(q, ys)); out = out * np.clip(np.median(f) / f, 0.8, 1.25)[:, None, None]
    return np.clip(out, 0, 1).astype(np.float32)


def two_class(img_lab, mask, prefer):
    """k-means (k=2) inside mask; returns (fg_center, bg_center) in Lab."""
    pts = img_lab[mask > 0.5].reshape(-1, 3).astype(np.float32)
    if len(pts) > 60000:
        pts = pts[np.random.default_rng(1).choice(len(pts), 60000, replace=False)]
    crit = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 50, 0.1)
    _, lab, cen = cv2.kmeans(pts, 2, None, crit, 4, cv2.KMEANS_PP_CENTERS)
    counts = np.bincount(lab.ravel(), minlength=2)
    if prefer == 'light':
        fg = int(np.argmax(cen[:, 0] + 0.6 * cen[:, 2]))
    elif prefer == 'dark':
        fg = int(np.argmin(cen[:, 0]))
    else:  # 'gold': most yellow
        fg = int(np.argmax(cen[:, 2] + 0.3 * cen[:, 0]))
    return cen[fg], cen[1 - fg], counts


def glyph_score(img_lab, fg, bg):
    d = fg - bg
    s = ((img_lab - bg) @ d) / (d @ d)
    return s.astype(np.float32)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def rebuild_glyphs(img, spec, scale, ref_logo=None):
    """Crisp re-composite of gold foil + printed text, using the photo glyphs as masks."""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)
    foil = np.zeros(img.shape[:2], np.float32)
    out = img.copy(); bgclean = img.copy()
    for g in spec['glyphs']:
        reg = region_mask(img.shape, [g['rect']])
        fg, bg, _ = two_class(lab, reg, g['kind'])
        s = glyph_score(lab, fg, bg)
        s = cv2.GaussianBlur(s, (0, 0), g.get('blur', 0.6) * scale)
        thr = g.get('thr', 0.45); w = g.get('soft', 0.10)
        m = smoothstep(thr - w, thr + w, s) * reg
        if g['kind'] == 'gold':  # glare on the foil reads as holes -> fill small enclosed gaps
            inv = (m < 0.5).astype(np.uint8)
            n, lbl, st, _ = cv2.connectedComponentsWithStats(inv, 4)
            holes = np.isin(lbl, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] < g.get('hole_area', 90) * scale * scale])
            m = np.maximum(m, cv2.GaussianBlur(holes.astype(np.float32), (0, 0), 0.6))
        if g.get('logo_bbox') and ref_logo is not None:
            bb = g['logo_bbox']
            if bb == 'auto':  # the label's own (glare-damaged) mark is good enough to locate the parts
                bb = auto_logo_bbox(m, img.shape)
            m = register_logo(ref_logo, img.shape, bb)
        if g.get('logo_out'):
            LOGO_CACHE['mask'] = (m * region_mask(img.shape, [g['logo_out']])).astype(np.float32)
        if g.get('min_area'):  # drop speckles (e.g. dark illustration strokes near black type)
            n, lbl, st, _ = cv2.connectedComponentsWithStats((m > 0.5).astype(np.uint8), 8)
            keep = np.isin(lbl, [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] >= g['min_area'] * scale * scale])
            m = m * cv2.dilate(keep.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
        # remove the soft original stroke (incl. halo) and re-composite crisp glyph
        halo = cv2.dilate(((smoothstep(0.18, 0.3, s) * reg > 0.5) & (cv2.dilate((m > 0.05).astype(np.uint8), np.ones((int(3 * scale) | 1,) * 2, np.uint8)) > 0)).astype(np.uint8),
                          np.ones((int(g.get('halo', 2) * scale) | 1,) * 2, np.uint8))
        u8 = (np.clip(out, 0, 1) * 255).astype(np.uint8)
        clean = cv2.inpaint(u8, halo, int(3 * scale), cv2.INPAINT_TELEA).astype(np.float32) / 255
        bgclean = cv2.inpaint((np.clip(bgclean, 0, 1) * 255).astype(np.uint8), halo, int(3 * scale),
                              cv2.INPAINT_TELEA).astype(np.float32) / 255
        col = np.median(out[m > 0.9], axis=0) if (m > 0.9).any() else out.mean((0, 1))
        if g['kind'] == 'gold':
            col = np.array(spec['foil_bgr'], np.float32)
        out = clean * (1 - m[..., None]) + col[None, None] * m[..., None]
        if g['kind'] == 'gold':
            foil = np.maximum(foil, m)
    return np.clip(out, 0, 1).astype(np.float32), foil, np.clip(bgclean, 0, 1).astype(np.float32)


LOGO_CACHE = {}


def _place(ref, shape, bbox):
    ys, xs = np.where(ref > 0.5)
    rx0, rx1, ry0, ry1 = xs.min(), xs.max(), ys.min(), ys.max()
    H, W = shape[:2]
    tx0, tx1 = (bbox[0] + 1) / 2 * W, (bbox[1] + 1) / 2 * W
    ty0, ty1 = bbox[2] * H, bbox[3] * H
    sx = (tx1 - tx0) / (rx1 - rx0); sy = (ty1 - ty0) / (ry1 - ry0)
    M = np.array([[sx, 0, tx0 - sx * rx0], [0, sy, ty0 - sy * ry0]], np.float32)
    print('  reference logo part placed, scale %.3f x %.3f' % (sx, sy))
    return np.clip(cv2.warpAffine(ref, M, (W, H), flags=cv2.INTER_CUBIC), 0, 1)


def split_logo(ref):
    rows = (ref > 0.5).any(1); ys = np.where(rows)[0]
    gaps = []; start = None
    for y in range(ys.min(), ys.max()):
        if not rows[y] and start is None: start = y
        if rows[y] and start is not None: gaps.append((y - start, start, y)); start = None
    _, g0, g1 = [g for g in gaps if g[0] >= 6][-1]  # lowest clear gap = name / tagline
    cut = (g0 + g1) // 2
    top = ref.copy(); top[cut:] = 0
    bot = ref.copy(); bot[:cut] = 0
    return top, bot


def auto_logo_bbox(m, shape):
    H, W = shape[:2]; out = []
    for part in split_logo(m):
        n, lbl, st, _ = cv2.connectedComponentsWithStats((part > 0.5).astype(np.uint8), 8)
        big = [i for i in range(1, n) if st[i, cv2.CC_STAT_AREA] > 40]
        x0 = min(st[i, 0] for i in big); y0 = min(st[i, 1] for i in big)
        x1 = max(st[i, 0] + st[i, 2] for i in big); y1 = max(st[i, 1] + st[i, 3] for i in big)
        out.append([x0 / W * 2 - 1, x1 / W * 2 - 1, y0 / H, y1 / H])
    return out


def register_logo(ref, shape, bboxes):
    """Place the clean reference NAMURA mark (from the HILLEL photo) into this label's logo area.
    The mark is split at its lowest clear horizontal gap into [mountain + name] and [tagline];
    each part goes into its own box [x0, x1, v0, v1] (normalised label coords) measured
    on the original photo, so the result matches this label's own layout."""
    if not isinstance(bboxes[0], (list, tuple)):
        return _place(ref, shape, bboxes)
    top, bot = split_logo(ref)
    return np.maximum(_place(top, shape, bboxes[0]), _place(bot, shape, bboxes[1]))


def mirror_extend(img, W_total, side_src=None, side_value=None):
    """Wrap the label further round the bottle: the photographed front stays untouched,
    the sides are a reflection of the de-texted background (no mirrored type)."""
    H, W = img.shape[:2]; pad = (W_total - W) // 2
    if pad <= 0: return img
    src = img if side_src is None else side_src
    big = cv2.copyMakeBorder(src, 0, 0, pad, W_total - W - pad, cv2.BORDER_REFLECT_101)
    if side_value is not None:
        big[:] = side_value
    big[:, pad:pad + W] = img
    if side_src is not None:  # soft cross-fade across the photo edge
        f = max(4, W // 40); ramp = np.linspace(0, 1, f)
        ramp = ramp.reshape((1, f) + (1,) * (img.ndim - 2))
        sl = slice(pad, pad + f); sr = slice(pad + W - f, pad + W)
        big[:, sl] = side_src[:, :f] * (1 - ramp) + img[:, :f] * ramp
        big[:, sr] = img[:, -f:] * (1 - ramp) + side_src[:, -f:] * ramp
    return big


def main():
    os.makedirs(OUT, exist_ok=True)
    if DEBUG: os.makedirs(DBG, exist_ok=True)
    meta = {}
    for name in ['hillel', 'haroeh', 'ivri']:  # hillel first: it provides the clean reference logo
        s = SPEC[name]
        scale = s.get('upscale', 3.0)
        R = s['top']['R']; th = np.radians(s['theta_photo'])
        W = int(R * 2 * th * scale)
        H = int((s['bottom']['ys'] + s['ctrl'][-1]['b'] - s['top']['ys'] - s['ctrl'][0]['b']) * scale)
        img = unwrap(s, W, H)
        c0, c1 = s.get('crop', [0, 1])
        img = img[int(c0 * H):int(c1 * H)]; H = img.shape[0]
        img = flatten_shading(img, s)
        img, foil, bgclean = rebuild_glyphs(img, s, scale, LOGO_CACHE.get('mask'))
        if s.get('fill_bottom'):  # rows below fb sample glass at the front -> plain paper from de-texted rows
            fb, a, b = (int(f * H) for f in s['fill_bottom'])
            src = bgclean[a:b]
            med = np.median(src, axis=0, keepdims=True)
            grain = (src - cv2.blur(src, (31, 31)))
            reps = int(np.ceil((H - fb) / len(grain)))
            img[fb:] = med + np.concatenate([grain] * reps)[:H - fb] * 0.6
            ramp = np.linspace(0, 1, 12)[:, None, None]
            img[fb - 12:fb] = img[fb - 12:fb] * (1 - ramp) + (med + grain[:12] * 0.6) * ramp
        thmax = np.radians(s.get('theta_max', 100))
        Wt = int(W * thmax / th)
        side = bgclean.copy()
        for v0, v1 in s.get('side_flat_rows', []):  # plain paper behind printed type on the sides
            r0, r1 = int(v0 * H), int(v1 * H)
            e = max(8, W // 12)  # match the brightness of the columns next to each edge
            grain = side[r0:r1] - cv2.blur(side[r0:r1], (31, 31))
            ml = np.median(side[r0:r1, :e], axis=1, keepdims=True)
            mr = np.median(side[r0:r1, -e:], axis=1, keepdims=True)
            wgt = np.linspace(0, 1, W)[None, :, None]
            side[r0:r1] = ml * (1 - wgt) + mr * wgt + grain * 0.6
        img = mirror_extend(img, Wt, side)
        foil = mirror_extend(foil, Wt, side_value=0.0)
        # paper bump: high-pass of luminance (emboss on HILLEL, fine grain elsewhere)
        lum = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        hp = lum - cv2.GaussianBlur(lum, (0, 0), 6 * scale)
        bump = np.clip(0.5 + hp * s.get('bump_gain', 1.5), 0, 1)
        bump = np.maximum(bump, 0.5 + 0.35 * cv2.GaussianBlur(foil, (0, 0), 1.0))  # hot-stamped foil is raised
        rough = np.full_like(lum, s.get('paper_roughness', 0.7)) * (1 - foil) + s.get('foil_roughness', 0.28) * foil
        cv2.imwrite(f'{OUT}/{name}_albedo.jpg', (img * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 95])
        # three.js: roughnessMap uses G, metalnessMap uses B. cv2 writes BGR, so B channel = foil.
        pbr = np.dstack([foil, rough, np.ones_like(foil)])
        cv2.imwrite(f'{OUT}/{name}_pbr.png', (pbr * 255).astype(np.uint8))
        cv2.imwrite(f'{OUT}/{name}_bump.jpg', (bump * 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])
        meta[name] = {'width': Wt, 'height': H, 'theta_max_deg': s.get('theta_max', 100),
                      'aspect_h_over_arc': H / (R * scale * 2 * thmax)}
        print(name, Wt, H, 'foil px', int(foil.sum()))
        if DEBUG:
            dbg = (img * 255).astype(np.uint8).copy()
            for yy in range(0, H, 60): cv2.line(dbg, (0, yy), (Wt, yy), (0, 255, 255), 1)
            cv2.imwrite(f'{DBG}/{name}_grid.jpg', cv2.resize(dbg, None, fx=0.35, fy=0.35, interpolation=cv2.INTER_AREA))
    json.dump(meta, open(f'{OUT}/labels.json', 'w'), indent=2)


if __name__ == '__main__':
    main()
