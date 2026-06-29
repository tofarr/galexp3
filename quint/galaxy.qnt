// SPDX-License-Identifier: MIT
//
// galaxy.qnt
//
// Iteration 1e — Galaxy data model + per-star appearance.
//
// Scope (current):
//   - Position, StarColor, GalaxySize, Galaxy types
//   - Per-size star counts and disc radii
//   - Per-star numeric size in [STAR_SIZE_MIN, STAR_SIZE_MAX]
//     — will later govern resource yield of a colonised star.
//   - Validity predicate isValidGalaxy(g)
//   - Static sanity checks (Quint `run` checks)
//
// What is intentionally NOT here yet:
//   - Players, empires, planets, fleets
//   - Turn resolution, combat, research, diplomacy
//   - Rendering, persistence, AI
//   - An action-level initGalaxy. The TypeScript module proves by
//     construction (via property tests) that initGalaxy(seed, size)
//     always produces a galaxy satisfying isValidGalaxy. We will lift
//     the generator into the spec in a later iteration when state and
//     transitions are introduced; for now the spec is purely about
//     validity of static galaxy values.
//
// The TypeScript implementation in src/sim/galaxy.ts mirrors this spec
// and is verified by property tests in src/sim/galaxy.test.ts.
// Per the Quint <-> TS parity rule, every invariant stated here must
// have a corresponding Vitest property test in TypeScript.
//
// Note on types: Quint has no `float`. Positions are integers in abstract
// units; the renderer in src/ui/ will scale to pixels. The TypeScript
// side uses `number` (double precision) but rounds to integers before
// asserting equality against the spec's predicates, so the parity holds
// at integer granularity. If we ever need sub-unit precision in the
// spec, we'd swap to a fixed-point representation.

module galaxy {

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  /// Star body colour palette. Six visually distinct hues picked to
  /// read against the dark blue disc background. Not a physical
  /// spectral classification — "Green" and "Purple" stars are not
  /// realistic in the Morgan-Keenan system, but we want visual
  /// variety for gameplay (coloured empires, alien races, etc.).
  type StarColor =
    | White
    | Yellow
    | Red
    | Orange
    | Green
    | Purple

  /// sRGB hex colour for the body of a star of the given colour.
  /// Format: "0xRRGGBB" (lowercase hex). Used by the renderer to
  /// fill the star body.
  /// (No colour-management discussion in the spec; the renderer is
  /// expected to pass these through verbatim to its colour API.)
  type HexColor = str

  /// A star's position in the galaxy. Continuous 2D space.
  /// Units are abstract integers (rendering will scale them to pixels).
  type Position = { x: int, y: int }

  /// Unique identifier of a star within a single galaxy.
  /// IDs are dense integers 1..N where N is the size's star count.
  type StarId = int

  /// A single star system. v1 keeps the system itself abstract —
  /// no planets, no buildings, no colony state yet.
  /// `size` is a positive integer in [STAR_SIZE_MIN, STAR_SIZE_MAX].
  /// Larger stars render with bigger bodies, wider blooms, and (later)
  /// produce more resources when colonised.
  type Star = {
    id: StarId,
    color: StarColor,
    size: int,
    position: Position
  }

  /// Galaxy size presets. Star counts come from Master of Orion (1993):
  ///   Small  -> 24 stars
  ///   Medium -> 33 stars
  ///   Large  -> 48 stars
  ///   Huge   -> 72 stars
  /// See STAR_COUNT below for the authoritative table.
  /// MoO 2 used a slightly different scale (24/40/56/80); swap if desired.
  type GalaxySize = Small | Medium | Large | Huge

  /// A galaxy is a set of stars placed within a bounded disc.
  /// `radius` is the disc radius in the same abstract units as Position.
  type Galaxy = {
    size: GalaxySize,
    radius: int,
    stars: Set[Star]
  }

  // ---------------------------------------------------------------------------
  // Constants (parameterised by GalaxySize)
  // ---------------------------------------------------------------------------

