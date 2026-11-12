import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AssetLoader } from '../assets/AssetLoader';

// Procedurally modelled view-models (original work). Weapon space: -Z forward, +Y up, +X right, metres.
export interface GunMats { metal: THREE.Material; metalWorn: THREE.Material; polymer: THREE.Material; furniture: THREE.Material; dark: THREE.Material; chrome: THREE.Material; brass: THREE.Material; glove: THREE.Material; gloveGrip: THREE.Material; sleeve: THREE.Material; dot: THREE.Material; lens: THREE.Material; sightDot: THREE.Material }

export function createGunMaterials(a: AssetLoader): GunMats {
  const fab = a.set('fabric'); const rust = a.set('metal_rust');
  const fabric = (color: number, rep: number, rough = 0.9) => { const n = fab.normal.clone(); n.repeat.set(rep, rep); n.needsUpdate = true; return new THREE.MeshStandardMaterial({ color, roughness: rough, normalMap: n, normalScale: new THREE.Vector2(0.8, 0.8) }); };
  const worn = rust.normal.clone(); worn.repeat.set(3, 3); worn.needsUpdate = true;
  return {
    metal: new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.6, roughness: 0.45, envMapIntensity: 3 }),
    metalWorn: new THREE.MeshStandardMaterial({ color: 0x45484d, metalness: 0.65, roughness: 0.4, normalMap: worn, normalScale: new THREE.Vector2(0.12, 0.12), envMapIntensity: 3 }),
    polymer: new THREE.MeshStandardMaterial({ color: 0x232426, roughness: 0.62, envMapIntensity: 2 }),
    furniture: new THREE.MeshStandardMaterial({ color: 0x4d4636, roughness: 0.7, envMapIntensity: 2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x030303, roughness: 0.9 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0x9a9da0, metalness: 1, roughness: 0.22 }),
    brass: new THREE.MeshStandardMaterial({ color: 0xb08a3a, metalness: 1, roughness: 0.32 }),
    glove: fabric(0x35373b, 5, 0.85), gloveGrip: fabric(0x1c1d1f, 9, 0.7), sleeve: fabric(0x2c342b, 7, 0.95),
    dot: new THREE.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
    lens: new THREE.MeshStandardMaterial({ color: 0x223040, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.2, depthWrite: false }),
    sightDot: new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: 0x7dffa0, emissiveIntensity: 0.9 }),
  };
}

/** Extrudes a side profile given as [forward, up] points into a part of the given width. */
function profile(pts: [number, number][], width: number, bevel = 0.0015, holes: [number, number][][] = []): THREE.BufferGeometry {
  const sh = new THREE.Shape(); pts.forEach(([f, y], i) => (i ? sh.lineTo(f, y) : sh.moveTo(f, y))); sh.closePath();
  for (const h of holes) { const p = new THREE.Path(); h.forEach(([f, y], i) => (i ? p.lineTo(f, y) : p.moveTo(f, y))); p.closePath(); sh.holes.push(p); }
  const g = new THREE.ExtrudeGeometry(sh, { depth: width - bevel * 2, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 4 });
  g.translate(0, 0, -(width - bevel * 2) / 2); g.rotateY(Math.PI / 2); return g;
}
const mesh = (g: THREE.BufferGeometry, m: THREE.Material, parent: THREE.Object3D, f = 0, y = 0, x = 0): THREE.Mesh => { const o = new THREE.Mesh(g, m); o.position.set(x, y, -f); o.receiveShadow = true; parent.add(o); return o; };
const box = (w: number, h: number, l: number, m: THREE.Material, parent: THREE.Object3D, f: number, y: number, x = 0) => mesh(new THREE.BoxGeometry(w, h, l), m, parent, f, y, x);
/** Cylinder lying along the bore axis from f0 to f1. */
const tube = (r: number, f0: number, f1: number, m: THREE.Material, parent: THREE.Object3D, y: number, seg = 16, x = 0) => { const g = new THREE.CylinderGeometry(r, r, f1 - f0, seg); g.rotateX(Math.PI / 2); return mesh(g, m, parent, (f0 + f1) / 2, y, x); };

export interface HandPose { curls: [number, number, number][]; thumb: [number, number, number]; thumbCurl: number; spread?: number }
/**
 * Gloved hand. Local space: fingers extend along -Z from the knuckles (z = 0), palm faces -Y,
 * wrist at z = +0.1. side = 1 right hand (thumb on -X), -1 left hand.
 */
