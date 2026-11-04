// 순서 화면의 훅 표. 줄 이름과 설명은 화면이 id로 찾으므로 여기에는 id, fold, phase, failure, orderMatters만 둔다.
// 훅 id와 fold는 contracts의 HOOKS와 같아야 한다. hooks.test.ts가 46개 전부를 대조한다.
import type { CanvasPlugin } from "./types.ts";

/** 훅 결과 규칙(F.extensions §4.1): 관찰, 차단, 수정, 합치기 */
type Fold = "tap" | "first" | "chain" | "collect";
/** 핸들러가 실패했을 때의 처리(adr.0017 §3.4) */
type Failure = "closed" | "open" | "skip";
type PhaseId = "start" | "think" | "act" | "wrap";

/** 순서 화면의 네 묶음 */
export const PHASES: readonly PhaseId[] = ["start", "think", "act", "wrap"];

interface HookDef {
  readonly id: string;
  readonly fold: Fold;
  readonly phase: PhaseId;
  readonly failure: Failure;
  /** 내장이 이 순간을 맡고 있다(대체할 수 있다) */
  readonly builtin?: boolean;
  /**
   * 순서가 승자나 값을 바꾸는가. 참인 훅의 줄만 끌기 손잡이를 얻는다(핸들러가 둘 이상일 때). 기준은 `hookOrderMatters` 주석.
   */
  readonly orderMatters: boolean;
}

/**
 * 순서가 승자나 값을 바꾸는 훅인가. 기준은 결정 값의 모양이다.
 * - chain: 핸들러가 값을 고쳐 다음으로 넘기므로 순서가 최종 값을 바꾼다 → 참.
 * - first, 값이 있는 답: 처음 답한 핸들러가 이기고 뒤는 건너뛴다. 답이 허용·대체·값(trust의 yes/no,
 *   input.bash의 result, compact·fork·tree의 계속 변형)을 담으면 순서가 이긴 값을 바꾼다 → 참.
 * - first, 막음만: ToolCallDecision, GuardDecision, SessionCancelDecision은 block/cancel뿐이다. 결과는 어느 순서에서도 막힘이고
 *   순서가 바꾸는 것은 사유와 뒤 핸들러의 실행 여부뿐이다. 그래서 손잡이는 주지 않고 저장 전 경고와 줄 경고가 맡는다 → 거짓.
 * - collect, tap: 이 기준(chain, 값이 있는 first 답)에 들지 않는다. tap은 바꾸지 않고, collect는 조각을 모을 뿐 승자나 고친 값이 없다 → 거짓.
 * 판단 근거는 F.extensions §3.4·§3.5, X.operations §4.1.3이다.
 */
export const HOOKS: readonly HookDef[] = [
  { id: "thread.start", fold: "tap", phase: "start", failure: "open", orderMatters: false },
  { id: "input.user.before", fold: "chain", phase: "start", failure: "skip", orderMatters: true },
  {
    id: "input.agent.before",
    fold: "collect",
    phase: "start",
    failure: "open",
    orderMatters: false,
  },
  {
    id: "thread.compact.before",
    fold: "first",
    phase: "think",
    failure: "open",
    builtin: true,
    orderMatters: true,
  },
  {
    id: "request.provider.before",
    fold: "chain",
    phase: "think",
    failure: "skip",
    orderMatters: true,
  },
  {
    id: "guard.model.before",
    fold: "first",
    phase: "think",
    failure: "closed",
    orderMatters: false,
  },
  { id: "request.model.after", fold: "tap", phase: "think", failure: "open", orderMatters: false },
  { id: "tool.call.before", fold: "first", phase: "act", failure: "closed", orderMatters: false },
  { id: "tool.result", fold: "chain", phase: "act", failure: "skip", orderMatters: true },
  { id: "tool.execution.after", fold: "tap", phase: "act", failure: "open", orderMatters: false },
  { id: "boundary.step.after", fold: "chain", phase: "wrap", failure: "skip", orderMatters: true },
  { id: "boundary.settle.after", fold: "tap", phase: "wrap", failure: "open", orderMatters: false },
  { id: "thread.shutdown", fold: "tap", phase: "wrap", failure: "open", orderMatters: false },
];

