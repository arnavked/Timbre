import './style.css';

import { autoPreampDb, biquad, combinedResponseDb, logSpace, magnitudeDb } from './audio/dsp';
import { AudioEngine, type TestSignal } from './audio/engine';
import { exportParametricEq, parseParametricEq } from './formats/parametric';
import { exportProfilesJson, parseProfilesJson } from './formats/profileJson';
import {
  clamp,
  cloneBands,
  createDefaultBands,
  flattenBands,
  type Band,
} from './model/band';
import {
  deviceSummary,
  emptyDevice,
  newId,
  type DeviceKey,
  type Profile,
} from './model/profile';
import { listProfiles, putProfile, removeProfile } from './storage/profiles';
import { BandList } from './ui/bandList';
import { EQGraph } from './ui/graph';
import { ProfilePanel } from './ui/profilePanel';

function must<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

const canvas = must<HTMLCanvasElement>('#eq');
const bandsEl = must<HTMLElement>('#bands');
const preampEl = must<HTMLElement>('#preamp');
const statusEl = must<HTMLElement>('#status');
const rateEl = must<HTMLElement>('#sample-rate');
const meterEl = must<HTMLElement>('#meter-fill');
const hintEl = must<HTMLElement>('#graph-hint');
const graphWrap = must<HTMLElement>('.graph-wrap');

const playBtn = must<HTMLButtonElement>('#btn-play');
const fileBtn = must<HTMLButtonElement>('#btn-file');
const fileInput = must<HTMLInputElement>('#file-input');
const pinkBtn = must<HTMLButtonElement>('#btn-pink');
const sweepBtn = must<HTMLButtonElement>('#btn-sweep');
const bypassBtn = must<HTMLButtonElement>('#btn-bypass');
const resetBtn = must<HTMLButtonElement>('#btn-reset');
const undoBtn = must<HTMLButtonElement>('#btn-undo');
const redoBtn = must<HTMLButtonElement>('#btn-redo');

const tabBands = must<HTMLButtonElement>('#tab-bands');
const tabProfile = must<HTMLButtonElement>('#tab-profile');
const paneBands = must<HTMLElement>('#pane-bands');
const paneProfile = must<HTMLElement>('#pane-profile');
const profilePanelEl = must<HTMLElement>('#profile-panel');

const engine = new AudioEngine();

const state = {
  bands: createDefaultBands(),
  selectedId: null as number | null,
  preamp: 0,
  /** Preamp from an imported file, honoured when it asks for more headroom. */
  preampOverride: null as number | null,
};

const profileState = {
  id: null as string | null,
  name: 'Untitled curve',
  device: emptyDevice(),
  dirty: false,
};

let profiles: Profile[] = [];

type Source = { kind: 'file' } | { kind: 'test'; signal: TestSignal };
let source: Source | null = null;
let currentLabel = '';

// ----------------------------------------------------------------- history

const past: Band[][] = [];
const future: Band[][] = [];
let dragSnapshot: Band[] | null = null;

