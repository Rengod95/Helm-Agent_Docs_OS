// 크리스탈 표시(DP-223 [결정: 2026-11-18 사용자 "결정(크리스탈) 버전이 좋음 … 내비 옆에도 괜찮을듯", lcMk]). "내 확인이 필요함"을 말한다.
// 모양은 crystal-geometry.ts(로고의 갈라진 유리 두 조각), 상황별 움직임은 crystal-motion.ts, 여기서는 칠하기와 시계만 한다.
// 칠하기는 시안(`_notes/tools/orbit-mark/crystal-mark.html`)의 "확인 필요" 그대로다: 따뜻한 유리 몸(남보라 + 분홍), 받은 빛에 따라 밝은 면,
// 모서리와 갈라진 틈에 맺힌 호박·분홍·자홍 빛깔(beam의 `--fx-glow-*`). 다크는 빛을 더해(lighter) 그리고, 라이트는 옅은 색면과 짙은 날로 그린다.
// 쉬는 상태는 멈춘 한 장면이다: 값이나 테마가 바뀔 때 한 번 그리고 requestAnimationFrame을 걸지 않는다. 상황이 바뀌면 그 표시만 시계에 올라
// 움직임이 끝날 때까지(최대 420ms) 그리고 내려온다. 동시에 움직이는 표시는 4개까지이고 나머지는 바로 끝 자세다. 움직임 줄이기면 늘 끝 자세다.
// 뜻은 이 부품이 말한다(role="img", `label`). 색에만 기대지 않도록 급함은 틈이 더 열린 모양으로도 다르다.

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

/** beam.css `--fx-glow-*`의 빛깔(sRGB). 시안과 같다 */
const GLOW = {
  orange: [255, 160, 30],
  pink: [255, 50, 100],
  magenta: [240, 50, 180],
  indigo: [100, 70, 255],
  blue: [40, 140, 255],
} as const satisfies Record<string, Rgb>;
const WARM: readonly Rgb[] = [GLOW.orange, GLOW.pink, GLOW.magenta, GLOW.pink];

/** 그리기 배율 상한. 기기 2 × 앱 200%까지 또렷하다 */
const MAX_SCALE = 4;
/** 동시에 움직이는 표시 수 상한(목록이 한꺼번에 바뀌어도 프레임 일이 몇 개뿐이다) */
const MAX_MOVING = 4;
/** 빛이 오는 쪽(왼쪽 위 앞)과 반사 반각 */
const LIGHT = normalize([-0.5, 0.75, 0.6]);
const HALF = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
/** 쉬는 자세의 각(시안 "확인 필요": 요 −0.35 + 0.15, 피치 0.04, 롤 −0.26) */
const BASE_YAW = -0.2;
const PITCH = 0.04;
const ROLL = -0.26;
/** 칸 반지름 대비 결정 반지름. 튐(×1.08)에도 칸을 넘지 않는다 */
const FILL = 0.44;
/** 쉬는 자세의 틈 배율(시안 숨 0.6 → 1 + 0.8 × 0.6) */
const REST_GAP = 1.48;

const mix = (a: Rgb, b: Rgb, k: number): Rgb => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const rgb = (c: Rgb, k = 1): string =>
  `rgb(${c.map((v) => String(Math.round(Math.min(255, v * k)))).join(",")})`;
const rgba = (c: Rgb, a: number): string =>
  `rgba(${c.map((v) => String(Math.round(v))).join(",")},${a.toFixed(3)})`;

/** 따뜻한 빛깔 고리에서 자리 u의 색(부드럽게 잇는다) */
function warmAt(u: number): Rgb {
  const w = ((u % 1) + 1) % 1;
  const x = w * WARM.length;
  const i = Math.floor(x);
  const f = x - i;
  const s = f * f * (3 - 2 * f);
  const a = WARM[i % WARM.length] ?? GLOW.orange;
  const b = WARM[(i + 1) % WARM.length] ?? GLOW.orange;
  return mix(a, b, s);
}

interface Projected {
  readonly n: Vec3;
  readonly points: readonly (readonly [number, number])[];
  readonly z: number;
  readonly u: number;
  readonly cut: boolean;
  readonly seed: number;
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

