// NAMURA - "The Collection" : 20 s vertical brand film, shot list.
//
//  0.0 - 3.0   S1  Macro: HILLEL gold foil + embossed leaves, rack focus, light sweep
//  3.0 - 6.0   S2  HILLEL hero reveal: pull back, top beam, backlit garnet glow, title
//  6.0 - 8.0   S3  HAROEH: crane up from the stone, warm sweep across the shepherd label
//  8.0 - 10.0  S4  IVRI: orbit in from the right through the side beam
// 10.0 - 15.0  S5  Montage (7 beats): illustration, foil glint, shoulder reflection,
//                  capsule, type rack-focus, wax seal, vintage box
// 15.0 - 20.0  S6  Collection hero: HAROEH | HILLEL | IVRI, NAMURA end card
import * as THREE from 'three';

export const FPS = 30;
export const DURATION = 20.0;

// ------------------------------------------------------------------ helpers
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;
const lerpV = (a, b, t) => a.map((v, i) => lerp(v, b[i], t));
const seg = (t, a, b) => (t - a) / (b - a);
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const smoother = (x) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const expoOut = (x) => { x = clamp01(x); return x === 1 ? 1 : 1 - Math.pow(2, -9 * x); };
// ease-in-out that keeps moving (linear) outside [0,1] so shots can be sampled into transitions
const flow = (x) => (x < 0 ? x * 0.0 : x > 1 ? 1 + (x - 1) * 0.0 : smoother(x));
const drift = (x, k = 0.25) => lerp(smoother(x), x, k); // never fully stops: subtle continuous motion
const pulse = (t, c, w) => Math.exp(-Math.pow((t - c) / w, 2));

