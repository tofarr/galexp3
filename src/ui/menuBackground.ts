/**
 * Animated space-vortex background for the main menu.
 *
 * Two render paths:
 *  1. **CSS** (default) — conic + radial gradients animated with CSS
 *     transforms. Works everywhere, including browsers without WebGL.
 *  2. **PixiJS shader** (deferred) — a WebGL fragment shader rendering
 *     polar-coordinate vortex + FBM noise + chromatic aberration +
 *     procedural starfield. Mounted when `webglAvailable()` returns
 *     true. In a headless / no-GPU sandbox this path is skipped.
 *
 * The CSS path is intentionally cheap (no per-frame JS) so the menu
 * stays responsive. When the user runs in a real browser with GPU
 * access, the PixiJS shader path takes over automatically.
 */

import { Application, Filter, GlProgram, Graphics, Texture } from 'pixi.js';

// ============================================================================
// PixiJS shader (used only when WebGL is available)
//
// On browsers without WebGL, PixiJS auto-detects the renderer and
// silently falls back to CanvasRenderer, which has no GPU filter
// pipeline — the custom shader would never run. The CSS fallback
// below is what we render when this happens.
// ============================================================================

// Polar vortex with domain-warped noise, slow rotation, sparse stars,
// and chromatic aberration toward the edges. uMouse offsets the centre.
// Palette mirrors the CSS fallback so both paths feel the same.
const FRAGMENT_SHADER = /* glsl */ `#version 300 es
precision highp float;

in vec2 vTextureCoord;

uniform float uTime;
uniform vec2  uResolution;
uniform vec2  uMouse;

out vec4 finalColor;

// 2D hash → [0,1)
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

// Value noise (2 octaves) — cheap, good enough for a slow background.
float valueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  return 0.65 * valueNoise(p) + 0.35 * valueNoise(p * 2.07 + 4.1);
}

// Five-stop palette matching the CSS gradient.
vec3 palette(float t) {
  t = clamp(t, 0.0, 1.0);
  vec3 c0 = vec3(0.040, 0.050, 0.110); // deep void
  vec3 c1 = vec3(0.106, 0.165, 0.333); // navy
  vec3 c2 = vec3(0.420, 0.227, 0.549); // purple
  vec3 c3 = vec3(0.765, 0.310, 0.478); // magenta-rose
  vec3 c4 = vec3(0.941, 0.541, 0.235); // warm orange
  vec3 c5 = vec3(1.000, 0.784, 0.549); // pale gold
  if (t < 0.20) return mix(c0, c1, t / 0.20);
  if (t < 0.45) return mix(c1, c2, (t - 0.20) / 0.25);
  if (t < 0.70) return mix(c2, c3, (t - 0.45) / 0.25);
  if (t < 0.90) return mix(c3, c4, (t - 0.70) / 0.20);
  return mix(c4, c5, (t - 0.90) / 0.10);
}

void main() {
  // Normalised coordinates centred on screen, aspect-corrected.
  vec2 uv = (vTextureCoord - 0.5) * vec2(uResolution.x / uResolution.y, 1.0);

  // Mouse parallax — small offset toward cursor.
  vec2 mouseOffset = uMouse * 0.18;
  uv -= mouseOffset;

  // Polar coordinates around screen centre.
  float r = length(uv);
  float a = atan(uv.y, uv.x);

  // Domain-warped FBM noise gives the swirling arms.
  float t = uTime * 0.05;
  vec2 warp = vec2(
    fbm(uv * 1.6 + vec2( t,        0.0)),
    fbm(uv * 1.6 + vec2(0.0,      -t * 0.8))
  );
  float n = fbm(uv * 2.2 + warp * 0.9 + t);

  // Spiral: angle gets a radius-dependent offset so arms twist.
  float spiral = a + r * 3.2 - uTime * 0.12 + n * 1.8;

  // Combine — radial position drives the palette index, spiral adds banding.
  float band = 0.5 + 0.5 * sin(spiral * 3.0);
  float palIdx = clamp(0.85 - r * 0.9 + n * 0.35 + band * 0.18, 0.0, 1.0);
  vec3 col = palette(palIdx);

  // Centre glow — warm bloom toward the middle.
  float glow = exp(-r * 2.4);
  col += vec3(1.00, 0.78, 0.55) * glow * 0.55;

  // Vignette so the edges fade to void.
  float vignette = smoothstep(1.25, 0.20, r);
  col *= mix(0.25, 1.0, vignette);

  // Chromatic aberration — sample noise at slight offsets per channel.
  vec2 ca = uv * 0.6;
  float cr = fbm(ca + vec2( 0.012, 0.0) + t);
  float cg = fbm(ca + vec2( 0.000, 0.0) + t);
  float cb = fbm(ca + vec2(-0.012, 0.0) + t);
  col *= vec3(0.85 + cr * 0.30, 0.85 + cg * 0.30, 0.85 + cb * 0.30);

  // Sparse starfield — bright pinpoints where hash crosses a small threshold.
  vec2 starUV = vTextureCoord * vec2(uResolution.x / uResolution.y, 1.0) * 6.0;
  float s = hash21(floor(starUV));
  float starMask = step(0.992, s);
  float starTwinkle = 0.6 + 0.4 * sin(uTime * 2.0 + s * 31.0);
  col += vec3(1.0, 0.95, 0.85) * starMask * starTwinkle * 0.9;

  finalColor = vec4(col, 1.0);
}
`;

