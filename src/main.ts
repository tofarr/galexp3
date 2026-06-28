/**
 * Application entry point.
 *
 * Iter 1a — UI shell with menu + game views.
 *
 * This file is glue between src/sim/galaxy and the DOM. It is intentionally
 * not part of the spec; UI flow is verified by manual browser checks until
 * the UI grows complex enough to warrant Quint coverage.
 *
 * View routing (in-file state machine):
 *
 *   ┌─────────┐  New Game    ┌─────────┐
 *   │  menu   │  Load Game   │  game   │
 *   │  view   │ ───────────▶ │  view   │
 *   └─────────┘              └────┬────┘
 *      ▲                         │
 *      └─────── Back to menu ◀───┘
 */

import {
  GALAXY_SIZES,
  GalaxySize,
  RADIUS_FOR_SIZE,
  STAR_COUNT_FOR_SIZE,
  initGalaxy,
  isValidGalaxy,
} from '@sim/galaxy';

type AppView = 'menu' | 'game';

const menuView = document.getElementById('menu-view') as HTMLElement;
const gameView = document.getElementById('game-view') as HTMLElement;
const backLink = document.getElementById('back-link') as HTMLAnchorElement;
const headerSubtitle = document.getElementById('header-subtitle') as HTMLElement;

const newGameBtn = document.getElementById('new-game-btn') as HTMLButtonElement;
const loadGameBtn = document.getElementById('load-game-btn') as HTMLButtonElement;

const sizeSelect = document.getElementById('size-select') as HTMLSelectElement;
const seedInput = document.getElementById('seed-input') as HTMLInputElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const randomSeedBtn = document.getElementById('random-seed-btn') as HTMLButtonElement;
const statCount = document.getElementById('stat-count')!.querySelector('b')!;
const statRadius = document.getElementById('stat-radius')!.querySelector('b')!;
const statValid = document.getElementById('stat-valid')!.querySelector('b')!;
const jsonOut = document.getElementById('galaxy-json') as HTMLPreElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

const requiredElements = {
  menuView, gameView, backLink, headerSubtitle,
  newGameBtn, loadGameBtn,
  sizeSelect, seedInput, generateBtn, randomSeedBtn,
  statCount, statRadius, statValid, jsonOut, statusEl,
};
for (const [name, el] of Object.entries(requiredElements)) {
  if (!el) throw new Error(`main.ts: required DOM element missing: ${name}`);
}

let currentView: AppView = 'menu';

function showView(view: AppView): void {
  currentView = view;
  if (view === 'menu') {
    menuView.classList.remove('hidden');
    gameView.classList.add('hidden');
    backLink.classList.add('hidden');
    headerSubtitle.textContent = 'Iteration 1a — galaxy data model';
  } else {
    menuView.classList.add('hidden');
    gameView.classList.remove('hidden');
    backLink.classList.remove('hidden');
    headerSubtitle.textContent = 'Iteration 1a — game view';
  }
}

function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

function isGalaxySize(v: string): v is GalaxySize {
  return (GALAXY_SIZES as readonly string[]).includes(v);
}

function generateGalaxyInView(): void {
  const sizeRaw = sizeSelect.value;
  if (!isGalaxySize(sizeRaw)) {
    setStatus(`Invalid galaxy size: ${sizeRaw}`, 'err');
    return;
  }
  const size: GalaxySize = sizeRaw;
  const seed = Number.parseInt(seedInput.value, 10);
  if (!Number.isFinite(seed)) {
    setStatus('Seed must be an integer.', 'err');
    return;
  }

  try {
    const galaxy = initGalaxy(seed, size);
    const valid = isValidGalaxy(galaxy);

    statCount.textContent = String(galaxy.stars.length);
    statRadius.textContent = String(galaxy.radius);
    statValid.textContent = String(valid);

    const summary = {
      size: galaxy.size,
      radius: galaxy.radius,
      starCount: galaxy.stars.length,
      expectedCount: STAR_COUNT_FOR_SIZE[size],
      expectedRadius: RADIUS_FOR_SIZE[size],
      isValidGalaxy: valid,
      seed,
      firstFiveStars: galaxy.stars.slice(0, 5),
      lastStar: galaxy.stars[galaxy.stars.length - 1],
    };
    jsonOut.textContent = JSON.stringify(summary, null, 2);

    setStatus(
      valid
        ? `Generated ${galaxy.stars.length}-star ${size} galaxy (seed=${seed}). isValidGalaxy: true.`
        : `Generated galaxy FAILS isValidGalaxy — check console.`,
      valid ? 'ok' : 'err',
    );
    if (!valid) {
      console.error('Invalid galaxy produced:', galaxy);
    } else {
      console.log('Generated galaxy:', galaxy);
    }
  } catch (err) {
    setStatus(`Generation failed: ${(err as Error).message}`, 'err');
    console.error(err);
  }
}

// ---- Menu → Game transitions ----

function startNewGame(): void {
  showView('game');
  // Seed 42 / Large is a friendly default for a "first look" galaxy.
  sizeSelect.value = 'Large';
  seedInput.value = '42';
  generateGalaxyInView();
  setStatus('New game started. (Save/load not yet implemented.)', 'ok');
}

function startLoadGame(): void {
  // Persistence layer (Iter 2) will replace this body. For now we surface
  // the fact that load is a stub and drop the user into a demo galaxy.
  showView('game');
  sizeSelect.value = 'Large';
  seedInput.value = '42';
  generateGalaxyInView();
  setStatus('Load Game: no saved games yet. Showing demo galaxy.', '');
  console.warn('[galexp3] Load Game pressed — save/load not yet implemented.');
}

function backToMenu(): void {
  showView('menu');
}

newGameBtn.addEventListener('click', startNewGame);
loadGameBtn.addEventListener('click', startLoadGame);
backLink.addEventListener('click', (e) => {
  e.preventDefault();
  backToMenu();
});

generateBtn.addEventListener('click', generateGalaxyInView);
randomSeedBtn.addEventListener('click', () => {
  seedInput.value = String(Math.floor(Math.random() * 0x7fffffff) | 0);
  generateGalaxyInView();
});
sizeSelect.addEventListener('change', generateGalaxyInView);
seedInput.addEventListener('change', generateGalaxyInView);

// Initial view: menu.
showView('menu');
setStatus('Ready.', '');