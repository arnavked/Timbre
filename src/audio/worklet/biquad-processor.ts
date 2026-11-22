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
