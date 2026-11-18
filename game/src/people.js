// PALMBAY HEAT — people.js (v3): LEGO-minifigure citizens (Jaka fix
// #8 — "orangnya dibikin seperti lego dengan detail yang sempurna").
// Every human is a crisp minifig: cylindrical head with a top stud and
// a printed smile, trapezoid torso with a printed-detail plate (police
// uniform + badge, gang chain, civil prints), arms ending in C-shaped
// hands, separate hip + leg pieces. Pivot-based limbs keep the v2
// walk cycle, aim poses, surrender pose and weapon attach working.
// Pedestrians walk the SIDEWALKS along the road grid (lane offset now
// derived from each road's real width — avenues included).
const THREE = window.THREE;
import { CFG, PALETTE, SCALE, clamp } from './config.js';
import { roadCoord, nearestRoadCoord, roadHalfAt } from './world.js';
import { faceTexture, torsoPrintTexture } from './textures.js';

const SHIRTS = PALETTE.shirts;
const PANTS = PALETTE.pants;
const SKINS = PALETTE.skinTones;

const HAIRS = [0x2a1a10, 0x111111, 0x5a3a1a, 0x8a6a3a, 0xb8b0a4, 0x743028];

// minimal non-indexed merge for the shared part geometries below
function mergeGeos(list) {
  let total = 0;
  const parts = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    total += n.attributes.position.count;
    return n;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o3 = 0, o2 = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o3);
    nor.set(g.attributes.normal.array, o3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
    o3 += g.attributes.position.count * 3;
    o2 += g.attributes.position.count * 2;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}

// --- shared minifig geometry (built once; materials vary per person) ---
// The figure faces +Z. Total height 1.81 m (SCALE.personH = 1.8).
const hipGeo = new THREE.BoxGeometry(0.52, 0.18, 0.27);
const legGeo = (() => {
  // one leg piece: column + foot step, hanging below its hip pivot
  const col = new THREE.BoxGeometry(0.24, 0.72, 0.26);
  col.translate(0, -0.36, 0);
  const foot = new THREE.BoxGeometry(0.24, 0.1, 0.36);
  foot.translate(0, -0.67, 0.05);
  return mergeGeos([col, foot]);
})();
const torsoGeo = (() => {
  // trapezoid torso: 4-sided frustum, wider at the shoulders,
  // flattened front-to-back — the classic minifig silhouette
  const t = new THREE.CylinderGeometry(0.396, 0.311, 0.58, 4);
  t.rotateY(Math.PI / 4);
  t.scale(1, 1, 0.62);
  return t;
})();
const plateGeo = new THREE.PlaneGeometry(0.4, 0.48);
const neckGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.06, 10);
const headGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.26, 18);
const studGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.05, 12);
const hairGeo = new THREE.CylinderGeometry(0.185, 0.198, 0.15, 14);
const armGeo = (() => {
  const up = new THREE.BoxGeometry(0.13, 0.34, 0.15);
  up.translate(0, -0.17, 0);
  const fore = new THREE.BoxGeometry(0.115, 0.24, 0.135);
  fore.translate(0, -0.44, 0.012);
  return mergeGeos([up, fore]);
})();
const handGeo = (() => {
  // the C-hand: a torus arc whose opening faces forward (+Z)
  const t = new THREE.TorusGeometry(0.082, 0.027, 8, 14, 3.9);
  t.rotateY(Math.PI / 2);
  t.rotateX(0.6);
  return t;
})();
let FACE_TEX = null;
const PRINT_TEX = {};
function printTex(kind, variant) {
  const key = kind + ':' + variant;
  if (!PRINT_TEX[key]) PRINT_TEX[key] = torsoPrintTexture(kind, variant);
  return PRINT_TEX[key];
}

