// 핸들러 계측 링 버퍼(X-15, X.operations.spec §3.9·§4.8). thread마다 최근 Turn의 핸들러 기록을 메모리에만 둔다.
// 쓰기는 디스패처가 start·record로 하고, 읽기는 traceReadOf(primitives/host.ts)가 TraceReadPort로 낸다.
// 이 파일은 계약 타입만 가져온다. 디스패처와 호스트 쪽 타입은 여기로 들어오지 않는다.
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type {
  ExtTimingsResult,
  HookName,
  HookRunDecision,
  TraceAsk,
  TraceFailureReason,
  TraceHandlerEntry,
  TraceHandlerResult,
  TraceRecordEvent,
  TraceSourceKind,
  TraceTurnEntry,
  TraceTurnResult,
} from "@fresnel/contracts/extensions";
import { timingsOf, type HandlerRun, type TimingFilter } from "./handler-timings.ts";

/** x.operations.trace.* 유효 값(§6). 계측을 켜는 값. Turn 보관 수 상한은 없다 [결정: 2026-11-04 사용자] */
export interface TraceSettings {
  /** 계측을 켠다. Turn이 처음 보일 때 읽어 그 Turn의 기록 여부를 정한다(§4.8.3) */
  readonly enabled: boolean;
}

/** §6 기본값. 켬. thread의 Turn 수에는 상한이 없다(닫으면 풀린다, §4.8.3) */
export const DEFAULT_TRACE_SETTINGS: TraceSettings = { enabled: true };

/** Turn 하나에 쌓는 항목 수 상한(§4.8.5). 넘는 항목은 버린다 */
export const MAX_ENTRIES_PER_TURN = 5000;
/** 항목 하나에 쌓는 핸들러 기록 수 상한(TraceTurnEntry.handlers, 와이어 상한과 같다) */
export const MAX_HANDLERS_PER_ENTRY = 256;
/** 버퍼가 동시에 가지는 thread 수 상한 [제안]. 가장 오래 쓰이지 않은 thread부터 뺀다 */
export const MAX_THREADS = 32;
/**
 * 턴이 열리기 전에 받은 항목을 thread마다 붙잡는 상한 [제안, 턴 기록 §4.2 규칙 17의 2]. 넘으면 가장 먼저 받은 항목부터 버린다.
 * 다음 턴이 열리면 이 항목들이 그 턴의 단계 0이 되고, 계측이 꺼져 있으면 붙잡지 않는다
 */
export const MAX_PRE_TURN_ENTRIES = 8;
/**
 * 턴 전에 실행되는 훅 이름. 키 접두가 Turn이 아니어도(요청 id, 대화 id) 현재 열린 Turn이 없으면 다음 Turn의 단계 0에 붙는다.
 * 키로 정하지 않고 훅 이름으로 정한다(§4.2 규칙 17의 2 [제안])
 */
const PRE_TURN_HOOKS: ReadonlySet<string> = new Set([
  "thread.start",
  "input.user.before",
  "input.bash.before",
]);

/** 디스패치 하나의 시작 입력 */
interface TraceStart {
  readonly threadId: ThreadId;
  /** 디스패치 키. `<stepId 또는 turnId>:<접미>` 규칙을 따른다(§4.8.1) */
  readonly dispatchKey: string;
  readonly hook: HookName;
  /** 디스패처 시계의 지금(ms). 처음 보이는 Turn의 시작 시각이 된다 */
  readonly now: number;
}

/** 핸들러 실행 한 번의 기록 */
interface TraceRecord {
  readonly registrationId: string;
  /** 시간(ms). 정책이 잰 활성 시간, 예산 값, 중단까지 흐른 시간 가운데 하나다(§4.8.2) */
  readonly durationMs: number;
  readonly result: TraceHandlerResult;
  /** 핸들러가 시작한 시각. 디스패처 시계(`TraceStart.now`와 같은 시계)의 값이다 */
  readonly startedAt: number;
  /** 바뀐 크기. 고침이 아니면 0 */
  readonly size: number;
  /** 앞 핸들러 때문에 건너뛴 경우 그 핸들러. 아니면 null */
  readonly skippedBy: string | null;
  readonly reason: TraceFailureReason | null;
  /** 등록한 플러그인 이름, 버전, 출처. 디스패처가 등록 항목에서 채운다. 생략하면 항목에 싣지 않는다 */
  readonly plugin?: string;
  readonly versionId?: string | null;
  readonly sourceKind?: TraceSourceKind;
  /** 낸 결정(M5e §4.5). 생략하면 항목에 싣지 않는다 */
  readonly decision?: HookRunDecision;
  /** 사람 대기 메타데이터. 생략하면 항목에 싣지 않는다 */
  readonly ask?: TraceAsk;
}

