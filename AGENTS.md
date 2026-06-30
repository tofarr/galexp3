# AGENTS.md — galexp3

Persistent memory for repository-specific knowledge. Update this file
when new patterns, decisions, or gotchas are discovered.

## Project shape

- Browser-based 4X space game. Master of Orion / Galactic Civilizations style.
- Stack: TypeScript, Vite, Vitest, PixiJS (planned), IndexedDB (planned),
  Quint (spec + invariants).
- Single-player, turn-based. Galaxy map + decision menus as the spine.
- Layer separation: `sim/` (pure) / `ui/` (PixiJS) / `io/` (IndexedDB) / `ai/`.
- Persistence model: full state saved per turn.

## Methodology

- Quint specs are canonical. TypeScript modules mirror them.
- For every Quint invariant, there must be a Vitest property test in TS
  (using `fast-check`). This catches drift if Quint compile / TS hand-write
  fall out of step.
- Workflow per iteration: spec → property tests → MVP → review → next.
- Iteration cadence is intentionally small. Don't try to do everything at
  once. Pause for review between iterations.

## Iteration log

### Iter 1a — Galaxy data model

**Scope (current):**
- Types: `GalaxySize`, `Position`, `StarKind`, `Star`, `Galaxy`.
- Generator: `initGalaxy(seed, size)` deterministic, Poisson-disk in a
  bounded disc.
- Validity: `isValidGalaxy(g)`.
- Invariants: star count matches size, ids unique, positions unique,
  all within disc.

**Scope (deliberately excluded until later iters):**
- Players, empires, planets, fleets, win states, AI, persistence, UI.

**Decisions logged:**
- Galaxy size presets use **Master of Orion (1993)** counts:
  Small=24, Medium=33, Large=48, Huge=72.
  MoO 2 used 24/40/56/80 — swap `STAR_COUNT_FOR_SIZE` if MoO 2 numbers
  are preferred.
- Galaxy is a **bounded disc** (thematic; matches MoO feel). No torus,
  no wrap-around. Change `galaxyRadius` and the disc predicate to switch.
- Star generation uses seeded **Mulberry32** PRNG + Poisson-disk style
  rejection sampling. Deterministic for any (seed, size) pair.
- Star kinds are a closed set of six: Blue, White, Yellow, Red, Orange, Brown.
  Real spectral classification is richer; extend as gameplay requires.

### Iter 1d — Gaussian-blurred star halos

**Scope:**
- Each star's halo (atmospheric scatter) is rendered into a per-star
  `Graphics` wrapped in a `BlurFilter`, then drawn before the sharp
  body + spikes. The blur is **only on the halo**, so the star reads
  as a sharp point of light surrounded by soft bloom.
- Blur strength scales with star size (Dwarf 2 px, Standard 4 px,
  Giant 7 px, Supergiant 10 px).
- `filterArea` on each halo `Graphics` is inflated to
  `ceil(glowRadius + 3*blurStrength + 2)` in each axis so PixiJS
  doesn't clip the blurred kernel.
- `STAR_GLOW_ALPHA` bumped 64 → 110 so the bloom reads against the
  dark galaxy disc.

**Spec mirror:**
- `quint/galaxy.qnt` — new `STAR_BLUR_PX` defs + static check
  `starBlurOrdering` (Supergiant > Giant > Standard > Dwarf).
- `src/sim/galaxy.ts` — `STAR_BLUR_PX_FOR_SIZE` export.
- `src/sim/galaxy.test.ts` — existing sizeOrdering test extended to
  also assert strict blur ordering.

**Decisions logged:**
- Used PixiJS `BlurFilter` (built-in) on a single `Graphics` rather
  than a `Container` — the filter pipeline applies to `Graphics`
  directly in v8.
- `quality` left at the constructor default (4) — fully sufficient
  for halos this small. Bump only if visible banding appears.
- Bloom strength was tuned UP from iter-1d-in-progress initial values
  (1/2/3/4 → 2/4/7/10). The earlier values were invisible at any
  practical zoom and on the dark blue disc.

**Debugging breadcrumbs for the future:**
- If a blur (or any filter) suddenly stops appearing, check
  `app.renderer.type`.  Must be 1 (WebGL) or 2 (WebGPU).  Anything
  else → renderer silently downgraded to Canvas → filters no-op.
- Initial visual impressions of "blurs that look identical to no
  blur" often mean the blur is rendering but at a strength that's
  too low to read. Bump strength before suspecting broken plumbing.

### Iter 1e — Numeric star size + new colour palette + layered bloom

**Scope:**
- Replaced the 4-tier `StarSize` enum (Dwarf/Standard/Giant/Supergiant)
  with a numeric `size: int` in `[1, 100]`. Will later govern resource
  yield of a colonised star.
- Replaced the colour palette: dropped Blue & Brown (looked like
  artifacts on the dark disc), added Green & Purple for visual variety
  (not realistic in MK classification — gameplay colours).
  New set: **White, Yellow, Orange, Red, Green, Purple**.
