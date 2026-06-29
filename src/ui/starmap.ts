/**
 * PixiJS renderer for the galaxy star map.
 *
 * Iteration 1e — numeric star size, six-colour palette, layered bloom
 * rendering with a procedural starfield backdrop.
 *
 * Per-star layering (back to front, all under the selection ring):
 *   1. Outer halo (star's halo colour, ~3× body radius, low alpha,
 *      heavy Gaussian blur — atmospheric scatter)
 *   2. Inner bloom (star's body colour, ~1.7× body radius, medium
 *      alpha, medium Gaussian blur — colour glow)
 *   3. White core (pure white, body radius, opaque, lesser Gaussian
 *      blur — bright point of light)
 *   4. Tiny sharp center dot (pure white, ~0.4× body radius, opaque,
 *      unblurred — pixel-precise highlight for the brightest stars)
 *
 * Background:
 *   - Procedural starfield drawn first across the entire viewport.
 *     ~2000 deterministic dust stars at low alpha, ~80% white with
 *     the remaining 20% tinted warm/cool. Sits behind the galaxy disc.
 *
 * Reads pure camera + selection state from `src/sim/starmap.ts` and
 * paints it. All pixel layout decisions (world-to-screen transform,
 * viewport centring, aspect handling) come from the sim layer — this
 * module is a dumb projection of state into shapes.
 */

import { Application, BlurFilter, Container, Graphics } from 'pixi.js';
import {
  HIT_RADIUS_PX,
  NO_SELECTION,
  panTo as panCameraTo,
  projectOrigin,
  projectStar,
  starName,
  unprojectPoint,
  zoomCameraAround,
  type Camera,
  type GalaxySubset,
  type ScreenPoint,
  type StarmapState,
  type Viewport,
} from '../sim/starmap';
import {
  STAR_BLOOM_ALPHA,
  STAR_COLOR_FOR_COLOR,
  STAR_CORE_ALPHA,
  STAR_HALO_ALPHA,
  STAR_HALO_COLOR_FOR_COLOR,
  starBloomPx,
  starBodyPx,
  starHaloPx,
  type StarColor,
} from '../sim/galaxy';

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

const COLOR_DISC_FILL = 0x1a2545;
const COLOR_DISC_STROKE = 0x5070b0;
// Selection ring matches the galaxy disc stroke so the two rings
// read as the same "outline" hue across the starmap.
const COLOR_SELECTION_RING = COLOR_DISC_STROKE;
const COLOR_STAR_SELECTED = 0xffd07b;
const DISC_FILL_ALPHA = 0.35;

/**
 * Multiplier applied to every star's rendered pixel dimensions (halo,
 * bloom, core, highlight radius, and blur strength). The procedural
 * sizes produced by `star*Px()` mirror the Quint spec exactly; this
 * constant is a pure UI tuning knob so the visual size can be dialed
 * without touching the canonical spec.
 */
const STAR_DISPLAY_SCALE = 1.5;

/**
 * Independent multiplier on the blur strength only. Lets us soften the
 * glow without changing star sizes.
 */
const STAR_BLUR_SCALE = 0.75;

/**
 * Parse a "0xRRGGBB" hex string (the format used by STAR_COLOR_FOR_COLOR
 * and friends) into a 24-bit integer suitable for PixiJS colour APIs.
 * Returns 0 on malformed input — the appearance table is enforced by
 * unit tests, so a 0 only happens if the spec/TS tables are tampered
 * with at runtime, which we treat as a programmer error.
 */
function parseHexColor(hex: string): number {
  return parseInt(hex, 16) | 0;
}

// ---------------------------------------------------------------------------
// Procedural starfield
// ---------------------------------------------------------------------------

/**
 * Starfield dust parameters. Picked for a "dusty deep-space" feel —
 * many faint points with a handful of brighter highlights, slightly
 * warmer than pure white. The count is per-viewport-pixel-scaled so
 * density doesn't change with window size.
 */
const DUST_STARS_PER_KPX = 3.5; // ~2200 at 800x800, ~1900 at 700x600
const DUST_DENSITY_SEED = 0x57a3d51; // deterministic scatter across reloads

interface DustStar {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly color: number;
  readonly alpha: number;
}

/**
 * Generate a deterministic list of dust-star positions, sizes, and
 * colours for the given viewport. Uses a seeded PRNG so the same
 * viewport always renders the same backdrop.
 */
