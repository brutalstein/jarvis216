import type { State } from "../shared";

type Look = {
  amp: number;
  speed: number;
  ripple: number;
  spin: number;
  shimmer: number;
  breath: number;
  alpha: number;
};
const KEYS = ["amp", "speed", "ripple", "spin", "shimmer", "breath", "alpha"] as const;

// Motion per state. Colour comes from the CSS --state-target token so it is defined once.
const LOOKS: Record<State, Look> = {
  idle: { amp: 0.35, speed: 0.35, ripple: 0, spin: 0, shimmer: 0, breath: 1, alpha: 0.6 },
  listening: { amp: 1, speed: 0.8, ripple: 0, spin: 0, shimmer: 0, breath: 0.4, alpha: 0.95 },
  thinking: { amp: 0.7, speed: 1.5, ripple: 0, spin: 0.6, shimmer: 1, breath: 0, alpha: 0.9 },
  speaking: { amp: 0.8, speed: 1, ripple: 1, spin: 0, shimmer: 0, breath: 0, alpha: 1 },
  approval: { amp: 0.4, speed: 0.5, ripple: 0, spin: 0, shimmer: 0, breath: 1.6, alpha: 1 },
  error: { amp: 0.12, speed: 0.2, ripple: 0, spin: 0, shimmer: 0, breath: 0, alpha: 0.5 },
};

const VERTEX = "attribute vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}";

// Concentric hairline rings, each displaced by a few low-frequency waves: a line-drawn sphere.
const FRAGMENT = `
precision highp float;
uniform vec2 res;
uniform vec3 color;
uniform float time, rings, dpr, amp, speed, ripple, spin, shimmer, breath, alpha, level;
const float R0 = 0.14;
const float R1 = 0.94;

float deform(float a, float k, float t) {
  float env = sin(3.14159 * (0.06 + 0.88 * t));
  float b = a + time * spin;
  float w = 0.5 * sin(b * 2.0 + time * 0.6 * speed + k * 0.45)
          + 0.3 * sin(b * 3.0 - time * 0.9 * speed + k * 0.31)
          + 0.2 * sin(b * 5.0 + time * 1.3 * speed - k * 0.23);
  float wave = sin(k * 0.85 - time * 5.5);
  return env * (amp * (0.010 + 0.045 * level) * w + ripple * (0.004 + 0.03 * level) * wave);
}

void main() {
  float half_ = 0.5 * min(res.x, res.y);
  vec2 p = (gl_FragCoord.xy - 0.5 * res) / half_;
  float r = length(p) / (1.0 + breath * 0.018 * sin(time * 1.05));
  float a = atan(p.y, p.x);
  float spacing = (R1 - R0) / (rings - 1.0);
  float k0 = floor((r - R0) / spacing);
  float light = 0.62 + 0.38 * dot(normalize(p + 1e-5), vec2(-0.55, 0.83));
  float v = 0.0;
  for (int j = -1; j <= 2; j++) {
    float k = k0 + float(j);
    if (k < 0.0 || k > rings - 1.0) continue;
    float t = k / (rings - 1.0);
    float d = abs(r - R0 - k * spacing - deform(a, k, t)) * half_;
    float line = 1.0 - smoothstep(0.55 * dpr, 0.55 * dpr + 1.0, d);
    float fade = mix(0.35, 1.0, t) * (1.0 - 0.45 * smoothstep(0.8, 1.0, t));
    float shim = 1.0 - shimmer * 0.55 * (0.5 + 0.5 * sin(k * 0.7 - time * 3.2));
    v = max(v, line * fade * shim);
  }
  v *= light * alpha;
  gl_FragColor = vec4(color * v, v);
}`;

const UNIFORMS = ["res", "color", "time", "rings", "dpr", "level", ...KEYS];

function rgb(value: string): number[] | undefined {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim())?.[1];
  return hex ? [0, 2, 4].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255) : undefined;
}