- Dropped diffraction spikes — the new layered bloom renders as a
  realistic astrophotography-style point of light with halo.
- Each star is now four PixiJS layers (back to front):
  1. Outer halo (`STAR_HALO_COLOR_FOR_COLOR`, `haloRadius`, low alpha,
     **heavy** blur — atmospheric scatter)
  2. Inner bloom (body colour, `bloomRadius`, medium alpha, medium blur)
  3. White core (pure white, `bodyRadius`, opaque, **lesser** blur)
  4. Sharp highlight dot (white, ~0.4× bodyRadius, opaque, no blur —
     pixel-precise centre for bright stars)
- All pixel choices derived from `starBodyPx(size)`, `starBloomPx(size)`,
  `starHaloPx(size)`, `starBloomBlurPx(size)`, `starHaloBlurPx(size)`,
  `starCoreBlurPx(size)` — every star in the galaxy uses the same
  formulas; no per-galaxy tuning.
- New **procedural starfield** backdrop — ~2000 deterministic dust
  stars (~3.5/kpx²) painted into a single Graphics in one draw call,
  tinted mostly white with some warm/cool accent. Sits behind the
  galaxy disc.

**Spec mirror:**
- `quint/galaxy.qnt` — `StarColor = White | Yellow | Red | Orange |
  Green | Purple`, `STAR_COLOR_FOR_COLOR` table, `STAR_HALO_COLOR_FOR_COLOR`
  table, `STAR_BODY_PX/BLOOM/HALO_PX/BLOOM_BLUR_PX/HALO_BLUR_PX/
  CORE_BLUR_PX` formulas, new `allStarsHaveValidSize` predicate.
  Static checks added: `bodyRadiusInRange`, `haloBlurIsMonotonic`,
  `haloBlurHeaviest`, `everyColourHasBodyAndHalo`,
  `starSizeRangeIsSane`.
- `quint/starmap.qnt` — `StarKind` alias renamed to `StarColor`
  with the new variants; `Star` struct gains `color` + `size`.

**Decisions logged:**
- **Uniform** size distribution across [1, 100] for now. Unnatural
  (real galaxies have many more small stars than large) but better
  for gameplay — predictable variability, no dead-stars syndrome
  where half the map has nothing useful. Switch to a power-law
  distribution later when we balance resources.
- Body colour is separate from halo colour. Body uses the softer hue
  (e.g. Yellow body 0xffe680) while halo uses the more saturated
  variant (0xffd040). The contrast makes the scatter read as light
  bleeding past the star rather than a shadow.
- White is a special case — body and halo both whitish (0xffffff
  body, 0xdde8ff halo). They are allowed to match because a pure
  white halo around a white star reads correctly.
- Three blur layers instead of one. The "heavy" halo blur is the
  dominant feature (range 2..12 px); the "lesser" core blur keeps
  the white centre sharp but softens pixel edges (range 0..3 px);
  bloom blur sits between (range 1..5 px).
- Each star is FOUR PixiJS Graphics (halo/bloom/core/highlight),
  not one. Cost: ~4× draw calls per star. At 72 stars (Huge) = 288
  draw calls — comfortably under the practical limit. If we ever
  push to >500 stars we'll revisit with batched container.
- Dust starfield rendered once at mount, NOT re-rendered on galaxy
  change. The dust belongs to the viewport, not the galaxy.
- Poisson-disk min-distance in `initGalaxy` is now allowed to
  relax progressively (up to 30%) if the disc can't fit the target
  star count at the calculated spacing. The test for "no two
  stars closer than minDist" uses the same 30% allowance.

**Debugging breadcrumbs for the future:**
- PixiJS Graphics with a `BlurFilter` require a non-zero
  `filterArea` larger than the visible bounds. Rule of thumb used:
  `ceil(radius + 3*blurStrength + 2)` per axis. Forget this and the
  blur renders as a hard circle (clip).
- The `BackgroundColor` for the PixiJS app is `0`. Any dust drawn
  before the disc fill will be painted over. Dust is drawn first
  (behind disc); this is intentional so the disc reads as a region
  of dense gas rather than a window into a star cloud.

### Iter 1f — Halo-positioning bug fix (and post-fix tuning)

**Scope:**
- Fixed a reported bug: star halos rendered mis-positioned
  (concentrated bottom-right of the star, with a diagonal clip
  edge through the halo) on *some* stars but not all, in a zoom-
  dependent way.
- Rebuilt `paintStar` to use **one blurred `Graphics` per star**
  (halo + bloom + white core as concentric fills at local origin)
  with a single `BlurFilter`. The sharp highlight dot is a
  separate unblurred `Graphics`.
- No manual `filterArea` anywhere — PixiJS v8 auto-computes the
  filter bounds from the children's local geometry.
