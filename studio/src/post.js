// NAMURA Wine Studio - cinematic image pipeline.
//
//   per shot:  N jittered sub-frames over a 180deg shutter  -> true motion blur + AA
//              -> atmospheric haze (depth based) -> bokeh depth of field (single-pass gather)
//              -> dust particles (soft, depth-aware, with their own bokeh)
//   per frame: shot transition mix -> bloom (mip chain) -> lens + film finish
//              (chromatic aberration, ACES filmic, warm grade, vignette) -> titles -> grain
import * as THREE from 'three';

const PREVIEW = new URLSearchParams(location.search).has('preview');
const FS_VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

export class FullScreen {
  constructor() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.mesh = new THREE.Mesh(g); this.mesh.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.mesh);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  render(renderer, material, target) {
    this.mesh.material = material;
    renderer.setRenderTarget(target ?? null);
    renderer.render(this.scene, this.camera);
  }
}

const mat = (fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
  vertexShader: FS_VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, ...extra,
});

const rt = (w, h, opts = {}) => new THREE.WebGLRenderTarget(w, h, {
  type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  depthBuffer: false, ...opts,
});

const DEPTH_GLSL = /* glsl */`
  uniform float uNear; uniform float uFar;
  float linDepth(float d){ float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
`;

export class Pipeline {
  constructor(renderer, W, H) {
    this.r = renderer; this.W = W; this.H = H; this.fs = new FullScreen();
    const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2);
    this.scale = H / 1920; // all pixel sizes are authored at 1080x1920

    const depthTexture = new THREE.DepthTexture(W, H, THREE.FloatType);
    this.rtScene = rt(W, H, { depthBuffer: true, depthTexture });
    this.rtAccum = rt(W, H);
    this.rtShot = [rt(W, H), rt(W, H)];
    this.rtHalf = rt(hw, hh); this.rtHalfBlur = rt(hw, hh);
    this.rtMix = rt(W, H);
    this.rtDisplay = rt(W, H, { type: THREE.UnsignedByteType });
    this.rtOut = rt(W, H, { type: THREE.UnsignedByteType });
    this.bloomDown = []; this.bloomUp = [];
    let w = hw, h = hh;
    for (let i = 0; i < 7; i++) { this.bloomDown.push(rt(w, h)); this.bloomUp.push(rt(w, h)); w = Math.max(1, w >> 1); h = Math.max(1, h >> 1); }
    this.rtStreak = rt(this.bloomDown[2].width, this.bloomDown[2].height);

    this.copyAdd = mat(`varying vec2 vUv; uniform sampler2D tSrc; uniform float uWeight;
      void main(){ gl_FragColor = vec4(texture2D(tSrc, vUv).rgb * uWeight, 1.0); }`,
      { tSrc: { value: null }, uWeight: { value: 1 } },
      { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor });

    // --- haze + CoC + downsample to half res
    this.prep = mat(DEPTH_GLSL + `varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tDepth;
      uniform float uFocus; uniform float uCocK; uniform float uMaxCoc; uniform vec2 uTexel;
      uniform vec3 uHaze; uniform float uHazeDensity;
      vec3 hazed(vec2 uv){ vec3 c = texture2D(tColor, uv).rgb; float d = linDepth(texture2D(tDepth, uv).x);
        float f = 1.0 - exp(-uHazeDensity * d); return mix(c, uHaze, f); }
      void main(){
        vec2 o = uTexel * 0.5;
        vec3 c = 0.25 * (hazed(vUv + vec2(-o.x,-o.y)) + hazed(vUv + vec2(o.x,-o.y)) + hazed(vUv + vec2(-o.x,o.y)) + hazed(vUv + vec2(o.x,o.y)));
        float d = linDepth(texture2D(tDepth, vUv).x);
        float coc = clamp(uCocK * (d - uFocus) / d, -uMaxCoc, uMaxCoc);   // signed, full-res pixels
        gl_FragColor = vec4(c, coc);
      }`, {
      tColor: { value: null }, tDepth: { value: null }, uNear: { value: 0.01 }, uFar: { value: 30 },
      uFocus: { value: 1 }, uCocK: { value: 0 }, uMaxCoc: { value: 28 * this.scale }, uTexel: { value: new THREE.Vector2(1 / W, 1 / H) },
      uHaze: { value: new THREE.Color() }, uHazeDensity: { value: 0 },
    });

