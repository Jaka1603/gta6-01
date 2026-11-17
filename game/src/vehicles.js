// PALMBAY HEAT — vehicles.js: car factory, traffic AI, parked cars,
// enter/exit (steal) logic.
const THREE = window.THREE;
import { CFG, rng, clamp } from './config.js';
import { roadCoord, nearestRoadCoord } from './world.js';

const BODY_STYLES = [
  { name: 'sedan', w: 2.0, l: 4.4, h: 0.75, cabin: 0.62 },
  { name: 'coupe', w: 1.9, l: 4.0, h: 0.6, cabin: 0.55 },
  { name: 'van', w: 2.1, l: 5.0, h: 1.5, cabin: 1.1 },
  { name: 'pickup', w: 2.0, l: 4.8, h: 0.9, cabin: 0.7 },
  { name: 'taxi', w: 2.0, l: 4.4, h: 0.75, cabin: 0.62 },
];

const PAINTS = [
  0xc0392b, 0x2e86c1, 0xf1c40f, 0x27ae60, 0x8e44ad,
  0xe67e22, 0x1abc9c, 0xecf0f1, 0x2c3e50, 0xd35400,
];

export function makeCar(styleIdx, color, isPolice = false) {
  const s = BODY_STYLES[styleIdx % BODY_STYLES.length];
  const g = new THREE.Group();
  const paint = isPolice ? 0x1a1a22 : color;
  const bodyMat = new THREE.MeshPhongMaterial({
    color: paint, shininess: 120, specular: 0xaaaaaa,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, s.l), bodyMat);
  body.position.y = 0.55 + s.h / 2;
  body.castShadow = true;
  g.add(body);
  // cabin
  const cabMat = new THREE.MeshPhongMaterial({
    color: 0x1a2a3a, shininess: 140, specular: 0xcccccc,
  });
  const cab = new THREE.Mesh(
    new THREE.BoxGeometry(s.w * 0.85, s.cabin, s.l * 0.5), cabMat
  );
  cab.position.set(0, 0.55 + s.h + s.cabin / 2 - 0.05, -s.l * 0.08);
  cab.castShadow = true;
  g.add(cab);
  // wheels
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const wheelGeo = new THREE.CylinderGeometry(0.38, 0.38, 0.3, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelPos = [
    [-s.w / 2, 0.38, s.l * 0.32], [s.w / 2, 0.38, s.l * 0.32],
    [-s.w / 2, 0.38, -s.l * 0.32], [s.w / 2, 0.38, -s.l * 0.32],
  ];
  for (const p of wheelPos) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(p[0], p[1], p[2]);
    g.add(w);
  }
  // headlights + taillights
  const hl = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const sx of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.18, 0.1), hl);
    h.position.set(sx, 0.85, s.l / 2 + 0.02);
    g.add(h);
  }
  const tl = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
  for (const sx of [-0.6, 0.6]) {
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.16, 0.1), tl);
    t.position.set(sx, 0.85, -s.l / 2 - 0.02);
    g.add(t);
  }
  // taxi sign / police light bar
  if (s.name === 'taxi') {
    const sign = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.25, 0.4),
      new THREE.MeshBasicMaterial({ color: 0xffe135 })
    );
    sign.position.set(0, 0.55 + s.h + s.cabin + 0.1, -s.l * 0.08);
    g.add(sign);
  }
  let lightBar = null;
  if (isPolice) {
    lightBar = new THREE.Group();
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.35),
      new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    r.position.x = -0.3;
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.35),
      new THREE.MeshBasicMaterial({ color: 0x2040ff }));
    b.position.x = 0.3;
    lightBar.add(r, b);
    lightBar.position.set(0, 0.55 + s.h + s.cabin + 0.05, -s.l * 0.08);
    lightBar.userData = { r, b };
    g.add(lightBar);
    // POLICE door stripe
    const stripe = new THREE.Mesh(
      new THREE.BoxGeometry(s.w + 0.02, 0.25, s.l * 0.7),
      new THREE.MeshBasicMaterial({ color: 0xffffff })
    );
    stripe.position.y = 0.75;
    g.add(stripe);
  }
  g.userData = {
    style: s, lightBar, speed: 0, maxSpeed: 0,
    steer: 0, isPolice,
  };
  return g;
}

export function heroCar() {
  // Dario's ride: orange coupe
  const c = makeCar(1, 0xe67e22);
  c.userData.maxSpeed = CFG.carMax;
  c.userData.hero = true;
  return c;
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
