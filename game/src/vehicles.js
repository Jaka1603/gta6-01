// PALMBAY HEAT — vehicles.js (v2): SA-style parametric cars.
// Proportions from SCALE (car ~4.4 m): glass cabin, racing stripes,
// plates, hubs, lit headlights, brake lights, contact shadow.
// Hero = red convertible with interior + seats. Police = black/white
// LSPD livery with POLICE doors, push bumper, red/blue light bar.
const THREE = window.THREE;
import { CFG, PALETTE, SCALE, clamp } from './config.js';
import { roadCoord, nearestRoadCoord } from './world.js';
import { blobTexture, plateTexture, policeDoorTexture, glowTexture } from './textures.js';
import { glowSprite } from './effects.js';

const BODY_STYLES = [
  { name: 'sedan', w: 1.8, l: 4.4, h: 0.55, cabin: 0.5 },
  { name: 'coupe', w: 1.8, l: 4.0, h: 0.5, cabin: 0.45 },
  { name: 'van', w: 2.0, l: 5.0, h: 1.1, cabin: 0.9 },
  { name: 'pickup', w: 1.9, l: 4.8, h: 0.7, cabin: 0.55 },
  { name: 'taxi', w: 1.8, l: 4.4, h: 0.55, cabin: 0.5 },
  { name: 'suv', w: 1.95, l: 4.6, h: 0.8, cabin: 0.65 },
];

const PAINTS = [
  0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad,
  0xe67e22, 0x1abc9c, 0xecf0f1, 0x2c3e50, 0xd35400,
];

const tireGeo = new THREE.CylinderGeometry(SCALE.wheelR, SCALE.wheelR, 0.24, 18);
tireGeo.rotateZ(Math.PI / 2);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.95 });
const hubGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.26, 12);
hubGeo.rotateZ(Math.PI / 2);
const hubMat = new THREE.MeshStandardMaterial({
  color: 0xb8bcc2, roughness: 0.35, metalness: 0.5,
});
const glassMat = new THREE.MeshStandardMaterial({
  color: 0x10151c, roughness: 0.15, metalness: 0.5,
});
const chromeMat = new THREE.MeshStandardMaterial({
  color: 0xd8dce2, roughness: 0.3, metalness: 0.5,
});
let blobTex = null;

function wheel(x, z) {
  const g = new THREE.Group();
  const t = new THREE.Mesh(tireGeo, tireMat);
  t.castShadow = true;
  const hub = new THREE.Mesh(hubGeo, hubMat);
  g.add(t, hub);
  g.position.set(x, SCALE.wheelR, z);
  return g;
}

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

function addLights(car, s, brakeMat) {
  // headlights: warm emissive boxes + glow sprites (sunset = lights on)
  const hlMat = new THREE.MeshStandardMaterial({
    color: 0xfff2cc, emissive: 0xffe9a0, emissiveIntensity: 2.2,
  });
  for (const sx of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.18, 0.1), hlMat);
    h.position.set(sx, 0.82, s.l / 2 + 0.02);
    car.add(h);
    const glow = glowSprite(0xffe9a0, 1.1, 0.7);
    glow.position.set(sx, 0.82, s.l / 2 + 0.25);
    car.add(glow);
  }
  // taillights: brake material is driven by speed (brake = bright)
  for (const sx of [-0.6, 0.6]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.1), brakeMat);
    t.position.set(sx, 0.82, -s.l / 2 - 0.02);
    car.add(t);
    const glow = glowSprite(0xff2211, 0.7, 0.0);
    glow.position.set(sx, 0.82, -s.l / 2 - 0.25);
    glow.name = 'brakeGlow';
    car.add(glow);
  }
}

function addPlate(car, s, text) {
  const tex = plateTexture(text);
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.13, 0.03),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  plate.position.set(0, 0.62, -s.l / 2 - 0.04);
  car.add(plate);
  const plateF = plate.clone();
  plateF.position.set(0, 0.62, s.l / 2 + 0.04);
  plateF.rotation.y = Math.PI;
  car.add(plateF);
}

