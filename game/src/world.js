// PALMBAY HEAT — world.js (v3): procedural coastal city, SA-grade.
// Every surface textured (asphalt, sidewalks, facades with lit windows,
// sand, grass, water, planks); pastel art-deco buildings; power poles +
// sagging cables; billboards; arched bridge; pier; port cranes.
// v3 (Jaka's fixes): ONE natural layered-canopy tree family (no palm
// spikes), placement-validated against building AABBs (+1.5 m) and road
// rects (zero trees on asphalt); wide-spaced instanced street lamps;
// sidewalks SEGMENTED so they stop at junctions, with zebra crossings
// on every leg of every junction; traffic lights at avenue junctions +
// stop signs at minor ones; slatted benches on sidewalk edges. City
// layout is data — the minimap and the play-test assertions read it.
const THREE = window.THREE;
import { CFG, PALETTE, SCALE, ZONE_COLORS, zoneAt, rng, TAU } from './config.js';
import {
  canvasTexture, asphaltTexture, laneTexture, sidewalkTexture,
  facadeTextures, sandTexture, groundTexture, waterTexture,
  plankTexture, glowTexture, billboardTexture,
  zebraTexture, stopSignTexture,
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
  // v3 placement data — the play-test asserts against these
  buildingRects: [],   // {x0,z0,x1,z1} real building footprints
  roadRects: [],       // {x0,z0,x1,z1} drivable asphalt rects
  sidewalkSegs: [],    // {x0,z0,x1,z1} sidewalk segments + corner pads
  zebraLegs: 0,        // zebra crossing legs painted (4 per junction)
  trees: [],           // {x,z} validated tree trunk points
  lamps: [],           // {x,z} street lamp bases
  signs: [],           // {x,z,kind} traffic lights + stop signs
  benches: [],         // {x,z} bench centres
  // v6 additions
  doors: [],           // {x,z,yaw,block,zone} every building's entrance
  houses: [],          // enterable house records (briefs J/K)
  beachBar: null,      // { door:{x,z}, rect } — mission 1 anchor (brief C)
};

// --- v3 geometry helpers: merge many small geoms into ONE draw call ---
function mergeGeoms(list) {
  let total = 0;
  const parts = list.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    total += n.attributes.position.count;
    return n;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  let o3 = 0, o2 = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o3);
    nor.set(g.attributes.normal.array, o3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
    o3 += g.attributes.position.count * 3;
    o2 += g.attributes.position.count * 2;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
const _m4 = new THREE.Matrix4();
const _q4 = new THREE.Quaternion();
const _e4 = new THREE.Euler();
function xform(geo, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  const g = geo.clone();
  _e4.set(rx, ry, rz);
  _q4.setFromEuler(_e4);
  _m4.compose(new THREE.Vector3(x, y, z), _q4, new THREE.Vector3(sx, sy, sz));
  g.applyMatrix4(_m4);
  return g;
}
function uvScale(geo, su, sv) {
  const uv = geo.attributes.uv;
  if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}
// v6: merge with a baked vertex colour per part (houses, the beach
// bar, furniture — one material, one draw call per class)
const _cc = new THREE.Color();
function mergeColored(list) {
  let total = 0;
  const parts = list.map((p) => {
    const n = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const cnt = n.attributes.position.count;
    const col = new Float32Array(cnt * 3);
    _cc.set(p.color === undefined ? 0xffffff : p.color);
    for (let i = 0; i < cnt; i++) {
      col[i * 3] = _cc.r; col[i * 3 + 1] = _cc.g; col[i * 3 + 2] = _cc.b;
    }
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    total += cnt;
    return n;
  });
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  let o3 = 0, o2 = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o3);
    nor.set(g.attributes.normal.array, o3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o2);
    col.set(g.attributes.color.array, o3);
    o3 += g.attributes.position.count * 3;
    o2 += g.attributes.position.count * 2;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}
