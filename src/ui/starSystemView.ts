/**
 * Star-system background view — Iter 3a.
 *
 * Renders a small animated SVG of a star system: the star in its
 * own colour at the centre, surrounded by up to 8 concentric
 * orbital rings. Each ring is either empty (faint line) or has a
 * planet/gas-giant/asteroid-belt/dust-cloud on it. The orbits
 * rotate slowly so the panel reads as "alive" rather than static.
 *
 * Used as the BACKGROUND of the planet panel (sidepanel.ts) at
 * 20% opacity, so this module is presentation-only: it never
 * receives user input and never mutates game state.
 *
 * The SVG is created with `viewBox` centred at the origin so the
 * math is symmetric: each ring is a `<circle>` of radius
 * `RING_RADII[i]`, and each planet is a `<circle cx="R r" cy="0">`
 * inside a `<g>` that rotates around the origin via SMIL
 * (`<animateTransform>`). SMIL is the most-portable animation
 * primitive in browsers and avoids depending on CSS keyframe
 * animation in a way that the spec can model.
 */

import {
  NUM_PLANET_SLOTS,
  slotColor,
  slotSize,
  slotVisualRadius,
  type StarSystem,
  type PlanetSlotContents,
} from '@sim/starSystem';
import {
  STAR_BLOOM_ALPHA,
  STAR_CORE_ALPHA,
  STAR_HALO_ALPHA,
  STAR_HALO_COLOR_FOR_COLOR,
  STAR_COLOR_FOR_COLOR,
  starBodyPx,
  starBloomPx,
  starHaloPx,
  type Star,
  type StarColor,
} from '@sim/galaxy';

const NS_SVG = 'http://www.w3.org/2000/svg';

// ---------------------------------------------------------------------------
// SVG helpers
// ---------------------------------------------------------------------------

/** Append a `<stop>` to a `<radialGradient>` with the given offset, colour, and opacity. */
function addStop(
  gradient: SVGGradientElement,
  offset: string,
  color: string,
  opacity: number,
): void {
  const stop = document.createElementNS(NS_SVG, 'stop');
  stop.setAttribute('offset', offset);
  stop.setAttribute('stop-color', color);
  stop.setAttribute('stop-opacity', String(opacity));
  gradient.appendChild(stop);
}

/** Build a centred `<circle>` at the origin with the given radius. */
function circle(cx: number, cy: number, r: number): SVGCircleElement {
  const c = document.createElementNS(NS_SVG, 'circle');
  c.setAttribute('cx', String(cx));
  c.setAttribute('cy', String(cy));
  c.setAttribute('r', String(r));
  return c;
}

/**
 * Unique ID for the dust-cloud Gaussian-blur filter. We use a
 * single shared filter for all dust clouds because the blur
 * strength is the same — no need for a per-cloud filter.
 */
const DUST_CLOUD_FILTER_ID = 'cc-dust-blur';

/**
 * Append the dust-cloud Gaussian-blur filter to the given
 * `<defs>` ONCE. Idempotent: returns the existing filter if
 * one was already added. The filter uses `feGaussianBlur`
 * with a single `stdDeviation` — the standard "feather the
 * edges" effect. We don't need `feColorMatrix` or any other
 * primitives; a single blur is enough to turn a stroked
 * orbit ring into a soft cloud band.
 */
function ensureDustCloudFilter(defs: SVGDefsElement): void {
  if (defs.querySelector(`#${DUST_CLOUD_FILTER_ID}`)) return;
  const filter = document.createElementNS(NS_SVG, 'filter');
  filter.setAttribute('id', DUST_CLOUD_FILTER_ID);
  // x/y/width/height define the filter region. We pad by
  // 50% on each side so the blur tail isn't clipped at the
  // shape boundary — `feGaussianBlur` extends the visible
  // region by ~3 * stdDeviation, so we need at least that
  // much padding.
  filter.setAttribute('x', '-50%');
  filter.setAttribute('y', '-50%');
  filter.setAttribute('width', '200%');
  filter.setAttribute('height', '200%');
  const blur = document.createElementNS(NS_SVG, 'feGaussianBlur');
  blur.setAttribute('stdDeviation', String(DUST_CLOUD_BLUR));
  filter.appendChild(blur);
  defs.appendChild(filter);
}

