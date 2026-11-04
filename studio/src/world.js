// Builds the complete 3D world and applies per-shot state (bottle placement, light rig,
// beams, reflections) every sub-frame.
import * as THREE from 'three';
import { buildSet, aimBeam } from './environment.js';
import { createBottle } from './bottles.js';
import { Dust } from './particles.js';

export const NAMES = ['haroeh', 'hillel', 'ivri'];

// Base light rig. Shots override any field.
export const RIG = {
  key: 20, fill: 1.2, gobo: 60, top: 20, rimL: 14, rimR: 12, sweep: 0, sweepX: 0, sweepY: 0.16, sweepZ: 0.42,
  keyPos: [-0.85, 0.85, 1.05], keyTarget: [0, 0.13, 0], keyColor: 0xffd2a6,
  envRot: 0, envIntensity: 1.0, glow: 0.0,
  beamTop: 0.0, beamSide: 0.0,
  beamTopFrom: [-0.42, 1.45, -0.55], beamTopTo: [0.0, 0.0, 0.0],
  beamSideFrom: [1.3, 1.25, -0.9], beamSideTo: [-0.25, 0.05, 0.1],
};

// look-dev: ?rig={"gobo":200,"key":0} overrides every shot
let RIG_OVERRIDE = {};
try { RIG_OVERRIDE = JSON.parse(new URLSearchParams(location.search).get('rig') || '{}'); } catch { /* ignore */ }

export async function buildWorld(renderer) {
  const loader = new THREE.TextureLoader();
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const load = (url, srgb) => new Promise((res, rej) => loader.load(url, (t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = aniso; res(t);
  }, undefined, rej));
  const meta = await (await fetch('textures/labels.json')).json();
  const tex = {};
  for (const n of NAMES) {
    tex[n] = {
      albedo: await load(`textures/${n}_albedo.jpg`, true),
      pbr: await load(`textures/${n}_pbr.png`, false),
      bump: await load(`textures/${n}_bump.jpg`, false),
    };
  }
  const setTex = {
    stoneAlbedo: await load('textures/stone_albedo.jpg', true), stoneBump: await load('textures/stone_bump.jpg', false),
    plaster: await load('textures/plaster_albedo.jpg', true), gobo: await load('textures/vine_gobo.png', true),
  };
  const logo = await load('textures/namura_logo.png', false);

  const set = buildSet(renderer, setTex);
  const bottles = {};
  for (const n of NAMES) { bottles[n] = createBottle(n, tex[n], meta[n]); set.scene.add(bottles[n]); }
  const particles = new Dust(650);

  const v3 = (a) => new THREE.Vector3(...a);
  const world = {
    scene: set.scene, set, bottles, particles, logo, meta,
    update(t, s) {
      const r = { ...RIG, ...(s.rig ?? {}), ...RIG_OVERRIDE };
      const L = set.lights;
      // bottles
      for (const n of NAMES) {
        const b = bottles[n], bs = s.bottles?.[n];
        b.visible = !!bs && bs.visible !== false;
        if (!b.visible) continue;
        b.position.set(...(bs.pos ?? [0, 0, 0]));
        b.rotation.set(0, bs.rotY ?? 0, 0);
        b.userData.glassMat.userData.uniforms.uGlow.value = bs.glow ?? r.glow;
      }
      // lights
      L.key.intensity = r.key; L.key.color.set(r.keyColor);
      L.key.position.set(...r.keyPos); L.key.target.position.set(...r.keyTarget);
      L.fill.intensity = r.fill; L.gobo.intensity = r.gobo; L.top.intensity = r.top;
      L.rimL.intensity = r.rimL; L.rimR.intensity = r.rimR;
      L.sweep.intensity = r.sweep; L.sweep.position.set(r.sweepX, r.sweepY, r.sweepZ);
      L.sweep.lookAt(r.sweepX * 0.15, r.sweepY, 0);
      // gobo shadows drift very slowly (leaves moving in a breeze)
      L.gobo.target.position.set(0.0 + 0.025 * Math.sin(t * 0.6), 0.42 + 0.012 * Math.sin(t * 0.9 + 1.0), -0.78);
      // reflections
      set.scene.environmentRotation.set(0, r.envRot, 0);
      set.scene.environmentIntensity = r.envIntensity;
      // beams
      aimBeam(set.beams.top, v3(r.beamTopFrom), v3(r.beamTopTo));
      aimBeam(set.beams.side, v3(r.beamSideFrom), v3(r.beamSideTo));
      set.beams.top.material.uniforms.uIntensity.value = r.beamTop;
      set.beams.side.material.uniforms.uIntensity.value = r.beamSide;
      set.beams.top.visible = r.beamTop > 0; set.beams.side.visible = r.beamSide > 0;
      set.beams.top.material.uniforms.uTime.value = t; set.beams.side.material.uniforms.uTime.value = t;
      L.top.position.set(...r.beamTopFrom); L.top.target.position.set(...r.beamTopTo);
      // dust is lit by the strongest beam
      const useSide = r.beamSide > r.beamTop;
      const from = v3(useSide ? r.beamSideFrom : r.beamTopFrom), to = v3(useSide ? r.beamSideTo : r.beamTopTo);
      s.beam = { from, dir: to.clone().sub(from).normalize() };
    },
  };
  return world;
}
