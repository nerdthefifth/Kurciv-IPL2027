import * as THREE from 'three';

/*
 * The ground, built procedurally from original Kurciv modules (no third-party assets): PBR
 * materials, a GLSL outfield (mowing stripes, noise, wear and a rough boundary band), a GLSL
 * pitch whose cracks and footmarks grow with wear, a sky dome, sun or floodlights, tiered stands
 * in the venue's colours with an instanced crowd, a roof and lights in the venue's style, and a
 * skyline backdrop. World units are metres; +z points to the bowler's end (the engine's +y),
 * so the engine's (x, y) maps to (x, z).
 */

export type Quality = 'low' | 'medium' | 'high' | 'ultra';
export const STUMPS_Z = 10.06;
export const CREASE_Z = 8.84;

/** Everything a quality level changes, in one table. */
export const PRESETS: Record<Quality, { pixelRatio: number; antialias: boolean; shadows: boolean; shadowMap: number; crowdPerSeat: number; post: 'none' | 'grade' | 'bloom'; grassDetail: number; skyline: boolean; trail: number }> = {
  low: { pixelRatio: 1, antialias: false, shadows: false, shadowMap: 0, crowdPerSeat: 2, post: 'none', grassDetail: 0, skyline: false, trail: 0 },
  medium: { pixelRatio: 1.5, antialias: true, shadows: false, shadowMap: 0, crowdPerSeat: 5, post: 'grade', grassDetail: 1, skyline: true, trail: 10 },
  high: { pixelRatio: 2, antialias: true, shadows: true, shadowMap: 1024, crowdPerSeat: 8, post: 'bloom', grassDetail: 2, skyline: true, trail: 16 },
  ultra: { pixelRatio: 2.5, antialias: true, shadows: true, shadowMap: 2048, crowdPerSeat: 12, post: 'bloom', grassDetail: 3, skyline: true, trail: 24 },
};

export interface StadiumIdentity {
  tiers: 1 | 2 | 3;
  roof: 'none' | 'partial' | 'canopy';
  floodlights: 'pylon' | 'ring' | 'roofline';
  standColor: string;
  seatColors: [string, string];
  skyline: 'none' | 'city' | 'hills' | 'coast' | 'desert' | 'mountains';
  turf: string;
  shape: 'round' | 'oval' | 'square';
}

const DEFAULT_IDENTITY: StadiumIdentity = { tiers: 3, roof: 'partial', floodlights: 'pylon', standColor: '#d8d2c6', seatColors: ['#2f5f8f', '#c9c9c9'], skyline: 'city', turf: '#43893a', shape: 'round' };

export interface GroundVenue {
  boundaryStraight: number;
  boundarySquare: number;
  pitch?: { kind: string; wear: number; pace: number; spin: number };
  identity?: StadiumIdentity;
  climate?: string;
}

export interface Ground {
  group: THREE.Group;
  axes: { a: number; b: number };
  stumps: { striker: THREE.Group; bowler: THREE.Group };
  resetStumps: () => void;
  crowd: THREE.InstancedMesh | null;
  /** Pitch deterioration 0..1 (cracks and footmarks). */
  setWear: (w: number) => void;
  /** Light sources that should bloom (lamp heads). */
  glow: THREE.Object3D[];
}

// ------------------------------------------------------------------ shaders

const NOISE = /* glsl */ `
float kHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float kNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  float a = kHash(i), b = kHash(i + vec2(1.0, 0.0)), c = kHash(i + vec2(0.0, 1.0)), d = kHash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}
float kFbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 4; i++) { v += a * kNoise(p); p *= 2.03; a *= 0.5; } return v; }
`;

