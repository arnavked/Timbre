import { biquad, logSpace, magnitudeDb } from './dsp';
import { clamp, type Band } from '../model/band';
import { interpolateArray } from '../model/measurement';

export interface FitOptions {
  /** How many bands to place, 1–10. */
  count: number;
  /** Frequency range the solver may use for band centres. */
  freqMin: number;
  freqMax: number;
  /** Range the error is measured over. */
  windowMin: number;
  windowMax: number;
  qMin: number;
  qMax: number;
  gainMin: number;
  gainMax: number;
  /** 0 = no gain penalty, 1 = heavy. Default 0.15. */
  penalty: number;
  sampleRate: number;
}

export interface FitInput {
  /** Dense sampling of the target and measured curves. */
  freqs: number[];
  targetDb: number[];
  measuredDb: number[];
  options: FitOptions;
}

export interface FitResult {
  bands: Band[];
  freqs: number[];
  /** RMS error before fitting, in dB. */
  before: number;
  /** RMS error with the fitted bands, in dB. */
  after: number;
  /** target − measured − EQ at each grid frequency; positive means still short. */
  residual: number[];
}

const GRID_POINTS = 200;
const FREQ_FACTORS = [0.7, 0.85, 1, 1.2, 1.45];
const Q_FACTORS = [0.4, 0.55, 0.7, 0.9, 1.15, 1.5, 2, 2.8, 4];
const PASSES = 3;
/** Keep fitted bands at least ~1/14 octave apart. */
const MIN_SEPARATION = 0.05;

/**
 * Fit a cascade of peaking bands to the correction the target asks for.
 *
 * Deterministic by construction: log-spaced starting centres, a ridge solve
 * for the initial gains, then bounded coordinate descent over frequency and Q.
 * The returned bands are ordinary editor bands — there is no hidden state.
 */
export function fitBands(input: FitInput): FitResult {
  const options = input.options;
  const windowMin = clamp(options.windowMin, 20, 20000);
  const windowMax = clamp(options.windowMax, windowMin + 10, 20000);
  const freqMin = clamp(options.freqMin, 20, 20000);
  const freqMax = clamp(options.freqMax, freqMin + 1, 20000);
  const count = Math.round(clamp(options.count, 1, 10));
  const gainMin = Math.min(options.gainMin, options.gainMax);
  const gainMax = Math.max(options.gainMin, options.gainMax);
  const qMin = Math.max(0.1, Math.min(options.qMin, options.qMax));
  const qMax = Math.max(qMin, Math.max(options.qMin, options.qMax));
  const penalty = clamp(options.penalty, 0, 2);
  const sampleRate = options.sampleRate;

  const freqs = logSpace(windowMin, windowMax, GRID_POINTS);
  const need = freqs.map(
    (freq) =>
      interpolateArray(input.freqs, input.targetDb, freq) -
      interpolateArray(input.freqs, input.measuredDb, freq),
  );
  const before = rms(need);

  const centerMin = Math.max(20, Math.min(freqMin, freqMax), windowMin);
  const centerMax = Math.min(20000, Math.max(freqMin, freqMax), windowMax);
  const centers: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = count === 1 ? 0.5 : (i + 0.5) / count;
    centers.push(Math.exp(Math.log(centerMin) + (Math.log(centerMax) - Math.log(centerMin)) * t));
  }

  const qs = new Array<number>(count).fill(1.1);
  const gains = solveGains(centers, qs, need, freqs, penalty, gainMin, gainMax, sampleRate);

  const responses: number[][] = centers.map((freq, i) =>
    responseAt(freq, qs[i], gains[i], sampleRate, freqs),
  );
  const total = sumResponses(responses, freqs.length);

  for (let pass = 0; pass < PASSES; pass++) {
    let improved = false;

    for (let k = 0; k < count; k++) {
      // What the other bands leave to this one.
      const others = new Array<number>(freqs.length);
      let othersEnergy = 0;
      for (let i = 0; i < freqs.length; i++) {
        others[i] = need[i] - (total[i] - responses[k][i]);
        othersEnergy += others[i] * others[i];
      }

      const currentShape = unitShape(centers[k], qs[k], sampleRate, freqs);
      let bestFreq = centers[k];
      let bestQ = qs[k];
      let bestGain = gains[k];
      let bestCost = linearCost(others, othersEnergy, currentShape, gains[k], penalty);

      for (const freqFactor of FREQ_FACTORS) {
        const candidateFreq = clamp(centers[k] * freqFactor, freqMin, freqMax);
        if (crowded(centers, k, candidateFreq)) continue;
        for (const qFactor of Q_FACTORS) {
          const candidateQ = clamp(qs[k] * qFactor, qMin, qMax);
          const shape = unitShape(candidateFreq, candidateQ, sampleRate, freqs);
          const gain = optimalGain(shape, others, penalty, gainMin, gainMax);
          const candidateCost = linearCost(others, othersEnergy, shape, gain, penalty);
          if (candidateCost < bestCost - 1e-9) {
            bestCost = candidateCost;
            bestFreq = candidateFreq;
            bestQ = candidateQ;
            bestGain = gain;
          }
        }
      }

      if (bestFreq !== centers[k] || bestQ !== qs[k] || bestGain !== gains[k]) improved = true;

      centers[k] = bestFreq;
      qs[k] = bestQ;
      gains[k] = bestGain;
      responses[k] = responseAt(bestFreq, bestQ, bestGain, sampleRate, freqs);
      for (let i = 0; i < freqs.length; i++) {
        // others = need − Σ(j≠k); put the new band back on top of that sum.
        total[i] = need[i] - others[i] + responses[k][i];
      }
    }

    if (!improved) break;
  }

  const bands: Band[] = centers
    .map((freq, i) => ({
      id: i,
      enabled: Math.abs(gains[i]) >= 0.05,
      type: 'peaking' as const,
      freq: round(freq, 1),
      gain: round(gains[i], 1),
      q: round(qs[i], 2),
      slope: 1,
      channel: 'stereo' as const,
    }))
    .sort((a, b) => a.freq - b.freq)
    .map((band, index) => ({ ...band, id: index }));

  const residual = freqs.map((freq, i) => need[i] - sumOfBands(bands, freq, sampleRate));
  const after = rms(residual);

  return { bands, freqs, before, after, residual };
}

