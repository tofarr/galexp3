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

