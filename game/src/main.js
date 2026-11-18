// PALMBAY HEAT — main.js (v3): state machine, camera, controls,
// save/load, shot staging, game loop. SA-grade look: gradient sky dome
// with sun disc, horizon-matched fog, low warm sun with a shadow camera
// that follows the player, ACES tone mapping, living ambient systems.
// v3 audit fixes: real building collision for the player, the hero
// car, police and the chase target (v2 had none — everything passed
// through buildings); the HEAT ESCAPE mission now actually raises
// 3 stars (it used to complete instantly for free); the bust meter
// uses the player's real on-foot speed (it filled while sprinting
// away); stolen parked cars are restored on exit and lend their own
// top speed; start/continue resets police + in-car state; shooting
// raycasts against the city too (no more hits through buildings);
// traffic knows where the player is; the chase shot starts the chase
// mission it depicts.
const THREE = window.THREE;
import { CFG, PALETTE, SCALE, rng, clamp, lerp, TAU } from './config.js';
import { buildWorld, roadCoord, nearestRoadCoord, onRoad, worldInfo } from './world.js';
import { Traffic, spawnParked, heroCar, makeCar, setBrake } from './vehicles.js';
import { Pedestrians, heroPerson, attachWeapon } from './people.js';
import { Police } from './police.js';
import { Missions, MISSION_DEFS } from './missions.js';
import { Combat, Health } from './combat.js';
import { HUD } from './hud.js';
import { AudioSys } from './audio.js';
import { Flock, Clouds, DogFollower, CrossingCat } from './life.js';
import { stageGang, stageBusted } from './gang.js';

const SAVE_KEY = 'palmbay-heat-save-v1';
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot');           // chase | foot | mission | title | null
const SEED = parseInt(params.get('seed') || '1', 10) || 1;

const rand = rng(SEED * 7919 + 13);

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(SHOT ? 1 : Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = CFG.exposure;

const scene = new THREE.Scene();

// golden-hour sky dome: orange horizon -> teal top, sun disc + halo.
// The horizon colour MUST equal the fog colour — that melts the city
// into the sky instead of cutting it off.
const SUN_DIR = new THREE.Vector3(-0.75, 0.28, 0.30).normalize();
{
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(PALETTE.skyTop) },
      midColor: { value: new THREE.Color(PALETTE.skyMid) },
      horizonColor: { value: new THREE.Color(PALETTE.horizon) },
      sunDir: { value: SUN_DIR },
      sunColor: { value: new THREE.Color(PALETTE.sun) },
    },
    vertexShader: [
      'varying vec3 vDir;',
      'void main() {',
      '  vDir = normalize(position);',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform vec3 topColor, midColor, horizonColor, sunColor, sunDir;',
      'varying vec3 vDir;',
      'void main() {',
      '  float h = clamp(normalize(vDir).y, -0.05, 1.0);',
      '  vec3 col = mix(horizonColor, midColor, smoothstep(0.0, 0.18, h));',
      '  col = mix(col, topColor, smoothstep(0.12, 0.55, h));',
      '  float s = max(dot(normalize(vDir), normalize(sunDir)), 0.0);',
      '  col += sunColor * (pow(s, 350.0) * 1.6 + pow(s, 18.0) * 0.28);',
      '  gl_FragColor = vec4(col, 1.0);',
      '  #include <tonemapping_fragment>',
      '  #include <encodings_fragment>',
      '}',
    ].join('\n'),
  });
  var sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 15), skyMat);
  sky.frustumCulled = false;
  scene.add(sky);
}
scene.fog = new THREE.Fog(CFG.fog, CFG.fogNear, CFG.fogFar);

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1200);
camera.position.set(0, 40, 90);

// lights: one warm low sun (shadow-casting, follows the player) +
// hemisphere fill so shadow sides stay readable and teal-tinted.
const sun = new THREE.DirectionalLight(CFG.sunColor, CFG.sunIntensity);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SHADOW_S = 55;
Object.assign(sun.shadow.camera, {
  left: -SHADOW_S, right: SHADOW_S,
  top: SHADOW_S, bottom: -SHADOW_S,
  near: 1, far: 260,
});
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(CFG.hemiSky, CFG.hemiGround, CFG.hemiIntensity));
const _sv = new THREE.Vector3();
function updateSun(playerPos) {
  _sv.copy(playerPos).addScaledVector(SUN_DIR, 120);
  // snap to the shadow-texel grid so shadows don't shimmer while moving
  const texel = (SHADOW_S * 2) / 2048;
  _sv.x = Math.round(_sv.x / texel) * texel;
  _sv.z = Math.round(_sv.z / texel) * texel;
  sun.position.copy(_sv);
  sun.target.position.copy(playerPos);
  sun.target.updateMatrixWorld();
}

// ---------- world ----------
const { group: cityGroup, signs } = buildWorld(scene, rand);
const sea = cityGroup.userData.sea;

// ---------- entities ----------
const traffic = new Traffic(scene, rand);
traffic.spawn(CFG.trafficCount);
const parked = spawnParked(scene, rand, 12);
const peds = new Pedestrians(scene, rand);
peds.spawn(CFG.pedCount);
const police = new Police(scene, rand);
const missions = new Missions(scene);
const audio = new AudioSys();
const combat = new Combat(scene, audio);
const health = new Health();

