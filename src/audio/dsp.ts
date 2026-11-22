import type { Band, FilterType } from '../model/band';

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a0: number;
  a1: number;
  a2: number;
}

function normalized(
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): Biquad {
  const g = 1 / a0;
  return { b0: b0 * g, b1: b1 * g, b2: b2 * g, a0: 1, a1: a1 * g, a2: a2 * g };
}

/**
 * RBJ Audio EQ Cookbook coefficients, normalised so a0 = 1.
 *
 * Shelves derive their slope S from Q:
 *
 *   S = 1 / (1 + (1/Q² - 2) / (A + 1/A))
 *
 * Q = 0.7071 gives S = 1, which is the Web Audio default and close to the
 * Q = 0.7 that AutoEQ writes into its LSC/HSC filters. Because the preview and
 * the export use the same generator, what you hear is what you export.
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
  const alphaQ = sin / (2 * Math.max(q, 0.0001));

  switch (type) {
    case 'lowpass':
      return normalized((1 - cos) / 2, 1 - cos, (1 - cos) / 2, 1 + alphaQ, -2 * cos, 1 - alphaQ);

    case 'highpass':
      return normalized(
        (1 + cos) / 2,
        -(1 + cos),
        (1 + cos) / 2,
        1 + alphaQ,
        -2 * cos,
        1 - alphaQ,
      );

    case 'notch':
      return normalized(1, -2 * cos, 1, 1 + alphaQ, -2 * cos, 1 - alphaQ);

    case 'peaking': {
      const A = Math.pow(10, gainDb / 40);
      const alpha = sin / (2 * Math.max(q, 0.0001));
      return normalized(
        1 + alpha * A,
        -2 * cos,
        1 - alpha * A,
        1 + alpha / A,
        -2 * cos,
        1 - alpha / A,
      );
    }

    case 'lowshelf': {
      const A = Math.pow(10, gainDb / 40);
      const alpha = shelfAlpha(A, q, sin);
      const k = 2 * Math.sqrt(A) * alpha;
      return normalized(
        A * (A + 1 - (A - 1) * cos + k),
        2 * A * (A - 1 - (A + 1) * cos),
        A * (A + 1 - (A - 1) * cos - k),
        A + 1 + (A - 1) * cos + k,
        -2 * (A - 1 + (A + 1) * cos),
        A + 1 + (A - 1) * cos - k,
      );
    }

    case 'highshelf': {
      const A = Math.pow(10, gainDb / 40);
      const alpha = shelfAlpha(A, q, sin);
      const k = 2 * Math.sqrt(A) * alpha;
      return normalized(
        A * (A + 1 + (A - 1) * cos + k),
        -2 * A * (A - 1 + (A + 1) * cos),
        A * (A + 1 + (A - 1) * cos - k),
        A + 1 - (A - 1) * cos + k,
        2 * (A - 1 - (A + 1) * cos),
        A + 1 - (A - 1) * cos - k,
      );
    }
  }
}

function shelfAlpha(A: number, q: number, sin: number): number {
  const sum = A + 1 / A;
  const invS = 1 + (1 / (q * q) - 2) / sum;
  const inside = sum * (Math.max(invS, 0.05) - 1) + 2;
  return (sin / 2) * Math.sqrt(Math.max(inside, 1e-6));
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
    if (!band.enabled) continue;
    // A peaking/shelf filter at 0 dB is exactly flat; pass filters are not.
    if (bandUsesGain(band) && band.gain === 0) continue;
    const c = biquad(band.type, band.freq, band.gain, band.q, sampleRate);
    for (let i = 0; i < freqs.length; i++) {
      out[i] += magnitudeDb(c, freqs[i], sampleRate);
    }
  }

  return out;
}

function bandUsesGain(band: Band): boolean {
  return band.type === 'peaking' || band.type === 'lowshelf' || band.type === 'highshelf';
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
  const freqs = logSpace(20, 20000, 512);
  const response = combinedResponseDb(bands, freqs, sampleRate);
  let max = 0;
  for (const db of response) if (db > max) max = db;
  return -max;
}
