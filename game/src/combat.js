// PALMBAY HEAT — combat.js (v2): melee + shooting (raycast, pooled
// muzzle flash, impact sparks, smoke), NPC reactions. The pistol is a
// real mesh in the player's right hand; firing shows a glow flash, a
// star burst and a point-light spike, and impacts throw pooled sparks.
const THREE = window.THREE;
import { CFG, clamp } from './config.js';
import { MuzzleFlash, Sparks, Smoke } from './effects.js';
import { attachWeapon, detachWeapon } from './people.js';

export class Combat {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.weapon = 'fists';   // fists | pistol
    this.ammo = 12;
    this.cooldown = 0;
    this.player = null;
    this.raycaster = new THREE.Raycaster();
    this.flash = new MuzzleFlash(scene);
    this.sparks = new Sparks(scene);
    this.smoke = new Smoke(scene);
    this._tmp = new THREE.Vector3();
  }
  setPlayer(player) {
    this.player = player;
  }
  setWeapon(w) {
    this.weapon = w;
    if (w === 'pistol' && this.ammo <= 0) this.ammo = 12;
    if (!this.player) return;
    if (w === 'pistol') {
      attachWeapon(this.player, 'pistol');
      // aim pose: right arm raised forward
      this.player.userData.armR.rotation.x = -1.35;
    } else {
      detachWeapon(this.player);
      this.player.userData.armR.rotation.x = 0;
    }
  }
  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.flash.update(dt);
    this.sparks.update(dt);
    this.smoke.update(dt);
  }
  // melee swing: hits peds within 2.2m in front
  melee(playerPos, heading, peds, onHit) {
    if (this.cooldown > 0) return false;
    this.cooldown = 0.45;
    this.audio.play('punch');
    let hitAny = false;
    for (const p of peds) {
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
  // shoot: raycast from camera through crosshair centre
  shoot(camera, targets, onHit) {
    if (this.weapon !== 'pistol') return 'fists';
    if (this.cooldown > 0) return 'cooldown';
    if (this.ammo <= 0) {
      this.audio.play('dryfire');
      return 'empty';
    }
    this.cooldown = 0.28;
    this.ammo -= 1;
    this.audio.play('shot');
    // muzzle flash at the barrel tip (player's gun, or camera fallback)
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const tip = this._tmp.copy(camera.position).addScaledVector(dir, 1.2);
    tip.y -= 0.25;
    this.flash.fire(tip, dir);
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj.parent && !obj.userData.isPerson && obj.parent !== this.scene) {
        obj = obj.parent;
      }
      // impact: sparks + a wisp of smoke at the hit point
      this.sparks.burst(hits[0].point, 14);
      this.smoke.puff(hits[0].point, 0.35, 0xbbbbbb);
      if (onHit) onHit(obj, hits[0].point);
      return 'hit';
    }
    return 'miss';
  }
}

// simple player health model
export class Health {
  constructor(max = CFG.playerHealth) {
    this.max = max;
    this.hp = max;
  }
  damage(n) {
    this.hp = clamp(this.hp - n, 0, this.max);
    return this.hp <= 0;
  }
  heal(n) { this.hp = clamp(this.hp + n, 0, this.max); }
  get dead() { return this.hp <= 0; }
  get pct() { return this.hp / this.max; }
}
