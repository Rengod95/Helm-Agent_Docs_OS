// 크리스탈 표시(DP-223 [결정: 2026-11-18 사용자 "결정(크리스탈) 버전이 좋음 … 내비 옆에도 괜찮을듯", lcMk; 재질 "우리 앱 아이콘처럼 더 유리같은 느낌", lcMk2;
// "재질 색은 앱 아이콘처럼 3d rendering 이 된 느낌 … 색이 앱 아이콘 처럼 은은하고 반짝이는 느낌", lcMk3]). "내 확인이 필요함"을 말한다.
// 그림은 미리 렌더링한 유리다: scripts/crystal-bake.ts가 로고의 갈라진 두 조각(crystal-geometry.ts)을 광선 추적해(굴절, 프레넬 반사, 전반사,
// 빛깔별 굴절률, 둥근 날) 판 두 장(crystal-dark.png, crystal-light.png, 배치표 crystal-sheet.ts)으로 구워 두었고, 여기서는 그 칸들을 캔버스에
// 겹쳐 그리기만 한다. 거의 무색의 맑은 유리라 면 너머로 바탕이 비치고, 빛은 날의 작은 반짝임과 안쪽의 가는 줄에 모인다(lcMk5).
// 움직임(crystal-motion.ts의 자세)은 칸을 옮겨 낸다: 틈은 두 조각을 갈라진 면을 따라 떼고(gap·split), 돌림(yaw)은 구운 이웃 두 각을 섞고,
// 빛(glow)은 같은 칸을 한 번 더 얹어 밝히고, 빛줄기(sweep)는 유리 위에만 얹는다(source-atop).
// 쉬는 상태는 멈춘 한 장면이다: 값이나 테마가 바뀔 때 한 번 그리고 requestAnimationFrame을 걸지 않는다. 상황이 바뀌면 그 표시만 시계에 올라
// 움직임이 끝날 때까지(최대 420ms) 그리고 내려온다. 동시에 움직이는 표시는 4개까지이고 나머지는 바로 끝 자세다. 움직임 줄이기면 늘 끝 자세다.
// 뜻은 이 부품이 말한다(role="img", `label`). 급함은 빛깔이 아니라 틈이 더 열린 모양과 밝기로 다르다.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { isMotionReduced, useMotionReduced } from "../../lib/motion-presets.tsx";
import { cssZoomOf } from "../../lib/zoom.ts";
import { CRYSTAL_SHEET, type CrystalSheetRow } from "./crystal-sheet.ts";
import {
  cueMotion,
  cuesOf,
  poseAt,
  settlesAt,
  stillAt,
  targetPoseOf,
  type CrystalCue,
  type CrystalMotion,
  type CrystalPose,
} from "./crystal-motion.ts";
import { isDark } from "./dot-orb.tsx";

/** 칸 크기(CSS px). 14 내비 줄(size-icon-md), 20 카드 머리 */
export type CrystalMarkSize = 14 | 20;

/** 그리기 배율 상한. 기기 2 × 앱 200%까지 또렷하다 */
const MAX_SCALE = 4;
/** 동시에 움직이는 표시 수 상한(목록이 한꺼번에 바뀌어도 프레임 일이 몇 개뿐이다) */
const MAX_MOVING = 4;
/** 쉬는 자세의 빛(crystal-motion POSE_REST.glow). 이보다 밝은 자세만 한 번 더 얹는다 */
const REST_GLOW = 0.6;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** 판 그림(테마마다 한 장). 처음 그릴 때 읽기 시작하고, 다 읽으면 모든 표시를 다시 그린다 */
const SHEET_URL = {
  dark: new URL("./crystal-dark.png", import.meta.url).href,
  light: new URL("./crystal-light.png", import.meta.url).href,
} as const;
const sheets = new Map<keyof typeof SHEET_URL, HTMLImageElement>();

function sheetOf(dark: boolean): HTMLImageElement | null {
  const key = dark ? "dark" : "light";
  const known = sheets.get(key);
  if (known !== undefined) return known.complete && known.naturalWidth > 0 ? known : null;
  if (typeof Image === "undefined") return null;
  const image = new Image();
  image.decoding = "async";
  image.addEventListener("load", redrawAll, { once: true });
  image.src = SHEET_URL[key];
  sheets.set(key, image);
  return null;
}

/** 기기 px로 `need`인 칸에 쓸 판의 줄: 그보다 크거나 같은 가장 작은 줄(없으면 가장 큰 줄)에서 줄여 그린다 */
export function sheetRowFor(need: number): CrystalSheetRow | undefined {
  return CRYSTAL_SHEET.rows.find((row) => row.box >= need - 0.5) ?? CRYSTAL_SHEET.rows.at(-1);
}

