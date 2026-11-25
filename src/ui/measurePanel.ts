import {
  NORMALIZE_LABELS,
  NORMALIZE_MODES,
  SMOOTHING_LABELS,
  SMOOTHINGS,
  type Measurement,
  type NormalizeMode,
  type Smoothing,
} from '../model/measurement';
import {
  ADJUST_LIMITS,
  TARGET_CUSTOM,
  TARGET_FLAT,
  TARGET_NONE,
  targetName,
  type CustomTarget,
  type TargetAdjust,
} from '../model/target';
import { TARGETS } from '../model/targets';

export interface FitSettings {
  count: number;
  windowMin: number;
  windowMax: number;
  freqMin: number;
  freqMax: number;
  gainMin: number;
  gainMax: number;
  qMin: number;
  qMax: number;
  penalty: number;
}

export const DEFAULT_FIT: FitSettings = {
  count: 10,
  windowMin: 20,
  windowMax: 20000,
  freqMin: 20,
  freqMax: 20000,
  gainMin: -15,
  gainMax: 12,
  qMin: 0.3,
  qMax: 8,
  penalty: 0.15,
};

export interface MeasureView {
  targetId: string;
  adjust: TargetAdjust;
  customTarget: CustomTarget | null;
  showTarget: boolean;
  measurement: Measurement | null;
  showMeasured: boolean;
  fit: FitSettings;
  /** Before/after RMS of the last fit, in dB. */
  fitResult: { before: number; after: number } | null;
  /** Live residual RMS for the current bands, in dB. */
  liveRms: number | null;
  notice: string | null;
}

export interface MeasureCallbacks {
  onTarget(id: string): void;
  onAdjust(patch: Partial<TargetAdjust>): void;
  onToggleTarget(show: boolean): void;
  onMeasurementFile(file: File): void;
  onRemoveMeasurement(): void;
  onMeasurementOption(patch: {
    normalize?: NormalizeMode;
    customHz?: number;
    smoothing?: Smoothing;
  }): void;
  onToggleMeasured(show: boolean): void;
  onFitSettings(patch: Partial<FitSettings>): void;
  onFit(): void;
  onTargetFile(file: File): void;
}

