// Floating dust motes / pollen-gold specks. Deterministic (seeded) drift, rendered after
// DOF with their own circle-of-confusion bokeh and a soft depth test against the scene.
import * as THREE from 'three';

function mulberry32(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export class Dust {
  constructor(count = 700, seed = 11) {
    const rnd = mulberry32(seed);
    const pos = new Float32Array(count * 3), rnd4 = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (rnd() - 0.5) * 1.2; pos[i * 3 + 1] = rnd() * 0.75 - 0.05; pos[i * 3 + 2] = (rnd() - 0.5) * 1.1 + 0.05;
      rnd4[i * 4] = rnd(); rnd4[i * 4 + 1] = rnd(); rnd4[i * 4 + 2] = rnd(); rnd4[i * 4 + 3] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rnd4, 4));
    this.material = new THREE.ShaderMaterial({
      transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uFocus: { value: 1 }, uCocK: { value: 0 }, uMaxCoc: { value: 40 }, uPx: { value: 1 },
        tDepth: { value: null }, uRes: { value: new THREE.Vector2(1080, 1920) }, uNear: { value: 0.01 }, uFar: { value: 30 },
        uIntensity: { value: 1 }, uColor: { value: new THREE.Color(1.0, 0.78, 0.5) },
        uBeamA: { value: new THREE.Vector3() }, uBeamDir: { value: new THREE.Vector3(0, -1, 0) }, uBeamK: { value: 0.18 },
      },
      vertexShader: /* glsl */`
        attribute vec4 aRnd; uniform float uTime; uniform float uFocus; uniform float uCocK; uniform float uMaxCoc; uniform float uPx;
        uniform vec3 uBeamA; uniform vec3 uBeamDir; uniform float uBeamK;
        varying float vAlpha; varying float vSize; varying float vViewZ;
        void main(){
          vec3 p = position;
          float t = uTime * (0.35 + aRnd.x * 0.5);
          // slow convective drift (rising warm air) + gentle swirl
          p.y = mod(p.y + uTime * (0.006 + 0.012 * aRnd.y) + 0.05, 0.8) - 0.05;
          p.x += 0.025 * sin(t * 0.9 + aRnd.z * 6.28) + 0.012 * sin(t * 2.3 + aRnd.w * 9.0);
          p.z += 0.025 * cos(t * 0.7 + aRnd.w * 6.28);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          float d = -mv.z; vViewZ = d;
          float coc = min(abs(uCocK * (d - uFocus) / d), uMaxCoc);
          float base = (1.2 + 2.2 * aRnd.x * aRnd.x) * uPx;
          float size = max(base, coc);
          vSize = size;
          // energy-conserving bokeh: bigger discs are dimmer
          float lit = 0.25 + 3.0 * exp(-pow(length(cross(p - uBeamA, uBeamDir)) / uBeamK, 2.0));  // brighter inside the beam
          float twinkle = 0.65 + 0.35 * sin(uTime * (1.5 + 3.0 * aRnd.z) + aRnd.y * 40.0);
          vAlpha = lit * twinkle * (base * base) / (size * size) * (0.4 + 0.6 * aRnd.w);
          gl_PointSize = size * 2.0;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform float uIntensity; uniform vec3 uColor;
        varying float vAlpha; varying float vSize; varying float vViewZ;
        float linDepth(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
        void main(){
          vec2 c = gl_PointCoord * 2.0 - 1.0; float r = length(c);
          float big = smoothstep(3.0, 10.0, vSize);
          float disc = 1.0 - smoothstep(mix(0.2, 0.86, big), 1.0, r);
          float ring = mix(1.0, 0.75 + 0.35 * smoothstep(0.55, 0.95, r), big);   // subtle bokeh rim
          float sceneZ = linDepth(texture2D(tDepth, gl_FragCoord.xy / uRes).x);
          float vis = smoothstep(-0.02, 0.03, sceneZ - vViewZ);                   // soft depth test
          float a = disc * ring * vAlpha * vis * uIntensity;
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor * a, 1.0);
        }`,
    });
    this.points = new THREE.Points(g, this.material); this.points.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.points);
  }

  prepare(cam, o, t, state) {
    const u = this.material.uniforms;
    u.uTime.value = t; u.uFocus.value = o.focus; u.uCocK.value = o.cocK; u.uMaxCoc.value = o.maxCoc;
    u.tDepth.value = o.depth; u.uRes.value.set(o.res[0], o.res[1]); u.uNear.value = cam.near; u.uFar.value = cam.far;
    u.uPx.value = o.res[1] / 1920;
    u.uIntensity.value = state.dust ?? 1.0;
    if (state.beam) { u.uBeamA.value.copy(state.beam.from); u.uBeamDir.value.copy(state.beam.dir); }
  }
}
