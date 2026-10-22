import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

/*
 * Cricketer models: "Cricketers Pack (Low Poly)" by P3D Labs (Sketchfab), licensed
 * CC Attribution 4.0 — credit is shown in the match view and in docs/DATA_SOURCES.md.
 * Bundled at /models/cricketers.glb so the match never depends on an external URL.
 *
 * The pack ships as static (unrigged) meshes in an A-pose. We rig it at load time: a
 * skeleton is placed at measured joint positions and every vertex is weighted to the
 * nearest bone (blended across elbows, knees, neck and hips). Each frame the bones are
 * aimed along the limbs of the procedural driver rig (figure.ts), so every cricket action —
 * stance, shots, bowling, catches, throws, running — plays on the cricketer.
 *
 * Kits are repainted per franchise: the pack's texture is a simple layout (a shirt band with
 * lettering, then swatches for trim, accent, kit and skin), so each team gets its own
 * texture in its colours with its short name, and players get varied skin tones.
 */

const MODEL_URL = new URL(`${document.querySelector('base')?.getAttribute('href') ?? '/'}models/cricketers.glb`, location.origin).href;
export const MODEL_CREDIT = 'Cricketers Pack (Low Poly) by P3D Labs, CC BY 4.0';

/** Joint positions as fractions of the model height (measured from the pack's mesh). */
const J = {
  hips: [0, 0.31], neck: [0, 0.75], top: [0, 1.0],
  shoulder: [0.14, 0.64], elbow: [0.235, 0.49], hand: [0.3, 0.34],
  hip: [0.06, 0.3], knee: [0.06, 0.15], foot: [0.06, 0.0],
} as const;
const HEIGHT = 1.8;

type BoneName = 'Hips' | 'Spine' | 'Head' | 'HeadTop_End' | 'LeftArm' | 'LeftForeArm' | 'LeftHand' | 'RightArm' | 'RightForeArm' | 'RightHand'
  | 'LeftUpLeg' | 'LeftLeg' | 'LeftFoot' | 'RightUpLeg' | 'RightLeg' | 'RightFoot';
