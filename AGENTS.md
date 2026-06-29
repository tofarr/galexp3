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

