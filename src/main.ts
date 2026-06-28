/**
 * Application entry point.
 *
 * Iteration 1a boot test. Wires up the minimal HTML shell, generates a
 * galaxy using src/sim/galaxy, and renders the result as JSON to prove
 * the sim ↔ UI seam works end to end.
 *
 * This file is intentionally not part of the spec. It is glue.
 * Once PixiJS rendering lands (Iter 1b or later), most of the DOM here
 * gets replaced with a canvas.
 */

import {
  GALAXY_SIZES,
  GalaxySize,
  RADIUS_FOR_SIZE,
  STAR_COUNT_FOR_SIZE,
  initGalaxy,
  isValidGalaxy,
} from '@sim/galaxy';

const sizeSelect = document.getElementById('size-select') as HTMLSelectElement;
const seedInput = document.getElementById('seed-input') as HTMLInputElement;
const generateBtn = document.getElementById('generate-btn') as HTMLButtonElement;
const randomSeedBtn = document.getElementById('random-seed-btn') as HTMLButtonElement;
const statCount = document.getElementById('stat-count')!.querySelector('b')!;
const statRadius = document.getElementById('stat-radius')!.querySelector('b')!;
const statValid = document.getElementById('stat-valid')!.querySelector('b')!;
const jsonOut = document.getElementById('galaxy-json') as HTMLPreElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

if (
  !sizeSelect ||
  !seedInput ||
  !generateBtn ||
  !randomSeedBtn ||
  !statCount ||
  !statRadius ||
  !statValid ||
  !jsonOut ||
  !statusEl
) {
  throw new Error('main.ts: required DOM elements missing from index.html');
}

function setStatus(msg: string, kind: 'ok' | 'err' | '' = ''): void {
  statusEl.textContent = msg;
  statusEl.className = kind;
}

function isGalaxySize(v: string): v is GalaxySize {
  return (GALAXY_SIZES as readonly string[]).includes(v);
}

function generate(): void {
  const sizeRaw = sizeSelect.value;
  if (!isGalaxySize(sizeRaw)) {
    setStatus(`Invalid galaxy size: ${sizeRaw}`, 'err');
    return;
  }
  const size: GalaxySize = sizeRaw;
  const seed = Number.parseInt(seedInput.value, 10);
  if (!Number.isFinite(seed)) {
    setStatus('Seed must be an integer.', 'err');
    return;
  }

  try {
    const galaxy = initGalaxy(seed, size);
    const valid = isValidGalaxy(galaxy);

    statCount.textContent = String(galaxy.stars.length);
    statRadius.textContent = String(galaxy.radius);
    statValid.textContent = String(valid);

    // Compact per-star view so the JSON pane stays scannable.
    const summary = {
      size: galaxy.size,
      radius: galaxy.radius,
      starCount: galaxy.stars.length,
      expectedCount: STAR_COUNT_FOR_SIZE[size],
      expectedRadius: RADIUS_FOR_SIZE[size],
      isValidGalaxy: valid,
      seed,
      firstFiveStars: galaxy.stars.slice(0, 5),
      lastStar: galaxy.stars[galaxy.stars.length - 1],
    };
    jsonOut.textContent = JSON.stringify(summary, null, 2);

    setStatus(
      valid
        ? `Generated ${galaxy.stars.length}-star ${size} galaxy (seed=${seed}). isValidGalaxy: true.`
        : `Generated galaxy FAILS isValidGalaxy — check console.`,
      valid ? 'ok' : 'err',
    );
    if (!valid) {
      console.error('Invalid galaxy produced:', galaxy);
    } else {
      console.log('Generated galaxy:', galaxy);
    }
  } catch (err) {
    setStatus(`Generation failed: ${(err as Error).message}`, 'err');
    console.error(err);
  }
}

generateBtn.addEventListener('click', generate);
randomSeedBtn.addEventListener('click', () => {
  seedInput.value = String(Math.floor(Math.random() * 0x7fffffff) | 0);
  generate();
});
sizeSelect.addEventListener('change', generate);
seedInput.addEventListener('change', generate);

// Initial render so the page isn't blank on first paint.
generate();