/** Outfield: mowing stripes in world space, fbm colour variation, wear near the square, rough band by the rope. */
function grassMaterial(turf: string, axes: { a: number; b: number }, detail: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ color: turf, roughness: 0.92, metalness: 0 });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAxes = { value: new THREE.Vector2(axes.a, axes.b) };
    shader.uniforms.uDetail = { value: detail };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vWorldPos;\nuniform vec2 uAxes;\nuniform float uDetail;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 wp = vWorldPos.xz;
        float stripe = step(0.5, fract(wp.x / 7.0));
        float cross = step(0.5, fract(wp.y / 7.0));
        float mow = mix(stripe, mix(stripe, cross, 0.35), step(1.5, uDetail));
        diffuseColor.rgb *= 0.9 + 0.12 * mow;
        if (uDetail > 0.5) {
          float n = kFbm(wp * 0.35);
          diffuseColor.rgb *= 0.88 + 0.22 * n;
          float blades = kNoise(wp * 9.0);
          diffuseColor.rgb *= 0.95 + 0.08 * blades;
        }
        // Worn, lighter grass around the square
        float sq = length(vec2(wp.x / 9.0, wp.y / 16.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.08, 1.05, 0.88), (1.0 - smoothstep(0.6, 1.1, sq)) * 0.5);
        // Rough band just inside the rope
        float e = length(vec2(wp.x / uAxes.x, wp.y / uAxes.y));
        diffuseColor.rgb *= 1.0 - 0.12 * smoothstep(0.9, 1.0, e);
      `);
  };
  return m;
}

/** Pitch: base tone by surface, rolled sheen, and cracks/footmarks that grow with wear. */
function pitchMaterial(kind: string): { mat: THREE.MeshStandardMaterial; uniforms: { uWear: { value: number } } } {
  const base = kind === 'green' ? '#a9a26a' : kind === 'dry' ? '#d2b37c' : kind === 'flat' ? '#c9b48a' : kind === 'slow' ? '#bea27a' : '#c6ad80';
  const m = new THREE.MeshStandardMaterial({ color: base, roughness: 0.78, metalness: 0 });
  const uniforms = { uWear: { value: 0 } };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWear = uniforms.uWear;
    shader.uniforms.uGreen = { value: kind === 'green' ? 1 : 0 };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vPitchUv;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvPitchUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec2 vPitchUv;\nuniform float uWear;\nuniform float uGreen;\n${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = vPitchUv * vec2(3.05, 24.0);
        float grass = kFbm(p * 2.0) * uGreen;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.55, 0.28), grass * 0.45 * (1.0 - uWear));
        diffuseColor.rgb *= 0.92 + 0.12 * kFbm(p * 3.5);
        // Cracks: thin ridges in a cellular-ish noise, deeper as the surface wears.
        float c = abs(kNoise(p * 2.6) - 0.5) + abs(kNoise(p * 5.3 + 7.0) - 0.5) * 0.5;
        float crack = 1.0 - smoothstep(0.015, 0.05 + 0.04 * uWear, c);
        diffuseColor.rgb *= 1.0 - crack * (0.15 + 0.45 * uWear);
        // Footmarks outside the batters' off stumps at both ends
        float fm = 0.0;
        for (int s = -1; s <= 1; s += 2) {
          vec2 q = p - vec2(1.52 + 0.35, 12.0 + float(s) * 9.6);
          fm += 1.0 - smoothstep(0.2, 0.9, length(q * vec2(1.0, 0.7)));
          vec2 r = p - vec2(1.52 - 0.35, 12.0 + float(s) * 9.6);
          fm += 1.0 - smoothstep(0.2, 0.9, length(r * vec2(1.0, 0.7)));
        }
        diffuseColor.rgb *= 1.0 - fm * 0.22 * uWear;
      `);
  };
  return { mat: m, uniforms };
}

/** Sky dome: vertical gradient, sun glow; day or floodlit evening, tinted by climate. */
function skyDome(evening: boolean, climate: string | undefined): THREE.Mesh {
  const top = evening ? new THREE.Color('#0b1222') : climate === 'arid' ? new THREE.Color('#5f8fc4') : climate === 'maritime' ? new THREE.Color('#7f9bb6') : new THREE.Color('#4d84c7');
  const horizon = evening ? new THREE.Color('#2b2f4a') : climate === 'arid' ? new THREE.Color('#e9d7b8') : climate === 'maritime' ? new THREE.Color('#cfd8de') : new THREE.Color('#cfe0ee');
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTop: { value: top }, uHorizon: { value: horizon }, uSun: { value: new THREE.Vector3(-0.4, evening ? -0.2 : 0.6, 0.3).normalize() }, uEvening: { value: evening ? 1 : 0 } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform float uEvening; varying vec3 vDir;
      void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
        float sun = pow(max(dot(vDir, uSun), 0.0), 220.0) * (1.0 - uEvening);
        float halo = pow(max(dot(vDir, uSun), 0.0), 8.0) * 0.25 * (1.0 - uEvening);
        col += vec3(1.0, 0.92, 0.75) * (sun + halo);
        // Stadium light spill on the evening horizon
        col += vec3(0.35, 0.3, 0.22) * uEvening * (1.0 - smoothstep(0.0, 0.25, h)) * 0.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), mat);
}

