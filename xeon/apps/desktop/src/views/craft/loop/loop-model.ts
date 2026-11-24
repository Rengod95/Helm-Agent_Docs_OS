// 구성 탭 캔버스(plugHead, AGE-76)의 순수 모델: 플러그인 하나가 에이전트 루프의 어느 지점에 어떻게 붙는지.
// 루프의 뼈대는 엔진의 블록 모델(`@fresnel/contracts/blocks`의 `BLOCK_MODEL`: 블록 여섯, 경계 셋)이고, 훅의 자리는 계약의
// 위치 표(`HOOK_POSITIONS`)와 선언 표(`HOOKS`의 fold)에서 읽는다. 플러그인 쪽 값은 카드(`plugin.list`의 하는 일),
// 매니페스트의 훅 목록(`ext.get`), Drive 구성 선언의 블록(`blockRowsOf`)에서만 온다. 지어낸 자리나 이름은 없다.
import { assertNever } from "@fresnel/contracts";
import {
  HOOK_NAMES,
  HOOK_POSITIONS,
  HOOKS,
  type Fold,
  type HookName,
  type HookPosition,
  type HookPower,
  type PluginCard,
} from "@fresnel/contracts/extensions";
import type { BlockRow, InspectHookVM } from "@fresnel/client/workbench";

/** 엔진의 블록(계약 `BlockId`와 같은 값) */
export type LoopBlock = "context" | "model" | "tools" | "ask" | "agents" | "record";
/** 엔진의 경계(계약 `BoundaryId`와 같은 값) */
export type LoopBoundary = "conversation-start" | "input-received" | "before-turn-end";
/** 캔버스 줄 위의 지점: 블록 여섯과 경계 셋 */
export type PointId = LoopBlock | LoopBoundary;

/** 줄 위 지점의 순서(왼쪽에서 오른쪽). 기록은 턴 내내 듣는 블록이라 줄 밖 아래 띠로 그린다 */
export const RAIL_POINTS: readonly PointId[] = [
  "conversation-start",
  "input-received",
  "context",
  "model",
  "tools",
  "ask",
  "agents",
  "before-turn-end",
];

/** 모델이 부를 때만 지나는 블록(줄 위 괄호 "모델이 부를 때만"). 끝나면 결과를 들고 다음 단계의 컨텍스트 조립으로 돌아간다 */
export const CALLED_BLOCKS: readonly LoopBlock[] = ["tools", "ask", "agents"];

export function isBoundary(point: PointId): point is LoopBoundary {
  return (
    point === "conversation-start" || point === "input-received" || point === "before-turn-end"
  );
}

/** 무엇이 붙는 자리: 블록의 앞이나 뒤(문), 경계나 기록 위, 루프 밖(엔진 안) */
export type Spot =
  | {
      readonly kind: "gate";
      readonly block: Exclude<LoopBlock, "record">;
      readonly side: "before" | "after";
    }
  | { readonly kind: "on"; readonly point: LoopBoundary | "record" }
  | { readonly kind: "outside" };

/** 자리의 비교 열쇠 */
export function spotKey(spot: Spot): string {
  switch (spot.kind) {
    case "gate":
      return `${spot.side}:${spot.block}`;
    case "on":
      return `on:${spot.point}`;
    case "outside":
      return "outside";
    default:
      return assertNever(spot, "spotKey");
  }
}

/** 자리가 서는 줄 위 지점. 루프 밖이면 null */
export function pointOfSpot(spot: Spot): PointId | null {
  if (spot.kind === "gate") return spot.block;
  if (spot.kind === "on") return spot.point;
  return null;
}

/** 계약의 위치 하나를 캔버스의 자리로. 닻 없는 소식은 기록 블록의 구독이다(블록 모델과 같은 규칙) */
export function spotOfPosition(position: HookPosition): Spot {
  switch (position.kind) {
    case "block":
      return { kind: "gate", block: position.block, side: position.side };
    case "boundary":
      return { kind: "on", point: position.boundary };
    case "event": {
      const anchor = position.anchor;
      if (anchor === undefined || anchor.block === "record") return { kind: "on", point: "record" };
      return { kind: "gate", block: anchor.block, side: anchor.side };
    }
    case "internal":
      return { kind: "outside" };
    default:
      return assertNever(position, "spotOfPosition");
  }
}

const HOOK_SET: ReadonlySet<string> = new Set(HOOK_NAMES);

function knownHook(name: string): name is HookName {
  return HOOK_SET.has(name);
}