function generateDustStars(viewport: Viewport): DustStar[] {
  const rng = mulberry32(DUST_DENSITY_SEED);
  const areaPx = viewport.width * viewport.height;
  const count = Math.max(400, Math.round((areaPx / 1000) * DUST_STARS_PER_KPX));
  const stars: DustStar[] = [];
  for (let i = 0; i < count; i++) {
    const x = rng() * viewport.width;
    const y = rng() * viewport.height;
    // Mostly tiny (0.5 px), with a long tail of slightly bigger ones.
    const rRoll = rng();
    const radius = rRoll < 0.85 ? 0.6 : rRoll < 0.97 ? 1.0 : 1.5;
    // Alpha skewed low so most dust is barely visible.
    const alphaRoll = rng();
    const alpha = alphaRoll < 0.7 ? 0.18 : alphaRoll < 0.95 ? 0.32 : 0.55;
    // Colour: 80% white-ish, 10% warm, 10% cool.
    const cRoll = rng();
    let color: number;
    if (cRoll < 0.8) color = 0xeeeeff;
    else if (cRoll < 0.9) color = 0xffd9a8;
    else color = 0xb0c8ff;
    stars.push({ x, y, radius, color, alpha });
  }
  return stars;
}

/**
 * Paint the procedural starfield onto a single Graphics. Batched into
 * one draw call rather than 2000 PixiJS objects for performance.
 * Tiny circles drawn with low alpha blend to give the dusty-stars look.
 */
function paintDust(target: Graphics, dust: DustStar[], _viewport: Viewport): void {
  target.clear();
  for (const d of dust) {
    target.circle(d.x, d.y, d.radius).fill({
      color: d.color,
      alpha: d.alpha,
    });
  }
}

