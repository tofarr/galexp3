/**
 * PixiJS renderer for the galaxy star map.
 *
 * Iteration 1d. Adds a Gaussian-blurred bloom layer on each
 * star: the halo (atmospheric scatter) is rendered into a
 * per-star Container wrapped in a BlurFilter, while the body
 * and diffraction spikes are kept sharp. Bloom strength scales
 * with star size so supergiants get the most dramatic scatter
 * and dwarfs stay tight.
 *
 * Reads pure camera + selection state from `src/sim/starmap.ts`
 * and paints it. All pixel layout decisions (world-to-screen
 * transform, viewport centring, aspect handling) come from the
 * sim layer — this module is a dumb projection of state into
 * shapes.
 *
 * Three layers (back to front):
 *   - disc background  (filled circle)
 *   - stars            (one small circle per galaxy star)
 *   - selection ring   (highlight around the selected star, if any)
 *
 * The renderer re-uses a single PixiJS Application + Graphics for
 * all three layers and rebuilds the star shapes only when the star
 * set changes. Camera updates (pan, zoom) just repaint with the new
 * camera. Selection changes just toggle the ring.
 */

import { Application, BlurFilter, Container, Graphics, Rectangle } from 'pixi.js';
import {
  HIT_RADIUS_PX,
  NO_SELECTION,
  projectStar,
  starName,
  type Camera,
  type GalaxySubset,
  type ScreenPoint,
  type StarmapState,
  type Viewport,
} from '../sim/starmap';
import {
  STAR_BLUR_PX_FOR_SIZE,
  STAR_BODY_ALPHA,
  STAR_COLOR_FOR_KIND,
  STAR_GLOW_ALPHA,
  STAR_GLOW_COLOR_FOR_KIND,
  STAR_GLOW_RATIO,
  STAR_RADIUS_PX_FOR_SIZE,
  STAR_SIZE_FOR_KIND,
} from '../sim/galaxy';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const COLOR_DISC_FILL = 0x1a2545;
const COLOR_DISC_STROKE = 0x5070b0;
const COLOR_SELECTION_RING = 0xffd07b;
const COLOR_STAR_SELECTED = 0xffd07b;

/**
 * Parse a "0xRRGGBB" hex string (the format used by STAR_COLOR_FOR_KIND
 * and friends) into a 24-bit integer suitable for PixiJS colour APIs.
 * Returns 0 on malformed input — the appearance table is enforced by
 * unit tests, so a 0 only happens if the spec/TS tables are tampered
 * with at runtime, which we treat as a programmer error.
 */
