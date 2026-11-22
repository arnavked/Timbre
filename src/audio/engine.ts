import workletUrl from './worklet/biquad-processor.ts?worker&url';

import type { Band } from '../model/band';
import { biquad } from './dsp';

export type TestSignal = 'pink' | 'sweep';

const RAMP_MS = 25;
const TRIM_MIN = 0.178; // -15 dB
const TRIM_MAX = 5.623; // +15 dB

function rms(analyser: AnalyserNode, buffer: Float32Array<ArrayBuffer>): number {
  analyser.getFloatTimeDomainData(buffer);
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
}

/**
 * Signal flow:
 *
 *   input ──► preamp ──► worklet cascade ──► wetAnalyser ──► eqGain ──┐
 *     └──► dryAnalyser ──► dryTrim ──► dryGain ───────────────────────┴──► out ──► master ──► destination
 *
 * Bypass crossfades eqGain against dryGain instead of tearing the chain down,
 * so A/B switching is click-free. dryTrim is driven by the ratio of the two
 * analyser RMS readings, which makes the comparison level-matched while audio
 * is playing rather than merely preamp-matched.
 */
export class AudioEngine {
  readonly ctx: AudioContext;

  private readonly input: GainNode;
  private readonly preampNode: GainNode;
  private readonly eqGain: GainNode;
  private readonly dryGain: GainNode;
  private readonly dryTrim: GainNode;
  private readonly outGain: GainNode;
  private readonly masterAnalyser: AnalyserNode;
  private readonly wetAnalyser: AnalyserNode;
  private readonly dryAnalyser: AnalyserNode;

  private readonly peakBuffer: Float32Array<ArrayBuffer>;
  private readonly wetBuffer: Float32Array<ArrayBuffer>;
  private readonly dryBuffer: Float32Array<ArrayBuffer>;

  private readonly audioEl: HTMLAudioElement;

  private mediaSource: MediaElementAudioSourceNode | null = null;
  private bufferSource: AudioBufferSourceNode | null = null;
  private objectUrl: string | null = null;

  private worklet: AudioWorkletNode | null = null;
  private workletState = 'none';
  private bands: Band[] = [];
  private bandsSent = 0;
  private bypassed = false;
  private trimValue = 1;
  private bufferLabel: string | null = null;
  private fileLabel: string | null = null;
  private initialized = false;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });

    this.input = this.ctx.createGain();
    this.preampNode = this.ctx.createGain();
    this.eqGain = this.ctx.createGain();
    this.dryGain = this.ctx.createGain();
    this.dryTrim = this.ctx.createGain();
    this.outGain = this.ctx.createGain();

    this.masterAnalyser = this.ctx.createAnalyser();
    this.wetAnalyser = this.ctx.createAnalyser();
    this.dryAnalyser = this.ctx.createAnalyser();
    this.masterAnalyser.fftSize = 1024;
    this.wetAnalyser.fftSize = 1024;
    this.dryAnalyser.fftSize = 1024;

    this.peakBuffer = new Float32Array(this.masterAnalyser.fftSize);
    this.wetBuffer = new Float32Array(this.wetAnalyser.fftSize);
    this.dryBuffer = new Float32Array(this.dryAnalyser.fftSize);

    this.input.connect(this.preampNode);

    this.input.connect(this.dryAnalyser);
    this.dryAnalyser.connect(this.dryTrim);
    this.dryTrim.connect(this.dryGain);
    this.dryGain.connect(this.outGain);

    this.eqGain.connect(this.outGain);
    this.outGain.connect(this.masterAnalyser);
    this.masterAnalyser.connect(this.ctx.destination);

    this.eqGain.gain.value = 1;
    this.dryGain.gain.value = 0;
    this.dryTrim.gain.value = 1;

    this.audioEl = new Audio();
    this.audioEl.loop = true;
    this.audioEl.preload = 'metadata';
  }

  async init(): Promise<void> {
    if (this.initialized) return;

    await this.ctx.audioWorklet.addModule(workletUrl);

    const node = new AudioWorkletNode(this.ctx, 'timbre-biquad', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
    });

    this.preampNode.connect(node);
    node.connect(this.wetAnalyser);
    this.wetAnalyser.connect(this.eqGain);

    node.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; bands?: number; sampleRate?: number };
      if (data?.type === 'hello') this.workletState = `hello@${data.sampleRate}`;
      else if (data?.type === 'ack') this.workletState = `ack:${data.bands}`;
    };

    this.worklet = node;
    this.initialized = true;
    this.sendConfig();
  }

  get ready(): boolean {
    return this.initialized;
  }

  /** Handshake state of the worklet, for diagnostics. */
  get diagnostics(): { worklet: string; bandsSent: number } {
    return { worklet: this.workletState, bandsSent: this.bandsSent };
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
    this.bands = bands;
    this.sendConfig();
  }

  setPreamp(db: number): void {
    this.preampNode.gain.setTargetAtTime(Math.pow(10, db / 20), this.ctx.currentTime, 0.01);
  }

  setBypass(on: boolean): void {
    this.bypassed = on;
    const now = this.ctx.currentTime;
    this.eqGain.gain.setTargetAtTime(on ? 0 : 1, now, 0.02);
    this.dryGain.gain.setTargetAtTime(on ? 1 : 0, now, 0.02);
  }

  /**
   * Match the dry path to the wet path using the ratio of their RMS levels.
   * Called from the UI tick; cheap and idempotent when silent.
   */
  updateGainMatch(): void {
    if (!this.playing) return;

    const wet = rms(this.wetAnalyser, this.wetBuffer);
    const dry = rms(this.dryAnalyser, this.dryBuffer);
    if (wet < 1e-5 || dry < 1e-5) return;

    const target = wet / dry;
    const next = this.trimValue + (target - this.trimValue) * 0.2;
    this.trimValue = Math.min(Math.max(next, TRIM_MIN), TRIM_MAX);
    this.dryTrim.gain.setTargetAtTime(this.trimValue, this.ctx.currentTime, 0.05);
  }

  /** Peak sample magnitude of the most recent analyser window, 0..1+. */
  readPeak(): number {
    this.masterAnalyser.getFloatTimeDomainData(this.peakBuffer);
    let peak = 0;
    for (let i = 0; i < this.peakBuffer.length; i++) {
      const value = Math.abs(this.peakBuffer[i]);
      if (value > peak) peak = value;
    }
    return peak;
  }

  private sendConfig(): void {
    const node = this.worklet;
    if (!node) return;

    const bands = [];
    for (const band of this.bands) {
      if (!band.enabled) continue;
      const c = biquad(band.type, band.freq, band.gain, band.q, this.sampleRate);
      bands.push({
        b0: c.b0,
        b1: c.b1,
        b2: c.b2,
        a1: c.a1,
        a2: c.a2,
        channel: band.channel === 'stereo' ? 0 : band.channel === 'L' ? 1 : 2,
      });
    }

    node.port.postMessage({ type: 'config', bands, rampMs: RAMP_MS });
    this.bandsSent = bands.length;
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
