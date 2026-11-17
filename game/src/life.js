// PALMBAY HEAT — life.js (v2): the ambient life pass. Birds in V
// formation crossing the sky, seagulls circling the pier, a dog that
// follows a pedestrian, a cat that crosses the road now and then, and
// slow-drifting clouds. All motion is delta-time based and seeded, so a
// fixed-step pre-roll puts the same life in the same place every run.
const THREE = window.THREE;
import { CFG, TAU, clamp } from './config.js';

// --- one bird: cone body + two flapping wing planes ---
function makeBird(color = 0x22242a) {
  const b = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide });
  const body = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.7, 5), m);
  body.rotation.x = Math.PI / 2;   // cone points +Z: forward
  b.add(body);
  const wingGeo = new THREE.PlaneGeometry(1.1, 0.32);
  wingGeo.translate(0.55, 0, 0);   // pivot at the wing root
  const wl = new THREE.Mesh(wingGeo, m);
  const wr = new THREE.Mesh(wingGeo, m);
  wr.rotation.y = Math.PI;
  b.add(wl, wr);
  b.userData.flap = (t, ph, amp = 0.65) => {
    const a = Math.sin(t * 9 + ph) * amp;
    wl.rotation.z = a;
    wr.rotation.z = -a;
  };
  return b;
}

export class Flock {
  // centre: {x, z, r, h, speed, period} — leader flies a circle;
  // members hold V offsets behind the leader.
  constructor(scene, opts = {}) {
    this.scene = scene;
    this.cx = opts.cx || 0;
    this.cz = opts.cz || 0;
    this.r = opts.r || 120;
    this.h = opts.h || 30;
    this.speed = opts.speed || 9;
    this.count = opts.count || 7;
    this.color = opts.color || 0x22242a;
    this.angle = opts.angle || 0;
    this.birds = [];
    this.group = new THREE.Group();
    for (let i = 0; i < this.count; i++) {
      const b = makeBird(this.color);
      this.group.add(b);
      this.birds.push(b);
    }
    scene.add(this.group);
    this.t = 0;
  }
  // place the flock so it crosses a point in front of a camera:
  // angle set so the leader is at (tx, tz) right now.
  placeAt(tx, tz) {
    const dx = tx - this.cx, dz = tz - this.cz;
    this.angle = Math.atan2(dx, dz);
  }
  update(dt) {
    this.t += dt;
    const w = this.speed / this.r;   // angular speed
    this.angle += w * dt;
    const heading = this.angle + Math.PI / 2;
    // leader position on the circle
    const lx = this.cx + Math.sin(this.angle) * this.r;
    const lz = this.cz + Math.cos(this.angle) * this.r;
    const fwdX = Math.cos(this.angle);
    const fwdZ = -Math.sin(this.angle);
    this.birds.forEach((b, i) => {
      const side = i === 0 ? 0 : (i % 2 === 0 ? 1 : -1);
      const row = Math.ceil(i / 2);
      const bx = lx - fwdX * row * 1.6 + (-fwdZ) * side * row * 1.3;
      const bz = lz - fwdZ * row * 1.6 + fwdX * side * row * 1.3;
      b.position.set(bx, this.h + Math.sin(this.t * 1.3 + i) * 0.6, bz);
      b.rotation.y = Math.atan2(fwdX, fwdZ);
      const glide = 0.5 + 0.5 * Math.sin(this.t * 0.5 + i * 1.7);
      b.userData.flap(this.t, i * 0.9, 0.65 * glide + 0.1);
    });
  }
}

// --- dog: follows its owner at a heel offset, trots, sits when idle ---
export function makeDog() {
  const g = new THREE.Group();
  const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 });
  const coat = mat(0x8a5a30);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.42, 4, 8), coat);
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.34;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), coat);
  head.position.set(0.36, 0.48, 0);
  head.castShadow = true;
  g.add(head);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.1), mat(0x5a3a20));
  snout.position.set(0.5, 0.44, 0);
  g.add(snout);
  for (const s of [-1, 1]) {
    const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 6), mat(0x5a3a20));
    ear.position.set(0.32, 0.6, s * 0.08);
    g.add(ear);
  }
  // tail on a wagging pivot
  const tailPivot = new THREE.Group();
  tailPivot.position.set(-0.36, 0.44, 0);
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.3, 6), coat);
  tail.position.y = 0.12;
  tailPivot.add(tail);
  g.add(tailPivot);
  // four trotting legs on pivots
  const legs = [];
  const legGeo = new THREE.BoxGeometry(0.07, 0.3, 0.07);
  for (const [x, z] of [[0.2, 0.1], [0.2, -0.1], [-0.2, 0.1], [-0.2, -0.1]]) {
    const p = new THREE.Group();
    p.position.set(x, 0.3, z);
    const m = new THREE.Mesh(legGeo, coat);
    m.position.y = -0.15;
    p.add(m);
    g.add(p);
    legs.push(p);
  }
  g.userData = {
    tailPivot, legs, phase: 0, speed: 0,
    trot(phase, amp = 0.5) {
      legs[0].rotation.x = Math.sin(phase) * amp;
      legs[3].rotation.x = Math.sin(phase) * amp;
      legs[1].rotation.x = Math.sin(phase + Math.PI) * amp;
      legs[2].rotation.x = Math.sin(phase + Math.PI) * amp;
      tailPivot.rotation.y = Math.sin(phase * 0.5) * 0.4;
    },
  };
  return g;
}

