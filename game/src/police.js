// PALMBAY HEAT — police.js: wanted system (0-5 stars), police car
// spawn + chase AI, bust meter.
const THREE = window.THREE;
import { CFG, clamp } from './config.js';
import { makeCar } from './vehicles.js';

export class Police {
  constructor(scene, rand) {
    this.scene = scene;
    this.rand = rand;
    this.wanted = 0;
    this.heat = 0;        // 0..100, fills wanted
    this.bust = 0;        // 0..100, fills when a cop is touching you
    this.cars = [];
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
    }
  }
  spawnCar() {
    const car = makeCar(0, 0xffffff, true);
    car.userData.maxSpeed = 30 + this.wanted * 1.5;
    car.userData.speed = 0;
    car.userData.police = true;
    // spawn on a road near the player (set by main via this.playerPos)
    const p = this.playerPos || { x: 0, z: 0 };
    const a = this.rand() * Math.PI * 2;
    car.position.set(p.x + Math.cos(a) * 60, 0, p.z + Math.sin(a) * 60);
    this.group.add(car);
    this.cars.push(car);
    return car;
  }
  update(dt, playerPos, playerSpeed, onFoot) {
    this.playerPos = playerPos;
    this.flashT += dt * 8;
    const flash = Math.sin(this.flashT) > 0;
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
      // light bar flash
      if (u.lightBar) {
        u.lightBar.userData.r.material.color.setHex(flash ? 0xff2020 : 0x551010);
        u.lightBar.userData.b.material.color.setHex(flash ? 0x101050 : 0x2040ff);
      }
      // bust: cop within 3.5m of a slow/stopped player
      if (dist < 4 && playerSpeed < 3) {
        this.bust = clamp(this.bust + dt * 25, 0, 100);
      } else {
        this.bust = clamp(this.bust - dt * 8, 0, 100);
      }
      // ram: push player a little on contact (handled in main via dist)
      car.userData.distToPlayer = dist;
    }
    if (this.cars.length === 0) this.bust = clamp(this.bust - dt * 8, 0, 100);
    return this.bust >= 100;
  }
  clear() {
    this.wanted = 0; this.heat = 0; this.bust = 0;
    for (const c of this.cars) this.group.remove(c);
    this.cars = [];
  }
}