/** 이 플러그인의 훅 하나 */
export interface LoopHook {
  readonly name: string;
  /** 계약에 있는 훅 이름인가. 아니면 자리가 없다 */
  readonly known: boolean;
  /** 서는 자리(계약 위치 표 순서). 한 훅이 두 자리에 서기도 한다(`guard.output.before`) */
  readonly spots: readonly Spot[];
  /** 블록 앞뒤의 문이 아니라 지나간 일을 알리는 소식인가(계약 위치의 `event`) */
  readonly event: boolean;
  readonly fold: Fold | null;
  readonly powers: readonly HookPower[];
  /** 지금 엔진이 이 지점을 부르는가. 거짓이면 선언만 있다 */
  readonly fired: boolean;
  /** 계측(`ext.timings`)과 예산을 합친 줄. 매니페스트 훅 목록에서 왔으면 있다 */
  readonly measure: InspectHookVM | null;
}

export function loopHookOf(name: string, measure: InspectHookVM | null): LoopHook {
  if (!knownHook(name)) {
    return {
      name,
      known: false,
      spots: [],
      event: false,
      fold: null,
      powers: [],
      fired: false,
      measure,
    };
  }
  const row = HOOK_POSITIONS[name];
  return {
    name,
    known: true,
    spots: row.positions.map(spotOfPosition),
    event: row.positions.every((position) => position.kind === "event"),
    fold: HOOKS[name].fold,
    powers: row.powers,
    fired: row.fired,
    measure,
  };
}

/**
 * 플러그인이 블록에 넣는 재료(카드의 Inject 목록). 넣는 블록은 블록 모델의 주입 겹과 같다.
 * 카드의 `providers`는 모델 제공자가 아니라 매니페스트 `provides`의 서비스 id라(호스트 `card.ts`) 루프 재료가 아니다. 판의 요약이 따로 보인다
 */
export type FeedPoint = "context" | "tools" | "agents";

export interface LoopFeed {
  readonly point: FeedPoint;
  /** 칸 이름들(사람이 적은 파일 경로, 스킬, 명령, 도구, MCP 서버, 제공자, 에이전트 이름) */
  readonly items: readonly FeedItem[];
}

export interface FeedItem {
  readonly kind: "instruction" | "skill" | "command" | "tool" | "server" | "agent";
  readonly name: string;
}

/** 카드의 Inject 목록을 넣는 블록마다 묶는다. 빈 묶음은 뺀다. 화면 항목(`ui`)은 앱 화면, 제공(`providers`)은 서비스라 루프 재료가 아니다 */
export function loopFeedsOf(card: PluginCard | null): readonly LoopFeed[] {
  const inject = card?.does.inject ?? null;
  if (inject === null) return [];
  const feeds: LoopFeed[] = [
    {
      point: "context",
      items: [
        ...inject.instructions.always.map((entry): FeedItem => ({
          kind: "instruction",
          name: entry.path,
        })),
        ...inject.instructions.skills.map((skill): FeedItem => ({
          kind: "skill",
          name: skill.name,
        })),
        ...inject.commands.map((name): FeedItem => ({ kind: "command", name })),
      ],
    },
    {
      point: "tools",
      items: [
        ...inject.tools.map((tool): FeedItem => ({ kind: "tool", name: tool.name })),
        ...inject.mcpServers.map((server): FeedItem => ({ kind: "server", name: server.name })),
      ],
    },
    {
      point: "agents",
      items: inject.agents.map((name): FeedItem => ({ kind: "agent", name })),
    },
  ];
  return feeds.filter((feed) => feed.items.length > 0);
}

/** Drive 구성의 단계(블록) 하나와 그 단계가 끼어드는 자리 */
export interface LoopStep {
  readonly row: BlockRow;
  readonly spots: readonly Spot[];
}

interface LoopDrive {
  /** 카드의 Drive 칸에 적힌 명령(예: `/helm`) */
  readonly commands: readonly string[];
  /** 구성 선언의 블록. 선언이 없거나 아직 못 읽었으면 빈 배열 */
  readonly steps: readonly LoopStep[];
}

/** 단계가 쓰는 훅들의 자리(겹치면 하나). 모르는 훅 이름은 자리가 없다 */
export function stepSpotsOf(row: BlockRow): readonly Spot[] {
  const seen = new Map<string, Spot>();
  for (const name of row.hooks) {
    for (const spot of loopHookOf(name, null).spots) seen.set(spotKey(spot), spot);
  }
  return [...seen.values()];
}

/** 루프 밖에서 주는 것 하나 */
export interface OutsideItem {
  readonly kind: "service" | "screen";
  readonly name: string;
}

/** 카드의 Inject 목록 중 루프 재료가 아닌 것: 서비스 다음 화면 */
export function outsideOf(card: PluginCard | null): readonly OutsideItem[] {
  const inject = card?.does.inject ?? null;
  if (inject === null) return [];
  return [
    ...inject.providers.map((name): OutsideItem => ({ kind: "service", name })),
    ...inject.ui.map((ui): OutsideItem => ({ kind: "screen", name: ui.id })),
  ];
}

export interface LoopPlan {
  readonly feeds: readonly LoopFeed[];
  /** 루프 밖에서 주는 것: 다른 플러그인이 쓰는 서비스(카드 `providers`, 매니페스트 `provides`)와 앱 화면(카드 `ui`) */
  readonly outside: readonly OutsideItem[];
  readonly hooks: readonly LoopHook[];
  readonly drive: LoopDrive | null;
}

