// 화면 전체 물결 오버레이(DP-161·166). 부를 때만 canvas를 만들어 화면 위에 겹치고, 물결이 끝나면 rAF를 멈추고 텍스처·GL 문맥·canvas를 놓는다.
// 차례: (1) Electron 창이면 셸이 창을 한 장 찍는다(canvas가 붙기 전이라 그림에 물결이 없다). (2) canvas를 붙이고 그 그림을 텍스처로 올려
// 흐린 두 장을 한 번 만든다. (3) 매 프레임 렌즈(굴절·색수차·흐림·모으기) → 색 띠·가장자리 → 입자 차례로 그린다.
// 그림이 없으면(웹 탭, 찍기가 한도를 넘음, 실패) 렌즈 없이 색과 입자만 그린다. 렌즈는 내용이 움직이거나 흐려진 곳만 덮으므로 앞선이 지나간 자리는
// 곧바로 실제 화면이다. 찍은 그림이 낡으면(찍기 시작부터 DOM이 바뀌거나 스크롤됨) 렌즈를 쓰지 않거나(그리기 전) 150ms에 걷는다(도는 중).
// 그래서 찍은 때의 그림과 실제 화면이 겹쳐 두 겹으로 보이는 일이 없다(시안 dzU2 §3.3).
// 누르기를 막지 않고(pointer-events: none) 화면 낭독에서 빠진다. WebGL2를 못 쓰거나 셰이더가 실패하면 조용히 건너뛴다(장식이라 알릴 것이 없다).
// 한 번에 하나만 돈다. 창이 숨으면 그 자리에서 끝낸다.

import { detach, rethrow } from "@fresnel/contracts";
import { isMotionReduced } from "../../lib/motion-presets.tsx";
import { waveStyleOf, type WaveCause, type WaveTune } from "./fx-config.ts";
import { captureForWave, waveLensAvailable, type WaveSnapshot } from "./wave-capture.ts";
import {
  WAVE_BLUR_FRAGMENT,
  WAVE_DOT_FRAGMENT,
  WAVE_DOT_VERTEX,
  WAVE_FRAGMENT,
  WAVE_LENS_FRAGMENT,
  WAVE_VERTEX,
} from "./wave-shader.ts";
import {
  PARTICLE_STRIDE,
  WAVE_PALETTE,
  waveDurationOf,
  waveFieldOf,
  waveFrontAt,
  waveLumpsAt,
  waveParticlesAt,
  type WaveRect,
} from "./wave-front.ts";

/** 지금 도는 물결을 끝내는 함수. 없으면 null */
let stopCurrent: (() => void) | null = null;
/** 창을 찍는 중(물결이 아직 시작하지 않았다) */
let starting = false;

/** 렌즈가 없을 때 장치 px 배율 상한. 색 띠는 부드러워 CSS px의 1.5배면 충분하고 4K 창에서 조각 수를 줄인다 */
const SCALE_CAP = 1.5;
/** 렌즈가 있을 때 상한. 찍은 그림의 배율(보통 2)을 그대로 써야 렌즈 가장자리에서 글이 실제 화면과 같은 선명도로 이어진다 */
const LENS_SCALE_CAP = 2;
/** 흐린 두 장의 해상도(CSS px당 텍셀). 가장 약한 흐림(7px)도 이 해상도에서 1.75텍셀이라 줄여도 티가 나지 않는다 */
const BLUR_RES = 0.5;
/** 가까운 흐림(원본 `nearBlur`, CSS px) */
const NEAR_BLUR = 7;
/** 화면이 바뀌어 렌즈를 걷는 시간(ms) */
const LENS_RETIRE_MS = 150;

/** 바뀐 노드가 모두 물결 canvas인가(자기 자신이 붙고 떨어진 것은 화면이 바뀐 것이 아니다) */
function oursOnly(nodes: NodeList): boolean {
  return Array.from(nodes).every(
    (node) => node instanceof HTMLCanvasElement && node.classList.contains("fx-wave"),
  );
}

/** 찍은 그림이 낡았는지 지켜본다: 본문 DOM이 바뀌거나(물결 canvas 제외) 어디든 스크롤되면 한 번 알린다. 돌려주는 함수가 지켜보기를 끝낸다 */
function watchStale(onStale: () => void): () => void {
  let fired = false;
  const fire = (): void => {
    if (fired) return;
    fired = true;
    onStale();
  };
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (
        record.type === "childList" &&
        oursOnly(record.addedNodes) &&
        oursOnly(record.removedNodes)
      )
        continue;
      fire();
      return;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  document.addEventListener("scroll", fire, { capture: true, passive: true });
  window.addEventListener("resize", fire);
  return () => {
    observer.disconnect();
    document.removeEventListener("scroll", fire, { capture: true });
    window.removeEventListener("resize", fire);
  };
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) === true) return shader;
  gl.deleteShader(shader);
  return null;
}

