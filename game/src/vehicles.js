// PALMBAY HEAT — vehicles.js (v5): SA-style parametric cars, rebuilt
// to Jaka's spec after his phone play-test. Every car is assembled
// from MERGED geometry (one mesh per material class, not one per
// part): separate body panels with door seams + handles printed on
// the flanks, dark glass windshield / rear window / side band split
// by painted pillars, four wheels with hubcaps that ROLL (front pair
// also STEERS), emissive headlights + brake-driven taillights,
// bumpers, side mirrors, plates front + rear. Styles: sedan, coupe,
// van, pickup, taxi, SUV from one parametric factory.
// v5 collision: cars are SOLID to people — Traffic.update knocks
// down pedestrians and the player instead of ghosting through them
// (v4 and earlier drove straight through), and sheds speed on impact.
// v3 audit retained: true cardinal headings after turns, traffic
// yields to the player, parked cars at the real curb, cached brakes.
const THREE = window.THREE;
import { CFG, PALETTE, SCALE, clamp } from './config.js';
import { roadCoord, nearestRoadCoord, roadHalfAt } from './world.js';
import { blobTexture, plateTexture, policeDoorTexture, glowTexture, carSideTexture } from './textures.js';
import { glowSprite } from './effects.js';
import { knockPerson } from './people.js';

const BODY_STYLES = [
  { name: 'sedan', w: 1.8, l: 4.4, h: 0.55, cabin: 0.5 },
  { name: 'coupe', w: 1.8, l: 4.0, h: 0.5, cabin: 0.45 },
  { name: 'van', w: 2.0, l: 5.0, h: 1.1, cabin: 0.55 },
  { name: 'pickup', w: 1.9, l: 4.8, h: 0.7, cabin: 0.55 },
  { name: 'taxi', w: 1.8, l: 4.4, h: 0.55, cabin: 0.5 },
  { name: 'suv', w: 1.95, l: 4.6, h: 0.8, cabin: 0.65 },
];

const PAINTS = [
  0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad,
  0xe67e22, 0x1abc9c, 0xecf0f1, 0x2c3e50, 0xd35400,
];

// --- merged-geometry kit -------------------------------------------
// Parts are plain geometries, transformed, then concatenated with a
// baked vertex colour per part. One material per class renders the
// whole shell: paint (vertexColours), glass, trim, chrome, lights.
const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _s1 = new THREE.Vector3(1, 1, 1);
const _col = new THREE.Color();
function xform(geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const g = geo.clone();
  _e.set(rx, ry, rz);
  _q.setFromEuler(_e);
  _v.set(x, y, z);
  _m.compose(_v, _q, _s1);
  g.applyMatrix4(_m);
  return g;
}
function mergeColored(parts) {
  let total = 0;
  const cooked = parts.map((p) => {
    const n = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const cnt = n.attributes.position.count;
    const col = new Float32Array(cnt * 3);
    _col.set(p.color === undefined ? 0xffffff : p.color);
    for (let i = 0; i < cnt; i++) {
      col[i * 3] = _col.r; col[i * 3 + 1] = _col.g; col[i * 3 + 2] = _col.b;
    }
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    total += cnt;
    return n;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  let o3 = 0, o2 = 0;
  for (const g of cooked) {
    pos.set(g.attributes.position.array, o3);
    nor.set(g.attributes.normal.array, o3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
    col.set(g.attributes.color.array, o3);
    o3 += g.attributes.position.count * 3;
    o2 += g.attributes.position.count * 2;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const paintMatFor = (paint) => new THREE.MeshStandardMaterial({
  // low metalness: no env map in this build, so high metalness reads black
  color: paint, metalness: 0.25, roughness: 0.35,
});
const glassMat = new THREE.MeshStandardMaterial({
  color: 0x10151c, roughness: 0.12, metalness: 0.5,
});
const trimMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.7, metalness: 0.2,
});
const chromeMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.28, metalness: 0.6,
});
const shellMat = () => new THREE.MeshStandardMaterial({
  vertexColors: true, metalness: 0.25, roughness: 0.35,
});
let blobTex = null;
let sideTex = null;

function contactShadow() {
  if (!blobTex) blobTex = blobTexture();
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(5.0, 2.4),
    new THREE.MeshBasicMaterial({
      map: blobTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1,
    })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  return m;
}

// --- wheels: steer pivot -> roll spin -> merged tire/hubcap mesh ---
const wheelMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.6, metalness: 0.3,
});
function makeWheel() {
  const pivot = new THREE.Group();
  const spin = new THREE.Group();
  pivot.add(spin);
  const tire = new THREE.CylinderGeometry(SCALE.wheelR, SCALE.wheelR, 0.24, 18);
  tire.rotateZ(Math.PI / 2);
  const hub = new THREE.CylinderGeometry(0.185, 0.185, 0.252, 12);
  hub.rotateZ(Math.PI / 2);
  const cap = new THREE.CylinderGeometry(0.07, 0.07, 0.26, 8);
  cap.rotateZ(Math.PI / 2);
  // hubcap cross: two slim bars so the roll reads at a glance
  const bar1 = box(0.26, 0.3, 0.055);
  const bar2 = box(0.26, 0.055, 0.3);
  const geo = mergeColored([
    { geo: tire, color: 0x151515 },
    { geo: hub, color: 0xb8bcc2 },
    { geo: cap, color: 0x4a4f55 },
    { geo: bar1, color: 0x9ea4ac },
    { geo: bar2, color: 0x9ea4ac },
  ]);
  const mesh = new THREE.Mesh(geo, wheelMat);
  mesh.castShadow = true;
  spin.add(mesh);
  pivot.userData.spin = spin;
  return pivot;
}
export function rollWheels(car, dist) {
  const u = car.userData;
  if (!u.spins) return;
  const a = dist / SCALE.wheelR;
  for (const s of u.spins) s.rotation.x += a;
}
export function steerWheels(car, angle) {
  const u = car.userData;
  if (u.wheelFL) u.wheelFL.rotation.y = angle;
  if (u.wheelFR) u.wheelFR.rotation.y = angle;
}
function addWheels(g, s) {
  const wheels = [], spins = [];
  const spots = [
    [-s.w / 2 + 0.06, s.l * 0.32, 'FL'], [s.w / 2 - 0.06, s.l * 0.32, 'FR'],
    [-s.w / 2 + 0.06, -s.l * 0.32, 'RL'], [s.w / 2 - 0.06, -s.l * 0.32, 'RR'],
  ];
  for (const [x, z, tag] of spots) {
    const w = makeWheel();
    w.position.set(x, SCALE.wheelR, z);
    g.add(w);
    wheels.push(w);
    spins.push(w.userData.spin);
    if (tag === 'FL') g.userData.wheelFL = w;
    if (tag === 'FR') g.userData.wheelFR = w;
  }
  g.userData.wheels = wheels;
  g.userData.spins = spins;
}

