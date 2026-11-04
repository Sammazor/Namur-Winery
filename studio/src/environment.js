// NAMURA Wine Studio - the set: reflection environment, light rig, stone plinth,
// cellar backdrop with vine-leaf gobo, volumetric beams.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/examples/jsm/lights/RectAreaLightUniformsLib.js';

// ------------------------------------------------------------ reflection environment
// A virtual product-photography studio: long strip softboxes (the classic long vertical
// highlights on glass), a warm key panel, a soft overhead and a dark warm surround.
export function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  const dome = new THREE.Mesh(new THREE.SphereGeometry(10, 64, 32), new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader: `varying vec3 vP; void main(){
      vec3 d = normalize(vP);
      vec3 floorC = vec3(0.020, 0.013, 0.008), horizon = vec3(0.045, 0.030, 0.018), sky = vec3(0.012, 0.010, 0.009);
      vec3 c = d.y < 0.0 ? mix(horizon, floorC, smoothstep(0.0, -0.4, d.y)) : mix(horizon, sky, smoothstep(0.0, 0.6, d.y));
      gl_FragColor = vec4(c, 1.0); }`,
  }));
  env.add(dome);
  const panel = (w, h, pos, color, intensity, soft = true) => {
    const mat = new THREE.ShaderMaterial({
      side: THREE.DoubleSide,
      uniforms: { uC: { value: new THREE.Color(...color).multiplyScalar(intensity) }, uSoft: { value: soft ? 1 : 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec2 vUv; uniform vec3 uC; uniform float uSoft;
        void main(){ vec2 q = abs(vUv-0.5)*2.0; float f = (1.0-smoothstep(0.0,1.0,q.x))*(1.0-smoothstep(0.6,1.0,q.y));
          f = f * f * (3.0 - 2.0 * f) * 1.6;
          f = mix(1.0, f, uSoft); gl_FragColor = vec4(uC*f, 1.0);} `,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(...pos); m.lookAt(0, 0.6, 0); env.add(m); return m;
  };
  panel(1.6, 7, [-4.2, 1.2, 1.2], [1.0, 0.86, 0.70], 7.0);      // left strip (warm)
  panel(1.2, 7, [4.4, 1.2, 0.2], [1.0, 0.93, 0.85], 5.0);       // right strip
  panel(2.6, 2.0, [-2.6, 2.6, 3.2], [1.0, 0.82, 0.6], 3.2);     // front-left key panel
  panel(5, 5, [0, 6.5, 0], [1.0, 0.9, 0.8], 0.55);             // soft overhead
  panel(0.35, 6, [-1.6, 1.2, -4.0], [1.0, 0.78, 0.5], 5.0);    // back rims
  panel(0.35, 6, [1.7, 1.2, -4.0], [1.0, 0.78, 0.5], 4.0);
  panel(1.4, 0.18, [0.4, 0.2, 4.2], [1.0, 0.85, 0.7], 2.2);     // low front kicker (shoulder catch)

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.0, 0.1, 50);
  pmrem.dispose();
  return rt.texture;
}

// ------------------------------------------------------------ volumetric beam
const noiseGLSL = /* glsl */`
  float hash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
  float vnoise(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
    return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
               mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z); }
  float fbm3(vec3 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p*=2.03; a*=0.5; } return s; }
`;
export { noiseGLSL };

export function makeBeam({ length = 2.4, r0 = 0.03, r1 = 0.55, color = [1.0, 0.8, 0.55] } = {}) {
  const geo = new THREE.CylinderGeometry(r0, r1, length, 64, 24, true);
  geo.translate(0, -length / 2, 0); // apex at origin, beam points down -Y
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(...color) }, uIntensity: { value: 0.0 }, uTime: { value: 0 }, uLen: { value: length } },
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vAxial;
      uniform float uLen;
      void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vAxial = -position.y/uLen;
        vN = normalize(normalMatrix*normal); vec4 mv = viewMatrix*w; vV = -mv.xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: noiseGLSL + `varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vAxial;
      uniform vec3 uColor; uniform float uIntensity; uniform float uTime;
      void main(){
        float ndv = abs(dot(normalize(vN), normalize(vV)));
        float core = pow(ndv, 2.5);                       // thicker through the middle of the cone
        float along = smoothstep(0.0, 0.12, vAxial) * (1.0 - smoothstep(0.55, 1.0, vAxial));
        float n = fbm3(vW * 3.2 + vec3(0.0, -uTime * 0.12, uTime * 0.05));
        float dust = 0.55 + 0.9 * n * n;
        gl_FragColor = vec4(uColor * uIntensity * core * along * dust, 1.0);
      }`,
  });
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = 5;
  return m;
}

// ------------------------------------------------------------ the set
export function buildSet(renderer, textures) {
  RectAreaLightUniformsLib.init();
  const scene = new THREE.Scene();
  scene.environment = buildEnvironment(renderer);
  scene.background = new THREE.Color(0.0, 0.0, 0.0);

  // stone plinth
  const stoneMap = textures.stoneAlbedo, stoneBump = textures.stoneBump;
  for (const t of [stoneMap, stoneBump]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.6, 0.8); }
  const stone = new THREE.MeshPhysicalMaterial({
    map: stoneMap, bumpMap: stoneBump, bumpScale: 2.2, roughness: 0.78, metalness: 0,
    color: new THREE.Color(1.75, 1.5, 1.3), envMapIntensity: 0.6,
    clearcoat: 0.08, clearcoatRoughness: 0.5,
  });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.42, 0.62, 1, 1, 1), stone);
  plinth.position.set(0, -0.21, -0.04); plinth.receiveShadow = true; plinth.castShadow = true;
  scene.add(plinth);
  // chamfer light catch on the front edge
  const edge = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.006, 0.006), stone);
  edge.position.set(0, -0.002, 0.27); edge.rotation.x = Math.PI / 4; scene.add(edge);

  // cellar backdrop
  const plaster = textures.plaster; plaster.wrapS = plaster.wrapT = THREE.RepeatWrapping; plaster.repeat.set(2.5, 2.0);
  const wall = new THREE.Mesh(new THREE.PlaneGeometry(7, 5),
    new THREE.MeshStandardMaterial({ map: plaster, bumpMap: plaster, bumpScale: 1.5, roughness: 0.95, color: new THREE.Color(1.1, 0.95, 0.85), envMapIntensity: 0.25 }));
  wall.position.set(0, 1.2, -0.78); wall.receiveShadow = true; scene.add(wall);
  // dark floor beyond the plinth
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(8, 8),
    new THREE.MeshStandardMaterial({ color: 0x0b0806, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -0.42; floor.receiveShadow = true; scene.add(floor);

  // ---------------- light rig
  const L = {};
  L.key = new THREE.SpotLight(0xffd2a6, 0, 0, 0.42, 0.95, 2);
  L.key.position.set(-0.85, 0.85, 1.05); L.key.target.position.set(0, 0.13, 0);
  L.key.castShadow = true; L.key.shadow.mapSize.set(2048, 2048); L.key.shadow.bias = -0.0002; L.key.shadow.normalBias = 0.002;
  L.key.shadow.radius = 6; L.key.shadow.camera.near = 0.3; L.key.shadow.camera.far = 4;
  scene.add(L.key, L.key.target);

  L.fill = new THREE.SpotLight(0xc9d4ff, 0, 0, 0.6, 1.0, 2);
  L.fill.position.set(1.1, 0.4, 1.2); L.fill.target.position.set(0, 0.14, 0);
  scene.add(L.fill, L.fill.target);

  // backdrop gobo: dappled vine shadows on the cellar wall
  L.gobo = new THREE.SpotLight(0xffb873, 0, 0, 0.5, 0.6, 2);
  L.gobo.position.set(0.7, 1.6, 0.9); L.gobo.target.position.set(0.0, 0.42, -0.78);
  L.gobo.map = textures.gobo; L.gobo.castShadow = true; L.gobo.shadow.mapSize.set(1024, 1024);
  L.gobo.shadow.bias = -0.0005; L.gobo.shadow.radius = 4;
  scene.add(L.gobo, L.gobo.target);

  // top light (feeds the volumetric beam, catches capsules and shoulders)
  L.top = new THREE.SpotLight(0xffd9a8, 0, 0, 0.32, 0.85, 2);
  L.top.position.set(-0.35, 1.7, -0.35); L.top.target.position.set(0, 0.0, 0.0);
  L.top.castShadow = true; L.top.shadow.mapSize.set(1024, 1024); L.top.shadow.bias = -0.0003; L.top.shadow.radius = 5;
  scene.add(L.top, L.top.target);

  // strip lights (area): rims from behind + a moving sweep in front
  L.rimL = new THREE.RectAreaLight(0xffd0a0, 0, 0.12, 0.9); L.rimL.position.set(-0.32, 0.18, -0.45); L.rimL.lookAt(0, 0.16, 0.2);
  L.rimR = new THREE.RectAreaLight(0xffe2c0, 0, 0.12, 0.9); L.rimR.position.set(0.32, 0.18, -0.45); L.rimR.lookAt(0, 0.16, 0.2);
  L.sweep = new THREE.RectAreaLight(0xfff0dc, 0, 0.06, 0.75); L.sweep.position.set(0, 0.16, 0.42); L.sweep.lookAt(0, 0.16, 0);
  scene.add(L.rimL, L.rimR, L.sweep);

  // volumetric beams
  const beams = {
    top: makeBeam({ length: 2.3, r0: 0.03, r1: 0.42, color: [1.0, 0.78, 0.52] }),
    side: makeBeam({ length: 2.8, r0: 0.02, r1: 0.55, color: [1.0, 0.72, 0.45] }),
  };
  scene.add(beams.top, beams.side);

  return { scene, lights: L, beams, plinth, wall };
}

export function aimBeam(beam, from, to) {
  beam.position.copy(from);
  const dir = new THREE.Vector3().subVectors(to, from).normalize();
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
}