/** 돌림 각 `yaw`를 구운 이웃 두 각과 그 비율로(양 끝 밖은 끝 각 하나) */
export function yawFrames(yaw: number): readonly (readonly [number, number])[] {
  const yaws = CRYSTAL_SHEET.yaws;
  for (let i = 0; i < yaws.length - 1; i++) {
    const lo = yaws[i] ?? 0;
    const hi = yaws[i + 1] ?? 0;
    if (yaw <= hi || i === yaws.length - 2) {
      const k = clamp01((yaw - lo) / (hi - lo));
      const pair: (readonly [number, number])[] = [];
      if (k < 0.999) pair.push([i, 1 - k]);
      if (k > 0.001) pair.push([i + 1, k]);
      return pair;
    }
  }
  return [[0, 1]];
}

/** 빛줄기의 빛깔(옅은 오로라: 라벤더 → 하늘 → 민트). 다크는 거의 흰빛, 라이트는 흰 유리 위에서 보이게 조금 짙다 */
const SWEEP_DARK = ["rgba(236,232,255,", "rgba(226,240,255,", "rgba(228,255,250,"] as const;
const SWEEP_LIGHT = ["rgba(150,138,255,", "rgba(120,170,255,", "rgba(90,205,210,"] as const;

/**
 * 한 자세를 칸 하나(`size` CSS px, 이미 배율이 걸린 ctx)에 그린다. `scale`은 CSS px당 기기 px(판의 줄을 고른다).
 * 판이 아직 없으면(읽는 중) 비워 두고, 다 읽으면 다시 그린다
 */
