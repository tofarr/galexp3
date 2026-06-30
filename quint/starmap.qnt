// SPDX-License-Identifier: MIT
//
// starmap.qnt
//
// Iteration 1b — Star map camera + selection model.
//
// Scope (current):
//   - Camera state: pan (in galaxy units) + zoom (integer percentage
//     of base scale: 100 = 1.0x). Centred, aspect-corrected viewport.
//   - Selection: a single optional star id. We use the sentinel
//     `selectedId == 0` to mean "no selection" because (a) Quint
//     0.22's `match` parser does not reliably support all sum-type
//     patterns we need, (b) star ids in galaxy.qnt are dense integers
//     starting at 1, so 0 is a safe sentinel, (c) it keeps the spec
//     simple and avoids a wrapper type.
//   - Pure coordinate transforms:
//       projectStar(star, camera, viewport, radius) -> ScreenPoint
//       unprojectPoint(point, camera, viewport, radius) -> Position
//       starAtPoint(point, galaxy, camera, viewport) -> int
//         (0 if no star is under the point)
//   - Pure state transitions:
//       selectStar, clearSelection, closePlanetMenu,
//       panCamera, zoomCameraAround,
//       selectStarCentred, clickEmpty, clickAtPoint
//   - Predicates: isValidCamera, isSelectionValid, isValidState
//
// Scope (deliberately excluded):
//   - Players / empires / ownership. Star will later gain
//     `owner: 0 | PlayerId`; the camera and selection code is
//     already designed to surface it (side panel will show ownership
//     metrics in a later iteration).
//   - Animation / easing. The MVP snaps to the new camera state;
//     smooth motion is a renderer concern.
//   - Multi-select, keyboard shortcuts, hover tooltips, right-click.
//   - Persistence. Camera state is in-memory UI state only.
//
// Coordinate system:
//   Galaxy: (0, 0) is disc centre, +x right, +y up. Range [-R, R] in
//           both axes. Positions are integers (mirror of galaxy.qnt).
//   Screen: (0, 0) is top-left of the viewport, +x right, +y down.
//           Pixels are integers.
//
// Number system:
//   Quint 0.22 has no native `real` type at the syntax level — all
//   numerics are `int`. We encode zoom as an integer percentage
//   (100 = 1.0x, range [MIN_ZOOM_PCT, MAX_ZOOM_PCT] = [25, 800]).
//   Every projection uses integer arithmetic with one final division
//   by ZOOM_DENOMINATOR (100). This matches the convention already
//   established in galaxy.qnt's preamble. The TypeScript mirror in
//   src/sim/starmap.ts uses `number` internally for clarity but
//   applies the same integer rounding when asserting spec parity.
//
// UI concerns out of scope here:
//   - The side panel's display string for a star (e.g. "Star #N") is
//     a TS-only concern. We deliberately don't model it in Quint
//     because Quint has no int-to-string primitive in this version.
//
// The TypeScript implementation mirrors this spec; property tests
// in src/sim/starmap.test.ts check the invariants. Per the Quint <->
// TS parity rule, every invariant here must have a Vitest counterpart.

module starmap {

  // ---------------------------------------------------------------------------
  // Types
  // ---------------------------------------------------------------------------

  /// Mirror of galaxy.qnt's Position. Integer 2D coords in galaxy units.
  type Position = { x: int, y: int }

  /// Mirror of galaxy.qnt's Star — only id, color, size and position
  /// are read directly here. `color` and `size` are kept for
  /// completeness; the renderer reads them but the spec never branches
  /// on them.
  type Star = { id: int, color: StarColor, size: int, position: Position }

  type StarColor = White | Yellow | Red | Orange | Green | Purple

  /// Subset of galaxy.qnt's Galaxy. Only `stars` and `radius` are
  /// used by the camera. We accept any star set here so this module
  /// is testable in isolation from galaxy.qnt's full galaxy invariant.
  type GalaxySubset = { radius: int, stars: Set[Star] }

  /// Star id within a galaxy. Matches galaxy.qnt's convention of
  /// dense integers 1..N. The selection sentinel is 0.
  type StarId = int

  /// Screen-space 2D point in integer pixels.
  /// Origin: top-left of the viewport. +x right, +y down.
  type ScreenPoint = { sx: int, sy: int }

  /// Camera pan, in galaxy units. The galaxy point at screen-centre.
  /// No bounds: pan is unconstrained so the user can drag the disc
  /// off-screen if they want.
  type Pan = { x: int, y: int }