  /// Authoritative star counts per galaxy size.
  /// Source: Master of Orion (1993), SimTex / MicroProse.
  /// If we change these, regenerate every saved galaxy — they are not
  /// versioned in saves yet (that comes with persistence in Iter 2).
  pure def STAR_COUNT(s: GalaxySize): int =
    if (s == Small)  24
    else if (s == Medium) 33
    else if (s == Large)  48
    else 72

  /// Authoritative disc radius per galaxy size (in abstract units).
  /// These are picked to keep star density roughly constant across sizes.
  /// Mirror src/sim/galaxy.ts#galaxyRadius. Tuned in tandem with the
  /// renderer — change here AND in the TS module together.
  pure def RADIUS(s: GalaxySize): int =
    if (s == Small)  50
    else if (s == Medium) 60
    else if (s == Large)  70
    else 90

  // ---------------------------------------------------------------------------
  // Star numeric size range
  // ---------------------------------------------------------------------------

  /// Inclusive minimum star size. Below this the star is essentially
  /// invisible and not worth colonising; the invariant rejects it.
  pure val STAR_SIZE_MIN: int = 1

  /// Inclusive maximum star size. Above this the bloom becomes
  /// unmanageably wide at extreme zoom-out; tune as needed.
  pure val STAR_SIZE_MAX: int = 100

  /// True iff a star's numeric size is within the allowed range.
  pure def isValidSize(sz: int): bool =
    sz >= STAR_SIZE_MIN and sz <= STAR_SIZE_MAX

  // ---------------------------------------------------------------------------
  // Star appearance tables
  // ---------------------------------------------------------------------------
  //
  // These tables bind a StarColor to its body and halo colour, and
  // give pixel-scale formulas driven by the star's numeric size.
  // The mapping is fixed — every star in every galaxy uses the
  // same formulas. Gameplay relevance: `size` will later drive
  // resource yield of a colonised star (defined in a later iteration).

  /// sRGB hex body colour (format "0xRRGGBB") for a star of the given
  /// colour. Colours are picked to be visually distinct against the
  /// #1a2545 disc background while still reading as a star.
  pure def STAR_COLOR(c: StarColor): HexColor =
    if (c == White)   "0xffffff"
    else if (c == Yellow)  "0xffe680"
    else if (c == Orange)  "0xffb060"
    else if (c == Red)     "0xff8080"
    else if (c == Green)   "0xa0ffa0"
    else "0xc080ff"  // Purple

  /// sRGB hex halo / bloom colour (format "0xRRGGBB") for a star of the
  /// given colour. Slightly more saturated than the body, with hue
  /// pushed toward the warm side where the body is cool and vice
  /// versa, so the bloom reads as scatter rather than a shadow.
  pure def STAR_HALO_COLOR(c: StarColor): HexColor =
    if (c == White)   "0xdde8ff"
    else if (c == Yellow)  "0xffd040"
    else if (c == Orange)  "0xff8030"
    else if (c == Red)     "0xff5050"
    else if (c == Green)   "0x60ff60"
    else "0x8040ff"  // Purple

  /// Pixel radius of a star body for a star of numeric size `s`.
  /// Linear interpolation: size=1 → 1 px, size=100 → 5 px. The
  /// renderer leaves body size fixed (no zoom-scaling) so stars
  /// stay visible at any zoom.
  pure def STAR_BODY_PX(s: int): int =
    if (s < STAR_SIZE_MIN) 0
    else if (s > STAR_SIZE_MAX) 0
    else
      // 1 + (s - 1) * 4 / 99 → 1..5 across the full range.
      // Integer math: ((s - 1) * 4) / 99 truncated toward zero.
      1 + ((s - 1) * 4 / 99)

  /// Pixel radius of the star's inner bloom (the medium-soft scatter
  /// around the body). About 1.7x the body, with a floor of 2 so
  /// even tiny stars get a visible bloom.
  pure def STAR_BLOOM_PX(s: int): int =
    val b = STAR_BODY_PX(s)
    if (b == 0) 0
    else
      val r = b * 17 / 10
      if (r < 2) 2 else r