// --- v5 amendment: a separately-hinged DRIVER door ---------------
// GTA-style entry needs a door that actually opens. One extra mesh
// per car: a hinge group at the FRONT edge of the driver-side
// (left, -X — same side as the steering wheel) front door. The
// lower panel sits at body width; the glass pane steps inward to
// the glasshouse plane so the closed door reads flush. Opening =
// hinge.rotation.y from 0 to ~1.15 rad (rear edge swings out).
const doorMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.38, metalness: 0.22,
});
function addDriverDoor(g, s, paintHex, hingeZ) {
  const hinge = new THREE.Group();
  const bodyTop = 0.55 + s.h;
  hinge.position.set(-(s.w / 2) - 0.012, 0.6, hingeZ);
  const parts = [];
  // lower panel: paint, from the hinge backwards 1.04 m
  parts.push({ geo: xform(box(0.05, bodyTop - 0.52, 1.04), 0, (bodyTop - 0.6) / 2 - 0.02, -0.52), color: paintHex });
  // glass pane: stepped in to the glasshouse plane (+X toward body)
  const glassIn = s.w / 2 - s.w * 0.4 - 0.02;
  parts.push({ geo: xform(box(0.045, s.cabin * 0.82, 0.96), glassIn, (bodyTop - 0.6) + s.cabin * 0.38, -0.52), color: 0x18222e });
  // handle nub at the rear of the panel
  parts.push({ geo: xform(box(0.03, 0.045, 0.17), -0.03, bodyTop - 0.78, -0.88), color: 0x14151a });
  const mesh = new THREE.Mesh(mergeColored(parts), doorMat);
  hinge.add(mesh);
  hinge.rotation.y = 0;
  g.add(hinge);
  g.userData.door = hinge;
  return hinge;
}