/** The living presence: WebGL rings whose colour and motion carry JARVIS's state. */
export class Presence {
  private gl: WebGLRenderingContext | null;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private look: Look = { ...LOOKS.idle };
  private target = LOOKS.idle;
  private color = [0.66, 0.635, 0.62];
  private targetColor = this.color;
  private state: State = "idle";
  private input = 0;
  private output = 0;
  private level = 0;
  private rings = 24;
  private frame = 0;
  private readonly start = performance.now();
  private readonly reduced = matchMedia("(prefers-reduced-motion: reduce)");

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
    });
    if (!this.gl || !this.compile(this.gl)) {
      this.gl = null;
      canvas.dataset.fallback = "true";
    }
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.reduced.addEventListener("change", () => this.schedule());
    document.addEventListener("visibilitychange", () => this.schedule());
    this.setState("idle");
  }

  setState(state: State) {
    this.state = state;
    this.target = LOOKS[state];
    const token = getComputedStyle(document.body).getPropertyValue("--state-target");
    this.targetColor = rgb(token) ?? this.targetColor;
    this.schedule();
  }

  setInput(level: number) {
    this.input = Math.min(1, Math.max(0, level));
  }

  setOutput(level: number) {
    this.output = Math.min(1, Math.max(0, level));
  }

  private schedule() {
    const still = this.reduced.matches;
    this.canvas.dataset.motion = still ? "reduced" : "full";
    cancelAnimationFrame(this.frame);
    if (still || document.hidden) {
      this.look = { ...this.target };
      this.color = this.targetColor;
      this.level = 0;
      this.draw(2);
      return;
    }
    const tick = () => {
      this.step();
      this.draw((performance.now() - this.start) / 1000);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  private step() {
    for (const key of KEYS) this.look[key] += (this.target[key] - this.look[key]) * 0.06;
    this.color = this.color.map((c, i) => c + (this.targetColor[i] - c) * 0.06);
    const heard =
      this.state === "speaking" ? this.output : this.state === "listening" ? this.input : 0;
    this.level += (heard - this.level) * 0.2;
    // Audio callbacks stop when silent; stale levels decay instead of freezing the rings.
    this.input *= 0.92;
    this.output *= 0.92;
  }

  private resize() {
    const dpr = devicePixelRatio || 1;
    const width = Math.round(this.canvas.clientWidth * dpr);
    const height = Math.round(this.canvas.clientHeight * dpr);
    if (width === this.canvas.width && height === this.canvas.height) return;
    this.canvas.width = width;
    this.canvas.height = height;
    // About 7 CSS pixels between rings at any size.
    const radius = Math.min(this.canvas.clientWidth, this.canvas.clientHeight) / 2;
    this.rings = Math.min(28, Math.max(7, Math.round((radius * 0.8) / 7)));
    if (this.reduced.matches || document.hidden) this.draw(2);
  }

  private compile(gl: WebGLRenderingContext) {
    const program = gl.createProgram();
    for (const [type, source] of [
      [gl.VERTEX_SHADER, VERTEX],
      [gl.FRAGMENT_SHADER, FRAGMENT],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) return false;
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return false;
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return false;
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "p");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    for (const name of UNIFORMS) this.loc[name] = gl.getUniformLocation(program, name);
    return true;
  }

  private draw(time: number) {
    const gl = this.gl;
    if (!gl) return;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.loc.res, this.canvas.width, this.canvas.height);
    gl.uniform3f(this.loc.color, this.color[0], this.color[1], this.color[2]);
    gl.uniform1f(this.loc.time, time);
    gl.uniform1f(this.loc.rings, this.rings);
    gl.uniform1f(this.loc.dpr, devicePixelRatio || 1);
    gl.uniform1f(this.loc.level, this.level);
    for (const key of KEYS) gl.uniform1f(this.loc[key], this.look[key]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
