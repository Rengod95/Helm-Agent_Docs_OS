// 순서 화면의 훅 표. 줄 이름과 설명은 화면이 id로 찾으므로 여기에는 id, fold, phase, failure만 둔다.
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
}

/** 순서 화면에 늘 보이는 순간 13개. 위에서 아래가 에이전트 루프가 도는 순서다(압축은 컨텍스트 조립 앞, L1.loop §4.2) */
export const HOOKS: readonly HookDef[] = [
  { id: "thread.start", fold: "tap", phase: "start", failure: "open" },
  { id: "input.user.before", fold: "chain", phase: "start", failure: "skip" },
  { id: "input.agent.before", fold: "collect", phase: "start", failure: "open" },
  { id: "thread.compact.before", fold: "first", phase: "think", failure: "open", builtin: true },
  { id: "request.provider.before", fold: "chain", phase: "think", failure: "skip" },
  { id: "guard.model.before", fold: "first", phase: "think", failure: "closed" },
  { id: "request.model.after", fold: "tap", phase: "think", failure: "open" },
  { id: "tool.call.before", fold: "first", phase: "act", failure: "closed" },
  { id: "tool.result", fold: "chain", phase: "act", failure: "skip" },
  { id: "tool.execution.after", fold: "tap", phase: "act", failure: "open" },
  { id: "boundary.step.after", fold: "chain", phase: "wrap", failure: "skip" },
  { id: "boundary.settle.after", fold: "tap", phase: "wrap", failure: "open" },
  { id: "thread.shutdown", fold: "tap", phase: "wrap", failure: "open" },
];

/** 나머지 훅 33개(46개 중). 펼치면 id만 보인다 */
export const OTHER_HOOKS: readonly { readonly id: string; readonly fold: Fold }[] = [
  { id: "input.bash.before", fold: "first" },
  { id: "request.context.before", fold: "chain" },
  { id: "request.system.before", fold: "chain" },
  { id: "request.cache.before", fold: "chain" },
  { id: "request.headers.before", fold: "chain" },
  { id: "request.provider.after", fold: "tap" },
  { id: "request.stream", fold: "tap" },
  { id: "request.thinking.after", fold: "tap" },
  { id: "tool.execution.before", fold: "tap" },
  { id: "tool.execution.update", fold: "tap" },
  { id: "boundary.turn.before", fold: "tap" },
  { id: "boundary.step.before", fold: "tap" },
  { id: "boundary.message.before", fold: "tap" },
  { id: "boundary.message.update", fold: "tap" },
  { id: "boundary.message.after", fold: "chain" },
  { id: "boundary.settle.before", fold: "chain" },
  { id: "boundary.turn.after", fold: "tap" },
  { id: "thread.trust.before", fold: "first" },
  { id: "thread.resources", fold: "collect" },
  { id: "thread.mcp.after", fold: "tap" },
  { id: "thread.info.after", fold: "tap" },
  { id: "thread.switch.before", fold: "first" },
  { id: "thread.fork.before", fold: "first" },
  { id: "thread.compact.after", fold: "tap" },
  { id: "thread.compact.failed", fold: "tap" },
  { id: "thread.tree.before", fold: "first" },
  { id: "thread.tree.after", fold: "tap" },
  { id: "thread.prompt.before", fold: "tap" },
  { id: "thread.prompt.after", fold: "tap" },
  { id: "guard.tool.before", fold: "first" },
  { id: "guard.output.before", fold: "first" },
  { id: "lifecycle.agent.settled", fold: "tap" },
  { id: "lifecycle.lease.rejected", fold: "tap" },
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
