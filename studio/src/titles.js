// Minimal luxury typography, composited in display space after the grade.
// Hebrew reveals right-to-left (reading direction); gold elements carry a moving foil sheen.
import * as THREE from 'three';

const VERT = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const FRAG = /* glsl */`
  varying vec2 vUv; uniform sampler2D tMap; uniform float uOpacity; uniform float uReveal; uniform float uDir;
  uniform float uBlur; uniform float uSheen; uniform float uGold; uniform vec3 uColor; uniform float uGlow;
  void main(){
    float a = texture2D(tMap, vUv, uBlur).a;
    // soft directional wipe (uDir=-1: right->left for Hebrew)
    float q = uDir < 0.0 ? 1.0 - vUv.x : vUv.x;          // distance from the edge where reading starts
    float w = 1.0 - smoothstep(uReveal * 1.25 - 0.25, uReveal * 1.25, q);
    vec3 gold = mix(vec3(0.60, 0.42, 0.20), vec3(1.0, 0.88, 0.62), smoothstep(0.1, 0.9, vUv.y));
    gold = mix(gold, vec3(0.80, 0.60, 0.32), 0.35 * sin(vUv.x * 9.0 + vUv.y * 4.0) * 0.5 + 0.15);
    float sheen = exp(-pow((vUv.x * 0.8 - vUv.y * 0.35 - uSheen) * 7.0, 2.0));
    vec3 col = mix(uColor, gold, uGold) + sheen * vec3(1.0, 0.92, 0.75) * 0.9 * uGold;
    float alpha = a * w * uOpacity;
    // faint glow from a blurrier mip
    float g = texture2D(tMap, vUv, uBlur + 4.0).a * uGlow * w * uOpacity;
    gl_FragColor = vec4(col * alpha + vec3(1.0, 0.8, 0.5) * g * 0.35, alpha + g * 0.15);
  }`;

export class Titles {
  constructor(W, H) {
    this.W = W; this.H = H;
    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1); // normalised screen space, y up
    this.items = {};
  }

  _quad(id, canvasOrTex, heightN, opts = {}) {
    const tex = canvasOrTex.isTexture ? canvasOrTex : new THREE.CanvasTexture(canvasOrTex);
    tex.colorSpace = THREE.NoColorSpace; tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 4; tex.needsUpdate = true;
    const img = canvasOrTex.isTexture ? canvasOrTex.image : canvasOrTex;
    const aspect = img.width / img.height;
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthTest: false, depthWrite: false,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      uniforms: {
        tMap: { value: tex }, uOpacity: { value: 0 }, uReveal: { value: 1 }, uDir: { value: opts.dir ?? -1 }, uBlur: { value: 0 },
        uSheen: { value: -1 }, uGold: { value: opts.gold ? 1 : 0 }, uColor: { value: new THREE.Color(...(opts.color ?? [0.95, 0.9, 0.82])) },
        uGlow: { value: opts.glow ?? 0.0 },
      },
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), m);
    mesh.userData = { aspect, heightN, x: 0.5, y: 0.5 };
    mesh.visible = false;
    this.scene.add(mesh); this.items[id] = mesh;
    return mesh;
  }

  addText(id, text, { font, size = 160, weight = 300, spacing = '0em', heightN, gold = false, color, dir, glow } = {}) {
    const c = document.createElement('canvas'); const ctx = c.getContext('2d');
    const f = `${weight} ${size}px ${font}`;
    ctx.font = f; ctx.letterSpacing = spacing;
    const isRTL = /[֐-׿]/.test(text);
    const m = ctx.measureText(text);
    const pad = size * 0.5;
    c.width = Math.ceil(m.width + pad * 2); c.height = Math.ceil(size * 1.6 + pad);
    ctx.font = f; ctx.letterSpacing = spacing; ctx.direction = isRTL ? 'rtl' : 'ltr';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    ctx.fillText(text, c.width / 2 + (isRTL ? 0 : parseFloat(spacing) * size * 0.5), c.height / 2);
    return this._quad(id, c, heightN ?? size / 1920 * 1.6 + pad / 1920, { gold, color, dir: dir ?? (isRTL ? -1 : 1), glow });
  }

  addImage(id, texture, heightN, opts) { return this._quad(id, texture, heightN, opts); }

  // state: { opacity, reveal, blur, x, y, scale, sheen }
  set(id, s) {
    const m = this.items[id]; if (!m) return;
    const u = m.material.uniforms;
    m.visible = (s.opacity ?? 0) > 0.001;
    u.uOpacity.value = s.opacity ?? 0; u.uReveal.value = s.reveal ?? 1; u.uBlur.value = s.blur ?? 0; u.uSheen.value = s.sheen ?? -1;
    const sc = s.scale ?? 1, h = m.userData.heightN * sc;
    const aspectScreen = this.W / this.H;
    m.scale.set(h * m.userData.aspect / aspectScreen, h, 1);
    m.position.set(s.x ?? 0.5, s.y ?? 0.5, 0);
  }

  hideAll() { for (const k in this.items) this.items[k].visible = false; }

  render(renderer, target) {
    renderer.setRenderTarget(target); renderer.autoClear = false;
    renderer.render(this.scene, this.camera); renderer.autoClear = true;
  }
}
