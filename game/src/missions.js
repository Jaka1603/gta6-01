// PALMBAY HEAT — missions.js: 5-mission story chain for Mama Rosa.
// Checkpoint pillars, objective banner, timer, cash rewards.
const THREE = window.THREE;
import { CFG } from './config.js';
import { roadCoord } from './world.js';

export const MISSION_DEFS = [
  {
    id: 1, name: 'PICKUP AT THE PIER',
    brief: 'Mama Rosa needs a package from the Sunset Pier. Drive to the marker.',
    target: [-180, 60], time: 0, reward: CFG.missionReward[0],
    text: 'Ambil paket di Sunset Pier.',
  },
  {
    id: 2, name: 'THE CHASE',
    brief: 'A rival crew took the package. Chase the blue sedan and ram it 3 times!',
    target: [120, -120], time: 0, reward: CFG.missionReward[1],
    chase: true, text: 'Kejar sedan biru itu!',
  },
  {
    id: 3, name: 'HOT DELIVERY',
    brief: 'Deliver the package to Palm Bay Motors before the timer runs out.',
    target: [90, -30], time: 75, reward: CFG.missionReward[2],
    text: 'Antar paket tepat waktu!',
  },
  {
    id: 4, name: 'HEAT ESCAPE',
    brief: 'The cops are on you — 3 stars. Lose the heat: stay out of sight until the meter cools.',
    target: [0, 0], time: 0, reward: CFG.missionReward[3],
    escape: true, text: 'Kabur dari polisi!',
  },
  {
    id: 5, name: 'THE FINALE',
    brief: 'Final job: bring the cash to Mama Rosa at the diner. No mistakes.',
    target: [30, 30], time: 90, reward: CFG.missionReward[4],
    text: 'Bawa uangnya ke Mama Rosa.',
  },
];

export class Missions {
  constructor(scene) {
    this.scene = scene;
    this.index = 0;            // 0-based into MISSION_DEFS
    this.active = false;
    this.timer = 0;
    this.marker = null;
    this.markerLight = null;
    this.chaseCar = null;
    this.chaseHits = 0;
    this.done = false;
    this.onEvent = null;       // (type, payload) -> hud/audio hooks
  }
  get current() { return MISSION_DEFS[this.index] || null; }
  get started() { return this.active; }

  start(index = 0) {
    this.index = index;
    this.active = true;
    this.done = false;
    this.chaseHits = 0;
    const def = this.current;
    this.timer = def.time || 0;
    this.placeMarker(def.target[0], def.target[1]);
    this.emit('start', def);
    return def;
  }

  placeMarker(x, z) {
    this.clearMarker();
    const g = new THREE.Group();
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.2, 26, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd23f, transparent: true, opacity: 0.35,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    pillar.position.y = 13;
    g.add(pillar);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.6, 0.25, 8, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23f })
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.3;
    g.add(ring);
    const light = new THREE.PointLight(0xffd23f, 1.2, 30);
    light.position.y = 6;
    g.add(light);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.marker = g;
    this.markerLight = light;
  }
  clearMarker() {
    if (this.marker) {
      this.scene.remove(this.marker);
      this.marker = null;
    }
  }

  update(dt, playerPos, playerInCar) {
    if (!this.active || this.done) return null;
    const def = this.current;
    if (def.time > 0) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.fail('Waktu habis! Misi gagal.');
        return 'failed';
      }
    }
    // marker pulse
    if (this.marker) {
      const s = 1 + Math.sin(performance.now() * 0.004) * 0.12;
      this.marker.scale.set(s, 1, s);
    }
    // escape mission: complete when wanted drops to 0
    if (def.escape) return null; // main checks wanted
    const dx = playerPos.x - def.target[0];
    const dz = playerPos.z - def.target[1];
    if (Math.hypot(dx, dz) < 6) {
      return this.complete();
    }
    return null;
  }

  complete() {
    const def = this.current;
    this.done = true;
    this.active = false;
    this.clearMarker();
    this.emit('complete', def);
    return 'complete';
  }
  fail(reason) {
    this.active = false;
    this.done = false;
    this.clearMarker();
    this.emit('fail', { reason, def: this.current });
  }
  next() {
    if (this.index + 1 >= MISSION_DEFS.length) {
      this.emit('allDone', null);
      return null;
    }
    return this.start(this.index + 1);
  }
  emit(type, payload) {
    if (this.onEvent) this.onEvent(type, payload);
  }
  // chase target handling (mission 2): called by main when ramming
  registerChaseHit() {
    this.chaseHits += 1;
    this.emit('chaseHit', { hits: this.chaseHits, need: 3 });
    if (this.chaseHits >= 3) return this.complete();
    return null;
  }
  reset() {
    this.index = 0; this.active = false; this.done = false;
    this.timer = 0; this.chaseHits = 0;
    this.clearMarker();
  }
}
