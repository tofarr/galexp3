/**
 * Star map camera + selection model.
 *
 * Iteration 1b. Mirrors quint/starmap.qnt.
 * Pure module — no I/O, no rendering, no DOM. The PixiJS layer in
 * src/ui/ consumes this and draws the disc + stars + panel.
 *
 * Coordinate system (identical to the Quint spec):
 *   Galaxy: (0, 0) is disc centre, +x right, +y up.
 *           Positions are integers (mirror of galaxy.qnt).
 *   Screen: (0, 0) is top-left of the viewport, +x right, +y down.
 *
 * Zoom is an integer percentage of the base scale: 100 = 1.0x.
 * Constrained to [MIN_ZOOM_PCT, MAX_ZOOM_PCT]. Every projection uses
 * integer arithmetic with a final division by ZOOM_DENOMINATOR so
 * the TS and Quint implementations agree bit-for-bit at integer
 * granularity.
 *
 * Selection is represented by a sentinel: `selectedId === 0` means
 * no selection. Star ids in galaxy.qnt are dense integers starting
 * at 1, so 0 is a safe sentinel. This mirrors the spec and avoids
 * the need for a sum type or optional wrapper in this version of
 * Quint.
 */

import type { Position, Star } from './galaxy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ScreenPoint {
  readonly sx: number;
  readonly sy: number;
}

export interface Pan {
  readonly x: number;
  readonly y: number;
}

export type Zoom = number;

export interface Viewport {
  readonly width: number;
  readonly height: number;
}

export interface Camera {
  readonly pan: Pan;
  readonly zoom: Zoom;
}

/**
 * Subset of the galaxy needed by camera + selection. Decouples this
 * module from galaxy.qnt's full Galaxy type so it can be tested in
 * isolation.
 */
export interface GalaxySubset {
  readonly radius: number;
  readonly stars: ReadonlyArray<Star>;
}

