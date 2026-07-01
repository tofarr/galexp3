// SPDX-License-Identifier: MIT
//
// starSystem.qnt
//
// Iteration 3a — Star system data model.
//
// Scope (current):
//   - PlanetSize, PlanetClass enums
//   - PlanetBody struct (size + classification)
//   - PlanetSlot struct with a kind tag and optional fields
//     (we use a struct-with-kind rather than a parameterized
//     variant because the Quint 0.22.4 type checker has trouble
//     inferring effects when match / variant-payload-extract is
//     nested inside other expressions — see AGENTS.md)
//   - StarSystem struct (NUM_PLANET_SLOTS slots for one star)
//   - Helpers: slotHasSize, slotIsPlanet, slotIsGasGiant
//   - Validity predicate isValidStarSystem(s)
//   - Static sanity checks (`run` checks)
//
// What is intentionally NOT here yet:
//   - Planet resource yields (will come when colonisation lands)
//   - Planetary buildings, queues, population
//   - Per-slot physics (orbital distance, mass) — the UI lays the slots
//     out in concentric rings; the spec doesn't need distances for
//     correctness yet.
//   - Generator (TypeScript proves generation by construction; we'll
//     lift it into the spec when state and transitions appear)
//
// The TypeScript implementation in src/sim/starSystem.ts mirrors this
// spec and is verified by property tests in src/sim/starSystem.test.ts.
// Per the Quint <-> TS parity rule, every invariant stated here must
// have a corresponding Vitest property test in TypeScript.
//
// Note: we deliberately do NOT import galaxy.qnt here — we use plain
// `int` for starId so this spec is standalone.

module starSystem {

  // ---------------------------------------------------------------------------
  // Planet types
  // ---------------------------------------------------------------------------

  /// Planet size buckets — small to huge. Will later govern the visual
  /// radius of the planet in the star-system view and the surface area
  /// available for colonisation.
  type PlanetSize = Small | Medium | Large | Huge

  /// Planetary classification. Roughly inspired by Master of Orion /
  /// Galactic Civilizations — each class implies different habitability
  /// and resource profiles. Order is meaningful: Dead/Radiated/Toxic
  /// are hostile; Desert/Ocean/Jungle/Terran are increasingly habitable.
  type PlanetClass = Dead | Radiated | Toxic | Desert | Ocean | Jungle | Terran

  /// Planet body struct (size + classification). Used inside a
  /// PlanetSlot when the slot's kind is "Planet". Gas giants do NOT
  /// carry a body — they have a size but no classification.
  type PlanetBody = {
    size: PlanetSize,
    classification: PlanetClass
  }

  /// One orbital slot. The `kind` discriminator picks what kind of
  /// body (if any) the slot holds; the `body` is only populated when
  /// kind == "Planet" (true planets have size + class). Gas giants
  /// use `gasGiantSize`; dust clouds and empty slots ignore both
  /// fields.
  ///
  /// Iter 3a-d: removed `Asteroids` — astronomically equivalent to
  /// a dust cloud (a debris belt is just a denser dust cloud), so
  /// the model collapses both into a single `DustCloud` variant.
  /// The weight that was on Asteroids rolls into DustCloud, so
  /// the overall "non-empty" ratio is preserved.
  ///
  /// We model as a struct-with-kind rather than a parameterized
  /// variant because of the Quint 0.22.4 effect-inference quirk
  /// (see AGENTS.md). The TS layer uses a discriminated union —
  /// same semantics, more idiomatic in TypeScript.
  type PlanetSlot = {
    kind: str,                  // "Empty" | "DustCloud" | "GasGiant" | "Planet"
    body: PlanetBody,           // only meaningful when kind == "Planet"
    gasGiantSize: PlanetSize    // only meaningful when kind == "GasGiant"
  }

  /// A star system has a fixed 8 orbital slots. Slots are ordered
  /// innermost-to-outermost (slot 0 closest to the star).
  /// `starId` is a plain int (no dependency on galaxy.qnt).
  type StarSystem = {
    starId: int,
    slots: List[PlanetSlot]
  }

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /// Number of orbital slots per star system. Master of Orion used
  /// up to 6; we go up to 8 to give the visualisation more variety
  /// and to leave room for future late-game colonisation slots.
  pure val NUM_PLANET_SLOTS: int = 8

  // ---------------------------------------------------------------------------
  // Slot constants
  //
  // We model the slot constructors as `pure val` constants (not
  // functions) because Quint's type-checker confuses a parameterless
  // `pure def foo()` with an effectful operator in some contexts
  // (see AGENTS.md "Quint 0.22.4 quirks"). Pure vals sidestep that.
  // ---------------------------------------------------------------------------

  /// Empty slot — no body, no fields populated.
  pure val emptySlot =
    { kind: "Empty", body: { size: Small, classification: Terran }, gasGiantSize: Small }

  /// Dust cloud slot. A debris belt is astronomically a denser
  /// dust cloud, so the model collapses both into this single
  /// variant. The renderer uses different visualisation
  /// settings (blur amount, stroke vs. fill) for the two
  /// appearances — but they share the same data shape.
  pure val dustCloudSlot =
    { kind: "DustCloud", body: { size: Small, classification: Terran }, gasGiantSize: Small }

  /// Gas giant slot with the given size.
  pure def gasGiantSlot(sz) =
    { kind: "GasGiant", body: { size: Small, classification: Terran }, gasGiantSize: sz }

  /// True planet slot with size + classification.
  pure def planetBodySlot(sz, cls) =
    { kind: "Planet", body: { size: sz, classification: cls }, gasGiantSize: Small }