/** 디스패치 하나의 기록기. 핸들러 기록은 첫 기록 때 항목 하나로 만들어진다 */
export interface TraceDispatch {
  record(run: TraceRecord): void;
}

export interface TraceBufferDeps {
  /** 계측 설정 유효 값. 읽기 함수는 호출 때마다 현재 값을 돌려준다 */
  settings(): TraceSettings;
  /**
   * 기록하지 않을 등록 id인가. 외부 훅 단위(`fresnel-hooks-<범위>`)가 여기에 든다. 단위는 호출마다 자기 행을 내지 않고,
   * 실행한 훅마다 `hook:<id>` 행을 실행기가 직접 넣는다(X.operations §4.8.2). 훅이 하나도 맞지 않은 호출에는 단위 행도 항목도 없다
   */
  hidden?(registrationId: string): boolean;
}

export interface TraceBuffer {
  /** 디스패치를 시작한다. 계측이 꺼져 있거나 Turn을 정할 수 없으면 undefined(기록하지 않는다) */
  start(input: TraceStart): TraceDispatch | undefined;
  /** 버퍼에 남은 Turn의 기록. 계측이 꺼져 있거나 Turn이 버퍼 밖이면 undefined */
  turn(threadId: ThreadId, turnId: TurnId): TraceTurnResult | undefined;
  /** 계측이 켜져 있는가(현재 설정 값) */
  enabled(): boolean;
  /** 남은 기록의 훅별 시간 분포. 계측이 꺼져 있으면 `{traceEnabled: false, timings: []}` */
  timings(filter: TimingFilter): ExtTimingsResult;
  /**
   * thread의 남은 Turn 전체에서 핸들러 결과가 `blocked`인 기록 수(`testRun.phase`의 guardHits). 계측이 꺼져 있거나 thread를 모르면 0이다
   */
  blockedCount(threadId: ThreadId): number;
  /** thread의 기록을 지운다. `closeThread`가 부른다(§4.8.3) */
  forgetThread(threadId: ThreadId): void;
  /**
   * 핸들러 기록이 쌓일 때마다 알린다(`TraceReadPort.onRecord`). 턴 전 항목은 알리지 않는다. 돌려준 함수로 푼다.
   * 듣는 쪽이 던지면 Hook을 부르는 길이 깨지므로 던지지 않아야 한다
   */
  onRecord(listener: (event: TraceRecordEvent) => void): () => void;
}

/** 쓰기 중인 항목. 생성된 뒤에는 핸들러 기록만 자란다 */
interface MutableEntry {
  /** 턴 안의 순서. 턴 전에 받은 항목이 턴에 붙을 때 다시 센다 */
  seq: number;
  readonly hook: string;
  readonly step: number;
  /** 턴 전에 받은 항목이면 참 */
  readonly pre: boolean;
  readonly handlers: TraceHandlerEntry[];
}

/**
 * Turn 하나의 상태. 턴 전 항목을 붙잡는 자리(`holding`)도 같은 모양이다. 다음 Turn이 열리면 그 자리가 Turn이 된다
 * (같은 객체라 아직 끝나지 않은 턴 전 디스패치의 기록도 같은 순서 번호와 같은 자리에 든다)
 */
interface TurnTrace {
  /** Turn이 처음 보일 때 읽은 계측 값. 이 Turn의 기록 여부를 정한다 */
  enabled: boolean;
  /** 턴 전 항목을 붙잡는 자리이면 참. 턴이 열리면 거짓이 된다 */
  holding: boolean;
  /** Turn이 처음 보인 시각(디스패처 시계). 핸들러의 `atMs`는 이 값부터 잰다 */
  openedAt: number;
  readonly entries: MutableEntry[];
  /** 단계 식별자 → 단계 번호(첫 발견 순서, 1부터) */
  readonly steps: Map<string, number>;
  /** 다음 항목에 줄 순서 번호 */
  nextSeq: number;
  /** `boundary.turn.after`를 받은 Turn. 닫힌 Turn은 현재 Turn이 되지 않는다 */
  closed: boolean;
}

