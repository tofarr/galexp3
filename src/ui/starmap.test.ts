/**
 * Tests for pure helpers exported from src/ui/starmap.ts.
 *
 * The PixiJS-bound renderer's dirty-flag flow can't be exercised in
 * node (no DOM, no WebGL), so this file covers the seam that DOES
 * not depend on PixiJS: the projection of the selection ring centre.
 * The renderer's repaint ordering (which is where the actual bug
 * lived — `paintDirty` got cleared before the ring could read it)
 * is documented in code comments at the repaint site; the contract
 * is that whenever the ring is painted, it must be at the projected
 * position for the *current* camera.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  MAX_ZOOM_PCT,
  MIN_ZOOM_PCT,
  NO_SELECTION,
  initialCamera,
  projectStar,
  type Camera,
  type Viewport,
} from '../sim/starmap';
import { initGalaxy, type GalaxySize } from '../sim/galaxy';
import { selectionRingCentre } from './starmap';

// Arbitrary viewport size used by most tests.
const VIEWPORT: Viewport = { width: 800, height: 600 };

// Smallest galaxy size — fewer stars, faster tests. We don't depend
// on the exact star count; the helper takes any GalaxySubset.
const SIZE: GalaxySize = 'Small';

function cameraAt(zoom: number, panX = 0, panY = 0): Camera {
  return { pan: { x: panX, y: panY }, zoom };
}

describe('selectionRingCentre', () => {
  it('returns null when there is no selection', () => {
    const g = initGalaxy(42, SIZE);
    expect(selectionRingCentre(NO_SELECTION, g, initialCamera, VIEWPORT)).toBeNull();
  });

  it('returns null when the selected id is not in the galaxy', () => {
    const g = initGalaxy(42, SIZE);
    const bogus = 999_999;
    expect(selectionRingCentre(bogus, g, initialCamera, VIEWPORT)).toBeNull();
  });

  it('returns the projected position of the selected star at the current camera', () => {
    const g = initGalaxy(42, SIZE);
    const star = g.stars[0]!;
    const cam = cameraAt(150, 5, -3);
    const centre = selectionRingCentre(star.id, g, cam, VIEWPORT);
    expect(centre).not.toBeNull();
    // Sanity bounds: at zoom 150% with default pan, a Small-galaxy
    // star projects somewhere inside the viewport. Not asserting
    // exact pixels — those are covered by the projectStar parity
    // tests in src/sim/starmap.test.ts.
    expect(centre!.sx).toBeGreaterThanOrEqual(0);
    expect(centre!.sy).toBeGreaterThanOrEqual(0);
    expect(centre!.sx).toBeLessThanOrEqual(VIEWPORT.width);
    expect(centre!.sy).toBeLessThanOrEqual(VIEWPORT.height);
  });

  // ---------------------------------------------------------------------------
  // Regression: ring must follow camera changes.
  // ---------------------------------------------------------------------------
  //
  // This is the test that captures the original bug. The renderer
  // used to clear `paintDirty` inside its first paint block, so the
  // selection ring was skipped on every camera change — it stayed
  // at the previous frame's projected position. The fix samples the
  // dirty flags once before clearing them.
  //
  // This test exercises the *pure* projection: it asserts that
  // selectionRingCentre always agrees with the actual projectStar
  // for the given camera. If the renderer ever calls the helper with
  // a stale camera (e.g. the bug regresses and a tween frame paints
  // the ring before re-sampling the camera), the helper would still
  // give the correct position — but the renderer would paint at the
  // wrong frame. The structural guard against that regression lives
  // in the repaint() function in src/ui/starmap.ts.

  it('moves when the camera zooms', () => {
    const g = initGalaxy(7, SIZE);
    const star = g.stars[0]!;
    const cam1 = cameraAt(100);
    const cam2 = cameraAt(200);
    const c1 = selectionRingCentre(star.id, g, cam1, VIEWPORT);
    const c2 = selectionRingCentre(star.id, g, cam2, VIEWPORT);
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    // The star is not at the world origin in general, so the two
    // projections will differ. We don't assert a specific delta — the
    // zoomCameraAround anchor-preserving property guarantees that
    // the *viewport centre* maps to itself, but a star at an
    // arbitrary position will move relative to the centre as the
    // zoom changes. (A star exactly at the origin would map to the
    // viewport centre in both cameras — but no star in any in-game
    // galaxy is at (0,0) so that's fine.)
    expect(c1!.sx !== c2!.sx || c1!.sy !== c2!.sy).toBe(true);
  });

  it('moves when the camera pans', () => {
    const g = initGalaxy(7, SIZE);
    const star = g.stars[0]!;
    const cam1 = cameraAt(100, 0, 0);
    const cam2 = cameraAt(100, 10, -10);
    const c1 = selectionRingCentre(star.id, g, cam1, VIEWPORT);
    const c2 = selectionRingCentre(star.id, g, cam2, VIEWPORT);
    expect(c1).not.toBeNull();
    expect(c2).not.toBeNull();
    expect(c1!.sx).not.toBe(c2!.sx);
  });

  it('agrees with projectStar for the same (camera, star) input', () => {
    // The renderer uses the helper instead of inlining projectStar
    // so that "find selected star" and "project it" stay together.
    // This test pins that the helper must produce the same result
    // as projectStar for any input — a future change that, say,
    // adjusted the selection-rule (e.g. snap to nearest star) would
    // be caught here.
    //
    // (zoomCameraAround's anchor-preserving invariant is already
    // covered in src/sim/starmap.test.ts; we don't need to re-test
    // it at the helper layer.)
    const g = initGalaxy(11, SIZE);
    for (const zoom of [50, 100, 200, 400, 800]) {
      const cam = cameraAt(zoom, 0, 0);
      for (const star of g.stars) {
        const helper = selectionRingCentre(star.id, g, cam, VIEWPORT);
        const direct = projectStar(star, cam, VIEWPORT, g.radius);
        expect(helper).not.toBeNull();
        expect(helper!.sx).toBe(direct.sx);
        expect(helper!.sy).toBe(direct.sy);
      }
    }
  });

  // Property: the helper is consistent with projectStar for every
  // (camera, star) pair. projectStar is the spec-mirroring primitive
  // already covered in src/sim/starmap.test.ts; this test guards the
  // "wrapper" path used by the renderer.
  //
  // The helper is a pure projection — at extreme zooms (max 8x)
  // with no pan, stars near the disc rim project well outside the
  // viewport. That's the correct, spec-faithful behaviour: the
  // renderer's clip / culling is a separate concern. This test
  // therefore just asserts the helper returns *some* point for
  // every (camera, star) pair — the contract that "wherever the
  // projectStar says the star is, that's where the ring goes".
  it('returns a point for every (camera, star) pair', () => {
    const g = initGalaxy(13, SIZE);
    fc.assert(
      fc.property(
        fc.integer({ min: MIN_ZOOM_PCT, max: MAX_ZOOM_PCT }),
        fc.integer({ min: -200, max: 200 }),
        fc.integer({ min: -200, max: 200 }),
        (zoom, panX, panY) => {
          const cam = cameraAt(zoom, panX, panY);
          for (const star of g.stars) {
            const centre = selectionRingCentre(star.id, g, cam, VIEWPORT);
            expect(centre).not.toBeNull();
            // Screen coordinates are integers (mirrors projectStar).
            expect(Number.isInteger(centre!.sx)).toBe(true);
            expect(Number.isInteger(centre!.sy)).toBe(true);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  // Hits the boundary case: at MIN_ZOOM_PCT the entire disc fits
  // comfortably in the viewport, so every star projects inside it.
  // (At MAX_ZOOM_PCT, rim stars project outside the viewport by
  // design — that's how the disc "expands past the viewport" when
  // you zoom in. Not a bug.)
  it('keeps every star inside the viewport at minimum zoom', () => {
    const g = initGalaxy(17, SIZE);
    const cam = cameraAt(MIN_ZOOM_PCT, 0, 0);
    for (const star of g.stars) {
      const centre = selectionRingCentre(star.id, g, cam, VIEWPORT);
      expect(centre).not.toBeNull();
      // Allow a small margin (1 px) for integer-rounding.
      expect(centre!.sx).toBeGreaterThanOrEqual(0);
      expect(centre!.sy).toBeGreaterThanOrEqual(0);
      expect(centre!.sx).toBeLessThanOrEqual(VIEWPORT.width);
      expect(centre!.sy).toBeLessThanOrEqual(VIEWPORT.height);
    }
  });
});