  // ---------------------------------------------------------------------------
  // Helpers
  //
  // All helpers operate on the struct-with-kind representation so we
  // never need Quint `match`. The discriminator `kind` is compared
  // as a string.
  // ---------------------------------------------------------------------------

  /// True iff this slot holds a real planet.
  pure def slotIsPlanet(s) = s.kind == "Planet"

  /// True iff this slot holds a gas giant.
  pure def slotIsGasGiant(s) = s.kind == "GasGiant"

  /// True iff this slot is non-empty (has a body). Dust clouds
  /// count as occupied — the orbit still has stuff in it.
  pure def slotIsOccupied(s) = s.kind != "Empty"

  /// True iff this slot has a size (Planet or GasGiant). Useful for
  /// the renderer: only these slots render a sphere.
  pure def slotHasSize(s) = s.kind == "Planet" or s.kind == "GasGiant"

  /// Pull the size out of any slot that has one. For Planet slots
  /// we use the body's size; for GasGiant we use gasGiantSize. For
  /// all other kinds, returns -1 (caller should branch on
  /// slotHasSize first).
  pure def slotSize(s) =
    if (s.kind == "Planet")    planetSizeToInt(s.body.size)
    else if (s.kind == "GasGiant") planetSizeToInt(s.gasGiantSize)
    else -1

  /// Map PlanetSize to an integer. Used by slotSize and by the
  /// property tests that compare against a numeric range.
  pure def planetSizeToInt(s) =
    if (s == Small)  1
    else if (s == Medium) 2
    else if (s == Large) 3
    else 4

  /// Count of slots in a system. Avoids `.size()` on Lists (which is
  /// unreliable on Lists in Quint 0.22.4 per AGENTS.md).
  pure def slotsCount(slots) =
    slots.foldl(0, (acc, _) => acc + 1)

  // ---------------------------------------------------------------------------
  // Validity
  // ---------------------------------------------------------------------------

  /// A valid star system has exactly NUM_PLANET_SLOTS slots. We do
  /// NOT constrain what each slot holds — Empty is allowed, every
  /// slot being occupied is allowed, everything in between is allowed.
  /// The only invariant is the slot count.
  pure def isValidStarSystem(s) =
    slotsCount(s.slots) == NUM_PLANET_SLOTS

  /// A helper for callers that want a fully-populated system (every
  /// slot is a real planet). Useful for tests and for the "max
  /// habitability" reference system. NOT used by the random
  /// generator — that produces a mix.
  pure def allPlanetsSystem(starId, sizes, classes) =
    {
      starId: starId,
      slots: sizes.foldl((List(), 0),
        (acc, sz) =>
          val idx = acc._2
          val cls = classes.nth(idx)
          (acc._1.append(planetBodySlot(sz, cls)), idx + 1)
      )._1
    }

  // ---------------------------------------------------------------------------
  // Static sanity checks (Quint `run` checks)
  // ---------------------------------------------------------------------------

  /// Static assertion: NUM_PLANET_SLOTS is what we expect.
  run numPlanetSlotsIs8 = NUM_PLANET_SLOTS == 8

  /// Static assertion: the slot constructors produce the kinds we
  /// expect and slotHasSize / slotIsPlanet / slotIsGasGiant discriminate.
  /// Note: emptySlot / dustCloudSlot are `pure val`s (no parens);
  /// the planet + gas-giant constructors are `pure def`s
  /// (with parens).
  run slotConstructorsRoundTrip =
    slotIsPlanet(planetBodySlot(Small, Terran))
    and slotIsGasGiant(gasGiantSlot(Large))
    and not(slotIsPlanet(emptySlot))
    and not(slotIsPlanet(dustCloudSlot))
    and not(slotIsPlanet(gasGiantSlot(Huge)))
    and not(slotIsOccupied(emptySlot))
    and slotIsOccupied(dustCloudSlot)
    and slotIsOccupied(gasGiantSlot(Medium))
    and slotIsOccupied(planetBodySlot(Small, Terran))
    and slotHasSize(planetBodySlot(Small, Terran))
    and slotHasSize(gasGiantSlot(Large))
    and not(slotHasSize(emptySlot))
    and not(slotHasSize(dustCloudSlot))

  /// Static assertion: slotSize returns the expected integer for each
  /// size on both Planet and GasGiant slots, and -1 for non-body slots.
  run slotSizeIsCorrect =
    slotSize(planetBodySlot(Small, Terran))  == 1
    and slotSize(planetBodySlot(Medium, Terran)) == 2
    and slotSize(planetBodySlot(Large, Terran)) == 3
    and slotSize(planetBodySlot(Huge, Terran)) == 4
    and slotSize(gasGiantSlot(Small)) == 1
    and slotSize(gasGiantSlot(Huge))  == 4
    and slotSize(emptySlot) == -1
    and slotSize(dustCloudSlot) == -1

  /// Static assertion: planetSizeToInt is a total order.
  run planetSizeIsOrdered =
    planetSizeToInt(Small)  < planetSizeToInt(Medium)
    and planetSizeToInt(Medium) < planetSizeToInt(Large)
    and planetSizeToInt(Large)  < planetSizeToInt(Huge)

  /// Static assertion: a planet-only test system is valid and has
  /// the right size distribution. We use 8 sizes + 8 classes (the
  /// canonical NUM_PLANET_SLOTS) so isValidStarSystem passes.
  run allPlanetsSystemIsValid =
    val sys = allPlanetsSystem(0,
      List(Small, Medium, Large, Huge, Small, Medium, Large, Huge),
      List(Terran, Ocean, Jungle, Desert, Dead, Radiated, Toxic, Terran))
    isValidStarSystem(sys)
    and slotsCount(sys.slots) == 8
    and slotIsPlanet(sys.slots.nth(0))
    and slotIsPlanet(sys.slots.nth(7))
}