const cam = new THREE.PerspectiveCamera(40, 9 / 16, 0.01, 30);
cam.filmGauge = 36;
function shoot(pos, target, mm, roll = 0) {
  cam.position.set(...pos);
  cam.up.set(Math.sin(roll), Math.cos(roll), 0);
  cam.lookAt(...target);
  cam.setFocalLength(mm);
  return cam;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// orbit helper: position around a target at radius r, azimuth az (rad, 0 = +Z), height y
const orbit = (target, r, az, y) => [target[0] + r * Math.sin(az), y, target[2] + r * Math.cos(az)];

const solo = (name, extra = {}) => ({ [name]: { pos: [0, 0, 0], rotY: 0, ...extra } });
const TRIO = (glow = 0.0) => ({
  haroeh: { pos: [-0.108, 0, -0.035], rotY: 0.16, glow },
  hillel: { pos: [0.0, 0, 0.022], rotY: 0.0, glow },
  ivri: { pos: [0.108, 0, -0.035], rotY: -0.16, glow },
});
const HAZE = (d = 0.25, k = 1) => ({ color: [0.022 * k, 0.014 * k, 0.008 * k], density: d * 0.7 });

// Label geometry helpers (y of label features, metres above the plinth)
const Y = {
  hillelLogo: 0.129, hillelName: 0.083, hillelVintage: 0.064, hillelShoulder: 0.215, hillelTop: 0.305,
  haroehLogo: 0.15, haroehArt: 0.105, haroehName: 0.062, haroehCap: 0.29,
  ivriLogo: 0.146, ivriName: 0.077, ivriArt: 0.104,
};

// ------------------------------------------------------------------ shots
export const SHOTS = [
  // S1 ─ macro on HILLEL foil. Rack focus from floating gold dust to the stamped logo.
  { id: 'S1-macro-hillel', start: 0.0, end: 3.0, samples: 4, apply(t) {
      const u = seg(t, 0.0, 3.0);
      const m = drift(u, 0.35);
      const target = [lerp(0.012, 0.0, m), lerp(0.112, Y.hillelLogo, m), 0.03];
      const pos = [lerp(0.05, -0.006, m), lerp(0.098, 0.134, m), lerp(0.175, 0.150, m)];
      shoot(pos, target, 100, lerp(0.05, -0.015, m));
      const rack = smoother(seg(t, 0.55, 1.75));
      return {
        camera: cam, bottles: solo('hillel', { rotY: lerp(-0.32, -0.04, m) }),
        dof: { focus: lerp(0.07, dist(pos, [0, Y.hillelLogo, 0.0375]), rack), fstop: 11 },
        haze: HAZE(0.18), dust: 1.6,
        rig: {
          key: lerp(1.62, 7.02, smooth(u * 1.4)), fill: 0.3, gobo: 24, rimL: 7.2, rimR: 6, top: 6,
          keyPos: [-0.6, 0.45, 0.65],
          sweep: 28 * pulse(t, 2.0, 0.75), sweepX: lerp(0.35, -0.35, smooth(seg(t, 1.1, 2.9))), sweepY: 0.13, sweepZ: 0.28,
          envRot: lerp(0.9, 0.2, m), envIntensity: lerp(0.6, 1.0, u),
        },
      };
    } },

  // S2 ─ HILLEL hero reveal: pull back + rise, top beam ignites, garnet backlight.
  { id: 'S2-hero-hillel', start: 3.0, end: 6.0, samples: 4, apply(t) {
      const u = seg(t, 3.0, 6.0);
      const m = drift(u, 0.3);
      const target = [0, lerp(0.18, 0.2, m), 0];
      const pos = orbit(target, lerp(0.7, 0.52, m), lerp(-0.34, 0.06, m), lerp(0.06, 0.15, m));
      shoot(pos, target, 50, lerp(-0.012, 0, m));
      const ignite = expoOut(seg(t, 3.1, 4.4));
      return {
        camera: cam, bottles: solo('hillel', { rotY: lerp(-0.18, 0.05, m), glow: 1.6 * ignite }),
        dof: { focus: dist(pos, [0, 0.15, 0.03]), fstop: 2.2 },
        haze: HAZE(0.42), dust: 1.2,
        rig: {
          key: lerp(9.6, 21.6, ignite), gobo: 72, top: 18 * ignite, beamTop: 0.11 * ignite, rimL: 15.6, rimR: 13.2, fill: 0.6,
          envRot: lerp(-0.5, 0.25, m),
        },
      };
    } },

  // S3 ─ HAROEH: crane up from stone level; warm sweep crosses the shepherd illustration.
  { id: 'S3-haroeh', start: 6.0, end: 8.0, samples: 5, apply(t) {
      const u = seg(t, 6.0, 8.0);
      const m = drift(u, 0.35);
      const target = [0, lerp(0.12, 0.19, m), 0];
      const pos = orbit(target, lerp(0.62, 0.66, m), lerp(0.30, 0.10, m), lerp(0.015, 0.125, m));
      shoot(pos, target, 55, lerp(0.02, 0, m));
      return {
        camera: cam, bottles: solo('haroeh', { rotY: lerp(0.22, -0.02, m), glow: 1.2 }),
        dof: { focus: dist(pos, [0, 0.12, 0.035]), fstop: 2.4 },
        haze: HAZE(0.36), dust: 1.0,
        rig: {
          key: 20.4, keyPos: [-0.9, 0.6, 0.9], gobo: 62.4, top: 12, beamTop: 0.07, rimL: 18, rimR: 9.6,
          sweep: 55 * pulse(t, 7.0, 0.6), sweepX: lerp(-0.4, 0.45, smooth(seg(t, 6.2, 7.9))), sweepY: 0.12, sweepZ: 0.35,
          envRot: lerp(0.6, -0.2, m),
          beamTopFrom: [0.45, 1.5, -0.5],
        },
      };
    } },

  // S4 ─ IVRI: orbit in from the right through a raking side beam.
  { id: 'S4-ivri', start: 8.0, end: 10.0, samples: 5, apply(t) {
      const u = seg(t, 8.0, 10.0);
      const m = drift(u, 0.35);
      const target = [0, lerp(0.17, 0.175, m), 0];
      const pos = orbit(target, lerp(0.6, 0.7, m), lerp(0.62, 0.02, m), lerp(0.20, 0.13, m));
      shoot(pos, target, 55, lerp(-0.03, 0, m));
      return {
        camera: cam, bottles: solo('ivri', { rotY: lerp(0.35, 0.0, m), glow: 1.4 }),
        dof: { focus: dist(pos, [0, 0.13, 0.035]), fstop: 2.4 },
        haze: HAZE(0.4), dust: 1.3,
        rig: {
          key: 19.2, keyPos: [-0.7, 0.75, 1.1], gobo: 52.8, top: 5, beamSide: 0.10, rimL: 10.8, rimR: 20.4, fill: 0.8,
          envRot: lerp(-0.7, 0.1, m),
        },
      };
    } },

  // ── S5 montage: 7 beats
  { id: 'M1-shepherd', start: 10.0, end: 10.7, samples: 5, apply(t) {
      const u = seg(t, 10.0, 10.7);
      const x = lerp(0.03, -0.022, u);
      const pos = [x, Y.haroehArt + 0.004, 0.15], target = [x * 0.6, Y.haroehArt, 0];
      shoot(pos, target, 85, 0);
      return { camera: cam, bottles: solo('haroeh', { rotY: lerp(0.08, -0.08, u) }),
        dof: { focus: dist(pos, [0, Y.haroehArt, 0.0375]), fstop: 11 }, haze: HAZE(0.15), dust: 1.2,
        rig: { key: 8.64, keyPos: [-0.6, 0.5, 0.7], sweep: 12, sweepX: lerp(0.3, -0.3, u), sweepY: 0.11, sweepZ: 0.25, envRot: lerp(0.4, -0.4, u) } };
    } },
  { id: 'M2-ivri-foil', start: 10.7, end: 11.4, samples: 5, apply(t) {
      const u = seg(t, 10.7, 11.4);
      const pos = [lerp(-0.035, -0.012, u), Y.ivriLogo + 0.01, lerp(0.16, 0.13, u)], target = [0.004, Y.ivriLogo - 0.002, 0];
      shoot(pos, target, 100, -0.03);
      return { camera: cam, bottles: solo('ivri', { rotY: lerp(0.12, -0.05, u) }),
        dof: { focus: dist(pos, [0, Y.ivriLogo, 0.0375]), fstop: 13 }, haze: HAZE(0.12), dust: 1.8,
        rig: { key: 5.4, keyPos: [-0.5, 0.6, 0.6], sweep: 16 * pulse(u, 0.5, 0.25), sweepX: lerp(0.3, -0.3, u), sweepY: 0.15, sweepZ: 0.2, envRot: lerp(-0.3, 0.6, u) } };
    } },
  { id: 'M3-shoulder', start: 11.4, end: 12.1, samples: 5, apply(t) {
      const u = seg(t, 11.4, 12.1);
      const target = [0, Y.hillelShoulder, 0];
      const pos = orbit(target, 0.2, lerp(-0.5, 0.15, u), lerp(0.17, 0.19, u));
      shoot(pos, target, 70, lerp(0.06, -0.02, u));
      return { camera: cam, bottles: solo('hillel', { rotY: 0, glow: 1.8 }),
        dof: { focus: dist(pos, target) - 0.03, fstop: 6.3 }, haze: HAZE(0.3), dust: 1.0,
        rig: { key: 9.6, top: 22, beamTop: 0.09, rimL: 24, rimR: 24, envRot: lerp(-1.6, 1.3, smooth(u)), envIntensity: 1.3 } };
    } },
  { id: 'M4-capsule', start: 12.1, end: 12.8, samples: 5, apply(t) {
      const u = seg(t, 12.1, 12.8);
      const target = [0, Y.haroehCap, 0];
      const pos = orbit(target, 0.16, lerp(0.7, -0.1, u), lerp(0.34, 0.325, u));
      shoot(pos, target, 70, 0.0);
      return { camera: cam, bottles: solo('haroeh', { glow: 1.0 }),
        dof: { focus: dist(pos, target), fstop: 8 }, haze: HAZE(0.3), dust: 1.4,
        rig: { key: 16.8, keyPos: [-0.5, 0.9, 0.6], keyTarget: [0, 0.27, 0], top: 20, beamTop: 0.08, beamTopFrom: [0.3, 1.5, -0.4], beamTopTo: [0, 0.25, 0],
          rimL: 18, rimR: 18, envRot: lerp(0.8, -0.6, u) } };
    } },
  { id: 'M5-ivri-type', start: 12.8, end: 13.5, samples: 5, apply(t) {
      const u = seg(t, 12.8, 13.5);
      const pos = [lerp(0.012, -0.004, u), Y.ivriName + 0.003, lerp(0.19, 0.155, u)], target = [0, Y.ivriName, 0];
      shoot(pos, target, 90, 0.0);
      const rack = smoother(seg(u, 0.1, 0.6));
      return { camera: cam, bottles: solo('ivri', { rotY: lerp(-0.05, 0.03, u) }),
        dof: { focus: lerp(0.075, dist(pos, [0, Y.ivriName, 0.0375]), rack), fstop: 11 }, haze: HAZE(0.15), dust: 2.2,
        rig: { key: 8.64, keyPos: [-0.7, 0.4, 0.8], sweep: 9.6, sweepX: lerp(-0.2, 0.25, u), sweepY: 0.08, sweepZ: 0.3, envRot: 0.2 } };
    } },
  { id: 'M6-wax', start: 13.5, end: 14.2, samples: 5, apply(t) {
      const u = seg(t, 13.5, 14.2);
      const target = [0, 0.284, 0];
      const pos = orbit(target, lerp(0.15, 0.12, u), lerp(-0.25, 0.2, u), lerp(0.27, 0.285, u));
      shoot(pos, target, 85, 0.0);
      return { camera: cam, bottles: solo('hillel', { glow: 2.0 }),
        dof: { focus: dist(pos, target) - 0.015, fstop: 7 }, haze: HAZE(0.35), dust: 1.6,
        rig: { key: 7.2, top: 26, beamTop: 0.12, beamTopFrom: [-0.2, 1.4, -0.6], beamTopTo: [0, 0.28, 0], rimL: 27, rimR: 18, envRot: lerp(1.0, 0.0, u), envIntensity: 1.25 } };
    } },
  { id: 'M7-vintage', start: 14.2, end: 15.0, samples: 5, apply(t) {
      const u = seg(t, 14.2, 15.0);
      const pos = [0.0, Y.hillelName + 0.002, lerp(0.17, 0.12, easeOut(u))], target = [0, Y.hillelName - 0.004, 0];
      shoot(pos, target, 100, 0.0);
      return { camera: cam, bottles: solo('hillel', { rotY: lerp(0.06, -0.02, u) }),
        dof: { focus: dist(pos, [0, Y.hillelName, 0.0375]), fstop: 13 }, haze: HAZE(0.12), dust: 1.4,
        rig: { key: 6.48, keyPos: [-0.55, 0.5, 0.7], sweep: 16 * pulse(u, 0.55, 0.22), sweepX: lerp(-0.3, 0.3, u), sweepY: 0.08, sweepZ: 0.22, envRot: lerp(0.3, -0.3, u) } };
    } },

  // S6 ─ the collection. Pull back and rise into the final hero frame.
  { id: 'S6-collection', start: 15.0, end: 20.0, samples: 4, apply(t) {
      const u = seg(t, 15.0, 20.0);
      const settle = smoother(seg(t, 15.0, 17.6));
      const hold = seg(t, 17.6, 20.0);
      const target = [0, lerp(0.15, 0.205, settle) + 0.004 * hold, 0];
      const r = lerp(0.6, 0.98, settle) - 0.03 * clamp01(hold);
      const pos = orbit(target, r, lerp(0.22, 0.0, settle) - 0.02 * clamp01(hold), lerp(0.085, 0.215, settle));
      shoot(pos, target, 50, 0);
      const lightUp = expoOut(seg(t, 15.2, 16.8));
      return {
        camera: cam, bottles: TRIO(1.4 * lightUp),
        dof: { focus: dist(pos, [0, 0.15, 0.04]), fstop: lerp(2.0, 3.2, settle) },
        haze: HAZE(0.4), dust: 1.3,
        rig: {
          key: lerp(14.4, 24, lightUp), keyPos: [-0.95, 0.95, 1.25], keyTarget: [0, 0.14, 0], fill: 0.9, gobo: 72,
          top: 16 * lightUp, beamTop: 0.10 * lightUp, beamTopFrom: [-0.3, 1.6, -0.6], beamTopTo: [0.02, 0.0, 0.0],
          beamSide: 0.04 * lightUp, rimL: 18, rimR: 18,
          sweep: 60 * pulse(t, 16.6, 0.7), sweepX: lerp(-0.6, 0.6, smooth(seg(t, 15.6, 17.6))), sweepY: 0.15, sweepZ: 0.6,
          envRot: lerp(0.5, -0.1, settle) - 0.05 * hold,
        },
      };
    } },
];

// cut list: transition between SHOTS[i] and SHOTS[i+1]
export const CUTS = [
  { at: 3.0, dur: 0.6, type: 'light' },
  { at: 6.0, dur: 0.30, type: 'whip', dir: [1, 0] },
  { at: 8.0, dur: 0.3, type: 'whip', dir: [-1, 0] },
  { at: 10.0, dur: 0.24, type: 'whip', dir: [0, 1] },
  { at: 10.7, dur: 0.0, type: 'cut' },
  { at: 11.4, dur: 0.2, type: 'whip', dir: [-1, 0] },
  { at: 12.1, dur: 0.0, type: 'cut' },
  { at: 12.8, dur: 0.2, type: 'whip', dir: [1, 0] },
  { at: 13.5, dur: 0.0, type: 'cut' },
  { at: 14.2, dur: 0.0, type: 'cut' },
  { at: 15.0, dur: 0.7, type: 'light' },
];

// global look over time: fades, flashes on the beats, exposure
export function lookAt(t) {
  let flash = 0;
  for (const c of [10.7, 12.1, 13.5, 14.2]) flash += 0.06 * Math.exp(-Math.max(0, t - c) * 14) * (t >= c ? 1 : 0);
  flash += 0.05 * pulse(t, 3.0, 0.12) + 0.06 * pulse(t, 15.0, 0.15) + 0.04 * pulse(t, 8.0, 0.1);
  const fadeIn = 1 - smooth(seg(t, 0.0, 0.7));
  const fadeOut = smooth(seg(t, 19.55, 20.0));
  return {
    exposure: 1.3, bloom: 0.085, bloomThreshold: 0.85, streak: 0.07, ca: 0.0055, vignette: 0.6, grain: 0.03,
    fade: Math.max(fadeIn, fadeOut), flash: [flash, flash * 0.75, flash * 0.48],
  };
}

// ------------------------------------------------------------------ titles
export function setupTitles(titles, logoTex) {
  const HE = '"Frank Ruhl Libre"', LA = '"Cormorant Garamond"';
  const name = (id, he, la) => {
    titles.addText(id + '-he', he, { font: HE, size: 220, weight: 300, heightN: 0.18, gold: true, glow: 0.6 });
    titles.addText(id + '-la', la, { font: LA, size: 64, weight: 500, spacing: '0.55em', heightN: 0.048, color: [0.93, 0.86, 0.74] });
  };
  name('hillel', 'הלל', 'HILLEL');
  name('haroeh', 'הרועה', 'HAROEH');
  name('ivri', 'עברי', 'IVRI');
  titles.addImage('logo', logoTex, 0.125, { gold: true, glow: 0.5 });
  titles.addText('brand-la', 'NAMURA', { font: LA, size: 80, weight: 500, spacing: '0.75em', heightN: 0.05, color: [0.93, 0.86, 0.74] });
}

export function titlesAt(titles, t) {
  titles.hideAll();
  const card = (id, t0, t1, y) => {
    const a = smooth(seg(t, t0, t0 + 0.6)) * (1 - smooth(seg(t, t1 - 0.45, t1)));
    if (a <= 0) return;
    const rev = expoOut(seg(t, t0, t0 + 1.1));
    titles.set(id + '-he', { opacity: a, reveal: rev, blur: (1 - rev) * 3, y: y + 0.006 * (1 - rev) + 0.004 * seg(t, t0, t1), scale: lerp(1.04, 1.0, rev),
      sheen: lerp(-0.4, 1.4, seg(t, t0 + 0.5, t0 + 1.6)) });
    const b = smooth(seg(t, t0 + 0.45, t0 + 1.1)) * (1 - smooth(seg(t, t1 - 0.5, t1 - 0.1)));
    titles.set(id + '-la', { opacity: b * 0.9, reveal: 1, blur: (1 - b) * 2, y: y + 0.058 + 0.004 * seg(t, t0, t1), scale: lerp(1.08, 1.0, b) });
  };
  card('hillel', 4.0, 5.95, 0.875);
  card('haroeh', 6.55, 7.95, 0.875);
  card('ivri', 8.55, 9.95, 0.875);
  // end card
  const la = smooth(seg(t, 16.3, 17.3));
  if (la > 0) {
    const rev = expoOut(seg(t, 16.3, 17.6));
    titles.set('logo', { opacity: la, reveal: rev, blur: (1 - rev) * 3, y: 0.835 + 0.008 * (1 - rev), scale: lerp(1.05, 1.0, rev),
      sheen: lerp(-0.5, 1.5, seg(t, 17.4, 18.8)) });
    const b = smooth(seg(t, 17.0, 17.9));
    titles.set('brand-la', { opacity: b * 0.92, reveal: 1, blur: (1 - b) * 2, y: 0.738, scale: lerp(1.1, 1.0, b) });
  }
}

// ------------------------------------------------------------------ frame resolution
export function resolve(t) {
  // which shots are on screen and how they mix
  let i = SHOTS.findIndex((s) => t >= s.start && t < s.end);
  if (i < 0) i = SHOTS.length - 1;
  for (const c of CUTS) {
    if (c.dur > 0 && t >= c.at - c.dur / 2 && t < c.at + c.dur / 2) {
      const a = SHOTS.findIndex((s) => Math.abs(s.end - c.at) < 1e-6);
      return { a: SHOTS[a], b: SHOTS[a + 1], transition: { ...c, p: (t - (c.at - c.dur / 2)) / c.dur } };
    }
  }
  return { a: SHOTS[i] };
}
