// SPDX-License-Identifier: MIT
//
// empire.qnt
//
// Iteration 2a - Player + colony + resource model.
//
// Scope (current):
//   - ResourceType: agriculture | industry | academic | culture
//   - ResourcePool: fixed-size 4-tuple (one slot per resource type)
//   - Player: id, name, isHuman, resources
//   - Race: id, name (placeholders for now; race traits deferred)
//   - CenterType: producing centers (agricultural, industrial,
//     academic, culture) + trade + special structures (shipyard,
//     defenseSatellite, shield, stargate)
//   - PopulationUnit: id, raceId, buffs, debuffs, center
//     - buffs/debuffs are opaque IDs for now; the structure exists
//       so individual unit modifiers can be added later without
//       changing the data shape
//   - ConstructionOrder: build / demolish
//   - Colony: id, starId, ownerId, population, pendingConstruction,
//     ageInYears
//   - EmpireStar: extends Star with maxPopulation
//   - EmpireGalaxy: stars, players, colonies
//   - Cost helpers: popGrowthCost, popSpawnCost, centerBuildCost,
//     canAffordBuild
//   - Validity predicates isValidPlayer, isValidColony,
//     isValidEmpire
//   - Pure helpers applyConstruction, popSpawnCount, applyBuildTo
//   - Static sanity checks (`run` checks)
//
// What is intentionally NOT here yet:
//   - End-of-turn transition (TS side owns the mutable game state
//     and advances it imperatively; the Quint spec stays pure and
//     exposes the building blocks)
//   - Buffs / debuffs effects on production
//   - Ship building (depends on shipyard)
//   - Defense / bombardment / shields
//   - Stargate travel-speed math
//   - AI players (we model `isHuman` and the start position, but
//     have no AI action logic yet)
//   - A non-trivial initial-galaxy generator with players / colonies
//   - Technology tree / diplomacy
//   - Persistence / serialisation
//
// The TypeScript implementation in src/sim/{player,colony,galaxy}.ts
// mirrors this spec and is verified by property tests in
// src/sim/{player,colony,galaxy}.test.ts. Per the Quint <-> TS
// parity rule, every invariant stated here must have a
// corresponding Vitest property test in TypeScript.
//
// Note on Quint syntax: pure defs cannot use direct recursion
// (QNT099). All "iterate over a number" loops are expressed with
// `range.fold(...)` instead.

module empire {

  // ---------------------------------------------------------------------------
  // Resource types
  // ---------------------------------------------------------------------------

  /// The four player-wide resource types. The position of a
  /// resource type in this tuple is its index; we use the index
  /// for typed lookups in ResourcePool. The TypeScript tuple
  /// `RESOURCE_TYPES` in src/sim/player.ts MUST mirror this order.
  pure val RESOURCE_TYPES = ("agriculture", "industry", "academic", "culture")

  /// A 4-tuple of resources in the canonical order
  /// (agriculture, industry, academic, culture). We use a tuple
  /// rather than a map so size and shape are enforced by the type
  /// system.
  type ResourcePool = (int, int, int, int)

  /// A pool of all zeros (the natural starting pool).
  pure val EMPTY_POOL: ResourcePool = (0, 0, 0, 0)

  /// Element-wise sum of two pools.
  pure def addPool(a: ResourcePool, b: ResourcePool): ResourcePool =
    (a._1 + b._1, a._2 + b._2, a._3 + b._3, a._4 + b._4)

  /// Helper: a - min(a, b). Used by subPool to clamp at zero so
  /// the pool can never go negative.
  pure def clampSub(a: int, b: int): int =
    if (a < b) 0 else (a - b)

  /// Element-wise subtraction clamped at 0. We never let a pool
  /// go negative; payments that can't be made are tracked
  /// separately as "unmaintained pop units" per turn.
  pure def subPool(a: ResourcePool, b: ResourcePool): ResourcePool =
    (clampSub(a._1, b._1), clampSub(a._2, b._2),
     clampSub(a._3, b._3), clampSub(a._4, b._4))

