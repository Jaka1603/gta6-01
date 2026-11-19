// PALMBAY HEAT — missions.js (v8): 7-mission story chain for Mama
// Rosa. Checkpoint pillars, objective banner, timer, cash rewards.
// v8 (top-1 lesson): every mission is STAGED — 3-4 named stages with
// transitions, an objective counter (TABRAKAN 1/3, CHECKPOINT 2/4)
// and a NEXT teaser, so a mission reads as a journey instead of a
// single drive-to-dot. The FINAL completion trigger of each mission
// is unchanged from v7 (reach radius / 3 rams / follow-done /
// in-car delivery / heat gone) — stages are progression layered on
// top of the same triggers: distance bands for reach missions,
// waypoints for the tail, ram count for the chase, heat bands for
// the escape, car-boarding + distance for the delivery.
// v3 audit: chase missions can no longer be completed by simply
// driving to the target point — only the 3 rams count.
// v6 (brief N): two new mission types from the reference dissection —
// FOLLOW (tail the courier, stay in the band, don't lose them) and
// DELIVERY (package run that only counts while Dario is IN a car,
// anchored at a shop's front door). Mission 1's checkpoint moved to
// the beach bar's door (brief C) — world.js tells main where the
// bar stands, and main patches the target before the chain starts.
const THREE = window.THREE;
import { CFG } from './config.js';
import { roadCoord } from './world.js';

export const MISSION_DEFS = [
  {
    id: 1, name: 'PICKUP AT THE PIER',
    brief: 'Mama Rosa needs a package from the Sunset Pier. Drive to the marker.',
    // v6 (brief C): the checkpoint is the BEACH BAR's door on the
    // sand by the pier approach — reachable on foot and by car.
    // main patches this from worldInfo.beachBar.door at build time;
    // the fallback matches the built bar position.
    target: [-228.5, 60], time: 0, reward: CFG.missionReward[0],
    text: 'Ambil paket di Sunset Pier.',
    stages: ['Ke Beachfront — ikuti jalan pantai', 'Dekati Sunset Pier', 'Ambil paket di pintu Beach Bar'],
  },
  {
    id: 2, name: 'TAIL THE COURIER',
    brief: 'A courier is walking Mama Rosa\'s ledger across town. Follow him — stay close, but don\'t touch him.',
    target: [30, -90], time: 0, reward: CFG.missionReward[1],
    follow: true, text: 'Ikuti kurir itu — jangan sampai lepas!',
    stages: ['Temukan kurirnya', 'Ekor leg 2 — tetap di pita 4–32 m', 'Ekor leg 3 — jangan sampai lepas', 'Leg terakhir — kurir hampir sampai'],
  },
  {
    id: 3, name: 'THE CHASE',
    brief: 'A rival crew took the package. Chase the blue sedan and ram it 3 times!',
    target: [120, -120], time: 0, reward: CFG.missionReward[2],
    // v2: the chase runs through gang turf (green zone on the
  // minimap) — the rival crew's home ground.
  chase: true, text: 'Kejar sedan biru itu!', zone: 'GANG TURF',
    stages: ['Pepet sedan biru itu', 'Tabrak lagi — jangan kasih kabur', 'Satu tabrakan lagi!'],
  },
  {
    id: 4, name: 'HOT DELIVERY',
    brief: 'Deliver the package to Palm Bay Motors before the timer runs out.',
    target: [90, -30], time: 150, reward: CFG.missionReward[3],
    text: 'Antar paket tepat waktu!',
    stages: ['Keluar dari Beachfront', 'Setengah jalan — jaga tempo', 'Dekati Palm Bay Motors'],
  },
  {
    id: 5, name: 'SPECIAL DELIVERY',
    brief: 'A fragile crate for the diner. Drive it to Mama Rosa\'s front door — walking it over does not count.',
    // main patches this to the diner door (bx3,bz3) from
    // worldInfo.doors; the fallback is the diner block's kerb.
    target: [16, 16], time: 0, reward: CFG.missionReward[4],
    delivery: true, text: 'Antar krat ke pintu Mama Rosa — pakai mobil!',
    stages: ['Naik mobil dulu — kratnya berat', 'Bawa kratnya melintasi kota', 'Parkir di pintu Mama Rosa'],
  },
  {
    id: 6, name: 'HEAT ESCAPE',
    brief: 'The cops are on you — 3 stars. Lose the heat: stay out of sight until the meter cools.',
    target: [0, 0], time: 0, reward: CFG.missionReward[5],
    escape: true, text: 'Kabur dari polisi!',
    stages: ['Putus kontak — jauhi mereka', 'Tetap tak terlihat — heat menurun', 'Hampir bersih — tahan sebentar lagi'],
  },
  {
    id: 7, name: 'THE FINALE',
    brief: 'Final job: bring the cash to Mama Rosa at the diner. No mistakes.',
    target: [30, 30], time: 180, reward: CFG.missionReward[6],
    text: 'Bawa uangnya ke Mama Rosa.',
    stages: ['Bawa uangnya keluar distrik', 'Melintasi Downtown — tanpa kesalahan', 'Serahkan ke Mama Rosa'],
  },
];

