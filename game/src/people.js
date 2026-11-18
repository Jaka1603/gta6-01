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
import { CFG, PALETTE, SCALE, clamp, gameRand } from './config.js';
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
// v5: everything above the hips lives in an `upper` group pivoted at
// hip height, so the whole torso can LEAN (run gait) as one piece;
// the root group itself is reserved for heading + the knock tumble.
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
  const HIP_Y = 0.78;
  const upper = new THREE.Group();
  upper.position.y = HIP_Y;
  g.add(upper);
  // hip piece (the minifig "hips" block both legs hang from)
  const hip = new THREE.Mesh(hipGeo, pantsMat);
  hip.position.y = 0;
  hip.castShadow = true;
  upper.add(hip);
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
  g.add(legL, legR);
  // trapezoid torso + printed-detail plate on the chest
  const torso = new THREE.Mesh(torsoGeo, shirtMat);
  torso.position.y = 1.16 - HIP_Y;
  torso.castShadow = true;
  upper.add(torso);
  const plate = new THREE.Mesh(plateGeo, new THREE.MeshStandardMaterial({
    map: printTex(opts.print || 'civil', opts.printVariant || 0),
    transparent: true, roughness: 0.5,
    polygonOffset: true, polygonOffsetFactor: -1,
  }));
  plate.position.set(0, 1.17 - HIP_Y, 0.185);
  plate.rotation.x = 0.1;
  upper.add(plate);
  const neck = new THREE.Mesh(neckGeo, shirtMat);
  neck.position.y = 1.475 - HIP_Y;
  upper.add(neck);
  // cylindrical head (printed smile faces +Z via the π yaw) + stud/hair
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.63 - HIP_Y;
  head.rotation.y = Math.PI;
  head.castShadow = true;
  upper.add(head);
  if (opts.hair) {
    const hair = new THREE.Mesh(hairGeo, mat(opts.hairColor || 0x2a1a10, 0.5));
    hair.position.y = 1.72 - HIP_Y;
    hair.castShadow = true;
    upper.add(hair);
  } else if (!opts.noStud) {
    const stud = new THREE.Mesh(studGeo, skinMat);
    stud.position.y = 1.785 - HIP_Y;
    upper.add(stud);
  }
  // arms on shoulder pivots, C-hands at the bottom
  const armMat = opts.sleeveless ? skinMat : shirtMat;
  const armL = limb(armGeo, armMat, true);
  armL.position.set(-0.345, 1.4 - HIP_Y, 0);
  const armR = limb(armGeo, armMat, true);
  armR.position.set(0.345, 1.4 - HIP_Y, 0);
  upper.add(armL, armR);
  g.userData = {
    legL, legR, armL, armR, upper, torso, head,
    walkPhase: gameRand() * 6,
    speed: 0, heading: 0, fleeing: false,
    isPerson: true,
    minifig: true,
    knock: null,          // v5: active knockdown state, if any
    // v7 (skill: State Machines): ONE explicit AI state label,
    // maintained at every transition — walk | flee | brawl | knock
    // | dead — so tests/debugging read state, not flag piles
    aiState: 'walk',
    // v6: health + fist-fight state (brief M). hp is shared by peds,
    // gang members and officers; brawl is driven by the owner class.
    hp: 100, dead: false,
    brawl: null,          // { target, onStrike } while fighting
    punchCd: 0, punchAnim: 0, staggerT: 0,
    // walk(phase, amp, lean) swings limbs and leans the torso;
    // called by owners, not here. v5 gait split (Jaka fix #6):
    // walking = small amp, upright; running = big amp + lean.
    walk(phase, amp = 0.55, lean = 0) {
      legL.rotation.x = Math.sin(phase) * amp;
      legR.rotation.x = Math.sin(phase + Math.PI) * amp;
      armL.rotation.x = Math.sin(phase + Math.PI) * amp * 0.7;
      armR.rotation.x = Math.sin(phase) * amp * 0.7;
      upper.rotation.x = lean;
      // a runner's bob is deeper and lands on the stride beat
      g.position.y = Math.abs(Math.sin(phase)) * (0.03 + amp * 0.05);
    },
    idle() {
      legL.rotation.x *= 0.8; legR.rotation.x *= 0.8;
      armL.rotation.x *= 0.8; armR.rotation.x *= 0.8;
      upper.rotation.x *= 0.8;
      g.position.y *= 0.7;
    },
  };
  return g;
}