  /// Camera zoom, an integer percentage of the base scale.
  /// 100 = 1.0x (disc just fits the smaller viewport dimension).
  /// Constrained to [MIN_ZOOM_PCT, MAX_ZOOM_PCT].
  type Zoom = int

  /// Viewport dimensions in integer pixels.
  type Viewport = { width: int, height: int }

  type Camera = { pan: Pan, zoom: Zoom }

  /// Starmap state: a camera + the current selection.
  /// `selectedId == 0` means no selection (since star ids are 1..N).
  /// The galaxy itself lives outside this module — the UI owns the
  /// generated Galaxy and passes it in to the pure functions below.
  type StarmapState = { camera: Camera, selectedId: StarId }

  // ---------------------------------------------------------------------------
  // Constants
  // ---------------------------------------------------------------------------

  /// Sentinel for "no selection". Star ids start at 1 in galaxy.qnt.
  pure val NO_SELECTION: int = 0

  /// Zoom denominator. The "true" zoom is zoomPct / ZOOM_DENOMINATOR.
  pure val ZOOM_DENOMINATOR: int = 100

  /// Minimum zoom percent (0.25x).
  pure val MIN_ZOOM_PCT: int = 25

  /// Maximum zoom percent (8.0x).
  pure val MAX_ZOOM_PCT: int = 800

  /// Initial zoom percent (1.0x).
  pure val INITIAL_ZOOM_PCT: int = 100

  /// Hit-test tolerance, in screen pixels. A click within this Chebyshev
  /// radius of a star's screen position selects it.
  pure val HIT_RADIUS_PX: int = 10

  /// Width of the right-side planet menu / context panel, in screen
  /// pixels. The starmap canvas still occupies the full viewport,
  /// but visually the *centred* map is shifted left so that stars
  /// around the visual centre aren't hidden behind the panel.
  /// Set to 0 to disable (centring uses the canvas centre).
  pure val PANEL_WIDTH_PX: int = 280

  /// Gap between the panel and the visually-centred region, in
  /// pixels. Keeps a small breathing space so the ring isn't glued
  /// to the panel edge. Combined with PANEL_WIDTH_PX to compute the
  /// horizontal centre offset from the canvas centre.
  pure val PANEL_CENTRE_GAP_PX: int = 20

  /// Initial camera: centred on the galaxy origin, zoom = 1.0x.
  pure val initialCamera: Camera =
    { pan: { x: 0, y: 0 }, zoom: INITIAL_ZOOM_PCT }

  /// Initial starmap state — no selection.
  pure val initialState: StarmapState =
    { camera: initialCamera, selectedId: NO_SELECTION }

  // ---------------------------------------------------------------------------
  // Coordinate transforms
  // ---------------------------------------------------------------------------

  /// Base scale: pixels per galaxy unit at zoom = 1.0x.
  /// Uses the smaller viewport dimension so the disc fits even on
  /// non-square viewports. Integer division truncates toward zero;
  /// a disc fits at zoom = 1.0x with at most 1px of slack.
  pure def baseScale(v: Viewport, radius: int): int =
    if (radius <= 0) 0
    else
      val minDim = if (v.width < v.height) v.width else v.height
      minDiv(minDim, 2 * radius)

  /// Integer division that truncates toward zero. Centralised so the
  /// spec stays readable and so we have a single place to handle the
  /// divide-by-zero case.
  pure def minDiv(a: int, b: int): int =
    if (b <= 0) 0
    else a / b

  /// Effective world-to-screen scale at the current zoom, in pixels
  /// per galaxy unit. = baseScale * zoomPct / ZOOM_DENOMINATOR.
  pure def worldScale(v: Viewport, radius: int, zoomPct: int): int =
    minDiv(baseScale(v, radius) * zoomPct, ZOOM_DENOMINATOR)

  /// Convert a galaxy point to a screen point (integer pixels).
  /// Y is flipped: galaxy +y is up, screen +y is down.
  /// Truncation toward zero mirrors JS integer pixel behaviour.
  /// Note: worldScale already incorporates /ZOOM_DENOMINATOR so the
  /// final pixel offset is `dx * s_px` without further division.
  pure def projectStar(s: Star, c: Camera, v: Viewport, radius: int): ScreenPoint =
    val s_px = worldScale(v, radius, c.zoom)
    val cx = v.width / 2
    val cy = v.height / 2
    val dx = (s.position.x - c.pan.x) * s_px
    val dy = (s.position.y - c.pan.y) * s_px
    { sx: cx + dx,
      sy: cy - dy }

