/**
 * Galaxy data model.
 *
 * Iteration 1e. Mirrors quint/galaxy.qnt.
 *
 * Per-star numeric `size` (in [STAR_SIZE_MIN, STAR_SIZE_MAX]) drives
 * the rendered body radius and bloom width, and will later govern
 * resource yield of a colonised star. The colour is one of six
 * preset hues (white/yellow/red/orange/green/purple).
 *
 * Pure module — no I/O, no rendering, no randomness outside
 * `initGalaxy` which accepts a seeded PRNG.
 *
 * Invariants guaranteed by `initGalaxy`:
 *   - stars.length === STAR_COUNT_FOR_SIZE[size]
 *   - all star ids in 1..N are present exactly once
 *   - every star position lies within (or on the boundary of) a disc
 *     of radius `radius` centred at the origin
 *   - no two stars share the same (x, y) position
 *   - every star.size in [STAR_SIZE_MIN, STAR_SIZE_MAX]
 *   - same seed + size always produces the same galaxy (determinism)
 *
 * Positions and radius are integers in abstract units (same as the
 * Quint spec). The renderer in src/ui/ scales these to pixels. To
 * preserve Quint <-> TS parity at integer granularity, positions are
 * stored as integers; any sub-integer generation noise is rounded.
 */

/**
 * Star body colour palette. Mirror of `StarColor` in quint/galaxy.qnt.
 * Six visually distinct hues. Not a physical spectral classification —
 * Green and Purple aren't realistic in the Morgan-Keenan system but
 * we want visual variety for gameplay.
 */
export const STAR_COLORS = [
  'White',
  'Yellow',
  'Red',
  'Orange',
  'Green',
  'Purple',
] as const;

export type StarColor = (typeof STAR_COLORS)[number];

/** sRGB hex body colour (format "0xRRGGBB") for a star of the given colour. */
export type HexColor = string;

export const STAR_COLOR_FOR_COLOR: Record<StarColor, HexColor> = {
  White: '0xffffff',
  Yellow: '0xffe680',
  Orange: '0xffb060',
  Red: '0xff8080',
  Green: '0xa0ffa0',
  Purple: '0xc080ff',
};

/**
 * sRGB hex halo / bloom colour (format "0xRRGGBB") for a star of the
 * given colour. Slightly more saturated than the body, so the halo
 * reads as scatter rather than a shadow.
 */
export const STAR_HALO_COLOR_FOR_COLOR: Record<StarColor, HexColor> = {
  White: '0xdde8ff',
  Yellow: '0xffd040',
  Orange: '0xff8030',
  Red: '0xff5050',
  Green: '0x60ff60',
  Purple: '0x8040ff',
};

/** Inclusive minimum star size. Mirror of STAR_SIZE_MIN. */
export const STAR_SIZE_MIN = 1;

/** Inclusive maximum star size. Mirror of STAR_SIZE_MAX. */
export const STAR_SIZE_MAX = 100;

/** True iff `sz` lies in [STAR_SIZE_MIN, STAR_SIZE_MAX]. */
export function isValidSize(sz: number): boolean {
  return Number.isInteger(sz) && sz >= STAR_SIZE_MIN && sz <= STAR_SIZE_MAX;
}

/**
 * Pixel radius of a star body for a star of numeric size `s`.
 * Linear interpolation: size=1 → 1 px, size=100 → 5 px.
 * Mirror of STAR_BODY_PX in quint/galaxy.qnt.
 */
export function starBodyPx(s: number): number {
  if (!isValidSize(s)) return 0;
  // 1 + (s - 1) * 4 / 99 → integer math mirroring the Quint formula.
  return 1 + Math.trunc(((s - 1) * 4) / 99);
}

/**
 * Pixel radius of the star's inner bloom. About 1.7x the body with
 * a floor of 2 so even tiny stars get a visible bloom.
 * Mirror of STAR_BLOOM_PX.
 */
export function starBloomPx(s: number): number {
  const b = starBodyPx(s);
  if (b === 0) return 0;
  const r = Math.trunc((b * 17) / 10);
  return r < 2 ? 2 : r;
}

/**
 * Pixel radius of the star's outer halo. About 3x the body, with a
 * floor of 3. Mirror of STAR_HALO_PX.
 */
export function starHaloPx(s: number): number {
  const b = starBodyPx(s);
  if (b === 0) return 0;
  const r = b * 3;
  return r < 3 ? 3 : r;
}

/**
 * Gaussian-blur strength (pixels) applied to the inner bloom.
 * Mirror of STAR_BLOOM_BLUR_PX. Range 1..5.
 */
export function starBloomBlurPx(s: number): number {
  if (!isValidSize(s)) return 0;
  return 1 + Math.trunc(((s - 1) * 4) / 99);
}

/**
 * Gaussian-blur strength (pixels) applied to the outer halo.
 * **Heavy** blur layer in the new rendering.
 * Mirror of STAR_HALO_BLUR_PX. Range 2..12.
 */
export function starHaloBlurPx(s: number): number {
  if (!isValidSize(s)) return 0;
  return 2 + Math.trunc(((s - 1) * 10) / 99);
}

/**
 * Gaussian-blur strength (pixels) applied to the central white core.
 * **Lesser** blur layer. Range 0..3.
 * Mirror of STAR_CORE_BLUR_PX.
 */
export function starCoreBlurPx(s: number): number {
  if (!isValidSize(s)) return 0;
  return Math.trunc(((s - 1) * 3) / 99);
}

/** Inner-bloom alpha (0..255). ~0.43. */
export const STAR_BLOOM_ALPHA = 110;

/** Outer-halo alpha (0..255). ~0.24. */
export const STAR_HALO_ALPHA = 60;

/** White-core alpha (0..255). Opaque. */
export const STAR_CORE_ALPHA = 255;

export const GALAXY_SIZES = ['Small', 'Medium', 'Large', 'Huge'] as const;
export type GalaxySize = (typeof GALAXY_SIZES)[number];

/**
 * Authoritative star counts per galaxy size.
 * Source: Master of Orion (1993). Mirror of STAR_COUNT in
 * quint/galaxy.qnt.
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
  readonly color: StarColor;
  readonly size: number;
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
 * Each star gets:
 *   - a colour drawn uniformly from STAR_COLORS (round-robin in
 *     practice, since we index by `stars.length`)
 *   - a numeric size drawn uniformly from [STAR_SIZE_MIN, STAR_SIZE_MAX]
 *     (uniform for now — gameplay-balancing will tune later)
 *
 * The function is total: if the minimum distance is too tight to fit
 * the target star count, the minimum is relaxed progressively until
 * the disc can hold the required number.
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

    // Uniform numeric size in [STAR_SIZE_MIN, STAR_SIZE_MAX].
    const sizeRaw =
      STAR_SIZE_MIN +
      Math.floor(rng() * (STAR_SIZE_MAX - STAR_SIZE_MIN + 1));

    stars.push({
      id: stars.length + 1,
      color: STAR_COLORS[stars.length % STAR_COLORS.length]!,
      size: sizeRaw,
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

    if (!isValidSize(s.size)) return false;
  }
  return true;
}