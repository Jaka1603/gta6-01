// PALMBAY HEAT — textures.js (v2): every surface texture is painted on a
// 2D canvas at load — asphalt, sidewalks, facades (map + emissiveMap pair),
// sand, grass, water, glow, plates, police doors, billboards. Seeded RNG
// only; colour textures are tagged sRGB; anisotropy set for grazing views.
const THREE = window.THREE;
import { PALETTE } from './config.js';

const ANISO = 8;

export function canvasTexture(w, h, painter, opts = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  painter(c.getContext('2d'), w, h);
  const tex = new THREE.CanvasTexture(c);
  if (opts.srgb !== false) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  const r = opts.repeat || [1, 1];
  tex.repeat.set(r[0], r[1]);
  tex.anisotropy = ANISO;
  return tex;
}

export function grain(ctx, w, h, rand, n, alpha, light) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = light
      ? 'rgba(255,255,255,' + alpha + ')'
      : 'rgba(0,0,0,' + alpha + ')';
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
}

export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) * f);
  const g = Math.min(255, ((n >> 8) & 255) * f);
  const b = Math.min(255, (n & 255) * f);
  return 'rgb(' + (r | 0) + ',' + (g | 0) + ',' + (b | 0) + ')';
}

// --- asphalt: dark grain, repair patches, cracks, oil stains ---
// v6 (brief H): finer two-scale grain, tar-sealed crack snakes,
// patched utility cuts and painted manhole covers baked in, so the
// surface reads detailed at street level, not flat grey.
export function asphaltTexture(rand) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = PALETTE.asphalt;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, rand, 9000, 0.05, true);
    grain(ctx, w, h, rand, 9000, 0.06, false);
    grain(ctx, w, h, rand, 6000, 0.035, true);
    grain(ctx, w, h, rand, 6000, 0.04, false);
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = PALETTE.asphaltPatch;
      ctx.globalAlpha = 0.5 + rand() * 0.3;
      ctx.fillRect(rand() * w, rand() * h, 40 + rand() * 120, 30 + rand() * 80);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      let x = rand() * w, y = rand() * h;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (rand() - 0.5) * 60;
        y += rand() * 30;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // tar snakes: glossy black sealed cracks, wider than hairlines
    ctx.strokeStyle = 'rgba(12,12,16,0.55)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      ctx.lineWidth = 3 + rand() * 3;
      ctx.beginPath();
      let x = rand() * w, y = rand() * h;
      ctx.moveTo(x, y);
      for (let j = 0; j < 4; j++) {
        x += (rand() - 0.5) * 90;
        y += (rand() - 0.5) * 90;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // utility cut: a straight-edged repair trench with a lighter fill
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    const ux = rand() * w * 0.7, uy = rand() * h * 0.7;
    ctx.fillRect(ux, uy, 130, 26);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 2;
    ctx.strokeRect(ux, uy, 130, 26);
    for (let i = 0; i < 4; i++) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 30 + rand() * 40);
      g.addColorStop(0, 'rgba(10,10,14,0.35)');
      g.addColorStop(1, 'rgba(10,10,14,0)');
      ctx.save();
      ctx.translate(rand() * w, rand() * h);
      ctx.fillStyle = g;
      ctx.fillRect(-80, -80, 160, 160);
      ctx.restore();
    }
    // manhole covers: dark iron discs with a rim + grip dots
    for (let i = 0; i < 2; i++) {
      const mx = 60 + rand() * (w - 120), my = 60 + rand() * (h - 120);
      ctx.fillStyle = '#2c2e33';
      ctx.beginPath(); ctx.arc(mx, my, 21, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(mx, my, 21, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(200,205,215,0.28)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 15, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(200,205,215,0.30)';
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(mx + Math.cos(a) * 9, my + Math.sin(a) * 9, 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });
}

// --- lane markings strip: dashed yellow centre + white edges ---
// v6 (brief H): crisper paint — brighter, slightly worn dashes with
// soft edge falloff and full-strength edge lines.
export function laneTexture() {
  return canvasTexture(128, 512, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, w, h);
    // centre dash: bright worn yellow, one dash per tile
    ctx.fillStyle = '#e8d06a';
    ctx.fillRect(w / 2 - 3, 40, 6, 90);
    ctx.fillStyle = 'rgba(59,62,68,0.35)';
    ctx.fillRect(w / 2 - 3, 62, 6, 7);
    ctx.fillRect(w / 2 - 3, 96, 6, 5);
    // edge lines: solid, near-opaque white
    ctx.fillStyle = 'rgba(245,245,238,0.95)';
    ctx.fillRect(4, 0, 4, h);
    ctx.fillRect(w - 8, 0, 4, h);
    ctx.fillStyle = 'rgba(59,62,68,0.22)';
    ctx.fillRect(4, 130, 4, 26);
    ctx.fillRect(w - 8, 340, 4, 30);
  });
}

