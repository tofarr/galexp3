/**
 * Corner controls — the two buttons that live at the bottom-right
 * of the starmap, above the planet panel:
 *
 *   ┌────────┐  ┌────────┐
 *   │ Menu   │  │ Next ▸ │   ← bottom-right of starmap
 *   └────────┘  └────────┘
 *
 * The Menu button opens a small popup menu with three items
 * (Save Game / Load Game / Exit to Title). Items are not wired
 * to anything yet — the host installs handlers via `onMenuItem`.
 *
 * The Next Turn button is icon-only (play triangle) with a
 * dynamic tooltip that the host owns via `setNextTurnTooltip`.
 *
 * Both buttons share the same corner host, drawn above the
 * planet panel (z-index 20 in the injected styles below, vs
 * the panel's z-index 10).
 *
 * The popup is anchored to the Menu button and opens upward
 * (anchored to the bottom of the button) so it doesn't fall
 * off the bottom of the screen. It closes on:
 *   - backdrop click
 *   - Escape key
 *   - menu-item click
 *   - Menu-button click (toggles)
 *
 * Self-contained: injects its own <style> tag (idempotent).
 */

export type CornerMenuItemId = 'save' | 'load' | 'exit';

export interface CornerMenuItem {
  readonly id: CornerMenuItemId;
  readonly label: string;
}

const MENU_ITEMS: readonly CornerMenuItem[] = [
  { id: 'save', label: 'Save Game' },
  { id: 'load', label: 'Load Game' },
  { id: 'exit', label: 'Exit to Title' },
];

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

const STYLE_ID = 'corner-controls-styles';