  /// Pixel radius of the star's outer halo (the wide, very-soft
  /// scatter). About 3x the body, gives the "atmospheric bloom" feel.
  pure def STAR_HALO_PX(s: int): int =
    val b = STAR_BODY_PX(s)
    if (b == 0) 0
    else
      val r = b * 3
      if (r < 3) 3 else r

  /// Gaussian-blur strength (pixels) applied to the inner bloom.
  /// Larger stars get a wider, softer inner bloom.
  pure def STAR_BLOOM_BLUR_PX(s: int): int =
    if (s < STAR_SIZE_MIN) 0
    else if (s > STAR_SIZE_MAX) 0
    else
      // 1 + (s - 1) * 4 / 99 → 1..5 across the full range.
      1 + ((s - 1) * 4 / 99)

  /// Gaussian-blur strength (pixels) applied to the outer halo. This
  /// is the **heavy** blur layer in the new rendering — it makes the
  /// halo read as soft scatter rather than a hard ring.
  pure def STAR_HALO_BLUR_PX(s: int): int =
    if (s < STAR_SIZE_MIN) 0
    else if (s > STAR_SIZE_MAX) 0
    else
      // 2 + (s - 1) * 10 / 99 → 2..12 across the full range.
      2 + ((s - 1) * 10 / 99)

  /// Gaussian-blur strength (pixels) applied to the central white
  /// core. This is the **lesser** blur layer — it keeps the core
  /// reading as a sharp point of light while still softening the
  /// pixel edges so it merges naturally with the bloom.
  pure def STAR_CORE_BLUR_PX(s: int): int =
    if (s < STAR_SIZE_MIN) 0
    else if (s > STAR_SIZE_MAX) 0
    else
      // (s - 1) * 3 / 99 → 0..3 across the full range.
      (s - 1) * 3 / 99

  /// Inner-bloom alpha (0..255). Modest opacity; the halo below is
  /// the dominant glow layer.
  pure val STAR_BLOOM_ALPHA: int = 110  // ~0.43

  /// Outer-halo alpha (0..255). Lower than the inner bloom — the
  /// halo is the soft, distant scatter.
  pure val STAR_HALO_ALPHA: int = 60   // ~0.24

  /// White-core alpha (0..255). Fully opaque so the core reads as
  /// the brightest point.
  pure val STAR_CORE_ALPHA: int = 255

  // ---------------------------------------------------------------------------
  // Predicates
  // ---------------------------------------------------------------------------

  /// True iff `p` lies within (or on the boundary of) the disc of
  /// radius `r` centred at the origin.
  pure def withinDisc(p: Position, r: int): bool =
    (p.x * p.x) + (p.y * p.y) <= r * r

  /// True iff every star in the galaxy lies inside the disc.
  pure def allStarsWithinBounds(g: Galaxy): bool =
    g.stars.forall(s => withinDisc(s.position, g.radius))

  /// True iff every star in the galaxy has a unique id.
  pure def starIdsUnique(g: Galaxy): bool =
    g.stars.size() == g.stars.map(s => s.id).size()

  /// True iff no two stars occupy the same position (exact equality).
  /// Poisson-disk sampling in TS will enforce a minimum distance,
  /// which strictly implies this.
  pure def noDuplicatePositions(g: Galaxy): bool =
    g.stars.forall(s1 =>
      g.stars.forall(s2 =>
        s1 == s2 or (s1.position.x != s2.position.x) or (s1.position.y != s2.position.y)
      )
    )

  /// True iff every star in the galaxy has a numeric size in
  /// [STAR_SIZE_MIN, STAR_SIZE_MAX].
  pure def allStarsHaveValidSize(g: Galaxy): bool =
    g.stars.forall(s => isValidSize(s.size))

  /// True iff the galaxy contains exactly the expected number of stars
  /// for its declared size.
  pure def starCountMatchesSize(g: Galaxy): bool =
    g.stars.size() == STAR_COUNT(g.size)