function sameBands(a: Band[], b: Band[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((band, index) => {
    const other = b[index];
    return (
      band.enabled === other.enabled &&
      band.type === other.type &&
      band.freq === other.freq &&
      band.gain === other.gain &&
      band.q === other.q &&
      band.slope === other.slope &&
      band.channel === other.channel
    );
  });
}

function recordHistory(before: Band[]): void {
  if (sameBands(before, state.bands)) return;
  past.push(before);
  if (past.length > 50) past.shift();
  future.length = 0;
  updateHistoryButtons();
}

function undo(): void {
  const previous = past.pop();
  if (!previous) return;
  future.push(cloneBands(state.bands));
  state.bands = previous;
  state.preampOverride = null;
  applyBands();
  updateHistoryButtons();
  markDirty();
  setStatus('Undo.');
}

function redo(): void {
  const next = future.pop();
  if (!next) return;
  past.push(cloneBands(state.bands));
  state.bands = next;
  state.preampOverride = null;
  applyBands();
  updateHistoryButtons();
  markDirty();
  setStatus('Redo.');
}

function updateHistoryButtons(): void {
  undoBtn.disabled = past.length === 0;
  redoBtn.disabled = future.length === 0;
}

// ------------------------------------------------------------------ render

function selectBand(id: number | null): void {
  state.selectedId = id;
  graph.setSelected(id);
  bandList.setSelected(id);
}

function applyBands(): void {
  const auto = autoPreampDb(state.bands, engine.sampleRate);
  state.preamp =
    state.preampOverride === null ? auto : Math.min(state.preampOverride, auto);

  engine.setBands(state.bands);
  engine.setPreamp(state.preamp);

  graph.setBands(state.bands);
  bandList.update(state.bands);

  preampEl.textContent = `${state.preamp.toFixed(1)} dB`;
}

function applyPatch(id: number, patch: Partial<Omit<Band, 'id'>>): boolean {
  const index = state.bands.findIndex((band) => band.id === id);
  if (index < 0) return false;

  const current = state.bands[index];
  const next: Band = { ...current, ...patch };

  const keys = Object.keys(patch) as Array<keyof Omit<Band, 'id'>>;
  const changed = keys.some((key) => current[key] !== next[key]);
  if (!changed) return false;

  state.bands[index] = next;
  state.preampOverride = null;
  applyBands();
  markDirty();
  return true;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
  statusEl.title = text;
}

// ------------------------------------------------------------------ profiles

function refreshPanel(): void {
  profilePanel.setMeta({
    id: profileState.id,
    name: profileState.name,
    device: profileState.device,
    dirty: profileState.dirty,
  });
}

function markDirty(): void {
  if (profileState.dirty) return;
  profileState.dirty = true;
  refreshPanel();
}

async function refreshProfiles(): Promise<void> {
  try {
    profiles = await listProfiles();
    profilePanel.setProfiles(profiles);
  } catch (error) {
    setStatus(`Profile storage unavailable: ${messageOf(error)}`);
  }
}

function buildProfile(): Profile {
  const now = new Date().toISOString();
  const existing = profileState.id
    ? profiles.find((profile) => profile.id === profileState.id)
    : undefined;

  return {
    schemaVersion: 1,
    id: profileState.id ?? newId(),
    name: profileState.name.trim() || 'Untitled curve',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    device: { ...profileState.device },
    preamp: state.preamp,
    bands: cloneBands(state.bands),
  };
}

async function saveProfile(asNew: boolean): Promise<void> {
  const profile = buildProfile();
  if (asNew || !profileState.id) {
    profile.id = newId();
    profile.createdAt = new Date().toISOString();
  }

  try {
    await putProfile(profile);
  } catch (error) {
    setStatus(`Could not save: ${messageOf(error)}`);
    return;
  }

  // Ask the browser to keep the library out of eviction, if it can.
  if (navigator.storage?.persist) void navigator.storage.persist().catch(() => {});

  profileState.id = profile.id;
  profileState.name = profile.name;
  profileState.dirty = false;

  await refreshProfiles();
  refreshPanel();
  setStatus(`Saved “${profile.name}”.`);
}

function loadProfile(id: string): void {
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) return;

  const previousDevice = { ...profileState.device };
  const before = cloneBands(state.bands);
  profilePanel.hideNotice();
  state.bands = cloneBands(profile.bands);
  // Keep the saved preamp so a profile that was imported with extra headroom
  // sounds the same when it is loaded back.
  state.preampOverride = profile.preamp;
  profileState.id = profile.id;
  profileState.name = profile.name;
  profileState.device = { ...profile.device };
  profileState.dirty = false;

  applyBands();
  recordHistory(before);
  refreshPanel();
  selectBand(null);

  const warning = deviceMismatchWarning(previousDevice, profile.device);
  if (warning) profilePanel.showNotice(warning);

  setStatus(`Loaded “${profile.name}” — ${deviceSummary(profile.device)}.`);
}

/**
 * A curve tuned for one connection mode or ANC state will not match the same
 * headphone in another. Only warn when it is the same model, so switching
 * between different headphones stays quiet.
 */
function deviceMismatchWarning(previous: DeviceKey, next: DeviceKey): string | null {
  const model = next.model.trim();
  if (!model || model.toLowerCase() !== previous.model.trim().toLowerCase()) return null;
  if (
    previous.connection === next.connection &&
    previous.codec.trim().toLowerCase() === next.codec.trim().toLowerCase() &&
    previous.anc === next.anc
  ) {
    return null;
  }

  return `“${model}” was tuned for ${deviceSummary(next)}, but the device was set to ${deviceSummary(
    previous,
  )}. The curve may not match — switch the fields or re-tune.`;
}

