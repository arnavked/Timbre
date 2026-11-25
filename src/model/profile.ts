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
  type Band,
  type Channel,
  type FilterType,
} from './band';
import { normalizeMeasurement, type Measurement } from './measurement';
import {
  normalizeAdjust,
  normalizeCustomTarget,
  type CustomTarget,
  type TargetAdjust,
} from './target';

export type Connection = 'wired' | 'bluetooth' | 'usb';
export type AncMode = 'on' | 'off' | 'transparency';

export interface DeviceKey {
  /** Free text, e.g. "Sony WH-1000XM5". */
  model: string;
  connection: Connection;
  /** Bluetooth codec, e.g. "LDAC". Empty for wired connections. */
  codec: string;
  anc: AncMode;
}

export interface Profile {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  device: DeviceKey;
  /** Effective preamp at save time, in dB. */
  preamp: number;
  bands: Band[];
  /** Selected target id, so the design context survives a reload. */
  targetId?: string;
  /** Target shape offsets (tilt, bass, treble, ear gain). */
  targetAdjust?: TargetAdjust;
  /** Inline custom target, when one was imported. */
  customTarget?: CustomTarget;
  /**
   * Inline measurement snapshot.
   *
   * The PRD sketched a `measurementId`, but storing the points with the profile
   * means overlays survive a reload and a JSON round-trip without a second store.
   */
  measurement?: Measurement;
  notes?: string;
}

export const CONNECTION_LABELS: Record<Connection, string> = {
  wired: 'Wired',
  bluetooth: 'Bluetooth',
  usb: 'USB',
};

export const ANC_LABELS: Record<AncMode, string> = {
  on: 'ANC on',
  off: 'ANC off',
  transparency: 'Transparency',
};

export const CONNECTIONS: Connection[] = ['wired', 'bluetooth', 'usb'];
export const ANC_MODES: AncMode[] = ['off', 'on', 'transparency'];

export function emptyDevice(): DeviceKey {
  return { model: '', connection: 'wired', codec: '', anc: 'off' };
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Short one-line description, e.g. "Bluetooth · LDAC · ANC on". */
export function deviceSummary(device: DeviceKey): string {
  const parts: string[] = [CONNECTION_LABELS[device.connection] ?? 'Wired'];
  if (device.codec.trim()) parts.push(device.codec.trim());
  if (device.connection === 'bluetooth' || device.anc !== 'off') {
    parts.push(ANC_LABELS[device.anc] ?? 'ANC off');
  }
  return parts.join(' · ');
}

export function profileTitle(profile: Profile): string {
  const model = profile.device.model.trim();
  return model ? `${profile.name} — ${model}` : profile.name;
}

const FILTER_TYPES: FilterType[] = [
  'peaking',
  'lowshelf',
  'highshelf',
  'lowpass',
  'highpass',
  'notch',
];

const CHANNELS: Channel[] = ['stereo', 'L', 'R'];

/**
 * Coerce imported band data into exactly BAND_COUNT valid bands.
 * Unknown or missing fields fall back to a disabled peaking band.
 */
export function normalizeBands(raw: unknown): Band[] {
  const source = Array.isArray(raw) ? raw : [];
  const bands: Band[] = [];

  for (let i = 0; i < BAND_COUNT; i++) {
    const entry = source[i];
    if (!entry || typeof entry !== 'object') {
      bands.push(blankBand(i));
      continue;
    }

    const value = entry as Record<string, unknown>;
    const type = FILTER_TYPES.includes(value.type as FilterType)
      ? (value.type as FilterType)
      : 'peaking';
    const channel = CHANNELS.includes(value.channel as Channel)
      ? (value.channel as Channel)
      : 'stereo';

    bands.push({
      id: i,
      enabled: value.enabled === undefined ? true : Boolean(value.enabled),
      type,
      freq: clamp(numberOr(value.freq, 1000), FREQ_MIN, FREQ_MAX),
      gain: clamp(numberOr(value.gain, 0), GAIN_MIN, GAIN_MAX),
      q: clamp(numberOr(value.q, 1), Q_MIN, Q_MAX),
      slope: clamp(numberOr(value.slope, 1), SLOPE_MIN, SLOPE_MAX),
      channel,
    });
  }

  return bands;
}

export function normalizeDevice(raw: unknown): DeviceKey {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const connection = CONNECTIONS.includes(value.connection as Connection)
    ? (value.connection as Connection)
    : 'wired';
  const anc = ANC_MODES.includes(value.anc as AncMode) ? (value.anc as AncMode) : 'off';

  return {
    model: typeof value.model === 'string' ? value.model.slice(0, 80) : '',
    connection,
    codec: typeof value.codec === 'string' ? value.codec.slice(0, 40) : '',
    anc,
  };
}

/** Validate and repair a profile read from storage or a JSON file. */
export function normalizeProfile(raw: unknown): Profile | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  if (!Array.isArray(value.bands)) return null;

  const now = new Date().toISOString();
  const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Untitled curve';

  const customTarget = normalizeCustomTarget(value.customTarget);
  const measurement = normalizeMeasurement(value.measurement);

  return {
    schemaVersion: 1,
    id: typeof value.id === 'string' && value.id ? value.id : newId(),
    name: name.slice(0, 80),
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : now,
    device: normalizeDevice(value.device),
    preamp: numberOr(value.preamp, 0),
    bands: normalizeBands(value.bands),
    ...(typeof value.targetId === 'string' ? { targetId: value.targetId } : {}),
    ...(value.targetAdjust ? { targetAdjust: normalizeAdjust(value.targetAdjust) } : {}),
    ...(customTarget ? { customTarget } : {}),
    ...(measurement ? { measurement } : {}),
    ...(typeof value.notes === 'string' ? { notes: value.notes.slice(0, 2000) } : {}),
  };
}

function numberOr(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value.replace(',', '.'));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}
