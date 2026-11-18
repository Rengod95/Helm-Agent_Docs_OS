// 크리스탈 표시(DP-223 [결정: 2026-11-18 사용자 "결정(크리스탈) 버전이 좋음 … 내비 옆에도 괜찮을듯", lcMk; 재질·색 2026-11-18 "우리 앱 아이콘처럼 더 유리같은 느낌",
// "크리스탈과 어울리는 색 … 오로라 색도 ㄱㅊ음", lcMk2]). "내 확인이 필요함"을 말한다.
// 모양은 crystal-geometry.ts(로고의 갈라진 유리 두 조각), 상황별 움직임은 crystal-motion.ts, 여기서는 칠하기와 시계만 한다.
// 칠하기는 앱 아이콘의 유리다: 거의 비치는 몸(오로라 빛깔이 옅게 든 얼음), 가장자리로 갈수록 밝아지는 안쪽 테(프레넬), 비쳐 보이는 뒷면 모서리(깊이),
// 빛을 받는 윗변의 흰 날과 꼭짓점 하나의 반짝임. 빛깔은 입력창 오로라와 같은 계열(aurora.css·beam.css `--fx-crystal-*`: 보라 h288 → 파랑 h262 → 청록 h210)이고,
// 쉬는 상태는 채도를 눌러 차분하다. 움직이는 순간에만 빛줄기가 유리 안을 지나며 빛깔이 돈다(보라 → 파랑 → 청록 → 자홍). 12~16px에서는 안쪽 모서리를 거의 지우고
// 테와 몸의 투명도 대비로 재질을 낸다.
// 쉬는 상태는 멈춘 한 장면이다: 값이나 테마가 바뀔 때 한 번 그리고 requestAnimationFrame을 걸지 않는다. 상황이 바뀌면 그 표시만 시계에 올라
// 움직임이 끝날 때까지(최대 420ms) 그리고 내려온다. 동시에 움직이는 표시는 4개까지이고 나머지는 바로 끝 자세다. 움직임 줄이기면 늘 끝 자세다.
// 뜻은 이 부품이 말한다(role="img", `label`). 급함은 빛깔이 아니라 틈이 더 열린 모양과 밝기로 다르다.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { isMotionReduced, useMotionReduced } from "../../lib/motion-presets.tsx";
import { cssZoomOf } from "../../lib/zoom.ts";
import {
  CRYSTAL_CUT_N,
  CRYSTAL_RADIUS,
  crystalShards,
  normalize,
  rotate,
  type Vec3,
} from "./crystal-geometry.ts";
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

/** 칸 크기(CSS px). 12 좁은 칸, 14 대화 줄·내비 줄(size-icon-md), 16 줄 상태 칸, 20 카드 머리 */
export type CrystalMarkSize = 12 | 14 | 16 | 20;

type Rgb = readonly [number, number, number];
type Point = readonly [number, number];

/**
 * 오로라 빛깔 고리(sRGB). 앞 셋은 `--fx-crystal-a·b·c`(aurora.css의 보라 h288, 파랑 h262, 청록 h210과 같은 계열)를 옮긴 값이고,
 * 넷째는 beam `--fx-glow-magenta`를 눌러 쓴 자홍이다(빛줄기가 지날 때만 보인다). 다크는 밝고 라이트는 짙다
 */
const RING_DARK: readonly Rgb[] = [
  [161, 144, 255],
  [102, 155, 255],
  [71, 210, 232],
  [214, 120, 230],
];
const RING_LIGHT: readonly Rgb[] = [
  [116, 86, 224],
  [45, 105, 222],
  [0, 154, 177],
  [186, 70, 190],
];
/** 빛깔이 빠진 유리(얼음). 채도를 누르면 이 색으로 간다 */
const ICE_DARK: Rgb = [214, 226, 255];
const ICE_LIGHT: Rgb = [150, 170, 215];
/** 라이트의 바깥 날(짙은 청회색). 흰 바탕에서 유리의 윤곽을 잡는다 */
const SLATE: Rgb = [58, 70, 112];
const WHITE: Rgb = [255, 255, 255];

