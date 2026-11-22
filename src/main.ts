import './style.css';

import { autoPreampDb, biquad, combinedResponseDb, logSpace, magnitudeDb } from './audio/dsp';
import { AudioEngine, type TestSignal } from './audio/engine';
import {
  clamp,
  cloneBands,
  createDefaultBands,
  flattenBands,
  type Band,
} from './model/band';
import { BandList } from './ui/bandList';
import { EQGraph } from './ui/graph';

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

const engine = new AudioEngine();

const state = {
  bands: createDefaultBands(),
  selectedId: null as number | null,
  preamp: 0,
};

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
  applyBands();
  updateHistoryButtons();
  setStatus('Undo.');
}

function redo(): void {
  const next = future.pop();
  if (!next) return;
  past.push(cloneBands(state.bands));
  state.bands = next;
  applyBands();
  updateHistoryButtons();
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
  state.preamp = autoPreampDb(state.bands, engine.sampleRate);

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
  applyBands();
  return true;
}

function setStatus(text: string): void {
  statusEl.textContent = text;
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

resetBtn.addEventListener('click', () => {
  const before = cloneBands(state.bands);
  state.bands = flattenBands(state.bands);
  applyBands();
  recordHistory(before);
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
  if (file) void handleFile(file, true);
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
  };
}