/** 나머지 훅 33개(46개 중). 펼치면 id만 보인다 */
export const OTHER_HOOKS: readonly {
  readonly id: string;
  readonly fold: Fold;
  readonly orderMatters: boolean;
}[] = [
  { id: "input.bash.before", fold: "first", orderMatters: true },
  { id: "request.context.before", fold: "chain", orderMatters: true },
  { id: "request.system.before", fold: "chain", orderMatters: true },
  { id: "request.cache.before", fold: "chain", orderMatters: true },
  { id: "request.headers.before", fold: "chain", orderMatters: true },
  { id: "request.provider.after", fold: "tap", orderMatters: false },
  { id: "request.stream", fold: "tap", orderMatters: false },
  { id: "request.thinking.after", fold: "tap", orderMatters: false },
  { id: "tool.execution.before", fold: "tap", orderMatters: false },
  { id: "tool.execution.update", fold: "tap", orderMatters: false },
  { id: "boundary.turn.before", fold: "tap", orderMatters: false },
  { id: "boundary.step.before", fold: "tap", orderMatters: false },
  { id: "boundary.message.before", fold: "tap", orderMatters: false },
  { id: "boundary.message.update", fold: "tap", orderMatters: false },
  { id: "boundary.message.after", fold: "chain", orderMatters: true },
  { id: "boundary.settle.before", fold: "chain", orderMatters: true },
  { id: "boundary.turn.after", fold: "tap", orderMatters: false },
  { id: "thread.trust.before", fold: "first", orderMatters: true },
  { id: "thread.resources", fold: "collect", orderMatters: false },
  { id: "thread.mcp.after", fold: "tap", orderMatters: false },
  { id: "thread.info.after", fold: "tap", orderMatters: false },
  { id: "thread.switch.before", fold: "first", orderMatters: false },
  { id: "thread.fork.before", fold: "first", orderMatters: true },
  { id: "thread.compact.after", fold: "tap", orderMatters: false },
  { id: "thread.compact.failed", fold: "tap", orderMatters: false },
  { id: "thread.tree.before", fold: "first", orderMatters: true },
  { id: "thread.tree.after", fold: "tap", orderMatters: false },
  { id: "thread.prompt.before", fold: "tap", orderMatters: false },
  { id: "thread.prompt.after", fold: "tap", orderMatters: false },
  { id: "guard.tool.before", fold: "first", orderMatters: false },
  { id: "guard.output.before", fold: "first", orderMatters: false },
  { id: "lifecycle.agent.settled", fold: "tap", orderMatters: false },
  { id: "lifecycle.lease.rejected", fold: "tap", orderMatters: false },
];

/**
 * 코어 루프의 내장 단계. 훅 줄 사이에 같은 흐름의 줄로 끼고(after = 이 훅 줄 바로 뒤), 앞뒤 훅 줄(wrap)에서 감쌀 수 있다.
 */
interface CoreStep {
  readonly id: string;
  readonly after: string;
  readonly wrap: readonly [string, string];
  /** 플러그인이 건드릴 수 없는 단계(도구 실행뿐) */
  readonly locked: boolean;
  /**
   * 통째로 바꿀 수 있는 단계. 지금 대체가 가능한 것은 압축뿐이고 그 자리는 이 표가 아니라
   * `thread.compact.before` 훅의 builtin으로 표시한다. 그래서 이 단계들은 모두 false다.
   */
  readonly replaceable: boolean;
}

export const CORE_STEPS: readonly CoreStep[] = [
  {
    id: "core.context.assemble",
    after: "thread.compact.before",
    wrap: ["input.agent.before", "request.provider.before"],
    locked: false,
    replaceable: false,
  },
  {
    id: "core.model.call",
    after: "guard.model.before",
    wrap: ["request.provider.before", "request.model.after"],
    locked: false,
    replaceable: false,
  },
  {
    id: "core.tools.run",
    after: "tool.call.before",
    wrap: ["tool.call.before", "tool.result"],
    locked: true,
    replaceable: false,
  },
];

/** id의 훅 정의(13개 순간만). 나머지 33개는 undefined다 */
export function hookDef(id: string): HookDef | undefined {
  return HOOKS.find((h) => h.id === id);
}

/** id의 fold(46개 전부). 모르는 훅이면 undefined */
export function hookFold(id: string): Fold | undefined {
  return hookDef(id)?.fold ?? OTHER_HOOKS.find((h) => h.id === id)?.fold;
}

/** id의 orderMatters(46개 전부). 모르는 훅이면 false다 */
export function hookOrderMatters(id: string): boolean {
  return [...HOOKS, ...OTHER_HOOKS].find((h) => h.id === id)?.orderMatters ?? false;
}

/**
 * 훅 줄마다 불리는 순서. 덮어쓴 순서를 먼저 따르고(그 훅을 선언하지 않은 플러그인은 버린다),
 * 덮어쓰지 않은 플러그인은 목록 순서로 뒤에 붙는다. 줄에 드는 것은 그 훅을 선언한 플러그인뿐이다.
 */
export function hooksInOrder(
  plugins: readonly CanvasPlugin[],
  overrides: Readonly<Record<string, readonly string[]>>,
): Record<string, string[]> {
  const declared = new Map<string, string[]>();
  for (const p of plugins) {
    for (const h of p.hooks) declared.set(h, [...(declared.get(h) ?? []), p.id]);
  }
  const lanes: Record<string, string[]> = {};
  for (const h of new Set([...declared.keys(), ...Object.keys(overrides)])) {
    const ids = declared.get(h) ?? [];
    const seeded = [...new Set(overrides[h] ?? [])].filter((id) => ids.includes(id));
    lanes[h] = [...seeded, ...ids.filter((id) => !seeded.includes(id))];
  }
  return lanes;
}
