"""
Procedural set textures for the NAMURA studio (deterministic, no external assets):
  stone_albedo.jpg / stone_bump.jpg   - dark warm limestone for the plinth
  plaster_albedo.jpg                  - aged cellar wall for the backdrop
  vine_gobo.png                       - vine-leaf shadow pattern projected by the backdrop light
"""
import os, numpy as np, cv2
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'studio/public/textures'); os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)

def fbm(n, octaves=7, persistence=0.55, base=4, seed=0):
    r = np.random.default_rng(seed); acc = np.zeros((n, n), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        f = base * 2 ** o
        g = r.standard_normal((f + 1, f + 1)).astype(np.float32)
        g[-1] = g[0]; g[:, -1] = g[:, 0]  # tileable
        acc += cv2.resize(g, (n, n), interpolation=cv2.INTER_CUBIC) * amp
        tot += amp; amp *= persistence
    acc /= tot; return (acc - acc.mean()) / (acc.std() + 1e-6)

N = 2048
# --- stone ---
a = fbm(N, 8, 0.58, 3, 1); b = fbm(N, 6, 0.5, 8, 2); pores = fbm(N, 3, 0.5, 256, 3)
veins = np.abs(fbm(N, 6, 0.6, 2, 4)); veins = np.exp(-veins * 9)
lum = 0.20 + 0.035 * a + 0.02 * b - 0.05 * np.clip(pores - 1.6, 0, 3) + 0.03 * veins
col = np.dstack([lum * 0.78, lum * 0.90, lum * 1.0])  # BGR: warm brown-grey
cv2.imwrite(f'{OUT}/stone_albedo.jpg', np.clip(col * 255, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])
bump = 0.5 + 0.12 * a + 0.1 * b - 0.18 * np.clip(pores - 1.4, 0, 3) + 0.05 * fbm(N, 2, 0.5, 512, 5)
cv2.imwrite(f'{OUT}/stone_bump.jpg', np.clip(bump * 255, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 92])

# --- plaster wall ---
w = fbm(N, 8, 0.6, 2, 11); w2 = fbm(N, 5, 0.5, 16, 12)
lum = 0.16 + 0.04 * w + 0.015 * w2
col = np.dstack([lum * 0.62, lum * 0.80, lum * 1.0])
cv2.imwrite(f'{OUT}/plaster_albedo.jpg', np.clip(col * 255, 0, 255).astype(np.uint8), [cv2.IMWRITE_JPEG_QUALITY, 90])

# --- vine-leaf gobo (white = light passes) ---
G = 1024; img = np.ones((G, G), np.float32)
def leaf(cx, cy, s, ang):
    """Grape-leaf silhouette: five pointed lobes, serrated edge, stem notch."""
    t = np.linspace(-np.pi, np.pi, 720)
    lobes = 0.5 + 0.5 * (1 - np.abs(np.sin(2.5 * t))) ** 1.6         # 5 pointed lobes
    lobes *= 1 - 0.55 * np.exp(-(t / 0.22) ** 2)                      # deep notch where stem meets
    serr = 1 + 0.045 * np.abs(np.sin(30 * t))                         # serrations
    r = s * lobes * serr
    x = cx + r * np.sin(t + ang); y = cy - r * np.cos(t + ang)
    cv2.fillPoly(img, [np.stack([x, y], 1).astype(np.int32)], 0.0)
# two branches sweeping in from the top corners, leaves hanging off them
for (x0, y0, dx, dy, ph) in [(-60, 60, 34, 9, 0.0), (1080, 30, -30, 14, 1.3)]:
    pts = []; x, y = x0, y0
    for i in range(30):
        x += dx; y += dy + 22 * np.sin(i * 0.33 + ph); pts.append((x, y))
    cv2.polylines(img, [np.array(pts, np.int32)], False, 0.0, 10)
    for i, (px, py) in enumerate(pts[1::3]):
        sz = rng.uniform(55, 105); ox, oy = rng.uniform(-25, 25), rng.uniform(25, 90)
        cv2.line(img, (int(px), int(py)), (int(px + ox), int(py + oy)), 0.0, 4)
        leaf(px + ox, py + oy + sz * 0.9, sz, rng.uniform(-0.6, 0.6))
# a few loose leaves lower down for dappling
for i in range(4):
    leaf(rng.uniform(80, 940), rng.uniform(420, 760), rng.uniform(45, 80), rng.uniform(-3, 3))
img = cv2.GaussianBlur(img, (0, 0), 5)  # soft shadow edge
img = 0.18 + 0.82 * img
vign = np.fromfunction(lambda y, x: 1 - np.clip(np.hypot((x - G / 2) / (G / 2), (y - G / 2) / (G / 2)), 0, 1) ** 2.5, (G, G))
img *= np.clip(vign, 0, 1)
cv2.imwrite(f'{OUT}/vine_gobo.png', np.clip(img * 255, 0, 255).astype(np.uint8))
print('set textures written')
