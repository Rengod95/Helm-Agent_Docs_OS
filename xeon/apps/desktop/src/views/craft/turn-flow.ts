// 자세히 보기의 한 턴 흐름(순수 모델). 생명선의 순간 14개, 플러그인이 끼어드는 순간, 최근 실행 얹기를 만든다.
// 문구는 두지 않는다: 동사·값·결과는 id로 내고, 화면이 message key로 바꾼다. 플러그인별 손글 문장은 없다.
import {
  HOOKS,
  hookFold,
  hooksInOrder,
  type CanvasPlugin,
  type CanvasSnapshot,
  type PHASES,
} from "@fresnel/client/workbench/canvas";
import { assertNever, attemptAsync, Bug } from "@fresnel/contracts";
import type { CraftRunEntry, CraftSource } from "./craft-context.tsx";

/** 훅 결과 규칙(F.extensions §4.1). 도구 실행 순간은 훅이 아니라서 fold가 없다 */
type Fold = NonNullable<ReturnType<typeof hookFold>>;
export type Phase = (typeof PHASES)[number];

/** 도구가 실행될 때. 훅 목록에는 없고 코어 단계(core.tools.run)다 */
export const TOOL_RUN = "tool.run";

/** 순간이 받는 값의 종류. 훅마다 정해져 있어 플러그인과 상관없다 */
export type ValueKind =
  | "thread"
  | "user-input"
  | "agent-input"
  | "history"
  | "model-request"
  | "model-response"
  | "tool-call"
  | "tool-result"
  | "step"
  | "turn";

/** 하는 일의 동사. 관찰·수정·차단·합치기는 fold에서, 불려 나옴은 도구 실행에서 온다 */
export type Verb = "observe" | "modify" | "block" | "merge" | "call";

/** 넘기는 값의 종류: 같은 값, 고친 값, 통과 또는 차단, 합친 조각, 도구 결과 */
export type Hand = "unchanged" | "modified" | "decision" | "merged" | "result";

export interface Moment {
  readonly id: string;
  readonly phase: Phase;
  /** 도구 실행 순간만 null */
  readonly fold: Fold | null;
  readonly gets: ValueKind;
}

// 훅마다 받는 값. 표에 없는 훅이 HOOKS에 생기면 아래 Bug가 바로 터진다.
const GETS: Readonly<Record<string, ValueKind>> = {
  "thread.start": "thread",
  "input.user.before": "user-input",
  "input.agent.before": "agent-input",
  "thread.compact.before": "history",
  "request.provider.before": "model-request",
  "guard.model.before": "model-request",
  "request.model.after": "model-response",
  "tool.call.before": "tool-call",
  [TOOL_RUN]: "tool-call",
  "tool.result": "tool-result",
  "tool.execution.after": "tool-result",
  "boundary.step.after": "step",
  "boundary.settle.after": "turn",
  "thread.shutdown": "thread",
};

function gets(id: string): ValueKind {
  const kind = GETS[id];
  if (kind === undefined) throw new Bug(`turn-flow: no value kind for moment ${id}`);
  return kind;
}

/** 턴의 순간 14개. 훅 13개를 순서대로 두고 tool.call.before 뒤에 "도구가 실행될 때"를 끼운다 */
export const MOMENTS: readonly Moment[] = HOOKS.flatMap((h): Moment[] => {
  const here: Moment = { id: h.id, phase: h.phase, fold: h.fold, gets: gets(h.id) };
  if (h.id !== "tool.call.before") return [here];
  return [here, { id: TOOL_RUN, phase: "act", fold: null, gets: gets(TOOL_RUN) }];
});

const LIFELINE: ReadonlySet<string> = new Set(MOMENTS.map((m) => m.id));

const VERB_OF: Readonly<Record<Fold, Verb>> = {
  tap: "observe",
  chain: "modify",
  first: "block",
  collect: "merge",
};

const HAND_OF: Readonly<Record<Verb, Hand>> = {
  observe: "unchanged",
  modify: "modified",
  block: "decision",
  merge: "merged",
  call: "result",
};

