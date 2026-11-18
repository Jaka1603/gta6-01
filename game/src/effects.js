// PALMBAY HEAT — effects.js (v3): pooled visual effects. Everything is
// allocated once at load and reused — no `new` inside the frame loop.
// Glow sprites (headlights, lamps, muzzle flash), impact sparks (one
// THREE.Points pool), smoke / exhaust puffs (sprite pool).
// v3 audit: Smoke.puff's scale argument was silently discarded by
// update() — the starting scale is now kept per slot.
const THREE = window.THREE;
import { glowTexture } from './textures.js';
import { gameRand } from './config.js';

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
    this.sprite.material.rotation = gameRand() * Math.PI;
    const s = 0.8 + gameRand() * 0.5;
    this.sprite.scale.setScalar(s);
    this.star.position.copy(pos);
    this.star.lookAt(pos.clone().add(dir));
    this.star.rotation.z = gameRand() * Math.PI;
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
      const a = gameRand() * Math.PI * 2;
      const sp = 2 + gameRand() * 5;
      this.vel[i * 3] = Math.cos(a) * sp;
      this.vel[i * 3 + 1] = 1.5 + gameRand() * 3.5;
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
  constructor(scene, count = 44) {
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

// --- v6 tracers: thin additive streaks from muzzle to impact ----
// A pooled set of stretched boxes; each shot lights one for ~55 ms.
// Used by police return fire, gang fire and the player's own shots
// so every bullet in the game is READABLE, not just heard.
export class Tracers {
  constructor(scene, count = 24) {
    this.pool = [];
    const geo = new THREE.BoxGeometry(0.035, 0.035, 1);
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: 0xffd9a0, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0,
      }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.pool.push({ m, life: 0 });
    }
    this.cursor = 0;
    this._mid = new THREE.Vector3();
    this._dir = new THREE.Vector3();
  }
  fire(from, to, color = 0xffd9a0) {
    const slot = this.pool[this.cursor];
    this.cursor = (this.cursor + 1) % this.pool.length;
    this._mid.addVectors(from, to).multiplyScalar(0.5);
    this._dir.subVectors(to, from);
    const len = this._dir.length();
    if (len < 0.1) return;
    slot.m.position.copy(this._mid);
    slot.m.scale.set(1, 1, len);
    slot.m.lookAt(to);
    slot.m.material.color.setHex(color);
    slot.m.material.opacity = 0.85;
    slot.m.visible = true;
    slot.life = 0.055;
  }
  update(dt) {
    for (const slot of this.pool) {
      if (slot.life <= 0) continue;
      slot.life -= dt;
      if (slot.life <= 0) {
        slot.m.visible = false;
        slot.m.material.opacity = 0;
      }
    }
  }
}

// --- v6 explosion: one pooled blast — flash sprite, point light,
// shockwave ring — scaled by the caller (car = 1, chain = 0.8) ---
export class Explosion {
  constructor(scene) {
    this.sprite = glowSprite(0xffc860, 1);
    this.sprite.visible = false;
    this.ring = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.14, 8, 28),
      new THREE.MeshBasicMaterial({
        color: 0xffa040, blending: THREE.AdditiveBlending,
        depthWrite: false, transparent: true, opacity: 0,
        side: THREE.DoubleSide,
      })
    );
    this.ring.rotation.x = Math.PI / 2;
    this.ring.visible = false;
    this.light = new THREE.PointLight(0xff9040, 0, 34);
    scene.add(this.sprite, this.ring, this.light);
    this.t = 0;
    this.dur = 0.55;
    this.scale = 1;
  }
  boom(pos, scale = 1) {
    this.scale = scale;
    this.sprite.position.copy(pos);
    this.sprite.position.y += 0.8;
    this.ring.position.copy(pos);
    this.ring.position.y = 0.4;
    this.light.position.copy(pos);
    this.light.position.y += 1.2;
    this.sprite.visible = true;
    this.ring.visible = true;
    this.t = this.dur;
  }
  update(dt) {
    if (this.t <= 0) return;
    this.t -= dt;
    const k = 1 - Math.max(0, this.t) / this.dur;   // 0 -> 1
    const s = (2 + k * 9) * this.scale;
    this.sprite.scale.setScalar(s);
    this.sprite.material.opacity = 0.95 * (1 - k);
    this.ring.scale.setScalar(0.5 + k * 5.5 * this.scale);
    this.ring.material.opacity = 0.7 * (1 - k);
    this.light.intensity = 60 * (1 - k) * this.scale;
    if (this.t <= 0) {
      this.sprite.visible = false;
      this.ring.visible = false;
      this.light.intensity = 0;
    }
  }
}

// --- v6 skid marks: ONE ring-buffer ribbon mesh ------------------
// Segments are quads written into preallocated position/colour
// buffers (600 segments max); the oldest are overwritten in place,
// so laying rubber costs zero allocation and one draw call. Alpha
// lives in the vertex colour (black on transparent material).
export class SkidMarks {
  constructor(scene, max = 600) {
    this.max = max;
    this.cursor = 0;
    this.pos = new Float32Array(max * 6 * 3);
    this.col = new Float32Array(max * 6 * 3);
    // park every quad far underground until written
    for (let i = 0; i < max * 6; i++) this.pos[i * 3 + 1] = -50;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.55,
      depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.geo = geo;
    this.dirty = false;
  }
  // one quad centred at (x, z), long axis along heading, dark 0..1
  add(x, z, heading, len = 0.9, width = 0.24, dark = 0.85) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const fx = Math.sin(heading), fz = Math.cos(heading);
    const rx = fz, rz = -fx;                 // right vector
    const hl = len / 2, hw = width / 2, y = 0.055;
    const corners = [
      [x - fx * hl - rx * hw, z - fz * hl - rz * hw],
      [x - fx * hl + rx * hw, z - fz * hl + rz * hw],
      [x + fx * hl + rx * hw, z + fz * hl + rz * hw],
      [x + fx * hl - rx * hw, z + fz * hl - rz * hw],
    ];
    const tris = [0, 1, 2, 0, 2, 3];
    const o = i * 18;
    const shade = (1 - dark) * 0.1;
    for (let v = 0; v < 6; v++) {
      const c = corners[tris[v]];
      this.pos[o + v * 3] = c[0];
      this.pos[o + v * 3 + 1] = y;
      this.pos[o + v * 3 + 2] = c[1];
      this.col[o + v * 3] = shade;
      this.col[o + v * 3 + 1] = shade;
      this.col[o + v * 3 + 2] = shade;
    }
    this.dirty = true;
  }
  update() {
    if (!this.dirty) return;
    this.dirty = false;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
