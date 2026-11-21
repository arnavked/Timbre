import type { Band, FilterType } from '../model/band';

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

/**
 * RBJ Audio EQ Cookbook coefficients.
 *
 * Shelves are computed with S = 1, which is exactly what the Web Audio
 * BiquadFilterNode does, so the drawn curve matches what you hear.
 * (AutoEQ exports Q-based shelves; that difference is fixed in M1 when the
 * cascade moves into an AudioWorklet — see PRD TR-3 / risk R2.)
 */
export function biquad(
  type: FilterType,
  freq: number,
  gainDb: number,
  q: number,
  sampleRate: number,
): Biquad {
  const f = Math.min(Math.max(freq, 10), sampleRate * 0.49);
  const w0 = (2 * Math.PI * f) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const A = Math.pow(10, gainDb / 40);

  if (type === 'peaking') {
    const alpha = sin / (2 * Math.max(q, 0.0001));
    return {
      b0: 1 + alpha * A,
      b1: -2 * cos,
      b2: 1 - alpha * A,
      a0: 1 + alpha / A,
      a1: -2 * cos,
      a2: 1 - alpha / A,
    };
  }

  // S = 1 shelf: alpha = sin(w0)/2 * sqrt(2)
  const alpha = (sin / 2) * Math.SQRT2;
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

  if (type === 'lowshelf') {
    return {
      b0: A * (A + 1 - (A - 1) * cos + twoSqrtAAlpha),
      b1: 2 * A * (A - 1 - (A + 1) * cos),
      b2: A * (A + 1 - (A - 1) * cos - twoSqrtAAlpha),
      a0: A + 1 + (A - 1) * cos + twoSqrtAAlpha,
      a1: -2 * (A - 1 + (A + 1) * cos),
      a2: A + 1 + (A - 1) * cos - twoSqrtAAlpha,
    };
  }

  return {
    b0: A * (A + 1 + (A - 1) * cos + twoSqrtAAlpha),
    b1: -2 * A * (A - 1 + (A + 1) * cos),
    b2: A * (A + 1 + (A - 1) * cos - twoSqrtAAlpha),
    a0: A + 1 - (A - 1) * cos + twoSqrtAAlpha,
    a1: 2 * (A - 1 - (A + 1) * cos),
    a2: A + 1 - (A - 1) * cos - twoSqrtAAlpha,
  };
}

/** Magnitude response of one biquad at a frequency, in dB. */
export function magnitudeDb(c: Biquad, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const cos1 = Math.cos(w);
  const sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w);
  const sin2 = Math.sin(2 * w);

  const numRe = c.b0 + c.b1 * cos1 + c.b2 * cos2;
  const numIm = -(c.b1 * sin1 + c.b2 * sin2);
  const denRe = c.a0 + c.a1 * cos1 + c.a2 * cos2;
  const denIm = -(c.a1 * sin1 + c.a2 * sin2);

  const num = numRe * numRe + numIm * numIm;
  const den = denRe * denRe + denIm * denIm;
  if (den <= 1e-20) return 0;

  return 10 * Math.log10(num / den);
}

/** Summed response of a band list, in dB. Disabled bands contribute nothing. */
export function combinedResponseDb(
  bands: Band[],
  freqs: number[],
  sampleRate: number,
): number[] {
  const out = new Array<number>(freqs.length).fill(0);

  for (const band of bands) {
    if (!band.enabled || band.gain === 0) continue;
    const c = biquad(band.type, band.freq, band.gain, band.q, sampleRate);
    for (let i = 0; i < freqs.length; i++) {
      out[i] += magnitudeDb(c, freqs[i], sampleRate);
    }
  }

  return out;
}

export function logSpace(min: number, max: number, count: number): number[] {
  const a = Math.log(min);
  const b = Math.log(max);
  const out = new Array<number>(count);
  for (let i = 0; i < count; i++) {
    out[i] = Math.exp(a + ((b - a) * i) / (count - 1));
  }
  return out;
}

/**
 * Automatic preamp: the negative of the largest boost in the chain.
 * Keeps the signal below 0 dBFS without the user having to think about it.
 */
export function autoPreampDb(bands: Band[], sampleRate: number): number {
  const freqs = logSpace(20, 20000, 256);
  const response = combinedResponseDb(bands, freqs, sampleRate);
  let max = 0;
  for (const db of response) if (db > max) max = db;
  return -max;
}