function startNewProfile(): void {
  const before = cloneBands(state.bands);
  profilePanel.hideNotice();
  state.bands = createDefaultBands();
  state.preampOverride = null;
  profileState.id = null;
  profileState.name = 'Untitled curve';
  profileState.device = emptyDevice();
  profileState.dirty = false;

  applyBands();
  recordHistory(before);
  refreshPanel();
  selectBand(null);
  setStatus('Started a new curve.');
}

async function duplicateProfile(): Promise<void> {
  profileState.id = null;
  profileState.name = `${profileState.name.trim() || 'Untitled curve'} copy`;
  await saveProfile(false);
}

async function deleteProfile(id: string): Promise<void> {
  const profile = profiles.find((candidate) => candidate.id === id);
  if (!profile) return;
  if (!window.confirm(`Delete “${profile.name}”? This cannot be undone.`)) return;

  try {
    await removeProfile(id);
  } catch (error) {
    setStatus(`Could not delete: ${messageOf(error)}`);
    return;
  }

  if (profileState.id === id) {
    // The curve stays in the editor, but it is no longer backed by a profile.
    profileState.id = null;
    profileState.dirty = true;
  }

  await refreshProfiles();
  refreshPanel();
  setStatus(`Deleted “${profile.name}”.`);
}

async function importFile(file: File): Promise<void> {
  let text: string;
  try {
    text = await file.text();
  } catch (error) {
    setStatus(`Could not read ${file.name}: ${messageOf(error)}`);
    return;
  }

  const head = text.trimStart();
  const isJson = /\.json$/i.test(file.name) || head.startsWith('{') || head.startsWith('[');
  if (isJson) {
    await importJson(text, file.name);
  } else {
    importText(text, file.name);
  }
}

function importText(text: string, fileName: string): void {
  const parsed = parseParametricEq(text);
  const enabled = parsed.bands.filter((band) => band.enabled).length;

  if (enabled === 0 && parsed.preamp === null) {
    setStatus(`No filters found in ${fileName}.`);
    return;
  }

  const before = cloneBands(state.bands);
  profilePanel.hideNotice();
  state.bands = parsed.bands;
  state.preampOverride = parsed.preamp;
  profileState.id = null;
  profileState.name = baseName(fileName);
  profileState.dirty = true;

  applyBands();
  recordHistory(before);
  refreshPanel();
  selectBand(null);

  setStatus(`Imported ${enabled} band${enabled === 1 ? '' : 's'} from ${fileName}.`);
  if (parsed.warnings.length > 0) {
    statusEl.title = parsed.warnings.join('\n');
  }
}

async function importJson(text: string, fileName: string): Promise<void> {
  const parsed = parseProfilesJson(text);
  if (parsed.profiles.length === 0) {
    setStatus(parsed.warnings[0] ?? `No profiles found in ${fileName}.`);
    return;
  }

  const isBackup = parsed.profiles.length > 1;
  if (isBackup) {
    try {
      for (const profile of parsed.profiles) await putProfile(profile);
      await refreshProfiles();
    } catch (error) {
      setStatus(`Could not restore profiles: ${messageOf(error)}`);
      return;
    }
  }

  const profile = parsed.profiles[0];
  const before = cloneBands(state.bands);
  profilePanel.hideNotice();
  state.bands = cloneBands(profile.bands);
  state.preampOverride = profile.preamp;
  profileState.id = isBackup ? profile.id : null;
  profileState.name = profile.name;
  profileState.device = { ...profile.device };
  profileState.dirty = !isBackup;

  applyBands();
  recordHistory(before);
  refreshPanel();
  selectBand(null);

  setStatus(
    isBackup
      ? `Restored ${parsed.profiles.length} profiles.`
      : `Imported “${profile.name}”. Save it to keep it in the library.`,
  );
  if (parsed.warnings.length > 0) {
    statusEl.title = parsed.warnings.join('\n');
  }
}

function exportText(): void {
  const text = exportParametricEq(state.bands, state.preamp);
  const count = state.bands.filter((band) => band.enabled).length;
  download(`${safeName(profileState.name)}.txt`, text, 'text/plain');
  setStatus(`Exported ${count} band${count === 1 ? '' : 's'} as ParametricEQ.txt.`);
}

