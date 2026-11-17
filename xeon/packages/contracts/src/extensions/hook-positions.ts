import { HOOKS, HOOK_NAMES, type HookName } from "./hooks.ts";

// 훅 위치 데이터(M5e 스펙 §4.1). 위치는 HOOKS 선언의 필드가 아니라 이 별도 표다. 이름과 HookSignatures는 그대로 두고,
// 각 훅이 블록 앞·뒤, 경계, 이벤트, 내부 가운데 어디에 서는지와 할 수 있는 일을 적는다.
// 블록 모델(`contracts/src/blocks`)의 훅 목록은 이 표에서 파생한다. 행은 50개다. 47~50번(사람에게 묻기, 서브에이전트)은
// M5e 2b·2c가 발화를 연결해 `fired: true`다.

/** 블록 여섯. `record`는 앞뒤 훅이 없고 이벤트 구독만 있다 */
export type BlockId = "context" | "model" | "tools" | "ask" | "agents" | "record";
/** 흐름 전체의 세 자리. 블록 안이 아니다 */
export type BoundaryId = "conversation-start" | "input-received" | "before-turn-end";
/** 훅이 할 수 있는 일. tap은 `observe`뿐이고, 고치기·결정·보태기는 tap이 아닌 fold가 쓴다 */
export type HookPower = "observe" | "modify" | "decide" | "contribute";

export type HookPosition =
  | {
      readonly kind: "block";
      readonly block: Exclude<BlockId, "record">;
      readonly side: "before" | "after";
    }
  | { readonly kind: "boundary"; readonly boundary: BoundaryId }
  /** `anchor`는 화면이 흐름 그림에 놓을 자리다. 없으면 기록 블록의 구독이다(블록 파생이 이렇게 읽는다) */
  | {
      readonly kind: "event";
      readonly anchor?: { readonly block: BlockId; readonly side: "before" | "after" };
    }
  | { readonly kind: "internal" };

export interface HookPositionRow {
  readonly hook: HookName;
  /** 한 훅이 둘 이상의 위치에 서는 경우만 둘 이상이다(guard.output.before의 display, execution) */
  readonly positions: readonly HookPosition[];
  readonly powers: readonly HookPower[];
  /** 지금 코드가 발화하는가. false면 선언만 있다 */
  readonly fired: boolean;
  /** 고빈도 이벤트인가. 구독이 표본 추출을 요청할 수 있다 */
  readonly highFrequency?: true;
}

type Side = "before" | "after";

const at = (block: Exclude<BlockId, "record">, side: Side): HookPosition => ({
  kind: "block",
  block,
  side,
});
const boundary = (id: BoundaryId): HookPosition => ({ kind: "boundary", boundary: id });
const onEvent = (block: BlockId, side: Side): HookPosition => ({
  kind: "event",
  anchor: { block, side },
});
const freeEvent: HookPosition = { kind: "event" };
const internal: HookPosition = { kind: "internal" };