/**
 * 캔버스에 그릴 것. 훅은 매니페스트 훅 목록(계측 줄)이 있으면 그것을, 아직 못 읽었으면 카드의 훅 이름을 쓴다.
 * Drive는 카드에 Drive 칸이 있거나 목록 행이 묶음 플러그인(`isOrchestration`)일 때다
 */
export function loopPlanOf(input: {
  readonly card: PluginCard | null;
  readonly hookRows: readonly InspectHookVM[] | null;
  readonly orchestration: boolean;
  readonly steps: readonly BlockRow[];
}): LoopPlan {
  const { card } = input;
  const hooks =
    input.hookRows !== null
      ? input.hookRows.map((row) => loopHookOf(row.hook, row))
      : (card?.does.hook?.hooks ?? []).map((hook) => loopHookOf(hook.name, null));
  const driveCard = card?.does.drive ?? null;
  const drive =
    driveCard !== null || input.orchestration
      ? {
          commands: driveCard?.commands ?? [],
          steps: input.steps.map((row) => ({ row, spots: stepSpotsOf(row) })),
        }
      : null;
  return { feeds: loopFeedsOf(card), outside: outsideOf(card), hooks, drive };
}

/** 훅을 자리마다 모은다(자리 순서는 첫 등장 순서). 한 훅이 두 자리에 서면 두 묶음에 다 든다 */
export function hooksBySpot(
  hooks: readonly LoopHook[],
): readonly { readonly spot: Spot; readonly hooks: readonly LoopHook[] }[] {
  const groups = new Map<string, { spot: Spot; hooks: LoopHook[] }>();
  for (const hook of hooks) {
    for (const spot of hook.spots) {
      const key = spotKey(spot);
      const group = groups.get(key) ?? { spot, hooks: [] };
      group.hooks.push(hook);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

/** 훅 카드의 한 줄: 같은 일을 하는 훅은 한 줄로 묶고 수를 보인다. 누르면 첫 훅을 고른다 */
export interface HookLine {
  readonly power: HookPower | null;
  readonly hooks: readonly LoopHook[];
}

/** 한 자리의 훅들을 할 수 있는 첫 일로 묶는다(첫 등장 순서). 일이 없는 훅(모르는 이름)은 하나씩 한 줄이다 */
export function hookLinesOf(hooks: readonly LoopHook[]): readonly HookLine[] {
  const lines: { power: HookPower | null; hooks: LoopHook[] }[] = [];
  for (const hook of hooks) {
    const power = hook.powers[0] ?? null;
    const line = power === null ? undefined : lines.find((l) => l.power === power);
    if (line === undefined) lines.push({ power, hooks: [hook] });
    else line.hooks.push(hook);
  }
  return lines;
}

/** 이 플러그인이 무엇이든 붙는 지점(줄 위 지점이 밝게 보인다) */
export function usedPointsOf(plan: LoopPlan): ReadonlySet<PointId> {
  const used = new Set<PointId>();
  for (const feed of plan.feeds) used.add(feed.point);
  for (const hook of plan.hooks) {
    for (const spot of hook.spots) {
      const point = pointOfSpot(spot);
      if (point !== null) used.add(point);
    }
  }
  for (const step of plan.drive?.steps ?? []) {
    for (const spot of step.spots) {
      const point = pointOfSpot(spot);
      if (point !== null) used.add(point);
    }
  }
  return used;
}

/** 캔버스에서 고른 것. 아무것도 안 골랐으면 null(패널은 요약) */
export type LoopPick =
  | { readonly kind: "point"; readonly point: PointId }
  | { readonly kind: "hook"; readonly name: string }
  | { readonly kind: "feed"; readonly point: FeedPoint }
  | { readonly kind: "drive" }
  | { readonly kind: "step"; readonly id: string };

export function pickKey(pick: LoopPick | null): string {
  if (pick === null) return "none";
  switch (pick.kind) {
    case "point":
      return `point:${pick.point}`;
    case "hook":
      return `hook:${pick.name}`;
    case "feed":
      return `feed:${pick.point}`;
    case "drive":
      return "drive";
    case "step":
      return `step:${pick.id}`;
    default:
      return assertNever(pick, "pickKey");
  }
}

/** 고른 것이 밝게 할 자리(그 자리의 문과 지점이 강조된다) */
export function pickedSpotsOf(plan: LoopPlan, pick: LoopPick | null): readonly Spot[] {
  if (pick === null) return [];
  switch (pick.kind) {
    case "hook":
      return plan.hooks.find((hook) => hook.name === pick.name)?.spots ?? [];
    case "step":
      return plan.drive?.steps.find((step) => step.row.id === pick.id)?.spots ?? [];
    case "point":
    case "feed":
    case "drive":
      return [];
    default:
      return assertNever(pick, "pickedSpotsOf");
  }
}
