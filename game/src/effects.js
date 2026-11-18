// PALMBAY HEAT — effects.js (v3): pooled visual effects. Everything is
// allocated once at load and reused — no `new` inside the frame loop.
// Glow sprites (headlights, lamps, muzzle flash), impact sparks (one
// THREE.Points pool), smoke / exhaust puffs (sprite pool).
// v3 audit: Smoke.puff's scale argument was silently discarded by
// update() — the starting scale is now kept per slot.
const THREE = window.THREE;
import { glowTexture } from './textures.js';

let GLOW = null;
export function initEffects() {
  if (!GLOW) GLOW = glowTexture();
  return GLOW;
}

export function glowSprite(color, scale, opacity = 1) {
  initEffects();
  const s = new THREE.Sprite(new THREE.SpriteMaterial({
    map: GLOW,
    color,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    opacity,
  }));
  s.scale.setScalar(scale);
  return s;
}

// --- muzzle flash: orange glow sprite + star plane, shown ~45 ms ---
export class MuzzleFlash {
  constructor(scene) {
    this.scene = scene;
    this.sprite = glowSprite(0xffa040, 0.9);
    this.sprite.visible = false;
    this.star = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.7),
      new THREE.MeshBasicMaterial({
        color: 0xffc860,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        transparent: true,
        side: THREE.DoubleSide,
      })
    );
    this.star.visible = false;
    this.light = new THREE.PointLight(0xffa040, 0, 9);
    scene.add(this.sprite, this.star, this.light);
    this.t = 0;
  }
  fire(pos, dir) {
    this.sprite.position.copy(pos);
    this.sprite.visible = true;
    this.sprite.material.rotation = Math.random() * Math.PI;
    const s = 0.8 + Math.random() * 0.5;
    this.sprite.scale.setScalar(s);
    this.star.position.copy(pos);
    this.star.lookAt(pos.clone().add(dir));
    this.star.rotation.z = Math.random() * Math.PI;
    this.star.visible = true;
    this.light.position.copy(pos);
    this.light.intensity = 8;
    this.t = 0.05;
  }
  update(dt) {
    if (this.t <= 0) return;
    this.t -= dt;
    if (this.t <= 0) {
      this.sprite.visible = false;
      this.star.visible = false;
      this.light.intensity = 0;
    }
  }
}

// --- impact sparks: one Points pool, 300 particles ---
export class Sparks {
  constructor(scene, count = 300) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    for (let i = 0; i < count; i++) this.pos[i * 3 + 1] = -999;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.09,
      map: initEffects(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      color: 0xffcc66,
      transparent: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.cursor = 0;
  }
  burst(p, n = 12) {
    for (let k = 0; k < n; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.count;
      this.pos[i * 3] = p.x;
      this.pos[i * 3 + 1] = p.y;
      this.pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 5;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = 1.5 + Math.random() * 3.5;
      this.vel[i * 3 + 2] = Math.sin(a) * sp;
      this.life[i] = 0.35;
    }
  }
  update(dt) {
    let any = false;
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.vel[i * 3 + 1] -= 5.9 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
    }
    if (any) this.points.geometry.attributes.position.needsUpdate = true;
  }
}

// --- smoke / exhaust puffs: sprite pool, fade + rise + grow ---
export class Smoke {
  constructor(scene, count = 24) {
    this.scene = scene;
    this.pool = [];
    for (let i = 0; i < count; i++) {
      const m = new THREE.SpriteMaterial({
        map: initEffects(),
        color: 0x9a9a9a,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      const s = new THREE.Sprite(m);
      s.visible = false;
      scene.add(s);
      this.pool.push({ s, life: 0, max: 0.8, scale0: 0.3 });
    }
    this.cursor = 0;
  }
  puff(p, scale = 0.3, color = 0x9a9a9a) {
    const slot = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    slot.s.position.copy(p);
    slot.s.material.color.setHex(color);
    slot.s.scale.setScalar(scale);
    slot.scale0 = scale;
    slot.s.visible = true;
    slot.life = slot.max;
  }
  update(dt) {
    for (const slot of this.pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.s.visible = false;
        slot.s.material.opacity = 0;
        continue;
      }
      const k = 1 - slot.life / slot.max;
      slot.s.position.y += dt * 0.6;
      slot.s.scale.setScalar(slot.scale0 + k * 0.5);
      slot.s.material.opacity = 0.28 * (1 - k);
    }
  }
}