/** 그리기 배율 상한. 기기 2 × 앱 200%까지 또렷하다 */
const MAX_SCALE = 4;
/** 동시에 움직이는 표시 수 상한(목록이 한꺼번에 바뀌어도 프레임 일이 몇 개뿐이다) */
const MAX_MOVING = 4;
/** 빛이 오는 쪽(왼쪽 위 앞)과 반사 반각 */
const LIGHT = normalize([-0.5, 0.75, 0.6]);
const HALF = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
/** 화면에서 빛이 오는 쪽(왼쪽 위, 캔버스 y는 아래로) */
const LIGHT_2D: Point = [-0.55, -0.835];
/** 쉬는 자세의 각(시안 "확인 필요": 요 −0.35 + 0.15, 피치 0.04, 롤 −0.26) */
const BASE_YAW = -0.2;
const PITCH = 0.04;
const ROLL = -0.26;
/** 칸 반지름 대비 결정 반지름. 튐(×1.08)에도 칸을 넘지 않는다 */
const FILL = 0.44;
/** 쉬는 자세의 틈 배율(시안 숨 0.6 → 1 + 0.8 × 0.6) */
const REST_GAP = 1.48;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const mix = (a: Rgb, b: Rgb, k: number): Rgb => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rgba = (c: Rgb, a: number): string =>
  `rgba(${c.map((v) => String(Math.round(Math.min(255, Math.max(0, v))))).join(",")},${clamp01(a).toFixed(3)})`;

/** 오로라 고리에서 자리 u의 색(부드럽게 잇는다) */
function ringAt(ring: readonly Rgb[], u: number): Rgb {
  const w = ((u % 1) + 1) % 1;
  const x = w * ring.length;
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  const first = ring[0] ?? WHITE;
  return mix(ring[i % ring.length] ?? first, ring[(i + 1) % ring.length] ?? first, s);
}