// A minifigure built from joint pivots: rotation.x on a limb pivot
// swings it (walk cycle, aim poses, hands-up surrender all reuse it).
export function makePerson(shirt, pants, skin = 0xd9a066, opts = {}) {
  const g = new THREE.Group();
  // hard-surface plastic: low roughness, no metalness
  const mat = (c, r = 0.38) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  const shirtMat = mat(shirt);
  const pantsMat = mat(pants);
  const skinMat = mat(skin, 0.45);
  if (!FACE_TEX) FACE_TEX = faceTexture();
  const headMat = new THREE.MeshStandardMaterial({
    map: FACE_TEX, color: skin, roughness: 0.45,
  });
  // hip piece (the minifig "hips" block both legs hang from)
  const hip = new THREE.Mesh(hipGeo, pantsMat);
  hip.position.y = 0.78;
  hip.castShadow = true;
  g.add(hip);
  // limbs: pivot group at the joint, mesh hangs below it
  const limb = (geo, m, withHand) => {
    const p = new THREE.Group();
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true;
    p.add(mesh);
    if (withHand) {
      const hand = new THREE.Mesh(handGeo, skinMat);
      hand.position.set(0, -0.6, 0.02);
      p.add(hand);
    }
    return p;
  };
  const legL = limb(legGeo, pantsMat, false);
  legL.position.set(-0.135, 0.72, 0);
  const legR = limb(legGeo, pantsMat, false);
  legR.position.set(0.135, 0.72, 0);
  // trapezoid torso + printed-detail plate on the chest
  const torso = new THREE.Mesh(torsoGeo, shirtMat);
  torso.position.y = 1.16;
  torso.castShadow = true;
  g.add(torso);
  const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({
    map: printTex(opts.print || 'civil', opts.printVariant || 0),
    transparent: true, roughness: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1,
  }));
  plate.position.set(0, 1.17, 0.185);
  plate.rotation.x = 0.1;
  g.add(plate);
  const neck = new THREE.Mesh(neckGeo, shirtMat);
  neck.position.y = 1.475;
  g.add(neck);
  // cylindrical head (printed smile faces +Z via the π yaw) + stud/hair
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.63;
  head.rotation.y = Math.PI;
  head.castShadow = true;
  g.add(head);
  if (opts.hair) {
    const hair = new THREE.Mesh(hairGeo, mat(opts.hairColor || 0x2a1a10, 0.5));
    hair.position.y = 1.72;
    hair.castShadow = true;
    g.add(hair);
  } else if (!opts.noStud) {
    const stud = new THREE.Mesh(studGeo, skinMat);
    stud.position.y = 1.785;
    g.add(stud);
  }
  // arms on shoulder pivots, C-hands at the bottom
  const armMat = opts.sleeveless ? skinMat : shirtMat;
  const armL = limb(armGeo, armMat, true);
  armL.position.set(-0.345, 1.4, 0);
  const armR = limb(armGeo, armMat, true);
  armR.position.set(0.345, 1.4, 0);
  g.add(legL, legR, armL, armR);
  g.userData = {
    legL, legR, armL, armR,
    walkPhase: Math.random() * 6,
    speed: 0, heading: 0, fleeing: false,
    isPerson: true,
    minifig: true,
    // walk(phase) swings limbs; called by owners, not here
    walk(phase, amp = 0.55) {
      legL.rotation.x = Math.sin(phase) * amp;
      legR.rotation.x = Math.sin(phase + Math.PI) * amp;
      armL.rotation.x = Math.sin(phase + Math.PI) * amp * 0.7;
      armR.rotation.x = Math.sin(phase) * amp * 0.7;
    },
    idle() {
      legL.rotation.x *= 0.8; legR.rotation.x *= 0.8;
      armL.rotation.x *= 0.8; armR.rotation.x *= 0.8;
    },
  };
  return g;
}

// --- weapons held in the right hand (pistol / rifle, correct scale) ---
export function makePistol() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.4, metalness: 0.6 });
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.07), dark);
  grip.position.y = -0.05;
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.24), dark);
  barrel.position.set(0, 0.04, 0.12);
  const slide = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.04, 0.2), dark);
  slide.position.set(0, 0.075, 0.1);
  g.add(grip, barrel, slide);
  return g;
}

export function makeRifle() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.45, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x6a4a28, roughness: 0.8 });
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.34), wood);
  stock.position.set(0, -0.02, -0.28);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.5), dark);
  body.position.set(0, 0.02, 0.05);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, 0.52);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.16, 0.08), dark);
  mag.position.set(0, -0.08, 0.08);
  mag.rotation.x = 0.2;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.02), dark);
  sight.position.set(0, 0.09, 0.28);
  g.add(stock, body, barrel, mag, sight);
  return g;
}

// Attach a weapon to a person's right hand (hand = end of armR pivot).
// Returns the weapon group; call detachWeapon(person) to remove it.
export function attachWeapon(person, kind) {
  detachWeapon(person);
  const w = kind === 'rifle' ? makeRifle() : makePistol();
  const armR = person.userData.armR;
  // hand sits at the bottom of the arm: y -0.62 in pivot space
  w.position.set(0, -0.62, 0.02);
  if (kind === 'rifle') {
    // rifle held across the body, barrel forward (+Z of the person)
    w.rotation.x = Math.PI / 2 - 0.35;
    w.position.set(0, -0.62, 0.12);
  } else {
    // pistol points forward when the arm aims
    w.rotation.x = Math.PI / 2;
  }
  armR.add(w);
  person.userData.weaponMesh = w;
  person.userData.weaponKind = kind;
  return w;
}

export function detachWeapon(person) {
  const w = person.userData.weaponMesh;
  if (w) {
    person.userData.armR.remove(w);
    person.userData.weaponMesh = null;
    person.userData.weaponKind = null;
  }
}

export function heroPerson() {
  // Dario Venn: white tank top, dark jeans, gold chain, dark hair
  const p = makePerson(0xf2f2ea, 0x2c3e50, 0xc98a5a, {
    sleeveless: true, print: 'hero', hair: true, hairColor: 0x1a1210,
  });
  const chain = new THREE.Mesh(
    new THREE.TorusGeometry(0.11, 0.015, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0xd8a030, metalness: 0.9, roughness: 0.3 })
  );
  chain.position.set(0, 1.42, 0.03);
  chain.rotation.x = Math.PI / 2 - 0.35;
  p.add(chain);
  p.userData.hero = true;
  return p;
}

