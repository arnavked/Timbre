import {
  BAND_COLORS,
  FREQ_MAX,
  FREQ_MIN,
  GAIN_MAX,
  GAIN_MIN,
  Q_MAX,
  Q_MIN,
  clamp,
  parseNumber,
  type Band,
  type FilterType,
} from '../model/band';

export interface BandListCallbacks {
  onChange(id: number, patch: Partial<Omit<Band, 'id'>>): void;
  onSelect(id: number | null): void;
}

interface Row {
  root: HTMLElement;
  swatch: HTMLButtonElement;
  type: HTMLSelectElement;
  power: HTMLButtonElement;
  freq: HTMLInputElement;
  gain: HTMLInputElement;
  q: HTMLInputElement;
}

const TYPE_LABEL: Record<FilterType, string> = {
  peaking: 'Peak',
  lowshelf: 'Low shelf',
  highshelf: 'High shelf',
};

export class BandList {
  private readonly rows: Row[] = [];
  private readonly cb: BandListCallbacks;
  private bands: Band[] = [];
  private selectedId: number | null = null;

  constructor(container: HTMLElement, bands: Band[], callbacks: BandListCallbacks) {
    this.cb = callbacks;
    this.bands = bands;

    for (const band of bands) {
      const row = this.buildRow(band);
      this.rows.push(row);
      container.append(row.root);
    }

    this.update(bands);
  }

  update(bands: Band[]): void {
    this.bands = bands;

    bands.forEach((band, index) => {
      const row = this.rows[index];
      if (!row) return;

      const color = BAND_COLORS[band.id % BAND_COLORS.length];
      row.swatch.style.color = color;
      row.root.classList.toggle('selected', band.id === this.selectedId);
      row.root.classList.toggle('disabled', !band.enabled);

      row.type.value = band.type;
      row.power.setAttribute('aria-pressed', String(band.enabled));
      row.power.setAttribute('aria-label', `${band.enabled ? 'Disable' : 'Enable'} band ${band.id + 1}`);

      const isPeak = band.type === 'peaking';
      row.q.disabled = !isPeak;

      if (document.activeElement !== row.freq) {
        row.freq.value = String(Math.round(band.freq));
      }
      if (document.activeElement !== row.gain) {
        row.gain.value = band.gain.toFixed(1);
      }
      if (document.activeElement !== row.q) {
        row.q.value = band.q.toFixed(2);
      }
    });
  }

  setSelected(id: number | null): void {
    this.selectedId = id;
    this.rows.forEach((row, index) => {
      const band = this.bands[index];
      if (!band) return;
      row.root.classList.toggle('selected', band.id === id);
    });
  }

  private buildRow(band: Band): Row {
    const root = document.createElement('div');
    root.className = 'band';
    root.dataset.id = String(band.id);

    root.innerHTML = `
      <button class="swatch" type="button" aria-label="Select band"></button>
      <select class="type" aria-label="Filter type">
        <option value="peaking">${TYPE_LABEL.peaking}</option>
        <option value="lowshelf">${TYPE_LABEL.lowshelf}</option>
        <option value="highshelf">${TYPE_LABEL.highshelf}</option>
      </select>
      <button class="power" type="button" aria-pressed="true" aria-label="Enable band"></button>
      <div class="fields">
        <label><span>Freq</span><input class="freq" type="number" inputmode="decimal" min="${FREQ_MIN}" max="${FREQ_MAX}" step="1" /></label>
        <label><span>Gain</span><input class="gain" type="number" inputmode="decimal" min="${GAIN_MIN}" max="${GAIN_MAX}" step="0.1" /></label>
        <label><span>Q</span><input class="q" type="number" inputmode="decimal" min="${Q_MIN}" max="${Q_MAX}" step="0.01" /></label>
      </div>
    `;

    const swatch = root.querySelector<HTMLButtonElement>('.swatch');
    const type = root.querySelector<HTMLSelectElement>('.type');
    const power = root.querySelector<HTMLButtonElement>('.power');
    const freq = root.querySelector<HTMLInputElement>('.freq');
    const gain = root.querySelector<HTMLInputElement>('.gain');
    const q = root.querySelector<HTMLInputElement>('.q');

    if (!swatch || !type || !power || !freq || !gain || !q) {
      throw new Error('Failed to build band row');
    }

    const id = band.id;

    swatch.addEventListener('click', () => this.cb.onSelect(id));
    type.addEventListener('change', () => {
      this.cb.onChange(id, { type: type.value as FilterType });
    });
    power.addEventListener('click', () => {
      const current = this.bands.find((b) => b.id === id);
      this.cb.onChange(id, { enabled: !(current?.enabled ?? true) });
    });

    const bindNumber = (
      input: HTMLInputElement,
      apply: (value: number) => Partial<Omit<Band, 'id'>>,
    ) => {
      const commit = () => {
        const parsed = parseNumber(input.value);
        if (parsed === null) {
          this.update(this.bands);
          return;
        }
        this.cb.onChange(id, apply(parsed));
      };
      input.addEventListener('change', commit);
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          input.blur();
        }
      });
    };

    bindNumber(freq, (value) => ({ freq: clamp(value, FREQ_MIN, FREQ_MAX) }));
    bindNumber(gain, (value) => ({ gain: clamp(value, GAIN_MIN, GAIN_MAX) }));
    bindNumber(q, (value) => ({ q: clamp(value, Q_MIN, Q_MAX) }));

    return { root, swatch, type, power, freq, gain, q };
  }
}
