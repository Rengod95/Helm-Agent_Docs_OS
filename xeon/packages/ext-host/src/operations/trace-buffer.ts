// 핸들러 계측 링 버퍼(X-15, X.operations.spec §3.9·§4.8). thread마다 최근 Turn의 핸들러 기록을 메모리에만 둔다.
// 쓰기는 디스패처가 start·record로 하고, 읽기는 traceReadOf(primitives/host.ts)가 TraceReadPort로 낸다.
// 이 파일은 계약 타입만 가져온다. 디스패처와 호스트 쪽 타입은 여기로 들어오지 않는다.
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type {
  ExtTimingsResult,
  HookName,
  TraceFailureReason,
  TraceHandlerEntry,
  TraceHandlerResult,
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
}

/** 쓰기 중인 항목. 생성된 뒤에는 핸들러 기록만 자란다 */
interface MutableEntry {
  readonly seq: number;
  readonly hook: string;
  readonly step: number;
  readonly handlers: TraceHandlerEntry[];
}

/** Turn 하나의 상태 */
interface TurnTrace {
  /** Turn이 처음 보일 때 읽은 계측 값. 이 Turn의 기록 여부를 정한다 */
  readonly enabled: boolean;
  /** Turn이 처음 보인 시각(디스패처 시계). 핸들러의 `atMs`는 이 값부터 잰다 */
  readonly openedAt: number;
  readonly entries: MutableEntry[];
  /** 단계 식별자 → 단계 번호(첫 발견 순서, 1부터) */
  readonly steps: Map<string, number>;
}

/** thread 하나의 상태 */
interface ThreadTrace {
  /** 삽입 순서가 Turn 순서다. 맨 앞이 가장 오래된 Turn */
  readonly turns: Map<string, TurnTrace>;
  /** 마지막으로 열린 Turn. stp_ 키와 그 밖의 키가 여기에 붙는다 */
  current: string | undefined;
}

/** 접두는 첫 `:` 앞이다. `:`가 없으면 키 전체다 */
function prefixOf(dispatchKey: string): string {
  const colon = dispatchKey.indexOf(":");
  return colon < 0 ? dispatchKey : dispatchKey.slice(0, colon);
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
  return {
    seq: entry.seq,
    hook: entry.hook,
    step: entry.step,
    handlers: [...entry.handlers],
  };
}

export function createTraceBuffer(deps: TraceBufferDeps): TraceBuffer {
  const threads = new Map<string, ThreadTrace>();

  /** thread를 찾는다. 없으면 만들고 thread 수 상한을 넘는 가장 오래된 thread를 뺀다 */
  function threadOf(threadId: string): ThreadTrace {
    const found = threads.get(threadId);
    if (found !== undefined) return found;
    const created: ThreadTrace = { turns: new Map(), current: undefined };
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

  /** 처음 보는 Turn을 연다. 계측 값을 여기서 한 번 읽고 보관 수를 넘는 가장 오래된 Turn을 뺀다 */
  function openTurn(thread: ThreadTrace, turnId: string, now: number): TurnTrace {
    const settings = deps.settings();
    const turn: TurnTrace = {
      enabled: settings.enabled,
      openedAt: now,
      entries: [],
      steps: new Map(),
    };
    thread.turns.set(turnId, turn);
    return turn;
  }

  function dispatchOf(
    threadId: string,
    thread: ThreadTrace,
    turn: TurnTrace,
    step: number,
    hook: string,
  ): TraceDispatch {
    let entry: MutableEntry | undefined;
    return {
      record(run) {
        // 숨기는 등록의 행은 항목을 만들지도 않는다. 그래서 아무도 돌지 않은 디스패치에는 항목이 없다
        if (deps.hidden?.(run.registrationId) === true) return;
        if (entry === undefined) {
          if (turn.entries.length >= MAX_ENTRIES_PER_TURN) return;
          entry = { seq: turn.entries.length, hook, step, handlers: [] };
          turn.entries.push(entry);
          touch(threadId, thread);
        }
        if (entry.handlers.length >= MAX_HANDLERS_PER_ENTRY) return;
        entry.handlers.push({
          registrationId: run.registrationId,
          ms: run.durationMs,
          result: run.result,
          atMs: Math.max(0, run.startedAt - turn.openedAt),
          size: run.size,
          skippedBy: run.skippedBy,
          reason: run.reason,
        });
      },
    };
  }

  function* runsOf(): Generator<HandlerRun> {
    for (const thread of threads.values()) {
      for (const turn of thread.turns.values()) {
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

  /** Turn 키: 그 Turn을 현재 Turn으로 세운다. 계측이 꺼진 Turn도 세워야 뒤의 stp_ 키가 엉뚱한 Turn에 붙지 않는다 */
  function startTurn(
    threadId: string,
    turnId: string,
    hook: HookName,
    now: number,
  ): TraceDispatch | undefined {
    const thread = threadOf(threadId);
    let turn = thread.turns.get(turnId);
    if (turn === undefined) {
      turn = openTurn(thread, turnId, now);
      touch(threadId, thread);
    }
    thread.current = turnId;
    return turn.enabled ? dispatchOf(threadId, thread, turn, 0, hook) : undefined;
  }

  /** stp_ 키와 그 밖의 키: 현재 Turn에 붙는다(stp_는 단계 번호를 받는다). 현재 Turn이 없으면 기록하지 않는다 */
  function startInCurrent(
    threadId: string,
    prefix: string,
    hook: HookName,
  ): TraceDispatch | undefined {
    const thread = threads.get(threadId);
    if (thread === undefined || thread.current === undefined) return undefined;
    const turn = thread.turns.get(thread.current);
    if (turn === undefined || !turn.enabled) return undefined;
    const step = prefix.startsWith("stp_") ? stepOrdinal(turn, prefix) : 0;
    return dispatchOf(threadId, thread, turn, step, hook);
  }

  return {
    start({ threadId, dispatchKey, hook, now }) {
      const prefix = prefixOf(dispatchKey);
      if (prefix.startsWith("trn_")) return startTurn(threadId, prefix, hook, now);
      return startInCurrent(threadId, prefix, hook);
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
  };
}