    // --- bokeh gather (single pass, golden-angle spiral; after Dennis Gustafsson)
    this.bokeh = mat(`varying vec2 vUv; uniform sampler2D tHalf; uniform vec2 uTexel; uniform float uMaxCoc; uniform float uRadScale;
      const float GA = 2.39996323;
      void main(){
        vec4 cc = texture2D(tHalf, vUv);
        float centerSize = abs(cc.a) * 0.5;               // to half-res px
        vec3 color = cc.rgb; float tot = 1.0;
        float maxR = uMaxCoc * 0.5;
        float radius = uRadScale;
        for (int i = 0; i < 160; i++) {
          if (radius >= maxR) break;
          float ang = float(i) * GA;
          vec2 tc = vUv + vec2(cos(ang), sin(ang)) * uTexel * radius;
          vec4 s = texture2D(tHalf, tc);
          float sSize = abs(s.a) * 0.5;
          if (s.a > cc.a) sSize = clamp(sSize, 0.0, centerSize * 2.0);   // behind: don't bleed onto sharper fg
          float m = smoothstep(radius - 0.5, radius + 0.5, sSize);
          // bokeh highlights: brighten bright taps a little (cat's-eye-free round bokeh)
          vec3 sc = s.rgb * (1.0 + 0.6 * smoothstep(1.0, 4.0, dot(s.rgb, vec3(0.3,0.6,0.1))));
          color += mix(color / tot, sc, m); tot += 1.0;
          radius += uRadScale / radius;
        }
        gl_FragColor = vec4(color / tot, cc.a);
      }`, { tHalf: { value: null }, uTexel: { value: new THREE.Vector2(1 / hw, 1 / hh) }, uMaxCoc: { value: 28 * this.scale }, uRadScale: { value: 0.75 } });

    // --- recombine sharp full-res with blurred half-res
    this.dofComposite = mat(DEPTH_GLSL + `varying vec2 vUv; uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tBlur;
      uniform float uFocus; uniform float uCocK; uniform float uMaxCoc; uniform vec3 uHaze; uniform float uHazeDensity;
      void main(){
        vec3 c = texture2D(tColor, vUv).rgb; float d = linDepth(texture2D(tDepth, vUv).x);
        c = mix(c, uHaze, 1.0 - exp(-uHazeDensity * d));
        float coc = abs(clamp(uCocK * (d - uFocus) / d, -uMaxCoc, uMaxCoc));
        vec4 b = texture2D(tBlur, vUv);
        float fgSpread = smoothstep(1.0, 4.0, abs(b.a)) * step(b.a, 0.0);   // blurred foreground spills over sharp bg
        float k = max(smoothstep(0.8, 3.0, coc), fgSpread);
        gl_FragColor = vec4(mix(c, b.rgb, k), 1.0);
      }`, {
      tColor: { value: null }, tDepth: { value: null }, tBlur: { value: null }, uNear: { value: 0.01 }, uFar: { value: 30 },
      uFocus: { value: 1 }, uCocK: { value: 0 }, uMaxCoc: { value: 28 * this.scale }, uHaze: { value: new THREE.Color() }, uHazeDensity: { value: 0 },
    });

