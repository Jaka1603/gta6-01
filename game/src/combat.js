// PALMBAY HEAT — combat.js: melee + shooting (raycast, muzzle flash,
// health), NPC reactions.
const THREE = window.THREE;
import { CFG, clamp } from './config.js';

export class Combat {
  constructor(scene, audio) {
    this.scene = scene;
    this.audio = audio;
    this.weapon = 'fists';   // fists | pistol
    this.ammo = 12;
    this.cooldown = 0;
    this.flash = null;
    this.flashT = 0;
    this.raycaster = new THREE.Raycaster();
  }
  setWeapon(w) {
    this.weapon = w;
    if (w === 'pistol' && this.ammo <= 0) this.ammo = 12;
  }
  update(dt) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.flash) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.scene.remove(this.flash);
        this.flash = null;
      }
    }
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
    this.muzzleFlash(camera);
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hits = this.raycaster.intersectObjects(targets, true);
    if (hits.length > 0) {
      let obj = hits[0].object;
      while (obj.parent && !obj.userData.isPerson && obj.parent !== this.scene) {
        obj = obj.parent;
      }
      if (onHit) onHit(obj, hits[0].point);
      return 'hit';
    }
    return 'miss';
  }
  muzzleFlash(camera) {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe9a0 })
    );
    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    flash.position.copy(camera.position).addScaledVector(dir, 1.2);
    flash.position.y -= 0.25;
    this.scene.add(flash);
    this.flash = flash;
    this.flashT = 0.06;
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
