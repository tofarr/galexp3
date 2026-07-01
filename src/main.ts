/**
 * Application entry point.
 *
 * Iter 1e — replaced fixed StarSize enum with numeric size in
 * [1, 100] (will later drive resource yield), swapped colour
 * palette to {White, Yellow, Red, Orange, Green, Purple}, rebuilt
 * star rendering as four layers (outer halo → inner bloom → white
 * core → sharp highlight), and added a procedural dusty starfield
 * backdrop.
 *
 * Iter 2c — replaced the in-game debug header (Galaxy Size / Seed /
 * Generate / Random seed + star-stat badges + galaxy-JSON pre) with
 * a five-resource bar (Agriculture / Industry / Research / Culture /
 * Military) on the left and a Next Turn button on the right. Per
 * iteration 2a's spec, each ResourcePool is now a 5-tuple.
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
 *   - A resource bar (#resource-bar-host) at the top with the
 *     five player resources and a Next Turn button.
 *   - A PixiJS starmap renderer in #starmap-canvas.
 *   - A side panel (CSS-driven slide-in) in #sidepanel-host.
 *   - Click handlers on the canvas that hit-test against the
 *     pure sim layer in src/sim/starmap.ts.
 *   - Zoom in/out and clear-selection buttons.
 */

import {
  initGalaxy,
  isValidGalaxy,
  type Galaxy,
  type GalaxySize,
} from '@sim/galaxy';
import {
  ZOOM_DENOMINATOR,
  clearSelection,
  clickAtPoint,
  closePlanetMenu,
  initialState as initialStarmap,
  isValidState,
  NO_SELECTION,
  PANEL_WIDTH_PX,
  starAtPoint,
  type StarmapState,
  type Camera,
} from '@sim/starmap';
import { mountMenuBackground, type MenuBackground } from './ui/menuBackground';
import { mountStarmap, type StarmapRenderer } from './ui/starmap';
import { mountSidePanel, type SidePanel } from './ui/sidepanel';
import { mountNewGameDialog, type NewGameDialog } from './ui/newGameDialog';
import { mountResourceBar, type ResourceBar, type ResourceKey } from './ui/resourceBar';
import {
  mountCornerControls,
  type CornerControls,
  type CornerMenuItemId,
} from './ui/cornerControls';

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

const statusEl = document.getElementById('status') as HTMLDivElement;

const starmapCanvas = document.getElementById('starmap-canvas') as HTMLElement;
const sidepanelHost = document.getElementById('sidepanel-host') as HTMLElement;
const zoomInBtn = document.getElementById('zoom-in-btn') as HTMLButtonElement;
const zoomOutBtn = document.getElementById('zoom-out-btn') as HTMLButtonElement;
const clearSelBtn = document.getElementById('clear-selection-btn') as HTMLButtonElement;
const starmapStatus = document.getElementById('starmap-status')!.querySelector('b')!;
const newGameDialogHost = document.getElementById('new-game-dialog-host') as HTMLElement;
const resourceBarHost = document.getElementById('resource-bar-host') as HTMLElement;
const nextTurnBtnHost = document.getElementById('next-turn-btn-host') as HTMLElement;

/** Duration of camera animation tweens (zoom + recenter). */
const ZOOM_ANIMATION_MS = 180;