export class Pedestrians {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.peds = [];
    this.group = new THREE.Group();
    scene.add(this.group);
  }
  spawn(n) {
    for (let i = 0; i < n; i++) {
      const p = makePerson(
        SHIRTS[Math.floor(this.rand() * SHIRTS.length)],
        PANTS[Math.floor(this.rand() * PANTS.length)],
        SKINS[Math.floor(this.rand() * SKINS.length)],
        {
          print: 'civil',
          printVariant: Math.floor(this.rand() * 4),
          hair: this.rand() < 0.55,
          hairColor: HAIRS[Math.floor(this.rand() * HAIRS.length)],
        }
      );
      // sidewalk lane: pick a road line + side, walk along it.
      // v3 audit: the lane offset must come from THIS road's width —
      // the old fixed offset put avenue pedestrians on the asphalt.
      const vertical = this.rand() < 0.5;
      const line = Math.floor(this.rand() * (CFG.gridN + 1));
      const coord = roadCoord(line);
      const side = (this.rand() < 0.5 ? 1 : -1) * (roadHalfAt(coord) + 1.45);
      const along = (this.rand() * 2 - 1) * 195;
      if (vertical) {
        p.position.set(coord + side, 0, along);
        p.userData.heading = this.rand() < 0.5 ? 0 : Math.PI;
      } else {
        p.position.set(along, 0, coord + side);
        p.userData.heading = this.rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
      }
      p.userData.vertical = vertical;
      p.userData.roadLine = coord;
      p.userData.side = side;
      p.userData.speed = 1.2 + this.rand() * 0.5;
      p.userData.wait = 0;
      this.group.add(p);
      this.peds.push(p);
    }
  }
  fleeFrom(x, z, radius = 18) {
    for (const p of this.peds) {
      const dx = p.position.x - x, dz = p.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d < radius) {
        p.userData.fleeing = true;
        p.userData.heading = Math.atan2(dx, dz);
        p.userData.speed = 4.5;
        p.userData.fleeTimer = 3;
      }
    }
  }
  update(dt) {
    for (const p of this.peds) {
      const u = p.userData;
      if (u.fleeTimer !== undefined) {
        u.fleeTimer -= dt;
        if (u.fleeTimer <= 0) {
          u.fleeing = false;
          u.speed = 1.2 + this.rand() * 0.5;
          u.fleeTimer = undefined;
          // snap back to a sidewalk lane
          u.heading = u.vertical ? (u.heading < Math.PI ? 0 : Math.PI)
            : (u.heading > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
      }
      if (u.wait > 0) { u.wait -= dt; u.idle(); continue; }
      // wander: occasionally pause, U-turn, or turn at an intersection
      if (this.rand() < dt * 0.06) {
        const roll = this.rand();
        if (roll < 0.25) u.wait = 1 + this.rand() * 3;
        else if (roll < 0.45) u.heading += Math.PI; // U-turn
        else if (roll < 0.6) {
          // turn onto the crossing street at an intersection
          const nx = nearestRoadCoord(p.position.x);
          const nz = nearestRoadCoord(p.position.z);
          const nearX = Math.abs(p.position.x - nx) < 8;
          const nearZ = Math.abs(p.position.z - nz) < 8;
          if (nearX || nearZ) {
            u.vertical = !u.vertical;
            u.heading = u.vertical
              ? (this.rand() < 0.5 ? 0 : Math.PI)
              : (this.rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
            if (u.vertical) {
              // v3 audit: recompute the lane offset for the NEW road's
              // width before snapping, or the ped walks through blocks
              u.roadLine = nx;
              u.side = Math.sign(u.side) * (roadHalfAt(nx) + 1.45);
              p.position.x = nx + u.side;
            } else {
              u.roadLine = nz;
              u.side = Math.sign(u.side) * (roadHalfAt(nz) + 1.45);
              p.position.z = nz + u.side;
            }
          }
        }
      }
      const vx = Math.sin(u.heading) * u.speed;
      const vz = Math.cos(u.heading) * u.speed;
      p.position.x += vx * dt;
      p.position.z += vz * dt;
      // stay on the sidewalk lane: clamp along-axis, keep lateral offset
      if (u.vertical) {
        p.position.x = u.roadLine + u.side;
        if (p.position.z > 205) { p.position.z = 205; u.heading = Math.PI; }
        if (p.position.z < -205) { p.position.z = -205; u.heading = 0; }
      } else {
        p.position.z = u.roadLine + u.side;
        if (p.position.x > 205) { p.position.x = 205; u.heading = -Math.PI / 2; }
        if (p.position.x < -205) { p.position.x = -205; u.heading = Math.PI / 2; }
      }
      p.rotation.y = u.heading;
      // walk cycle (delta-time, phase advances with speed)
      u.walkPhase += dt * u.speed * 3.2;
      u.walk(u.walkPhase);
    }
  }
}
