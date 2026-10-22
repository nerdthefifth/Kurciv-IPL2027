import * as THREE from 'three';
import { RiggedBody, kitMaterial, type CricketerAsset, type Segment } from './rigged';

/*
 * Procedural cricketers. No downloaded model: a small rig of shared capsules and spheres,
 * team-coloured, with a few seeded variations (skin tone, build, helmet or cap) so a player
 * looks the same all match. Poses are joint angles; actions are functions of time that
 * return a pose, blended for smooth transitions.
 */

export type Joint = 'spine' | 'head' | 'lShoulder' | 'lElbow' | 'rShoulder' | 'rElbow' | 'lHip' | 'lKnee' | 'rHip' | 'rKnee';
export type Pose = Partial<Record<Joint, [number, number, number]>> & { lift?: number; lean?: number };

const SKIN = ['#f1c9a5', '#d9a47a', '#b97f54', '#8d5a3a', '#5e3b26'].map((c) => new THREE.MeshLambertMaterial({ color: c }));
const WHITE = new THREE.MeshLambertMaterial({ color: '#f2f2ee' });
const PAD = new THREE.MeshLambertMaterial({ color: '#fbfbf7' });
const WOOD = new THREE.MeshLambertMaterial({ color: '#d8b77e' });
const GRIP = new THREE.MeshLambertMaterial({ color: '#202020' });
const SHOE = new THREE.MeshLambertMaterial({ color: '#e9e9e9' });
const GLOVE = new THREE.MeshLambertMaterial({ color: '#f0f0f0' });