// --- sidewalk slabs with expansion joints and a dirt line ---
export function sidewalkTexture(rand) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = PALETTE.sidewalk;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, rand, 5000, 0.05, false);
    grain(ctx, w, h, rand, 2000, 0.04, true);
    ctx.strokeStyle = 'rgba(70,64,54,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, h - 6, w, 6);
  });
}

// --- building facade: day map + lit-window emissive map, same layout ---
export function facadeTextures(rand, opts = {}) {
  const w = opts.w || 256;
  const h = opts.h || 512;
  const wall = opts.wall || PALETTE.wallPastels[0];
  const cols = opts.cols || 5;
  const rows = opts.rows || 9;
  const litRatio = opts.litRatio == null ? 0.35 : opts.litRatio;
  const layout = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      layout.push({
        c, r,
        lit: rand() < litRatio,
        shade: 0.85 + rand() * 0.3,
      });
    }
  }
  const win = (ctx, fill) => {
    const cw = w / cols, ch = h / rows;
    for (const L of layout) {
      const x = L.c * cw + cw * 0.22;
      const y = L.r * ch + ch * 0.2;
      const ww = cw * 0.56, wh = ch * 0.55;
      ctx.fillStyle = fill(L.lit, L.shade);
      ctx.fillRect(x, y, ww, wh);
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(x, y, ww, 2);
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(x, y + wh / 2 - 1, ww, 2);
    }
  };
  const map = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, rand, 2500, 0.04, false);
    // stucco banding: subtle horizontal lines per floor
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let r = 0; r < rows; r++) ctx.fillRect(0, (r * h) / rows, w, 2);
    win(ctx, (lit, s) => lit ? '#8a6f3c' : shade(PALETTE.windowDark, s));
    // shopfront band at street level
    ctx.fillStyle = 'rgba(0,0,0,0.28)';
    ctx.fillRect(0, h - 26, w, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, h - 10, w, 10);
  });
  const emissiveMap = canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    win(ctx, (lit) => lit ? '#ffca7a' : '#000');
  });
  return { map, emissiveMap };
}

// --- sand: pale base, fine grain, shell specks ---
export function sandTexture(rand) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, rand, 6000, 0.06, false);
    grain(ctx, w, h, rand, 3000, 0.05, true);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 40; i++) {
      ctx.fillRect(rand() * w, rand() * h, 2, 2);
    }
  });
}

// --- grass / dirt ground outside the city grid ---
export function groundTexture(rand) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, rand, 8000, 0.08, false);
    grain(ctx, w, h, rand, 5000, 0.06, true);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = 'rgba(90,70,40,0.25)';
      ctx.beginPath();
      ctx.arc(rand() * w, rand() * h, 12 + rand() * 26, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// --- water: soft horizontal streaks on teal ---
export function waterTexture(rand) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#2e8fa3';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) {
      ctx.fillStyle = rand() < 0.5
        ? 'rgba(127,212,217,0.35)'
        : 'rgba(20,80,110,0.3)';
      const y = rand() * h;
      ctx.fillRect(rand() * w, y, 20 + rand() * 60, 2 + rand() * 3);
    }
  });
}

// --- wooden pier planks ---
export function plankTexture(rand) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#8a6a4a';
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, rand, 3000, 0.07, false);
    ctx.strokeStyle = 'rgba(40,26,12,0.8)';
    ctx.lineWidth = 2;
    for (let x = 0; x <= w; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, h);
      ctx.stroke();
    }
  });
}

// --- shared radial glow (headlights, muzzle flash, lamps) ---
export function glowTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 2, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// --- soft dark blob for contact shadows under cars ---
export function blobTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.7, 'rgba(0,0,0,0.28)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

// --- licence plate with text ---
export function plateTexture(text) {
  return canvasTexture(128, 32, (ctx, w, h) => {
    ctx.fillStyle = '#f2f2ea';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#2244aa';
    ctx.lineWidth = 3;
    ctx.strokeRect(2, 2, w - 4, h - 4);
    ctx.fillStyle = '#1a2a44';
    ctx.font = 'bold 19px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);
  });
}