/** 50개 훅의 위치. 행 순서는 스펙 §3.1 표 순서이고 47~50번은 M5e에서 더한 행이다(HOOK_NAMES와 같다) */
export const HOOK_POSITIONS: { readonly [N in HookName]: HookPositionRow } = {
  "input.user.before": {
    hook: "input.user.before",
    positions: [boundary("input-received")],
    powers: ["modify", "decide"],
    fired: true,
  },
  "input.bash.before": {
    hook: "input.bash.before",
    positions: [boundary("input-received")],
    powers: ["decide"],
    fired: true,
  },
  "input.agent.before": {
    hook: "input.agent.before",
    positions: [at("context", "before")],
    powers: ["contribute"],
    fired: true,
  },
  "request.context.before": {
    hook: "request.context.before",
    positions: [at("context", "before")],
    powers: ["modify"],
    fired: true,
  },
  "request.system.before": {
    hook: "request.system.before",
    positions: [at("context", "before")],
    powers: ["modify"],
    fired: true,
  },
  "request.cache.before": {
    hook: "request.cache.before",
    positions: [internal],
    powers: ["modify"],
    fired: false,
  },
  "request.provider.before": {
    hook: "request.provider.before",
    positions: [at("model", "before")],
    powers: ["modify"],
    fired: true,
  },
  "request.headers.before": {
    hook: "request.headers.before",
    positions: [at("model", "before")],
    powers: ["modify"],
    fired: true,
  },
  "request.provider.after": {
    hook: "request.provider.after",
    positions: [onEvent("model", "after")],
    powers: ["observe"],
    fired: true,
  },
  "request.stream": {
    hook: "request.stream",
    positions: [onEvent("model", "after")],
    powers: ["observe"],
    fired: true,
    highFrequency: true,
  },
  "request.model.after": {
    hook: "request.model.after",
    positions: [onEvent("model", "after")],
    powers: ["observe"],
    fired: true,
  },
  "request.thinking.after": {
    hook: "request.thinking.after",
    positions: [onEvent("model", "after")],
    powers: ["observe"],
    fired: true,
  },
  "tool.call.before": {
    hook: "tool.call.before",
    positions: [at("tools", "before")],
    powers: ["decide"],
    fired: true,
  },
  "tool.result": {
    hook: "tool.result",
    positions: [at("tools", "after")],
    powers: ["modify"],
    fired: true,
  },
  "tool.execution.before": {
    hook: "tool.execution.before",
    positions: [onEvent("tools", "before")],
    powers: ["observe"],
    fired: true,
  },
  "tool.execution.update": {
    hook: "tool.execution.update",
    // 실행 중에 나므로 앞뒤 어느 쪽도 정확하지 않다. 스펙 §3.2가 도구 실행 뒤 묶음에 둔 것을 따른다
    positions: [onEvent("tools", "after")],
    powers: ["observe"],
    fired: true,
    highFrequency: true,
  },
  "tool.execution.after": {
    hook: "tool.execution.after",
    positions: [onEvent("tools", "after")],
    powers: ["observe"],
    fired: true,
  },
  "boundary.turn.before": {
    hook: "boundary.turn.before",
    positions: [freeEvent],
    powers: ["observe"],
    fired: true,
  },
  "boundary.step.before": {
    hook: "boundary.step.before",
    positions: [freeEvent],
    powers: ["observe"],
    fired: true,
  },
  "boundary.message.before": {
    hook: "boundary.message.before",
    positions: [onEvent("model", "after")],
    powers: ["observe"],
    fired: true,
  },
  "boundary.message.update": {
    hook: "boundary.message.update",
    positions: [onEvent("model", "after")],
    powers: ["observe"],
    fired: true,
    highFrequency: true,
  },
  "boundary.message.after": {
    hook: "boundary.message.after",
    positions: [at("model", "after")],
    powers: ["modify"],
    fired: true,
  },
  "boundary.step.after": {
    hook: "boundary.step.after",
    positions: [boundary("before-turn-end")],
    powers: ["modify"],
    fired: true,
  },
  "boundary.settle.before": {
    hook: "boundary.settle.before",
    positions: [boundary("before-turn-end")],
    powers: ["modify"],
    fired: true,
  },
  "boundary.turn.after": {
    hook: "boundary.turn.after",
    positions: [freeEvent],
    powers: ["observe"],
    fired: true,
  },
  "boundary.settle.after": {
    hook: "boundary.settle.after",
    positions: [freeEvent],
    powers: ["observe"],
    fired: true,
  },
  "thread.trust.before": {
    hook: "thread.trust.before",
    positions: [internal],
    powers: ["decide"],
    fired: false,
  },
  "thread.resources": {
    hook: "thread.resources",
    positions: [boundary("conversation-start")],
    powers: ["contribute"],
    fired: true,
  },
  "thread.mcp.after": {
    hook: "thread.mcp.after",
    positions: [freeEvent],
    powers: ["observe"],
    fired: true,
  },
  "thread.start": {
    hook: "thread.start",
    positions: [boundary("conversation-start")],
    powers: ["observe"],
    fired: true,
  },
  "thread.info.after": {
    hook: "thread.info.after",
    positions: [freeEvent],
    powers: ["observe"],
    fired: true,
  },
  "thread.switch.before": {
    hook: "thread.switch.before",
    positions: [internal],
    powers: ["decide"],
    fired: true,
  },
  "thread.fork.before": {
    hook: "thread.fork.before",
    positions: [internal],
    powers: ["decide"],
    fired: true,
  },
  "thread.compact.before": {
    hook: "thread.compact.before",
    positions: [at("context", "before")],
    powers: ["decide"],
    fired: true,
  },
  "thread.compact.after": {
    hook: "thread.compact.after",
    positions: [onEvent("context", "after")],
    powers: ["observe"],
    fired: true,
  },
  "thread.compact.failed": {
    hook: "thread.compact.failed",
    positions: [onEvent("context", "after")],
    powers: ["observe"],
    fired: true,
  },
  "thread.tree.before": {
    hook: "thread.tree.before",
    positions: [internal],
    powers: ["decide"],
    fired: true,
  },
  "thread.tree.after": {
    hook: "thread.tree.after",
    positions: [freeEvent],
    powers: ["observe"],
    fired: true,
  },
  "thread.shutdown": {
    hook: "thread.shutdown",
    positions: [freeEvent],
    powers: ["observe"],
    fired: true,
  },
  "thread.prompt.before": {
    hook: "thread.prompt.before",
    positions: [onEvent("ask", "before")],
    powers: ["observe"],
    fired: true,
  },
  "thread.prompt.after": {
    hook: "thread.prompt.after",
    positions: [onEvent("ask", "after")],
    powers: ["observe"],
    fired: true,
  },
  "guard.model.before": {
    hook: "guard.model.before",
    positions: [at("model", "before")],
    powers: ["decide"],
    fired: true,
  },
  "guard.tool.before": {
    hook: "guard.tool.before",
    positions: [at("tools", "before")],
    powers: ["decide"],
    fired: true,
  },
  "guard.output.before": {
    hook: "guard.output.before",
    // display는 모델 호출 뒤, execution은 도구 실행 앞
    positions: [at("model", "after"), at("tools", "before")],
    powers: ["decide"],
    fired: true,
  },
  "lifecycle.agent.settled": {
    hook: "lifecycle.agent.settled",
    positions: [onEvent("agents", "after")],
    powers: ["observe"],
    fired: true,
  },
  "lifecycle.lease.rejected": {
    hook: "lifecycle.lease.rejected",
    positions: [freeEvent],
    powers: ["observe"],
    fired: true,
  },
  "ask.human.before": {
    hook: "ask.human.before",
    positions: [at("ask", "before")],
    powers: ["decide"],
    fired: true,
  },
  "ask.human.after": {
    hook: "ask.human.after",
    positions: [onEvent("ask", "after")],
    powers: ["observe"],
    fired: true,
  },
  "agent.spawn.before": {
    hook: "agent.spawn.before",
    positions: [at("agents", "before")],
    powers: ["decide"],
    fired: true,
  },
  "agent.spawn.after": {
    hook: "agent.spawn.after",
    positions: [at("agents", "after")],
    powers: ["modify"],
    fired: true,
  },
};

