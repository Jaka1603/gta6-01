// PALMBAY HEAT — hud.js: DOM HUD (cash, health, wanted stars, weapon,
// objective) + 2D minimap canvas + phone-style popups.
import { CFG, clamp } from './config.js';
import { roadCoord } from './world.js';

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
    mk('hud-health', 'hud health', '');
    mk('hud-stars', 'hud stars', '');
    mk('hud-weapon', 'hud weapon', '👊 FISTS');
    mk('hud-objective', 'hud objective', '');
    mk('hud-timer', 'hud timer', '');
    mk('hud-speed', 'hud speed', '');
    mk('hud-bust', 'hud bust', '');
    mk('hud-center', 'hud center', '');
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
  setHealth(pct) {
    const w = Math.round(clamp(pct, 0, 1) * 100);
    this.el['hud-health'].innerHTML =
      '<div class="bar"><div class="fill" style="width:' + w + '%"></div></div>' +
      '<span>❤ ' + w + '</span>';
  }
  setStars(n) {
    let s = '';
    for (let i = 0; i < 5; i++) s += i < n ? '★' : '☆';
    this.el['hud-stars'].textContent = s;
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
  // --- minimap ---
  drawMinimap(player, policeCars, missionTarget, chaseCar) {
    const ctx = this.mmCtx;
    const S = 190, HALF = 210, scale = S / (HALF * 2 + 40);
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(20, 28, 40, 0.85)';
    ctx.fillRect(0, 0, S, S);
    const toMap = (x, z) => [S / 2 + x * scale, S / 2 + z * scale];
    // sea (west)
    ctx.fillStyle = '#2a6a8a';
    ctx.fillRect(0, 0, S / 2 - HALF * scale, S);
    // beach
    ctx.fillStyle = '#e8c890';
    ctx.fillRect(S / 2 - HALF * scale, 0, 14, S);
    // roads
    ctx.strokeStyle = '#5a5a66';
    ctx.lineWidth = 4;
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
    // player arrow
    const [px, py] = toMap(player.x, player.z);
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(player.heading);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(6, 7); ctx.lineTo(-6, 7); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