function exportJson(): void {
  // Backup the whole library. The curve on screen replaces its saved copy so
  // unsaved edits are included.
  const current = buildProfile();
  const list = [current, ...profiles.filter((profile) => profile.id !== current.id)];

  const name =
    list.length === 1 ? `${safeName(list[0].name)}.json` : 'timbre-profiles.json';
  download(name, exportProfilesJson(list), 'application/json');
  setStatus(`Exported ${list.length} profile${list.length === 1 ? '' : 's'} as JSON.`);
}

async function copyText(): Promise<void> {
  const text = exportParametricEq(state.bands, state.preamp);
  try {
    await navigator.clipboard.writeText(text);
    setStatus('Copied ParametricEQ.txt to the clipboard.');
  } catch {
    setStatus('Clipboard blocked — use Export .txt instead.');
  }
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .slice(0, 80);
  return cleaned || 'timbre-profile';
}

function baseName(fileName: string): string {
  return fileName.replace(/\.(txt|json)$/i, '') || 'Imported curve';
}

function isProfileFile(file: File): boolean {
  return (
    /\.(txt|json)$/i.test(file.name) ||
    file.type === 'text/plain' ||
    file.type === 'application/json'
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function selectTab(which: 'bands' | 'profile'): void {
  const bands = which === 'bands';
  tabBands.setAttribute('aria-selected', String(bands));
  tabProfile.setAttribute('aria-selected', String(!bands));
  tabBands.tabIndex = bands ? 0 : -1;
  tabProfile.tabIndex = bands ? -1 : 0;
  paneBands.hidden = !bands;
  paneProfile.hidden = bands;
}

// -------------------------------------------------------------------- audio

const graph = new EQGraph(canvas, {
  onChange: (id, patch) => {
    applyPatch(id, patch);
  },
  onSelect: (id) => selectBand(id),
  onDragStart: () => {
    dragSnapshot = cloneBands(state.bands);
  },
  onDragEnd: () => {
    if (dragSnapshot) {
      recordHistory(dragSnapshot);
      dragSnapshot = null;
    }
  },
  onInteract: () => hintEl.classList.add('hidden'),
});

const bandList = new BandList(bandsEl, state.bands, {
  onChange: (id, patch) => {
    const before = cloneBands(state.bands);
    if (applyPatch(id, patch)) recordHistory(before);
  },
  onSelect: (id) => selectBand(id),
});

const profilePanel = new ProfilePanel(profilePanelEl, {
  onMeta: (patch) => {
    if (patch.name !== undefined) profileState.name = patch.name;
    if (patch.device) profileState.device = { ...profileState.device, ...patch.device };
    profileState.dirty = true;
    refreshPanel();
  },
  onSave: () => void saveProfile(false),
  onNew: startNewProfile,
  onDuplicate: () => void duplicateProfile(),
  onDelete: (id) => void deleteProfile(id),
  onLoad: loadProfile,
  onImport: (file) => void importFile(file),
  onExportText: exportText,
  onExportJson: exportJson,
  onCopy: () => void copyText(),
});

let lastLabel = '';

function updateTransport(): void {
  const label = engine.playing ? 'Pause' : 'Play';
  if (label !== lastLabel) {
    playBtn.textContent = label;
    lastLabel = label;
  }
}

async function togglePlay(): Promise<void> {
  if (engine.playing) {
    engine.pause();
    setStatus('Paused.');
    updateTransport();
    return;
  }

  const active = source;
  if (!active) {
    setStatus('Load a file or try pink noise.');
    return;
  }

  try {
    if (active.kind === 'file') {
      await engine.play();
    } else {
      await engine.playTest(active.signal);
    }
    setStatus(`Playing ${currentLabel}.`);
  } catch {
    setStatus('Playback was blocked — click Play again.');
  }

  updateTransport();
}

async function handleFile(file: File, autoplay: boolean): Promise<void> {
  engine.loadFile(file);
  source = { kind: 'file' };
  currentLabel = file.name;

  if (autoplay) {
    try {
      await engine.play();
      setStatus(`Playing ${file.name}.`);
    } catch {
      setStatus(`Loaded ${file.name} — press Play to start audio.`);
    }
  } else {
    setStatus(`Loaded ${file.name} — press Play.`);
  }

  updateTransport();
}

async function playTest(signal: TestSignal): Promise<void> {
  source = { kind: 'test', signal };
  currentLabel = signal === 'pink' ? 'pink noise' : '20 Hz – 20 kHz sweep';
  hintEl.classList.add('hidden');

  try {
    await engine.playTest(signal);
    setStatus(`Playing ${currentLabel}.`);
  } catch {
    setStatus('Playback was blocked — click again.');
  }

  updateTransport();
}

function toggleBypass(): void {
  const next = !engine.isBypassed;
  engine.setBypass(next);
  bypassBtn.setAttribute('aria-pressed', String(next));
  setStatus(next ? 'EQ bypassed — level-matched while playing.' : 'EQ engaged.');
}

// ------------------------------------------------------------------ wiring

playBtn.addEventListener('click', () => void togglePlay());
fileBtn.addEventListener('click', () => fileInput.click());
pinkBtn.addEventListener('click', () => void playTest('pink'));
sweepBtn.addEventListener('click', () => void playTest('sweep'));
bypassBtn.addEventListener('click', toggleBypass);
undoBtn.addEventListener('click', undo);
redoBtn.addEventListener('click', redo);

tabBands.addEventListener('click', () => selectTab('bands'));
tabProfile.addEventListener('click', () => selectTab('profile'));

for (const tab of [tabBands, tabProfile]) {
  tab.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next = tab === tabBands ? 'profile' : 'bands';
    selectTab(next);
    (next === 'bands' ? tabBands : tabProfile).focus();
  });
}