  /// True iff the galaxy's declared radius matches the spec value for
  /// its size. This anchors the renderer / spec agreement.
  pure def radiusMatchesSize(g: Galaxy): bool =
    g.radius == RADIUS(g.size)

  /// Top-level validity predicate. Any generated galaxy MUST satisfy this.
  pure def isValidGalaxy(g: Galaxy): bool =
    starCountMatchesSize(g)
    and radiusMatchesSize(g)
    and starIdsUnique(g)
    and allStarsWithinBounds(g)
    and noDuplicatePositions(g)
    and allStarsHaveValidSize(g)

  /// Convenience: human-readable diagnostic name for a galaxy size.
  pure def galaxySizeName(s: GalaxySize): str =
    if (s == Small)  "Small"
    else if (s == Medium) "Medium"
    else if (s == Large)  "Large"
    else "Huge"

  // ---------------------------------------------------------------------------
  // Static sanity checks (Quint `run` checks)
  // ---------------------------------------------------------------------------

  /// Static assertion that every size has a non-zero star count.
  run sizeHasPositiveCount =
    STAR_COUNT(Small) > 0
    and STAR_COUNT(Medium) > 0
    and STAR_COUNT(Large) > 0
    and STAR_COUNT(Huge) > 0

  /// Static assertion that sizes are strictly increasing.
  run sizesAreOrdered =
    STAR_COUNT(Small) < STAR_COUNT(Medium)
    and STAR_COUNT(Medium) < STAR_COUNT(Large)
    and STAR_COUNT(Large) < STAR_COUNT(Huge)

  /// Static assertion that every size has a positive radius.
  run sizesHavePositiveRadius =
    RADIUS(Small) > 0
    and RADIUS(Medium) > 0
    and RADIUS(Large) > 0
    and RADIUS(Huge) > 0

  /// Star size range is sane.
  run starSizeRangeIsSane =
    STAR_SIZE_MIN >= 1
    and STAR_SIZE_MAX > STAR_SIZE_MIN

  /// Spot-check that body radius lies in [1, 5] for a sweep of sizes.
  /// Linear formula `1 + (s-1)*4/99` clamps correctly at both ends.
  run bodyRadiusInRange =
    STAR_BODY_PX(STAR_SIZE_MIN) >= 1
    and STAR_BODY_PX(STAR_SIZE_MIN) <= 2
    and STAR_BODY_PX(STAR_SIZE_MAX) >= 4
    and STAR_BODY_PX(STAR_SIZE_MAX) <= 6

  /// Halo blur is monotonically non-decreasing across the size range.
  /// Spot-check at the endpoints and the midpoint.
  run haloBlurIsMonotonic =
    STAR_HALO_BLUR_PX(STAR_SIZE_MIN) <= STAR_HALO_BLUR_PX(50)
    and STAR_HALO_BLUR_PX(50) <= STAR_HALO_BLUR_PX(STAR_SIZE_MAX)

  /// Halo blur is the heaviest of the three blur layers — the outer
  /// bloom is the dominant soft scatter.
  run haloBlurHeaviest =
    STAR_HALO_BLUR_PX(STAR_SIZE_MAX) > STAR_BLOOM_BLUR_PX(STAR_SIZE_MAX)
    and STAR_BLOOM_BLUR_PX(STAR_SIZE_MAX) > STAR_CORE_BLUR_PX(STAR_SIZE_MAX)

  /// Spot-check every colour has a non-empty body and halo.
  run everyColourHasBodyAndHalo =
    STAR_COLOR(White) != ""
    and STAR_HALO_COLOR(White) != ""
    and STAR_COLOR(Yellow) != ""
    and STAR_HALO_COLOR(Yellow) != ""
    and STAR_COLOR(Red) != ""
    and STAR_HALO_COLOR(Red) != ""
    and STAR_COLOR(Orange) != ""
    and STAR_HALO_COLOR(Orange) != ""
    and STAR_COLOR(Green) != ""
    and STAR_HALO_COLOR(Green) != ""
    and STAR_COLOR(Purple) != ""
    and STAR_HALO_COLOR(Purple) != ""
}