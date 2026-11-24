// Fully procedural audio (Web Audio API). No sample files.
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.vol = 0.8;
    this.firePanner = null;
    this.firePos = null;
    this.hbT = 0;
  }

  init() {
    if (this.ctx) { this.ctx.resume(); return; }
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return;
    const ctx = (this.ctx = new C());
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.white = this.makeNoise(2, 'white');
    this.brown = this.makeNoise(4, 'brown');
    this.rev = ctx.createConvolver();
    this.rev.buffer = this.makeImpulse(1.8, 2.6);
    const rg = ctx.createGain(); rg.gain.value = 0.4;
    this.rev.connect(rg); rg.connect(this.master);
    this.startAmbience();
  }

  setVolume(v) {
    this.vol = v;
    if (this.master) this.master.gain.value = v;
  }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume(); }

  makeNoise(sec, type) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return buf;
  }
  makeImpulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return buf;
  }

  setPos(node, p) {
    if (node.positionX) { node.positionX.value = p.x; node.positionY.value = p.y; node.positionZ.value = p.z; }
    else node.setPosition(p.x, p.y, p.z);
  }
  panner(pos) {
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 3; p.maxDistance = 120; p.rolloffFactor = 1.35;
    this.setPos(p, pos);
    p.connect(this.master);
    return p;
  }
  dest(pos) { return pos ? this.panner(pos) : this.master; }

  setListener(cam) {
    if (!this.ctx) return;
    const l = this.ctx.listener, e = cam.matrixWorld.elements;
    if (l.positionX) {
      l.positionX.value = e[12]; l.positionY.value = e[13]; l.positionZ.value = e[14];
      l.forwardX.value = -e[8]; l.forwardY.value = -e[9]; l.forwardZ.value = -e[10];
      l.upX.value = e[4]; l.upY.value = e[5]; l.upZ.value = e[6];
    } else {
      l.setPosition(e[12], e[13], e[14]);
      l.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  // ---------- primitives ----------
  noise(dest, o) {
    const ctx = this.ctx;
    const t = ctx.currentTime + (o.t || 0), dur = o.dur ?? 0.1;
    const src = ctx.createBufferSource();
    src.buffer = o.brown ? this.brown : this.white;
    const f = ctx.createBiquadFilter();
    f.type = o.type || 'lowpass';
    f.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    f.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    const a = o.attack ?? 0.002, peak = o.gain ?? 1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    if (o.rev) { const s = ctx.createGain(); s.gain.value = o.rev; g.connect(s); s.connect(this.rev); }
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }
  tone(dest, o) {
    const ctx = this.ctx;
    const t = ctx.currentTime + (o.t || 0), dur = o.dur ?? 0.1;
    const osc = ctx.createOscillator();
    osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(o.f, t);
    if (o.f2) osc.frequency.exponentialRampToValueAtTime(o.f2, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(o.gain ?? 0.5, t + (o.attack ?? 0.003));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  // ---------- effects ----------
  gun(kind = 'rifle') {
    if (!this.ctx) return;
    const d = this.master;
    if (kind === 'glock') {
      this.noise(d, { dur: 0.2, type: 'lowpass', f: 7000, f2: 700, gain: 0.8, rev: 0.45 });
      this.noise(d, { dur: 0.035, type: 'highpass', f: 3000, gain: 0.7 });
      this.tone(d, { f: 260, f2: 70, dur: 0.12, gain: 0.55 });
    } else if (kind === 'sniper') {
      this.noise(d, { dur: 0.7, type: 'lowpass', f: 9000, f2: 220, gain: 1.25, rev: 1.0 });
      this.noise(d, { dur: 0.06, type: 'highpass', f: 1800, gain: 1.0 });
      this.tone(d, { f: 120, f2: 28, dur: 0.45, gain: 1.0 });
      this.noise(d, { t: 0.25, dur: 1.4, type: 'lowpass', f: 600, f2: 120, gain: 0.25, attack: 0.2 });
    } else {
      this.noise(d, { dur: 0.3, type: 'lowpass', f: 8000, f2: 450, gain: 1.0, rev: 0.6 });
      this.noise(d, { dur: 0.05, type: 'highpass', f: 2200, gain: 0.8 });
      this.tone(d, { f: 170, f2: 38, dur: 0.2, gain: 0.9 });
    }
  }
  bolt() {
    if (!this.ctx) return;
    const d = this.master;
    this.noise(d, { dur: 0.05, type: 'bandpass', f: 2400, q: 3, gain: 0.5 });
    this.noise(d, { t: 0.18, dur: 0.06, type: 'bandpass', f: 1800, q: 3, gain: 0.6 });
    this.tone(d, { t: 0.18, f: 520, f2: 260, dur: 0.06, gain: 0.2, type: 'triangle' });
  }
  switchGun() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.12, type: 'bandpass', f: 900, q: 1, gain: 0.25 });
    this.noise(this.master, { t: 0.2, dur: 0.04, type: 'bandpass', f: 2600, q: 3, gain: 0.35 });
  }
  battery() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.04, type: 'bandpass', f: 2000, q: 3, gain: 0.4 });
    this.noise(this.master, { t: 0.25, dur: 0.05, type: 'bandpass', f: 1500, q: 3, gain: 0.5 });
    this.tone(this.master, { t: 0.32, f: 880, f2: 880, dur: 0.08, gain: 0.08, type: 'sine' });
  }
  splash() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.22, type: 'bandpass', f: 700 + Math.random() * 500, q: 0.8, gain: 0.35 });
    this.noise(this.master, { dur: 0.12, type: 'highpass', f: 2500, gain: 0.12 });
  }
  machete(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    this.noise(d, { dur: 0.35, type: 'bandpass', f: 500, f2: 3000, q: 2, gain: 0.7 });
    this.growl(pos, { pitch: 0.55, dur: 0.9, gain: 0.8 });
  }
  owl(pos, alarm = false) {
    if (!this.ctx) return;
    const d = this.dest(pos), f = 380 + Math.random() * 40;
    const notes = alarm ? [[0, 0.15, 1.4]] : [[0, 0.22, 1], [0.32, 0.18, 0.95], [0.75, 0.55, 1.02]];
    for (const [t, dur, k] of notes) this.tone(d, { t, f: f * k, f2: f * k * 0.92, dur, gain: 0.28, attack: 0.06 });
  }
  crow(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos), n = 2 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      this.tone(d, { t: i * 0.32, f: 820, f2: 560, dur: 0.22, gain: 0.25, type: 'sawtooth' });
      this.noise(d, { t: i * 0.32, dur: 0.2, type: 'bandpass', f: 1300, q: 3, gain: 0.35 });
    }
  }
  bat(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    for (let i = 0; i < 3; i++) this.tone(d, { t: i * 0.06, f: 7500 + Math.random() * 2500, f2: 6000, dur: 0.03, gain: 0.08 });
  }
  flap(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    for (let i = 0; i < 5; i++) this.noise(d, { t: i * 0.13, dur: 0.09, type: 'lowpass', f: 900, f2: 300, gain: 0.35 });
  }
  scream(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, d = this.dest(pos), dur = 1.6 + Math.random();
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(520, t); o.frequency.linearRampToValueAtTime(880, t + 0.3); o.frequency.linearRampToValueAtTime(420, t + dur);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 3;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.15); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 7; const lg = ctx.createGain(); lg.gain.value = 25; lfo.connect(lg); lg.connect(o.frequency);
    o.connect(bp); bp.connect(g); g.connect(d);
    const rs = ctx.createGain(); rs.gain.value = 0.9; g.connect(rs); rs.connect(this.rev);
    o.start(t); o.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
  }
  twig(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    this.noise(d, { dur: 0.04, type: 'highpass', f: 1800, gain: 0.9 });
    this.noise(d, { t: 0.05, dur: 0.03, type: 'bandpass', f: 2500, q: 2, gain: 0.5 });
  }
  setDark(k) {
    if (!this.ctx) return;
    if (!this.drone) {
      const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0;
      for (const f of [41, 43.5, 61.7]) { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const og = ctx.createGain(); og.gain.value = 0.35; o.connect(og); og.connect(g); o.start(); }
      const n = ctx.createBufferSource(); n.buffer = this.brown; n.loop = true; const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160;
      const ng = ctx.createGain(); ng.gain.value = 0.6; n.connect(lp); lp.connect(ng); ng.connect(g); n.start();
      g.connect(this.master); this.drone = g;
    }
    this.drone.gain.setTargetAtTime(k * 0.45, this.ctx.currentTime, 0.5);
  }

  empty() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.03, type: 'bandpass', f: 2600, q: 3, gain: 0.5 });
    this.tone(this.master, { f: 1300, f2: 900, dur: 0.03, gain: 0.15, type: 'square' });
  }
  reload(kind = 'rifle') {
    if (!this.ctx) return;
    const d = this.master;
    if (kind === 'glock') {
      this.noise(d, { t: 0.2, dur: 0.06, type: 'bandpass', f: 2000, q: 2, gain: 0.45 });
      this.noise(d, { t: 0.8, dur: 0.07, type: 'bandpass', f: 1600, q: 2, gain: 0.6 });
      this.noise(d, { t: 1.2, dur: 0.05, type: 'highpass', f: 2600, gain: 0.55 });
      return;
    }
    if (kind === 'sniper') { this.bolt(); }
    // mag out
    this.noise(d, { t: 0.25, dur: 0.07, type: 'bandpass', f: 1800, q: 2, gain: 0.5 });
    this.tone(d, { t: 0.25, f: 220, f2: 120, dur: 0.08, gain: 0.3 });
    // mag in
    this.noise(d, { t: 1.1, dur: 0.09, type: 'bandpass', f: 1400, q: 2, gain: 0.7 });
    this.tone(d, { t: 1.1, f: 180, f2: 90, dur: 0.12, gain: 0.5 });
    // bolt
    this.noise(d, { t: 1.6, dur: 0.05, type: 'highpass', f: 3000, gain: 0.5 });
    this.noise(d, { t: 1.75, dur: 0.06, type: 'bandpass', f: 2200, q: 3, gain: 0.6 });
    this.tone(d, { t: 1.75, f: 400, f2: 200, dur: 0.07, gain: 0.25, type: 'triangle' });
  }
  step(power = 0.7) {
    if (!this.ctx) return;
    const d = this.master, v = 0.12 + power * 0.14;
    this.noise(d, { dur: 0.09, type: 'lowpass', f: 500 + Math.random() * 250, f2: 160, gain: v });
    this.noise(d, { dur: 0.06, type: 'bandpass', f: 1800 + Math.random() * 800, q: 1.2, gain: v * 0.35 });
  }
  land() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.18, type: 'lowpass', f: 400, f2: 80, gain: 0.7 });
  }
  jump() { if (this.ctx) this.noise(this.master, { dur: 0.1, type: 'lowpass', f: 700, f2: 200, gain: 0.2 }); }
  zStep(pos, heavy = false) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    if (heavy) { this.noise(d, { dur: 0.3, type: 'lowpass', f: 180, f2: 50, gain: 1.2 }); this.tone(d, { f: 60, f2: 35, dur: 0.25, gain: 0.6 }); return; }
    this.noise(d, { dur: 0.14, type: 'lowpass', f: 260, f2: 90, gain: 0.55 });
    this.noise(d, { dur: 0.08, type: 'bandpass', f: 1200, q: 1, gain: 0.12 });
  }
  growl(pos, o = {}) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, d = this.dest(pos);
    const pitch = o.pitch || 1, dur = o.dur || 1.1, gain = o.gain ?? 0.5;
    const base = (62 + Math.random() * 28) * pitch;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.12);
    g.gain.setValueAtTime(gain * 0.85, t + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 5;
    lp.frequency.setValueAtTime(450, t);
    lp.frequency.linearRampToValueAtTime(900 * pitch, t + dur * 0.4);
    lp.frequency.linearRampToValueAtTime(380, t + dur);
    lp.connect(g); g.connect(d);
    const rs = ctx.createGain(); rs.gain.value = 0.3; g.connect(rs); rs.connect(this.rev);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 6 + Math.random() * 3;
    const lg = ctx.createGain(); lg.gain.value = base * 0.07;
    lfo.connect(lg);
    for (const [type, mul, det] of [['sawtooth', 1, 0], ['sawtooth', 1.012, 6], ['square', 0.5, 0]]) {
      const o1 = ctx.createOscillator(); o1.type = type; o1.detune.value = det;
      o1.frequency.setValueAtTime(base * mul * 1.25, t);
      o1.frequency.exponentialRampToValueAtTime(base * mul * 0.8, t + dur);
      lg.connect(o1.frequency);
      const og = ctx.createGain(); og.gain.value = type === 'square' ? 0.25 : 0.5;
      o1.connect(og); og.connect(lp);
      o1.start(t); o1.stop(t + dur + 0.05);
    }
    lfo.start(t); lfo.stop(t + dur + 0.05);
    this.noise(d, { dur: dur * 0.9, type: 'bandpass', f: 800 * pitch, q: 1.5, gain: 0.22 * gain * 2 });
  }
  zHurt(pos) { this.growl(pos, { pitch: 1.5, dur: 0.45, gain: 0.5 }); }
  zDie(pos, big) { this.growl(pos, { pitch: big ? 0.4 : 0.75, dur: big ? 2.5 : 1.5, gain: big ? 0.9 : 0.55 }); }
  zAttack(pos) {
    if (!this.ctx) return;
    this.growl(pos, { pitch: 1.2, dur: 0.5, gain: 0.55 });
    this.noise(this.dest(pos), { t: 0.15, dur: 0.12, type: 'lowpass', f: 600, f2: 150, gain: 0.7 });
  }
  impact(pos, kind = 'dirt') {
    if (!this.ctx) return;
    const d = this.dest(pos);
    if (kind === 'flesh') {
      this.noise(d, { dur: 0.12, type: 'lowpass', f: 600, f2: 150, gain: 0.7 });
      this.tone(d, { f: 140, f2: 60, dur: 0.1, gain: 0.35 });
    } else if (kind === 'rock') {
      this.noise(d, { dur: 0.08, type: 'bandpass', f: 3200, q: 4, gain: 0.5 });
      this.tone(d, { f: 1700, f2: 1100, dur: 0.07, gain: 0.12, type: 'triangle' });
    } else if (kind === 'wood') {
      this.noise(d, { dur: 0.09, type: 'bandpass', f: 900, q: 2, gain: 0.6 });
      this.tone(d, { f: 300, f2: 150, dur: 0.08, gain: 0.25, type: 'triangle' });
    } else if (kind === 'water') {
      this.noise(d, { dur: 0.25, type: 'bandpass', f: 900, q: 0.8, gain: 0.5 });
    } else {
      this.noise(d, { dur: 0.1, type: 'lowpass', f: 1200, f2: 300, gain: 0.45 });
    }
  }
  hurt() {
    if (!this.ctx) return;
    this.tone(this.master, { f: 90, f2: 40, dur: 0.3, gain: 0.8 });
    this.noise(this.master, { dur: 0.25, type: 'lowpass', f: 900, f2: 200, gain: 0.5 });
    this.tone(this.master, { f: 330, f2: 180, dur: 0.18, gain: 0.12, type: 'sawtooth' });
  }
  hitmarker() {
    if (!this.ctx) return;
    this.tone(this.master, { f: 1800, f2: 1500, dur: 0.04, gain: 0.12, type: 'square' });
  }
  pickup() {
    if (!this.ctx) return;
    this.tone(this.master, { f: 520, f2: 520, dur: 0.1, gain: 0.2, type: 'triangle' });
    this.tone(this.master, { t: 0.08, f: 780, f2: 780, dur: 0.16, gain: 0.2, type: 'triangle' });
  }
  flashlight() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.025, type: 'bandpass', f: 2000, q: 4, gain: 0.4 });
  }
  heartbeat() {
    if (!this.ctx) return;
    this.tone(this.master, { f: 60, f2: 40, dur: 0.16, gain: 0.8 });
    this.tone(this.master, { t: 0.24, f: 52, f2: 36, dur: 0.18, gain: 0.55 });
  }
  waveStart() {
    if (!this.ctx) return;
    const d = this.master;
    this.tone(d, { f: 55, f2: 48, dur: 2.2, gain: 0.35, type: 'sawtooth', attack: 0.8 });
    this.tone(d, { f: 82, f2: 70, dur: 2.2, gain: 0.2, type: 'sawtooth', attack: 0.9 });
  }
  playerDie() {
    if (!this.ctx) return;
    this.tone(this.master, { f: 80, f2: 25, dur: 1.4, gain: 0.8 });
    this.noise(this.master, { dur: 1.2, type: 'lowpass', f: 700, f2: 60, gain: 0.5 });
  }

  // ---------- ambience ----------
  startAmbience() {
    const ctx = this.ctx;
    // wind
    const wind = ctx.createBufferSource(); wind.buffer = this.brown; wind.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.7;
    const wg = ctx.createGain(); wg.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lg = ctx.createGain(); lg.gain.value = 0.3;
    lfo.connect(lg); lg.connect(wg.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.07;
    const lg2 = ctx.createGain(); lg2.gain.value = 160;
    lfo2.connect(lg2); lg2.connect(bp.frequency);
    wind.connect(bp); bp.connect(wg); wg.connect(this.master);
    wind.start(); lfo.start(); lfo2.start();
    // faint whistle
    const w2 = ctx.createBufferSource(); w2.buffer = this.white; w2.loop = true;
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 1100; bp2.Q.value = 14;
    const g2 = ctx.createGain(); g2.gain.value = 0.012;
    const l3 = ctx.createOscillator(); l3.frequency.value = 0.13;
    const lg3 = ctx.createGain(); lg3.gain.value = 0.01; l3.connect(lg3); lg3.connect(g2.gain);
    w2.connect(bp2); bp2.connect(g2); g2.connect(this.master);
    w2.start(); l3.start();
    // crickets
    const cr = ctx.createOscillator(); cr.type = 'sine'; cr.frequency.value = 4300;
    const cg = ctx.createGain(); cg.gain.value = 0.0;
    const cl = ctx.createOscillator(); cl.type = 'square'; cl.frequency.value = 16;
    const cla = ctx.createGain(); cla.gain.value = 0.004; cl.connect(cla); cla.connect(cg.gain);
    cr.connect(cg); cg.connect(this.master);
    cr.start(); cl.start();
    // campfire bed (positional) – position set by setFire()
    if (this.firePos) this.startFire();
  }
  setFire(pos) {
    this.firePos = pos;
    if (this.ctx && !this.firePanner) this.startFire();
  }
  startFire() {
    const ctx = this.ctx;
    this.firePanner = this.panner(this.firePos);
    this.firePanner.refDistance = 4;
    const s = ctx.createBufferSource(); s.buffer = this.brown; s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.value = 0.45;
    s.connect(lp); lp.connect(g); g.connect(this.firePanner);
    s.start();
  }
  update(dt) {
    if (!this.ctx || !this.firePanner || this.ctx.state !== 'running') return;
    if (Math.random() < dt * 10) {
      this.noise(this.firePanner, { dur: 0.01 + Math.random() * 0.03, type: 'bandpass', f: 2000 + Math.random() * 4000, q: 2, gain: 0.25 + Math.random() * 0.35 });
    }
  }
}
