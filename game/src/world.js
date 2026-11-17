// PALMBAY HEAT — world.js: procedural coastal city.
// Grid of streets + avenues, zoned blocks, beach + animated sea,
// port cranes, bridge, palms, lamps, neon signs. Golden hour.
// three.min.js (r152 global build) is loaded as a classic script
// before this module; it attaches window.THREE.
const THREE = window.THREE;
import { CFG, ZONE_COLORS, zoneAt, rng, TAU } from './config.js';

const PITCH = CFG.block + CFG.roadW; // 60
const HALF = (CFG.gridN * PITCH) / 2; // 210

export const worldInfo = {
  pitch: PITCH, half: HALF, gridN: CFG.gridN,
  roadY: 0.02,
};

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

function box(w, h, d, color, x, y, z, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true; m.receiveShadow = true;
  return m;
}

// emissive window texture, drawn once on a canvas
function windowTexture(rand, litRatio) {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#101418'; g.fillRect(0, 0, 64, 128);
  for (let y = 4; y < 124; y += 10) {
    for (let x = 4; x < 60; x += 10) {
      const lit = rand() < litRatio;
      g.fillStyle = lit ? (rand() < 0.6 ? '#ffd98a' : '#9fd8ff') : '#1c222c';
      g.fillRect(x, y, 6, 6);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function neonSign(text, color, w = 12) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#14101a'; g.fillRect(0, 0, 256, 64);
  g.font = 'bold 30px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 16;
  g.fillStyle = color;
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, w / 4),
    new THREE.MeshBasicMaterial({ map: t, transparent: false, side: THREE.DoubleSide })
  );
  return m;
}

