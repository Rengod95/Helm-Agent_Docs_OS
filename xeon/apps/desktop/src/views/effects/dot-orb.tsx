// 점 구슬(DP-189 [결정: 2026-11-13 사용자 "2번같은 스타일의 아이콘"]). 생각 표시(thinking-indicator, thinking-orbs)와 같은 점 구슬 식구로
// "진행 중"과 "내 확인이 필요함"을 그린다. 모양(점의 자리와 움직임)은 thinking-orbs의 기하(MODE_FRAMES, 프리셋 20)를 그대로 쓰고,
// 칠하기만 여기서 한다. 라이브러리 부품(ThinkingOrb)을 쓰지 않는 까닭:
//   1) 라이브러리 프리셋은 20·32·64뿐이고 줄 아이콘 칸은 12·14다(같은 기하를 작은 칸에 그린다),
//   2) 라이브러리는 기기 배율을 2로 자르고 앱 배율(`<html>`의 CSS zoom, lib/zoom.ts)을 모른다: 200%에서 흐려진다. 여기서는 기기 배율 × 앱 배율(최대 4)로 그린다,
//   3) 잉크가 한 색뿐이다. 주의 구슬은 물듦과 같은 호박 → 산호 세로 그라데이션을 점마다 칠한다,
//   4) 구슬마다 requestAnimationFrame을 따로 돌리지 않고 시계 하나가 화면에 보이는 구슬만 그린다(대화 목록에 스무 개가 떠도 한 번의 프레임 일).
// 움직이는 수는 attention-budget.ts가 정한다(상한을 넘거나 움직임을 줄이면 같은 기하의 멈춘 한 장면). 화면 밖·숨은 창에서는 그리지 않는다.

import { useEffect, useRef, type ReactNode } from "react";
import {
  MODE_FRAMES,
  resolvePreset,
  scaleRadii,
  type OrbFrame,
  type OrbState,
} from "thinking-orbs";
import { cssZoomOf } from "../../lib/zoom.ts";
import { useAttentionLive, type AttentionLiveKind } from "./attention-budget.ts";

/** 잉크. ink는 생각 구슬과 같은 흑백, warm은 주의 물듦과 같은 호박 → 산호 */
export type DotOrbTone = "ink" | "warm";

/** 칸 크기(CSS px). 12는 내비 줄 숫자 옆, 14는 아이콘 칸(size-icon-md), 20은 생각 구슬(라이브러리 프리셋 20 그대로, DP-208) */
export type DotOrbSize = 12 | 14 | 20;

type Rgb = readonly [number, number, number];

/**
 * 따뜻한 잉크의 위·아래 빛깔(sRGB). attention.css의 `--fx-attend-a`·`--fx-attend-b`와 같은 색이다(oklch를 sRGB로 옮긴 값).
 * 다크는 밝은 호박 → 산호, 라이트는 흰 바탕에서 묻히지 않게 짙은 호박 → 산호
 */
const WARM: Readonly<Record<"dark" | "light", readonly [Rgb, Rgb]>> = {
  dark: [
    [246, 189, 82],
    [241, 128, 72],
  ],
  light: [
    [207, 132, 18],
    [196, 80, 34],
  ],
};

/** 그리기 배율 상한. 기기 2 × 앱 200%까지 또렷하다 */
const MAX_SCALE = 4;

/** 멈춘 한 장면의 시각(초, 프리셋 속도를 곱하기 전). 라이브러리의 움직임 줄이기 장면(0.6)과 같다 */
const STILL_T = 0.6;

interface Entry {
  readonly canvas: HTMLCanvasElement;
  state: OrbState;
  tone: DotOrbTone;
  size: number;
  live: boolean;
  visible: boolean;
  /** 프리셋 기하 옵션과 속도(state·size가 바뀌면 다시 푼다) */
  opts: Readonly<Record<string, number | undefined>>;
  speed: number;
}

const entries = new Set<Entry>();
let raf = 0;
let envBound = false;

