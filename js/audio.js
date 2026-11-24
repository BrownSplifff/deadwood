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
    let send;
    if (o.rev) { send = ctx.createGain(); send.gain.value = o.rev; g.connect(send); send.connect(this.rev); }
    src.onended = () => { src.disconnect(); f.disconnect(); g.disconnect(); send?.disconnect(); };
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
    osc.onended = () => { osc.disconnect(); g.disconnect(); };
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  // ---------- effects ----------
  gun(kind = 'rifle') {
    if (!this.ctx) return;
    const d = this.master;
    const muffle = 1 - (this.shotMuffle ?? 0) * 0.68;
    if (kind === 'glock') {
      this.noise(d, { dur: 0.2, type: 'lowpass', f: 7000 * muffle, f2: 700, gain: 0.8, rev: 0.45 });
      this.noise(d, { dur: 0.035, type: 'highpass', f: 3000, gain: 0.7 * muffle });
      this.tone(d, { f: 260, f2: 70, dur: 0.12, gain: 0.55 });
    } else if (kind === 'sniper') {
      this.noise(d, { dur: 0.7, type: 'lowpass', f: 9000 * muffle, f2: 220, gain: 1.25, rev: 1.0 });
      this.noise(d, { dur: 0.06, type: 'highpass', f: 1800, gain: muffle });
      this.tone(d, { f: 120, f2: 28, dur: 0.45, gain: 1.0 });
      this.noise(d, { t: 0.25, dur: 1.4, type: 'lowpass', f: 600, f2: 120, gain: 0.25, attack: 0.2 });
    } else {
      this.noise(d, { dur: 0.3, type: 'lowpass', f: 8000 * muffle, f2: 450, gain: 1.0, rev: 0.6 });
      this.noise(d, { dur: 0.05, type: 'highpass', f: 2200, gain: 0.8 * muffle });
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

  // ---------- phase 2: desert / hanging woods ----------
  sandEmerge(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    this.noise(d, { dur: 1.6, type: 'lowpass', f: 500, f2: 120, gain: 0.7, attack: 0.3, brown: true });
    this.noise(d, { dur: 1.2, type: 'bandpass', f: 2600, q: 0.7, gain: 0.25, attack: 0.2 });
    this.growl(pos, { pitch: 0.85, dur: 1.4, gain: 0.45 });
  }
  ropeSnap(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    this.noise(d, { dur: 0.06, type: 'highpass', f: 1500, gain: 0.8 });
    this.noise(d, { t: 0.5, dur: 0.3, type: 'lowpass', f: 300, f2: 70, gain: 0.9 });
  }
  gurgle(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    for (let i = 0; i < 4; i++) this.tone(d, { t: i * 0.08, f: 180 + Math.random() * 120, f2: 90, dur: 0.07, gain: 0.25, type: 'triangle' });
    this.noise(d, { dur: 0.4, type: 'bandpass', f: 700, q: 4, gain: 0.3 });
  }
  acidSpit(pos) { if (this.ctx) { const d = this.dest(pos); this.noise(d, { dur: 0.18, type: 'bandpass', f: 1800, f2: 600, q: 2, gain: 0.6 }); this.tone(d, { f: 300, f2: 120, dur: 0.12, gain: 0.2 }); } }
  acidHit(pos) { if (this.ctx) { const d = this.dest(pos); this.noise(d, { dur: 0.5, type: 'highpass', f: 2500, gain: 0.35 }); this.noise(d, { dur: 0.15, type: 'lowpass', f: 700, gain: 0.5 }); } }
  cultistShout(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    this.tone(d, { f: 220, f2: 160, dur: 0.6, gain: 0.35, type: 'sawtooth', attack: 0.05 });
    this.noise(d, { dur: 0.6, type: 'bandpass', f: 900, q: 3, gain: 0.3 });
  }
  cultistMagic(pos, stage) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    if (stage === 'charge') {
      this.tone(d, { f: 210, f2: 570, dur: 0.6, gain: 0.15, type: 'triangle', rev: 0.6 });
    } else if (stage === 'throw') {
      this.noise(d, { dur: 0.26, type: 'bandpass', f: 2400, f2: 540, q: 2, gain: 0.38, rev: 0.5 });
    } else {
      this.tone(d, { f: 160, f2: 60, dur: 0.19, gain: 0.24, type: 'triangle' });
      this.noise(d, { dur: 0.27, type: 'highpass', f: 1500, gain: 0.22, rev: 0.5 });
    }
  }
  camel(pos, pain = false) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime, d = this.dest(pos), dur = pain ? 0.6 : 1.3;
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(pain ? 220 : 95, t); o.frequency.linearRampToValueAtTime(pain ? 160 : 140, t + dur * 0.4); o.frequency.linearRampToValueAtTime(pain ? 120 : 80, t + dur);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 22; const lg = ctx.createGain(); lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency);
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 600; f.Q.value = 2;
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.1); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f); f.connect(g); g.connect(d); o.start(t); o.stop(t + dur + 0.1); lfo.start(t); lfo.stop(t + dur + 0.1);
  }
  mummyRoar(pos, wake = false, dying = false) {
    if (!this.ctx) return;
    this.growl(pos, { pitch: dying ? 0.3 : 0.38, dur: dying ? 3.2 : wake ? 2.6 : 1.8, gain: 1.0 });
    this.noise(this.dest(pos), { dur: dying ? 3 : 2, type: 'lowpass', f: 300, f2: 60, gain: 0.6, attack: 0.3, brown: true, rev: 0.8 });
  }
  mummyChant(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    for (const [f, k] of [[98, 0], [147, 0.1], [196, 0.2]]) this.tone(d, { t: k, f, f2: f * 0.98, dur: 1.4, gain: 0.25, type: 'sawtooth', attack: 0.3 });
    this.noise(d, { dur: 1.4, type: 'bandpass', f: 500, q: 2, gain: 0.3, attack: 0.4 });
  }
  bandageWhip(pos) { if (this.ctx) { const d = this.dest(pos); this.noise(d, { dur: 0.35, type: 'bandpass', f: 600, f2: 3200, q: 1.5, gain: 0.7 }); this.noise(d, { t: 0.05, dur: 0.25, type: 'highpass', f: 3000, gain: 0.2 }); } }
  slam(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    this.tone(d, { f: 70, f2: 25, dur: 0.9, gain: 1.2 });
    this.noise(d, { dur: 1.2, type: 'lowpass', f: 600, f2: 80, gain: 1.0, rev: 0.7, brown: true });
  }
  eat() { if (this.ctx) for (let i = 0; i < 4; i++) this.noise(this.master, { t: i * 0.18, dur: 0.1, type: 'bandpass', f: 900 + Math.random() * 900, q: 1.5, gain: 0.45 }); }
  drink() { if (this.ctx) for (let i = 0; i < 4; i++) this.tone(this.master, { t: i * 0.22, f: 300, f2: 180, dur: 0.15, gain: 0.25 }); }
  invClick() { if (this.ctx) this.noise(this.master, { dur: 0.04, type: 'bandpass', f: 1500, q: 2, gain: 0.3 }); }
  zombieBreath(k = 1) {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 1.1, type: 'bandpass', f: 380, f2: 220, q: 3, gain: 0.35 * k, attack: 0.4, brown: true });
    this.tone(this.master, { f: 85, f2: 60, dur: 1.0, gain: 0.18 * k, type: 'sawtooth', attack: 0.3 });
  }
  creak(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos), t0 = Math.random() * 0.2;
    this.tone(d, { t: t0, f: 140 + Math.random() * 60, f2: 220, dur: 0.6, gain: 0.18, type: 'sawtooth', attack: 0.1 });
    this.noise(d, { t: t0, dur: 0.6, type: 'bandpass', f: 1200, q: 8, gain: 0.12 });
  }
  whisper(pos) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    for (let i = 0; i < 6; i++) this.noise(d, { t: i * 0.16, dur: 0.14, type: 'bandpass', f: 2200 + Math.random() * 2500, q: 6, gain: 0.12 });
  }
  /** continuous chanting coming from the nearest desert camp (positional) */
  setChant(pos, k) {
    if (!this.ctx) return;
    if (!this.chant) {
      const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0;
      const p = this.panner(pos || { x: 0, y: 0, z: 0 }); p.refDistance = 8; g.connect(p);
      const voice = (f, det) => {
        const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        const f1 = ctx.createBiquadFilter(); f1.type = 'bandpass'; f1.frequency.value = 520; f1.Q.value = 5;
        const f2 = ctx.createBiquadFilter(); f2.type = 'bandpass'; f2.frequency.value = 900; f2.Q.value = 5;
        const vg = ctx.createGain(); vg.gain.value = 0.25;
        o.connect(f1); o.connect(f2); f1.connect(vg); f2.connect(vg); vg.connect(g); o.start();
        const lfo = ctx.createOscillator(); lfo.frequency.value = 0.35 + Math.random() * 0.2; const lg = ctx.createGain(); lg.gain.value = 260; lfo.connect(lg); lg.connect(f1.frequency); lfo.start();
        return o;
      };
      this.chantVoices = [voice(98, 0), voice(98, 9), voice(147, -6), voice(73.4, 4)];
      // rhythmic swell
      const am = ctx.createOscillator(); am.frequency.value = 0.42; const ag = ctx.createGain(); ag.gain.value = 0.35; am.connect(ag); ag.connect(g.gain); am.start();
      this.chant = { g, p };
    }
    if (pos) this.setPos(this.chant.p, pos);
    this.chant.g.gain.setTargetAtTime(0.6 * k, this.ctx.currentTime, 0.4);
  }
  setSuspenseSilence(on) {
    this.silence = on ? 0.05 : 1;
  }
  setOutdoorAmbience(wind, river, desert) {
    if (!this.riverGain) return;
    const now = this.ctx.currentTime;
    this.riverGain.gain.setTargetAtTime(0.55 * river * (this.silence ?? 1), now, 0.3);
    this.dryWindGain.gain.setTargetAtTime(wind * (0.018 + 0.14 * desert) * (this.silence ?? 1), now, 0.55);
    this.dryWindFilter.frequency.setTargetAtTime(560 + 950 * desert, now, 0.55);
  }
  setWeather(rain, sand, sheltered, metal) {
    if (!this.weatherRain) return;
    const now = this.ctx.currentTime, quiet = this.silence ?? 1;
    this.weatherRain.gain.setTargetAtTime(rain * (sheltered ? 0.13 : 0.29) * quiet, now, 0.55);
    this.weatherFilter.frequency.setTargetAtTime(sheltered ? (metal ? 680 : 300) : 2000, now, 0.5);
    this.weatherRoof.gain.setTargetAtTime(metal ? rain * 0.24 * quiet : 0, now, 0.45);
    this.weatherStorm.gain.setTargetAtTime(sand * (sheltered ? 0.04 : 0.33) * quiet, now, 0.6);
    this.shotMuffle = sand * (sheltered ? 0 : 1);
    this.creatureMuffle = sheltered ? 1 : 1 - rain * 0.32 - sand * 0.27;
  }
  railStep() {
    if (!this.ctx) return;
    this.noise(this.master, { dur: 0.095, type: 'bandpass', f: 1900, f2: 900, q: 4, gain: 0.23, rev: 0.48 });
    this.tone(this.master, { f: 146, f2: 87, dur: 0.13, gain: 0.085, type: 'triangle' });
  }

  horror(event, pos, volume = 1) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.pruneHorror(now);
    if (this.horrorSources.length >= 7 && event !== 'horde' && event !== 'thunder') return;
    const dest = this.dest(pos);
    if (dest !== this.master) this.horrorSources.push({ dest, until: now + 9 });
    const noise = (f, f2, dur, gain, o = {}) => this.noise(dest, { f, f2, dur, gain: gain * volume, rev: 0.38, ...o });
    const tone = (f, f2, dur, gain, o = {}) => this.tone(dest, { f, f2, dur, gain: gain * volume, rev: 0.42, ...o });
    switch (event) {
      case 'thunder':
        noise(240, 36, 3.1, 1.8, { brown: true, attack: 0.13, rev: 0.85 });
        noise(2100, 155, 0.45, 0.8, { t: 0.08 }); tone(47, 24, 3.2, 0.35, { attack: 0.18 }); break;
      case 'whistle':
        tone(325, 313, 2.1, 0.28, { type: 'triangle', attack: 0.34, rev: 0.8 });
        tone(432, 419, 1.9, 0.15, { t: 0.1, attack: 0.32 }); break;
      case 'metal': case 'chain': case 'door':
        tone(event === 'door' ? 104 : 780, 126, 0.59, 0.21, { type: 'triangle' });
        for (let i = 0; i < 4; i++) noise(3500 - i * 530, 700, 0.14, 0.33 / (i + 1), { t: i * 0.11, type: 'bandpass', q: 5 }); break;
      case 'groan':
        tone(123, 49, 2.3, 0.24, { type: 'triangle', attack: 0.48 });
        noise(430, 104, 1.65, 0.7, { brown: true, attack: 0.28 }); break;
      case 'branch': case 'twig':
        noise(2800, 850, 0.085, 0.72, { type: 'bandpass' });
        noise(540, 125, 0.29, 0.64, { brown: true, t: 0.024 }); break;
      case 'scratch': case 'rustle': case 'sand': case 'clicks': case 'twisted':
        for (let i = 0; i < (event === 'clicks' ? 6 : 4); i++) {
          const f = event === 'sand' ? 1700 : event === 'twisted' ? 660 : 2400;
          noise(f + Math.random() * 900, f * 0.48, event === 'clicks' ? 0.055 : 0.19, 0.38,
            { t: i * (event === 'clicks' ? 0.105 : 0.21), type: 'bandpass', q: 3 });
        }
        if (event === 'twisted') noise(480, 270, 0.94, 0.66, { brown: true, attack: 0.1 }); break;
      case 'steps': case 'thud':
        noise(310, 52, 0.37, 0.95, { brown: true });
        if (event === 'steps') noise(2100, 530, 0.12, 0.3);
        else tone(48, 28, 0.65, 0.23); break;
      case 'scream':
        tone(780, 290, 1.2, 0.5, { type: 'sawtooth', attack: 0.14, rev: 0.95 });
        noise(1900, 870, 0.83, 0.32, { attack: 0.11, type: 'bandpass' }); break;
      case 'horde':
        for (let i = 0; i < 4; i++) {
          tone(105 - i * 9, 43 + i * 4, 0.9 + i * 0.17, 0.25, { type: 'sawtooth', attack: 0.12, t: i * 0.11 });
          noise(690, 149, 1.2, 0.7, { t: i * 0.13, brown: true, attack: 0.16 });
        }
        break;
      default: // breathy whispers and distant coughing
        for (let i = 0; i < 3; i++) noise(850 + i * 380, 480 + 230 * i, 0.23, 0.45,
          { t: i * 0.31, type: 'bandpass', q: 4, attack: event === 'cough' ? 0.018 : 0.07 });
    }
  }

  pruneHorror(now) {
    this.horrorSources ??= [];
    for (let i = this.horrorSources.length - 1; i >= 0; i--) if (this.horrorSources[i].until <= now) {
      this.horrorSources[i].dest.disconnect(); this.horrorSources.splice(i, 1);
    }
  }

  dogBark(pos, bite = false) {
    if (!this.ctx) return;
    const d = this.dest(pos), n = bite ? 1 : 1 + ((Math.random() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const t = i * 0.22, f = 380 + Math.random() * 160;
      this.tone(d, { t, f, f2: f * 0.55, dur: 0.14, gain: 0.35, type: 'sawtooth' });
      this.noise(d, { t, dur: 0.12, type: 'bandpass', f: 1100, q: 2, gain: 0.45 });
    }
    if (bite) this.noise(d, { t: 0.05, dur: 0.08, type: 'highpass', f: 1800, gain: 0.5 });
    this.growl(pos, { pitch: 2.1, dur: 0.35, gain: 0.3 });
  }
  dogYelp(pos, dead = false) {
    if (!this.ctx) return;
    const d = this.dest(pos);
    this.tone(d, { f: 900, f2: dead ? 250 : 500, dur: dead ? 0.6 : 0.2, gain: 0.35, type: 'triangle' });
  }
  wormRoar(pos, dying = false) {
    if (!this.ctx) return;
    this.growl(pos, { pitch: dying ? 0.2 : 0.26, dur: dying ? 3.5 : 2.6, gain: 1.2 });
    const d = this.dest(pos);
    this.noise(d, { dur: 2.4, type: 'lowpass', f: 400, f2: 50, gain: 1.2, attack: 0.15, brown: true, rev: 0.9 });
    this.tone(d, { f: 45, f2: 25, dur: 2.2, gain: 0.9, attack: 0.1 });
  }
  /** continuous underground rumble of a hunting sand worm (positional) */
  setRumble(pos, k) {
    if (!this.ctx) return;
    if (!this.rumble) {
      const ctx = this.ctx, g = ctx.createGain(); g.gain.value = 0;
      const p = this.panner({ x: 0, y: 0, z: 0 }); p.refDistance = 12; g.connect(p);
      const n = ctx.createBufferSource(); n.buffer = this.brown; n.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140;
      n.connect(lp); lp.connect(g); n.start();
      const o = ctx.createOscillator(); o.frequency.value = 32; const og = ctx.createGain(); og.gain.value = 0.5; o.connect(og); og.connect(g); o.start();
      this.rumble = { g, p };
    }
    if (pos) this.setPos(this.rumble.p, pos);
    this.rumble.g.gain.setTargetAtTime(pos ? 1.6 * k : 0, this.ctx.currentTime, 0.3);
  }
  // ---------- ambience ----------
  startAmbience() {
    const ctx = this.ctx;
    const weatherBed = (buffer, type, freq, q = 0.7) => {
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      const filter = ctx.createBiquadFilter(); filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
      const gain = ctx.createGain(); gain.gain.value = 0;
      source.connect(filter); filter.connect(gain); gain.connect(this.master); source.start();
      return [gain, filter];
    };
    [this.weatherRain, this.weatherFilter] = weatherBed(this.white, 'lowpass', 2000);
    [this.weatherRoof] = weatherBed(this.white, 'bandpass', 1350, 5.5);
    [this.weatherStorm] = weatherBed(this.brown, 'bandpass', 240);
    // River flow, with slow variations beneath its distance-controlled volume.
    const wind = ctx.createBufferSource(); wind.buffer = this.brown; wind.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 380; bp.Q.value = 0.7;
    const wg = ctx.createGain(); wg.gain.value = 0.5;
    const river = ctx.createGain(); river.gain.value = 0;
    this.riverGain = river;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.11;
    const lg = ctx.createGain(); lg.gain.value = 0.3;
    lfo.connect(lg); lg.connect(wg.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.07;
    const lg2 = ctx.createGain(); lg2.gain.value = 160;
    lfo2.connect(lg2); lg2.connect(bp.frequency);
    wind.connect(bp); bp.connect(wg); wg.connect(river); river.connect(this.master);
    wind.start(); lfo.start(); lfo2.start();
    // Dry wind. The desert blend raises the sandy hiss and its faint whistle.
    const w2 = ctx.createBufferSource(); w2.buffer = this.white; w2.loop = true;
    const dry = ctx.createGain(); dry.gain.value = 0;
    const hiss = ctx.createBiquadFilter(); hiss.type = 'bandpass'; hiss.frequency.value = 560; hiss.Q.value = 0.65;
    this.dryWindGain = dry; this.dryWindFilter = hiss;
    const gust = ctx.createGain(); gust.gain.value = 0.66;
    const gustLfo = ctx.createOscillator(); gustLfo.frequency.value = 0.19;
    const gustDepth = ctx.createGain(); gustDepth.gain.value = 0.3;
    gustLfo.connect(gustDepth); gustDepth.connect(gust.gain);
    w2.connect(hiss); hiss.connect(gust); gust.connect(dry); dry.connect(this.master);
    gustLfo.start();
    const bp2 = ctx.createBiquadFilter(); bp2.type = 'bandpass'; bp2.frequency.value = 1100; bp2.Q.value = 14;
    const g2 = ctx.createGain(); g2.gain.value = 0.075;
    const l3 = ctx.createOscillator(); l3.frequency.value = 0.13;
    const lg3 = ctx.createGain(); lg3.gain.value = 0.06; l3.connect(lg3); lg3.connect(g2.gain);
    w2.connect(bp2); bp2.connect(g2); g2.connect(dry);
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
    this.firePanner.distanceModel = 'linear';
    this.firePanner.maxDistance = 22;
    this.firePanner.rolloffFactor = 1;
    const s = ctx.createBufferSource(); s.buffer = this.brown; s.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g = ctx.createGain(); g.gain.value = 0.16;
    s.connect(lp); lp.connect(g); g.connect(this.firePanner);
    s.start();
  }
  update(dt) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    this.pruneHorror(this.ctx.currentTime);
    if (!this.firePanner) return;
    if (Math.random() < dt * 10) {
      this.noise(this.firePanner, { dur: 0.01 + Math.random() * 0.03, type: 'bandpass', f: 2000 + Math.random() * 4000, q: 2, gain: 0.25 + Math.random() * 0.35 });
    }
  }
}