function parseHexColor(hex: string): number {
  return parseInt(hex, 16) | 0;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export interface StarmapRenderer {
  /** Update the camera and repaint. Cheap; no allocations. */
  setCamera(camera: Camera): void;
  /** Update the selection state and repaint the ring. */
  setSelection(selectedId: number): void;
  /** Update the galaxy and rebuild star graphics. */
  setGalaxy(galaxy: GalaxySubset): void;
  /** Convert a screen point (clientX/clientY in container coords) into a sim ScreenPoint. */
  screenPointFromClient(clientX: number, clientY: number): ScreenPoint;
  /** Current viewport in pixels. */
  readonly viewport: Viewport;
  /** Cleanly tear down the PixiJS application. Idempotent. */
  destroy(): void;
}

/**
 * Mount the starmap renderer into a container element. The container
 * gets a PixiJS canvas fitted to its size; the renderer takes its
 * viewport from the container's bounding box on mount and re-fits
 * it on subsequent calls to `setGalaxy`. For 1b we don't add a
 * resize observer — the layout is fixed by the page CSS.
 */
export async function mountStarmap(
  container: HTMLElement,
  initialGalaxy: GalaxySubset,
  initialState: StarmapState,
): Promise<StarmapRenderer> {
  const rect = container.getBoundingClientRect();
  const viewport: Viewport = {
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height)),
  };

  const app = new Application();
  await app.init({
    width: viewport.width,
    height: viewport.height,
    backgroundAlpha: 0,
    antialias: true,
    autoStart: false, // we drive frames manually only when dirty
    resolution: window.devicePixelRatio || 1,
    autoDensity: true,
  });
  container.appendChild(app.canvas);
  app.canvas.style.display = 'block';
  app.canvas.style.width = '100%';
  app.canvas.style.height = '100%';

  const root = new Container();
  app.stage.addChild(root);

  const disc = new Graphics();
  const starsLayer = new Container();
  const selectionLayer = new Graphics();
  root.addChild(disc);
  root.addChild(starsLayer);
  root.addChild(selectionLayer);

  // Mutable renderer state.
  let currentGalaxy: GalaxySubset = { radius: 0, stars: [] };
  let currentCamera: Camera = initialState.camera;
  let currentSelectedId: number = initialState.selectedId;

  // Mark dirty flags so paint() can skip work that's already current.
  let galaxyDirty = true;
  let paintDirty = true;
  let ringDirty = true;

  function repaint(): void {
    if (paintDirty || galaxyDirty) {
      paintDisc();
      paintStars();
      paintDirty = false;
      galaxyDirty = false;
    }
    if (ringDirty || paintDirty) {
      paintSelectionRing();
      ringDirty = false;
    }
    app.renderer.render(app.stage);
  }

  function paintDisc(): void {
    disc.clear();
    const cx = Math.floor(viewport.width / 2);
    const cy = Math.floor(viewport.height / 2);
    const rPx = worldRadiusPx(currentGalaxy.radius, currentCamera);
    if (rPx <= 0) return;
    disc.circle(cx, cy, rPx).fill({ color: COLOR_DISC_FILL });
    disc.circle(cx, cy, rPx).stroke({
      width: 1.5,
      color: COLOR_DISC_STROKE,
      alpha: 0.7,
    });
    // A faint inner ring for orientation.
    disc.circle(cx, cy, Math.floor(rPx * 0.7)).stroke({
      width: 0.5,
      color: COLOR_DISC_STROKE,
      alpha: 0.25,
    });
  }

  function paintStars(): void {
    starsLayer.removeChildren();
    for (const s of currentGalaxy.stars) {
      const p = projectStar(s, currentCamera, viewport, currentGalaxy.radius);
      const isSelected = s.id === currentSelectedId;
      const sizeClass = STAR_SIZE_FOR_KIND[s.kind];
      const bodyRadius = isSelected
        ? STAR_RADIUS_PX_FOR_SIZE[sizeClass] + 2
        : STAR_RADIUS_PX_FOR_SIZE[sizeClass];
      const glowRadius = bodyRadius * STAR_GLOW_RATIO;
      const bodyColor = isSelected
        ? COLOR_STAR_SELECTED
        : parseHexColor(STAR_COLOR_FOR_KIND[s.kind]);
      const glowColor = isSelected
        ? COLOR_STAR_SELECTED
        : parseHexColor(STAR_GLOW_COLOR_FOR_KIND[s.kind]);
      const blurStrength = STAR_BLUR_PX_FOR_SIZE[sizeClass];

      // Halo: a single Graphics holding two stacked glow circles,
      // run through a BlurFilter. The soft scatter around the bright
      // body gives the impression of atmospheric bloom; the body and
      // spikes below stay sharp.
      const halo = new Graphics();
      halo.circle(0, 0, glowRadius).fill({
        color: glowColor,
        alpha: STAR_GLOW_ALPHA / 255,
      });
      halo.circle(0, 0, bodyRadius + Math.max(1, Math.floor(bodyRadius / 2)))
        .fill({ color: glowColor, alpha: (STAR_GLOW_ALPHA * 2) / 255 });
      // filterArea must contain the halo radius plus ~3x the blur
      // kernel — otherwise PixiJS clips the blurred pixels.
      const filterHalf = Math.ceil(glowRadius + blurStrength * 3 + 2);
      halo.filterArea = new Rectangle(
        -filterHalf,
        -filterHalf,
        filterHalf * 2,
        filterHalf * 2,
      );
      halo.filters = [new BlurFilter({ strength: blurStrength })];
      halo.x = p.sx;
      halo.y = p.sy;
      starsLayer.addChild(halo);

      // Body: opaque disc + diffraction spikes (Giant/Supergiant only).
      // Kept sharp — no filter — so the star reads as a point of
      // light against the soft halo.
      const body = new Graphics();
      body.circle(0, 0, bodyRadius).fill({
        color: bodyColor,
        alpha: STAR_BODY_ALPHA / 255,
      });
      if (sizeClass === 'Giant' || sizeClass === 'Supergiant') {
        const spikeLen = bodyRadius * 5;
        const spikeWidth = sizeClass === 'Supergiant' ? 0.8 : 0.5;
        const spikeAlpha = sizeClass === 'Supergiant' ? 0.6 : 0.45;
        body.moveTo(-spikeLen, 0).lineTo(spikeLen, 0).stroke({
          color: bodyColor,
          width: spikeWidth,
          alpha: spikeAlpha,
        });
        body.moveTo(0, -spikeLen).lineTo(0, spikeLen).stroke({
          color: bodyColor,
          width: spikeWidth,
          alpha: spikeAlpha,
        });
      }
      body.x = p.sx;
      body.y = p.sy;
      starsLayer.addChild(body);
    }
  }

  function paintSelectionRing(): void {
    selectionLayer.clear();
    if (currentSelectedId === NO_SELECTION) return;
    const star = currentGalaxy.stars.find(
      (s) => s.id === currentSelectedId,
    );
    if (!star) return;
    const p = projectStar(star, currentCamera, viewport, currentGalaxy.radius);
    selectionLayer.circle(p.sx, p.sy, HIT_RADIUS_PX + 4);
    selectionLayer.stroke({
      width: 1.5,
      color: COLOR_SELECTION_RING,
      alpha: 0.9,
    });
  }

  /** World radius in pixels at the current camera scale. */
  function worldRadiusPx(radius: number, c: Camera): number {
    if (radius <= 0) return 0;
    const minDim = Math.min(viewport.width, viewport.height);
    const base = Math.trunc(minDim / (2 * radius));
    // worldScale in pixels per galaxy unit = base * zoomPct / 100.
    // The disc occupies `radius` world units, so its pixel radius is
    // worldScale * radius.
    const sPx = Math.trunc((base * c.zoom) / 100);
    return sPx * radius;
  }

  // Wire up DOM listeners — convert client coords to canvas coords.
  const clientToCanvas = (clientX: number, clientY: number): ScreenPoint => {
    const rect = app.canvas.getBoundingClientRect();
    // Canvas may be CSS-scaled; the PixiJS render resolution is
    // rect.width x rect.height in CSS pixels (autoDensity handles the
    // backing-store scale).
    const sx = Math.floor(clientX - rect.left);
    const sy = Math.floor(clientY - rect.top);
    return { sx, sy };
  };

  // Initial paint.
  renderer_setGalaxy(initialGalaxy);
  renderer_setCamera(initialState.camera);
  renderer_setSelection(initialState.selectedId);
  repaint();

  function renderer_setGalaxy(galaxy: GalaxySubset): void {
    currentGalaxy = galaxy;
    galaxyDirty = true;
    paintDirty = true;
    repaint();
  }
  function renderer_setCamera(camera: Camera): void {
    currentCamera = camera;
    paintDirty = true;
    repaint();
  }
  function renderer_setSelection(selectedId: number): void {
    currentSelectedId = selectedId;
    ringDirty = true;
    paintDirty = true;
    repaint();
  }
  function renderer_destroy(): void {
    try {
      app.destroy(true, { children: true });
    } catch {
      /* already destroyed */
    }
  }

  return {
    setCamera: renderer_setCamera,
    setSelection: renderer_setSelection,
    setGalaxy: renderer_setGalaxy,
    screenPointFromClient: clientToCanvas,
    viewport,
    destroy: renderer_destroy,
  };
}

// ---------------------------------------------------------------------------
// Exports for the side panel
// ---------------------------------------------------------------------------

/** Re-export starName so the UI layer can label the selection. */
export { starName };