// ambient life: two bird flocks, gulls over the pier, clouds,
// a dog that heels a pedestrian, a cat that crosses the road.
const flockCity = new Flock(scene, { cx: 0, cz: 0, r: 130, h: 30, speed: 9, count: 7 });
const flockBeach = new Flock(scene, { cx: -180, cz: 0, r: 90, h: 24, speed: 8, count: 6 });
const gulls = new Flock(scene, {
  cx: -270, cz: 60, r: 22, h: 15, speed: 6, count: 5, color: 0xf2f2ea,
});
const clouds = new Clouds(scene, rand);
const dog = new DogFollower(scene, peds.peds[0]);
const cat = new CrossingCat(scene, rand);

const player = heroPerson();
player.position.set(30, 0, 30);
player.rotation.y = Math.PI;
scene.add(player);
combat.setPlayer(player);

const car = heroCar();
car.position.set(34, 0, 30);
car.rotation.y = Math.PI / 2;
scene.add(car);

// chase target for mission 2 (blue sedan)
const chaseTarget = makeCar(0, 0x2e86c1);
chaseTarget.position.set(120, 0, -120);
chaseTarget.userData.maxSpeed = 26;
chaseTarget.userData.speed = 0;
chaseTarget.visible = false;
scene.add(chaseTarget);

// ---------- HUD ----------
const hud = new HUD(document.getElementById('hud'));

// ---------- game state ----------
const state = {
  mode: 'title',        // title | playing | paused | busted | wasted
  cash: CFG.startCash,
  inCar: false,
  carSpeed: 0,
  heading: Math.PI,     // player facing (on foot)
  keys: {},
  missionIndex: 0,
  missionsDone: 0,
  time: 0,
  clockMin: 1110,       // 18:30 — golden hour, fixed for the look
  camYaw: 0,
  shotReady: false,
  exhaustT: 0,
  skidT: 0,
  footSpeed: 0,       // v3: real on-foot speed for the bust meter
  stolenCar: null,    // v3: the parked car currently swapped out
  heroMax: 0,         // v3: hero top speed to restore after a steal
};
let saveData = loadSave();

function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function writeSave() {
  const data = {
    cash: state.cash, missionIndex: missions.index,
    missionsDone: state.missionsDone,
    x: player.position.x, z: player.position.z,
    health: health.hp, wanted: police.wanted,
    when: Date.now(),
  };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch {}
  saveData = data;
}

// ---------- building collision (v3) ----------
// Circle-vs-AABB push-out against the real building footprints.
// Returns how far the position was moved (0 = no contact).
function collideBuildings(pos, radius) {
  let moved = 0;
  const rects = worldInfo.buildingRects;
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    const nx = clamp(pos.x, r.x0, r.x1);
    const nz = clamp(pos.z, r.z0, r.z1);
    const dx = pos.x - nx, dz = pos.z - nz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-6) {
      const d = Math.sqrt(d2);
      pos.x = nx + (dx / d) * radius;
      pos.z = nz + (dz / d) * radius;
      moved = Math.max(moved, radius - d);
    } else {
      // centre inside the footprint: exit along the smallest penetration
      const pl = pos.x - r.x0, pr = r.x1 - pos.x;
      const pt = pos.z - r.z0, pb = r.z1 - pos.z;
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) pos.x = r.x0 - radius;
      else if (m === pr) pos.x = r.x1 + radius;
      else if (m === pt) pos.z = r.z0 - radius;
      else pos.z = r.z1 + radius;
      moved = Math.max(moved, radius);
    }
  }
  return moved;
}

// ---------- title screen ----------
const titleEl = document.getElementById('title');
const titleContinue = document.getElementById('btn-continue');
const titleNew = document.getElementById('btn-new');
const titleQuit = document.getElementById('btn-quit');
const endEl = document.getElementById('endscreen');
const endTitle = document.getElementById('end-title');
const endText = document.getElementById('end-text');
const pauseEl = document.getElementById('pause');