function programOf(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram | null {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (vertex === null || fragment === null) return null;
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) === true) return program;
  gl.deleteProgram(program);
  return null;
}

/** 아래 가운데 알약(입력창이 화면에 없을 때) */
function bottomSourceOf(width: number, height: number): WaveRect {
  const w = Math.min(360, width * 0.4);
  return { x: (width - w) / 2, y: height - 72, width: w, height: 48 };
}

function textureOf(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
  pixels: Uint8Array | null,
): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return texture;
}

/** 찍은 그림과 미리 흐린 두 장. 물결 동안 그대로다 */
type LensTextures = {
  readonly sharp: WebGLTexture;
  readonly near: WebGLTexture;
  readonly far: WebGLTexture;
  /** 흐림을 만들 때만 쓴 것. 끝날 때 함께 놓는다 */
  readonly scratch: readonly WebGLTexture[];
  readonly framebuffer: WebGLFramebuffer;
  /** 찍을 때의 창 크기(CSS px). 창 크기가 바뀌면 렌즈를 끈다 */
  readonly width: number;
  readonly height: number;
};

/** 그림을 올리고 흐린 두 장을 만든다. 흐림 셰이더를 못 만들면 null(렌즈 없이 간다) */
function lensTexturesOf(
  gl: WebGL2RenderingContext,
  snapshot: WaveSnapshot,
  cssWidth: number,
  cssHeight: number,
  blur: number,
  triangle: WebGLBuffer,
): LensTextures | null {
  const program = programOf(gl, WAVE_VERTEX, WAVE_BLUR_FRAGMENT);
  if (program === null) return null;
  const sharp = textureOf(gl, snapshot.width, snapshot.height, snapshot.bytes);
  const lw = Math.max(1, Math.round(cssWidth * BLUR_RES));
  const lh = Math.max(1, Math.round(cssHeight * BLUR_RES));
  const small = textureOf(gl, lw, lh, null);
  const pass = textureOf(gl, lw, lh, null);
  const near = textureOf(gl, lw, lh, null);
  const far = textureOf(gl, lw, lh, null);
  const framebuffer = gl.createFramebuffer();
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  const position = gl.getAttribLocation(program, "a_pos");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  const at = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  gl.uniform1i(at("u_src"), 0);
  gl.uniform2f(at("u_dst"), lw, lh);
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, lw, lh);
  gl.disable(gl.BLEND);
  gl.activeTexture(gl.TEXTURE0);
  const blurPass = (
    from: WebGLTexture,
    to: WebGLTexture,
    dir: readonly [number, number],
    sigma: number,
    swizzle: boolean,
  ): void => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, to, 0);
    gl.bindTexture(gl.TEXTURE_2D, from);
    gl.uniform2f(at("u_dir"), dir[0], dir[1]);
    gl.uniform1f(at("u_sigma"), sigma);
    gl.uniform1f(at("u_swizzle"), swizzle ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
  // 줄이기(BGRA → RGB), 그다음 가로·세로 가우스. 시그마는 원본 blur 반지름(CSS px)을 줄인 텍셀로
  blurPass(sharp, small, [0, 0], 0, true);
  blurPass(small, pass, [1, 0], NEAR_BLUR * BLUR_RES, false);
  blurPass(pass, near, [0, 1], NEAR_BLUR * BLUR_RES, false);
  blurPass(small, pass, [1, 0], blur * BLUR_RES, false);
  blurPass(pass, far, [0, 1], blur * BLUR_RES, false);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteProgram(program);
  return {
    sharp,
    near,
    far,
    scratch: [small, pass],
    framebuffer,
    width: cssWidth,
    height: cssHeight,
  };
}

