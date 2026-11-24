// PALMBAY HEAT — audio.js (v6/v8): WebAudio synth. No audio assets.
// v8 audio implementation: three buses (master -> music / sfx / ui)
// through a master compressor; every sound is a written recipe;
// a procedural adaptive music loop (chord pad + bass + arp + kit)
// whose layers follow the game's intensity; ducking under big
// impacts; per-class voice caps. v3 audit retained: blip/noise
// honour the mute flag directly.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.uiBus = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.muted = false;
    this.started = false;
    this._voices = 0;         // live short voices (cap ~14)
    this._sirenT = 0;
    // --- music state ---
    this.musicOn = false;
    this.musicTimer = null;
    this.step = 0;            // eighth-note counter
    this.nextStepTime = 0;
    this.intensity = 0;       // applied intensity 0 calm | 1 engaged | 2 danger
    this.pendingIntensity = 0;
    this.padGain = null;
    this.bassGain = null;
    this.arpGain = null;
    this.drumGain = null;
    this.noiseBuf = null;
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    // master -> compressor -> destination (v8 bus discipline)
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.connect(this.ctx.destination);
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(comp);
    const mkBus = (v) => {
      const g = this.ctx.createGain();
      g.gain.value = v;
      g.connect(this.master);
      return g;
    };
    this.sfxBus = mkBus(0.9);
    this.musicBus = mkBus(0.85);
    this.uiBus = mkBus(0.8);
    // shared noise buffer (v8: one buffer, many voices)
    const nlen = this.ctx.sampleRate;
    this.noiseBuf = this.ctx.createBuffer(1, nlen, this.ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nlen; i++) nd[i] = Math.random() * 2 - 1;
    // engine hum (sawtooth, gain driven by speed)
    this.engineOsc = this.ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineGain = this.ctx.createGain();
    this.engineGain.gain.value = 0;
    const engineFilter = this.ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 320;
    this.engineOsc.connect(engineFilter);
    engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus);
    this.engineOsc.start();
    // siren (two-tone)
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.sfxBus);
    this.sirenOsc.start();
    this.startMusic();
    this.started = true;
  }
  // ---------- procedural music (v8) -------------------------------
  // i–VI–III–VII in A minor at 104 BPM — the driving progression.
  // Layers: pad (always), bass (always), arp (engaged+), kit
  // (danger). Intensity changes land on BAR boundaries only.
  static CHORDS = [
    { bass: 55.0, tones: [110.0, 130.81, 164.81] },   // Am
    { bass: 43.65, tones: [87.31, 110.0, 130.81] },   // F
    { bass: 65.41, tones: [130.81, 164.81, 196.0] },  // C
    { bass: 49.0, tones: [98.0, 123.47, 146.83] },    // G
  ];
  static EIGHTH = 60 / 104 / 2;   // seconds per eighth note
  startMusic() {
    const layer = (v) => {
      const g = this.ctx.createGain();
      g.gain.value = v;
      g.connect(this.musicBus);
      return g;
    };
    this.padGain = layer(0.05);
    this.bassGain = layer(0.055);
    this.arpGain = layer(0);
    this.drumGain = layer(0);
    this.step = 0;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    this.musicOn = true;
    // lookahead scheduler: 40 ms timer, 0.14 s horizon
    this.musicTimer = setInterval(() => this.scheduleMusic(), 40);
  }
  scheduleMusic() {
    if (!this.musicOn || !this.ctx) return;
    while (this.nextStepTime < this.ctx.currentTime + 0.14) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.nextStepTime += AudioSys.EIGHTH;
      this.step += 1;
    }
  }
  scheduleStep(step, t) {
    const bar = Math.floor(step / 8) % 4;
    const chord = AudioSys.CHORDS[bar];
    const s8 = step % 8;
    if (s8 === 0) {
      // bar boundary: intensity changes land HERE, never mid-bar
      if (this.pendingIntensity !== this.intensity) {
        this.intensity = this.pendingIntensity;
        const tc = this.ctx.currentTime;
        this.arpGain.gain.setTargetAtTime(this.intensity >= 1 ? 0.035 : 0, tc, 0.3);
        this.drumGain.gain.setTargetAtTime(this.intensity >= 2 ? 0.05 : 0, tc, 0.3);
      }
      // pad: detuned saw pair per chord tone through a lowpass,
      // one envelope spanning the whole bar
      const barLen = AudioSys.EIGHTH * 8;
      const lp = this.ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = this.intensity >= 2 ? 1400 : 800;
      lp.connect(this.padGain);
      for (const f of chord.tones) {
        for (const det of [-4, 4]) {
          const o = this.ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = f;
          o.detune.value = det;
          const og = this.ctx.createGain();
          og.gain.setValueAtTime(0, t);
          og.gain.linearRampToValueAtTime(0.16, t + 0.4);
          og.gain.setValueAtTime(0.16, t + barLen - 0.4);
          og.gain.linearRampToValueAtTime(0, t + barLen);
          o.connect(og); og.connect(lp);
          o.start(t); o.stop(t + barLen + 0.05);
        }
      }
    }
    // bass: root eighths with an octave hop late in the bar
    if (s8 % 2 === 0) {
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = chord.bass * (s8 === 6 ? 2 : 1);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.5, t);
      g.gain.exponentialRampToValueAtTime(0.01, t + AudioSys.EIGHTH * 0.9);
      o.connect(g); g.connect(this.bassGain);
      o.start(t); o.stop(t + AudioSys.EIGHTH);
    }
    // arp: chord tones cycling two octaves up (engaged layer)
    if (this.intensity >= 1) {
      const tone = chord.tones[step % 3] * 2;
      const o = this.ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = tone;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.01, t + 0.16);
      o.connect(g); g.connect(this.arpGain);
      o.start(t); o.stop(t + 0.18);
    }
    // kit: kick on quarters, hat on off-eighths (danger layer)
    if (this.intensity >= 2) {
      if (s8 % 4 === 0) {
        const o = this.ctx.createOscillator();
        o.type = 'sine';
        o.frequency.setValueAtTime(120, t);
        o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.9, t);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.13);
        o.connect(g); g.connect(this.drumGain);
        o.start(t); o.stop(t + 0.14);
      }
      if (s8 % 2 === 1) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.noiseBuf;
        const hp = this.ctx.createBiquadFilter();
        hp.type = 'highpass'; hp.frequency.value = 6000;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.01, t + 0.05);
        src.connect(hp); hp.connect(g); g.connect(this.drumGain);
        src.start(t, Math.random() * 0.5, 0.06);
      }
    }
  }
  setMusicIntensity(i) {
    this.pendingIntensity = i;
  }
  // duck the music bus briefly under a big impact (v8)
  duck() {
    if (!this.ctx || !this.musicBus) return;
    const t = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.3, t + 0.03);
    g.linearRampToValueAtTime(0.85, t + 0.4);
  }
  // ---------- world voices -----------------------------------------
  setEngine(speedNorm) {
    if (!this.ctx) return;
    this.engineOsc.frequency.value = 55 + speedNorm * 120;
    this.engineGain.gain.value = 0.02 + speedNorm * 0.06;
  }
  setSiren(on, dt) {
    if (!this.ctx) return;
    this._sirenT += dt;
    if (on) {
      this.sirenOsc.frequency.value = Math.sin(this._sirenT * 4) > 0 ? 950 : 700;
      this.sirenGain.gain.value = 0.045;
    } else {
      this.sirenGain.gain.value = 0;
    }
  }
  blip(freq, dur, type = 'sine', vol = 0.2) {
    if (!this.ctx || this.muted || this._voices >= 14) return;
    this._voices += 1;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    // v8 recipe discipline: ±5% pitch variation kills repetition
    o.frequency.value = freq * (1 + (Math.random() - 0.5) * 0.05);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.uiBus);
    o.onended = () => { this._voices -= 1; };
    o.start(t); o.stop(t + dur);
  }
  noise(dur, vol = 0.3, freq = 1200) {
    if (!this.ctx || this.muted || this._voices >= 14) return;
    this._voices += 1;
    const t = this.ctx.currentTime;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(this.sfxBus);
    src.onended = () => { this._voices -= 1; };
    src.start(t);
  }
  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'chime':
        this.blip(880, 0.18); setTimeout(() => this.blip(1318, 0.25), 90);
        break;
      case 'shot': this.noise(0.12, 0.4, 2500); break;
      case 'hit': this.blip(1500, 0.05, 'square', 0.10); this.noise(0.05, 0.14, 3200); break;
      case 'kill': this.blip(280, 0.14, 'square', 0.16); this.noise(0.12, 0.22, 700); break;
      case 'punch': this.noise(0.08, 0.25, 500); break;
      case 'dryfire': this.blip(180, 0.06, 'square', 0.12); break;
      case 'cash': this.blip(1320, 0.12); setTimeout(() => this.blip(1760, 0.2), 100); break;
      case 'busted': this.blip(220, 0.5, 'sawtooth', 0.2); break;
      case 'wasted': this.blip(110, 0.8, 'sawtooth', 0.25); break;
      case 'mission': this.blip(660, 0.15); setTimeout(() => this.blip(990, 0.3), 120); break;
      case 'screech': this.noise(0.3, 0.22, 900); break;
      case 'skid': this.noise(0.18, 0.15, 1400); break;
    }
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.9;
    return this.muted;
  }
}