  /// `true` iff `a` has at least as much of every resource as `b`.
  pure def poolGE(a: ResourcePool, b: ResourcePool): bool =
    a._1 >= b._1 and a._2 >= b._2 and a._3 >= b._3 and a._4 >= b._4

  // ---------------------------------------------------------------------------
  // Players
  // ---------------------------------------------------------------------------

  /// Per-player cost of building any center, in industry points.
  /// Flat across center types for now (a future iteration may
  /// differentiate, e.g. shipyard more expensive than a culture center).
  pure val CENTER_BUILD_COST: int = 15

  /// Per-pop-unit maintenance debit, per turn. Pop units require
  /// 1 agriculture and 1 culture to remain active; an unmaintained
  /// pop unit produces nothing that turn.
  pure val POP_MAINTENANCE: ResourcePool = (1, 0, 0, 1)

  type Player = {
    id: int,
    name: str,
    isHuman: bool,
    resources: ResourcePool,
  }

  /// `true` iff `p`'s resource pool is non-negative in every slot.
  pure def isValidPlayer(p: Player): bool =
    p.resources._1 >= 0 and p.resources._2 >= 0
    and p.resources._3 >= 0 and p.resources._4 >= 0

  // ---------------------------------------------------------------------------
  // Races
  // ---------------------------------------------------------------------------

  /// A race. Just an id and a name for now; traits and modifiers
  /// are deferred. We model races as opaque so the type of
  /// PopulationUnit.raceId is stable when we add traits later.
  type Race = { id: int, name: str }

  // ---------------------------------------------------------------------------
  // Center types and outputs
  // ---------------------------------------------------------------------------

  /// All center types. `agricultural | industrial | academic |
  /// culture` are the four "producing" centers (each yields 5 of
  /// its resource per turn per maintained pop unit). `trade`
  /// yields 1 of every resource per turn. The remaining four are
  /// special structures that produce nothing directly but unlock
  /// other gameplay (ship building, defense, fast travel).
  pure val CENTER_TYPES = (
    "agricultural", "industrial", "academic", "culture",
    "trade",
    "shipyard", "defenseSatellite", "shield", "stargate"
  )

  /// `true` iff the center is one of the four producing types.
  pure def isProducingCenter(c: str): bool =
    c == "agricultural" or c == "industrial"
    or c == "academic" or c == "culture"

  /// Sentinel value for "no center built" on a pop unit. We use
  /// the string "none" rather than a separate Option to keep the
  /// Quint type flat; the TypeScript side will use `null`.
  pure val NO_CENTER: str = "none"

  /// 2 raised to `n`. Recursion-free, implemented as a fold. For
  /// `n <= 0` returns 1.
  pure def pow2(n: int): int =
    if (n <= 0) 1
    else (0.to(n - 1)).fold(1, (acc, _) => acc * 2)

  /// Base per-turn resource yield of a maintained pop unit with
  /// this center. Special structures yield nothing; trade yields
  /// 1 of every resource; producing centers yield 5 of their
  /// resource. Buffs/tech modifiers are not modelled here yet -
  /// they multiply the output in a later iteration.
  pure def centerBaseOutput(c: str): ResourcePool =
    if (c == "agricultural") (5, 0, 0, 0)
    else if (c == "industrial") (0, 5, 0, 0)
    else if (c == "academic") (0, 0, 5, 0)
    else if (c == "culture") (0, 0, 0, 5)
    else if (c == "trade") (1, 1, 1, 1)
    else (0, 0, 0, 0)

  // ---------------------------------------------------------------------------
  // Population units
  // ---------------------------------------------------------------------------

  /// A single population unit. The `center` field, when not equal
  /// to NO_CENTER, names what (if anything) is built on this
  /// unit; NO_CENTER means the unit is unassigned (still requires
  /// maintenance but produces nothing). Buffs/debuffs are opaque
  /// IDs for now.
  type PopulationUnit = {
    id: int,
    raceId: int,
    buffs: Set[int],
    debuffs: Set[int],
    center: str,
  }

  /// An unassigned pop unit (no center built on it).
  pure def emptyPop(id: int, raceId: int): PopulationUnit = {
    id: id, raceId: raceId, buffs: Set(), debuffs: Set(), center: NO_CENTER
  }

