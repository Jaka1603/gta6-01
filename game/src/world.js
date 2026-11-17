// PALMBAY HEAT — world.js (v2): procedural coastal city, SA-grade.
// Every surface textured (asphalt, sidewalks, facades with lit windows,
// sand, grass, water, planks); pastel art-deco buildings; palms via
// InstancedMesh; power poles + sagging cables; billboards; arched bridge;
// pier; port cranes. City layout is data — the minimap reads it too.
const THREE = window.THREE;
import { CFG, PALETTE, SCALE, ZONE_COLORS, zoneAt, rng, TAU } from './config.js';
import {
  canvasTexture, asphaltTexture, laneTexture, sidewalkTexture,
  facadeTextures, sandTexture, groundTexture, waterTexture,
  plankTexture, glowTexture, billboardTexture,
} from './textures.js';

const PITCH = CFG.block + CFG.roadW; // 60
const HALF = (CFG.gridN * PITCH) / 2; // 210

export const worldInfo = {
  pitch: PITCH,
  half: HALF,
  gridN: CFG.gridN,
  roadY: 0.02,
  blocks: [],          // {x0,z0,x1,z1,zone} — minimap reads this
  gangTurf: null,      // world rect of the gang territory
};

function mat(color, opts = {}) {
  return new THREE.MeshLambertMaterial({ color, ...opts });
}

function box(w, h, d, color, x, y, z, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, opts));
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

function neonSign(text, color, w = 9) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = '#14101a'; g.fillRect(0, 0, 256, 64);
  g.font = 'bold 28px Arial, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = color; g.shadowBlur = 16;
  g.fillStyle = color;
  g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, w / 4),
    new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide })
  );
}