function solveGains(
  centers: number[],
  qs: number[],
  need: number[],
  freqs: number[],
  penalty: number,
  gainMin: number,
  gainMax: number,
  sampleRate: number,
): number[] {
  const count = centers.length;
  const shapes = centers.map((freq, i) => unitShape(freq, qs[i], sampleRate, freqs));
  const matrix = Array.from({ length: count }, () => new Array<number>(count).fill(0));
  const rhs = new Array<number>(count).fill(0);

  for (let i = 0; i < count; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < freqs.length; k++) sum += shapes[i][k] * shapes[j][k];
      matrix[i][j] = sum;
      matrix[j][i] = sum;
    }
    let dot = 0;
    for (let k = 0; k < freqs.length; k++) dot += shapes[i][k] * need[k];
    rhs[i] = dot;
  }

  for (let i = 0; i < count; i++) matrix[i][i] *= 1 + penalty;

  const solution = solveLinear(matrix, rhs);
  if (!solution) return new Array<number>(count).fill(0);
  return solution.map((value) => clamp(value, gainMin, gainMax));
}

function unitShape(freq: number, q: number, sampleRate: number, freqs: number[]): number[] {
  const filter = biquad('peaking', freq, 1, q, sampleRate);
  const out = new Array<number>(freqs.length);
  for (let i = 0; i < freqs.length; i++) out[i] = magnitudeDb(filter, freqs[i], sampleRate);
  return out;
}

function responseAt(
  freq: number,
  q: number,
  gain: number,
  sampleRate: number,
  freqs: number[],
): number[] {
  if (gain === 0) return new Array<number>(freqs.length).fill(0);
  const filter = biquad('peaking', freq, gain, q, sampleRate);
  const out = new Array<number>(freqs.length);
  for (let i = 0; i < freqs.length; i++) out[i] = magnitudeDb(filter, freqs[i], sampleRate);
  return out;
}

function optimalGain(
  shape: number[],
  need: number[],
  penalty: number,
  gainMin: number,
  gainMax: number,
): number {
  let dot = 0;
  let norm = 0;
  for (let i = 0; i < shape.length; i++) {
    dot += shape[i] * need[i];
    norm += shape[i] * shape[i];
  }
  const gain = dot / (norm * (1 + penalty) + 1e-9);
  return clamp(gain, gainMin, gainMax);
}

/**
 * Least-squares cost for a band shape scaled by `gain`, with a ridge term.
 * Lower is better; the gain penalty keeps a single huge boost expensive.
 */
function linearCost(
  need: number[],
  needEnergy: number,
  shape: number[],
  gain: number,
  penalty: number,
): number {
  let dot = 0;
  let norm = 0;
  for (let i = 0; i < shape.length; i++) {
    dot += shape[i] * need[i];
    norm += shape[i] * shape[i];
  }
  return needEnergy - (2 * gain * dot - gain * gain * norm) + penalty * norm * gain * gain;
}

function crowded(centers: number[], index: number, candidate: number): boolean {
  for (let j = 0; j < centers.length; j++) {
    if (j === index) continue;
    if (Math.abs(Math.log(candidate / centers[j])) < MIN_SEPARATION) return true;
  }
  return false;
}

function sumResponses(responses: number[][], length: number): number[] {
  const total = new Array<number>(length).fill(0);
  for (const response of responses) {
    for (let i = 0; i < length; i++) total[i] += response[i];
  }
  return total;
}

function sumOfBands(bands: Band[], freq: number, sampleRate: number): number {
  let sum = 0;
  for (const band of bands) {
    if (!band.enabled) continue;
    const filter = biquad(band.type, band.freq, band.gain, band.q, sampleRate, band.slope);
    sum += magnitudeDb(filter, freq, sampleRate);
  }
  return sum;
}

function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const n = rhs.length;
  const a = matrix.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];

    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) a[row][k] -= factor * a[col][k];
    }
  }

  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let col = row + 1; col < n; col++) sum -= a[row][col] * x[col];
    x[row] = sum / a[row][row];
  }
  return x;
}

function rms(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / Math.max(1, values.length));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