  /// `true` iff the pop unit has a center built on it.
  pure def hasCenter(p: PopulationUnit): bool = p.center != NO_CENTER

  /// Convert a list of population units to a set of their ids.
  /// Used to assert uniqueness within a colony. Empty input
  /// returns the empty set. We use `foldl` with a conditional
  /// initial because Quint's `fold` does not infer the type of
  /// the empty initial value `Set()`.
  pure def popIds(pops: List[PopulationUnit]): Set[int] =
    pops.foldl(if (pops == List()) Set() else Set(pops[0].id),
               (s, p) => s.union(Set(p.id)))

  /// Convert a list of construction orders to a set of their
  /// targeted pop unit ids. Same pattern as `popIds`.
  pure def orderPopIds(orders: List[ConstructionOrder]): Set[int] =
    orders.foldl(if (orders == List()) Set() else Set(orders[0].popUnitId),
                 (s, o) => s.union(Set(o.popUnitId)))

  /// Quint 0.22.4 has a typing bug where the built-in `filter`
  /// mis-types List inputs as Set inputs, so calling `xs.filter(...)`
  /// on a List fails to typecheck. We provide our own fold-based
  /// `filterList` as a workaround. It handles empty lists and
  /// single-element lists explicitly and falls back to
  /// `tail().foldl(...)` for longer lists.
  pure def filterList(xs: List[int], pred: int => bool): List[int] =
    if (xs == List()) xs
    else if (xs.tail() == List()) (if (pred(xs[0])) List(xs[0]) else List())
    else xs.tail().foldl(
      if (pred(xs[0])) List(xs[0]) else List(),
      (acc, x) => if (pred(x)) acc.append(x) else acc
    )

  // ---------------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------------

  /// A queued build/demolish order. The build cost is deducted
  /// from the owner's pool at queue time (so the order is only
  /// placed if the player can afford it); the actual mutation
  /// happens at end-of-turn.
  type ConstructionOrder = {
    kind: str,                 // "build" or "demolish"
    popUnitId: int,            // which pop unit is affected
    center: str,               // for "build": the new center type
  }

  /// `true` iff the player can afford to queue this build order.
  /// Demolish is free (it removes a center, no new resource spend).
  pure def canAffordBuild(p: Player, c: str): bool =
    if (c == NO_CENTER) true
    else p.resources._2 >= CENTER_BUILD_COST

  // ---------------------------------------------------------------------------
  // Colonies
  // ---------------------------------------------------------------------------

  type Colony = {
    id: int,
    starId: int,
    ownerId: int,
    population: List[PopulationUnit],
    pendingConstruction: List[ConstructionOrder],
    ageInYears: int,           // ticks up by 1 each end-of-turn
  }

  /// Predicates for validity checks. We avoid Quint's buggy
  /// `filter`/`exists`/`forall`/`size` built-ins on Lists and Sets
  /// (Quint 0.22.4 unifies them with the wrong type), expressing
  /// everything via fold with explicit branching.

  /// Does pop unit with the given id appear in `pops`?
  pure def hasPopWithId(pops: List[PopulationUnit], id: int): bool =
    pops.foldl(false, (acc, p) => acc or p.id == id)

  /// `true` iff the colony is well-formed: no two pop units share
  /// an id, no two construction orders target the same pop unit,
  /// every construction order targets an existing pop unit, and
  /// age is non-negative. We do NOT require a particular number
  /// of pop units - a brand-new colony can be empty.
  ///
  /// Avoiding Quint 0.22.4's broken `forall`/`exists` and `size`
  /// on List inputs: every check is a plain fold over the list.
  pure def isValidColony(c: Colony): bool = {
    // 1) No duplicate pop ids: for each pop p, no other pop has
    //    the same id. We do this by checking that the only pop
    //    whose id equals p.id is p itself.
    val uniquePops =
      c.population.foldl(true, (acc, p) => acc and
        c.population.foldl(0, (n, q) => if (q.id == p.id) n + 1 else n) == 1)
    // 2) No duplicate order targets.
    val uniqueOrders =
      c.pendingConstruction.foldl(true, (acc, o) => acc and
        c.pendingConstruction.foldl(0, (n, o2) => if (o2.popUnitId == o.popUnitId) n + 1 else n) == 1)
    // 3) Every order's popUnitId matches an existing pop id.
    val allOrdersTargetReal =
      c.pendingConstruction.foldl(true, (acc, o) => acc and hasPopWithId(c.population, o.popUnitId))
    c.ageInYears >= 0 and uniquePops and uniqueOrders and allOrdersTargetReal
  }

