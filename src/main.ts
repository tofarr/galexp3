/**
 * Application entry point.
 *
 * Iter 1b — galaxy data model + menu (kept from 1a) plus the star
 * map view (PixiJS renderer + side panel + camera + selection).
 *
 * View routing (in-file state machine):
 *
 *   ┌─────────┐  New Game    ┌─────────┐
 *   │  menu   │  Load Game   │  game   │
 *   │  view   │ ───────────▶ │  view   │
 *   └─────────┘              └────┬────┘
 *      ▲                         │
 *      └─────── Back to menu ◀───┘
 *
 * The game view mounts:
 *   - A PixiJS starmap renderer in #starmap-canvas.
 *   - A side panel (CSS-driven slide-in) in #sidepanel-host.
 *   - Click handlers on the canvas that hit-test against the
 *     pure sim layer in src/sim/starmap.ts.
 *   - Zoom in/out and clear-selection buttons.
 */

import {
  GALAXY_SIZES,
  GalaxySize,
  RADIUS_FOR_SIZE,
  STAR_COUNT_FOR_SIZE,
  initGalaxy,
  isValidGalaxy,
  type Galaxy,
} from '@sim/galaxy';
import {
  ZOOM_DENOMINATOR,
  clearSelection,
  initialState as initialStarmap,
  isValidState,
  NO_SELECTION,
  selectStar,
  starAtPoint,
  zoomCameraAround,
  type StarmapState,
} from '@sim/starmap';
import { mountMenuBackground, type MenuBackground } from './ui/menuBackground';
import { mountStarmap, type StarmapRenderer } from './ui/starmap';
import { mountSidePanel, type SidePanel } from './ui/sidepanel';

type AppView = 'menu' | 'game';

// ---------------------------------------------------------------------------
// DOM lookups
// ---------------------------------------------------------------------------

const menuView = document.getElementById('menu-view') as HTMLElement;
const menuBg = document.getElementById('menu-bg') as HTMLElement;
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

const starmapCanvas = document.getElementById('starmap-canvas') as HTMLElement;
const sidepanelHost = document.getElementById('sidepanel-host') as HTMLElement;
const zoomInBtn = document.getElementById('zoom-in-btn') as HTMLButtonElement;
const zoomOutBtn = document.getElementById('zoom-out-btn') as HTMLButtonElement;
const clearSelBtn = document.getElementById('clear-selection-btn') as HTMLButtonElement;
const starmapStatus = document.getElementById('starmap-status')!.querySelector('b')!;

const requiredElements = {
  menuView, menuBg, gameView, backLink, headerSubtitle,
  newGameBtn, loadGameBtn,
  sizeSelect, seedInput, generateBtn, randomSeedBtn,
  statCount, statRadius, statValid, jsonOut, statusEl,
  starmapCanvas, sidepanelHost,
  zoomInBtn, zoomOutBtn, clearSelBtn, starmapStatus,
};
for (const [name, el] of Object.entries(requiredElements)) {
  if (!el) throw new Error(`main.ts: required DOM element missing: ${name}`);
}

// ---------------------------------------------------------------------------
// Menu background
// ---------------------------------------------------------------------------

let menuBackground: MenuBackground | null = null;
let menuBackgroundPromise: Promise<MenuBackground> | null = null;

function ensureMenuBackground(): Promise<MenuBackground> {
  if (menuBackground) return Promise.resolve(menuBackground);
  if (menuBackgroundPromise) return menuBackgroundPromise;
  menuBackgroundPromise = mountMenuBackground({ container: menuBg })
    .then((bg) => {
      menuBackground = bg;
      menuBackgroundPromise = null;
      console.info(`menu background mounted (mode=${bg.mode})`);
      return bg;
    })
    .catch((err) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Failed to mount menu background:', msg, err);
      menuBackgroundPromise = null;
      throw err;
    });
  return menuBackgroundPromise;
}

// ---------------------------------------------------------------------------
// Starmap runtime state
// ---------------------------------------------------------------------------

interface GameRuntime {
  galaxy: Galaxy;
  state: StarmapState;
  renderer: StarmapRenderer;
  sidePanel: SidePanel;
}

let runtime: GameRuntime | null = null;

function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

function isGalaxySize(v: string): v is GalaxySize {
  return (GALAXY_SIZES as readonly string[]).includes(v);
}

