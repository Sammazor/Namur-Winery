// NAMURA Wine Studio - bottle models.
// Bottles are lathe-turned from measured Bordeaux profiles (proportions taken from the
// original product photos). Labels are wrapped with the photo-extracted PBR textures.
import * as THREE from 'three';

export const BOTTLE_R = 0.0375;      // 75 mm Bordeaux body
const LABEL_R = BOTTLE_R + 0.00035;  // label paper sits on the glass

// ---------------------------------------------------------------- profiles
function bezier(p0, p1, p2, p3, n) {
  const c = new THREE.CubicBezierCurve(...[p0, p1, p2, p3].map(p => new THREE.Vector2(p[0], p[1])));
  return c.getPoints(n).map(v => [v.x, v.y]);
}

function bordeauxProfile(o) {
  const { H, R = BOTTLE_R, shoulderY, neckY, neckBaseR, neckTopR, punt = 0.013 } = o;
  const pts = [];
  // punt (push-up) and heel
  pts.push(...bezier([0.0001, punt], [0.016, punt], [0.024, 0.002], [0.0305, 0.0], 14));
  pts.push(...bezier([0.0305, 0.0], [0.0352, 0.0], [R, 0.0005], [R, 0.008], 10).slice(1));
  // straight body
  pts.push([R, shoulderY]);
  // shoulder
  pts.push(...bezier([R, shoulderY], [R, shoulderY + (neckY - shoulderY) * 0.55],
    [neckBaseR + 0.004, neckY - 0.010], [neckBaseR, neckY], 40).slice(1));
  // neck taper, lip ring and mouth
  pts.push([neckTopR, H - 0.009]);
  pts.push([neckTopR + 0.0012, H - 0.007], [neckTopR + 0.0012, H - 0.0015]);
  pts.push([neckTopR - 0.001, H], [0.0095, H], [0.0094, H - 0.02]);
  return pts.map(p => new THREE.Vector2(p[0], p[1]));
}

function neckRadiusAt(prof, y) {
  // radius of the glass profile at height y (scan the outer silhouette)
  for (let i = 0; i < prof.length - 1; i++) {
    const a = prof[i], b = prof[i + 1];
    if ((a.y - y) * (b.y - y) <= 0 && a.y !== b.y) return a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y);
  }
  return prof[prof.length - 1].x;
}

// ---------------------------------------------------------------- materials
const glassChunkVert = /* glsl */`
  varying float vLocalY;
`;

function makeGlass(tint) {
  const m = new THREE.MeshPhysicalMaterial({
    color: tint, roughness: 0.045, metalness: 0.0, ior: 1.52, specularIntensity: 1.0,
    envMapIntensity: 1.0,
  });
  // Backlit wine glow: dark wine-filled glass lets a deep garnet light through at grazing
  // angles when a light sits behind the bottle (classic wine-shot rim).
  m.userData.uniforms = {
    uGlow: { value: 0.0 }, uWine: { value: new THREE.Color(0.55, 0.035, 0.03) },
    uWineLevel: { value: 0.235 },
  };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + glassChunkVert)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vLocalY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vLocalY; uniform float uGlow; uniform vec3 uWine; uniform float uWineLevel;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float ndv = clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0);
          float rim = pow(1.0 - ndv, 5.0) * smoothstep(0.0, 0.08, ndv);   // thin garnet edge only
          float wine = smoothstep(uWineLevel + 0.004, uWineLevel - 0.004, vLocalY) * smoothstep(0.004, 0.02, vLocalY);
          totalEmissiveRadiance += uWine * uGlow * rim * wine;
        }`);
  };
  m.customProgramCacheKey = () => 'namura-glass';
  return m;
}

function makeLabelMaterial(tex, gold) {
  const m = new THREE.MeshPhysicalMaterial({
    map: tex.albedo, roughnessMap: tex.pbr, metalnessMap: tex.pbr, bumpMap: tex.bump,
    roughness: 1.0, metalness: 1.0, bumpScale: 0.35,
    envMapIntensity: 1.0,
  });
  m.userData.uniforms = { uGold: { value: gold } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n uniform vec3 uGold;')
      // hot-stamped foil: metallic regions take a true gold F0 instead of the photo colour
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        diffuseColor.rgb = mix(diffuseColor.rgb, uGold * 0.6 * (0.85 + 0.3 * diffuseColor.g), metalnessFactor);
        roughnessFactor = mix(roughnessFactor, max(roughnessFactor, 0.36), metalnessFactor);`);
  };
  m.customProgramCacheKey = () => 'namura-label';
  return m;
}