  /// Inverse of projectStar — given a screen point, return the galaxy
  /// point that maps to it under the current camera.
  /// The un-truncated world scale is baseScale * zoomPct; dividing
  /// by `worldScale` instead would re-introduce the truncation that
  /// happened in worldScale, doubling the integer-rounding error.
  pure def unprojectPoint(p: ScreenPoint, c: Camera, v: Viewport, radius: int): Position =
    val s_untrunc = baseScale(v, radius) * c.zoom
    val cx = v.width / 2
    val cy = v.height / 2
    val dx = minDiv((p.sx - cx) * ZOOM_DENOMINATOR, s_untrunc)
    val dy = minDiv((cy - p.sy) * ZOOM_DENOMINATOR, s_untrunc)
    { x: c.pan.x + dx, y: c.pan.y + dy }

  /// Integer absolute value (Quint has no built-in abs for int).
  pure def absI(n: int): int = if (n < 0) -n else n

  /// Chebyshev distance between two screen points.
  pure def chebyshev(p: ScreenPoint, q: ScreenPoint): int =
    val adx = absI(p.sx - q.sx)
    val ady = absI(p.sy - q.sy)
    if (adx > ady) adx else ady

  /// True iff a star's screen position is within HIT_RADIUS_PX of a
  /// given screen point (Chebyshev distance).
  pure def isStarAtPoint(s: Star, p: ScreenPoint, c: Camera, v: Viewport, radius: int): bool =
    chebyshev(projectStar(s, c, v, radius), p) <= HIT_RADIUS_PX

  /// Hit-test: return the id of the star under screen point `p`, or
  /// `NO_SELECTION` if no star is within the hit-test radius.
  /// Among candidates, the one with the smallest Chebyshev distance
  /// wins (deterministic tie-break by smallest id).
  pure def starAtPoint(p: ScreenPoint, g: GalaxySubset, c: Camera, v: Viewport): int =
    val candidates = g.stars.filter(s => isStarAtPoint(s, p, c, v, g.radius))
    if (candidates.size() == 0) NO_SELECTION
    else
      val bestDist = candidates.fold(9999, (best, s) =>
        val d = chebyshev(projectStar(s, c, v, g.radius), p)
        if (d < best) d else best)
      val winners = candidates.filter(s =>
        chebyshev(projectStar(s, c, v, g.radius), p) == bestDist)
      // Deterministic tie-break: smallest id among winners.
      val minId = winners.fold(9999, (best, s) =>
        if (s.id < best) s.id else best)
      minId

  // ---------------------------------------------------------------------------
  // Camera predicates
  // ---------------------------------------------------------------------------

  /// True iff a camera's zoom percent is in the allowed range.
  pure def isValidZoom(z: int): bool =
    z >= MIN_ZOOM_PCT and z <= MAX_ZOOM_PCT

  /// True iff a camera is well-formed. Pan has no bounds by design.
  pure def isValidCamera(c: Camera): bool = isValidZoom(c.zoom)

  /// True iff the selection refers to a star that exists in `g`,
  /// or is the no-selection sentinel.
  pure def isSelectionValid(selId: int, g: GalaxySubset): bool =
    if (selId == NO_SELECTION) true
    else g.stars.exists(s => s.id == selId)

  /// True iff a starmap state is internally consistent.
  pure def isValidState(state: StarmapState, g: GalaxySubset): bool =
    isValidCamera(state.camera)
    and isSelectionValid(state.selectedId, g)

  /// True iff a world point lies inside (or on the boundary of) the
  /// galaxy disc of the given radius. Mirrors the TS `isInsideGalaxy`.
  pure def isInsideGalaxy(world: Position, radius: int): bool =
    world.x * world.x + world.y * world.y <= radius * radius

  // ---------------------------------------------------------------------------
  // State transitions
  // ---------------------------------------------------------------------------

  /// Select a star by id. Returns the new state unchanged if `id`
  /// does not correspond to a star in `g`.
  pure def selectStar(state: StarmapState, id: int, g: GalaxySubset): StarmapState =
    if (g.stars.exists(s => s.id == id))
      { ...state, selectedId: id }
    else state

