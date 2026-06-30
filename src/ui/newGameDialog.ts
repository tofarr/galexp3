/**
 * New Game setup dialog.
 *
 * Opens as a modal-ish overlay above the main menu when the user
 * clicks "New Game". Lets the player pick a galaxy size and seed,
 * then fires an onStart callback and dismisses itself. Backdrop
 * click and Escape both close the dialog without starting.
 *
 * The dialog is self-contained: it injects its own <style> tag
 * (matching the menu-card aesthetic) and creates its DOM on the
 * first open. The host element is supplied by the caller — by
 * default we mount into a dedicated element in the menu view so
 * the modal sits above the menu card but is hidden when the game
 * view is active.
 *
 * The dialog does not own generation — it just reports the chosen
 * (size, seed) pair. The caller wires `onStart` to whatever it
 * uses to actually create the galaxy.
 */

import { GALAXY_SIZES, STAR_COUNT_FOR_SIZE, type GalaxySize } from '../sim/galaxy';

export interface NewGameChoice {
  readonly size: GalaxySize;
  readonly seed: number;
}

export interface NewGameDialog {
  open(defaults?: Partial<NewGameChoice>): void;
  close(): void;
  onStart(handler: (choice: NewGameChoice) => void): void;
}

// ---------------------------------------------------------------------------
// Styling (mirrors the menu-card palette)
// ---------------------------------------------------------------------------

const STYLE_ID = 'new-game-dialog-styles';

const CSS = `
  .ngd-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: rgba(2, 3, 10, 0.72);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: ngd-fade-in 140ms ease-out;
  }
  @keyframes ngd-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  .ngd-card {
    position: relative;
    max-width: 460px;
    width: 100%;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 28px 32px 24px;
    color: var(--fg);
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
    animation: ngd-pop-in 160ms ease-out;
  }
  @keyframes ngd-pop-in {
    from { opacity: 0; transform: translateY(8px) scale(0.98); }
    to   { opacity: 1; transform: translateY(0)   scale(1.00); }
  }
  .ngd-card h2 {
    margin: 0 0 4px;
    font-size: 20px;
    font-weight: 600;
    letter-spacing: 0.06em;
    background: linear-gradient(180deg, #d6e6ff 0%, #6fb8ff 100%);
    -webkit-background-clip: text;
    background-clip: text;
    color: transparent;
  }
  .ngd-card .ngd-sub {
    color: var(--muted);
    font-size: 12px;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    margin-bottom: 22px;
  }
  .ngd-field {
    margin-bottom: 18px;
  }
  .ngd-field > label {
    display: block;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 8px;
  }
  .ngd-sizes {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }
  .ngd-sizes label {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 10px 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
  }
  .ngd-sizes label:hover { border-color: var(--accent); }
  .ngd-sizes input { display: none; }
  .ngd-sizes input:checked + .ngd-size-body {
    color: var(--accent);
  }
  .ngd-sizes label:has(input:checked) {
    border-color: var(--accent);
    background: rgba(111, 184, 255, 0.06);
  }
  .ngd-size-body { display: flex; flex-direction: column; gap: 2px; }
  .ngd-size-name { font-size: 14px; font-weight: 500; letter-spacing: 0.03em; }
  .ngd-size-hint { font-size: 11px; color: var(--muted); }
  .ngd-seed-row {
    display: flex;
    gap: 8px;
    align-items: stretch;
  }
  .ngd-seed-row input {
    flex: 1;
    background: var(--panel-2);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 8px 10px;
    border-radius: 4px;
    font-size: 14px;
    font-family: ui-monospace, "SF Mono", monospace;
    outline: none;
    transition: border-color 120ms ease;
  }
  .ngd-seed-row input:focus { border-color: var(--accent); }
  .ngd-seed-row button {
    background: var(--panel-2);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 8px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    letter-spacing: 0.04em;
    white-space: nowrap;
  }
  .ngd-seed-row button:hover { border-color: var(--accent); color: var(--accent); }
  .ngd-error {
    min-height: 16px;
    color: #ff7b7b;
    font-size: 12px;
    margin-top: -8px;
    margin-bottom: 12px;
  }
  .ngd-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 22px;
  }
  .ngd-actions button {
    background: var(--panel-2);
    color: var(--fg);
    border: 1px solid var(--border);
    padding: 10px 22px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.04em;
    transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
  }
  .ngd-actions button:hover { border-color: var(--accent); color: var(--accent); }
  .ngd-actions .ngd-primary {
    background: linear-gradient(180deg, #1c3a66 0%, #0f1f3a 100%);
    border-color: var(--accent);
    color: var(--accent);
  }
  .ngd-actions .ngd-primary:hover {
    background: linear-gradient(180deg, #2a4d80 0%, #14284a 100%);
  }
`;

function injectStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// DOM construction
// ---------------------------------------------------------------------------

function buildSizeOption(size: GalaxySize): HTMLLabelElement {
  const label = document.createElement('label');
  label.className = 'ngd-size-option';

  const input = document.createElement('input');
  input.type = 'radio';
  input.name = 'ngd-size';
  input.value = size;
  input.dataset.role = 'size';

  const body = document.createElement('span');
  body.className = 'ngd-size-body';

  const name = document.createElement('span');
  name.className = 'ngd-size-name';
  name.textContent = size;

  const hint = document.createElement('span');
  hint.className = 'ngd-size-hint';
  hint.textContent = `${STAR_COUNT_FOR_SIZE[size]} stars`;

  body.appendChild(name);
  body.appendChild(hint);
  label.appendChild(input);
  label.appendChild(body);
  return label;
}

function buildBackdrop(): HTMLDivElement {
  const backdrop = document.createElement('div');
  backdrop.className = 'ngd-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const card = document.createElement('div');
  card.className = 'ngd-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-labelledby', 'ngd-title');

  const h2 = document.createElement('h2');
  h2.id = 'ngd-title';
  h2.textContent = 'New Game';
  card.appendChild(h2);

  const sub = document.createElement('div');
  sub.className = 'ngd-sub';
  sub.textContent = 'Configure your galaxy';
  card.appendChild(sub);

  // Galaxy size field
  const sizeField = document.createElement('div');
  sizeField.className = 'ngd-field';
  const sizeLabel = document.createElement('label');
  sizeLabel.textContent = 'Galaxy size';
  const sizes = document.createElement('div');
  sizes.className = 'ngd-sizes';
  for (const size of GALAXY_SIZES) {
    sizes.appendChild(buildSizeOption(size));
  }
  sizeField.appendChild(sizeLabel);
  sizeField.appendChild(sizes);
  card.appendChild(sizeField);

  // Seed field
  const seedField = document.createElement('div');
  seedField.className = 'ngd-field';
  const seedLabel = document.createElement('label');
  seedLabel.htmlFor = 'ngd-seed-input';
  seedLabel.textContent = 'Seed';
  const seedRow = document.createElement('div');
  seedRow.className = 'ngd-seed-row';
  const seedInput = document.createElement('input');
  seedInput.id = 'ngd-seed-input';
  seedInput.type = 'number';
  seedInput.value = '42';
  seedInput.dataset.role = 'seed';
  const randomBtn = document.createElement('button');
  randomBtn.type = 'button';
  randomBtn.dataset.role = 'random';
  randomBtn.textContent = 'Random';
  seedRow.appendChild(seedInput);
  seedRow.appendChild(randomBtn);
  seedField.appendChild(seedLabel);
  seedField.appendChild(seedRow);
  card.appendChild(seedField);

  // Error slot
  const error = document.createElement('div');
  error.className = 'ngd-error';
  error.dataset.role = 'error';
  card.appendChild(error);

  // Actions
  const actions = document.createElement('div');
  actions.className = 'ngd-actions';
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.dataset.role = 'cancel';
  cancelBtn.textContent = 'Cancel';
  const startBtn = document.createElement('button');
  startBtn.type = 'button';
  startBtn.className = 'ngd-primary';
  startBtn.dataset.role = 'start';
  startBtn.textContent = 'Start';
  actions.appendChild(cancelBtn);
  actions.appendChild(startBtn);
  card.appendChild(actions);

  backdrop.appendChild(card);
  return backdrop;
}