// --- police door: white door panel, POLICE + star badge ---
export function policeDoorTexture() {
  return canvasTexture(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#f4f4f0';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#1a1a22';
    ctx.font = 'bold 44px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('POLICE', w / 2 + 28, h / 2);
    // seven-point star badge
    ctx.save();
    ctx.translate(42, h / 2);
    ctx.fillStyle = '#c8a030';
    ctx.beginPath();
    for (let i = 0; i < 14; i++) {
      const r = i % 2 === 0 ? 26 : 11;
      const a = (i / 14) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1a2a44';
    ctx.beginPath();
    ctx.arc(0, 0, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#1a1a22';
    ctx.font = 'bold 13px Arial, sans-serif';
    ctx.fillText('PALM BAY', w / 2 + 28, h - 16);
  });
}

// --- painted billboard (not neon): big flat-colour ad art ---
export function billboardTexture(text, sub, bg, fg) {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.font = 'bold 64px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 - 20);
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.fillText(sub, w / 2, h / 2 + 52);
    ctx.strokeStyle = fg;
    ctx.lineWidth = 6;
    ctx.strokeRect(8, 8, w - 16, h - 16);
  });
}

// --- v3 zebra crossing tile: worn white bars on transparency ---
// Bars run along V (the traffic direction once laid); the tile repeats
// along U across the road. One tile = ~4.2 m of crossing width.
export function zebraTexture() {
  return canvasTexture(128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(245,245,235,0.92)';
    for (let x = 5; x < w; x += 32) ctx.fillRect(x, 4, 17, h - 8);
    // worn patches so the paint reads used, not freshly sprayed
    // (tiny local LCG — this file is seeded-RNG only)
    let seed = 1234567;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    ctx.fillStyle = 'rgba(40,40,44,0.25)';
    for (let i = 0; i < 26; i++) {
      ctx.fillRect(rnd() * w, rnd() * h, 3 + rnd() * 7, 2 + rnd() * 4);
    }
  });
}

// --- v5 stop sign face: red field, white OCTAGON ring + STOP ---
// v3 drew a square border and let the cap geometry cut the corners;
// the cylinder-cap UVs also mirrored the text (Jaka's phone shot
// showed STOP backwards). v5 draws the real octagonal ring and the
// texture is applied to flat CircleGeometry discs (planar UVs), so
// the text reads correctly from BOTH approach sides.
export function stopSignTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    const cx = w / 2, cy = h / 2;
    ctx.fillStyle = '#c0272d';
    ctx.fillRect(0, 0, w, h);
    // octagon ring, flat-top orientation matching the sign blank
    const ring = (r) => {
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
        const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    ctx.strokeStyle = '#f5f2ea';
    ctx.lineWidth = 11;
    ring(104);
    ctx.stroke();
    ctx.fillStyle = '#f5f2ea';
    ctx.font = 'bold 82px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('STOP', cx, cy + 4);
  });
}

// --- v5 car side panel: door seams + handles on transparency ---
// Laid over both flanks of every car (one shared texture): front and
// rear door outlines, two handles, a fuel flap and a sill shadow.
// Transparent elsewhere, so it reads over any paint colour.
export function carSideTexture() {
  return canvasTexture(512, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(12,12,16,0.55)';
    ctx.lineWidth = 3;
    // rear door (left of canvas = rear of car once mapped)
    ctx.strokeRect(52, 14, 168, 96);
    // front door
    ctx.strokeRect(238, 14, 196, 96);
    // handles: small rounded bars near the top rear of each door
    ctx.fillStyle = 'rgba(15,15,20,0.8)';
    const handle = (x, y) => {
      ctx.beginPath();
      ctx.roundRect(x, y, 34, 9, 4);
      ctx.fill();
    };
    handle(178, 30);
    handle(392, 30);
    // fuel flap on the rear quarter
    ctx.beginPath();
    ctx.arc(30, 44, 11, 0, Math.PI * 2);
    ctx.stroke();
    // sill shadow along the bottom edge
    const g = ctx.createLinearGradient(0, h - 26, 0, h);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g;
    ctx.fillRect(0, h - 26, w, 26);
    // wheel-arch shading hints at both ends
    ctx.fillStyle = 'rgba(0,0,0,0.20)';
    ctx.beginPath(); ctx.arc(84, h, 46, Math.PI, 0); ctx.fill();
    ctx.beginPath(); ctx.arc(w - 84, h, 46, Math.PI, 0); ctx.fill();
  });
}

