export type FilterType =
  | 'peaking'
  | 'lowshelf'
  | 'highshelf'
  | 'lowpass'
  | 'highpass'
  | 'notch';

export type Channel = 'stereo' | 'L' | 'R';

export interface Band {
  id: number;
  enabled: boolean;
  type: FilterType;
  /** Centre / corner frequency in Hz. */
  freq: number;
  /** Gain in dB. Ignored by pass filters and notch. */
  gain: number;
  /**
   * Q factor for peaking, pass, and notch filters.
   *
   * Shelves ignore this and use `slope` instead.
   */
  q: number;
  /**
   * RBJ shelf slope S for low/high shelves. 1 is the neutral slope that
   * AutoEQ's Q = 0.7 corresponds to. Ignored by every other filter type.
   */
  slope: number;
  channel: Channel;
}

export const BAND_COUNT = 10;

export const BAND_COLORS = [
  '#e8b44a',
  '#56b6f0',
  '#8f7bf0',
  '#4fd1a5',
  '#ef7fa8',
  '#f2a65a',
  '#63d2d8',
  '#b8c96a',
  '#c98bf0',
  '#7aa2f7',
];

export const FREQ_MIN = 20;
export const FREQ_MAX = 20000;
export const GAIN_MIN = -20;
export const GAIN_MAX = 20;
export const Q_MIN = 0.1;
export const Q_MAX = 18;
export const SLOPE_MIN = 0.3;
export const SLOPE_MAX = 1.5;

export interface FilterTypeInfo {
  value: FilterType;
  label: string;
  short: string;
  usesGain: boolean;
}

export const FILTER_TYPES: FilterTypeInfo[] = [
  { value: 'peaking', label: 'Peak', short: 'PK', usesGain: true },
  { value: 'lowshelf', label: 'Low shelf', short: 'LS', usesGain: true },
  { value: 'highshelf', label: 'High shelf', short: 'HS', usesGain: true },
  { value: 'lowpass', label: 'Low pass', short: 'LP', usesGain: false },
  { value: 'highpass', label: 'High pass', short: 'HP', usesGain: false },
  { value: 'notch', label: 'Notch', short: 'NO', usesGain: false },
];

export function isPassType(type: FilterType): boolean {
  return type === 'lowpass' || type === 'highpass' || type === 'notch';
}

export function isShelf(type: FilterType): boolean {
  return type === 'lowshelf' || type === 'highshelf';
}

export function usesGain(type: FilterType): boolean {
  return !isPassType(type);
}

/**
 * A mild starting curve so the first-run experience is audible rather than a flat line.
 * Bands 5-9 start disabled so the graph is not cluttered with idle handles.
 */
export function createDefaultBands(): Band[] {
  return [
    { id: 0, enabled: true, type: 'lowshelf', freq: 105, gain: 3, q: 0.707, slope: 1, channel: 'stereo' },
    { id: 1, enabled: true, type: 'peaking', freq: 320, gain: -1.5, q: 1.2, slope: 1, channel: 'stereo' },
    { id: 2, enabled: true, type: 'peaking', freq: 1200, gain: 0, q: 1, slope: 1, channel: 'stereo' },
    { id: 3, enabled: true, type: 'peaking', freq: 3000, gain: 1.5, q: 1.2, slope: 1, channel: 'stereo' },
    { id: 4, enabled: true, type: 'highshelf', freq: 10000, gain: -2, q: 0.707, slope: 1, channel: 'stereo' },
    { id: 5, enabled: false, type: 'peaking', freq: 60, gain: 0, q: 1, slope: 1, channel: 'stereo' },
    { id: 6, enabled: false, type: 'peaking', freq: 600, gain: 0, q: 1, slope: 1, channel: 'stereo' },
    { id: 7, enabled: false, type: 'peaking', freq: 2000, gain: 0, q: 1, slope: 1, channel: 'stereo' },
    { id: 8, enabled: false, type: 'peaking', freq: 6000, gain: 0, q: 1, slope: 1, channel: 'stereo' },
    { id: 9, enabled: false, type: 'peaking', freq: 15000, gain: 0, q: 1, slope: 1, channel: 'stereo' },
  ];
}

/** A disabled peaking band, used to pad imports up to BAND_COUNT. */
export function blankBand(id: number): Band {
  return { id, enabled: false, type: 'peaking', freq: 1000, gain: 0, q: 1, slope: 1, channel: 'stereo' };
}

export function cloneBands(bands: Band[]): Band[] {
  return bands.map((band) => ({ ...band }));
}

export function flattenBands(bands: Band[]): Band[] {
  return bands.map((band) => ({ ...band, gain: 0 }));
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Human-readable frequency, e.g. 1200 -> "1.2 kHz". */
export function formatHz(hz: number): string {
  if (hz >= 10000) return `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)} kHz`;
  if (hz >= 1000) return `${(hz / 1000).toFixed(2).replace(/0$/, '')} kHz`;
  return `${Math.round(hz)} Hz`;
}

/** Parse loose numeric input: "1k", "1.2k", "3,5", "-2". */
export function parseNumber(raw: string): number | null {
  const text = raw.trim().toLowerCase().replace(',', '.');
  if (text === '') return null;
  const match = /^(-?\d*\.?\d+)\s*(k|khz|hz)?$/.exec(text);
  if (!match) return null;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[2] === 'k' || match[2] === 'khz' ? value * 1000 : value;
}