function showTitle() {
  state.mode = 'title';
  document.getElementById('hud').classList.add('hidden');
  titleEl.classList.remove('hidden');
  endEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  titleContinue.style.display = saveData ? 'block' : 'none';
  document.getElementById('save-line').textContent = saveData
    ? 'Save: $' + saveData.cash + ' · Misi ' + (saveData.missionIndex + 1) + '/5 · ' +
      new Date(saveData.when).toLocaleDateString()
    : 'Belum ada save.';
}
function startGame(fromSave) {
  audio.ensure();
  titleEl.classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  endEl.classList.add('hidden');
  pauseEl.classList.add('hidden');
  state.mode = 'playing';
  // v3 audit: a (re)start always begins from a clean street — v2 kept
  // the previous session's police cars and a stale in-car flag
  police.clear();
  state.inCar = false;
  player.visible = true;
  if (fromSave && saveData) {
    state.cash = saveData.cash;
    state.missionsDone = saveData.missionsDone || 0;
    health.hp = saveData.health || CFG.playerHealth;
    player.position.set(saveData.x || 30, 0, saveData.z || 30);
    missions.start(saveData.missionIndex || 0);
    hud.phone('MAMA ROSA', 'Selamat datang kembali, Dario. Kerjaan menunggumu.');
  } else {
    state.cash = CFG.startCash;
    state.missionsDone = 0;
    health.hp = CFG.playerHealth;
    player.position.set(30, 0, 30);
    police.clear();
    missions.reset();
    missions.start(0);
    hud.phone('MAMA ROSA', 'Dario, sayang. Paket di Sunset Pier. Jangan telat.');
  }
  syncHUD();
}
titleNew.addEventListener('click', () => startGame(false));
titleContinue.addEventListener('click', () => startGame(true));
document.getElementById('btn-retry').addEventListener('click', () => {
  health.hp = CFG.playerHealth;
  police.clear();
  player.position.set(30, 0, 30);
  endEl.classList.add('hidden');
  state.mode = 'playing';
  missions.start(missions.index);
  syncHUD();
});
document.getElementById('btn-title').addEventListener('click', showTitle);
titleQuit.addEventListener('click', () => {
  writeSave();
  hud.center('PROGRESS DISIMPAN', 'Sampai jumpa di Palm Bay, Dario.');
});

// ---------- missions events ----------
missions.onEvent = (type, payload) => {
  if (type === 'start') {
    hud.setObjective(payload.name + ' — ' + payload.brief);
    hud.setZone(payload.zone || '');
    hud.phone('MAMA ROSA', payload.brief);
    audio.play('mission');
    // v3 audit: HEAT ESCAPE's brief promises 3 stars, but nothing
    // ever raised them — and the completion check (wanted 0, heat 0)
    // was already true, so the mission completed instantly for free
    if (payload.escape) police.setWanted(3);
  } else if (type === 'complete') {
    state.cash += payload.reward;
    state.missionsDone += 1;
    audio.play('cash');
    hud.center('MISI SELESAI', '+$' + payload.reward + ' · ' + payload.name);
    hud.phone('MAMA ROSA', 'Bagus, Dario. $' + payload.reward + ' sudah masuk.');
    writeSave();
    setTimeout(() => {
      const next = missions.next();
      if (!next) {
        hud.center('PALM BAY HEAT — TAMAT', 'Semua 5 misi selesai. Kota ini milikmu, Dario.');
        hud.phone('MAMA ROSA', 'Kamu legenda Palm Bay sekarang.');
      }
    }, 1800);
  } else if (type === 'fail') {
    audio.play('busted');
    hud.center('MISI GAGAL', payload.reason);
    // v3 audit: only restart into a live game — the timer used to
    // restart the mission behind the busted/wasted screen too
    setTimeout(() => {
      if (state.mode === 'playing') missions.start(missions.index);
    }, 1200);
  } else if (type === 'chaseHit') {
    hud.center('TABRAKAN!', payload.hits + ' / 3');
    audio.play('punch');
  } else if (type === 'allDone') {
    // story complete
  }
};

