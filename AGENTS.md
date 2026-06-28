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

## Environment notes — PixiJS in headless / no-GPU sandboxes

- The dev sandbox browser **does not expose WebGL/WebGL2** —
  `canvas.getContext('webgl2')` returns null. This is silent and easy to
  miss. PixiJS's `autoDetectRenderer` then falls back to **CanvasRenderer**
  (renderer type 4), which **has no GPU filter / shader pipeline** — so
  any `Filter` attached to a DisplayObject simply does nothing visually.
- When debugging "filter has no visible effect", first verify the active
  renderer type via `app.renderer.type` — must be `1` (WEBGL) or `2`
  (WEBGPU) for filters to run.
- The menu background in this codebase has **two render paths** selected
  by `webglAvailable()` at mount time:
    - WebGL → `mountShaderVortex()` (PixiJS GlProgram + Filter)
    - no WebGL → `mountCssVortex()` (CSS conic + radial gradients)
  This keeps the menu visible in any environment while preserving the
  shader code for real-browser use.
- Future PixiJS work: always sanity-check `app.renderer.type` after init.
  If it's 4 (CANVAS), GPU features won't run and you'll spend hours
  debugging filters that silently no-op.

