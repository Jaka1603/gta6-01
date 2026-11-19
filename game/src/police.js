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
import { attachWeapon, detachWeapon, startBrawl, stopBrawl, updateBrawl, updateKnock, poseSeated, poseStand } from './people.js';

// v8: named units (top-1 lesson — the response panel reads real
// callsigns, not anonymous red dots). Ground units draw from this
// pool in spawn order; the air unit is always KITE-1.
const CALLSIGNS = ['CORAL-48', 'CORAL-85', 'MARLIN-3', 'MARLIN-7', 'DORADO-2', 'PELICAN-9'];

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
    // v8: distance to the nearest unit, refreshed by update() —
    // decay() reads it (heat must not melt while a unit is on you)
    this.nearestDist = Infinity;
    this.callsignIdx = 0;
    // v8: the air unit (helicopter), built lazily at wanted >= 4
    this.heli = null;        // THREE.Group while deployed
    this.heliAngle = 0;
    this.heliGlow = null;
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
    // v8 bug fix: v7 decayed heat at full rate even with a unit on
    // your bumper — HEAT ESCAPE (and losing the cops generally)
    // resolved itself on a timer while the chase was still on.
    // Heat now melts fast only once you have actually broken away
    // (> 35 m from the nearest unit); under pressure it barely
    // cools, so escaping is a driving problem again.
    const rate = this.nearestDist > 35 ? 1.6 : 0.5;
    this.heat = Math.max(0, this.heat - dt * rate);
    this.updateWanted();
  }
  syncCars() {
    // v8: the air unit joins at wanted >= 4 and leaves at <= 2
    if (this.wanted >= 4) this.deployHeli();
    else if (this.wanted <= 2) this.retireHeli();
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
    car.userData.callsign = CALLSIGNS[this.callsignIdx % CALLSIGNS.length];
    this.callsignIdx += 1;
    car.userData.role = 'PURSUIT';
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
    // one officer per car (only the first two cars, for perf). v7:
    // the officer starts SEATED IN the car as its driver — the old
    // build glued him 2.4 m beside the car at any speed (Jaka's bug).
    if (this.officers.length < 2) {
      const officer = makeOfficer();
      this.scene.add(officer);
      const o = {
        person: officer, car,
        // v7 FSM: ride | exit | heel | toAnchor | fire | return | enter
        mode: 'ride',
        anchor: new THREE.Vector3(),
        exitFrom: new THREE.Vector3(),
        phaseT: 0, phase: 0,
        returnTo: 'seat',           // return end-state: 'seat' | 'door'
        burstLeft: 0, burstT: 0,
        pauseT: 0.4 + this.officers.length * 0.5 + this.rand() * 0.4,
        burstAcc: 0.55,
      };
      this.officers.push(o);
      this.placeAtSeat(o);
      poseSeated(officer);
    }
    return car;
  }
  // --- v8 air unit -------------------------------------------------
  // A real flying helicopter: it orbits the player at ~26 m, banks
  // toward him, rotors spinning, with a searchlight cone + ground
  // glow that track him. Deployed at wanted >= 4 (syncCars), gone
  // at <= 2. Pure presentation + HUD presence — no extra lights,
  // so the draw-call cost is ~10 meshes only while it is up.
  deployHeli() {
    if (this.heli) return;
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.4, metalness: 0.2 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x18222e, roughness: 0.3, metalness: 0.4 });
    const blue = new THREE.MeshStandardMaterial({ color: 0x2050a0, roughness: 0.45 });
    const bx = (w, h, d, m, x, y, z) => {
      const q = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      q.position.set(x, y, z); q.castShadow = true; g.add(q); return q;
    };
    bx(1.7, 1.5, 3.6, white, 0, 0, 0.4);            // fuselage
    bx(1.74, 0.4, 3.0, blue, 0, -0.25, 0.4);       // stripe
    bx(1.3, 0.8, 1.1, dark, 0, 0.25, 2.1);         // cockpit glass
    bx(0.5, 0.5, 3.4, white, 0, 0.35, -3.2);       // tail boom
    bx(0.12, 1.1, 0.7, blue, 0, 0.75, -4.8);       // tail fin
    bx(2.6, 0.08, 0.3, dark, 0, -1.05, 0.3);       // skids
    bx(0.3, 0.08, 2.6, dark, -1.15, -1.05, 0.3);
    bx(0.3, 0.08, 2.6, dark, 1.15, -1.05, 0.3);
    const rotor = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.06, 0.55),
      new THREE.MeshStandardMaterial({ color: 0x22242a, roughness: 0.5 }));
    rotor.position.y = 1.0;
    g.add(rotor);
    const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.3, 0.3), rotor.material);
    tailRotor.position.set(0.12, 0.75, -4.8);
    g.add(tailRotor);
    // searchlight cone: apex at the belly, opening on the ground
    const coneGeo = new THREE.ConeGeometry(5.2, 26, 14, 1, true);
    coneGeo.translate(0, -13, 0);
    const cone = new THREE.Mesh(coneGeo, new THREE.MeshBasicMaterial({
      color: 0xfff2c0, transparent: true, opacity: 0.10,
      blending: THREE.AdditiveBlending, depthWrite: false,
      side: THREE.DoubleSide, fog: false,
    }));
    cone.position.y = -0.8;
    cone.frustumCulled = false;
    g.add(cone);
    g.userData = { rotor, tailRotor, cone, callsign: 'KITE-1', role: 'AIR UNIT' };
    const p = this.playerPos || { x: 0, z: 0 };
    g.position.set(p.x + 30, 26, p.z + 30);
    this.scene.add(g);
    this.heli = g;
    // ground glow pool under the spotlight (rides the player)
    const glowTexC = document.createElement('canvas');
    glowTexC.width = glowTexC.height = 64;
    const gc = glowTexC.getContext('2d');
    const grad = gc.createRadialGradient(32, 32, 2, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,244,200,0.55)');
    grad.addColorStop(1, 'rgba(255,244,200,0)');
    gc.fillStyle = grad; gc.fillRect(0, 0, 64, 64);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(11, 11),
      new THREE.MeshBasicMaterial({
        map: new THREE.CanvasTexture(glowTexC), transparent: true,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(p.x, 0.25, p.z);
    this.scene.add(glow);
    this.heliGlow = glow;
  }
  retireHeli() {
    if (this.heli) { this.scene.remove(this.heli); this.heli = null; }
    if (this.heliGlow) { this.scene.remove(this.heliGlow); this.heliGlow = null; }
  }
  updateHeli(dt, playerPos) {
    const h = this.heli;
    if (!h) return;
    this.heliAngle += dt * 0.22;
    const tx = playerPos.x + Math.sin(this.heliAngle) * 17;
    const tz = playerPos.z + Math.cos(this.heliAngle) * 17;
    const k = 1 - Math.exp(-1.6 * dt);
    h.position.x += (tx - h.position.x) * k;
    h.position.z += (tz - h.position.z) * k;
    h.position.y += (26 - h.position.y) * k;
    h.rotation.y = Math.atan2(playerPos.x - h.position.x, playerPos.z - h.position.z);
    h.rotation.z = 0.14;   // banked into the orbit
    h.userData.rotor.rotation.y += dt * 26;
    h.userData.tailRotor.rotation.x += dt * 34;
    if (this.heliGlow) this.heliGlow.position.set(playerPos.x, 0.25, playerPos.z);
  }
  // shot staging: deploy + park the heli in a composed orbit spot
  stageHeli(playerPos, angle = 0.8) {
    this.deployHeli();
    if (!this.heli) return;
    this.heliAngle = angle;
    this.heli.position.set(
      playerPos.x + Math.sin(angle) * 17, 26,
      playerPos.z + Math.cos(angle) * 17);
    this.heli.rotation.y = Math.atan2(
      playerPos.x - this.heli.position.x, playerPos.z - this.heli.position.z);
    if (this.heliGlow) this.heliGlow.position.set(playerPos.x, 0.25, playerPos.z);
  }

  // v7: the officer's seat in car space — driver side (-X), dropped
  // so torso + head sit inside the glass band under the roof line.
  placeAtSeat(o) {
    const { person, car } = o;
    _side.set(-0.42, -0.25, 0.05).applyEuler(car.rotation);
    person.position.copy(car.position).add(_side);
    person.rotation.y = car.rotation.y;
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
      // v7: a car whose officer is out on foot HOLDS position (he
      // walks back to it); a car with its officer still aboard eases
      // to a stop ~9 m from an on-foot player — the classic cop stop,
      // and the only way the officer can ever get out: the old
      // targetSpeed never dropped below 12 near the player, so the
      // "stopped car" deploy gate was unreachable in real play.
      const oc = this.officers.find((oo) => oo.car === car);
      let targetSpeed = Math.min(u.maxSpeed, dist * 0.6 + 12);
      if (oc && (oc.mode !== 'ride' || oc.person.userData.dead)) {
        targetSpeed = 0;
      } else if (oc && onFoot && this.wanted >= 1 && dist < 16) {
        targetSpeed = Math.min(targetSpeed, Math.max(0, (dist - 9) * 1.4));
      }
      // a held car does not pivot in place to track the player
      if (Math.abs(u.speed) > 0.4 || targetSpeed > 0.1) {
        car.rotation.y += clamp(diff, -1.8 * dt, 1.8 * dt);
      }
      u.speed += (targetSpeed - u.speed) * Math.min(1, dt * 1.5);
      // v7: hard approach cap near an on-foot player — the eased
      // target alone let the car blow past and orbit at speed, so
      // it never settled into the stop that lets the officer out
      if (oc && oc.mode === 'ride' && onFoot && this.wanted >= 1 && dist < 16) {
        u.speed = Math.min(u.speed, Math.max(0, (dist - 8) * 1.2));
      }
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
    this.nearestDist = nearest;
    this.updateHeli(dt, playerPos);
    // bust: nearest cop within 4m of a slow/stopped player fills it in 4s
    if (this.cars.length > 0 && nearest < 4 && playerSpeed < 3) {
      this.bust = clamp(this.bust + dt * 25, 0, 100);
    } else {
      this.bust = clamp(this.bust - dt * 8, 0, 100);
    }
    // --- officers (v7 FSM) ----------------------------------------
    // ride: SEATED in the car as its driver (v6 glued the officer
    // 2.4 m beside the car at ANY speed — Jaka's headline bug).
    // When the car stops near a slow/on-foot player the officer
    // exits (door swings), then: wanted >= 2 — walks to an 8-14 m
    // firing anchor and shoots bursty pistol fire (v6 ballistics
    // kept); wanted == 1 — wades in and brawls. If the action moves
    // away he runs back, gets in, and the chase resumes.
    for (const o of this.officers) {
      const { person, car } = o;
      const u = person.userData;
      const dx = playerPos.x - person.position.x;
      const dz = playerPos.z - person.position.z;
      const distP = Math.hypot(dx, dz);
      const carSpeed = Math.abs(car.userData.speed || 0);
      const distCar = Math.hypot(playerPos.x - car.position.x, playerPos.z - car.position.z);
      // v7 bug fix: a knocked officer never got updateKnock called —
      // he froze mid-pose forever (dead ones standing upright).
      if (u.knock) {
        if (o.mode === 'ride' && u.dead) {
          // shot dead at the wheel: stay seated, slumped; car holds
          this.placeAtSeat(o);
          u.upper.rotation.x = 0.35;
        } else {
          updateKnock(person, dt);
        }
        if (u.dead) continue;
        if (u.knock) continue;
      }
      if (u.dead) continue;
      const door = car.userData.door;
      switch (o.mode) {
        case 'ride': {
          this.placeAtSeat(o);
          if (door) door.rotation.y *= Math.max(0, 1 - dt * 6);
          if (this.wanted >= 1 && carSpeed < 1.6 && distCar < 30 && playerSpeed < 9) {
            o.mode = 'exit';
            o.phaseT = 0;
            o.exitFrom.copy(person.position);
            poseStand(person);
          }
          break;
        }
        case 'exit': {
          o.phaseT += dt;
          const k = Math.min(1, o.phaseT / 0.4);
          _side.set(-1, 0, 0).applyEuler(car.rotation);
          _target.copy(car.position).addScaledVector(_side, 1.7);
          _target.y = 0;
          person.position.lerpVectors(o.exitFrom, _target, k);
          person.rotation.y = car.rotation.y;
          if (door) door.rotation.y = Math.sin(k * Math.PI * 0.5) * 1.0;
          if (k >= 1) { o.mode = 'heel'; o.phaseT = 0; }
          break;
        }
        case 'heel': {
          if (door) door.rotation.y *= Math.max(0, 1 - dt * 6);
          // recall: the action moved away — run back to the car
          if (distCar > 48 || playerSpeed > 9.5) {
            if (u.brawl) stopBrawl(person);
            o.mode = 'return'; o.returnTo = 'seat';
            break;
          }
          if (this.wanted >= 2 && this.fx && this.playerRef) {
            // step out to a firing anchor holding the 8-14 m band
            o.anchor.copy(person.position);
            const toP = _toP.set(playerPos.x - o.anchor.x, 0, playerPos.z - o.anchor.z);
            const dA = toP.length();
            if (dA > 0.01) {
              if (dA > 14) o.anchor.addScaledVector(toP.normalize(), Math.min(dA - 11, 7));
              else if (dA < 8) o.anchor.addScaledVector(toP.normalize(), -(8 - dA));
            }
            attachWeapon(person, 'pistol');
            o.mode = 'toAnchor';
            break;
          }
          // fists at wanted 1 (v6 behaviour): he holds his ground
          // by the car and only wades in when the player closes to
          // confrontation distance — v7's first pass started the
          // brawl at 11 m, so a cop 12 m away charged and landed
          // punches inside the v6 suite's no-gunfire window. 7 m
          // sits safely between the two suite geometries (officer
          // ~10.3-13.7 m off in the no-gunfire pin, ~3.3-6.7 m in
          // the brawl pin)
          if (this.wanted === 1 && onFoot && this.playerRef && !this.playerRef.userData.dead) {
            if (!u.brawl && distP < 7) {
              startBrawl(person, this.playerRef, () => {
                if (this.onPlayerShot) this.onPlayerShot(3 + this.rand() * 2);
              });
            }
            if (u.brawl) {
              if (distCar > 16) {
                stopBrawl(person);
                o.mode = 'return'; o.returnTo = 'door';
              } else {
                updateBrawl(person, dt, this.rand);
              }
              break;
            }
          } else if (u.brawl) stopBrawl(person);
          // stand at the driver-side door, face the player
          _side.set(-1, 0, 0).applyEuler(car.rotation);
          person.position.copy(car.position).addScaledVector(_side, 1.7);
          person.position.y = 0;
          person.rotation.y = Math.atan2(dx, dz);
          u.idle();
          break;
        }
        case 'toAnchor': {
          if (this.wanted < 2 || distP > 42) {
            detachWeapon(person);
            o.mode = 'return';
            o.returnTo = this.wanted < 2 ? 'seat' : 'door';
            break;
          }
          const ax = o.anchor.x - person.position.x;
          const az = o.anchor.z - person.position.z;
          const d = Math.hypot(ax, az);
          if (d < 0.3) { o.mode = 'fire'; break; }
          const sp = 4.6;
          person.position.x += (ax / d) * Math.min(d, sp * dt);
          person.position.z += (az / d) * Math.min(d, sp * dt);
          person.rotation.y = Math.atan2(ax, az);
          o.phase += dt * sp * 1.9;
          u.walk(o.phase, 0.5, 0.06);
          person.position.y = 0;   // walk() bobs y; officers stay grounded
          break;
        }
        case 'fire': {
          // abandon the stance if the player escapes or heat drops
          if (this.wanted < 2 || distP > 42) {
            detachWeapon(person);
            o.mode = 'return';
            o.returnTo = this.wanted < 2 ? 'seat' : 'door';
            break;
          }
          person.position.copy(o.anchor);
          person.rotation.y = Math.atan2(dx, dz);
          u.armR.rotation.x = -1.35;   // pistol aim pose
          u.armL.rotation.x = -0.4;
          u.legL.rotation.x *= 0.7; u.legR.rotation.x *= 0.7;
          // burst state machine (v6 ballistics, unchanged)
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
          break;
        }
        case 'return': {
          if (u.brawl) stopBrawl(person);
          _side.set(-1, 0, 0).applyEuler(car.rotation);
          _target.copy(car.position).addScaledVector(_side, 1.7);
          const ax = _target.x - person.position.x;
          const az = _target.z - person.position.z;
          const d = Math.hypot(ax, az);
          if (d < 0.35) {
            if (o.returnTo === 'seat') {
              o.mode = 'enter';
              o.phaseT = 0;
              o.exitFrom.copy(person.position);
            } else {
              o.mode = 'heel';
            }
            break;
          }
          const sp = 6.5;
          person.position.x += (ax / d) * Math.min(d, sp * dt);
          person.position.z += (az / d) * Math.min(d, sp * dt);
          person.rotation.y = Math.atan2(ax, az);
          o.phase += dt * sp * 1.9;
          u.walk(o.phase, 0.62, 0.12);
          person.position.y = 0;
          break;
        }
        case 'enter': {
          o.phaseT += dt;
          const k = Math.min(1, o.phaseT / 0.35);
          _side.set(-0.42, -0.25, 0.05).applyEuler(car.rotation);
          _target.copy(car.position).add(_side);
          person.position.lerpVectors(o.exitFrom, _target, k);
          person.rotation.y = car.rotation.y;
          if (door) door.rotation.y = Math.sin(k * Math.PI * 0.5) * 1.0;
          if (k >= 1) {
            o.mode = 'ride';
            poseSeated(person);
            if (door) door.rotation.y = 0;
          }
          break;
        }
        default: {
          o.mode = 'ride';
          this.placeAtSeat(o);
          poseSeated(person);
        }
      }
    }
    return this.bust >= 100;
  }
  clear() {
    this.wanted = 0; this.heat = 0; this.bust = 0;
    this.nearestDist = Infinity;
    this.retireHeli();
    for (const c of this.cars) this.group.remove(c);
    this.cars = [];
    for (const o of this.officers) this.scene.remove(o.person);
    this.officers = [];
  }
}