// --- lights + plates (merged per material, as before but fewer) ---
function addLights(car, s, brakeMat) {
  const hlMat = new THREE.MeshStandardMaterial({
    color: 0xfff2cc, emissive: 0xffe9a0, emissiveIntensity: 2.2,
  });
  const heads = [], tails = [];
  for (const sx of [-0.58, 0.58]) {
    heads.push({ geo: xform(box(0.42, 0.18, 0.1), sx, 0.84, s.l / 2 + 0.03) });
    tails.push({ geo: xform(box(0.42, 0.16, 0.1), sx, 0.84, -s.l / 2 - 0.03) });
    const glow = glowSprite(0xffe9a0, 1.1, 0.7);
    glow.position.set(sx, 0.84, s.l / 2 + 0.25);
    car.add(glow);
    const bGlow = glowSprite(0xff2211, 0.7, 0.0);
    bGlow.position.set(sx, 0.84, -s.l / 2 - 0.25);
    bGlow.name = 'brakeGlow';
    car.add(bGlow);
  }
  const hm = new THREE.Mesh(mergeColored(heads), hlMat);
  const tm = new THREE.Mesh(mergeColored(tails), brakeMat);
  car.add(hm, tm);
}
function addPlate(car, s, text) {
  const tex = plateTexture(text);
  const rear = new THREE.PlaneGeometry(0.5, 0.13);
  rear.rotateY(Math.PI);
  rear.translate(0, 0.62, -s.l / 2 - 0.09);
  const front = new THREE.PlaneGeometry(0.5, 0.13);
  front.translate(0, 0.62, s.l / 2 + 0.09);
  const plate = new THREE.Mesh(
    mergeColored([{ geo: rear }, { geo: front }]),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  car.add(plate);
}
// door seams + handles printed on both flanks (one shared texture).
// The right flank's U is flipped so the rear door + fuel flap stay
// at the rear on both sides.
function addSidePanels(car, s) {
  if (!sideTex) sideTex = carSideTexture();
  const len = s.l * 0.88, hgt = s.h + 0.34;
  const mkSide = (sideSign) => {
    const p = new THREE.PlaneGeometry(len, hgt);
    if (sideSign > 0) {
      const uv = p.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setX(i, 1 - uv.getX(i));
    }
    p.rotateY(sideSign > 0 ? Math.PI / 2 : -Math.PI / 2);
    p.translate(sideSign * (s.w / 2 + 0.008), 0.55 + s.h / 2 + 0.02, -0.02);
    return p;
  };
  const mesh = new THREE.Mesh(
    mergeColored([{ geo: mkSide(1) }, { geo: mkSide(-1) }]),
    new THREE.MeshStandardMaterial({
      map: sideTex, transparent: true, roughness: 0.5,
      polygonOffset: true, polygonOffsetFactor: -2,
    })
  );
  car.add(mesh);
}

export function makeCar(styleIdx, color, isPolice = false) {
  const s = BODY_STYLES[styleIdx % BODY_STYLES.length];
  const g = new THREE.Group();
  const paint = isPolice ? PALETTE.policeBlack : color;
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x330000, emissive: 0xff2211, emissiveIntensity: 1,
  });
  g.userData = {
    style: s, lightBar: null, speed: 0, maxSpeed: 0,
    steer: 0, isPolice, brakeMat,
  };
  const bodyTop = 0.55 + s.h;              // top of the lower body
  const cabZ = -s.l * 0.08;                // cabin centre
  const cabLen = s.name === 'van' ? s.l * 0.62 : s.l * 0.5;
  const cabTop = bodyTop + s.cabin - 0.05;
  // ---- paint shell: body, nose, roof, pillars, mirrors, stripes --
  const P = [];
  P.push({ geo: xform(box(s.w, s.h, s.l), 0, 0.55 + s.h / 2, 0), color: paint });
  P.push({ geo: xform(box(s.w * 0.92, s.h * 0.72, 0.7), 0, 0.55 + s.h * 0.36, s.l / 2 - 0.1), color: paint });
  if (s.name !== 'van') {
    P.push({ geo: xform(box(s.w * 0.8, 0.07, cabLen * 0.92), 0, cabTop + 0.03, cabZ), color: paint });
    // A-pillars (slanted, flanking the windshield) + C-pillars
    for (const sx of [-1, 1]) {
      P.push({ geo: xform(box(0.08, s.cabin + 0.12, 0.08), sx * s.w * 0.36, bodyTop + s.cabin / 2, cabZ + cabLen / 2 - 0.02, -0.42), color: paint });
      P.push({ geo: xform(box(0.08, s.cabin + 0.06, 0.08), sx * s.w * 0.36, bodyTop + s.cabin / 2, cabZ - cabLen / 2 + 0.02, 0.3), color: paint });
      // side mirror caps on stalks at the front doors
      P.push({ geo: xform(box(0.17, 0.1, 0.11), sx * (s.w / 2 + 0.1), bodyTop + s.cabin * 0.42, cabZ + cabLen / 2 - 0.28), color: paint });
    }
    // racing stripes over hood + roof + trunk (the SA sport read)
    if (!isPolice) {
      for (const dz of [-0.16, 0.16]) {
        P.push({ geo: xform(box(0.26, 0.02, s.l), dz, bodyTop + 0.012, 0), color: 0xf5f5f5 });
        P.push({ geo: xform(box(0.26, 0.02, cabLen * 0.92), dz, cabTop + 0.075, cabZ), color: 0xf5f5f5 });
      }
    }
  } else {
    // van: the cabin is part of the body; add a roof cap + rear doors seam
    P.push({ geo: xform(box(s.w * 0.96, 0.07, s.l * 0.94), 0, bodyTop + s.cabin + 0.02, 0), color: paint });
  }
  if (s.name === 'coupe' && !isPolice) {
    // small rear spoiler
    P.push({ geo: xform(box(s.w * 0.72, 0.05, 0.3), 0, bodyTop + 0.16, -s.l / 2 + 0.25), color: paint });
    for (const sx of [-0.5, 0.5]) {
      P.push({ geo: xform(box(0.07, 0.16, 0.07), sx, bodyTop + 0.07, -s.l / 2 + 0.25), color: paint });
    }
  }
  if (s.name === 'pickup') {
    // open bed: two side walls + tailgate behind the cab (paint)
    for (const sx of [-1, 1]) {
      P.push({ geo: xform(box(0.09, 0.34, s.l * 0.36), sx * (s.w / 2 - 0.045), bodyTop + 0.17, -s.l * 0.33), color: paint });
    }
    P.push({ geo: xform(box(s.w, 0.34, 0.09), 0, bodyTop + 0.17, -s.l / 2 + 0.045), color: paint });
  }
  const shell = new THREE.Mesh(mergeColored(P), shellMat());
  // shellMat is vertex-colored white-based; tint via paint parts baked in
  shell.castShadow = true;
  g.add(shell);
  // ---- glasshouse: windshield, rear glass, side band, dark core --
  const G = [];
  G.push({ geo: xform(box(s.w * 0.8, s.cabin, cabLen * 0.94), 0, bodyTop + s.cabin / 2 - 0.05, cabZ), color: 0x0c0e12 });
  if (s.name !== 'van') {
    G.push({ geo: xform(box(s.w * 0.76, s.cabin * 0.95, 0.05), 0, bodyTop + s.cabin / 2, cabZ + cabLen / 2 + 0.01, -0.42), color: 0x18222e });
    G.push({ geo: xform(box(s.w * 0.76, s.cabin * 0.9, 0.05), 0, bodyTop + s.cabin / 2, cabZ - cabLen / 2 - 0.01, 0.3), color: 0x18222e });
    for (const sx of [-1, 1]) {
      G.push({ geo: xform(box(0.05, s.cabin * 0.78, cabLen * 0.8), sx * s.w * 0.4, bodyTop + s.cabin / 2, cabZ), color: 0x18222e });
    }
  } else {
    // van windshield is near-vertical; side glass runs the front half
    G.push({ geo: xform(box(s.w * 0.84, s.cabin * 0.9, 0.05), 0, bodyTop + s.cabin / 2 + 0.28, s.l / 2 - 0.28, -0.12), color: 0x18222e });
    for (const sx of [-1, 1]) {
      G.push({ geo: xform(box(0.05, s.cabin * 0.62, s.l * 0.3), sx * s.w * 0.46, bodyTop + s.cabin / 2 + 0.3, s.l * 0.22), color: 0x18222e });
    }
  }
  const glass = new THREE.Mesh(mergeColored(G), glassMat);
  glass.castShadow = true;
  g.add(glass);
  // ---- trim: bumpers, grille, sills, stalks, bed floor, exhaust --
  const T = [];
  T.push({ geo: xform(box(s.w * 0.98, 0.22, 0.2), 0, 0.42, s.l / 2 + 0.08), color: 0x1c1e24 });
  T.push({ geo: xform(box(s.w * 0.98, 0.22, 0.2), 0, 0.42, -s.l / 2 - 0.08), color: 0x1c1e24 });
  T.push({ geo: xform(box(s.w * 0.62, 0.17, 0.06), 0, 0.8, s.l / 2 + 0.05), color: 0x0b0b0f });
  for (const sx of [-1, 1]) {
    T.push({ geo: xform(box(0.07, 0.15, s.l * 0.58), sx * (s.w / 2 - 0.02), 0.3, 0), color: 0x17181d });
    T.push({ geo: xform(box(0.14, 0.04, 0.04), sx * (s.w / 2 + 0.03), bodyTop + s.cabin * 0.42, cabZ + cabLen / 2 - 0.28), color: 0x17181d });
    // exhaust tip (chrome class, but baked dark steel in trim)
    T.push({ geo: xform(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8), sx * 0.35, 0.32, -s.l / 2 - 0.12, Math.PI / 2), color: 0x8a8f96 });
  }
  if (s.name === 'pickup') {
    T.push({ geo: xform(box(s.w * 0.9, 0.06, s.l * 0.36), 0, bodyTop + 0.03, -s.l * 0.33), color: 0x222226 });
  }
  const trim = new THREE.Mesh(mergeColored(T), trimMat);
  g.add(trim);
  // ---- details that stay separate: panels, lights, plates, wheels
  addSidePanels(g, s);
  addLights(g, s, brakeMat);
  addPlate(g, s, isPolice ? 'PBPD 07' : 'PBAY ' + String(10 + (styleIdx * 7) % 89));
  addWheels(g, s);
  // driver door, hinged at its front edge (vans: door sits forward)
  addDriverDoor(g, s, paint, s.name === 'van' ? s.l / 2 - 0.42 : cabZ + cabLen / 2 - 0.04);
  if (s.name === 'taxi') {
    const sign = new THREE.Mesh(
      box(0.8, 0.25, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffe135 })
    );
    sign.position.set(0, cabTop + 0.18, cabZ);
    g.add(sign);
  }
  // police livery: white doors with POLICE + star, push bumper, light bar
  let lightBar = null;
  if (isPolice) {
    const doorTex = policeDoorTexture();
    const doorMat = new THREE.MeshBasicMaterial({ map: doorTex });
    const doorParts = [];
    for (const side of [-1, 1]) {
      const dp = new THREE.PlaneGeometry(1.7, 0.85);
      dp.rotateY(side > 0 ? Math.PI / 2 : -Math.PI / 2);
      dp.translate(side * (s.w / 2 + 0.012), 0.82, -0.1);
      doorParts.push({ geo: dp });
    }
    g.add(new THREE.Mesh(mergeColored(doorParts), doorMat));
    const bumper = new THREE.Mesh(
      box(s.w * 0.9, 0.35, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4, metalness: 0.7 })
    );
    bumper.position.set(0, 0.55, s.l / 2 + 0.35);
    g.add(bumper);
    for (const sx of [-0.5, 0.5]) {
      const upright = new THREE.Mesh(box(0.12, 0.7, 0.12), bumper.material);
      upright.position.set(sx, 0.75, s.l / 2 + 0.35);
      g.add(upright);
    }
    lightBar = new THREE.Group();
    const rMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    const bMat = new THREE.MeshBasicMaterial({ color: 0x2040ff });
    const r = new THREE.Mesh(box(0.55, 0.2, 0.4), rMat);
    r.position.x = -0.32;
    const b = new THREE.Mesh(box(0.55, 0.2, 0.4), bMat);
    b.position.x = 0.32;
    const base = new THREE.Mesh(
      box(1.4, 0.08, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.5 })
    );
    const rGlow = glowSprite(0xff2020, 1.6, 0.8);
    rGlow.position.set(-0.32, 0.2, 0);
    const bGlow = glowSprite(0x2040ff, 1.6, 0.8);
    bGlow.position.set(0.32, 0.2, 0);
    lightBar.add(base, r, b, rGlow, bGlow);
    lightBar.position.set(0, cabTop + 0.14, cabZ);
    lightBar.userData = { r, b, rMat, bMat, rGlow, bGlow };
    g.add(lightBar);
    g.userData.lightBar = lightBar;
  }
  g.add(contactShadow());
  return g;
}

