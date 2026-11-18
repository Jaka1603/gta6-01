// PALMBAY HEAT — police.js (v3): wanted system (0-5 stars), LSPD
// black/white police cars with flashing red/blue light bars, and one
// uniformed officer standing by each car. Bust meter fills when a cop
// is touching a slow player. v3 audit: pursuit cars spawn snapped
// onto the nearest road — the old 60 m ring around the player could
// drop a car inside a building.
const THREE = window.THREE;
import { CFG, clamp } from './config.js';
import { makeCar } from './vehicles.js';
import { makeOfficer } from './gang.js';
import { nearestRoadCoord } from './world.js';

export class Police {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.wanted = 0;
    this.heat = 0;        // 0..100, fills wanted
    this.bust = 0;        // 0..100, fills when a cop is touching you
    this.cars = [];
    this.officers = [];   // { person, car } — officer heels its car
    this.group = new THREE.Group();
    scene.add(this.group);
    this.flashT = 0;
  }
  addWanted(n) {
    this.heat = clamp(this.heat + n * 25, 0, 100);
    this.updateWanted();
  }
  setWanted(n) {
    this.wanted = clamp(n, 0, CFG.wantedMax);
    this.heat = this.wanted * 20 + 10; // mid-band so it holds the level
    this.syncCars();
  }
  updateWanted() {
    const w = Math.min(CFG.wantedMax, Math.floor(this.heat / 20));
    if (w !== this.wanted) {
      this.wanted = w;
      this.syncCars();
    }
  }
  decay(dt) {
    if (this.wanted === 0) return;
    this.heat = Math.max(0, this.heat - dt * 1.2);
    this.updateWanted();
  }
  syncCars() {
    // target car count = wanted level
    while (this.cars.length < this.wanted) this.spawnCar();
    while (this.cars.length > this.wanted) {
      const c = this.cars.pop();
      this.group.remove(c);
      const oi = this.officers.findIndex((o) => o.car === c);
      if (oi >= 0) {
        this.scene.remove(this.officers[oi].person);
        this.officers.splice(oi, 1);
      }
    }
  }
  spawnCar() {
    const car = makeCar(0, 0xffffff, true);
    car.userData.maxSpeed = 30 + this.wanted * 1.5;
    car.userData.speed = 0;
    car.userData.police = true;
    // spawn near the player (set by main via this.playerPos), snapped
    // onto the nearest road line so the car never starts inside a
    // building (v3 audit)
    const p = this.playerPos || { x: 0, z: 0 };
    const a = this.rand() * Math.PI * 2;
    const sx = p.x + Math.cos(a) * 60;
    const sz = p.z + Math.sin(a) * 60;
    if (Math.abs(sx - nearestRoadCoord(sx)) < Math.abs(sz - nearestRoadCoord(sz))) {
      car.position.set(nearestRoadCoord(sx) + 3.2, 0, sz);
    } else {
      car.position.set(sx, 0, nearestRoadCoord(sz) + 3.2);
    }
    this.group.add(car);
    this.cars.push(car);
    // one officer heels the car (only the first two cars, for perf)
    if (this.officers.length < 2) {
      const officer = makeOfficer();
      this.scene.add(officer);
      this.officers.push({ person: officer, car });
    }
    return car;
  }
  update(dt, playerPos, playerSpeed, onFoot) {
    this.playerPos = playerPos;
    this.flashT += dt * 8;
    const flash = Math.sin(this.flashT) > 0;
    let nearest = Infinity;
    for (const car of this.cars) {
      const u = car.userData;
      // chase: steer toward player
      const dx = playerPos.x - car.position.x;
      const dz = playerPos.z - car.position.z;
      const dist = Math.hypot(dx, dz);
      const targetAngle = Math.atan2(dx, dz);
      let diff = targetAngle - car.rotation.y;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      car.rotation.y += clamp(diff, -1.8 * dt, 1.8 * dt);
      const targetSpeed = Math.min(u.maxSpeed, dist * 0.6 + 12);
      u.speed += (targetSpeed - u.speed) * Math.min(1, dt * 1.5);
      const fwd = new THREE.Vector3(0, 0, 1).applyEuler(car.rotation);
      car.position.addScaledVector(fwd, u.speed * dt);
      // light bar flash: red/blue alternate, glow sprites follow
      if (u.lightBar) {
        const lb = u.lightBar.userData;
        lb.rMat.color.setHex(flash ? 0xff2020 : 0x551010);
        lb.bMat.color.setHex(flash ? 0x101050 : 0x2040ff);
        lb.rGlow.material.opacity = flash ? 0.9 : 0.08;
        lb.bGlow.material.opacity = flash ? 0.08 : 0.9;
      }
      // brake lights when the pursuit slows
      if (u.brakeMat) u.brakeMat.emissiveIntensity = u.speed < 4 ? 3 : 1;
      // nearest car decides the bust meter (once per frame, not per car:
      // far cars must not out-decay the near car's fill)
      if (dist < nearest) nearest = dist;
      // ram: push player a little on contact (handled in main via dist)
      car.userData.distToPlayer = dist;
    }
    // bust: nearest cop within 4m of a slow/stopped player fills it in 4s
    if (this.cars.length > 0 && nearest < 4 && playerSpeed < 3) {
      this.bust = clamp(this.bust + dt * 25, 0, 100);
    } else {
      this.bust = clamp(this.bust - dt * 8, 0, 100);
    }
    // officers stand at their car's driver side, facing the player
    for (const { person, car } of this.officers) {
      const side = new THREE.Vector3(1, 0, 0).applyEuler(car.rotation);
      person.position.copy(car.position).addScaledVector(side, 2.4);
      const dx = playerPos.x - person.position.x;
      const dz = playerPos.z - person.position.z;
      person.rotation.y = Math.atan2(dx, dz);
      // idle stance: arms relaxed at the sides
      person.userData.idle();
    }
    return this.bust >= 100;
  }
  clear() {
    this.wanted = 0; this.heat = 0; this.bust = 0;
    for (const c of this.cars) this.group.remove(c);
    this.cars = [];
    for (const o of this.officers) this.scene.remove(o.person);
    this.officers = [];
  }
}