async function ensureStarmap(galaxy: Galaxy): Promise<void> {
  // Always mount on first call (runtime is null).
  if (!runtime) {
    const renderer = await mountStarmap(starmapCanvas, galaxy, initialStarmap);
    const sidePanel = mountSidePanel(sidepanelHost);
    runtime = { galaxy, state: initialStarmap, renderer, sidePanel };
    attachStarmapEvents();
    return;
  }
  // Already mounted: update galaxy and re-validate state.
  runtime.galaxy = galaxy;
  if (!isValidState(runtime.state, galaxy)) {
    runtime.state = initialStarmap;
  }
  runtime.renderer.setGalaxy(galaxy);
  runtime.renderer.setCamera(runtime.state.camera);
  runtime.renderer.setSelection(runtime.state.selectedId);
  if (runtime.state.selectedId !== NO_SELECTION) {
    runtime.sidePanel.showStar(runtime.state.selectedId, galaxy);
  } else {
    runtime.sidePanel.clear();
  }
}

function applyState(next: StarmapState): void {
  if (!runtime) return;
  const { renderer, sidePanel } = runtime;
  runtime.state = next;
  renderer.setCamera(next.camera);
  renderer.setSelection(next.selectedId);
  if (next.selectedId === NO_SELECTION) {
    sidePanel.clear();
  } else {
    sidePanel.showStar(next.selectedId, runtime.galaxy);
  }
}

function attachStarmapEvents(): void {
  if (!runtime) return;
  const { renderer, sidePanel } = runtime;

  starmapCanvas.addEventListener('click', (ev) => {
    if (!runtime) return;
    const sp = renderer.screenPointFromClient(ev.clientX, ev.clientY);
    const id = starAtPoint(
      sp,
      runtime.galaxy,
      runtime.state.camera,
      renderer.viewport,
    );
    starmapStatus.textContent = id === NO_SELECTION ? '—' : `#${id}`;
    if (id === NO_SELECTION) {
      applyState(clearSelection(runtime.state));
    } else {
      applyState(selectStar(runtime.state, id, runtime.galaxy));
    }
  });

  zoomInBtn.addEventListener('click', () => {
    if (!runtime) return;
    applyState(
      zoomCameraAround(
        runtime.state,
        150,
        {
          sx: renderer.viewport.width / 2,
          sy: renderer.viewport.height / 2,
        },
        renderer.viewport,
        runtime.galaxy.radius,
      ),
    );
  });

  zoomOutBtn.addEventListener('click', () => {
    if (!runtime) return;
    applyState(
      zoomCameraAround(
        runtime.state,
        Math.floor((ZOOM_DENOMINATOR * 2) / 3),
        {
          sx: renderer.viewport.width / 2,
          sy: renderer.viewport.height / 2,
        },
        renderer.viewport,
        runtime.galaxy.radius,
      ),
    );
  });

  clearSelBtn.addEventListener('click', () => {
    if (!runtime) return;
    applyState(clearSelection(runtime.state));
  });

  void sidePanel; // currently unused outside applyState; reserved for future button bindings.
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

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

    void ensureStarmap(galaxy);
  } catch (err) {
    setStatus(`Generation failed: ${(err as Error).message}`, 'err');
    console.error(err);
  }
}

// ---------------------------------------------------------------------------
// View routing
// ---------------------------------------------------------------------------

function showView(view: AppView): void {
  if (view === 'menu') {
    menuView.classList.remove('hidden');
    gameView.classList.add('hidden');
    backLink.classList.add('hidden');
    headerSubtitle.textContent = 'Iteration 1a — galaxy data model';
    ensureMenuBackground().catch(() => { /* logged in ensureMenuBackground */ });
  } else {
    menuView.classList.add('hidden');
    gameView.classList.remove('hidden');
    backLink.classList.remove('hidden');
    headerSubtitle.textContent = 'Iteration 1b — galaxy starmap';
  }
}

function startNewGame(): void {
  showView('game');
  sizeSelect.value = 'Large';
  seedInput.value = '42';
  generateGalaxyInView();
  setStatus('New game started. (Save/load not yet implemented.)', 'ok');
}

function startLoadGame(): void {
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

// ---------------------------------------------------------------------------
// Wire-up
// ---------------------------------------------------------------------------

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

// Initial view: menu (which also kicks off the background mount).
showView('menu');
setStatus('Ready.', '');