export interface StarmapState {
  readonly camera: Camera;
  /** 0 means no selection. */
  readonly selectedId: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Sentinel for "no selection". Star ids start at 1 in galaxy.qnt. */
export const NO_SELECTION = 0;

/** Zoom denominator. The "true" zoom is zoomPct / ZOOM_DENOMINATOR. */
export const ZOOM_DENOMINATOR = 100;

/** Minimum zoom percent (0.25x). */
export const MIN_ZOOM_PCT = 25;

/** Maximum zoom percent (8.0x). */
export const MAX_ZOOM_PCT = 800;

/** Initial zoom percent (1.0x). */
export const INITIAL_ZOOM_PCT = 100;

/** Hit-test tolerance in screen pixels (Chebyshev radius). */
export const HIT_RADIUS_PX = 12;

/** Initial camera: centred on the galaxy origin, zoom = 1.0x. */
export const initialCamera: Camera = {
  pan: { x: 0, y: 0 },
  zoom: INITIAL_ZOOM_PCT,
};

/** Initial starmap state — no selection. */
export const initialState: StarmapState = {
  camera: initialCamera,
  selectedId: NO_SELECTION,
};

// ---------------------------------------------------------------------------
// Coordinate transforms
// ---------------------------------------------------------------------------

/**
 * Integer division that truncates toward zero, with a guard against
 * divide-by-zero. Mirrors `minDiv` in the Quint spec.
 */
function minDiv(a: number, b: number): number {
  if (b <= 0) return 0;
  // JS `/` already truncates toward zero for non-negative operands;
  // we use `Math.trunc` to keep the spec parity for negative values.
  return Math.trunc(a / b);
}

/**
 * Base scale: pixels per galaxy unit at zoom = 1.0x. Uses the smaller
 * viewport dimension so the disc fits even on non-square viewports.
 */
export function baseScale(v: Viewport, radius: number): number {
  if (radius <= 0) return 0;
  const minDim = v.width < v.height ? v.width : v.height;
  return minDiv(minDim, 2 * radius);
}

/**
 * Effective world-to-screen scale at the current zoom, in pixels per
 * galaxy unit. = baseScale * zoomPct / ZOOM_DENOMINATOR.
 */
export function worldScale(v: Viewport, radius: number, zoomPct: number): number {
  return minDiv(baseScale(v, radius) * zoomPct, ZOOM_DENOMINATOR);
}

/**
 * Convert a galaxy point to a screen point (integer pixels).
 * Y is flipped: galaxy +y is up, screen +y is down.
 * worldScale already incorporates /ZOOM_DENOMINATOR so the final
 * pixel offset is `dx * sPx` with no further division.
 */
export function projectStar(
  s: Star,
  c: Camera,
  v: Viewport,
  radius: number,
): ScreenPoint {
  const sPx = worldScale(v, radius, c.zoom);
  const cx = Math.trunc(v.width / 2);
  const cy = Math.trunc(v.height / 2);
  const dx = (s.position.x - c.pan.x) * sPx;
  const dy = (s.position.y - c.pan.y) * sPx;
  return {
    sx: cx + dx,
    sy: cy - dy,
  };
}

/**
 * Screen position of the galaxy origin (world (0, 0)) under the
 * given camera. Equivalent to `projectStar({position:{x:0,y:0},...},
 * c, v, radius)` without needing a synthetic Star. Used by the
 * renderer to draw the disc / selection ring at the correct
 * on-screen location when the camera is panned.
 */
export function projectOrigin(
  c: Camera,
  v: Viewport,
  radius: number,
): ScreenPoint {
  const sPx = worldScale(v, radius, c.zoom);
  const cx = Math.trunc(v.width / 2);
  const cy = Math.trunc(v.height / 2);
  return {
    sx: cx - c.pan.x * sPx,
    sy: cy + c.pan.y * sPx,
  };
}

/**
 * Inverse of projectStar. Given a screen point, return the galaxy
 * point that maps to it under the current camera. The un-truncated
 * world scale is `baseScale * zoomPct`; dividing by `worldScale`
 * would re-introduce the truncation that happened inside
 * worldScale, doubling the integer-rounding error.
 */
export function unprojectPoint(
  p: ScreenPoint,
  c: Camera,
  v: Viewport,
  radius: number,
): Position {
  const sUntrunc = baseScale(v, radius) * c.zoom;
  const cx = Math.trunc(v.width / 2);
  const cy = Math.trunc(v.height / 2);
  const dx = minDiv((p.sx - cx) * ZOOM_DENOMINATOR, sUntrunc);
  const dy = minDiv((cy - p.sy) * ZOOM_DENOMINATOR, sUntrunc);
  return { x: c.pan.x + dx, y: c.pan.y + dy };
}

/** Integer absolute value. */
function absI(n: number): number {
  return n < 0 ? -n : n;
}

/** Chebyshev distance between two screen points. */
function chebyshev(p: ScreenPoint, q: ScreenPoint): number {
  const adx = absI(p.sx - q.sx);
  const ady = absI(p.sy - q.sy);
  return adx > ady ? adx : ady;
}

/**
 * True iff a star's screen position is within HIT_RADIUS_PX of a
 * given screen point (Chebyshev distance).
 */
export function isStarAtPoint(
  s: Star,
  p: ScreenPoint,
  c: Camera,
  v: Viewport,
  radius: number,
): boolean {
  return chebyshev(projectStar(s, c, v, radius), p) <= HIT_RADIUS_PX;
}

/**
 * Hit-test: return the id of the star under screen point `p`, or
 * `NO_SELECTION` if no star is within the hit-test radius. Among
 * candidates, the one with the smallest Chebyshev distance wins;
 * deterministic tie-break by smallest id.
 */
export function starAtPoint(
  p: ScreenPoint,
  g: GalaxySubset,
  c: Camera,
  v: Viewport,
): number {
  const candidates: Star[] = [];
  for (const s of g.stars) {
    if (isStarAtPoint(s, p, c, v, g.radius)) candidates.push(s);
  }
  if (candidates.length === 0) return NO_SELECTION;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const s of candidates) {
    const d = chebyshev(projectStar(s, c, v, g.radius), p);
    if (d < bestDist) bestDist = d;
  }
  let minId = Number.POSITIVE_INFINITY;
  for (const s of candidates) {
    if (chebyshev(projectStar(s, c, v, g.radius), p) === bestDist && s.id < minId) {
      minId = s.id;
    }
  }
  return minId;
}

// ---------------------------------------------------------------------------
// Camera predicates
// ---------------------------------------------------------------------------

export function isValidZoom(z: number): boolean {
  return z >= MIN_ZOOM_PCT && z <= MAX_ZOOM_PCT;
}

export function isValidCamera(c: Camera): boolean {
  return isValidZoom(c.zoom);
}

/**
 * True iff the selection refers to a star that exists in `g`, or
 * is the no-selection sentinel.
 */
export function isSelectionValid(selId: number, g: GalaxySubset): boolean {
  if (selId === NO_SELECTION) return true;
  for (const s of g.stars) {
    if (s.id === selId) return true;
  }
  return false;
}

/** True iff a starmap state is internally consistent. */
export function isValidState(state: StarmapState, g: GalaxySubset): boolean {
  return isValidCamera(state.camera) && isSelectionValid(state.selectedId, g);
}

// ---------------------------------------------------------------------------
// State transitions
// ---------------------------------------------------------------------------

/**
 * Select a star by id. Returns the new state unchanged if `id` does
 * not correspond to a star in `g`.
 */
export function selectStar(
  state: StarmapState,
  id: number,
  g: GalaxySubset,
): StarmapState {
  for (const s of g.stars) {
    if (s.id === id) return { ...state, selectedId: id };
  }
  return state;
}

/** Clear the current selection. */
export function clearSelection(state: StarmapState): StarmapState {
  return { ...state, selectedId: NO_SELECTION };
}

