// NAMURA Wine Studio - entry point.
//   ?w=1080&h=1920        output resolution (default 1080x1920)
//   ?t=4.5                render a single still at time t (preview)
//   ?play                 realtime-ish playback preview
//   (no flag)             render mode: the renderer drives window.NAMURA.renderFrame(i)
import '@fontsource/frank-ruhl-libre/hebrew-300.css';
import '@fontsource/cormorant-garamond/latin-500.css';
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Pipeline, FullScreen } from './post.js';
import { Titles } from './titles.js';
import { FPS, DURATION, resolve, lookAt, setupTitles, titlesAt } from './timeline.js';

const q = new URLSearchParams(location.search);
const W = +(q.get('w') ?? 1080), H = +(q.get('h') ?? 1920);
const hud = document.getElementById('hud');

const canvas = document.createElement('canvas');
canvas.width = W; canvas.height = H;
document.getElementById('stage').appendChild(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // our finish pass already outputs display-referred values

async function init() {
  await Promise.all([
    document.fonts.load('300 100px "Frank Ruhl Libre"', 'הלל'),
    document.fonts.load('500 100px "Cormorant Garamond"', 'NAMURA'),
  ]);
  const world = await buildWorld(renderer);
  const pipe = new Pipeline(renderer, W, H);
  const titles = new Titles(W, H);
  setupTitles(titles, world.logo);
  const blit = new FullScreen();
  const blitMat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform sampler2D t; void main(){ gl_FragColor = texture2D(t, vUv); }',
    uniforms: { t: { value: null } }, depthTest: false,
  });
  // compile everything up-front
  renderer.compile(world.scene, new THREE.PerspectiveCamera());

  const frames = Math.round(DURATION * FPS);
  let pixels = null;

  function renderTime(t, frame) {
    const r = resolve(t);
    const a = pipe.renderShot(r.a, t, FPS, 0, world);
    const b = r.b ? pipe.renderShot(r.b, t, FPS, 1, world) : null;
    titlesAt(titles, t);
    const out = pipe.composeFrame({ a, b, transition: r.transition, look: lookAt(t), titles, t, frame });
    blitMat.uniforms.t.value = out.texture; blit.render(renderer, blitMat, null);
    return out;
  }

  const gl = renderer.getContext(); const px = new Uint8Array(4);
  const sync = () => { renderer.setRenderTarget(pipe.rtOut); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  window.NAMURA_PROFILE = (t) => {
    const r = resolve(t); const res = {};
    const time = (k, f) => { sync(); const t0 = performance.now(); f(); sync(); res[k] = Math.round(performance.now() - t0); };
    let st;
    time('apply+update', () => { st = r.a.apply(t); world.update(t, st); });
    time('scene', () => { renderer.setRenderTarget(pipe.rtScene); renderer.render(world.scene, st.camera); });
    renderer.shadowMap.autoUpdate = false;
    time('scene-noshadow', () => { renderer.setRenderTarget(pipe.rtScene); renderer.render(world.scene, st.camera); });
    renderer.shadowMap.autoUpdate = true;
    const L = world.set.lights; const saved = [L.rimL, L.rimR, L.sweep].map((l) => l.visible);
    [L.rimL, L.rimR, L.sweep].forEach((l) => (l.visible = false));
    time('scene-norect(compile)', () => { renderer.setRenderTarget(pipe.rtScene); renderer.render(world.scene, st.camera); });
    time('scene-norect', () => { renderer.setRenderTarget(pipe.rtScene); renderer.render(world.scene, st.camera); });
    [L.rimL, L.rimR, L.sweep].forEach((l, i) => (l.visible = saved[i]));
    const objs = { wall: world.set.wall, plinth: world.set.plinth, beams: world.set.beams.top, beamS: world.set.beams.side,
      bottles: world.bottles.hillel };
    for (const [k, o] of Object.entries(objs)) { const v = o.visible; o.visible = false;
      time('no-' + k, () => { renderer.setRenderTarget(pipe.rtScene); renderer.render(world.scene, st.camera); }); o.visible = v; }
    time('fullshot', () => pipe.renderShot(r.a, t, FPS, 0, world));
    const a = { out: pipe.rtShot[0] };
    time('compose', () => pipe.composeFrame({ a, look: lookAt(t), titles, t, frame: 0 }));
    return res;
  };
  window.NAMURA = {
    W, H, FPS, frames, DURATION,
    renderFrame(i) {
      const t0 = performance.now();
      renderTime(i / FPS, i);
      return performance.now() - t0;
    },
    // render frame i and POST raw RGBA (bottom-up rows) to the local render server
    async renderAndUpload(i, url) {
      const t0 = performance.now();
      const out = renderTime(i / FPS, i);
      pixels = pixels ?? new Uint8Array(W * H * 4);
      renderer.readRenderTargetPixels(out, 0, 0, W, H, pixels);
      const t1 = performance.now();
      await fetch(url, { method: 'POST', body: pixels });
      return { render: t1 - t0, upload: performance.now() - t1 };
    },
  };

  if (q.has('t')) {
    const t = +q.get('t'); const ms = window.NAMURA.renderFrame(Math.round(t * FPS));
    hud.textContent = `t=${t}s  ${ms.toFixed(0)} ms`;
  } else if (q.has('play')) {
    const start = performance.now();
    const loop = () => { const t = ((performance.now() - start) / 1000) % DURATION; renderTime(t, Math.floor(t * FPS)); hud.textContent = t.toFixed(2); requestAnimationFrame(loop); };
    loop();
  }
  window.NAMURA_READY = true;
}
init().catch((e) => { console.error(e); window.NAMURA_ERROR = String(e && e.stack || e); });
