/** Web Audio による F-22 サウンド合成 (F119 タービン/燃焼音, A/B, 風切り音, 警報) */
export class FlightAudio {
  ctx: AudioContext;
  master: GainNode;
  private roarF: BiquadFilterNode;
  private roarG: GainNode;
  private whine1: OscillatorNode;
  private whine2: OscillatorNode;
  private whineG: GainNode;
  private whineF: BiquadFilterNode;
  private rumbleG: GainNode;
  private rumbleOsc: OscillatorNode;
  private abG: GainNode;
  private crackleG: GainNode;
  private windF: BiquadFilterNode;
  private windG: GainNode;
  private buffetG: GainNode;
  private cabinF: BiquadFilterNode;
  private warnG: GainNode;
  private warnOsc: OscillatorNode;
  private lastVoice = 0;
  volume = 0.8;
  muted = false;

  constructor() {
    this.ctx = new AudioContext();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);

    // 機内フィルタ (エンジン音のこもり)
    this.cabinF = c.createBiquadFilter();
    this.cabinF.type = 'lowpass';
    this.cabinF.frequency.value = 1200;
    this.cabinF.connect(this.master);

    const white = this.noiseBuffer('white');
    const brown = this.noiseBuffer('brown');
    const crackle = this.crackleBuffer();
    const src = (b: AudioBuffer) => {
      const s = c.createBufferSource();
      s.buffer = b;
      s.loop = true;
      s.start(0, Math.random() * 2);
      return s;
    };

    // ジェットロア
    this.roarF = c.createBiquadFilter();
    this.roarF.type = 'lowpass';
    this.roarF.Q.value = 0.7;
    this.roarG = c.createGain();
    src(white).connect(this.roarF).connect(this.roarG).connect(this.cabinF);

    // タービンワイン (N2 連動)
    this.whine1 = c.createOscillator();
    this.whine1.type = 'sawtooth';
    this.whine2 = c.createOscillator();
    this.whine2.type = 'triangle';
    this.whineF = c.createBiquadFilter();
    this.whineF.type = 'bandpass';
    this.whineF.Q.value = 6;
    this.whineG = c.createGain();
    this.whine1.connect(this.whineF);
    this.whine2.connect(this.whineF);
    this.whineF.connect(this.whineG).connect(this.cabinF);
    this.whine1.start();
    this.whine2.start();

    // 低音ランブル
    this.rumbleOsc = c.createOscillator();
    this.rumbleOsc.type = 'sine';
    this.rumbleOsc.frequency.value = 42;
    const rf = c.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 140;
    this.rumbleG = c.createGain();
    src(brown).connect(rf);
    this.rumbleOsc.connect(rf);
    rf.connect(this.rumbleG).connect(this.master);

    // アフターバーナー
    const abF = c.createBiquadFilter();
    abF.type = 'lowpass';
    abF.frequency.value = 700;
    this.abG = c.createGain();
    this.abG.gain.value = 0;
    src(brown).connect(abF).connect(this.abG).connect(this.cabinF);
    const crF = c.createBiquadFilter();
    crF.type = 'bandpass';
    crF.frequency.value = 900;
    crF.Q.value = 0.6;
    this.crackleG = c.createGain();
    this.crackleG.gain.value = 0;
    src(crackle).connect(crF).connect(this.crackleG).connect(this.cabinF);

    // 風切り音
    this.windF = c.createBiquadFilter();
    this.windF.type = 'bandpass';
    this.windF.Q.value = 0.5;
    this.windG = c.createGain();
    src(white).connect(this.windF).connect(this.windG).connect(this.master);

    // バフェット
    const bf = c.createBiquadFilter();
    bf.type = 'lowpass';
    bf.frequency.value = 70;
    this.buffetG = c.createGain();
    this.buffetG.gain.value = 0;
    src(brown).connect(bf).connect(this.buffetG).connect(this.master);

