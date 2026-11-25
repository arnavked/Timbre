import { logSpace } from '../audio/dsp';

export type Smoothing = 'none' | '1/12' | '1/6' | '1/3';
export type NormalizeMode = '1k' | '500' | 'mean' | 'custom';

export interface Measurement {
  id: string;
  name: string;
  /** Raw points in Hz / dB, as parsed. Never rewritten by normalisation. */
  points: Array<[number, number]>;
  source?: string;
  normalize: NormalizeMode;
  /** Reference frequency for `normalize: 'custom'`. */
  customHz?: number;
  smoothing: Smoothing;
}

export const SMOOTHING_LABELS: Record<Smoothing, string> = {
  none: 'None',
  '1/12': '1/12 octave',
  '1/6': '1/6 octave',
  '1/3': '1/3 octave',
};

export const SMOOTHINGS: Smoothing[] = ['none', '1/12', '1/6', '1/3'];

export const NORMALIZE_LABELS: Record<NormalizeMode, string> = {
  '1k': '1 kHz',
  '500': '500 Hz',
  mean: 'Mean 200–2k',
  custom: 'Custom',
};

export const NORMALIZE_MODES: NormalizeMode[] = ['1k', '500', 'mean', 'custom'];

export const MEASURE_FREQ_MIN = 10;
export const MEASURE_FREQ_MAX = 40000;

const DENSE_POINTS = 480;
const DENSE_MIN = 20;
const DENSE_MAX = 20000;

export interface ParsedCsv {
  points: Array<[number, number]>;
  warnings: string[];
  /** Header names found in the file, if any. */
  columns: string[];
}

/**
 * Tolerant frequency-response CSV parser.
 *
 * Handles Squig.link, REW, AutoEQ and generic `freq,dB` exports: comma,
 * semicolon, tab, or whitespace delimiters; optional header rows; decimal
 * commas when the delimiter is not a comma; `#`, `//`, and `*` comment lines.
 */
export function parseMeasurementCsv(text: string): ParsedCsv {
  const warnings: string[] = [];
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);

  const rows: string[][] = [];
  let delimiter = detectDelimiter(lines);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('*')) continue;
    rows.push(splitRow(line, delimiter));
  }

  if (rows.length === 0) {
    return { points: [], warnings: ['That file has no data rows.'], columns: [] };
  }

  let freqCol = 0;
  let levelCol = 1;
  let columns: string[] = [];

  const first = rows[0];
  if (first.length >= 2 && !(isNumeric(first[0]) && isNumeric(first[1]))) {
    columns = first.map((value) => value.replace(/^"|"$/g, '').trim());
    const lower = columns.map((value) => value.toLowerCase());
    const freqIndex = lower.findIndex((value) => /freq|hz/.test(value));
    const levelIndex = lower.findIndex((value) => /db|spl|amplitude|level|raw|sound|gain/.test(value));
    if (freqIndex >= 0) freqCol = freqIndex;
    if (levelIndex >= 0 && levelIndex !== freqCol) levelCol = levelIndex;
    rows.shift();
  }

  const points: Array<[number, number]> = [];
  let skipped = 0;

  for (const row of rows) {
    if (row.length <= Math.max(freqCol, levelCol)) {
      skipped += 1;
      continue;
    }
    const freq = parseNumber(row[freqCol]);
    const level = parseNumber(row[levelCol]);
    if (freq === null || level === null || freq <= 0) {
      skipped += 1;
      continue;
    }
    if (freq < MEASURE_FREQ_MIN || freq > MEASURE_FREQ_MAX) continue;
    points.push([freq, level]);
  }

  if (skipped > 0) {
    warnings.push(`Skipped ${skipped} row${skipped === 1 ? '' : 's'} that did not parse.`);
  }

  points.sort((a, b) => a[0] - b[0]);

  const deduped: Array<[number, number]> = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && Math.abs(last[0] - point[0]) < 1e-6) deduped[deduped.length - 1] = point;
    else deduped.push(point);
  }

  if (deduped.length < 4) {
    return {
      points: [],
      warnings: [...warnings, 'Need at least four frequency/level pairs to draw a curve.'],
      columns,
    };
  }

  if (deduped.length < 20) {
    warnings.push(`Only ${deduped.length} points — the curve may look jagged.`);
  }

  return { points: deduped, warnings, columns };
}

/** Value at one frequency, interpolated linearly in log frequency. */
export function valueAt(points: Array<[number, number]>, freq: number): number {  if (points.length === 0) return 0;
  if (freq <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (freq >= last[0]) return last[1];

  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= freq) lo = mid;
    else hi = mid;
  }
  const [f0, d0] = points[lo];
  const [f1, d1] = points[hi];
  const t = Math.log(freq / f0) / Math.log(f1 / f0);
  return d0 + (d1 - d0) * t;
}

