import * as THREE from 'three';

/*
 * The ground, built procedurally: grass with mowing stripes (a canvas texture), boundary rope,
 * fielding circle, pitch with creases and stumps, sight screens, tiered stands with an
 * instanced crowd, floodlight towers and an evening sky. World units are metres; +z points to
 * the bowler's end (the engine's +y), so the engine's (x, y) maps to (x, z).
 */

export type Quality = 'low' | 'medium' | 'high';
export const STUMPS_Z = 10.06;
export const CREASE_Z = 8.84;

export interface Ground {
  group: THREE.Group;
  axes: { a: number; b: number };
  stumps: { striker: THREE.Group; bowler: THREE.Group };
  resetStumps: () => void;
  crowd: THREE.InstancedMesh | null;
}

function grassTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d')!;
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? '#3f8a3a' : '#468f3f';
    g.fillRect(0, i * 32, 512, 32);
  }
  // A little noise so the outfield does not look flat.
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = `rgba(${20 + Math.random() * 30},${70 + Math.random() * 50},${20 + Math.random() * 20},0.25)`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(5, 5);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function stumpSet(): THREE.Group {
  const g = new THREE.Group();
  const stump = new THREE.CylinderGeometry(0.018, 0.018, 0.71, 6);
  const bail = new THREE.CylinderGeometry(0.01, 0.01, 0.11, 4);
  const m = new THREE.MeshLambertMaterial({ color: '#f4ecd8' });
  for (const x of [-0.115, 0, 0.115]) {
    const s = new THREE.Mesh(stump, m);
    s.position.set(x, 0.355, 0);
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

export function buildGround(scene: THREE.Scene, venue: { boundaryStraight: number; boundarySquare: number }, colors: [string, string], quality: Quality): Ground {
  const group = new THREE.Group();
  scene.add(group);
  const a = venue.boundarySquare;
  const b = venue.boundaryStraight - 8.8;
  const axes = { a, b };

  // Sky and light
  scene.background = new THREE.Color('#0d1626');
  scene.fog = new THREE.Fog('#0d1626', 160, 320);
  scene.add(new THREE.HemisphereLight('#bcd4ff', '#2c4a22', 1.1));
  const sun = new THREE.DirectionalLight('#fff4e0', 1.6);
  sun.position.set(-40, 80, 30);
  if (quality === 'high') {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    const s = sun.shadow.camera as THREE.OrthographicCamera;
    s.left = -40; s.right = 40; s.top = 40; s.bottom = -40;
  }
  scene.add(sun);

  // Outfield
  const outer = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshLambertMaterial({ map: grassTexture() }));
  outer.rotation.x = -Math.PI / 2;
  outer.scale.set(a + 14, b + 14, 1);
  outer.receiveShadow = quality === 'high';
  group.add(outer);

  // Boundary rope
  const curve = new THREE.EllipseCurve(0, 0, a, b, 0, Math.PI * 2, false, 0);
  const pts = curve.getPoints(160).map((p) => new THREE.Vector3(p.x, 0.06, p.y));
  const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 160, 0.09, 5, true), new THREE.MeshLambertMaterial({ color: colors[0] }));
  group.add(rope);
  // Advertising boards just behind the rope
  const boardPts = new THREE.EllipseCurve(0, 0, a + 4, b + 4, 0, Math.PI * 2, false, 0).getPoints(48);
  const boardGeo = new THREE.BoxGeometry(1, 0.9, 0.15);
  const boardMats = [new THREE.MeshLambertMaterial({ color: colors[0] }), new THREE.MeshLambertMaterial({ color: '#1b2233' }), new THREE.MeshLambertMaterial({ color: colors[1] })];
  for (let i = 0; i < boardPts.length; i++) {
    const p = boardPts[i];
    const q = boardPts[(i + 1) % boardPts.length];
    const m = new THREE.Mesh(boardGeo, boardMats[i % 3]);
    m.position.set((p.x + q.x) / 2, 0.45, (p.y + q.y) / 2);
    m.scale.x = Math.hypot(q.x - p.x, q.y - p.y);
    m.rotation.y = -Math.atan2(q.y - p.y, q.x - p.x);
    group.add(m);
  }

  // Fielding circle: dashes 30 yards from each set of stumps
  const dash = new THREE.PlaneGeometry(0.9, 0.12);
  const white = new THREE.MeshBasicMaterial({ color: '#e8efe6', transparent: true, opacity: 0.6 });
  const r = 27.43;
  for (let i = 0; i < 64; i++) {
    const t = (i / 64) * Math.PI * 2;
    const x = Math.cos(t) * r;
    const z = Math.sin(t) * r + (Math.sin(t) >= 0 ? STUMPS_Z : -STUMPS_Z);
    const m = new THREE.Mesh(dash, white);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = -t + Math.PI / 2;
    m.position.set(x, 0.02, z);
    group.add(m);
  }

  // Pitch and creases
  const pitch = new THREE.Mesh(new THREE.PlaneGeometry(3.05, 24), new THREE.MeshLambertMaterial({ color: '#c9b083' }));
  pitch.rotation.x = -Math.PI / 2;
  pitch.position.y = 0.01;
  pitch.receiveShadow = quality === 'high';
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
  const screenGeo = new THREE.BoxGeometry(14, 6, 0.5);
  const screenMat = new THREE.MeshLambertMaterial({ color: '#eef1f4' });
  for (const s of [1, -1]) {
    const m = new THREE.Mesh(screenGeo, screenMat);
    m.position.set(0, 3, s * (b + 9));
    group.add(m);
  }

  // Stands: tiers around the ground, with gaps for the sight screens
  const standMat = new THREE.MeshLambertMaterial({ color: '#283043' });
  const roofMat = new THREE.MeshLambertMaterial({ color: '#3b455c' });
  const segs = 36;
  const seatPositions: THREE.Vector3[] = [];
  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * Math.PI * 2;
    const t1 = ((i + 1) / segs) * Math.PI * 2;
    const tm = (t0 + t1) / 2;
    if (Math.abs(Math.cos(tm)) < 0.12) continue; // sight-screen gaps (straight ends)
    for (let tier = 0; tier < 3; tier++) {
      const ra = a + 12 + tier * 6;
      const rb = b + 12 + tier * 6;
      const p0 = new THREE.Vector2(Math.cos(t0) * ra, Math.sin(t0) * rb);
      const p1 = new THREE.Vector2(Math.cos(t1) * ra, Math.sin(t1) * rb);
      const len = p0.distanceTo(p1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len + 0.4, 2.5 + tier * 3, 5.5), standMat);
      m.position.set((p0.x + p1.x) / 2, (2.5 + tier * 3) / 2, (p0.y + p1.y) / 2);
      m.rotation.y = -Math.atan2(p1.y - p0.y, p1.x - p0.x);
      group.add(m);
      for (let k = 0; k < 10; k++) {
        const f = (k + 0.5) / 10;
        seatPositions.push(new THREE.Vector3(p0.x + (p1.x - p0.x) * f, 2.5 + tier * 3 + 0.4, p0.y + (p1.y - p0.y) * f));
      }
    }
    if (i % 3 === 0) {
      const roof = new THREE.Mesh(new THREE.BoxGeometry(2 * Math.PI * (a + 24) / segs * 3, 0.5, 14), roofMat);
      const tm3 = tm + (Math.PI * 2) / segs;
      roof.position.set(Math.cos(tm3) * (a + 25), 13, Math.sin(tm3) * (b + 25));
      roof.rotation.y = -tm3 + Math.PI / 2;
      group.add(roof);
    }
  }

  // Crowd: one instanced mesh, density by quality
  let crowd: THREE.InstancedMesh | null = null;
  const perSeat = quality === 'low' ? 2 : quality === 'medium' ? 5 : 9;
  const count = seatPositions.length * perSeat;
  if (count) {
    crowd = new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 0.7, 0.35), new THREE.MeshLambertMaterial(), count);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    const palette = [colors[0], colors[1], '#e5e7eb', '#1f2937', '#f59e0b', colors[0]];
    let n = 0;
    for (const p of seatPositions) {
      for (let k = 0; k < perSeat; k++) {
        const jitter = (Math.random() - 0.5) * 3;
        const dir = Math.atan2(p.z, p.x);
        m.makeTranslation(p.x + Math.cos(dir + Math.PI / 2) * jitter, p.y + Math.random() * 0.2, p.z + Math.sin(dir + Math.PI / 2) * jitter);
        crowd.setMatrixAt(n, m);
        crowd.setColorAt(n, c.set(palette[Math.floor(Math.random() * palette.length)]));
        n++;
      }
    }
    crowd.instanceMatrix.needsUpdate = true;
    group.add(crowd);
  }

  // Floodlight towers
  const poleGeo = new THREE.CylinderGeometry(0.5, 0.8, 40, 6);
  const headGeo = new THREE.BoxGeometry(6, 3.5, 1);
  const pole = new THREE.MeshLambertMaterial({ color: '#4b5563' });
  const lamp = new THREE.MeshBasicMaterial({ color: '#fff8dc' });
  for (const t of [0.6, 2.55, 3.75, 5.7]) {
    const x = Math.cos(t) * (a + 40);
    const z = Math.sin(t) * (b + 40);
    const p = new THREE.Mesh(poleGeo, pole);
    p.position.set(x, 20, z);
    const h = new THREE.Mesh(headGeo, lamp);
    h.position.set(x, 41, z);
    h.lookAt(0, 0, 0);
    group.add(p, h);
  }
  return { group, axes, stumps: { striker, bowler }, resetStumps, crowd };
}