// --- hero convertible: open top, low windshield, seats + interior ---
export function makeConvertible(paintHex) {
  const g = new THREE.Group();
  const s = BODY_STYLES[1]; // coupe base
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x330000, emissive: 0xff2211, emissiveIntensity: 1,
  });
  g.userData = {
    style: s, lightBar: null, speed: 0, maxSpeed: 0,
    steer: 0, isPolice: false, brakeMat, convertible: true,
  };
  const paintMat = paintMatFor(paintHex);
  const bodyTop = 0.55 + s.h;
  const P = [];
  P.push({ geo: xform(box(s.w, s.h, s.l), 0, 0.55 + s.h / 2, 0), color: paintHex });
  P.push({ geo: xform(box(s.w * 0.92, s.h * 0.72, 0.7), 0, 0.55 + s.h * 0.36, s.l / 2 - 0.1), color: paintHex });
  for (const dz of [-0.16, 0.16]) {
    P.push({ geo: xform(box(0.26, 0.02, s.l), dz, bodyTop + 0.012, 0), color: 0xf5f5f5 });
  }
  for (const sx of [-1, 1]) {
    P.push({ geo: xform(box(0.17, 0.1, 0.11), sx * (s.w / 2 + 0.1), bodyTop + 0.28, s.l * 0.14), color: paintHex });
  }
  const shell = new THREE.Mesh(mergeColored(P), shellMat());
  shell.castShadow = true;
  g.add(shell);
  // open tub: dark interior floor + side walls
  const tubMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 });
  const tub = new THREE.Mesh(box(s.w * 0.86, 0.3, s.l * 0.48), tubMat);
  tub.position.set(0, bodyTop + 0.12, -s.l * 0.08);
  g.add(tub);
  // seats + headrests: dark leather, so the open top reads as interior
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.85 });
  for (const sx of [-0.45, 0.45]) {
    const seat = new THREE.Mesh(box(0.55, 0.5, 0.5), seatMat);
    seat.position.set(sx, bodyTop + 0.5, -s.l * 0.16);
    seat.castShadow = true;
    g.add(seat);
    const rest = new THREE.Mesh(box(0.4, 0.22, 0.16), seatMat);
    rest.position.set(sx, bodyTop + 0.82, -s.l * 0.16 - 0.22);
    g.add(rest);
  }
  // chrome roll bar behind the seats (the convertible cue)
  const chrome = new THREE.MeshStandardMaterial({
    color: 0xd8dce2, roughness: 0.3, metalness: 0.5,
  });
  for (const sx of [-0.45, 0.45]) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.035, 8, 16, Math.PI), chrome
    );
    hoop.position.set(sx, bodyTop + 0.78, -s.l * 0.16 - 0.28);
    g.add(hoop);
  }
  // low tilted windshield (glass): tall enough to catch the sky
  const shieldMat = new THREE.MeshStandardMaterial({
    color: 0x8fb8d8, roughness: 0.1, metalness: 0.3,
    transparent: true, opacity: 0.75,
  });
  const shield = new THREE.Mesh(box(s.w * 0.84, 0.7, 0.06), shieldMat);
  shield.position.set(0, bodyTop + 0.62, s.l * 0.14);
  shield.rotation.x = -0.35;
  g.add(shield);
  // steering wheel
  const steerWheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.035, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.6 })
  );
  steerWheel.position.set(-0.45, bodyTop + 0.55, s.l * 0.02);
  steerWheel.rotation.x = -0.5;
  g.add(steerWheel);
  // trim: bumpers + grille (same language as the factory cars)
  const T = [];
  T.push({ geo: xform(box(s.w * 0.98, 0.22, 0.2), 0, 0.42, s.l / 2 + 0.08), color: 0x1c1e24 });
  T.push({ geo: xform(box(s.w * 0.98, 0.22, 0.2), 0, 0.42, -s.l / 2 - 0.08), color: 0x1c1e24 });
  T.push({ geo: xform(box(s.w * 0.62, 0.17, 0.06), 0, 0.8, s.l / 2 + 0.05), color: 0x0b0b0f });
  for (const sx of [-0.35, 0.35]) {
    T.push({ geo: xform(new THREE.CylinderGeometry(0.055, 0.055, 0.3, 8), sx, 0.32, -s.l / 2 - 0.12, Math.PI / 2), color: 0x8a8f96 });
  }
  g.add(new THREE.Mesh(mergeColored(T), trimMat));
  addSidePanels(g, s);
  addLights(g, s, brakeMat);
  addPlate(g, s, 'DARIO 1');
  addWheels(g, s);
  // the hero's driver door opens too — hinge ahead of the windshield
  addDriverDoor(g, s, paintHex, s.l * 0.16);
  g.add(contactShadow());
  return g;
}