const ORDER: BoneName[] = ['Hips', 'Spine', 'Head', 'HeadTop_End', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'];
const PARENT: Record<BoneName, BoneName | null> = {
  Hips: null, Spine: 'Hips', Head: 'Spine', HeadTop_End: 'Head',
  LeftArm: 'Spine', LeftForeArm: 'LeftArm', LeftHand: 'LeftForeArm', RightArm: 'Spine', RightForeArm: 'RightArm', RightHand: 'RightForeArm',
  LeftUpLeg: 'Hips', LeftLeg: 'LeftUpLeg', LeftFoot: 'LeftLeg', RightUpLeg: 'Hips', RightLeg: 'RightUpLeg', RightFoot: 'RightLeg',
};

/** Model-space (metres) bind position of each bone; +x is the character's left. */
function bindPositions(): Record<BoneName, THREE.Vector3> {
  const v = (p: readonly number[], side = 1) => new THREE.Vector3(p[0] * side * HEIGHT, p[1] * HEIGHT, 0);
  return {
    Hips: v(J.hips), Spine: v(J.hips), Head: v(J.neck), HeadTop_End: v(J.top),
    LeftArm: v(J.shoulder), LeftForeArm: v(J.elbow), LeftHand: v(J.hand),
    RightArm: v(J.shoulder, -1), RightForeArm: v(J.elbow, -1), RightHand: v(J.hand, -1),
    LeftUpLeg: v(J.hip), LeftLeg: v(J.knee), LeftFoot: v(J.foot),
    RightUpLeg: v(J.hip, -1), RightLeg: v(J.knee, -1), RightFoot: v(J.foot, -1),
  };
}

export interface CricketerAsset {
  geometry: THREE.BufferGeometry;
}

let loading: Promise<CricketerAsset | null> | null = null;

export function loadCricketer(): Promise<CricketerAsset | null> {
  loading ??= new GLTFLoader().loadAsync(MODEL_URL).then((gltf) => {
    let mesh: THREE.Mesh | null = null;
    gltf.scene.traverse((o: any) => {
      if (!mesh && o.isMesh) mesh = o;
    });
    if (!mesh) return null;
    const g = (mesh as THREE.Mesh).geometry.clone();
    g.computeBoundingBox();
    const bb = g.boundingBox!;
    const h = bb.max.y - bb.min.y;
    g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    g.scale(HEIGHT / h, HEIGHT / h, HEIGHT / h);
    skin(g);
    return { geometry: g };
  }).catch(() => null);
  return loading;
}

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Weights every vertex to one or two bones by where it sits on the body. */
function skin(g: THREE.BufferGeometry) {
  const pos = g.attributes.position;
  const n = pos.count;
  const idx = new Uint16Array(n * 4);
  const wt = new Float32Array(n * 4);
  const I = (b: BoneName) => ORDER.indexOf(b);
  const bp = bindPositions();
  const set = (i: number, a: BoneName, b: BoneName, k: number) => {
    idx[i * 4] = I(a);
    idx[i * 4 + 1] = I(b);
    wt[i * 4] = 1 - k;
    wt[i * 4 + 1] = k;
  };
  const v = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i);
    const y = v.y / HEIGHT;
    const ax = Math.abs(v.x) / HEIGHT;
    const left = v.x >= 0;
    if (ax > 0.135 && y < 0.72 && y > 0.25) {
      // Arm: project onto shoulder → hand, blend upper/fore across the elbow.
      const sh = bp[left ? 'LeftArm' : 'RightArm'];
      const hd = bp[left ? 'LeftHand' : 'RightHand'];
      const d = hd.clone().sub(sh);
      const t = v.clone().sub(sh).dot(d) / d.lengthSq();
      if (t < 0.1) set(i, 'Spine', left ? 'LeftArm' : 'RightArm', smoothstep(-0.15, 0.1, t));
      else set(i, left ? 'LeftArm' : 'RightArm', left ? 'LeftForeArm' : 'RightForeArm', smoothstep(0.42, 0.58, t));
    } else if (y < 0.33) {
      // Leg: thigh above the knee, shin below, blended; the top blends into the hips.
      const up = left ? 'LeftUpLeg' : 'RightUpLeg';
      const lo = left ? 'LeftLeg' : 'RightLeg';
      if (y > 0.27) set(i, up, 'Hips', smoothstep(0.27, 0.33, y));
      else set(i, lo, up, smoothstep(0.12, 0.19, y));
    } else if (y > 0.7) {
      set(i, 'Spine', 'Head', smoothstep(0.7, 0.78, y));
    } else {
      set(i, 'Hips', 'Spine', smoothstep(0.31, 0.42, y));
    }
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
}

// ------------------------------------------------------------------ kits

const SKINS = ['#f3cfac', '#dcaa83', '#bd8a5f', '#93633f', '#5f3f29'];
const kitCache = new Map<string, THREE.MeshLambertMaterial>();

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(1 - k);
  return `#${c.getHexString()}`;
}

const lightness = (hex: string) => new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 }).l;