const requiredElements = {
  menuView, menuBg, gameView, backLink, headerSubtitle,
  newGameBtn, loadGameBtn,
  statusEl,
  starmapCanvas, sidepanelHost,
  zoomInBtn, zoomOutBtn, clearSelBtn, starmapStatus,
  newGameDialogHost, resourceBarHost,
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

// ---------------------------------------------------------------------------
// Player state (resource pool, owned by runtime)
// ---------------------------------------------------------------------------

/**
 * Per-player state owned by the game view. For now, only the
 * resource pool is meaningful — there's exactly one player (the
 * human) and no other game-state entities (colonies, fleets)
 * exist yet. Field names mirror the canonical spec's ResourcePool
 * tuple layout (agriculture, industry, academic, culture, military).
 */
interface PlayerState {
  id: number;
  name: string;
  isHuman: boolean;
  resources: Record<ResourceKey, number>;
  turnNumber: number;
}

let player: PlayerState | null = null;

function newPlayer(): PlayerState {
  return {
    id: 0,
    name: 'You',
    isHuman: true,
    resources: { agriculture: 0, industry: 0, academic: 0, culture: 0, military: 0 },
    turnNumber: 0,
  };
}

// ---------------------------------------------------------------------------
// Resource bar (UI mount)
// ---------------------------------------------------------------------------

const resourceBar: ResourceBar = mountResourceBar(resourceBarHost);

// ---------------------------------------------------------------------------
// Corner controls (Menu button + Next Turn button at bottom-right)
// ---------------------------------------------------------------------------

const cornerControls: CornerControls = mountCornerControls(nextTurnBtnHost);
cornerControls.setNextTurnHandler(() => {
  if (!player) return;
  // Placeholder: full turn-resolution lives in a future iteration.
  // For now we just bump the turn counter and clear the status.
  player.turnNumber += 1;
  cornerControls.setNextTurnTooltip(
    `End turn ${player.turnNumber - 1} → start turn ${player.turnNumber}`,
  );
  setStatus(`Turn ${player.turnNumber}. (End-of-turn logic not yet implemented.)`, '');
  console.info(`[galexp3] Next Turn pressed; turn=${player.turnNumber}; resources=`, player.resources);
});

cornerControls.onMenuItem((id: CornerMenuItemId) => {
  // None of the menu items are wired to actual save/load/exit logic
  // yet — surface them via the status line + console so it's visible
  // that the click landed, and so the wiring site is obvious to
  // whoever implements them next.
  switch (id) {
    case 'save':
      setStatus('Save Game: not yet implemented.', '');
      console.warn('[galexp3] Menu: Save Game pressed — not yet implemented.');
      break;
    case 'load':
      setStatus('Load Game: not yet implemented.', '');
      console.warn('[galexp3] Menu: Load Game pressed — not yet implemented.');
      break;
    case 'exit':
      setStatus('Exit to Title: not yet implemented.', '');
      console.warn('[galexp3] Menu: Exit to Title pressed — not yet implemented.');
      break;
  }
});

function refreshResourceBar(): void {
  if (!player) return;
  resourceBar.setPool(player.resources);
  // Tooltip reflects the upcoming turn: the button will END the
  // current turn and START the next one, so we describe both.
  cornerControls.setNextTurnTooltip(
    `End turn ${player.turnNumber} → start turn ${player.turnNumber + 1}`,
  );
}

// ---------------------------------------------------------------------------
// New Game dialog
// ---------------------------------------------------------------------------

const newGameDialog: NewGameDialog = mountNewGameDialog(newGameDialogHost);
newGameDialog.onStart(({ size, seed }) => {
  showView('game');
  applyNewGame(size, seed);
  setStatus('New game started. (Save/load not yet implemented.)', 'ok');
});

function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

async function ensureStarmap(galaxy: Galaxy): Promise<void> {
  // Always mount on first call (runtime is null).
  if (!runtime) {
    const renderer = await mountStarmap(starmapCanvas, galaxy, initialStarmap);
    const sidePanel = mountSidePanel(sidepanelHost, {
      // Iter 2l — the X button owns the close transition. The panel
      // is presentational; the host (us) clears the selection via
      // `closePlanetMenu`, which then drives applyState → sidePanel.clear().
      onClose: () => {
        if (!runtime) return;
        applyState(closePlanetMenu(runtime.state));
      },
    });
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

    // Iter 2l — click semantics (handled by the sim's `clickAtPoint`):
    //   • Hit a star    → selectStarCentred (selects + recentres
    //                     for the panel width)
    //   • Hit empty     → clickEmpty (pans to the click point, keeps
    //                     the current selection — does NOT clear it)
    // There is no in-canvas transition that clears the selection;
    // the panel is closed only via the X button (→ closePlanetMenu).
    const next = clickAtPoint(
      runtime.state,
      sp,
      runtime.galaxy,
      renderer.viewport,
      PANEL_WIDTH_PX,
    );
    if (next !== runtime.state) {
      // Camera moved (new or different selection, or empty pan).
      // Animate to the new camera via the renderer so the transition
      // is smooth. For star selections the camera target is the
      // star itself (already in `next.camera.pan`); for empty clicks
      // it's the world point under the cursor.
      const cameraMoved = next.camera.pan.x !== runtime.state.camera.pan.x
        || next.camera.pan.y !== runtime.state.camera.pan.y
        || next.camera.zoom !== runtime.state.camera.zoom;
      applyState(next);
      if (cameraMoved) {
        const targetPan = id === NO_SELECTION
          ? renderer.worldPointFromClient(ev.clientX, ev.clientY)
          : { x: next.camera.pan.x, y: next.camera.pan.y };
        renderer
          .panTo(targetPan, ZOOM_ANIMATION_MS)
          .then((finalCamera) => {
            if (!runtime) return;
            runtime.state = { ...runtime.state, camera: finalCamera };
          })
          .catch(() => {
            /* superseded by a newer tween */
          });
      }
    }
    // else: click was on empty space outside the galaxy disc — neither
    // selection nor camera changed; nothing to do.
  });

  zoomInBtn.addEventListener('click', () => {
    if (!runtime) return;
    const centre = {
      sx: renderer.viewport.width / 2,
      sy: renderer.viewport.height / 2,
    };
    renderer
      .zoomBy(150, centre)
      .then((finalCamera: Camera) => {
        if (!runtime) return;
        runtime.state = { ...runtime.state, camera: finalCamera };
      })
      .catch(() => {
        /* superseded by a newer zoom — ignore */
      });
  });

  zoomOutBtn.addEventListener('click', () => {
    if (!runtime) return;
    const centre = {
      sx: renderer.viewport.width / 2,
      sy: renderer.viewport.height / 2,
    };
    renderer
      .zoomBy(Math.floor((ZOOM_DENOMINATOR * 2) / 3), centre)
      .then((finalCamera: Camera) => {
        if (!runtime) return;
        runtime.state = { ...runtime.state, camera: finalCamera };
      })
      .catch(() => {
        /* superseded by a newer zoom — ignore */
      });
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

/**
 * Generate a galaxy from a (size, seed) pair. Resets the player
 * state to a fresh human player at turn 0 with an empty resource
 * pool. The resource bar is refreshed immediately so the player
 * sees their starting counts (all 0 for now; per-turn production
 * will fill these in once colonies exist).
 */
function applyNewGame(size: GalaxySize, seed: number): void {
  try {
    const galaxy = initGalaxy(seed, size);
    const valid = isValidGalaxy(galaxy);

    // Reset player state.
    player = newPlayer();
    refreshResourceBar();

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
    headerSubtitle.textContent = 'Iteration 1e — sized + coloured stars with layered bloom';
  }
}

function startNewGame(): void {
  // Open the New Game dialog. Once the user picks (size, seed) and
  // presses Start, we route to the game view and generate.
  newGameDialog.open();
}

function startLoadGame(): void {
  showView('game');
  applyNewGame('Large', 42);
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

// Initial view: menu (which also kicks off the background mount).
showView('menu');
setStatus('Ready.', '');