- Iteratively dialed in the look: blur 10 → 5 → 2.5px (kept at
  2.5px); added `STAR_DISPLAY_SCALE = 1.5` so every visual
  dimension (halo/bloom/core radii, highlight radius, blur
  strength) is multiplied together, preserving the proportions
  we settled on while making stars render 1.5× larger.

**Spec mirror:**
- No Quint spec change. Visual sizing in `src/sim/galaxy.ts`
  still mirrors `STAR_BODY_PX/BLOOM/HALO_PX` exactly. The 1.5×
  multiplier is a pure UI tuning knob in `src/ui/starmap.ts`
  (`STAR_DISPLAY_SCALE`) — intentionally NOT in the spec layer,
  since the spec is the canonical "what does a star look like in
  the simulation" and the multiplier is "how does it render in
  this particular UI iteration".
- `starBloomBlurPx`/`starCoreBlurPx`/`starHaloBlurPx` are still
  in `src/sim/galaxy.ts` (and tested in `src/sim/galaxy.test.ts`)
  — unused in `starmap.ts` for now, kept available for a future
  iteration that wants multi-strength blurs again.

**Decisions logged:**
- **Root cause of the halo-positioning bug**:
  When per-layer `Graphics` (halo / bloom / core) each had their
  own `BlurFilter` **and** an explicit `filterArea` set to
  `(-haloHalf, -haloHalf, 2*haloHalf, 2*haloHalf)` (negative
  origin, centred on local 0,0), some stars rendered with the
  halo offset toward the bottom-right and partially clipped.
  The bug was zoom-dependent and affected only a subset of stars
  — consistent with subpixel / rounding inconsistency in the
  per-star filter-area + bounds pipeline when stars overlap on
  screen.
- **Fix**: collapse to one blurred `Graphics` per star with no
  manual `filterArea`. PixiJS v8's auto-compute derives a centred
  `filterArea` from the children's local geometry (every circle
  is drawn at local origin → bounds are symmetric). User
  empirically confirmed no-blur rendered correctly, then a single
  `BlurFilter(10)` on the merged `Graphics` rendered correctly
  too — confirming the bug was in the manual multi-layer setup,
  not in the BlurFilter itself.
- **One blur at a fixed strength (2.5px)**, not three separate
  blurs at size-derived strengths. The previous three-strength
  approach (halo heaviest, core lightest) was driven by the
  per-layer design. With one filter that distinction goes away
  — and the simpler path renders identically visually, with
  fewer draw calls and no per-layer `filterArea` to misbehave.
- **`STAR_DISPLAY_SCALE` lives in the UI layer, not the spec**.
  Future iteration: if we decide 1.5× is the canonical "right"
  size, bake it into `STAR_BODY_PX` in `quint/galaxy.qnt` and
  remove the constant. Until then it's a tuning knob.
- The sharp highlight dot is **outside** the blurred `Graphics`
  on purpose — it gives bright stars a pixel-precise centre
  against the soft glow.

**Debugging breadcrumbs for the future:**
- In PixiJS v8, putting multiple `BlurFilter`s on per-layer
  `Graphics` (especially with manual negative-half `filterArea` in
  local coords) is fragile. If you see offset/clipped halos, the
  first thing to try is collapsing to one blurred `Graphics` per
  logical object and dropping manual `filterArea`. The auto-
  computed `filterArea` is reliably centred for geometry drawn at
  local origin.
- Sanity check: if the visual position of a blurred layer is
  wrong on *some* shapes but not all, disable blur entirely. If
  the no-blur render is correct and the blurred render is wrong,
  the bug is filter-pipeline-side, not geometry-side. This
  bisection is fast and saves hours of digging through
  `Bounds.applyMatrix` internals.
- `BlurFilter.strength` accepts floats (not just integers). 2.5
  is a valid, working value.

## Layout

```
quint/         # canonical Quint specs
src/
  sim/         # pure data model + tests
  ui/          # PixiJS render (not started — Iter 1b)
  io/          # IndexedDB persistence (not started — Iter 2)
  ai/          # scripted AI (not started — later)
```

## Commands

- `npm run dev` — Vite dev server.
- `npm test` — Vitest, one shot. Use `npm run test:watch` while iterating.
- `npm run spec` — pass-through to `quint` CLI.
- `npm run spec:check` — `quint typecheck quint/galaxy.qnt`.
- `npm run spec:simulate` — bounded simulator run of the spec.

## Environment notes — PixiJS renderer in this dev sandbox

- The dev sandbox browser **does** expose WebGL (PixiJS ends up with
  `app.renderer.type === 1`). Iter 1d confirmed this: `BlurFilter`
  applied to per-star halos renders correctly.
- The earlier note (written before any Pixi work) about a lack of
  WebGL turned out to be wrong — guess and check, don't trust
  prior negative notes.