  /// Clear the current selection.
  pure def clearSelection(state: StarmapState): StarmapState =
    { ...state, selectedId: NO_SELECTION }

  /// Pan the camera by a screen-space delta. Positive `dx` pans the
  /// view right; positive `dy` pans the view down (which is galaxy
  /// +y up = camera pan y decreases).
  /// Use the un-truncated scale baseScale * zoomPct so integer
  /// rounding is consistent with projectStar.
  pure def panCamera(state: StarmapState, dx: int, dy: int, v: Viewport, radius: int): StarmapState =
    val s_untrunc = baseScale(v, radius) * state.camera.zoom
    val dgx = minDiv(dx * ZOOM_DENOMINATOR, s_untrunc)
    val dgy = minDiv(dy * ZOOM_DENOMINATOR, s_untrunc)
    { ...state, camera: { ...state.camera,
      pan: { x: state.camera.pan.x + dgx, y: state.camera.pan.y - dgy } } }

  /// Clamp a zoom percent into the allowed range.
  pure def clampZoom(z: int): int =
    if (z < MIN_ZOOM_PCT) MIN_ZOOM_PCT
    else if (z > MAX_ZOOM_PCT) MAX_ZOOM_PCT
    else z

  /// Zoom around a screen-space anchor. After the zoom, the galaxy
  /// point under `anchor` is still under `anchor`. The new zoom is
  /// clamped to [MIN_ZOOM_PCT, MAX_ZOOM_PCT] and the pan is adjusted
  /// so the anchor stays put. Uses un-truncated scales
  /// (baseScale * zoomPct) for consistency with unprojectPoint.
  pure def zoomCameraAround(state: StarmapState, factorPct: int, anchor: ScreenPoint, v: Viewport, radius: int): StarmapState =
    val oldZ = state.camera.zoom
    val newZraw = minDiv(oldZ * factorPct, ZOOM_DENOMINATOR)
    val newZ = clampZoom(newZraw)
    val cx = v.width / 2
    val cy = v.height / 2
    val sOldUntrunc = baseScale(v, radius) * oldZ
    val sNewUntrunc = baseScale(v, radius) * newZ
    // World point under anchor before zoom.
    val wx = state.camera.pan.x + minDiv((anchor.sx - cx) * ZOOM_DENOMINATOR, sOldUntrunc)
    val wy = state.camera.pan.y + minDiv((cy - anchor.sy) * ZOOM_DENOMINATOR, sOldUntrunc)
    // After zoom, set pan so (wx, wy) maps back to anchor.
    val newPanX = wx - minDiv((anchor.sx - cx) * ZOOM_DENOMINATOR, sNewUntrunc)
    val newPanY = wy - minDiv((cy - anchor.sy) * ZOOM_DENOMINATOR, sNewUntrunc)
    { ...state, camera: { pan: { x: newPanX, y: newPanY }, zoom: newZ } }

  // ---------------------------------------------------------------------------
  // Planet menu / selection transitions (Iter 2l)
  // ---------------------------------------------------------------------------

  /// X-coordinate of the *visual* centre of the map, accounting for
  /// the right-side planet menu panel. Stars around this point will
  /// not be hidden behind the panel.
  ///
  /// When PANEL_WIDTH_PX is 0 (no panel), this is just the canvas
  /// centre. With the default 280 px panel and a 20 px gap, the
  /// visual centre shifts left by (280 + 20) / 2 = 150 px.
  ///
  /// The visual-centre offset is clamped so it never exceeds the
  /// canvas width: at very narrow viewports the panel would
  /// otherwise push the visual centre outside the canvas.
  pure def visualCentreX(v: Viewport, panelWidth: int): int =
    val halfW = v.width / 2
    // When there is no panel, the visual centre is the canvas centre.
    // With a panel, shift left by (panelWidth + gap) / 2 so the
    // selected star isn't glued against the panel edge. The offset
    // is clamped so a giant panel doesn't push the visual centre
    // off the canvas entirely.
    val offset = if (panelWidth <= 0) 0
                 else
                   val raw = minDiv(panelWidth + PANEL_CENTRE_GAP_PX, 2)
                   if (raw > halfW) halfW else raw
    halfW - offset

  /// Y-coordinate of the visual centre — unchanged by the panel
  /// (panel is on the right edge, vertical centring is unaffected).
  pure def visualCentreY(v: Viewport): int = v.height / 2

