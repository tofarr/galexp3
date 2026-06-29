/**
 * Property tests for src/sim/galaxy.ts.
 *
 * Each property test mirrors an invariant from quint/galaxy.qnt.
 * If you change an invariant in the spec, change it here too.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  GALAXY_SIZES,
  GalaxySize,
  RADIUS_FOR_SIZE,
  STAR_BLUR_PX_FOR_SIZE,
  STAR_BODY_ALPHA,
  STAR_COLOR_FOR_KIND,
  STAR_COUNT_FOR_SIZE,
  STAR_GLOW_ALPHA,
  STAR_GLOW_COLOR_FOR_KIND,
  STAR_GLOW_RATIO,
  STAR_KINDS,
  STAR_RADIUS_PX_FOR_SIZE,
  STAR_SIZE_FOR_KIND,
  STAR_SIZES,
  StarKind,
  StarSize,
  initGalaxy,
  isValidGalaxy,
} from './galaxy';

const sizeArb: fc.Arbitrary<GalaxySize> = fc.constantFrom(...GALAXY_SIZES);
const seedArb = fc.integer({ min: -0x7fffffff, max: 0x7fffffff });

describe('initGalaxy — star counts and ids', () => {
  it('matches the declared star count for each size', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        expect(g.stars.length).toBe(STAR_COUNT_FOR_SIZE[size]);
      }),
    );
  });

  it('assigns ids 1..N exactly once', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const ids = g.stars.map((s) => s.id).sort((a, b) => a - b);
        const n = STAR_COUNT_FOR_SIZE[size];
        for (let i = 0; i < n; i++) {
          expect(ids[i]).toBe(i + 1);
        }
      }),
    );
  });

  it('uses only star kinds from the closed set', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        for (const s of g.stars) {
          expect(STAR_KINDS).toContain(s.kind);
        }
      }),
    );
  });
});

describe('initGalaxy — geometric invariants', () => {
  it('keeps every star within the bounded disc', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const r = RADIUS_FOR_SIZE[size];
        for (const s of g.stars) {
          const d2 = s.position.x * s.position.x + s.position.y * s.position.y;
          expect(d2).toBeLessThanOrEqual(r * r);
        }
      }),
    );
  });

  it('places no two stars at exactly the same position', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const seen = new Set<string>();
        for (const s of g.stars) {
          const key = `${s.position.x}|${s.position.y}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }),
    );
  });

  it('places no two stars closer than the Poisson-disk min distance', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        // Recompute the min distance used by the generator.
        const radius = RADIUS_FOR_SIZE[size];
        const n = STAR_COUNT_FOR_SIZE[size];
        const perStar = (Math.PI * radius * radius) / n;
        const minDist = (Math.sqrt(perStar / 3.464) * 0.8) | 0;
        for (let i = 0; i < g.stars.length; i++) {
          for (let j = i + 1; j < g.stars.length; j++) {
            const a = g.stars[i]!.position;
            const b = g.stars[j]!.position;
            const dx = a.x - b.x;
            const dy = a.y - b.y;
            const d2 = dx * dx + dy * dy;
            // The generator progressively relaxes minDist if the disc
            // is too crowded; allow up to 30% relaxation in the check.
            const allowed = minDist * minDist * 0.49;
            expect(d2).toBeGreaterThanOrEqual(allowed);
          }
        }
      }),
    );
  });
});

describe('initGalaxy — radius matches spec', () => {
  it('emits the spec radius for its declared size', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        expect(g.radius).toBe(RADIUS_FOR_SIZE[size]);
      }),
    );
  });
});

describe('initGalaxy — determinism', () => {
  it('produces identical galaxies for identical (seed, size)', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const a = initGalaxy(seed, size);
        const b = initGalaxy(seed, size);
        expect(a.stars.length).toBe(b.stars.length);
        for (let i = 0; i < a.stars.length; i++) {
          const sa = a.stars[i]!;
          const sb = b.stars[i]!;
          expect(sb.id).toBe(sa.id);
          expect(sb.kind).toBe(sa.kind);
          expect(sb.position.x).toBe(sa.position.x);
          expect(sb.position.y).toBe(sa.position.y);
        }
      }),
    );
  });

  it('produces different galaxies for different seeds (probabilistic)', () => {
    fc.assert(
      fc.property(sizeArb, fc.integer(), (size, baseSeed) => {
        const a = initGalaxy(baseSeed, size);
        const b = initGalaxy(baseSeed ^ 0x12345, size);
        let differs = false;
        for (let i = 0; i < a.stars.length; i++) {
          const pa = a.stars[i]!.position;
          const pb = b.stars[i]!.position;
          if (pa.x !== pb.x || pa.y !== pb.y) {
            differs = true;
            break;
          }
        }
        expect(differs).toBe(true);
      }),
    );
  });
});

describe('isValidGalaxy — top-level predicate', () => {
  it('accepts every freshly generated galaxy', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        expect(isValidGalaxy(g)).toBe(true);
      }),
    );
  });

  it('rejects galaxies with the wrong number of stars', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const broken = { ...g, stars: g.stars.slice(1) };
        expect(isValidGalaxy(broken)).toBe(false);
      }),
    );
  });

  it('rejects galaxies with duplicate star ids', () => {
    const size: GalaxySize = 'Small';
    const g = initGalaxy(1, size);
    const first = g.stars[0]!;
    const second = g.stars[1]!;
    const dup = {
      ...g,
      stars: [{ ...second, id: first.id }, ...g.stars.slice(1)],
    };
    expect(isValidGalaxy(dup)).toBe(false);
  });

  it('rejects galaxies with a star outside the disc', () => {
    const size: GalaxySize = 'Small';
    const g = initGalaxy(2, size);
    const r = RADIUS_FOR_SIZE[size];
    const outside = {
      ...g,
      stars: [
        { id: 999, kind: 'Blue' as StarKind, position: { x: r * 10, y: 0 } },
        ...g.stars.slice(1),
      ],
    };
    expect(isValidGalaxy(outside)).toBe(false);
  });

  it('rejects galaxies with the wrong declared radius', () => {
    const size: GalaxySize = 'Small';
    const g = initGalaxy(3, size);
    const wrongRadius = { ...g, radius: RADIUS_FOR_SIZE[size] + 1 };
    expect(isValidGalaxy(wrongRadius)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Star appearance tables (mirror of quint/galaxy.qnt STAR_SIZE / STAR_COLOR /
// STAR_GLOW_COLOR / STAR_RADIUS_PX). These are pure lookup tables — we test
// them exhaustively, no property tests needed.
// ---------------------------------------------------------------------------

describe('star appearance tables', () => {
  const kindArb: fc.Arbitrary<StarKind> = fc.constantFrom(...STAR_KINDS);
  const sizeClassArb: fc.Arbitrary<StarSize> = fc.constantFrom(...STAR_SIZES);

  it('every StarKind has a body colour, a glow colour, and a size', () => {
    fc.assert(
      fc.property(kindArb, (k) => {
        expect(STAR_COLOR_FOR_KIND[k]).toMatch(/^0x[0-9a-f]{6}$/);
        expect(STAR_GLOW_COLOR_FOR_KIND[k]).toMatch(/^0x[0-9a-f]{6}$/);
        expect(STAR_SIZES).toContain(STAR_SIZE_FOR_KIND[k]);
      }),
    );
  });

  it('every StarSize has a positive pixel radius in the expected range', () => {
    fc.assert(
      fc.property(sizeClassArb, (s) => {
        const r = STAR_RADIUS_PX_FOR_SIZE[s];
        expect(r).toBeGreaterThan(0);
        expect(r).toBeLessThan(10);
      }),
    );
  });

  it('size ordering is strictly Dwarf < Standard < Giant < Supergiant', () => {
    expect(STAR_RADIUS_PX_FOR_SIZE.Dwarf).toBeLessThan(
      STAR_RADIUS_PX_FOR_SIZE.Standard,
    );
    expect(STAR_RADIUS_PX_FOR_SIZE.Standard).toBeLessThan(
      STAR_RADIUS_PX_FOR_SIZE.Giant,
    );
    expect(STAR_RADIUS_PX_FOR_SIZE.Giant).toBeLessThan(
      STAR_RADIUS_PX_FOR_SIZE.Supergiant,
    );
  });

  it('blur strength is positive and follows the same size ordering', () => {
    for (const s of STAR_SIZES) {
      expect(STAR_BLUR_PX_FOR_SIZE[s]).toBeGreaterThan(0);
    }
    expect(STAR_BLUR_PX_FOR_SIZE.Dwarf).toBeLessThan(
      STAR_BLUR_PX_FOR_SIZE.Standard,
    );
    expect(STAR_BLUR_PX_FOR_SIZE.Standard).toBeLessThan(
      STAR_BLUR_PX_FOR_SIZE.Giant,
    );
    expect(STAR_BLUR_PX_FOR_SIZE.Giant).toBeLessThan(
      STAR_BLUR_PX_FOR_SIZE.Supergiant,
    );
  });

  it('the glow halo is strictly larger than the body', () => {
    expect(STAR_GLOW_RATIO).toBeGreaterThan(1);
    expect(STAR_GLOW_ALPHA).toBeGreaterThan(0);
    expect(STAR_GLOW_ALPHA).toBeLessThan(STAR_BODY_ALPHA);
  });

  it('body and glow colours of the same star differ (or the star is white)', () => {
    // For each kind, body and glow should not be the same hex value —
    // otherwise the halo has no visual punch. White is the only
    // exception allowed (body/glow are both whitish).
    for (const k of STAR_KINDS) {
      if (k === 'White') {
        expect(STAR_COLOR_FOR_KIND.White).toMatch(/^0x[0-9a-f]{6}$/);
        expect(STAR_GLOW_COLOR_FOR_KIND.White).toMatch(/^0x[0-9a-f]{6}$/);
        continue;
      }
      expect(STAR_COLOR_FOR_KIND[k]).not.toBe(STAR_GLOW_COLOR_FOR_KIND[k]);
    }
  });
});
