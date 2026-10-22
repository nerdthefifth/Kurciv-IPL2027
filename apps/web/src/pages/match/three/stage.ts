import * as THREE from 'three';
import { fieldForDelivery } from '@kurciv/simulation';
import { Figure, P, blend, bowlAction, run, shotKind, shotPose, type Pose } from './figure';
import { CREASE_Z, STUMPS_Z, buildGround, type Ground, type Quality } from './stadium';
import { MODEL_CREDIT, loadCricketer, type CricketerAsset } from './rigged';
export { MODEL_CREDIT };

/*
 * The match presentation. The engine has already resolved every delivery; this stage only
 * reads the recorded event (line, length, speed, shot, contact, angle, where the ball
 * finished, who fielded it, the dismissal, ball tracking) and animates it. It never decides,
 * rerolls or changes anything, and replays read the same record again.
 */

export type CameraMode = 'broadcast' | 'follow' | 'bowler' | 'wicket' | 'wide';
export type StageStatus = null | 'replay' | 'review' | 'appeal';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const easeOut = (t: number) => 1 - (1 - clamp(t, 0, 1)) ** 2;

const PITCH_D: Record<string, number> = { yorker: 1.0, full: 3.0, good: 5.5, back: 7.5, short: 9.5 };
const ARRIVE_H: Record<string, number> = { yorker: 0.1, full: 0.38, good: 0.7, back: 1.0, short: 1.45 };
const LINE_X: Record<string, number> = { wide: 0.95, off: 0.32, stumps: 0.0, leg: -0.3 };
const BAT_Z = -9.1;
const RUN_TIME = 2.6;

/** One timed piece of animation: update(t) for t in [0, duration]. */
interface Clip {
  duration: number;
  update: (t: number) => void;
  status: StageStatus;
  done: () => void;
}

/** Mirror a pose for a left-hander: swap sides and flip yaw/roll. */
function mirrorPose(p: Pose): Pose {
  const out: Pose = { lift: p.lift, lean: p.lean };
  const swap: Record<string, string> = { lShoulder: 'rShoulder', rShoulder: 'lShoulder', lElbow: 'rElbow', rElbow: 'lElbow', lHip: 'rHip', rHip: 'lHip', lKnee: 'rKnee', rKnee: 'lKnee' };
  for (const [k, v] of Object.entries(p)) {
    if (k === 'lift' || k === 'lean' || !Array.isArray(v)) continue;
    (out as any)[swap[k] ?? k] = [v[0], -v[1], -v[2]];
  }
  return out;
}

