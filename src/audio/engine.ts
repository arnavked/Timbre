import type { Band } from '../model/band';

export type TestSignal = 'pink' | 'sweep';

/**
 * Signal flow:
 *
 *   input ──► preamp ──► band 0 ──► … ──► band N ──► eqGain ──┐
 *     └────────────────────────────────────────► dryGain ────┴──► out ──► analyser ──► destination
 *
 * Bypass crossfades eqGain against dryGain instead of tearing the chain down,
 * so A/B switching is click-free. The dry path is trimmed by the preamp so the
 * comparison is roughly level-matched.
 */
export class AudioEngine {
  readonly ctx: AudioContext;

  private readonly input: GainNode;
  private readonly preampNode: GainNode;
  private readonly eqGain: GainNode;
  private readonly dryGain: GainNode;
  private readonly outGain: GainNode;
  private readonly analyser: AnalyserNode;
  private readonly filters: BiquadFilterNode[] = [];
  private readonly audioEl: HTMLAudioElement;
  private readonly peakBuffer: Float32Array<ArrayBuffer>;

  private mediaSource: MediaElementAudioSourceNode | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private objectUrl: string | null = null;
  private preampDb = 0;
  private bypassed = false;

  constructor(bandCount: number) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });

    this.input = this.ctx.createGain();
    this.preampNode = this.ctx.createGain();
    this.eqGain = this.ctx.createGain();
    this.dryGain = this.ctx.createGain();
    this.outGain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.peakBuffer = new Float32Array(this.analyser.fftSize);

    // Build the filter cascade.
    let tail: AudioNode = this.preampNode;
    for (let i = 0; i < bandCount; i++) {
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = 1000;
      filter.gain.value = 0;
      filter.Q.value = 1;
      tail.connect(filter);
      tail = filter;
      this.filters.push(filter);
    }
    tail.connect(this.eqGain);
    this.eqGain.connect(this.outGain);

    this.input.connect(this.preampNode);
    this.input.connect(this.dryGain);
    this.dryGain.connect(this.outGain);

    this.outGain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    // Start fully wet.
    this.eqGain.gain.value = 1;
    this.dryGain.gain.value = 0;

    this.audioEl = new Audio();
    this.audioEl.loop = true;
    this.audioEl.preload = 'metadata';
  }

  get sampleRate(): number {
    return this.ctx.sampleRate;
  }

  get isBypassed(): boolean {
    return this.bypassed;
  }

  get playing(): boolean {
    return !this.audioEl.paused || this.bufferSource !== null;
  }

  get trackName(): string | null {
    if (this.bufferSource) return this.bufferLabel;
    if (!this.audioEl.src) return null;
    return this.fileLabel;
  }

  private bufferLabel: string | null = null;
  private fileLabel: string | null = null;

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') {
      await this.ctx.resume();
    }
  }

  loadFile(file: File): void {
    this.stopBuffer();
    this.ensureMediaSource();

    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(file);
    this.audioEl.src = this.objectUrl;
    this.audioEl.load();

    this.fileLabel = file.name;
    this.bufferLabel = null;
  }

  async play(): Promise<void> {
    await this.resume();
    if (!this.audioEl.src) return;
    await this.audioEl.play();
  }

  pause(): void {
    this.audioEl.pause();
    this.stopBuffer();
  }

  async playTest(kind: TestSignal): Promise<void> {
    await this.resume();
    this.audioEl.pause();
    this.stopBuffer();

    const buffer = kind === 'pink' ? this.makePinkNoise(4) : this.makeSweep(6);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = kind === 'pink';
    source.connect(this.input);
    source.onended = () => {
      if (this.bufferSource === source) this.bufferSource = null;
    };
    source.start();

    this.bufferSource = source;
    this.bufferLabel = kind === 'pink' ? 'Pink noise' : 'Sweep 20 Hz – 20 kHz';
  }

  setBands(bands: Band[]): void {
    const now = this.ctx.currentTime;
    for (let i = 0; i < this.filters.length; i++) {
      const filter = this.filters[i];
      const band = bands[i];
      if (!filter || !band) continue;

      filter.type = band.type;
      filter.frequency.setTargetAtTime(band.freq, now, 0.01);
      filter.gain.setTargetAtTime(band.enabled ? band.gain : 0, now, 0.01);
      filter.Q.setTargetAtTime(band.q, now, 0.01);
    }
  }

  setPreamp(db: number): void {
    this.preampDb = db;
    const now = this.ctx.currentTime;
    this.preampNode.gain.setTargetAtTime(Math.pow(10, db / 20), now, 0.01);
    if (this.bypassed) {
      this.dryGain.gain.setTargetAtTime(Math.pow(10, db / 20), now, 0.01);
    }
  }

  setBypass(on: boolean): void {
    this.bypassed = on;
    const now = this.ctx.currentTime;
    const dry = Math.pow(10, this.preampDb / 20);
    this.eqGain.gain.setTargetAtTime(on ? 0 : 1, now, 0.02);
    this.dryGain.gain.setTargetAtTime(on ? dry : 0, now, 0.02);
  }

  /** Peak sample magnitude of the most recent analyser window, 0..1+. */
  readPeak(): number {
    this.analyser.getFloatTimeDomainData(this.peakBuffer);
    let peak = 0;
    for (let i = 0; i < this.peakBuffer.length; i++) {
      const v = Math.abs(this.peakBuffer[i]);
      if (v > peak) peak = v;
    }
    return peak;
  }

  private ensureMediaSource(): void {
    if (this.mediaSource) return;
    this.mediaSource = this.ctx.createMediaElementSource(this.audioEl);
    this.mediaSource.connect(this.input);
  }

  private stopBuffer(): void {
    if (!this.bufferSource) return;
    const source = this.bufferSource;
    this.bufferSource = null;
    source.onended = null;
    try {
      source.stop();
    } catch {
      // already stopped
    }
    source.disconnect();
  }

  private makePinkNoise(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, length, rate);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;

      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.969 * b2 + white * 0.153852;
        b3 = 0.8665 * b3 + white * 0.3104856;
        b4 = 0.55 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.016898;
        const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
        b6 = white * 0.115926;
        data[i] = pink * 0.09;
      }
    }

    return buffer;
  }

  private makeSweep(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate;
    const length = Math.floor(rate * seconds);
    const buffer = this.ctx.createBuffer(2, length, rate);
    const f0 = 20;
    const f1 = 20000;
    const fade = Math.floor(rate * 0.02);

    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let phase = 0;

      for (let i = 0; i < length; i++) {
        const t = i / rate;
        const freq = f0 * Math.pow(f1 / f0, t / seconds);
        phase += (2 * Math.PI * freq) / rate;

        let amp = 0.28;
        if (i < fade) amp *= i / fade;
        if (i > length - fade) amp *= (length - i) / fade;

        data[i] = Math.sin(phase) * amp;
      }
    }

    return buffer;
  }
}
