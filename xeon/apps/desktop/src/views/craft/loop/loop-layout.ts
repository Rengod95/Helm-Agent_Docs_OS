// 구성 탭 캔버스(plugHead)의 자리 계산. 순수 함수만 둔다. 좌표는 그래프 좌표(배율 1)이고 화면은 이것을 폭에 맞춰 줄이거나 키운다.
// 위에서 아래로: 재료 줄(이 플러그인이 블록에 넣는 것) → 루프 줄(경계 셋, 블록 다섯) → Hook 줄(지점마다 카드) → 기록 띠(턴 내내) → Drive 줄.
// 줄 위 지점의 폭과 간격, 카드 크기는 4의 배수이고 글이 두 줄까지 들어가는 값이다.
import {
  CALLED_BLOCKS,
  hookLinesOf,
  hooksBySpot,
  isBoundary,
  pointOfSpot,
  RAIL_POINTS,
  spotKey,
  type FeedPoint,
  type LoopFeed,
  type LoopHook,
  type LoopPlan,
  type LoopStep,
  type PointId,
  type Spot,
} from "./loop-model.ts";

const BOUNDARY_W = 88;
const BLOCK_W = 112;
const POINT_GAP = 32;
const BLOCK_H = 56;
const BOUNDARY_H = 40;
/** 블록 문(앞, 뒤)이 블록 끝에서 떨어진 거리 */
const GATE_OFFSET = 14;
/** 다음 단계로 돌아가는 호가 루프 줄 위로 뜨는 높이 */
const ARC_RISE = 28;
const FEED_W = 208;
const FEED_HEAD = 40;
const FEED_ROW = 20;
/** 재료 카드에 이름을 몇 줄까지 보이나(나머지는 "외 N개") */
export const FEED_SHOWN = 3;
const LANE_GAP = 48;
const HOOK_W = 208;
const HOOK_HEAD = 40;
const HOOK_ROW = 32;
const CARD_GAP = 12;
const RECORD_H = 40;
const DRIVE_HEAD = 56;
const STEP_W = 176;
const STEP_H = 32;
const STEP_GAP = 8;
const DRIVE_PAD = 16;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

interface FeedBox {
  readonly feed: LoopFeed;
  readonly rect: Rect;
}

interface HookBox {
  readonly spot: Spot;
  readonly hooks: readonly LoopHook[];
  readonly rect: Rect;
  /** 카드와 이을 문이나 지점의 좌표. 루프 밖 카드는 null */
  readonly anchor: { readonly x: number; readonly y: number } | null;
}

interface StepBox {
  readonly step: LoopStep;
  readonly rect: Rect;
}

export interface LoopLayout {
  readonly width: number;
  readonly height: number;
  readonly points: ReadonlyMap<PointId, Rect>;
  /** 루프 줄의 가운데 높이(선과 문이 서는 y) */
  readonly railY: number;
  readonly feeds: readonly FeedBox[];
  readonly hooks: readonly HookBox[];
  readonly record: Rect;
  readonly drive: { readonly rect: Rect; readonly steps: readonly StepBox[] } | null;
  /** 다음 단계로 돌아가는 호: 서브에이전트 위에서 컨텍스트 조립 위로 */
  readonly arc: {
    readonly fromX: number;
    readonly toX: number;
    readonly topY: number;
    readonly railTop: number;
  };
}

/** 줄 위 지점마다의 가로 자리(왼쪽 끝 0부터) */
function railXs(): ReadonlyMap<PointId, { x: number; w: number }> {
  const xs = new Map<PointId, { x: number; w: number }>();
  let x = 0;
  for (const point of RAIL_POINTS) {
    const w = isBoundary(point) ? BOUNDARY_W : BLOCK_W;
    xs.set(point, { x, w });
    x += w + POINT_GAP;
  }
  return xs;
}

/** 줄의 오른쪽 끝 */
function railRight(xs: ReadonlyMap<PointId, { x: number; w: number }>): number {
  const last = xs.get("before-turn-end");
  return last === undefined ? 0 : last.x + last.w;
}

/** 자리의 가로 좌표(문은 블록 끝에서 `GATE_OFFSET`, 경계는 가운데). 기록과 루프 밖은 null */
function spotX(spot: Spot, xs: ReadonlyMap<PointId, { x: number; w: number }>): number | null {
  if (spot.kind === "gate") {
    const at = xs.get(spot.block);
    if (at === undefined) return null;
    return spot.side === "before" ? at.x - GATE_OFFSET : at.x + at.w + GATE_OFFSET;
  }
  if (spot.kind === "on" && spot.point !== "record") {
    const at = xs.get(spot.point);
    return at === undefined ? null : at.x + at.w / 2;
  }
  return null;
}