const G = {
  torso: new THREE.CapsuleGeometry(0.16, 0.36, 3, 8),
  hips: new THREE.CapsuleGeometry(0.14, 0.12, 3, 8),
  head: new THREE.SphereGeometry(0.115, 10, 8),
  helmet: new THREE.SphereGeometry(0.135, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  peak: new THREE.BoxGeometry(0.16, 0.015, 0.1),
  grill: new THREE.TorusGeometry(0.11, 0.008, 4, 10, Math.PI),
  upper: new THREE.CapsuleGeometry(0.05, 0.22, 3, 6),
  fore: new THREE.CapsuleGeometry(0.043, 0.2, 3, 6),
  hand: new THREE.SphereGeometry(0.05, 6, 5),
  thigh: new THREE.CapsuleGeometry(0.075, 0.3, 3, 6),
  shin: new THREE.CapsuleGeometry(0.06, 0.32, 3, 6),
  pad: new THREE.BoxGeometry(0.16, 0.5, 0.12),
  shoe: new THREE.BoxGeometry(0.1, 0.07, 0.24),
  blade: new THREE.BoxGeometry(0.105, 0.56, 0.04),
  handle: new THREE.CylinderGeometry(0.018, 0.018, 0.28, 6),
  glove: new THREE.SphereGeometry(0.07, 6, 5),
};

const matCache = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: string) {
  let m = matCache.get(color);
  if (!m) matCache.set(color, (m = new THREE.MeshLambertMaterial({ color })));
  return m;
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

export type Kit = 'bat' | 'field' | 'keeper';

export class Figure {
  root = new THREE.Group();
  private j = {} as Record<Joint, THREE.Group>;
  private hipsG = new THREE.Group();
  bat: THREE.Group | null = null;
  rightHand = new THREE.Object3D();
  id: string;
  kit: Kit;
  private current: Pose = {};
  colors: [string, string];
  body: RiggedBody | null = null;
  private batView: THREE.Object3D | null = null;
  private points = {} as Record<'lHand' | 'rHand' | 'lFoot' | 'rFoot' | 'headTop', THREE.Object3D>;

  label: string;
  private skinIndex: number;

  constructor(id: string, colors: [string, string], kit: Kit, castShadow: boolean, label = '') {
    this.id = id;
    this.kit = kit;
    this.colors = colors;
    this.label = label;
    const h = hash(id);
    this.skinIndex = Math.floor(h * SKIN.length);
    const skin = SKIN[Math.floor(h * SKIN.length)];
    const shirt = mat(colors[0]);
    const trim = mat(colors[1]);
    const scale = 0.94 + hash(`${id}s`) * 0.12;
    this.root.scale.setScalar(scale);
    const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, pos: [number, number, number], rot?: [number, number, number]) => {
      const x = new THREE.Mesh(g, m);
      x.position.set(...pos);
      if (rot) x.rotation.set(...rot);
      x.castShadow = castShadow;
      x.userData.shared = true;
      parent.add(x);
      return x;
    };
    const group = (parent: THREE.Object3D, pos: [number, number, number]) => {
      const g = new THREE.Group();
      g.position.set(...pos);
      parent.add(g);
      return g;
    };
    // Pelvis at hip height; everything hangs from it.
    this.hipsG.position.y = 0.92;
    this.root.add(this.hipsG);
    mesh(G.hips, kit === 'field' ? shirt : WHITE, this.hipsG, [0, 0, 0], [0, 0, Math.PI / 2]);
    this.j.spine = group(this.hipsG, [0, 0.08, 0]);
    mesh(G.torso, shirt, this.j.spine, [0, 0.3, 0]);
    mesh(G.peak, trim, this.j.spine, [0, 0.52, 0.12]).scale.set(1.8, 1, 0.3);
    this.j.head = group(this.j.spine, [0, 0.66, 0]);
    mesh(G.head, skin, this.j.head, [0, 0.08, 0]);
    if (kit === 'bat' || hash(`${id}h`) < 0.25) {
      mesh(G.helmet, kit === 'bat' ? trim : shirt, this.j.head, [0, 0.1, 0]);
      if (kit === 'bat') mesh(G.grill, GRIP, this.j.head, [0, 0.06, 0.07], [Math.PI / 2, 0, 0]);
    } else {
      mesh(G.helmet, trim, this.j.head, [0, 0.12, -0.005]).scale.set(1, 0.6, 1);
      mesh(G.peak, trim, this.j.head, [0, 0.14, 0.11]);
    }
    for (const side of ['l', 'r'] as const) {
      const sx = side === 'l' ? 1 : -1;
      const sh = group(this.j.spine, [0.21 * sx, 0.5, 0]);
      mesh(G.upper, shirt, sh, [0, -0.14, 0]);
      const el = group(sh, [0, -0.29, 0]);
      mesh(G.fore, skin, el, [0, -0.12, 0]);
      mesh(kit === 'bat' || kit === 'keeper' ? G.glove : G.hand, kit === 'bat' || kit === 'keeper' ? GLOVE : skin, el, [0, -0.26, 0]);
      this.j[`${side}Shoulder`] = sh;
      this.j[`${side}Elbow`] = el;
      const hip = group(this.hipsG, [0.1 * sx, -0.04, 0]);
      mesh(G.thigh, kit === 'field' ? WHITE : WHITE, hip, [0, -0.2, 0]);
      const knee = group(hip, [0, -0.42, 0]);
      if (kit === 'bat' || kit === 'keeper') mesh(G.pad, PAD, knee, [0, -0.18, 0.03]);
      else mesh(G.shin, WHITE, knee, [0, -0.2, 0]);
      mesh(G.shoe, SHOE, knee, [0, -0.43, 0.05]);
      this.j[`${side}Hip`] = hip;
      this.j[`${side}Knee`] = knee;
    }
    this.j.rElbow.add(this.rightHand);
    // Invisible end points the rigged body aims its forearms, shins and head at.
    const point = (parent: THREE.Object3D, y: number) => {
      const o = new THREE.Object3D();
      o.position.set(0, y, 0);
      parent.add(o);
      return o;
    };
    this.points = { lHand: point(this.j.lElbow, -0.27), rHand: point(this.j.rElbow, -0.27), lFoot: point(this.j.lKnee, -0.43), rFoot: point(this.j.rKnee, -0.43), headTop: point(this.j.head, 0.25) };
    this.rightHand.position.set(0, -0.27, 0);
    if (kit === 'bat') {
      // The bat hangs from the lower (right) hand.
      const bat = new THREE.Group();
      mesh(G.handle, GRIP, bat, [0, -0.1, 0]);
      mesh(G.blade, WOOD, bat, [0, -0.5, 0]);
      bat.position.set(0, -0.27, 0.02);
      this.j.rElbow.add(bat);
      this.bat = bat;
    }
    this.setPose({});
  }

  /** Applies a pose (missing joints return to neutral). */
  setPose(p: Pose) {
    this.current = p;
    for (const k of Object.keys(this.j) as Joint[]) {
      const r = p[k] ?? [0, 0, 0];
      this.j[k].rotation.set(r[0], r[1], r[2]);
    }
    this.hipsG.position.y = 0.92 + (p.lift ?? 0);
    this.hipsG.rotation.x = p.lean ?? 0;
  }

  /** Swaps the simple body for a rigged, skinned model driven by this figure's joints. */
  attach(asset: CricketerAsset, castShadow: boolean) {
    if (this.body) return;
    const segs: Segment[] = [
      { bone: 'Spine', child: 'Spine1', from: this.j.spine, to: this.j.head },
      { bone: 'Head', child: 'HeadTop_End', from: this.j.head, to: this.points.headTop },
      { bone: 'LeftArm', child: 'LeftForeArm', from: this.j.lShoulder, to: this.j.lElbow },
      { bone: 'LeftForeArm', child: 'LeftHand', from: this.j.lElbow, to: this.points.lHand },
      { bone: 'RightArm', child: 'RightForeArm', from: this.j.rShoulder, to: this.j.rElbow },
      { bone: 'RightForeArm', child: 'RightHand', from: this.j.rElbow, to: this.points.rHand },
      { bone: 'LeftUpLeg', child: 'LeftLeg', from: this.j.lHip, to: this.j.lKnee },
      { bone: 'LeftLeg', child: 'LeftFoot', from: this.j.lKnee, to: this.points.lFoot },
      { bone: 'RightUpLeg', child: 'RightLeg', from: this.j.rHip, to: this.j.rKnee },
      { bone: 'RightLeg', child: 'RightFoot', from: this.j.rKnee, to: this.points.rFoot },
    ];
    let body: RiggedBody;
    try {
      body = new RiggedBody(asset, kitMaterial(this.colors, this.label, this.skinIndex), castShadow, segs);
    } catch {
      return;
    }
    this.root.traverse((o: any) => {
      if (o.isMesh && o.userData.shared) o.visible = false;
    });
    this.root.add(body.root);
    this.body = body;
    if (this.bat) {
      const view = this.bat.clone(true);
      view.traverse((o: any) => {
        if (o.isMesh) o.visible = true;
      });
      this.root.add(view);
      this.batView = view;
    }
    if (body.head && this.kit === 'bat') {
      // The pack's cricketers have big heads (about 0.47 m wide): size the helmet to fit.
      const helmet = new THREE.Mesh(G.helmet, mat(this.colors[1]));
      helmet.scale.setScalar(1.85);
      helmet.position.set(0, 0.25, -0.01);
      body.head.add(helmet);
      const grill = new THREE.Mesh(G.grill, GRIP);
      grill.scale.setScalar(1.9);
      grill.rotation.x = Math.PI / 2;
      grill.position.set(0, 0.17, 0.15);
      body.head.add(grill);
    }
    this.syncBody();
  }

  /** Copies the driver pose onto the rigged body (and the bat into its hand). */
  syncBody() {
    if (!this.body || !this.root.visible) return;
    this.root.updateMatrixWorld(true);
    this.body.sync(this.current.lift ?? 0);
    if (this.batView && this.bat && this.body.rightHand) {
      const pos = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const rq = new THREE.Quaternion();
      this.body.rightHand.getWorldPosition(pos);
      this.bat.getWorldQuaternion(q);
      this.root.getWorldQuaternion(rq);
      this.batView.position.copy(this.root.worldToLocal(pos));
      this.batView.quaternion.copy(rq.invert().multiply(q));
    }
  }

  get pose() {
    return this.current;
  }

  /** Bat angle: the blade swings with the lower arm; this tilts it relative to the forearm. */
  setBat(x: number, z = 0) {
    if (this.bat) this.bat.rotation.set(x, 0, z);
  }

  face(target: THREE.Vector3) {
    const dx = target.x - this.root.position.x;
    const dz = target.z - this.root.position.z;
    if (Math.abs(dx) + Math.abs(dz) > 1e-3) this.root.rotation.y = Math.atan2(dx, dz);
  }

  dispose() {
    this.root.removeFromParent();
  }
}

