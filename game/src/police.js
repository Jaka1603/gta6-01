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
import { attachWeapon, detachWeapon, startBrawl, stopBrawl, updateBrawl } from './people.js';

// v7 hot-loop discipline: module scratch vectors — police.update
// runs per frame per car/officer and must not allocate
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();
const _toP = new THREE.Vector3();
const _from = new THREE.Vector3();
const _target = new THREE.Vector3();

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
    // v6 wiring (set by main): combat FX for return fire + the
    // player figure + a damage callback
    this.fx = null;
    this.playerRef = null;
    this.onPlayerShot = null;   // (dmg) => void
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
      this.officers.push({
        person: officer, car,
        // v6 fire/brawl state (briefs F + M)
        mode: 'heel',               // heel | fire
        anchor: new THREE.Vector3(),
        burstLeft: 0, burstT: 0,
        pauseT: 0.4 + this.officers.length * 0.5 + this.rand() * 0.4,
        burstAcc: 0.55,
      });
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
      const fwd = _fwd.set(0, 0, 1).applyEuler(car.rotation);
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
    // --- officers (v6, briefs F + M) -------------------------------
    // wanted >= 2: once their car is stopped in range, officers get
    // out and SHOOT — bursty pistol fire (2-4 rounds, 0.9-1.6 s
    // between bursts, staggered per officer, accuracy tightening
    // inside a burst), holding an 8-14 m standoff from the player.
    // wanted == 1: fists only — an officer whose car is stopped near
    // an on-foot player wades in and brawls.
    for (const o of this.officers) {
      const { person, car } = o;
      const u = person.userData;
      const dx = playerPos.x - person.position.x;
      const dz = playerPos.z - person.position.z;
      const distP = Math.hypot(dx, dz);
      const carSpeed = Math.abs(car.userData.speed || 0);
      const distCar = Math.hypot(playerPos.x - car.position.x, playerPos.z - car.position.z);
      if (u.dead) continue;
      if (u.knock) continue;
      // -- return fire --
      if (this.wanted >= 2 && this.fx && this.playerRef) {
        if (o.mode !== 'fire' && carSpeed < 3 && distCar > 5 && distCar < 46) {
          // take the firing stance at the car's side, stepped
          // toward the player to hold the 8-14 m band
          o.mode = 'fire';
          const side = _side.set(1, 0, 0).applyEuler(car.rotation);
          o.anchor.copy(car.position).addScaledVector(side, 2.4);
          const toP = _toP.set(playerPos.x - o.anchor.x, 0, playerPos.z - o.anchor.z);
          const dA = toP.length();
          if (dA > 14) o.anchor.addScaledVector(toP.normalize(), Math.min(dA - 11, 6));
          attachWeapon(person, 'pistol');
        }
        if (o.mode === 'fire') {
          // abandon the stance if the car rolls away or heat drops
          if (carSpeed > 6 || distCar > 55) {
            o.mode = 'heel';
            detachWeapon(person);
          } else {
            person.position.copy(o.anchor);
            person.rotation.y = Math.atan2(dx, dz);
            u.armR.rotation.x = -1.35;   // pistol aim pose
            u.armL.rotation.x = -0.4;
            u.legL.rotation.x *= 0.7; u.legR.rotation.x *= 0.7;
            // burst state machine
            if (o.burstLeft > 0) {
              o.burstT -= dt;
              if (o.burstT <= 0) {
                o.burstT = 0.13;
                o.burstLeft -= 1;
                const from = _from.set(
                  person.position.x + Math.sin(person.rotation.y) * 0.35,
                  1.38,
                  person.position.z + Math.cos(person.rotation.y) * 0.35
                );
                const target = _target.set(playerPos.x, 1.05, playerPos.z);
                const los = !this.fx._hasLoS || this.fx._hasLoS(from, target);
                if (los && distP < 48) {
                  const res = this.fx.fireNPC(from, target, o.burstAcc);
                  o.burstAcc = Math.min(0.82, o.burstAcc + 0.06);
                  if (res.hit && this.onPlayerShot) {
                    this.onPlayerShot(4 + this.rand() * 4);   // 4-8 HP
                  }
                }
              }
            } else {
              o.pauseT -= dt;
              if (o.pauseT <= 0) {
                o.burstLeft = 2 + Math.floor(this.rand() * 3);   // 2-4 rounds
                o.burstT = 0;
                o.burstAcc = 0.55;
                o.pauseT = 0.9 + this.rand() * 0.7;              // 0.9-1.6 s
              }
            }
            continue;
          }
        }
      } else if (o.mode === 'fire') {
        o.mode = 'heel';
        detachWeapon(person);
      }
      // -- fists at wanted 1 --
      if (this.wanted === 1 && onFoot && this.playerRef && !this.playerRef.userData.dead) {
        if (!u.brawl && carSpeed < 2 && distCar < 8 && distP < 9) {
          startBrawl(person, this.playerRef, () => {
            if (this.onPlayerShot) this.onPlayerShot(3 + this.rand() * 2);
          });
        }
        if (u.brawl) {
          if (distCar > 16 || this.wanted !== 1) stopBrawl(person);
          else { updateBrawl(person, dt, this.rand); continue; }
        }
      } else if (u.brawl) stopBrawl(person);
      // -- default: heel the car, face the player --
      const side = _side.set(1, 0, 0).applyEuler(car.rotation);
      person.position.copy(car.position).addScaledVector(side, 2.4);
      person.rotation.y = Math.atan2(
        playerPos.x - person.position.x, playerPos.z - person.position.z);
      u.idle();
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