const PIXI_DEFAULT_VERTEX_SHADER = /* glsl */ `#version 300 es
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord() {
  return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main() {
  gl_Position = filterVertexPosition();
  vTextureCoord = filterTextureCoord();
}
`;


// ============================================================================
// WebGL detection
// ============================================================================

function webglAvailable(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return !!(
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl')
    );
  } catch {
    return false;
  }
}

// ============================================================================
// Public API
// ============================================================================

export interface MenuBackground {
  /** Stop the render loop and release all GPU resources. */
  dispose(): void;
  /** Force a manual resize of the render surface. */
  resize(): void;
  /** Which render path was selected ('shader' | 'css'). */
  readonly mode: 'shader' | 'css';
}

export interface MountOptions {
  /** Container element to mount the canvas into. */
  container: HTMLElement;
}

/**
 * Build the menu background and append its canvas to `container`.
 * Returns a handle with a `dispose()` method for teardown.
 *
 * Picks the best render path for the current browser:
 *  - WebGL available → PixiJS shader (high-fidelity vortex)
 *  - No WebGL        → CSS animated gradients (always works)
 */
export async function mountMenuBackground(
  options: MountOptions,
): Promise<MenuBackground> {
  const { container } = options;
  if (!container) throw new Error('mountMenuBackground: container is required');

  if (!webglAvailable()) {
    return mountCssVortex(container);
  }
  return mountShaderVortex(container);
}

// ---------------------------------------------------------------------------
// CSS fallback (always works)
// ---------------------------------------------------------------------------

function mountCssVortex(container: HTMLElement): MenuBackground {
  const wrap = document.createElement('div');
  wrap.className = 'vortex-bg';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.innerHTML = `
    <div class="vortex-stars"></div>
    <div class="vortex-swirl"></div>
    <div class="vortex-glow"></div>
  `;
  container.prepend(wrap);

  return {
    mode: 'css',
    dispose: () => {
      if (wrap.parentElement === container) container.removeChild(wrap);
    },
    resize: () => { /* CSS handles layout automatically */ },
  };
}

// ---------------------------------------------------------------------------
// PixiJS shader (preferred when WebGL is available)
// ---------------------------------------------------------------------------

async function mountShaderVortex(container: HTMLElement): Promise<MenuBackground> {
  const app = new Application();
  await app.init({
    backgroundAlpha: 0,
    antialias: true,
    autoStart: true,
    resizeTo: container,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoDensity: true,
    preference: 'webgl',
    powerPreference: 'high-performance',
  });
  container.appendChild(app.canvas);

  const initialW = app.canvas.width || app.screen.width || 1;
  const initialH = app.canvas.height || app.screen.height || 1;
  const graphics = new Graphics()
    .rect(0, 0, initialW, initialH)
    .fill({ texture: Texture.WHITE, color: 0xffffff });
  app.stage.addChild(graphics);

  const filter = new Filter({
    glProgram: new GlProgram({
      fragment: FRAGMENT_SHADER,
      vertex: PIXI_DEFAULT_VERTEX_SHADER,
      name: 'vortex-background',
    }),
    resources: {
      vortexUniforms: {
        uTime: { value: 0, type: 'f32' },
        uResolution: {
          value: [app.screen.width, app.screen.height],
          type: 'vec2<f32>',
        },
        uMouse: { value: [0, 0], type: 'vec2<f32>' },
      },
    },
  });
  graphics.filters = [filter];

  // --- mouse tracking ---------------------------------------------------
  const targetMouse = { x: 0, y: 0 };
  const currentMouse = { x: 0, y: 0 };
  const onPointerMove = (e: PointerEvent): void => {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    targetMouse.x = Math.max(-1, Math.min(1, nx));
    targetMouse.y = Math.max(-1, Math.min(1, ny));
  };
  window.addEventListener('pointermove', onPointerMove, { passive: true });

  // --- ticker -----------------------------------------------------------
  const uniforms = filter.resources.vortexUniforms.uniforms;
  const startTime = performance.now();
  app.ticker.add(() => {
    const t = (performance.now() - startTime) / 1000;

    const smoothing = 0.12;
    currentMouse.x += (targetMouse.x - currentMouse.x) * smoothing;
    currentMouse.y += (targetMouse.y - currentMouse.y) * smoothing;

    uniforms.uTime = t;
    const w = app.screen.width || app.canvas.width || 1;
    const h = app.screen.height || app.canvas.height || 1;
    (uniforms.uResolution as unknown as [number, number]) = [w, h];
    (uniforms.uMouse as unknown as [number, number]) = [
      currentMouse.x,
      currentMouse.y,
    ];
  });

  // --- resize -----------------------------------------------------------
  const syncSize = (): void => {
    graphics
      .clear()
      .rect(0, 0, app.screen.width, app.screen.height)
      .fill({ texture: Texture.WHITE, color: 0xffffff });
    (uniforms.uResolution as unknown as [number, number]) = [
      app.screen.width,
      app.screen.height,
    ];
  };
  app.renderer.on('resize', syncSize);

  return {
    mode: 'shader',
    dispose: () => {
      window.removeEventListener('pointermove', onPointerMove);
      app.renderer.off('resize', syncSize);
      app.destroy(true, { children: true, texture: true });
      if (app.canvas.parentElement === container) {
        container.removeChild(app.canvas);
      }
    },
    resize: syncSize,
  };
}