// ------------------------------------------------------------------ pose library

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

export function blend(a: Pose, b: Pose, t: number): Pose {
  const k = ease(t);
  const out: Pose = { lift: lerp(a.lift ?? 0, b.lift ?? 0, k), lean: lerp(a.lean ?? 0, b.lean ?? 0, k) };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)].filter((x) => x !== 'lift' && x !== 'lean')) as Set<Joint>;
  for (const j of keys) {
    const x = a[j] ?? [0, 0, 0];
    const y = b[j] ?? [0, 0, 0];
    out[j] = [lerp(x[0], y[0], k), lerp(x[1], y[1], k), lerp(x[2], y[2], k)];
  }
  return out;
}

/** Plays keyframes [time, pose] at time t. */
export function keyed(frames: [number, Pose][], t: number): Pose {
  if (t <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    if (t <= frames[i][0]) return blend(frames[i - 1][1], frames[i][1], (t - frames[i - 1][0]) / (frames[i][0] - frames[i - 1][0]));
  }
  return frames[frames.length - 1][1];
}

export const P = {
  idle: (t = 0): Pose => ({ lShoulder: [0, 0, 0.08], rShoulder: [0, 0, -0.08], spine: [Math.sin(t * 1.3) * 0.02, 0, 0] }),
  ready: (): Pose => ({ lift: -0.1, lean: 0.25, spine: [0.15, 0, 0], lHip: [-0.5, 0, 0.12], lKnee: [0.7, 0, 0], rHip: [-0.5, 0, -0.12], rKnee: [0.7, 0, 0], lShoulder: [-0.6, 0, 0.3], lElbow: [-0.5, 0, 0], rShoulder: [-0.6, 0, -0.3], rElbow: [-0.5, 0, 0] }),
  /** Batting stance, side-on: the body faces the off side, the bat grounded behind the toes. */
  stance: (): Pose => ({ lift: -0.06, spine: [0.25, 0, 0], head: [0, -1.2, 0], lHip: [-0.25, 0, 0.12], lKnee: [0.35, 0, 0], rHip: [-0.25, 0, -0.12], rKnee: [0.35, 0, 0], lShoulder: [-0.5, 0.2, -0.45], lElbow: [-0.6, 0, 0], rShoulder: [-0.35, 0.3, -0.25], rElbow: [-0.4, 0, 0] }),
  backlift: (): Pose => ({ lift: -0.05, spine: [0.2, 0.3, 0], head: [0, -1.25, 0], lHip: [-0.2, 0, 0.12], lKnee: [0.3, 0, 0], rHip: [-0.2, 0, -0.12], rKnee: [0.35, 0, 0], lShoulder: [-1.6, 0.4, -0.5], lElbow: [-0.9, 0, 0], rShoulder: [-1.4, 0.5, -0.3], rElbow: [-1.1, 0, 0] }),
  celebrate: (t: number): Pose => ({ lift: Math.max(0, Math.sin(t * 7)) * 0.25, lShoulder: [-3, 0, 0.3], rShoulder: [-3, 0, -0.3], lElbow: [-0.2, 0, 0], rElbow: [-0.2, 0, 0] }),
  appeal: (): Pose => ({ spine: [-0.15, 0, 0], lShoulder: [-2.9, 0, 0.2], rShoulder: [-2.9, 0, -0.2], lHip: [-0.3, 0, 0], lKnee: [0.4, 0, 0] }),
  dejected: (t: number): Pose => ({ spine: [0.25, 0, 0], head: [0.4, 0, 0], ...run(t, 0.35) }),
  catch: (): Pose => ({ spine: [0.1, 0, 0], lShoulder: [-2.2, 0, 0.25], rShoulder: [-2.2, 0, -0.25], lElbow: [-0.4, 0, 0], rElbow: [-0.4, 0, 0], lHip: [-0.3, 0, 0], lKnee: [0.5, 0, 0], rHip: [-0.3, 0, 0], rKnee: [0.5, 0, 0], lift: -0.06 }),
  pickup: (): Pose => ({ lean: 0.9, lift: -0.25, spine: [0.5, 0, 0], rShoulder: [-1.4, 0, -0.1], lShoulder: [-0.8, 0, 0.3], lHip: [-1.2, 0, 0.1], lKnee: [1.4, 0, 0], rHip: [-0.3, 0, -0.1], rKnee: [0.6, 0, 0] }),
  throwBack: (): Pose => ({ spine: [-0.1, 0.6, 0], rShoulder: [-2.4, 0, -1.2], rElbow: [-1.2, 0, 0], lShoulder: [-1.4, 0, 0.6] }),
  throwOut: (): Pose => ({ spine: [0.35, -0.4, 0], rShoulder: [-1.2, 0, 0.4], rElbow: [0, 0, 0], lShoulder: [0.3, 0, 0.4], lHip: [-0.6, 0, 0], lKnee: [0.3, 0, 0] }),
  dive: (): Pose => ({ lean: 1.35, lift: -0.65, lShoulder: [-3, 0, 0.3], rShoulder: [-3, 0, -0.3], lHip: [0.2, 0, 0.15], rHip: [0.3, 0, -0.15] }),
  keeperCrouch: (): Pose => ({ lift: -0.42, lean: 0.35, spine: [0.3, 0, 0], lHip: [-1.6, 0, 0.35], lKnee: [2.2, 0, 0], rHip: [-1.6, 0, -0.35], rKnee: [2.2, 0, 0], lShoulder: [-0.9, 0, 0.2], lElbow: [-0.6, 0, 0], rShoulder: [-0.9, 0, -0.2], rElbow: [-0.6, 0, 0] }),
  keeperTake: (): Pose => ({ lift: -0.2, lean: 0.2, spine: [0.1, 0, 0], lHip: [-0.9, 0, 0.3], lKnee: [1.2, 0, 0], rHip: [-0.9, 0, -0.3], rKnee: [1.2, 0, 0], lShoulder: [-1.5, 0, 0.1], lElbow: [-0.3, 0, 0], rShoulder: [-1.5, 0, -0.1], rElbow: [-0.3, 0, 0] }),
};