/** The dB offset that puts the reference point at 0 dB. */
export function normalizationOffset(measurement: Measurement): number {
  const { points, normalize } = measurement;
  if (points.length === 0) return 0;

  switch (normalize) {
    case '1k':
      return valueAt(points, 1000);
    case '500':
      return valueAt(points, 500);
    case 'custom':
      return valueAt(points, measurement.customHz ?? 1000);
    case 'mean': {
      const freqs = logSpace(200, 2000, 60);
      let sum = 0;
      for (const freq of freqs) sum += valueAt(points, freq);
      return sum / freqs.length;
    }
    default:
      return valueAt(points, 1000);
  }
}

/**
 * The normalised, optionally smoothed curve sampled at `freqs`.
 *
 * Smoothing is fractional-octave and display-only; pass `smooth: false` for
 * solver input.
 */
export function measurementCurve(
  measurement: Measurement,
  freqs: number[],
  options: { smooth?: boolean } = {},
): number[] {
  const offset = normalizationOffset(measurement);
  const denseFreqs = logSpace(DENSE_MIN, DENSE_MAX, DENSE_POINTS);
  let dense = denseFreqs.map((freq) => valueAt(measurement.points, freq) - offset);

  if (options.smooth !== false) {
    dense = smoothOctave(dense, measurement.smoothing);
  }

  return freqs.map((freq) => interpolateArray(denseFreqs, dense, freq));
}

export function measurementRange(points: Array<[number, number]>): { min: number; max: number } {
  if (points.length === 0) return { min: DENSE_MIN, max: DENSE_MAX };
  return {
    min: Math.max(DENSE_MIN, points[0][0]),
    max: Math.min(DENSE_MAX, points[points.length - 1][0]),
  };
}

/** Interpolate a sampled curve, in log frequency. */
export function interpolateArray(freqs: number[], values: number[], freq: number): number {
  if (freqs.length === 0) return 0;
  if (freq <= freqs[0]) return values[0];
  if (freq >= freqs[freqs.length - 1]) return values[values.length - 1];

  let lo = 0;
  let hi = freqs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (freqs[mid] <= freq) lo = mid;
    else hi = mid;
  }
  const t = Math.log(freq / freqs[lo]) / Math.log(freqs[hi] / freqs[lo]);
  return values[lo] + (values[hi] - values[lo]) * t;
}

function smoothOctave(values: number[], smoothing: Smoothing): number[] {
  if (smoothing === 'none') return values;

  const width = smoothing === '1/3' ? 1 / 3 : smoothing === '1/6' ? 1 / 6 : 1 / 12;
  const octaves = Math.log2(DENSE_MAX / DENSE_MIN);
  const perOctave = (values.length - 1) / octaves;
  const half = Math.max(1, Math.round((width * perOctave) / 2));

  const out = new Array<number>(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let weight = 0;
    for (let k = -half; k <= half; k++) {
      const index = i + k;
      if (index < 0 || index >= values.length) continue;
      const w = half + 1 - Math.abs(k);
      sum += values[index] * w;
      weight += w;
    }
    out[i] = sum / weight;
  }
  return out;
}

function detectDelimiter(lines: string[]): string {
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('//') || line.startsWith('*')) continue;
    if (line.includes(';')) return ';';
    if (line.includes('\t')) return '\t';
    if (line.includes(',')) return ',';
    return ' ';
  }
  return ',';
}

function splitRow(line: string, delimiter: string): string[] {
  if (delimiter === ' ') return line.split(/\s+/);
  return line.split(delimiter).map((value) => value.trim());
}

function parseNumber(raw: string): number | null {
  const text = raw.replace(/^"|"$/g, '').replace(',', '.').trim();
  if (!text) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : null;
}

function isNumeric(raw: string): boolean {
  return parseNumber(raw) !== null;
}

/** Deep copy, so a loaded profile cannot mutate the library it came from. */
export function cloneMeasurement(measurement: Measurement): Measurement {
  return {
    ...measurement,
    points: measurement.points.map(([freq, db]) => [freq, db] as [number, number]),
  };
}

/**
 * Validate a measurement snapshot from storage or a JSON profile.
 * Returns null when there is not enough usable data to draw a curve.
 */
export function normalizeMeasurement(raw: unknown): Measurement | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.points)) return null;

  const points: Array<[number, number]> = [];
  for (const entry of value.points) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const freq = Number(entry[0]);
    const db = Number(entry[1]);
    if (Number.isFinite(freq) && Number.isFinite(db) && freq > 0) points.push([freq, db]);
  }
  if (points.length < 2) return null;
  points.sort((a, b) => a[0] - b[0]);

  const normalize = NORMALIZE_MODES.includes(value.normalize as NormalizeMode)
    ? (value.normalize as NormalizeMode)
    : '1k';
  const smoothing = SMOOTHINGS.includes(value.smoothing as Smoothing)
    ? (value.smoothing as Smoothing)
    : '1/12';
  const customHz =
    typeof value.customHz === 'number' && Number.isFinite(value.customHz)
      ? value.customHz
      : undefined;

  return {
    id: typeof value.id === 'string' && value.id ? value.id : `m-${Date.now().toString(36)}`,
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim().slice(0, 80)
        : 'Measurement',
    points,
    source: typeof value.source === 'string' ? value.source.slice(0, 200) : undefined,
    normalize,
    ...(customHz !== undefined ? { customHz } : {}),
    smoothing,
  };
}