/**
 * Deterministic seeded PRNG (Mulberry32). Same seed -> same sequence.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
  /** The camera currently being rendered. May differ from the sim
   *  source-of-truth while a zoom tween is in flight. */
  getCamera(): Camera;
  /**
   * Animate a multiplicative zoom centred on `anchor`, using the
   * same zoom-preserves-anchor math as the rest of the sim. Returns
   * a promise that resolves with the final camera when the tween
   * completes (or rejects with `'Superseded'` if a newer tween is
   * started before this one finishes).
   */
  zoomBy(factorPct: number, anchor: ScreenPoint): Promise<Camera>;
  /**
   * Animate the camera so that `worldPoint` ends up at the screen
   * centre. Zoom is preserved. The same promise semantics as
   * `zoomBy` — resolves with the final camera or rejects with
   * `'Superseded'` if a newer tween pre-empts this one.
   */
  panTo(
    worldPoint: { readonly x: number; readonly y: number },
    durationMs: number,
  ): Promise<Camera>;
  /**
   * Convert a click in container-local client coordinates to a
   * world-space Position using the currently rendered camera.
   * Useful for click-to-recenter handlers.
   */
  worldPointFromClient(clientX: number, clientY: number): {
    readonly x: number;
    readonly y: number;
  };
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

  // Layer order (back to front):
  //   dust      procedural starfield background
  //   disc      galaxy disc fill + outline
  //   stars     per-star layered bloom
  //   ring      selection highlight
  const dustLayer = new Graphics();
  const disc = new Graphics();
  const starsLayer = new Container();
  const selectionLayer = new Graphics();
  root.addChild(dustLayer);
  root.addChild(disc);
  root.addChild(starsLayer);
  root.addChild(selectionLayer);

  // Pre-render the procedural starfield. It doesn't depend on galaxy
  // or camera state, so we paint it once at mount and forget.
  paintDust(dustLayer, generateDustStars(viewport), viewport);

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

  // -------------------------------------------------------------------------
  // Zoom animation
  // -------------------------------------------------------------------------
  //
  // A small requestAnimationFrame-friendly tween system that lerps the
  // camera from its current rendered value to a target. Used by the zoom
  // buttons so clicking "zoom in" glides instead of snapping. Pan is
  // lerped linearly alongside zoom; for a centre-anchored zoom the target
  // pan equals the source pan (the anchor-preserving math gives
  // `newPan = oldPan` when `anchor = (cx, cy)`), so this lerp is a no-op
  // and the centred world point stays exactly under the centre throughout
  // the tween — no drift.
  //
  // A new tween supersedes any in-flight one (its promise rejects with
  // `'Superseded'`); the caller can ignore that.

  const ZOOM_ANIMATION_MS = 180;

  type ActiveTween = {
    from: Camera;
    to: Camera;
    startTime: number;
    duration: number;
    resolve: (camera: Camera) => void;
    reject: (reason: Error) => void;
  };

  let activeTween: ActiveTween | null = null;

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  let activeRaf: number | null = null;

  function startCameraTween(target: Camera, durationMs: number): Promise<Camera> {
    if (activeTween) {
      const old = activeTween;
      activeTween = null;
      old.reject(new Error('Superseded'));
    }
    const tween: ActiveTween = {
      from: {
        pan: { x: currentCamera.pan.x, y: currentCamera.pan.y },
        zoom: currentCamera.zoom,
      },
      to: { pan: { x: target.pan.x, y: target.pan.y }, zoom: target.zoom },
      startTime: performance.now(),
      duration: Math.max(1, durationMs),
      resolve: () => {},
      reject: () => {},
    };
    activeTween = tween;
    return new Promise<Camera>((resolve, reject) => {
      tween.resolve = resolve;
      tween.reject = reject;
      if (activeRaf !== null) cancelAnimationFrame(activeRaf);
      activeRaf = requestAnimationFrame(tickCameraTween);
    });
  }

  function tickCameraTween(): void {
    activeRaf = null;
    if (!activeTween) return;
    const { from, to, startTime, duration, resolve } = activeTween;
    const raw = (performance.now() - startTime) / duration;
    const t = raw >= 1 ? 1 : raw <= 0 ? 0 : raw;
    const eased = easeOutCubic(t);
    currentCamera = {
      pan: {
        x: from.pan.x + (to.pan.x - from.pan.x) * eased,
        y: from.pan.y + (to.pan.y - from.pan.y) * eased,
      },
      zoom: from.zoom + (to.zoom - from.zoom) * eased,
    };
    paintDirty = true;
    repaint();
    if (t >= 1) {
      // Snap to exact target so the final frame is the precise camera.
      currentCamera = { pan: { ...to.pan }, zoom: to.zoom };
      paintDirty = true;
      repaint();
      activeTween = null;
      resolve(to);
    } else {
      activeRaf = requestAnimationFrame(tickCameraTween);
    }
  }

  function renderer_zoomBy(
    factorPct: number,
    anchor: ScreenPoint,
  ): Promise<Camera> {
    // zoomCameraAround needs a StarmapState but only reads .camera.
    const fromState: StarmapState = {
      camera: currentCamera,
      selectedId: NO_SELECTION,
    };
    const next = zoomCameraAround(
      fromState,
      factorPct,
      anchor,
      viewport,
      currentGalaxy.radius,
    );
    return startCameraTween(next.camera, ZOOM_ANIMATION_MS);
  }

  function renderer_panTo(
    worldPoint: { readonly x: number; readonly y: number },
    durationMs: number,
  ): Promise<Camera> {
    // panCameraTo reads only .camera.
    const fromState: StarmapState = {
      camera: currentCamera,
      selectedId: NO_SELECTION,
    };
    const next = panCameraTo(fromState, worldPoint);
    return startCameraTween(next.camera, Math.max(1, durationMs));
  }

  function unprojectClient(clientX: number, clientY: number) {
    return unprojectPoint(
      clientToCanvas(clientX, clientY),
      currentCamera,
      viewport,
      currentGalaxy.radius,
    );
  }

  function paintDisc(): void {
    disc.clear();
    const rPx = worldRadiusPx(currentGalaxy.radius, currentCamera);
    if (rPx <= 0) return;
    // The disc is anchored at the galaxy origin in world space, so
    // its screen position is the projected origin — not the viewport
    // centre. This makes the disc move with the camera pan.
    const origin = projectOrigin(currentCamera, viewport, currentGalaxy.radius);
    const cx = origin.sx;
    const cy = origin.sy;
    disc.circle(cx, cy, rPx).fill({ color: COLOR_DISC_FILL, alpha: DISC_FILL_ALPHA });
    disc.circle(cx, cy, rPx).stroke({
      width: 1.5,
      color: COLOR_DISC_STROKE,
      alpha: 0.5,
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
      paintStar(s.id, s.color, s.size, p.sx, p.sy, isSelected);
    }
  }

  /**
   * Render a single star as a layered bloom at screen position
   * (sx, sy). All pixel choices are derived from the numeric size;
   * there is no per-galaxy tuning.
   */
  function paintStar(
    _id: number,
    color: StarColor,
    size: number,
    sx: number,
    sy: number,
    isSelected: boolean,
  ): void {
    const bodyRadius = Math.max(
      1,
      Math.round(starBodyPx(size) * STAR_DISPLAY_SCALE + (isSelected ? 2 : 0)),
    );
    const bloomRadius = Math.round(starBloomPx(size) * STAR_DISPLAY_SCALE);
    const haloRadius = Math.round(starHaloPx(size) * STAR_DISPLAY_SCALE);

    const bodyColor = isSelected
      ? COLOR_STAR_SELECTED
      : parseHexColor(STAR_COLOR_FOR_COLOR[color]);
    const haloColor = isSelected
      ? COLOR_STAR_SELECTED
      : parseHexColor(STAR_HALO_COLOR_FOR_COLOR[color]);

    // ---- One blurred star ----------------------------------------------
    // The glow (halo + bloom + white core) is rendered on a single
    // Graphics so a single BlurFilter can be applied. filterArea is
    // intentionally NOT set — PixiJS v8 auto-computes it from the
    // children's local bounds, which (since every circle is drawn at
    // local origin) is a rectangle centred on (0,0). The previous
    // per-layer manual filterArea caused off-centre rendering.
    const glow = new Graphics();
    glow.circle(0, 0, haloRadius).fill({
      color: haloColor,
      alpha: STAR_HALO_ALPHA / 255,
    });
    glow.circle(0, 0, bloomRadius).fill({
      color: bodyColor,
      alpha: STAR_BLOOM_ALPHA / 255,
    });
    glow.circle(0, 0, bodyRadius).fill({
      color: 0xffffff,
      alpha: STAR_CORE_ALPHA / 255,
    });
    glow.filters = [
      new BlurFilter({ strength: 2.5 * STAR_DISPLAY_SCALE * STAR_BLUR_SCALE }),
    ];
    glow.x = sx;
    glow.y = sy;
    starsLayer.addChild(glow);

    // ---- Sharp highlight dot ------------------------------------------
    // Rendered separately, outside the blurred Graphics, so the very
    // brightest stars still have a pixel-precise point of light against
    // the soft glow.
    const highlightRadius = Math.max(
      0.5,
      bodyRadius * 0.4 * STAR_DISPLAY_SCALE,
    );
    const highlight = new Graphics();
    highlight.circle(0, 0, highlightRadius).fill({
      color: 0xffffff,
      alpha: 1,
    });
    highlight.x = sx;
    highlight.y = sy;
    starsLayer.addChild(highlight);
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
    getCamera: () => currentCamera,
    zoomBy: renderer_zoomBy,
    panTo: renderer_panTo,
    worldPointFromClient: unprojectClient,
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

/**
 * Test seam — paint one star into a fresh Graphics so unit tests
 * can assert on the layer set without standing up the full renderer.
 */
export function _paintStarForTest(opts: {
  graphics: Graphics;
  color: StarColor;
  size: number;
  isSelected?: boolean;
}): void {
  const { graphics, color, size } = opts;
  const isSelected = opts.isSelected ?? false;

  const bodyRadius = Math.max(1, Math.round(starBodyPx(size) + (isSelected ? 2 : 0)));
  const bloomRadius = starBloomPx(size);
  const haloRadius = starHaloPx(size);

  const bodyColor = isSelected
    ? COLOR_STAR_SELECTED
    : parseHexColor(STAR_COLOR_FOR_COLOR[color]);
  const haloColor = isSelected
    ? COLOR_STAR_SELECTED
    : parseHexColor(STAR_HALO_COLOR_FOR_COLOR[color]);

  // Halo (blurred).
  graphics.circle(0, 0, haloRadius).fill({
    color: haloColor,
    alpha: STAR_HALO_ALPHA / 255,
  });
  // Inner bloom (blurred).
  graphics.circle(0, 0, bloomRadius).fill({
    color: bodyColor,
    alpha: STAR_BLOOM_ALPHA / 255,
  });
  // White core.
  graphics.circle(0, 0, bodyRadius).fill({
    color: 0xffffff,
    alpha: STAR_CORE_ALPHA / 255,
  });
}

// Internal constants re-exported for tests / future use.
export { STAR_BLOOM_ALPHA, STAR_HALO_ALPHA, STAR_CORE_ALPHA };