/**
 * Convert a galaxy colour from the `"0xRRGGBB"` format used by
 * the STAR_COLOR_FOR_COLOR / STAR_HALO_COLOR_FOR_COLOR tables into
 * the `#RRGGBB` format SVG attributes expect. Trivial replace —
 * kept as a one-liner helper so the call sites read clearly.
 */
function colorToHex(galaxyHex: string): string {
  return galaxyHex.replace(/^0x/i, '#');
}

/**
 * Parse a `#RRGGBB` colour into its `[r, g, b]` channels in 0..255.
 * Returns `[0, 0, 0]` for malformed input — the gradient stops that
 * consume this will just be black (the fall-back is invisible on
 * a dark panel background).
 */
function parseRgb(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return [0, 0, 0];
  return [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)];
}

/**
 * Mix a colour towards white by `amount` (0..1). `amount=0` returns
 * the colour unchanged; `amount=1` returns white. Used to derive
 * the "lit" highlight stop of the planet-sphere gradient.
 */
function lighten(hex: string, amount: number): string {
  const [r, g, b] = parseRgb(hex);
  const t = (v: number) => Math.round(v + (255 - v) * amount);
  return `rgb(${t(r)}, ${t(g)}, ${t(b)})`;
}

/**
 * Mix a colour towards black by `amount` (0..1). `amount=0` returns
 * the colour unchanged; `amount=1` returns black. Used to derive
 * the "night side" stop of the planet-sphere gradient.
 */
function darken(hex: string, amount: number): string {
  const [r, g, b] = parseRgb(hex);
  const t = (v: number) => Math.round(v * (1 - amount));
  return `rgb(${t(r)}, ${t(g)}, ${t(b)})`;
}

/**
 * Build a centred `<circle>` rendered as a 3D-looking sphere
 * via a `radialGradient` whose bright spot is offset to the
 * upper-left (simulating light from that direction). The
 * gradient fades from a lightened version of the colour
 * (highlight) through the base colour (mid-tone / day side)
 * to a darkened version (terminator / night side).
 *
 * The pattern is the standard "fake sphere" technique — no
 * per-planet SVG filters, no per-planet textures, just a
 * gradient with three stops. Works at any radius; the
 * gradient is defined in % of the bounding box so it
 * scales naturally.
 */
function sphereCircle(
  cx: number,
  cy: number,
  r: number,
  gradKey: string,
): SVGCircleElement {
  const c = circle(cx, cy, r);
  c.setAttribute('fill', `url(#sphere-${gradKey})`);
  return c;
}

/**
 * Append a sphere gradient to the given `<defs>`. Idempotent
 * per `gradKey` — the caller is responsible for unique keys
 * (we use the planet index + colour hash).
 */
function addSphereGradient(
  defs: SVGDefsElement,
  gradKey: string,
  baseColor: string,
): void {
  const grad = document.createElementNS(NS_SVG, 'radialGradient');
  grad.setAttribute('id', `sphere-${gradKey}`);
  // Offset the bright spot to the upper-left. (50% 50% is a flat
  // disc; we want a directional light.) 30% / 30% reads as
  // "sun in the upper left" without being too extreme.
  grad.setAttribute('cx', '32%');
  grad.setAttribute('cy', '30%');
  // Larger r pushes the dark side further out so the terminator
  // is more dramatic.
  grad.setAttribute('r', '75%');
  addStop(grad, '0%',   lighten(baseColor, 0.45), 1);
  addStop(grad, '45%',  baseColor,                  1);
  addStop(grad, '100%', darken(baseColor, 0.55),  1);
  defs.appendChild(grad);
}

// ---------------------------------------------------------------------------
// Layout constants
//
// All measurements in viewBox units (0..1 of the SVG). The SVG is
// scaled to fit the host element by the viewBox + preserveAspectRatio
// combo, so these are abstract units — the renderer doesn't care
// about pixel sizes.
// ---------------------------------------------------------------------------

/** Square viewBox, centred at origin. */
const VIEWBOX = 600;

/** Half-side of the viewBox (for symmetry, rings are computed as +x). */
const HALF = VIEWBOX / 2;

/** Base orbital period for the innermost ring, in seconds. */
const INNER_PERIOD_S = 14;

/** Outer rings are slower. Each step adds this many seconds. */
const PERIOD_STEP_S = 6;