  // ---------------------------------------------------------------------------
  // Galaxy extension
  // ---------------------------------------------------------------------------

  /// Existing star with one added field. (Defined here as a
  /// separate type to keep this spec self-contained; the TS side
  /// extends the Star interface in src/sim/galaxy.ts.)
  type EmpireStar = {
    id: int,
    maxPopulation: int,        // free-growth cap; a pop above this has cost
  }

  type EmpireGalaxy = {
    stars: List[EmpireStar],
    players: List[Player],
    colonies: List[Colony],
  }

  /// Convert a list of colonies to a set of their starIds.
  /// Empty input returns the empty set. Same foldl pattern as
  /// `popIds`.
  pure def colonyStarIds(cs: List[Colony]): Set[int] =
    cs.foldl(if (cs == List()) Set() else Set(cs[0].starId),
             (s, c) => s.union(Set(c.starId)))

  /// Galaxy-level validity: every star has a non-negative
  /// maxPopulation; every player satisfies isValidPlayer; every
  /// colony satisfies isValidColony; every colony's starId and
  /// ownerId reference real ids; colonies are uniquely keyed by
  /// starId (at most one colony per star). All checks via fold
  /// (Quint 0.22.4's `forall`/`exists`/`size` on Lists are buggy).
  pure def isValidEmpire(g: EmpireGalaxy): bool = {
    val starsValid =
      g.stars.foldl(true, (acc, s) => acc and s.maxPopulation >= 0)
    val playersValid =
      g.players.foldl(true, (acc, p) => acc and isValidPlayer(p))
    val coloniesValid =
      g.colonies.foldl(true, (acc, c) => acc and isValidColony(c))
    val colonyRefsStar =
      g.colonies.foldl(true, (acc, c) => acc and
        g.stars.foldl(false, (b, s) => b or s.id == c.starId))
    val colonyRefsOwner =
      g.colonies.foldl(true, (acc, c) => acc and
        g.players.foldl(false, (b, p) => b or p.id == c.ownerId))
    val starIdsUnique =
      g.colonies.foldl(true, (acc, c) => acc and
        g.colonies.foldl(0, (n, c2) => if (c2.starId == c.starId) n + 1 else n) == 1)
    starsValid and playersValid and coloniesValid and
      colonyRefsStar and colonyRefsOwner and starIdsUnique
  }

  // ---------------------------------------------------------------------------
  // Cost helpers
  // ---------------------------------------------------------------------------

  /// Cost in industry points for the (overBy + 1)-th pop unit
  /// beyond `maxPopulation`, where overBy = current - max.
  /// Uses `base * 2^overBy` with base 10. Calling with
  /// current <= max returns 0 (free growth up to the cap).
  pure def popGrowthCost(maxPopulation: int, current: int): int =
    if (current <= maxPopulation) 0
    else 10 * pow2(current - maxPopulation)

  /// Total industry cost of spawning `spawnCount` pop units onto
  /// a colony that already has `currentPop` units with a free
  /// cap of `maxPopulation`. All spawned units in a single
  /// end-of-turn go onto the "top" of the pop count, so the
  /// (currentPop + k + 1)-th unit (k in 0..spawnCount-1) costs
  /// popGrowthCost(maxPopulation, currentPop + k + 1). The whole
  /// batch's industry cost is the sum of those terms.
  pure def popSpawnCost(maxPopulation: int, currentPop: int, spawnCount: int): int =
    if (spawnCount <= 0) 0
    else (0.to(spawnCount - 1)).fold(0, (acc, k) => acc + popGrowthCost(maxPopulation, currentPop + k + 1))

