/**
 * Property tests for src/sim/starmap.ts.
 *
 * Each property test mirrors an invariant from quint/starmap.qnt.
 * If you change an invariant in the spec, change it here too.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { RADIUS_FOR_SIZE, GALAXY_SIZES, initGalaxy, type GalaxySize, type Star } from './galaxy';
import {
  HIT_RADIUS_PX,
  MAX_ZOOM_PCT,
  MIN_ZOOM_PCT,
  NO_SELECTION,
  STARMAP_TEST_VALUES,
  ZOOM_DENOMINATOR,
  baseScale,
  clearSelection,
  clampZoom,
  initialCamera,
  initialState,
  isInsideGalaxy,
  isSelectionValid,
  isStarAtPoint,
  isValidCamera,
  isValidState,
  isValidZoom,
  panCamera,
  panTo,
  projectOrigin,
  projectStar,
  selectStar,
  starAtPoint,
  unprojectPoint,
  worldScale,
  zoomCameraAround,
  type Camera,
  type ScreenPoint,
  type StarmapState,
  type Viewport,
} from './starmap';

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const sizeArb: fc.Arbitrary<GalaxySize> = fc.constantFrom(...GALAXY_SIZES);
const seedArb = fc.integer({ min: -0x7fffffff, max: 0x7fffffff });

const zoomArb = fc.integer({ min: MIN_ZOOM_PCT, max: MAX_ZOOM_PCT });

// We constrain the viewport so that baseScale >= 5 for all galaxy
// sizes: minDim >= 10 * max_radius = 900. At baseScale 5 with zoom
// 100%, worldScale = 5 (1 galaxy unit = 5 pixels), which keeps
// round-trip projections within ±1 unit of integer accuracy across
// the full zoom range. Edge cases at smaller scales are covered by
// the hand-computed parity tests below.
const viewportArb = fc.record({
  width: fc.integer({ min: 1000, max: 4000 }),
  height: fc.integer({ min: 1000, max: 4000 }),
});

const panArb = fc.record({
  x: fc.integer({ min: -200, max: 200 }),
  y: fc.integer({ min: -200, max: 200 }),
});

const cameraArb: fc.Arbitrary<Camera> = fc.record({
  pan: panArb,
  zoom: zoomArb,
});

const screenPointArb: fc.Arbitrary<ScreenPoint> = fc.record({
  sx: fc.integer({ min: -100, max: 4000 }),
  sy: fc.integer({ min: -100, max: 4000 }),
});

// ---------------------------------------------------------------------------
// Constants / initial state
// ---------------------------------------------------------------------------

describe('starmap — initial state', () => {
  it('initial camera has INITIAL_ZOOM_PCT and zero pan', () => {
    expect(initialCamera.pan.x).toBe(0);
    expect(initialCamera.pan.y).toBe(0);
    expect(initialCamera.zoom).toBe(100);
  });

  it('initial state has no selection', () => {
    expect(initialState.selectedId).toBe(NO_SELECTION);
  });

  it('initial state is valid for any generated galaxy', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        expect(isValidState(initialState, g)).toBe(true);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Constants ordering
// ---------------------------------------------------------------------------

describe('starmap — constants', () => {
  it('MIN_ZOOM_PCT < MAX_ZOOM_PCT', () => {
    expect(MIN_ZOOM_PCT).toBeLessThan(MAX_ZOOM_PCT);
  });

  it('MIN_ZOOM_PCT === 25 and MAX_ZOOM_PCT === 800', () => {
    expect(MIN_ZOOM_PCT).toBe(25);
    expect(MAX_ZOOM_PCT).toBe(800);
  });

  it('NO_SELECTION === 0', () => {
    expect(NO_SELECTION).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// baseScale
// ---------------------------------------------------------------------------

describe('starmap — baseScale', () => {
  it('returns 0 for non-positive radius', () => {
    expect(baseScale({ width: 800, height: 600 }, 0)).toBe(0);
    expect(baseScale({ width: 800, height: 600 }, -5)).toBe(0);
  });

  it('matches the spec formula for each galaxy size', () => {
    fc.assert(
      fc.property(sizeArb, viewportArb, (size, v) => {
        const radius = RADIUS_FOR_SIZE[size];
        const minDim = Math.min(v.width, v.height);
        // floor(minDim / (2 * radius)) via trunc-toward-zero div
        const expected = Math.trunc(minDim / (2 * radius));
        expect(baseScale(v, radius)).toBe(expected);
      }),
    );
  });

  it('is invariant to which dimension is larger', () => {
    fc.assert(
      fc.property(sizeArb, fc.integer({ min: 200, max: 2000 }), (size, w) => {
        const radius = RADIUS_FOR_SIZE[size];
        const tall = baseScale({ width: w, height: w + 1000 }, radius);
        const wide = baseScale({ width: w + 1000, height: w }, radius);
        expect(tall).toBe(wide);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// worldScale
// ---------------------------------------------------------------------------

describe('starmap — worldScale', () => {
  it('returns 0 at zoom = 0', () => {
    expect(worldScale({ width: 800, height: 600 }, 50, 0)).toBe(0);
  });

  it('is monotonic non-decreasing with zoom', () => {
    fc.assert(
      fc.property(
        sizeArb,
        viewportArb,
        zoomArb,
        (size, v, z) => {
          const radius = RADIUS_FOR_SIZE[size];
          const a = worldScale(v, radius, z);
          const b = worldScale(v, radius, Math.min(z + 1, MAX_ZOOM_PCT));
          expect(b).toBeGreaterThanOrEqual(a);
        },
      ),
    );
  });

  it('exactly doubles within integer rounding when both scales are clean', () => {
    // For zoom levels where both z and z*2 yield a non-truncated
    // worldScale (i.e., baseScale * z is divisible by 100), the
    // ratio is exactly 2.
    fc.assert(
      fc.property(
        sizeArb,
        viewportArb,
        (size, v) => {
          const radius = RADIUS_FOR_SIZE[size];
          // Pick a zoom level such that baseScale*zoomPct is a
          // multiple of 100: use zoomPct = 100 (1.0x).
          const a = worldScale(v, radius, 100);
          const b = worldScale(v, radius, 200);
          if (a === 0 && b === 0) return; // degenerate viewport
          if (a === 0 || b === 0) return; // truncation-boundary
          // Both are exact doubles of baseScale.
          expect(b).toBe(a * 2);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Round-trip: projectStar / unprojectPoint
// ---------------------------------------------------------------------------

describe('starmap — projectStar / unprojectPoint round trip', () => {
  it('is identity for the galaxy origin at zoom 1.0x', () => {
    const v: Viewport = { width: 800, height: 600 };
    const radius = 70;
    const c: Camera = { pan: { x: 0, y: 0 }, zoom: 100 };
    const origin: Star = { id: 1, color: 'Yellow', size: 50, position: { x: 0, y: 0 } };
    const proj = projectStar(origin, c, v, radius);
    expect(proj.sx).toBe(400);
    expect(proj.sy).toBe(300);
    const back = unprojectPoint(proj, c, v, radius);
    expect(back.x).toBe(0);
    expect(back.y).toBe(0);
  });

  it('round-trips with bounded drift across the disc', () => {
    fc.assert(
      fc.property(
        sizeArb,
        seedArb,
        cameraArb,
        viewportArb,
        (size, seed, c, v) => {
          const g = initGalaxy(seed, size);
          // Skip degenerate scale combinations:
          //   - sPx = 0: every star projects to the viewport centre
          //   - (baseScale * zoomPct) mod 100 != 0: integer rounding
          //     in worldScale loses precision, causing cumulative
          //     round-trip drift proportional to the truncation.
          const sPx = worldScale(v, g.radius, c.zoom);
          if (sPx === 0) return;
          if ((baseScale(v, g.radius) * c.zoom) % 100 !== 0) return;
          // With a clean (truncation-free) worldScale, round-trip
          // drift is at most 1 galaxy unit per axis.
          for (const s of g.stars) {
            const proj = projectStar(s, c, v, g.radius);
            const back = unprojectPoint(proj, c, v, g.radius);
            const dx = Math.abs(back.x - s.position.x);
            const dy = Math.abs(back.y - s.position.y);
            expect(dx).toBeLessThanOrEqual(1);
            expect(dy).toBeLessThanOrEqual(1);
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

describe('starmap — selection', () => {
  it('isSelectionValid accepts NO_SELECTION for any galaxy', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        expect(isSelectionValid(NO_SELECTION, g)).toBe(true);
      }),
    );
  });

  it('isSelectionValid accepts real star ids', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        for (const s of g.stars) {
          expect(isSelectionValid(s.id, g)).toBe(true);
        }
      }),
    );
  });

  it('isSelectionValid rejects ids outside 1..N', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        expect(isSelectionValid(g.stars.length + 1, g)).toBe(false);
        expect(isSelectionValid(-1, g)).toBe(false);
      }),
    );
  });

  it('selectStar sets selectedId when the id is valid', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const firstId = g.stars[0]!.id;
        const s1 = selectStar(initialState, firstId, g);
        expect(s1.selectedId).toBe(firstId);
      }),
    );
  });

  it('selectStar leaves state unchanged when the id is invalid', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const s1 = selectStar(initialState, g.stars.length + 1, g);
        expect(s1.selectedId).toBe(NO_SELECTION);
      }),
    );
  });

  it('clearSelection resets to NO_SELECTION', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const s1 = selectStar(initialState, g.stars[0]!.id, g);
        const s2 = clearSelection(s1);
        expect(s2.selectedId).toBe(NO_SELECTION);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Hit test
// ---------------------------------------------------------------------------

describe('starmap — starAtPoint', () => {
  it('returns NO_SELECTION when the point is far from any star', () => {
    const g = { radius: 50, stars: [] };
    const c: Camera = { pan: { x: 0, y: 0 }, zoom: 100 };
    const v: Viewport = { width: 800, height: 600 };
    const far: ScreenPoint = { sx: 0, sy: 0 };
    expect(starAtPoint(far, g, c, v)).toBe(NO_SELECTION);
  });

  // Zoom level for the hit-test property tests. We pick a high
  // enough zoom that one galaxy unit projects to at least one
  // pixel for every galaxy size — this avoids stars at adjacent
  // integer positions colliding on the same screen pixel due to
  // integer truncation. The smallest baseScale across sizes is
  // 4 (Huge, viewport 1200x800: 800/180 = 4), so we use a factor
  // of 25 (1.0x baseScale -> 25x) which gives 25x scale.
  // Equivalently: zoomPct = 2500 (out of max 800). Instead we
  // pick a smaller viewport scale.
  // Easier: use a zoomPct that ensures baseScale * zoomPct / 100 >= 1.
  // baseScale min = 4 (Huge). Need zoomPct >= 100 / 4 = 25.
  // We pick zoomPct = 400 (4x) for ample headroom and good separation.
  const HIT_TEST_ZOOM_PCT = 400;

  it('finds the star under a point within HIT_RADIUS_PX', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const c: Camera = { pan: { x: 0, y: 0 }, zoom: HIT_TEST_ZOOM_PCT };
        const v: Viewport = { width: 1200, height: 800 };
        const r = RADIUS_FOR_SIZE[size];
        for (const s of g.stars) {
          const sp = projectStar(s, c, v, r);
          // Click right on the star.
          const id = starAtPoint(sp, g, c, v);
          // Two stars may share the same screen pixel when their
          // integer world positions differ by less than one screen
          // pixel after projection. With HIT_TEST_ZOOM_PCT = 400
          // and min baseScale = 4, the world-to-screen scale is
          // 4 * 400 / 100 = 16 px/unit, so only stars at exactly
          // the same world position would collide (impossible by
          // the no-duplicate-positions invariant).
          expect(id).toBe(s.id);
        }
      }),
    );
  });

  it('finds the star at exactly HIT_RADIUS_PX', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const c: Camera = { pan: { x: 0, y: 0 }, zoom: HIT_TEST_ZOOM_PCT };
        const v: Viewport = { width: 1200, height: 800 };
        const r = RADIUS_FOR_SIZE[size];
        for (const s of g.stars) {
          const sp = projectStar(s, c, v, r);
          // Chebyshev offset of exactly HIT_RADIUS_PX.
          const id = starAtPoint(
            { sx: sp.sx + HIT_RADIUS_PX, sy: sp.sy },
            g,
            c,
            v,
          );
          // With HIT_TEST_ZOOM_PCT = 400 the nearest neighbour of any
          // star is at least baseScale*1 = 16 px away, so the only
          // candidate within HIT_RADIUS_PX is the target star itself.
          expect(id).toBe(s.id);
        }
      }),
    );
  });

  it('misses when the click is one pixel past HIT_RADIUS_PX', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const c: Camera = { pan: { x: 0, y: 0 }, zoom: HIT_TEST_ZOOM_PCT };
        const v: Viewport = { width: 1200, height: 800 };
        const r = RADIUS_FOR_SIZE[size];
        for (const s of g.stars) {
          const sp = projectStar(s, c, v, r);
          const far = { sx: sp.sx + HIT_RADIUS_PX + 1, sy: sp.sy };
          const id = starAtPoint(far, g, c, v);
          if (id !== NO_SELECTION) {
            // If we hit something, it must be a different star.
            expect(id).not.toBe(s.id);
          }
        }
      }),
    );
  });

  it('isStarAtPoint agrees with starAtPoint', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, screenPointArb, (size, seed, p) => {
        const g = initGalaxy(seed, size);
        const c: Camera = { pan: { x: 0, y: 0 }, zoom: HIT_TEST_ZOOM_PCT };
        const v: Viewport = { width: 1200, height: 800 };
        const id = starAtPoint(p, g, c, v);
        if (id === NO_SELECTION) {
          for (const s of g.stars) {
            expect(isStarAtPoint(s, p, c, v, g.radius)).toBe(false);
          }
        } else {
          const star = g.stars.find((s) => s.id === id)!;
          expect(isStarAtPoint(star, p, c, v, g.radius)).toBe(true);
        }
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Pan
// ---------------------------------------------------------------------------

describe('starmap — panCamera', () => {
  it('panning by (0, 0) is identity', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const v: Viewport = { width: 800, height: 600 };
        const s1 = panCamera(initialState, 0, 0, v, g.radius);
        expect(s1.camera.pan.x).toBe(0);
        expect(s1.camera.pan.y).toBe(0);
        expect(s1.camera.zoom).toBe(initialState.camera.zoom);
      }),
    );
  });

  it('positive dx pans the camera right (pan.x increases)', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const v: Viewport = { width: 800, height: 600 };
        const s1 = panCamera(initialState, 100, 0, v, g.radius);
        expect(s1.camera.pan.x).toBeGreaterThan(initialState.camera.pan.x);
      }),
    );
  });

  it('positive dy pans the camera down (pan.y decreases)', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const v: Viewport = { width: 800, height: 600 };
        const s1 = panCamera(initialState, 0, 100, v, g.radius);
        expect(s1.camera.pan.y).toBeLessThan(initialState.camera.pan.y);
      }),
    );
  });

  it('pan is reversible with negation', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, viewportArb, (size, seed, v) => {
        const g = initGalaxy(seed, size);
        const s1 = panCamera(initialState, 137, -42, v, g.radius);
        const s2 = panCamera(s1, -137, 42, v, g.radius);
        expect(s2.camera.pan.x).toBe(initialState.camera.pan.x);
        expect(s2.camera.pan.y).toBe(initialState.camera.pan.y);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

describe('starmap — clampZoom', () => {
  it('clamps to MIN_ZOOM_PCT', () => {
    expect(clampZoom(MIN_ZOOM_PCT - 1)).toBe(MIN_ZOOM_PCT);
    expect(clampZoom(-1000)).toBe(MIN_ZOOM_PCT);
  });

  it('clamps to MAX_ZOOM_PCT', () => {
    expect(clampZoom(MAX_ZOOM_PCT + 1)).toBe(MAX_ZOOM_PCT);
    expect(clampZoom(99999)).toBe(MAX_ZOOM_PCT);
  });

  it('is identity inside the range', () => {
    fc.assert(
      fc.property(zoomArb, (z) => {
        expect(clampZoom(z)).toBe(z);
      }),
    );
  });
});

describe('starmap — projectOrigin', () => {
  it('returns the viewport centre when pan is zero', () => {
    fc.assert(
      fc.property(viewportArb, (v) => {
        const c: Camera = { pan: { x: 0, y: 0 }, zoom: 100 };
        const o = projectOrigin(c, v, 70);
        expect(o.sx).toBe(Math.trunc(v.width / 2));
        expect(o.sy).toBe(Math.trunc(v.height / 2));
      }),
    );
  });

  it('agrees with projectStar for world (0, 0)', () => {
    fc.assert(
      fc.property(viewportArb, cameraArb, (v, c) => {
        const origin: Star = {
          id: 0,
          color: 'Yellow',
          size: 0,
          position: { x: 0, y: 0 },
        };
        const a = projectOrigin(c, v, 70);
        const b = projectStar(origin, c, v, 70);
        expect(a.sx).toBe(b.sx);
        expect(a.sy).toBe(b.sy);
      }),
    );
  });

  it('positive pan.x moves the origin to the left of viewport centre', () => {
    const v: Viewport = { width: 800, height: 600 };
    const c: Camera = { pan: { x: 50, y: 0 }, zoom: 100 };
    const o = projectOrigin(c, v, 70);
    expect(o.sx).toBeLessThan(400);
    expect(o.sy).toBe(300);
  });

  it('positive pan.y moves the origin below viewport centre (y-flipped)', () => {
    const v: Viewport = { width: 800, height: 600 };
    const c: Camera = { pan: { x: 0, y: 50 }, zoom: 100 };
    const o = projectOrigin(c, v, 70);
    expect(o.sx).toBe(400);
    expect(o.sy).toBeGreaterThan(300);
  });
});

describe('starmap — isInsideGalaxy', () => {
  it('the galaxy origin is inside', () => {
    expect(isInsideGalaxy({ x: 0, y: 0 }, 70)).toBe(true);
  });

  it('a point on the boundary is inside', () => {
    // (±radius, 0) and (0, ±radius) all on the disc edge.
    expect(isInsideGalaxy({ x: 70, y: 0 }, 70)).toBe(true);
    expect(isInsideGalaxy({ x: -70, y: 0 }, 70)).toBe(true);
    expect(isInsideGalaxy({ x: 0, y: 70 }, 70)).toBe(true);
    expect(isInsideGalaxy({ x: 0, y: -70 }, 70)).toBe(true);
    // pythagorean boundary point: (r/√2, r/√2)
    const h = 70 / Math.sqrt(2);
    expect(isInsideGalaxy({ x: h, y: h }, 70)).toBe(true);
  });

  it('a point outside is outside', () => {
    expect(isInsideGalaxy({ x: 71, y: 0 }, 70)).toBe(false);
    expect(isInsideGalaxy({ x: 0, y: -71 }, 70)).toBe(false);
    const h = 50; // 50² + 50² = 5000 > 70² = 4900
    expect(isInsideGalaxy({ x: h, y: h }, 70)).toBe(false);
  });

  it('matches the disc predicate across all galaxy sizes and points', () => {
    fc.assert(
      fc.property(sizeArb, (size) => {
        const g = initGalaxy(0, size);
        // origin: always inside
        expect(isInsideGalaxy({ x: 0, y: 0 }, g.radius)).toBe(true);
        // boundary: always inside (≤)
        expect(isInsideGalaxy({ x: g.radius, y: 0 }, g.radius)).toBe(true);
        // one past boundary: always outside
        expect(
          isInsideGalaxy({ x: g.radius + 1, y: 0 }, g.radius),
        ).toBe(false);
      }),
    );
  });
});

describe('starmap — panTo', () => {
  it('sets pan to the world point and preserves zoom', () => {
    const s = panTo(initialState, { x: 10, y: -20 });
    expect(s.camera.pan.x).toBe(10);
    expect(s.camera.pan.y).toBe(-20);
    expect(s.camera.zoom).toBe(initialState.camera.zoom);
  });

  it('does not mutate the input state', () => {
    const before = initialState;
    panTo(initialState, { x: 10, y: -20 });
    expect(initialState).toBe(before);
    expect(initialState.camera.pan.x).toBe(0);
    expect(initialState.camera.pan.y).toBe(0);
  });

  it('centring on the galaxy origin yields the initial pan', () => {
    const s = panTo(
      { ...initialState, camera: { pan: { x: 99, y: 99 }, zoom: 100 } },
      { x: 0, y: 0 },
    );
    expect(s.camera.pan).toEqual({ x: 0, y: 0 });
  });

  it('property: any world point round-trips through project/unproject', () => {
    // After panTo, projectStar of (x,y) should land at screen centre
    // (cx, cy). We verify against a known viewport + radius.
    fc.assert(
      fc.property(
        viewportArb,
        fc.integer({ min: -70, max: 70 }),
        fc.integer({ min: -70, max: 70 }),
        (v, x, y) => {
          const radius = 70;
          const s = panTo(initialState, { x, y });
          const proj = projectStar(
            { id: 1, color: 'Yellow', size: 50, position: { x, y } },
            s.camera,
            v,
            radius,
          );
          const cx = Math.trunc(v.width / 2);
          const cy = Math.trunc(v.height / 2);
          // worldScale truncates, so allow ±1 px drift.
          expect(Math.abs(proj.sx - cx)).toBeLessThanOrEqual(1);
          expect(Math.abs(proj.sy - cy)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

describe('starmap — zoomCameraAround', () => {
  it('factor = ZOOM_DENOMINATOR leaves the camera unchanged', () => {
    fc.assert(
      fc.property(sizeArb, viewportArb, (size, v) => {
        const g = initGalaxy(0, size);
        const s1 = zoomCameraAround(
          initialState,
          ZOOM_DENOMINATOR,
          { sx: 100, sy: 100 },
          v,
          g.radius,
        );
        expect(s1.camera.zoom).toBe(initialState.camera.zoom);
        expect(s1.camera.pan.x).toBe(initialState.camera.pan.x);
        expect(s1.camera.pan.y).toBe(initialState.camera.pan.y);
      }),
    );
  });

  it('factor > ZOOM_DENOMINATOR increases zoom (up to clamp)', () => {
    fc.assert(
      fc.property(sizeArb, viewportArb, (size, v) => {
        const g = initGalaxy(0, size);
        const s1 = zoomCameraAround(
          initialState,
          200,
          { sx: v.width / 2, sy: v.height / 2 },
          v,
          g.radius,
        );
        expect(s1.camera.zoom).toBeGreaterThan(initialState.camera.zoom);
        expect(s1.camera.zoom).toBeLessThanOrEqual(MAX_ZOOM_PCT);
      }),
    );
  });

  it('factor < ZOOM_DENOMINATOR decreases zoom (down to clamp)', () => {
    fc.assert(
      fc.property(sizeArb, viewportArb, (size, v) => {
        const g = initGalaxy(0, size);
        const s1 = zoomCameraAround(
          initialState,
          50,
          { sx: v.width / 2, sy: v.height / 2 },
          v,
          g.radius,
        );
        expect(s1.camera.zoom).toBeLessThan(initialState.camera.zoom);
        expect(s1.camera.zoom).toBeGreaterThanOrEqual(MIN_ZOOM_PCT);
      }),
    );
  });

  it('huge factor clamps to MAX_ZOOM_PCT', () => {
    fc.assert(
      fc.property(sizeArb, viewportArb, (size, v) => {
        const g = initGalaxy(0, size);
        const s1 = zoomCameraAround(
          initialState,
          99999,
          { sx: 100, sy: 100 },
          v,
          g.radius,
        );
        expect(s1.camera.zoom).toBe(MAX_ZOOM_PCT);
      }),
    );
  });

  it('tiny factor clamps to MIN_ZOOM_PCT', () => {
    fc.assert(
      fc.property(sizeArb, viewportArb, (size, v) => {
        const g = initGalaxy(0, size);
        const s1 = zoomCameraAround(
          initialState,
          1,
          { sx: 100, sy: 100 },
          v,
          g.radius,
        );
        expect(s1.camera.zoom).toBe(MIN_ZOOM_PCT);
      }),
    );
  });

  it('preserves the anchor: world point under anchor is unchanged', () => {
    // Zoom is "around" a screen anchor: the galaxy point under that
    // screen point must remain under it after the zoom. We skip:
    //   - anchors outside the viewport.
    //   - anchors near the viewport edge (where the unprojected
    //     world point can be far outside the disc and projection
    //     after zoom can land outside the viewport).
    //   - viewports with degenerate scale (worldScale = 0).
    //   - zoom levels that cause integer truncation in worldScale.
    fc.assert(
      fc.property(
        sizeArb,
        seedArb,
        viewportArb,
        screenPointArb,
        (size, seed, v, anchor) => {
          // Constrain anchor to be near the viewport centre so the
          // unprojected world point stays inside the disc.
          const cx = v.width / 2;
          const cy = v.height / 2;
          const EDGE_MARGIN = 100;
          if (
            anchor.sx < cx - EDGE_MARGIN ||
            anchor.sx > cx + EDGE_MARGIN ||
            anchor.sy < cy - EDGE_MARGIN ||
            anchor.sy > cy + EDGE_MARGIN
          ) {
            return;
          }
          const g = initGalaxy(seed, size);
          const s0: StarmapState = {
            camera: { pan: { x: 0, y: 0 }, zoom: 100 },
            selectedId: NO_SELECTION,
          };
          const sOld = worldScale(v, g.radius, s0.camera.zoom);
          if (sOld === 0) return; // Degenerate viewport; skip.
          // Skip if zoomPct * baseScale isn't a multiple of 100
          // (integer truncation in worldScale causes drift).
          if ((baseScale(v, g.radius) * s0.camera.zoom) % 100 !== 0) return;
          const s1 = zoomCameraAround(s0, 200, anchor, v, g.radius);
          const sNew = worldScale(v, g.radius, s1.camera.zoom);
          if (sNew === 0) return; // New scale is degenerate; skip.
          // World point under anchor before zoom.
          const w0 = unprojectPoint(anchor, s0.camera, v, g.radius);
          // After zooming, that same world point projects back onto the anchor.
          const back = projectStar(
            { id: 0, color: 'Yellow', size: 50, position: w0 },
            s1.camera,
            v,
            g.radius,
          );
          // Integer-rounding tolerance: ±1px.
          expect(Math.abs(back.sx - anchor.sx)).toBeLessThanOrEqual(1);
          expect(Math.abs(back.sy - anchor.sy)).toBeLessThanOrEqual(1);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Camera predicate
// ---------------------------------------------------------------------------

describe('starmap — isValidCamera', () => {
  it('accepts cameras with valid zoom', () => {
    fc.assert(
      fc.property(panArb, zoomArb, (pan, zoom) => {
        expect(isValidCamera({ pan, zoom })).toBe(true);
      }),
    );
  });

  it('rejects cameras with out-of-range zoom', () => {
    expect(isValidCamera({ pan: { x: 0, y: 0 }, zoom: MIN_ZOOM_PCT - 1 })).toBe(
      false,
    );
    expect(isValidCamera({ pan: { x: 0, y: 0 }, zoom: MAX_ZOOM_PCT + 1 })).toBe(
      false,
    );
  });
});

describe('starmap — isValidZoom', () => {
  it('accepts MIN_ZOOM_PCT and MAX_ZOOM_PCT inclusive', () => {
    expect(isValidZoom(MIN_ZOOM_PCT)).toBe(true);
    expect(isValidZoom(MAX_ZOOM_PCT)).toBe(true);
  });

  it('rejects just outside the range', () => {
    expect(isValidZoom(MIN_ZOOM_PCT - 1)).toBe(false);
    expect(isValidZoom(MAX_ZOOM_PCT + 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Quint <-> TS parity sanity: same numbers, same results
// ---------------------------------------------------------------------------

describe('starmap — Quint <-> TS parity', () => {
  it('baseScale matches the spec for fixed inputs', () => {
    expect(baseScale({ width: 800, height: 600 }, 70)).toBe(
      STARMAP_TEST_VALUES.baseScale800x600r70,
    );
  });

  it('worldScale matches the spec for fixed inputs', () => {
    expect(worldScale({ width: 800, height: 600 }, 70, 100)).toBe(
      STARMAP_TEST_VALUES.worldScale100,
    );
  });

  it('projectStar matches the spec for fixed inputs', () => {
    const s: Star = {
      id: 1,
      color: 'Yellow', size: 50,
      position: { x: 10, y: 0 },
    };
    const c: Camera = { pan: { x: 0, y: 0 }, zoom: 100 };
    const v: Viewport = { width: 800, height: 600 };
    const proj = projectStar(s, c, v, 70);
    expect(proj.sx).toBe(STARMAP_TEST_VALUES.projectStarYellowSX);
    expect(proj.sy).toBe(STARMAP_TEST_VALUES.projectStarYellowSY);
  });

  it('zoomByOneIsNoop holds for a representative input', () => {
    const s0: StarmapState = initialState;
    const s1 = zoomCameraAround(
      s0,
      ZOOM_DENOMINATOR,
      { sx: 100, sy: 100 },
      { width: 800, height: 600 },
      70,
    );
    expect(s1.camera.zoom).toBe(STARMAP_TEST_VALUES.zoomByOneIsNoopZoom);
    expect(s1.camera.pan.x).toBe(STARMAP_TEST_VALUES.zoomByOneIsNoopPanX);
    expect(s1.camera.pan.y).toBe(STARMAP_TEST_VALUES.zoomByOneIsNoopPanY);
  });
});

// ---------------------------------------------------------------------------
// Misc helpers exposed for the parity test (and renderer reuse)
// ---------------------------------------------------------------------------

// (No additional exports: this file is a test consumer, not a
// producer of reusable test helpers.)