    // --- transitions between two shots
    this.mix = mat(`varying vec2 vUv; uniform sampler2D tA; uniform sampler2D tB; uniform float uP; uniform int uType;
      uniform vec2 uDir; uniform float uTime;
      float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
      vec3 dirBlur(sampler2D t, vec2 uv, vec2 d){ vec3 s = vec3(0.0); for(int i=0;i<16;i++){ s += texture2D(t, uv + d*(float(i)/15.0-0.5)).rgb; } return s/16.0; }
      void main(){
        vec3 a, b; float p = uP;
        if (uType == 1) {               // whip: directional smear peaking at the cut
          float s = sin(p * 3.14159);
          a = dirBlur(tA, vUv, uDir * s * 0.35); b = dirBlur(tB, vUv, uDir * s * 0.35);
          gl_FragColor = vec4(mix(a, b, smoothstep(0.35, 0.65, p)), 1.0); return;
        }
        a = texture2D(tA, vUv).rgb; b = texture2D(tB, vUv).rgb;
        if (uType == 2) {               // light reveal: next shot emerges through its own highlights + smoke
          float lb = dot(b, vec3(0.3, 0.6, 0.1));
          float n = vn(vUv * vec2(5.0, 9.0) + uTime * 0.2) * 0.6 + vn(vUv * vec2(13.0, 22.0)) * 0.4;
          float m = smoothstep(p * 1.4 - 0.3, p * 1.4 - 0.05, clamp(lb * 0.35 + n * 0.65, 0.0, 1.0) * (1.0 - p * 0.2) + p * 0.35);
          m = clamp(max(m, smoothstep(0.75, 1.0, p)), 0.0, 1.0);
          gl_FragColor = vec4(mix(a, b, m), 1.0); return;
        }
        gl_FragColor = vec4(mix(a, b, smoothstep(0.0, 1.0, p)), 1.0);     // dissolve
      }`, { tA: { value: null }, tB: { value: null }, uP: { value: 0 }, uType: { value: 0 }, uDir: { value: new THREE.Vector2(1, 0) }, uTime: { value: 0 } });