export function makeCar(styleIdx, color, isPolice = false) {
  const s = BODY_STYLES[styleIdx % BODY_STYLES.length];
  const g = new THREE.Group();
  const paint = isPolice ? PALETTE.policeBlack : color;
  const paintMat = new THREE.MeshStandardMaterial({
    // low metalness: no env map in this build, so high metalness reads black
    color: paint, metalness: 0.25, roughness: 0.35,
  });
  // lower body + nose taper (kills the brick silhouette)
  const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.l), paintMat);
  body.position.y = 0.55 + s.h / 2;
  body.castShadow = true;
  g.add(body);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(s.w * 0.92, s.h * 0.72, 0.7), paintMat
  );
  nose.position.set(0, 0.55 + s.h * 0.36, s.l / 2 - 0.1);
  nose.castShadow = true;
  g.add(nose);
  // glass cabin + painted roof
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(s.w * 0.85, s.cabin, s.l * 0.5), glassMat
  );
  cab.position.set(0, 0.55 + s.h + s.cabin / 2 - 0.05, -s.l * 0.08);
  cab.castShadow = true;
  g.add(cab);
  const roof = new THREE.Mesh(
    new THREE.BoxGeometry(s.w * 0.8, 0.07, s.l * 0.46), paintMat
  );
  roof.position.set(0, 0.55 + s.h + s.cabin - 0.02, -s.l * 0.08);
  g.add(roof);
  // racing stripes over hood + roof + trunk (the SA sport read)
  if (!isPolice && s.name !== 'van') {
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xf5f5f5, roughness: 0.4,
    });
    for (const dz of [-0.16, 0.16]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(s.l + 0.02, 0.02, 0.26), stripeMat);
      st.position.set(dz, 0.55 + s.h + 0.012, 0);
      // hood/trunk stripes run along the car: rotate the box
      st.rotation.y = Math.PI / 2;
      g.add(st);
      const st2 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, s.l * 0.46), stripeMat);
      st2.position.set(dz, 0.55 + s.h + s.cabin + 0.02, -s.l * 0.08);
      g.add(st2);
    }
  }
  // wheels with hubs
  for (const [x, z] of [
    [-s.w / 2 + 0.06, s.l * 0.32], [s.w / 2 - 0.06, s.l * 0.32],
    [-s.w / 2 + 0.06, -s.l * 0.32], [s.w / 2 - 0.06, -s.l * 0.32],
  ]) g.add(wheel(x, z));
  // exhaust: twin pipes
  for (const sx of [-0.35, 0.35]) {
    const ex = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), chromeMat
    );
    ex.rotation.x = Math.PI / 2;
    ex.position.set(sx, 0.35, -s.l / 2 - 0.08);
    g.add(ex);
  }
  // lights + plate
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x330000, emissive: 0xff2211, emissiveIntensity: 1,
  });
  addLights(g, s, brakeMat);
  addPlate(g, s, isPolice ? 'PBPD 07' : 'PBAY ' + String(10 + (styleIdx * 7) % 89));
  // taxi sign
  if (s.name === 'taxi') {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.25, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffe135 })
    );
    sign.position.set(0, 0.55 + s.h + s.cabin + 0.1, -s.l * 0.08);
    g.add(sign);
  }
  // pickup bed: open tub behind the cab
  if (s.name === 'pickup') {
    const bed = new THREE.Mesh(
      new THREE.BoxGeometry(s.w * 0.9, 0.3, s.l * 0.34),
      new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.9 })
    );
    bed.position.set(0, 0.55 + s.h + 0.12, -s.l * 0.32);
    g.add(bed);
  }
  // police livery: white doors with POLICE + star, push bumper, light bar
  let lightBar = null;
  if (isPolice) {
    const doorTex = policeDoorTexture();
    const doorMat = new THREE.MeshBasicMaterial({ map: doorTex });
    for (const side of [-1, 1]) {
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.85), doorMat);
      door.position.set(side * (s.w / 2 + 0.012), 0.82, -0.1);
      door.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
      g.add(door);
    }
    // push bumper (front bar)
    const bumper = new THREE.Mesh(
      new THREE.BoxGeometry(s.w * 0.9, 0.35, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.4, metalness: 0.7 })
    );
    bumper.position.set(0, 0.55, s.l / 2 + 0.35);
    g.add(bumper);
    for (const sx of [-0.5, 0.5]) {
      const upright = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.7, 0.12),
        bumper.material
      );
      upright.position.set(sx, 0.75, s.l / 2 + 0.35);
      g.add(upright);
    }
    // light bar: red/blue blocks + glow sprites
    lightBar = new THREE.Group();
    const rMat = new THREE.MeshBasicMaterial({ color: 0xff2020 });
    const bMat = new THREE.MeshBasicMaterial({ color: 0x2040ff });
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.4), rMat);
    r.position.x = -0.32;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.2, 0.4), bMat);
    b.position.x = 0.32;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.08, 0.45),
      new THREE.MeshStandardMaterial({ color: 0x111114, roughness: 0.5 })
    );
    const rGlow = glowSprite(0xff2020, 1.6, 0.8);
    rGlow.position.set(-0.32, 0.2, 0);
    const bGlow = glowSprite(0x2040ff, 1.6, 0.8);
    bGlow.position.set(0.32, 0.2, 0);
    lightBar.add(base, r, b, rGlow, bGlow);
    lightBar.position.set(0, 0.55 + s.h + s.cabin + 0.08, -s.l * 0.08);
    lightBar.userData = { r, b, rMat, bMat, rGlow, bGlow };
    g.add(lightBar);
  }
  g.add(contactShadow());
  g.userData = {
    style: s, lightBar, speed: 0, maxSpeed: 0,
    steer: 0, isPolice, brakeMat,
  };
  return g;
}

