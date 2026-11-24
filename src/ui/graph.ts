import { biquad, magnitudeDb } from '../audio/dsp';
import {
  BAND_COLORS,
  FREQ_MAX,
  FREQ_MIN,
  GAIN_MAX,
  GAIN_MIN,
  Q_MAX,
  Q_MIN,
  clamp,
  formatHz,
  isPassType,
  type Band,
} from '../model/band';

const DB_MIN = -24;
const DB_MAX = 24;
const POINTS = 360;

const GRID_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
const GRID_DB = [-24, -18, -12, -6, 0, 6, 12, 18, 24];

export type BandPatch = Partial<Pick<Band, 'freq' | 'gain' | 'q'>>;

export interface GraphCallbacks {
  onChange(id: number, patch: BandPatch): void;
  onSelect(id: number | null): void;
  onDragStart(): void;
  onDragEnd(): void;
  onInteract(): void;
}

interface Point {
  x: number;
  y: number;
}

export class EQGraph {
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly cb: GraphCallbacks;
  private readonly pad = { left: 42, right: 16, top: 16, bottom: 26 };

  private bands: Band[] = [];
  private sampleRate = 48000;
  private selectedId: number | null = null;
  private dragId: number | null = null;
  private hoverId: number | null = null;
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement, callbacks: GraphCallbacks) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    this.canvas = canvas;
    this.g = ctx;
    this.cb = callbacks;

    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('pointerleave', this.onPointerLeave);

    this.resize();
  }

  setBands(bands: Band[]): void {
    this.bands = bands;
    this.draw();
  }

  setSampleRate(rate: number): void {
    this.sampleRate = rate;
    this.draw();
  }

  setSelected(id: number | null): void {
    this.selectedId = id;
    this.draw();
  }

  // ---------------------------------------------------------------- geometry

  private get plotWidth(): number {
    return Math.max(1, this.width - this.pad.left - this.pad.right);
  }

  private get plotHeight(): number {
    return Math.max(1, this.height - this.pad.top - this.pad.bottom);
  }

  private freqToX(freq: number): number {
    const t = Math.log(freq / FREQ_MIN) / Math.log(FREQ_MAX / FREQ_MIN);
    return this.pad.left + t * this.plotWidth;
  }

  private xToFreq(x: number): number {
    const t = (x - this.pad.left) / this.plotWidth;
    return FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
  }

  private dbToY(db: number): number {
    const t = (db - DB_MIN) / (DB_MAX - DB_MIN);
    return this.pad.top + (1 - t) * this.plotHeight;
  }

  private yToDb(y: number): number {
    const t = 1 - (y - this.pad.top) / this.plotHeight;
    return DB_MIN + t * (DB_MAX - DB_MIN);
  }

  private yToQ(y: number): number {
    const t = clamp((y - this.pad.top) / this.plotHeight, 0, 1);
    return Q_MIN * Math.pow(Q_MAX / Q_MIN, 1 - t);
  }

  private handlePoint(band: Band): Point {
    const y = isPassType(band.type) ? this.dbToY(0) : this.dbToY(band.gain);
    return { x: this.freqToX(band.freq), y };
  }

  // ----------------------------------------------------------------- drawing

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.canvas.width = Math.round(this.width * dpr);
    this.canvas.height = Math.round(this.height * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  draw(): void {
    const g = this.g;
    if (this.width === 0 || this.height === 0) return;

    g.clearRect(0, 0, this.width, this.height);
    this.drawGrid(g);
    this.drawBandCurves(g);
    this.drawCombined(g);
    this.drawHandles(g);
    this.drawDragLabel(g);
  }

  private drawGrid(g: CanvasRenderingContext2D): void {
    const { left, top } = this.pad;

    g.save();
    g.font = '10px ui-monospace, "SF Mono", Consolas, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'top';

    for (const freq of GRID_FREQS) {
      const x = Math.round(this.freqToX(freq)) + 0.5;
      g.strokeStyle = freq === 1000 ? '#2a3038' : '#1c2027';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, top);
      g.lineTo(x, top + this.plotHeight);
      g.stroke();

      g.fillStyle = '#5c636e';
      g.fillText(this.gridLabel(freq), x, top + this.plotHeight + 8);
    }

    g.textAlign = 'right';
    g.textBaseline = 'middle';
    for (const db of GRID_DB) {
      const y = Math.round(this.dbToY(db)) + 0.5;
      const isZero = db === 0;

      g.strokeStyle = isZero ? '#2e353f' : '#1c2027';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(left, y);
      g.lineTo(left + this.plotWidth, y);
      g.stroke();

      g.fillStyle = isZero ? '#8a929e' : '#4d545e';
      g.fillText(isZero ? '0' : `${db > 0 ? '+' : ''}${db}`, left - 8, y);
    }

    g.restore();
  }

  private gridLabel(freq: number): string {
    if (freq >= 1000) return `${freq / 1000}k`;
    return String(freq);
  }

  private sampleFrequencies(): number[] {
    const freqs = new Array<number>(POINTS);
    for (let i = 0; i < POINTS; i++) {
      const t = i / (POINTS - 1);
      freqs[i] = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
    }
    return freqs;
  }

  private drawBandCurves(g: CanvasRenderingContext2D): void {
    const freqs = this.sampleFrequencies();

    for (const band of this.bands) {
      if (!band.enabled) continue;
      const color = BAND_COLORS[band.id % BAND_COLORS.length];
      const coeffs = biquad(band.type, band.freq, band.gain, band.q, this.sampleRate, band.slope);

      g.beginPath();
      for (let i = 0; i < freqs.length; i++) {
        const x = this.freqToX(freqs[i]);
        const y = this.dbToY(clamp(magnitudeDb(coeffs, freqs[i], this.sampleRate), DB_MIN, DB_MAX));
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = color;
      g.globalAlpha = this.selectedId === null || this.selectedId === band.id ? 0.32 : 0.14;
      g.lineWidth = 1;
      g.stroke();
    }

    g.globalAlpha = 1;
  }

  private drawCombined(g: CanvasRenderingContext2D): void {
    const freqs = this.sampleFrequencies();
    const coeffs = this.bands
      .filter((band) => band.enabled)
      .map((band) => biquad(band.type, band.freq, band.gain, band.q, this.sampleRate, band.slope));

    const points: Point[] = [];
    for (const freq of freqs) {
      let db = 0;
      for (const c of coeffs) db += magnitudeDb(c, freq, this.sampleRate);
      points.push({ x: this.freqToX(freq), y: this.dbToY(clamp(db, DB_MIN, DB_MAX)) });
    }

    // Soft glow under the curve.
    g.save();
    g.beginPath();
    g.moveTo(points[0].x, this.dbToY(0));
    for (const point of points) g.lineTo(point.x, point.y);
    g.lineTo(points[points.length - 1].x, this.dbToY(0));
    g.closePath();
    g.fillStyle = 'rgba(232, 180, 74, 0.07)';
    g.fill();
    g.restore();

    g.beginPath();
    points.forEach((point, i) => (i === 0 ? g.moveTo(point.x, point.y) : g.lineTo(point.x, point.y)));
    g.strokeStyle = '#e8b44a';
    g.lineWidth = 2.25;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.shadowColor = 'rgba(232, 180, 74, 0.45)';
    g.shadowBlur = 10;
    g.stroke();
    g.shadowBlur = 0;
  }

  private drawHandles(g: CanvasRenderingContext2D): void {
    for (const band of this.bands) {
      const color = BAND_COLORS[band.id % BAND_COLORS.length];
      const { x, y } = this.handlePoint(band);
      const isSelected = this.selectedId === band.id;
      const isHovered = this.hoverId === band.id;
      const radius = isSelected ? 7 : 5.5;

      g.beginPath();
      g.arc(x, y, radius + 4, 0, Math.PI * 2);
      g.fillStyle = isSelected ? 'rgba(232, 180, 74, 0.12)' : 'rgba(255,255,255,0.03)';
      g.fill();

      g.beginPath();
      g.arc(x, y, radius, 0, Math.PI * 2);
      g.fillStyle = band.enabled ? color : '#121417';
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = band.enabled ? (isSelected ? '#ffffff' : 'rgba(0,0,0,0.55)') : color;
      g.stroke();

      if (isHovered || isSelected) {
        g.beginPath();
        g.arc(x, y, radius + 4, 0, Math.PI * 2);
        g.strokeStyle = 'rgba(255,255,255,0.18)';
        g.lineWidth = 1;
        g.stroke();
      }
    }
  }

  private drawDragLabel(g: CanvasRenderingContext2D): void {
    if (this.dragId === null) return;
    const band = this.bands.find((candidate) => candidate.id === this.dragId);
    if (!band) return;

    const { x, y } = this.handlePoint(band);
    const detail = isPassType(band.type)
      ? `Q ${band.q.toFixed(2)}`
      : `${band.gain >= 0 ? '+' : ''}${band.gain.toFixed(1)} dB`;
    const text = `${formatHz(band.freq)}   ${detail}`;

    g.save();
    g.font = '11px ui-monospace, "SF Mono", Consolas, monospace';
    const w = g.measureText(text).width + 14;
    const h = 22;
    const bx = clamp(x - w / 2, this.pad.left, this.width - this.pad.right - w);
    const by = clamp(y - h - 14, this.pad.top, this.height - this.pad.bottom - h);

    g.fillStyle = 'rgba(12, 14, 17, 0.94)';
    g.strokeStyle = '#2e353f';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(bx, by, w, h, 6);
    g.fill();
    g.stroke();

    g.fillStyle = '#e6e8ec';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, bx + w / 2, by + h / 2 + 0.5);
    g.restore();
  }

  // --------------------------------------------------------------- pointers

  private localPoint(event: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private hitTest(point: Point): Band | null {
    let best: Band | null = null;
    let bestDistance = 18;

    for (const band of this.bands) {
      const handle = this.handlePoint(band);
      const distance = Math.hypot(handle.x - point.x, handle.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = band;
      }
    }

    return best;
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    const point = this.localPoint(event);
    const band = this.hitTest(point);

    if (!band) {
      this.cb.onSelect(null);
      return;
    }

    event.preventDefault();
    try {
      this.canvas.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointer; dragging still works without capture.
    }

    this.dragId = band.id;
    this.cb.onSelect(band.id);
    this.cb.onDragStart();
    this.cb.onInteract();
    this.draw();
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const point = this.localPoint(event);

    if (this.dragId === null) {
      const band = this.hitTest(point);
      const nextHover = band ? band.id : null;
      this.canvas.style.cursor = band ? 'grab' : 'crosshair';
      if (nextHover !== this.hoverId) {
        this.hoverId = nextHover;
        this.draw();
      }
      return;
    }

    this.canvas.style.cursor = 'grabbing';
    const band = this.bands.find((candidate) => candidate.id === this.dragId);
    if (!band) return;

    const freq = clamp(this.xToFreq(point.x), FREQ_MIN, FREQ_MAX);

    if (isPassType(band.type)) {
      this.cb.onChange(band.id, { freq, q: clamp(this.yToQ(point.y), Q_MIN, Q_MAX) });
    } else {
      const gain = clamp(this.yToDb(point.y), GAIN_MIN, GAIN_MAX);
      this.cb.onChange(band.id, { freq, gain });
    }
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.dragId === null) return;
    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }
    this.dragId = null;
    this.canvas.style.cursor = 'crosshair';
    this.cb.onDragEnd();
    this.draw();
  };

  private readonly onPointerLeave = (): void => {
    if (this.dragId !== null) return;
    if (this.hoverId !== null) {
      this.hoverId = null;
      this.draw();
    }
  };
}