export class Stage {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.5, 900);
  ground!: Ground;
  ball: THREE.Mesh;
  ballShadow: THREE.Mesh;
  overlay = new THREE.Group();
  figures = new Map<string, Figure>();
  state: any;
  quality: Quality;
  timescale = 1;
  cameraMode: CameraMode = 'broadcast';
  autoCamera = true;
  onStatus: (s: StageStatus) => void = () => {};
  private camPos = V(-24, 7.5, -3);
  private camTarget = V(0, 1, -2);
  private wantPos = this.camPos.clone();
  private wantTarget = this.camTarget.clone();
  private shot: { mode: CameraMode | 'closeup' | 'review'; focus?: THREE.Vector3 } = { mode: 'broadcast' };
  private clips: Clip[] = [];
  private clip: Clip | null = null;
  private t = 0;
  private raf = 0;
  private last = 0;
  private settle = 0;
  private frameTimes: number[] = [];
  private pixelRatio: number;
  private appealedSeq: number | null = null;
  lastEvent: any = null;
  private athlete: CricketerAsset | null = null;
  private disposed = false;

  constructor(private host: HTMLElement, state: any, quality: Quality) {
    this.state = state;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: quality === 'low' ? 'low-power' : 'default' });
    this.pixelRatio = Math.min(window.devicePixelRatio, quality === 'high' ? 2 : quality === 'medium' ? 1.5 : 1);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.shadowMap.enabled = quality === 'high';
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.ground = buildGround(this.scene, state.setup.venue, state.setup.home.colors, quality);
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: '#fdfdfd' }));
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.14, 10), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35 }));
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ball, this.ballShadow, this.overlay);
    this.ball.visible = this.ballShadow.visible = false;
    this.resize();
    this.syncLineup(state);
    this.kick();
    // Rigged models load in the background; until then (or if they fail) the simple figures play.
    void loadCricketer().then((g) => {
      if (!g || this.disposed) return;
      this.athlete = g;
      for (const f of this.figures.values()) f.attach(g, this.quality === 'high');
      this.kick();
    });
  }

  // ---------------------------------------------------------------- loop

  resize() {
    const w = this.host.clientWidth || 640;
    const h = this.host.clientHeight || 360;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.kick();
  }

  /** Starts the render loop; it stops itself once nothing is moving (no work while idle). */
  kick() {
    this.settle = 40;
    if (this.raf) return;
    this.last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      this.tick(dt);
      this.renderer.render(this.scene, this.camera);
      this.adapt(dt);
      if (this.clip || this.clips.length || this.settle-- > 0) this.raf = requestAnimationFrame(frame);
      else this.raf = 0;
    };
    this.raf = requestAnimationFrame(frame);
  }

  /** Lowers the resolution when frames get slow, so Low settings stay smooth. */
  private adapt(dt: number) {
    if (!this.clip) return;
    this.frameTimes.push(dt);
    if (this.frameTimes.length < 90) return;
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.frameTimes = [];
    if (avg > 1 / 32 && this.pixelRatio > 0.6) {
      this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.25);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
    }
  }

  private tick(dt: number) {
    if (!this.clip && this.clips.length) {
      this.clip = this.clips.shift()!;
      this.t = 0;
      this.onStatus(this.clip.status);
    }
    if (this.clip) {
      this.t += dt * this.timescale * (this.clip.status === 'replay' ? 0.75 : 1);
      this.clip.update(Math.min(this.t, this.clip.duration));
      if (this.t >= this.clip.duration) {
        const c = this.clip;
        this.clip = null;
        this.onStatus(null);
        c.done();
        this.settle = 40;
      }
    } else {
      // Idle breathing keeps the scene alive between deliveries.
      const s = performance.now() / 1000;
      for (const f of this.figures.values()) if (!f.root.userData.busy) f.setPose(f.kit === 'keeper' ? P.keeperCrouch() : f.root.userData.batter ? this.batterPose(f, P.stance()) : f.root.userData.bowler ? P.idle(s) : blend(P.idle(s), P.ready(), 0.5));
    }
    for (const f of this.figures.values()) f.syncBody();
    this.updateCamera(dt);
  }

  private updateCamera(dt: number) {
    const mode = this.shot.mode;
    const ball = this.ball.position;
    const focus = this.shot.focus ?? ball;
    switch (mode) {
      case 'broadcast': this.wantPos.set(-24, 7.5, -3); this.wantTarget.set(0, 0.9, -2.5); break;
      case 'bowler': this.wantPos.set(0.5, 4.8, 25); this.wantTarget.set(0, 0.6, -9); break;
      case 'wicket': this.wantPos.set(0.3, 2.0, -20); this.wantTarget.set(0, 1, 6); break;
      case 'wide': this.wantPos.set(-22, 42, -42); this.wantTarget.set(0, 0, 2); break;
      case 'follow': {
        const dir = V(ball.x, 0, ball.z - BAT_Z);
        const len = dir.length();
        if (!this.ball.visible || len < 4) { this.wantPos.set(-14, 9, -24); this.wantTarget.set(0, 1, -6); break; }
        dir.normalize();
        this.wantPos.set(ball.x - dir.x * 18 - dir.z * 6, Math.max(6, ball.y * 0.7 + 7), ball.z - dir.z * 18 + dir.x * 6);
        this.wantTarget.copy(ball);
        break;
      }
      case 'closeup': this.wantPos.set(focus.x - 5, 2.6, focus.z - 6); this.wantTarget.set(focus.x, 1.3, focus.z); break;
      case 'review': this.wantPos.set(0, 2.4, 14); this.wantTarget.set(0, 0.5, -10); break;
    }
    const k = 1 - Math.exp(-dt * (mode === 'follow' ? 4 : 2.6));
    this.camPos.lerp(this.wantPos, k);
    this.camTarget.lerp(this.wantTarget, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camTarget);
  }

  setCamera(mode: CameraMode) {
    this.cameraMode = mode;
    if (!this.clip) this.shot = { mode };
    this.kick();
  }

  private direct(mode: CameraMode | 'closeup' | 'review', focus?: THREE.Vector3) {
    this.shot = this.autoCamera || mode === 'review' ? { mode, focus } : { mode: this.cameraMode, focus };
  }

  // ---------------------------------------------------------------- people

  private team(side: 'home' | 'away') {
    return this.state.setup[side];
  }

  private figureFor(id: string, kit: 'bat' | 'field' | 'keeper', team: { colors: [string, string]; shortName: string }): Figure {
    const colors = team.colors;
    let f = this.figures.get(id);
    if (f && f.kit !== kit) {
      f.dispose();
      this.figures.delete(id);
      f = undefined;
    }
    if (!f) {
      f = new Figure(id, colors, kit, this.quality === 'high', team.shortName);
      if (this.athlete) f.attach(this.athlete, this.quality === 'high');
      this.figures.set(id, f);
      this.scene.add(f.root);
    }
    return f;
  }

  private player(id: string) {
    return this.state.setup.home.xi.find((p: any) => p.id === id) ?? this.state.setup.away.xi.find((p: any) => p.id === id);
  }

  private batterPose(f: Figure, p: Pose): Pose {
    return this.player(f.id)?.batHand === 'L' ? mirrorPose(p) : p;
  }

  /** Puts the current batters, bowler and fielders where the engine has them for the next ball. */
  syncLineup(state: any) {
    this.state = state;
    const inn = state.innings[state.innings.length - 1];
    for (const f of this.figures.values()) f.root.visible = false;
    if (!inn) return;
    const bowlSide = inn.bowlingSide;
    const bat = this.team(inn.battingSide);
    const bowl = this.team(bowlSide);
    const bowlerId = inn.currentBowlerId ?? inn.queuedBowlerId ?? inn.lastOverBowlerId ?? bowl.xi.find((p: any) => p.bowlType !== 'NONE' && p.id !== bowl.keeperId)?.id;
    const ev = { innings: inn.index, over: Math.floor(inn.legalBalls / 6), strikerId: inn.strikerId, bowlerId };
    let field: { id: string; x: number; y: number; role: string }[] = [];
    try {
      field = fieldForDelivery(state, ev as any);
    } catch {
      field = [];
    }
    for (const s of field) {
      const f = this.figureFor(s.id, s.role === 'keeper' ? 'keeper' : 'field', bowl);
      f.root.visible = true;
      f.root.userData = { home: V(s.x, 0, s.y), bowler: s.role === 'bowler' };
      if (s.role === 'bowler') {
        const spin = this.isSpin(s.id);
        f.root.position.set(0.9, 0, STUMPS_Z + (spin ? 6 : 16));
        f.root.rotation.y = Math.PI;
      } else {
        f.root.position.set(s.x, 0, s.y);
        f.face(V(0, 0, BAT_Z));
      }
    }
    this.placeBatter(inn.strikerId, true, bat);
    this.placeBatter(inn.nonStrikerId, false, bat);
    this.ball.visible = this.ballShadow.visible = false;
    this.ground.resetStumps();
    this.kick();
  }

  private placeBatter(id: string, striker: boolean, team: { colors: [string, string]; shortName: string }) {
    const f = this.figureFor(id, 'bat', team);
    const left = this.player(id)?.batHand === 'L';
    f.root.visible = true;
    f.root.userData = { batter: true };
    if (striker) {
      f.root.position.set(left ? 0.32 : -0.32, 0, BAT_Z - 0.1);
      f.root.rotation.y = left ? -Math.PI / 2 : Math.PI / 2;
    } else {
      f.root.position.set(left ? -1.1 : 1.1, 0, CREASE_Z + 0.6);
      f.root.rotation.y = Math.PI;
    }
    f.setPose(striker ? this.batterPose(f, P.stance()) : P.idle());
  }

  private isSpin(id: string) {
    return ['OB', 'LB', 'SLA', 'SLC'].includes(this.player(id)?.bowlType);
  }

  // ---------------------------------------------------------------- presenting deliveries

  /** Queue a recorded delivery. Resolves when it has been shown. */
  present(ev: any, opts: { replay?: boolean } = {}): Promise<void> {
    this.lastEvent = ev;
    return new Promise((resolve) => {
      if (!opts.replay && this.appealedSeq === ev.seq) {
        // The delivery was already shown as an appeal: show only the review and the aftermath.
        this.appealedSeq = null;
        if (ev.review && ev.tracking) this.clips.push(this.reviewClip(ev, () => {}));
        this.clips.push(this.aftermathClip(ev, resolve));
      } else {
        this.clips.push(this.deliveryClip(ev, !!opts.replay, opts.replay ? resolve : () => {}));
        if (!opts.replay && ev.review && ev.tracking) this.clips.push(this.reviewClip(ev, () => {}));
        if (!opts.replay) this.clips.push({ duration: 0.01, status: null, update: () => {}, done: resolve });
      }
      this.kick();
    });
  }

  /** A decision is under review: show the ball and the appeal, without revealing the outcome. */
  presentAppeal(pe: any, kind: 'lbw' | 'caught-behind'): Promise<void> {
    this.appealedSeq = pe.seq;
    const ev = { ...pe, contact: kind === 'lbw' ? 'miss' : 'edge', end: null, aerial: false, boundary: null, batRuns: 0, totalRuns: 0, extras: null, wicket: null, chance: null, fielderId: null, angle: null, appeal: kind };
    return new Promise((resolve) => {
      this.clips.push(this.deliveryClip(ev, false, resolve, 'appeal'));
      this.kick();
    });
  }

  replay() {
    if (this.lastEvent && !this.clip) void this.present(this.lastEvent, { replay: true });
  }

  /** Builds the full sequence for one recorded delivery. */
  private deliveryClip(ev: any, replay: boolean, done: () => void, status: StageStatus = replay ? 'replay' : null): Clip {
    const inn = this.state.innings[ev.innings] ?? this.state.innings[this.state.innings.length - 1];
    const bat = this.team(inn.battingSide);
    const bowl = this.team(inn.bowlingSide);
    // Who stood where for this ball, exactly as the engine assigned it.
    let field: { id: string; x: number; y: number; role: string }[] = [];
    try { field = fieldForDelivery(this.state, ev); } catch { field = []; }
    for (const f of this.figures.values()) f.root.visible = false;
    const fig = new Map<string, Figure>();
    const home = new Map<string, THREE.Vector3>();
    for (const s of field) {
      const f = this.figureFor(s.id, s.role === 'keeper' ? 'keeper' : 'field', bowl);
      f.root.visible = true;
      f.root.userData = { busy: true };
      fig.set(s.id, f);
      home.set(s.id, V(s.x, 0, s.y));
    }
    const striker = this.figureFor(ev.strikerId, 'bat', bat);
    const nonStriker = this.figureFor(ev.nonStrikerId, 'bat', bat);
    for (const f of [striker, nonStriker]) {
      f.root.visible = true;
      f.root.userData = { busy: true, batter: true };
    }
    const bowler = fig.get(ev.bowlerId) ?? this.figureFor(ev.bowlerId, 'field', bowl);
    bowler.root.visible = true;
    const keeper = field.find((s) => s.role === 'keeper');
    const keeperPos = keeper ? home.get(keeper.id)! : V(0, 0, -20);
    const left = this.player(ev.strikerId)?.batHand === 'L';
    const hs = left ? -1 : 1;
    const spin = this.isSpin(ev.bowlerId);
    const S0 = V(left ? 0.32 : -0.32, 0, BAT_Z - 0.1);
    const N0 = V(left ? -1.1 : 1.1, 0, CREASE_Z + 0.6);

    // ----- the delivery
    const runup = spin ? 6 : 16;
    const runupT = spin ? 1.3 : 2.1;
    const release = runupT + 0.35;
    const R = V(0.55, spin ? 2.0 : 2.25, STUMPS_Z - 0.6);
    const lineX = (ev.extras?.kind === 'wide' ? 1.7 : LINE_X[ev.line] ?? 0) * hs;
    const P1 = V(lineX * 0.9, 0.04, -STUMPS_Z + (PITCH_D[ev.length] ?? 5));
    const A = V(lineX, ARRIVE_H[ev.length] ?? 0.6, BAT_Z + 0.35);
    const v = Math.max(15, (ev.speed ?? 120) / 3.6);
    const flight = clamp(((R.distanceTo(P1) + P1.distanceTo(A)) / v) * 1.7, 0.55, 1.5);
    const f1 = flight * (R.distanceTo(P1) / (R.distanceTo(P1) + P1.distanceTo(A)));
    const contact = release + flight;

    // ----- after contact: where the record says the ball went
    const kind = ev.wicket?.kind as string | undefined;
    const sk = shotKind(ev.contact === 'leave' ? 'leave' : ev.shot);
    const missed = ev.contact === 'leave' || ev.contact === 'miss';
    const dirOf = (deg: number) => { const r = (deg * Math.PI) / 180; return V(Math.sin(r) * hs, 0, Math.cos(r)); };
    const fromB = A.clone();
    let end: THREE.Vector3 | null = ev.end ? V(ev.end.x, 0, ev.end.y) : null;
    let aerial = !!ev.aerial;
    let peak = 0;
    let travel = 0;
    let catcher: string | null = null;
    let gatherer: string | null = null;
    let stumpsHit: 'striker' | 'bowler' | null = null;
    let throwTo: THREE.Vector3 | null = null;
    let runOutEnd: 'striker' | 'bowler' | null = null;
    const ropeDist = (from: THREE.Vector3, dir: THREE.Vector3) => {
      const { a, b } = this.ground.axes;
      const Aq = (dir.x * dir.x) / (a * a) + (dir.z * dir.z) / (b * b);
      const Bq = 2 * ((from.x * dir.x) / (a * a) + (from.z * dir.z) / (b * b));
      const Cq = (from.x * from.x) / (a * a) + (from.z * from.z) / (b * b) - 1;
      return (-Bq + Math.sqrt(Math.max(0, Bq * Bq - 4 * Aq * Cq))) / (2 * Aq);
    };
    if (ev.appeal === 'lbw' || kind === 'lbw') {
      end = A.clone().add(V(0.3 * hs, 0, 0.8));
      end.y = 0;
      travel = 0.5;
    } else if (kind === 'bowled' || kind === 'hit wicket') {
      end = V(0, 0.35, -STUMPS_Z);
      travel = 0.12;
      stumpsHit = 'striker';
    } else if (kind === 'stumped' || (missed && !ev.extras?.kind?.includes('bye'))) {
      end = V(keeperPos.x * 0.3 + lineX * 0.7, kind === 'stumped' ? 0.5 : A.y * 0.85, keeperPos.z + 0.6);
      travel = Math.abs(end.z - A.z) / (v * 0.75);
      if (kind === 'stumped') { stumpsHit = 'striker'; }
    } else if (kind === 'caught' || kind === 'caught behind' || ev.appeal === 'caught-behind') {
      catcher = ev.wicket?.fielderId ?? keeper?.id ?? null;
      const c = catcher && home.get(catcher) ? home.get(catcher)! : keeperPos;
      end = end && ev.appeal !== 'caught-behind' ? end : c.clone();
      aerial = true;
      peak = clamp(fromB.distanceTo(end) * 0.32, 1.2, 26);
      travel = 0.5 + fromB.distanceTo(end) / 24;
    } else if (ev.boundary === 6) {
      const dir = dirOf(ev.angle ?? 0);
      end = fromB.clone().add(dir.multiplyScalar(ropeDist(fromB, dir) + 7 + (ev.batRuns ? 3 : 0)));
      aerial = true;
      peak = clamp(fromB.distanceTo(end) * 0.36, 16, 34);
      travel = 1.6 + fromB.distanceTo(end) / 40;
    } else if (ev.boundary === 4) {
      const dir = dirOf(ev.angle ?? 0);
      end = fromB.clone().add(dir.multiplyScalar(ropeDist(fromB, dir) + 0.5));
      aerial = false;
      travel = 0.6 + fromB.distanceTo(end) / 30;
    } else {
      if (!end) {
        const dir = dirOf(ev.angle ?? 0);
        end = fromB.clone().add(dir.multiplyScalar(missed ? 0 : 3 + (ev.batRuns ?? 0) * 6));
      }
      end.y = 0;
      peak = aerial ? clamp(fromB.distanceTo(end) * 0.3, 2, 22) : 0;
      travel = aerial ? 0.6 + fromB.distanceTo(end) / 22 : 0.25 + fromB.distanceTo(end) / 20;
      gatherer = ev.fielderId ?? ev.chance?.fielderId ?? null;
      if (ev.chance?.kind === 'catch' && !ev.chance.taken) { catcher = ev.chance.fielderId; aerial = true; peak = Math.max(peak, 4); }
      if (kind === 'run out') {
        gatherer = ev.wicket.fielderId ?? gatherer;
      }
    }
    const landT = contact + travel;

    // ----- running between the wickets
    const extraRuns = ev.extras && (ev.extras.kind === 'bye' || ev.extras.kind === 'leg-bye') ? ev.extras.runs : ev.extras?.kind === 'wide' || ev.extras?.kind === 'no-ball' ? Math.max(0, ev.extras.runs - 1) : 0;
    const runs = ev.boundary ? 0 : (ev.batRuns ?? 0) + extraRuns;
    const runOut = kind === 'run out';
    const runsShown = runs + (runOut ? 1 : 0);
    const runStart = contact + 0.35;
    if (runOut) {
      const outIsStriker = ev.wicket.playerOutId === ev.strikerId;
      // After `runs` completed runs, the striker is at the far end when runs is odd.
      const strikerAtFar = runs % 2 === 1;
      const outAtFar = outIsStriker ? strikerAtFar : !strikerAtFar;
      runOutEnd = outAtFar ? 'striker' : 'bowler';
      stumpsHit = runOutEnd;
    }
    const gatherPos = end ? end.clone().setY(0) : null;
    const gatherT = gatherer ? landT + 0.15 : landT;
    const throwStart = gatherT + 0.4;
    if (gatherer && !ev.boundary && gatherPos) {
      throwTo = runOutEnd === 'bowler' ? V(0, 0.6, STUMPS_Z) : runOutEnd === 'striker' ? V(0, 0.6, -STUMPS_Z) : keeperPos.clone().add(V(0, 1, 1.5));
    }
    const throwDur = throwTo && gatherPos ? 0.35 + gatherPos.distanceTo(throwTo) / 30 : 0;
    const runsEnd = runStart + runsShown * RUN_TIME * (runOut ? 0.82 : 1);
    const settleT = Math.max(landT + 0.6, throwStart + throwDur + 0.3, runsEnd + 0.2);
    const wicket = !!ev.wicket;
    const celebrate = wicket ? 2.2 : ev.boundary === 6 ? 0.9 : 0.4;
    const duration = settleT + celebrate + 0.4;

    // Ball position along the recorded path at time t.
    const ballAt = (t: number, out: THREE.Vector3): boolean => {
      if (t < release) return false;
      if (t < release + f1) {
        const u = (t - release) / f1;
        out.lerpVectors(R, P1, u);
        out.y = R.y + (P1.y - R.y) * u + (spin ? 0.7 : 0.1) * 4 * u * (1 - u);
        return true;
      }
      if (t < contact) {
        const u = (t - release - f1) / (flight - f1);
        out.lerpVectors(P1, A, u);
        out.y = P1.y + (A.y - P1.y) * u + 0.12 * 4 * u * (1 - u);
        return true;
      }
      if (!end) { out.copy(A); return true; }
      if (t < landT) {
        const u = (t - contact) / travel;
        if (aerial) {
          out.lerpVectors(fromB, end, u);
          out.y = fromB.y + (end.y + (catcher ? 1.4 : 0) - fromB.y) * u + peak * 4 * u * (1 - u);
        } else {
          out.lerpVectors(fromB, end, easeOut(u));
          out.y = Math.max(0.11, fromB.y * (1 - u * 4));
        }
        return true;
      }
      // Caught: the ball stays in the catcher's hands.
      if (catcher && kind && kind.startsWith('caught') && fig.get(catcher)) { fig.get(catcher)!.rightHand.getWorldPosition(out); return true; }
      if (throwTo && gatherPos && t >= throwStart) {
        const u = Math.min(1, (t - throwStart) / throwDur);
        out.lerpVectors(gatherPos.clone().setY(1.6), throwTo, u);
        out.y += 3 * u * (1 - u) * Math.min(4, gatherPos.distanceTo(throwTo) / 12);
        return true;
      }
      if (ev.boundary === 6) { out.copy(end); out.y = 2; return t < landT + 0.4; }
      out.copy(end);
      out.y = Math.max(0.11, end.y);
      return true;
    };

    const fielderTarget = (id: string) => (id === catcher || id === gatherer ? gatherPos : null);
    const tmp = V(0, 0, 0);
    let cameraPhase = '';
    const update = (t: number) => {
      // Camera direction
      const phase = t < release - 0.3 ? 'runup' : t < contact + 0.2 ? 'ball' : t < settleT ? 'play' : 'after';
      if (phase !== cameraPhase) {
        cameraPhase = phase;
        if (replay) this.direct(phase === 'runup' || phase === 'ball' ? 'bowler' : 'follow');
        else if (phase === 'runup' || phase === 'ball') this.direct(this.cameraMode === 'follow' ? 'broadcast' : this.cameraMode);
        else if (phase === 'play') this.direct(aerial || ev.boundary ? 'follow' : runs > 0 ? 'wide' : this.cameraMode === 'follow' ? 'broadcast' : this.cameraMode);
        else this.direct(wicket ? 'closeup' : this.cameraMode === 'follow' ? 'broadcast' : this.cameraMode, wicket ? bowler.root.position.clone() : undefined);
      }

      // Bowler: run-up, delivery stride, follow-through, then reaction
      const bStart = V(0.9, 0, STUMPS_Z + runup);
      const bRelease = V(0.6, 0, STUMPS_Z - 0.4);
      if (t < release) {
        bowler.root.position.lerpVectors(bStart, bRelease, smooth(t / release) * 0.6 + (t / release) * 0.4);
        bowler.root.rotation.y = Math.PI;
      } else {
        bowler.root.position.lerpVectors(bRelease, V(0.9, 0, STUMPS_Z - 3.2), easeOut((t - release) / 1.2));
      }
      let bp = bowlAction(t - (release - 0.5), 0.5, spin);
      if (t < release - 0.5) bp = run(t, spin ? 0.5 : 0.95);
      if ((ev.appeal || kind === 'lbw' || kind === 'caught behind') && t > contact + 0.15 && t < settleT + 0.5) bp = P.appeal();
      if (wicket && t > settleT) bp = P.celebrate(t - settleT);
      bowler.setPose(bp);

      // Batters
      const tc = t - contact;
      const shot = shotPose(missed && sk !== 'leave' ? 'defend' : sk, missed && sk !== 'leave' ? tc - 0.12 : tc);
      let sp = t < release ? P.stance() : shot.pose;
      striker.setBat(shot.bat);
      // Running: striker and non-striker swap ends once per completed run.
      const legs = runsShown;
      const runningAt = (who: 'striker' | 'non', origin: THREE.Vector3) => {
        if (!legs || t < runStart) return null;
        const k = Math.min(legs, (t - runStart) / RUN_TIME);
        const done = Math.floor(k);
        const frac = k - done;
        const startFar = who === 'non';
        const atFar = (n: number) => (startFar ? n % 2 === 0 : n % 2 === 1);
        const z0 = atFar(done) ? CREASE_Z + 0.6 : BAT_Z;
        const z1 = atFar(done) ? BAT_Z : CREASE_Z + 0.6;
        const lastLegOut = runOut && done === legs - 1 && ((who === 'striker') === (ev.wicket.playerOutId === ev.strikerId));
        const f = lastLegOut ? Math.min(frac, 0.8) : frac;
        if (k >= legs) {
          const finalFar = atFar(legs);
          return { pos: V(origin.x > 0 ? 1.1 : -1.1, 0, finalFar ? CREASE_Z + 0.6 : BAT_Z - 0.1), running: false, dir: 0 };
        }
        return { pos: V(who === 'striker' ? -0.9 * hs : 0.9 * hs, 0, z0 + (z1 - z0) * smooth(f)), running: !(lastLegOut && frac >= 0.8), dir: z1 > z0 ? 1 : -1 };
      };
      const sRun = runningAt('striker', S0);
      if (sRun) {
        striker.root.position.copy(sRun.pos);
        striker.root.rotation.y = sRun.dir > 0 ? 0 : sRun.dir < 0 ? Math.PI : striker.root.rotation.y;
        sp = sRun.running ? run(t, 1) : P.idle(t);
        striker.setBat(0.6);
      } else {
        striker.root.position.copy(S0);
        striker.root.rotation.y = left ? -Math.PI / 2 : Math.PI / 2;
        if (ev.boundary === 6 && t > landT) sp = P.idle(t);
      }
      if (wicket && ev.wicket.playerOutId === ev.strikerId && t > settleT + 0.4) {
        sp = P.dejected(t);
        striker.root.rotation.y = -Math.PI / 2;
        striker.root.position.x -= (t - settleT - 0.4) * 1.4;
      }
      striker.setPose(sRun ? sp : this.batterPose(striker, sp));
      const nRun = runningAt('non', N0);
      if (nRun) {
        nonStriker.root.position.copy(nRun.pos);
        nonStriker.root.rotation.y = nRun.dir > 0 ? 0 : Math.PI;
        nonStriker.setPose(nRun.running ? run(t, 1) : P.idle(t));
      } else {
        // Backing up as the bowler releases.
        nonStriker.root.position.copy(N0).add(V(0, 0, t > release - 0.3 ? -smooth((t - release + 0.3) / 0.8) * 1.5 : 0));
        nonStriker.root.rotation.y = Math.PI;
        nonStriker.setPose(t > release - 0.3 && t < contact + 0.8 ? run(t, 0.3) : P.idle(t));
      }
      if (wicket && ev.wicket.playerOutId === ev.nonStrikerId && t > settleT + 0.4) {
        nonStriker.setPose(P.dejected(t));
        nonStriker.root.rotation.y = -Math.PI / 2;
        nonStriker.root.position.x -= (t - settleT - 0.4) * 1.4;
      }

      // Fielders
      for (const s of field) {
        if (s.id === ev.bowlerId) continue;
        const f = fig.get(s.id)!;
        const h = home.get(s.id)!;
        const target = fielderTarget(s.id);
        if (s.role === 'keeper') {
          f.root.position.copy(h);
          f.root.rotation.y = 0;
          let kp = t < release - 0.2 ? P.keeperCrouch() : t < contact + 0.4 ? P.keeperTake() : P.ready();
          if (kind === 'stumped' && t > contact + travel) { kp = P.pickup(); f.root.position.lerp(V(0, 0, -STUMPS_Z - 0.6), smooth((t - contact - travel) / 0.4)); }
          if (throwTo && t > throwStart && runOutEnd !== 'bowler') kp = P.keeperTake();
          if (s.id === catcher && t > landT - 0.3) kp = P.catch();
          if (wicket && t > settleT) kp = P.celebrate(t - settleT + 0.3);
          f.setPose(kp);
          continue;
        }
        let fp: Pose = P.ready();
        f.root.position.copy(h);
        if (target && t >= contact) {
          // Run from position to the recorded spot, arriving with the ball (or as soon as legs allow).
          const dist = h.distanceTo(target);
          const arrive = Math.max(landT, contact + dist / 7.5);
          const u = clamp((t - contact) / (arrive - contact), 0, 1);
          const dive = (ev.chance?.difficulty === 'hard' || (ev.runsSaved ?? 0) > 0) && dist < 7;
          f.root.position.lerpVectors(h, target, smooth(u));
          if (u < 1) {
            f.face(target);
            fp = dive && u > 0.6 ? P.dive() : run(t, 1);
          } else {
            const caught = s.id === catcher && !!kind?.startsWith('caught');
            if (s.id === catcher) fp = t < landT + 0.4 ? P.catch() : caught ? (wicket && t > settleT ? P.celebrate(t - settleT) : P.catch()) : P.pickup();
            else if (throwTo && t < throwStart) fp = P.pickup();
            else if (throwTo && t < throwStart + 0.35) { f.face(throwTo); fp = blend(P.throwBack(), P.throwOut(), (t - throwStart) / 0.35); }
            else fp = wicket && t > settleT ? P.celebrate(t - settleT) : P.idle(t);
          }
        } else if (ev.boundary && t > contact && f.root.position.distanceTo(end ?? h) < 30) {
          // Nearby fielders chase a boundary they cannot reach.
          const dest = (end ?? h).clone();
          f.root.position.lerp(dest, clamp((t - contact) / 6, 0, 0.35));
          f.face(dest);
          fp = run(t, 0.8);
        } else if (wicket && t > settleT && f.root.position.distanceTo(bowler.root.position) < 40) {
          f.root.position.lerp(bowler.root.position, clamp((t - settleT) / 8, 0, 0.2));
          fp = P.celebrate(t - settleT + h.x);
        }
        f.setPose(fp);
      }

      // Ball and stumps
      const visible = ballAt(t, tmp);
      this.ball.visible = this.ballShadow.visible = visible;
      if (visible) {
        this.ball.position.copy(tmp);
        this.ballShadow.position.set(tmp.x, 0.02, tmp.z);
      }
      const hitAt = stumpsHit === 'striker' && kind !== 'run out' ? (kind === 'stumped' ? contact + travel + 0.4 : contact + travel) : runOut ? throwStart + throwDur : Infinity;
      if (stumpsHit && t > hitAt) {
        const set = stumpsHit === 'striker' ? this.ground.stumps.striker : this.ground.stumps.bowler;
        const u = Math.min(1, (t - hitAt) / 0.6);
        set.children.forEach((c, i) => {
          if (c.userData.bail) { c.position.y = c.userData.base.y + Math.sin(u * Math.PI) * 0.8; c.position.z = -u * 1.5; c.rotation.x = u * 6; }
          else c.rotation.x = -u * (0.3 + i * 0.12);
        });
      }
    };
    return {
      duration: ev.appeal ? contact + 1.6 : duration, status, update,
      done: () => {
        for (const f of this.figures.values()) f.root.userData.busy = false;
        this.ball.visible = this.ballShadow.visible = false;
        done();
      },
    };
  }

  /** After an appeal already shown: the outcome (celebration or relief), no second delivery. */
  private aftermathClip(ev: any, done: () => void): Clip {
    const bowler = this.figures.get(ev.bowlerId);
    const out = this.figures.get(ev.wicket?.playerOutId ?? '');
    return {
      duration: ev.wicket ? 2.2 : 0.8, status: null,
      update: (t) => {
        if (ev.wicket) {
          this.direct('closeup', bowler?.root.position.clone());
          bowler?.setPose(P.celebrate(t));
          if (out) { out.setPose(P.dejected(t)); out.root.rotation.y = -Math.PI / 2; out.root.position.x -= 0.02; }
        }
      },
      done,
    };
  }

  /** DRS ball tracking from the recorded evidence, drawn from the umpire's view. */
  private reviewClip(ev: any, done: () => void): Clip {
    const tr = ev.tracking;
    const hs = this.player(ev.strikerId)?.batHand === 'L' ? -1 : 1;
    const W = (x: number, h: number, d: number) => V(x * hs, h, -STUMPS_Z + d);
    const release = V(0.55, 2.2, STUMPS_Z - 0.6);
    const pitch = tr.pitch ? W(tr.pitch.x, 0.03, tr.pitch.d) : null;
    const impact = W(tr.impact.x, tr.impact.z, tr.impact.d);
    const proj = W(tr.projected.x, tr.projected.z, 0);
    const pts: THREE.Vector3[] = [release, ...(pitch ? [pitch] : []), impact, proj];
    const g = this.overlay;
    g.clear();
    const colorOf = (s: string) => (s === 'hitting' || s === 'in-line' ? '#ef4444' : s === 'umpires-call' ? '#f59e0b' : '#22c55e');
    const pathMat = new THREE.MeshBasicMaterial({ color: '#60a5fa', transparent: true, opacity: 0.85 });
    const projMat = new THREE.MeshBasicMaterial({ color: colorOf(tr.wickets), transparent: true, opacity: 0.85 });
    const segs: THREE.Mesh[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 6), i === pts.length - 2 ? projMat : pathMat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(V(0, 1, 0), b.clone().sub(a).normalize());
      m.scale.y = 0.0001;
      m.userData = { len, a, b };
      g.add(m);
      segs.push(m);
    }
    const marker = (p: THREE.Vector3, color: string, flat = false) => {
      const m = flat ? new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), new THREE.MeshBasicMaterial({ color })) : new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), new THREE.MeshBasicMaterial({ color }));
      if (flat) m.rotation.x = -Math.PI / 2;
      m.position.copy(p);
      m.visible = false;
      g.add(m);
      return m;
    };
    const mPitch = pitch ? marker(pitch, colorOf(tr.pitched === 'outside-leg' ? 'missing' : 'in-line'), true) : null;
    const mImpact = marker(impact, colorOf(tr.impactZone));
    const mProj = marker(proj, colorOf(tr.wickets));
    const zone = new THREE.Mesh(new THREE.BoxGeometry(0.23 + 0.22, 0.71 + 0.11, 0.05), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.12 }));
    zone.position.set(0, 0.4, -STUMPS_Z);
    g.add(zone);
    const total = 3.2;
    return {
      duration: total + 1.6, status: 'review',
      update: (t) => {
        this.direct('review');
        const u = Math.min(1, t / total) * segs.length;
        segs.forEach((m, i) => {
          const k = clamp(u - i, 0, 1);
          m.scale.y = Math.max(0.0001, k);
          const a = m.userData.a as THREE.Vector3;
          const b = m.userData.b as THREE.Vector3;
          m.position.copy(a).lerp(b, k / 2);
        });
        if (mPitch) mPitch.visible = u >= 1;
        mImpact.visible = u >= (pitch ? 2 : 1);
        mProj.visible = u >= segs.length;
      },
      done: () => {
        g.clear();
        done();
      },
    };
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.renderer.dispose();
    this.renderer.domElement.remove();
    // Figure geometries and materials are shared module-wide and reused by the next match view.
    this.scene.traverse((o: any) => {
      if (o.isMesh && !o.userData.shared) o.geometry?.dispose?.();
    });
  }
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}