// ---------- input ----------
addEventListener('keydown', (e) => {
  state.keys[e.code] = true;
  audio.ensure();
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if (state.mode === 'playing') { state.mode = 'paused'; pauseEl.classList.remove('hidden'); }
    else if (state.mode === 'paused') { state.mode = 'playing'; pauseEl.classList.add('hidden'); }
  }
  if (e.code === 'KeyE' && state.mode === 'playing') tryEnterExitCar();
  if (e.code === 'KeyF' && state.mode === 'playing' && !state.inCar) {
    combat.melee(player.position, state.heading, peds.peds, (p) => {
      peds.fleeFrom(p.position.x, p.position.z, 12);
      police.addWanted(1);
    });
  }
  if (e.code === 'Digit1' && state.mode === 'playing') { combat.setWeapon('fists'); syncHUD(); }
  if (e.code === 'Digit2' && state.mode === 'playing') { combat.setWeapon('pistol'); syncHUD(); }
  if (e.code === 'KeyR' && state.mode === 'playing') {
    if (combat.weapon === 'pistol') { combat.ammo = 12; hud.center('RELOAD', '12 peluru'); }
  }
});
addEventListener('keyup', (e) => { state.keys[e.code] = false; });
addEventListener('mousedown', (e) => {
  if (state.mode !== 'playing' || state.inCar || e.button !== 0) return;
  audio.ensure();
  // v3 audit: the city is a raycast target too — shots now stop at
  // walls instead of passing through buildings to hit peds behind
  // them, and only a person (or the chase car) raises the heat
  const res = combat.shoot(camera, [peds.group, chaseTarget, cityGroup], (obj) => {
    if (obj === chaseTarget || (obj.userData && obj.userData.isPerson)) {
      peds.fleeFrom(player.position.x, player.position.z, 20);
      police.addWanted(1);
    }
  });
  if (res === 'hit' || res === 'miss') syncHUD();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- enter / exit car ----------
function nearestCar(maxD) {
  let best = null, bestD = maxD;
  const all = [car].concat(parked);
  for (const c of all) {
    if (c.userData.parked && c.userData.stolen) continue;
    const d = Math.hypot(c.position.x - player.position.x, c.position.z - player.position.z);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}
function tryEnterExitCar() {
  if (state.inCar) {
    // exit
    state.inCar = false;
    const side = new THREE.Vector3(1, 0, 0).applyEuler(car.rotation);
    player.position.copy(car.position).addScaledVector(side, 2.5);
    player.visible = true;
    state.heading = car.rotation.y;
    // v3 audit: put the stolen car back where it was taken from and
    // give the convertible its own top speed back (v2 deleted the
    // stolen car from the world and kept whatever speed was last set)
    if (state.stolenCar) {
      const c = state.stolenCar;
      c.visible = true;
      c.userData.parked = true;
      c.userData.stolen = false;
      state.stolenCar = null;
      car.userData.maxSpeed = state.heroMax || CFG.carMax;
    }
    hud.center('KELUAR MOBIL', '');
    return;
  }
  const c = nearestCar(4);
  if (!c) return;
  if (c.userData.parked) {
    c.userData.parked = false;
    c.userData.stolen = true;
    police.addWanted(1);
    hud.phone('MAMA ROSA', 'Mobil curian? Hati-hati, Dario. Polisi mengawasi.');
    peds.fleeFrom(player.position.x, player.position.z, 10);
  }
  state.inCar = true;
  state.carSpeed = 0;
  player.visible = false;
  // swap active car if it is a parked one — and remember it, plus the
  // hero's own top speed, so the exit can restore both (v3 audit)
  if (c !== car) {
    car.position.copy(c.position);
    car.rotation.copy(c.rotation);
    c.visible = false;
    state.stolenCar = c;
    state.heroMax = car.userData.maxSpeed;
    car.userData.maxSpeed = c.userData.maxSpeed || CFG.carMax;
  }
  audio.play('chime');
  hud.center('MASUK MOBIL', 'WASD mengemudi · E keluar · Spasi rem');
}

// ---------- HUD sync ----------
function zoneNameAt(x, z) {
  const gt = worldInfo.gangTurf;
  if (gt && x >= gt.x0 && x <= gt.x1 && z >= gt.z0 && z <= gt.z1) return 'GANG TURF — PALM BAY GREENS';
  if (x < -150) return 'BEACHFRONT';
  if (x > 90 && z > 90) return 'PORT';
  if (Math.abs(x) < 90 && Math.abs(z) < 90) return 'DOWNTOWN';
  return 'SUBURBS';
}
function syncHUD() {
  hud.setCash(state.cash);
  hud.setHealth(health.pct);
  hud.setStars(police.wanted);
  hud.setWeapon(combat.weapon, combat.ammo);
  hud.setClock(state.clockMin);
  const pp = state.inCar ? car.position : player.position;
  hud.setZone(zoneNameAt(pp.x, pp.z));
  const def = missions.current;
  if (missions.active && def) {
    hud.setObjective(def.name + ' — ' + def.brief);
    hud.setTimer(def.time > 0 ? missions.timer : 0);
  } else {
    hud.setObjective('');
    hud.setTimer(0);
  }
}

// ---------- per-frame update ----------
const clock = new THREE.Clock();
let hudT = 0;
let frameNo = 0;

function updatePlayer(dt) {
  const k = state.keys;
  const run = k['ShiftLeft'] || k['ShiftRight'];
  const speed = run ? CFG.playerRun : CFG.playerWalk;
  let mx = 0, mz = 0;
  if (k['KeyW'] || k['ArrowUp']) mz += 1;
  if (k['KeyS'] || k['ArrowDown']) mz -= 1;
  if (k['KeyA'] || k['ArrowLeft']) mx -= 1;
  if (k['KeyD'] || k['ArrowRight']) mx += 1;
  const u = player.userData;
  if (mx || mz) {
    const len = Math.hypot(mx, mz);
    const ang = Math.atan2(mx / len, mz / len) + state.camYaw;
    state.heading = ang;
    state.footSpeed = speed;
    player.position.x += Math.sin(ang) * speed * dt;
    player.position.z += Math.cos(ang) * speed * dt;
    player.position.x = clamp(player.position.x, -208, 208);
    player.position.z = clamp(player.position.z, -208, 208);
    player.rotation.y = ang;
    u.walkPhase += dt * speed * 2.4;
    u.walk(u.walkPhase);
    // bump peds aside
    for (const p of peds.peds) {
      const d = Math.hypot(p.position.x - player.position.x, p.position.z - player.position.z);
      if (d < 1.1) peds.fleeFrom(player.position.x, player.position.z, 6);
    }
  } else {
    state.footSpeed = 0;
    u.idle();
  }
  // v3: buildings are solid for the player too (v2 walked through them)
  collideBuildings(player.position, 0.45);
  // keep the pistol aim pose while armed
  if (combat.weapon === 'pistol') u.armR.rotation.x = -1.35;
}

function updateCar(dt) {
  const k = state.keys;
  const u = car.userData;
  let throttle = 0;
  if (k['KeyW'] || k['ArrowUp']) throttle += 1;
  if (k['KeyS'] || k['ArrowDown']) throttle -= 0.7;
  const braking = !!k['Space'];
  if (braking) throttle = -1.4;
  state.carSpeed += throttle * CFG.carAccel * dt;
  state.carSpeed -= state.carSpeed * 0.6 * dt; // drag
  state.carSpeed = clamp(state.carSpeed, -10, u.maxSpeed);
  // brake lights + skid sound on hard braking
  setBrake(car, braking || throttle < -0.5);
  if (braking && Math.abs(state.carSpeed) > 8 && state.skidT <= 0) {
    audio.play('skid');
    state.skidT = 0.9;
  }
  state.skidT -= dt;
  let steer = 0;
  if (k['KeyA'] || k['ArrowLeft']) steer += 1;
  if (k['KeyD'] || k['ArrowRight']) steer -= 1;
  const spd = state.carSpeed;
  if (Math.abs(spd) > 0.5) {
    car.rotation.y += steer * CFG.carTurn * dt * clamp(Math.abs(spd) / 12, 0.3, 1) * Math.sign(spd);
  }
  const fwd = new THREE.Vector3(0, 0, 1).applyEuler(car.rotation);
  car.position.addScaledVector(fwd, spd * dt);
  car.position.x = clamp(car.position.x, -208, 208);
  car.position.z = clamp(car.position.z, -208, 208);
  // v3: buildings are solid — hitting one scrubs speed (v2 drove
  // straight through every building in the city)
  if (collideBuildings(car.position, 2.3) > 0) state.carSpeed *= 0.55;
  // hit traffic + parked cars (simple arcade shove + slowdown)
  for (const oc of traffic.cars) {
    const d = Math.hypot(oc.position.x - car.position.x, oc.position.z - car.position.z);
    if (d < 3.1 && Math.abs(spd) > 2) {
      oc.position.x += fwd.x * 1.2;
      oc.position.z += fwd.z * 1.2;
      state.carSpeed *= 0.7;
      audio.play('punch');
    }
  }
  for (const oc of parked) {
    if (!oc.visible) continue;
    const d = Math.hypot(oc.position.x - car.position.x, oc.position.z - car.position.z);
    if (d < 3.1 && Math.abs(spd) > 2) state.carSpeed *= 0.7;
  }
  // exhaust puffs while accelerating
  state.exhaustT -= dt;
  if (throttle > 0.3 && state.exhaustT <= 0) {
    state.exhaustT = 0.12;
    const back = new THREE.Vector3(0, 0, -1).applyEuler(car.rotation);
    const tip = car.position.clone().addScaledVector(back, 2.3);
    tip.y = 0.35;
    combat.smoke.puff(tip, 0.25, 0x8a8a8a);
  }
  // hit peds -> wanted + flee
  for (const p of peds.peds) {
    const d = Math.hypot(p.position.x - car.position.x, p.position.z - car.position.z);
    if (d < 1.6 && Math.abs(spd) > 2) {
      peds.fleeFrom(car.position.x, car.position.z, 15);
      police.addWanted(1);
      state.carSpeed *= 0.6;
    }
  }
  // ram chase target (mission 2)
  if (missions.active && missions.current && missions.current.chase && chaseTarget.visible) {
    const d = Math.hypot(chaseTarget.position.x - car.position.x, chaseTarget.position.z - car.position.z);
    if (d < 3.4 && Math.abs(spd) > 4) {
      missions.registerChaseHit();
      state.carSpeed *= 0.5;
      chaseTarget.position.x += fwd.x * 3;
      chaseTarget.position.z += fwd.z * 3;
    }
  }
  // police ram slows the hero car
  for (const pc of police.cars) {
    const d = Math.hypot(pc.position.x - car.position.x, pc.position.z - car.position.z);
    if (d < 3.2) state.carSpeed *= 0.92;
  }
  audio.setEngine(Math.abs(spd) / CFG.carMax);
}

function updateChaseTarget(dt) {
  if (!missions.active || !missions.current || !missions.current.chase) {
    chaseTarget.visible = false;
    return;
  }
  chaseTarget.visible = true;
  const u = chaseTarget.userData;
  // flee from player along roads, weaving
  const dx = chaseTarget.position.x - player.position.x;
  const dz = chaseTarget.position.z - player.position.z;
  const targetAngle = Math.atan2(dx, dz) + Math.sin(state.time * 0.7) * 0.4;
  let diff = targetAngle - chaseTarget.rotation.y;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  chaseTarget.rotation.y += clamp(diff, -1.6 * dt, 1.6 * dt);
  u.speed = lerp(u.speed, u.maxSpeed, dt);
  const fwd = new THREE.Vector3(0, 0, 1).applyEuler(chaseTarget.rotation);
  chaseTarget.position.addScaledVector(fwd, u.speed * dt);
  chaseTarget.position.x = clamp(chaseTarget.position.x, -205, 205);
  chaseTarget.position.z = clamp(chaseTarget.position.z, -205, 205);
  // v3: the chase car respects buildings too (it fled through them)
  collideBuildings(chaseTarget.position, 2.3);
}

// ---------- camera ----------
const camTarget = new THREE.Vector3();
let shotCamPos = null;
let shotCamTarget = null;
function updateCamera(dt) {
  const focus = state.inCar ? car.position : player.position;
  // staged shots: snap to the composed camera, no drift
  if (SHOT && shotCamPos) {
    camera.position.copy(shotCamPos);
    camera.lookAt(shotCamTarget);
    return;
  }
  const heading = state.inCar ? car.rotation.y : state.heading;
  // camera yaw follows behind the focus
  const wantYaw = heading + Math.PI;
  let dy = wantYaw - state.camYaw;
  while (dy > Math.PI) dy -= TAU;
  while (dy < -Math.PI) dy += TAU;
  state.camYaw += dy * Math.min(1, dt * 3);
  const dist = state.inCar ? 11 : 6.5;
  const height = state.inCar ? 4.5 : 3.0;
  const cx = focus.x + Math.sin(state.camYaw) * dist;
  const cz = focus.z + Math.cos(state.camYaw) * dist;
  camera.position.lerp(new THREE.Vector3(cx, height, cz), Math.min(1, dt * 6));
  // v3 audit: keep the chase camera out of buildings (it used to
  // clip inside facades whenever the player backed against a wall)
  collideBuildings(camera.position, 0.7);
  const lookY = focus.y + 1.6;
  camTarget.lerp(new THREE.Vector3(focus.x, lookY, focus.z), Math.min(1, dt * 8));
  camera.lookAt(camTarget);
}

// ---------- busted / wasted ----------
function showEnd(kind) {
  state.mode = kind;
  audio.play(kind);
  endEl.classList.remove('hidden');
  if (kind === 'busted') {
    endTitle.textContent = 'BUSTED!';
    endTitle.style.color = '#59a7ff';
    endText.textContent = 'Polisi menangkap Dario. Uang jaminan $200 dipotong.';
    state.cash = Math.max(0, state.cash - 200);
  } else {
    endTitle.textContent = 'WASTED!';
    endTitle.style.color = '#ff5a5a';
    endText.textContent = 'Dario tumbang. Rumah sakit memotong $150.';
    state.cash = Math.max(0, state.cash - 150);
  }
  writeSave();
  syncHUD();
}

// ---------- shot staging ----------
// Deterministic: ambient systems are pre-rolled in fixed 1/60 steps
// (traffic, pedestrians, birds, gulls, clouds, cat) so every run puts
// the same life in the same place; hero + police are staged after the
// pre-roll so their framing is exact. Birds are then placed in view.
function preroll(seconds) {
  const step = 1 / 60;
  const n = Math.round(seconds / step);
  for (let i = 0; i < n; i++) {
    state.time += step;
    state.clockMin += step / 10;   // clock advances, never resets
    traffic.update(step);
    peds.update(step);
    flockCity.update(step);
    flockBeach.update(step);
    gulls.update(step);
    clouds.update(step);
    cat.update(step);
  }
}

// Place a flock so its leader flies in front of the camera.
function stageFlockInView(flock, camPos, viewDir, dist, height) {
  flock.cx = camPos.x + viewDir.x * dist;
  flock.cz = camPos.z + viewDir.z * dist;
  flock.r = 20;
  flock.h = height;
  flock.angle = Math.atan2(camPos.x - flock.cx, camPos.z - flock.cz);
  flock.update(0);
}

function applyShot() {
  if (!SHOT) return;
  // deterministic scene for screenshots
  if (SHOT === 'title') {
    // seed a save so CONTINUE shows (spec: title lists New Game / Continue)
    saveData = {
      cash: 2450, missionIndex: 2, missionsDone: 2,
      x: 30, z: 30, health: 100, wanted: 0, when: Date.now(),
    };
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(saveData)); } catch {}
    showTitle();
    // high wide vista from the east, looking west into the sunset:
    // sun disc in the upper-left third, skyline silhouettes below it.
    shotCamPos = new THREE.Vector3(150, 48, -60);
    shotCamTarget = new THREE.Vector3(-120, 10, -90);
    camera.position.copy(shotCamPos);
    camera.lookAt(shotCamTarget);
    state.shotReady = true;
    return;
  }
  state.mode = 'playing';
  titleEl.classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
  audio.ensure();
  if (SHOT === 'chase') {
    // beachfront avenue (x=-210 road), heading north, sea on the left.
    // Red convertible hero, police pursuit staggered in the next lanes
    // (never stacked on the hero's bumper), two-way traffic.
    state.inCar = true;
    player.visible = false;
    car.position.set(-210, 0, 60);
    car.rotation.y = 0;
    state.carSpeed = 26;
    state.camYaw = car.rotation.y + Math.PI;
    police.setWanted(3);
    // v3 audit: the cover depicts a chase — start THE CHASE (index 1),
    // not HOT DELIVERY, so the HUD objective matches the picture
    missions.start(1);
    state.cash = 2450;
    state.missionsDone = 2;
    state.clockMin = 1142; // 19:02
    preroll(4);
    // police flanking in adjacent lanes, clearly BEHIND the hero
    // (never stacked on its bumper, never beside it)
    const slots = [[-6, -12], [6, -18], [-3, -26]];
    police.cars.forEach((pc, i) => {
      pc.position.set(car.position.x + slots[i][0], 0, car.position.z + slots[i][1]);
      pc.rotation.y = car.rotation.y;
      pc.userData.speed = 24;
    });
    // officers stay out of the avenue for the cover framing
    for (const o of police.officers) o.person.visible = false;
    // camera: low chase cam behind-left, hero in the lower third,
    // road + palms leading north, sun rim-light from the west.
    shotCamPos = new THREE.Vector3(car.position.x - 6, 5.0, car.position.z - 16);
    shotCamTarget = new THREE.Vector3(car.position.x + 0.5, 1.3, car.position.z + 8);
    camera.position.copy(shotCamPos);
    camera.lookAt(shotCamTarget);
    // birds crossing the sky above the boulevard, in the upper third
    const viewDir = new THREE.Vector3(0, 0, 1);
    stageFlockInView(flockCity, shotCamPos, viewDir, 60, 11);
    state.camYaw = car.rotation.y + Math.PI;
  } else if (SHOT === 'foot') {
    // on foot on the beachfront promenade, walking north: trees and
    // sea to the left, pastel buildings to the right, peds + dog ahead.
    state.inCar = false;
    player.position.set(-198.7, 0, -10);
    state.heading = 0;
    state.camYaw = state.heading + Math.PI;
    police.setWanted(1);
    missions.start(0);
    state.cash = 520;
    state.clockMin = 1135; // 18:55
    preroll(4);
    // a pedestrian + the dog walk toward the player on the same sidewalk
    const walker = peds.peds[0];
    walker.position.set(-198.7, 0, 14);
    walker.userData.along = 14; // v3: update() drives z from userData.along
    walker.userData.heading = Math.PI;
    walker.userData.vertical = true;
    walker.userData.roadLine = -210;
    walker.userData.side = 11.3;
    walker.userData.speed = 1.5;
    dog.owner = walker;
    dog.dog.position.set(-198.0, 0, 11);
    dog.dog.rotation.y = Math.PI;
    dog.update(0);
    // camera: eye-level behind-right of the player, close enough that
    // the minifigure build reads (v3), sidewalk + trees leading north,
    // walker + dog ahead, gulls overhead.
    shotCamPos = new THREE.Vector3(player.position.x - 1.6, 1.9, player.position.z - 4.4);
    shotCamTarget = new THREE.Vector3(player.position.x + 0.9, 1.35, player.position.z + 7);
    camera.position.copy(shotCamPos);
    camera.lookAt(shotCamTarget);
    const viewDir = new THREE.Vector3(0.1, 0, 1).normalize();
    stageFlockInView(flockBeach, shotCamPos, viewDir, 50, 12);
    state.camYaw = state.heading + Math.PI;
  } else if (SHOT === 'mission') {
    // HOT DELIVERY with the LSPD closing in: hero convertible at the
    // marker, two police cars flanking ahead, gang group + busted scene
    // staged on the turf corner — mission pillar reads in the frame.
    state.inCar = true;
    player.visible = false;
    car.position.set(70, 0, -30);
    car.rotation.y = Math.PI / 2;
    state.carSpeed = 18;
    state.camYaw = car.rotation.y + Math.PI;
    police.setWanted(2);
    missions.start(2);
    missions.timer = 42;
    state.cash = 1250;
    state.clockMin = 1147; // 19:07
    hud.phone('MAMA ROSA', 'Cepat, Dario! Paketnya harus sampai sebelum jam 7.');
    hud.center('MISI: HOT DELIVERY', '+$900 kalau tepat waktu');
    // keep the cash banner up for the still frame
    clearTimeout(hud._centerT);
    hud._centerT = setTimeout(() => hud.el['hud-center'].classList.remove('show'), 20000);
    preroll(4);
    // police closing in from ahead, flanking — visible in frame
    const flank = [[95, -45], [85, -12]];
    police.cars.forEach((pc, i) => {
      pc.position.set(flank[i][0], 0, flank[i][1]);
      pc.rotation.y = Math.atan2(car.position.x - pc.position.x, car.position.z - pc.position.z);
      pc.userData.speed = 16;
    });
    // gang group on the turf corner sidewalk (green, rifles visible)
    stageGang(scene, [
      { x: 96, z: -52, heading: Math.PI * 0.75, rifle: true },
      { x: 99, z: -49, heading: Math.PI * 0.6, rifle: true },
      { x: 93, z: -48, heading: Math.PI * 0.9, rifle: false },
      { x: 97, z: -55, heading: Math.PI * 0.5, rifle: false },
      { x: 101, z: -53, heading: Math.PI * 0.8, rifle: true },
    ]);
    // busted scene: officer + hands-up suspect beside the lead cop car
    const lead = police.cars[0];
    stageBusted(scene, lead.position, lead.rotation.y);
    // camera: three-quarter view from the south-west — hero car left,
    // marker pillar centre, police + gang right. v3: pulled closer and
    // lower so the junction's traffic light (corner 78.7, -41.3) and the
    // zebra legs sit squarely in frame.
    shotCamPos = new THREE.Vector3(63, 4.2, -56);
    shotCamTarget = new THREE.Vector3(93, 2.0, -29);
    camera.position.copy(shotCamPos);
    camera.lookAt(shotCamTarget);
    state.camYaw = car.rotation.y + Math.PI;
  }
  syncHUD();
  // one minimap draw right away so the first frame already shows it
  const pp = state.inCar ? car.position : player.position;
  hud.drawMinimap(
    { x: pp.x, z: pp.z, heading: state.inCar ? car.rotation.y : state.heading },
    police.cars,
    missions.active && missions.current ? missions.current.target : null,
    chaseTarget.visible ? chaseTarget : null
  );
  state.shotReady = true;
}

// ---------- main loop ----------
function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.time += dt;
  state.clockMin += dt / 10;   // golden hour drifts slowly, never resets

  // sea: vertex waves (throttled) + texture drift for shimmer
  frameNo += 1;
  if (sea && frameNo % 3 === 0) {
    const pos = sea.geometry.attributes.position;
    const base = sea.userData.base;
    for (let i = 0; i < pos.count; i++) {
      pos.array[i * 3 + 2] = Math.sin(base[i * 3] * 0.08 + state.time * 1.4) * 0.5 +
        Math.cos(base[i * 3 + 1] * 0.06 + state.time) * 0.4;
    }
    pos.needsUpdate = true;
    sea.geometry.computeVertexNormals();
  }
  if (sea && sea.userData.waterTex) {
    sea.userData.waterTex.offset.y += dt * 0.008;
    sea.userData.waterTex.offset.x += dt * 0.003;
  }
  // neon flicker
  for (let i = 0; i < signs.length; i++) {
    signs[i].material.opacity = 0.9 + Math.sin(state.time * 3 + i * 2) * 0.1;
  }
  // sky dome follows the camera (world is large)
  sky.position.copy(camera.position);
  // sun shadow frustum follows the player
  updateSun(state.inCar ? car.position : player.position);

  if (state.mode === 'playing') {
    if (state.inCar) updateCar(dt);
    else updatePlayer(dt);
    traffic.playerPos = state.inCar ? car.position : player.position;
    traffic.update(dt);
    peds.update(dt);
    flockCity.update(dt);
    flockBeach.update(dt);
    gulls.update(dt);
    clouds.update(dt);
    dog.update(dt);
    cat.update(dt);
    updateChaseTarget(dt);
    combat.update(dt);
    const playerPos = state.inCar ? car.position : player.position;
    // v3 audit: on foot the bust meter now sees the REAL movement
    // speed — v2 passed 0, so it filled even while sprinting away
    const playerSpeed = state.inCar ? Math.abs(state.carSpeed) : state.footSpeed;
    const busted = police.update(dt, playerPos, playerSpeed, !state.inCar);
    // v3: pursuit cars collide with buildings like everyone else
    for (const pc of police.cars) collideBuildings(pc.position, 2.3);
    police.decay(dt);
    audio.setSiren(police.wanted > 0, dt);
    // mission logic
    if (missions.active) {
      const res = missions.update(dt, playerPos, state.inCar);
      if (res === 'complete') { /* event handler advances */ }
      // escape mission completes when heat is gone
      if (missions.current && missions.current.escape && police.wanted === 0 && police.heat <= 0) {
        missions.complete();
      }
    }
    // health: police contact on foot damages player
    if (!state.inCar) {
      for (const pc of police.cars) {
        const d = Math.hypot(pc.position.x - player.position.x, pc.position.z - player.position.z);
        if (d < 2.6 && health.damage(18 * dt)) { showEnd('wasted'); break; }
      }
    }
    if (busted) showEnd('busted');
    // auto-save every 20s
    if (state.time % 20 < dt) writeSave();
    updateCamera(dt);
    // HUD refresh ~10/s
    hudT += dt;
    if (hudT > 0.1) {
      hudT = 0;
      syncHUD();
      hud.setSpeed(state.inCar ? Math.abs(state.carSpeed) * 3.6 : 0);
      hud.setBust(police.bust / 100);
      const pp = state.inCar ? car.position : player.position;
      hud.drawMinimap(
        { x: pp.x, z: pp.z, heading: state.inCar ? car.rotation.y : state.heading },
        police.cars,
        missions.active && missions.current ? missions.current.target : null,
        chaseTarget.visible ? chaseTarget : null
      );
    }
  } else if (state.mode === 'title') {
    // slow orbit over the city vista — frozen for the staged title shot
    if (SHOT !== 'title') {
      const a = state.time * 0.02;
      camera.position.set(Math.sin(a) * 170, 55, Math.cos(a) * 170);
      camera.lookAt(0, 10, 0);
    }
    traffic.update(dt);
    peds.update(dt);
    flockCity.update(dt);
    flockBeach.update(dt);
    gulls.update(dt);
    clouds.update(dt);
  }
  renderer.render(scene, camera);
  if (SHOT && state.shotReady) {
    document.title = 'SHOT-READY';
    window.__shotReady = true;
  }
}

applyShot();
if (!SHOT) showTitle();
animate();
window.__game = {
  state, missions, police, health, player, car, hud,
  traffic, peds, renderer, combat, flockCity, gulls,
  scene, camera, cityGroup, worldInfo,
};