/**
 * Star radius in viewBox units. The starmap uses absolute pixel
 * sizes (1..5 px body, 2..9 px bloom, 3..15 px halo) at 1.0× zoom.
 * The panel's viewBox is 600 units mapped to ~280 px on screen, so
 * the star would be too small to read. We multiply the starmap
 * sizes by this factor to give the panel star real visual weight.
 *
 * Iter 3a — re-rendered as a layered halo+bloom+core sprite that
 * matches the starmap's render (see _paintStarForTest in
 * src/ui/starmap.ts). The previous one-circle approach looked
 * bland against the orbit rings.
 */
const PANEL_STAR_SCALE = 9;

/**
 * Multiplier on the bloom layer specifically. The bloom is the
 * star's "soft body" — the layer that gives a star its presence
 * on screen. Bumping this from 1× to 4× makes the bloom dominate
 * the panel the way a star's light dominates a planet's sky:
 * a large, soft, colour-tinted disc that fades into the rings.
 *
 * Note that the bloom gradient's stops are scaled by this same
 * factor in `addStop` so the falloff shape stays correct at the
 * new size.
 */
const BLOOM_MULTIPLIER = 4;

/**
 * Radii of the 8 orbital rings, innermost to outermost. Pushed
 * outward (was 60 in iter 3a) so the larger, properly-rendered
 * star halo (~body*PANEL_STAR_SCALE*3) doesn't overlap the inner
 * orbit.
 */
const RING_RADII: readonly number[] = (() => {
  // Reserve room for the star halo at the centre, then spread the
  // 8 rings evenly out to the edge with a small margin.
  const innerR = 90;
  const outerR = HALF - 20;
  const step = (outerR - innerR) / (NUM_PLANET_SLOTS - 1);
  const out: number[] = [];
  for (let i = 0; i < NUM_PLANET_SLOTS; i++) {
    out.push(innerR + i * step);
  }
  return out;
})();

/**
 * Radius multiplier for the orbit-ring stroke. Faint, not visually
 * heavy; this is just a hint of where the orbit lives.
 */
const RING_STROKE = 1.2;

/**
 * Dust cloud stroke width. Heavier than `RING_STROKE` because
 * the cloud is a body, not just a hint — we want the orbit
 * ring (when it doubles as a cloud) to read as a real
 * feature. The Gaussian blur softens it back to a haze.
 */
const DUST_CLOUD_STROKE = 3.5;

/**
 * Gaussian blur strength (in viewBox units) applied to the
 * dust cloud. Softens the stroked orbit into a soft, hazy
 * band — the "cloud" look. A bit larger than the
 * DUST_CLOUD_STROKE so the edges feather out.
 */
const DUST_CLOUD_BLUR = 4;

/** Base body radius (a Small planet). */
const BODY_RADIUS_MIN = 3;

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export interface StarSystemView {
  /**
   * Update the rendered star (and its system). The star's `color`
   * drives the body/halo colour, and its `size` drives the
   * relative radii of the halo / bloom / core layers (same
   * formulas as the starmap render, just scaled up for the
   * panel).
   */
  setStar(star: Star): void;
  /** Tear down the SVG and any animation handles. Idempotent. */
  destroy(): void;
}

/**
 * Mount the star-system view into `host`. The host should be the
 * absolutely-positioned background layer of the sidepanel (see
 * `sidepanel.ts` for the wiring). The view fills the host.
 *
 * The SVG fills the host via `width="100%" height="100%"` and uses
 * `preserveAspectRatio="xMidYMid meet"` so it stays square and
 * centred.
 */