/**
 * Pan the camera by a screen-space delta. Positive `dx` pans the
 * view right; positive `dy` pans the view down. Uses the
 * un-truncated scale `baseScale * zoomPct` for consistency with
 * unprojectPoint.
 */
export function panCamera(
  state: StarmapState,
  dx: number,
  dy: number,
  v: Viewport,
  radius: number,
): StarmapState {
  const sUntrunc = baseScale(v, radius) * state.camera.zoom;
  const dgx = minDiv(dx * ZOOM_DENOMINATOR, sUntrunc);
  const dgy = minDiv(dy * ZOOM_DENOMINATOR, sUntrunc);
  return {
    ...state,
    camera: {
      ...state.camera,
      pan: {
        x: state.camera.pan.x + dgx,
        y: state.camera.pan.y - dgy,
      },
    },
  };
}

/** Clamp a zoom percent into the allowed range. */
export function clampZoom(z: number): number {
  if (z < MIN_ZOOM_PCT) return MIN_ZOOM_PCT;
  if (z > MAX_ZOOM_PCT) return MAX_ZOOM_PCT;
  return z;
}

/**
 * True iff the given world point lies inside (or on the boundary of)
 * the galaxy disc of the given radius. The disc is centred on the
 * galaxy origin (0, 0).
 */
export function isInsideGalaxy(world: Position, radius: number): boolean {
  return world.x * world.x + world.y * world.y <= radius * radius;
}

/**
 * Build a camera with `pan` set to `worldPoint` and `zoom` preserved.
 * Used to recentre the view so that `worldPoint` ends up at the
 * screen centre. Zoom is unchanged — this is a pure pan.
 */
export function panTo(
  state: StarmapState,
  worldPoint: Position,
): StarmapState {
  return {
    ...state,
    camera: {
      ...state.camera,
      pan: { x: worldPoint.x, y: worldPoint.y },
    },
  };
}

/**
 * Zoom around a screen-space anchor. After the zoom, the galaxy point
 * under `anchor` is still under `anchor`. Zoom is clamped to the
 * allowed range and pan is adjusted so the anchor stays put.
 * Uses un-truncated scales (`baseScale * zoomPct`) for consistency
 * with unprojectPoint.
 */
export function zoomCameraAround(
  state: StarmapState,
  factorPct: number,
  anchor: ScreenPoint,
  v: Viewport,
  radius: number,
): StarmapState {
  const oldZ = state.camera.zoom;
  const newZraw = minDiv(oldZ * factorPct, ZOOM_DENOMINATOR);
  const newZ = clampZoom(newZraw);
  const cx = Math.trunc(v.width / 2);
  const cy = Math.trunc(v.height / 2);
  const sOldUntrunc = baseScale(v, radius) * oldZ;
  const sNewUntrunc = baseScale(v, radius) * newZ;
  // World point under anchor before zoom.
  const wx =
    state.camera.pan.x +
    minDiv((anchor.sx - cx) * ZOOM_DENOMINATOR, sOldUntrunc);
  const wy =
    state.camera.pan.y +
    minDiv((cy - anchor.sy) * ZOOM_DENOMINATOR, sOldUntrunc);
  // After zoom, set pan so (wx, wy) maps back to anchor.
  const newPanX =
    wx - minDiv((anchor.sx - cx) * ZOOM_DENOMINATOR, sNewUntrunc);
  const newPanY =
    wy - minDiv((cy - anchor.sy) * ZOOM_DENOMINATOR, sNewUntrunc);
  return {
    ...state,
    camera: { pan: { x: newPanX, y: newPanY }, zoom: newZ },
  };
}

// ---------------------------------------------------------------------------
// Parity test values
// ---------------------------------------------------------------------------

/**
 * Hand-computed expected values for a small canonical input set.
 * Used by the Quint <-> TS parity tests to catch any drift between
 * the spec and the TS mirror. The numbers were computed by hand
 * from the spec's integer formulas:
 *
 *   baseScale(800x600, 70)  = floor(min(800,600) / 140)
 *                          = floor(600 / 140)
 *                          = 4
 *
 *   worldScale at 100%     = baseScale * 100 / 100 = 4
 *
 *   projectStar(star10, 0,0; 100%, 800x600, 70)
 *       s_px = 4
 *       cx = 400, cy = 300
 *       dx = (10 - 0) * 4 = 40
 *       sx = 400 + 40 = 440
 *       dy = (0 - 0) * 4 = 0
 *       sy = 300 - 0 = 300
 *
 *   zoomByOneIsNoop 1.0x around (100, 100) — by construction, noop.
 */
export const STARMAP_TEST_VALUES = {
  baseScale800x600r70: 4,
  worldScale100: 4,
  projectStarYellowSX: 440,
  projectStarYellowSY: 300,
  zoomByOneIsNoopZoom: 100,
  zoomByOneIsNoopPanX: 0,
  zoomByOneIsNoopPanY: 0,
} as const;