export class Missions {
  constructor(scene) {
    this.scene = scene;
    this.defs = MISSION_DEFS;  // v6: exposed for tests + HUD counts
    this.index = 0;            // 0-based into MISSION_DEFS
    this.active = false;
    this.timer = 0;
    this.marker = null;
    this.markerLight = null;
    this.chaseCar = null;
    this.chaseHits = 0;
    this.done = false;
    this.onEvent = null;       // (type, payload) -> hud/audio hooks
    // v6 follow state: main drives the courier and reports here
    this.followPos = null;     // courier position (THREE.Vector3-ish)
    this.followDone = false;   // courier reached the last waypoint
    this.loseT = 0;            // seconds spent outside the follow band
    this.wpIndex = 0;          // courier waypoint reached (CHECKPOINT)
    // v7: start-of-mission grace — the timer and the follow loseT stay
    // frozen for the first seconds so the player can read the dialogue
    // card / get into a car; failure can only happen at true expiry.
    this.graceT = 0;
    this.loseWarned = false;
    // v8 stage state (see header): 1-based stage, its count, the
    // stage's objective line, an objective counter ("TABRAKAN 1/3")
    // and the NEXT teaser. heat is mirrored in by main each frame
    // (the escape mission's stages read heat bands).
    this.stage = 1;
    this.stageCount = 3;
    this.stageText = '';
    this.counterText = '';
    this.nextText = '';
    this.heat = 0;
    this.sawCar = false;   // delivery stage 1 ends when Dario drives
  }
  get current() { return MISSION_DEFS[this.index] || null; }
  get started() { return this.active; }

  start(index = 0) {
    this.index = index;
    this.active = true;
    this.done = false;
    this.chaseHits = 0;
    this.followPos = null;
    this.followDone = false;
    this.loseT = 0;
    this.wpIndex = 0;
    this.graceT = 4;
    this.loseWarned = false;
    this.sawCar = false;
    const def = this.current;
    this.stageCount = def.stages ? def.stages.length : 3;
    this.stage = 1;
    this.stageText = def.stages ? def.stages[0] : def.text;
    this.counterText = '';
    this.setNextText(def);
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
    // rotating beacon cone above the pillar (reads from far away)
    const beacon = new THREE.Mesh(
      new THREE.ConeGeometry(3.2, 9, 12, 1, true),
      new THREE.MeshBasicMaterial({
        color: 0xffd23f, transparent: true, opacity: 0.22,
        side: THREE.DoubleSide, depthWrite: false,
      })
    );
    beacon.position.y = 30;
    beacon.rotation.x = Math.PI;
    g.add(beacon);
    g.position.set(x, 0, z);
    this.scene.add(g);
    this.marker = g;
    this.markerLight = light;
    this.markerBeacon = beacon;
  }
  clearMarker() {
    if (this.marker) {
      this.scene.remove(this.marker);
      this.marker = null;
    }
  }