    // --- bloom
    this.bloomPre = mat(`varying vec2 vUv; uniform sampler2D tSrc; uniform float uThreshold; uniform vec2 uTexel;
      void main(){ vec3 c = vec3(0.0);
        c += texture2D(tSrc, vUv + uTexel*vec2(-1,-1)).rgb; c += texture2D(tSrc, vUv + uTexel*vec2(1,-1)).rgb;
        c += texture2D(tSrc, vUv + uTexel*vec2(-1,1)).rgb;  c += texture2D(tSrc, vUv + uTexel*vec2(1,1)).rgb; c *= 0.25;
        float l = max(c.r, max(c.g, c.b)); float k = max(l - uThreshold, 0.0); k = k * k / (k + 0.5 + 1e-4);
        gl_FragColor = vec4(c * (k / max(l, 1e-4)), 1.0); }`, { tSrc: { value: null }, uThreshold: { value: 1.0 }, uTexel: { value: new THREE.Vector2() } });
    this.down = mat(`varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
      void main(){ vec2 t = uTexel;
        vec3 a = texture2D(tSrc, vUv + t*vec2(-2,2)).rgb, b = texture2D(tSrc, vUv + t*vec2(0,2)).rgb, c = texture2D(tSrc, vUv + t*vec2(2,2)).rgb;
        vec3 d = texture2D(tSrc, vUv + t*vec2(-2,0)).rgb, e = texture2D(tSrc, vUv).rgb, f = texture2D(tSrc, vUv + t*vec2(2,0)).rgb;
        vec3 g = texture2D(tSrc, vUv + t*vec2(-2,-2)).rgb, h = texture2D(tSrc, vUv + t*vec2(0,-2)).rgb, i = texture2D(tSrc, vUv + t*vec2(2,-2)).rgb;
        vec3 j = texture2D(tSrc, vUv + t*vec2(-1,1)).rgb, k = texture2D(tSrc, vUv + t*vec2(1,1)).rgb;
        vec3 l = texture2D(tSrc, vUv + t*vec2(-1,-1)).rgb, m = texture2D(tSrc, vUv + t*vec2(1,-1)).rgb;
        vec3 o = e*0.125 + (a+c+g+i)*0.03125 + (b+d+f+h)*0.0625 + (j+k+l+m)*0.125;
        gl_FragColor = vec4(o, 1.0); }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.up = mat(`varying vec2 vUv; uniform sampler2D tSrc; uniform sampler2D tBase; uniform vec2 uTexel; uniform float uRadius;
      void main(){ vec2 t = uTexel * uRadius;
        vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
        s += (texture2D(tSrc, vUv + vec2(t.x,0)).rgb + texture2D(tSrc, vUv - vec2(t.x,0)).rgb + texture2D(tSrc, vUv + vec2(0,t.y)).rgb + texture2D(tSrc, vUv - vec2(0,t.y)).rgb) * 2.0;
        s += texture2D(tSrc, vUv + t).rgb + texture2D(tSrc, vUv - t).rgb + texture2D(tSrc, vUv + vec2(t.x,-t.y)).rgb + texture2D(tSrc, vUv + vec2(-t.x,t.y)).rgb;
        gl_FragColor = vec4(texture2D(tBase, vUv).rgb + s / 16.0, 1.0); }`, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });

    // --- lens + film finish (display-referred output)
    this.finish = mat(`varying vec2 vUv; uniform sampler2D tSrc; uniform sampler2D tBloom; uniform sampler2D tStreak;
      uniform float uExposure; uniform float uBloom; uniform float uStreak; uniform float uCA; uniform float uVignette;
      uniform float uFade; uniform vec3 uFlash; uniform float uAspect;
      vec3 aces(vec3 x){ // ACES fitted (Hill)
        const mat3 i = mat3(0.59719,0.07600,0.02840, 0.35458,0.90834,0.13383, 0.04823,0.01566,0.83777);
        const mat3 o = mat3(1.60475,-0.10208,-0.00327, -0.53108,1.10813,-0.07276, -0.07367,-0.00605,1.07602);
        vec3 v = i * x; vec3 a = v*(v+0.0245786)-0.000090537; vec3 b = v*(0.983729*v+0.4329510)+0.238081; return clamp(o*(a/b),0.0,1.0); }
      void main(){
        vec2 c = vUv - 0.5; c.x *= uAspect; float r2 = dot(c, c);
        vec2 ca = (vUv - 0.5) * uCA * r2;
        vec3 col;
        col.r = texture2D(tSrc, vUv + ca).r; col.g = texture2D(tSrc, vUv).g; col.b = texture2D(tSrc, vUv - ca).b;
        col += texture2D(tBloom, vUv).rgb * uBloom;
        col += texture2D(tStreak, vUv).rgb * uStreak * vec3(1.0, 0.82, 0.6);
        col = col * uExposure + uFlash;
        // warm split-tone before the curve: amber highlights, umber shadows
        float l = dot(col, vec3(0.2126,0.7152,0.0722));
        col = mix(col, col * vec3(1.06, 0.98, 0.86), smoothstep(0.0, 1.2, l));
        col += vec3(0.0035, 0.0018, 0.0006) * (1.0 - smoothstep(0.0, 0.08, l));
        vec3 m = aces(col);
        // gentle saturation + cinematic s-curve in display space
        float lm = dot(m, vec3(0.2126,0.7152,0.0722));
        m = mix(vec3(lm), m, 1.04);
        m = pow(m, vec3(1.0/2.2));
        m = m + 0.035 * sin(6.28318 * m) * 0.25;
        float vig = 1.0 - uVignette * smoothstep(0.15, 0.95, r2 * 1.6);
        m *= vig * (1.0 - uFade);
        gl_FragColor = vec4(clamp(m, 0.0, 1.0), 1.0);
      }`, {
      tSrc: { value: null }, tBloom: { value: null }, tStreak: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0.08 }, uStreak: { value: 0.0 },
      uCA: { value: 0.006 }, uVignette: { value: 0.55 }, uFade: { value: 0 }, uFlash: { value: new THREE.Color(0, 0, 0) }, uAspect: { value: W / H },
    });

    // anamorphic streak: horizontal stretch of the bloom's bright core
    this.streak = mat(`varying vec2 vUv; uniform sampler2D tSrc; uniform vec2 uTexel;
      void main(){ vec3 s = vec3(0.0); float tw = 0.0;
        for (int i = -24; i <= 24; i++){ float w = exp(-abs(float(i)) * 0.11); s += texture2D(tSrc, vUv + vec2(float(i) * uTexel.x * 3.0, 0.0)).rgb * w; tw += w; }
        gl_FragColor = vec4(s / tw, 1.0); }`, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });

    this.grain = mat(`varying vec2 vUv; uniform sampler2D tSrc; uniform float uSeed; uniform float uAmount; uniform vec2 uRes;
      float h(vec3 p){ p = fract(p * vec3(443.897, 441.423, 437.195)); p += dot(p, p.yzx + 19.19); return fract((p.x + p.y) * p.z); }
      void main(){ vec3 c = texture2D(tSrc, vUv).rgb;
        vec2 px = floor(vUv * uRes / max(1.0, uRes.y / 1920.0));
        float g = (h(vec3(px, uSeed)) + h(vec3(px + 17.0, uSeed + 3.1)) - 1.0);
        float l = dot(c, vec3(0.299,0.587,0.114));
        c += g * uAmount * (0.35 + 0.65 * (1.0 - abs(l - 0.45) * 1.6));
        c += (h(vec3(px, uSeed + 7.7)) - 0.5) / 255.0;   // dither
        gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0); }`, { tSrc: { value: null }, uSeed: { value: 0 }, uAmount: { value: 0.035 }, uRes: { value: new THREE.Vector2(W, H) } });
  }

  // ---------------------------------------------------------------- per shot
  // shot.apply(time) must set scene + camera state; returns {camera, dof, haze, samples, shutter}
  renderShot(shot, t, fps, targetIndex, world) {
    const r = this.r;
    const samples = PREVIEW ? Math.min(2, shot.samples ?? 4) : (shot.samples ?? 4), shutter = shot.shutter ?? 0.5;
    r.setRenderTarget(this.rtAccum); r.setClearColor(0x000000, 1); r.clear();
    // centre sub-frame last so its depth buffer feeds DOF/haze/particles
    const order = [];
    for (let k = 0; k < samples; k++) order.push(k);
    const mid = Math.floor(samples / 2); order.splice(mid, 1); order.push(mid);
    let state;
    for (let j = 0; j < order.length; j++) {
      const k = order[j];
      const tk = t + (samples > 1 ? (k / (samples - 1) - 0.5) * shutter / fps : 0);
      state = shot.apply(tk);
      const cam = state.camera;
      cam.updateProjectionMatrix();
      // sub-pixel jitter (Halton 2,3) for anti-aliasing
      const jx = (halton(k + 1, 2) - 0.5) * 2 / this.W, jy = (halton(k + 1, 3) - 0.5) * 2 / this.H;
      cam.projectionMatrix.elements[8] += jx; cam.projectionMatrix.elements[9] += jy;
      cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
      world.update(tk, state);
      r.setRenderTarget(this.rtScene); r.setClearColor(0x000000, 1); r.clear();
      r.render(world.scene, cam);
      this.copyAdd.uniforms.tSrc.value = this.rtScene.texture; this.copyAdd.uniforms.uWeight.value = 1 / samples;
      this.fs.render(r, this.copyAdd, this.rtAccum);
    }
    const cam = state.camera;
    cam.updateProjectionMatrix();
    const dof = state.dof ?? { focus: 1, fstop: 8 };
    const f = cam.getFocalLength() / 1000;
    const s = dof.focus;
    // thin-lens CoC; magnification capped so close-up framings behave like a real macro lens
    const cocK = (f * f / (dof.fstop * Math.max(s - f, f))) / 0.036 * this.H;
    const haze = state.haze ?? { color: [0.02, 0.014, 0.009], density: 0.0 };
    for (const m of [this.prep, this.dofComposite]) {
      m.uniforms.uFocus.value = s; m.uniforms.uCocK.value = cocK;
      m.uniforms.uNear.value = cam.near; m.uniforms.uFar.value = cam.far;
      m.uniforms.uHaze.value.setRGB(...haze.color); m.uniforms.uHazeDensity.value = haze.density;
    }
    this.prep.uniforms.tColor.value = this.rtAccum.texture; this.prep.uniforms.tDepth.value = this.rtScene.depthTexture;
    this.fs.render(r, this.prep, this.rtHalf);
    this.bokeh.uniforms.tHalf.value = this.rtHalf.texture;
    this.fs.render(r, this.bokeh, this.rtHalfBlur);
    const out = this.rtShot[targetIndex];
    this.dofComposite.uniforms.tColor.value = this.rtAccum.texture; this.dofComposite.uniforms.tDepth.value = this.rtScene.depthTexture;
    this.dofComposite.uniforms.tBlur.value = this.rtHalfBlur.texture;
    this.fs.render(r, this.dofComposite, out);
    // particles over the DOF'd image (they carry their own bokeh)
    if (world.particles) {
      world.particles.prepare(cam, { focus: s, cocK, maxCoc: 40 * this.scale, depth: this.rtScene.depthTexture, res: [this.W, this.H] }, t, state);
      r.setRenderTarget(out); r.autoClear = false; r.render(world.particles.scene, cam); r.autoClear = true;
    }
    return { out, state };
  }

  // ---------------------------------------------------------------- per frame
  composeFrame({ a, b, transition, look, titles, t, frame }) {
    const r = this.r;
    let src = a.out;
    if (b) {
      const m = this.mix.uniforms;
      m.tA.value = a.out.texture; m.tB.value = b.out.texture; m.uP.value = transition.p;
      m.uType.value = { dissolve: 0, whip: 1, light: 2 }[transition.type] ?? 0;
      m.uDir.value.set(...(transition.dir ?? [1, 0])); m.uTime.value = t;
      this.fs.render(r, this.mix, this.rtMix); src = this.rtMix;
    }
    // bloom chain
    const d0 = this.bloomDown[0];
    this.bloomPre.uniforms.tSrc.value = src.texture; this.bloomPre.uniforms.uThreshold.value = look.bloomThreshold ?? 0.9;
    this.bloomPre.uniforms.uTexel.value.set(0.5 / this.W, 0.5 / this.H);
    this.fs.render(r, this.bloomPre, d0);
    for (let i = 1; i < this.bloomDown.length; i++) {
      const s = this.bloomDown[i - 1];
      this.down.uniforms.tSrc.value = s.texture; this.down.uniforms.uTexel.value.set(1 / s.width, 1 / s.height);
      this.fs.render(r, this.down, this.bloomDown[i]);
    }
    let prev = this.bloomDown[this.bloomDown.length - 1];
    for (let i = this.bloomDown.length - 2; i >= 0; i--) {
      this.up.uniforms.tSrc.value = prev.texture; this.up.uniforms.tBase.value = this.bloomDown[i].texture;
      this.up.uniforms.uTexel.value.set(1 / prev.width, 1 / prev.height); this.up.uniforms.uRadius.value = 1.0;
      this.fs.render(r, this.up, this.bloomUp[i]); prev = this.bloomUp[i];
    }
    // streak from a mid bloom level
    const sl = this.bloomDown[2];
    this.streak.uniforms.tSrc.value = sl.texture; this.streak.uniforms.uTexel.value.set(1 / sl.width, 1 / sl.height);
    this.fs.render(r, this.streak, this.rtStreak);
    const f = this.finish.uniforms;
    f.tSrc.value = src.texture; f.tBloom.value = this.bloomUp[0].texture; f.tStreak.value = this.rtStreak.texture;
    f.uExposure.value = look.exposure ?? 1; f.uBloom.value = look.bloom ?? 0.08; f.uStreak.value = look.streak ?? 0.0;
    f.uCA.value = (look.ca ?? 0.006); f.uVignette.value = look.vignette ?? 0.55; f.uFade.value = look.fade ?? 0;
    f.uFlash.value.setRGB(...(look.flash ?? [0, 0, 0]));
    this.fs.render(r, this.finish, this.rtDisplay);
    if (titles) titles.render(r, this.rtDisplay, t);
    this.grain.uniforms.tSrc.value = this.rtDisplay.texture; this.grain.uniforms.uSeed.value = (frame * 7.31) % 97.0;
    this.grain.uniforms.uAmount.value = look.grain ?? 0.035;
    this.fs.render(r, this.grain, this.rtOut);
    return this.rtOut;
  }
}

function halton(i, b) { let f = 1, r = 0; while (i > 0) { f /= b; r += f * (i % b); i = Math.floor(i / b); } return r; }