/** 물결을 한 번 띄운다. 이미 돌고 있거나 움직임을 줄였거나 창이 숨었으면 아무것도 하지 않는다 */
export function playWave(input: {
  readonly cause: WaveCause;
  /** 물결이 떠나는 자리(창 기준 CSS px). 없으면 아래 가운데 */
  readonly source?: WaveRect;
}): void {
  if (typeof document === "undefined" || stopCurrent !== null || starting) return;
  if (isMotionReduced() || document.hidden) return;
  if (!waveLensAvailable()) {
    run(input, null, null);
    return;
  }
  starting = true;
  // 찍기를 부르기 전부터 지켜본다: 찍는 동안 바뀐 화면도 낡은 것이다
  let stale = false;
  const unwatch = watchStale(() => {
    stale = true;
  });
  detach(
    captureForWave().then((snapshot) => {
      starting = false;
      unwatch();
      if (isMotionReduced() || document.hidden || stopCurrent !== null) return null;
      run(input, stale ? null : snapshot, snapshot === null ? null : snapshot.ms);
      return null;
    }),
    rethrow,
  );
}

function run(
  input: { readonly cause: WaveCause; readonly source?: WaveRect },
  snapshot: WaveSnapshot | null,
  captureMs: number | null,
): void {
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
  const band = programOf(gl, WAVE_VERTEX, WAVE_FRAGMENT);
  const dots = programOf(gl, WAVE_DOT_VERTEX, WAVE_DOT_FRAGMENT);
  if (band === null || dots === null) {
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return;
  }
  const tune: WaveTune = waveStyleOf(input.cause, document.documentElement);
  const w = tune.wave;
  const duration = waveDurationOf(w) * 1000;
  const triangle = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, triangle);
  // 화면 전체를 덮는 삼각형 하나
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const startWidth = window.innerWidth;
  const startHeight = window.innerHeight;
  const lensProgram = snapshot === null ? null : programOf(gl, WAVE_VERTEX, WAVE_LENS_FRAGMENT);
  const textures =
    snapshot === null || lensProgram === null
      ? null
      : lensTexturesOf(gl, snapshot, startWidth, startHeight, w.blur, triangle);
  const lensScale =
    snapshot === null ? 1 : Math.min(snapshot.width / Math.max(startWidth, 1), LENS_SCALE_CAP);

  // 색 띠 값(바뀌지 않는다)
  gl.useProgram(band);
  const bandAt = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(band, name);
  gl.uniform3fv(bandAt("u_pal"), WAVE_PALETTE);
  gl.uniform1f(bandAt("u_lead"), w.lead);
  gl.uniform1f(bandAt("u_tail"), w.tail);
  gl.uniform1f(bandAt("u_strength"), w.strength);
  gl.uniform1f(bandAt("u_rimWidth"), w.rimWidth);
  gl.uniform1f(bandAt("u_rimSoftness"), w.rimSoftness);
  gl.uniform1f(bandAt("u_corner"), w.cornerRadius);
  gl.uniform1f(bandAt("u_uneven"), w.rimUnevenness);
  gl.uniform1f(bandAt("u_pulse"), w.rimPulse);
  gl.uniform1f(bandAt("u_hairWidth"), w.hairlineWidth);
  gl.uniform1f(bandAt("u_hairOpacity"), w.hairlineOpacity);
  gl.uniform1f(bandAt("u_hairWhite"), w.hairlineWhite);
  gl.uniform1f(bandAt("u_opacity"), tune.opacity);
  const bandPos = gl.getAttribLocation(band, "a_pos");

  // 렌즈 값(바뀌지 않는다)
  const lensAt = (name: string): WebGLUniformLocation | null =>
    lensProgram === null ? null : gl.getUniformLocation(lensProgram, name);
  if (lensProgram !== null && textures !== null) {
    gl.useProgram(lensProgram);
    gl.uniform1i(lensAt("u_tex"), 0);
    gl.uniform1i(lensAt("u_near"), 1);
    gl.uniform1i(lensAt("u_far"), 2);
    gl.uniform1f(lensAt("u_amplitude"), w.amplitude);
    gl.uniform1f(lensAt("u_lensWidth"), w.lensWidth);
    gl.uniform1f(lensAt("u_aberration"), w.aberration);
    gl.uniform1f(lensAt("u_blur"), w.blur);
    gl.uniform1f(lensAt("u_blurAhead"), w.blurAhead);
    gl.uniform1f(lensAt("u_blurBehind"), w.blurBehind);
  }
  const lensPos = lensProgram === null ? -1 : gl.getAttribLocation(lensProgram, "a_pos");

  // 입자
  gl.useProgram(dots);
  gl.uniform3fv(gl.getUniformLocation(dots, "u_dotColor"), tune.dot);
  gl.uniform1f(gl.getUniformLocation(dots, "u_opacity"), tune.opacity);
  const dotBuffer = gl.createBuffer();
  const dotPos = gl.getAttribLocation(dots, "a_dot");

  canvas.dataset["lens"] = textures === null ? "off" : "on";
  if (captureMs !== null) canvas.dataset["captureMs"] = captureMs.toFixed(1);
  document.body.append(canvas);
  /** 화면이 바뀐 때(ms, rAF 시각). 그 뒤 LENS_RETIRE_MS에 렌즈를 걷는다 */
  let retiredAt: number | null = null;
  let retireNow = false;
  const unwatch =
    textures === null
      ? () => {}
      : watchStale(() => {
          retireNow = true;
          canvas.dataset["lens"] = "retired";
        });

  let frame = 0;
  let started: number | null = null;
  const stop = (): void => {
    cancelAnimationFrame(frame);
    unwatch();
    document.removeEventListener("visibilitychange", onVisibility);
    if (textures !== null) {
      for (const texture of [textures.sharp, textures.near, textures.far, ...textures.scratch])
        gl.deleteTexture(texture);
      gl.deleteFramebuffer(textures.framebuffer);
    }
    gl.deleteBuffer(triangle);
    gl.deleteBuffer(dotBuffer);
    gl.deleteProgram(band);
    gl.deleteProgram(dots);
    if (lensProgram !== null) gl.deleteProgram(lensProgram);
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
    if (retireNow) {
      retiredAt ??= now;
    }
    const lensAlpha = retiredAt === null ? 1 : Math.max(0, 1 - (now - retiredAt) / LENS_RETIRE_MS);
    if (elapsed >= duration) {
      stop();
      return;
    }
    const width = window.innerWidth;
    const height = window.innerHeight;
    // 찍은 뒤 창 크기가 바뀌면 그림이 어긋나므로 렌즈를 끈다
    const lens =
      textures !== null && textures.width === width && textures.height === height ? textures : null;
    const scale = lens === null ? Math.min(window.devicePixelRatio || 1, SCALE_CAP) : lensScale;
    const pw = Math.round(width * scale);
    const ph = Math.round(height * scale);
    if (canvas.width !== pw || canvas.height !== ph) {
      canvas.width = pw;
      canvas.height = ph;
    }
    gl.viewport(0, 0, pw, ph);
    const size = { width, height };
    const source = input.source ?? bottomSourceOf(width, height);
    const front = waveFrontAt(elapsed / duration, source, size, w);
    const field = waveFieldOf(front);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindBuffer(gl.ARRAY_BUFFER, triangle);

    // 1. 렌즈(덮어 쓴다)
    gl.disable(gl.BLEND);
    if (lens !== null && lensProgram !== null && (front.energy > 0 || front.gravity > 0)) {
      gl.useProgram(lensProgram);
      gl.enableVertexAttribArray(lensPos);
      gl.vertexAttribPointer(lensPos, 2, gl.FLOAT, false, 0, 0);
      gl.uniform2f(lensAt("u_size"), width, height);
      gl.uniform1f(lensAt("u_scale"), scale);
      gl.uniform1fv(lensAt("u_f"), field);
      gl.uniform1f(lensAt("u_alpha"), lensAlpha);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, lens.sharp);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, lens.near);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, lens.far);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // 2. 색 띠·가장자리(premultiplied, 위에 얹는다)
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(band);
    gl.enableVertexAttribArray(bandPos);
    gl.vertexAttribPointer(bandPos, 2, gl.FLOAT, false, 0, 0);
    gl.uniform2f(bandAt("u_size"), width, height);
    gl.uniform1f(bandAt("u_scale"), scale);
    gl.uniform1fv(bandAt("u_f"), field);
    gl.uniform3fv(bandAt("u_lumps"), waveLumpsAt(front.time, size, w.cornerRadius, w.rimPulse));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // 3. 입자
    gl.useProgram(dots);
    gl.uniform2f(gl.getUniformLocation(dots, "u_size"), width, height);
    gl.uniform1f(gl.getUniformLocation(dots, "u_scale"), scale);
    gl.bindBuffer(gl.ARRAY_BUFFER, dotBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, waveParticlesAt(front, source, w), gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(dotPos);
    gl.vertexAttribPointer(dotPos, PARTICLE_STRIDE, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.POINTS, 0, w.particleCount);
    gl.disableVertexAttribArray(dotPos);

    frame = requestAnimationFrame(draw);
  };
  stopCurrent = stop;
  document.addEventListener("visibilitychange", onVisibility);
  frame = requestAnimationFrame(draw);
}
