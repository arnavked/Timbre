import { normalizeProfile, type Profile } from '../model/profile';

export interface ProfileFile {
  schemaVersion: 1;
  app: 'timbre';
  exportedAt: string;
  profiles: Profile[];
}

/** Lossless JSON, including device keys, per-channel routing, and shelf slopes. */
export function exportProfilesJson(profiles: Profile[]): string {
  const file: ProfileFile = {
    schemaVersion: 1,
    app: 'timbre',
    exportedAt: new Date().toISOString(),
    profiles,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

export interface ParsedProfiles {
  profiles: Profile[];
  warnings: string[];
}

/**
 * Accepts a Timbre backup (`{ profiles: [...] }`), a bare array of profiles, or
 * a single profile object, so files from any future export shape still import.
 */
export function parseProfilesJson(text: string): ParsedProfiles {
  const warnings: string[] = [];

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { profiles: [], warnings: ['That file is not valid JSON.'] };
  }

  let list: unknown[] = [];
  if (Array.isArray(data)) {
    list = data;
  } else if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>;
    list = Array.isArray(record.profiles) ? record.profiles : [data];
  }

  const profiles: Profile[] = [];
  for (const entry of list) {
    const profile = normalizeProfile(entry);
    if (profile) profiles.push(profile);
    else warnings.push('Skipped an entry that did not look like a profile.');
  }

  if (profiles.length === 0) warnings.push('No profiles found in that file.');
  return { profiles, warnings };
}
