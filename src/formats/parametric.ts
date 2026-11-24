import { shelfQFromSlope, shelfSlopeFromQ } from '../audio/dsp';
import {
  BAND_COUNT,
  FREQ_MAX,
  FREQ_MIN,
  GAIN_MAX,
  GAIN_MIN,
  Q_MAX,
  Q_MIN,
  SLOPE_MAX,
  SLOPE_MIN,
  blankBand,
  clamp,
  isShelf,
  usesGain,
  type Band,
  type FilterType,
} from '../model/band';

export interface ParsedEq {
  preamp: number | null;
  bands: Band[];
  warnings: string[];
}

const TYPE_TAGS: Record<string, FilterType> = {
  PK: 'peaking',
  PEAK: 'peaking',
  PEQ: 'peaking',
  LS: 'lowshelf',
  LSC: 'lowshelf',
  LOWSHELF: 'lowshelf',
  HS: 'highshelf',
  HSC: 'highshelf',
  HIGHSHELF: 'highshelf',
  LP: 'lowpass',
  LPQ: 'lowpass',
  LOWPASS: 'lowpass',
  HP: 'highpass',
  HPQ: 'highpass',
  HIGHPASS: 'highpass',
  NO: 'notch',
  NOTCH: 'notch',
  BP: 'peaking',
  BANDPASS: 'peaking',
};

const TYPE_LABELS: Record<FilterType, string> = {
  peaking: 'PK',
  lowshelf: 'LSC',
  highshelf: 'HSC',
  lowpass: 'LPQ',
  highpass: 'HPQ',
  notch: 'NO',
};

/** Equalizer APO commands that cannot be represented as a biquad cascade. */
const UNSUPPORTED = new Set([
  'graphiceq',
  'convolution',
  'copy',
  'include',
  'loudnesscorrection',
  'device',
  'channel',
  'stage',
  'delay',
]);

/**
 * Parse AutoEQ / Equalizer APO / Peace / Wavelet `ParametricEQ.txt` text.
 *
 * Unknown lines are reported and skipped rather than failing the whole file,
 * and the result is always padded to BAND_COUNT bands so the editor keeps its
 * fixed ten rows.
 */
export function parseParametricEq(text: string): ParsedEq {
  const warnings: string[] = [];
  const bands: Band[] = [];
  let preamp: number | null = null;
  let skipped = 0;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = stripComment(rawLine).trim();
    if (!line) continue;

    const preampMatch = /^preamp\s*[:=]\s*(-?\d+(?:[.,]\d+)?)/i.exec(line);
    if (preampMatch) {
      preamp = toNumber(preampMatch[1]);
      continue;
    }

    const filterMatch = /^filter\s*(\d*)\s*:\s*(on|off)?\s*([a-z]+)?\s*(.*)$/i.exec(line);
    if (!filterMatch) {
      if (/^filter\b/i.test(line)) {
        warnings.push(`Skipped unreadable filter line: ${line}`);
      } else {
        const command = /^[a-z]+/i.exec(line)?.[0] ?? '';
        if (UNSUPPORTED.has(command.toLowerCase())) {
          warnings.push(`“${command}” lines are not supported and were skipped.`);
        }
      }
      continue;
    }

    if (bands.length >= BAND_COUNT) {
      skipped += 1;
      continue;
    }

    const index = filterMatch[1];
    const label = index ? `Filter ${index}` : 'Filter';
    const enabled = (filterMatch[2] ?? 'on').toLowerCase() !== 'off';
    const tag = (filterMatch[3] ?? '').toUpperCase();
    const rest = filterMatch[4] ?? '';
    const type = TYPE_TAGS[tag];

    if (!type) {
      warnings.push(`${label}: unknown type "${tag || '?'}" skipped.`);
      continue;
    }
    if (tag === 'BP' || tag === 'BANDPASS') {
      warnings.push(`${label}: band-pass approximated as a peak filter.`);
    }

    const freq = readNumber(rest, /(?:^|\s)(?:fc|freq|frequency)\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/i);
    if (freq === null) {
      warnings.push(`${label}: no frequency found, skipped.`);
      continue;
    }

    const gain = readNumber(rest, /(?:^|\s)gain\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/i) ?? 0;
    const qValue = readNumber(rest, /(?:^|\s)q\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/i);
    const bandwidth = readNumber(rest, /(?:^|\s)bw\s*[:=]?\s*(-?\d+(?:[.,]\d+)?)/i);

    let q = qValue ?? (bandwidth !== null ? bandwidthToQ(bandwidth) : 1);
    q = clamp(q, Q_MIN, Q_MAX);

    let slope = 1;
    if (isShelf(type) && qValue !== null) {
      slope = clamp(shelfSlopeFromQ(qValue, gain), SLOPE_MIN, SLOPE_MAX);
    }

    bands.push({
      id: bands.length,
      enabled,
      type,
      freq: clamp(freq, FREQ_MIN, FREQ_MAX),
      gain: clamp(gain, GAIN_MIN, GAIN_MAX),
      q,
      slope,
      channel: 'stereo',
    });
  }

  if (skipped > 0) {
    warnings.push(`${skipped} extra filter${skipped === 1 ? '' : 's'} dropped (limit is ${BAND_COUNT}).`);
  }

  for (let i = bands.length; i < BAND_COUNT; i++) {
    bands.push(blankBand(i));
  }

  return { preamp, bands, warnings };
}

/**
 * Write an AutoEQ-compatible `ParametricEQ.txt`.
 *
 * Only enabled bands are emitted and they are numbered from 1, which is what
 * AutoEQ, Peace, and Wavelet expect. Shelves carry a Q derived from their
 * slope so the file reproduces the same curve in any RBJ-compliant tool.
 */
export function exportParametricEq(bands: Band[], preamp: number): string {
  const lines = [`Preamp: ${formatNumber(preamp, 1)} dB`];
  let index = 0;

  for (const band of bands) {
    if (!band.enabled) continue;
    index += 1;

    const parts = [
      `Filter ${index}: ON ${TYPE_LABELS[band.type]}`,
      `Fc ${formatNumber(band.freq, band.freq < 1000 ? 1 : 0)} Hz`,
    ];

    if (usesGain(band.type)) {
      parts.push(`Gain ${formatNumber(band.gain, 1)} dB`);
    }

    const q = isShelf(band.type) ? shelfQFromSlope(band.slope, band.gain) : band.q;
    parts.push(`Q ${formatNumber(q, 3)}`);

    lines.push(parts.join(' '));
  }

  return `${lines.join('\n')}\n`;
}

function stripComment(line: string): string {
  const hash = line.indexOf('#');
  const slash = line.indexOf('//');
  let end = line.length;
  if (hash >= 0) end = Math.min(end, hash);
  if (slash >= 0) end = Math.min(end, slash);
  return line.slice(0, end);
}

function readNumber(text: string, pattern: RegExp): number | null {
  const match = pattern.exec(text);
  return match ? toNumber(match[1]) : null;
}

function toNumber(raw: string): number {
  return Number.parseFloat(raw.replace(',', '.'));
}

/** Bandwidth in octaves to Q, as Equalizer APO defines it. */
function bandwidthToQ(octaves: number): number {
  const safe = Math.max(octaves, 0.01);
  return 1 / (2 * Math.sinh((Math.LN2 / 2) * safe));
}

function formatNumber(value: number, decimals: number): string {
  const fixed = value.toFixed(decimals);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return trimmed === '-0' ? '0' : trimmed;
}
