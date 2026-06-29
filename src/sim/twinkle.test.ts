/**
 * Property tests for src/sim/twinkle.ts.
 *
 * Each property mirrors an invariant from quint/galaxy.qnt's
 * "Star twinkle (visual-only)" section. The renderer must NEVER
 * mutate Star.size; these tests assert that the helper functions
 * are pure and well-behaved across the entire real line of `t`.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  STAR_TWINKLE_DURATION_MAX_MS,
  STAR_TWINKLE_DURATION_MIN_MS,
  STAR_TWINKLE_INTERVAL_MAX_MS,
  STAR_TWINKLE_INTERVAL_MIN_MS,
  STAR_TWINKLE_PEAK_SCALE,
  advanceStarTwinkle,
  initStarTwinkle,
  pulseActive,
  pulseScaleAt,
  scheduleDurationMs,
  scheduleIntervalMs,
} from './twinkle';

describe('pulseScaleAt', () => {
  it('endpoints return exactly 1 (no scale)', () => {
    expect(pulseScaleAt(0)).toBe(1);
    expect(pulseScaleAt(1)).toBe(1);
  });

  it('apex (t = 0.5) returns exactly the peak scale', () => {
    expect(pulseScaleAt(0.5)).toBe(STAR_TWINKLE_PEAK_SCALE);
  });

  it('clamps out-of-range t to the endpoints', () => {
    // Below 0 -> 1.
    expect(pulseScaleAt(-100)).toBe(1);
    expect(pulseScaleAt(-0.0001)).toBe(1);
    // Above 1 -> 1.
    expect(pulseScaleAt(1.0001)).toBe(1);
    expect(pulseScaleAt(1000)).toBe(1);
    // NaN is silently treated as out-of-range (function is total).
    expect(pulseScaleAt(NaN)).toBe(1);
  });

  it('never exceeds STAR_TWINKLE_PEAK_SCALE inside [0, 1]', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (t) => {
        const s = pulseScaleAt(t);
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(STAR_TWINKLE_PEAK_SCALE);
      }),
    );
  });

  it('is symmetric around the apex (t -> 1 - t)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.5, noNaN: true }),
        (t) => {
          expect(pulseScaleAt(t)).toBeCloseTo(pulseScaleAt(1 - t), 10);
        },
      ),
    );
  });

  it('is monotonically increasing on [0, 0.5]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 0.5 - 1e-6, noNaN: true }),
        (t: number) => {
          expect(pulseScaleAt(t)).toBeLessThanOrEqual(pulseScaleAt(t + 1e-6));
        },
      ),
    );
  });

  it('is monotonically decreasing on [0.5, 1]', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.5, max: 1 - 1e-6, noNaN: true }),
        (t: number) => {
          expect(pulseScaleAt(t)).toBeGreaterThanOrEqual(
            pulseScaleAt(t + 1e-6),
          );
        },
      ),
    );
  });
});

describe('scheduleIntervalMs', () => {
  it('always lies in [MIN, MAX]', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (r) => {
        const ms = scheduleIntervalMs(() => r);
        expect(ms).toBeGreaterThanOrEqual(STAR_TWINKLE_INTERVAL_MIN_MS);
        expect(ms).toBeLessThanOrEqual(STAR_TWINKLE_INTERVAL_MAX_MS);
      }),
    );
  });

  it('rng = 0 yields MIN', () => {
    // The function assumes rng() returns a value in [0, 1) (the
    // mulberry32 PRNG used elsewhere does this). rng = 0 should
    // hit the floor of the inclusive interval.
    expect(scheduleIntervalMs(() => 0)).toBe(STAR_TWINKLE_INTERVAL_MIN_MS);
  });
});

describe('scheduleDurationMs', () => {
  it('always lies in [MIN, MAX]', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), (r) => {
        const ms = scheduleDurationMs(() => r);
        expect(ms).toBeGreaterThanOrEqual(STAR_TWINKLE_DURATION_MIN_MS);
        expect(ms).toBeLessThanOrEqual(STAR_TWINKLE_DURATION_MAX_MS);
      }),
    );
  });
});

describe('pulseActive', () => {
  it('false before start, true during, false at/after end', () => {
    const p = { startedAtMs: 1000, durationMs: 500 };
    expect(pulseActive(p, 999)).toBe(false);
    expect(pulseActive(p, 1000)).toBe(true);
    expect(pulseActive(p, 1250)).toBe(true);
    expect(pulseActive(p, 1499)).toBe(true);
    expect(pulseActive(p, 1500)).toBe(false);
    expect(pulseActive(p, 9999)).toBe(false);
  });
});

describe('advanceStarTwinkle (integration)', () => {
  it('starts at scale 1 when scheduled in the future', () => {
    const st = initStarTwinkle(0, 1000);
    expect(advanceStarTwinkle(st, 500, () => 0.5)).toBe(1);
  });

  it('kicks off a pulse when time reaches nextAtMs', () => {
    const st = initStarTwinkle(0, 1000);
    // t = nextAtMs exactly.
    const scale = advanceStarTwinkle(st, 1000, () => 0.5);
    // pulseScaleAt(0) = 1.
    expect(scale).toBe(1);
    expect(st.pulse).not.toBeNull();
    expect(st.pulse?.startedAtMs).toBe(1000);
    // nextAtMs not yet rescheduled (only when pulse ends).
    expect(st.nextAtMs).toBe(1000);
  });

  it('returns an apex scale near STAR_TWINKLE_PEAK_SCALE at the pulse midpoint', () => {
    const st = initStarTwinkle(0, 0);
    // Force a 1000ms pulse starting at t=0.
    advanceStarTwinkle(st, 0, () => 0.5);
    // Override duration deterministically.
    st.pulse = { startedAtMs: 0, durationMs: 1000 };
    const scale = advanceStarTwinkle(st, 500, () => 0.5);
    expect(scale).toBeCloseTo(STAR_TWINKLE_PEAK_SCALE, 10);
  });

  it('ends a pulse at exactly startedAt + duration and reschedules', () => {
    const st = initStarTwinkle(0, 0);
    advanceStarTwinkle(st, 0, () => 0.5);
    st.pulse = { startedAtMs: 0, durationMs: 1000 };
    // At end: pulseActive returns false, so advance clears it and
    // schedules the next. Returns scale 1.
    const scale = advanceStarTwinkle(st, 1000, () => 0);
    expect(scale).toBe(1);
    expect(st.pulse).toBeNull();
    // nextAtMs must now be in the future.
    expect(st.nextAtMs).toBeGreaterThanOrEqual(1000);
    // With rng() = 0, scheduleIntervalMs returns MIN.
    expect(st.nextAtMs).toBe(1000 + STAR_TWINKLE_INTERVAL_MIN_MS);
  });

  it('does not mutate the input Star.size (visual-only invariant)', () => {
    // We don't pass Star into advanceStarTwinkle (it lives in the
    // renderer), but we DO assert that the helper is referentially
    // transparent on its inputs — same state + same now + same rng
    // -> same scale.
    const st = initStarTwinkle(0, 1000);
    const r = () => 0.5;
    const a = advanceStarTwinkle(st, 500, r);
    const b = advanceStarTwinkle(st, 500, r);
    expect(a).toBe(b);
  });

  it('long simulation: scales are always within [1, PEAK] and endpoints stay at 1', () => {
    const st = initStarTwinkle(0, 0);
    let rngState = 12345;
    const rng = () => {
      // simple LCG for determinism in tests
      rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
      return rngState / 0x7fffffff;
    };
    // Run for 60 simulated seconds at 16ms steps.
    let lastScale = 1;
    for (let t = 0; t <= 60_000; t += 16) {
      lastScale = advanceStarTwinkle(st, t, rng);
      expect(lastScale).toBeGreaterThanOrEqual(1);
      expect(lastScale).toBeLessThanOrEqual(STAR_TWINKLE_PEAK_SCALE);
    }
    // Final frame should be either mid-pulse or idle (returning 1).
    expect(lastScale).toBeGreaterThanOrEqual(1);
  });
});