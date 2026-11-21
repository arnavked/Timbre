export type FilterType = 'peaking' | 'lowshelf' | 'highshelf';

export interface Band {
  id: number;
  enabled: boolean;
  type: FilterType;
  /** Centre / corner frequency in Hz. */
  freq: number;
  /** Gain in dB. Ignored by pass filters. */
  gain: number;
  /** Q factor. Ignored by shelves (Web Audio fixes their slope at S = 1). */
  q: number;
}

export const BAND_COUNT = 5;

export const BAND_COLORS = ['#e8b44a', '#56b6f0', '#8f7bf0', '#4fd1a5', '#ef7fa8'];

export const FREQ_MIN = 20;
export const FREQ_MAX = 20000;
export const GAIN_MIN = -20;
export const GAIN_MAX = 20;
export const Q_MIN = 0.1;
export const Q_MAX = 18;

/**
 * A mild starting curve so the first-run experience is audible rather than a flat line.
 * "Flatten" in the UI returns every band to 0 dB.
 */
export function createDefaultBands(): Band[] {
  return [
    { id: 0, enabled: true, type: 'lowshelf', freq: 105, gain: 3, q: 0.707 },
    { id: 1, enabled: true, type: 'peaking', freq: 320, gain: -1.5, q: 1 },
    { id: 2, enabled: true, type: 'peaking', freq: 1200, gain: 0, q: 1 },
    { id: 3, enabled: true, type: 'peaking', freq: 3000, gain: 1.5, q: 1.2 },
    { id: 4, enabled: true, type: 'highshelf', freq: 10000, gain: -2, q: 0.707 },
  ];
}

export function flattenBands(bands: Band[]): Band[] {
  return bands.map((b) => ({ ...b, gain: 0 }));
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
