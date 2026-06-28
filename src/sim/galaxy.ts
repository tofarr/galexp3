/**
 * Galaxy data model.
 *
 * Iteration 1a. Mirrors quint/galaxy.qnt.
 * Pure module — no I/O, no rendering, no randomness outside `initGalaxy`
 * which accepts a seeded PRNG.
 *
 * Invariants guaranteed by `initGalaxy`:
 *   - stars.length === STAR_COUNT_FOR_SIZE[size]
 *   - all star ids in 1..N are present exactly once
 *   - every star position lies within (or on the boundary of) a disc of
 *     radius `radius` centred at the origin
 *   - no two stars share the same (x, y) position
 *   - same seed + size always produces the same galaxy (determinism)
 *
 * Positions and radius are integers in abstract units (same as the Quint
 * spec). The renderer in src/ui/ will scale these to pixels. To preserve
 * Quint <-> TS parity at integer granularity, positions are stored as
 * integers; any sub-integer generation noise is rounded.
 */

export const STAR_KINDS = [
  'Blue',
  'White',
  'Yellow',
  'Red',
  'Orange',
  'Brown',
] as const;

export type StarKind = (typeof STAR_KINDS)[number];

export const GALAXY_SIZES = ['Small', 'Medium', 'Large', 'Huge'] as const;
export type GalaxySize = (typeof GALAXY_SIZES)[number];

/**
 * Authoritative star counts per galaxy size.
 * Source: Master of Orion (1993). Mirror of STAR_COUNT in quint/galaxy.qnt.
 */
export const STAR_COUNT_FOR_SIZE: Record<GalaxySize, number> = {
  Small: 24,
  Medium: 33,
  Large: 48,
  Huge: 72,
};

export interface Position {
  readonly x: number;
  readonly y: number;
}

export interface Star {
  readonly id: number;
  readonly kind: StarKind;
  readonly position: Position;
}

export interface Galaxy {
  readonly size: GalaxySize;
  readonly radius: number;
  readonly stars: ReadonlyArray<Star>;
}

/**
 * Authoritative disc radius per galaxy size (integer abstract units).
 * Mirror of RADIUS in quint/galaxy.qnt. Keep in sync with the spec.
 */
export const RADIUS_FOR_SIZE: Record<GalaxySize, number> = {
  Small: 50,
  Medium: 60,
  Large: 70,
  Huge: 90,
};

/**
 * Deterministic seeded PRNG (Mulberry32).
 * Same seed -> same sequence. Not cryptographic.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Prng {
  (): number;
}

/**
 * Sample an integer point inside (or on the boundary of) a disc of
 * radius `r` centred at the origin, using the supplied PRNG. Returns a
 * Position whose x and y are integers in the range [-r, r].
 */
function sampleInDiscInt(rng: Prng, r: number): Position {
  while (true) {
    // Sample integer coords uniformly in the inscribed square, reject
    // those outside the disc. Distribution is uniform over the disc
    // because the rejection is geometric (square minus corners).
    const x = Math.floor(rng() * (2 * r + 1)) - r;
    const y = Math.floor(rng() * (2 * r + 1)) - r;
    if (x * x + y * y <= r * r) {
      return { x, y };
    }
  }
}

/**
 * Compute a minimum star-to-star distance for Poisson-disk style
 * rejection sampling at integer granularity. With N stars in a disc of
 * radius R, an even hex-style spread gives roughly
 *   d = 2 * sqrt(area / (sqrt(12) * N))
 * We use a slightly relaxed fraction so generation has slack.
 */
function minStarDistance(n: number, radius: number): number {
  const area = Math.PI * radius * radius;
  const perStar = area / n;
  return (Math.sqrt(perStar / 3.464) * 0.8) | 0; // floor to integer
}

/**
 * Generate a galaxy of the given size using a seeded PRNG.
 * Stars are placed using rejection sampling inside a bounded disc with a
 * minimum distance between any two stars (Poisson-disk style).
 *
 * The function is total: if the minimum distance is too tight to fit the
 * target star count, the minimum is relaxed progressively until the disc
 * can hold the required number.
 *
 * Determinism: identical (seed, size) always produces an identical galaxy.
 */
export function initGalaxy(seed: number, size: GalaxySize): Galaxy {
  const rng = mulberry32(seed);
  const radius = RADIUS_FOR_SIZE[size];
  const targetCount = STAR_COUNT_FOR_SIZE[size];
  let minDist = minStarDistance(targetCount, radius);

  const stars: Star[] = [];
  let safety = 0;
  const SAFETY_LIMIT = 1000;

  // Relax minDist until we can place all target stars within budget.
  while (stars.length < targetCount) {
    safety++;
    if (safety > SAFETY_LIMIT) {
      if (minDist < 1) {
        throw new Error(
          `initGalaxy: failed to place ${targetCount} stars of size ${size} with radius ${radius}`,
        );
      }
      minDist = (minDist * 0.95) | 0;
      stars.length = 0;
      safety = 0;
    }

    const candidate = sampleInDiscInt(rng, radius);
    let ok = true;
    for (let i = 0; i < stars.length; i++) {
      const other = stars[i]!;
      const dx = candidate.x - other.position.x;
      const dy = candidate.y - other.position.y;
      if (dx * dx + dy * dy < minDist * minDist) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    stars.push({
      id: stars.length + 1,
      kind: STAR_KINDS[stars.length % STAR_KINDS.length]!,
      position: candidate,
    });
  }

  return {
    size,
    radius,
    stars,
  };
}

/**
 * Validity predicate mirroring `isValidGalaxy` from quint/galaxy.qnt.
 * Used by property tests and as a defensive runtime check.
 */
export function isValidGalaxy(g: Galaxy): boolean {
  if (g.stars.length !== STAR_COUNT_FOR_SIZE[g.size]) return false;
  if (g.radius !== RADIUS_FOR_SIZE[g.size]) return false;

  const seenIds = new Set<number>();
  const seenPositions = new Set<string>();
  for (const s of g.stars) {
    if (seenIds.has(s.id)) return false;
    seenIds.add(s.id);

    const key = `${s.position.x}|${s.position.y}`;
    if (seenPositions.has(key)) return false;
    seenPositions.add(key);

    const r = g.radius;
    if (s.position.x * s.position.x + s.position.y * s.position.y > r * r) {
      return false;
    }
  }
  return true;
}
