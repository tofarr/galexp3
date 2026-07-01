/**
 * Right-side context panel for the star map.
 *
 * Iteration 1b. Slides in from the right edge when a star is selected
 * and slides back out when selection is cleared. Shows only the
 * star's display name for now — ownership metrics, market data,
 * and command buttons will be added in later iterations.
 *
 * Animation is CSS-driven (transform-only) so it stays smooth even
 * when the renderer is busy. The panel mounts itself into the
 * provided container; the caller is responsible for the
 * layout/positioning of that container in the page CSS.
 */

import type { GalaxySubset } from '../sim/starmap';
import { NO_SELECTION } from '../sim/starmap';

// ---------------------------------------------------------------------------
// DOM structure
// ---------------------------------------------------------------------------

const PANEL_CLASS = 'sidepanel';
const PANEL_OPEN_CLASS = 'sidepanel--open';
const PANEL_VISIBLE_CLASS = 'sidepanel--visible';

const STAR_NAME_ID = 'sidepanel-star-name';

/**
 * Inject the minimum CSS needed for the panel. We keep it in a
 * <style> tag so the panel is self-contained; the page CSS already
 * provides the colour palette via CSS variables.
 *
 * Iter 2l — adds the close-button styles and layout. The button
 * floats top-right of the panel and uses the same colour palette
 * as the rest of the UI.
 */
function injectStyles(): void {
  if (document.getElementById('sidepanel-styles')) return;
  const style = document.createElement('style');
  style.id = 'sidepanel-styles';
  style.textContent = `
    .${PANEL_CLASS} {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 280px;
      background: var(--panel);
      border-left: 1px solid var(--border);
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.4);
      transform: translateX(100%);
      transition: transform 220ms ease-out;
      padding: 20px 22px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 14px;
      pointer-events: none;
      z-index: 10;
    }
    .${PANEL_CLASS}.${PANEL_VISIBLE_CLASS} { pointer-events: auto; }
    .${PANEL_CLASS}.${PANEL_OPEN_CLASS} { transform: translateX(0); }

    .sidepanel-header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }
    .sidepanel-close {
      flex-shrink: 0;
      width: 28px;
      height: 28px;
      border: 1px solid var(--border);
      background: transparent;
      color: var(--muted);
      font-size: 18px;
      line-height: 1;
      cursor: pointer;
      border-radius: 4px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
    }
    .sidepanel-close:hover {
      color: var(--fg);
      border-color: var(--fg);
      background: rgba(255, 255, 255, 0.04);
    }
    .sidepanel-close:focus {
      outline: 2px solid var(--accent, #6cf);
      outline-offset: 1px;
    }
    .sidepanel-star-name {
      font-size: 22px;
      font-weight: 600;
      color: var(--fg);
      letter-spacing: 0.02em;
    }
    .sidepanel-empty {
      font-size: 13px;
      color: var(--muted);
      font-style: italic;
    }
    .sidepanel-footer {
      margin-top: auto;
      font-size: 11px;
      color: var(--muted);
      border-top: 1px solid var(--border);
      padding-top: 12px;
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SidePanelOptions {
  /**
   * Called when the user dismisses the panel via the X button.
   * Iter 2l — the panel is purely presentational; the host owns
   * the selection state and must react to the close request by
   * clearing the selection (via `closePlanetMenu`).
   */
  onClose?: () => void;
}

export interface SidePanel {
  /** Show the panel populated for the selected star. */
  showStar(id: number, galaxy: GalaxySubset): void;
  /** Slide the panel out and clear its contents. */
  clear(): void;
  /** Remove the panel from the DOM. Idempotent. */
  destroy(): void;
}

/**
 * Mount the side panel into a container. The container should be
 * positioned so that absolute positioning of the panel anchors
 * correctly (typically the same container that holds the starmap
 * PixiJS canvas, with `position: relative`).
 *
 * Iter 2l — accepts an `onClose` callback fired when the user
 * clicks the X button. The panel itself never mutates selection
 * state; the host owns it and must clear it on close.
 */
export function mountSidePanel(
  container: HTMLElement,
  options: SidePanelOptions = {},
): SidePanel {
  injectStyles();

  const panel = document.createElement('aside');
  panel.className = PANEL_CLASS;
  panel.setAttribute('aria-label', 'Selection details');
  panel.setAttribute('role', 'complementary');

  const headerRow = document.createElement('div');
  headerRow.className = 'sidepanel-header-row';

  const nameEl = document.createElement('div');
  nameEl.id = STAR_NAME_ID;
  nameEl.className = 'sidepanel-star-name';
  nameEl.textContent = '—';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sidepanel-close';
  closeBtn.setAttribute('aria-label', 'Close panel');
  closeBtn.title = 'Close planet menu';
  closeBtn.textContent = '\u00D7'; // × multiplication sign
  closeBtn.addEventListener('click', () => {
    // The panel is purely a view of the selection; we just fire the
    // callback so the host can run closePlanetMenu. The host's
    // state-update will then call back into clear() to animate the
    // panel out.
    options.onClose?.();
  });

  headerRow.appendChild(nameEl);
  headerRow.appendChild(closeBtn);

  const empty = document.createElement('div');
  empty.className = 'sidepanel-empty';
  empty.textContent = 'Click a star to view its details.';

  const footer = document.createElement('div');
  footer.className = 'sidepanel-footer';
  footer.textContent = 'Iteration 2l — planet menu';

  panel.appendChild(headerRow);
  panel.appendChild(empty);
  panel.appendChild(footer);

  container.appendChild(panel);

  let mounted = true;

  function showStar(id: number, galaxy: GalaxySubset): void {
    if (!mounted) return;
    const star = galaxy.stars.find((s) => s.id === id);
    if (!star) {
      clear();
      return;
    }
    nameEl.textContent = star.name;
    nameEl.style.display = '';
    empty.style.display = 'none';
    panel.classList.add(PANEL_VISIBLE_CLASS, PANEL_OPEN_CLASS);
  }

  function clear(): void {
    if (!mounted) return;
    nameEl.textContent = '—';
    nameEl.style.display = '';
    empty.style.display = '';
    panel.classList.remove(PANEL_OPEN_CLASS);
    // Keep the panel mounted but unclickable; a later showStar() will
    // re-open it. We delay removing the visible flag so the slide-out
    // animation has time to play.
    setTimeout(() => {
      if (panel.classList.contains(PANEL_OPEN_CLASS)) return;
      panel.classList.remove(PANEL_VISIBLE_CLASS);
    }, 240);
  }

  function destroy(): void {
    if (!mounted) return;
    mounted = false;
    panel.remove();
  }

  return { showStar, clear, destroy };
}

/** Sentinel re-export so main.ts can pass `NO_SELECTION` through. */
export { NO_SELECTION };