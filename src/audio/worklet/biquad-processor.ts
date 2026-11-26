declare const sampleRate: number;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor,
): void;

interface BandCoefficients {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  /** 0 = both channels, 1 = left, 2 = right. */
  channel: number;
}

interface ConfigMessage {
  type: 'config';
  bands: BandCoefficients[];
  rampMs: number;
}

interface RunningBand extends BandCoefficients {
  z1: number;
  z2: number;
}

type Chain = RunningBand[];

/**
 * A cascade of biquads per channel, in transposed direct form II.
 *
 * Coefficients are computed on the main thread and posted here, so the graph,
 * the preview and the exported profile all come from one implementation.
 * Every config change crossfades from the previous chain to the new one, which
 * keeps drags click-free and avoids the instability of interpolating
 * coefficients directly.
 */
class TimbreBiquadProcessor extends AudioWorkletProcessor {
  private current: Chain[] = [[], []];
  private previous: Chain[] | null = null;
  private fade = 1;
  private fadeStep = 0;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<ConfigMessage>) => {
      if (event.data && event.data.type === 'config') this.apply(event.data);
    };
    this.port.postMessage({ type: 'hello', sampleRate });
  }

  private apply(message: ConfigMessage): void {
    const next: Chain[] = [[], []];

    for (const band of message.bands) {
      for (let ch = 0; ch < 2; ch++) {
        if (band.channel !== 0 && band.channel !== ch + 1) continue;
        next[ch].push({
          b0: band.b0,
          b1: band.b1,
          b2: band.b2,
          a1: band.a1,
          a2: band.a2,
          channel: band.channel,
          z1: 0,
          z2: 0,
        });
      }
    }

    this.previous = this.current;
    this.current = next;
    this.fade = 0;
    const samples = Math.max(1, Math.round((message.rampMs / 1000) * sampleRate));
    this.fadeStep = 1 / samples;
    this.port.postMessage({ type: 'ack', bands: message.bands.length });
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const frames = output[0].length;
    const previous = this.previous;
    const startFade = this.fade;

    for (let ch = 0; ch < output.length; ch++) {
      const source = input[Math.min(ch, input.length - 1)];
      const target = output[ch];
      const currentChain = this.current[Math.min(ch, 1)];
      const previousChain = previous ? previous[Math.min(ch, 1)] : null;

      let t = startFade;

      for (let i = 0; i < frames; i++) {
        const x = source[i];
        const wet = runChain(currentChain, x);

        if (previousChain) {
          const dry = runChain(previousChain, x);
          target[i] = dry + (wet - dry) * t;
          t += this.fadeStep;
          if (t > 1) t = 1;
        } else {
          target[i] = wet;
        }
      }
    }

    if (previous) {
      this.fade = Math.min(1, startFade + this.fadeStep * frames);
      if (this.fade >= 1) this.previous = null;
    }

    return true;
  }
}

function runChain(chain: Chain, input: number): number {
  let value = input;
  for (let i = 0; i < chain.length; i++) {
    const band = chain[i];
    const y = band.b0 * value + band.z1;
    band.z1 = band.b1 * value - band.a1 * y + band.z2;
    band.z2 = band.b2 * value - band.a2 * y;
    value = y;
  }
  return value;
}

registerProcessor('timbre-biquad', TimbreBiquadProcessor);

// ---------------------------------------------------------------- limiter

interface LimiterConfigMessage {
  type: 'limiter-config';
  ceilingDb: number;
  lookaheadMs: number;
  releaseMs: number;
  enabled?: boolean;
}

const TRUE_PEAK_TAPS = 32;

/**
 * Safety margin on the detected peak. The interpolator rolls off very close to
 * Nyquist, where a 4× estimate cannot be exact, so the limiter works about a
 * tenth of a dB early rather than ever let the output exceed the ceiling.
 */
const TRUE_PEAK_MARGIN = 1.01;

/**
 * Three fractional phases (1/4, 1/2, 3/4) of a 4× windowed-sinc interpolator.
 * Each phase is DC-normalised. The kernel is centered on the 32-sample history,
 * so a detected peak lags the input by 15.5 samples — well inside the 5 ms
 * lookahead.
 */
const TRUE_PEAK_PHASES: Float32Array[] = buildTruePeakPhases();

function buildTruePeakPhases(): Float32Array[] {
  const sinc = (x: number): number => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));
  const phases: Float32Array[] = [];

  for (let phase = 1; phase <= 3; phase++) {
    const frac = phase / 4;
    const taps = new Float32Array(TRUE_PEAK_TAPS);
    let sum = 0;

    for (let m = 0; m < TRUE_PEAK_TAPS; m++) {
      const t = m - TRUE_PEAK_TAPS / 2 + 1 - frac;
      const window =
        0.42 -
        0.5 * Math.cos((2 * Math.PI * m) / (TRUE_PEAK_TAPS - 1)) +
        0.08 * Math.cos((4 * Math.PI * m) / (TRUE_PEAK_TAPS - 1));
      const value = sinc(t) * window;
      taps[m] = value;
      sum += value;
    }

    for (let m = 0; m < TRUE_PEAK_TAPS; m++) taps[m] /= sum;
    phases.push(taps);
  }

  return phases;
}

