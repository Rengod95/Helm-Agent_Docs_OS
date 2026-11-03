// WebGL 1 자원 묶음: 전체 화면 삼각형 하나와 조각 셰이더 하나. 셰이더 소스는 space-math.ts가 준다.
// 능력이 없으면 null을 돌려주고, 호출하는 쪽이 CSS 대체로 간다. 셰이더 로그는 콘솔에 찍지 않는다.
import { QUAD_VERT } from "./space-math.ts";

export type UniformLookup = (name: string) => WebGLUniformLocation | null;

/** 문맥과 프로그램을 세웠는지. pending은 아직 세우는 중, none은 WebGL이 없거나 셰이더가 안 될 때 */
export type GlSupport = "pending" | "shader" | "none";

export interface QuadProgram {
  readonly gl: WebGLRenderingContext;
  readonly program: WebGLProgram;
  readonly buffer: WebGLBuffer;
  readonly attr: number;
  /** uniform 위치는 한 번만 찾는다(프레임마다 찾지 않는다) */
  readonly locations: Map<string, WebGLUniformLocation | null>;
}

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

function link(gl: WebGLRenderingContext, vs: WebGLShader, fs: WebGLShader): WebGLProgram | null {
  // createProgram은 실패를 null로 알리지 않는다(실패하면 문맥 상실 뒤의 호출이고, 아래 링크 검사가 잡는다)
  const program = gl.createProgram();
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/** 프로그램과 버퍼를 짠다. 문맥이 되살아난 뒤에도 같은 소스로 다시 짠다(예전 GL 객체는 무효다). */
export function buildQuadProgram(gl: WebGLRenderingContext, fragSrc: string): QuadProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, QUAD_VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragSrc);
  const program = vs === null || fs === null ? null : link(gl, vs, fs);
  // 링크가 끝나면 셰이더 객체는 필요 없다(실패해도 지운다: 새는 객체를 남기지 않는다)
  if (vs !== null) gl.deleteShader(vs);
  if (fs !== null) gl.deleteShader(fs);
  if (program === null) return null;
  const buffer = gl.createBuffer();
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const attr = gl.getAttribLocation(program, "a");
  gl.enableVertexAttribArray(attr);
  gl.vertexAttribPointer(attr, 2, gl.FLOAT, false, 0, 0);
  return { gl, program, buffer, attr, locations: new Map() };
}

export function releaseQuadProgram(p: QuadProgram): void {
  p.gl.deleteProgram(p.program);
  p.gl.deleteBuffer(p.buffer);
}

function uniformAt(p: QuadProgram, name: string): WebGLUniformLocation | null {
  const hit = p.locations.get(name);
  if (hit !== undefined) return hit;
  const loc = p.gl.getUniformLocation(p.program, name);
  p.locations.set(name, loc);
  return loc;
}

/** 프로그램을 쓰고 uniform을 채운 뒤 삼각형을 그린다. 뷰포트는 호출하는 쪽이 캔버스 크기에 맞춘다. */
export function drawQuad(p: QuadProgram, setUniforms: (loc: UniformLookup) => void): void {
  const { gl } = p;
  gl.useProgram(p.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, p.buffer);
  gl.enableVertexAttribArray(p.attr);
  gl.vertexAttribPointer(p.attr, 2, gl.FLOAT, false, 0, 0);
  setUniforms((name) => uniformAt(p, name));
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

/**
 * 기기 배율이 바뀌면 부른다(창을 다른 모니터로 옮길 때). 해제 함수를 돌려준다.
 * 배율은 미디어 질의로 본다: 같은 질의가 바뀌면 배율이 바뀐 것이라 새 질의로 다시 건다.
 */
export function watchDevicePixelRatio(onChange: () => void): () => void {
  let query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  const onQuery = (): void => {
    query.removeEventListener("change", onQuery);
    query = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
    query.addEventListener("change", onQuery);
    onChange();
  };
  query.addEventListener("change", onQuery);
  return (): void => {
    query.removeEventListener("change", onQuery);
  };
}
