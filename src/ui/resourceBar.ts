/**
 * Resource bar for the game-view header.
 *
 * Displays the five player resources as icon + count badges:
 *   - Agriculture (green, grain icon)
 *   - Industry    (blue, factory icon)
 *   - Research    (purple, beaker icon)  [spec field name: "academic"]
 *   - Culture     (yellow, library icon)
 *   - Military    (red, paper-plane icon)
 *
 * The spec's canonical name for the research resource is "academic"
 * (see `RESOURCE_TYPES` in quint/empire.qnt) — the UI uses "Research"
 * because that's the user-facing term the design uses. The mapping is
 * `RESOURCE_DISPLAY_NAMES` below.
 *
 * Mouseover (native `title`) shows the icon's display name + the
 * full title, e.g. "12345 Military Points". The icon SVG is rendered
 * visually inside the badge; the title attribute text is what the
 * browser tooltip shows.
 *
 * The Next Turn button used to live here (mounted via an optional
 * second host arg) but moved out to its own module
 * (`src/ui/cornerControls.ts`) so the two corner controls could
 * share a host and a consistent visual language.
 *
 * Self-contained: injects its own <style> tag (idempotent guard so
 * HMR doesn't duplicate), mounts DOM into the supplied host. The
 * host stays in the page for the game-view lifetime; the bar's
 * contents are repopulated on `setPool`.
 */

export type ResourceKey =
  | 'agriculture'
  | 'industry'
  | 'academic'
  | 'culture'
  | 'military';

export interface ResourceDescriptor {
  readonly key: ResourceKey;
  readonly iconName: string;       // displayed in tooltip and used as aria-label
  readonly displayName: string;    // "Agriculture" / "Research" etc.
  readonly color: string;          // CSS color used for icon + count
  readonly iconPath: readonly string[]; // SVG <path d="..."> strings
}

/**
 * Authoritative icon + color table. Order here is the display order
 * in the resource bar (left to right). The `key` is the spec field
 * name and matches the index in `RESOURCE_TYPES`.
 */
export const RESOURCE_DESCRIPTORS: readonly ResourceDescriptor[] = [
  {
    key: 'agriculture',
    iconName: 'grain',
    displayName: 'Agriculture',
    color: '#4ade80',              // green
    iconPath: [
      // Single wheat stalk: central stem with grain leaves alternating
      // up each side, and a small V-shaped head at the top.
      // Stem.
      'M12 21 V7',
      // Tip V (top of the wheat head).
      'M12 7 L9.5 5.5',
      'M12 7 L14.5 5.5',
      // Grain pairs ascending the stem.
      'M12 9 L9 7',
      'M12 9 L15 7',
      'M12 12 L9 10',
      'M12 12 L15 10',
      'M12 15 L9 13',
      'M12 15 L15 13',
      'M12 18 L9 16',
      'M12 18 L15 16',
    ],
  },
  {
    key: 'industry',
    iconName: 'factory',
    displayName: 'Industry',
    color: '#38bdf8',              // blue
    iconPath: [
      // Tall right-hand block with a flag/antenna on top.
      'M14 21 V5 H17',
      // Smokestack on the left, taller than the factory body.
      'M3 21 V8 H7 V21',
      // Smokestack cap.
      'M3 8 H7',
      // Sawtooth roof across the middle (3 teeth, descending).
      'M7 13 L10 10 L13 13 L16 10 L19 13 L21 13',
      // Factory body under the sawtooth.
      'M3 21 H21',
      'M3 13 H21 V21',
      // Door.
      'M10 21 V17 H13 V21',
      // Window in the smokestack.
      'M4 11 H6',
      // Two small windows in the body.
      'M9 16 H11',
      'M15 16 H17',
    ],
  },
  {
    key: 'academic',
    iconName: 'beaker',
    displayName: 'Research',
    color: '#c084fc',              // purple
    iconPath: [
      // Erlenmeyer flask: neck, sloped shoulders, body, liquid line,
      // bubbles
      'M9 3 V9 L4 19 A2 2 0 0 0 6 22 H18 A2 2 0 0 0 20 19 L15 9 V3',
      'M8 3 H16',
      'M7 14 H17',
      'M10 17 L10 17.5',            // bubble
      'M14 18 L14 18.5',            // bubble
    ],
  },
  {
    key: 'culture',
    iconName: 'building-library',
    displayName: 'Culture',
    color: '#fbbf24',              // yellow / amber
    iconPath: [
      // Classical library facade: pediment + columns + base
      'M3 8 L12 4 L21 8',
      'M3 8 H21',
      'M6 8 V18',
      'M10 8 V18',
      'M14 8 V18',
      'M18 8 V18',
      'M3 18 H21',
      'M3 20 H21',
    ],
  },
  {
    key: 'military',
    iconName: 'paper-plane',
    displayName: 'Military',
    color: '#f87171',              // red
    iconPath: [
      // Paper airplane (silhouette)
      'M3 12 L21 4 L17 21 L11 14 L3 12 Z',
      'M11 14 L21 4',
    ],
  },
];