  /// Visual centre of the map (i.e. where the selected star should
  /// land after centring).
  pure def visualCentre(v: Viewport, panelWidth: int): ScreenPoint =
    { sx: visualCentreX(v, panelWidth), sy: visualCentreY(v) }

  /// Compute the camera pan that puts a given world point at the
  /// visual centre. This is the inverse of `projectStar` for the
  /// visual-centre screen point.
  ///
  /// Note: uses the un-truncated world scale (baseScale * zoomPct) to
  /// mirror unprojectPoint's integer-rounding behaviour.
  pure def panToVisualCentre(state: StarmapState, world: Position, v: Viewport, radius: int, panelWidth: int): StarmapState =
    val centre = visualCentre(v, panelWidth)
    val s_untrunc = baseScale(v, radius) * state.camera.zoom
    val dx = minDiv((centre.sx - v.width / 2) * ZOOM_DENOMINATOR, s_untrunc)
    val dy = minDiv((v.height / 2 - centre.sy) * ZOOM_DENOMINATOR, s_untrunc)
    { ...state, camera: { ...state.camera,
      pan: { x: world.x - dx, y: world.y - dy } } }

  /// Select a star and re-centre the camera so the star appears at
  /// the visual centre (offset for the panel). The zoom is unchanged.
  /// Returns the input state unchanged if `id` is not a valid star.
  pure def selectStarCentred(state: StarmapState, id: int, g: GalaxySubset, v: Viewport, panelWidth: int): StarmapState =
    if (not(g.stars.exists(s => s.id == id)))
      state
    else
      // The `exists` check guarantees a match; fold to pull one out
      // (any element with the matching id works — by galaxy invariant
      // ids are unique, so the fold picks that one).
      val target = g.stars.fold(
        { id: -1, color: White, size: 0, position: { x: 0, y: 0 } },
        (acc, s) => if (s.id == id) s else acc)
      val selected = { ...state, selectedId: id }
      panToVisualCentre(selected, target.position, v, g.radius, panelWidth)

  /// Close the planet menu — clears the current selection without
  /// touching the camera. Idempotent: calling on no-selection is a
  /// no-op (same state).
  pure def closePlanetMenu(state: StarmapState): StarmapState =
    { ...state, selectedId: NO_SELECTION }

  /// Click on empty space (no star under the cursor). Pans the
  /// camera so the world point under the click ends up at the
  /// visual centre. NEVER clears the selection — clicking empty
  /// space re-centres without disturbing the open planet menu.
  /// Returns the input state unchanged if the click lies outside
  /// the galaxy disc (clicks off the disc are no-ops).
  pure def clickEmpty(state: StarmapState, screenPoint: ScreenPoint, g: GalaxySubset, v: Viewport, panelWidth: int): StarmapState =
    val world = unprojectPoint(screenPoint, state.camera, v, g.radius)
    if (not(isInsideGalaxy(world, g.radius)))
      state
    else
      panToVisualCentre(state, world, v, g.radius, panelWidth)

  /// Top-level click transition used by the starmap canvas click
  /// handler. If the click hits a star, selects it (and centres);
  /// if it hits empty space, pans to the click point and KEEPS the
  /// existing selection. There is no transition that clears the
  /// selection on an in-game click — the panel must be closed
  /// explicitly (closePlanetMenu).
  pure def clickAtPoint(state: StarmapState, screenPoint: ScreenPoint, g: GalaxySubset, v: Viewport, panelWidth: int): StarmapState =
    val id = starAtPoint(screenPoint, g, state.camera, v)
    if (id == NO_SELECTION)
      clickEmpty(state, screenPoint, g, v, panelWidth)
    else
      selectStarCentred(state, id, g, v, panelWidth)

  // ---------------------------------------------------------------------------
  // Static sanity checks
  // ---------------------------------------------------------------------------

  /// Initial camera must be valid.
  run initialCameraIsValid = isValidCamera(initialCamera)

  /// Initial state must be valid (camera valid, no selection).
  run initialStateIsValid =
    isValidCamera(initialState.camera)
    and initialState.selectedId == NO_SELECTION

  /// Zoom bounds are ordered.
  run zoomBoundsOrdered = MIN_ZOOM_PCT < MAX_ZOOM_PCT