export function heroCar() {
  // Dario's ride: red convertible with white stripes
  const c = makeConvertible(PALETTE.heroRed);
  c.userData.maxSpeed = CFG.carMax;
  c.userData.hero = true;
  return c;
}

// brake lights on/off (emissive + glow sprite). v3: cached — the
// traverse only runs when the state actually flips, not every frame.
export function setBrake(car, on) {
  const u = car.userData;
  if (!u.brakeMat || u.brakeOn === on) return;
  u.brakeOn = on;
  u.brakeMat.emissiveIntensity = on ? 4 : 1;
  car.traverse((o) => {
    if (o.name === 'brakeGlow') o.material.opacity = on ? 0.85 : 0.0;
  });
}

// --- v5 car-vs-person impact ---------------------------------------
// Shared OBB test: is `person` inside the car's swept footprint?
// Returns { along, side } in car space, or null. On a real hit the
// person is knocked along the car's travel direction (speed-scaled)
// with a lateral shove; at crawling speed they are only pushed
// aside. The car sheds speed via u.hitT (set by the caller).
export function carPersonHit(car, person, speed) {
  const u = car.userData;
  const s = u.style || { w: 1.8, l: 4.4 };
  const dx = person.position.x - car.position.x;
  const dz = person.position.z - car.position.z;
  const ry = car.rotation.y;
  const fx = Math.sin(ry), fz = Math.cos(ry);
  const rx = Math.cos(ry), rz = -Math.sin(ry);
  const along = dx * fx + dz * fz;
  const side = dx * rx + dz * rz;
  if (Math.abs(along) > s.l / 2 + 0.42 || Math.abs(side) > s.w / 2 + 0.42) return null;
  if (person.userData.knock) return null;
  if (speed >= 2.2) {
    const push = speed * 1.12 + 2.2;
    knockPerson(
      person,
      fx * push + rx * Math.sign(side || 1) * 1.6,
      fz * push + rz * Math.sign(side || 1) * 1.6
    );
    return { along, side, knocked: true };
  }
  // crawling: shove them out of the footprint, no fall. A lane
  // pedestrian's anchor moves with the shove — otherwise their own
  // lane clamp would drag them straight back under the car
  const pushOut = (s.w / 2 + 0.55) - Math.abs(side);
  if (pushOut > 0) {
    const dir = Math.sign(side || 1);
    person.position.x += rx * dir * pushOut;
    person.position.z += rz * dir * pushOut;
    const pu = person.userData;
    if (typeof pu.roadLine === 'number') {
      pu.side += (pu.vertical ? rx : rz) * dir * pushOut;
      pu.fleeing = Math.max(pu.fleeing || 0, 0.9);
    }
  }
  return { along, side, knocked: false };
}