/** Repaints the pack's texture layout in a franchise's colours (cached per team and skin tone). */
export function kitMaterial(colors: [string, string], label: string, skinIndex: number): THREE.MeshLambertMaterial {
  const key = `${colors.join()}|${label}|${skinIndex}`;
  let m = kitCache.get(key);
  if (m) return m;
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d')!;
  const [primary, secondary] = colors;
  // Keep the lettering and trim readable when both team colours are light (or both dark).
  const accent = Math.abs(lightness(primary) - lightness(secondary)) < 0.18 ? (lightness(primary) > 0.5 ? shade(secondary, 0.55) : '#f2f2f2') : secondary;
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 1024, 1024);
  g.fillStyle = primary;
  g.fillRect(0, 90, 1024, 559);
  g.fillStyle = accent;
  g.font = `bold ${label.length > 3 ? 100 : 118}px Inter, Arial, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label.slice(0, 4), 287, 428);
  g.fillText(label.slice(0, 4), 783, 428);
  g.fillStyle = '#343434';
  g.fillRect(0, 770, 254, 254);
  g.fillStyle = accent;
  g.fillRect(254, 770, 254, 254);
  g.fillStyle = shade(primary, 0.12);
  g.fillRect(508, 770, 254, 254);
  g.fillStyle = SKINS[skinIndex % SKINS.length];
  g.fillRect(762, 770, 262, 254);
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; // glTF UV convention
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  m = new THREE.MeshLambertMaterial({ map: t });
  kitCache.set(key, m);
  return m;
}

// ------------------------------------------------------------------ one rigged cricketer

/** Driver segment (from joint → to point) and the bone that should follow it. */
export interface Segment {
  bone: string;
  child: string;
  from: THREE.Object3D;
  to: THREE.Object3D;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
const dir = new THREE.Vector3();
const cur = new THREE.Vector3();
const qWorld = new THREE.Quaternion();
const qParent = new THREE.Quaternion();
const qDelta = new THREE.Quaternion();

export class RiggedBody {
  root = new THREE.Group();
  private bones = new Map<string, THREE.Bone>();
  private axis = new Map<string, THREE.Vector3>();
  private hipsRest = new THREE.Vector3();
  head: THREE.Bone | null;
  rightHand: THREE.Bone | null;

  constructor(asset: CricketerAsset, material: THREE.Material, castShadow: boolean, private segments: Segment[]) {
    const bp = bindPositions();
    const list: THREE.Bone[] = [];
    for (const name of ORDER) {
      const b = new THREE.Bone();
      b.name = name;
      const parent = PARENT[name];
      b.position.copy(parent ? bp[name].clone().sub(bp[parent]) : bp[name]);
      if (parent) this.bones.get(parent)!.add(b);
      this.bones.set(name, b);
      list.push(b);
    }
    const mesh = new THREE.SkinnedMesh(asset.geometry, material);
    mesh.castShadow = castShadow;
    mesh.frustumCulled = false;
    mesh.add(this.bones.get('Hips')!);
    mesh.bind(new THREE.Skeleton(list));
    this.root.add(mesh);
    for (const s of segments) {
      const child = this.bones.get(s.child);
      if (child) this.axis.set(s.bone, child.position.clone().normalize());
    }
    this.hipsRest.copy(this.bones.get('Hips')!.position);
    this.head = this.bones.get('Head') ?? null;
    this.rightHand = this.bones.get('RightHand') ?? null;
  }

  /** Aims each bone along its driver segment (parents first), then sets the hips height. */
  sync(lift: number) {
    for (const b of this.bones.values()) b.quaternion.identity();
    const hips = this.bones.get('Hips')!;
    // The driver's pelvis is higher than this model's: scale crouches to its shorter legs.
    hips.position.copy(this.hipsRest);
    hips.position.y += lift * (this.hipsRest.y / 0.92);
    this.root.updateMatrixWorld(true);
    for (const s of this.segments) {
      const bone = this.bones.get(s.bone);
      const axis = this.axis.get(s.bone);
      if (!bone || !axis) continue;
      s.from.getWorldPosition(tmpA);
      s.to.getWorldPosition(tmpB);
      dir.subVectors(tmpB, tmpA);
      if (dir.lengthSq() < 1e-8) continue;
      dir.normalize();
      bone.getWorldQuaternion(qWorld);
      cur.copy(axis).applyQuaternion(qWorld).normalize();
      qDelta.setFromUnitVectors(cur, dir);
      qWorld.premultiply(qDelta);
      bone.parent!.getWorldQuaternion(qParent);
      bone.quaternion.copy(qParent.invert().multiply(qWorld));
      bone.updateMatrixWorld(true);
    }
  }
}