function paintCrystal(
  ctx: CanvasRenderingContext2D,
  size: number,
  scale: number,
  pose: CrystalPose,
  dark: boolean,
): void {
  ctx.clearRect(0, 0, size, size);
  if (pose.alpha <= 0.001) return;
  const image = sheetOf(dark);
  const row = sheetRowFor(size * scale * pose.scale);
  if (image === null || row === undefined) return;
  const box = row.box;
  const drawn = size * pose.scale;
  const left = (size - drawn) / 2;
  // 모형 1이 칸에서 몇 CSS px인가. 틈은 쉬는 틈(row.half)의 배율과 더 벌어진 거리(split)만큼 두 조각을 갈라진 면을 따라 뗀다
  const unitCss = drawn / 2 / CRYSTAL_SHEET.halfExtent;
  const open = (row.half * (pose.gap - 1) + pose.split) * unitCss;
  const frames = yawFrames(pose.yaw);
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // 이웃 두 각을 더해 섞는다(미리 곱한 값의 합 = 고른 섞음). 두 조각은 겹치지 않는다
  ctx.globalCompositeOperation = "lighter";
  const layer = (alpha: number): void => {
    for (const [frame, weight] of frames) {
      const apart = CRYSTAL_SHEET.apart[frame] ?? [0, 0];
      for (const shard of [0, 1] as const) {
        const sign = shard === 0 ? 1 : -1;
        ctx.globalAlpha = clamp01(alpha * weight);
        ctx.drawImage(
          image,
          (frame * 2 + shard) * box,
          row.top,
          box,
          box,
          left + apart[0] * open * sign,
          left + apart[1] * open * sign,
          drawn,
          drawn,
        );
      }
    }
  };
  layer(pose.alpha);
  // 빛: 쉬는 자세보다 밝은 자세(가리킴·급함)는 같은 그림을 한 번 더 얹는다. 다크는 더해 밝히고, 라이트는 덮어 날이 또렷해진다
  const extra = (pose.glow - REST_GLOW) * (dark ? 1.1 : 0.9);
  if (extra > 0.01) {
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    layer(pose.alpha * extra);
  }
  // 빛줄기: 아래 왼쪽 → 위 오른쪽으로 유리 위만 지난다(움직이는 순간만)
  if (pose.sweep !== null) {
    const s = clamp01((pose.sweep + 1.7) / 3.4);
    const cx = size / 2 + 0.55 * pose.sweep * drawn * 0.27;
    const cy = size / 2 - 0.835 * pose.sweep * drawn * 0.27;
    const w = drawn * 0.24;
    const band = ctx.createLinearGradient(
      cx - 0.55 * w,
      cy + 0.835 * w,
      cx + 0.55 * w,
      cy - 0.835 * w,
    );
    const tone =
      (dark ? SWEEP_DARK : SWEEP_LIGHT)[Math.min(2, Math.floor(s * 3))] ?? "rgba(255,255,255,";
    const peak = (dark ? 0.7 : 0.45) * Math.sin(Math.PI * s);
    band.addColorStop(0, `${tone}0)`);
    band.addColorStop(0.5, `${tone}${peak.toFixed(3)})`);
    band.addColorStop(1, `${tone}0)`);
    ctx.globalCompositeOperation = "source-atop";
    ctx.globalAlpha = 1;
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.restore();
}
// ---------- 시계: 움직이는 표시만 그린다 ----------

interface Inputs {
  readonly present: boolean;
  readonly count: number;
  readonly urgent: boolean;
}

interface Entry {
  readonly canvas: HTMLCanvasElement;
  size: number;
  motion: CrystalMotion;
  present: boolean;
  urgent: boolean;
  hovered: boolean;
  /** 막 붙어 아직 값을 받지 않았다(처음 그림) */
  fresh: boolean;
  /** 나감이 끝났을 때 부른다(부품이 캔버스를 내린다) */
  gone: () => void;
}

const entries = new Set<Entry>();
const moving = new Set<Entry>();
let raf = 0;
let envBound = false;

function draw(entry: Entry, now: number): void {
  const zoom = Math.min(MAX_SCALE, (window.devicePixelRatio || 1) * cssZoomOf(entry.canvas));
  const px = Math.round(entry.size * zoom);
  if (entry.canvas.width !== px) entry.canvas.width = px;
  if (entry.canvas.height !== px) entry.canvas.height = px;
  const ctx = entry.canvas.getContext("2d");
  if (ctx === null) return;
  const unit = px / entry.size;
  ctx.setTransform(unit, 0, 0, unit, 0, 0);
  paintCrystal(ctx, entry.size, unit, poseAt(entry.motion, now), isDark());
}

function settle(entry: Entry, now: number): void {
  moving.delete(entry);
  entry.motion = stillAt(poseAt(entry.motion, now));
  draw(entry, now);
  if (!entry.present) entry.gone();
}

function tick(): void {
  raf = 0;
  const now = performance.now();
  for (const entry of moving) {
    if (now >= settlesAt(entry.motion)) settle(entry, now);
    else draw(entry, now);
  }
  if (moving.size > 0) raf = requestAnimationFrame(tick);
}

/** 상황 하나를 건다. 움직임을 줄이거나 숨은 창이거나 이미 여럿이 움직이면 바로 끝 자세다 */
function cue(entry: Entry, which: CrystalCue): void {
  const now = performance.now();
  const target = targetPoseOf(entry);
  const jump =
    isMotionReduced() ||
    document.visibilityState === "hidden" ||
    (!moving.has(entry) && moving.size >= MAX_MOVING);
  if (jump) {
    moving.delete(entry);
    entry.motion = stillAt(target);
    draw(entry, now);
    if (!entry.present) entry.gone();
    return;
  }
  entry.motion = cueMotion(entry.motion, which, now, target);
  moving.add(entry);
  draw(entry, now);
  if (raf === 0) raf = requestAnimationFrame(tick);
}

/** 테마·배율이 바뀌면 멈춘 표시도 다시 그린다 */
function redrawAll(): void {
  const now = performance.now();
  for (const entry of entries) draw(entry, now);
}

function bindEnv(): void {
  if (envBound) return;
  envBound = true;
  new MutationObserver(redrawAll).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme", "style", "class"],
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", redrawAll);
  window.addEventListener("resize", redrawAll);
}

/** 가리킴·초점·누름을 듣는 자리: 가장 가까운 `[data-crystal-host]`(줄·카드·내비 줄). 없으면 듣지 않는다 */
function listenHost(entry: Entry): () => void {
  const host = entry.canvas.closest("[data-crystal-host]");
  if (host === null) return () => {};
  let pointer = false;
  let focus = false;
  const update = (): void => {
    const hovered = pointer || focus;
    if (hovered === entry.hovered) return;
    entry.hovered = hovered;
    if (entry.present) cue(entry, hovered ? "hover" : "unhover");
  };
  const enter = (): void => {
    pointer = true;
    update();
  };
  const leave = (): void => {
    pointer = false;
    update();
  };
  const focusIn = (event: Event): void => {
    focus = event.target instanceof Element && event.target.matches(":focus-visible");
    update();
  };
  const focusOut = (event: Event): void => {
    const next = event instanceof FocusEvent ? event.relatedTarget : null;
    focus = next instanceof Node && host.contains(next);
    update();
  };
  const down = (event: Event): void => {
    if (event instanceof PointerEvent && event.button !== 0) return;
    if (entry.present) cue(entry, "press");
  };
  const key = (event: Event): void => {
    if (!(event instanceof KeyboardEvent) || event.repeat) return;
    if ((event.key === "Enter" || event.key === " ") && entry.present) cue(entry, "press");
  };
  host.addEventListener("pointerenter", enter);
  host.addEventListener("pointerleave", leave);
  host.addEventListener("focusin", focusIn);
  host.addEventListener("focusout", focusOut);
  host.addEventListener("pointerdown", down);
  host.addEventListener("keydown", key);
  return () => {
    host.removeEventListener("pointerenter", enter);
    host.removeEventListener("pointerleave", leave);
    host.removeEventListener("focusin", focusIn);
    host.removeEventListener("focusout", focusOut);
    host.removeEventListener("pointerdown", down);
    host.removeEventListener("keydown", key);
  };
}

/**
 * 크리스탈 표시 하나. `present`가 false가 되면 두 조각이 갈라지며 나가고(움직임 줄이기면 바로) 자리를 비운다.
 * 처음 그릴 때는 움직이지 않는다(목록을 열 때 여러 표시가 한꺼번에 들어오지 않게): 들어옴은 보이던 부품에서 `present`가 켜질 때다.
 * 가리킴·눌림은 가장 가까운 `[data-crystal-host]` 조상에서 듣는다
 */
export function CrystalMark(props: {
  readonly present: boolean;
  readonly size: CrystalMarkSize;
  /** 화면 읽기 이름: 무엇이 몇 개 기다리는지 */
  readonly label: string;
  /** 기다리는 수. 늘면 튀고 빛이 오르고, 줄면 잦아든다 */
  readonly count?: number;
  /** 시한이 있는 승인이 기다림 */
  readonly urgent?: boolean;
  readonly className?: string;
}): ReactNode {
  const reduced = useMotionReduced();
  const [shown, setShown] = useState(props.present);
  if (props.present && !shown) setShown(true);
  if (!props.present && shown && reduced) setShown(false);
  const ref = useRef<HTMLCanvasElement>(null);
  const entryRef = useRef<Entry | null>(null);
  const prevRef = useRef<Inputs | null>(null);
  const count = props.count ?? 1;
  const urgent = props.urgent === true;

  // 캔버스가 붙으면(또는 칸 크기가 바뀌면) 시계에 올리고 가리킴을 듣는다. 떨어지면 내린다.
  // 값은 마지막으로 본 값(prevRef)에서 잇는다. 처음 붙을 때는 아래 효과가 바로 이어 값과 자세를 넣는다
  useEffect(() => {
    const canvas = ref.current;
    if (!shown || canvas === null) return undefined;
    bindEnv();
    const seen = prevRef.current;
    const present = seen?.present ?? true;
    const seenUrgent = seen?.urgent ?? false;
    const entry: Entry = {
      canvas,
      size: props.size,
      motion: stillAt(targetPoseOf({ present, hovered: false, urgent: seenUrgent })),
      present,
      urgent: seenUrgent,
      hovered: false,
      fresh: seen === null,
      gone: () => {
        setShown(false);
      },
    };
    entries.add(entry);
    entryRef.current = entry;
    const unlisten = listenHost(entry);
    draw(entry, performance.now());
    return () => {
      unlisten();
      entries.delete(entry);
      moving.delete(entry);
      entryRef.current = null;
    };
  }, [shown, props.size]);

  // 값이 바뀌면 상황을 골라 건다. 처음 그릴 때는 움직이지 않고 그 값의 쉬는 자세에 선다
  useEffect(() => {
    const next: Inputs = { present: props.present, count, urgent };
    const cues = cuesOf(prevRef.current, next);
    prevRef.current = next;
    const entry = entryRef.current;
    if (entry === null) return;
    entry.present = props.present;
    entry.urgent = urgent;
    if (entry.fresh) {
      entry.fresh = false;
      entry.motion = stillAt(targetPoseOf(entry));
      draw(entry, performance.now());
    }
    for (const which of cues) cue(entry, which);
  }, [props.present, count, urgent]);

  if (!shown) return null;
  return (
    <span
      role="img"
      aria-label={props.label}
      data-slot="crystal-mark"
      data-state={urgent ? "urgent" : "waiting"}
      className={`fx-crystal${props.className === undefined ? "" : ` ${props.className}`}`}
      style={{ width: props.size, height: props.size }}
    >
      <canvas ref={ref} aria-hidden style={{ width: props.size, height: props.size }} />
    </span>
  );
}