// --- hero convertible: open top, low windshield, seats + interior ---
export function makeConvertible(paintHex) {
  const g = new THREE.Group();
  const s = BODY_STYLES[1]; // coupe base
  const paintMat = new THREE.MeshStandardMaterial({
    color: paintHex, metalness: 0.25, roughness: 0.3,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.l), paintMat);
  body.position.y = 0.55 + s.h / 2;
  body.castShadow = true;
  g.add(body);
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(s.w * 0.92, s.h * 0.72, 0.7), paintMat
  );
  nose.position.set(0, 0.55 + s.h * 0.36, s.l / 2 - 0.1);
  nose.castShadow = true;
  g.add(nose);
  // open tub: dark interior floor + side walls
  const tubMat = new THREE.MeshStandardMaterial({ color: 0x1c1c22, roughness: 0.9 });
  const tub = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.86, 0.3, s.l * 0.48), tubMat);
  tub.position.set(0, 0.55 + s.h + 0.12, -s.l * 0.08);
  g.add(tub);
  // seats + headrests: dark leather, so the open top reads as interior
  const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.85 });
  for (const sx of [-0.45, 0.45]) {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.5), seatMat);
    seat.position.set(sx, 0.55 + s.h + 0.5, -s.l * 0.16);
    seat.castShadow = true;
    g.add(seat);
    const rest = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.22, 0.16), seatMat);
    rest.position.set(sx, 0.55 + s.h + 0.82, -s.l * 0.16 - 0.22);
    g.add(rest);
  }
  // chrome roll bar behind the seats (the convertible cue)
  for (const sx of [-0.45, 0.45]) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(0.26, 0.035, 8, 16, Math.PI), chromeMat
    );
    hoop.position.set(sx, 0.55 + s.h + 0.78, -s.l * 0.16 - 0.28);
    g.add(hoop);
  }
  // low tilted windshield (glass): tall enough to catch the sky
  const shieldMat = new THREE.MeshStandardMaterial({
    color: 0x8fb8d8, roughness: 0.1, metalness: 0.3,
    transparent: true, opacity: 0.75,
  });
  const shield = new THREE.Mesh(new THREE.BoxGeometry(s.w * 0.84, 0.7, 0.06), shieldMat);
  shield.position.set(0, 0.55 + s.h + 0.62, s.l * 0.14);
  shield.rotation.x = -0.35;
  g.add(shield);
  // steering wheel
  const steerWheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.22, 0.035, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.6 })
  );
  steerWheel.position.set(-0.45, 0.55 + s.h + 0.55, s.l * 0.02);
  steerWheel.rotation.x = -0.5;
  g.add(steerWheel);
  // racing stripes
  const stripeMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.4 });
  for (const dz of [-0.16, 0.16]) {
    const st = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.02, s.l), stripeMat);
    st.position.set(dz, 0.55 + s.h + 0.012, 0);
    g.add(st);
  }
  for (const [x, z] of [
    [-s.w / 2 + 0.06, s.l * 0.32], [s.w / 2 - 0.06, s.l * 0.32],
    [-s.w / 2 + 0.06, -s.l * 0.32], [s.w / 2 - 0.06, -s.l * 0.32],
  ]) g.add(wheel(x, z));
  for (const sx of [-0.35, 0.35]) {
    const ex = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.3, 8), chromeMat
    );
    ex.rotation.x = Math.PI / 2;
    ex.position.set(sx, 0.35, -s.l / 2 - 0.08);
    g.add(ex);
  }
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0x330000, emissive: 0xff2211, emissiveIntensity: 1,
  });
  addLights(g, s, brakeMat);
  addPlate(g, s, 'DARIO 1');
  g.add(contactShadow());
  g.userData = {
    style: s, lightBar: null, speed: 0, maxSpeed: 0,
    steer: 0, isPolice: false, brakeMat, convertible: true,
  };
  return g;
}

