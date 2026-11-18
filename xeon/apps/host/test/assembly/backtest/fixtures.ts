import { err, ok, parse } from "@fresnel/contracts";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import { ThreadIdSchema, type IdFactory } from "@fresnel/contracts/conversation";
import type { CallRecord, ScopeKind, TurnRecord, TurnSummary } from "@fresnel/contracts/wire";
import type {
  CandidateCall,
  CandidateHandler,
  CandidateOpenInput,
  CandidateOutcome,
  CandidateRunner,
  ReplayPoint,
} from "@fresnel/ext-host";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import type { TurnRecordReadPort } from "../../../src/assembly/measure/turn-read.ts";

// 돌려 보기 시험의 공용 재료. 기록(CallRecord, TurnRecord), 대화 로그 사건, 가짜 실행기와 가짜 턴 읽기 포트를 만든다.
// 모든 값은 스키마에 맞는 실제 모양이다(시험이 `parse`로 검사하는 경로를 그대로 탄다).

export const AT: number = Date.UTC(2026, 10, 18, 9, 0, 0);
export const ids: IdFactory = fixedIdFactory();

/** 호출 기록 하나. 덮어쓸 칸만 준다 */
export function callOf(toolCallId: string, overrides: Partial<CallRecord> = {}): CallRecord {
  return {
    toolCallId,
    parentToolCallId: null,
    tool: "bash",
    plugin: "core",
    caller: "main",
    callerPlugin: null,
    via: null,
    risk: "exec",
    capability: null,
    callKey: "k0000000000000000",
    targetKey: null,
    afterUntrusted: false,
    verdict: "allowed",
    blockedBy: null,
    hooks: [],
    policy: null,
    approval: null,
    exec: null,
    result: null,
    ...overrides,
  };
}

/** 훅 기록의 막음 한 줄 자리: 실제 막은 플러그인과 훅 이름을 가진 `blockedBy`를 만든다 */
export function blockedBy(plugin: string, hook: string): CallRecord["blockedBy"] {
  return { plugin, hook, registrationId: `${plugin}:h` };
}

/** 턴 기록 하나(단계 0 한 개에 호출을 담는다). 턴의 칸은 시험이 보는 것만 의미가 있고 나머지는 빈 값이다 */
export function turnOf(
  threadId: string,
  turnId: string,
  startedAt: number,
  calls: readonly CallRecord[],
  scope: ScopeKind = "live",
): TurnRecord {
  return {
    schema: 1,
    threadId,
    turnId,
    parent: null,
    origin: "user",
    startedAt,
    endedAt: startedAt + 100,
    status: "completed",
    level: "full",
    complete: true,
    scope,
    profile: null,
    profileRevChanges: [],
    overlay: null,
    testRun: null,
    children: [],
    frames: [],
    steps: [
      {
        stepIndex: 0,
        stepId: `stp_${turnId}`,
        modelCalls: [],
        materials: [],
        advertised: {
          count: 0,
          tokens: 0,
          deferredCount: 0,
          removedCount: 0,
          fingerprint: "fp",
          byPlugin: [],
          tools: [],
        },
        cache: null,
        hooks: [],
        calls: [...calls],
        composition: null,
        recorded: true,
      },
    ],
    turnHooks: [],
    continues: [],
    skills: { listed: [], listedOmitted: 0, read: [] },
    cost: [],
    pluginCalls: [],
    pluginStderr: [],
    flags: {
      blockedIntent: 0,
      blockedFault: 0,
      deniedPolicy: 0,
      deniedHuman: 0,
      deniedNoninteractive: 0,
      replaced: 0,
      cancelledAsk: 0,
      asked: 0,
      modified: 0,
      timedOut: 0,
      failed: 0,
      drive: false,
      cacheBreak: false,
      subagents: 0,
      truncatedMaterials: 0,
      draftActive: false,
      untrackedWrite: false,
    },
    elided: {},
  };
}

/** 목록의 한 줄. 턴 기록에서 요약을 만든다 */
function summaryOf(turn: TurnRecord): TurnSummary {
  return {
    threadId: turn.threadId,
    turnId: turn.turnId,
    startedAt: turn.startedAt,
    endedAt: turn.endedAt,
    status: turn.status,
    scope: turn.scope,
    complete: turn.complete,
    profileId: null,
    stepCount: turn.steps.length,
    callCount: turn.steps.reduce((sum, step) => sum + step.calls.length, 0),
    flags: turn.flags,
    frameDepthMax: 0,
    childCount: 0,
  };
}

/** 대화 로그의 사건 하나. 시험은 `item.recorded`만 쓴다. 대화 id는 `ids.next("thr")`로 만든 값이어야 한다 */
export function envelope(threadId: string, seq: number, payload: unknown): DurableEventEnvelope {
  const id = parse(ThreadIdSchema, threadId);
  if (!id.ok) throw new Error("the fixture thread id must be a thread id");
  return {
    id: ids.next("evt"),
    kind: "item.recorded",
    version: 1,
    threadId: id.value,
    turnId: null,
    stepId: null,
    recordedAt: AT + seq,
    causationId: null,
    correlationId: null,
    payload,
    durable: true,
    seq,
    parentId: null,
  };
}