/** Running cycle: `speed` 0..1 scales stride. */
export function run(t: number, speed = 1): Pose {
  const s = Math.sin(t * (6 + speed * 6));
  const a = 0.25 + speed * 0.55;
  return {
    spine: [0.12 * speed, 0, 0], lift: Math.abs(s) * 0.04 * speed,
    lHip: [-s * a, 0, 0], rHip: [s * a, 0, 0], lKnee: [Math.max(0, s) * a * 1.4 + 0.1, 0, 0], rKnee: [Math.max(0, -s) * a * 1.4 + 0.1, 0, 0],
    lShoulder: [s * a * 0.9, 0, 0.08], rShoulder: [-s * a * 0.9, 0, -0.08], lElbow: [-0.9 * speed, 0, 0], rElbow: [-0.9 * speed, 0, 0],
  };
}

/** Bowling action at time t from the start of the delivery stride (release at `release`). */
export function bowlAction(t: number, release: number, spin: boolean): Pose {
  const pre = release - (spin ? 0.3 : 0.35);
  return keyed([
    [pre - 0.01, { ...run(t, spin ? 0.4 : 0.9) }],
    [pre + 0.1, { lift: spin ? 0.05 : 0.18, spine: [-0.2, 0.9, 0], lShoulder: [-2.6, 0, 0.3], rShoulder: [0.4, 0, -0.2], lHip: [-1, 0, 0], lKnee: [0.8, 0, 0], rHip: [0.3, 0, 0], rKnee: [0.6, 0, 0] }],
    [release, { lift: 0, spine: [0.15, 0, 0], lShoulder: [-0.8, 0, 0.5], rShoulder: [-3.0, 0, -0.1], rElbow: [0, 0, 0], lHip: [-0.6, 0, 0], lKnee: [0.1, 0, 0], rHip: [0.4, 0, 0], rKnee: [0.5, 0, 0] }],
    [release + 0.3, { lift: -0.05, spine: [0.6, -0.4, 0], lShoulder: [0.4, 0, 0.4], rShoulder: [0.2, 0, 0.6], lHip: [-0.3, 0, 0], lKnee: [0.4, 0, 0], rHip: [-0.8, 0, 0], rKnee: [0.8, 0, 0] }],
    [release + 0.8, P.idle()],
  ], t);
}