export function makeHand(side: 1 | -1, pose: HandPose, m: GunMats): THREE.Group {
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.088, 0.032, 0.102, 3, 0.013), m.glove); palm.position.set(0, 0, 0.05); hand.add(palm);
  const pad = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.012, 0.03, 2, 0.005), m.gloveGrip); pad.position.set(0, 0.016, 0.012); hand.add(pad);
  const inner = new THREE.Mesh(new RoundedBoxGeometry(0.078, 0.008, 0.085, 2, 0.004), m.gloveGrip); inner.position.set(0, -0.015, 0.05); hand.add(inner);
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.034, 0.05, 14), m.gloveGrip); cuff.rotation.x = Math.PI / 2; cuff.scale.set(1, 0.72, 1); cuff.position.set(0, 0, 0.122); hand.add(cuff);
  const lens = [[0.04, 0.025, 0.021], [0.044, 0.028, 0.022], [0.041, 0.026, 0.021], [0.032, 0.02, 0.018]];
  const rad = [0.0098, 0.0102, 0.0096, 0.0086];
  for (let i = 0; i < 4; i++) {
    let parent: THREE.Object3D = hand; let z = 0;
    for (let s = 0; s < 3; s++) {
      const j = new THREE.Group(); j.position.set(s === 0 ? side * (-0.0315 + i * 0.021) : 0, 0, s === 0 ? 0 : z); j.rotation.x = pose.curls[i][s];
      if (s === 0) j.rotation.y = side * (i - 1.5) * (pose.spread ?? 0.04);
      const r = rad[i] * (1 - s * 0.08), L = lens[i][s];
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, L, 3, 8), s === 2 ? m.gloveGrip : m.glove); seg.rotation.x = Math.PI / 2; seg.position.z = -L / 2; j.add(seg);
      parent.add(j); parent = j; z = -L;
    }
  }
  const tb = new THREE.Group(); tb.position.set(side * -0.04, -0.004, 0.065); tb.rotation.set(pose.thumb[0], side * pose.thumb[1], side * pose.thumb[2]);
  const t1 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0125, 0.04, 3, 8), m.glove); t1.rotation.x = Math.PI / 2; t1.position.z = -0.02; tb.add(t1);
  const tj = new THREE.Group(); tj.position.z = -0.042; tj.rotation.x = pose.thumbCurl; const t2 = new THREE.Mesh(new THREE.CapsuleGeometry(0.0105, 0.028, 3, 8), m.gloveGrip); t2.rotation.x = Math.PI / 2; t2.position.z = -0.016; tj.add(t2); tb.add(tj);
  hand.add(tb);
  mergeStatic(hand);
  return hand;
}

/** Sleeved forearm; stretched each frame between a wrist and an elbow anchor. */
export function makeArm(m: GunMats): THREE.Mesh {
  const g = new THREE.CylinderGeometry(0.034, 0.047, 1, 14, 1); g.rotateX(-Math.PI / 2); g.translate(0, 0, 0.5); // +Z = toward elbow, unit length
  const a = new THREE.Mesh(g, m.sleeve); a.scale.set(1, 0.9, 0.4); a.receiveShadow = true; return a;
}

export interface GunModel { root: THREE.Group; slide: THREE.Object3D; mag: THREE.Object3D; muzzle: THREE.Object3D; eject: THREE.Object3D; trigger?: THREE.Object3D }

