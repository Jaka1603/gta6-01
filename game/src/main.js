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
import { Traffic, spawnParked, heroCar, makeCar, setBrake, rollWheels, steerWheels, carPersonHit } from './vehicles.js';
import { Pedestrians, heroPerson, attachWeapon, updateKnock } from './people.js';
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
// Mobile play: coarse pointers / touchscreens get a virtual stick,
// action buttons and a lighter render load. ?touch=1 forces the UI
// on (desktop testing + mobile screenshots).
const IS_TOUCH = params.get('touch') === '1' ||
  (window.matchMedia && matchMedia('(pointer: coarse)').matches) ||
  navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
if (IS_TOUCH) document.body.classList.add('touch');

const rand = rng(SEED * 7919 + 13);

// ---------- renderer / scene ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(SHOT ? 1 : Math.min(devicePixelRatio, IS_TOUCH ? 1.75 : 2));
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
sun.shadow.mapSize.set(IS_TOUCH ? 1024 : 2048, IS_TOUCH ? 1024 : 2048);
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
  const texel = (SHADOW_S * 2) / sun.shadow.mapSize.x;
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
// v5: Dario starts on the SIDEWALK corner by his car — v3 put him
// in the middle of the (30,30) junction, which was harmless while
// cars ghosted through people; with solid traffic (fix #4) he was
// run over within seconds of spawning
player.position.set(40.5, 0, 38.45);
player.rotation.y = Math.PI / 2;
scene.add(player);
combat.setPlayer(player);

const car = heroCar();
car.position.set(34, 0, 30);
car.rotation.y = Math.PI / 2;
scene.add(car);