function makeWax() {
  const m = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0.009, 0.008, 0.008), roughness: 0.22, metalness: 0.0,
    side: THREE.DoubleSide,
  });
  m.userData.uniforms = { uWaxBottom: { value: 0.0 } };
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, m.userData.uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n varying vec2 vLatheUv; varying float vY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vLatheUv = uv; vY = position.y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n varying vec2 vLatheUv; varying float vY; uniform float uWaxBottom;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
        {
          // hand-dipped wax: irregular lower edge with a few longer drips
          float a = vLatheUv.x * 6.28318;
          float edge = 0.0025 * sin(a * 3.0 + 1.3) + 0.0018 * sin(a * 7.0 + 0.4) + 0.001 * sin(a * 17.0);
          edge -= 0.007 * pow(max(0.0, sin(a * 2.0 + 0.7)), 18.0) + 0.0045 * pow(max(0.0, sin(a * 5.0 + 2.1)), 30.0);
          if (vY < uWaxBottom + edge) discard;
        }`);
  };
  m.customProgramCacheKey = () => 'namura-wax';
  return m;
}

// ---------------------------------------------------------------- bottle specs
// Label heights come from the extracted textures (photo scale), label bottoms from the
// collection photo (fraction of bottle height).
export const BOTTLES = {
  haroeh: {
    profile: { H: 0.305, shoulderY: 0.200, neckY: 0.236, neckBaseR: 0.0160, neckTopR: 0.0146 },
    labelBottom: 0.036, closure: 'capsule', capsuleFrom: 0.270,
    capsule: { color: 0.016, metalness: 0.55, roughness: 0.26 },
    glass: [0.010, 0.012, 0.009], gold: [1.0, 0.70, 0.40],
  },
  hillel: {
    profile: { H: 0.300, shoulderY: 0.196, neckY: 0.233, neckBaseR: 0.0166, neckTopR: 0.0150 },
    labelBottom: 0.051, closure: 'wax', waxFrom: 0.262,
    glass: [0.008, 0.011, 0.009], gold: [1.0, 0.78, 0.42],
  },
  ivri: {
    profile: { H: 0.306, shoulderY: 0.201, neckY: 0.237, neckBaseR: 0.0160, neckTopR: 0.0146 },
    labelBottom: 0.048, closure: 'capsule', capsuleFrom: 0.266,
    capsule: { color: 0.02, metalness: 0.15, roughness: 0.55 },
    glass: [0.011, 0.011, 0.009], gold: [1.0, 0.74, 0.40],
  },
};

export function createBottle(name, tex, labelMeta) {
  const spec = BOTTLES[name];
  const g = new THREE.Group(); g.name = name;
  const prof = bordeauxProfile(spec.profile);

  const glassMat = makeGlass(new THREE.Color(...spec.glass));
  const glass = new THREE.Mesh(new THREE.LatheGeometry(prof, 160), glassMat);
  glass.castShadow = true; glass.receiveShadow = true;
  g.add(glass);

  // label band (front of the label faces +Z)
  const thMax = THREE.MathUtils.degToRad(labelMeta.theta_max_deg);
  const labelH = labelMeta.aspect_h_over_arc * LABEL_R * 2 * thMax;
  const labelMat = makeLabelMaterial(tex, new THREE.Color(...spec.gold));
  const label = new THREE.Mesh(
    new THREE.CylinderGeometry(LABEL_R, LABEL_R, labelH, 256, 1, true, -thMax, 2 * thMax), labelMat);
  label.position.y = spec.labelBottom + labelH / 2;
  label.castShadow = true; label.receiveShadow = true;
  g.add(label);

  const H = spec.profile.H;
  let closureMat;
  if (spec.closure === 'capsule') {
    const c = spec.capsule;
    closureMat = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(c.color, c.color, c.color * 0.95), metalness: c.metalness, roughness: c.roughness,
    });
    const pts = [];
    const y0 = spec.capsuleFrom;
    for (let i = 0; i <= 24; i++) {
      const y = y0 + (H - 0.003 - y0) * i / 24;
      pts.push(new THREE.Vector2(neckRadiusAt(prof, y) + 0.0009 + (i === 0 ? -0.0004 : 0), y));
    }
    const rTop = spec.profile.neckTopR + 0.0021;
    pts.push(...bezier([rTop, H - 0.003], [rTop, H + 0.0004], [rTop - 0.001, H + 0.0008], [rTop - 0.003, H + 0.0008], 8)
      .slice(1).map(p => new THREE.Vector2(p[0], p[1])));
    pts.push(new THREE.Vector2(0.0, H + 0.0006));
    const cap = new THREE.Mesh(new THREE.LatheGeometry(pts, 128), closureMat);
    cap.castShadow = true; g.add(cap);
  } else {
    // HILLEL: black wax dip with a rounded, slightly bulbous top
    closureMat = makeWax();
    const y0 = spec.waxFrom - 0.012;
    const pts = [];
    for (let i = 0; i <= 20; i++) {
      const y = y0 + (H - 0.016 - y0) * i / 20;
      const swell = 0.0011 + 0.0016 * Math.pow(i / 20, 2);
      pts.push(new THREE.Vector2(neckRadiusAt(prof, y) + swell, y));
    }
    const rb = pts[pts.length - 1].x;
    pts.push(...bezier([rb, H - 0.016], [rb + 0.0012, H - 0.004], [rb * 0.75, H + 0.0105], [0.0001, H + 0.011], 24)
      .slice(1).map(p => new THREE.Vector2(p[0], p[1])));
    const wax = new THREE.Mesh(new THREE.LatheGeometry(pts, 128), closureMat);
    closureMat.userData.uniforms.uWaxBottom.value = spec.waxFrom;
    wax.castShadow = true; g.add(wax);
  }

  // contact shadow (ambient occlusion where the bottle meets the stone)
  const ao = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.16), new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uStrength: { value: 0.85 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec2 vUv; uniform float uStrength;
      void main(){ float d = length(vUv-0.5)*2.0; float a = (1.0-smoothstep(0.42,1.0,d)) * uStrength;
        a = max(a, smoothstep(0.52,0.44,d)*0.95*uStrength); gl_FragColor = vec4(0.0,0.0,0.0,a); }`,
  }));
  ao.rotation.x = -Math.PI / 2; ao.position.y = 0.0006; ao.renderOrder = 1;
  g.add(ao);

  g.userData = { glassMat, labelMat, closureMat, height: H + (spec.closure === 'wax' ? 0.011 : 0.001), label, labelH };
  return g;
}