    // 警報音
    this.warnOsc = c.createOscillator();
    this.warnOsc.type = 'square';
    this.warnOsc.frequency.value = 1000;
    this.warnG = c.createGain();
    this.warnG.gain.value = 0;
    const wf = c.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 2500;
    this.warnOsc.connect(wf).connect(this.warnG).connect(this.master);
    this.warnOsc.start();
    this.rumbleOsc.start();
  }

  private noiseBuffer(kind: 'white' | 'brown') {
    const len = this.ctx.sampleRate * 3;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    return b;
  }

  private crackleBuffer() {
    const len = this.ctx.sampleRate * 3;
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    let env = 0;
    for (let i = 0; i < len; i++) {
      if (Math.random() < 0.0009) env = 0.6 + Math.random() * 0.4;
      env *= 0.996;
      d[i] = (Math.random() * 2 - 1) * env;
    }
    return b;
  }

  resume() {
    this.ctx.resume();
  }

  update(p: { rpm: number; ab: number; speed: number; q: number; buffet: number; cockpit: boolean; warn: 'none' | 'stall' | 'pullup' | 'gcas' }) {
    const t = this.ctx.currentTime;
    const tc = 0.08;
    const n = Math.max(0, (p.rpm - 60) / 40); // 0..1
    const vol = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(vol, t, 0.2);
    this.cabinF.frequency.setTargetAtTime(p.cockpit ? 900 : 9000, t, tc);
    this.roarF.frequency.setTargetAtTime(250 + n * n * 2600 + p.ab * 1500, t, tc);
    this.roarG.gain.setTargetAtTime((p.cockpit ? 0.18 : 0.5) * (0.15 + n * 0.85), t, tc);
    const wf = 1900 + p.rpm * 18;
    this.whine1.frequency.setTargetAtTime(wf, t, tc);
    this.whine2.frequency.setTargetAtTime(wf * 1.51, t, tc);
    this.whineF.frequency.setTargetAtTime(wf * 1.1, t, tc);
    this.whineG.gain.setTargetAtTime((p.cockpit ? 0.012 : 0.04) * (0.3 + n), t, tc);
    this.rumbleOsc.frequency.setTargetAtTime(36 + n * 22, t, tc);
    this.rumbleG.gain.setTargetAtTime(0.12 + n * 0.25 + p.ab * 0.45, t, tc);
    this.abG.gain.setTargetAtTime(p.ab * (p.cockpit ? 0.5 : 1.1), t, 0.15);
    this.crackleG.gain.setTargetAtTime(p.ab * (p.cockpit ? 0.12 : 0.6), t, 0.15);
    const qn = Math.min(1, p.q / 60000);
    this.windF.frequency.setTargetAtTime(350 + Math.min(1, p.speed / 600) * 2200, t, tc);
    this.windG.gain.setTargetAtTime((p.cockpit ? 0.35 : 0.12) * Math.sqrt(qn), t, tc);
    this.buffetG.gain.setTargetAtTime(Math.min(1, p.buffet) * 0.9, t, 0.05);

    // 警報
    let wg = 0;
    const ph = t % 1;
    if (p.warn === 'stall') {
      this.warnOsc.frequency.setValueAtTime(ph < 0.5 ? 800 : 600, t);
      wg = 0.05;
    } else if (p.warn === 'pullup' || p.warn === 'gcas') {
      this.warnOsc.frequency.setValueAtTime(1200, t);
      wg = ph % 0.25 < 0.12 ? 0.06 : 0;
    }
    this.warnG.gain.setTargetAtTime(this.muted ? 0 : wg, t, 0.01);
    if (p.warn === 'pullup' || p.warn === 'gcas') this.voice(p.warn === 'gcas' ? 'Auto G-CAS' : 'Pull up, pull up');
  }

  voice(s: string) {
    const now = performance.now();
    if (this.muted || now - this.lastVoice < 2600 || !('speechSynthesis' in window)) return;
    this.lastVoice = now;
    const u = new SpeechSynthesisUtterance(s);
    u.lang = 'en-US';
    u.rate = 1.05;
    u.pitch = 0.9;
    u.volume = this.volume;
    speechSynthesis.speak(u);
  }

  boom() {
    const c = this.ctx;
    const len = c.sampleRate * 1.2;
    const b = c.createBuffer(1, len, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const tt = i / c.sampleRate;
      d[i] = (Math.random() * 2 - 1) * Math.exp(-tt * 4) * (tt < 0.12 ? 1 : 0.6);
    }
    const s = c.createBufferSource();
    s.buffer = b;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 220;
    const g = c.createGain();
    g.gain.value = this.muted ? 0 : 2.2;
    s.connect(f).connect(g).connect(this.master);
    s.start();
  }

  dispose() {
    this.ctx.close();
  }
}