/** 2차원 볼록 껍질(조각 하나의 화면 윤곽). 차례는 화면에서 시계 방향이 아니어도 된다 */
function hull2d(points: readonly Point[]): Point[] {
  const pts = points.toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: Point, a: Point, b: Point): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2) {
      const a = lower[lower.length - 2];
      const b = lower[lower.length - 1];
      if (a === undefined || b === undefined || cross(a, b, p) > 1e-9) break;
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (const p of pts.toReversed()) {
    while (upper.length >= 2) {
      const a = upper[upper.length - 2];
      const b = upper[upper.length - 1];
      if (a === undefined || b === undefined || cross(a, b, p) > 1e-9) break;
      upper.pop();
    }
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function tracePath(ctx: CanvasRenderingContext2D, points: readonly Point[]): void {
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
}

interface Projected {
  readonly n: Vec3;
  readonly points: readonly Point[];
  readonly z: number;
  readonly cut: boolean;
}

interface Shard {
  readonly faces: readonly Projected[];
  readonly outline: readonly Point[];
  readonly z: number;
  /** 틈을 향한 화면 방향(갈라진 면의 법선을 화면에 옮긴 것) */
  readonly toward: Point;
}

/** 한 자세를 칸 하나(`size` CSS px, 이미 배율이 걸린 ctx)에 그린다 */
function paintCrystal(
  ctx: CanvasRenderingContext2D,
  size: number,
  pose: CrystalPose,
  dark: boolean,
): void {
  ctx.clearRect(0, 0, size, size);
  if (pose.alpha <= 0.001) return;
  const small = size <= 20;
  const unit = (size * FILL) / CRYSTAL_RADIUS;
  const scale = unit * pose.scale;
  const gapPx = Math.max(small ? 1.3 : 1.5, size * 0.04) * REST_GAP * pose.gap;
  const parts = crystalShards(gapPx / unit / 2);
  const yaw = BASE_YAW + pose.yaw;
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * FILL * pose.scale;

  const shards: Shard[] = parts.map((part, pi) => {
    const sign = pi === 0 ? 1 : -1;
    const off: Vec3 = [
      CRYSTAL_CUT_N[0] * sign * pose.split,
      CRYSTAL_CUT_N[1] * sign * pose.split,
      CRYSTAL_CUT_N[2] * sign * pose.split,
    ];
    const shift = (p: Vec3): Vec3 =>
      rotate([p[0] + off[0], p[1] + off[1], p[2] + off[2]], yaw, PITCH, ROLL);
    const faces = part.map((face): Projected => {
      const c = shift(face.c);
      return {
        n: rotate(face.n, yaw, PITCH, ROLL),
        points: face.v.map((p): Point => {
          const r = shift(p);
          return [cx + r[0] * scale, cy - r[1] * scale];
        }),
        z: c[2],
        cut: face.cut,
      };
    });
    const z = faces.reduce((acc, f) => acc + f.z, 0) / Math.max(1, faces.length);
    // 조각 +1은 갈라진 면 법선 쪽에 있다: 틈은 그 반대쪽이다
    const cutN = rotate(CRYSTAL_CUT_N, yaw, PITCH, ROLL);
    const len = Math.hypot(cutN[0], cutN[1]) || 1;
    const toward: Point = [(-sign * cutN[0]) / len, (sign * cutN[1]) / len];
    return { faces, outline: hull2d(faces.flatMap((f) => f.points)), z, toward };
  });
  shards.sort((a, b) => a.z - b.z);

  // 작은 칸일수록 안쪽 모서리를 지우고 테·윤곽의 대비를 올린다(12 → 0, 24 이상 → 1)
  const detail = clamp01((size - 12) / 12);
  const tiny = 1 - detail;
  // 쉬는 자세(빛 0.6)는 채도를 누른다. 가리킴·급함·움직임에서 빛깔이 오른다
  // 빛줄기가 지나는 동안(s 0 → 1)만 빛깔 고리가 한 번 돌고 채도가 오른다. 양 끝(s 0, 1)에서 0이라 멈출 때 튀지 않는다
  const passing = pose.sweep === null ? 0 : Math.sin(Math.PI * clamp01((pose.sweep + 1.7) / 3.4));
  const sat = clamp01(0.55 + 1.1 * (pose.glow - 0.6) + 0.35 * passing);
  const turn = 0.45 * passing;
  const ring = dark ? RING_DARK : RING_LIGHT;
  const ice = dark ? ICE_DARK : ICE_LIGHT;
  const tint = (u: number, k = 1): Rgb => mix(ice, ringAt(ring, u), clamp01(sat * k));
  const lw = Math.max(small ? 0.75 : 0.8, size * 0.012);
  const rim = Math.max(0.65, size * 0.05);

  // 아래 왼쪽(보라) → 위 오른쪽(청록)으로 흐르는 오로라 몸
  const across = (alpha: number, k = 1): CanvasGradient => {
    const g = ctx.createLinearGradient(
      cx - radius * 0.45,
      cy + radius * 0.9,
      cx + radius * 0.45,
      cy - radius * 0.9,
    );
    for (let i = 0; i <= 4; i++) g.addColorStop(i / 4, rgba(tint((i / 4) * 0.62 + turn, k), alpha));
    return g;
  };

  ctx.save();
  ctx.globalAlpha = Math.min(1, pose.alpha);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const glow = pose.glow;

  for (const shard of shards) {
    const outline = shard.outline;
    if (outline.length < 3) continue;
    // 틈 쪽 변: 갈라진 면에서 빛이 갈라져 빛깔이 가장 짙게 맺힌다
    const [towardX, towardY] = shard.toward;
    const midX = outline.reduce((acc, p) => acc + p[0], 0) / outline.length;
    const midY = outline.reduce((acc, p) => acc + p[1], 0) / outline.length;
    ctx.save();
    tracePath(ctx, outline);
    ctx.clip();

    // 몸: 거의 비치는 유리. 빛깔은 옅게 든다
    tracePath(ctx, outline);
    ctx.fillStyle = across(dark ? 0.1 + 0.16 * glow : 0.12 + 0.1 * glow);
    ctx.fill();

    // 면: 빛을 받는 면은 희게, 비스듬한 면(가장자리 쪽)은 빛깔이 짙게(프레넬)
    for (const face of shard.faces) {
      if (face.n[2] <= 0 || face.points.length < 3) continue;
      const graze = Math.pow(1 - face.n[2], 2);
      const spec = Math.pow(Math.max(0, dot(face.n, HALF)), 14);
      tracePath(ctx, face.points);
      if (face.cut) {
        // 갈라진 면: 프리즘처럼 빛깔이 가장 짙다
        ctx.fillStyle = across(dark ? 0.32 + 0.3 * glow : 0.26 + 0.2 * glow, 1.6);
        ctx.fill();
        continue;
      }
      ctx.fillStyle = rgba(
        WHITE,
        (dark ? 0.04 + 0.42 * spec : 0.1 + 0.5 * spec) * (0.7 + 0.3 * glow),
      );
      ctx.fill();
      if (graze > 0.08) {
        ctx.fillStyle = across((dark ? 0.16 : 0.12) * graze * (0.6 + 0.6 * glow), 1.3);
        ctx.fill();
      }
    }

    // 안쪽 테(프레넬): 윤곽에서 안으로 갈수록 옅어지는 오로라 빛. 넓고 옅은 겹 위에 좁고 짙은 겹
    tracePath(ctx, outline);
    ctx.strokeStyle = across((dark ? 0.14 : 0.12) + 0.1 * glow, 1.4);
    ctx.lineWidth = rim * 3.2;
    ctx.stroke();
    ctx.strokeStyle = across((dark ? 0.34 : 0.26) + 0.24 * glow + 0.1 * tiny, 1.6);
    ctx.lineWidth = rim * 1.3;
    ctx.stroke();

    // 깊이: 뒷면 모서리가 비쳐 보이고, 앞면 안쪽 모서리는 가는 날이다(작은 칸에서는 거의 지운다)
    for (const face of shard.faces) {
      tracePath(ctx, face.points);
      const front = face.n[2] > 0;
      const ink = dark ? ICE_DARK : SLATE;
      ctx.strokeStyle = rgba(ink, front ? (dark ? 0.32 : 0.26) * detail + 0.06 : 0.14 * detail);
      ctx.lineWidth = front ? lw * 0.8 : lw * 0.6;
      ctx.stroke();
    }
    ctx.restore();

    // 윤곽: 빛 쪽 변은 흰 날, 반대쪽은 빛깔이 든 옅은 날. 라이트는 짙은 청회 날 안쪽에 흰 날을 겹친다
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      if (a === undefined || b === undefined) continue;
      const ex = b[0] - a[0];
      const ey = b[1] - a[1];
      const len = Math.hypot(ex, ey) || 1;
      // 바깥 법선(윤곽 차례와 무관하게 조각 가운데에서 멀어지는 쪽)
      let nx = ey / len;
      let ny = -ex / len;
      const mx = (a[0] + b[0]) / 2;
      const my = (a[1] + b[1]) / 2;
      if (nx * (mx - midX) + ny * (my - midY) < 0) {
        nx = -nx;
        ny = -ny;
      }
      const lit = clamp01(0.5 + 0.5 * (nx * LIGHT_2D[0] + ny * LIGHT_2D[1]));
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      if (nx * towardX + ny * towardY > 0.5) {
        ctx.strokeStyle = across((dark ? 0.6 : 0.55) + 0.3 * glow, 1.5);
        ctx.lineWidth = Math.max(lw * 1.1, size * 0.024);
        ctx.stroke();
      } else if (dark) {
        ctx.strokeStyle = rgba(
          mix(WHITE, tint(0.2 + 0.4 * (1 - lit)), 0.55 * (1 - lit)),
          0.42 + 0.5 * lit + 0.1 * tiny + 0.08 * glow,
        );
        ctx.lineWidth = lw;
        ctx.stroke();
      } else {
        ctx.strokeStyle = rgba(
          mix(SLATE, tint(0.3, 1.2), 0.35 * (1 - lit)),
          0.36 + 0.24 * (1 - lit) + 0.12 * tiny,
        );
        ctx.lineWidth = lw;
        ctx.stroke();
        if (lit > 0.55) {
          // 흰 날: 윤곽 바로 안쪽
          const inset = lw * 0.9;
          ctx.beginPath();
          ctx.moveTo(a[0] - nx * inset, a[1] - ny * inset);
          ctx.lineTo(b[0] - nx * inset, b[1] - ny * inset);
          ctx.strokeStyle = rgba(WHITE, 0.9 * (lit - 0.4));
          ctx.lineWidth = lw * 0.9;
          ctx.stroke();
        }
      }
    }
  }

  // 빛줄기: 유리 안을 지나며 빛깔이 돈다(움직이는 순간만)
  if (pose.sweep !== null) {
    const s = clamp01((pose.sweep + 1.7) / 3.4);
    const dx = 0.55;
    const dy = -0.835;
    const px = cx + dx * pose.sweep * radius * 0.62;
    const py = cy + dy * pose.sweep * radius * 0.62;
    const w = radius * 0.5;
    const band = ctx.createLinearGradient(px - dx * w, py - dy * w, px + dx * w, py + dy * w);
    const hue = ringAt(ring, 0.1 + s * 0.85);
    band.addColorStop(0, rgba(hue, 0));
    band.addColorStop(0.5, rgba(mix(hue, WHITE, dark ? 0.25 : 0.1), dark ? 0.75 : 0.55));
    band.addColorStop(1, rgba(hue, 0));
    ctx.save();
    ctx.beginPath();
    for (const shard of shards) {
      shard.outline.forEach(([x, y], i) => {
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
    }
    ctx.clip();
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    ctx.fillStyle = band;
    ctx.fillRect(0, 0, size, size);
    ctx.restore();
  }

  // 반짝임: 빛 쪽 꼭짓점 하나에 맺힌다
  const top = shards
    .flatMap((shard) => shard.outline)
    .reduce<Point | null>(
      (best, p) =>
        best === null ||
        p[0] * LIGHT_2D[0] + p[1] * LIGHT_2D[1] > best[0] * LIGHT_2D[0] + best[1] * LIGHT_2D[1]
          ? p
          : best,
      null,
    );
  if (top !== null) {
    const gx = top[0] + (cx - top[0]) * 0.22;
    const gy = top[1] + (cy - top[1]) * 0.22;
    const r = Math.max(1.4, size * 0.1);
    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, r);
    const a = (dark ? 0.85 : 0.95) * (0.6 + 0.4 * glow);
    g.addColorStop(0, rgba(WHITE, a));
    g.addColorStop(0.35, rgba(WHITE, a * 0.45));
    g.addColorStop(1, rgba(WHITE, 0));
    ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
    ctx.fillStyle = g;
    ctx.fillRect(gx - r, gy - r, r * 2, r * 2);
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
  paintCrystal(ctx, entry.size, poseAt(entry.motion, now), isDark());
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
