// 화면 전체 물결 오버레이(DP-161). 부를 때만 canvas를 만들어 화면 위에 겹치고, 물결이 끝나면 rAF를 멈추고 GL 문맥과 canvas를 놓는다.
// 누르기를 막지 않고(pointer-events: none) 화면 낭독에서 빠진다. WebGL2를 못 쓰거나 셰이더가 실패하면 조용히 건너뛴다(장식이라 알릴 것이 없다).
// 한 번에 하나만 돈다. 창이 숨으면 그 자리에서 끝낸다.

import { isMotionReduced } from "../../lib/motion-presets.tsx";
import { waveStyleOf, type WaveCause } from "./fx-config.ts";
import { WAVE_FRAGMENT, WAVE_VERTEX } from "./wave-shader.ts";
import {
  WAVE_PALETTE,
  waveDurationOf,
  waveFieldAt,
  waveLumpsAt,
  type WaveRect,
} from "./wave-front.ts";

/** 지금 도는 물결을 끝내는 함수. 없으면 null */
let stopCurrent: (() => void) | null = null;

/** 장치 px 배율 상한. 색 띠는 부드러워 CSS px의 1.5배면 충분하고 4K 창에서 조각 수를 줄인다 */
const SCALE_CAP = 1.5;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
  gl.deleteShader(shader);
  return null;
}

function programOf(gl: WebGL2RenderingContext): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, WAVE_VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, WAVE_FRAGMENT);
  const program = gl.createProgram();
  if (vertex === null || fragment === null) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  return gl.getProgramParameter(program, gl.LINK_STATUS) === true ? program : null;
}

/** 아래 가운데 알약(첫 진입처럼 누른 자리가 없을 때) */
function bottomSourceOf(width: number, height: number): WaveRect {
  const w = Math.min(360, width * 0.4);
  return { x: (width - w) / 2, y: height - 72, width: w, height: 48 };
}

/** 물결을 한 번 띄운다. 이미 돌고 있거나 움직임을 줄였거나 창이 숨었으면 아무것도 하지 않는다 */
export function playWave(input: {
  readonly cause: WaveCause;
  /** 물결이 떠나는 자리(창 기준 CSS px). 없으면 아래 가운데 */
  readonly source?: WaveRect;
}): void {
  if (typeof document === "undefined" || stopCurrent !== null) return;
  if (isMotionReduced() || document.hidden) return;
  const canvas = document.createElement("canvas");
  canvas.className = "fx-wave";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (gl === null) return;
  const program = programOf(gl);
  if (program === null) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return;
  }
  const style = waveStyleOf(input.cause, document.documentElement);
  const duration = waveDurationOf(style.wave) * 1000;
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  // 화면 전체를 덮는 삼각형 하나
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.useProgram(program);
  const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  gl.uniform3fv(at("u_pal"), WAVE_PALETTE);
  const w = style.wave;
  gl.uniform1f(at("u_lead"), w.lead);
  gl.uniform1f(at("u_tail"), w.tail);
  gl.uniform1f(at("u_strength"), w.strength);
  gl.uniform1f(at("u_rimWidth"), w.rimWidth);
  gl.uniform1f(at("u_rimSoftness"), w.rimSoftness);
  gl.uniform1f(at("u_corner"), w.cornerRadius);
  gl.uniform1f(at("u_uneven"), w.rimUnevenness);
  gl.uniform1f(at("u_pulse"), w.rimPulse);
  gl.uniform1f(at("u_hairWidth"), w.hairlineWidth);
  gl.uniform1f(at("u_hairOpacity"), w.hairlineOpacity);
  gl.uniform1f(at("u_hairWhite"), w.hairlineWhite);
  const uSize = at("u_size");
  const uScale = at("u_scale");
  const uField = at("u_f");
  const uLumps = at("u_lumps");
  canvas.style.opacity = String(style.opacity);
  document.body.append(canvas);

  let frame = 0;
  let started: number | null = null;
  const stop = (): void => {
    cancelAnimationFrame(frame);
    document.removeEventListener("visibilitychange", onVisibility);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    canvas.remove();
    if (stopCurrent === stop) stopCurrent = null;
  };
  const onVisibility = (): void => {
    if (document.hidden) stop();
  };
  const draw = (now: number): void => {
    started ??= now;
    const elapsed = now - started;
    if (elapsed >= duration) {
      stop();
      return;
    }
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = Math.min(window.devicePixelRatio || 1, SCALE_CAP);
    const pw = Math.round(width * scale);
    const ph = Math.round(height * scale);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    gl.viewport(0, 0, pw, ph);
    const size = { width, height };
    const source = input.source ?? bottomSourceOf(width, height);
    const field = waveFieldAt(elapsed / duration, source, size, w);
    gl.uniform2f(uSize, width, height);
    gl.uniform1f(uScale, scale);
    gl.uniform1fv(uField, field);
    gl.uniform3fv(uLumps, waveLumpsAt(field[5] ?? 0, size, w.cornerRadius, w.rimPulse));
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    frame = requestAnimationFrame(draw);
  };
  stopCurrent = stop;
  document.addEventListener("visibilitychange", onVisibility);
  frame = requestAnimationFrame(draw);
}