- Even so, the menu background still has **two render paths**
  selected by `webglAvailable()` at mount time, because some CI /
  preview environments *do* lack WebGL and we want the menu to
  render somewhere:
    - WebGL available → `mountShaderVortex()` (PixiJS GlProgram +
      Filter)
    - no WebGL → `mountCssVortex()` (CSS conic + radial gradients)
- When debugging "filter has no visible effect", first verify the
  active renderer type via `app.renderer.type` after init — must be
  `1` (WebGL) or `2` (WebGPU) for filters to run. If it's `4`
  (Canvas), GPU features won't run.

## Quint 0.22.4 quirks — WORKAROUNDS

Confirmed bugs in the bundled Quint version; these patterns are
required, not optional:

- **`.filter` / `.exists` / `.forall` / `.size` on Lists** throw or
  return wrong answers. Don't use them. Replace with `foldl`
  (always) or head/tail recursion.
- **`List.append(x)` on the result of a `foldl`** works, but ONLY
  when the fold seed and lambda are unambiguously typed. The
  pattern that always works is:
  ```quint
  xs.foldl(List(), (acc, x) => if (cond(x)) acc.append(x) else acc)
  ```
- **Empty-list seeds with type parameters** parse-fail.
  Use `List()`, NOT `List[T]()`. The element type is inferred
  from the rest of the fold.
- **`Set()` as a foldl seed** is fine when used directly, BUT the
  common pattern `if (xs == List()) Set() else Set(xs[0].field)`
  is dangerous when used to seed a Set-fold whose purpose is to
  EXCLUDE the first element. The pattern silently puts the first
  element's field into the result set even when it shouldn't be
  there (e.g., seeding a "demolish targets" set with the first
  order's popUnitId wrongly includes a build order in the set,
  which then silently drops a healthy pop unit from the population).
  **Rule: when computing "the subset that satisfies P", seed with
  `Set()` (or `List()`) and let the lambda add only the matching
  elements. Don't pre-seed with `xs[0]` and rely on the lambda
  to filter — the seed is unconditional.**
- **`head` is a Quint keyword** and shadows when used as a
  variable name. Use `firstP`, `firstStar`, `headElem`, etc.
- **Lists with element-of-type T where T has a `Set[int]` field**
  work fine through `foldl`/`append`, but if a complex fold ever
  drops elements inexplicably, bisect: replace the Set fold with
  a hardcoded `Set(N)` and see whether the drop goes away. If it
  does, the bug is in the Set fold, not the List fold.

### Iter 2a — Player + colony + resource model

**Scope:**
- New spec module: `quint/empire.qnt`.
- Types: `ResourceType`, `ResourcePool` (4-tuple of
  agriculture/industry/academic/culture ints),
  `Player`, `Race`, `EmpireStar`, `PopulationUnit`, `CenterType`,
  `ConstructionOrder`, `Colony`, `EmpireGalaxy`.
- Cost helpers: `popGrowthCost` (industry per 10 years), `popSpawnCost`,
  `popSpawnCount` (binary doubling helper).
- Build/demolish pipeline helpers: `applyBuildTo`, `applyConstruction`,
  `isDemolishTarget`, `findLastBuild`.
- Validity predicates: `isValidColony`, `isValidEmpire`.
- 7 property tests in the spec layer; all pass.

**Spec mirror:** TS mirror in `src/sim/empire.ts` + tests in
`src/sim/empire.test.ts` — to be written next iteration.

**Decisions logged:**
- The resource pool is a **4-tuple**, not a map from `ResourceType`
  to int. Tuples are easier to fold over, cheaper to equality-
  compare, and the closed set of resources won't grow. If we add
  a 5th resource later, this is the kind of thing to refactor
  while it's still cheap.
- `popSpawnCost` and `popSpawnCount` use the formula
  `10 * 2^overBy` where `overBy` is the number of pop units
  added beyond the colony's maxPopulation. Implemented with a
  `pow2` helper because Quint's built-in `pow` operates on
  `int` and `2` must be promoted carefully (use a `mul` helper
  instead of `*` inside the recursion).
- Demolish **removes** the pop unit from the colony's population,
  not just resets its center to "none". This keeps the population
  count honest and avoids zombies. (Confirmed by the bug fix
  in this iteration: the initial implementation seeded demTarget
  with `Set(orders[0].popUnitId)` which wrongly included a build
  order and silently dropped a healthy pop. The seed-with-first
  pattern is correct ONLY when you genuinely want every element
  to be in the resulting set.)

### Iter 2b — New Game setup dialog

**Scope:**
- New UI module: `src/ui/newGameDialog.ts`. Self-contained
  modal-ish dialog that opens on "New Game" from the main menu.
- Galaxy size: 4 radio-button cards in a 2×2 grid
  (Small/Medium/Large/Huge) with star-count hints.
- Seed: number input + Random button. Defaults: Large, seed 42.
- Actions: Cancel + Start (primary). Escape and backdrop click
  both dismiss without starting. Validation on Start for non-
  integer seed → inline error message.
