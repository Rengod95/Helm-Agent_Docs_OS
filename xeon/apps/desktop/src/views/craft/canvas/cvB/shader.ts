// 배경 셰이더 한 장. 아주 연한 빛: 가장자리가 조금 밝아지는 프레넬 테두리, 가운데 위쪽의 넓은 번짐, 물밑 빛 같은 가는 결(caustic).
// 색은 거의 무채색이고 결에만 오로라 색(보라·청록)이 아주 조금 섞인다. 프레임 루프가 없다: 부르는 쪽이 필요할 때 한 번 그린다.
// WebGL이 없거나 셰이더가 안 되면 아무것도 그리지 않는다(격자만 남는다).

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }
`;

const FRAG = `
precision mediump float;
uniform vec2 res;
uniform float dark;
float field(vec2 q) {
  float v = 0.0;
  v += sin(q.x * 3.1 + sin(q.y * 2.3) * 1.7);
  v += sin(q.y * 3.7 + sin(q.x * 1.9 + 1.3) * 1.5);
  v += sin((q.x + q.y) * 2.2 + sin(q.x * 2.9 - q.y) * 1.2);
  return v / 3.0;
}
void main() {
  vec2 uv = gl_FragCoord.xy / res;
  vec2 c = uv - vec2(0.5, 0.56);
  c.x *= res.x / res.y;
  float r = length(c);
  vec2 e = min(uv, 1.0 - uv);
  float edge = 1.0 - smoothstep(0.0, 0.22, min(e.x, e.y));
  float bloom = exp(-r * r * 2.6);
  vec2 q = c * 2.4;
  float f = field(q);
  float lines = pow(1.0 - abs(f), 14.0) * smoothstep(1.15, 0.15, r);
  vec3 violet = vec3(0.62, 0.55, 0.95);
  vec3 cyan = vec3(0.55, 0.85, 0.95);
  vec3 tint = mix(violet, cyan, 0.5 + 0.5 * sin(c.x * 2.0 + c.y * 1.4));
  vec3 white = vec3(1.0);
  float aBloom = mix(0.0, 0.035, dark) * bloom;
  float aEdge = mix(0.025, 0.03, dark) * edge;
  float aLines = mix(0.03, 0.05, dark) * lines;
  vec3 edgeColor = mix(vec3(0.35, 0.38, 0.5), white, dark);
  vec3 col = white * aBloom + edgeColor * aEdge + mix(white, tint, 0.55) * aLines;
  float a = aBloom + aEdge + aLines;
  gl_FragColor = vec4(col, a);
}
`;

interface Program {
  readonly gl: WebGLRenderingContext;
  readonly res: WebGLUniformLocation | null;
  readonly dark: WebGLUniformLocation | null;
}

const programs = new WeakMap<HTMLCanvasElement, Program | null>();

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function setup(canvas: HTMLCanvasElement): Program | null {
  const gl = canvas.getContext("webgl", {
    premultipliedAlpha: true,
    antialias: false,
    alpha: true,
  });
  if (gl === null) return null;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (vs === null || fs === null) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) return null;
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attr = gl.getAttribLocation(program, "p");
  gl.enableVertexAttribArray(attr);
  gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
  return {
    gl,
    res: gl.getUniformLocation(program, "res"),
    dark: gl.getUniformLocation(program, "dark"),
  };
}

/** 한 번 그린다. 화면 픽셀 비율은 1.5에서 자른다(아주 연한 빛이라 더 세밀할 필요가 없다) */
export function drawLight(canvas: HTMLCanvasElement, dark: boolean): void {
  let program = programs.get(canvas);
  if (program === undefined) {
    program = setup(canvas);
    programs.set(canvas, program);
  }
  if (program === null) return;
  const ratio = Math.min(window.devicePixelRatio, 1.5);
  const w = Math.max(1, Math.round(canvas.clientWidth * ratio));
  const h = Math.max(1, Math.round(canvas.clientHeight * ratio));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const { gl } = program;
  gl.viewport(0, 0, w, h);
  gl.uniform2f(program.res, w, h);
  gl.uniform1f(program.dark, dark ? 1 : 0);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}