/** 값이 앞 핸들러에서 뒤로 흐르는 동사. 관찰은 값을 바꾸지 않아 줄 사이 이음이 없다 */
const FLOWS: ReadonlySet<Verb> = new Set<Verb>(["modify", "block", "merge"]);

/** 한 플러그인이 한 순간에서 하는 일 */
export interface Part {
  readonly moment: string;
  readonly verb: Verb;
  readonly gets: ValueKind;
  readonly hands: Hand;
  /** 값이 앞 핸들러(같은 줄)에서 온다면 그 id, 아니면 null */
  readonly from: string | null;
  /** 값이 넘어갈 다음 핸들러(같은 줄)의 id, 아니면 null */
  readonly to: string | null;
}

/** 생명선 밖의 훅(순서 화면의 나머지 33개 중 이 플러그인이 건 것). fold를 모르면 verb는 null */
interface OffTurn {
  readonly hook: string;
  readonly verb: Verb | null;
}

/** 열 하나: 플러그인 하나의 생명선 위 순간들과 생명선 밖 훅 */
export interface Column {
  readonly plugin: CanvasPlugin;
  readonly moments: readonly Part[];
  readonly offTurn: readonly OffTurn[];
}

export type Order = Readonly<Record<string, readonly string[]>>;
const NO_ORDER: Order = {};

type Lanes = Readonly<Record<string, readonly string[]>>;

/** 도구를 내놓는 플러그인(도구 또는 MCP 서버 조각). 도구 실행 순간에 불려 나온다 */
function toolProviders(snapshot: CanvasSnapshot): readonly string[] {
  return snapshot.plugins
    .filter((p) => p.pieces.some((x) => x.kind === "tool" || x.kind === "mcp"))
    .map((p) => p.id);
}

function partFor(
  plugin: CanvasPlugin,
  m: Moment,
  lanes: Lanes,
  tools: readonly string[],
): Part | null {
  if (m.fold === null) {
    if (!tools.includes(plugin.id)) return null;
    return { moment: m.id, verb: "call", gets: m.gets, hands: HAND_OF.call, from: null, to: null };
  }
  // 줄의 순서가 곧 값이 흐르는 순서다(끌어 바꾼 순서가 있으면 그대로 따른다)
  const lane = lanes[m.id] ?? [];
  const at = lane.indexOf(plugin.id);
  if (at < 0) return null;
  const verb = VERB_OF[m.fold];
  const flows = FLOWS.has(verb);
  return {
    moment: m.id,
    verb,
    gets: m.gets,
    hands: HAND_OF[verb],
    from: flows && at > 0 ? (lane[at - 1] ?? null) : null,
    to: flows ? (lane[at + 1] ?? null) : null,
  };
}

function offTurnOf(plugin: CanvasPlugin): OffTurn[] {
  return plugin.hooks
    .filter((h) => !LIFELINE.has(h))
    .map((hook): OffTurn => {
      const fold = hookFold(hook);
      return { hook, verb: fold === undefined ? null : VERB_OF[fold] };
    });
}

/**
 * 플러그인 하나가 끼어드는 순간. 생명선 순서(MOMENTS)대로 나온다.
 * 선언만 본다(사용 중인지는 보지 않는다). 순서 덮어쓰기가 없으면 목록 순서가 줄 순서다.
 */
export function momentsFor(
  plugin: CanvasPlugin,
  snapshot: CanvasSnapshot,
  order: Order = NO_ORDER,
): Part[] {
  const lanes = hooksInOrder(snapshot.plugins, order);
  const tools = toolProviders(snapshot);
  return MOMENTS.flatMap((m) => {
    const part = partFor(plugin, m, lanes, tools);
    return part === null ? [] : [part];
  });
}

/** 여러 플러그인(그룹이면 구성원 전부)의 열. 같은 생명선에 열마다 한 줄씩 놓는다 */
export function columnsFor(
  plugins: readonly CanvasPlugin[],
  snapshot: CanvasSnapshot,
  order: Order = NO_ORDER,
): Column[] {
  const lanes = hooksInOrder(snapshot.plugins, order);
  const tools = toolProviders(snapshot);
  return plugins.map((plugin) => ({
    plugin,
    moments: MOMENTS.flatMap((m) => {
      const part = partFor(plugin, m, lanes, tools);
      return part === null ? [] : [part];
    }),
    offTurn: offTurnOf(plugin),
  }));
}