  /// A factor of 1.0x (ZOOM_DENOMINATOR percent) leaves the camera unchanged.
  run zoomByOneIsNoop =
    val s0 = initialState
    val s1 = zoomCameraAround(s0, ZOOM_DENOMINATOR, { sx: 100, sy: 100 }, { width: 800, height: 600 }, 70)
    s1.camera.zoom == INITIAL_ZOOM_PCT
    and s1.camera.pan.x == 0
    and s1.camera.pan.y == 0

  /// Zoom clamps to MAX_ZOOM_PCT.
  run zoomClampsHigh =
    val s0 = initialState
    val s1 = zoomCameraAround(s0, 99999, { sx: 100, sy: 100 }, { width: 800, height: 600 }, 70)
    s1.camera.zoom == MAX_ZOOM_PCT

  /// Zoom clamps to MIN_ZOOM_PCT.
  run zoomClampsLow =
    val s0 = initialState
    val s1 = zoomCameraAround(s0, 1, { sx: 100, sy: 100 }, { width: 800, height: 600 }, 70)
    s1.camera.zoom == MIN_ZOOM_PCT

  // ---------------------------------------------------------------------------
  // Planet menu / selection sanity checks (Iter 2l)
  // ---------------------------------------------------------------------------

  /// PANEL_WIDTH_PX is positive (panel is visible) and bounded.
  run panelWidthSane =
    PANEL_WIDTH_PX > 0 and PANEL_WIDTH_PX < 1000

  /// visualCentreX shifts the centre LEFT by (panelWidth + gap) / 2
  /// — i.e. smaller than v.width / 2.
  run visualCentreXIsLeftOfCanvasCentre =
    val v = { width: 800, height: 600 }
    visualCentreX(v, PANEL_WIDTH_PX) < v.width / 2

  /// visualCentreX is always non-negative (the offset is clamped).
  run visualCentreXNonNegative =
    val v = { width: 800, height: 600 }
    visualCentreX(v, PANEL_WIDTH_PX) >= 0

  /// visualCentreX at panelWidth = 0 equals the canvas centre.
  run visualCentreXNoPanel =
    val v = { width: 800, height: 600 }
    visualCentreX(v, 0) == v.width / 2

  /// visualCentreY is always the canvas vertical centre.
  run visualCentreYAlways =
    val v = { width: 800, height: 600 }
    visualCentreY(v) == v.height / 2

  /// closePlanetMenu clears the selection but preserves the camera.
  run closePlanetMenuClearsSelection =
    val g = { radius: 70, stars: Set({ id: 1, color: White, size: 5, position: { x: 0, y: 0 } }) }
    val s0 = { camera: { pan: { x: 5, y: -3 }, zoom: 150 }, selectedId: 1 }
    val s1 = closePlanetMenu(s0)
    s1.selectedId == NO_SELECTION
    and s1.camera.pan.x == 5
    and s1.camera.pan.y == -3
    and s1.camera.zoom == 150

  /// closePlanetMenu is idempotent on no-selection.
  run closePlanetMenuIdempotent =
    val s0 = initialState
    val s1 = closePlanetMenu(s0)
    s1 == s0

  /// selectStarCentred updates the selection AND the camera pan so
  /// the chosen star lands at the visual centre (offset for the
  /// panel). The exact pan is `world - dx` where
  /// `dx = (visualCentre - canvasCentre) * ZOOM_DENOMINATOR / s_untrunc`
  /// — we assert on `camera.pan` directly to side-step the
  /// integer-rounding offset that projectStar would re-introduce
  /// (≈ 2 px here).
  run selectStarCentredMovesCamera =
    val v = { width: 800, height: 600 }
    val g = { radius: 70, stars: Set({ id: 1, color: White, size: 5, position: { x: 0, y: 0 } }) }
    val s0 = initialState
    val s1 = selectStarCentred(s0, 1, g, v, PANEL_WIDTH_PX)
    s1.selectedId == 1
    and s1.camera.zoom == INITIAL_ZOOM_PCT  // zoom unchanged
    // visualCentreX(800, 280) = 250; s_untrunc = base(4) * 100 = 400;
    // dx = (250 - 400) * 100 / 400 = -37 (truncated);
    // pan.x = world.x - dx = 0 - (-37) = 37.
    and s1.camera.pan.x == 37
    and s1.camera.pan.y == 0

  /// selectStarCentred with an unknown id leaves the state unchanged.
  run selectStarCentredUnknownNoop =
    val v = { width: 800, height: 600 }
    val g = { radius: 70, stars: Set({ id: 1, color: White, size: 5, position: { x: 10, y: -5 } }) }
    val s0 = initialState
    val s1 = selectStarCentred(s0, 999, g, v, PANEL_WIDTH_PX)
    s1 == s0