// --- v5 knockdown (Jaka fix #4): cars are SOLID to people ---
// knockPerson launches a figure along (vx, vz): it slides with
// friction, topples forward over ~0.18 s, lies still, then climbs
// back up. updateKnock advances the state; it returns true while
// the figure is down (owners skip their normal movement then).
export function knockPerson(person, vx, vz, downTime = 1.15) {
  const u = person.userData;
  if (u.knock) return false;
  u.aiState = 'knock';
  const speed = Math.hypot(vx, vz);
  u.knock = {
    t: 0, dur: downTime + Math.min(0.5, speed * 0.03),
    vx, vz,
    face: Math.atan2(vx, vz),   // fall in the direction of travel
  };
  // sprawl: limbs flung out, frozen for the whole tumble
  u.legL.rotation.x = -0.9; u.legR.rotation.x = 0.55;
  u.armL.rotation.x = -2.4; u.armR.rotation.x = -1.9;
  u.upper.rotation.x = 0;
  person.rotation.y = u.knock.face;
  return true;
}

export function updateKnock(person, dt) {
  const u = person.userData;
  const k = u.knock;
  if (!k) return false;
  k.t += dt;
  // slide: exponential friction, most travel in the first half second
  const drag = Math.exp(-3.2 * dt);
  person.position.x += k.vx * dt;
  person.position.z += k.vz * dt;
  k.vx *= drag; k.vz *= drag;
  // tumble curve: fast fall (0→1 in 0.18 s), hold, then get up
  const FALL = 1.42; // rad — flat on the ground, face forward
  let a;
  if (k.t < 0.18) a = FALL * (k.t / 0.18);
  else if (k.t > k.dur - 0.38) a = FALL * Math.max(0, (k.dur - k.t) / 0.38);
  else a = FALL;
  person.rotation.x = a;
  if (k.t >= k.dur) {
    u.knock = null;
    u.aiState = u.dead ? 'dead' : (u.brawl ? 'brawl' : 'walk');
    person.rotation.x = 0;
    person.position.y = 0;
    u.idle();
    return false;
  }
  return true;
}

// --- v6 damage + fist-fighting (brief M) ---------------------------
// hurtPerson applies damage to any minifig: stagger on solid hits,
// a long knockdown at 0 hp (dead — owners stop driving the figure).
// Returns 'dead' | 'stagger' | 'ok'.
export function hurtPerson(person, dmg, fromX = 0, fromZ = 0) {
  const u = person.userData;
  if (u.dead) return 'dead';
  u.hp -= dmg;
  if (u.hp <= 0) {
    u.dead = true;
    u.aiState = 'dead';
    u.brawl = null;
    const dx = person.position.x - fromX, dz = person.position.z - fromZ;
    const d = Math.hypot(dx, dz) || 1;
    // a very long down-time: the figure stays down for the session
    if (!knockPerson(person, (dx / d) * 3.5, (dz / d) * 3.5, 9999) && u.knock) {
      u.knock.dur = 9999;   // already down (car hit) — keep them down
    }
    return 'dead';
  }
  if (dmg >= 10 && u.staggerT <= 0) {
    u.staggerT = 0.38;
    return 'stagger';
  }
  return 'ok';
}

// startBrawl makes `person` fight `target` (another figure, usually
// the player): the owner class (Pedestrians / Police / main's gang
// driver) advances it via updateBrawl each frame; onStrike fires
// when a punch lands in range so the owner can apply damage.
export function startBrawl(person, target, onStrike) {
  const u = person.userData;
  if (u.dead || u.knock) return false;
  u.brawl = { target, onStrike };
  u.aiState = 'brawl';
  u.fleeing = false;
  u.fleeTimer = undefined;
  u.punchCd = 0.3 + gameRand() * 0.4;
  return true;
}

export function stopBrawl(person) {
  person.userData.brawl = null;
  if (!person.userData.dead && person.userData.aiState === 'brawl') {
    person.userData.aiState = 'walk';
  }
}