const coloredMat = () => new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.85, metalness: 0.0,
});
// distance from a point to an AABB (0 when inside) — placement validation
function rectDist(x, z, r) {
  const dx = Math.max(r.x0 - x, 0, x - r.x1);
  const dz = Math.max(r.z0 - z, 0, z - r.z1);
  return Math.hypot(dx, dz);
}
function pointInRect(x, z, r, pad = 0) {
  return x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad;
}

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
  // v3 audit: reach 5 m over the sand so the shoreline reads as wash,
  // not a dirt gap between the old sea edge (-255) and the sand (-250)
  sea.position.set(-HALF - 195, 0.15, 0);
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
      // v3: register the drivable asphalt rect (placement validation)
      worldInfo.roadRects.push(horizontal
        ? { x0: -roadLen / 2, z0: p - w / 2, x1: roadLen / 2, z1: p + w / 2 }
        : { x0: p - w / 2, z0: -roadLen / 2, x1: p + w / 2, z1: roadLen / 2 });
    }
  }

  // -- v3 sidewalks (Jaka fix #5): SEGMENTED slabs that STOP at every
  //    junction — a sidewalk never paints across asphalt — with corner
  //    pads wrapping each junction. All merged into ONE draw call.
  {
    const segs = [];
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    const addRun = (vertical, stripCenter) => {
      let cur = -roadLen / 2;
      const emit = (a, b) => {
        if (b - a < 1.4) return;
        const len = b - a, mid = (a + b) / 2;
        const wX = vertical ? SCALE.sidewalkW : len;
        const wZ = vertical ? len : SCALE.sidewalkW;
        segs.push(uvScale(
          xform(flat, vertical ? stripCenter : mid, 0.06, vertical ? mid : stripCenter, 0, wX, 1, wZ),
          wX / 2.6, wZ / 2.6
        ));
        worldInfo.sidewalkSegs.push(vertical
          ? { x0: stripCenter - SCALE.sidewalkW / 2, z0: a, x1: stripCenter + SCALE.sidewalkW / 2, z1: b }
          : { x0: a, z0: stripCenter - SCALE.sidewalkW / 2, x1: b, z1: stripCenter + SCALE.sidewalkW / 2 });
      };
      for (let j = 0; j <= CFG.gridN; j++) {
        const q = roadCoord(j);
        const hq = roadHalfAt(q);
        emit(cur, Math.min(q - hq - 0.4, roadLen / 2));
        cur = Math.max(cur, q + hq + 0.4);
      }
      emit(cur, roadLen / 2);
    };
    for (let i = 0; i <= CFG.gridN; i++) {
      const p = roadCoord(i);
      const hw = roadHalfAt(p);
      for (const side of [-1, 1]) {
        addRun(true, p + side * (hw + SCALE.sidewalkW / 2));
        addRun(false, p + side * (hw + SCALE.sidewalkW / 2));
      }
      // corner pads at every junction of road i
      for (let j = 0; j <= CFG.gridN; j++) {
        const q = roadCoord(j);
        const hq = roadHalfAt(q);
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
          const cxp = p + sx * (hw + SCALE.sidewalkW / 2);
          const czp = q + sz * (hq + SCALE.sidewalkW / 2);
          segs.push(uvScale(
            xform(flat, cxp, 0.06, czp, 0, SCALE.sidewalkW, 1, SCALE.sidewalkW), 1, 1
          ));
          worldInfo.sidewalkSegs.push({
            x0: cxp - SCALE.sidewalkW / 2, z0: czp - SCALE.sidewalkW / 2,
            x1: cxp + SCALE.sidewalkW / 2, z1: czp + SCALE.sidewalkW / 2,
          });
        }
      }
    }
    const swMesh = new THREE.Mesh(
      mergeGeoms(segs),
      new THREE.MeshStandardMaterial({ map: sidewalkTex, roughness: 0.95 })
    );
    swMesh.receiveShadow = true;
    group.add(swMesh);
  }

  // -- v3 zebra crossings (Jaka fix #5): white stripes across EVERY leg
  //    of EVERY junction, on the asphalt, aligned with the sidewalk
  //    ends. One merged draw call.
  {
    const zTex = zebraTexture();
    const legs = [];
    const flat = new THREE.PlaneGeometry(1, 1);
    flat.rotateX(-Math.PI / 2);
    for (let i = 0; i <= CFG.gridN; i++) {
      for (let j = 0; j <= CFG.gridN; j++) {
        const p = roadCoord(i), q = roadCoord(j);
        const hw = roadHalfAt(p), hq = roadHalfAt(q);
        for (const s of [-1, 1]) {
          // leg crossing road i (vertical): stripes parallel to traffic
          legs.push(uvScale(
            xform(flat, p, CFG.roadY + 0.025, q + s * (hq + 1.7), 0, hw * 2 - 0.6, 1, 3.0),
            (hw * 2 - 0.6) / 4.2, 1
          ));
          // leg crossing road j (horizontal)
          legs.push(uvScale(
            xform(flat, p + s * (hw + 1.7), CFG.roadY + 0.025, q, Math.PI / 2, hq * 2 - 0.6, 1, 3.0),
            (hq * 2 - 0.6) / 4.2, 1
          ));
          worldInfo.zebraLegs += 2;
        }
      }
    }
    const zm = new THREE.Mesh(mergeGeoms(legs), new THREE.MeshStandardMaterial({
      map: zTex, transparent: true, roughness: 0.9, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2,
    }));
    zm.receiveShadow = true;
    group.add(zm);
  }

  // ================= v6: houses, interiors, beach bar =============
  // Suburb blocks become a real residential district (brief J):
  // small + medium houses with pyramid roofs, lawns, paths and
  // fences — merged city-wide into 3 draw calls. Three houses are
  // ENTERABLE with furnished interiors (brief K). Every building in
  // the city gets an entrance door (brief I) via one instanced pass.
  const doorSpots = [];   // {x, z(face plane), yaw}
  const houseWallParts = [], houseRoofParts = [], houseTrimParts = [];
  const HOUSE_WALLS = [0xf7ead9, 0xf3e2c7, 0xdfe9ec, 0xf2c4ce, 0xcfe3ee, 0xeec39a];
  const HOUSE_ROOFS = [0xb85a3a, 0x8a4a3a, 0x6a7a8a, 0x9a5a44, 0x7a6a5a];
  const ENTERABLE_BLOCKS = { '3,0': 0, '6,3': 1, '2,5': 2 };
  const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const cylG = (rt, rb, h, s = 10) => new THREE.CylinderGeometry(rt, rb, h, s);
  function pyramidRoofGeo() {
    const g = new THREE.CylinderGeometry(0.01, 1, 1, 4);
    g.rotateY(Math.PI / 4);
    return g;
  }
  function houseDoorSpot(x, z, yaw, blockKey, zone) {
    doorSpots.push({ x, z, yaw });
    worldInfo.doors.push({ x, z, yaw, block: blockKey, zone });
  }

  // one solid (non-enterable) house, merged into the city arrays
  function simpleHouse(x, z, w, d, wallC, roofC, blockKey) {
    const h = 3.1;
    houseWallParts.push({ geo: xform(boxG(w, h, d), x, h / 2, z), color: wallC });
    houseRoofParts.push({
      geo: xform(pyramidRoofGeo(), x, h + 0.85, z, 0, (w + 1.1) / 1.414, 1.7, (d + 1.1) / 1.414),
      color: roofC,
    });
    // garden: lawn, path to the door, front fence with a gap, shrubs
    houseTrimParts.push({ geo: xform(boxG(w + 5, 0.07, d + 4.5), x, 0.035, z), color: 0x69a854 });
    const doorX = x + w * 0.18;
    houseTrimParts.push({ geo: xform(boxG(1.3, 0.09, 2.3), doorX, 0.05, z - d / 2 - 1.15), color: 0xcfc4ae });
    const fz = z - d / 2 - 2.25;
    const gx0 = x - (w + 5) / 2, gx1 = x + (w + 5) / 2;
    const gapL = doorX - 0.85, gapR = doorX + 0.85;
    if (gapL > gx0) houseTrimParts.push({ geo: xform(boxG(gapL - gx0, 0.55, 0.07), (gx0 + gapL) / 2, 0.32, fz), color: 0xf0ead8 });
    if (gx1 > gapR) houseTrimParts.push({ geo: xform(boxG(gx1 - gapR, 0.55, 0.07), (gapR + gx1) / 2, 0.32, fz), color: 0xf0ead8 });
    for (const sx of [-1, 1]) {
      houseTrimParts.push({
        geo: xform(new THREE.SphereGeometry(0.55, 8, 6), x + sx * (w / 2 - 0.6), 0.5, z - d / 2 - 0.7, 0, 1, 0.75, 1),
        color: 0x3f7a34,
      });
    }
    worldInfo.buildingRects.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 });
    houseDoorSpot(doorX, z - d / 2, Math.PI, blockKey, 'suburb');
  }

  // one ENTERABLE house (brief K): walls with a real door opening,
  // hinged door, furnished interior merged into ONE mesh + a TV.
  // Roof and far (north) wall are separate so main can hide them
  // while Dario is inside. Wall segments join buildingRects, so the
  // house is solid except at its doorway.
  function enterableHouse(x, z, w, d, wallC, roofC, blockKey, idx) {
    const g = new THREE.Group();
    const H = 3.1, T = 0.18;
    const doorW = 1.25, doorH = 2.15;
    const doorX = x + w * 0.18;
    // floor slab (wood)
    const floor = new THREE.Mesh(boxG(w, 0.14, d),
      new THREE.MeshStandardMaterial({ color: 0x9a7248, roughness: 0.9 }));
    floor.position.set(x, 0.07, z);
    floor.receiveShadow = true;
    g.add(floor);
    // solid walls merged: west, east, and the south wall in three
    // pieces around the door opening (+ lintel above it)
    const parts = [];
    parts.push({ geo: xform(boxG(T, H, d), x - w / 2 + T / 2, H / 2, z), color: wallC });
    parts.push({ geo: xform(boxG(T, H, d), x + w / 2 - T / 2, H / 2, z), color: wallC });
    const sZ = z - d / 2 + T / 2;
    const leftW = (doorX - doorW / 2) - (x - w / 2);
    const rightW = (x + w / 2) - (doorX + doorW / 2);
    parts.push({ geo: xform(boxG(leftW, H, T), x - w / 2 + leftW / 2, H / 2, sZ), color: wallC });
    parts.push({ geo: xform(boxG(rightW, H, T), doorX + doorW / 2 + rightW / 2, H / 2, sZ), color: wallC });
    parts.push({ geo: xform(boxG(doorW, H - doorH, T), doorX, doorH + (H - doorH) / 2, sZ), color: wallC });
    const wallsMesh = new THREE.Mesh(mergeColored(parts), coloredMat());
    wallsMesh.castShadow = true;
    wallsMesh.receiveShadow = true;
    g.add(wallsMesh);
    // far (north) wall — separate, hides while the player is inside
    const farWall = new THREE.Mesh(boxG(w, H, T),
      new THREE.MeshStandardMaterial({ color: wallC, roughness: 0.9 }));
    farWall.position.set(x, H / 2, z + d / 2 - T / 2);
    farWall.castShadow = true;
    g.add(farWall);
    // pyramid roof — separate, hides while inside
    const roof = new THREE.Mesh(pyramidRoofGeo(),
      new THREE.MeshStandardMaterial({ color: roofC, roughness: 0.9, flatShading: true }));
    roof.scale.set((w + 1.1) / 1.414, 1.9, (d + 1.1) / 1.414);
    roof.position.set(x, H + 0.95, z);
    roof.castShadow = true;
    g.add(roof);
    // hinged front door
    const doorPivot = new THREE.Group();
    doorPivot.position.set(doorX - doorW / 2, 0, z - d / 2);
    const doorPanel = new THREE.Mesh(boxG(doorW, doorH, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x2a6a7a, roughness: 0.6 }));
    doorPanel.position.set(doorW / 2, doorH / 2, 0);
    doorPanel.castShadow = true;
    doorPivot.add(doorPanel);
    g.add(doorPivot);
    // ---- furnished interior (brief K): ONE merged mesh ----------
    const F = [];
    const fp = (geo, fx, fy, fz, color) => F.push({ geo: xform(geo, fx, fy, fz), color });
    // living room (west): rug, sofa facing the TV, coffee table,
    // floor lamp, plant, wall art
    fp(boxG(3.2, 0.04, 2.2), x - w / 2 + 2.2, 0.17, z - 1, 0xb84a6a);
    fp(boxG(0.9, 0.5, 2.2), x - w / 2 + 2.9, 0.4, z - 1, 0x3a6a8a);          // sofa base
    fp(boxG(0.25, 0.75, 2.2), x - w / 2 + 3.3, 0.52, z - 1, 0x2f5872);      // sofa back
    fp(boxG(0.9, 0.32, 0.25), x - w / 2 + 2.9, 0.55, z - 2.05, 0x2f5872);   // sofa arm
    fp(boxG(0.9, 0.32, 0.25), x - w / 2 + 2.9, 0.55, z + 0.05, 0x2f5872);   // sofa arm
    fp(boxG(1.1, 0.07, 0.6), x - w / 2 + 1.75, 0.5, z - 1, 0x6a4a30);       // coffee table top
    fp(boxG(1.0, 0.05, 0.5), x - w / 2 + 1.75, 0.24, z - 1, 0x54382a);      // coffee table shelf
    fp(boxG(0.4, 0.5, 1.6), x - w / 2 + 0.5, 0.4, z - 1, 0x333340);         // TV stand
    fp(cylG(0.03, 0.03, 1.5, 6), x - w / 2 + 0.7, 0.9, z + d / 2 - 0.8, 0x8a8a92); // lamp pole
    fp(cylG(0.16, 0.23, 0.28, 10), x - w / 2 + 0.7, 1.72, z + d / 2 - 0.8, 0xffd9a0); // lamp shade
    fp(cylG(0.16, 0.13, 0.3, 9), x + w / 2 - 0.7, 0.3, z - d / 2 + 0.7, 0xb85a3a);  // plant pot
    fp(new THREE.SphereGeometry(0.34, 8, 6), x + w / 2 - 0.7, 0.78, z - d / 2 + 0.7, 0x3f7a34); // plant
    fp(new THREE.SphereGeometry(0.24, 8, 6), x + w / 2 - 0.55, 1.0, z - d / 2 + 0.85, 0x4c9440);
    fp(boxG(0.05, 0.7, 0.95), x + w / 2 - 0.16, 1.75, z - 2.2, 0xe76f51);   // wall art
    // kitchen (north-east): counter run, fridge, stove
    fp(boxG(3.4, 0.9, 0.65), x + w / 2 - 2.3, 0.6, z + d / 2 - 0.55, 0xd8d2c2);  // counter
    fp(boxG(3.5, 0.06, 0.72), x + w / 2 - 2.3, 1.08, z + d / 2 - 0.55, 0x4a4a52); // counter top
    fp(boxG(0.8, 1.8, 0.7), x + w / 2 - 0.75, 1.05, z + d / 2 - 0.6, 0xc8ccd2);   // fridge
    fp(boxG(0.05, 0.5, 0.05), x + w / 2 - 1.12, 1.3, z + d / 2 - 0.28, 0x8a8f96); // fridge handle
    fp(boxG(0.7, 0.85, 0.65), x + 0.4, 0.57, z + d / 2 - 0.55, 0xe8e4da);        // stove
    for (const [bx2, bz2] of [[-0.16, -0.14], [0.16, -0.14], [-0.16, 0.14], [0.16, 0.14]]) {
      fp(cylG(0.09, 0.09, 0.03, 10), x + 0.4 + bx2, 1.01, z + d / 2 - 0.55 + bz2, 0x1c1c20); // burners
    }
    // dining set (centre-east): table + 4 chairs
    fp(boxG(1.5, 0.07, 0.95), x + 1.3, 0.86, z + 0.9, 0x7a5230);
    for (const [lx, lz] of [[-0.65, -0.38], [0.65, -0.38], [-0.65, 0.38], [0.65, 0.38]]) {
      fp(boxG(0.07, 0.82, 0.07), x + 1.3 + lx, 0.43, z + 0.9 + lz, 0x5f3f24);
    }
    for (const [chx, chz, ry] of [[0.55, 0.9, 0], [2.05, 0.9, 0], [1.3, 0.05, 0], [1.3, 1.75, 0]]) {
      void ry;
      fp(boxG(0.42, 0.05, 0.42), x + chx, 0.56, z + chz, 0x8a5a34);
      fp(boxG(0.42, 0.5, 0.05), x + chx, 0.83, z + chz + (chz < 0.9 ? -0.19 : 0.19), 0x8a5a34);
    }
    // bedroom (north-west): bed, wardrobe, nightstand
    fp(boxG(1.6, 0.3, 2.2), x - w / 2 + 1.7, 0.3, z + d / 2 - 1.8, 0x6a4a30);   // bed frame
    fp(boxG(1.5, 0.22, 2.1), x - w / 2 + 1.7, 0.56, z + d / 2 - 1.8, 0xf0ead8); // mattress
    fp(boxG(1.52, 0.1, 1.3), x - w / 2 + 1.7, 0.68, z + d / 2 - 1.45, 0x2a9d8f); // blanket
    fp(boxG(0.6, 0.12, 0.4), x - w / 2 + 1.7, 0.72, z + d / 2 - 2.6, 0xffffff);  // pillow
    fp(boxG(1.4, 2.1, 0.5), x - w / 2 + 3.6, 1.2, z + d / 2 - 0.45, 0x7a5230);   // wardrobe
    fp(boxG(0.5, 0.45, 0.4), x - w / 2 + 2.85, 0.37, z + d / 2 - 2.7, 0x8a5a34); // nightstand
    fp(boxG(0.16, 0.2, 0.16), x - w / 2 + 2.85, 0.7, z + d / 2 - 2.7, 0xffd9a0);  // bedside lamp
    const interior = new THREE.Group();
    const furn = new THREE.Mesh(mergeColored(F), coloredMat());
    furn.receiveShadow = true;
    interior.add(furn);
    // the TV: emissive screen on its stand, facing the sofa (+X)
    const tv = new THREE.Mesh(boxG(0.07, 0.85, 1.5),
      new THREE.MeshBasicMaterial({ color: 0x9fd8e8 }));
    tv.position.set(x - w / 2 + 0.32, 1.3, z - 1);
    interior.add(tv);
    interior.visible = false;   // main shows it when the player is near
    g.add(interior);
    group.add(g);
    // collision: wall segments (the doorway stays open)
    worldInfo.buildingRects.push(
      { x0: x - w / 2, z0: z - d / 2, x1: x - w / 2 + T, z1: z + d / 2 },
      { x0: x + w / 2 - T, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 },
      { x0: x - w / 2, z0: z + d / 2 - T, x1: x + w / 2, z1: z + d / 2 },
      { x0: x - w / 2, z0: z - d / 2, x1: doorX - doorW / 2, z1: z - d / 2 + T },
      { x0: doorX + doorW / 2, z0: z - d / 2, x1: x + w / 2, z1: z - d / 2 + T }
    );
    worldInfo.houses.push({
      x, z, w, d, idx, block: blockKey,
      rect: { x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2 },
      doorPos: { x: doorX, z: z - d / 2 - 0.9 },
      doorPivot, roof, farWall, interior,
      furnitureCount: 14,
      pickupSpot: { x: x - w / 2 + 1.7, z: z - 1 },
      group: g,
    });
  }

  function buildSuburbBlock(bx, bz, cx, cz) {
    const key = bx + ',' + bz;
    const spots = [[-11.5, -11], [11.5, -11], [0, 12.5]];
    const enterableIdx = ENTERABLE_BLOCKS[key];
    spots.forEach(([ox, oz], k) => {
      const wallC = HOUSE_WALLS[Math.floor(rand() * HOUSE_WALLS.length)];
      const roofC = HOUSE_ROOFS[Math.floor(rand() * HOUSE_ROOFS.length)];
      if (enterableIdx !== undefined && k === 0) {
        enterableHouse(cx + ox, cz + oz, 10.5, 8.5, wallC, roofC, key, enterableIdx);
        return;
      }
      simpleHouse(cx + ox, cz + oz, 8 + rand() * 3, 7 + rand() * 2.5, wallC, roofC, key);
    });
  }

  // the beach bar by the pier approach (brief C): deck, posts,
  // counter, stools, bottle shelf, thatch roof — and a framed door
  // on its east face, where mission 1's checkpoint now lives.
  function buildBeachBar() {
    const bx = -234, bz = 60, w = 8, d = 6.5;
    const deck = new THREE.Mesh(boxG(9.5, 0.18, 8),
      new THREE.MeshStandardMaterial({ map: plankTex, roughness: 0.9 }));
    deck.position.set(bx, 0.09, bz);
    deck.receiveShadow = true;
    group.add(deck);
    const parts = [];
    for (const [px, pz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
      parts.push({ geo: xform(cylG(0.09, 0.11, 3.1, 7), bx + px, 1.55, bz + pz), color: 0x6a4a30 });
    }
    // counter (bartender west, stools east) + back shelf + bottles
    parts.push({ geo: xform(boxG(4.6, 1.05, 0.5), bx - 0.8, 0.62, bz), color: 0x8a5a34 });
    parts.push({ geo: xform(boxG(4.9, 0.08, 0.7), bx - 0.8, 1.18, bz), color: 0x5a3a20 });
    parts.push({ geo: xform(boxG(0.35, 2.2, 4.6), bx - w / 2 + 0.35, 1.1, bz), color: 0x5a3a20 });
    const bottleCols = [0x2e9e4a, 0xe76f51, 0x59e6ff, 0xf1c40f, 0xff5fa2];
    for (let i = 0; i < 5; i++) {
      parts.push({ geo: xform(boxG(0.16, 0.42, 0.16), bx - w / 2 + 0.62, 1.5, bz - 1.6 + i * 0.8), color: bottleCols[i] });
    }
    for (let i = 0; i < 3; i++) {
      parts.push({ geo: xform(cylG(0.26, 0.26, 0.09, 10), bx + 0.6, 0.78, bz - 1.4 + i * 1.4), color: 0xb85a3a });
      parts.push({ geo: xform(cylG(0.05, 0.05, 0.7, 6), bx + 0.6, 0.4, bz - 1.4 + i * 1.4), color: 0x4a3a28 });
    }
    // door frame on the east face
    parts.push({ geo: xform(boxG(0.14, 2.3, 0.14), bx + w / 2, 1.15, bz - 0.75), color: 0xf0ead8 });
    parts.push({ geo: xform(boxG(0.14, 2.3, 0.14), bx + w / 2, 1.15, bz + 0.75), color: 0xf0ead8 });
    parts.push({ geo: xform(boxG(0.14, 0.16, 1.64), bx + w / 2, 2.36, bz), color: 0xf0ead8 });
    const merged = new THREE.Mesh(mergeColored(parts), coloredMat());
    merged.castShadow = true;
    group.add(merged);
    // the door itself, ajar against the frame
    const door = new THREE.Mesh(boxG(0.07, 2.15, 1.3),
      new THREE.MeshStandardMaterial({ color: 0x2a9d8f, roughness: 0.6 }));
    door.position.set(bx + w / 2 - 0.62, 1.08, bz - 0.72);
    door.rotation.y = 0.9;
    group.add(door);
    const roof = new THREE.Mesh(pyramidRoofGeo(),
      new THREE.MeshStandardMaterial({ color: 0xc8a05a, roughness: 1, flatShading: true }));
    roof.scale.set((w + 2.2) / 1.414, 1.8, (d + 2.2) / 1.414);
    roof.position.set(bx, 4.0, bz);
    roof.castShadow = true;
    group.add(roof);
    const sign = neonSign('BEACH BAR', '#59e6ff', 3.4);
    sign.position.set(bx + w / 2 + 0.35, 2.7, bz);
    sign.rotation.y = Math.PI / 2;
    group.add(sign);
    signs.push(sign);
    // solid up to the counter; the deck + doorway stay walkable
    const rect = { x0: bx - w / 2, z0: bz - d / 2, x1: bx + 1.6, z1: bz + d / 2 };
    worldInfo.buildingRects.push(rect);
    worldInfo.beachBar = { door: { x: bx + w / 2 + 1.5, z: bz }, rect };
    worldInfo.doors.push({ x: bx + w / 2 + 0.1, z: bz, yaw: Math.PI / 2, block: 'beach', zone: 'beach' });
  }

  // -- city blocks: buildings (vegetation + furniture come later,
  //    placed against the finished layout data) --
  const buildings = [];
  const signs = [];
  const blockBuildings = {};   // "bx,bz" -> [ {x,z,w,d,h} ] for sign mounting
  const treeSpots = [];        // filled by the validated v3 tree pass
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
      blockBuildings[bx + ',' + bz] = [];
      // v6: suburb blocks are a residential district of houses now
      if (zone === 'suburb') {
        buildSuburbBlock(bx, bz, cx, cz);
        continue;
      }
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
        worldInfo.buildingRects.push({
          x0: cx + ox - w / 2, z0: cz + oz - d / 2,
          x1: cx + ox + w / 2, z1: cz + oz + d / 2,
        });
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
      // v3: trees are placed AFTER the whole city exists, in the
      // validated vegetation pass below — the old per-block scatter is
      // what put trees inside buildings and on roads (Jaka fixes #3/#4).
    }
  }

  // -- v6 post-pass: beach bar, merged houses, instanced doors -----
  buildBeachBar();
  if (houseWallParts.length) {
    const hw = new THREE.Mesh(mergeColored(houseWallParts), coloredMat());
    hw.castShadow = true;
    hw.receiveShadow = true;
    group.add(hw);
    const hr = new THREE.Mesh(mergeColored(houseRoofParts), coloredMat());
    hr.castShadow = true;
    group.add(hr);
    const ht = new THREE.Mesh(mergeColored(houseTrimParts), coloredMat());
    ht.receiveShadow = true;
    group.add(ht);
  }
  {
    // every big building's door joins the same instanced pass as
    // the simple houses' (doorSpots holds face-plane positions)
    for (const key of Object.keys(blockBuildings)) {
      const [bx, bz] = key.split(',').map(Number);
      const zone = zoneAt(bx, bz);
      for (const b of blockBuildings[key]) {
        houseDoorSpot(b.x + b.w * 0.18, b.z - b.d / 2, Math.PI, key, zone);
      }
    }
    const dummy = new THREE.Object3D();
    const n = Math.max(1, doorSpots.length);
    const frames = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.34, 2.34, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xf0ead8, roughness: 0.7 }), n);
    const panels = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.12, 2.18, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x2a5a6a, roughness: 0.55 }), n);
    const knobs = new THREE.InstancedMesh(
      new THREE.SphereGeometry(0.05, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xd8a030, roughness: 0.35, metalness: 0.7 }), n);
    doorSpots.forEach((ds, i) => {
      dummy.rotation.set(0, ds.yaw, 0);
      dummy.position.set(ds.x, 1.17, ds.z - 0.05);
      dummy.updateMatrix();
      frames.setMatrixAt(i, dummy.matrix);
      dummy.position.set(ds.x, 1.09, ds.z - 0.1);
      dummy.updateMatrix();
      panels.setMatrixAt(i, dummy.matrix);
      dummy.position.set(ds.x + 0.38, 1.05, ds.z - 0.16);
      dummy.updateMatrix();
      knobs.setMatrixAt(i, dummy.matrix);
    });
    frames.count = doorSpots.length;
    panels.count = doorSpots.length;
    knobs.count = doorSpots.length;
    frames.instanceMatrix.needsUpdate = true;
    panels.instanceMatrix.needsUpdate = true;
    knobs.instanceMatrix.needsUpdate = true;
    frames.frustumCulled = false;
    panels.frustumCulled = false;
    knobs.frustumCulled = false;
    group.add(frames, panels, knobs);
  }

  // -- v3 TREES (Jaka fixes #1/#3/#4): ONE natural tree family — a
  //    tapered trunk with branches and a fuller, layered canopy of 3
  //    stacked rounded cones (soft silhouette, NO palm frond spikes).
  //    Placement is validated against the finished layout: a trunk
  //    point must clear every building AABB by >= 1.5 m and must not
  //    stand on any road rect — trees live on sand, grass verges,
  //    sidewalk inner edges and park interiors only.
  const treeClear = (x, z) => {
    for (const r of worldInfo.roadRects) if (pointInRect(x, z, r, 0.35)) return false;
    for (const r of worldInfo.buildingRects) if (rectDist(x, z, r) < 1.5) return false;
    for (const t of treeSpots) {
      const dx = t.x - x, dz = t.z - z;
      if (dx * dx + dz * dz < 3.4 * 3.4) return false;
    }
    return true;
  };
  const addTree = (x, z, s) => {
    if (treeClear(x, z)) treeSpots.push({ x, z, s, rot: rand() * TAU });
  };
  // beach sand row (west of the promenade fence, on the sand)
  for (let z = -196; z <= 196; z += 12.5) {
    if (z > 38 && z < 82) continue;   // keep the pier approach clear
    addTree(-226.5 + (rand() - 0.5) * 2, z + (rand() - 0.5) * 5, 0.95 + rand() * 0.3);
  }
  // grass verge row east of the beachfront avenue (the cover's line)
  for (let z = -198; z <= 198; z += 11) {
    addTree(-192.8 + (rand() - 0.5) * 1.6, z + (rand() - 0.5) * 4, 0.9 + rand() * 0.35);
  }
  // sidewalk trees on the strip's inner edge, at block middles
  for (let i = 1; i <= CFG.gridN; i++) {
    const p = roadCoord(i);
    const hw = roadHalfAt(p);
    for (let b = 0; b < CFG.gridN; b++) {
      const mid = -HALF + CFG.roadW / 2 + b * PITCH + CFG.block / 2;
      for (const side of [-1, 1]) {
        if (rand() < 0.5) addTree(p + side * (hw + 2.15), mid + (rand() - 0.5) * 10, 0.85 + rand() * 0.35);
        if (rand() < 0.5) addTree(mid + (rand() - 0.5) * 10, p + side * (hw + 2.15), 0.85 + rand() * 0.35);
      }
    }
  }
  // park interiors in suburb + beach blocks, rejection-sampled
  for (let bx = 0; bx < CFG.gridN; bx++) {
    for (let bz = 0; bz < CFG.gridN; bz++) {
      const zone = zoneAt(bx, bz);
      if (zone !== 'suburb' && zone !== 'beach') continue;
      const cx = -HALF + CFG.roadW / 2 + bx * PITCH + CFG.block / 2;
      const cz = -HALF + CFG.roadW / 2 + bz * PITCH + CFG.block / 2;
      const n = 2 + Math.floor(rand() * 3);
      for (let k = 0; k < n; k++) {
        for (let tries = 0; tries < 8; tries++) {
          const x = cx + (rand() - 0.5) * (CFG.block - 7);
          const z = cz + (rand() - 0.5) * (CFG.block - 7);
          if (treeClear(x, z)) {
            treeSpots.push({ x, z, s: 0.9 + rand() * 0.4, rot: rand() * TAU });
            break;
          }
        }
      }
    }
  }
  worldInfo.trees = treeSpots.map((t) => ({ x: t.x, z: t.z }));

  // -- trees rendered as 2 instanced meshes (trunks + canopies) --
  {
    const dummy = new THREE.Object3D();
    const trunkParts = [];
    const tg = new THREE.CylinderGeometry(0.13, 0.21, 2.6, 7);
    tg.translate(0, 1.3, 0);
    trunkParts.push(tg);
    for (const s of [-1, 1]) {
      const br = new THREE.CylinderGeometry(0.05, 0.08, 1.1, 5);
      br.translate(0, 0.55, 0);
      trunkParts.push(xform(br, s * 0.28, 2.2, 0, 0, 1, 1, 1, 0, s * 0.7));
    }
    const trunkGeo = mergeGeoms(trunkParts);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: PALETTE.treeTrunk, roughness: 1,
    });
    // canopy: 3 stacked rounded cones; vertices jittered so the
    // silhouette stays soft and organic instead of spiky
    const coneAt = (r, h, y) => {
      const c = new THREE.ConeGeometry(r, h, 9);
      const pa = c.attributes.position;
      for (let vi = 0; vi < pa.count; vi++) {
        pa.setX(vi, pa.getX(vi) + (rand() - 0.5) * 0.22);
        pa.setZ(vi, pa.getZ(vi) + (rand() - 0.5) * 0.22);
      }
      c.translate(0, y, 0);
      return c;
    };
    const canopyGeo = mergeGeoms([
      coneAt(SCALE.treeCanopyR, 3.6, 2.6 + 1.6),
      coneAt(SCALE.treeCanopyR * 0.74, 3.0, 2.6 + 3.0),
      coneAt(SCALE.treeCanopyR * 0.48, 2.5, 2.6 + 4.3),
    ]);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: PALETTE.treeCanopy, roughness: 0.95, flatShading: true,
    });
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeSpots.length);
    treeSpots.forEach((t, i) => {
      dummy.position.set(t.x, 0, t.z);
      dummy.rotation.set(0, t.rot, 0);
      dummy.scale.setScalar(t.s);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
      canopies.setMatrixAt(i, dummy.matrix);
    });
    trunks.castShadow = true;
    canopies.castShadow = true;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    trunks.frustumCulled = false;
    canopies.frustumCulled = false;
    group.add(trunks, canopies);
  }

  // -- v3 STREET LAMPS (Jaka fix #2): instanced posts every ~28 m,
  //    alternating sides of the street, warm emissive heads and a
  //    single Points glow layer — never clustered, never on asphalt.
  const lampSpots = [];
  {
    const lampClear = (x, z) => {
      for (const r of worldInfo.roadRects) if (pointInRect(x, z, r, 0.3)) return false;
      for (const r of worldInfo.buildingRects) if (rectDist(x, z, r) < 1.2) return false;
      for (const t of treeSpots) {
        const dx = t.x - x, dz = t.z - z;
        if (dx * dx + dz * dz < 2.2 * 2.2) return false;
      }
      return true;
    };
    for (let i = 0; i <= CFG.gridN; i++) {
      const p = roadCoord(i);
      const hw = roadHalfAt(p);
      let k = 0;
      for (let a = -196; a <= 196; a += SCALE.lampSpacing, k++) {
        const side = (k % 2 === 0) ? 1 : -1;
        const along = a + (i % 2) * 9;
        let inJunction = false;
        for (let j = 0; j <= CFG.gridN; j++) {
          const q = roadCoord(j);
          if (Math.abs(along - q) < roadHalfAt(q) + 2.6) { inJunction = true; break; }
        }
        if (inJunction) continue;
        if (lampClear(p + side * (hw + 0.55), along)) {
          lampSpots.push({ x: p + side * (hw + 0.55), z: along, dirX: -side, dirZ: 0 });
        }
        if (lampClear(along, p + side * (hw + 0.55))) {
          lampSpots.push({ x: along, z: p + side * (hw + 0.55), dirX: 0, dirZ: -side });
        }
      }
    }
    worldInfo.lamps = lampSpots.map((l) => ({ x: l.x, z: l.z }));
    const poleParts = [];
    const pg = new THREE.CylinderGeometry(0.06, 0.09, SCALE.lampH, 7);
    pg.translate(0, SCALE.lampH / 2, 0);
    poleParts.push(pg);
    const ag = new THREE.BoxGeometry(0.09, 0.09, 1.15);
    ag.translate(0, SCALE.lampH - 0.05, 0.5);
    poleParts.push(ag);
    const hg = new THREE.BoxGeometry(0.24, 0.09, 0.52);
    hg.translate(0, SCALE.lampH - 0.12, 1.0);
    poleParts.push(hg);
    const poleGeo = mergeGeoms(poleParts);
    const poleMat = new THREE.MeshStandardMaterial({
      color: PALETTE.lampMetal, roughness: 0.55, metalness: 0.45,
    });
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampSpots.length);
    const bulbGeo = new THREE.BoxGeometry(0.16, 0.05, 0.4);
    bulbGeo.translate(0, SCALE.lampH - 0.18, 1.0);
    const bulbMat = new THREE.MeshStandardMaterial({
      color: 0xffe2b0, emissive: PALETTE.lampGlow, emissiveIntensity: 2.6,
    });
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampSpots.length);
    const dummy = new THREE.Object3D();
    const glowPos = new Float32Array(lampSpots.length * 3);
    lampSpots.forEach((l, idx) => {
      dummy.position.set(l.x, 0, l.z);
      dummy.rotation.set(0, Math.atan2(l.dirX, l.dirZ), 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      poles.setMatrixAt(idx, dummy.matrix);
      bulbs.setMatrixAt(idx, dummy.matrix);
      glowPos[idx * 3] = l.x + l.dirX * 1.0;
      glowPos[idx * 3 + 1] = SCALE.lampH - 0.2;
      glowPos[idx * 3 + 2] = l.z + l.dirZ * 1.0;
    });
    poles.castShadow = true;
    poles.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    poles.frustumCulled = false;
    bulbs.frustumCulled = false;
    group.add(poles, bulbs);
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
    const glows = new THREE.Points(glowGeo, new THREE.PointsMaterial({
      map: glowTex, color: PALETTE.lampGlow, size: 2.4, sizeAttenuation: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
      transparent: true, opacity: 0.5,
    }));
    glows.frustumCulled = false;
    group.add(glows);
  }

  // -- v3 TRAFFIC FURNITURE (Jaka fix #6): traffic lights where an
  //    avenue meets any road, stop signs at minor junctions — bases
  //    on sidewalk corners, validated like the trees and lamps.
  const signSpots = [];
  {
    const furnClear = (x, z) => {
      for (const r of worldInfo.roadRects) if (pointInRect(x, z, r, 0.3)) return false;
      for (const r of worldInfo.buildingRects) if (rectDist(x, z, r) < 1.2) return false;
      for (const t of treeSpots) {
        const dx = t.x - x, dz = t.z - z;
        if (dx * dx + dz * dz < 2.0 * 2.0) return false;
      }
      for (const l of lampSpots) {
        const dx = l.x - x, dz = l.z - z;
        if (dx * dx + dz * dz < 1.6 * 1.6) return false;
      }
      for (const s of signSpots) {
        const dx = s.x - x, dz = s.z - z;
        if (dx * dx + dz * dz < 1.6 * 1.6) return false;
      }
      return true;
    };
    for (let i = 0; i <= CFG.gridN; i++) {
      for (let j = 0; j <= CFG.gridN; j++) {
        const p = roadCoord(i), q = roadCoord(j);
        const hw = roadHalfAt(p), hq = roadHalfAt(q);
        const avenue = (i % CFG.avenueEvery === 0) || (j % CFG.avenueEvery === 0);
        if (avenue) {
          for (const [sx, sz] of [[1, 1], [-1, -1]]) {
            const x = p + sx * (hw + 1.3), z = q + sz * (hq + 1.3);
            if (furnClear(x, z)) {
              signSpots.push({ x, z, kind: 'signal', yaw: Math.atan2(-sx, -sz) });
            }
          }
        } else {
          const x = p + hw + 1.3, z = q - hq - 1.3;
          if (furnClear(x, z)) {
            // v5: faces are double-sided prints, so yaw 0 (faces
            // perpendicular to the vertical road) reads correctly
            // for traffic approaching from either direction
            signSpots.push({ x, z, kind: 'stop', yaw: 0 });
          }
        }
      }
    }
    worldInfo.signs = signSpots.map((s) => ({ x: s.x, z: s.z, kind: s.kind }));
    const signals = signSpots.filter((s) => s.kind === 'signal');
    const stops = signSpots.filter((s) => s.kind === 'stop');
    const dummy = new THREE.Object3D();
    const sigParts = [];
    const sp = new THREE.CylinderGeometry(0.07, 0.1, SCALE.signalH, 7);
    sp.translate(0, SCALE.signalH / 2, 0);
    sigParts.push(sp);
    const sa = new THREE.BoxGeometry(0.09, 0.09, 2.3);
    sa.translate(0, SCALE.signalH - 0.1, 1.05);
    sigParts.push(sa);
    const sigGeo = mergeGeoms(sigParts);
    const sigMat = new THREE.MeshStandardMaterial({
      color: PALETTE.lampMetal, roughness: 0.55, metalness: 0.45,
    });
    const sigPoles = new THREE.InstancedMesh(sigGeo, sigMat, Math.max(1, signals.length));
    const headGeo = new THREE.BoxGeometry(0.34, 0.92, 0.26);
    headGeo.translate(0, SCALE.signalH - 0.62, 2.1);
    const headMat = new THREE.MeshStandardMaterial({ color: 0x14161a, roughness: 0.5 });
    const heads = new THREE.InstancedMesh(headGeo, headMat, Math.max(1, signals.length));
    const dotGeo = new THREE.CircleGeometry(0.085, 10);
    dotGeo.translate(0, 0, 0.145);
    const greenDots = [], redDots = [], darkDots = [];
    signals.forEach((s, si) => {
      dummy.position.set(s.x, 0, s.z);
      dummy.rotation.set(0, s.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      sigPoles.setMatrixAt(si, dummy.matrix);
      heads.setMatrixAt(si, dummy.matrix);
      const fx = s.x + Math.sin(s.yaw) * 2.1;
      const fz = s.z + Math.cos(s.yaw) * 2.1;
      const litGreen = (si % 2 === 0);
      const rows = [SCALE.signalH - 0.32, SCALE.signalH - 0.62, SCALE.signalH - 0.92];
      rows.forEach((y, ri) => {
        const entry = { x: fx, y, z: fz, yaw: s.yaw };
        if (ri === 0) (litGreen ? darkDots : redDots).push(entry);
        else if (ri === 2) (litGreen ? greenDots : darkDots).push(entry);
        else darkDots.push(entry);
      });
    });
    sigPoles.count = signals.length;
    heads.count = signals.length;
    sigPoles.castShadow = true;
    sigPoles.instanceMatrix.needsUpdate = true;
    heads.instanceMatrix.needsUpdate = true;
    sigPoles.frustumCulled = false;
    heads.frustumCulled = false;
    group.add(sigPoles, heads);
    const mkDots = (list, material) => {
      const m = new THREE.InstancedMesh(dotGeo, material, Math.max(1, list.length));
      list.forEach((d, idx) => {
        dummy.position.set(d.x, d.y, d.z);
        dummy.rotation.set(0, d.yaw, 0);
        dummy.scale.setScalar(1);
        dummy.updateMatrix();
        m.setMatrixAt(idx, dummy.matrix);
      });
      m.count = list.length;
      m.instanceMatrix.needsUpdate = true;
      m.frustumCulled = false;
      return m;
    };
    group.add(mkDots(greenDots, new THREE.MeshBasicMaterial({ color: PALETTE.signalGreen })));
    group.add(mkDots(redDots, new THREE.MeshBasicMaterial({ color: PALETTE.signalRed })));
    group.add(mkDots(darkDots, new THREE.MeshStandardMaterial({ color: 0x2c2f26, roughness: 0.6 })));
    // stop signs: thin pole + octagon blank + printed STOP faces.
    // v5 (Jaka fix #1): the v3 face was a cylinder cap, whose UVs
    // mirror the texture — his phone shot showed STOP backwards.
    // The face is now two flat discs with hand-set planar UVs: the
    // front disc reads correctly from +Z (u grows with +x), and the
    // back disc is the SAME planar mapping carried through a π yaw
    // — the yaw itself negates x, so u ends up shrinking with +x,
    // which is exactly what a viewer standing at -Z needs to read
    // it un-mirrored. (Flipping U as well would mirror it again —
    // the v5 play-test asserts both slopes.)
    const stopPoleGeo = new THREE.CylinderGeometry(0.05, 0.06, SCALE.signH, 6);
    stopPoleGeo.translate(0, SCALE.signH / 2, 0);
    const stopPoles = new THREE.InstancedMesh(stopPoleGeo, sigMat, Math.max(1, stops.length));
    const rimGeo = new THREE.CylinderGeometry(0.47, 0.47, 0.045, 8);
    rimGeo.rotateX(Math.PI / 2);
    rimGeo.rotateZ(Math.PI / 8);
    rimGeo.translate(0, SCALE.signH + 0.25, 0);
    const rimMat = new THREE.MeshStandardMaterial({
      color: PALETTE.signRed, roughness: 0.5,
    });
    const rims = new THREE.InstancedMesh(rimGeo, rimMat, Math.max(1, stops.length));
    const stopTex = stopSignTexture();
    const disc = () => {
      const d = new THREE.CircleGeometry(0.455, 8);
      d.rotateZ(Math.PI / 8); // flat top, matching the printed ring
      // planar UVs recomputed from the ROTATED positions (three.js
      // leaves UVs behind when geometry rotates, which would skew
      // the print against the blank's outline)
      const p = d.attributes.position, uv = d.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        uv.setXY(i, p.getX(i) / 0.91 + 0.5, p.getY(i) / 0.91 + 0.5);
      }
      return d;
    };
    const faceF = disc();
    faceF.translate(0, SCALE.signH + 0.25, 0.028);
    const faceB = disc();
    faceB.rotateY(Math.PI);
    faceB.translate(0, SCALE.signH + 0.25, -0.028);
    const faceGeo = mergeGeoms([faceF, faceB]);
    const stopMat = new THREE.MeshStandardMaterial({
      map: stopTex, roughness: 0.5,
    });
    const faces = new THREE.InstancedMesh(faceGeo, stopMat, Math.max(1, stops.length));
    // exposed for the v5 play-test's mirror audit + render readback
    worldInfo.stopFace = { geo: faceGeo, tex: stopTex };
    stops.forEach((s, si) => {
      dummy.position.set(s.x, 0, s.z);
      dummy.rotation.set(0, s.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      stopPoles.setMatrixAt(si, dummy.matrix);
      rims.setMatrixAt(si, dummy.matrix);
      faces.setMatrixAt(si, dummy.matrix);
    });
    stopPoles.count = stops.length;
    rims.count = stops.length;
    faces.count = stops.length;
    stopPoles.instanceMatrix.needsUpdate = true;
    rims.instanceMatrix.needsUpdate = true;
    faces.instanceMatrix.needsUpdate = true;
    stopPoles.frustumCulled = false;
    rims.frustumCulled = false;
    faces.frustumCulled = false;
    group.add(stopPoles, rims, faces);
  }

  // -- v3 BENCHES (Jaka fix #7): slatted waiting benches along
  //    sidewalk edges, the promenade and the pier — validated
  //    placement, never on the road, never through other furniture.
  const benchSpots = [];
  {
    const benchClear = (x, z) => {
      for (const r of worldInfo.roadRects) if (pointInRect(x, z, r, 0.3)) return false;
      for (const r of worldInfo.buildingRects) if (rectDist(x, z, r) < 1.0) return false;
      for (const t of treeSpots) {
        const dx = t.x - x, dz = t.z - z;
        if (dx * dx + dz * dz < 2.4 * 2.4) return false;
      }
      for (const l of lampSpots) {
        const dx = l.x - x, dz = l.z - z;
        if (dx * dx + dz * dz < 1.8 * 1.8) return false;
      }
      for (const s of signSpots) {
        const dx = s.x - x, dz = s.z - z;
        if (dx * dx + dz * dz < 1.8 * 1.8) return false;
      }
      for (const b of benchSpots) {
        const dx = b.x - x, dz = b.z - z;
        if (dx * dx + dz * dz < 6 * 6) return false;
      }
      return true;
    };
    const addBench = (x, z, yaw, y = 0) => {
      if (benchClear(x, z)) benchSpots.push({ x, z, yaw, y });
    };
    // promenade benches facing the sea + east-side benches facing it too
    for (let z = -170; z <= 180; z += 35) addBench(-222.1, z, -Math.PI / 2);
    for (let z = -150; z <= 170; z += 40) addBench(-197.8, z + 12, -Math.PI / 2);
    // city sidewalks: inner strip edge at block middles, facing the road
    for (let i = 1; i <= CFG.gridN; i += 2) {
      const p = roadCoord(i);
      const hw = roadHalfAt(p);
      for (let b = 0; b < CFG.gridN; b += 2) {
        const mid = -HALF + CFG.roadW / 2 + b * PITCH + CFG.block / 2;
        addBench(p + hw + 2.28, mid, -Math.PI / 2);
        addBench(mid, p - hw - 2.28, 0);
      }
    }
    // pier benches facing the water (deck top is y = 1.5)
    addBench(-262, 58.5, -Math.PI / 2, 1.5);
    addBench(-276, 61.5, -Math.PI / 2, 1.5);
    worldInfo.benches = benchSpots.map((b) => ({ x: b.x, z: b.z }));
    const slatParts = [], legParts = [];
    for (const dz of [-0.16, 0, 0.16]) {
      const s = new THREE.BoxGeometry(SCALE.benchL, 0.045, 0.115);
      s.translate(0, SCALE.benchSeatH, dz);
      slatParts.push(s);
    }
    for (const dy of [0.66, 0.84]) {
      const s = new THREE.BoxGeometry(SCALE.benchL, 0.11, 0.04);
      s.translate(0, dy, -0.26);
      slatParts.push(s);
    }
    for (const sx of [-0.78, 0.78]) {
      const leg = new THREE.BoxGeometry(0.06, SCALE.benchSeatH, 0.52);
      leg.translate(sx, SCALE.benchSeatH / 2, 0);
      legParts.push(leg);
      const post = new THREE.BoxGeometry(0.06, 0.5, 0.05);
      post.translate(sx, SCALE.benchSeatH + 0.22, -0.26);
      legParts.push(post);
    }
    const slats = new THREE.InstancedMesh(
      mergeGeoms(slatParts),
      new THREE.MeshStandardMaterial({ color: PALETTE.benchWood, roughness: 0.85 }),
      Math.max(1, benchSpots.length)
    );
    const legs = new THREE.InstancedMesh(
      mergeGeoms(legParts),
      new THREE.MeshStandardMaterial({ color: PALETTE.benchIron, roughness: 0.6, metalness: 0.4 }),
      Math.max(1, benchSpots.length)
    );
    const dummy = new THREE.Object3D();
    benchSpots.forEach((b, idx) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      slats.setMatrixAt(idx, dummy.matrix);
      legs.setMatrixAt(idx, dummy.matrix);
    });
    slats.count = benchSpots.length;
    legs.count = benchSpots.length;
    slats.castShadow = true;
    slats.instanceMatrix.needsUpdate = true;
    legs.instanceMatrix.needsUpdate = true;
    slats.frustumCulled = false;
    legs.frustumCulled = false;
    group.add(slats, legs);
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
    posts.frustumCulled = false;
    group.add(posts);
    // v3 audit: support posts under the deck (it floated 0.5 m over
    // the sand/water with nothing holding it up)
    const supGeo = new THREE.CylinderGeometry(0.22, 0.22, 1.6, 6);
    const sups = new THREE.InstancedMesh(supGeo, postMat, 10);
    let si = 0;
    for (let i = 0; i < 5; i++) {
      for (const zz of [57.2, 62.8]) {
        dummy.position.set(-HALF - 34 - i * 13, 0.2, zz);
        dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        sups.setMatrixAt(si++, dummy.matrix);
      }
    }
    sups.instanceMatrix.needsUpdate = true;
    sups.frustumCulled = false;
    group.add(sups);
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
    // v6 (brief C): the fence now has a GATE GAP at the pier / beach
    // bar approach (z 53..67) — v5 fenced the mission spot shut.
    const mkFence = (z0, z1) => {
      const len = z1 - z0;
      const t = fenceTex.clone();
      t.needsUpdate = true;
      t.repeat.set(len / 12, 1);
      const f = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.2),
        new THREE.MeshBasicMaterial({
          map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false,
        }));
      // v3 audit: x=-218 stood ON the avenue's west lane (avenue spans
      // -220..-200) — the fence belongs on the sand side of the promenade
      f.position.set(-HALF - 12.9, 0.7, (z0 + z1) / 2);
      f.rotation.y = Math.PI / 2;
      group.add(f);
    };
    mkFence(-180, 53);
    mkFence(67, 180);
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

// road coordinate helpers (shared by traffic / missions / staging)
export function roadCoord(i) { return -HALF + i * PITCH; }
export function roadHalfAt(coord) {
  const i = Math.round((coord + HALF) / PITCH);
  return (i % CFG.avenueEvery === 0) ? (CFG.roadW + 6) / 2 : CFG.roadW / 2;
}
export function nearestRoadCoord(v) {
  const i = Math.round((v + HALF) / PITCH);
  return roadCoord(Math.max(0, Math.min(CFG.gridN, i)));
}
export function onRoad(x, z) {
  const dx = Math.abs(x - nearestRoadCoord(x));
  const dz = Math.abs(z - nearestRoadCoord(z));
  return dx < CFG.roadW / 2 + 1 || dz < CFG.roadW / 2 + 1;
}
