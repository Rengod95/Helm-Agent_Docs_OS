// 캔버스 바탕: 무채색 글로 라인 그리드(CSS, 시점을 따라 움직인다)와 아주 연한 셰이더 한 장(WebGL, 한 번만 그린다).
// 셰이더는 프레임 루프가 없다: 처음, 크기·테마·배율이 바뀔 때만 그린다. 그래서 멈춘 화면은 GPU를 쓰지 않는다.
// 장식이라 보조 기술에서 숨긴다. WebGL이 없으면 그리드만 남는다.
import { useEffect, useRef, type ReactNode } from "react";

export interface BackdropView {
  readonly x: number;
  readonly y: number;
  readonly k: number;
}

const VERT = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";

// 프레넬 테두리(가장자리로 갈수록 밝아지는 얇은 띠)와 겹친 사인파 두 장의 맥놀이(물속 빛무늬). 알파는 4% 아래.
const FRAG = `precision mediump float;
uniform vec2 uSize;uniform float uDark;uniform vec2 uLens;
float wave(vec2 p){
  float a=sin(p.x*1.7+sin(p.y*1.3)*1.6)+sin(p.y*1.9+sin(p.x*1.1)*1.4);
  float b=sin((p.x+p.y)*1.2+sin(p.x*0.7-p.y*0.9)*2.0);
  return pow(clamp(0.5+0.25*(a+b)*0.5,0.,1.),6.);
}
void main(){
  vec2 uv=gl_FragCoord.xy/uSize;
  vec2 p=(gl_FragCoord.xy-uLens)/min(uSize.x,uSize.y);
  float d=length(p);
  float rim=smoothstep(0.62,0.42,d)*smoothstep(0.18,0.40,d);
  float edge=pow(clamp(d*1.15,0.,1.),3.0);
  float c=wave(p*6.0)*rim*0.55+edge*0.35;
  float alpha=c*mix(0.045,0.06,1.-uDark);
  vec3 tint=mix(vec3(0.55,0.62,0.72),vec3(0.86,0.9,1.0),uDark);
  gl_FragColor=vec4(tint*alpha,alpha);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const s = gl.createShader(type);
  if (s === null) return null;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (gl.getShaderParameter(s, gl.COMPILE_STATUS) !== true) {
    gl.deleteShader(s);
    return null;
  }
  return s;
}

/** 한 번 그린다. 그린 횟수를 `data-draws`에 남긴다(쉬는 상태 측정용) */
function paint(canvas: HTMLCanvasElement, dark: boolean): boolean {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: true,
    antialias: false,
    preserveDrawingBuffer: true,
  });
  if (gl === null) return false;
  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (vs === null || fs === null) return false;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (gl.getProgramParameter(prog, gl.LINK_STATUS) !== true) return false;
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const at = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(at);
  gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.uniform2f(gl.getUniformLocation(prog, "uSize"), canvas.width, canvas.height);
  gl.uniform1f(gl.getUniformLocation(prog, "uDark"), dark ? 1 : 0);
  gl.uniform2f(gl.getUniformLocation(prog, "uLens"), canvas.width * 0.5, canvas.height * 0.55);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.deleteBuffer(buf);
  gl.deleteProgram(prog);
  canvas.dataset["draws"] = String(Number(canvas.dataset["draws"] ?? "0") + 1);
  return true;
}

export function Backdrop(props: {
  readonly view: BackdropView;
  readonly dark: boolean;
}): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const { dark } = props;
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return undefined;
    // 크기가 바뀌면 다시 그린다(창 크기·패널 열기). 같은 크기면 그리지 않는다
    const redraw = (): void => {
      const dpr = Math.min(window.devicePixelRatio, 1.5);
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr * 0.5));
      const h = Math.max(1, Math.round(canvas.clientHeight * dpr * 0.5));
      if (canvas.width === w && canvas.height === h && canvas.dataset["theme"] === String(dark))
        return;
      canvas.width = w;
      canvas.height = h;
      canvas.dataset["theme"] = String(dark);
      if (!paint(canvas, dark)) canvas.hidden = true;
    };
    redraw();
    const ro = new ResizeObserver(redraw);
    ro.observe(canvas);
    return () => {
      ro.disconnect();
    };
  }, [dark]);
  const { x, y, k } = props.view;
  const minor = 24 * k;
  const major = 120 * k;
  const pos = `${String(x)}px ${String(y)}px`;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden bg-bg-canvas">
      <canvas ref={ref} data-cve-shader className="absolute inset-0 size-full" />
      <div
        className="absolute inset-0"
        style={{
          // 가는 선(작은 칸), 굵은 선(큰 칸), 큰 칸의 번짐(3px, 아주 옅게). 무채색 글자색을 섞어 테마를 따른다
          backgroundImage: [
            "linear-gradient(to right, var(--cve-grid-glow) 0 3px, transparent 3px)",
            "linear-gradient(to bottom, var(--cve-grid-glow) 0 3px, transparent 3px)",
            "linear-gradient(to right, var(--cve-grid-major) 0 1px, transparent 1px)",
            "linear-gradient(to bottom, var(--cve-grid-major) 0 1px, transparent 1px)",
            "linear-gradient(to right, var(--cve-grid-minor) 0 1px, transparent 1px)",
            "linear-gradient(to bottom, var(--cve-grid-minor) 0 1px, transparent 1px)",
          ].join(","),
          backgroundSize: [major, major, major, major, minor, minor]
            .map((s) => `${String(s)}px ${String(s)}px`)
            .join(","),
          backgroundPosition: [
            `${String(x - 1)}px ${String(y - 1)}px`,
            `${String(x - 1)}px ${String(y - 1)}px`,
            pos,
            pos,
            pos,
            pos,
          ].join(","),
          maskImage: "radial-gradient(ellipse 75% 70% at 50% 52%, black 30%, transparent 100%)",
          WebkitMaskImage:
            "radial-gradient(ellipse 75% 70% at 50% 52%, black 30%, transparent 100%)",
        }}
      />
    </div>
  );
}