  /// clickEmpty pans so the world point under the click ends up at
  /// the visual centre, but NEVER clears the existing selection.
  /// We assert on the resulting camera pan directly (the camera
  /// pan after clickEmpty should be the same as calling
  /// panToVisualCentre with the world point under the click).
  run clickEmptyPreservesSelection =
    val v = { width: 800, height: 600 }
    val g = { radius: 70, stars: Set({ id: 1, color: White, size: 5, position: { x: 0, y: 0 } }) }
    // Start with a selection visible, pan around (selection = star 1).
    val s0 = { camera: { pan: { x: 5, y: 5 }, zoom: 100 }, selectedId: 1 }
    // The world point under the canvas centre, under s0:
    // with pan = (5, 5), the camera centre is galaxy (5, 5).
    val click = { sx: v.width / 2, sy: v.height / 2 }
    val s1 = clickEmpty(s0, click, g, v, PANEL_WIDTH_PX)
    s1.selectedId == 1  // selection preserved across empty click
    // After: pan.x = clickWorld.x - dx; clickWorld = (5, 5);
    // dx = (visualCentreX - v.width/2)*100/s_untrunc = -15000/400 = -37;
    // pan.x = 5 - (-37) = 42. pan.y unchanged at 5.
    and s1.camera.pan.x == 42
    and s1.camera.pan.y == 5

  /// clickEmpty on a point outside the disc is a no-op.
  run clickEmptyOutsideDiscNoop =
    val v = { width: 800, height: 600 }
    val g = { radius: 70, stars: Set({ id: 1, color: White, size: 5, position: { x: 0, y: 0 } }) }
    val s0 = initialState
    // A click at the canvas top-left corner, well outside the disc.
    val click = { sx: 5, sy: 5 }
    val s1 = clickEmpty(s0, click, g, v, PANEL_WIDTH_PX)
    s1 == s0

  /// clickAtPoint dispatches to selectStarCentred when a star is hit.
  run clickAtPointOnStarSelects =
    val v = { width: 800, height: 600 }
    val g = { radius: 70, stars: Set({ id: 1, color: White, size: 5, position: { x: 0, y: 0 } }) }
    val star1 = g.stars.fold({ id: -1, color: White, size: 0, position: { x: 0, y: 0 } }, (acc, s) => s)
    val s0 = initialState
    // Click at the projected position of the star.
    val starScreen = projectStar(star1, s0.camera, v, g.radius)
    val s1 = clickAtPoint(s0, starScreen, g, v, PANEL_WIDTH_PX)
    s1.selectedId == 1

  /// clickAtPoint on empty space preserves the selection (regression
  /// for the Iter 2l bug: empty clicks must NOT clear selection).
  run clickAtPointEmptyPreservesSelection =
    val v = { width: 800, height: 600 }
    val g = { radius: 70, stars: Set({ id: 1, color: White, size: 5, position: { x: 0, y: 0 } }) }
    val s0 = { camera: initialCamera, selectedId: 1 }
    // Click somewhere far from the star (which is at the centre).
    val s1 = clickAtPoint(s0, { sx: 1, sy: 1 }, g, v, PANEL_WIDTH_PX)
    s1.selectedId == 1

  /// Switching between selections via clickAtPoint updates the
  /// selection (not just keeps the old one).
  run clickAtPointSwitchesSelection =
    val v = { width: 800, height: 600 }
    val g = { radius: 70, stars: Set(
      { id: 1, color: White, size: 5, position: { x: -20, y: 0 } },
      { id: 2, color: Yellow, size: 5, position: { x: 20, y: 0 } },
    )}
    // Select star 1 first, recentre camera.
    val s0 = selectStarCentred(initialState, 1, g, v, PANEL_WIDTH_PX)
    // Now click star 2 (project it under the current camera to get
    // an on-screen click). Pull star 2 out via fold since Set has
    // no indexing.
    val star2 = g.stars.fold(
      { id: -1, color: White, size: 0, position: { x: 0, y: 0 } },
      (acc, s) => if (s.id == 2) s else acc)
    val star2Screen = projectStar(star2, s0.camera, v, g.radius)
    val s1 = clickAtPoint(s0, star2Screen, g, v, PANEL_WIDTH_PX)
    s1.selectedId == 2
}