const SLIDERS: Array<{ key: keyof TargetAdjust; label: string; step: number }> = [
  { key: 'tilt', label: 'Tilt', step: 0.5 },
  { key: 'bass', label: 'Bass', step: 0.5 },
  { key: 'treble', label: 'Treble', step: 0.5 },
  { key: 'earGain', label: 'Ear gain', step: 0.5 },
];

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function signed(value: number, decimals = 1): string {
  if (Math.abs(value) < 0.05) return '0 dB';
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)} dB`;
}

export class MeasurePanel {
  private readonly cb: MeasureCallbacks;

  private readonly targetSelect: HTMLSelectElement;
  private readonly targetShow: HTMLInputElement;
  private readonly customRow: HTMLElement;
  private readonly customName: HTMLElement;
  private readonly targetFile: HTMLInputElement;

  private readonly sliders = new Map<keyof TargetAdjust, { input: HTMLInputElement; output: HTMLElement }>();

  private readonly empty: HTMLElement;
  private readonly loaded: HTMLElement;
  private readonly measurementFile: HTMLInputElement;
  private readonly measureName: HTMLElement;
  private readonly measureMeta: HTMLElement;
  private readonly normalizeSelect: HTMLSelectElement;
  private readonly customHzField: HTMLElement;
  private readonly customHz: HTMLInputElement;
  private readonly smoothingSelect: HTMLSelectElement;
  private readonly measureShow: HTMLInputElement;
  private readonly noticeEl: HTMLElement;

  private readonly countSelect: HTMLSelectElement;
  private readonly windowMin: HTMLInputElement;
  private readonly windowMax: HTMLInputElement;
  private readonly gainMin: HTMLInputElement;
  private readonly gainMax: HTMLInputElement;
  private readonly qMin: HTMLInputElement;
  private readonly qMax: HTMLInputElement;
  private readonly penalty: HTMLInputElement;
  private readonly penaltyOut: HTMLElement;
  private readonly fitBtn: HTMLButtonElement;
  private readonly fitResult: HTMLElement;

  private measurementPresent = false;

  constructor(container: HTMLElement, callbacks: MeasureCallbacks) {
    this.cb = callbacks;

    // --- target -------------------------------------------------------------
    const targetSection = element('section', 'measure-section');
    targetSection.append(element('h3', undefined, 'Target'));

    const targetRow = element('div', 'row');
    this.targetSelect = element('select');
    this.targetSelect.setAttribute('aria-label', 'Target curve');
    for (const target of TARGETS) {
      this.targetSelect.append(this.option(target.id, target.name));
    }
    this.targetSelect.append(this.option(TARGET_FLAT, 'Flat'));
    this.targetSelect.append(this.option(TARGET_NONE, 'No target'));

    const showLabel = element('label', 'check');
    this.targetShow = element('input');
    this.targetShow.type = 'checkbox';
    showLabel.append(this.targetShow, element('span', undefined, 'Show'));

    targetRow.append(this.targetSelect, showLabel);
    targetSection.append(targetRow);

    this.customRow = element('div', 'custom-target');
    this.customName = element('span', 'custom-target-name');
    const clearCustom = element('button', 'btn ghost small', 'Use built-ins');
    clearCustom.type = 'button';
    clearCustom.addEventListener('click', () => this.cb.onTarget(TARGETS[0]?.id ?? TARGET_FLAT));
    this.customRow.append(this.customName, clearCustom);
    this.customRow.hidden = true;
    targetSection.append(this.customRow);

    const shape = element('details', 'sub');
    shape.append(element('summary', undefined, 'Target shape'));
    const sliderGrid = element('div', 'slider-grid');
    for (const slider of SLIDERS) {
      const limit = ADJUST_LIMITS[slider.key];
      const label = element('label', 'slider');
      const name = element('span', 'slider-name', slider.label);
      const input = element('input');
      input.type = 'range';
      input.min = String(-limit);
      input.max = String(limit);
      input.step = String(slider.step);
      input.value = '0';
      input.setAttribute('aria-label', slider.label);
      const output = element('output', 'slider-value', '0 dB');
      input.addEventListener('input', () => {
        const value = Number.parseFloat(input.value);
        output.textContent = signed(value);
        this.cb.onAdjust({ [slider.key]: value } as Partial<TargetAdjust>);
      });
      label.append(name, input, output);
      sliderGrid.append(label);
      this.sliders.set(slider.key, { input, output });
    }
    shape.append(sliderGrid);
    targetSection.append(shape);

    const targetIo = element('div', 'io-row');
    const loadTarget = element('button', 'btn small', 'Load target CSV…');
    loadTarget.type = 'button';
    this.targetFile = element('input');
    this.targetFile.type = 'file';
    this.targetFile.accept = '.csv,.txt,text/csv,text/plain';
    this.targetFile.hidden = true;
    loadTarget.addEventListener('click', () => this.targetFile.click());
    this.targetFile.addEventListener('change', () => {
      const file = this.targetFile.files?.[0];
      if (file) this.cb.onTargetFile(file);
      this.targetFile.value = '';
    });
    targetIo.append(loadTarget, this.targetFile);
    targetSection.append(targetIo);

    // --- measurement --------------------------------------------------------
    const measureSection = element('section', 'measure-section');
    measureSection.append(element('h3', undefined, 'Measurement'));

    this.empty = element('div', 'measure-empty');
    const loadMeasurement = element('button', 'btn small', 'Load measurement CSV…');
    loadMeasurement.type = 'button';
    this.measurementFile = element('input');
    this.measurementFile.type = 'file';
    this.measurementFile.accept = '.csv,.txt,text/csv,text/plain';
    this.measurementFile.hidden = true;
    loadMeasurement.addEventListener('click', () => this.measurementFile.click());
    this.measurementFile.addEventListener('change', () => {
      const file = this.measurementFile.files?.[0];
      if (file) this.cb.onMeasurementFile(file);
      this.measurementFile.value = '';
    });
    this.empty.append(
      loadMeasurement,
      this.measurementFile,
      element(
        'p',
        'note inline',
        'Squig.link, REW, AutoEQ, or any freq / dB table. Comma, semicolon, or tab.',
      ),
    );
    measureSection.append(this.empty);

    this.loaded = element('div', 'measure-loaded');
    const measureHead = element('div', 'measure-head');
    const nameWrap = element('div', 'measure-title');
    this.measureName = element('span', 'measure-name', 'Measurement');
    this.measureMeta = element('span', 'measure-meta', '');
    nameWrap.append(this.measureName, this.measureMeta);
    const remove = element('button', 'profile-remove', '×');
    remove.type = 'button';
    remove.title = 'Remove measurement';
    remove.setAttribute('aria-label', 'Remove measurement');
    remove.addEventListener('click', () => this.cb.onRemoveMeasurement());
    measureHead.append(nameWrap, remove);
    this.loaded.append(measureHead);

    const optionsGrid = element('div', 'field-grid');
    this.normalizeSelect = element('select');
    this.normalizeSelect.setAttribute('aria-label', 'Normalise measurement');
    for (const mode of NORMALIZE_MODES) {
      this.normalizeSelect.append(this.option(mode, NORMALIZE_LABELS[mode]));
    }
    this.normalizeSelect.addEventListener('change', () => {
      const normalize = this.normalizeSelect.value as NormalizeMode;
      this.customHzField.hidden = normalize !== 'custom';
      this.cb.onMeasurementOption({ normalize });
    });

    this.customHz = element('input');
    this.customHz.type = 'number';
    this.customHz.min = '20';
    this.customHz.max = '20000';
    this.customHz.step = '10';
    this.customHz.addEventListener('change', () => {
      const value = Number.parseFloat(this.customHz.value);
      if (Number.isFinite(value)) this.cb.onMeasurementOption({ customHz: value });
    });
    this.customHzField = this.field('Ref Hz', this.customHz);
    this.customHzField.hidden = true;

    this.smoothingSelect = element('select');
    this.smoothingSelect.setAttribute('aria-label', 'Smoothing');
    for (const smoothing of SMOOTHINGS) {
      this.smoothingSelect.append(this.option(smoothing, SMOOTHING_LABELS[smoothing]));
    }
    this.smoothingSelect.addEventListener('change', () => {
      this.cb.onMeasurementOption({ smoothing: this.smoothingSelect.value as Smoothing });
    });

    const measureShowLabel = element('label', 'check');
    this.measureShow = element('input');
    this.measureShow.type = 'checkbox';
    this.measureShow.addEventListener('change', () => this.cb.onToggleMeasured(this.measureShow.checked));
    measureShowLabel.append(this.measureShow, element('span', undefined, 'Show measured'));

    optionsGrid.append(
      this.field('Normalise', this.normalizeSelect),
      this.field('Smoothing', this.smoothingSelect),
      this.customHzField,
    );
    this.loaded.append(optionsGrid, measureShowLabel);
    measureSection.append(this.loaded);

    this.noticeEl = element('p', 'measure-notice');
    this.noticeEl.hidden = true;
    measureSection.append(this.noticeEl);

    // --- fit ----------------------------------------------------------------
    const fitSection = element('section', 'measure-section');
    fitSection.append(element('h3', undefined, 'Auto-fit'));

    const fitGrid = element('div', 'field-grid');
    this.countSelect = element('select');
    this.countSelect.setAttribute('aria-label', 'Number of bands');
    for (let count = 4; count <= 10; count++) {
      this.countSelect.append(this.option(String(count), `${count} bands`));
    }
    this.countSelect.addEventListener('change', () =>
      this.cb.onFitSettings({ count: Number.parseInt(this.countSelect.value, 10) }),
    );

    this.windowMin = this.numberInput(20, 20000, 20);
    this.windowMax = this.numberInput(20, 20000, 20000);
    const windowRow = element('div', 'range-row');
    windowRow.append(this.windowMin, element('span', 'range-dash', '–'), this.windowMax);
    const windowField = this.field('Fit window (Hz)', windowRow, 'wide');
    const commitWindow = () => {
      const min = clampNumber(Number.parseFloat(this.windowMin.value), 20, 20000, 20);
      const max = clampNumber(Number.parseFloat(this.windowMax.value), 20, 20000, 20000);
      this.cb.onFitSettings({ windowMin: Math.min(min, max - 10), windowMax: Math.max(max, min + 10) });
    };
    this.windowMin.addEventListener('change', commitWindow);
    this.windowMax.addEventListener('change', commitWindow);

    fitGrid.append(this.field('Bands', this.countSelect), windowField);
    fitSection.append(fitGrid);

    const limits = element('details', 'sub');
    limits.append(element('summary', undefined, 'Limits'));
    const limitGrid = element('div', 'field-grid');
    this.gainMin = this.numberInput(-20, 0, -15);
    this.gainMax = this.numberInput(0, 20, 12);
    this.qMin = this.numberInput(0.1, 4, 0.3, 0.05);
    this.qMax = this.numberInput(1, 18, 8, 0.1);
    const commitLimit = (key: 'gainMin' | 'gainMax' | 'qMin' | 'qMax') => {
      const input = this[key];
      const value = Number.parseFloat(input.value);
      if (Number.isFinite(value)) this.cb.onFitSettings({ [key]: value });
    };
    for (const [key, input] of [
      ['gainMin', this.gainMin],
      ['gainMax', this.gainMax],
      ['qMin', this.qMin],
      ['qMax', this.qMax],
    ] as const) {
      input.addEventListener('change', () => commitLimit(key));
    }

    limitGrid.append(
      this.field('Min gain', this.gainMin),
      this.field('Max gain', this.gainMax),
      this.field('Min Q', this.qMin),
      this.field('Max Q', this.qMax),
    );

    const penaltyLabel = element('label', 'slider wide');
    this.penalty = element('input');
    this.penalty.type = 'range';
    this.penalty.min = '0';
    this.penalty.max = '1';
    this.penalty.step = '0.05';
    this.penalty.value = '0.15';
    this.penaltyOut = element('output', 'slider-value', '0.15');
    this.penalty.addEventListener('input', () => {
      const value = Number.parseFloat(this.penalty.value);
      this.penaltyOut.textContent = value.toFixed(2);
      this.cb.onFitSettings({ penalty: value });
    });
    penaltyLabel.append(element('span', 'slider-name', 'Gain penalty'), this.penalty, this.penaltyOut);
    limitGrid.append(penaltyLabel);
    limits.append(limitGrid);
    fitSection.append(limits);

    const fitRow = element('div', 'fit-row');
    this.fitBtn = element('button', 'btn primary small', 'Auto-fit');
    this.fitBtn.type = 'button';
    this.fitBtn.addEventListener('click', () => this.cb.onFit());
    this.fitResult = element('div', 'fit-result');
    fitRow.append(this.fitBtn, this.fitResult);
    fitSection.append(fitRow);

    fitSection.append(
      element(
        'p',
        'note inline',
        'Fitted bands replace the current curve and stay fully editable. Ctrl+Z undoes the fit.',
      ),
    );

    container.append(targetSection, measureSection, fitSection);

    this.targetSelect.addEventListener('change', () => this.cb.onTarget(this.targetSelect.value));
    this.targetShow.addEventListener('change', () => this.cb.onToggleTarget(this.targetShow.checked));
  }

  update(view: MeasureView): void {
    this.syncTarget(view);
    this.syncMeasurement(view);
    this.syncFit(view);
  }

  private syncTarget(view: MeasureView): void {
    const options = new Set([...this.targetSelect.options].map((option) => option.value));
    if (view.customTarget && !options.has(TARGET_CUSTOM)) {
      this.targetSelect.append(this.option(TARGET_CUSTOM, view.customTarget.name));
    }
    if (view.targetId === TARGET_CUSTOM && view.customTarget) {
      const customOption = [...this.targetSelect.options].find((option) => option.value === TARGET_CUSTOM);
      if (customOption) customOption.textContent = view.customTarget.name;
    }

    this.targetSelect.value = view.targetId;
    this.targetShow.checked = view.showTarget;

    this.customRow.hidden = !(view.targetId === TARGET_CUSTOM && view.customTarget);
    if (view.customTarget) this.customName.textContent = view.customTarget.name;

    for (const slider of SLIDERS) {
      const control = this.sliders.get(slider.key);
      if (!control) continue;
      const value = view.adjust[slider.key];
      if (document.activeElement !== control.input) control.input.value = String(value);
      control.output.textContent = signed(value);
    }

    const targetLabel = targetName(view.targetId, view.customTarget);
    this.targetSelect.title = targetLabel;
  }

  private syncMeasurement(view: MeasureView): void {
    const measurement = view.measurement;
    this.measurementPresent = measurement !== null;
    this.empty.hidden = measurement !== null;
    this.loaded.hidden = measurement === null;

    if (view.notice) {
      this.noticeEl.textContent = view.notice;
      this.noticeEl.hidden = false;
    } else {
      this.noticeEl.hidden = true;
    }

    if (!measurement) return;

    this.measureName.textContent = measurement.name;
    this.measureMeta.textContent = `${measurement.points.length} points`;

    if (document.activeElement !== this.normalizeSelect) {
      this.normalizeSelect.value = measurement.normalize;
    }
    this.customHzField.hidden = measurement.normalize !== 'custom';
    if (document.activeElement !== this.customHz) {
      this.customHz.value = String(measurement.customHz ?? 1000);
    }
    if (document.activeElement !== this.smoothingSelect) {
      this.smoothingSelect.value = measurement.smoothing;
    }
    this.measureShow.checked = view.showMeasured;
  }

  private syncFit(view: MeasureView): void {
    if (document.activeElement !== this.countSelect) {
      this.countSelect.value = String(view.fit.count);
    }
    const setNumber = (input: HTMLInputElement, value: number) => {
      if (document.activeElement !== input) input.value = String(value);
    };
    setNumber(this.windowMin, view.fit.windowMin);
    setNumber(this.windowMax, view.fit.windowMax);
    setNumber(this.gainMin, view.fit.gainMin);
    setNumber(this.gainMax, view.fit.gainMax);
    setNumber(this.qMin, view.fit.qMin);
    setNumber(this.qMax, view.fit.qMax);
    if (document.activeElement !== this.penalty) this.penalty.value = String(view.fit.penalty);
    this.penaltyOut.textContent = view.fit.penalty.toFixed(2);

    const ready = this.measurementPresent && view.targetId !== TARGET_NONE;
    this.fitBtn.disabled = !ready;
    this.fitBtn.title = ready
      ? 'Fit bands to measured + EQ − target'
      : 'Load a measurement and pick a target first';

    if (view.liveRms !== null && ready) {
      const live = `now ${view.liveRms.toFixed(2)} dB`;
      this.fitResult.textContent = view.fitResult
        ? `Fit ${view.fitResult.before.toFixed(2)} → ${view.fitResult.after.toFixed(2)} dB · ${live}`
        : `Residual ${view.liveRms.toFixed(2)} dB RMS`;
      this.fitResult.title = 'Residual = measured + EQ − target, over the fit window';
      this.fitResult.hidden = false;
    } else if (view.fitResult) {
      this.fitResult.textContent = `Fit ${view.fitResult.before.toFixed(2)} → ${view.fitResult.after.toFixed(2)} dB`;
      this.fitResult.title = 'Residual error before → after the last fit';
      this.fitResult.hidden = false;
    } else {
      this.fitResult.hidden = true;
    }
  }

  private option(value: string, label: string): HTMLOptionElement {
    const option = element('option', undefined, label);
    option.value = value;
    return option;
  }

  private field(labelText: string, control: HTMLElement, extra = ''): HTMLLabelElement {
    const label = element('label', `field ${extra}`.trim());
    label.append(element('span', undefined, labelText), control);
    return label;
  }

  private numberInput(min: number, max: number, value: number, step = 1): HTMLInputElement {
    const input = element('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(value);
    return input;
  }
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}