export type ShotKind = 'leave' | 'defend' | 'work' | 'drive' | 'cut' | 'pull' | 'sweep' | 'loft' | 'slog' | 'scoop';

export function shotKind(id: string | null): ShotKind {
  switch (id) {
    case 'leave': return 'leave';
    case 'defend': case 'dig-out': return 'defend';
    case 'push': case 'flick': case 'glance': case 'late-cut': return 'work';
    case 'drive': return 'drive';
    case 'cut': case 'upper-cut': return 'cut';
    case 'pull': case 'hook': return 'pull';
    case 'sweep': case 'reverse': case 'slog-sweep': return 'sweep';
    case 'loft': case 'inside-out': return 'loft';
    case 'slog': return 'slog';
    case 'scoop': case 'ramp': return 'scoop';
    default: return 'defend';
  }
}

/** Shot keyframes around contact at time 0 (negative = before contact). Returns pose and bat tilt. */
export function shotPose(kind: ShotKind, t: number): { pose: Pose; bat: number } {
  const S = P.stance();
  const B = P.backlift();
  const after = (p: Pose): [number, Pose][] => [[-0.45, S], [-0.22, B], [0, p]];
  let frames: [number, Pose][];
  let bat = 0;
  switch (kind) {
    case 'leave':
      frames = [[-0.45, S], [-0.15, { ...S, lShoulder: [-2.8, 0, -0.3], rShoulder: [-2.7, 0, -0.1], lElbow: [-0.6, 0, 0], rElbow: [-0.6, 0, 0] }], [0.6, { ...S, lShoulder: [-2.8, 0, -0.3], rShoulder: [-2.7, 0, -0.1] }], [1.2, S]];
      bat = 0.2;
      break;
    case 'defend':
      frames = [...after({ lift: -0.1, spine: [0.45, -0.2, 0], head: [0.2, -1.2, 0], lHip: [-0.8, 0, 0.1], lKnee: [0.6, 0, 0], rHip: [0.1, 0, -0.1], rKnee: [0.4, 0, 0], lShoulder: [-0.7, -0.3, -0.2], lElbow: [-0.5, 0, 0], rShoulder: [-0.5, -0.2, -0.1], rElbow: [-0.3, 0, 0] }), [0.7, S]];
      bat = -0.3;
      break;
    case 'work':
      frames = [...after({ lift: -0.06, spine: [0.35, -0.7, 0], lHip: [-0.6, 0, 0], lKnee: [0.5, 0, 0], lShoulder: [-0.9, -0.6, -0.2], rShoulder: [-0.8, -0.5, 0], rElbow: [-0.2, 0, 0] }), [0.5, { spine: [0.25, -1, 0], lShoulder: [-1.4, -0.8, 0], rShoulder: [-1.3, -0.7, 0] }], [1.1, S]];
      break;
    case 'drive':
      frames = [...after({ lift: -0.12, spine: [0.45, -0.3, 0], lHip: [-0.9, 0, 0], lKnee: [0.7, 0, 0], rHip: [0.25, 0, 0], rKnee: [0.6, 0, 0], lShoulder: [-1.1, -0.2, -0.2], rShoulder: [-1.0, -0.2, 0], rElbow: [-0.2, 0, 0] }), [0.35, { lift: -0.1, spine: [0.3, -0.6, 0], lHip: [-0.9, 0, 0], lKnee: [0.6, 0, 0], lShoulder: [-2.9, -0.4, 0], rShoulder: [-2.7, -0.3, 0], rElbow: [-1.2, 0, 0] }], [1.1, S]];
      bat = 0.2;
      break;
    case 'loft':
      frames = [...after({ lift: -0.05, spine: [0.25, -0.6, 0], lHip: [-0.7, 0, 0], lKnee: [0.4, 0, 0], lShoulder: [-1.5, -0.4, 0], rShoulder: [-1.4, -0.4, 0] }), [0.35, { spine: [-0.1, -1.2, 0], lShoulder: [-3.1, -0.8, 0.4], rShoulder: [-3.0, -0.6, 0], rElbow: [-1.4, 0, 0] }], [1.2, S]];
      bat = 0.4;
      break;
    case 'cut':
      frames = [...after({ spine: [0.2, 0.7, 0], rHip: [-0.4, 0, -0.3], rKnee: [0.4, 0, 0], lShoulder: [-1.5, 0.9, -0.6], rShoulder: [-1.5, 1.0, -0.4], rElbow: [0, 0, 0] }), [0.35, { spine: [0.1, 1.1, 0], lShoulder: [-1.8, 1.4, -0.4], rShoulder: [-1.7, 1.5, -0.2] }], [1, S]];
      bat = 1.2;
      break;
    case 'pull':
      frames = [...after({ lift: 0.02, spine: [0, -1, 0], rHip: [-0.3, 0, -0.4], lShoulder: [-1.6, -1.1, 0.2], rShoulder: [-1.6, -1.2, 0.2], rElbow: [-0.2, 0, 0] }), [0.35, { spine: [-0.1, -1.6, 0], lShoulder: [-2.2, -1.6, 0.4], rShoulder: [-2.2, -1.7, 0.6] }], [1, S]];
      bat = 1.3;
      break;
    case 'slog':
      frames = [...after({ spine: [0.1, -1.1, 0], lHip: [-0.6, 0, 0.2], lKnee: [0.3, 0, 0], lShoulder: [-1.9, -1.0, 0.2], rShoulder: [-1.9, -1.1, 0.3] }), [0.35, { spine: [-0.2, -1.8, 0], lShoulder: [-3.0, -1.4, 0.6], rShoulder: [-2.9, -1.5, 0.6], rElbow: [-1.3, 0, 0] }], [1.2, S]];
      bat = 0.8;
      break;
    case 'sweep':
      frames = [[-0.45, S], [-0.22, B], [0, { lift: -0.42, lean: 0.5, spine: [0.5, -0.9, 0], lHip: [-1.6, 0, 0], lKnee: [1.6, 0, 0], rHip: [0.2, 0, 0], rKnee: [2.0, 0, 0], lShoulder: [-1.3, -1.0, 0], rShoulder: [-1.2, -1.1, 0.2] }], [0.4, { lift: -0.42, lean: 0.5, spine: [0.4, -1.4, 0], lHip: [-1.6, 0, 0], lKnee: [1.6, 0, 0], rKnee: [2.0, 0, 0], lShoulder: [-1.8, -1.6, 0], rShoulder: [-1.7, -1.6, 0.3] }], [1.2, S]];
      bat = 1.2;
      break;
    case 'scoop':
      frames = [[-0.45, S], [-0.2, { ...S, lift: -0.2 }], [0, { lift: -0.25, lean: 0.4, spine: [0.5, 0, 0], lHip: [-1.1, 0, 0], lKnee: [1.2, 0, 0], lShoulder: [-1.2, 0, -0.1], rShoulder: [-1.1, 0, 0] }], [0.4, { lift: -0.2, spine: [0.2, 0, 0], lShoulder: [-2.6, 0, -0.1], rShoulder: [-2.5, 0, 0] }], [1.1, S]];
      bat = -0.6;
      break;
  }
  return { pose: keyed(frames, t), bat: t > -0.3 ? bat : 0 };
}
