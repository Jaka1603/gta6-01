// PALMBAY HEAT — hud.js (v3): DOM HUD (cash, health, wanted stars,
// weapon, objective, sunset clock) + 2D minimap canvas + phone popups.
// The minimap is drawn from the SAME city layout data as the 3D world
// (worldInfo.blocks + road lines), so streets and blocks read true:
// blocks grey, roads dark, water teal, beach sand, gang turf green.
// v3 audit: the player arrow was mirrored (it pointed south while the
// player faced north) and the sea/beach bands sat ~30 m east of the
// real shoreline — both now drawn from world-true coordinates.
import { CFG, clamp } from './config.js';
import { roadCoord, worldInfo } from './world.js';

export class HUD {
  constructor(root) {
    this.root = root;
    this.el = {};
    this.buildDOM();
    this.popups = [];
  }
  buildDOM() {
    const mk = (id, cls, html) => {
      const d = document.createElement('div');
      d.id = id; d.className = cls; d.innerHTML = html;
      this.root.appendChild(d);
      this.el[id] = d;
      return d;
    };
    mk('hud-cash', 'hud cash', '$0');
    mk('hud-clock', 'hud clock', '🕕 18:30');
    mk('hud-health', 'hud health', '');
    mk('hud-stars', 'hud stars', '');
    mk('hud-weapon', 'hud weapon', '👊 FISTS');
    mk('hud-objective', 'hud objective', '');
    mk('hud-timer', 'hud timer', '');
    mk('hud-speed', 'hud speed', '');
    mk('hud-bust', 'hud bust', '');
    mk('hud-zone', 'hud zone', '');
    mk('hud-center', 'hud center', '');
    // v5 mission guide (Jaka fix #3): a live arrow + distance that
    // always point at the current objective, SA-style
    const guide = mk('hud-guide', 'hud guide',
      '<span id="guide-arrow">▲</span><span id="guide-dist"></span>');
    guide.style.display = 'none';
    this.guideArrow = guide.querySelector('#guide-arrow');
    this.guideDist = guide.querySelector('#guide-dist');
    this.guideState = { angle: 0, dist: 0, visible: false };
    // v5 amendment: contextual action prompt ("E — Masuk Mobil"),
    // projected next to the car it refers to (see main.js)
    const prompt = mk('hud-prompt', 'hud prompt', '');
    prompt.style.display = 'none';
    this.promptState = { text: '', x: 0, y: 0, visible: false };
    // minimap
    const mm = document.createElement('canvas');
    mm.id = 'minimap'; mm.width = 190; mm.height = 190;
    mm.className = 'minimap';
    this.root.appendChild(mm);
    this.minimap = mm;
    this.mmCtx = mm.getContext('2d');
    // phone popup area
    mk('hud-phone', 'hud phone', '');
    // crosshair
    mk('hud-cross', 'hud cross', '+');
  }
  setCash(n) { this.el['hud-cash'].textContent = '$' + Math.floor(n).toLocaleString('en-US'); }
  setClock(minutes) {
    const h = Math.floor(minutes / 60) % 24;
    const m = Math.floor(minutes % 60);
    this.el['hud-clock'].textContent = '🕕 ' + h + ':' + String(m).padStart(2, '0');
  }
  setZone(name) {
    const el = this.el['hud-zone'];
    if (name) {
      el.textContent = '📍 ' + name;
      el.style.display = 'block';
    } else el.style.display = 'none';
  }
  setHealth(pct) {
    const w = Math.round(clamp(pct, 0, 1) * 100);
    this.el['hud-health'].innerHTML =
      '<div class="bar"><div class="fill" style="width:' + w + '%"></div></div>' +
      '<span>❤ ' + w + '</span>';
  }
  setStars(n) {
    let s = '';
    for (let i = 0; i < 5; i++) {
      s += i < n ? '★' : '<span style="opacity:.35">★</span>';
    }
    this.el['hud-stars'].innerHTML = s;
    this.el['hud-stars'].classList.toggle('hot', n >= 3);
  }
  setWeapon(w, ammo) {
    this.el['hud-weapon'].textContent =
      w === 'pistol' ? '🔫 PISTOL · ' + ammo : '👊 FISTS';
    // crosshair only when aiming the pistol
    this.el['hud-cross'].style.display = w === 'pistol' ? 'block' : 'none';
  }
  setObjective(text) {
    this.el['hud-objective'].innerHTML = text ? '🎯 ' + text : '';
    this.el['hud-objective'].style.display = text ? 'block' : 'none';
  }
  // v5: angle = screen-relative bearing to the target (0 = straight
  // ahead, + = target to the right); dist in metres. null hides it.
  setGuide(angle, dist) {
    const el = this.el['hud-guide'];
    if (angle === null || angle === undefined) {
      if (this.guideState.visible) {
        el.style.display = 'none';
        this.guideState.visible = false;
      }
      return;
    }
    this.guideState.angle = angle;
    this.guideState.dist = dist;
    this.guideState.visible = true;
    el.style.display = 'flex';
    this.guideArrow.style.transform = 'rotate(' + angle + 'rad)';
    const d = Math.round(dist);
    if (this._guideDistShown !== d) {
      this._guideDistShown = d;
      this.guideDist.textContent = d + ' m';
    }
  }
  // v5 amendment: show/hide the projected action prompt. x/y are
  // CSS pixels; the element is centred on x and floats above y.
  setPrompt(text, x, y) {
    const el = this.el['hud-prompt'];
    if (!text) {
      if (this.promptState.visible) {
        el.style.display = 'none';
        this.promptState.visible = false;
        this.promptState.text = '';
      }
      return;
    }
    this.promptState.text = text;
    this.promptState.x = x;
    this.promptState.y = y;
    this.promptState.visible = true;
    el.style.display = 'block';
    if (el.textContent !== text) el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
  }
  setTimer(sec) {
    if (sec > 0) {
      const m = Math.floor(sec / 60);
      const s = Math.floor(sec % 60);
      this.el['hud-timer'].textContent = '⏱ ' + m + ':' + String(s).padStart(2, '0');
      this.el['hud-timer'].style.display = 'block';
    } else this.el['hud-timer'].style.display = 'none';
  }
  setSpeed(kmh) {
    this.el['hud-speed'].textContent = kmh > 1 ? Math.round(kmh) + ' km/h' : '';
  }
  setBust(pct) {
    const el = this.el['hud-bust'];
    if (pct > 0.02) {
      el.textContent = '🚨 BUST ' + Math.round(pct * 100) + '%';
      el.style.display = 'block';
    } else el.style.display = 'none';
  }
  center(text, sub = '') {
    const el = this.el['hud-center'];
    el.innerHTML = sub ? '<b>' + text + '</b><span>' + sub + '</span>' : '<b>' + text + '</b>';
    el.classList.add('show');
    clearTimeout(this._centerT);
    this._centerT = setTimeout(() => el.classList.remove('show'), 2600);
  }
  phone(from, text) {
    const box = this.el['hud-phone'];
    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.innerHTML = '<b>' + from + '</b><span>' + text + '</span>';
    box.appendChild(msg);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(() => { if (msg.parentNode) msg.parentNode.removeChild(msg); }, 6000);
  }
  // --- minimap: same layout data as the 3D city ---
  drawMinimap(player, policeCars, missionTarget, chaseCar) {
    const ctx = this.mmCtx;
    const S = 190, HALF = 210, scale = S / (HALF * 2 + 60);
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(20, 28, 40, 0.85)';
    ctx.fillRect(0, 0, S, S);
    const toMap = (x, z) => [S / 2 + x * scale, S / 2 + z * scale];
    // sea + beach at their true world x bands: water west of -245,
    // sand -250..-210 (the avenue covers the rest of the strip)
    const [seaEdge] = toMap(-245, 0);
    const [sandW] = toMap(-250, 0);
    const [sandE] = toMap(-210, 0);
    ctx.fillStyle = '#2a6a8a';
    ctx.fillRect(0, 0, Math.max(0, seaEdge), S);
    ctx.fillStyle = '#e8c890';
    ctx.fillRect(Math.max(0, sandW), 0, sandE - Math.max(0, sandW), S);
    // gang turf tint (green wash over those blocks)
    const gt = worldInfo.gangTurf;
    if (gt) {
      const [x0, y0] = toMap(gt.x0, gt.z0);
      const [x1, y1] = toMap(gt.x1, gt.z1);
      ctx.fillStyle = 'rgba(46,158,74,0.35)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // city blocks (grey, from the real layout)
    ctx.fillStyle = '#4a5568';
    for (const b of worldInfo.blocks) {
      const [x0, y0] = toMap(b.x0, b.z0);
      const [x1, y1] = toMap(b.x1, b.z1);
      ctx.fillRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    }
    // roads (dark lines over the blocks)
    ctx.strokeStyle = '#232830';
    ctx.lineWidth = 5;
    for (let i = 0; i <= CFG.gridN; i++) {
      const c = roadCoord(i);
      const [x] = toMap(c, 0);
      const [, y] = toMap(0, c);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
    }
    // mission marker
    if (missionTarget) {
      const [mx, my] = toMap(missionTarget[0], missionTarget[1]);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.arc(mx, my, 7, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(mx, my, 10, 0, Math.PI * 2); ctx.stroke();
    }
    // chase car
    if (chaseCar) {
      const [cx, cy] = toMap(chaseCar.position.x, chaseCar.position.z);
      ctx.fillStyle = '#3a86ff';
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    }
    // police blips
    for (const car of policeCars) {
      const [px, py] = toMap(car.position.x, car.position.z);
      ctx.fillStyle = '#ff4040';
      ctx.beginPath(); ctx.arc(px, py, 4, 0, Math.PI * 2); ctx.fill();
    }
    // player arrow — canvas rotation is π − heading: the map's +z
    // points DOWN the canvas, so a raw heading mirrors the arrow
    const [px, py] = toMap(player.x, player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(Math.PI - player.heading);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
