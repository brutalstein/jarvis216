import type { State } from "../shared";

const colours: Record<State, [number, number, number]> = {
  idle: [0.36, 0.48, 0.54],
  listening: [0.65, 0.85, 0.87],
  thinking: [0.53, 0.69, 0.84],
  speaking: [0.75, 0.9, 0.87],
  approval: [0.92, 0.72, 0.43],
  error: [0.9, 0.48, 0.46],
};

export class Presence {
  private state: State = "idle";
  private level = 0;
  private readonly reduce = matchMedia("(prefers-reduced-motion: reduce)");
  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: true, antialias: true });
    const ctx = gl ? null : canvas.getContext("2d");
    let program: WebGLProgram | null = null;
    if (gl) {
      const shader = (type: number, source: string) => {
        const value = gl.createShader(type);
        if (!value) throw new Error("SHADER_UNAVAILABLE");
        gl.shaderSource(value, source);
        gl.compileShader(value);
        return value;
      };
      program = gl.createProgram();
      if (program) {
        gl.attachShader(
          program,
          shader(gl.VERTEX_SHADER, "attribute vec2 p; void main(){gl_Position=vec4(p,0.,1.);}"),
        );
        gl.attachShader(
          program,
          shader(
            gl.FRAGMENT_SHADER,
            `precision mediump float;
          uniform vec2 size; uniform float t; uniform float energy; uniform vec3 colour;
          void main(){vec2 p=(gl_FragCoord.xy/size-.5)*2.;
          float envelope=pow(max(0.,1.-p.x*p.x),2.); float a=0.;
          for(int i=0;i<27;i++){float n=float(i)-13.;
            float y=n*.028+sin(p.x*4.+t*.65+n*.13)*envelope*(.12+energy*.16)
              +cos(p.x*7.-t*.4+n*.24)*envelope*.08;
            a+=(1.-smoothstep(0.,.005,abs(p.y-y)))*envelope*(.28+.45*(1.-abs(n)/14.));}
          float alpha=min(.9,a); gl_FragColor=vec4(colour*alpha,alpha);}`,
          ),
        );
        gl.linkProgram(program);
        gl.useProgram(program);
        const buffer = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(
          gl.ARRAY_BUFFER,
          new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
          gl.STATIC_DRAW,
        );
        const location = gl.getAttribLocation(program, "p");
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
      }
    }
    const draw = (now: number) => {
      const dpr = Math.min(devicePixelRatio, 2);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      const reduced = this.reduce.matches;
      canvas.dataset.motion = reduced ? "reduced" : "full";
      const t = reduced ? 0 : now / 1000;
      const energy =
        this.state === "speaking"
          ? Math.max(0.3, this.level)
          : this.state === "thinking"
            ? 0.12
            : this.level;
      const colour = colours[this.state];
      if (gl && program) {
        gl.viewport(0, 0, w, h);
        gl.uniform2f(gl.getUniformLocation(program, "size"), w, h);
        gl.uniform1f(gl.getUniformLocation(program, "t"), t);
        gl.uniform1f(gl.getUniformLocation(program, "energy"), energy);
        gl.uniform3fv(gl.getUniformLocation(program, "colour"), colour);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      } else if (ctx) {
        ctx.clearRect(0, 0, w, h);
        ctx.strokeStyle = `rgb(${colour.map((c) => Math.round(c * 255)).join(",")})`;
        ctx.lineWidth = dpr * 0.7;
        for (let line = -13; line <= 13; line++) {
          ctx.beginPath();
          for (let x = 0; x <= w; x += 4) {
            const p = (x / w) * 2 - 1;
            const envelope = (1 - p * p) ** 2;
            const y =
              h / 2 +
              line * h * 0.014 +
              Math.sin(p * 4 + t * 0.65 + line * 0.13) * envelope * h * (0.06 + energy * 0.08);
            if (x === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
    };
    let frame = 0;
    const animate = (now: number) => {
      draw(now);
      if (!this.reduce.matches && !document.hidden) frame = requestAnimationFrame(animate);
    };
    const restart = () => {
      cancelAnimationFrame(frame);
      animate(performance.now());
    };
    this.reduce.addEventListener("change", restart);
    document.addEventListener("visibilitychange", restart);
    this.render = restart;
    restart();
  }
  private render: () => void;
  setState(state: State) {
    this.state = state;
    if (this.reduce.matches) this.render();
  }
  setLevel(level: number) {
    this.level = Math.max(0, Math.min(1, level));
  }
}
