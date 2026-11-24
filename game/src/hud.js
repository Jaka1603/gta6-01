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

// v8 weapon slot row (top-1 style): fixed order, icon + short tag;
// ammo renders under the ACTIVE slot only.
const SLOT_DEFS = [
  { id: 'fists', icon: '👊', tag: 'FISTS' },
  { id: 'pistol', icon: '🔫', tag: '.38' },
  { id: 'heavy', icon: '🔫', tag: 'HVY' },
  { id: 'smg', icon: '🔫', tag: 'SMG' },
  { id: 'shotgun', icon: '🔫', tag: '12G' },
  { id: 'rifle', icon: '🔫', tag: 'AR-9' },
];

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
    // v9: hitmarker — flashes over the crosshair on every landed
    // hit (red + longer on a kill), the top-1's "reticle hit" read
    const hm = mk('hud-hitmark', 'hud hitmark', '✕');
    hm.style.display = 'none';
    // v6: aim-mode indicator (AUTO lock-on / MANUAL crosshair)
    mk('hud-aim', 'hud aim', '');
    // v6: lock-on tag under the crosshair while AUTO has a target
    const lock = mk('hud-lock', 'hud locktag', '⌖ LOCK');
    lock.style.display = 'none';
    // v6 presentation (brief N): mission title card, CHECKPOINT
    // banner, district splash, floating money popup, SAVED toast
    mk('hud-titlecard', 'hud titlecard', '');
    mk('hud-banner', 'hud banner', '');
    mk('hud-splash', 'hud splash', '');
    mk('hud-money', 'hud moneypop', '');
    mk('hud-toast', 'hud toast', '');
    this.buildDialogue();
    this.buildV8Panels(mk);
  }
  // ---- v8 rich named HUD (top-1 lessons A) ------------------------
  // Police response panel, weapon slot row, crew ability cards,
  // rank bar, wanted status line, district block, radio line and
  // the chase target bar. Built once; refreshed at HUD rate.
  buildV8Panels(mk) {
    const panel = mk('hud-police', 'hud policepanel', '');
    panel.style.display = 'none';
    const slots = mk('hud-weapons', 'hud weaponslots', '');
    this.slotEls = SLOT_DEFS.map((s) => {
      const d = document.createElement('div');
      d.className = 'wslot locked';
      d.innerHTML = '<i>' + s.icon + '</i><b>' + s.tag + '</b><span></span>';
      slots.appendChild(d);
      return { root: d, ammo: d.querySelector('span'), id: s.id };
    });
    const crew = mk('hud-crew', 'hud crewcards', '');
    this.crewEls = [];
    for (let i = 0; i < 3; i++) {
      const d = document.createElement('div');
      d.className = 'crewcard';
      d.innerHTML = '<b></b><span class="crole"></span><span class="ccd"></span>';
      crew.appendChild(d);
      this.crewEls.push({
        root: d, name: d.querySelector('b'),
        role: d.querySelector('.crole'), cd: d.querySelector('.ccd'),
      });
    }
    mk('hud-rank', 'hud rank', '');
    const status = mk('hud-status', 'hud statusline', '');
    status.style.display = 'none';
    mk('hud-district', 'hud district', '');
    const radio = mk('hud-radio', 'hud radio', '');
    radio.style.display = 'none';
    const target = mk('hud-target', 'hud targetbar', '');
    target.style.display = 'none';
  }
  // the mission card: number + title, STAGE pill, stage objective,
  // objective counter and the NEXT teaser — replaces the plain
  // objective line while a mission runs (same element, so layout
  // and the touch overlap checks keep their geometry).
  setMissionCard(m) {
    const el = this.el['hud-objective'];
    if (!m) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = 'block';
    el.innerHTML =
      '<div class="mc-head"><b>MISSION ' + m.num + ' · ' + m.name + '</b>' +
      '<span class="mc-stage">STAGE ' + m.stage + '/' + m.stageCount + '</span></div>' +
      '<div class="mc-obj">' + m.stageText +
      (m.counter ? ' &nbsp;<span class="mc-count">' + m.counter + '</span>' : '') + '</div>' +
      '<div class="mc-next">NEXT: ' + m.next + '</div>';
  }
  setPolicePanel(units, statusText) {
    const el = this.el['hud-police'];
    if (!units || !units.length) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    let h = '<div class="pp-head">🚨 POLICE RESPONSE · ' + units.length + ' UNIT' +
      (units.length > 1 ? 'S' : '') + '</div>';
    for (const u of units) {
      h += '<div class="pp-row"><b>' + u.name + '</b><span class="pp-role">' + u.role +
        '</span><span class="pp-dist">' + Math.round(u.dist) + ' m</span></div>';
    }
    if (statusText) h += '<div class="pp-status">' + statusText + '</div>';
    el.innerHTML = h;
  }
  setStatus(text) {
    const el = this.el['hud-status'];
    if (text) { el.textContent = text; el.style.display = 'block'; }
    else el.style.display = 'none';
  }
  setRank(rank, rankName, rp, pct) {
    this.el['hud-rank'].innerHTML =
      '<div class="rk-head"><b>RANK ' + rank + ' · ' + rankName + '</b><span>' +
      Math.floor(rp).toLocaleString('en-US') + ' RP</span></div>' +
      '<div class="rk-bar"><div class="rk-fill" style="width:' +
      Math.round(clamp(pct, 0, 1) * 100) + '%"></div></div>';
  }
  setWeaponSlots(active, owned, mags, reserves) {
    for (const s of this.slotEls) {
      const has = owned.has(s.id);
      s.root.classList.toggle('locked', !has);
      s.root.classList.toggle('active', has && s.id === active);
      s.ammo.textContent = !has ? '—'
        : s.id === 'fists' ? '∞'
        : (mags[s.id] + '/' + reserves[s.id]);
    }
  }
  setCrew(cards) {
    cards.forEach((c, i) => {
      const e = this.crewEls[i];
      if (!e) return;
      e.name.textContent = c.ability + ' — ' + c.name;
      e.role.textContent = c.role;
      e.cd.textContent = c.cdLeft > 0
        ? '⏳ ' + Math.ceil(c.cdLeft) + 's'
        : '▶ ' + c.key + ' READY';
      e.root.classList.toggle('ready', c.cdLeft <= 0);
      e.root.classList.toggle('cooling', c.cdLeft > 0);
    });
  }
  setDistrict(name, standing, label) {
    this.el['hud-district'].innerHTML =
      '<div class="dz-name">' + name + '</div>' +
      '<div class="dz-row"><span>' + label + ' · ' + Math.round(standing) + '</span>' +
      '<div class="dz-bar"><div class="dz-fill" style="width:' +
      Math.round(clamp(standing, 0, 100)) + '%"></div></div></div>';
  }
  setRadio(text) {
    const el = this.el['hud-radio'];
    if (text) { el.textContent = '📻 ' + text; el.style.display = 'block'; }
    else el.style.display = 'none';
  }
  setTargetBar(name, pct) {
    const el = this.el['hud-target'];
    if (!name) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.innerHTML = '<b>🎯 ' + name + '</b><div class="tg-bar"><div class="tg-fill" style="width:' +
      Math.round(clamp(pct, 0, 1) * 100) + '%"></div></div>' +
      '<span>' + Math.round(clamp(pct, 0, 1) * 100) + '% — ' +
      (pct > 0.66 ? 'PRISTINE' : pct > 0.33 ? 'DENTED' : 'WRECKED') + '</span>';
  }
  // ---- v8 pause MAP tab: the whole city on one canvas -----------
  // Same layout data as the minimap, drawn big with district names,
  // the gang turf, a route line to the objective and unit blips.
  drawBigMap(canvas, view) {
    const ctx = canvas.getContext('2d');
    const S = canvas.width, HALF = 210, scale = S / (HALF * 2 + 90);
    const toMap = (x, z) => [S / 2 + x * scale, S / 2 + z * scale];
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#16202e';
    ctx.fillRect(0, 0, S, S);
    const [seaEdge] = toMap(-245, 0);
    const [sandW] = toMap(-250, 0);
    const [sandE] = toMap(-210, 0);
    ctx.fillStyle = '#2a6a8a';
    ctx.fillRect(0, 0, Math.max(0, seaEdge), S);
    ctx.fillStyle = '#e8c890';
    ctx.fillRect(Math.max(0, sandW), 0, sandE - Math.max(0, sandW), S);
    const gt = worldInfo.gangTurf;
    if (gt) {
      const [x0, y0] = toMap(gt.x0, gt.z0);
      const [x1, y1] = toMap(gt.x1, gt.z1);
      ctx.fillStyle = 'rgba(46,158,74,0.4)';
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    ctx.fillStyle = '#4a5568';
    for (const b of worldInfo.blocks) {
      const [x0, y0] = toMap(b.x0, b.z0);
      const [x1, y1] = toMap(b.x1, b.z1);
      ctx.fillRect(x0 + 1, y0 + 1, x1 - x0 - 2, y1 - y0 - 2);
    }
    ctx.strokeStyle = '#232830';
    ctx.lineWidth = 6;
    for (let i = 0; i <= CFG.gridN; i++) {
      const c = roadCoord(i);
      const [x] = toMap(c, 0);
      const [, y] = toMap(0, c);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(S, y); ctx.stroke();
    }
    // pier
    const [px0, py0] = toMap(-300, 56);
    const [px1, py1] = toMap(-240, 64);
    ctx.fillStyle = '#8a6a4a';
    ctx.fillRect(px0, py0, px1 - px0, py1 - py0);
    // district labels (the same names the HUD splash uses)
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.font = 'bold 15px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    const label = (x, z, t) => { const [lx, ly] = toMap(x, z); ctx.fillText(t, lx, ly); };
    label(-185, 0, 'BEACHFRONT');
    label(0, 0, 'DOWNTOWN');
    label(0, -150, 'THE PALMS');
    label(150, 150, 'HARBOR');
    label(150, -60, 'OLD TOWN');
    label(-60, 150, 'MIDTOWN');
    label(150, -150, 'GANG TURF');
    // route line to the objective
    if (view.target) {
      const [tx, ty] = toMap(view.target[0], view.target[1]);
      const [ux, uy] = toMap(view.player.x, view.player.z);
      ctx.strokeStyle = '#ffd23f';
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 6]);
      ctx.beginPath(); ctx.moveTo(ux, uy); ctx.lineTo(tx, ty); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#ffd23f';
      ctx.beginPath(); ctx.arc(tx, ty, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(tx, ty, 12, 0, Math.PI * 2); ctx.stroke();
    }
    // police blips
    for (const c of view.police || []) {
      const [cx, cy] = toMap(c.x, c.z);
      ctx.fillStyle = '#ff4040';
      ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.fill();
    }
    if (view.heli) {
      const [hx, hy] = toMap(view.heli.x, view.heli.z);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(hx, hy, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#16202e';
      ctx.font = 'bold 9px sans-serif';
      ctx.fillText('H', hx, hy + 3);
    }
    // player arrow (same π − heading convention as the minimap)
    const [ux, uy] = toMap(view.player.x, view.player.z);
    ctx.save();
    ctx.translate(ux, uy);
    ctx.rotate(Math.PI - view.player.heading);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#222'; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -10); ctx.lineTo(7, 8); ctx.lineTo(-7, 8); ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.restore();
    // north marker
    ctx.fillStyle = '#ffd23f';
    ctx.font = 'bold 18px Trebuchet MS, sans-serif';
    ctx.fillText('N ▲', S - 30, 26);
  }
  // Mama Rosa's portrait dialogue card: canvas portrait (painted
  // once), name, line, NEXT / SKIP buttons. The world keeps idling
  // behind it — it is a card, not a modal.
  buildDialogue() {
    const card = document.createElement('div');
    card.id = 'hud-dialogue';
    card.className = 'hud dialogue';
    card.style.display = 'none';
    const cv = document.createElement('canvas');
    cv.width = 96; cv.height = 96;
    cv.className = 'dlg-portrait';
    const c = cv.getContext('2d');
    // golden backdrop, face, dark hair bun, gold earring, smile
    const g = c.createRadialGradient(48, 40, 6, 48, 48, 52);
    g.addColorStop(0, '#ffd9a0'); g.addColorStop(1, '#e2703a');
    c.fillStyle = g; c.fillRect(0, 0, 96, 96);
    c.fillStyle = '#8a5a3a';
    c.beginPath(); c.arc(48, 52, 21, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#2a1a10';
    c.beginPath(); c.arc(48, 36, 22, Math.PI, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(48, 17, 8, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#26211c';
    c.beginPath(); c.arc(41, 50, 2.6, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.arc(55, 50, 2.6, 0, Math.PI * 2); c.fill();
    c.strokeStyle = '#26211c'; c.lineWidth = 2.4; c.lineCap = 'round';
    c.beginPath(); c.arc(48, 57, 9, Math.PI * 0.2, Math.PI * 0.8); c.stroke();
    c.fillStyle = '#d8a030';
    c.beginPath(); c.arc(71, 58, 3.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#b84a1a';
    c.fillRect(20, 82, 56, 14);
    card.appendChild(cv);
    const body = document.createElement('div');
    body.className = 'dlg-body';
    body.innerHTML = '<b id="dlg-name">MAMA ROSA</b><span id="dlg-text"></span>';
    card.appendChild(body);
    const btns = document.createElement('div');
    btns.className = 'dlg-btns';
    const next = document.createElement('button');
    next.id = 'dlg-next'; next.type = 'button'; next.textContent = 'NEXT ▸';
    const skip = document.createElement('button');
    skip.id = 'dlg-skip'; skip.type = 'button'; skip.textContent = 'SKIP';
    btns.appendChild(next); btns.appendChild(skip);
    card.appendChild(btns);
    this.root.appendChild(card);
    this.el['hud-dialogue'] = card;
    this.dlgText = card.querySelector('#dlg-text');
    this.dlgName = card.querySelector('#dlg-name');
    const done = (skipped) => {
      card.style.display = 'none';
      clearTimeout(this._dlgT);
      const cb = this._dlgCb;
      this._dlgCb = null;
      if (cb) cb(skipped);
    };
    next.addEventListener('click', () => done(false));
    skip.addEventListener('click', () => done(true));
    this._dlgDone = done;
  }
  showDialogue(name, text, cb) {
    this.dlgName.textContent = name;
    this.dlgText.textContent = text;
    this._dlgCb = cb || null;
    this.el['hud-dialogue'].style.display = 'flex';
    clearTimeout(this._dlgT);
    this._dlgT = setTimeout(() => this._dlgDone && this._dlgDone(true), 14000);
  }
  hideDialogue() { if (this._dlgDone) this._dlgDone(true); }
  titleCard(name, sub = '') {
    const el = this.el['hud-titlecard'];
    el.innerHTML = '<b>' + name + '</b>' + (sub ? '<span>' + sub + '</span>' : '');
    el.classList.add('show');
    clearTimeout(this._tcT);
    this._tcT = setTimeout(() => el.classList.remove('show'), 3000);
  }
  banner(text) {
    const el = this.el['hud-banner'];
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._bnT);
    this._bnT = setTimeout(() => el.classList.remove('show'), 1800);
  }
  splash(name) {
    const el = this.el['hud-splash'];
    el.textContent = name;
    el.classList.add('show');
    clearTimeout(this._spT);
    this._spT = setTimeout(() => el.classList.remove('show'), 2400);
  }
  moneyPopup(amount) {
    const el = this.el['hud-money'];
    el.textContent = '+$' + Math.floor(amount).toLocaleString('en-US');
    el.classList.remove('pop');
    void el.offsetWidth;   // restart the CSS animation
    el.classList.add('pop');
  }
  toast(text) {
    const el = this.el['hud-toast'];
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._tsT);
    this._tsT = setTimeout(() => el.classList.remove('show'), 1600);
  }
  setAimMode(mode) {
    this.aimMode = mode;
    this.el['hud-aim'].textContent = mode === 'auto' ? '⌖ AIM: AUTO' : '✛ AIM: MANUAL';
    this.el['hud-aim'].style.display = 'block';
    // the crosshair belongs to MANUAL; AUTO shows the lock ring
    const armed = this._weapon && this._weapon !== 'fists';
    this.el['hud-cross'].style.display = (armed && mode === 'manual') ? 'block' : 'none';
  }
  setLockTag(on) {
    this.el['hud-lock'].style.display = on ? 'block' : 'none';
  }
  // v9: per-hit confirmation at the crosshair
  hitmark(kill = false) {
    const el = this.el['hud-hitmark'];
    if (!el) return;
    el.style.display = 'block';
    el.classList.toggle('kill', !!kill);
    el.classList.remove('show');
    void el.offsetWidth;   // restart the pop
    el.classList.add('show');
    clearTimeout(this._hmT);
    this._hmT = setTimeout(() => {
      el.classList.remove('show');
      el.style.display = 'none';
    }, kill ? 240 : 130);
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
  setHealth(pct, armourPct = 0, hpNum = null, armourNum = 0) {
    const w = Math.round(clamp(pct, 0, 1) * 100);
    const a = Math.round(clamp(armourPct, 0, 1) * 100);
    // v8: HEALTH and ARMOUR bars, both with numbers (top-1 style)
    this.el['hud-health'].innerHTML =
      '<div class="hcol">' +
      '<div class="hrow"><em>HP</em><div class="bar"><div class="fill" style="width:' + w + '%"></div></div><span>' + (hpNum === null ? w : Math.ceil(hpNum)) + '</span></div>' +
      '<div class="hrow"><em>AR</em><div class="bar armour"><div class="fill" style="width:' + a + '%"></div></div><span>' + Math.ceil(armourNum) + '</span></div>' +
      '</div>';
  }
  setStars(n) {
    let s = '';
    for (let i = 0; i < 5; i++) {
      s += i < n ? '★' : '<span style="opacity:.35">★</span>';
    }
    this.el['hud-stars'].innerHTML = s;
    this.el['hud-stars'].classList.toggle('hot', n >= 3);
  }
  setWeapon(w, ammo, reserve) {
    // v6: the whole arsenal reads here — name, magazine, reserve,
    // and the crosshair follows the aim mode (MANUAL only)
    const LABELS = {
      fists: '👊 FISTS', pistol: '🔫 PISTOL', heavy: '🔫 HEAVY PISTOL',
      smg: '🔫 SMG', shotgun: '🔫 SHOTGUN', rifle: '🔫 RIFLE',
    };
    this._weapon = w;
    this.el['hud-weapon'].textContent = w === 'fists'
      ? LABELS.fists
      : (LABELS[w] || w) + ' · ' + ammo + (reserve != null ? ' / ' + reserve : '');
    const armed = w !== 'fists';
    this.el['hud-cross'].style.display =
      (armed && this.aimMode !== 'auto') ? 'block' : 'none';
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
    // v8: big-number speedometer (top-1 style)
    this.el['hud-speed'].innerHTML = kmh > 1
      ? Math.round(kmh) + ' <small>KM/H</small>' : '';
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
  drawMinimap(player, policeCars, missionTarget, chaseCar, pickups) {
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
    // v6: pickup blips — cyan diamonds for weapons, green crosses
    // for health — so hidden gear is findable from the map
    if (pickups) {
      for (const pk of pickups) {
        const [kx, ky] = toMap(pk.x, pk.z);
        if (pk.kind === 'health') {
          ctx.fillStyle = '#3dff7a';
          ctx.fillRect(kx - 1.5, ky - 4.5, 3, 9);
          ctx.fillRect(kx - 4.5, ky - 1.5, 9, 3);
        } else {
          ctx.fillStyle = pk.kind === 'armour' ? '#59a7ff' : '#59e6ff';
          ctx.save();
          ctx.translate(kx, ky);
          ctx.rotate(Math.PI / 4);
          ctx.fillRect(-3, -3, 6, 6);
          ctx.restore();
        }
      }
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