// ---------------------------------------------------------------------------
// Public mount
// ---------------------------------------------------------------------------

/**
 * Mount the dialog into the given host element. The host stays in
 * the DOM permanently; the dialog itself is created on first open
 * and torn down on close (so each open gets fresh defaults and
 * clean state).
 */
export function mountNewGameDialog(host: HTMLElement): NewGameDialog {
  injectStyles();

  let onStartHandler: ((choice: NewGameChoice) => void) | null = null;
  let current: HTMLDivElement | null = null;
  let escListener: ((e: KeyboardEvent) => void) | null = null;

  function close(): void {
    if (!current) return;
    current.remove();
    current = null;
    if (escListener) {
      document.removeEventListener('keydown', escListener);
      escListener = null;
    }
  }

  function pickRandomSeed(): number {
    // 31-bit signed; matches the existing menu "Random seed" button.
    return Math.floor(Math.random() * 0x7fffffff) | 0;
  }

  function readChoice(backdrop: HTMLDivElement): NewGameChoice | null {
    const checked = backdrop.querySelector<HTMLInputElement>(
      'input[name="ngd-size"]:checked',
    );
    const seedInput = backdrop.querySelector<HTMLInputElement>('input[data-role="seed"]');
    const errorEl = backdrop.querySelector<HTMLDivElement>('div[data-role="error"]');
    if (!checked || !seedInput || !errorEl) return null;

    const raw = seedInput.value.trim();
    const seed = Number.parseInt(raw, 10);
    if (!Number.isFinite(seed)) {
      errorEl.textContent = 'Seed must be an integer.';
      return null;
    }
    if (!GALAXY_SIZES.includes(checked.value as GalaxySize)) {
      errorEl.textContent = 'Pick a galaxy size.';
      return null;
    }
    return { size: checked.value as GalaxySize, seed };
  }

  function open(defaults?: Partial<NewGameChoice>): void {
    close();
    const backdrop = buildBackdrop();
    current = backdrop;

    // Apply defaults (defaults override build defaults).
    const seedInput = backdrop.querySelector<HTMLInputElement>('input[data-role="seed"]')!;
    const defaultSize = defaults?.size ?? 'Large';
    const defaultSeed = defaults?.seed ?? 42;
    seedInput.value = String(defaultSeed);
    const sizeInput = backdrop.querySelector<HTMLInputElement>(
      `input[name="ngd-size"][value="${defaultSize}"]`,
    );
    if (sizeInput) sizeInput.checked = true;

    // Wire interactions.
    const randomBtn = backdrop.querySelector<HTMLButtonElement>('button[data-role="random"]')!;
    const cancelBtn = backdrop.querySelector<HTMLButtonElement>('button[data-role="cancel"]')!;
    const startBtn = backdrop.querySelector<HTMLButtonElement>('button.ngd-primary')!;
    const errorEl = backdrop.querySelector<HTMLDivElement>('div[data-role="error"]')!;

    randomBtn.addEventListener('click', () => {
      seedInput.value = String(pickRandomSeed());
      errorEl.textContent = '';
    });
    cancelBtn.addEventListener('click', close);
    backdrop.addEventListener('click', (ev) => {
      // Click on the backdrop (outside the card) closes.
      if (ev.target === backdrop) close();
    });
    startBtn.addEventListener('click', () => {
      const choice = readChoice(backdrop);
      if (!choice) return;
      close();
      onStartHandler?.(choice);
    });
    seedInput.addEventListener('input', () => {
      errorEl.textContent = '';
    });

    // Escape closes.
    escListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', escListener);

    host.appendChild(backdrop);
    seedInput.focus();
    seedInput.select();
  }

  function onStart(handler: (choice: NewGameChoice) => void): void {
    onStartHandler = handler;
  }

  return { open, close, onStart };
}