  /// Number of new pop units to spawn this turn. Equal to the
  /// number of 10-year boundaries crossed when the colony ages
  /// by one year. The TypeScript side owns the `nextId` counter
  /// across the whole galaxy; this pure function only computes
  /// the spawn count.
  pure def popSpawnCount(colonyAgeBefore: int): int =
    (colonyAgeBefore + 1) / 10 - colonyAgeBefore / 10

  // ---------------------------------------------------------------------------
  // End-of-turn pipeline helpers (pure)
  // ---------------------------------------------------------------------------

  /// Apply any build orders targeting pop unit `p`. Returns the
  /// last build order matching `(kind="build", popUnitId=p.id)`,
  /// or NO_CENTER if there are none. Quint 0.22.4's broken `filter`
  /// is avoided by folding over the list explicitly. Last-write-
  /// wins; duplicates are a player error.
  pure def findLastBuild(orders: List[ConstructionOrder], pid: int): str =
    orders.foldl(NO_CENTER,
                 (acc, o) => if (o.kind == "build" and o.popUnitId == pid) o.center else acc)

  /// Apply `findLastBuild` to pop unit `p`.
  pure def applyBuildTo(p: PopulationUnit, orders: List[ConstructionOrder]): PopulationUnit = {
    val newCenter = findLastBuild(orders, p.id)
    if (newCenter == NO_CENTER) p
    else { ...p, center: newCenter }
  }

  /// Does this pop unit appear in the demolish list?
  /// `exists` has a typechecker bug on Lists in Quint 0.22.4,
  /// so we fold over the orders explicitly.
  pure def isDemolishTarget(orders: List[ConstructionOrder], pid: int): bool =
    orders.foldl(false,
                 (acc, o) => acc or (o.kind == "demolish" and o.popUnitId == pid))

/// Apply all pending build/demolish orders to a colony's
  /// population. Demolish REMOVES the pop unit from the population
  /// list entirely (it was an existing unit, not just its center);
  /// build sets the pop's center to the order's center. The build
  /// cost was already deducted at queue time, so this is a pure
  /// state mutation with no resource side effects.
  pure def applyConstruction(colony: Colony): Colony = {
    // Seed with empty Set and let the fold populate ONLY the
    // demolish popUnitIds. (Seeding with `Set(orders[0].popUnitId)`
    // wrongly includes the first order's id even when it's a build,
    // not a demolish; that caused p1 to be silently removed from
    // the population.)
    val demTarget = colony.pendingConstruction.foldl(
      Set(),
      (s, o) => if (o.kind == "demolish") s.union(Set(o.popUnitId)) else s)
    val newPop = colony.population.foldl(
      List(),
      (acc, p) => if (demTarget.contains(p.id)) acc
                  else acc.append(applyBuildTo(p, colony.pendingConstruction)))
    { ...colony, population: newPop, pendingConstruction: List() }
  }

  // ---------------------------------------------------------------------------
  // Static sanity checks (Quint `run` checks)
  //
  // Quint `run` blocks take a single expression; we chain asserts
  // with `and` rather than stacking them.
  // ---------------------------------------------------------------------------

  /// A pop unit at or above the free cap is never free; the cost
  /// doubles for each subsequent unit. (Matches the spec'd
  /// `base * 2^overBy` with base = 10.)
  run popGrowthCostTest =
    assert(popGrowthCost(5, 5) == 0) and
    assert(popGrowthCost(5, 4) == 0) and
    assert(popGrowthCost(5, 6) == 20) and
    assert(popGrowthCost(5, 7) == 40) and
    assert(popGrowthCost(5, 10) == 320)

  /// Total cost of spawning N pop units when already at or above
  /// the cap. Free pops contribute 0; over-cap pops contribute
  /// `base * 2^overBy`. The new pops occupy the slots ABOVE the
  /// current count, so the (currentPop+k+1)-th unit costs
  /// popGrowthCost(maxPop, currentPop+k+1) for k in 0..spawnCount-1.
  run popSpawnCostTest =
    assert(popSpawnCost(5, 5, 0) == 0) and
    assert(popSpawnCost(5, 5, 1) == 20) and     // new pop is the 6th; 10*2^1 = 20
    assert(popSpawnCost(5, 5, 2) == 60) and     // 20 + 40
    assert(popSpawnCost(5, 6, 1) == 40) and     // new pop is the 7th; 10*2^2 = 40
    assert(popSpawnCost(10, 0, 10) == 0)        // all under cap; new pops 1..10 still free