function stumpSet(): THREE.Group {
  const g = new THREE.Group();
  const stump = new THREE.CylinderGeometry(0.018, 0.018, 0.71, 8);
  const bail = new THREE.CylinderGeometry(0.01, 0.01, 0.11, 6);
  const m = new THREE.MeshStandardMaterial({ color: '#f4ecd8', roughness: 0.45 });
  for (const x of [-0.115, 0, 0.115]) {
    const s = new THREE.Mesh(stump, m);
    s.position.set(x, 0.355, 0);
    s.castShadow = true;
    s.userData.base = { x, y: 0.355 };
    g.add(s);
  }
  for (const x of [-0.057, 0.057]) {
    const b = new THREE.Mesh(bail, m);
    b.rotation.z = Math.PI / 2;
    b.position.set(x, 0.72, 0);
    b.userData.base = { x, y: 0.72 };
    b.userData.bail = true;
    g.add(b);
  }
  return g;
}

/** Simple skyline silhouettes beyond the stands, in the venue's setting. */
function skyline(group: THREE.Group, kind: StadiumIdentity['skyline'], a: number, b: number, evening: boolean, rand: () => number) {
  if (kind === 'none') return;
  const far = Math.max(a, b) + 120;
  const tone = evening ? '#1a2033' : kind === 'desert' ? '#c9ae84' : kind === 'mountains' ? '#6d7d91' : kind === 'hills' ? '#5b7a53' : '#8a94a3';
  const mat = new THREE.MeshStandardMaterial({ color: tone, roughness: 1, fog: true });
  if (kind === 'city') {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const win = new THREE.MeshBasicMaterial({ color: evening ? '#ffd98a' : '#a9b6c8' });
    for (let i = 0; i < 70; i++) {
      const t = rand() * Math.PI * 2;
      const h = 15 + rand() * 55;
      const w = 8 + rand() * 14;
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(w, h, w);
      m.position.set(Math.cos(t) * (far + rand() * 60), h / 2, Math.sin(t) * (far + rand() * 60));
      group.add(m);
      if (evening && rand() < 0.5) {
        const lit = new THREE.Mesh(geo, win);
        lit.scale.set(w * 1.01, h * 0.2, w * 1.01);
        lit.position.set(m.position.x, h * (0.3 + rand() * 0.5), m.position.z);
        group.add(lit);
      }
    }
  } else if (kind === 'coast') {
    const sea = new THREE.Mesh(new THREE.RingGeometry(far - 20, far + 260, 64), new THREE.MeshStandardMaterial({ color: evening ? '#0d1a2b' : '#3f7fa6', roughness: 0.2, metalness: 0.1 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -0.5;
    group.add(sea);
  } else {
    const cone = new THREE.ConeGeometry(1, 1, 7);
    const n = kind === 'mountains' ? 26 : 40;
    for (let i = 0; i < n; i++) {
      const t = rand() * Math.PI * 2;
      const h = kind === 'mountains' ? 70 + rand() * 110 : kind === 'desert' ? 8 + rand() * 14 : 20 + rand() * 30;
      const w = kind === 'desert' ? 60 + rand() * 40 : 40 + rand() * 40;
      const m = new THREE.Mesh(cone, mat);
      m.scale.set(w, h, w);
      m.position.set(Math.cos(t) * (far + 40 + rand() * 80), h / 2 - 2, Math.sin(t) * (far + 40 + rand() * 80));
      group.add(m);
    }
  }
}

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619) >>> 0;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

export function buildGround(
  scene: THREE.Scene, venue: GroundVenue, colors: [string, string], quality: Quality, opts: { evening?: boolean; seed?: string } = {},
): Ground {
  const preset = PRESETS[quality];
  const id = venue.identity ?? DEFAULT_IDENTITY;
  const evening = !!opts.evening;
  const rand = seeded(opts.seed ?? 'ground');
  const group = new THREE.Group();
  scene.add(group);
  const a = venue.boundarySquare;
  const b = venue.boundaryStraight - 8.8;
  const axes = { a, b };
  const glow: THREE.Object3D[] = [];

  // Sky, fog and light
  scene.add(skyDome(evening, venue.climate));
  scene.background = new THREE.Color(evening ? '#0b1222' : '#cfe0ee');
  scene.fog = new THREE.Fog(evening ? '#141a2c' : venue.climate === 'arid' ? '#e3d3b6' : '#c7d6e3', 220, 520);
  scene.add(new THREE.HemisphereLight(evening ? '#9fb3d9' : '#d6e6ff', evening ? '#1f2a1c' : '#3a5a2c', evening ? 0.55 : 0.9));
  const key = new THREE.DirectionalLight(evening ? '#f2f4ff' : '#fff1d8', evening ? 1.9 : 2.6);
  key.position.set(evening ? 20 : -40, evening ? 90 : 80, evening ? -30 : 30);
  if (preset.shadows) {
    key.castShadow = true;
    key.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
    key.shadow.bias = -0.0004;
    const s = key.shadow.camera as THREE.OrthographicCamera;
    s.left = -45; s.right = 45; s.top = 45; s.bottom = -45; s.near = 10; s.far = 220;
  }
  scene.add(key);
  if (evening && (quality === 'high' || quality === 'ultra')) {
    // A second floodlit key from the opposite side softens player shadows, as under real lights.
    const fill = new THREE.DirectionalLight('#eef2ff', 0.9);
    fill.position.set(-30, 80, 40);
    scene.add(fill);
  }

  // Outfield
  const outer = new THREE.Mesh(new THREE.CircleGeometry(1, 96), grassMaterial(id.turf, axes, preset.grassDetail));
  outer.rotation.x = -Math.PI / 2;
  outer.scale.set(a + 14, b + 14, 1);
  outer.receiveShadow = preset.shadows;
  group.add(outer);

  // Boundary rope and advertising boards
  const curve = new THREE.EllipseCurve(0, 0, a, b, 0, Math.PI * 2, false, 0);
  const pts = curve.getPoints(160).map((p) => new THREE.Vector3(p.x, 0.06, p.y));
  group.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.09, 6, true), new THREE.MeshStandardMaterial({ color: colors[0], roughness: 0.6 })));
  const boardPts = new THREE.EllipseCurve(0, 0, a + 4, b + 4, 0, Math.PI * 2, false, 0).getPoints(48);
  const boardGeo = new THREE.BoxGeometry(1, 0.9, 0.15);
  const boardMats = [colors[0], '#1b2233', colors[1]].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, emissive: evening ? c : '#000000', emissiveIntensity: evening ? 0.25 : 0 }));
  for (let i = 0; i < boardPts.length; i++) {
    const p = boardPts[i];
    const q = boardPts[(i + 1) % boardPts.length];
    const m = new THREE.Mesh(boardGeo, boardMats[i % 3]);
    m.position.set((p.x + q.x) / 2, 0.45, (p.y + q.y) / 2);
    m.scale.x = Math.hypot(q.x - p.x, q.y - p.y);
    m.rotation.y = -Math.atan2(q.y - p.y, q.x - p.x);
    group.add(m);
  }

  // Fielding circle
  const dash = new THREE.PlaneGeometry(0.9, 0.12);
  const white = new THREE.MeshBasicMaterial({ color: '#e8efe6', transparent: true, opacity: 0.6 });
  const r = 27.43;
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const m = new THREE.Mesh(dash, white);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -t + Math.PI / 2;
    m.position.set(Math.cos(t) * r, 0.02, Math.sin(t) * r + (Math.sin(t) >= 0 ? STUMPS_Z : -STUMPS_Z));
    group.add(m);
  }

  // Pitch and creases
  const pm = pitchMaterial(venue.pitch?.kind ?? 'balanced');
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 24, 1, 1), pm.mat);
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = 0.01;
  pitch.receiveShadow = preset.shadows;
  group.add(pitch);
  const line = (w: number, x: number, z: number, along = false) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(along ? 0.05 : w, along ? w : 0.05), new THREE.MeshBasicMaterial({ color: '#f5f5f0' }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.015, z);
    group.add(m);
  };
  for (const s of [1, -1]) {
    line(3.66, 0, s * CREASE_Z);
    line(2.64, 0, s * STUMPS_Z);
    for (const x of [1.32, -1.32]) line(2.44, x, s * (CREASE_Z + 0.6), true);
  }
  const striker = stumpSet();
  striker.position.z = -STUMPS_Z;
  const bowler = stumpSet();
  bowler.position.z = STUMPS_Z;
  group.add(striker, bowler);
  const resetStumps = () => {
    for (const set of [striker, bowler]) for (const c of set.children) {
      const base = c.userData.base;
      c.position.set(base.x, base.y, 0);
      c.rotation.set(0, 0, c.userData.bail ? Math.PI / 2 : 0);
    }
  };

  // Sight screens
  const screenMat = new THREE.MeshStandardMaterial({ color: '#eef1f4', roughness: 0.8 });
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(14, 6, 0.5), screenMat);
    m.position.set(0, 3, s * (b + 9));
    group.add(m);
  }

  // Stands in the venue's identity: tiers, stand tone, seat colours, roof style
  const standMat = new THREE.MeshStandardMaterial({ color: id.standColor, roughness: 0.85 });
  const seatMats = id.seatColors.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  const roofMat = new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.35, metalness: 0.4, transparent: id.roof === 'canopy', opacity: id.roof === 'canopy' ? 0.85 : 1 });
  const segs = id.shape === 'square' ? 40 : 36;
  const seatPositions: THREE.Vector3[] = [];
  const squareness = id.shape === 'square' ? 0.18 : 0;
  const ring = (t: number, ra: number, rb: number) => {
    const c = Math.cos(t);
    const s = Math.sin(t);
    const k = 1 + squareness * (Math.abs(c * s) * 2);
    return new THREE.Vector2(c * ra * k, s * rb * k);
  };
  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * Math.PI * 2;
    const t1 = ((i + 1) / segs) * Math.PI * 2;
    const tm = (t0 + t1) / 2;
    if (Math.abs(Math.cos(tm)) < 0.12) continue; // sight-screen gaps (straight ends)
    for (let tier = 0; tier < id.tiers; tier++) {
      const ra = a + 12 + tier * 6;
      const rb = b + 12 + tier * 6;
      const p0 = ring(t0, ra, rb);
      const p1 = ring(t1, ra, rb);
      const len = p0.distanceTo(p1);
      const h = 2.5 + tier * 3;
      const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.4, h, 5.5), standMat);
      m.position.set((p0.x + p1.x) / 2, h / 2, (p0.y + p1.y) / 2);
      m.rotation.y = -Math.atan2(p1.y - p0.y, p1.x - p0.x);
      m.castShadow = preset.shadows && quality === 'ultra';
      group.add(m);
      // Seat band on the front face in the venue colours
      const band = new THREE.Mesh(new THREE.BoxGeometry(len + 0.2, 0.5, 5.6), seatMats[(i + tier) % 2]);
      band.position.set(m.position.x, h - 0.1, m.position.z);
      band.rotation.y = m.rotation.y;
      group.add(band);
      for (let k = 0; k < 10; k++) {
        const f = (k + 0.5) / 10;
        seatPositions.push(new THREE.Vector3(p0.x + (p1.x - p0.x) * f, h + 0.4, p0.y + (p1.y - p0.y) * f));
      }
    }
    const roofEvery = id.roof === 'canopy' ? 1 : id.roof === 'partial' ? 3 : 0;
    if (roofEvery && i % roofEvery === 0) {
      const span = roofEvery === 1 ? 1.05 : 3;
      const top = 2.5 + (id.tiers - 1) * 3 + 6;
      const tm3 = roofEvery === 1 ? tm : tm + (Math.PI * 2) / segs;
      const roof = new THREE.Mesh(new THREE.BoxGeometry(((2 * Math.PI * (a + 12 + id.tiers * 6)) / segs) * span, 0.4, 12), roofMat);
      const at = ring(tm3, a + 12 + id.tiers * 6, b + 12 + id.tiers * 6);
      roof.position.set(at.x, top, at.y);
      roof.rotation.y = -tm3 + Math.PI / 2;
      roof.rotation.z = 0;
      group.add(roof);
      if (id.floodlights === 'roofline' && i % 2 === 0) {
        const lamp = new THREE.Mesh(new THREE.BoxGeometry(4, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: evening ? '#fffbe8' : '#d9dde3' }));
        lamp.position.set(at.x * 0.97, top - 0.4, at.y * 0.97);
        lamp.rotation.y = roof.rotation.y;
        group.add(lamp);
        if (evening) glow.push(lamp);
      }
    }
  }

  // Crowd: one instanced mesh; density by quality, colours from both teams and the venue
  let crowd: THREE.InstancedMesh | null = null;
  const perSeat = preset.crowdPerSeat;
  const count = seatPositions.length * perSeat;
  if (count) {
    crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.7, 0.35), new THREE.MeshStandardMaterial({ roughness: 0.9 }), count);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const palette = [colors[0], colors[1], '#e5e7eb', '#1f2937', id.seatColors[0], colors[0]];
    let n = 0;
    for (const p of seatPositions) {
      for (let k = 0; k < perSeat; k++) {
        const jitter = (rand() - 0.5) * 3;
        const dir = Math.atan2(p.z, p.x);
        m.makeTranslation(p.x + Math.cos(dir + Math.PI / 2) * jitter, p.y + rand() * 0.2, p.z + Math.sin(dir + Math.PI / 2) * jitter);
        crowd.setMatrixAt(n, m);
        crowd.setColorAt(n, c.set(palette[Math.floor(rand() * palette.length)]));
        n++;
      }
    }
    crowd.instanceMatrix.needsUpdate = true;
    group.add(crowd);
  }

  // Floodlights in the venue's style
  const lampMat = new THREE.MeshBasicMaterial({ color: evening ? '#fffbe8' : '#e4e7ec' });
  if (id.floodlights === 'pylon') {
    const poleGeo = new THREE.CylinderGeometry(0.5, 0.8, 40, 8);
    const headGeo = new THREE.BoxGeometry(6, 3.5, 1);
    const pole = new THREE.MeshStandardMaterial({ color: '#6b7280', roughness: 0.5, metalness: 0.6 });
    for (const t of [0.6, 2.55, 3.75, 5.7]) {
      const x = Math.cos(t) * (a + 40);
      const z = Math.sin(t) * (b + 40);
      const p = new THREE.Mesh(poleGeo, pole);
      p.position.set(x, 20, z);
      const h = new THREE.Mesh(headGeo, lampMat);
      h.position.set(x, 41, z);
      h.lookAt(0, 0, 0);
      group.add(p, h);
      if (evening) glow.push(h);
    }
  } else if (id.floodlights === 'ring') {
    const top = 2.5 + (id.tiers - 1) * 3 + 9;
    const ringGeo = new THREE.TorusGeometry(1, 0.012, 6, 96);
    const halo = new THREE.Mesh(ringGeo, lampMat);
    halo.rotation.x = Math.PI / 2;
    halo.scale.set(a + 16 + id.tiers * 6, b + 16 + id.tiers * 6, 40);
    halo.position.y = top;
    group.add(halo);
    if (evening) glow.push(halo);
  }

  if (preset.skyline) skyline(group, id.skyline, a, b, evening, rand);

  return {
    group, axes, stumps: { striker, bowler }, resetStumps, crowd, glow,
    setWear: (w: number) => {
      pm.uniforms.uWear.value = Math.max(0, Math.min(1, w));
    },
  };
}