const CSS = `
  /* The corner host is the same DOM element that the legacy
     "next-turn-btn-host" used to be — the HTML id is preserved
     so existing markup doesn't move. */
  .cc-host {
    position: absolute;
    bottom: 5px;
    right: 5px;
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 5px;
    z-index: 20;            /* above planet panel (z-index 10) */
    pointer-events: auto;   /* the host itself was previously pointer-events:none by inheritance */
  }

  /* Shared visual language for both corner buttons: 32×32
     icon-only buttons, mirroring the starmap zoom controls
     so the four corner buttons all share a single style. */
  .cc-btn {
    width: 32px;
    height: 32px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--panel);
    color: var(--fg);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    transition: border-color 120ms ease, color 120ms ease, background 120ms ease;
  }
  .cc-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .cc-btn:focus-visible {
    outline: 2px solid var(--accent, #6cf);
    outline-offset: 1px;
  }
  .cc-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .cc-btn svg {
    width: 18px;
    height: 18px;
  }

  /* The Next Turn button uses the same accent-tinted gradient as
     the legacy primary action buttons (New Game / Start) so the
     "primary action" affordance is preserved even though the
     button is now icon-only. */
  .cc-next-turn-btn {
    background: linear-gradient(180deg, #1c3a66 0%, #0f1f3a 100%);
    color: var(--accent);
    border-color: var(--accent);
  }
  .cc-next-turn-btn:hover {
    background: linear-gradient(180deg, #2a4d80 0%, #14284a 100%);
  }
  .cc-next-turn-btn svg {
    /* The play triangle wants a slightly stronger visual weight
       than the menu bars; nudge the size up by 1px so it reads
       as the primary action at a glance. */
    width: 19px;
    height: 19px;
  }

  /* Menu button "open" state — visually match the panel-2 fill so
     it reads as a depressed toggle. */
  .cc-menu-btn[aria-expanded="true"] {
    background: var(--panel-2);
    border-color: var(--accent);
    color: var(--accent);
  }

  /* ---- Popup menu ---- */
  /* The popup is attached to <body> when open (not to the host)
     because the host lives inside the starmap-host which has
     overflow:hidden — that would clip any popup rendered
     outside the host's bounds. We position it with fixed
     coordinates computed at open time (see openMenu()). */
  .cc-popup {
    position: fixed;
    z-index: 25;                 /* above the host (20) */
    min-width: 180px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.55);
    padding: 6px 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cc-popup[hidden] { display: none; }

  .cc-popup-item {
    appearance: none;
    background: transparent;
    border: 0;
    color: var(--fg);
    padding: 8px 16px;
    text-align: left;
    font-size: 13px;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: background 120ms ease, color 120ms ease;
    font-family: inherit;
  }
  .cc-popup-item:hover {
    background: var(--panel-2);
    color: var(--accent);
  }
  .cc-popup-item:focus-visible {
    outline: 2px solid var(--accent, #6cf);
    outline-offset: -2px;
  }

  /* ---- Backdrop (transparent click-catcher for "click outside" close) ---- */
  .cc-backdrop {
    position: fixed;
    inset: 0;
    z-index: 19;          /* below the host (20) so clicks on the host still work */
    background: transparent;
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
// Icon helpers (SVG, currentColor, 24×24 viewBox)
// ---------------------------------------------------------------------------

function svgEl(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.75');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

/** Three horizontal lines — the universal "menu" glyph. */
function buildMenuIcon(): SVGSVGElement {
  const svg = svgEl();
  for (const y of [6, 12, 18]) {
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '4');
    line.setAttribute('y1', String(y));
    line.setAttribute('x2', '20');
    line.setAttribute('y2', String(y));
    svg.appendChild(line);
  }
  return svg;
}

/** Solid filled triangle pointing right — the "play" glyph. */
function buildPlayIcon(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  // Filled triangle, slightly offset from the centre so the
  // visual centre of mass lines up with the button centre.
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M8 5 L19 12 L8 19 Z');
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

// ---------------------------------------------------------------------------
// Public mount
// ---------------------------------------------------------------------------

export interface CornerControls {
  /** Replace the Next Turn button click handler. Pass null to disable. */
  setNextTurnHandler(handler: (() => void) | null): void;
  /** Update the Next Turn button's tooltip (browser-native title attr). */
  setNextTurnTooltip(text: string): void;
  /** Direct access to the underlying Next Turn button. */
  nextTurnButton: HTMLButtonElement;
  /** Open the popup menu (programmatically). No-op if already open. */
  openMenu(): void;
  /** Close the popup menu. No-op if already closed. */
  closeMenu(): void;
  /** Replace the handler fired when a menu item is clicked. */
  onMenuItem(handler: ((id: CornerMenuItemId) => void) | null): void;
}

/**
 * Mount the corner controls into `host`. The host should be
 * positioned (typically `position: absolute` inside the starmap)
 * — the module's own CSS anchors it to the bottom-right with
 * `right: 5px; bottom: 5px; z-index: 20`.
 */
export function mountCornerControls(host: HTMLElement): CornerControls {
  injectStyles();

  // The host already exists in the HTML (it used to be the
  // "next-turn-btn-host"). If the host doesn't already have
  // the cc-host class, add it so the layout kicks in even if
  // the page-level CSS hasn't been updated yet.
  if (!host.classList.contains('cc-host')) {
    host.classList.add('cc-host');
  }

  // ---- Menu button (left) ----
  const menuBtn = document.createElement('button');
  menuBtn.type = 'button';
  menuBtn.className = 'cc-btn cc-menu-btn';
  menuBtn.id = 'corner-menu-btn';
  menuBtn.setAttribute('aria-haspopup', 'menu');
  menuBtn.setAttribute('aria-expanded', 'false');
  menuBtn.setAttribute('aria-label', 'Open menu');
  menuBtn.title = 'Menu';
  menuBtn.appendChild(buildMenuIcon());

  // ---- Next Turn button (right) ----
  const nextTurnBtn = document.createElement('button');
  nextTurnBtn.type = 'button';
  nextTurnBtn.className = 'cc-btn cc-next-turn-btn';
  nextTurnBtn.id = 'next-turn-btn';
  nextTurnBtn.setAttribute('aria-label', 'Next Turn');
  nextTurnBtn.title = 'Next Turn';
  nextTurnBtn.appendChild(buildPlayIcon());

  host.appendChild(menuBtn);
  host.appendChild(nextTurnBtn);

  // ---- Popup (built once, kept detached; attached to <body> only
  //       when open so it escapes the starmap host's
  //       overflow:hidden clip region). Positioned with fixed
  //       coords computed at open time from the menu button's
  //       bounding rect. ----
  const popup = document.createElement('div');
  popup.className = 'cc-popup';
  popup.setAttribute('role', 'menu');
  popup.setAttribute('aria-label', 'Game menu');
  popup.hidden = true;

  for (const item of MENU_ITEMS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'cc-popup-item';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.itemId = item.id;
    btn.textContent = item.label;
    popup.appendChild(btn);
  }

  // ---- State ----
  let nextTurnHandler: (() => void) | null = null;
  let menuItemHandler: ((id: CornerMenuItemId) => void) | null = null;
  let backdrop: HTMLDivElement | null = null;
  let escListener: ((e: KeyboardEvent) => void) | null = null;

  function setNextTurnHandler(handler: (() => void) | null): void {
    nextTurnHandler = handler;
    nextTurnBtn.disabled = handler === null;
  }

  function setNextTurnTooltip(text: string): void {
    nextTurnBtn.title = text;
  }

  function setAriaExpanded(open: boolean): void {
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function openMenu(): void {
    if (!popup.hidden) return;

    // Position relative to the menu button using fixed
    // viewport coords. The menu button is at the bottom-right
    // of the starmap, so the popup anchors:
    //   • right edge → aligns with the menu button's right
    //   • bottom edge → 6px above the menu button's top
    // Using `bottom` (from viewport bottom) avoids having to
    // measure the popup's height first.
    const rect = menuBtn.getBoundingClientRect();
    const rightPx = Math.max(0, window.innerWidth - rect.right);
    const bottomPx = Math.max(0, window.innerHeight - rect.top + 6);
    popup.style.right = `${rightPx}px`;
    popup.style.bottom = `${bottomPx}px`;
    popup.style.top = '';   // clear any prior value

    setAriaExpanded(true);

    // Attach to body so the popup escapes any ancestor
    // overflow:hidden (the starmap host has one).
    document.body.appendChild(popup);
    popup.hidden = false;

    // Transparent backdrop closes on outside clicks. We listen on
    // `mousedown` (not `click`) so the mousedown that originated on
    // the menu button — which opened this popup — doesn't
    // double-fire as a click on the backdrop and immediately
    // close it. (The mouseup of the same gesture lands on the
    // backdrop, but the mousedown already happened on the menu
    // button before the backdrop was in the DOM, so listening on
    // mousedown is safe.)
    if (!backdrop) {
      backdrop = document.createElement('div');
      backdrop.className = 'cc-backdrop';
      backdrop.addEventListener('mousedown', () => closeMenu());
    }
    document.body.appendChild(backdrop);

    // Escape closes.
    if (!escListener) {
      escListener = (e: KeyboardEvent) => {
        if (e.key === 'Escape') closeMenu();
      };
      document.addEventListener('keydown', escListener);
    }

    // Move focus to the first menu item so keyboard users can
    // navigate with Tab/Enter without an extra click.
    const firstItem = popup.querySelector<HTMLButtonElement>('.cc-popup-item');
    firstItem?.focus();
  }

  function closeMenu(): void {
    if (popup.hidden) return;
    popup.hidden = true;
    setAriaExpanded(false);

    // Detach from body. The element stays around (with the
    // items intact) so the next open reuses it without
    // rebuilding.
    if (popup.parentElement === document.body) {
      document.body.removeChild(popup);
    }

    if (backdrop) {
      backdrop.remove();
      backdrop = null;
    }
    if (escListener) {
      document.removeEventListener('keydown', escListener);
      escListener = null;
    }

    // Return focus to the menu button so keyboard users don't
    // lose their place.
    menuBtn.focus();
  }

  function onMenuItem(handler: ((id: CornerMenuItemId) => void) | null): void {
    menuItemHandler = handler;
  }

  // ---- Wire interactions ----
  nextTurnBtn.addEventListener('click', () => {
    if (nextTurnHandler) nextTurnHandler();
  });

  menuBtn.addEventListener('click', () => {
    if (popup.hidden) openMenu();
    else closeMenu();
  });

  popup.addEventListener('click', (ev) => {
    const target = ev.target as HTMLElement | null;
    const itemId = target?.dataset?.itemId as CornerMenuItemId | undefined;
    if (!itemId) return;
    closeMenu();
    menuItemHandler?.(itemId);
  });

  return {
    setNextTurnHandler,
    setNextTurnTooltip,
    nextTurnButton: nextTurnBtn,
    openMenu,
    closeMenu,
    onMenuItem,
  };
}