- After Start: routes to the game view, mirrors (size, seed)
  into the existing in-game controls so they stay in sync,
  and runs the same generation path as before.
- Wiring: `startNewGame()` in `main.ts` now opens the dialog
  instead of jumping straight to the game view with hardcoded
  defaults. The existing in-game controls remain a useful
  "regenerate with current settings" affordance.

**Decisions logged:**
- **Dialog is mounted lazily on `open()`** and torn down on
  `close()`, not retained in the DOM between opens. Each open
  gets fresh defaults and clean state (no stale error messages,
  no leftover focus).
- **Galaxy size uses radios, not a `<select>`**. The 2×2 card
  grid makes the four options visible at a glance and shows
  the star-count hint alongside each one. Same visual
  language as the menu's button cards.
- **Radio buttons are hidden, label is the visible target**
  (`display:none` on input, styling on label). This gives us
  full control of the visual state (`:has(input:checked)`)
  without browser-default radio styling.
- **No state survives between opens**. If the user picks Huge
  with seed=99, then cancels, then re-opens — they see Large
  with seed 42 again. This is intentional for now (the
  dialog is a "fresh start" affordance; remembering last
  choice can come when there's actual gameplay state to
  preserve).
- **Generated HTML dialog is created with `document.createElement`**
  (not innerHTML) and uses `textContent` for user-visible
  strings. Safer than string interpolation; no XSS risk from
  the seed field, even though we already `Number.parseInt` it.
- **CSS injected once** via a tagged `<style>` element with
  `id="new-game-dialog-styles"`. Idempotent guard prevents
  duplicate injection on HMR.
- **Backdrop click + Escape close the dialog** without
  starting a game. Standard modal UX. The Escape listener is
  scoped to the dialog's lifetime so it doesn't leak between
  opens.

**Debugging breadcrumbs for the future:**
- `vite preview` listens on `localhost` by default, NOT on
  `127.0.0.1`. If a curl from `127.0.0.1` fails with
  `connection refused`, try `localhost` — or pass `--host`
  to bind to all interfaces.
- `:has()` selector works in modern browsers (Chromium, Safari,
  Firefox 121+) for the "checked radio highlights its label"
  pattern. No JS toggle needed.
- The dialog mounts into `#new-game-dialog-host` (a sibling of
  the menu card) inside the menu view. Both are hidden when
  the game view is active, so the dialog effectively unmounts
  with the menu — but the JS object lives for the page
  lifetime, which is what we want for re-opening.



### Iter 2c — Resource bar tooltips + Next Turn tooltip

**Scope:**
- Resource badge `title` simplified to `{value} {displayName} Points`
  (icon name removed so the tooltip is purely numerical).
- Next Turn button now has a dynamic tooltip:
  `End turn N → start turn N+1` — updated each turn by the host
  via `setNextTurnTooltip`.
- New `setNextTurnTooltip(text: string)` method on the returned
  `ResourceBar` so the host owns the wording.

**Decisions logged:**
- **Native `title` attribute, not a custom tooltip library**.
  Each badge already uses the browser-native title; we just
  changed the string. Avoids ~20 kB for Floating UI / Popper
  just to show five identical strings.
- **Arrow character choice**: U+2192 (RIGHTWARDS ARROW, the
  standard one in tech specs) over `->` (which reads as "from/by")
  and over → lookalikes. Renders consistently across
  macOS / Win / Linux.
- **Compute the next-turn number in the host**, not in the bar.
  The bar doesn't know the current turn — the host passes a
  string in. Keeps `mountResourceBar` ignorant of the game
  state shape (good separation).
- **Tooltip stays on during the click**: native title has a
  small visible delay; suppression would be more code than
  it's worth.


### Iter 2d — Move Next Turn button to bottom-right of starmap

**Scope:**
- Next Turn button is no longer part of the resource bar.
  It now lives in its own absolutely-positioned host
  `#next-turn-btn-host` inside the starmap, bottom-right,
  5px in from the corner — mirroring the zoom controls
  which sit bottom-left 5px in.
- `mountResourceBar(host, nextTurnButtonHost?)` signature:
  if the second arg is supplied, the button is mounted there.
  If not, behaviour reverts to "in the bar, with a flex
  spacer to push it right" — backward compatible.
- The `.rb-next-turn-btn` class moved with the button, so it
  travels to whatever host it's mounted in.

**Decisions logged:**
- **Why bottom-right**: all four corners of the starmap now
  consistent — resources top-left, side panel top-right,
  zoom bottom-left, next turn bottom-right. No more
  "header strip" pattern.
- **Why mirror the zoom 5px inset exactly**: visual symmetry.
  If Next Turn was at 8px and zoom at 5px the corner layout
  would feel uneven.
