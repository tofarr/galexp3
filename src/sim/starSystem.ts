import { mulberry32 } from './galaxy';

/**
 * Star system data model — Iter 3a.
 *
 * Each star in the galaxy has a deterministic star system: 8
 * orbital slots, each of which can be Empty / DustCloud / GasGiant
 * / Planet (size + classification). This module is the pure data
 * model; the spec lives in `quint/starSystem.qnt`.
 *
 * Iter 3a-d: removed the `Asteroids` variant — astronomically a
 * debris belt is just a denser dust cloud, so the model collapses
 * both into a single `DustCloud` variant. The renderer uses
 * different visualisation settings (blur amount, stroke vs. fill)
 * to convey the two appearances, but the data shape is the same.
 *
 * The model is intentionally a discriminated union in TypeScript
 * (the natural shape) rather than the struct-with-kind that the
 * Quint spec uses to dodge a Quint 0.22.4 type-checker quirk. The
 * two are equivalent and converted in `fromSpec` / `toSpec` helpers
 * if a future iter needs to call into the spec.
 */

export type PlanetSize = 'Small' | 'Medium' | 'Large' | 'Huge';

export type PlanetClass =
  | 'Dead'
  | 'Radiated'
  | 'Toxic'
  | 'Desert'
  | 'Ocean'
  | 'Jungle'
  | 'Terran';

export interface PlanetBody {
  readonly size: PlanetSize;
  readonly classification: PlanetClass;
}

export type PlanetSlotContents =
  | { readonly kind: 'Empty' }
  | { readonly kind: 'DustCloud' }
  | { readonly kind: 'GasGiant'; readonly size: PlanetSize }
  | { readonly kind: 'Planet'; readonly body: PlanetBody };

export interface StarSystem {
  readonly starId: number;
  readonly slots: ReadonlyArray<PlanetSlotContents>;
}

// ---------------------------------------------------------------------------
// Constants — mirror quint/starSystem.qnt
// ---------------------------------------------------------------------------

/** Canonical 8-slot count. See NUM_PLANET_SLOTS in the spec. */
export const NUM_PLANET_SLOTS = 8;

export const PLANET_SIZES: ReadonlyArray<PlanetSize> = [
  'Small',
  'Medium',
  'Large',
  'Huge',
];

export const PLANET_CLASSES: ReadonlyArray<PlanetClass> = [
  'Dead',
  'Radiated',
  'Toxic',
  'Desert',
  'Ocean',
  'Jungle',
  'Terran',
];

// ---------------------------------------------------------------------------
// Slot constructors
// ---------------------------------------------------------------------------

/** Empty slot — no body, no fields populated. */
export const emptySlot: PlanetSlotContents = { kind: 'Empty' };

/**
 * Dust cloud slot. Astronomically a debris belt is just a denser
 * dust cloud, so the model uses a single variant. The renderer
 * chooses between a faint filled disc (sparse cloud) and a
 * blurred stroked ring (debris belt) based on density or some
 * other attribute; for now it always renders the same.
 */
export const dustCloudSlot: PlanetSlotContents = { kind: 'DustCloud' };

export function gasGiantSlot(size: PlanetSize): PlanetSlotContents {
  return { kind: 'GasGiant', size };
}