export function heroCar() {
  // Dario's ride: red convertible with white stripes
  const c = makeConvertible(PALETTE.heroRed);
  c.userData.maxSpeed = CFG.carMax;
  c.userData.hero = true;
  return c;
}

// brake lights on/off (emissive + glow sprite)
export function setBrake(car, on) {
  const u = car.userData;
  if (!u.brakeMat) return;
  u.brakeMat.emissiveIntensity = on ? 4 : 1;
  car.traverse((o) => {
    if (o.name === 'brakeGlow') o.material.opacity = on ? 0.85 : 0.0;
  });
}


// --- traffic AI: cars follow the road grid, turn at intersections ---
export class Traffic {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.cars = [];
    this.group = new THREE.Group();
    scene.add(this.group);
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
    car.userData.vertical = vertical;
    car.userData.dir = lane > 0 ? 1 : -1;
    car.userData.turnCooldown = 0;
    this.group.add(car);
    this.cars.push(car);
    return car;
  }
  update(dt) {
    for (const car of this.cars) {
      const u = car.userData;
      u.turnCooldown -= dt;
      const fwd = new THREE.Vector3(0, 0, 1).applyEuler(car.rotation);
      // slow near intersections when another car is close ahead
      let speed = u.speed;
      for (const other of this.cars) {
        if (other === car) continue;
        const d = other.position.distanceTo(car.position);
        if (d < 9) {
          const to = other.position.clone().sub(car.position).normalize();
          if (to.dot(fwd) > 0.7) { speed = Math.min(speed, u.speed * 0.25); break; }
        }
      }
      // brake lights when slowing for traffic ahead
      setBrake(car, speed < u.speed * 0.6);
      car.position.addScaledVector(fwd, speed * dt);
      // wrap around city edges
      if (car.position.x > 215) car.position.x = -215;
      if (car.position.x < -215) car.position.x = 215;
      if (car.position.z > 215) car.position.z = -215;
      if (car.position.z < -215) car.position.z = 215;
      // maybe turn at an intersection
      const nx = nearestRoadCoord(car.position.x);
      const nz = nearestRoadCoord(car.position.z);
      const nearX = Math.abs(car.position.x - nx) < 1.2;
      const nearZ = Math.abs(car.position.z - nz) < 1.2;
      if (u.turnCooldown <= 0 && nearX && nearZ && this.rand() < 0.3) {
        u.vertical = !u.vertical;
        const turn = this.rand() < 0.5 ? Math.PI / 2 : -Math.PI / 2;
        car.rotation.y += turn;
        // snap to the road line
        if (u.vertical) car.position.x = nx + (car.rotation.y === 0 ? 3.2 : -3.2);
        else car.position.z = nz + (car.rotation.y === Math.PI / 2 ? 3.2 : -3.2);
        u.turnCooldown = 4;
      }
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
    const along = (rand() * 2 - 1) * 190;
    const vertical = rand() < 0.5;
    if (vertical) {
      car.position.set(coord + 5.4, 0, along);
      car.rotation.y = rand() < 0.5 ? 0 : Math.PI;
    } else {
      car.position.set(along, 0, coord + 5.4);
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