export function buildWorld(scene, rand) {
  const group = new THREE.Group();
  group.name = 'city';

  // -- ground base --
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 260, HALF * 2 + 120),
    mat(0x6a5a48)
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-40, -0.05, 0);
  ground.receiveShadow = true;
  group.add(ground);

  // -- beach sand strip (west) --
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(70, HALF * 2 + 120),
    mat(0xe8c890)
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-HALF - 35, 0.0, 0);
  sand.receiveShadow = true;
  group.add(sand);

  // -- sea (animated in main loop via userData) --
  const seaGeo = new THREE.PlaneGeometry(320, HALF * 2 + 120, 24, 24);
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshLambertMaterial({
    color: 0x2a6a8a, transparent: true, opacity: 0.92,
  }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-HALF - 195, 0.4, 0);
  sea.userData.waves = true;
  sea.userData.base = seaGeo.attributes.position.array.slice();
  group.add(sea);
  group.userData.sea = sea;

  // -- roads + sidewalks --
  const roadMat = new THREE.MeshLambertMaterial({ color: CFG.road, shininess: 0 });
  // glossy wet look: use phong-ish via MeshPhongMaterial
  const wetRoad = new THREE.MeshPhongMaterial({
    color: CFG.road, shininess: 90, specular: 0x887766,
  });
  for (let i = 0; i <= CFG.gridN; i++) {
    const p = -HALF + i * PITCH;
    const wide = (i % CFG.avenueEvery === 0);
    const w = wide ? CFG.roadW + 6 : CFG.roadW;
    // north-south road
    const r1 = new THREE.Mesh(new THREE.PlaneGeometry(w, HALF * 2 + CFG.roadW), wetRoad);
    r1.rotation.x = -Math.PI / 2;
    r1.position.set(p, CFG.roadY, 0);
    r1.receiveShadow = true;
    group.add(r1);
    // east-west road
    const r2 = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2 + CFG.roadW, w), wetRoad);
    r2.rotation.x = -Math.PI / 2;
    r2.position.set(0, CFG.roadY, p);
    r2.receiveShadow = true;
    group.add(r2);
    // centre dashes
    for (let d = -HALF + 8; d < HALF - 4; d += 12) {
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, 3),
        mat(CFG.roadLine)
      );
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(p, CFG.roadY + 0.01, d);
      group.add(dash);
      const dash2 = dash.clone();
      dash2.position.set(d, CFG.roadY + 0.01, p);
      dash2.rotation.z = Math.PI / 2;
      group.add(dash2);
    }
  }

  // -- city blocks: buildings --
  const winTex = windowTexture(rand, 0.45);
  const buildings = [];
  const signs = [];
  for (let bx = 0; bx < CFG.gridN; bx++) {
    for (let bz = 0; bz < CFG.gridN; bz++) {
      const zone = zoneAt(bx, bz);
      const cx = -HALF + CFG.roadW / 2 + bx * PITCH + CFG.block / 2;
      const cz = -HALF + CFG.roadW / 2 + bz * PITCH + CFG.block / 2;
      const palette = ZONE_COLORS[zone];
      const nB = zone === 'downtown' ? 2 : (rand() < 0.5 ? 2 : 1);
      for (let k = 0; k < nB; k++) {
        const w = 12 + rand() * 14, d = 12 + rand() * 14;
        let h = 8 + rand() * 10;
        if (zone === 'downtown') h = 26 + rand() * 55;
        if (zone === 'port') h = 7 + rand() * 8;
        if (zone === 'beach') h = 7 + rand() * 12;
        const ox = (rand() - 0.5) * (CFG.block - w - 4);
        const oz = (rand() - 0.5) * (CFG.block - d - 4);
        const color = palette[Math.floor(rand() * palette.length)];
        const bmat = new THREE.MeshLambertMaterial({
          color, emissiveMap: winTex, emissive: 0xffffff,
          emissiveIntensity: 0.35,
        });
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bmat);
        b.position.set(cx + ox, h / 2, cz + oz);
        b.castShadow = true; b.receiveShadow = true;
        group.add(b);
        buildings.push(b);
        // rooftop box
        if (rand() < 0.5) {
          const rt = box(w * 0.3, 2, d * 0.3, 0x555560,
            cx + ox, h + 1, cz + oz);
          group.add(rt);
        }
      }
      // palms on beachfront + suburbs
      if (zone === 'beach' || zone === 'suburb') {
        const nP = 2 + Math.floor(rand() * 3);
        for (let p = 0; p < nP; p++) {
          const px = cx + (rand() - 0.5) * (CFG.block - 6);
          const pz = cz + (rand() - 0.5) * (CFG.block - 6);
          group.add(makePalm(px, pz, rand));
        }
      }
      // street lamps at block corners
      if ((bx + bz) % 2 === 0) {
        const lx = cx - CFG.block / 2 - 2, lz = cz - CFG.block / 2 - 2;
        group.add(makeLamp(lx, lz));
      }
    }
  }

  // -- neon signs (own names) --
  const signDefs = [
    { text: 'HOTEL SOLANA', color: '#ff5fa2', bx: 1, bz: 3, h: 9 },
    { text: "MAMA ROSA'S", color: '#ffb347', bx: 3, bz: 3, h: 8 },
    { text: 'PALM BAY MOTORS', color: '#59e6ff', bx: 4, bz: 2, h: 8 },
    { text: 'SUNSET PIER', color: '#ff7e5f', bx: 0, bz: 5, h: 9 },
  ];
  for (const s of signDefs) {
    const cx = -HALF + CFG.roadW / 2 + s.bx * PITCH + CFG.block / 2;
    const cz = -HALF + CFG.roadW / 2 + s.bz * PITCH + CFG.block / 2;
    const sign = neonSign(s.text, s.color);
    sign.position.set(cx, s.h, cz - CFG.block / 2 - 0.6);
    // face the road south of the block, so the text reads correctly
    sign.rotation.y = Math.PI;
    group.add(sign);
    signs.push(sign);
  }

  // -- port cranes (east edge) --
  for (let i = 0; i < 3; i++) {
    const x = HALF + 18, z = -HALF + 60 + i * 90;
    const crane = new THREE.Group();
    const leg1 = box(2, 26, 2, 0xd8542e, -6, 13, 0);
    const leg2 = box(2, 26, 2, 0xd8542e, 6, 13, 0);
    const top = box(26, 2, 3, 0xd8542e, 4, 26, 0);
    const cab = box(5, 4, 4, 0x333340, 0, 23, 0);
    crane.add(leg1, leg2, top, cab);
    crane.position.set(x, 0, z);
    group.add(crane);
    // containers
    for (let cI = 0; cI < 5; cI++) {
      const cc = box(8, 3, 3, [0x3a7a5a, 0xb85a2a, 0x2a5a8a, 0x8a2a3a][cI % 4],
        x - 14 + (cI % 3) * 9, 1.6, z + 22 + Math.floor(cI / 3) * 4);
      group.add(cc);
    }
  }

  // -- bridge over the bay (south-west) --
  const bridge = new THREE.Group();
  const deck = box(10, 1.5, 120, 0x6a6a72, -HALF - 60, 4, HALF - 40);
  bridge.add(deck);
  for (let i = 0; i < 4; i++) {
    const tower = box(2, 22, 3, 0x8a8a92, -HALF - 64, 12, HALF - 90 + i * 34);
    const tower2 = box(2, 22, 3, 0x8a8a92, -HALF - 56, 12, HALF - 90 + i * 34);
    bridge.add(tower, tower2);
  }
  group.add(bridge);

  // -- pier (west, into the sea) --
  const pier = box(8, 1, 60, 0x8a6a4a, -HALF - 30, 1.2, 60);
  group.add(pier);

  scene.add(group);
  return { group, buildings, signs };
}

function makePalm(x, z, rand) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.55, 7, 6),
    mat(0x7a5a3a)
  );
  trunk.position.y = 3.5;
  trunk.rotation.z = (rand() - 0.5) * 0.15;
  trunk.castShadow = true;
  g.add(trunk);
  const leafMat = mat(0x2a8a4a);
  for (let i = 0; i < 6; i++) {
    const leaf = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 4.5, 4), leafMat
    );
    const a = (i / 6) * TAU;
    leaf.position.set(Math.cos(a) * 1.6, 7.2, Math.sin(a) * 1.6);
    leaf.rotation.set(Math.sin(a) * 1.1, 0, -Math.cos(a) * 1.1);
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  return g;
}

function makeLamp(x, z) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.22, 6, 6), mat(0x333340)
  );
  pole.position.y = 3;
  pole.castShadow = true;
  g.add(pole);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd98a })
  );
  bulb.position.y = 6.2;
  g.add(bulb);
  g.position.set(x, 0, z);
  return g;
}

// road coordinate helpers (shared by traffic / missions)
export function roadCoord(i) { return -HALF + i * PITCH; }
export function nearestRoadCoord(v) {
  const i = Math.round((v + HALF) / PITCH);
  return roadCoord(Math.max(0, Math.min(CFG.gridN, i)));
}
export function onRoad(x, z) {
  const dx = Math.abs(x - nearestRoadCoord(x));
  const dz = Math.abs(z - nearestRoadCoord(z));
  return dx < CFG.roadW / 2 + 1 || dz < CFG.roadW / 2 + 1;
}
