// PALMBAY HEAT — config.js (v2): palette + scale tables, city layout,
// tuning. ONE art direction for the whole game: every builder reads
// PALETTE / SCALE below — no per-object improvised colours or sizes.
// San Andreas benchmark: warm orange->teal sunset, textured surfaces,
// door 2.1 m, car ~4.4 m, palm 7-10 m.
export const PALETTE = {
  // sky / atmosphere (fog colour MUST equal the horizon colour)
  skyTop: 0x2f6db3,
  skyMid: 0xe2703a,
  horizon: 0xffd9a0,
  fog: 0xf7b267,
  sun: 0xffb347,
  sunLight: 0xffd9a8,
  hemiSky: 0x9fc3e8,
  hemiGround: 0x8a6a4f,
  // ground
  asphalt: '#3b3e44',
  asphaltPatch: '#33363b',
  sidewalk: '#b3aa97',
  curb: '#8f887a',
  sand: '#e6cf9e',
  grass: '#5d9c4e',
  dirt: '#7a6a52',
  water: 0x2e8fa3,
  waterHi: 0x7fd4d9,
  // vegetation
  palmTrunk: 0x8a6a4a,
  palmLeaf: 0x3f9e4d,
  leafyLeaf: 0x4c9440,
  // buildings: pastel art-deco walls (Miami / Vice City read)
  wallPastels: ['#f3e2c7', '#eec39a', '#dfe9ec', '#f2c4ce', '#cfe3ee', '#f7ead9'],
  windowDark: '#2c3e50',
  windowLit: '#ffd98a',
  roofDark: 0x555560,
  // cars
  carPaints: [0xc0392b, 0xe67e22, 0xf1c40f, 0x2980b9, 0xecf0f1, 0x2c3e50, 0x8e44ad],
  heroRed: 0xc0392b,
  // people / gangs
  skinTones: [0xd9a066, 0xc98a5a, 0x8a5a3a, 0xe8b88a],
  shirts: [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71, 0x9b59b6, 0xecf0f1, 0x1abc9c, 0xfd79a8],
  pants: [0x2c3e50, 0x34495e, 0x7f8c8d, 0x5d4037, 0x1a1a2e],
  gangGreen: 0x2e9e4a,   // Palm Bay local gang colour (Grove-style green)
  gangBandana: 0x27ae60,
  policeNavy: 0x1c2a44,
  policeBlack: 0x14141c,
};

// Scale table — metres. Every model reads these; nothing is eyeballed.
export const SCALE = {
  doorH: 2.1,
  floorH: 3.1,
  personH: 1.8,
  carL: 4.4,
  carW: 1.8,
  carH: 1.35,
  wheelR: 0.34,
  palmH: 8.5,
  treeH: 5.5,
  laneW: 3.4,
  sidewalkW: 2.6,
  lampH: 5.2,
};

export const CFG = {
  // -- palette (golden hour, SA sunset) --
  skyTop: PALETTE.skyTop,
  skyMid: PALETTE.skyMid,
  skyLow: PALETTE.horizon,
  fog: PALETTE.fog,
  fogNear: 70,
  fogFar: 380,
  sunColor: PALETTE.sunLight,
  sunIntensity: 3.0,
  hemiSky: PALETTE.hemiSky,
  hemiGround: PALETTE.hemiGround,
  hemiIntensity: 0.9,
  ambient: 0x604a55,
  road: 0x3b3e44,
  roadLine: 0xd8c86a,
  sidewalk: 0xb3aa97,
  roadY: 0.02,           // road surface height (lanes sit just above it)
  exposure: 1.15,
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
  playerWalk: 7,
  playerRun: 11,
  carAccel: 26,
  carBrake: 40,
  carMax: 34,
  carTurn: 1.9,
  trafficCount: 26,
  pedCount: 30,
  wantedMax: 5,
  missionReward: [400, 650, 900, 1200, 2500],
  startCash: 120,
  playerHealth: 100,
  // gang turf on the map (block coords bx 5..6, bz 1..2) — green tint
  // on the minimap and the gang's home ground for the staged group.
  gangTurf: { bx0: 5, bz0: 1, bx1: 6, bz1: 2 },
};

export function zoneAt(bx, bz) {
  if (bx <= 1) return 'beach';
  if (bx >= 5 && bz >= 5) return 'port';
  if (bx >= 2 && bx <= 4 && bz >= 2 && bz <= 4) return 'downtown';
  return 'suburb';
}

// Pastel art-deco walls per zone — picked from PALETTE.wallPastels,
// never random RGB.
export const ZONE_COLORS = {
  beach: ['#f3e2c7', '#f2c4ce', '#f7ead9', '#cfe3ee'],
  downtown: ['#dfe9ec', '#cfe3ee', '#f3e2c7', '#eec39a'],
  port: ['#d8c8b8', '#c8b8a8', '#e0d0c0', '#b8a898'],
  suburb: ['#f7ead9', '#eec39a', '#f3e2c7', '#dfe9ec'],
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