// --- traffic AI: cars follow the road grid, turn at intersections ---
export class Traffic {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.cars = [];
    this.group = new THREE.Group();
    scene.add(this.group);
    // v5 wiring (set by main): pedestrians to collide with, the
    // player figure, and a callback for player impacts
    this.peds = null;
    this.playerRef = null;
    this.playerOnFoot = false;
    this.onPlayerHit = null;
  }
  spawn(n) {
    for (let i = 0; i < n; i++) this.addCar();
  }
  addCar() {
    const style = Math.floor(this.rand() * BODY_STYLES.length);
    const color = PAINTS[Math.floor(this.rand() * PAINTS.length)];
    const car = makeCar(style, color);
    const vertical = this.rand() < 0.5;
    const line = Math.floor(this.rand() * (CFG.gridN + 1));
    const coord = roadCoord(line);
    const lane = (this.rand() < 0.5 ? 1 : -1) * 3.2;
    const along = (this.rand() * 2 - 1) * 200;
    if (vertical) {
      car.position.set(coord + lane, 0, along);
      car.rotation.y = lane > 0 ? 0 : Math.PI;
    } else {
      car.position.set(along, 0, coord + lane);
      car.rotation.y = lane > 0 ? Math.PI / 2 : -Math.PI / 2;
    }
    car.userData.speed = 7 + this.rand() * 6;
    car.userData.maxSpeed = car.userData.speed;
    car.userData.curSpeed = car.userData.speed;
    car.userData.vertical = vertical;
    car.userData.dir = lane > 0 ? 1 : -1;
    car.userData.turnCooldown = 0;
    car.userData.hitT = 0;
    car.userData.steerVis = 0;
    this.group.add(car);
    this.cars.push(car);
    return car;
  }
  update(dt) {
    for (const car of this.cars) {
      const u = car.userData;
      u.turnCooldown -= dt;
      if (u.hitT > 0) u.hitT -= dt;
      const fwd = new THREE.Vector3(0, 0, 1).applyEuler(car.rotation);
      // v5: traffic cars have INERTIA — u.curSpeed approaches the
      // frame's target speed with real braking/acceleration rates,
      // so yields are firm stops when there is room, but a car
      // surprised at close range physically cannot stop in time
      // (and knocks the person down, per fix #4)
      let target = u.speed;
      // slow near intersections when another car is close ahead
      for (const other of this.cars) {
        if (other === car) continue;
        const d = other.position.distanceTo(car.position);
        if (d < 9) {
          const to = other.position.clone().sub(car.position).normalize();
          if (to.dot(fwd) > 0.7) { target = Math.min(target, u.speed * 0.25); break; }
        }
      }
      // v3 audit: traffic also yields to the PLAYER (car or on foot)
      if (target === u.speed && this.playerPos) {
        const dx = this.playerPos.x - car.position.x;
        const dz = this.playerPos.z - car.position.z;
        const d = Math.hypot(dx, dz);
        if (d < 10 && d > 0.01) {
          const dot = (dx / d) * fwd.x + (dz / d) * fwd.z;
          if (dot > 0.7) target = Math.min(target, u.speed * 0.2);
        }
      }
      // v5: after an impact the car sheds speed for a beat instead
      // of ploughing on through the person it just hit
      if (u.hitT > 0) target = Math.min(target, u.speed * 0.3);
      if (u.curSpeed === undefined) u.curSpeed = u.speed;
      const rate = target < u.curSpeed ? 14 : 5;
      const dv = target - u.curSpeed;
      u.curSpeed += Math.abs(dv) <= rate * dt ? dv : Math.sign(dv) * rate * dt;
      const speed = u.curSpeed;
      setBrake(car, target < speed - 0.05);
      car.position.addScaledVector(fwd, speed * dt);
      rollWheels(car, speed * dt);
      // wrap around city edges
      if (car.position.x > 215) car.position.x = -215;
      if (car.position.x < -215) car.position.x = 215;
      if (car.position.z > 215) car.position.z = -215;
      if (car.position.z < -215) car.position.z = 215;
      // v5: people are SOLID — knockdowns + push-asides (this is
      // the fix for cars ghosting through pedestrians and Dario)
      if (this.peds) {
        for (const p of this.peds) {
          const hit = carPersonHit(car, p, speed);
          if (hit) {
            u.hitT = Math.max(u.hitT, 0.85);
            if (hit.knocked) break;
          }
        }
      }
      if (this.playerRef && this.playerOnFoot && !this.playerRef.userData.knock) {
        const hit = carPersonHit(car, this.playerRef, speed);
        if (hit) {
          u.hitT = Math.max(u.hitT, 0.85);
          if (this.onPlayerHit) this.onPlayerHit(car, speed, hit.knocked);
        }
      }
      // maybe turn at an intersection (v3 cardinal-heading logic)
      const nx = nearestRoadCoord(car.position.x);
      const nz = nearestRoadCoord(car.position.z);
      const nearX = Math.abs(car.position.x - nx) < 1.2;
      const nearZ = Math.abs(car.position.z - nz) < 1.2;
      if (u.turnCooldown <= 0 && nearX && nearZ && this.rand() < 0.3) {
        let h = Math.round(car.rotation.y / (Math.PI / 2));
        h = ((h % 4) + 4) % 4;              // 0:+Z 1:+X 2:-Z 3:-X
        const turnDir = this.rand() < 0.5 ? 1 : 3;
        h = (h + turnDir) % 4;
        car.rotation.y = h * Math.PI / 2;
        u.steerVis = turnDir === 1 ? 0.42 : -0.42;
        u.vertical = (h % 2 === 0);
        if (u.vertical) car.position.x = nx + (h === 0 ? 3.2 : -3.2);
        else car.position.z = nz + (h === 1 ? 3.2 : -3.2);
        u.turnCooldown = 4;
      }
      // front wheels ease back to straight after a turn
      u.steerVis *= Math.exp(-2.6 * dt);
      steerWheels(car, u.steerVis);
    }
  }
}