- **`.rb-bar` panel chrome (background, border-bottom, padding)
  kept** in this iteration — at this point the bar still looks
  like a strip. Two iterations later (iter 2g) the strip is
  gone and the chrome is neutralised, but the chrome code is
  left in place so `mountResourceBar` still works headless.
- **No spacer when button is detached**: the spacer only renders
  when the button is mounted inside the bar (see `injectStyles`
  and the `setNextTurnButtonHost` branch in the mount function).


### Iter 2e — Tooltip strings finalised

**Scope:**
- Removed the icon-name prefix from the resource badge
  tooltip. Now: "0 Agriculture Points" rather than
  "agriculture 0 Agriculture Points". The icon is right
  there visually; the suffix is redundant.
- Confirmed the Next Turn tooltip wording:
  `End turn N → start turn N+1` — explicit about what
  "Next Turn" means (start the next turn).

**Decisions logged:**
- **Why "End turn N → start turn N+1" rather than just
  "N → N+1"**: the dynamic version reads as game action
  ("End turn N"). The plain version reads as arithmetic.
  Players ask "what does Next Turn do?" — the explicit
  version answers that in 4 words.
- **Same arrow character (U+2192)** as iter 2c — one symbol
  across the whole HUD for direction.


### Iter 2f — Resource bar refresh refactor