/** 열들 중 하나라도 끼어드는 순간 id. 펼칠 줄과 얇은 눈금 줄을 가른다 */
export function activeMoments(columns: readonly Column[]): ReadonlySet<string> {
  return new Set(columns.flatMap((c) => c.moments.map((p) => p.moment)));
}

// ── 최근 실행 ────────────────────────────────────────────────────
export type RunResult = CraftRunEntry["result"];
/** 화면의 결과. 고침(changed)은 wire 결과로 알 수 없어 없다 */
export type RunOutcome = "passed" | "failed" | "blocked" | "skipped";

export interface RunMark {
  /** 턴 시작부터의 초 */
  readonly sec: number;
  /** 걸린 시간(trace.turn의 ms 그대로) */
  readonly ms: number;
  readonly result: RunResult;
  readonly outcome: RunOutcome;
}

/** 훅(순간) id → 그 턴의 기록들. 한 훅이 턴 안에서 여러 번 돌면 여러 개다 */
export type RunMarks = ReadonlyMap<string, readonly RunMark[]>;

export function outcomeOf(result: RunResult): RunOutcome {
  switch (result) {
    case "ok":
      return "passed";
    case "error":
    case "over_budget":
      return "failed";
    case "denied":
      return "blocked";
    case "skipped":
      return "skipped";
    // [미결] "고침(changed)"은 wire 결과에 없어 만들지 않는다. 고친 값을 알리는 wire 필드가 생기면 여기에 더한다.
    default:
      return assertNever(result, "outcomeOf");
  }
}

/** 이 플러그인의 기록만 훅별로 모은다. 기록은 입력 순서대로다(wire의 seq 순서) */
export function runOverlay(entries: readonly CraftRunEntry[], plugin: CanvasPlugin): RunMarks {
  const out = new Map<string, RunMark[]>();
  for (const e of entries) {
    if (e.registrationId !== plugin.id) continue;
    const mark: RunMark = { sec: e.sec, ms: e.ms, result: e.result, outcome: outcomeOf(e.result) };
    const list = out.get(e.hook);
    if (list === undefined) out.set(e.hook, [mark]);
    else list.push(mark);
  }
  return out;
}

export type TimeUnit = "ms" | "s";

/**
 * 걸린 시간을 단위와 수로 나눈다. 1초 미만은 ms 그대로, 그 밖은 초로 바꾸되 나누기만 한다(반올림 없음).
 * 예: 3 → ms 3, 30000 → s 30, 8123 → s 8.123
 */
export function timeLabel(ms: number): { readonly unit: TimeUnit; readonly n: number } {
  return ms < 1000 ? { unit: "ms", n: ms } : { unit: "s", n: ms / 1000 };
}

export type RunsLoad =
  | { readonly k: "locked" }
  | { readonly k: "error"; readonly cause: unknown }
  | { readonly k: "ready"; readonly byPlugin: ReadonlyMap<string, RunMarks> };

/**
 * 최근 실행을 읽는다. 계측이 꺼져 있으면(null) locked, 읽다 거부되면 error다. 거부는 값으로 바꿔 화면이 보이게 한다.
 */
export async function loadRuns(
  source: Pick<CraftSource, "recentRuns">,
  plugins: readonly CanvasPlugin[],
): Promise<RunsLoad> {
  const got = await attemptAsync(() =>
    Promise.all(
      plugins.map(async (plugin) => ({ plugin, entries: await source.recentRuns(plugin.id) })),
    ),
  );
  if (!got.ok) return { k: "error", cause: got.error.cause };
  const byPlugin = new Map<string, RunMarks>();
  for (const { plugin, entries } of got.value) {
    if (entries === null) return { k: "locked" };
    byPlugin.set(plugin.id, runOverlay(entries, plugin));
  }
  return { k: "ready", byPlugin };
}
