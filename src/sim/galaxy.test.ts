/**
 * Property tests for src/sim/galaxy.ts.
 *
 * Each property test mirrors an invariant from quint/galaxy.qnt.
 * If you change an invariant in the spec, change it here too.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { emptyStarSystem } from './starSystem';
import {
  GALAXY_SIZES,
  GalaxySize,
  RADIUS_FOR_SIZE,
  STAR_BLOOM_ALPHA,
  STAR_COLORS,
  STAR_COLOR_FOR_COLOR,
  STAR_COUNT_FOR_SIZE,
  STAR_CORE_ALPHA,
  STAR_HALO_ALPHA,
  STAR_HALO_COLOR_FOR_COLOR,
  STAR_SIZE_MAX,
  STAR_SIZE_MIN,
  StarColor,
  initGalaxy,
  isValidGalaxy,
  isValidSize,
  starBloomBlurPx,
  starBloomPx,
  starBodyPx,
  starCoreBlurPx,
  starHaloBlurPx,
  starHaloPx,
} from './galaxy';

const sizeArb: fc.Arbitrary<GalaxySize> = fc.constantFrom(...GALAXY_SIZES);
const colorArb: fc.Arbitrary<StarColor> = fc.constantFrom(...STAR_COLORS);
const seedArb = fc.integer({ min: -0x7fffffff, max: 0x7fffffff });
const sizeValueArb = fc.integer({ min: STAR_SIZE_MIN, max: STAR_SIZE_MAX });

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

  it('uses only colours from the closed set', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        for (const s of g.stars) {
          expect(STAR_COLORS).toContain(s.color);
        }
      }),
    );
  });

  it('assigns every star a numeric size in [STAR_SIZE_MIN, STAR_SIZE_MAX]', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        for (const s of g.stars) {
          expect(isValidSize(s.size)).toBe(true);
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
          expect(sb.color).toBe(sa.color);
          expect(sb.size).toBe(sa.size);
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
        {
          id: 999,
          color: 'White' as StarColor,
          size: 50,
          position: { x: r * 10, y: 0 },
          name: 'Far',
          system: emptyStarSystem(999),
        },
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

  it('rejects galaxies with a star whose size is out of range', () => {
    const size: GalaxySize = 'Small';
    const g = initGalaxy(4, size);
    const badStar = g.stars[0]!;
    const broken = {
      ...g,
      stars: [{ ...badStar, size: STAR_SIZE_MAX + 1 }, ...g.stars.slice(1)],
    };
    expect(isValidGalaxy(broken)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Star appearance tables — these are pure functions, so we property-test
// the formulas against the spec's claims about the ranges.
// ---------------------------------------------------------------------------

describe('star appearance formulas', () => {
  it('every StarColor has a body colour and a halo colour', () => {
    fc.assert(
      fc.property(colorArb, (c) => {
        expect(STAR_COLOR_FOR_COLOR[c]).toMatch(/^0x[0-9a-f]{6}$/);
        expect(STAR_HALO_COLOR_FOR_COLOR[c]).toMatch(/^0x[0-9a-f]{6}$/);
      }),
    );
  });

  it('body and halo of the same star differ (white allowed to match)', () => {
    fc.assert(
      fc.property(colorArb, (c) => {
        if (c === 'White') {
          // Both whitish — allowed.
          return;
        }
        expect(STAR_COLOR_FOR_COLOR[c]).not.toBe(STAR_HALO_COLOR_FOR_COLOR[c]);
      }),
    );
  });

  it('bodyPx is monotonic non-decreasing in size and lands in [1, 5]', () => {
    let prev = -1;
    for (let s = STAR_SIZE_MIN; s <= STAR_SIZE_MAX; s++) {
      const r = starBodyPx(s);
      expect(r).toBeGreaterThanOrEqual(1);
      expect(r).toBeLessThanOrEqual(5);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it('bloomPx > bodyPx and haloPx > bloomPx for every valid size', () => {
    fc.assert(
      fc.property(sizeValueArb, (s) => {
        const body = starBodyPx(s);
        const bloom = starBloomPx(s);
        const halo = starHaloPx(s);
        expect(bloom).toBeGreaterThan(body);
        expect(halo).toBeGreaterThan(bloom);
      }),
    );
  });

  it('halo blur is the heaviest of the three blur layers', () => {
    fc.assert(
      fc.property(sizeValueArb, (s) => {
        expect(starHaloBlurPx(s)).toBeGreaterThanOrEqual(starBloomBlurPx(s));
        expect(starBloomBlurPx(s)).toBeGreaterThanOrEqual(starCoreBlurPx(s));
      }),
    );
  });

  it('halo blur is monotonic non-decreasing in size', () => {
    let prev = -1;
    for (let s = STAR_SIZE_MIN; s <= STAR_SIZE_MAX; s++) {
      const b = starHaloBlurPx(s);
      expect(b).toBeGreaterThanOrEqual(prev);
      prev = b;
    }
  });

  it('alpha values are well-ordered (halo dimmest, core opaque)', () => {
    expect(STAR_HALO_ALPHA).toBeGreaterThan(0);
    expect(STAR_HALO_ALPHA).toBeLessThan(STAR_BLOOM_ALPHA);
    expect(STAR_BLOOM_ALPHA).toBeLessThan(STAR_CORE_ALPHA);
  });
});

// ---------------------------------------------------------------------------
// Star naming (src/sim/names.ts)
// ---------------------------------------------------------------------------

describe('initGalaxy — star names', () => {
  it('every star gets a non-empty name', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        for (const s of g.stars) {
          expect(s.name).toBeTypeOf('string');
          expect(s.name.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it('star names are unique within a galaxy', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        const seen = new Set<string>();
        for (const s of g.stars) {
          expect(seen.has(s.name)).toBe(false);
          seen.add(s.name);
        }
        expect(seen.size).toBe(g.stars.length);
      }),
    );
  });

  it('same (seed, size) -> same star names (determinism)', () => {
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const a = initGalaxy(seed, size);
        const b = initGalaxy(seed, size);
        const namesA = a.stars.map((s) => s.name);
        const namesB = b.stars.map((s) => s.name);
        expect(namesA).toEqual(namesB);
      }),
    );
  });

  it('different seeds -> different name streams (sanity)', () => {
    // Two random seeds should produce different name lists unless we
    // are catastrophically unlucky (collision probability is
    // (N / pool)^N; astronomically small for any galaxy size).
    const g1 = initGalaxy(1, 'Medium');
    const g2 = initGalaxy(2, 'Medium');
    expect(g1.stars.map((s) => s.name)).not.toEqual(
      g2.stars.map((s) => s.name),
    );
  });

  it('names look sci-fi: "<Capitalised word>"', () => {
    // Single-word name, capitalised, ASCII letters only. Catches
    // obvious regressions (empty name, garbage chars, leading/
    // trailing spaces, multi-word names, disambiguator suffixes
    // leaking through, etc.).
    const name = /^[A-Z][a-zA-Z]+$/;
    fc.assert(
      fc.property(sizeArb, seedArb, (size, seed) => {
        const g = initGalaxy(seed, size);
        for (const s of g.stars) {
          expect(s.name).toMatch(name);
        }
      }),
    );
  });

  it('isValidGalaxy rejects galaxies with duplicate names', () => {
    const size: GalaxySize = 'Small';
    const g = initGalaxy(7, size);
    const dup = {
      ...g,
      stars: g.stars.map((s, i) => ({
        ...s,
        name: i === 0 ? g.stars[1]!.name : s.name,
      })),
    };
    expect(isValidGalaxy(dup)).toBe(false);
  });

  it('isValidGalaxy rejects galaxies with empty names', () => {
    const size: GalaxySize = 'Small';
    const g = initGalaxy(8, size);
    const broken = {
      ...g,
      stars: g.stars.map((s, i) => (i === 0 ? { ...s, name: '' } : s)),
    };
    expect(isValidGalaxy(broken)).toBe(false);
  });

  it('uses varied names — not "10 copies of the same word"', () => {
    // Distribution sanity: a galaxy of 48 stars picked from a pool
    // of ~600 single-word names should produce many distinct names.
    // A generator that's draining a single corner of the shuffle
    // would produce many duplicates.
    const g = initGalaxy(42, 'Large');
    const names = new Set(g.stars.map((s) => s.name));
    // 48 stars should comfortably produce >40 distinct names.
    expect(names.size).toBeGreaterThan(40);
  });
});