export function buildPistol(m: GunMats): GunModel {
  const root = new THREE.Group();
  mesh(profile([[-0.024, 0.002], [0.16, 0.002], [0.16, -0.02], [0.04, -0.02], [0.022, -0.112], [-0.03, -0.122], [-0.017, -0.05], [-0.034, -0.016]], 0.03, 0.003), m.polymer, root);
  mesh(profile([[0.036, -0.018], [0.094, -0.018], [0.094, -0.05], [0.085, -0.061], [0.03, -0.061]], 0.013, 0.001, [[[0.042, -0.024], [0.088, -0.024], [0.088, -0.048], [0.081, -0.055], [0.04, -0.055]]]), m.polymer, root);
  const trig = box(0.006, 0.024, 0.007, m.metal, root, 0.058, -0.037); trig.rotation.x = 0.25;
  box(0.032, 0.006, 0.02, m.metal, root, 0.12, -0.021); // accessory rail
  box(0.0325, 0.012, 0.004, m.metal, root, 0.02, -0.01); // slide stop
  // slide (recoils)
  const slide = new THREE.Group(); root.add(slide);
  mesh(profile([[-0.028, 0.003], [0.164, 0.003], [0.168, 0.009], [0.168, 0.026], [0.164, 0.031], [-0.028, 0.031]], 0.0285, 0.0022), m.metalWorn, slide);
  for (let i = 0; i < 7; i++) for (const s of [-1, 1]) box(0.001, 0.02, 0.0018, m.dark, slide, -0.02 + i * 0.0045, 0.018, s * 0.0142);
  box(0.0105, 0.012, 0.04, m.dark, slide, 0.085, 0.0252, 0.0092); box(0.009, 0.004, 0.036, m.chrome, slide, 0.085, 0.022, 0.008);
  box(0.0035, 0.0055, 0.006, m.metal, slide, 0.158, 0.0335); box(0.002, 0.002, 0.001, m.sightDot, slide, 0.1548, 0.0345);
  box(0.02, 0.004, 0.012, m.metal, slide, -0.018, 0.0328);
  for (const s of [-1, 1]) { box(0.005, 0.006, 0.008, m.metal, slide, -0.02, 0.0365, s * 0.0058); box(0.002, 0.002, 0.001, m.sightDot, slide, -0.0242, 0.0365, s * 0.0058); }
  tube(0.0072, 0.166, 0.172, m.chrome, root, 0.019); tube(0.0046, 0.1705, 0.1725, m.dark, root, 0.019, 10);
  tube(0.004, 0.166, 0.171, m.metal, root, 0.008, 8); // guide rod
  // magazine (slides along the grip axis)
  const mag = new THREE.Group(); mag.position.set(0, -0.118, 0.006); mag.rotation.x = -0.135; root.add(mag);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.105, 0.03), m.metal); body.position.y = 0.05; mag.add(body);
  const plate = new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.01, 0.045, 2, 0.003), m.polymer); plate.position.set(0, -0.004, -0.002); mag.add(plate);
  const rnd = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.02, 8), m.brass); rnd.rotation.x = Math.PI / 2; rnd.position.set(0, 0.105, -0.004); mag.add(rnd);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.019, -0.18); root.add(muzzle);
  const eject = new THREE.Object3D(); eject.position.set(0.018, 0.028, -0.085); root.add(eject);
  mergeStatic(root, [slide, mag, trig]);
  return { root, slide, mag, muzzle, eject, trigger: trig };
}

