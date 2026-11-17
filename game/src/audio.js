// PALMBAY HEAT — audio.js: WebAudio synth. No audio assets.
// Engine hum, siren, pickup chime, gunshot, punch, ambient pad.
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.muted = false;
    this.started = false;
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.35;
    this.master.connect(this.ctx.destination);
    // ambient pad: two detuned sines + slow LFO
    const padGain = this.ctx.createGain();
    padGain.gain.value = 0.05;
    padGain.connect(this.master);
    for (const f of [110, 164.8, 220]) {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = f;
      o.connect(padGain);
      o.start();
    }
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
    this.engineGain.connect(this.master);
    this.engineOsc.start();
    // siren (two-tone)
    this.sirenOsc = this.ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 700;
    this.sirenGain = this.ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain);
    this.sirenGain.connect(this.master);
    this.sirenOsc.start();
    this.started = true;
    this._sirenT = 0;
  }
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
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur);
  }
  noise(dur, vol = 0.3, freq = 1200) {
    if (!this.ctx) return;
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
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }
  play(name) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'chime':
        this.blip(880, 0.18); setTimeout(() => this.blip(1318, 0.25), 90);
        break;
      case 'shot': this.noise(0.12, 0.4, 2500); break;
      case 'punch': this.noise(0.08, 0.25, 500); break;
      case 'dryfire': this.blip(180, 0.06, 'square', 0.12); break;
      case 'cash': this.blip(1320, 0.12); setTimeout(() => this.blip(1760, 0.2), 100); break;
      case 'busted': this.blip(220, 0.5, 'sawtooth', 0.2); break;
      case 'wasted': this.blip(110, 0.8, 'sawtooth', 0.25); break;
      case 'mission': this.blip(660, 0.15); setTimeout(() => this.blip(990, 0.3), 120); break;
    }
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.35;
    return this.muted;
  }
}