**Scope:**
- `setPool(value, descriptor)` combined the previous two-call
  `setCount(value); setDescriptor(d)` into one. The host now
  passes the descriptor it already has (it's a stable shape),
  the bar updates the count text and the badge `title` together.
- Removed the stale `refreshResourceBar` call below
  `newPlayer()` in `src/main.ts` — it was a leftover from
  a debugging session before `setPool` existed.

**Decisions logged:**
- **One `setPool` call, not fluent chain**:
  `bar.setPool(value, descriptor)` rather than
  `bar.setDescriptor(d).setCount(value)`. Single method =
  single tooltip update, no chance of the two calls getting
  out of sync.
- **Descriptor is passed in, not stored** by the bar itself:
  the bar doesn't own resource definitions, the host does.
  The bar just uses what it's given for that call.
- **Stale-code bug pre-empted**: the unused `refreshResourceBar`
  was found in `main.ts` below `newPlayer()`. Removed to avoid
  the dead-code trap where someone later "fixes" the bug by
  restoring it.


### Iter 2g — Resource badges moved into the starmap

**Scope:**
- Removed the entire top header strip that wrapped the
  resource bar (`<div id="resource-bar-host">` that previously
  sat between `<section id="game-view">` and `<main>`).
- Re-homed `#resource-bar-host` *inside* `#starmap-host`,
  as the third positioned child (after canvas and side panel,
  before zoom and next-turn hosts). The host now has
  `position: absolute; top: 5px; left: 5px; z-index: 1`,
  mirroring the other corner containers.
- Neutralised the bar's dark panel chrome with a scoped
  override so the badges float over the starfield without
  a unifying header:
  ```css
  .resource-bar-host .rb-bar {
    background: transparent;
    border-bottom: none;
    padding: 0;
    gap: 6px;
  }
  ```
- The badges themselves keep their own `panel-2` background
  + accent border, so each one stays legible against the
  starfield on its own (no shared "container" behind them).

**Decisions logged:**
- **Why an override instead of editing `.rb-bar` directly**:
  the resource bar module owns its inner styles (`.rb-bar`
  is created in JS by `injectStyles()`). Editing those would
  change the look for any other consumer of `mountResourceBar`,
  even though today there is only one. The override is scoped
  to the new host and is the minimum surface area for this UI change.
- **Re-used the existing id, didn't introduce a new one**.
  `main.ts` already references
  `document.getElementById('resource-bar-host')`. Moving the
  element rather than introducing `#starmap-resource-bar-host`
  keeps the JS surface identical.
- **`top: 5px; left: 5px`** to match the existing corner-button
  convention (zoom, next-turn both use 5px padding). The four
  corners are now visually symmetric: zoom bottom-left,
  resources top-left, next-turn bottom-right, side-panel top-right.
- **`gap: 6px`** (down from the bar's 10px default) to make the
  row feel more compact when it's just floating — 10px gaps
  looked too sparse at the new smaller size.
- **DOM order matters for stacking**: placed
  `#resource-bar-host` *after* `#sidepanel-host` so it sits on
  top of any selection panel that might be drawn there. (Same
  stacking discipline as the zoom / next-turn containers.)


### Iter 2h — Swap Agriculture & Industry icons

**Scope:**
- Replaced the Agriculture icon (was `building-storefront`, a
  shop with awning) with a `grain` icon — three wheat-style
  stalks, each a central stem with grain leaves alternating up
  its length and a small V-shaped head at the top.
- Replaced the Industry icon (was `building-office`, a tall
  block with a 3×4 window grid) with a `factory` icon —
  sawtooth roof with three peaks, a tall smokestack on the left
  with a small window, a shorter block on the right with a
  flag-like stub, a door in the middle, and two small windows
  in the body.
- Updated the file header doc comment so the resource list
  matches the new icons.
- The three remaining resources (Research/beaker, Culture/library,
  Military/paper-plane) are unchanged.

**Decisions logged:**
- **No icon library**. The bar continues to draw SVG paths
  inline, just like the other three icons. Bringing in
  lucide / heroicons / feather would be ~100 kB for two icons
  that take a handful of `<path d="...">` elements each. The
  current approach is consistent with the rest of the file
  and stays dependency-free.
- **Why path-by-path hand-rolled**: the existing `buildIcon`
  helper takes `iconPath: string[]` and applies the same stroke
  / linecap / linejoin settings to every path. Sticking to that
  contract means no helper changes — just rewrite the array
  for the two affected resources.
- **`iconName` strings updated to match**: `'grain'` and `'factory'`.
  These strings aren't user-visible (we removed them from the
  tooltip in iter 2e) but they're kept for accessibility /
  future spec-name use.


### Iter 2i — Single-stalk grain icon

**Scope:**
- Reduced the Agriculture icon from three grain stalks (27 paths)
  to a single centred wheat stalk (11 paths). The stalk is
  vertically centred at `x=12`, runs from `y=21` (bottom) to
  `y=7` (top), with a small V-shaped head (`y=7` →
  `(9.5, 5.5)` and `(14.5, 5.5)`) and 4 pairs of grain leaves
  alternating at `y=9, 12, 15, 18`.
- Industry icon unchanged.
- `iconName` still `'grain'` — one wheat stalk is still grain.

**Decisions logged:**
- **Why single-stalk**: the three-stalk icon read as "weeds" or
  "leaves" at the small 18px badge size because the three stems
  visually merged into a horizontal mass. A single centred stalk
  uses the full vertical extent of the 24×24 viewBox and is
  unambiguous as wheat/grain at any scale.
- **Centred at x=12** so the icon occupies the same visual
  centre as the other single-subject icons (beaker, paper-plane,
  library pediment).
- **Path reduction (27 → 11)** is a 60% drop in stroke work
  for the renderer — negligible for one icon but a nice
  side-effect if we ever animate or tint the icon path-by-path.
- **Why not move the stem off-centre to suggest leaning**:
  wheat-head icons in real-world glyph sets (lucide, heroicons,
  feather) almost always have the stem dead-centre. A leaning
  stem would look like a wilted plant. Kept the stem straight.


### Iter 2j — Single-word sci-fi star names

**Scope:**
- Replaced the two-word `<Prefix> <Suffix>` scheme (e.g. "Vega Prime",
  "Bellatrix Alpha") with a single-word scheme (e.g. "Vulcan",
  "Phyco", "Klystron", "Proxima", "Sirius").
- `src/sim/names.ts` now exports a single `STAR_NAMES: ReadonlyArray<string>`
  of 600 curated sci-fi words. The two old exports `STAR_NAME_PREFIXES`
  and `STAR_NAME_SUFFIXES` are gone.
- `nameStars` simplified: shuffle the pool, walk each star at a random
  offset into the shuffle. The disambiguator fallback (now appending
  `"<n>"` to a name rather than `" <n>"`) is unreachable for any
  in-game galaxy size (Huge = 72 stars, pool = 600) but kept as a
  safety net.
- `shuffleInPlace` helper deleted (only `shuffleStable` is used now).
- `quint/galaxy.qnt` placeholder table renamed: `STAR_NAME_PREFIXES`
  + `STAR_NAME_SUFFIXES` collapsed into a single `STAR_NAMES` Set,
  with a representative sample of names for the spec.
- Test regex updated from `^[A-Z][a-zA-Z]+ [A-Z][a-zA-Z]+$` to
  `^[A-Z][a-zA-Z]+$` to match the new single-word format.
- "Varied prefixes" distribution test rewritten as "Varied names"
  to assert uniqueness (set size > 40 in a 48-star galaxy) rather
  than prefix diversity.

**Decisions logged:**
- **600 names, not 400.** With Huge = 72 stars, the pool only needs
  to be larger than 72. But 400 leaves no headroom for the
  unexpected — e.g. a future "Inhabited Star Names" feature that
  picks a name and then formats `(<faction>)` against it — and
  the per-name overhead is tiny (10 kB total in the bundle). 600
  is comfortable without being wasteful.
- **One flat array, not many small categorical arrays.** The old
  scheme split words into prefix/suffix; the new scheme is one
  bag of words. Categorising them (e.g. real-stars vs invented)
  would be a maintenance burden with no observable benefit: the
  shuffle already gives uniform distribution across the pool.
- **Pool character-distribution skewed to 5-6 chars.** Of 600
  names: 17 are 4-char, 198 are 5-char, 308 are 6-char, 38 are
  7-char, 32 are 8-char, 5 are 9-char, 2 are 10-char. Short
  names read clearly at every UI size (star labels at 14px,
  sidepanel star name at 18px) without crowding neighbouring
  stars at the 14px size.
- **Quint placeholder is a 23-name subset, not all 600.** The
  quint spec exists to *name the scheme*, not to enumerate
  every word. Carrying 600 strings into the spec would inflate
  it 25x for no semantic gain. The subset contains your seven
  example words (Vulcan, Alderan, Phyco, Klystron, Sirius,
  Proxima, plus an extended selection of recognisable names)
  so any human reading the spec gets the flavour immediately.
- **"Alderan" not "Aldebaran".** You used *Alderan* (Star Wars).
  I kept *both* in the TS pool — the SW name and the real
  star — and the spec lists *Alderan* alongside. Aldebaran is
  there for astronomical flavour; Alderan is there because
  you wrote it.
- **Fallback format `<name><n>` not `<name> <n>`**. The fallback
  would break the single-word rule if it fired. Concatenated
  form (`"Vulcan2"`) keeps it single-token and unparseable as
  multiple words; the fallback fires at the 600+ star mark which
  is unreachable for in-game galaxies.
- **Distribution test relaxed.** Old test checked that >10 of 60
  prefixes appeared (it was a 5x headroom sanity check on a
  600-name product grid). New test checks that >40 of 48 names
  are distinct (essentially "no duplicates in a 48-star galaxy").
  Direct check on the property we actually care about.

### Iter 2k — Selection ring didn't follow camera changes

**Symptom.** After zooming or panning, the selection ring stayed at
the on-screen position it had when the star was first selected —
i.e. it stopped tracking the star. The ring's *position* was being
computed correctly from `projectStar(star, currentCamera, …)`, but
it wasn't being recomputed after the camera changed.

**Root cause.** The renderer's `repaint()` had two dirty-flag
blocks:

```ts
if (paintDirty || galaxyDirty) {
  paintDisc();
  paintStars();
  paintDirty = false;       // <-- cleared mid-call
  galaxyDirty = false;
}
if (ringDirty || paintDirty) {  // <-- paintDirty already false
  paintSelectionRing();
  ringDirty = false;
}
```

`setCamera(camera)` sets `paintDirty = true`. The first block
runs `paintStars` and `paintDisc`, then clears `paintDirty`. The
second block then sees `ringDirty || paintDirty` as `false || false`
and skips the ring. The same happens on every frame of the zoom
tween.

`setSelection()` worked because it set `ringDirty = true` directly,
not via `paintDirty` — so the bug only showed up when you changed
the camera after selecting.

**Fix.**
- Sample dirty flags once at the top of `repaint()`, run both paint
  blocks if needed, then clear flags. The renderer's "camera
  changed" signal is now correctly visible to both paint blocks.
- Extracted the ring's projection logic into a pure helper
  `selectionRingCentre(selectedId, galaxy, camera, viewport)`
  (exported from `src/ui/starmap.ts`). `paintSelectionRing` now
  calls the helper. This is a no-behaviour-change refactor on its
  own, but it makes the projection testable without spinning up
  PixiJS.

**Tests.**
- New file `src/ui/starmap.test.ts` — 8 unit tests for
  `selectionRingCentre`:
  - returns null when no selection
  - returns null when the selected id is not in the galaxy
  - returns a projected point for a valid selection
  - **moves when the camera zooms** (regression test)
  - **moves when the camera pans** (regression test)
  - agrees with `projectStar` for the same (camera, star) input
  - returns a point for every (camera, star) pair (property test)
  - keeps every star inside the viewport at minimum zoom

The renderer-level dirty-flag ordering (the structural fix) is
covered by a code comment at the `repaint()` site — PixiJS renderer
tests would require jsdom + WebGL, which isn't part of the existing
test setup (all current tests run in `environment: 'node'`).

**Decisions logged.**
- **One helper, not two.** The "find selected star" and "project it
  to screen" steps are now combined in `selectionRingCentre`. The
  alternative was to keep them separate and let the renderer wire
  them together — but the renderer only ever uses them in that
  combination, so combining them eliminates a needless abstraction
  layer. The pure helper is exported (so it's testable) and its
  contract is: "give me the on-screen centre of the currently
  selected star, or null if there isn't one".
- **Three dirty flags, not two.** Considered collapsing
  `galaxyDirty` and `paintDirty` into a single `layoutDirty`. Kept
  them separate because they have different cost: a galaxy change
  rebuilds the per-star cache (O(N) allocs), while a camera change
  just reprojects existing containers (O(N) scalar updates). The
  separate flags preserve the original "only rebuild cache when the
  star set actually changed" optimisation.
- **Did not scale the ring radius with zoom** — that's a separate
  cosmetic follow-up. The reported bug was position-only. Leaving
  the radius at `HIT_RADIUS_PX + 4 = 16 px` keeps the ring a
  consistent UI affordance regardless of zoom level (which is
  arguably better UX than a ring that grows/shrinks).