export class DogFollower {
  constructor(scene, owner) {
    this.scene = scene;
    this.owner = owner;   // a person group the dog heels
    this.dog = makeDog();
    scene.add(this.dog);
    this.phase = 0;
    this.idleT = 0;
  }
  update(dt) {
    const o = this.owner.position;
    const heading = this.owner.rotation.y;
    // heel spot: behind-left of the owner
    const tx = o.x - Math.sin(heading) * 0.9 - Math.cos(heading) * 0.45;
    const tz = o.z - Math.cos(heading) * 0.9 + Math.sin(heading) * 0.45;
    const dx = tx - this.dog.position.x;
    const dz = tz - this.dog.position.z;
    const d = Math.hypot(dx, dz);
    const u = this.dog.userData;
    if (d > 0.25) {
      this.idleT = 0;
      const sp = clamp(d * 2.2, 1.2, 5.5);
      const targetHeading = Math.atan2(dx, dz);
      let diff = targetHeading - this.dog.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      this.dog.rotation.y += clamp(diff, -4 * dt, 4 * dt);
      this.dog.position.x += Math.sin(this.dog.rotation.y) * sp * dt;
      this.dog.position.z += Math.cos(this.dog.rotation.y) * sp * dt;
      this.phase += dt * sp * 3.4;
      u.trot(this.phase);
    } else {
      // owner stopped: sit still, tail wags
      this.idleT += dt;
      u.trot(0, 0);
      u.tailPivot.rotation.y = Math.sin(this.idleT * 6) * 0.5;
    }
  }
}

// --- a cat that crosses the road every 25-40 s (seeded timer) ---
export class CrossingCat {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.cat = makeDog();   // same body plan, scaled down, longer tail
    this.cat.scale.setScalar(0.55);
    this.cat.visible = false;
    scene.add(this.cat);
    this.timer = 18 + rand() * 10;
    this.active = false;
    this.from = new THREE.Vector3();
    this.to = new THREE.Vector3();
    this.phase = 0;
  }
  update(dt) {
    if (!this.active) {
      this.timer -= dt;
      if (this.timer <= 0) {
        // pick a road line, cross it at a random point
        const vertical = this.rand() < 0.5;
        const line = -210 + Math.floor(this.rand() * 8) * 60;
        const along = (this.rand() * 2 - 1) * 180;
        if (vertical) {
          this.from.set(line - 9, 0, along);
          this.to.set(line + 9, 0, along);
        } else {
          this.from.set(along, 0, line - 9);
          this.to.set(along, 0, line + 9);
        }
        this.cat.position.copy(this.from);
        this.cat.rotation.y = Math.atan2(
          this.to.x - this.from.x, this.to.z - this.from.z
        );
        this.cat.visible = true;
        this.active = true;
        this.phase = 0;
      }
      return;
    }
    this.phase += dt;
    const k = clamp(this.phase / 6, 0, 1);   // ~6 s to cross
    this.cat.position.lerpVectors(this.from, this.to, k);
    this.cat.userData.trot(this.phase * 8, 0.45);
    if (k >= 1) {
      this.active = false;
      this.cat.visible = false;
      this.timer = 25 + this.rand() * 15;
    }
  }
}

// --- clouds: flat-shaded blobs drifting slowly, wrapping at +-800 ---
export class Clouds {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.group = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({
      color: 0xffffff, emissive: 0x8899aa, emissiveIntensity: 0.25,
      transparent: true, opacity: 0.85, flatShading: true,
    });
    this.clouds = [];
    for (let i = 0; i < 12; i++) {
      const c = new THREE.Group();
      const n = 3 + Math.floor(rand() * 3);
      for (let j = 0; j < n; j++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(6 + rand() * 9, 7, 6), m);
        s.position.set(j * 7 - n * 3.5, rand() * 2, (rand() - 0.5) * 8);
        s.scale.y = 0.45;
        c.add(s);
      }
      c.position.set((rand() * 2 - 1) * 700, 95 + rand() * 45, (rand() * 2 - 1) * 700);
      this.group.add(c);
      this.clouds.push(c);
    }
    scene.add(this.group);
  }
  update(dt) {
    for (const c of this.clouds) {
      c.position.x += dt * 1.2;
      if (c.position.x > 800) c.position.x = -800;
    }
  }
}