// --- parked cars (stealable) ---
export function spawnParked(scene, rand, n = 10) {
  const parked = [];
  for (let i = 0; i < n; i++) {
    const style = Math.floor(rand() * BODY_STYLES.length);
    const color = PAINTS[Math.floor(rand() * PAINTS.length)];
    const car = makeCar(style, color);
    const line = Math.floor(rand() * (CFG.gridN + 1));
    const coord = roadCoord(line);
    // v3 audit: park in the curb lane of THIS road (avenues are 20 m
    // wide — the old fixed +5.4 m sat in a through lane there), and
    // never inside a junction box, where the car would block the
    // crossing road's lanes.
    const curb = roadHalfAt(coord) - 1.05;
    let along = (rand() * 2 - 1) * 190;
    for (let tries = 0; tries < 10; tries++) {
      let inJunction = false;
      for (let j = 0; j <= CFG.gridN; j++) {
        const q = roadCoord(j);
        if (Math.abs(along - q) < roadHalfAt(q) + 4.5) { inJunction = true; break; }
      }
      if (!inJunction) break;
      along = (rand() * 2 - 1) * 190;
    }
    const vertical = rand() < 0.5;
    if (vertical) {
      car.position.set(coord + curb, 0, along);
      car.rotation.y = rand() < 0.5 ? 0 : Math.PI;
    } else {
      car.position.set(along, 0, coord + curb);
      car.rotation.y = rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
    }
    car.userData.parked = true;
    car.userData.speed = 0;
    car.userData.maxSpeed = CFG.carMax * (0.85 + rand() * 0.25);
    scene.add(car);
    parked.push(car);
  }
  return parked;
}
