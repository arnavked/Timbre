import {
  ANC_LABELS,
  ANC_MODES,
  CONNECTION_LABELS,
  CONNECTIONS,
  deviceSummary,
  type AncMode,
  type Connection,
  type DeviceKey,
  type Profile,
} from '../model/profile';

export interface ProfileMeta {
  id: string | null;
  name: string;
  device: DeviceKey;
  dirty: boolean;
}

export interface ProfilePanelCallbacks {
  onMeta(patch: { name?: string; device?: Partial<DeviceKey> }): void;
  onSave(): void;
  onNew(): void;
  onDuplicate(): void;
  onDelete(id: string): void;
  onLoad(id: string): void;
  onImport(file: File): void;
  onExportText(): void;
  onExportJson(): void;
  onCopy(): void;
}

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

export class ProfilePanel {
  private readonly cb: ProfilePanelCallbacks;

  private readonly nameInput: HTMLInputElement;
  private readonly modelInput: HTMLInputElement;
  private readonly codecInput: HTMLInputElement;
  private readonly connectionSelect: HTMLSelectElement;
  private readonly ancSelect: HTMLSelectElement;

  private readonly saveBtn: HTMLButtonElement;
  private readonly deleteBtn: HTMLButtonElement;
  private readonly dirtyDot: HTMLElement;
  private readonly list: HTMLUListElement;
  private readonly count: HTMLElement;
  private readonly modelList: HTMLDataListElement;
  private readonly codecList: HTMLDataListElement;
  private readonly notice: HTMLElement;
  private readonly noticeText: HTMLElement;

  private activeId: string | null = null;
  private profiles: Profile[] = [];

  constructor(container: HTMLElement, callbacks: ProfilePanelCallbacks) {
    this.cb = callbacks;

    // --- notice -------------------------------------------------------------
    // Non-blocking banner, e.g. a profile tuned for a different connection.
    this.notice = element('div', 'notice');
    this.notice.hidden = true;
    this.notice.setAttribute('role', 'status');
    this.noticeText = element('span', 'notice-text');
    const dismiss = element('button', 'notice-dismiss', 'Dismiss');
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => this.hideNotice());
    this.notice.append(this.noticeText, dismiss);

    // --- identity -----------------------------------------------------------
    const identity = element('section', 'profile-section');
    identity.append(element('h3', undefined, 'Profile'));

    this.nameInput = element('input');
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 80;
    this.nameInput.placeholder = 'Untitled curve';
    this.nameInput.setAttribute('aria-label', 'Profile name');
    identity.append(this.field('Name', this.nameInput));

    this.modelInput = element('input');
    this.modelInput.type = 'text';
    this.modelInput.maxLength = 80;
    this.modelInput.placeholder = 'Sony WH-1000XM5';
    this.modelInput.setAttribute('list', 'device-models');
    this.modelInput.setAttribute('aria-label', 'Headphone model');

    this.connectionSelect = element('select');
    this.connectionSelect.setAttribute('aria-label', 'Connection');
    for (const value of CONNECTIONS) {
      const option = element('option', undefined, CONNECTION_LABELS[value]);
      option.value = value;
      this.connectionSelect.append(option);
    }

    this.codecInput = element('input');
    this.codecInput.type = 'text';
    this.codecInput.maxLength = 40;
    this.codecInput.placeholder = 'LDAC';
    this.codecInput.setAttribute('list', 'device-codecs');
    this.codecInput.setAttribute('aria-label', 'Bluetooth codec');

    this.ancSelect = element('select');
    this.ancSelect.setAttribute('aria-label', 'Noise cancelling');
    for (const value of ANC_MODES) {
      const option = element('option', undefined, ANC_LABELS[value]);
      option.value = value;
      this.ancSelect.append(option);
    }

    const grid = element('div', 'field-grid');
    grid.append(
      this.field('Model', this.modelInput, 'wide'),
      this.field('Connection', this.connectionSelect),
      this.field('Codec', this.codecInput),
      this.field('ANC', this.ancSelect),
    );
    identity.append(grid);

    this.modelList = element('datalist');
    this.modelList.id = 'device-models';
    this.codecList = element('datalist');
    this.codecList.id = 'device-codecs';
    identity.append(this.modelList, this.codecList);

    // --- actions ------------------------------------------------------------
    const actions = element('div', 'profile-actions');
    this.saveBtn = this.button('Save', 'primary');
    this.deleteBtn = this.button('Delete', 'danger');
    const newBtn = this.button('New');
    const duplicateBtn = this.button('Duplicate');
    this.dirtyDot = element('span', 'dirty-dot', 'unsaved');
    this.dirtyDot.hidden = true;

    actions.append(this.saveBtn, newBtn, duplicateBtn, this.deleteBtn, this.dirtyDot);
    identity.append(actions);

    // --- library ------------------------------------------------------------
    const library = element('section', 'profile-section');
    const head = element('div', 'section-head');
    head.append(element('h3', undefined, 'Library'));
    this.count = element('span', 'count', '0 saved');
    head.append(this.count);
    this.list = element('ul', 'profile-list');
    library.append(head, this.list);

    // --- import / export ----------------------------------------------------
    const io = element('section', 'profile-section');
    io.append(element('h3', undefined, 'Import / export'));
    const ioRow = element('div', 'io-row');
    const importBtn = this.button('Import…');
    const exportTextBtn = this.button('ParametricEQ.txt');
    const exportJsonBtn = this.button('JSON');
    const copyBtn = this.button('Copy');
    ioRow.append(importBtn, exportTextBtn, exportJsonBtn, copyBtn);