  const faces: Projected[] = [];
  parts.forEach((part, pi) => {
    const sign = pi === 0 ? 1 : -1;
    const off: Vec3 = [
      CRYSTAL_CUT_N[0] * sign * pose.split,
      CRYSTAL_CUT_N[1] * sign * pose.split,
      CRYSTAL_CUT_N[2] * sign * pose.split,
    ];
    part.forEach((face, fi) => {
      const shift = (p: Vec3): Vec3 =>
        rotate([p[0] + off[0], p[1] + off[1], p[2] + off[2]], yaw, PITCH, ROLL);
      const c = shift(face.c);
      faces.push({
        n: rotate(face.n, yaw, PITCH, ROLL),
        points: face.v.map((p) => {
          const r = shift(p);
          return [cx + r[0] * scale, cy - r[1] * scale] as const;
        }),
        z: c[2],
        u: c[0] * 0.55 + c[1] * 0.85,
        cut: face.cut,
        seed: pi * 0.37 + fi * 0.173,
      });
    });
  });
  faces.sort((a, b) => a.z - b.z);

  const ink: Rgb = dark ? [225, 228, 245] : [70, 76, 110];
  const bodyBase: Rgb = dark ? mix(GLOW.indigo, GLOW.blue, 0.45) : [96, 110, 220];
  const body = mix(bodyBase, GLOW.pink, 0.45);
  const lw = Math.max(small ? 0.7 : 0.75, size * 0.011);
  ctx.save();
  ctx.globalAlpha = Math.min(1, pose.alpha);
  ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
  ctx.lineJoin = "round";

  for (const face of faces) {
    const front = face.n[2] > 0;
    const faceA = front ? 1 : 0.4;
    const lam = Math.max(0, dot(face.n, LIGHT));
    const spec = Math.pow(Math.max(0, dot(face.n, HALF)), 18);
    const sweep =
      pose.sweep === null ? 0 : 0.7 * Math.exp(-Math.pow((face.u - pose.sweep) / 0.5, 2));
    const k = Math.min(
      1.2,
      0.28 + 0.62 * pose.glow * (0.55 + 0.45 * Math.max(0, face.n[2])) + sweep,
    );
    const disp = warmAt((face.u * 0.32 + face.seed) * 0.7);

    const first = face.points[0];
    const across = face.points[2] ?? face.points[1];
    if (first === undefined || across === undefined) continue;
    ctx.beginPath();
    face.points.forEach(([x, y], i) => {
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    if (dark) {
      // 면 안에서 빛이 한쪽으로 기운다(평평한 색면이 아닌 유리)
      const b = (0.13 + 0.4 * lam) * faceA * (small ? 1.8 : 1);
      const channel = (i: 0 | 1 | 2): number =>
        body[i] * b + disp[i] * k * (face.cut ? 0.6 : 0.4) * faceA + 255 * spec * 0.4 * faceA;
      const fill: Rgb = [channel(0), channel(1), channel(2)];
      const g = ctx.createLinearGradient(first[0], first[1], across[0], across[1]);
      g.addColorStop(0, rgb(fill));
      g.addColorStop(1, rgb(fill, 0.55));
      ctx.fillStyle = g;
    } else {
      const a = (0.08 + 0.12 * (1 - lam)) * faceA + k * 0.22 * faceA;
      ctx.fillStyle = rgba(mix(body, disp, Math.min(1, k * 0.9)), Math.min(0.6, a + spec * 0.1));
    }
    ctx.fill();

    // 모서리: 앞면은 또렷한 유리 날, 뒷면은 비쳐 보이는 옅은 선. 빛이 지나는 모서리와 갈라진 틈에 빛깔이 맺힌다
    const edgeK = Math.min(1, k * 1.2 + (face.cut ? 0.35 : 0));
    const ea = front ? (small ? 0.24 : 0.2) + 0.55 * edgeK + spec * 0.3 : small ? 0.05 : 0.07;
    ctx.strokeStyle = rgba(mix(ink, disp, Math.min(1, edgeK * 0.85)), Math.min(1, ea));
    ctx.lineWidth = front ? lw : lw * 0.7;
    ctx.stroke();
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
