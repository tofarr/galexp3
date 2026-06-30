/**
 * Star twinkle — visual-only pulse animation.
 *
 * The simulation model (Star.size) is never touched. Twinkle is a
 * pure renderer-side effect: each star periodically scales its
 * drawn layers up and back down by `STAR_TWINKLE_PEAK_SCALE`
 * (default 1.10, i.e., 10% bigger at the apex).
 *
 * This module is intentionally Pixi-free so it can be unit-tested
 * with no DOM or GPU dependency. The renderer (src/ui/starmap.ts)
 * wires the constants below into the actual Graphics pipeline.
 *
 * Spec mirror: quint/galaxy.qnt (STAR_TWINKLE_* constants and
 * pulseScaleAtPct). Keep these in sync with the spec.
 */

/** Peak scale at the apex of a pulse. 1.10 = +10%. */
export const STAR_TWINKLE_PEAK_SCALE = 1.2;

/** Smallest interval between two pulses on the same star, in ms.
 *  With MAX = 6000 the average gap is ~3.75 s — about 1/10 of the
 *  pre-tuning rate (when this was 150/600 ms) so the galaxy feels
 *  alive without being distracting. */
export const STAR_TWINKLE_INTERVAL_MIN_MS = 1500;

/** Largest interval between two pulses on the same star, in ms. */
export const STAR_TWINKLE_INTERVAL_MAX_MS = 6000;

/** Shortest single-pulse duration, in ms. */
export const STAR_TWINKLE_DURATION_MIN_MS = 500;

/** Longest single-pulse duration, in ms. */
export const STAR_TWINKLE_DURATION_MAX_MS = 5000;

/**
 * Multiplicative scale for a star whose pulse has progressed a
 * fraction `t` ∈ [0, 1]. Smooth triangle: 1.0 at both endpoints,
 * `STAR_TWINKLE_PEAK_SCALE` at the apex (t = 0.5). Out-of-range
 * `t` is clamped.
 *
 * `t` is permitted to be a `number` so callers can use the real
 * elapsed time; the function clamps first, so it is total over
 * the entire real line.
 */
export function pulseScaleAt(t: number): number {
  if (!(t > 0)) return 1;
  if (!(t < 1)) return 1;
  // |2t - 1| ∈ [0, 1] peaks at the endpoints of [0, 1] and equals
  // 0 at t = 0.5. Subtracting from 1 flips it into a triangle
  // that is 1 at the endpoints and 0 at the apex. Multiply by the
  // amplitude (peak - 1) to lift it into [0, peak - 1]. Add 1 to
  // shift into [1, peak].
  const triangle = 1 - Math.abs(2 * t - 1);
  return 1 + (STAR_TWINKLE_PEAK_SCALE - 1) * triangle;
}

/**
 * A scheduled pulse for one star. `startedAtMs` is the wall-clock
 * time (typically `performance.now()`) the pulse began; the pulse
 * is "live" while `now < startedAtMs + durationMs` and the scale
 * is given by `pulseScaleAt((now - startedAtMs) / durationMs)`.
 */
export interface Pulse {
  readonly startedAtMs: number;
  readonly durationMs: number;
}

/**
 * True iff `now` lies strictly inside the pulse window
 * `[startedAtMs, startedAtMs + durationMs]`.
 */
export function pulseActive(pulse: Pulse, now: number): boolean {
  return now >= pulse.startedAtMs && now < pulse.startedAtMs + pulse.durationMs;
}

/**
 * Pick a random interval between two consecutive pulses for one
 * star. Uniform in [MIN, MAX].
 */
export function scheduleIntervalMs(rng: () => number): number {
  const min = STAR_TWINKLE_INTERVAL_MIN_MS;
  const max = STAR_TWINKLE_INTERVAL_MAX_MS;
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Pick a random single-pulse duration. Uniform in [MIN, MAX].
 */
export function scheduleDurationMs(rng: () => number): number {
  const min = STAR_TWINKLE_DURATION_MIN_MS;
  const max = STAR_TWINKLE_DURATION_MAX_MS;
  return min + Math.floor(rng() * (max - min + 1));
}

/**
 * Per-star twinkle bookkeeping. Lives entirely in the renderer;
 * never written to a save file or shared with the simulation.
 */
export interface StarTwinkleState {
  /** Wall-clock time at which the next pulse should begin. */
  nextAtMs: number;
  /** Active pulse, or null if idle. */
  pulse: Pulse | null;
}

/**
 * Build a fresh twinkle state for a star, scheduling its first
 * pulse to start `intervalMs` from `now`.
 */
export function initStarTwinkle(now: number, intervalMs: number): StarTwinkleState {
  return { nextAtMs: now + intervalMs, pulse: null };
}

/**
 * Advance one star's twinkle state to time `now`. If `now` is at
 * or past the scheduled start, a new pulse begins (with a fresh
 * random duration) and `nextAtMs` is pushed forward by a fresh
 * random interval. Returns the *scale* that should be applied to
 * the star at this frame, or 1.0 if the star is idle.
 *
 * `rng` is the source of randomness for the new pulse's duration
 * and the rescheduled nextAt. Caller is expected to provide a
 * stable PRNG so tests are reproducible.
 */
export function advanceStarTwinkle(
  state: StarTwinkleState,
  now: number,
  rng: () => number,
): number {
  // Case 1: a pulse is already running.
  if (state.pulse) {
    if (pulseActive(state.pulse, now)) {
      const t = (now - state.pulse.startedAtMs) / state.pulse.durationMs;
      return pulseScaleAt(t);
    }
    // Pulse just ended — clear it and schedule the next one.
    state.pulse = null;
    state.nextAtMs = now + scheduleIntervalMs(rng);
    return 1;
  }
  // Case 2: idle, waiting for nextAt.
  if (now >= state.nextAtMs) {
    state.pulse = {
      startedAtMs: now,
      durationMs: scheduleDurationMs(rng),
    };
    // Don't reschedule yet — we'll do that when this pulse ends.
    return pulseScaleAt(0);
  }
  return 1;
}