// Advance one brawling figure: approach the target, strike when in
// range (arm swing + onStrike), stagger freezes movement briefly.
// Returns false when the brawl ended (target gone / figure down).
export function updateBrawl(person, dt, rand) {
  const u = person.userData;
  const b = u.brawl;
  if (!b || u.dead) return false;
  if (u.knock) return true;             // down, but still in the fight
  const t = b.target;
  if (!t || (t.userData && t.userData.dead)) { u.brawl = null; return false; }
  const dx = t.position.x - person.position.x;
  const dz = t.position.z - person.position.z;
  const d = Math.hypot(dx, dz);
  u.heading = Math.atan2(dx, dz);
  person.rotation.y = u.heading;
  if (u.staggerT > 0) {
    u.staggerT -= dt;
    // reel back: arms flung up, torso leaning away
    u.armL.rotation.x = -2.5; u.armR.rotation.x = -2.2;
    u.upper.rotation.x = -0.22;
    person.position.x -= Math.sin(u.heading) * dt * 1.2;
    person.position.z -= Math.cos(u.heading) * dt * 1.2;
    return true;
  }
  if (u.punchAnim > 0) {
    u.punchAnim -= dt;
    const k = Math.sin(Math.max(0, u.punchAnim) / 0.22 * Math.PI);
    u.armR.rotation.x = -0.4 - k * 1.9;   // the haymaker swing
  }
  if (d > 1.85) {
    // approach at a fighting jog, fists up
    const sp = 3.7;
    person.position.x += Math.sin(u.heading) * sp * dt;
    person.position.z += Math.cos(u.heading) * sp * dt;
    u.walkPhase += dt * sp * 3.1;
    u.walk(u.walkPhase, 0.8, 0.12);
    u.armL.rotation.x = -1.1;            // guard hand stays up
    if (u.punchAnim <= 0) u.armR.rotation.x = -1.1;
    u.speed = sp;
  } else {
    // in range: circle a little, strike on the cooldown
    u.idle();
    u.armL.rotation.x = -1.1;
    if (u.punchAnim <= 0) u.armR.rotation.x = -1.1;
    u.punchCd -= dt;
    if (u.punchCd <= 0) {
      u.punchCd = 0.75 + rand() * 0.5;
      u.punchAnim = 0.22;
      if (d < 2.35 && b.onStrike) b.onStrike(person);
    }
    u.speed = 0;
  }
  return true;
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

// --- v6 weapon meshes: SMG, pump shotgun, heavy pistol ------------
// Same construction language as the pistol/rifle (dark metal boxes),
// sized to read in a minifig C-hand and as world pickup icons.
export function makeSMG() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.42, metalness: 0.55 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.09, 0.42), dark);
  body.position.set(0, 0.02, 0.08);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.16, 8), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, 0.36);
  const mag = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.2, 0.07), dark);
  mag.position.set(0, -0.09, 0.1);
  mag.rotation.x = 0.12;
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.16), dark);
  stock.position.set(0, 0.01, -0.18);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.13, 0.06), dark);
  grip.position.set(0, -0.06, -0.04);
  grip.rotation.x = 0.25;
  g.add(body, barrel, mag, stock, grip);
  return g;
}

export function makeShotgun() {
  const g = new THREE.Group();
  const dark = new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.45, metalness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a26, roughness: 0.85 });
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.62, 10), dark);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.03, 0.22);
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8), dark);
  tube.rotation.x = Math.PI / 2;
  tube.position.set(0, -0.015, 0.18);
  const pump = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.075, 0.2), wood);
  pump.position.set(0, -0.015, 0.16);
  const recv = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.24), dark);
  recv.position.set(0, 0.01, -0.14);
  const stock = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.13, 0.3), wood);
  stock.position.set(0, -0.03, -0.38);
  stock.rotation.x = 0.12;
  g.add(barrel, tube, pump, recv, stock);
  return g;
}

export function makeHeavyPistol() {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x8a8f96, roughness: 0.3, metalness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.4, metalness: 0.6 });
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.07, 0.34), steel);
  barrel.position.set(0, 0.05, 0.14);
  const vent = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.03, 0.2), dark);
  vent.position.set(0, 0.095, 0.16);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.17, 0.08), dark);
  grip.position.set(0, -0.05, -0.02);
  grip.rotation.x = 0.15;
  const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.035, 0.02), dark);
  sight.position.set(0, 0.1, 0.02);
  g.add(barrel, vent, grip, sight);
  return g;
}