export function planetBodySlot(
  size: PlanetSize,
  classification: PlanetClass,
): PlanetSlotContents {
  return { kind: 'Planet', body: { size, classification } };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slotIsPlanet(s: PlanetSlotContents): boolean {
  return s.kind === 'Planet';
}

export function slotIsGasGiant(s: PlanetSlotContents): boolean {
  return s.kind === 'GasGiant';
}

export function slotIsOccupied(s: PlanetSlotContents): boolean {
  return s.kind !== 'Empty';
}

export function slotHasSize(s: PlanetSlotContents): boolean {
  return s.kind === 'Planet' || s.kind === 'GasGiant';
}

export function slotSize(s: PlanetSlotContents): number {
  if (s.kind === 'Planet') return planetSizeToInt(s.body.size);
  if (s.kind === 'GasGiant') return planetSizeToInt(s.size);
  return -1;
}

export function planetSizeToInt(s: PlanetSize): number {
  switch (s) {
    case 'Small':  return 1;
    case 'Medium': return 2;
    case 'Large':  return 3;
    case 'Huge':   return 4;
  }
}

// ---------------------------------------------------------------------------
// Validity
// ---------------------------------------------------------------------------

/**
 * A star system is valid iff it has exactly NUM_PLANET_SLOTS slots.
 * We do NOT constrain what each slot holds — Empty is allowed,
 * every slot being occupied is allowed, everything in between
 * is allowed. The only invariant is the slot count. This mirrors
 * isValidStarSystem in quint/starSystem.qnt.
 */
export function isValidStarSystem(s: StarSystem): boolean {
  return s.slots.length === NUM_PLANET_SLOTS;
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

/**
 * Weights for the slot contents selection. Tuned for a roughly
 * star-system-like feel: most orbits are Empty (just like real
 * systems have lots of empty space), but enough is occupied to
 * give the visualisation variety.
 *
 * Iter 3a-d: removed the `Asteroids` row and rolled its 10%
 * weight into `DustCloud` — the two were collapsed into one
 * variant (astronomically equivalent). Net effect: dust clouds
 * are 2× as common (10% → 20%); the rest of the distribution
 * is unchanged.
 */
const KIND_WEIGHTS: ReadonlyArray<{ kind: PlanetSlotContents['kind']; weight: number }> = [
  { kind: 'Empty',     weight: 30 },
  { kind: 'DustCloud', weight: 20 },
  { kind: 'GasGiant',  weight: 10 },
  { kind: 'Planet',    weight: 40 },
];

/** Total weight (sum of KIND_WEIGHTS) for the weighted draw. */
const TOTAL_KIND_WEIGHT = KIND_WEIGHTS.reduce((acc, w) => acc + w.weight, 0);

/**
 * Pick a slot kind using a uniform random number in [0, 1).
 * Exported for tests; not part of the public API contract.
 */
export function pickSlotKind(rand: () => number): PlanetSlotContents['kind'] {
  const r = rand() * TOTAL_KIND_WEIGHT;
  let acc = 0;
  for (const { kind, weight } of KIND_WEIGHTS) {
    acc += weight;
    if (r < acc) return kind;
  }
  // Floating-point fallback (r very close to TOTAL_KIND_WEIGHT).
  return KIND_WEIGHTS[KIND_WEIGHTS.length - 1]!.kind;
}

/**
 * Pick a size using a uniform random number in [0, 1).
 * Exported for tests.
 */
export function pickSize(rand: () => number): PlanetSize {
  const idx = Math.floor(rand() * PLANET_SIZES.length);
  return PLANET_SIZES[Math.min(idx, PLANET_SIZES.length - 1)]!;
}

/**
 * Pick a class using a uniform random number in [0, 1).
 * Exported for tests.
 */
export function pickClass(rand: () => number): PlanetClass {
  const idx = Math.floor(rand() * PLANET_CLASSES.length);
  return PLANET_CLASSES[Math.min(idx, PLANET_CLASSES.length - 1)]!;
}

/**
 * Pick a slot contents using the weighted distribution.
 * The `rand` function should return a uniform number in [0, 1).
 * Pure: no hidden state, no I/O.
 */
export function pickSlot(rand: () => number): PlanetSlotContents {
  const kind = pickSlotKind(rand);
  switch (kind) {
    case 'Empty':     return emptySlot;
    case 'DustCloud': return dustCloudSlot;
    case 'GasGiant':  return gasGiantSlot(pickSize(rand));
    case 'Planet':    return planetBodySlot(pickSize(rand), pickClass(rand));
  }
}

/**
 * Generate a star system for a single star. The result has
 * exactly NUM_PLANET_SLOTS slots, each chosen independently using
 * `rand` for determinism (when wired to a seeded RNG).
 */
export function generateStarSystem(
  starId: number,
  rand: () => number,
): StarSystem {
  const slots: PlanetSlotContents[] = [];
  for (let i = 0; i < NUM_PLANET_SLOTS; i++) {
    slots.push(pickSlot(rand));
  }
  return { starId, slots };
}

/**
 * Hash (seed, starId) into a 32-bit seed. FNV-1a on the
 * stringified (seed, starId) — same algorithm used in
 * src/sim/galaxy.ts for consistency.
 */
function starSystemRngSeed(seed: number, starId: number): number {
  // FNV-1a 32-bit on a stringified tuple
  const str = `${seed}|${starId}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Generate a star system for a given (seed, starId) pair, using
 * a deterministic seeded PRNG. Two callers asking for the same
 * (seed, starId) always get the same system.
 */
export function generateStarSystemForStar(
  seed: number,
  starId: number,
): StarSystem {
  const rng = mulberry32(starSystemRngSeed(seed, starId));
  return generateStarSystem(starId, rng);
}

/**
 * Build a StarSystem with 8 empty slots. Useful for test fixtures
 * that don't care about the actual planets and just need a valid
 * StarSystem to satisfy the type.
 */
export function emptyStarSystem(starId: number): StarSystem {
  const slots: PlanetSlotContents[] = [];
  for (let i = 0; i < NUM_PLANET_SLOTS; i++) slots.push(emptySlot);
  return { starId, slots };
}

// ---------------------------------------------------------------------------
// Visualisation helpers (UI-side data; pure, no DOM)
// ---------------------------------------------------------------------------

/**
 * Visual radius in pixels for a slot's body, given the slot size
 * in [1, 4]. Returns 0 for slots without a body. The formula is
 * `0.6 + size * 0.6` (range 1.2..3.0 px) — small enough to keep the
 * background unobtrusive, large enough to be readable.
 */
export function slotVisualRadius(s: PlanetSlotContents): number {
  const sz = slotSize(s);
  if (sz < 0) return 0;
  return 0.6 + sz * 0.6;
}

/**
 * CSS color for a planet slot. We return a string for the renderer
 * to drop into a `fill` or `stroke` attribute. Gas giants get a
 * single representative brown — the banded rendering is left to
 * a future iter.
 */
export function slotColor(s: PlanetSlotContents): string {
  switch (s.kind) {
    case 'Empty':     return 'transparent';
    case 'DustCloud': return '#c8b890';
    case 'GasGiant':  return '#b8945a';
    case 'Planet':    return planetColor(s.body.classification);
  }
}

/**
 * CSS color for a planet classification. Pulled out so the
 * discriminator switch can use a typed `s.body.classification`
 * (TypeScript can't narrow `s.body` through the outer switch
 * otherwise).
 */
function planetColor(c: PlanetClass): string {
  switch (c) {
    case 'Dead':     return '#7a7066';
    case 'Radiated': return '#8a6238';
    case 'Toxic':    return '#a8b04a';
    case 'Desert':   return '#c89858';
    case 'Ocean':    return '#4878b8';
    case 'Jungle':   return '#3a7848';
    case 'Terran':   return '#4888a8';
  }
}