// v5: traffic is wired to the people it shares the street with —
// pedestrians get knocked down (handled inside Traffic), and a hit
// on Dario costs health + a beat of lost control (knock state on
// the player figure, driven by updatePlayer).
traffic.peds = peds.peds;
traffic.playerRef = player;
traffic.onPlayerHit = (hitCar, speed, knocked) => {
  if (!knocked) return; // crawling push-aside already moved him
  audio.play('punch');
  if (health.damage(7)) { showEnd('wasted'); return; }
  hud.center('KETABRAK!', 'Awas lalu lintas, Dario.');
  syncHUD();
};

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
  heading: Math.PI / 2, // player facing (on foot) — +X at spawn
  keys: {},
  missionIndex: 0,
  missionsDone: 0,
  time: 0,
  clockMin: 1110,       // 18:30 — golden hour, fixed for the look
  camYaw: -Math.PI / 2, // settled behind the spawn heading
  camOffset: 0,         // v4: touch camera-drag orbit offset (radians)
  camOffsetTarget: 0,   // v5: drags aim here; camOffset eases to it
  stickVec: { x: 0, y: 0, mag: 0 }, // v5: analog stick (touch)
  sprinting: false,     // v5: true while the run gait is engaged
  transition: null,     // v5 amendment: enter/exit car sequence
  exitPending: false,   // v5 amendment: ACT at speed -> brake first
  nearCar: null,        // v5 amendment: car the enter prompt offers
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
  document.body.classList.remove('in-game');
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
  document.body.classList.add('in-game');
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
    // sidewalk spawn (see build note), facing +X along the kerb,
    // camera settled behind him: W walks the pavement, not a lane
    player.position.set(40.5, 0, 38.45);
    state.heading = Math.PI / 2;
    state.camYaw = -Math.PI / 2;
    player.rotation.y = state.heading;
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
  player.position.set(40.5, 0, 38.45);
  state.heading = Math.PI / 2;
  state.camYaw = -Math.PI / 2;
  player.rotation.y = state.heading;
  endEl.classList.add('hidden');
  state.mode = 'playing';
  document.body.classList.add('in-game');
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
function togglePause() {
  if (state.mode === 'playing') { state.mode = 'paused'; pauseEl.classList.remove('hidden'); }
  else if (state.mode === 'paused') { state.mode = 'playing'; pauseEl.classList.add('hidden'); }
}
function playerMelee() {
  if (state.mode !== 'playing' || state.inCar) return;
  combat.melee(player.position, state.heading, peds.peds, (p) => {
    peds.fleeFrom(p.position.x, p.position.z, 12);
    police.addWanted(1);
  });
}
function playerShoot() {
  if (state.mode !== 'playing' || state.inCar) return;
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
}
function reloadPistol() {
  if (state.mode !== 'playing' || combat.weapon !== 'pistol') return;
  combat.ammo = 12;
  hud.center('RELOAD', '12 peluru');
  syncHUD();
}
function playerAttack() {
  if (state.mode !== 'playing' || state.inCar) return;
  audio.ensure();
  if (combat.weapon === 'pistol') {
    if (combat.ammo <= 0) reloadPistol();
    else playerShoot();
  } else playerMelee();
}
function cycleWeapon() {
  if (state.mode !== 'playing' || state.inCar) return;
  combat.setWeapon(combat.weapon === 'pistol' ? 'fists' : 'pistol');
  syncHUD();
}
addEventListener('keydown', (e) => {
  state.keys[e.code] = true;
  audio.ensure();
  if (e.code === 'KeyM') audio.toggleMute();
  if (e.code === 'KeyP' || e.code === 'Escape') togglePause();
  if (e.code === 'KeyE' && state.mode === 'playing') tryEnterExitCar();
  if (e.code === 'KeyF' && state.mode === 'playing') playerMelee();
  if (e.code === 'Digit1' && state.mode === 'playing') { combat.setWeapon('fists'); syncHUD(); }
  if (e.code === 'Digit2' && state.mode === 'playing') { combat.setWeapon('pistol'); syncHUD(); }
  if (e.code === 'KeyR' && state.mode === 'playing') reloadPistol();
});
addEventListener('keyup', (e) => { state.keys[e.code] = false; });
// v5 (fix #7): a mouse press on the canvas is a camera DRAG until
// it proves to be a click — drags orbit the camera (into the same
// damped camOffsetTarget the touch drag uses), a press released
// within a few px still fires, so click-to-shoot is unchanged.
let mouseDrag = null;
addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  // taps on the touch UI / menus must never fire the pistol, and the
  // compatibility mouse event after a touch tap must not double-fire
  if (e.target && e.target.closest && e.target.closest('#touch-controls, .overlay')) return;
  if (performance.now() - touchTapAt < 700) return;
  if (e.target === canvas && state.mode === 'playing') {
    mouseDrag = { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: 0 };
    return;
  }
  playerShoot();
});
addEventListener('mousemove', (e) => {
  if (!mouseDrag) return;
  state.camOffsetTarget += (e.clientX - mouseDrag.x) * 0.0052;
  mouseDrag.x = e.clientX;
  mouseDrag.y = e.clientY;
  mouseDrag.moved = Math.max(mouseDrag.moved,
    Math.abs(e.clientX - mouseDrag.sx) + Math.abs(e.clientY - mouseDrag.sy));
});
addEventListener('mouseup', () => {
  if (!mouseDrag) return;
  const wasClick = mouseDrag.moved < 6;
  mouseDrag = null;
  if (wasClick) playerShoot();
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------- touch controls ----------
// v5 (Jaka's amendment — the standard mobile GTA-clone scheme):
// a FLOATING analog stick: the base appears where the left thumb
// lands, the knob follows it clamped to the base, and deflection
// drives movement speed PROPORTIONALLY through state.stickVec
// (small push = stroll, full push = run). The stick still derives
// the digital WASD keys for anything that reads them. Buttons feed
// the same action functions as the keyboard. Dragging the right
// half of the screen orbits the camera into state.camOffsetTarget,
// which updateCamera damps toward — no jitter, no snapping.
const STICK_DEAD = 0.12;   // dead zone, as a fraction of full travel
const STICK_TRAVEL = 70;   // px of thumb travel = full deflection
let touchTapAt = 0;
let stickPointer = null;
let stickOrigin = { x: 0, y: 0 };
let runHeld = false;
const stickEl = document.getElementById('stick');
const knobEl = document.getElementById('stick-knob');
const runBtn = document.getElementById('btn-run');
const atkBtn = document.getElementById('btn-atk');

function setKey(code, on) { state.keys[code] = !!on; }
function syncHoldKeys() {
  if (state.inCar) {
    state.keys['Space'] = runHeld;      // RUN button becomes the brake
    state.keys['ShiftLeft'] = false;
    state.keys['ShiftRight'] = false;
  } else {
    state.keys['ShiftLeft'] = runHeld;
    state.keys['Space'] = false;
  }
}
function refreshTouchUI() {
  if (!document.body.classList.contains('touch')) return;
  const label = state.inCar ? 'BRK' : 'RUN';
  if (runBtn.textContent !== label) runBtn.textContent = label;
  const atk = state.inCar ? '···' : (combat.weapon === 'pistol' ? 'FIRE' : 'ATK');
  if (atkBtn.textContent !== atk) atkBtn.textContent = atk;
}
// the base floats to the thumb: it recentres on the landing point
// (clamped so the whole base stays on screen), then the knob is a
// pure function of thumb displacement from that origin.
function stickStart(e) {
  stickPointer = e.pointerId;
  const half = STICK_TRAVEL;
  stickOrigin.x = clamp(e.clientX, half, innerWidth - half);
  stickOrigin.y = clamp(e.clientY, half, innerHeight - half);
  stickEl.style.left = (stickOrigin.x - half) + 'px';
  stickEl.style.top = (stickOrigin.y - half) + 'px';
  stickEl.style.bottom = 'auto';
  knobEl.style.transition = 'none';
  stickMove(e);
}
function stickMove(e) {
  let dx = (e.clientX - stickOrigin.x) / STICK_TRAVEL;
  let dy = (e.clientY - stickOrigin.y) / STICK_TRAVEL;
  const len = Math.hypot(dx, dy);
  const mag = Math.min(1, len);
  if (len > 1) { dx /= len; dy /= len; }
  // analog vector: x = right, y = forward (screen-up), mag 0..1
  state.stickVec.x = dx;
  state.stickVec.y = -dy;
  state.stickVec.mag = mag;
  // knob follows the thumb, clamped so it never leaves the base
  knobEl.style.transform =
    'translate(-50%, -50%) translate(' + (dx * 39) + 'px, ' + (dy * 39) + 'px)';
  // derived digital keys (kept for readers/tests of state.keys)
  setKey('KeyW', dy < -STICK_DEAD);
  setKey('KeyS', dy > STICK_DEAD);
  setKey('KeyA', dx < -STICK_DEAD);
  setKey('KeyD', dx > STICK_DEAD);
}
function stickEnd(e) {
  if (e && e.pointerId !== undefined && e.pointerId !== stickPointer) return;
  stickPointer = null;
  // release: movement stops THIS frame, knob springs home
  state.stickVec.x = 0;
  state.stickVec.y = 0;
  state.stickVec.mag = 0;
  knobEl.style.transition = 'transform .15s ease-out';
  knobEl.style.transform = 'translate(-50%, -50%)';
  setKey('KeyW', false);
  setKey('KeyS', false);
  setKey('KeyA', false);
  setKey('KeyD', false);
}
addEventListener('pointermove', (e) => {
  if (e.pointerId === stickPointer) stickMove(e);
});
addEventListener('pointerup', stickEnd);
addEventListener('pointercancel', stickEnd);

function bindTap(id, on, off) {
  const el = document.getElementById(id);
  el.addEventListener('pointerdown', (e) => {
    touchTapAt = performance.now();
    audio.ensure();
    el.classList.add('active');
    if (on) on();
    e.preventDefault();
  });
  const end = (e) => {
    el.classList.remove('active');
    if (off) off();
    if (e) e.preventDefault();
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', end);
  return el;
}
bindTap('btn-atk', () => playerAttack());
bindTap('btn-act', () => {
  if (state.mode === 'playing') tryEnterExitCar();
  syncHoldKeys();
});
bindTap('btn-weapon', () => cycleWeapon());
bindTap('btn-run',
  () => { runHeld = true; syncHoldKeys(); },
  () => { runHeld = false; syncHoldKeys(); });
bindTap('btn-pause', () => togglePause());
bindTap('btn-full', () => {
  try {
    if (document.fullscreenElement) document.exitFullscreen();
    else {
      const p = document.documentElement.requestFullscreen();
      if (p && p.catch) p.catch(() => {});
      if (screen.orientation && screen.orientation.lock) {
        const q = screen.orientation.lock('landscape');
        if (q && q.catch) q.catch(() => {});
      }
    }
  } catch {}
});
// v5 touch dispatcher (the amendment's scheme): a touch on open
// screen is split by half — LEFT summons the floating stick under
// the thumb, RIGHT drags the camera. Drags accumulate into
// state.camOffsetTarget and updateCamera damps camOffset toward
// it, so the view swings with a little inertia and never snaps.
// Buttons keep their own bindTap handlers and are skipped here;
// the stick element sits in the left zone, so a touch starting on
// it is classified as a stick touch by position like any other.
let camPointer = null;
let camLastX = 0;
addEventListener('pointerdown', (e) => {
  if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
  touchTapAt = performance.now();
  document.body.classList.add('touch');
  if (state.mode !== 'playing') return;
  const t = e.target;
  if (t && t.closest && t.closest('#touch-actions, #touch-top, .overlay')) return;
  audio.ensure();
  if (e.clientX < innerWidth * 0.5) {
    if (stickPointer === null) stickStart(e);
  } else if (camPointer === null) {
    camPointer = e.pointerId;
    camLastX = e.clientX;
  }
});
addEventListener('pointermove', (e) => {
  if (e.pointerId !== camPointer) return;
  state.camOffsetTarget += (e.clientX - camLastX) * 0.0055;
  camLastX = e.clientX;
});
const camDragEnd = (e) => { if (e.pointerId === camPointer) camPointer = null; };
addEventListener('pointerup', camDragEnd);
addEventListener('pointercancel', camDragEnd);
// never leave a virtual key stuck when the tab loses focus
addEventListener('blur', () => {
  stickEnd();
  runHeld = false;
  syncHoldKeys();
});

// ---------- enter / exit car (v5 amendment: GTA-style flow) ------
// ACT near a car starts a short sequence instead of a teleport:
// Dario walks to the DRIVER-side door, the hinged door swings
// open, he gets in, the door closes, and the camera glides to the
// chase position. state.inCar flips immediately (the sequence is
// the visual), input is locked while it plays, and the v3 body-
// swap + stolen-car restore semantics are preserved exactly —
// the swap just happens mid-sequence now. Traffic cars can be
// carjacked the same way (wanted +1, restored to traffic on exit).
function nearestCar(maxD) {
  let best = null, bestD = maxD;
  const all = [car].concat(parked, traffic.cars);
  for (const c of all) {
    if (c.userData.parked && c.userData.stolen) continue;
    if (!c.visible) continue;
    const d = Math.hypot(c.position.x - player.position.x, c.position.z - player.position.z);
    if (d < bestD) { best = c; bestD = d; }
  }
  return best;
}
function setDoor(carObj, amt) {
  const d = carObj.userData.door;
  if (d) d.rotation.y = amt * 1.15;
}
function doorOpenAmt(carObj) {
  const d = carObj.userData.door;
  return d ? d.rotation.y / 1.15 : 0;
}
// where Dario stands to use the driver door (live — a jacked
// traffic car may still be rolling to a stop)
const _doorV = new THREE.Vector3();
function doorAnchor(c) {
  const s = c.userData.style || { w: 1.85, l: 4.4 };
  const hingeZ = c.userData.door ? c.userData.door.position.z : s.l * 0.1;
  _doorV.set(-(s.w / 2) - 0.62, 0, hingeZ - 0.35);
  return _doorV.applyEuler(c.rotation).add(c.position);
}
function startEnter(c) {
  state.inCar = true;            // state now; the sequence is visual
  state.carSpeed = 0;
  state.transition = {
    kind: 'enter', target: c, t: 0, dur: 0.9, swapped: false,
    from: player.position.clone(), focus: c.position,
  };
  hud.setPrompt(null);
}
function doEnterSwap(tr) {
  const c = tr.target;
  if (c.userData.parked) {
    c.userData.parked = false;
    c.userData.stolen = true;
    police.addWanted(1);
    hud.phone('MAMA ROSA', 'Mobil curian? Hati-hati, Dario. Polisi mengawasi.');
    peds.fleeFrom(player.position.x, player.position.z, 10);
  } else if (traffic.cars.includes(c)) {
    // carjacking: pull the car out of traffic until Dario gets out
    traffic.cars.splice(traffic.cars.indexOf(c), 1);
    c.userData.jacked = true;
    police.addWanted(1);
    peds.fleeFrom(player.position.x, player.position.z, 10);
  }
  player.visible = false;
  // swap active car if it is a parked/jacked one — and remember it,
  // plus the hero's own top speed, so the exit can restore both
  // (v3 audit semantics, unchanged)
  if (c !== car) {
    car.position.copy(c.position);
    car.rotation.copy(c.rotation);
    c.visible = false;
    state.stolenCar = c;
    state.heroMax = car.userData.maxSpeed;
    car.userData.maxSpeed = c.userData.maxSpeed || CFG.carMax;
    // the hero's door takes over the swing, mid-open
    setDoor(car, doorOpenAmt(c));
    setDoor(c, 0);
  }
  tr.doorFrom = doorOpenAmt(car);
  audio.play('chime');
  hud.center('MASUK MOBIL', IS_TOUCH
    ? 'Stick mengemudi · ACT keluar · BRK rem'
    : 'WASD mengemudi · E keluar · Spasi rem');
}
function startExit() {
  state.inCar = false;
  state.exitPending = false;
  // step out at the DRIVER side, where the door is
  const side = new THREE.Vector3(-1, 0, 0).applyEuler(car.rotation);
  player.position.copy(car.position).addScaledVector(side, 2.3);
  player.visible = true;
  state.heading = car.rotation.y;
  player.rotation.y = state.heading;
  // v3 audit: put the stolen car back where it was taken from and
  // give the convertible its own top speed back (v2 deleted the
  // stolen car from the world and kept whatever speed was last set)
  if (state.stolenCar) {
    const c = state.stolenCar;
    c.visible = true;
    if (c.userData.jacked) {
      // a jacked traffic car rejoins traffic and drives off
      c.userData.jacked = false;
      c.userData.speed = c.userData.maxSpeed;
      traffic.cars.push(c);
    } else {
      c.userData.parked = true;
      c.userData.stolen = false;
    }
    state.stolenCar = null;
    car.userData.maxSpeed = state.heroMax || CFG.carMax;
  }
  state.transition = {
    kind: 'exit', target: car, t: 0, dur: 0.7, swapped: true,
    from: player.position.clone(), focus: car.position,
  };
  hud.center('KELUAR MOBIL', '');
}
function tryEnterExitCar() {
  if (state.transition) {
    // mashing ACT during the entry queues the exit — the toggle
    // must never feel like the button was swallowed
    if (state.transition.kind === 'enter') state.transition.exitQueued = true;
    return;
  }
  if (state.inCar) {
    // at speed, ACT stands on the brakes first (never an eject)
    if (Math.abs(state.carSpeed) > 4) {
      state.exitPending = true;
      hud.center('MENGEREM…', 'Keluar setelah mobil berhenti');
      return;
    }
    startExit();
    return;
  }
  const c = nearestCar(4.5);
  if (c) startEnter(c);
}
// advance the enter/exit sequence; runs instead of updatePlayer /
// updateCar while state.transition is set
function advanceTransition(dt) {
  const tr = state.transition;
  tr.t += dt;
  const u = player.userData;
  if (tr.kind === 'enter') {
    const c = tr.target;
    if (!tr.swapped) {
      // walk to the driver door (live anchor), door swings open
      const anchor = doorAnchor(c);
      player.position.lerp(anchor, Math.min(1, dt * 9));
      player.rotation.y = Math.atan2(
        c.position.x - player.position.x, c.position.z - player.position.z);
      u.walkPhase += dt * 10;
      u.walk(u.walkPhase, 0.62, 0.04);
      const k = clamp((tr.t - 0.05) / 0.3, 0, 1);
      setDoor(c, k * k * (3 - 2 * k));
      tr.focus = c.position;
      if (tr.t >= 0.38) { doEnterSwap(tr); tr.swapped = true; }
    } else {
      // seated (hidden); the door swings shut behind him
      player.position.copy(car.position);
      const k = clamp((tr.t - 0.5) / 0.3, 0, 1);
      setDoor(car, (tr.doorFrom || 0.9) * (1 - k * k * (3 - 2 * k)));
      tr.focus = car.position;
      if (tr.t >= tr.dur) {
        setDoor(car, 0);
        state.transition = null;
        if (tr.exitQueued) startExit();
      }
    }
  } else {
    // exit: door opens, Dario is already stepping out, door closes
    const open = tr.t < 0.3
      ? clamp(tr.t / 0.25, 0, 1)
      : 1 - clamp((tr.t - 0.42) / 0.25, 0, 1);
    setDoor(car, open * open * (3 - 2 * open));
    u.idle();
    tr.focus = car.position;
    if (tr.t >= tr.dur) { setDoor(car, 0); state.transition = null; }
  }
  state.footSpeed = 0;
}
// the enter prompt: projected next to the car on desktop ("E —
// Masuk Mobil"), and on touch the ACT button glows as well
const _promptV = new THREE.Vector3();
function updateCarPrompt() {
  const actBtn = document.getElementById('btn-act');
  if (state.inCar || state.transition || state.mode !== 'playing') {
    state.nearCar = null;
    hud.setPrompt(null);
    if (actBtn) actBtn.classList.remove('glow');
    return;
  }
  const c = nearestCar(4.5);
  state.nearCar = c;
  if (!c) {
    hud.setPrompt(null);
    if (actBtn) actBtn.classList.remove('glow');
    return;
  }
  _promptV.set(c.position.x, 2.7, c.position.z).project(camera);
  if (_promptV.z > 1) { hud.setPrompt(null); return; }
  hud.setPrompt(
    IS_TOUCH ? 'MASUK MOBIL ▸ ACT' : 'E — MASUK MOBIL',
    (_promptV.x * 0.5 + 0.5) * innerWidth,
    (-_promptV.y * 0.5 + 0.5) * innerHeight
  );
  if (actBtn && IS_TOUCH) actBtn.classList.add('glow');
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
  refreshTouchUI();
}

// ---------- per-frame update ----------
const clock = new THREE.Clock();
let hudT = 0;
let frameNo = 0;

function updatePlayer(dt) {
  const u = player.userData;
  // v5: knocked down by a car — slide, tumble, get up; no control
  // until people.js clears the knock state
  if (u.knock) {
    updateKnock(player, dt);
    state.footSpeed = 0;
    state.sprinting = false;
    if (!u.knock) state.heading = player.rotation.y;
    collideBuildings(player.position, 0.45);
    return;
  }
  const k = state.keys;
  const runKey = k['ShiftLeft'] || k['ShiftRight'];
  // v5 input (amendment): the analog stick's speed is PROPORTIONAL
  // to deflection past the dead zone — a small push strolls, a full
  // push runs; the RUN button forces full run. The keyboard keeps
  // its digital walk/run split.
  let mx = 0, mz = 0, speed = 0;
  const sv = state.stickVec;
  if (sv.mag > 0.001) {
    mx = sv.x; mz = sv.y;
    const t = clamp((sv.mag - STICK_DEAD) / (1 - STICK_DEAD), 0, 1);
    speed = runKey ? CFG.playerRun : CFG.playerRun * t;
  } else {
    if (k['KeyW'] || k['ArrowUp']) mz += 1;
    if (k['KeyS'] || k['ArrowDown']) mz -= 1;
    if (k['KeyA'] || k['ArrowLeft']) mx -= 1;
    if (k['KeyD'] || k['ArrowRight']) mx += 1;
    speed = runKey ? CFG.playerRun : CFG.playerWalk;
  }
  if ((mx || mz) && speed > 0.01) {
    const len = Math.hypot(mx, mz) || 1;
    // input is relative to the camera's LOOK direction: the camera
    // sits at bearing camYaw from the player and looks back, so it
    // faces camYaw + π. (v3/v4 omitted the π — heading chased
    // camYaw while camYaw chased heading + π, and the pair rotated
    // forever: holding W ran Dario in a circle. With the π the
    // fixed point is exact: W runs straight away from camera.)
    const wantAng = Math.atan2(mx / len, mz / len) + state.camYaw + Math.PI;
    // v5 (amendment): the turn is RATE-LIMITED — Dario swings
    // around smoothly toward the input direction (relative to the
    // camera) instead of snapping to it
    let dh = wantAng - state.heading;
    while (dh > Math.PI) dh -= TAU;
    while (dh < -Math.PI) dh += TAU;
    state.heading += clamp(dh, -10.5 * dt, 10.5 * dt);
    const ang = state.heading;
    state.footSpeed = speed;
    // v5 gait (fix #6): the blend factor sf morphs the ANIMATION
    // with speed — relaxed upright walk at sf 0, wide-swinging
    // forward-leaning run at sf 1 — and the legs turn over faster
    const sf = clamp((speed - CFG.playerWalk) / (CFG.playerRun - CFG.playerWalk), 0, 1);
    state.sprinting = sf > 0.55;
    player.position.x += Math.sin(ang) * speed * dt;
    player.position.z += Math.cos(ang) * speed * dt;
    player.position.x = clamp(player.position.x, -208, 208);
    player.position.z = clamp(player.position.z, -208, 208);
    player.rotation.y = ang;
    const rate = 2.3 + 1.4 * sf;
    u.walkPhase += dt * speed * rate;
    u.walk(u.walkPhase, 0.5 + 0.48 * sf, 0.02 + 0.15 * sf);
    // bump peds aside
    for (const p of peds.peds) {
      const d = Math.hypot(p.position.x - player.position.x, p.position.z - player.position.z);
      if (d < 1.1) peds.fleeFrom(player.position.x, player.position.z, 6);
    }
  } else {
    state.footSpeed = 0;
    state.sprinting = false;
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
  // v5 (amendment): the analog stick drives too — up/down is
  // proportional throttle / brake-reverse, left/right steers.
  // The keyboard keeps its digital inputs when the stick is idle.
  const sv = state.stickVec;
  const stickDriving = sv.mag > STICK_DEAD;
  let throttle = 0;
  if (stickDriving) throttle = sv.y;
  else {
    if (k['KeyW'] || k['ArrowUp']) throttle += 1;
    if (k['KeyS'] || k['ArrowDown']) throttle -= 0.7;
  }
  const braking = !!k['Space'];
  if (braking) throttle = -1.4;
  // v5 amendment: ACT at speed does not eject — it stands on the
  // brakes, and the exit sequence starts once nearly stopped
  if (state.exitPending) {
    throttle = -2.2; // emergency stop: stood-on brakes, no coasting
    if (Math.abs(state.carSpeed) <= 4) {
      state.exitPending = false;
      startExit();
      return;
    }
  }
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
  if (stickDriving) steer = -sv.x;
  else {
    if (k['KeyA'] || k['ArrowLeft']) steer += 1;
    if (k['KeyD'] || k['ArrowRight']) steer -= 1;
  }
  if (state.exitPending) steer = 0;
  const spd = state.carSpeed;
  if (Math.abs(spd) > 0.5) {
    car.rotation.y += steer * CFG.carTurn * dt * clamp(Math.abs(spd) / 12, 0.3, 1) * Math.sign(spd);
  }
  const fwd = new THREE.Vector3(0, 0, 1).applyEuler(car.rotation);
  car.position.addScaledVector(fwd, spd * dt);
  car.position.x = clamp(car.position.x, -208, 208);
  car.position.z = clamp(car.position.z, -208, 208);
  // v5: the wheels finally turn — spin with travel, fronts steer
  rollWheels(car, spd * dt);
  steerWheels(car, steer * 0.45);
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
  // v5: hit peds -> they go DOWN (solid bodies, fix #4), the car
  // sheds speed, witnesses flee, wanted rises (kept from v3)
  for (const p of peds.peds) {
    const hit = carPersonHit(car, p, Math.abs(spd));
    if (!hit) continue;
    if (hit.knocked) {
      police.addWanted(1);
      peds.fleeFrom(car.position.x, car.position.z, 15);
      state.carSpeed *= 0.55;
      audio.play('punch');
    } else if (Math.abs(spd) > 0.5) {
      state.carSpeed *= 0.85;
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
  rollWheels(chaseTarget, u.speed * dt);
  // v5: the fleeing driver knocks people down too — nobody ghosts
  for (const p of peds.peds) carPersonHit(chaseTarget, p, Math.abs(u.speed));
  chaseTarget.position.x = clamp(chaseTarget.position.x, -205, 205);
  chaseTarget.position.z = clamp(chaseTarget.position.z, -205, 205);
  // v3: the chase car respects buildings too (it fled through them)
  collideBuildings(chaseTarget.position, 2.3);
}

// ---------- camera ----------
const camTarget = new THREE.Vector3();
let shotCamPos = null;
let shotCamTarget = null;
const _camV = new THREE.Vector3();
function updateCamera(dt) {
  // staged shots: snap to the composed camera, no drift
  if (SHOT && shotCamPos) {
    camera.position.copy(shotCamPos);
    camera.lookAt(shotCamTarget);
    return;
  }
  // v5 (fix #7): the drag offset EASES toward its target — the
  // approach is exponential, so it is monotonic with no overshoot
  // or jitter — and while moving (and not dragging) it recentres
  // gently behind the character/car on its own
  const dragging = camPointer !== null || mouseDrag !== null;
  const moving = state.inCar ? Math.abs(state.carSpeed) > 3 : state.footSpeed > 0.5;
  if (moving && !dragging && !state.transition) {
    state.camOffsetTarget *= Math.exp(-0.5 * dt);
    if (Math.abs(state.camOffsetTarget) < 0.002) state.camOffsetTarget = 0;
  }
  state.camOffset += (state.camOffsetTarget - state.camOffset) * (1 - Math.exp(-9 * dt));
  const dist = state.inCar ? 11 : 6.5;
  const height = state.inCar ? 4.5 : 3.0;
  if (state.transition) {
    // enter/exit sequence: glide around the car being used, keep
    // the current yaw (no snap), pull to chase distance on entry
    const f = state.transition.focus;
    _camV.set(f.x + Math.sin(state.camYaw) * dist, height, f.z + Math.cos(state.camYaw) * dist);
    camera.position.lerp(_camV, 1 - Math.exp(-5 * dt));
    collideBuildings(camera.position, 0.7);
    camTarget.lerp(_camV.set(f.x, f.y + 1.6, f.z), 1 - Math.exp(-7 * dt));
    camera.lookAt(camTarget);
    return;
  }
  const focus = state.inCar ? car.position : player.position;
  const heading = state.inCar ? car.rotation.y : state.heading;
  // camera yaw follows behind the focus (frame-rate independent
  // damping: the error shrinks smoothly every frame, never snaps)
  const wantYaw = heading + Math.PI + state.camOffset;
  let dy = wantYaw - state.camYaw;
  while (dy > Math.PI) dy -= TAU;
  while (dy < -Math.PI) dy += TAU;
  state.camYaw += dy * (1 - Math.exp(-4.2 * dt));
  const cx = focus.x + Math.sin(state.camYaw) * dist;
  const cz = focus.z + Math.cos(state.camYaw) * dist;
  camera.position.lerp(_camV.set(cx, height, cz), 1 - Math.exp(-6 * dt));
  // v3 audit: keep the chase camera out of buildings (it used to
  // clip inside facades whenever the player backed against a wall)
  collideBuildings(camera.position, 0.7);
  const lookY = focus.y + 1.6;
  camTarget.lerp(_camV.set(focus.x, lookY, focus.z), 1 - Math.exp(-8 * dt));
  camera.lookAt(camTarget);
  // v5 (fix #6): sprinting widens the FOV a touch — speed you can
  // feel; driving already had its own smaller kick
  const targetFov = 62 + (state.inCar
    ? clamp(Math.abs(state.carSpeed) / CFG.carMax, 0, 1) * 5
    : (state.sprinting ? 7 : 0));
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();
  }
}

// ---------- busted / wasted ----------
function showEnd(kind) {
  state.mode = kind;
  document.body.classList.remove('in-game');
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
  } else if (SHOT === 'sign') {
    // v5: STOP sign close-up — Dario reads the (now un-mirrored)
    // face from the approach side, mission guide live in the HUD
    const spot = worldInfo.signs.find((s) => s.kind === 'stop');
    state.inCar = false;
    missions.start(0);
    state.cash = 520;
    state.clockMin = 1135; // 18:55
    player.position.set(spot.x + 0.4, 0, spot.z + 3.6);
    state.heading = Math.PI;
    player.rotation.y = Math.PI;
    state.camYaw = 0;
    preroll(2);
    shotCamPos = new THREE.Vector3(spot.x + 1.1, 2.3, spot.z + 5.2);
    shotCamTarget = new THREE.Vector3(spot.x, 2.55, spot.z);
    camera.position.copy(shotCamPos);
    camera.lookAt(shotCamTarget);
  } else if (SHOT === 'car') {
    // v5: the rebuilt hero car — three-quarter view from the
    // driver side, door swung open (player hidden: he stood
    // between the camera and the car in the first staging)
    state.inCar = false;
    missions.start(0);
    state.cash = 1250;
    state.clockMin = 1140; // 19:00
    car.position.set(30, 0, 44);
    car.rotation.y = 0.6;
    player.visible = false;
    state.camYaw = 0.6 + Math.PI;
    preroll(2);
    if (car.userData.door) car.userData.door.rotation.y = 0.95;
    shotCamPos = new THREE.Vector3(24.2, 1.6, 47.9);
    shotCamTarget = new THREE.Vector3(30, 0.7, 44);
    camera.position.copy(shotCamPos);
    camera.lookAt(shotCamTarget);
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
    if (state.transition) advanceTransition(dt);
    else if (state.inCar) updateCar(dt);
    else updatePlayer(dt);
    traffic.playerPos = state.inCar ? car.position : player.position;
    traffic.playerOnFoot = !state.inCar && !state.transition;
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
    for (const pc of police.cars) {
      collideBuildings(pc.position, 2.3);
      rollWheels(pc, (pc.userData.speed || 0) * dt);
    }
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
    // v5 mission guide (fix #3): live bearing + distance to the
    // current objective, relative to the camera's view direction —
    // updated every frame so the arrow tracks as you turn
    {
      let target = null;
      if (missions.active && missions.current) {
        const def = missions.current;
        if (def.chase && chaseTarget.visible) target = chaseTarget.position;
        else if (!def.escape) target = { x: def.target[0], z: def.target[1] };
      }
      if (target) {
        const dx = target.x - playerPos.x, dz = target.z - playerPos.z;
        let rel = Math.atan2(dx, dz) - (state.camYaw + Math.PI);
        while (rel > Math.PI) rel -= TAU;
        while (rel < -Math.PI) rel += TAU;
        hud.setGuide(rel, Math.hypot(dx, dz));
      } else hud.setGuide(null);
    }
    updateCarPrompt();
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
  scene, camera, cityGroup, worldInfo, parked,
};
