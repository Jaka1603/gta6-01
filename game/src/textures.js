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
export function asphaltTexture(rand) {
  return canvasTexture(512, 512, (ctx, w, h) => {
    ctx.fillStyle = PALETTE.asphalt;
    ctx.fillRect(0, 0, w, h);
    grain(ctx, w, h, rand, 9000, 0.05, true);
    grain(ctx, w, h, rand, 9000, 0.06, false);
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
  });
}

// --- lane markings strip: dashed yellow centre + white edges ---
export function laneTexture() {
  return canvasTexture(128, 512, (ctx, w, h) => {
    ctx.fillStyle = 'rgba(0,0,0,0)';
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#d8c86a';
    ctx.fillRect(w / 2 - 3, 40, 6, 90);   // one dash per tile
    ctx.fillStyle = 'rgba(240,240,230,0.9)';
    ctx.fillRect(4, 0, 4, h);
    ctx.fillRect(w - 8, 0, 4, h);
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