/** 원하는 가운데 x들을 겹치지 않게 왼쪽부터 민다(순서는 원하는 x 순) */
function pack<T>(
  items: readonly { readonly item: T; readonly want: number; readonly w: number }[],
): readonly { readonly item: T; readonly x: number }[] {
  const sorted = items.toSorted((a, b) => a.want - b.want);
  const out: { item: T; x: number }[] = [];
  let next = Number.NEGATIVE_INFINITY;
  for (const entry of sorted) {
    const x = Math.max(entry.want - entry.w / 2, next);
    out.push({ item: entry.item, x });
    next = x + entry.w + CARD_GAP;
  }
  return out;
}

function feedHeight(feed: LoopFeed): number {
  const rows = Math.min(feed.items.length, FEED_SHOWN) + (feed.items.length > FEED_SHOWN ? 1 : 0);
  return FEED_HEAD + rows * FEED_ROW + 12;
}

function hookHeight(count: number): number {
  return HOOK_HEAD + count * HOOK_ROW + 8;
}

/** 자리 묶음의 순서: 줄 위 순서(문은 앞이 뒤보다 먼저), 기록, 루프 밖 */
function spotOrder(spot: Spot): number {
  const point = pointOfSpot(spot);
  if (point === null) return 1000;
  if (point === "record") return 900;
  const index = RAIL_POINTS.indexOf(point);
  const side = spot.kind === "gate" ? (spot.side === "before" ? 0 : 2) : 1;
  return index * 3 + side;
}

export function loopLayoutOf(plan: LoopPlan): LoopLayout {
  const xs = railXs();
  const right = railRight(xs);
  // 재료 줄
  const feedPacked = pack(
    plan.feeds.map((feed) => {
      const at = xs.get(feed.point);
      return { item: feed, want: at === undefined ? 0 : at.x + at.w / 2, w: FEED_W };
    }),
  );
  const feedH = plan.feeds.reduce((max, feed) => Math.max(max, feedHeight(feed)), 0);
  const railTop = (feedH > 0 ? feedH + LANE_GAP : 0) + ARC_RISE + 16;
  const railY = railTop + BLOCK_H / 2;
  const feeds: FeedBox[] = feedPacked.map(({ item, x }) => ({
    feed: item,
    rect: { x, y: 0, w: FEED_W, h: feedHeight(item) },
  }));
  const points = new Map<PointId, Rect>();
  for (const point of RAIL_POINTS) {
    const at = xs.get(point);
    if (at === undefined) continue;
    const h = isBoundary(point) ? BOUNDARY_H : BLOCK_H;
    points.set(point, { x: at.x, y: railY - h / 2, w: at.w, h });
  }
  // Hook 줄: 자리마다 카드 하나. 기록 구독은 줄 오른쪽 끝, 루프 밖은 그 뒤
  const hookTop = railTop + BLOCK_H + LANE_GAP;
  const groups = hooksBySpot(plan.hooks).toSorted((a, b) => spotOrder(a.spot) - spotOrder(b.spot));
  const hookPacked = pack(
    groups.map((group) => {
      const x = spotX(group.spot, xs);
      const want = x ?? (group.spot.kind === "outside" ? right + HOOK_W : right - HOOK_W / 2);
      return { item: group, want, w: HOOK_W };
    }),
  );
  const hookH = groups.reduce(
    (max, group) => Math.max(max, hookHeight(hookLinesOf(group.hooks).length)),
    0,
  );
  const recordTop = hookTop + (hookH > 0 ? hookH + LANE_GAP : 0);
  const record: Rect = { x: 0, y: recordTop, w: right, h: RECORD_H };
  const hooks: HookBox[] = hookPacked.map(({ item, x }) => {
    const sx = spotX(item.spot, xs);
    const rect = { x, y: hookTop, w: HOOK_W, h: hookHeight(hookLinesOf(item.hooks).length) };
    const anchor =
      sx !== null
        ? { x: sx, y: railY }
        : item.spot.kind === "on"
          ? { x: x + HOOK_W / 2, y: recordTop }
          : null;
    return { spot: item.spot, hooks: item.hooks, rect, anchor };
  });
  // Drive 줄: 컨텍스트 조립부터 서브에이전트까지(턴을 쥐는 구간) 넓은 카드 하나, 안에 단계 칸
  const context = xs.get("context");
  const agents = xs.get("agents");
  let drive: LoopLayout["drive"] = null;
  if (plan.drive !== null && context !== undefined && agents !== undefined) {
    const x = context.x;
    const w = agents.x + agents.w - context.x;
    const cols = Math.max(1, Math.floor((w - DRIVE_PAD * 2 + STEP_GAP) / (STEP_W + STEP_GAP)));
    const rows = Math.ceil(plan.drive.steps.length / cols);
    const y = recordTop + RECORD_H + LANE_GAP;
    const h = DRIVE_HEAD + rows * (STEP_H + STEP_GAP) + (rows > 0 ? DRIVE_PAD - STEP_GAP : 0);
    const steps: StepBox[] = plan.drive.steps.map((step, index) => ({
      step,
      rect: {
        x: x + DRIVE_PAD + (index % cols) * (STEP_W + STEP_GAP),
        y: y + DRIVE_HEAD + Math.floor(index / cols) * (STEP_H + STEP_GAP),
        w: STEP_W,
        h: STEP_H,
      },
    }));
    drive = { rect: { x, y, w, h }, steps };
  }
  const bottom = drive === null ? record.y + record.h : drive.rect.y + drive.rect.h;
  const widest = Math.max(
    right,
    ...feeds.map((box) => box.rect.x + box.rect.w),
    ...hooks.map((box) => box.rect.x + box.rect.w),
  );
  const leftmost = Math.min(
    0,
    ...feeds.map((box) => box.rect.x),
    ...hooks.map((box) => box.rect.x),
  );
  const shift = -leftmost;
  const moved = (rect: Rect): Rect => ({ ...rect, x: rect.x + shift });
  const ctxAt = points.get("context");
  const agentsAt = points.get("agents");
  return {
    width: widest + shift,
    height: bottom,
    points: new Map([...points.entries()].map(([id, rect]) => [id, moved(rect)])),
    railY,
    feeds: feeds.map((box) => Object.assign({}, box, { rect: moved(box.rect) })),
    hooks: hooks.map((box) =>
      Object.assign({}, box, {
        rect: moved(box.rect),
        anchor: box.anchor === null ? null : { x: box.anchor.x + shift, y: box.anchor.y },
      }),
    ),
    record: moved(record),
    drive:
      drive === null
        ? null
        : {
            rect: moved(drive.rect),
            steps: drive.steps.map((box) => Object.assign({}, box, { rect: moved(box.rect) })),
          },
    arc: {
      fromX: (agentsAt === undefined ? 0 : agentsAt.x + agentsAt.w * 0.75) + shift,
      toX: (ctxAt === undefined ? 0 : ctxAt.x + ctxAt.w * 0.75) + shift,
      topY: railTop - ARC_RISE,
      railTop,
    },
  };
}