/** thread 하나의 상태 */
interface ThreadTrace {
  /** 삽입 순서가 Turn 순서다. 맨 앞이 가장 오래된 Turn */
  readonly turns: Map<string, TurnTrace>;
  /** 마지막으로 열린 Turn. stp_ 키와 그 밖의 키가 여기에 붙는다. 닫히면 비운다 */
  current: string | undefined;
  /** 다음 Turn을 기다리는 턴 전 항목(thread마다 하나). 열린 Turn이 없을 때 받은 턴 전 훅이 든다 */
  waiting: TurnTrace | undefined;
}

/** 접두는 첫 `:` 앞이다. `:`가 없으면 키 전체다 */
function prefixOf(dispatchKey: string): string {
  const colon = dispatchKey.indexOf(":");
  return colon < 0 ? dispatchKey : dispatchKey.slice(0, colon);
}

/**
 * 키가 `<stepId>:<훅>:<toolCallId>[:<n>]` 모양인 도구 호출 지점의 훅(pipeline.ts의 dispatchKey 규칙).
 * 다른 훅의 키에는 셋째 자리가 호출 id가 아니므로(예: `approval:<id>:…`) 이 훅들에서만 호출 id를 얻는다
 */
const TOOL_CALL_KEY_HOOKS: ReadonlySet<string> = new Set([
  "tool.call.before",
  "guard.tool.before",
  "tool.result",
  "tool.execution.before",
  "tool.execution.update",
  "tool.execution.after",
]);

/** 도구 호출 지점의 디스패치 키 접미에서 호출 id를 얻는다. 해당 지점이 아니거나 모양이 다르면 null */
function toolCallIdOf(dispatchKey: string, hook: string): string | null {
  if (!TOOL_CALL_KEY_HOOKS.has(hook)) return null;
  const parts = dispatchKey.split(":");
  if (parts.length < 3 || parts[1] !== hook) return null;
  const callId = parts[2];
  return callId === undefined || callId === "" ? null : callId;
}

/** 맵의 가장 오래된 항목(삽입 순서의 맨 앞)을 뺀다 */
function dropOldest<V>(map: Map<string, V>): void {
  const oldest = map.keys().next();
  if (oldest.done === true) return;
  map.delete(oldest.value);
}

/** 단계 식별자의 번호. 처음 보는 단계는 다음 번호를 받는다 */
function stepOrdinal(turn: TurnTrace, stepId: string): number {
  const known = turn.steps.get(stepId);
  if (known !== undefined) return known;
  const ordinal = turn.steps.size + 1;
  turn.steps.set(stepId, ordinal);
  return ordinal;
}

function snapshotOf(entry: MutableEntry): TraceTurnEntry {
  const base = {
    seq: entry.seq,
    hook: entry.hook,
    step: entry.step,
    handlers: [...entry.handlers],
  };
  return entry.pre ? { ...base, pre: true } : base;
}

/** 턴 전 항목을 붙잡는 빈 자리 하나 */
function waitingTrace(now: number): TurnTrace {
  return {
    enabled: true,
    holding: true,
    openedAt: now,
    entries: [],
    steps: new Map(),
    nextSeq: 0,
    closed: false,
  };
}

/** 열린 Turn(닫히지 않고 현재인 Turn). 없으면 undefined */
function openCurrentOf(thread: ThreadTrace): TurnTrace | undefined {
  if (thread.current === undefined) return undefined;
  const turn = thread.turns.get(thread.current);
  return turn === undefined || turn.closed ? undefined : turn;
}

