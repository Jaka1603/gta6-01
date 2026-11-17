// PALMBAY HEAT — people.js (v2): proportional SA characters (~1.8 m).
// Pivot-based limbs: legs 0.8 / torso 0.6 / head 0.28, walk cycle with
// swinging arms and legs. Pedestrians walk the SIDEWALKS along the road
// grid (never through buildings). Weapons attach to the right hand.
const THREE = window.THREE;
import { CFG, PALETTE, SCALE, clamp } from './config.js';
import { roadCoord, nearestRoadCoord } from './world.js';

const SHIRTS = PALETTE.shirts;
const PANTS = PALETTE.pants;
const SKINS = PALETTE.skinTones;

function limbGeo(w, len) {
  return new THREE.BoxGeometry(w, len, w);
}

// A person built from joint pivots: rotation.x on a limb pivot swings it.
export function makePerson(shirt, pants, skin = 0xd9a066, opts = {}) {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });
  const shirtMat = mat(shirt);
  const pantsMat = mat(pants);
  const skinMat = mat(skin);
  // torso (tank top / tee)
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.22), shirtMat);
  torso.position.y = 1.1;
  torso.castShadow = true;
  g.add(torso);
  // head + hair cap
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 12, 10), skinMat);
  head.position.y = 1.58;
  head.castShadow = true;
  g.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(opts.hairColor || 0x2a1a10)
  );
  hair.position.y = 1.6;
  g.add(hair);
  // limbs: pivot group at the joint, mesh hangs below it
  const limb = (w, len, m) => {
    const p = new THREE.Group();
    const mesh = new THREE.Mesh(limbGeo(w, len), m);
    mesh.position.y = -len / 2;
    mesh.castShadow = true;
    p.add(mesh);
    return p;
  };
  const legL = limb(0.15, 0.8, pantsMat);
  legL.position.set(0, 0.8, 0.11);
  const legR = limb(0.15, 0.8, pantsMat);
  legR.position.set(0, 0.8, -0.11);
  const armL = limb(0.11, 0.62, opts.sleeveless ? skinMat : shirtMat);
  armL.position.set(0, 1.36, 0.28);
  const armR = limb(0.11, 0.62, opts.sleeveless ? skinMat : shirtMat);
  armR.position.set(0, 1.36, -0.28);
  g.add(legL, legR, armL, armR);
  g.userData = {
    legL, legR, armL, armR,
    walkPhase: Math.random() * 6,
    speed: 0, heading: 0, fleeing: false,
    isPerson: true,
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
  const p = makePerson(0xf2f2ea, 0x2c3e50, 0xc98a5a, { sleeveless: true });
  const chain = new THREE.Mesh(
    new THREE.TorusGeometry(0.11, 0.015, 6, 14),
    new THREE.MeshStandardMaterial({ color: 0xd8a030, metalness: 0.9, roughness: 0.3 })
  );
  chain.position.y = 1.42;
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
        SKINS[Math.floor(this.rand() * SKINS.length)]
      );
      // sidewalk lane: pick a road line + side, walk along it
      const vertical = this.rand() < 0.5;
      const line = Math.floor(this.rand() * (CFG.gridN + 1));
      const coord = roadCoord(line);
      const side = (this.rand() < 0.5 ? 1 : -1) * (CFG.roadW / 2 + 1.6);
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
              p.position.x = nx + u.side;
              u.roadLine = nx;
            } else {
              p.position.z = nz + u.side;
              u.roadLine = nz;
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
