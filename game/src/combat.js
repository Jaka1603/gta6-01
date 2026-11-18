// PALMBAY HEAT — combat.js (v6): the full weapon system (brief E+L).
// Six weapons with distinct stats — fists, pistol, heavy pistol,
// SMG, shotgun, rifle — an owned-set with per-weapon magazines and
// reserves, and TWO aim modes:
//   AUTO   — lock-on assist: firing snaps to the nearest hostile
//            whose perpendicular distance to the shot ray is within
//            the owner's 1 m tolerance, inside range + line-of-sight.
//            A red lock ring rides the target; the lock drops after
//            0.3 s out of tolerance / line-of-sight.
//   MANUAL — shots go exactly where the crosshair points (camera
//            centre), with at most 2 degrees of magnetism.
// Melee now deals real damage (brief M): stagger, knockdown, death
// are applied by main via hurtPerson. NPC return fire (police, gang)
// shares fireNPC so every bullet in the game draws a tracer.
const THREE = window.THREE;
import { CFG, clamp, gameRand } from './config.js';
import { MuzzleFlash, Sparks, Smoke, Tracers } from './effects.js';
import { attachWeapon, detachWeapon } from './people.js';

export const WEAPONS = {
  fists:   { name: 'FISTS',        dmg: 14, cd: 0.45, range: 2.4,  pellets: 0, spread: 0,    mag: 0,  reserve: 0,   auto: false },
  pistol:  { name: 'PISTOL',       dmg: 34, cd: 0.28, range: 120, pellets: 1, spread: 0.004, mag: 12, reserve: 96,  auto: false },
  heavy:   { name: 'HEAVY PISTOL', dmg: 68, cd: 0.52, range: 130, pellets: 1, spread: 0.003, mag: 7,  reserve: 42,  auto: false },
  smg:     { name: 'SMG',          dmg: 16, cd: 0.095, range: 90, pellets: 1, spread: 0.02, mag: 30, reserve: 180, auto: true },
  shotgun: { name: 'SHOTGUN',      dmg: 11, cd: 0.85, range: 38,  pellets: 7, spread: 0.075, mag: 6,  reserve: 36,  auto: false },
  rifle:   { name: 'RIFLE',        dmg: 46, cd: 0.16, range: 170, pellets: 1, spread: 0.006, mag: 24, reserve: 120, auto: true },
};
export const WEAPON_ORDER = ['fists', 'pistol', 'heavy', 'smg', 'shotgun', 'rifle'];