/** 어시스턴트 항목 하나. 도구 호출 블록을 `calls`대로 담는다 */
export function assistantEvent(
  threadId: string,
  seq: number,
  calls: readonly {
    readonly id: string;
    readonly name: string;
    readonly args: Readonly<Record<string, string>>;
    /** 인자를 읽지 못했다는 표지(모델 출력이 깨졌다) */
    readonly argumentsError?: string;
  }[],
): DurableEventEnvelope {
  return envelope(threadId, seq, {
    item: {
      itemId: ids.next("itm"),
      status: "completed",
      kind: "assistant",
      message: {
        role: "assistant",
        content: calls.map((call) => ({
          type: "toolCall",
          id: call.id,
          name: call.name,
          arguments: call.args,
          ...(call.argumentsError === undefined ? {} : { argumentsError: call.argumentsError }),
        })),
        api: "messages",
        provider: "tape",
        model: "tape-1",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "toolUse",
        timestamp: AT + seq,
      },
      partIds: calls.map(() => ids.next("prt")),
    },
  });
}

/** 도구 결과 항목 하나. 본문은 글자 한 줄이다 */
export function resultEvent(
  threadId: string,
  seq: number,
  toolCallId: string,
  toolName: string,
  text: string,
): DurableEventEnvelope {
  return envelope(threadId, seq, {
    item: {
      itemId: ids.next("itm"),
      status: "completed",
      kind: "toolResult",
      message: {
        role: "toolResult",
        toolCallId,
        toolName,
        content: [{ type: "text", text }],
        isError: false,
        timestamp: AT + seq,
      },
      effectId: null,
    },
  });
}

/** 후보 호출 입력의 `toolCallId`. 입력이 객체가 아니면 undefined다 */
export function payloadIdOf(call: CandidateCall): string | undefined {
  const payload = call.payload;
  if (typeof payload !== "object" || payload === null || !("toolCallId" in payload))
    return undefined;
  const id: unknown = payload.toolCallId;
  return typeof id === "string" ? id : undefined;
}

/** 가짜 실행기 하나. `script`가 호출마다 결과를 정한다. 열지 않고 부르면 던진다(실행기는 열고 나서만 돈다) */
export interface FakeRunner extends CandidateRunner {
  readonly calls: CandidateCall[];
  readonly closes: string[];
  readonly opens: CandidateOpenInput[];
  /** 한 번에 돈 호출 수의 최댓값(순차 실행이면 1) */
  readonly maxInFlight: number;
}

export interface FakeRunnerOptions {
  readonly points?: readonly ReplayPoint[];
  readonly openFails?: boolean;
  readonly script?: (
    call: CandidateCall,
    index: number,
  ) => CandidateOutcome | Promise<CandidateOutcome>;
  /** 호출 하나가 끝나기 전에 부르는 일(취소 시험이 쓴다) */
  readonly onCall?: (index: number) => void;
}

export function fakeRunner(options: FakeRunnerOptions = {}): FakeRunner {
  const points = options.points ?? ["tool.call.before"];
  const calls: CandidateCall[] = [];
  const closes: string[] = [];
  const opens: CandidateOpenInput[] = [];
  let opened = false;
  let inFlight = 0;
  let maxInFlight = 0;
  const handlers = (point: ReplayPoint): CandidateHandler[] =>
    points.includes(point)
      ? [{ registration: "ext:cand:h", handlerIndex: 0, hasState: false, initialState: null }]
      : [];
  return {
    get calls() {
      return calls;
    },
    get closes() {
      return closes;
    },
    get opens() {
      return opens;
    },
    get maxInFlight() {
      return maxInFlight;
    },
    open(input) {
      opens.push(input);
      if (options.openFails === true) {
        return Promise.resolve(err({ kind: "spawn_failed", message: "no process" }));
      }
      opened = true;
      return Promise.resolve(ok([]));
    },
    handlersFor(point) {
      return opened ? handlers(point) : [];
    },
    async run(call) {
      if (!opened) throw new Error("the fake runner was run before it was opened");
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const index = calls.length;
      calls.push(call);
      options.onCall?.(index);
      try {
        return options.script === undefined
          ? { kind: "returned", value: null, ms: 1 }
          : await options.script(call, index);
      } finally {
        inFlight -= 1;
      }
    },
    close(reason) {
      closes.push(reason);
    },
    stderrTail: () => [],
    restarts: 0,
  };
}

/** 턴 기록을 메모리에서 읽는 포트. 목록과 가져오기만 쓴다 */
export function turnPortOf(turns: readonly TurnRecord[]): Pick<TurnRecordReadPort, "list" | "get"> {
  const byKey = new Map<string, TurnRecord>();
  for (const turn of turns) byKey.set(`${turn.threadId}/${turn.turnId}`, turn);
  return {
    list: (query) => ({
      ok: true,
      value: {
        enabled: true,
        level: "full",
        items: turns
          .filter((turn) => turn.threadId === query.threadId)
          .map((turn) => summaryOf(turn)),
        next: null,
      },
    }),
    get: (threadId, turnId) => {
      const found = byKey.get(`${threadId}/${turnId}`);
      if (found === undefined) return { ok: false, error: { kind: "turn_missing" } };
      return { ok: true, value: { enabled: true, level: "full", record: found, absent: null } };
    },
  };
}