export function mountStarSystemView(host: HTMLElement): StarSystemView {
  const svg = document.createElementNS(NS_SVG, 'svg');
  svg.setAttribute('viewBox', `${-HALF} ${-HALF} ${VIEWBOX} ${VIEWBOX}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  svg.setAttribute('class', 'ssv-svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '100%');
  svg.setAttribute('height', '100%');

  // Layers (back to front): orbit rings, star, planet groups.
  const ringLayer = document.createElementNS(NS_SVG, 'g');
  ringLayer.setAttribute('class', 'ssv-rings');
  const starLayer = document.createElementNS(NS_SVG, 'g');
  starLayer.setAttribute('class', 'ssv-star');
  const planetLayer = document.createElementNS(NS_SVG, 'g');
  planetLayer.setAttribute('class', 'ssv-planets');

  svg.appendChild(ringLayer);
  svg.appendChild(starLayer);
  svg.appendChild(planetLayer);

  host.appendChild(svg);

  // Per-slot rotate groups for the planets. We re-create these on
  // every setSystem because the set of occupied slots can change.
  let orbitGroups: SVGGElement[] = [];

  function clearLayer(layer: SVGGElement): void {
    while (layer.firstChild) layer.removeChild(layer.firstChild);
  }

  function paintRings(system: StarSystem, starColor: StarColor): void {
    clearLayer(ringLayer);
    const ringColor = colorToHex(STAR_COLOR_FOR_COLOR[starColor]);
    for (let i = 0; i < NUM_PLANET_SLOTS; i++) {
      const r = RING_RADII[i]!;
      const slot = system.slots[i] ?? { kind: 'Empty' };
      // Orbit ring: always drawn, very faint.
      const ring = circle(0, 0, r);
      ring.setAttribute('fill', 'none');
      // Use the star's colour at very low opacity for the ring
      // so empty orbits still hint at the system's hue.
      ring.setAttribute('stroke', ringColor);
      ring.setAttribute('stroke-width', String(RING_STROKE));
      ring.setAttribute('stroke-opacity', slot.kind === 'Empty' ? '0.10' : '0.18');
      ringLayer.appendChild(ring);
    }
  }

  /**
   * Paint the central star in a layered halo+bloom+core+highlight
   * stack that mirrors the starmap's render
   * (see `_paintStarForTest` in src/ui/starmap.ts). The starmap
   * uses PixiJS sprites scaled from a baked gaussian texture; we
   * approximate the look in SVG with `radialGradient`-filled
   * circles — same falloff, no per-star texture upload.
   *
   * Layer order (back to front):
   *   1. halo  — large, halo colour, low alpha, soft radial gradient
   *   2. bloom — medium, body colour, medium alpha, soft radial gradient
   *   3. core  — small, opaque white
   *   4. hot   — tiny, opaque white (the "hot pixel" highlight)
   *
   * All radii are derived from `starBodyPx` / `starBloomPx` /
   * `starHaloPx` so the relative scale matches the starmap.
   */
  function paintStar(star: Star): void {
    clearLayer(starLayer);

    const bodyColor = colorToHex(STAR_COLOR_FOR_COLOR[star.color]);
    const haloColor = colorToHex(STAR_HALO_COLOR_FOR_COLOR[star.color]);

    // Radii in viewBox units. The starmap uses absolute pixel sizes;
    // we scale up by PANEL_STAR_SCALE so the star has real visual
    // weight at panel size. The bloom is further scaled by
    // BLOOM_MULTIPLIER so the soft body disc dominates the panel
    // the way a real star's light dominates its planetary system.
    const bodyR  = starBodyPx(star.size)  * PANEL_STAR_SCALE;
    const bloomR = starBloomPx(star.size) * PANEL_STAR_SCALE * BLOOM_MULTIPLIER;
    const haloR  = starHaloPx(star.size)  * PANEL_STAR_SCALE;
    // The highlight dot in the starmap is 0.4× bodyR.
    const hotR   = Math.max(0.5, bodyR * 0.4);

    // Unique gradient IDs per star so multiple instances on the
    // page (future-iter) don't collide. The prefix is also
    // namespaced so `<defs>` is self-contained.
    const gradKey = `ssv-${star.id}-${bodyColor}`;

    // <defs> with two radial gradients (halo + bloom).
    const defs = document.createElementNS(NS_SVG, 'defs');
    const haloGrad = document.createElementNS(NS_SVG, 'radialGradient');
    haloGrad.setAttribute('id', `halo-${gradKey}`);
    haloGrad.setAttribute('cx', '50%');
    haloGrad.setAttribute('cy', '50%');
    haloGrad.setAttribute('r', '50%');
    addStop(haloGrad, '0%',   haloColor, 0.85 * (STAR_HALO_ALPHA / 255));
    addStop(haloGrad, '35%',  haloColor, 0.45 * (STAR_HALO_ALPHA / 255));
    addStop(haloGrad, '70%',  haloColor, 0.10 * (STAR_HALO_ALPHA / 255));
    addStop(haloGrad, '100%', haloColor, 0);
    defs.appendChild(haloGrad);

    const bloomGrad = document.createElementNS(NS_SVG, 'radialGradient');
    bloomGrad.setAttribute('id', `bloom-${gradKey}`);
    bloomGrad.setAttribute('cx', '50%');
    bloomGrad.setAttribute('cy', '50%');
    bloomGrad.setAttribute('r', '50%');
    addStop(bloomGrad, '0%',   bodyColor, 0.85 * (STAR_BLOOM_ALPHA / 255));
    addStop(bloomGrad, '50%',  bodyColor, 0.30 * (STAR_BLOOM_ALPHA / 255));
    addStop(bloomGrad, '100%', bodyColor, 0);
    defs.appendChild(bloomGrad);

    starLayer.appendChild(defs);

    // 1. halo
    const halo = circle(0, 0, haloR);
    halo.setAttribute('fill', `url(#halo-${gradKey})`);
    starLayer.appendChild(halo);

    // 2. bloom
    const bloom = circle(0, 0, bloomR);
    bloom.setAttribute('fill', `url(#bloom-${gradKey})`);
    starLayer.appendChild(bloom);

    // 3. white core
    const core = circle(0, 0, bodyR);
    core.setAttribute('fill', '#ffffff');
    core.setAttribute('fill-opacity', String(STAR_CORE_ALPHA / 255));
    starLayer.appendChild(core);

    // 4. hot pixel (bright white centre)
    const hot = circle(0, 0, hotR);
    hot.setAttribute('fill', '#ffffff');
    starLayer.appendChild(hot);
  }

  function paintPlanets(system: StarSystem): void {
    // Wipe previous orbit groups.
    for (const g of orbitGroups) {
      if (g.parentNode === planetLayer) planetLayer.removeChild(g);
    }
    orbitGroups = [];
    clearLayer(planetLayer);

    // Each planet/gas-giant body needs its own sphere gradient
    // (different base colour per slot). We collect all the
    // <defs> entries here and attach them once to the planet
    // layer so they're available to every group's children.
    const defs = document.createElementNS(NS_SVG, 'defs');
    const seenKeys = new Set<string>();

    // The cloud <defs> filter must exist before any cloud is
    // rendered, so we set it up at the top of the loop.
    let hasCloud = false;
    const cloudRingRadii: number[] = [];

    for (let i = 0; i < NUM_PLANET_SLOTS; i++) {
      const slot: PlanetSlotContents = system.slots[i] ?? { kind: 'Empty' };
      const ringR = RING_RADII[i]!;
      const group = document.createElementNS(NS_SVG, 'g');
      const period = INNER_PERIOD_S + i * PERIOD_STEP_S;

      if (slot.kind === 'Empty') {
        // No body to draw — we still create the empty group so the
        // ring count matches the slot count and the animation
        // pipeline is uniform (no special-casing later).
      } else if (slot.kind === 'DustCloud') {
        // Render the cloud as a STROKED ORBIT RING centred on
        // the star, NOT on the orbit position. A dust cloud
        // around a star isn't a body that orbits the star —
        // it's a stationary ring of gas/dust at the slot's
        // orbital distance. So we draw the cloud as a static
        // circle at (0, 0) with the slot's orbit radius. The
        // cloud is added to planetLayer directly (NOT to the
        // orbit group) so it never animates.
        //
        // The cloud is a heavier, blurred version of the
        // orbit ring drawn behind it — visually the cloud
        // "is" the orbit, just made more substantial. The
        // Gaussian blur feathers the heavy stroke into a
        // soft haze. (Dust clouds cover the old "asteroid
        // belt" case: a denser dust cloud is visually a
        // thicker, more opaque ring, so the data-model
        // collapse from Asteroids→DustCloud is invisible.)
        ensureDustCloudFilter(defs);
        hasCloud = true;
        cloudRingRadii.push(ringR);
      } else {
        // Planet or GasGiant — draw a 3D-shaded body. Each
        // unique colour gets its own radialGradient in the
        // shared <defs>; we de-dupe so the same colour
        // (e.g. multiple Terran planets) doesn't get a dozen
        // identical gradients.
        const sz = slotSize(slot);
        const baseR = BODY_RADIUS_MIN + (sz - 1) * 1.5; // 3, 4.5, 6, 7.5
        const baseColor = slotColor(slot);
        const gradKey = `${baseColor}-${sz}`;
        if (!seenKeys.has(gradKey)) {
          seenKeys.add(gradKey);
          addSphereGradient(defs, gradKey, baseColor);
        }
        const body = sphereCircle(ringR, 0, baseR, gradKey);
        group.appendChild(body);
        animateRotate(group, period);
      }

      planetLayer.appendChild(group);
      orbitGroups.push(group);
    }

    // Render the dust clouds as STATIC rings centred on the
    // star. Done after the orbit groups so the clouds are
    // drawn on top of the orbit rings (the cloud is the
    // dominant visual for that radius). We do NOT animate
    // these — dust around a star doesn't orbit, it just sits
    // there.
    if (hasCloud) {
      ensureDustCloudFilter(defs);
      for (const ringR of cloudRingRadii) {
        // Find the colour of the dust cloud at this radius by
        // matching the slot. We could stash the colour per
        // slot above but keeping the lookup here keeps the
        // orbit loop's branch logic simple.
        let colour = '#c8b890';
        for (let i = 0; i < NUM_PLANET_SLOTS; i++) {
          const s = system.slots[i];
          if (s && s.kind === 'DustCloud' && RING_RADII[i] === ringR) {
            colour = slotColor(s);
            break;
          }
        }
        const cloud = document.createElementNS(NS_SVG, 'circle');
        cloud.setAttribute('cx', '0');
        cloud.setAttribute('cy', '0');
        cloud.setAttribute('r', String(ringR));
        cloud.setAttribute('fill', 'none');
        cloud.setAttribute('stroke', colour);
        // Heavier stroke than the faint orbit ring; the blur
        // feathers the edge so it doesn't read as "thick line".
        cloud.setAttribute('stroke-width', String(DUST_CLOUD_STROKE));
        // Slight transparency so the cloud doesn't completely
        // hide the orbit ring behind it.
        cloud.setAttribute('stroke-opacity', '0.65');
        cloud.setAttribute('filter', `url(#${DUST_CLOUD_FILTER_ID})`);
        // Append AFTER the orbit groups so the cloud renders
        // on top (z-order: later = on top in SVG).
        planetLayer.appendChild(cloud);
      }
    }

    // Attach the shared <defs> with all the sphere gradients
    // ONCE per paint. The gradients are referenced by URL
    // from each planet's `fill` attribute, so they need to
    // be in the same SVG document (which they are — same
    // host element). We attach to the planet layer (not
    // each group) so the defs aren't repeated per orbit
    // group.
    if (defs.childNodes.length > 0) {
      planetLayer.insertBefore(defs, planetLayer.firstChild);
    }
  }

  function animateRotate(group: SVGGElement, periodSeconds: number): void {
    // SMIL animateTransform: rotate from 0..360 around (0, 0) at
    // the given period. Repeats forever.
    const anim = document.createElementNS(NS_SVG, 'animateTransform');
    anim.setAttribute('attributeName', 'transform');
    anim.setAttribute('attributeType', 'XML');
    anim.setAttribute('type', 'rotate');
    anim.setAttribute('from', '0 0 0');
    anim.setAttribute('to', '360 0 0');
    anim.setAttribute('dur', `${periodSeconds}s`);
    anim.setAttribute('repeatCount', 'indefinite');
    group.appendChild(anim);
  }

  // The view paints a sensible placeholder on creation
  // (all-empty White star, size 50). The host calls `setStar`
  // with the real star before the panel is ever visible to a
  // user, so we don't need a separate "no star" sentinel.

  function setStar(star: Star): void {
    paintRings(star.system, star.color);
    paintStar(star);
    paintPlanets(star.system);
  }

  return {
    setStar,
    destroy: () => {
      for (const g of orbitGroups) {
        if (g.parentNode === planetLayer) planetLayer.removeChild(g);
      }
      orbitGroups = [];
      if (svg.parentNode === host) host.removeChild(svg);
    },
  };

  // Silence "unused variable" warnings — slotVisualRadius is kept
  // exported from the sim layer for callers but isn't used here
  // (we recompute the radius from slotSize directly in
  // paintPlanets).
  void slotVisualRadius;
}