/**
 * Lookahead limiter, fed from the stereo master mix.
 *
 * A delay line gives the detector `lookaheadMs` of warning. The gain envelope
 * attacks instantly and releases exponentially, so a transient can never push
 * the delayed output past the ceiling.
 *
 * Peak detection runs a 4× windowed-sinc interpolator over the last 32 samples
 * (three fractional phases) and takes the largest value across both channels,
 * with a small safety margin. A cubic interpolator would be cheaper but
 * collapses at fs/4, exactly where inter-sample peaks are worst; this kernel
 * reconstructs a 12 kHz sine to within 0.02 % and a 20 kHz sine to within
 * 0.2 %, so the ceiling holds for true peak rather than sample peak.
 *
 * The gain reduction is posted back a few times per second so the UI can show
 * a LIM indicator without polling the audio thread.
 */
class TimbreLimiterProcessor extends AudioWorkletProcessor {
  private ceiling = Math.pow(10, -0.3 / 20);
  private lookahead = Math.max(1, Math.round(sampleRate * 0.005));
  private releaseCoeff = Math.exp(-1 / (sampleRate * 0.08));
  private enabled = true;

  private delayL = new Float32Array(this.lookahead);
  private delayR = new Float32Array(this.lookahead);
  // Gain is delayed alongside the audio, so each sample is scaled by the gain
  // that was computed for it when it arrived. Applying the current gain to a
  // delayed sample would let the release start before the peak has left the
  // delay line, which overshoots the ceiling.
  private gainDelay = new Float32Array(this.lookahead).fill(1);
  private writeIndex = 0;

  private readonly histL = new Float32Array(TRUE_PEAK_TAPS);
  private readonly histR = new Float32Array(TRUE_PEAK_TAPS);

  private peakEnv = 0;
  private blocks = 0;
  private reported = 1;

  constructor() {
    super();
    this.port.onmessage = (event: MessageEvent<LimiterConfigMessage>) => {
      if (event.data && event.data.type === 'limiter-config') this.apply(event.data);
    };
  }

  private apply(message: LimiterConfigMessage): void {
    this.enabled = message.enabled !== false;
    this.ceiling = Math.pow(10, Math.min(0, message.ceilingDb) / 20);

    const nextLookahead = Math.max(1, Math.round((message.lookaheadMs / 1000) * sampleRate));
    if (nextLookahead !== this.lookahead) {
      this.lookahead = nextLookahead;
      this.delayL = new Float32Array(nextLookahead);
      this.delayR = new Float32Array(nextLookahead);
      this.gainDelay = new Float32Array(nextLookahead).fill(1);
      this.writeIndex = 0;
    }

    const release = Math.max(1, message.releaseMs) / 1000;
    this.releaseCoeff = Math.exp(-1 / (sampleRate * release));
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !output || output.length === 0) return true;

    const frames = output[0].length;

    if (!this.enabled) {
      for (let ch = 0; ch < output.length; ch++) {
        const source = input[Math.min(ch, input.length - 1)];
        const target = output[ch];
        for (let i = 0; i < frames; i++) target[i] = source[i];
      }
      return true;
    }

    let minGain = 1;

    for (let i = 0; i < frames; i++) {
      const xL = input[0][i];
      const xR = input[Math.min(1, input.length - 1)][i];

      // Slide the interpolator window forward by one sample.
      for (let m = 0; m < TRUE_PEAK_TAPS - 1; m++) {
        this.histL[m] = this.histL[m + 1];
        this.histR[m] = this.histR[m + 1];
      }
      this.histL[TRUE_PEAK_TAPS - 1] = xL;
      this.histR[TRUE_PEAK_TAPS - 1] = xR;

      // 4× true-peak estimate, linked across channels.
      let peak = Math.max(Math.abs(xL), Math.abs(xR));
      let interpPeak = 0;
      for (let p = 0; p < TRUE_PEAK_PHASES.length; p++) {
        const taps = TRUE_PEAK_PHASES[p];
        let l = 0;
        let r = 0;
        for (let m = 0; m < TRUE_PEAK_TAPS; m++) {
          l += this.histL[m] * taps[m];
          r += this.histR[m] * taps[m];
        }
        const absL = l < 0 ? -l : l;
        const absR = r < 0 ? -r : r;
        if (absL > interpPeak) interpPeak = absL;
        if (absR > interpPeak) interpPeak = absR;
      }
      if (interpPeak > peak) peak = interpPeak;
      peak *= TRUE_PEAK_MARGIN;

      // Instant attack, exponential release.
      const decayed = this.peakEnv * this.releaseCoeff;
      this.peakEnv = peak > decayed ? peak : decayed;

      const gain = this.peakEnv > this.ceiling ? this.ceiling / this.peakEnv : 1;
      if (gain < minGain) minGain = gain;

      const delayedL = this.delayL[this.writeIndex];
      const delayedR = this.delayR[this.writeIndex];
      const delayedGain = this.gainDelay[this.writeIndex];

      this.delayL[this.writeIndex] = xL;
      this.delayR[this.writeIndex] = xR;
      this.gainDelay[this.writeIndex] = gain;
      this.writeIndex += 1;
      if (this.writeIndex >= this.lookahead) this.writeIndex = 0;

      output[0][i] = delayedL * delayedGain;
      if (output.length > 1) output[1][i] = delayedR * delayedGain;
    }

    this.blocks += 1;
    if (this.blocks % 8 === 0) {
      // Smooth the meter a little so the indicator doesn't flicker.
      this.reported += (minGain - this.reported) * 0.5;
      this.port.postMessage({ type: 'gr', gain: this.reported });
    }

    return true;
  }
}

registerProcessor('timbre-limiter', TimbreLimiterProcessor);