/** 자리의 그림 좌표(문이면 줄 위, 경계면 지점 가운데, 기록이면 띠 위). 루프 밖이면 null */
export function spotPoint(layout: LoopLayout, spot: Spot): { x: number; y: number } | null {
  if (spot.kind === "outside") return null;
  if (spot.kind === "on" && spot.point === "record") {
    return { x: layout.record.x + layout.record.w / 2, y: layout.record.y };
  }
  if (spot.kind === "on") {
    const rect = layout.points.get(spot.point);
    return rect === undefined ? null : { x: rect.x + rect.w / 2, y: layout.railY };
  }
  const rect = layout.points.get(spot.block);
  if (rect === undefined) return null;
  return {
    x: spot.side === "before" ? rect.x - GATE_OFFSET : rect.x + rect.w + GATE_OFFSET,
    y: layout.railY,
  };
}

/** 문 자리(블록 앞뒤)만, 겹치지 않게. 캔버스는 여기에 작은 마름모를 그린다 */
export function gateSpotsOf(plan: LoopPlan): readonly Spot[] {
  const seen = new Map<string, Spot>();
  const add = (spot: Spot): void => {
    if (spot.kind === "gate") seen.set(spotKey(spot), spot);
  };
  for (const hook of plan.hooks) hook.spots.forEach(add);
  for (const step of plan.drive?.steps ?? []) step.spots.forEach(add);
  return [...seen.values()];
}

/** 모델이 부를 때만 지나는 블록인가(점선 테두리) */
export function isCalled(point: PointId): boolean {
  return CALLED_BLOCKS.some((block) => block === point);
}

/** 재료가 넣는 블록의 위쪽 가운데(재료 선이 닿는 곳) */
export function feedTarget(layout: LoopLayout, point: FeedPoint): { x: number; y: number } | null {
  const rect = layout.points.get(point);
  return rect === undefined ? null : { x: rect.x + rect.w / 2, y: rect.y };
}