resetBtn.addEventListener('click', () => {
  const before = cloneBands(state.bands);
  state.bands = flattenBands(state.bands);
  state.preampOverride = null;
  applyBands();
  recordHistory(before);
  markDirty();
  setStatus('All bands flattened.');
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void handleFile(file, true);
  fileInput.value = '';
});

window.addEventListener('dragover', (event) => {
  event.preventDefault();
  graphWrap.classList.add('drag-over');
});

window.addEventListener('dragleave', (event) => {
  if (event.relatedTarget === null) graphWrap.classList.remove('drag-over');
});

window.addEventListener('drop', (event) => {
  event.preventDefault();
  graphWrap.classList.remove('drag-over');
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  if (isProfileFile(file)) void importFile(file);
  else void handleFile(file, true);
});

window.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement | null;
  const typing =
    target !== null &&
    (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA');

  const mod = event.ctrlKey || event.metaKey;

  if (mod && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
    return;
  }

  if (mod && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redo();
    return;
  }

  if (typing) return;

  if (event.code === 'Space') {
    event.preventDefault();
    void togglePlay();
  } else if (!mod && event.key.toLowerCase() === 'b') {
    toggleBypass();
  }
});

// ------------------------------------------------------------------- boot

rateEl.textContent = `${(engine.sampleRate / 1000).toFixed(1)} kHz`;
graph.setSampleRate(engine.sampleRate);
applyBands();
updateHistoryButtons();
refreshPanel();
void refreshProfiles();

engine
  .init()
  .then(() => {
    applyBands();
    setStatus('Ready — load a file or try pink noise.');
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(error);
    setStatus(`Audio engine failed to start: ${message}`);
  });

let lastMatch = 0;

function tick(now: number): void {
  if (engine.playing) {
    const peak = engine.readPeak();
    const db = peak > 0 ? 20 * Math.log10(peak) : -60;
    const percent = clamp((db + 60) / 60, 0, 1) * 100;
    meterEl.style.width = `${percent.toFixed(1)}%`;
  } else {
    meterEl.style.width = '0%';
  }

  if (now - lastMatch > 120) {
    engine.updateGainMatch();
    lastMatch = now;
  }

  updateTransport();
  requestAnimationFrame(tick);
}

requestAnimationFrame(tick);

if (import.meta.env.DEV) {
  (window as unknown as { __timbre: unknown }).__timbre = {
    engine,
    state,
    applyBands,
    bandList,
    graph,
    dsp: { biquad, magnitudeDb, combinedResponseDb, autoPreampDb, logSpace },
    formats: { parseParametricEq, exportParametricEq, parseProfilesJson, exportProfilesJson },
    profileState,
    profiles: () => profiles,
    saveProfile,
    loadProfile,
    importText,
    importJson,
    exportText,
  };
}
