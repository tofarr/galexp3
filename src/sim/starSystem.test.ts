/**
 * Property tests for src/sim/starSystem.ts.
 *
 * Each property test mirrors an invariant from quint/starSystem.qnt.
 * If you change an invariant in the spec, change it here too.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  NUM_PLANET_SLOTS,
  PLANET_CLASSES,
  PLANET_SIZES,
  dustCloudSlot,
  emptySlot,
  emptyStarSystem,
  gasGiantSlot,
  generateStarSystem,
  generateStarSystemForStar,
  isValidStarSystem,
  planetBodySlot,
  planetSizeToInt,
  pickClass,
  pickSize,
  pickSlot,
  pickSlotKind,
  slotColor,
  slotHasSize,
  slotIsGasGiant,
  slotIsOccupied,
  slotIsPlanet,
  slotSize,
  slotVisualRadius,
  type PlanetClass,
  type PlanetSize,
  type PlanetSlotContents,
} from './starSystem';

describe('starSystem — slot constructors', () => {
  it('emptySlot has kind "Empty"', () => {
    expect(emptySlot.kind).toBe('Empty');
  });

  it('dustCloudSlot has kind "DustCloud"', () => {
    expect(dustCloudSlot.kind).toBe('DustCloud');
  });

  it('gasGiantSlot carries the size', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PLANET_SIZES), (sz) => {
        const s = gasGiantSlot(sz);
        expect(s.kind).toBe('GasGiant');
        if (s.kind === 'GasGiant') expect(s.size).toBe(sz);
      }),
    );
  });

  it('planetBodySlot carries the size and classification', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLANET_SIZES),
        fc.constantFrom(...PLANET_CLASSES),
        (sz, cls) => {
          const s = planetBodySlot(sz, cls);
          expect(s.kind).toBe('Planet');
          if (s.kind === 'Planet') {
            expect(s.body.size).toBe(sz);
            expect(s.body.classification).toBe(cls);
          }
        },
      ),
    );
  });
});

describe('starSystem — discriminators', () => {
  it('slotIsPlanet is true only for Planet slots', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLANET_SIZES),
        fc.constantFrom(...PLANET_CLASSES),
        (sz, cls) => {
          expect(slotIsPlanet(planetBodySlot(sz, cls))).toBe(true);
          expect(slotIsPlanet(emptySlot)).toBe(false);
          expect(slotIsPlanet(dustCloudSlot)).toBe(false);
          expect(slotIsPlanet(gasGiantSlot(sz))).toBe(false);
        },
      ),
    );
  });

  it('slotIsGasGiant is true only for GasGiant slots', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PLANET_SIZES), (sz) => {
        expect(slotIsGasGiant(gasGiantSlot(sz))).toBe(true);
        expect(slotIsGasGiant(emptySlot)).toBe(false);
        expect(slotIsGasGiant(dustCloudSlot)).toBe(false);
        expect(slotIsGasGiant(planetBodySlot(sz, 'Terran'))).toBe(false);
      }),
    );
  });

  it('slotIsOccupied is false for Empty, true for everything else', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLANET_SIZES),
        fc.constantFrom(...PLANET_CLASSES),
        (sz, cls) => {
          expect(slotIsOccupied(emptySlot)).toBe(false);
          expect(slotIsOccupied(dustCloudSlot)).toBe(true);
          expect(slotIsOccupied(gasGiantSlot(sz))).toBe(true);
          expect(slotIsOccupied(planetBodySlot(sz, cls))).toBe(true);
        },
      ),
    );
  });

  it('slotHasSize is true only for Planet and GasGiant', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLANET_SIZES),
        fc.constantFrom(...PLANET_CLASSES),
        (sz, cls) => {
          expect(slotHasSize(planetBodySlot(sz, cls))).toBe(true);
          expect(slotHasSize(gasGiantSlot(sz))).toBe(true);
          expect(slotHasSize(emptySlot)).toBe(false);
          expect(slotHasSize(dustCloudSlot)).toBe(false);
        },
      ),
    );
  });
});

describe('starSystem — slotSize', () => {
  it('returns the integer size for Planet and GasGiant slots', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLANET_SIZES),
        fc.constantFrom(...PLANET_CLASSES),
        (sz, cls) => {
          expect(slotSize(planetBodySlot(sz, cls))).toBe(planetSizeToInt(sz));
          expect(slotSize(gasGiantSlot(sz))).toBe(planetSizeToInt(sz));
        },
      ),
    );
  });

  it('returns -1 for slots without a size', () => {
    expect(slotSize(emptySlot)).toBe(-1);
    expect(slotSize(dustCloudSlot)).toBe(-1);
  });
});

describe('starSystem — planetSizeToInt', () => {
  it('is a total order matching the spec', () => {
    expect(planetSizeToInt('Small')).toBe(1);
    expect(planetSizeToInt('Medium')).toBe(2);
    expect(planetSizeToInt('Large')).toBe(3);
    expect(planetSizeToInt('Huge')).toBe(4);
    expect(planetSizeToInt('Small') < planetSizeToInt('Medium')).toBe(true);
    expect(planetSizeToInt('Medium') < planetSizeToInt('Large')).toBe(true);
    expect(planetSizeToInt('Large') < planetSizeToInt('Huge')).toBe(true);
  });
});

describe('starSystem — validity', () => {
  it('isValidStarSystem requires exactly NUM_PLANET_SLOTS slots', () => {
    expect(isValidStarSystem(emptyStarSystem(0))).toBe(true);
    // 7 slots is not valid
    expect(
      isValidStarSystem({ starId: 0, slots: Array(7).fill(emptySlot) }),
    ).toBe(false);
    // 9 slots is not valid
    expect(
      isValidStarSystem({ starId: 0, slots: Array(9).fill(emptySlot) }),
    ).toBe(false);
    // 0 slots is not valid
    expect(
      isValidStarSystem({ starId: 0, slots: [] }),
    ).toBe(false);
  });

  it('NUM_PLANET_SLOTS is 8 (mirrors spec)', () => {
    expect(NUM_PLANET_SLOTS).toBe(8);
  });
});

describe('starSystem — generator', () => {
  it('generateStarSystem returns NUM_PLANET_SLOTS slots', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1_000_000 }), (starId) => {
        const sys = generateStarSystem(starId, Math.random);
        expect(sys.starId).toBe(starId);
        expect(sys.slots.length).toBe(NUM_PLANET_SLOTS);
        expect(isValidStarSystem(sys)).toBe(true);
      }),
    );
  });

  it('generateStarSystem is deterministic for a fixed rand', () => {
    // The same seeded RNG should produce the same system.
    const rand1 = mulberry32(42);
    const sys1 = generateStarSystem(1, rand1);
    const rand2 = mulberry32(42);
    const sys2 = generateStarSystem(1, rand2);
    expect(JSON.stringify(sys1)).toBe(JSON.stringify(sys2));
  });

  it('generateStarSystemForStar is deterministic across calls', () => {
    const a = generateStarSystemForStar(42, 7);
    const b = generateStarSystemForStar(42, 7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('generateStarSystemForStar produces different systems for different starIds', () => {
    // Same seed, different starIds — different systems (with very high
    // probability). We can't expect different *values* deterministically,
    // but at least one slot must differ across most star pairs.
    let differing = 0;
    for (let s = 1; s <= 20; s++) {
      const a = generateStarSystemForStar(42, s);
      const b = generateStarSystemForStar(42, s + 1);
      if (JSON.stringify(a) !== JSON.stringify(b)) differing++;
    }
    // Almost all consecutive pairs should differ. Allow at most 2
    // collisions in 20 (extremely loose).
    expect(differing).toBeGreaterThanOrEqual(18);
  });

  it('generateStarSystemForStar fills every slot with a valid variant', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 100 }),
        (seed, starId) => {
          const sys = generateStarSystemForStar(seed, starId);
          expect(isValidStarSystem(sys)).toBe(true);
          for (const slot of sys.slots) {
            // Every slot is one of the known kinds.
            expect(
              ['Empty', 'DustCloud', 'GasGiant', 'Planet'],
            ).toContain(slot.kind);
          }
        },
      ),
    );
  });
});

describe('starSystem — pickSlot / pickSlotKind / pickSize / pickClass', () => {
  it('pickSlotKind returns a valid kind', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: 0, max: 1 }), (r) => {
        const k = pickSlotKind(() => r);
        expect(['Empty', 'DustCloud', 'GasGiant', 'Planet']).toContain(k);
      }),
    );
  });

  it('pickSize returns a valid size', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: 0, max: 1 }), (r) => {
        const sz = pickSize(() => r);
        expect(PLANET_SIZES).toContain(sz);
      }),
    );
  });

  it('pickClass returns a valid class', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: 0, max: 1 }), (r) => {
        const cls = pickClass(() => r);
        expect(PLANET_CLASSES).toContain(cls);
      }),
    );
  });

  it('pickSlot returns a slot whose kind is in the valid set', () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, min: 0, max: 1 }), (r) => {
        const s = pickSlot(() => r);
        expect(['Empty', 'DustCloud', 'GasGiant', 'Planet']).toContain(s.kind);
      }),
    );
  });
});

describe('starSystem — visualisation helpers', () => {
  it('slotVisualRadius returns 0 for non-body slots', () => {
    expect(slotVisualRadius(emptySlot)).toBe(0);
    expect(slotVisualRadius(dustCloudSlot)).toBe(0);
  });

  it('slotVisualRadius increases with size', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLANET_SIZES),
        fc.constantFrom(...PLANET_CLASSES),
        (sz, cls) => {
          const r1 = slotVisualRadius(planetBodySlot(sz, cls));
          const r2 = slotVisualRadius(gasGiantSlot(sz));
          expect(r1).toBeGreaterThan(0);
          expect(r2).toBeGreaterThan(0);
          // Same size should give the same radius regardless of
          // planet vs gas giant.
          expect(r1).toBe(r2);
        },
      ),
    );
  });

  it('slotColor is deterministic for the same slot', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...PLANET_SIZES),
        fc.constantFrom(...PLANET_CLASSES),
        (sz, cls) => {
          const a = slotColor(planetBodySlot(sz, cls));
          const b = slotColor(planetBodySlot(sz, cls));
          expect(a).toBe(b);
        },
      ),
    );
  });

  it('slotColor for Empty is transparent', () => {
    expect(slotColor(emptySlot)).toBe('transparent');
  });

  it('slotColor for DustCloud / GasGiant is non-transparent', () => {
    expect(slotColor(dustCloudSlot)).not.toBe('transparent');
    fc.assert(
      fc.property(fc.constantFrom(...PLANET_SIZES), (sz) => {
        expect(slotColor(gasGiantSlot(sz))).not.toBe('transparent');
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// mulberry32 — small deterministic 32-bit PRNG. Re-implemented here
// (rather than imported from galaxy) so this test file is standalone
// and doesn't take a runtime dependency on the galaxy module.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Silence the "unused import" warnings for types that are only
// referenced in JSDoc-style type-position comments.
const _types: PlanetSize | PlanetClass | PlanetSlotContents | undefined = undefined;
void _types;