  // v8: the NEXT teaser — the following stage's objective, or on
  // the final stage the next mission's name (top-1's "NEXT: ...").
  setNextText(def) {
    if (def.stages && this.stage < this.stageCount) {
      this.nextText = def.stages[this.stage];
    } else {
      const nx = MISSION_DEFS[this.index + 1];
      this.nextText = nx ? ('MISI BERIKUTNYA: ' + nx.name) : 'AKHIR CERITA';
    }
  }
  // v8: derive the current stage from live state. Pure progression
  // — never a completion or fail trigger by itself.
  computeStage(playerPos, playerInCar) {
    const def = this.current;
    if (!def) return;
    let s = 1;
    this.counterText = '';
    if (def.follow) {
      s = Math.min(this.wpIndex + 1, this.stageCount);
      this.counterText = 'CHECKPOINT ' + Math.min(this.wpIndex, this.stageCount) + '/' + this.stageCount;
    } else if (def.chase) {
      s = Math.min(this.chaseHits + 1, this.stageCount);
      this.counterText = 'TABRAKAN ' + this.chaseHits + '/3';
    } else if (def.escape) {
      s = this.heat > 40 ? 1 : (this.heat > 15 ? 2 : 3);
      this.counterText = 'HEAT ' + Math.ceil(this.heat) + '%';
    } else if (def.delivery) {
      if (playerInCar) this.sawCar = true;
      if (!this.sawCar) s = 1;
      else {
        const d = Math.hypot(playerPos.x - def.target[0], playerPos.z - def.target[1]);
        s = d > 25 ? 2 : 3;
      }
      this.counterText = this.sawCar ? '' : 'BUTUH MOBIL';
    } else {
      const d = Math.hypot(playerPos.x - def.target[0], playerPos.z - def.target[1]);
      s = d > 90 ? 1 : (d > 30 ? 2 : 3);
    }
    if (s !== this.stage) {
      this.stage = s;
      this.stageText = def.stages ? (def.stages[s - 1] || def.text) : def.text;
      this.setNextText(def);
      this.emit('stage', { stage: s, stageCount: this.stageCount, text: this.stageText, def });
    }
  }

  update(dt, playerPos, playerInCar) {
    if (!this.active || this.done) return null;
    const def = this.current;
    this.computeStage(playerPos, playerInCar);
    // v7 grace: no timer drain, no follow-lose accumulation while the
    // grace window runs — failing "too fast" was Jaka's complaint.
    const inGrace = this.graceT > 0;
    if (inGrace) this.graceT = Math.max(0, this.graceT - dt);
    if (def.time > 0 && !inGrace) {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.fail('Waktu habis! Misi gagal.');
        return 'failed';
      }
    }
    // marker pulse + beacon spin
    if (this.marker) {
      const s = 1 + Math.sin(performance.now() * 0.004) * 0.12;
      this.marker.scale.set(s, 1, s);
      if (this.markerBeacon) {
        this.markerBeacon.rotation.y += dt * 1.5;
      }
    }
    // escape mission: complete when wanted drops to 0
    if (def.escape) return null; // main checks wanted
    // chase mission: completes ONLY via registerChaseHit rams — the
    // generic reach-the-target check below used to finish it for free
    // because the target point is the chase car's start position
    if (def.chase) return null;
    // v6 follow mission: main drives the courier; the player must
    // stay inside the follow band (4..32 m). v7: TEN seconds outside
    // the band loses the tail (was five — failed far too fast), the
    // recovery is 3x, the grace window freezes accumulation, and a
    // warning banner fires before the fail so it never feels sudden.
    if (def.follow) {
      if (this.followDone) return this.complete();
      if (this.followPos) {
        const d = Math.hypot(
          playerPos.x - this.followPos.x, playerPos.z - this.followPos.z);
        if (!inGrace) {
          if (d > 32 || d < 2.2) this.loseT += dt;
          else this.loseT = Math.max(0, this.loseT - dt * 3);
          if (this.loseT > 4 && !this.loseWarned) {
            this.loseWarned = true;
            this.emit('followwarn', def);
          }
          if (this.loseT <= 2) this.loseWarned = false;
          if (this.loseT > 10) {
            this.fail(d < 2.2 ? 'Terlalu dekat — kurirnya kabur!' : 'Kehilangan jejak kurir!');
            return 'failed';
          }
        }
      }
      return null;
    }
    const dx = playerPos.x - def.target[0];
    const dz = playerPos.z - def.target[1];
    if (Math.hypot(dx, dz) < 6) {
      // v6 delivery: the crate only counts delivered from a vehicle
      if (def.delivery && !playerInCar) return null;
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
    this.stage = 1; this.stageCount = 3; this.stageText = '';
    this.counterText = ''; this.nextText = ''; this.sawCar = false;
    this.followPos = null; this.followDone = false; this.loseT = 0;
    this.clearMarker();
  }
}