export function createTraceBuffer(deps: TraceBufferDeps): TraceBuffer {
  const threads = new Map<string, ThreadTrace>();
  const listeners = new Set<(event: TraceRecordEvent) => void>();

  /** thread를 찾는다. 없으면 만들고 thread 수 상한을 넘는 가장 오래된 thread를 뺀다 */
  function threadOf(threadId: string): ThreadTrace {
    const found = threads.get(threadId);
    if (found !== undefined) return found;
    const created: ThreadTrace = { turns: new Map(), current: undefined, waiting: undefined };
    threads.set(threadId, created);
    while (threads.size > MAX_THREADS) dropOldest(threads);
    return created;
  }

  /** 쓰기가 있었던 thread를 가장 최근 자리로 옮긴다. 이미 밀려난 thread에는 다시 넣지 않는다 */
  function touch(threadId: string, thread: ThreadTrace): void {
    if (threads.get(threadId) !== thread) return;
    threads.delete(threadId);
    threads.set(threadId, thread);
  }

  /**
   * 처음 보는 Turn을 연다. 계측 값을 여기서 한 번 읽는다. 다음 Turn을 기다리던 턴 전 항목은 이 Turn의 단계 0이 된다.
   * 계측이 꺼져 있으면 붙이지 않고 버린다(§4.2 규칙 17의 2)
   */
  function openTurn(thread: ThreadTrace, turnId: string, now: number): TurnTrace {
    const settings = deps.settings();
    const turn = thread.waiting ?? waitingTrace(now);
    thread.waiting = undefined;
    turn.holding = false;
    turn.openedAt = now;
    turn.enabled = settings.enabled;
    // 계측이 꺼진 턴은 기록하지 않으므로 기다리던 항목도 버린다
    if (!settings.enabled) turn.entries.length = 0;
    turn.entries.forEach((entry, seq) => {
      entry.seq = seq;
    });
    turn.nextSeq = turn.entries.length;
    thread.turns.set(turnId, turn);
    return turn;
  }

  function dispatchOf(
    threadId: ThreadId,
    turnId: string | null,
    thread: ThreadTrace,
    turn: TurnTrace,
    step: number,
    hook: string,
    toolCallId: string | null,
  ): TraceDispatch {
    // 턴 전이었는지는 디스패치를 시작한 때 정한다. 항목은 턴이 열린 뒤에 만들어질 수도 있다
    const pre = turn.holding;
    let entry: MutableEntry | undefined;
    return {
      record(run) {
        // 숨기는 등록의 행은 항목을 만들지도 않는다. 그래서 아무도 돌지 않은 디스패치에는 항목이 없다
        if (deps.hidden?.(run.registrationId) === true) return;
        if (entry === undefined) {
          if (turn.holding) {
            // 턴 전 항목은 가장 먼저 받은 것부터 버려 상한을 지킨다
            if (turn.entries.length >= MAX_PRE_TURN_ENTRIES) turn.entries.shift();
          } else if (turn.entries.length >= MAX_ENTRIES_PER_TURN) {
            return;
          }
          entry = { seq: turn.nextSeq, hook, step, pre, handlers: [] };
          turn.nextSeq += 1;
          turn.entries.push(entry);
          touch(threadId, thread);
        }
        if (entry.handlers.length >= MAX_HANDLERS_PER_ENTRY) return;
        entry.handlers.push({
          registrationId: run.registrationId,
          ms: run.durationMs,
          result: run.result,
          // 턴 전에 실행된 훅은 턴이 열린 시각보다 앞이므로 0이다
          atMs: pre ? 0 : Math.max(0, run.startedAt - turn.openedAt),
          size: run.size,
          skippedBy: run.skippedBy,
          reason: run.reason,
          // 호출 지점이 아니면 키를 두지 않는다(옛 기록과 같은 모양)
          ...(toolCallId === null ? {} : { toolCallId }),
          ...(run.plugin === undefined ? {} : { plugin: run.plugin }),
          ...(run.versionId === undefined ? {} : { versionId: run.versionId }),
          ...(run.sourceKind === undefined ? {} : { sourceKind: run.sourceKind }),
          ...(run.decision === undefined ? {} : { decision: run.decision }),
          ...(run.ask === undefined ? {} : { ask: run.ask }),
        });
        // 턴이 열린 뒤의 기록만 알린다. 듣는 쪽이 없으면 사본도 만들지 않는다
        if (listeners.size === 0 || pre || turnId === null) return;
        const event: TraceRecordEvent = {
          threadId,
          turnId,
          entry: snapshotOf(entry),
          handlerIndex: entry.handlers.length - 1,
        };
        for (const listener of listeners) listener(event);
      },
    };
  }

  function* runsOf(): Generator<HandlerRun> {
    for (const thread of threads.values()) {
      const turns =
        thread.waiting === undefined
          ? thread.turns.values()
          : [thread.waiting, ...thread.turns.values()];
      for (const turn of turns) {
        for (const entry of turn.entries) {
          for (const handler of entry.handlers) {
            yield {
              hook: entry.hook,
              registrationId: handler.registrationId,
              ms: handler.ms,
              result: handler.result,
            };
          }
        }
      }
    }
  }

  /**
   * Turn 키: 그 Turn의 항목으로 적는다. 처음 보는 Turn이면 턴 전 항목을 물려받는다.
   * `boundary.turn.after`는 Turn을 닫는다. 닫힌 뒤의 훅(`boundary.settle.after`)은 그 Turn에 붙지만 현재 Turn으로 세우지는 않는다
   */
  function startTurn(
    threadId: ThreadId,
    turnId: string,
    hook: HookName,
    now: number,
    toolCallId: string | null,
  ): TraceDispatch | undefined {
    const thread = threadOf(threadId);
    let turn = thread.turns.get(turnId);
    if (turn === undefined) {
      turn = openTurn(thread, turnId, now);
      touch(threadId, thread);
    }
    if (hook === "boundary.turn.after") {
      turn.closed = true;
      if (thread.current === turnId) thread.current = undefined;
    } else if (!turn.closed) {
      thread.current = turnId;
    }
    return turn.enabled
      ? dispatchOf(threadId, turnId, thread, turn, 0, hook, toolCallId)
      : undefined;
  }

  /**
   * 키에 Turn이 없는 항목(stp_ 키와 그 밖의 키). 열린 현재 Turn이 있으면 그 Turn에 붙는다(stp_는 단계 번호를 받는다).
   * 열린 Turn이 없으면 턴 전에 실행되는 훅만 다음 Turn을 기다리며 붙잡고, 나머지는 기록하지 않는다.
   * 닫힌 이전 Turn에는 붙이지 않는다(다음 Turn의 턴 전 훅이 이전 Turn에 들어가지 않게 한다)
   */
  function startInCurrent(
    threadId: ThreadId,
    prefix: string,
    hook: HookName,
    now: number,
    toolCallId: string | null,
  ): TraceDispatch | undefined {
    const thread = threads.get(threadId);
    const open = thread === undefined ? undefined : openCurrentOf(thread);
    if (thread !== undefined && open !== undefined) {
      if (!open.enabled) return undefined;
      const step = prefix.startsWith("stp_") ? stepOrdinal(open, prefix) : 0;
      return dispatchOf(threadId, thread.current ?? null, thread, open, step, hook, toolCallId);
    }
    if (!PRE_TURN_HOOKS.has(hook)) return undefined;
    // 계측이 꺼지면 기다리던 항목도 버린다(계측을 다시 켜도 이전 항목이 다음 Turn에 붙지 않는다)
    if (!deps.settings().enabled) {
      if (thread !== undefined) thread.waiting = undefined;
      return undefined;
    }
    const holder = threadOf(threadId);
    const waiting = holder.waiting ?? waitingTrace(now);
    holder.waiting = waiting;
    return dispatchOf(threadId, null, holder, waiting, 0, hook, toolCallId);
  }

  return {
    start({ threadId, dispatchKey, hook, now }) {
      const prefix = prefixOf(dispatchKey);
      const toolCallId = toolCallIdOf(dispatchKey, hook);
      if (prefix.startsWith("trn_")) return startTurn(threadId, prefix, hook, now, toolCallId);
      return startInCurrent(threadId, prefix, hook, now, toolCallId);
    },

    turn(threadId, turnId) {
      if (!deps.settings().enabled) return undefined;
      const turn = threads.get(threadId)?.turns.get(turnId);
      if (turn === undefined || !turn.enabled) return undefined;
      return { traceEnabled: true, retained: true, entries: turn.entries.map(snapshotOf) };
    },

    enabled() {
      return deps.settings().enabled;
    },

    timings(filter) {
      if (!deps.settings().enabled) return { traceEnabled: false, timings: [] };
      return { traceEnabled: true, timings: timingsOf(runsOf(), filter) };
    },

    blockedCount(threadId) {
      if (!deps.settings().enabled) return 0;
      const thread = threads.get(threadId);
      if (thread === undefined) return 0;
      let count = 0;
      for (const turn of thread.turns.values()) {
        if (!turn.enabled) continue;
        for (const entry of turn.entries) {
          // 숨기는 등록의 행은 record에서 이미 빠져 있어 여기서 다시 거르지 않는다
          for (const handler of entry.handlers) {
            if (handler.result === "blocked") count += 1;
          }
        }
      }
      return count;
    },

    forgetThread(threadId) {
      threads.delete(threadId);
    },

    onRecord(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