// --- v3 minifig face: classic smile printed on the head cylinder ---
// White background on purpose: the head material's colour multiplies
// the map, so the white becomes the figure's skin tone and only the
// printed features stay dark. Face is centred at u = 0.5.
export function faceTexture() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#26211c';
    // eyes
    for (const dx of [-30, 30]) {
      ctx.beginPath();
      ctx.ellipse(w / 2 + dx, 108, 9, 14, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // the classic smile
    ctx.strokeStyle = '#26211c';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(w / 2, 128, 34, Math.PI * 0.18, Math.PI * 0.82);
    ctx.stroke();
    // soft cheeks
    ctx.fillStyle = 'rgba(232,140,110,0.55)';
    for (const dx of [-52, 52]) {
      ctx.beginPath();
      ctx.arc(w / 2 + dx, 140, 13, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

// --- v3 minifig torso prints (transparent plate over the torso) ---
// kind: 'civil' (variant 0..3) | 'police' | 'gang' | 'hero'
export function torsoPrintTexture(kind, variant = 0) {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    const ink = 'rgba(30,26,34,0.85)';
    const line = (x0, y0, x1, y1, lw = 5) => {
      ctx.strokeStyle = ink; ctx.lineWidth = lw; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    };
    if (kind === 'police') {
      // navy uniform print: tie, button line, two pockets, gold badge
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 13, 8); ctx.lineTo(w / 2 + 13, 8);
      ctx.lineTo(w / 2 + 5, 74); ctx.lineTo(w / 2 - 5, 74);
      ctx.closePath(); ctx.fill();
      for (let y = 96; y <= 216; y += 30) {
        ctx.beginPath(); ctx.arc(w / 2, y, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = ink; ctx.lineWidth = 5;
      ctx.strokeRect(26, 118, 62, 46);
      ctx.strokeRect(w - 88, 118, 62, 46);
      // gold badge on the left chest
      ctx.fillStyle = '#d8a030';
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 17 : 8;
        const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
        const x = 57 + Math.cos(a) * r, y = 84 + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath(); ctx.fill();
      // shoulder bars
      ctx.fillStyle = ink;
      ctx.fillRect(14, 16, 44, 10);
      ctx.fillRect(w - 58, 16, 44, 10);
    } else if (kind === 'gang') {
      // white undershirt V under the green shirt + gold chain
      ctx.fillStyle = 'rgba(245,245,240,0.95)';
      ctx.beginPath();
      ctx.moveTo(w / 2 - 34, 6); ctx.lineTo(w / 2 + 34, 6);
      ctx.lineTo(w / 2, 74);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#d8a030'; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(w / 2, 34, 40, Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();
      ctx.strokeStyle = ink; ctx.lineWidth = 5;
      ctx.strokeRect(30, 132, 58, 44);
    } else if (kind === 'hero') {
      // tank-top shading: strap shadows + a low neckline shadow
      ctx.fillStyle = 'rgba(30,26,34,0.20)';
      ctx.fillRect(16, 0, 30, 66);
      ctx.fillRect(w - 46, 0, 30, 66);
      ctx.beginPath();
      ctx.arc(w / 2, 2, 52, Math.PI * 0.15, Math.PI * 0.85);
      ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(30,26,34,0.20)';
      ctx.stroke();
    } else if (variant === 1) {
      // horizontal stripes
      ctx.fillStyle = 'rgba(30,26,34,0.28)';
      for (let y = 44; y < h - 20; y += 44) ctx.fillRect(8, y, w - 16, 17);
    } else if (variant === 2) {
      // necklace + pendant
      ctx.strokeStyle = '#d8a030'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(w / 2, 26, 44, Math.PI * 0.25, Math.PI * 0.75); ctx.stroke();
      ctx.fillStyle = '#d8a030';
      ctx.beginPath(); ctx.arc(w / 2, 76, 9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = ink; ctx.lineWidth = 5;
      ctx.strokeRect(28, 138, 56, 42);
    } else if (variant === 3) {
      // big chest emblem
      ctx.fillStyle = 'rgba(245,245,240,0.9)';
      ctx.beginPath(); ctx.arc(w / 2, 108, 40, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ink;
      ctx.font = 'bold 52px Arial, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('PB', w / 2, 112);
    } else {
      // plain tee: chest pocket + button placket
      ctx.strokeStyle = ink; ctx.lineWidth = 5;
      ctx.strokeRect(30, 120, 58, 46);
      line(w / 2, 20, w / 2, 90, 4);
    }
  });
}