export function buildRifle(m: GunMats): GunModel {
  const root = new THREE.Group(); const B = 0.045; // bore height
  mesh(profile([[-0.05, 0.012], [0.0, 0.0], [0.19, 0.0], [0.2, 0.012], [0.2, 0.079], [-0.05, 0.079]], 0.044, 0.003), m.metalWorn, root);
  mesh(profile([[0.083, 0.004], [0.152, 0.004], [0.156, -0.042], [0.08, -0.034]], 0.037, 0.002), m.metalWorn, root);
  mesh(profile([[0.004, 0.004], [0.046, 0.004], [0.03, -0.1], [-0.024, -0.106], [-0.012, -0.04]], 0.031, 0.004), m.polymer, root);
  mesh(profile([[0.044, -0.004], [0.084, -0.004], [0.084, -0.046], [0.044, -0.046]], 0.012, 0.001, [[[0.048, -0.008], [0.08, -0.008], [0.08, -0.042], [0.048, -0.042]]]), m.metal, root);
  const trig = box(0.005, 0.022, 0.006, m.metal, root, 0.058, -0.02); trig.rotation.x = 0.3;
  // stock
  tube(0.0145, -0.27, -0.05, m.metal, root, 0.052, 14);
  mesh(profile([[-0.11, 0.08], [-0.3, 0.08], [-0.312, 0.072], [-0.312, -0.052], [-0.29, -0.062], [-0.2, 0.015], [-0.11, 0.028]], 0.04, 0.004), m.polymer, root);
  box(0.042, 0.13, 0.012, m.dark, root, -0.314, 0.01);
  // handguard + rail
  const hg = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8); hg.rotateX(Math.PI / 2); hg.rotateZ(Math.PI / 8); mesh(hg, m.furniture, root, 0.35, B);
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) box(0.002, 0.012, 0.034, m.dark, root, 0.235 + i * 0.056, B, s * 0.0288);
  box(0.022, 0.009, 0.5, m.metal, root, 0.25, 0.083);
  for (let i = 0; i < 24; i++) box(0.0225, 0.004, 0.011, m.metal, root, 0.012 + i * 0.0205, 0.0885);
  // barrel, gas block, flash hider
  tube(0.0088, 0.2, 0.67, m.metal, root, B, 14); tube(0.014, 0.52, 0.56, m.metalWorn, root, B, 12); tube(0.0118, 0.67, 0.72, m.metal, root, B, 12);
  for (let i = 0; i < 4; i++) { const s = box(0.003, 0.026, 0.028, m.dark, root, 0.697, B); s.rotation.z = (i * Math.PI) / 4; }
  tube(0.0058, 0.716, 0.7215, m.dark, root, B, 10);
  // ejection port + bolt carrier (reciprocates), charging handle, controls
  box(0.002, 0.02, 0.07, m.dark, root, 0.11, 0.054, 0.0222);
  const slide = new THREE.Group(); root.add(slide); box(0.004, 0.016, 0.066, m.chrome, slide, 0.11, 0.054, 0.0214);
  box(0.03, 0.01, 0.05, m.metal, root, -0.04, 0.084); box(0.05, 0.008, 0.012, m.metal, root, -0.06, 0.084);
  box(0.004, 0.012, 0.012, m.metal, root, 0.13, 0.02, 0.0225); const fa = tube(0.006, 0.0, 0.02, m.metal, root, 0.05, 8, 0.024); fa.rotation.y = 0.5;
  box(0.004, 0.03, 0.01, m.metal, root, 0.165, 0.03, -0.0225);
  // reflex sight
  const sight = new THREE.Group(); sight.position.set(0, 0.0915, -0.1); root.add(sight);
  box(0.03, 0.012, 0.05, m.metal, sight, 0, 0.006);
  for (const s of [-1, 1]) box(0.003, 0.034, 0.012, m.metal, sight, 0.02, 0.029, s * 0.0165);
  box(0.036, 0.003, 0.012, m.metal, sight, 0.02, 0.0465); box(0.03, 0.02, 0.014, m.metal, sight, -0.018, 0.016);
  const lens = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.032), m.lens); lens.position.set(0, 0.029, -0.02); sight.add(lens);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.0011, 10), m.dot); dot.position.set(0, 0.0285, -0.0195); sight.add(dot);
  // folded front sight
  box(0.014, 0.01, 0.03, m.metal, root, 0.47, 0.092);
  // curved magazine
  const mag = new THREE.Group(); mag.position.set(0, -0.03, -0.118); root.add(mag);
  const mg = profile([[-0.03, 0.03], [0.03, 0.026], [0.05, -0.1], [0.046, -0.172], [-0.012, -0.164], [-0.02, -0.07]], 0.026, 0.002); const mm = new THREE.Mesh(mg, m.metal); mm.receiveShadow = true; mag.add(mm);
  for (let i = 0; i < 3; i++) { const r = new THREE.Mesh(new THREE.BoxGeometry(0.0275, 0.003, 0.05), m.dark); r.position.set(0, -0.05 - i * 0.04, -0.012 - i * 0.008); r.rotation.x = 0.12 + i * 0.05; mag.add(r); }
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, B, -0.74); root.add(muzzle);
  const eject = new THREE.Object3D(); eject.position.set(0.026, 0.056, -0.11); root.add(eject);
  mergeStatic(root, [slide, mag, trig]);
  return { root, slide, mag, muzzle, eject, trigger: trig };
}

/**
 * Collapses all meshes under root into one mesh per material (draw-call reduction).
 * Objects listed in `keep` (moving parts) are left alone and merged within themselves.
 */
export function mergeStatic(root: THREE.Object3D, keep: THREE.Object3D[] = []): void {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(); const by = new Map<THREE.Material, THREE.BufferGeometry[]>(); const dead: THREE.Mesh[] = [];
  const walk = (o: THREE.Object3D) => {
    if (keep.includes(o)) return;
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      let g = m.geometry.clone(); if (g.index) g = g.toNonIndexed();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
      const mat = m.material as THREE.Material; let a = by.get(mat); if (!a) by.set(mat, (a = [])); a.push(g); dead.push(m);
    }
    for (const c of [...o.children]) walk(c);
  };
  for (const c of [...root.children]) walk(c);
  for (const m of dead) { m.parent?.remove(m); m.geometry.dispose(); }
  for (const [mat, geos] of by) { const mesh = new THREE.Mesh(mergeGeometries(geos, false)!, mat); mesh.receiveShadow = true; root.add(mesh); geos.forEach((g) => g.dispose()); }
  for (const k of keep) if (!(k as THREE.Mesh).isMesh) mergeStatic(k);
}