export function buildWorld(scene, rand) {
  const group = new THREE.Group();
  group.name = 'city';
  const glowTex = glowTexture();

  // -- shared textures (one paint job, reused everywhere) --
  const asphalt = asphaltTexture(rand);
  const laneTex = laneTexture();
  const sidewalkTex = sidewalkTexture(rand);
  const sandTex = sandTexture(rand);
  const groundTex = groundTexture(rand);
  const waterTex = waterTexture(rand);
  const plankTex = plankTexture(rand);
  groundTex.repeat.set(60, 60);
  sandTex.repeat.set(8, 40);
  waterTex.repeat.set(24, 24);

  // -- facade variants: 6 pastel walls x 3 size classes (S/M/L) --
  // Windows stay ~1.5-2 m wide because the repeat is set per class.
  const facadeClasses = [];
  const classRepeat = [[1, 1], [1.6, 1.8], [2.4, 3.2]];
  for (let v = 0; v < 6; v++) {
    const wall = PALETTE.wallPastels[v % PALETTE.wallPastels.length];
    const perClass = [];
    for (let ci = 0; ci < 3; ci++) {
      const ft = facadeTextures(rand, {
        wall, cols: 5, rows: 9, litRatio: 0.35,
      });
      ft.map.repeat.set(classRepeat[ci][0], classRepeat[ci][1]);
      ft.emissiveMap.repeat.set(classRepeat[ci][0], classRepeat[ci][1]);
      perClass.push(new THREE.MeshStandardMaterial({
        map: ft.map,
        emissiveMap: ft.emissiveMap,
        emissive: 0xffb35c,
        emissiveIntensity: 1.0,
        roughness: 0.9,
        metalness: 0.0,
      }));
    }
    facadeClasses.push(perClass);
  }

  // -- ground base: textured grass/dirt outside the grid --
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 300, HALF * 2 + 160),
    new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-40, -0.05, 0);
  ground.receiveShadow = true;
  group.add(ground);

  // -- beach sand strip (west) --
  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(40, HALF * 2 + 160),
    new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.set(-HALF - 20, 0.0, 0);
  sand.receiveShadow = true;
  group.add(sand);

  // -- sea (animated texture offset + gentle vertex waves) --
  const seaGeo = new THREE.PlaneGeometry(320, HALF * 2 + 160, 24, 24);
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({
    map: waterTex, roughness: 0.25, metalness: 0.05,
    transparent: true, opacity: 0.94,
  }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-HALF - 205, 0.4, 0);
  sea.userData.waves = true;
  sea.userData.base = seaGeo.attributes.position.array.slice();
  sea.userData.waterTex = waterTex;
  group.add(sea);
  group.userData.sea = sea;

  // -- roads + lane strips + sidewalks + crosswalks --
  const roadLen = HALF * 2 + CFG.roadW;
  for (let i = 0; i <= CFG.gridN; i++) {
    const p = -HALF + i * PITCH;
    const wide = (i % CFG.avenueEvery === 0);
    const w = wide ? CFG.roadW + 6 : CFG.roadW;
    // asphalt (texture cloned per road so the repeat fits its size)
    for (const horizontal of [false, true]) {
      const t = asphalt.clone();
      t.needsUpdate = true;
      t.repeat.set(w / 9, roadLen / 9);
      const rmat = new THREE.MeshStandardMaterial({
        map: t, roughness: 0.55, metalness: 0.08,
      });
      const r = new THREE.Mesh(
        new THREE.PlaneGeometry(horizontal ? roadLen : w, horizontal ? w : roadLen),
        rmat
      );
      r.rotation.x = -Math.PI / 2;
      r.position.set(p, CFG.roadY, 0);
      if (horizontal) r.position.set(0, CFG.roadY, p);
      r.receiveShadow = true;
      group.add(r);
      // lane markings strip (dashed yellow centre + white edges)
      const lt = laneTex.clone();
      lt.needsUpdate = true;
      lt.repeat.set(1, roadLen / 8);
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(horizontal ? roadLen : w, horizontal ? w : roadLen),
        new THREE.MeshBasicMaterial({
          map: lt, transparent: true, depthWrite: false,
          polygonOffset: true, polygonOffsetFactor: -1,
        })
      );
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(p, CFG.roadY + 0.02, 0);
      if (horizontal) {
        strip.position.set(0, CFG.roadY + 0.02, p);
        strip.rotation.z = Math.PI / 2;
      }
      group.add(strip);
      // sidewalks: textured slabs on both edges of the road
      for (const side of [-1, 1]) {
        const st = sidewalkTex.clone();
        st.needsUpdate = true;
        st.repeat.set(1, roadLen / 4);
        const sw = new THREE.Mesh(
          new THREE.PlaneGeometry(SCALE.sidewalkW, roadLen),
          new THREE.MeshStandardMaterial({ map: st, roughness: 0.95 })
        );
        sw.rotation.x = -Math.PI / 2;
        if (horizontal) {
          sw.position.set(0, 0.06, p + side * (w / 2 + SCALE.sidewalkW / 2));
          sw.rotation.z = Math.PI / 2;
        } else {
          sw.position.set(p + side * (w / 2 + SCALE.sidewalkW / 2), 0.06, 0);
        }
        sw.receiveShadow = true;
        group.add(sw);
      }
    }
    // crosswalks on avenue intersections
    if (i % CFG.avenueEvery === 0) {
      for (let j = 0; j <= CFG.gridN; j += CFG.avenueEvery) {
        const q = -HALF + j * PITCH;
        const cwTex = canvasTexture(128, 64, (ctx, cw, ch) => {
          ctx.fillStyle = 'rgba(0,0,0,0)';
          ctx.clearRect(0, 0, cw, ch);
          ctx.fillStyle = 'rgba(245,245,235,0.92)';
          for (let x = 6; x < cw; x += 20) ctx.fillRect(x, 6, 10, ch - 12);
        });
        const cw = new THREE.Mesh(
          new THREE.PlaneGeometry(13, 5),
          new THREE.MeshBasicMaterial({
            map: cwTex, transparent: true, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -2,
          })
        );
        cw.rotation.x = -Math.PI / 2;
        cw.position.set(p, CFG.roadY + 0.03, q + 8);
        group.add(cw);
        const cw2 = cw.clone();
        cw2.rotation.z = Math.PI / 2;
        cw2.position.set(p + 8, CFG.roadY + 0.03, q);
        group.add(cw2);
      }
    }
  }

  // -- city blocks: buildings + palms + lamps --
  const buildings = [];
  const signs = [];
  const blockBuildings = {};   // "bx,bz" -> [ {x,z,w,d,h} ] for sign mounting
  const palmSpots = [];
  const treeSpots = [];
  const awningColors = [0x2a9d8f, 0xe76f51, 0xf1c40f, 0x8e44ad, 0x2980b9];
  for (let bx = 0; bx < CFG.gridN; bx++) {
    for (let bz = 0; bz < CFG.gridN; bz++) {
      const zone = zoneAt(bx, bz);
      const cx = -HALF + CFG.roadW / 2 + bx * PITCH + CFG.block / 2;
      const cz = -HALF + CFG.roadW / 2 + bz * PITCH + CFG.block / 2;
      worldInfo.blocks.push({
        x0: cx - CFG.block / 2, z0: cz - CFG.block / 2,
        x1: cx + CFG.block / 2, z1: cz + CFG.block / 2, zone,
      });
      const palette = ZONE_COLORS[zone];
      const nB = zone === 'downtown' ? 2 : (rand() < 0.5 ? 2 : 1);
      blockBuildings[bx + ',' + bz] = [];
      for (let k = 0; k < nB; k++) {
        const w = 12 + rand() * 14, d = 12 + rand() * 14;
        let h = 8 + rand() * 10;
        if (zone === 'downtown') h = 26 + rand() * 55;
        if (zone === 'port') h = 7 + rand() * 8;
        if (zone === 'beach') h = 7 + rand() * 12;
        const ox = (rand() - 0.5) * (CFG.block - w - 4);
        const oz = (rand() - 0.5) * (CFG.block - d - 4);
        const color = palette[Math.floor(rand() * palette.length)];
        const ci = h < 15 ? 0 : (h < 40 ? 1 : 2);
        const vi = Math.floor(rand() * facadeClasses.length);
        // pastel tint over the facade texture (keeps variety inside the palette)
        const bmat = facadeClasses[vi][ci].clone();
        bmat.color = new THREE.Color(color);
        const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), bmat);
        b.position.set(cx + ox, h / 2, cz + oz);
        b.castShadow = true;
        b.receiveShadow = true;
        group.add(b);
        buildings.push(b);
        blockBuildings[bx + ',' + bz].push({ x: cx + ox, z: cz + oz, w, d, h });
        // roof cap + AC / water-tank props
        const cap = box(w + 0.3, 0.3, d + 0.3, PALETTE.roofDark,
          cx + ox, h + 0.15, cz + oz);
        group.add(cap);
        if (rand() < 0.6) {
          const ac = box(2.2, 1.1, 1.6, 0x9a9aa2,
            cx + ox + (rand() - 0.5) * w * 0.5, h + 0.85, cz + oz + (rand() - 0.5) * d * 0.5);
          group.add(ac);
        }
        if (zone === 'downtown' && rand() < 0.4) {
          const tank = new THREE.Mesh(
            new THREE.CylinderGeometry(1.2, 1.2, 2.4, 8), mat(0x7a5a3a)
          );
          tank.position.set(cx + ox + w * 0.25, h + 1.5, cz + oz - d * 0.25);
          tank.castShadow = true;
          group.add(tank);
        }
        // shopfront awning on the south face (street level is what the camera sees)
        if ((zone === 'beach' || zone === 'downtown' || zone === 'suburb') && rand() < 0.55) {
          const aw = new THREE.Mesh(
            new THREE.BoxGeometry(Math.min(w * 0.7, 10), 0.18, 2.2),
            new THREE.MeshStandardMaterial({
              color: awningColors[Math.floor(rand() * awningColors.length)],
              roughness: 0.8,
            })
          );
          aw.position.set(cx + ox, 3.4, cz + oz - d / 2 - 1.0);
          aw.rotation.x = 0.35;
          aw.castShadow = true;
          group.add(aw);
        }
        // balconies on beachfront buildings
        if (zone === 'beach' && h > 9) {
          for (let f = 1; f <= 2; f++) {
            const bal = box(Math.min(w * 0.6, 8), 0.2, 1.4, 0xf7ead9,
              cx + ox, 3.1 + f * 3.1, cz + oz - d / 2 - 0.6);
            group.add(bal);
          }
        }
      }
      // palms on beachfront + suburbs, leafy trees downtown/suburb
      if (zone === 'beach' || zone === 'suburb') {
        const nP = 2 + Math.floor(rand() * 3);
        for (let p = 0; p < nP; p++) {
          palmSpots.push({
            x: cx + (rand() - 0.5) * (CFG.block - 6),
            z: cz + (rand() - 0.5) * (CFG.block - 6),
            lean: (rand() - 0.5) * 0.22,
            rot: rand() * TAU,
            s: 0.85 + rand() * 0.35,
          });
        }
      }
      if (zone === 'downtown' || zone === 'suburb') {
        const nT = 1 + Math.floor(rand() * 2);
        for (let p = 0; p < nT; p++) {
          treeSpots.push({
            x: cx + (rand() - 0.5) * (CFG.block - 8),
            z: cz + (rand() - 0.5) * (CFG.block - 8),
            s: 0.8 + rand() * 0.5,
          });
        }
      }
      // street lamps at block corners
      if ((bx + bz) % 2 === 0) {
        const lx = cx - CFG.block / 2 - 2, lz = cz - CFG.block / 2 - 2;
        group.add(makeLamp(lx, lz, glowTex));
      }
    }
  }

  // -- beachfront avenue palm rows (the cover shot's leading line) --
  for (let z = -HALF + 10; z < HALF - 6; z += 18) {
    palmSpots.push({
      x: -HALF + CFG.roadW + 3.2, z, lean: (rand() - 0.5) * 0.18,
      rot: rand() * TAU, s: 0.95 + rand() * 0.25,
    });
    if (rand() < 0.7) {
      palmSpots.push({
        x: -HALF - 3.2, z: z + 9, lean: (rand() - 0.5) * 0.18,
        rot: rand() * TAU, s: 0.9 + rand() * 0.3,
      });
    }
  }

  // -- palms: instanced trunks + instanced fronds (2 draw calls total) --
  {
    const dummy = new THREE.Object3D();
    const trunkGeo = new THREE.CylinderGeometry(0.14, 0.24, SCALE.palmH, 6);
    trunkGeo.translate(0, SCALE.palmH / 2, 0);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: PALETTE.palmTrunk, roughness: 1,
    });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmSpots.length);
    const frondGeo = new THREE.ConeGeometry(0.75, 4.4, 4);
    frondGeo.translate(0, 2.2, 0);
    frondGeo.scale(1, 1, 0.28);   // flattened palm frond
    const frondMat = new THREE.MeshStandardMaterial({
      color: PALETTE.palmLeaf, roughness: 0.9, side: THREE.DoubleSide,
    });
    const fronds = new THREE.InstancedMesh(
      frondGeo, frondMat, palmSpots.length * 8
    );
    palmSpots.forEach((p, i) => {
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, p.rot, p.lean);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      for (let f = 0; f < 8; f++) {
        const a = (f / 8) * TAU + p.rot;
        dummy.position.set(
          p.x + Math.cos(a) * 1.1 * p.s,
          SCALE.palmH * p.s - 0.4,
          p.z + Math.sin(a) * 1.1 * p.s
        );
        // droop outward-down from the crown
        dummy.rotation.set(
          Math.sin(a) * 1.15, 0, -Math.cos(a) * 1.15
        );
        dummy.scale.setScalar(p.s);
        dummy.updateMatrix();
        fronds.setMatrixAt(i * 8 + f, dummy.matrix);
      }
    });
    trunks.castShadow = true;
    fronds.castShadow = true;
    trunks.instanceMatrix.needsUpdate = true;
    fronds.instanceMatrix.needsUpdate = true;
    trunks.frustumCulled = false;
    fronds.frustumCulled = false;
    group.add(trunks, fronds);
  }

  // -- leafy trees: instanced trunks + instanced canopies --
  {
    const dummy = new THREE.Object3D();
    const tGeo = new THREE.CylinderGeometry(0.16, 0.24, 3.2, 6);
    tGeo.translate(0, 1.6, 0);
    const tMat = new THREE.MeshStandardMaterial({ color: 0x6a4a30, roughness: 1 });
    const trunks = new THREE.InstancedMesh(tGeo, tMat, treeSpots.length);
    const cGeo = new THREE.IcosahedronGeometry(2.2, 0);
    const cMat = new THREE.MeshStandardMaterial({
      color: PALETTE.leafyLeaf, roughness: 1, flatShading: true,
    });
    const canopies = new THREE.InstancedMesh(cGeo, cMat, treeSpots.length * 2);
    treeSpots.forEach((p, i) => {
      dummy.position.set(p.x, 0, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(p.s);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      dummy.position.set(p.x, 4.4 * p.s, p.z);
      dummy.scale.set(p.s, p.s * 0.75, p.s);
      dummy.updateMatrix();
      canopies.setMatrixAt(i * 2, dummy.matrix);
      dummy.position.set(p.x + 1.4 * p.s, 3.6 * p.s, p.z + 0.8 * p.s);
      dummy.scale.setScalar(p.s * 0.7);
      dummy.updateMatrix();
      canopies.setMatrixAt(i * 2 + 1, dummy.matrix);
    });
    trunks.castShadow = true;
    canopies.castShadow = true;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    trunks.frustumCulled = false;
    canopies.frustumCulled = false;
    group.add(trunks, canopies);
  }

  // -- power poles + sagging cables along the beachfront avenue --
  {
    const poleMat = mat(0x4a3a28);
    const cableMat = new THREE.LineBasicMaterial({ color: 0x1a1a1a });
    const poleTops = [];
    for (let z = -HALF + 20; z < HALF - 10; z += 40) {
      const x = -HALF + CFG.roadW + 6.4;
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.18, 7.5, 6), poleMat
      );
      pole.position.set(x, 3.75, z);
      pole.castShadow = true;
      group.add(pole);
      const arm = box(2.6, 0.18, 0.18, 0x4a3a28, x, 7.1, z);
      group.add(arm);
      poleTops.push(new THREE.Vector3(x - 1.2, 7.0, z));
      poleTops.push(new THREE.Vector3(x + 1.2, 7.0, z));
    }
    // sagging cables between consecutive poles (both wires)
    for (let w = 0; w < 2; w++) {
      for (let i = 0; i + 2 < poleTops.length; i += 2) {
        const a = poleTops[i + w], b = poleTops[i + 2 + w];
        const mid = a.clone().lerp(b, 0.5);
        mid.y -= 1.1;   // sag
        const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
        const pts = curve.getPoints(8);
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        group.add(new THREE.Line(geo, cableMat));
      }
    }
  }

  // -- neon signs mounted on real building faces (never floating) --
  const signDefs = [
    { text: 'HOTEL SOLANA', color: '#ff5fa2', bx: 1, bz: 3, h: 9 },
    { text: "MAMA ROSA'S", color: '#ffb347', bx: 3, bz: 3, h: 8 },
    { text: 'PALM BAY MOTORS', color: '#59e6ff', bx: 4, bz: 2, h: 8 },
    { text: 'SUNSET PIER', color: '#ff7e5f', bx: 0, bz: 5, h: 9 },
  ];
  for (const s of signDefs) {
    const list = blockBuildings[s.bx + ',' + s.bz] || [];
    if (!list.length) continue;
    // southmost building in the block — its south face carries the sign
    const b = list.reduce((a, c) => (c.z - c.d / 2 < a.z - a.d / 2 ? c : a));
    const sign = neonSign(s.text, s.color);
    sign.position.set(b.x, Math.min(s.h, b.h - 1.5), b.z - b.d / 2 - 0.35);
    sign.rotation.y = Math.PI;   // face the road south of the block
    group.add(sign);
    signs.push(sign);
  }

  // -- painted billboards on downtown rooftops --
  const boardDefs = [
    { text: 'PALM BAY MOTORS', sub: 'DEALS THAT SIZZLE', bg: '#e76f51', fg: '#fff3e0', bx: 4, bz: 2 },
    { text: 'HOTEL SOLANA', sub: 'SLEEP BY THE SEA', bg: '#2a9d8f', fg: '#f0fff8', bx: 2, bz: 4 },
  ];
  for (const bd of boardDefs) {
    const list = blockBuildings[bd.bx + ',' + bd.bz] || [];
    if (!list.length) continue;
    const b = list[0];
    const tex = billboardTexture(bd.text, bd.sub, bd.bg, bd.fg);
    const board = new THREE.Mesh(
      new THREE.PlaneGeometry(16, 8),
      new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
    );
    board.position.set(b.x, b.h + 5, b.z - b.d / 2 + 1);
    board.rotation.y = Math.PI;
    group.add(board);
    const post1 = box(0.3, 4, 0.3, 0x333340, b.x - 6, b.h + 2, b.z - b.d / 2 + 0.8);
    const post2 = box(0.3, 4, 0.3, 0x333340, b.x + 6, b.h + 2, b.z - b.d / 2 + 0.8);
    group.add(post1, post2);
  }

  // -- port cranes + containers (east edge) --
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
    for (let cI = 0; cI < 5; cI++) {
      const cc = box(8, 3, 3, [0x3a7a5a, 0xb85a2a, 0x2a5a8a, 0x8a2a3a][cI % 4],
        x - 14 + (cI % 3) * 9, 1.6, z + 22 + Math.floor(cI / 3) * 4);
      group.add(cc);
    }
  }

  // -- arched bridge over the bay (south-west), deck in 7 segments --
  {
    const bridge = new THREE.Group();
    const segs = 7;
    for (let i = 0; i < segs; i++) {
      const t0 = i / segs, t1 = (i + 1) / segs;
      const x0 = -HALF - 150 + t0 * 160, x1 = -HALF - 150 + t1 * 160;
      const y0 = 2 + Math.sin(t0 * Math.PI) * 7;
      const y1 = 2 + Math.sin(t1 * Math.PI) * 7;
      const len = Math.hypot(x1 - x0, y1 - y0);
      const seg = box(len, 1.5, 10, 0x6a6a72, (x0 + x1) / 2, (y0 + y1) / 2, HALF - 20);
      seg.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      bridge.add(seg);
    }
    for (const tx of [-HALF - 100, -HALF - 50]) {
      const tower = box(2, 26, 3, 0x8a8a92, tx, 13, HALF - 25);
      const tower2 = box(2, 26, 3, 0x8a8a92, tx, 13, HALF - 15);
      bridge.add(tower, tower2);
    }
    group.add(bridge);
  }

  // -- pier into the sea (west), plank texture + railing posts --
  {
    const pier = new THREE.Mesh(
      new THREE.BoxGeometry(60, 1, 8),
      new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.9 })
    );
    pier.position.set(-HALF - 60, 1.0, 60);
    pier.castShadow = true;
    pier.receiveShadow = true;
    group.add(pier);
    const postGeo = new THREE.CylinderGeometry(0.09, 0.09, 1.1, 5);
    const postMat = mat(0x5a4028);
    const posts = new THREE.InstancedMesh(postGeo, postMat, 32);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < 16; i++) {
      const x = -HALF - 88 + i * 4;
      dummy.position.set(x, 2.0, 56.2);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      posts.setMatrixAt(i * 2, dummy.matrix);
      dummy.position.set(x, 2.0, 63.8);
      dummy.updateMatrix();
      posts.setMatrixAt(i * 2 + 1, dummy.matrix);
    }
    posts.instanceMatrix.needsUpdate = true;
    group.add(posts);
  }

  // -- promenade fence between sidewalk and sand (beachfront) --
  {
    const fenceTex = canvasTexture(128, 64, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(220,220,220,0.85)';
      ctx.lineWidth = 2;
      for (let x = -h; x < w + h; x += 12) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + h, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + h, 0); ctx.lineTo(x, h); ctx.stroke();
      }
    });
    const fence = new THREE.Mesh(
      new THREE.PlaneGeometry(360, 1.2),
      new THREE.MeshBasicMaterial({
        map: fenceTex, transparent: true, side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    fenceTex.repeat.set(30, 1);
    fence.position.set(-HALF - 8, 0.7, 0);
    fence.rotation.y = Math.PI / 2;
    group.add(fence);
  }

  // gang territory in world coords (for minimap tint + staging)
  {
    const g = CFG.gangTurf;
    const x0 = -HALF + CFG.roadW / 2 + g.bx0 * PITCH;
    const x1 = -HALF + CFG.roadW / 2 + g.bx1 * PITCH + CFG.block;
    const z0 = -HALF + CFG.roadW / 2 + g.bz0 * PITCH;
    const z1 = -HALF + CFG.roadW / 2 + g.bz1 * PITCH + CFG.block;
    worldInfo.gangTurf = { x0, z0, x1, z1 };
  }

  scene.add(group);
  return { group, buildings, signs };
}

function makeLamp(x, z, glowTex) {
  const g = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.2, SCALE.lampH, 6), mat(0x333340)
  );
  pole.position.y = SCALE.lampH / 2;
  pole.castShadow = true;
  g.add(pole);
  const arm = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.12, 0.12), mat(0x333340)
  );
  arm.position.set(0.7, SCALE.lampH, 0);
  g.add(arm);
  const bulb = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd98a })
  );
  bulb.position.set(1.4, SCALE.lampH - 0.1, 0);
  g.add(bulb);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTex, color: 0xffd98a, blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true, opacity: 0.55,
  }));
  glow.scale.setScalar(2.2);
  glow.position.copy(bulb.position);
  g.add(glow);
  g.position.set(x, 0, z);
  return g;
}

// road coordinate helpers (shared by traffic / missions / staging)
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
