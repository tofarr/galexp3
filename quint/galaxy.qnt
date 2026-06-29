// SPDX-License-Identifier: MIT
//
// galaxy.qnt
//
// Iteration 1a — Galaxy data model spec.
//
// Scope (deliberately minimal):
//   - Star, Position, StarKind, GalaxySize, Galaxy types
//   - Per-size star counts and disc radii
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

  /// Star spectral kind. Mirrors the MoO 1 / 2 colour palette.
  /// Real spectral classes are richer; for v1 we keep it minimal and
  /// visually distinct. Extend later as gameplay needs dictate.
  type StarKind =
    | Blue
    | White
    | Yellow
    | Red
    | Orange
    | Brown

  /// Star physical size class. Drives both the rendered radius (in
  /// pixels) and (eventually) the resource yield of a colonised star
  /// system. Mapping from StarKind to StarSize is fixed by
  /// `STAR_SIZE`; do not vary per-galaxy.
  type StarSize =
    | Dwarf
    | Standard
    | Giant
    | Supergiant

  /// sRGB hex colour for the body of a star of the given kind.
  /// Format: "0xRRGGBB" (lowercase hex). Used by the renderer to
  /// fill the star body.
  /// (No colour-management discussion in the spec; the renderer is
  /// expected to pass these through verbatim to its colour API.)
  type HexColor = str

  /// sRGB hex colour for the glow halo around a star of the given kind.
  /// Same format as STAR_COLOR but with a hue chosen to read as a soft
  /// glow against the dark disc background.
  type HexGlowColor = str

  /// A star's position in the galaxy. Continuous 2D space.
  /// Units are abstract integers (rendering will scale them to pixels).
  type Position = { x: int, y: int }

  /// Unique identifier of a star within a single galaxy.
  /// IDs are dense integers 1..N where N is the size's star count.
  type StarId = int

  /// A single star system. v1 keeps the system itself abstract —
  /// no planets, no buildings, no colony state yet.
  type Star = {
    id: StarId,
    kind: StarKind,
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
  // Star appearance tables
  // ---------------------------------------------------------------------------
  //
  // These tables bind a StarKind to its physical size class, body
  // colour, and glow colour. The mapping is fixed — every star in every
  // galaxy uses the same table. Gameplay relevance: StarSize will drive
  // resource yield of a colonised star (defined in a later iteration).

  /// Physical size class for a star of the given kind.
  /// Mapping is loosely based on real stellar classification, simplified
  /// for v1 gameplay. The exact mapping is a tuning knob; if you change
  /// it, also change it in src/sim/galaxy.ts#STAR_SIZE_FOR_KIND.
  pure def STAR_SIZE(k: StarKind): StarSize =
    if (k == Blue)    Supergiant
    else if (k == White)   Giant
    else if (k == Yellow)  Standard
    else if (k == Orange)  Standard
    else if (k == Red)     Giant
    else Dwarf  // Brown

  /// sRGB hex body colour (format "0xRRGGBB") for a star of the given
  /// kind. Colours are picked to be visually distinct against the
  /// #1a2545 disc background while still reading as a star.
  pure def STAR_COLOR(k: StarKind): HexColor =
    if (k == Blue)    "0xb8d0ff"
    else if (k == White)   "0xffffff"
    else if (k == Yellow)  "0xffe680"
    else if (k == Orange)  "0xffb060"
    else if (k == Red)     "0xff8080"
    else "0xc08050"  // Brown

  /// sRGB hex glow-halo colour (format "0xRRGGBB") for a star of the
  /// given kind. Slightly more saturated than the body, with hue
  /// pushed toward the warm side where the body is cool and vice
  /// versa, so the halo reads as a bloom rather than a shadow.
  pure def STAR_GLOW_COLOR(k: StarKind): HexGlowColor =
    if (k == Blue)    "0x6fa8ff"
    else if (k == White)   "0xdde8ff"
    else if (k == Yellow)  "0xffd040"
    else if (k == Orange)  "0xff8030"
    else if (k == Red)     "0xff5050"
    else "0xa06030"  // Brown

  /// Pixel radius of a star body for a given StarSize. Held in the
  /// spec so the renderer is a dumb painter; the values are tuned
  /// for a 100% zoom level. The renderer is expected to leave the
  /// star body at a fixed pixel size (no zoom-scaling) so stars stay
  /// visible at any zoom.
  pure def STAR_RADIUS_PX(s: StarSize): int =
    if (s == Dwarf)      2
    else if (s == Standard)  3
    else if (s == Giant)     4
    else 5  // Supergiant

  /// Glow halo radius as a multiple of the star body radius.
  /// A single value for all sizes — keeps the visual language
  /// consistent.
  pure def STAR_GLOW_RATIO: int = 3

  /// Glow halo alpha (0..255) for the soft outer halo. A single
  /// value for all sizes.
  pure def STAR_GLOW_ALPHA: int = 64   // ~0.25

  /// Body alpha (0..255). Opaque bodies keep the visual punch.
  pure def STAR_BODY_ALPHA: int = 255

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

  /// Static assertion that every StarKind maps to a StarSize and that
  /// the resulting StarRadius_px is in the expected 2..5 range.
  run starRadiiAreInRange =
    STAR_RADIUS_PX(STAR_SIZE(Blue))    > 1
    and STAR_RADIUS_PX(STAR_SIZE(Blue))    < 10
    and STAR_RADIUS_PX(STAR_SIZE(White))   > 1
    and STAR_RADIUS_PX(STAR_SIZE(White))   < 10
    and STAR_RADIUS_PX(STAR_SIZE(Yellow))  > 1
    and STAR_RADIUS_PX(STAR_SIZE(Yellow))  < 10
    and STAR_RADIUS_PX(STAR_SIZE(Orange))  > 1
    and STAR_RADIUS_PX(STAR_SIZE(Orange))  < 10
    and STAR_RADIUS_PX(STAR_SIZE(Red))     > 1
    and STAR_RADIUS_PX(STAR_SIZE(Red))     < 10
    and STAR_RADIUS_PX(STAR_SIZE(Brown))   > 1
    and STAR_RADIUS_PX(STAR_SIZE(Brown))   < 10

  /// Static assertion that the size ordering is sane: a Supergiant is
  /// strictly larger than a Giant, which is strictly larger than a
  /// Standard, which is strictly larger than a Dwarf. This anchors the
  /// gameplay promise that larger stars yield more resources.
  run starSizeOrdering =
    STAR_RADIUS_PX(Supergiant) > STAR_RADIUS_PX(Giant)
    and STAR_RADIUS_PX(Giant)     > STAR_RADIUS_PX(Standard)
    and STAR_RADIUS_PX(Standard)  > STAR_RADIUS_PX(Dwarf)
}
