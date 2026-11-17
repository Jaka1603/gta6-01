// PALMBAY HEAT — config: palette, city layout, tuning.
// All values original; golden-hour sunset look.
export const CFG = {
  // -- palette (golden hour) --
  skyTop: 0x2e4a7a, skyMid: 0xff7e5f, skyLow: 0xffb36b,
  fog: 0xf2a06b, fogNear: 90, fogFar: 420,
  sunColor: 0xffd9a0, sunIntensity: 1.9,
  hemiSky: 0x8fb8d8, hemiGround: 0x5a3a2a, hemiIntensity: 0.9,
  ambient: 0x604a55,
  road: 0x3a3a44, roadLine: 0xd8c86a,
  sidewalk: 0x8a7f72,
  // -- city layout --
  block: 46,          // block size (m)
  roadW: 14,          // road width (m)
  gridN: 7,           // blocks per side (7x7)
  // derived: pitch = block + roadW = 60; city spans -210..210
  avenueEvery: 3,     // every 3rd street is a wide avenue
  // zones by block coords (bx,bz in 0..6)
  // beach west (bx 0..1), downtown centre (bx 2..4, bz 2..4),
  // port east (bx 5..6, bz 5..6), suburbs elsewhere
  // -- tuning --
  playerWalk: 7, playerRun: 11,
  carAccel: 26, carBrake: 40, carMax: 34, carTurn: 1.9,
  trafficCount: 26, pedCount: 30,
  wantedMax: 5,
  missionReward: [400, 650, 900, 1200, 2500],
  startCash: 120,
  playerHealth: 100,
};

export function zoneAt(bx, bz) {
  if (bx <= 1) return 'beach';
  if (bx >= 5 && bz >= 5) return 'port';
  if (bx >= 2 && bx <= 4 && bz >= 2 && bz <= 4) return 'downtown';
  return 'suburb';
}

export const ZONE_COLORS = {
  beach: [0xf2c9a0, 0xf7d7b0, 0xe8b48a, 0xf5e6d0],
  downtown: [0x9fb8cc, 0x7d9db8, 0xb8c8d8, 0x6a8aa8],
  port: [0x8a7a6a, 0x7a6a5a, 0x9a8a7a, 0x6a5a4a],
  suburb: [0xd8b8a0, 0xc8a890, 0xe0c8b0, 0xb89a80],
};

// mulberry32 seeded RNG — deterministic shots
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const TAU = Math.PI * 2;