type HookPositionRule =
  | "missing_row"
  | "unknown_row"
  | "name_mismatch"
  | "no_position"
  | "event_not_tap"
  | "block_on_tap"
  | "tap_powers"
  | "fold_powers";

interface HookPositionIssue {
  readonly hook: string;
  readonly rule: HookPositionRule;
}

/**
 * 위치 표의 검사(순수 함수). 키 집합이 HOOK_NAMES와 같아야 하고, 이벤트 위치는 tap에만, 블록·경계 위치는
 * tap이 아닌 fold(그리고 `thread.start`)에만 있다. tap의 powers는 `observe`뿐이고 tap이 아닌 fold는 `observe`를 가지지 않는다.
 * 어긋난 것을 모두 돌려주고, 없으면 빈 목록이다.
 */
export function checkHookPositions(
  table: Readonly<Record<string, HookPositionRow | undefined>>,
): readonly HookPositionIssue[] {
  const issues: HookPositionIssue[] = [];
  const known = new Set<string>(HOOK_NAMES);
  for (const key of Object.keys(table)) {
    if (!known.has(key)) issues.push({ hook: key, rule: "unknown_row" });
  }
  for (const name of HOOK_NAMES) {
    const row = table[name];
    if (row === undefined) {
      issues.push({ hook: name, rule: "missing_row" });
      continue;
    }
    if (row.hook !== name) issues.push({ hook: name, rule: "name_mismatch" });
    if (row.positions.length === 0) issues.push({ hook: name, rule: "no_position" });
    const isTap = HOOKS[name].fold === "tap";
    for (const position of row.positions) {
      if (position.kind === "event" && !isTap) {
        issues.push({ hook: name, rule: "event_not_tap" });
      }
      if ((position.kind === "block" || position.kind === "boundary") && isTap) {
        if (name !== "thread.start") issues.push({ hook: name, rule: "block_on_tap" });
      }
    }
    const observeOnly = row.powers.length === 1 && row.powers[0] === "observe";
    if (isTap && !observeOnly) issues.push({ hook: name, rule: "tap_powers" });
    if (!isTap && (row.powers.length === 0 || row.powers.includes("observe"))) {
      issues.push({ hook: name, rule: "fold_powers" });
    }
  }
  return issues;
}