export class Combat {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.weapon = 'fists';
    this.owned = new Set(['fists', 'pistol']);
    this.mags = {};       // rounds in the magazine, per weapon
    this.reserves = {};   // spare rounds, per weapon
    for (const k of WEAPON_ORDER) {
      this.mags[k] = WEAPONS[k].mag;
      this.reserves[k] = WEAPONS[k].reserve;
    }
    this.ammo = 0;        // mirror of the current magazine (HUD/tests)
    this.cooldown = 0;
    this.player = null;
    this.aimMode = 'manual';   // 'auto' | 'manual' — main sets default
    this.lockTarget = null;    // figure group locked by AUTO aim
    this.lockLostT = 0;
    this.hostiles = [];        // figures AUTO may lock / magnetism bends to
    this.occluders = [];       // building meshes for line-of-sight rays
    this.raycaster = new THREE.Raycaster();
    this.flash = new MuzzleFlash(scene);
    this.sparks = new Sparks(scene);
    this.smoke = new Smoke(scene);
    this.tracers = new Tracers(scene);
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this._ray = new THREE.Ray();
    this._lockT = 0;
    // v7 hot-loop discipline: pooled shot vectors (no per-shot new)
    this._tip = new THREE.Vector3();
    this._baseDir = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._hitPoint = new THREE.Vector3();
    this._end = new THREE.Vector3();
    this._npcPoint = new THREE.Vector3();
    this._npcDir = new THREE.Vector3();
    this._muzzle = { tip: this._tip, dir: this._baseDir };
    // lock indicator: a red glow + ring that rides the locked target
    this.lockFx = new THREE.Group();
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.55, 0.045, 8, 24),
      new THREE.MeshBasicMaterial({
        color: 0xff3838, transparent: true, opacity: 0.9,
        depthWrite: false,
      })
    );
    ring.rotation.x = Math.PI / 2;
    this.lockFx.add(ring);
    this.lockFx.visible = false;
    scene.add(this.lockFx);
  }
  get stats() { return WEAPONS[this.weapon]; }
  setPlayer(player) { this.player = player; }
  setWeapon(w) {
    if (!this.owned.has(w)) return false;
    this.weapon = w;
    this.ammo = this.mags[w];
    if (!this.player) return true;
    if (w === 'fists') {
      detachWeapon(this.player);
      this.player.userData.armR.rotation.x = 0;
    } else {
      attachWeapon(this.player, w);
      // aim pose: right arm raised forward
      this.player.userData.armR.rotation.x = -1.35;
    }
    return true;
  }
  cycleWeapon(dir = 1) {
    const ownedList = WEAPON_ORDER.filter((k) => this.owned.has(k));
    let i = ownedList.indexOf(this.weapon);
    i = (i + dir + ownedList.length) % ownedList.length;
    return this.setWeapon(ownedList[i]);
  }
  // grant a weapon (pickup): owned + a loaded magazine + reserve
  giveWeapon(kind) {
    const fresh = !this.owned.has(kind);
    this.owned.add(kind);
    this.mags[kind] = WEAPONS[kind].mag;
    this.reserves[kind] += WEAPONS[kind].reserve;
    if (this.weapon === kind) this.ammo = this.mags[kind];
    return fresh;
  }
  reload() {
    const st = this.stats;
    if (this.weapon === 'fists' || this.mags[this.weapon] >= st.mag) return false;
    const need = st.mag - this.mags[this.weapon];
    const take = Math.min(need, this.reserves[this.weapon]);
    if (take <= 0) return false;
    this.mags[this.weapon] += take;
    this.reserves[this.weapon] -= take;
    this.ammo = this.mags[this.weapon];
    return true;
  }
  toggleAimMode() {
    this.aimMode = this.aimMode === 'auto' ? 'manual' : 'auto';
    if (this.aimMode === 'manual') this.lockTarget = null;
    return this.aimMode;
  }
  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flash.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
    this.tracers.update(dt);
    // lock indicator rides its target (and pulses)
    if (this.lockTarget && !this.lockTarget.userData.dead) {
      const p = this.lockTarget.position;
      this.lockFx.position.set(p.x, 2.15 + Math.sin(performance.now() * 0.008) * 0.07, p.z);
      this.lockFx.visible = true;
    } else {
      this.lockFx.visible = false;
    }
  }
  // --- AUTO lock-on -------------------------------------------------
  // A hostile is lockable when its perpendicular distance to the
  // camera ray is <= 1 m (owner spec), its range along the ray is
  // inside weapon range, and no building blocks the line of sight.
  // The aim ray: camera forward, flattened, then re-aimed at the
  // point 12 m ahead of the PLAYER at chest height. The follow
  // camera pitches down at the player (3 m up, 6.5 m back), so a
  // raw centre ray dives into the dirt before it reaches a
  // standing target — shots whiffed and the lock tolerance missed
  // by ~0.1 m at conversational range. TPS convergence fixes the
  // whole class: lock checks, magnetism and manual shots all
  // measure along this ray.
  _aimDir(camera, out) {
    out.set(0, 0, -1).applyQuaternion(camera.quaternion);
    out.y = 0;
    if (out.lengthSq() < 0.01) out.set(0, 0, -1);
    else out.normalize();
    if (this.player) {
      this._tmp.copy(this.player.position);
      this._tmp.y += 1.15;
      this._tmp.addScaledVector(out, 12);
      out.copy(this._tmp).sub(camera.position).normalize();
    }
    return out;
  }
  _perpCandidate(camera, fig, range) {
    const u = fig.userData;
    if (u.dead || u.knock) return null;
    const dir = this._aimDir(camera, this._tmp2);
    this._tmp.copy(fig.position);
    this._tmp.y += 1.1;                       // chest height
    const origin = camera.position;
    const vx = this._tmp.x - origin.x, vy = this._tmp.y - origin.y, vz = this._tmp.z - origin.z;
    const t = vx * dir.x + vy * dir.y + vz * dir.z;
    if (t < 1 || t > range) return null;
    const px = origin.x + dir.x * t, py = origin.y + dir.y * t, pz = origin.z + dir.z * t;
    const perp = Math.hypot(this._tmp.x - px, this._tmp.y - py, this._tmp.z - pz);
    if (perp > 1.0) return null;
    return { fig, t, perp };
  }
  _hasLoS(from, to) {
    if (!this.occluders.length) return true;
    const dir = this._tmp.subVectors(to, from);
    const dist = dir.length();
    if (dist < 0.5) return true;
    this.raycaster.set(from, dir.normalize());
    this.raycaster.far = dist - 0.4;
    const hits = this.raycaster.intersectObjects(this.occluders, false);
    this.raycaster.far = 1000;
    return hits.length === 0;
  }
  // Called by main every frame while playing (cheap: throttled
  // re-acquire, per-frame tolerance check on the current lock).
  updateLock(camera, dt) {
    if (this.aimMode !== 'auto' || this.weapon === 'fists') {
      this.lockTarget = null;
      return;
    }
    const range = this.stats.range;
    // current lock still valid?
    if (this.lockTarget) {
      const c = this._perpCandidate(camera, this.lockTarget, range);
      const chest = this._tmp2.copy(this.lockTarget.position); chest.y += 1.1;
      if (c && this._hasLoS(camera.position, chest)) {
        this.lockLostT = 0;
      } else {
        this.lockLostT += dt;
        if (this.lockLostT > 0.3) this.lockTarget = null;
      }
    }
    // (re)acquire at ~12 Hz: nearest valid hostile along the ray
    this._lockT -= dt;
    if (!this.lockTarget && this._lockT <= 0) {
      this._lockT = 0.08;
      let best = null;
      for (const fig of this.hostiles) {
        const c = this._perpCandidate(camera, fig, range);
        if (c && (!best || c.t < best.t)) best = c;
      }
      if (best) {
        const chest = this._tmp.copy(best.fig.position); chest.y += 1.1;
        if (this._hasLoS(camera.position, chest)) {
          this.lockTarget = best.fig;
          this.lockLostT = 0;
        }
      }
    }
  }
  // melee swing: hits peds within 2.4m in front (brief M: damage is
  // applied by main's onHit via hurtPerson)
  melee(playerPos, heading, peds, onHit) {
    if (this.cooldown > 0) return false;
    this.cooldown = WEAPONS.fists.cd;
    this.audio.play('punch');
    let hitAny = false;
    for (const p of peds) {
      if (p.userData.dead) continue;
      const dx = p.position.x - playerPos.x;
      const dz = p.position.z - playerPos.z;
      const d = Math.hypot(dx, dz);
      if (d > 2.4) continue;
      const ang = Math.atan2(dx, dz);
      let diff = ang - heading;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 1.1) {
        hitAny = true;
        if (onHit) onHit(p);
      }
    }
    return hitAny;
  }
  _muzzleTip(camera) {
    // pooled (v7): writes the shared tip/dir — callers consume them
    // immediately (flash/tracers copy what they need). The flash
    // direction is the converged aim ray, so the muzzle reads as
    // pointing where the shot actually goes.
    this._aimDir(camera, this._baseDir);
    this._tip.copy(camera.position).addScaledVector(this._baseDir, 1.2);
    this._tip.y -= 0.25;
    return this._muzzle;
  }
  // shoot: behaviour depends on the weapon + aim mode.
  // onHit(obj, point, stats) — obj is a person group, the chase car,
  // or whatever the ray struck (city geometry included).
  shoot(camera, targets, onHit) {
    if (this.weapon === 'fists') return 'fists';
    if (this.cooldown > 0) return 'cooldown';
    const st = this.stats;
    if (this.mags[this.weapon] <= 0) {
      this.audio.play('dryfire');
      return 'empty';
    }
    this.cooldown = st.cd;
    this.mags[this.weapon] -= 1;
    this.ammo = this.mags[this.weapon];
    this.audio.play('shot');
    const { tip, dir } = this._muzzleTip(camera);
    this.flash.fire(tip, dir);
    // AUTO with a live lock: the shot snaps to the locked hostile
    if (this.aimMode === 'auto' && this.lockTarget && !this.lockTarget.userData.dead) {
      const fig = this.lockTarget;
      const point = this._hitPoint.set(fig.position.x, fig.position.y + 1.05, fig.position.z);
      this.tracers.fire(tip, point);
      this.sparks.burst(point, 12);
      if (onHit) onHit(fig, point, st);
      return 'hit';
    }
    // MANUAL (or AUTO with no lock): ray(s) from the crosshair.
    // Magnetism: a hostile within 2 degrees of the ray and closer
    // than any wall hit still takes the bullet.
    // v6 audit: raycaster.camera MUST be set — target groups
    // contain glow Sprites, and THREE.Sprite.raycast reads
    // raycaster.camera.matrixWorld; without it every shot threw
    // a TypeError mid-traversal and hits silently never landed.
    this.raycaster.camera = camera;
    let anyHit = false;
    for (let p = 0; p < st.pellets; p++) {
      const d = this._dir.copy(dir);
      if (st.spread > 0) {
        d.x += (gameRand() - 0.5) * 2 * st.spread;
        d.y += (gameRand() - 0.5) * 2 * st.spread;
        d.z += (gameRand() - 0.5) * 2 * st.spread;
        d.normalize();
      }
      this.raycaster.set(camera.position, d);
      this.raycaster.far = st.range;
      const hits = this.raycaster.intersectObjects(targets, true);
      let hitObj = null, hitPoint = null, hitDist = Infinity;
      if (hits.length > 0) {
        hitDist = hits[0].distance;
        hitPoint = hits[0].point;
        let obj = hits[0].object;
        while (obj.parent && !obj.userData.isPerson && !obj.userData.style && obj.parent !== this.scene) {
          obj = obj.parent;
        }
        hitObj = obj;
      }
      // 2-degree magnetism toward a hostile figure
      const magRad = Math.tan(2 * Math.PI / 180);
      for (const fig of this.hostiles) {
        if (fig.userData.dead || fig.userData.knock) continue;
        const c = this._perpCandidate(camera, fig, st.range);
        if (c && c.perp <= Math.max(0.35, c.t * magRad) && c.t < hitDist) {
          hitObj = fig;
          hitPoint = this._hitPoint.set(fig.position.x, fig.position.y + 1.05, fig.position.z);
          hitDist = c.t;
          break;
        }
      }
      if (hitPoint) {
        anyHit = true;
        this.tracers.fire(tip, hitPoint, 0xffe9b0);
        this.sparks.burst(hitPoint, p === 0 ? 12 : 4);
        if (p === 0) this.smoke.puff(hitPoint, 0.3, 0xbbbbbb);
        if (onHit) onHit(hitObj, hitPoint, st);
      } else {
        // tracer to the ray's end so a miss still reads
        const end = this._end.copy(camera.position).addScaledVector(d, Math.min(st.range, 60));
        this.tracers.fire(tip, end, 0xd8c9a0);
      }
    }
    this.raycaster.far = 1000;
    return anyHit ? 'hit' : 'miss';
  }
  // NPC return fire (police / gang): a bursty shot from `from`
  // toward `targetPos` with a hit roll driven by accuracy (0..1)
  // and distance. Draws the tracer + muzzle flash; the caller
  // applies damage when hit is true.
  fireNPC(from, targetPos, accuracy = 0.5) {
    const dist = from.distanceTo(targetPos);
    const pHit = clamp(accuracy - dist * 0.006, 0.08, 0.85);
    const hit = gameRand() < pHit;
    const point = this._npcPoint.copy(targetPos);
    if (!hit) {
      // near miss: crack past the target, offset by up to ~1.2 m
      point.x += (gameRand() - 0.5) * 2.4;
      point.y += gameRand() * 0.8 - 0.2;
      point.z += (gameRand() - 0.5) * 2.4;
    }
    const dir = this._npcDir.copy(point).sub(from).normalize();
    this.flash.fire(from, dir);
    this.tracers.fire(from, point, 0xffb060);
    if (hit) this.sparks.burst(point, 6);
    return { hit, point, dist };
  }
}

// simple player health model
export class Health {
  constructor(max = CFG.playerHealth) {
    this.max = max;
    this.hp = max;
  }
  damage(n) {
    if (!Number.isFinite(n)) return this.hp <= 0;   // v8: NaN guard at the boundary
    this.hp = clamp(this.hp - n, 0, this.max);
    return this.hp <= 0;
  }
  heal(n) { if (Number.isFinite(n)) this.hp = clamp(this.hp + n, 0, this.max); }
  get dead() { return this.hp <= 0; }
  get pct() { return this.hp / this.max; }
}