export function isDark(): boolean {
  const theme = document.documentElement.dataset["theme"];
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

function mixRgb(a: Rgb, b: Rgb, f: number): Rgb {
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** 라이브러리 잉크와 같은 깊이 그림자: 다크는 먼 점이 검정 쪽으로, 라이트는 흰색 쪽으로 옅어진다 */
function inkOf(base: Rgb | null, white: number, alpha: number, dark: boolean): string {
  const w = Math.min(1, Math.max(0, white));
  if (base === null) {
    const g = Math.round((dark ? 1 - w : w) * 255);
    return `rgba(${String(g)},${String(g)},${String(g)},${String(alpha)})`;
  }
  const ramp = (c: number): number => Math.round(dark ? c * (1 - w) : c + (255 - c) * w);
  return `rgba(${String(ramp(base[0]))},${String(ramp(base[1]))},${String(ramp(base[2]))},${String(alpha)})`;
}

/** 칸 안의 세로 자리(0 위 ~ 1 아래)에 맞는 따뜻한 빛깔. ink는 null(흑백) */
function baseAt(tone: DotOrbTone, dark: boolean, y: number, size: number): Rgb | null {
  if (tone === "ink") return null;
  const [top, bottom] = WARM[dark ? "dark" : "light"];
  return mixRgb(top, bottom, Math.min(1, Math.max(0, y / size)));
}

function paintFrame(
  ctx: CanvasRenderingContext2D,
  frame: OrbFrame,
  tone: DotOrbTone,
  dark: boolean,
  size: number,
): void {
  for (const line of frame.lines) {
    ctx.strokeStyle = inkOf(
      baseAt(tone, dark, (line.y1 + line.y2) / 2, size),
      line.white,
      line.a ?? 1,
      dark,
    );
    ctx.lineWidth = line.w;
    ctx.beginPath();
    ctx.moveTo(line.x1, line.y1);
    ctx.lineTo(line.x2, line.y2);
    ctx.stroke();
  }
  for (const dot of frame.dots) {
    ctx.fillStyle = inkOf(baseAt(tone, dark, dot.y, size), dot.white, dot.a ?? 1, dark);
    ctx.beginPath();
    ctx.arc(dot.x, dot.y, dot.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** 한 구슬을 시각 `seconds`(벽시계 초)의 장면으로 그린다. 멈춘 구슬은 늘 같은 장면이다 */
function draw(entry: Entry, seconds: number, dark: boolean): void {
  const scale = Math.min(MAX_SCALE, (window.devicePixelRatio || 1) * cssZoomOf(entry.canvas));
  const px = Math.round(entry.size * scale);
  if (entry.canvas.width !== px) entry.canvas.width = px;
  if (entry.canvas.height !== px) entry.canvas.height = px;
  const ctx = entry.canvas.getContext("2d");
  if (ctx === null) return;
  const unit = px / entry.size;
  ctx.setTransform(unit, 0, 0, unit, 0, 0);
  ctx.clearRect(0, 0, entry.size, entry.size);
  const t = entry.live ? seconds * entry.speed : STILL_T * entry.speed;
  paintFrame(
    ctx,
    MODE_FRAMES[resolvePreset(entry.state, 20).mode](entry.size, t, entry.opts),
    entry.tone,
    dark,
    entry.size,
  );
}

function tick(): void {
  raf = 0;
  if (document.visibilityState === "hidden") return;
  const dark = isDark();
  const seconds = performance.now() / 1000;
  let any = false;
  for (const entry of entries) {
    if (!entry.live || !entry.visible) continue;
    draw(entry, seconds, dark);
    any = true;
  }
  if (any) raf = requestAnimationFrame(tick);
}

/** 움직이는 구슬이 보이면 시계를 건다(이미 돌면 그대로) */
function wake(): void {
  if (raf !== 0 || document.visibilityState === "hidden") return;
  for (const entry of entries) {
    if (entry.live && entry.visible) {
      raf = requestAnimationFrame(tick);
      return;
    }
  }
}

/** 테마·배율이 바뀌면 멈춘 구슬도 다시 그린다 */
function redrawAll(): void {
  const dark = isDark();
  const seconds = performance.now() / 1000;
  for (const entry of entries) draw(entry, seconds, dark);
  wake();
}

/** 테마(`<html data-theme>`, 운영체제)와 앱 배율(`<html style>`의 zoom)·기기 배율의 바뀜을 한 번만 듣는다 */
function bindEnv(): void {
  if (envBound) return;
  envBound = true;
  new MutationObserver(redrawAll).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style", "class"],
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawAll);
  window.addEventListener("resize", redrawAll);
  document.addEventListener("visibilitychange", wake);
}

let observer: IntersectionObserver | null = null;
const byCanvas = new WeakMap<Element, Entry>();

function intersection(): IntersectionObserver {
  if (observer !== null) return observer;
  observer = new IntersectionObserver((changes) => {
    for (const change of changes) {
      const entry = byCanvas.get(change.target);
      if (entry !== undefined) entry.visible = change.isIntersecting;
    }
    wake();
  });
  return observer;
}

function presetOf(state: OrbState, size: number): Pick<Entry, "opts" | "speed"> {
  const preset = resolvePreset(state, 20);
  // 기하는 칸 크기에 맞춰 줄지만 점 반지름은 그만큼 줄면 너무 가늘다: 20 대비 줄어든 만큼 반지름을 덜 줄인다(줄 칸에서도 점이 셀 수 있게 보인다)
  const opts = size < 20 ? scaleRadii(preset.opts, Math.sqrt(20 / size)) : preset.opts;
  return { opts, speed: preset.speed };
}

/**
 * 점 구슬 하나. 뜻은 부르는 쪽이 글(sr-only·툴팁)로 말한다(aria-hidden).
 * `kind`는 움직임 상한의 줄(attention-budget): 진행은 "progress", 주의는 "mark"
 */
export function DotOrb(props: {
  readonly state: OrbState;
  readonly tone: DotOrbTone;
  readonly size: DotOrbSize;
  readonly kind: AttentionLiveKind;
  /** false면 처음부터 멈춘 한 장면이다 */
  readonly live?: boolean;
  readonly className?: string;
  /** 부르는 쪽이 정한 움직임 뜻(생각 구슬의 `data-active`). 시험과 CSS가 읽는다 */
  readonly "data-active"?: "true" | "false";
}): ReactNode {
  const ref = useRef<HTMLCanvasElement>(null);
  const entryRef = useRef<Entry | null>(null);
  const live = useAttentionLive(props.kind, props.live ?? true);

  // 캔버스가 붙을 때 시계에 올리고 떨어질 때 내린다(값은 아래 효과가 넣는다)
  useEffect(
    () => () => {
      const entry = entryRef.current;
      if (entry === null) return;
      observer?.unobserve(entry.canvas);
      entries.delete(entry);
      byCanvas.delete(entry.canvas);
      entryRef.current = null;
    },
    [],
  );

  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null) return;
    let entry = entryRef.current;
    if (entry === null) {
      bindEnv();
      entry = {
        canvas,
        state: props.state,
        tone: props.tone,
        size: props.size,
        live,
        visible: true,
        ...presetOf(props.state, props.size),
      };
      entries.add(entry);
      byCanvas.set(canvas, entry);
      entryRef.current = entry;
      intersection().observe(canvas);
    } else {
      if (entry.state !== props.state || entry.size !== props.size)
        Object.assign(entry, presetOf(props.state, props.size));
      entry.state = props.state;
      entry.tone = props.tone;
      entry.size = props.size;
      entry.live = live;
    }
    draw(entry, performance.now() / 1000, isDark());
    wake();
  }, [props.state, props.tone, props.size, live]);

  return (
    <canvas
      ref={ref}
      aria-hidden
      data-slot="dot-orb"
      data-tone={props.tone}
      data-live={live ? "true" : "false"}
      data-active={props["data-active"]}
      className={`fx-dot-orb${props.className === undefined ? "" : ` ${props.className}`}`}
      style={{ width: props.size, height: props.size }}
    />
  );
}