    const fileInput = element('input');
    fileInput.type = 'file';
    fileInput.accept = '.txt,.json,text/plain,application/json';
    fileInput.hidden = true;

    io.append(ioRow, fileInput);
    io.append(
      element(
        'p',
        'note inline',
        'Profiles stay in this browser. Export to move them to another device or into Equalizer APO, Peace, or Wavelet.',
      ),
    );

    container.append(this.notice, identity, library, io);

    // --- wiring -------------------------------------------------------------
    this.nameInput.addEventListener('input', () => this.cb.onMeta({ name: this.nameInput.value }));
    this.modelInput.addEventListener('input', () => this.cb.onMeta({ device: { model: this.modelInput.value } }));
    this.codecInput.addEventListener('input', () => this.cb.onMeta({ device: { codec: this.codecInput.value } }));
    this.connectionSelect.addEventListener('change', () =>
      this.cb.onMeta({ device: { connection: this.connectionSelect.value as Connection } }),
    );
    this.ancSelect.addEventListener('change', () =>
      this.cb.onMeta({ device: { anc: this.ancSelect.value as AncMode } }),
    );

    this.saveBtn.addEventListener('click', () => this.cb.onSave());
    newBtn.addEventListener('click', () => this.cb.onNew());
    duplicateBtn.addEventListener('click', () => this.cb.onDuplicate());
    this.deleteBtn.addEventListener('click', () => {
      if (this.activeId) this.cb.onDelete(this.activeId);
    });
    importBtn.addEventListener('click', () => fileInput.click());
    exportTextBtn.addEventListener('click', () => this.cb.onExportText());
    exportJsonBtn.addEventListener('click', () => this.cb.onExportJson());
    copyBtn.addEventListener('click', () => this.cb.onCopy());

    fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (file) this.cb.onImport(file);
      fileInput.value = '';
    });
  }

  showNotice(text: string): void {
    this.noticeText.textContent = text;
    this.notice.hidden = false;
  }

  hideNotice(): void {
    this.notice.hidden = true;
  }

  setMeta(meta: ProfileMeta): void {    this.activeId = meta.id;

    if (document.activeElement !== this.nameInput) {
      this.nameInput.value = meta.name;
    }
    if (document.activeElement !== this.modelInput) {
      this.modelInput.value = meta.device.model;
    }
    if (document.activeElement !== this.codecInput) {
      this.codecInput.value = meta.device.codec;
    }
    if (document.activeElement !== this.connectionSelect) {
      this.connectionSelect.value = meta.device.connection;
    }
    if (document.activeElement !== this.ancSelect) {
      this.ancSelect.value = meta.device.anc;
    }

    this.dirtyDot.hidden = !meta.dirty;
    this.deleteBtn.disabled = meta.id === null;
    this.highlightActive();
  }

  setProfiles(profiles: Profile[]): void {
    this.profiles = profiles;
    this.count.textContent = `${profiles.length} saved`;

    this.list.replaceChildren();

    if (profiles.length === 0) {
      this.list.append(element('li', 'empty', 'Nothing saved yet. Save a curve to keep it here.'));
    }

    for (const profile of profiles) {
      const item = element('li', 'profile-item');

      const load = element('button', 'profile-load');
      load.type = 'button';
      load.dataset.id = profile.id;
      load.title = `Load ${profile.name}`;

      const name = element('span', 'profile-name', profile.name);
      const meta = element(
        'span',
        'profile-meta',
        [profile.device.model.trim() || 'No model', deviceSummary(profile.device)].join(' — '),
      );
      load.append(name, meta);

      const remove = element('button', 'profile-remove', '×');
      remove.type = 'button';
      remove.title = `Delete ${profile.name}`;
      remove.setAttribute('aria-label', `Delete ${profile.name}`);

      load.addEventListener('click', () => this.cb.onLoad(profile.id));
      remove.addEventListener('click', () => this.cb.onDelete(profile.id));

      item.append(load, remove);
      item.dataset.id = profile.id;
      this.list.append(item);
    }

    this.refreshSuggestions();
    this.highlightActive();
  }

  private highlightActive(): void {
    for (const item of this.list.querySelectorAll<HTMLElement>('.profile-item')) {
      item.classList.toggle('active', item.dataset.id === this.activeId);
    }
  }

  private refreshSuggestions(): void {
    const models = new Set<string>();
    const codecs = new Set<string>();

    for (const profile of this.profiles) {
      if (profile.device.model.trim()) models.add(profile.device.model.trim());
      if (profile.device.codec.trim()) codecs.add(profile.device.codec.trim());
    }

    this.modelList.replaceChildren(
      ...[...models].map((value) => {
        const option = element('option');
        option.value = value;
        return option;
      }),
    );
    this.codecList.replaceChildren(
      ...[...codecs].map((value) => {
        const option = element('option');
        option.value = value;
        return option;
      }),
    );
  }

  private button(label: string, variant?: 'primary' | 'danger'): HTMLButtonElement {
    const button = element('button', 'btn small');
    button.type = 'button';
    button.textContent = label;
    if (variant) button.classList.add(variant);
    return button;
  }

  private field(labelText: string, control: HTMLElement, extra = ''): HTMLLabelElement {
    const label = element('label', `field ${extra}`.trim());
    label.append(element('span', undefined, labelText), control);
    return label;
  }
}