// ---------------------------------------------------------------------------
// Styling
// ---------------------------------------------------------------------------

const STYLE_ID = 'resource-bar-styles';

const CSS = `
  .rb-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }
  .rb-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: default;
    transition: border-color 120ms ease, background 120ms ease;
    user-select: none;
  }
  .rb-badge:hover {
    border-color: var(--accent);
  }
  .rb-icon {
    width: 18px;
    height: 18px;
    flex: 0 0 auto;
  }
  .rb-count {
    font-family: ui-monospace, "SF Mono", monospace;
    font-size: 14px;
    font-weight: 600;
    letter-spacing: 0.02em;
    font-variant-numeric: tabular-nums;
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

function buildIcon(descriptor: ResourceDescriptor): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'rb-icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', descriptor.color);
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of descriptor.iconPath) {
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
  }
  return svg;
}

function buildBadge(descriptor: ResourceDescriptor): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'rb-badge';
  badge.dataset.resource = descriptor.key;

  const icon = buildIcon(descriptor);
  badge.appendChild(icon);

  const count = document.createElement('span');
  count.className = 'rb-count';
  count.style.color = descriptor.color;
  count.dataset.role = 'count';
  count.textContent = '0';
  badge.appendChild(count);

  badge.title = `0 ${descriptor.displayName} Points`;
  badge.setAttribute('aria-label', `${descriptor.displayName} points`);

  return badge;
}

// ---------------------------------------------------------------------------
// Public mount
// ---------------------------------------------------------------------------

export interface ResourceBar {
  /** Update the displayed counts. Missing slots fall back to 0. */
  setPool(pool: Partial<Record<ResourceKey, number>>): void;
}

/**
 * Mount the resource bar in `host`. The bar is a single row of
 * the five resource badges; no other UI is added here.
 *
 * The Next Turn button (and its sibling Menu button) are now
 * mounted separately via `mountCornerControls` — see
 * `src/ui/cornerControls.ts`.
 */
export function mountResourceBar(
  host: HTMLElement,
): ResourceBar {
  injectStyles();

  const bar = document.createElement('div');
  bar.className = 'rb-bar';
  bar.setAttribute('role', 'group');
  bar.setAttribute('aria-label', 'Player resources');

  const badges = new Map<ResourceKey, { badge: HTMLSpanElement; count: HTMLSpanElement }>();
  for (const d of RESOURCE_DESCRIPTORS) {
    const badge = buildBadge(d);
    bar.appendChild(badge);
    badges.set(d.key, {
      badge,
      count: badge.querySelector<HTMLSpanElement>('span[data-role="count"]')!,
    });
  }

  host.appendChild(bar);

  function setPool(pool: Partial<Record<ResourceKey, number>>): void {
    for (const d of RESOURCE_DESCRIPTORS) {
      const value = pool[d.key] ?? 0;
      const entry = badges.get(d.key);
      if (!entry) continue;
      entry.count.textContent = String(value);
      entry.badge.title = `${value} ${d.displayName} Points`;
    }
  }

  return {
    setPool,
  };
}