/** 위치가 `event`인 24개 훅(M5e 스펙 §4.4.1). `g.subscribe`가 받는 이름이고, 시험이 `HOOK_POSITIONS`에서 파생한 목록과 같은지 본다 */
export const SUBSCRIBABLE_EVENTS = [
  "request.provider.after",
  "request.stream",
  "request.model.after",
  "request.thinking.after",
  "tool.execution.before",
  "tool.execution.update",
  "tool.execution.after",
  "boundary.turn.before",
  "boundary.step.before",
  "boundary.message.before",
  "boundary.message.update",
  "boundary.turn.after",
  "boundary.settle.after",
  "thread.mcp.after",
  "thread.info.after",
  "thread.compact.after",
  "thread.compact.failed",
  "thread.tree.after",
  "thread.shutdown",
  "thread.prompt.before",
  "thread.prompt.after",
  "lifecycle.agent.settled",
  "lifecycle.lease.rejected",
  "ask.human.after",
] as const;

export type SubscribableEvent = (typeof SUBSCRIBABLE_EVENTS)[number];

export type EventAnchor = NonNullable<Extract<HookPosition, { kind: "event" }>["anchor"]>;

const SUBSCRIBABLE_SET: ReadonlySet<string> = new Set<string>(SUBSCRIBABLE_EVENTS);

/** 이 이름이 이벤트 위치의 훅인가. 매니페스트의 `"all"` 구독과 `g.subscribe`의 검사가 쓴다 */
export function isSubscribableEvent(name: HookName): name is SubscribableEvent {
  return SUBSCRIBABLE_SET.has(name);
}

/** 이벤트 훅의 흐름 그림 자리(화면용). 없으면 undefined다 */
export function anchorOfEvent(name: SubscribableEvent): EventAnchor | undefined {
  for (const position of HOOK_POSITIONS[name].positions) {
    if (position.kind === "event") return position.anchor;
  }
  return undefined;
}

/** 고빈도 이벤트다. `sample: "coalesce"`를 받는 유일한 이벤트다 */
export function isHighFrequency(name: SubscribableEvent): boolean {
  return HOOK_POSITIONS[name].highFrequency === true;
}
