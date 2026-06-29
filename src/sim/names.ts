/**
 * Star-naming helpers.
 *
 * Each star in a galaxy gets a sci-fi-sounding display name composed
 * of a prefix and a suffix (e.g. "Vega Prime", "Orion Secundus").
 * Names are unique within the galaxy.
 *
 * Mirrored as placeholders in `quint/galaxy.qnt` (the spec names the
 * scheme; this file is the source of truth for the actual words).
 *
 * Determinism: pass the same `rng` as the rest of galaxy generation
 * to get reproducible names for a given seed.
 */

export const STAR_NAME_PREFIXES: ReadonlyArray<string> = [
  // Real star / constellation names (vaguely sci-fi by association).
  'Aldebaran',
  'Altair',
  'Andromeda',
  'Antares',
  'Arcturus',
  'Astra',
  'Bellatrix',
  'Betelgeuse',
  'Capella',
  'Castor',
  'Cygnus',
  'Deneb',
  'Eridanus',
  'Fomalhaut',
  'Helios',
  'Hydra',
  'Lyra',
  'Mira',
  'Mizar',
  'Nova',
  'Orion',
  'Perseus',
  'Phoenix',
  'Pollux',
  'Polaris',
  'Proxima',
  'Regulus',
  'Rigel',
  'Sirius',
  'Taurus',
  'Vega',
  // Made-up sci-fi syllables for that "sounds invented" feel.
  'Aethon',
  'Arctis',
  'Belari',
  'Corvus',
  'Drakkon',
  'Elysion',
  'Fenrir',
  'Galadon',
  'Hektor',
  'Illium',
  'Jovara',
  'Kythara',
  'Lirion',
  'Myriador',
  'Nereus',
  'Oberon',
  'Pyrran',
  'Quorath',
  'Rhelion',
  'Selene',
  'Thalassa',
  'Umbriel',
  'Valos',
  'Weylan',
  'Xandria',
  'Yggdrasil',
  'Zephyria',
  'Othrys',
  'Tartaros',
];

export const STAR_NAME_SUFFIXES: ReadonlyArray<string> = [
  'Prime',
  'Major',
  'Minor',
  'Secundus',
  'Tertius',
  'Alpha',
  'Beta',
  'Gamma',
  'Delta',
  'Epsilon',
];

/**
 * Items the name-generation cares about. Pulling this in via a
 * structural type means the function works whether `Star` has a
 * `name` field yet or not — useful for tests that hand-build
 * fixtures.
 */
export interface NameableStar {
  readonly id: number;
}

/**
 * Total — assigns every input star a non-empty, galaxy-unique name.
 * Returns a new array of stars with the `name` field populated; the
 * input stars are not mutated.
 *
 * Strategy:
 *   1. Build the full prefix×suffix product as a flat list, then
 *      Fisher-Yates shuffle it with `rng`. This produces one big
 *      randomized sequence of candidate names that we walk
 *      sequentially, taking the first one not already used.
 *   2. The walk starts at a *different* offset for each star (also
 *      from `rng`) so consecutive stars don't pull consecutive
 *      names from the same corner of the shuffle.
 *   3. If the entire pool is exhausted (won't happen for any
 *      galaxy size up to Huge — pool has 600 names; Huge has 72
 *      stars), fall back to "<prefix> <disambiguator>" with an
 *      integer that itself is checked against the used set.
 *
 * The flat-shuffle approach gives a more uniform distribution than
 * draining one prefix before moving on: every star has equal odds
 * of getting any prefix.
 */
export interface NamedStar extends NameableStar {
  readonly name: string;
}

export function nameStars<StarT extends NameableStar>(
  stars: ReadonlyArray<StarT>,
  rng: () => number,
): Array<StarT & NamedStar> {
  const used = new Set<string>();
  const out: Array<StarT & NamedStar> = [];

  // Build the full product and shuffle once.
  const pool: string[] = [];
  for (const prefix of STAR_NAME_PREFIXES) {
    for (const suffix of STAR_NAME_SUFFIXES) {
      pool.push(`${prefix} ${suffix}`);
    }
  }
  shuffleInPlace(pool, rng);

  // A separate shuffled prefix list, used only by the disambiguator
  // fallback path.
  const prefixOrder = shuffleStable(STAR_NAME_PREFIXES, rng);

  for (const star of stars) {
    let chosen: string | null = null;

    // Walk the shuffled pool starting at a different offset each
    // star. One full pass is enough since the pool is much larger
    // than any galaxy size — but to be safe against the (already
    // impossible) all-taken case, wrap around twice.
    const offset = Math.floor(rng() * pool.length);
    for (let step = 0; step < pool.length * 2; step++) {
      const candidate = pool[(offset + step) % pool.length]!;
      if (!used.has(candidate)) {
        chosen = candidate;
        break;
      }
    }

    if (chosen === null) {
      // Collision storm — append a numeric disambiguator. Picks a
      // random prefix from the shuffled order and pairs it with
      // an integer that bumps until unique.
      let n = 2;
      while (true) {
        const prefix = prefixOrder[n % prefixOrder.length]!;
        const candidate = `${prefix} ${n}`;
        if (!used.has(candidate)) {
          chosen = candidate;
          break;
        }
        n++;
      }
    }

    used.add(chosen);
    out.push({ ...star, name: chosen });
  }

  return out;
}

/**
 * Fisher-Yates shuffle returning a *new* array.
 */
function shuffleStable<T>(arr: ReadonlyArray<T>, rng: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/**
 * Fisher-Yates shuffle, in place.
 */
function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i]!;
    arr[i] = arr[j]!;
    arr[j] = tmp;
  }
}
