import { biquad, magnitudeDb, type Biquad } from '../audio/dsp';
import { TARGETS, TARGET_FREQS, type TargetDefinition } from './targets';

export type TargetId = 'flat' | 'custom' | string;

export interface TargetAdjust {
  /** ±6 dB, rotating around 1 kHz. Positive is brighter. */
  tilt: number;
  /** ±6 dB low shelf at 105 Hz. */
  bass: number;
  /** ±6 dB high shelf at 10 kHz. */
  treble: number;
  /** ±4 dB peak at 3 kHz, Q 1. */
  earGain: number;
}

export const DEFAULT_ADJUST: TargetAdjust = { tilt: 0, bass: 0, treble: 0, earGain: 0 };

export const ADJUST_LIMITS = { tilt: 6, bass: 6, treble: 6, earGain: 4 } as const;

export interface CustomTarget {
  name: string;
  /** Hz / dB pairs, already normalised to 0 dB at 1 kHz. */
  points: Array<[number, number]>;
}

export const TARGET_NONE = 'none';
export const TARGET_FLAT = 'flat';
export const TARGET_CUSTOM = 'custom';

export function findTarget(id: string): TargetDefinition | null {
  return TARGETS.find((target) => target.id === id) ?? null;
}

export function targetName(id: string, custom?: CustomTarget | null): string {
  if (id === TARGET_NONE) return 'No target';
  if (id === TARGET_FLAT) return 'Flat';
  if (id === TARGET_CUSTOM) return custom?.name ?? 'Custom target';
  return findTarget(id)?.name ?? 'No target';
}

export function clampAdjust(adjust: TargetAdjust): TargetAdjust {
  return {
    tilt: clampNumber(adjust.tilt, ADJUST_LIMITS.tilt),
    bass: clampNumber(adjust.bass, ADJUST_LIMITS.bass),
    treble: clampNumber(adjust.treble, ADJUST_LIMITS.treble),
    earGain: clampNumber(adjust.earGain, ADJUST_LIMITS.earGain),
  };
}

export function hasAdjust(adjust: TargetAdjust): boolean {
  return adjust.tilt !== 0 || adjust.bass !== 0 || adjust.treble !== 0 || adjust.earGain !== 0;
}

/**
 * Target curve sampled at `freqs`: the selected built-in or custom shape plus
 * the four preference adjustments. Returns zeros for `none` and `flat`.
 */
export function targetCurve(
  id: string,
  adjust: TargetAdjust,
  freqs: number[],
  sampleRate: number,
  custom?: CustomTarget | null,
): number[] {
  if (id === TARGET_NONE) {
    return freqs.map(() => 0);
  }

  const shape = clampAdjust(adjust);
  const out = new Array<number>(freqs.length);

  for (let i = 0; i < freqs.length; i++) {
    const base = id === TARGET_FLAT ? 0 : baseAt(id, freqs[i], custom);
    out[i] = base + tiltAt(shape.tilt, freqs[i]);
  }

  const filters: Biquad[] = [];
  if (shape.bass !== 0) filters.push(biquad('lowshelf', 105, shape.bass, 0.707, sampleRate, 1));
  if (shape.treble !== 0) filters.push(biquad('highshelf', 10000, shape.treble, 0.707, sampleRate, 1));
  if (shape.earGain !== 0) filters.push(biquad('peaking', 3000, shape.earGain, 1, sampleRate));

  for (const filter of filters) {
    for (let i = 0; i < freqs.length; i++) {
      out[i] += magnitudeDb(filter, freqs[i], sampleRate);
    }
  }

  return out;
}

/** Linear interpolation of the bundled target data at one frequency. */
function baseAt(id: string, freq: number, custom?: CustomTarget | null): number {
  if (id === TARGET_CUSTOM) {
    return custom ? interpolate(custom.points, freq) : 0;
  }

  const target = findTarget(id);
  if (!target) return 0;
  return interpolateTarget(target, freq);
}

function interpolateTarget(target: TargetDefinition, freq: number): number {
  const freqs = TARGET_FREQS;
  if (freq <= freqs[0]) return target.db[0];
  if (freq >= freqs[freqs.length - 1]) return target.db[target.db.length - 1];

  let lo = 0;
  let hi = freqs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (freqs[mid] <= freq) lo = mid;
    else hi = mid;
  }
  const t = Math.log(freq / freqs[lo]) / Math.log(freqs[hi] / freqs[lo]);
  return target.db[lo] + (target.db[hi] - target.db[lo]) * t;
}

function interpolate(points: Array<[number, number]>, freq: number): number {
  if (points.length === 0) return 0;
  if (freq <= points[0][0]) return points[0][1];
  if (freq >= points[points.length - 1][0]) return points[points.length - 1][1];

  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][0] <= freq) lo = mid;
    else hi = mid;
  }
  const t = Math.log(freq / points[lo][0]) / Math.log(points[hi][0] / points[lo][0]);
  return points[lo][1] + (points[hi][1] - points[lo][1]) * t;
}

/** ±tilt dB from 20 Hz to 20 kHz, pinned at 0 dB at 1 kHz. */
function tiltAt(tilt: number, freq: number): number {
  if (tilt === 0) return 0;
  const octaves = Math.log2(freq / 1000);
  const span = octaves >= 0 ? Math.log2(20000 / 1000) : Math.log2(1000 / 20);
  return (tilt * octaves) / span;
}

function clampNumber(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-limit, Math.min(limit, value));
}

/** Clamp a stored or imported adjustment into the public limits. */
export function normalizeAdjust(raw: unknown): TargetAdjust {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return clampAdjust({
    tilt: numberOr(value.tilt),
    bass: numberOr(value.bass),
    treble: numberOr(value.treble),
    earGain: numberOr(value.earGain),
  });
}

/** Validate a custom target snapshot, already normalised to 0 dB at 1 kHz. */
export function normalizeCustomTarget(raw: unknown): CustomTarget | null {
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

  return {
    name:
      typeof value.name === 'string' && value.name.trim()
        ? value.name.trim().slice(0, 80)
        : 'Custom target',
    points,
  };
}

function numberOr(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}