// Any handheld weapon mesh by kind (player hands + pickup icons).
export function makeWeaponMesh(kind) {
  switch (kind) {
    case 'rifle': return makeRifle();
    case 'smg': return makeSMG();
    case 'shotgun': return makeShotgun();
    case 'heavy': return makeHeavyPistol();
    default: return makePistol();
  }
}

// Attach a weapon to a person's right hand (hand = end of armR pivot).
// Returns the weapon group; call detachWeapon(person) to remove it.
export function attachWeapon(person, kind) {
  detachWeapon(person);
  const w = makeWeaponMesh(kind);
  const armR = person.userData.armR;
  // hand sits at the bottom of the arm: y -0.62 in pivot space
  w.position.set(0, -0.62, 0.02);
  if (kind === 'rifle' || kind === 'shotgun') {
    // long guns held across the body, barrel forward (+Z)
    w.rotation.x = Math.PI / 2 - 0.35;
    w.position.set(0, -0.62, 0.12);
  } else if (kind === 'smg') {
    w.rotation.x = Math.PI / 2 - 0.15;
    w.position.set(0, -0.62, 0.06);
  } else {
    // pistols point forward when the arm aims
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
  // v5: the chain rides the upper-body rig so it follows the run lean
  chain.position.set(0, 1.42 - 0.78, 0.03);
  chain.rotation.x = Math.PI / 2 - 0.35;
  p.userData.upper.add(chain);
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
      if (p.userData.dead || p.userData.brawl) continue;
      const dx = p.position.x - x, dz = p.position.z - z;
      const d = Math.hypot(dx, dz);
      if (d < radius) {
        p.userData.fleeing = true;
        p.userData.aiState = 'flee';
        p.userData.heading = Math.atan2(dx, dz);
        p.userData.speed = 4.5;
        p.userData.fleeTimer = 3;
      }
    }
  }
  update(dt) {
    for (const p of this.peds) {
      const u = p.userData;
      // v6: the dead stay down; brawlers fight (brief M) — both
      // bypass the sidewalk-lane logic entirely
      if (u.dead) {
        if (u.knock) updateKnock(p, dt);
        continue;
      }
      if (u.brawl) {
        if (u.knock) { updateKnock(p, dt); continue; }
        updateBrawl(p, dt, this.rand);
        continue;
      }
      // v5: a knocked-down pedestrian slides + tumbles first; the
      // sidewalk-lane logic below must not teleport them back
      if (u.knock) {
        const wasDown = updateKnock(p, dt);
        if (wasDown) continue;
        // just got up: re-derive the lane from where they landed
        const nx = nearestRoadCoord(p.position.x);
        const nz = nearestRoadCoord(p.position.z);
        u.vertical = Math.abs(p.position.x - nx) < Math.abs(p.position.z - nz);
        if (u.vertical) {
          u.roadLine = nx;
          u.side = Math.sign(p.position.x - nx || 1) * (roadHalfAt(nx) + 1.45);
          u.heading = this.rand() < 0.5 ? 0 : Math.PI;
        } else {
          u.roadLine = nz;
          u.side = Math.sign(p.position.z - nz || 1) * (roadHalfAt(nz) + 1.45);
          u.heading = this.rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
        }
        u.fleeing = true;
        u.fleeTimer = 1.2;
        u.speed = 4.2;
      }
      if (u.fleeTimer !== undefined) {
        u.fleeTimer -= dt;
        if (u.fleeTimer <= 0) {
          u.fleeing = false;
          if (u.aiState === 'flee') u.aiState = 'walk';
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
      // walk cycle (delta-time, phase advances with speed) — v5:
      // fleeing peds get the RUN gait (wide swing + forward lean),
      // strollers keep the relaxed upright walk, same as the player
      const run = u.speed > 2.6;
      u.walkPhase += dt * u.speed * (run ? 3.7 : 2.6);
      u.walk(u.walkPhase, run ? 0.95 : 0.5, run ? 0.16 : 0.02);
    }
  }
}