  /// A center is buildable only if the owner has at least
  /// CENTER_BUILD_COST industry. Demolish is always free.
  run canAffordBuildTest =
    assert(not(canAffordBuild(
      {id: 0, name: "P", isHuman: true, resources: (0, 14, 0, 0)},
      "agricultural"))) and
    assert(canAffordBuild(
      {id: 0, name: "P", isHuman: true, resources: (0, 15, 0, 0)},
      "agricultural")) and
    assert(canAffordBuild(
      {id: 0, name: "P", isHuman: true, resources: (0, 0, 0, 0)},
      NO_CENTER))

  /// Pop spawn count: at most 1 per 10 years, can be 0 or 1 in
  /// a single turn. Crosses a decade boundary at years 10, 20, 30...
  /// (i.e., when age goes from 9 to 10, 19 to 20, etc.).
  run popSpawnCountTest =
    assert(popSpawnCount(0) == 0) and      // age 0 -> 1; same decade
    assert(popSpawnCount(8) == 0) and      // age 8 -> 9; same decade
    assert(popSpawnCount(9) == 1) and      // age 9 -> 10; decade crossed
    assert(popSpawnCount(19) == 1) and     // age 19 -> 20; decade crossed
    assert(popSpawnCount(20) == 0)         // age 20 -> 21; same decade

  /// `applyConstruction` clears the queue, sets each build
  /// order's pop unit's center, and removes each demolish
  /// order's pop unit's center. After demolish, the pop unit
  /// is gone from the population list.
  run applyConstructionTest =
    assert({
      val p0 = emptyPop(0, 0)
      val p1 = emptyPop(1, 0)
      val p2 = { ...emptyPop(2, 0), center: "agricultural" }
      val colony = {
        id: 0, starId: 0, ownerId: 0,
        population: [p0, p1, p2],
        pendingConstruction: [
          {kind: "build", popUnitId: 1, center: "industrial"},
          {kind: "demolish", popUnitId: 2, center: NO_CENTER}
        ],
        ageInYears: 0,
      }
      val out = applyConstruction(colony)
      out.pendingConstruction == List()
        and out.population[0].center == NO_CENTER   // p0 unchanged
        and out.population[1].center == "industrial" // p1 built
    })

  /// `addPool` and `subPool` are componentwise, with subPool
  /// clamped at zero.
  run poolArithmeticTest =
    assert(addPool((1, 2, 3, 4), (10, 20, 30, 40)) == (11, 22, 33, 44)) and
    assert(subPool((10, 20, 30, 40), (1, 2, 3, 4)) == (9, 18, 27, 36)) and
    assert(subPool((1, 2, 3, 4), (10, 20, 30, 40)) == (0, 0, 0, 0)) and
    assert(EMPTY_POOL == (0, 0, 0, 0))

  /// `isValidColony` rejects duplicate pop ids, duplicate order
  /// targets, orders pointing at non-existent pops, and negative age.
  run isValidColonyTest =
    assert(isValidColony({
      id: 0, starId: 0, ownerId: 0,
      population: List(),
      pendingConstruction: List(),
      ageInYears: 0,
    })) and
    assert(not(isValidColony({
      id: 0, starId: 0, ownerId: 0,
      population: [emptyPop(1, 0), emptyPop(1, 0)], // duplicate id
      pendingConstruction: List(),
      ageInYears: 0,
    }))) and
    assert(not(isValidColony({
      id: 0, starId: 0, ownerId: 0,
      population: [emptyPop(1, 0)],
      pendingConstruction: [{kind: "build", popUnitId: 99, center: "industrial"}], // bad target
      ageInYears: 0,
    }))) and
    assert(not(isValidColony({
      id: 0, starId: 0, ownerId: 0,
      population: [emptyPop(1, 0)],
      pendingConstruction: List(),
      ageInYears: -1,
    })))
}