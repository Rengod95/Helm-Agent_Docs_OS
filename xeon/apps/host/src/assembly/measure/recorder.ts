import { join } from "node:path";
import { attempt, parse, type Logger } from "@fresnel/contracts";
import {
  StepCompletedPayloadSchema,
  TurnCompletedPayloadSchema,
  type StepContextWarning,
} from "@fresnel/contracts/conversation";
import type {
  ContextTraceEvent,
  PluginCallTraceEvent,
  PluginSetPort,
  ToolCallTraceEvent,
  TraceReadPort,
  TurnBlockEvent,
} from "@fresnel/contracts/extensions";
import {
  AgentSpawnedPayloadSchema,
  type CommitBatch,
  type EventFeed,
} from "@fresnel/contracts/records";
import type { UsageMeter, UsageRecord } from "@fresnel/contracts/services";
import {
  DEFAULT_RETENTION_DAYS,
  openMeasureStore,
  type MeasureRecord,
  type MeasureStore,
} from "./store.ts";
import { cacheExpired } from "./turn-context.ts";
import { DEFAULT_MAX_TURN_BYTES } from "./turn-fit.ts";
import type { TurnRecordEvent, TurnRecordEvents } from "./turn-events.ts";
import { MAX_HOOK_ROWS_PER_TURN } from "./turn-rows.ts";
import { createTurnWriter, type ParentLookup } from "./turn-writer.ts";
import { messageOf } from "../../util.ts";

/** 측정 DB 파일 이름 */
const MEASURE_DB_FILE_NAME = "measure.db";

// T-MEAS-STORE. 내구 이벤트 피드에서 Turn 경계(`turn.completed`)를 보고 Turn 하나의 요약을 측정 저장소에 쓴다.
// 커밋 경로 안에서는 모으기만 하고(TX-09) 쓰기는 마이크로태스크에서 한 묶음으로 한다. 그래서 모델 호출 경로가 SQLite 쓰기를 기다리지 않는다.
// 켜기와 끄기는 `x.operations.trace.enabled`(`enabled()`)로 묶는다. 꺼져 있으면 모으지도 쓰지도 않는다.
// 쓰는 종류(`kind`): `turn`(Turn 요약), `call`(모델 호출 한 번: 지연과 토큰), `hook`(핸들러 실행 한 번: 결과 다섯, 시간, Turn 시작 후 시점, 바뀐 크기), `ctx`(단계 요청의 소유자별 토큰), `cache`(캐시 사건).
// 호출(`call`)과 핸들러(`hook`)는 메모리에서 오므로 Turn 경계에서 모은다. 호출은 합산기 구독으로 Turn별로 쌓았다가 `turn.completed` 커밋 때 같은 묶음에 넣고,
// 핸들러는 그 시점에 계측 링 버퍼(`TraceReadPort.turn`)에서 읽는다. `ctx`와 `cache`는 `step.completed` 내구 기록(`composition`, `contextWarnings`)에서 온다.
// 요청 본문(`body`)은 `x.operations.trace.storeRequestBody`가 켜졌을 때만 저장한다(기본 끔). 마스킹 함수(`mask`)가 없으면 켜져 있어도 저장하지 않는다.
// 보존: 원본은 `x.operations.trace.retentionDays`(기본 30일)가 지나면 일별 집계로 접고 지운다. 시작할 때 한 번, 그 뒤에는 쓰기 묶음마다 1시간에 한 번 확인한다.

/** 호출 기록을 Turn별로 쌓는 상한. Turn 경계가 오지 않아도 메모리가 자라지 않게 한다 */
const MAX_PENDING_CALLS = 2000;
/** 보존 정리를 다시 확인하는 간격(ms) */
const PRUNE_INTERVAL_MS = 3_600_000;
/** 요청 본문 한 건의 글자 수 상한. 넘으면 잘라서 저장하고 `truncated`를 1로 남긴다 */
const MAX_BODY_CHARS = 262_144;
/** 아직 쓰지 않은 본문 행의 상한 */
const MAX_PENDING_BODIES = 20;

/** 저장소 쓰기 한 건. 마이크로태스크의 묶음에서 넣은 순서대로 실행한다 */
type StoreOp = (store: MeasureStore) => void;

interface MeasureRecorderDeps {
  readonly session: { readonly feed: Pick<EventFeed, "onCommit"> };
  /** 모델 호출 합산기(`ModelService.usage`) */
  readonly usage: Pick<UsageMeter, "subscribe">;
  /** 핸들러 계측 링 버퍼 읽기. 없으면 `hook` 기록을 하지 않는다 */
  readonly trace: Pick<TraceReadPort, "turn" | "onRecord"> | undefined;
  /** 대화의 프로필 포트를 얻는 함수. 없거나 undefined면 턴 시작의 프로필은 대화 로그의 사건만으로 정한다 */
  readonly pluginSet: (() => Pick<PluginSetPort, "resolve"> | undefined) | undefined;
  readonly store: MeasureStore;
  /** 턴 기록 테이블을 쓸 수 있는가(`store.turnRecordAvailable()`). 거짓이면 턴 행과 단계 행을 쓰지 않는다 */
  readonly turnRecords: boolean;
  /** 켬 여부(`x.operations.trace.enabled`의 현재 값) */
  readonly enabled: () => boolean;
  readonly logger: Logger;
  /** 쓰기 묶음마다 부르는 보존 확인. 한 번에 1시간 간격으로만 정리한다 */
  readonly maintain: () => void;
  /** 요청 본문 저장 여부(`x.operations.trace.storeRequestBody`의 현재 값) */
  readonly storeBody: () => boolean;
  /** 시크릿 값을 가린다. 없으면 본문을 저장하지 않는다 */
  readonly mask: ((text: string) => string) | undefined;
  /** 턴 기록이 쓰인 사건의 버스(구독 알림의 원천) */
  readonly events?: Pick<TurnRecordEvents, "emit">;
  /** `x.operations.trace.maxTurnBytes`의 현재 값 */
  readonly maxTurnBytes: () => number;
  /** `x.operations.trace.testRunsAlwaysOn`의 현재 값 */
  readonly testRunsAlwaysOn: () => boolean;
  /** 하위 대화의 부모(`agentOfChild`). 범위 표지를 부모에게서 물려받을 때 따라 올라간다(§4.6 규칙 31) */
  readonly parentOf?: ParentLookup;
}

/** 확장 핸들러 실패 한 건(`scope.handler_failed`의 값). 휘발 이벤트라 이 기록이 재시작 뒤에도 남는 유일한 사본이다 */
export interface HandlerFailureInput {
  readonly at: number;
  readonly owner: string;
  readonly point: string;
  readonly result: string;
  readonly message: string;
  readonly consecutive: number;
}

/** 실패 메시지를 저장하는 글자 수 상한 */
const MAX_FAILURE_MESSAGE_CHARS = 500;

/** 모델로 나간 요청 본문 한 건(측정 쪽 입력) */
export interface RequestBodyInput {
  readonly threadId: string;
  readonly turnId: string | null;
  readonly stepIndex: number;
  readonly at: number;
  /** 직렬화 전 요청. 이 함수가 JSON으로 바꾼다 */
  readonly body: unknown;
}

/** `turn.completed` 한 건의 측정 한 줄. 사용량이 없는 종료(중단 등)는 토큰과 비용을 0으로 둔다 */
function turnRecord(event: CommitBatch["events"][number]): MeasureRecord | undefined {
  if (event.kind !== "turn.completed") return undefined;
  const parsed = parse(TurnCompletedPayloadSchema, event.payload);
  if (!parsed.ok) return undefined;
  const { usage, status, stepCount } = parsed.value;
  return {
    at: event.recordedAt,
    threadId: event.threadId,
    turnId: event.turnId,
    kind: "turn",
    metrics: {
      steps: stepCount,
      input: usage?.input ?? 0,
      output: usage?.output ?? 0,
      cacheRead: usage?.cacheRead ?? 0,
      cacheWrite: usage?.cacheWrite ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      usd: usage?.cost.total ?? 0,
    },
    tags: { status },
  };
}

/** 호출 한 번의 측정 한 줄. 시작·첫 토큰 시각이 없는 기록(옛 대역)은 지연 칸을 비운다 */
function callRecord(call: UsageRecord): MeasureRecord {
  const metrics: Record<string, number> = {
    durationMs: call.startedAt === undefined ? 0 : Math.max(0, call.recordedAt - call.startedAt),
    input: call.usage.input,
    output: call.usage.output,
    cacheRead: call.usage.cacheRead,
    cacheWrite: call.usage.cacheWrite,
    totalTokens: call.usage.totalTokens,
    usd: call.usage.cost.total,
  };
  if (call.startedAt !== undefined) metrics["startedAt"] = call.startedAt;
  if (call.startedAt !== undefined && typeof call.firstTokenAt === "number") {
    metrics["firstTokenMs"] = Math.max(0, call.firstTokenAt - call.startedAt);
  }
  return {
    at: call.recordedAt,
    threadId: call.threadId,
    turnId: call.turnId,
    kind: "call",
    metrics,
    tags: {
      role: call.role,
      provider: call.provider,
      model: call.modelId,
      stopReason: call.stopReason,
      ...(call.scopeId === null ? {} : { scope: call.scopeId }),
      ...(call.requestId === undefined ? {} : { request: call.requestId }),
    },
  };
}

/** 하위 대화를 만든 쪽. 그 대화에서 나간 호출(하위 에이전트의 main, 웹 검색)을 소유 그룹과 부모 대화에 귀속하는 데 쓴다 */
interface ChildOwner {
  readonly scopeId: string | null;
  readonly parentThreadId: string;
  /** 자식을 띄운 때의 부모 Turn. 없으면(Turn 밖 drive) 그때 가장 나중에 끝난 부모 Turn이다. 부모 Turn을 읽을 때 자식 호출을 합치는 근거 */
  readonly parentTurnId: string | null;
  readonly requestId: string;
}

/** 소유 하위 대화 표의 상한. 넘으면 가장 먼저 들어온 것부터 뺀다 */
const MAX_CHILD_OWNERS = 500;

/** 호출 행에 소유 하위 대화의 귀속을 더한다: 호출 자신의 scope가 없으면 소유 그룹이, 부모 대화와 자식 요청 id는 항상 */
function ownedCallRecord(record: MeasureRecord, owner: ChildOwner | undefined): MeasureRecord {
  if (owner === undefined) return record;
  return {
    ...record,
    tags: {
      ...(owner.scopeId === null || record.tags["scope"] !== undefined
        ? {}
        : { scope: owner.scopeId }),
      ...record.tags,
      ownerThread: owner.parentThreadId,
      ownerRequest: owner.requestId,
      ...(owner.parentTurnId === null ? {} : { ownerTurn: owner.parentTurnId }),
    },
  };
}

/** 앞 호출과 견줄 수 있게 남기는, thread별 가장 나중의 main 호출 */
interface PriorCall {
  readonly model: string;
  readonly at: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/**
 * 캐시 만료 사건. 같은 모델의 앞 main 호출보다 캐시 쓰기가 두 배 넘게(그리고 1000 이상) 늘고 캐시 읽기가 반 밑으로 줄었으면
 * 접두를 통째로 다시 쓴 것이다(보통 5분을 넘겨 캐시가 만료된 호출). 앞 호출이 없거나 모델이 바뀌었으면(`cache_reset_model_switch`가 따로 있다) 아니다
 */
function cacheExpiredRecord(
  prior: PriorCall | undefined,
  call: UsageRecord,
  step: number,
): MeasureRecord | undefined {
  // 판정은 턴 기록의 캐시 원인과 같은 함수를 쓴다(turn-context.ts `cacheExpired`)
  const current = { model: call.modelId, ...call.usage };
  if (prior === undefined || !cacheExpired(prior, current)) return undefined;
  const { cacheRead, cacheWrite } = call.usage;
  return {
    at: call.recordedAt,
    threadId: call.threadId,
    turnId: call.turnId,
    kind: "cache",
    metrics: {
      step,
      cacheWrite,
      priorCacheWrite: prior.cacheWrite,
      cacheRead,
      priorCacheRead: prior.cacheRead,
      gapMs: Math.max(0, (call.startedAt ?? call.recordedAt) - prior.at),
    },
    tags: { code: "cache_expired", owner: "ttl" },
  };
}

/** `step.completed`의 요청 구성(`ctx`)과 캐시 사건(`cache`) */
function stepRecords(event: CommitBatch["events"][number]): readonly MeasureRecord[] {
  if (event.kind !== "step.completed") return [];
  const parsed = parse(StepCompletedPayloadSchema, event.payload);
  if (!parsed.ok) return [];
  const { composition, contextWarnings, stepIndex } = parsed.value;
  const base = { at: event.recordedAt, threadId: event.threadId, turnId: event.turnId };
  const out: MeasureRecord[] = [];
  if (composition !== undefined) {
    const metrics: Record<string, number> = {
      step: stepIndex,
      system: composition.system,
      tools: composition.tools,
      injected: composition.injected,
      volatile: composition.volatile,
      history: composition.history,
      total: composition.total,
    };
    for (const [owner, tokens] of Object.entries(composition.sections)) {
      metrics[`section.${owner}`] = tokens;
    }
    out.push({ ...base, kind: "ctx", metrics, tags: {} });
  }
  for (const warning of contextWarnings ?? []) {
    const cache = cacheRecord(base, stepIndex, warning);
    if (cache !== undefined) out.push(cache);
  }
  return out;
}

/**
 * 캐시를 깬 경고만 기록한다. 원인 소유자는 모델 전환(`model`)과 도구 보류(`tools`), 접두가 바뀐 경우는 바꾼 핸들러의 플러그인이다.
 * 접두 변경(`cache_prefix_reset`)은 바뀐 위치(`at`), 바뀐 부분(`changed`), 바꾼 Registration(`registrations`)과 플러그인(`plugins`)을 남긴다.
 * 소유자를 모르는 옛 기록(`owners`·`plugins` 없음)은 `context-hook`으로 둔다
 */
function cacheRecord(
  base: { readonly at: number; readonly threadId: string; readonly turnId: string | null },
  stepIndex: number,
  warning: StepContextWarning,
): MeasureRecord | undefined {
  if (warning.code === "cache_prefix_reset") {
    const plugins = warning.plugins ?? [];
    return {
      ...base,
      kind: "cache",
      metrics: { step: stepIndex, at: warning.at ?? -1 },
      tags: {
        code: warning.code,
        owner: plugins[0] ?? "context-hook",
        plugins: plugins.join(","),
        registrations: (warning.owners ?? []).join(","),
        changed: (warning.changed ?? []).join(","),
      },
    };
  }
  if (warning.code === "cache_reset_model_switch") {
    return {
      ...base,
      kind: "cache",
      metrics: { step: stepIndex },
      tags: { code: warning.code, owner: "model", from: warning.from ?? "", to: warning.to ?? "" },
    };
  }
  if (warning.code === "tools_deferred") {
    return {
      ...base,
      kind: "cache",
      metrics: {
        step: stepIndex,
        added: warning.added?.length ?? 0,
        removed: warning.removed?.length ?? 0,
      },
      tags: { code: warning.code, owner: "tools" },
    };
  }
  // near_window는 캐시 사건이 아니다
  return undefined;
}

/** 피드를 구독해 Turn 경계마다 한 묶음을 쓴다. 돌려주는 함수가 구독을 끊고 남은 묶음을 쓴다 */
function startMeasureRecorder(deps: MeasureRecorderDeps): {
  readonly stop: () => void;
  readonly offerBody: (input: RequestBodyInput) => void;
  readonly offerFailure: (input: HandlerFailureInput) => void;
  readonly offerCall: (input: ToolCallTraceEvent) => void;
  readonly offerPluginCall: (input: PluginCallTraceEvent) => void;
  readonly offerContext: (input: ContextTraceEvent) => void;
  readonly offerTurnRecord: (input: TurnBlockEvent) => void;
  /** 대화를 지운다. 대기 중인 쓰기를 먼저 쓰고 그 대화의 열린 턴 상태를 버린다 */
  readonly forget: (threadId: string) => void;
} {
  let pending: MeasureRecord[] = [];
  let pendingBodies = 0;
  let scheduled = false;
  /** 턴 기록 쓰기 묶음. 커밋 경로는 여기 넣기만 하고 마이크로태스크가 쓴다 */
  let pendingOps: StoreOp[] = [];
  const enqueueOp = (op: StoreOp): void => {
    pendingOps.push(op);
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  };
  /** 쓰기 묶음 안에서 나온 턴 기록 사건. 묶음이 커밋된 뒤에 보낸다(롤백된 행을 알리지 않는다). 묶음 밖에서는 바로 보낸다 */
  let queuedEvents: TurnRecordEvent[] | undefined;
  const sink = deps.events;
  const turnEvents: Pick<TurnRecordEvents, "emit"> | undefined =
    sink === undefined
      ? undefined
      : {
          emit: (event) => {
            if (queuedEvents === undefined) sink.emit(event);
            else queuedEvents.push(event);
          },
        };
  const turns = deps.turnRecords
    ? createTurnWriter({
        store: deps.store,
        trace: deps.trace,
        pluginSet: deps.pluginSet,
        enabled: deps.enabled,
        logger: deps.logger,
        queue: enqueueOp,
        ...(turnEvents === undefined ? {} : { events: turnEvents }),
        maxTurnBytes: deps.maxTurnBytes,
        testRunsAlwaysOn: deps.testRunsAlwaysOn,
        ...(deps.parentOf === undefined ? {} : { parentOf: deps.parentOf }),
      })
    : undefined;
  /** Turn별로 쌓은 호출. 그 Turn의 `turn.completed` 커밋이 오면 묶음에 넣는다 */
  const callsByTurn = new Map<string, MeasureRecord[]>();
  /** thread별로 가장 나중에 끝난 Turn. Turn 밖 호출(제목 등)이 어느 Turn 뒤의 호출인지 붙이는 데 쓴다 */
  const lastTurnOfThread = new Map<string, string>();
  const priorMainCall = new Map<string, PriorCall>();
  /** 하위 대화 id → 만든 쪽. `agent.spawned` 커밋이 채운다(자식의 첫 호출보다 먼저 커밋된다) */
  const childOwners = new Map<string, ChildOwner>();
  let pendingCalls = 0;

  // 훅 실행이 끝난 직후의 알림. Hook을 부르는 길 위에서 불리므로 던지지 않는다. 실패는 기록하고 그 알림만 건너뛴다
  const offHooks = deps.trace?.onRecord?.((event) => {
    const sent = attempt(() => turns?.hook(event));
    if (!sent.ok) deps.logger.warn("measure.hook_live_failed", { turnId: event.turnId });
  });
  const offUsage = deps.usage.subscribe((call) => {
    // 단계의 모델 호출은 턴 기록이 모은다(계측이 켜진 턴만 쓰므로 여기서 거르지 않는다)
    turns?.usage(call);
    if (!deps.enabled() || pendingCalls >= MAX_PENDING_CALLS) return;
    pendingCalls += 1;
    const record = ownedCallRecord(callRecord(call), childOwners.get(call.threadId));
    if (call.turnId === null) {
      // Turn 밖 호출(제목, 요약, 검색, 판정)은 다음 Turn을 기다리지 않고 바로 쓴다. 어느 Turn 뒤의 호출인지는 `afterTurn` 태그로 남긴다
      const after = lastTurnOfThread.get(call.threadId);
      pending.push(
        after === undefined ? record : { ...record, tags: { ...record.tags, afterTurn: after } },
      );
      pendingCalls -= 1;
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
      return;
    }
    const known = callsByTurn.get(call.turnId) ?? [];
    known.push(record);
    if (call.role === "main") {
      const step = known.filter((row) => row.kind === "call").length;
      const expired = cacheExpiredRecord(priorMainCall.get(call.threadId), call, step);
      if (expired !== undefined) {
        known.push(expired);
        pendingCalls += 1;
      }
      priorMainCall.set(call.threadId, {
        model: call.modelId,
        at: call.recordedAt,
        cacheRead: call.usage.cacheRead,
        cacheWrite: call.usage.cacheWrite,
      });
    }
    callsByTurn.set(call.turnId, known);
  });

  /**
   * 묶음 하나를 커밋 하나로 쓴다: 쌓인 작업을 차례로 돌리고 측정 행을 쓴다. 작업이 던지면 그 작업만 로그에 남기고 나머지는 계속 쓴다.
   * 묶음이 롤백되면 그 안에서 나온 턴 기록 사건은 보내지 않는다. 보존 정리는 묶음 밖에서 한다.
   */
  function flush(): void {
    scheduled = false;
    // 쌓인 것이 없으면 트랜잭션도 열지 않는다(`stop`과 `forget`은 쌓인 것이 없어도 부른다)
    if (pendingOps.length === 0 && pending.length === 0) return;
    const ops = pendingOps;
    pendingOps = [];
    const records = pending;
    pending = [];
    pendingBodies = 0;
    const heard: TurnRecordEvent[] = [];
    queuedEvents = heard;
    const committed = deps.store.batch(() => {
      for (const op of ops) {
        const mark = heard.length;
        const ran = attempt(() => op(deps.store));
        if (!ran.ok) {
          heard.splice(mark);
          deps.logger.warn("measure.op_failed", {
            reason: ran.error.kind,
            message: messageOf(ran.error.cause),
          });
        }
      }
      if (records.length === 0) return;
      const written = deps.store.writeBatch(records);
      if (!written.ok) {
        deps.logger.warn("measure.write_failed", {
          reason: written.error.kind,
          dropped: records.length,
        });
      }
    });
    queuedEvents = undefined;
    if (!committed.ok) {
      deps.logger.warn("measure.write_failed", {
        reason: committed.error.kind,
        dropped: records.length,
      });
    } else if (sink !== undefined) {
      for (const event of heard) sink.emit(event);
    }
    if (records.length === 0) return;
    deps.maintain();
  }

  /** 핸들러 실패 한 건을 `handler_failed` 행으로 모은다. thread가 없는 알림이라 threadId는 빈 문자열이다 */
  function offerFailure(input: HandlerFailureInput): void {
    if (!deps.enabled()) return;
    pending.push({
      at: input.at,
      threadId: "",
      turnId: null,
      kind: "handler_failed",
      metrics: { consecutive: input.consecutive },
      tags: {
        owner: input.owner,
        point: input.point,
        result: input.result,
        message: input.message.slice(0, MAX_FAILURE_MESSAGE_CHARS),
      },
    });
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  /** 켜져 있고 가릴 수단이 있을 때만 본문 행을 모은다. 가린 뒤의 문자열만 행에 들어간다 */
  function offerBody(input: RequestBodyInput): void {
    if (!deps.enabled() || !deps.storeBody() || deps.mask === undefined) return;
    if (pendingBodies >= MAX_PENDING_BODIES) return;
    const json = attempt(() => JSON.stringify(input.body));
    if (!json.ok || typeof json.value !== "string") return;
    const truncated = json.value.length > MAX_BODY_CHARS;
    const masked = deps.mask(truncated ? json.value.slice(0, MAX_BODY_CHARS) : json.value);
    pendingBodies += 1;
    pending.push({
      at: input.at,
      threadId: input.threadId,
      turnId: input.turnId,
      kind: "body",
      metrics: { step: input.stepIndex, chars: masked.length, truncated: truncated ? 1 : 0 },
      tags: { body: masked },
    });
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  }

  const off = deps.session.feed.onCommit((batch) => {
    // 턴 기록은 계측이 꺼져도 턴 행을 쓴다(규칙 3: `log_only`). 아래의 측정 행 수집은 켜져 있을 때만 한다
    for (const event of batch.events) turns?.event(event);
    if (!deps.enabled()) return;
    for (const event of batch.events) {
      if (event.kind === "agent.spawned") {
        const spawned = parse(AgentSpawnedPayloadSchema, event.payload);
        if (spawned.ok) {
          const { owner } = spawned.value;
          childOwners.set(spawned.value.childThreadId, {
            scopeId: owner.kind === "tool" ? null : owner.scopeId,
            parentThreadId: event.threadId,
            parentTurnId: event.turnId ?? lastTurnOfThread.get(event.threadId) ?? null,
            requestId: spawned.value.requestId,
          });
          const oldest =
            childOwners.size > MAX_CHILD_OWNERS ? childOwners.keys().next() : undefined;
          if (oldest !== undefined && oldest.done !== true) childOwners.delete(oldest.value);
        }
      }
      pending.push(...stepRecords(event));
      const record = turnRecord(event);
      if (record === undefined) continue;
      const turnIndex = pending.push(record) - 1;
      if (event.turnId !== null) {
        lastTurnOfThread.set(event.threadId, event.turnId);
        const calls = callsByTurn.get(event.turnId) ?? [];
        callsByTurn.delete(event.turnId);
        pendingCalls -= calls.length;
        pending.push(...calls);
        let hookRows = 0;
        let skippedByEarlier = 0;
        for (const entry of deps.trace?.turn(event.threadId, event.turnId)?.entries ?? []) {
          for (const handler of entry.handlers) {
            if (hookRows >= MAX_HOOK_ROWS_PER_TURN) break;
            hookRows += 1;
            if (handler.skippedBy !== null) skippedByEarlier += 1;
            pending.push({
              at: event.recordedAt,
              threadId: event.threadId,
              turnId: event.turnId,
              kind: "hook",
              metrics: {
                ms: handler.ms,
                seq: entry.seq,
                step: entry.step,
                atMs: handler.atMs,
                size: handler.size,
              },
              tags: {
                hook: entry.hook,
                registrationId: handler.registrationId,
                result: handler.result,
                ...(handler.skippedBy === null ? {} : { skippedBy: handler.skippedBy }),
                ...(handler.reason === null ? {} : { reason: handler.reason }),
              },
            });
          }
        }
        // 앞 핸들러 때문에 건너뛴 횟수는 Turn 요약 행에 둔다. 상한 때문에 버린 행은 세지 않는다
        pending[turnIndex] = {
          ...record,
          metrics: { ...record.metrics, hookSkippedByEarlier: skippedByEarlier },
        };
      }
    }
    if (pending.length > 0 && !scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });

  return {
    stop: () => {
      off();
      offUsage();
      offHooks?.();
      flush();
    },
    offerBody,
    offerFailure,
    offerCall,
    offerPluginCall,
    offerContext,
    offerTurnRecord,
    forget: (threadId) => {
      flush();
      turns?.forget(threadId);
    },
  };

  /** 도구 호출 하나가 닫힌 줄을 턴 기록에 넘긴다. 계측이 꺼져 있거나 턴 기록을 쓸 수 없으면 아무것도 하지 않는다 */
  function offerCall(input: ToolCallTraceEvent): void {
    turns?.call(input);
  }

  /** 가벼운 길의 플러그인 호출 줄을 턴 기록에 넘긴다. 턴은 기록기가 이 대화의 열린 턴에서 정한다. 없으면 버린다 */
  function offerPluginCall(input: PluginCallTraceEvent): void {
    turns?.pluginCall(input);
  }

  /** 조립 재료·광고와 스킬 읽기를 턴 기록에 넘긴다. 계측이 꺼져 있거나 턴 기록을 쓸 수 없으면 아무것도 하지 않는다 */
  function offerContext(input: ContextTraceEvent): void {
    turns?.context(input);
  }

  /** 색인·기억 블록의 사실을 턴 기록에 넘긴다. 열린 턴이 없거나 계측이 꺼져 있으면 버린다 */
  function offerTurnRecord(input: TurnBlockEvent): void {
    turns?.turnRecord(input);
  }
}

export interface MeasurementDeps {
  /** 측정 DB를 둘 폴더(대화 DB와 같은 데이터 폴더). 파일 이름은 `measure.db`다 */
  readonly dir: string;
  readonly session: { readonly feed: Pick<EventFeed, "onCommit"> };
  readonly usage: Pick<UsageMeter, "subscribe">;
  readonly trace?: Pick<TraceReadPort, "turn">;
  /**
   * 대화의 프로필 포트(`PluginSetPortKey`)를 얻는 함수. 조립이 포트를 만들기 전에는 undefined를 준다.
   * 기록기를 켠 뒤 처음 보는 대화의 턴 시작 프로필 값에만 쓴다(§4.10 규칙 60)
   */
  readonly pluginSet?: () => Pick<PluginSetPort, "resolve"> | undefined;
  readonly enabled: () => boolean;
  readonly logger: Logger;
  readonly now: () => number;
  /** 원본 보관 일수(`x.operations.trace.retentionDays`의 현재 값). 없으면 기본 30 */
  readonly retentionDays?: () => number;
  /** 요청 본문 저장 여부(`x.operations.trace.storeRequestBody`의 현재 값). 없으면 끔 */
  readonly storeRequestBody?: () => boolean;
  /** 시크릿 값을 가리는 함수. 없으면 본문을 저장하지 않는다 */
  readonly mask?: (text: string) => string;
  /** 턴 기록 사건 버스. 턴 기록이 쓰이거나 대화가 지워지면 알린다 */
  readonly events?: Pick<TurnRecordEvents, "emit">;
  /** `x.operations.trace.maxTurnBytes`의 현재 값. 없으면 기본 262144 */
  readonly maxTurnBytes?: () => number;
  /** `x.operations.trace.testRunsAlwaysOn`의 현재 값. 없으면 참 */
  readonly testRunsAlwaysOn?: () => boolean;
  /** 하위 대화의 부모(`agentOfChild`). 없으면 하위 대화도 자기 범위 표지만 본다(§4.6 규칙 31) */
  readonly parentOf?: ParentLookup;
}

/**
 * 측정 저장소를 열고 보존 정리를 한 번 한 뒤 기록기를 켠다. 열지 못하면 로그만 남기고 측정 없이 간다(측정은 대화를 막지 않는다).
 * `stop`이 기록기를 끊고 저장소를 닫는다
 */
export function startMeasurement(deps: MeasurementDeps): {
  readonly stop: () => void;
  /** 열린 저장소(읽기 포트용). 열지 못했으면 undefined */
  readonly store: MeasureStore | undefined;
  /** 모델로 나간 요청 본문을 넘긴다. 저장 설정이 꺼져 있거나 가릴 수단이 없으면 아무것도 하지 않는다 */
  readonly offerBody: (input: RequestBodyInput) => void;
  /** 확장 핸들러 실패를 `handler_failed` 행으로 남긴다. 계측이 꺼져 있으면 아무것도 하지 않는다 */
  readonly offerFailure: (input: HandlerFailureInput) => void;
  /** 도구 호출 하나가 닫힌 줄을 턴 기록에 넘긴다(읽기 전용 싱크의 뒤). 계측이 꺼져 있거나 저장소가 없으면 아무것도 하지 않는다 */
  readonly offerCall: (input: ToolCallTraceEvent) => void;
  /** 가벼운 길의 플러그인 호출 줄을 턴 기록에 넘긴다(읽기 전용 싱크의 뒤). 열린 턴이 없으면 버린다 */
  readonly offerPluginCall: (input: PluginCallTraceEvent) => void;
  /** 조립 재료·광고와 스킬 읽기를 턴 기록에 넘긴다(읽기 전용 싱크의 뒤). 계측이 꺼져 있거나 저장소가 없으면 아무것도 하지 않는다 */
  readonly offerContext: (input: ContextTraceEvent) => void;
  /** 색인·기억 블록의 사실을 턴 기록에 넘긴다(턴 기록 싱크의 뒤). 열린 턴이 없거나 계측이 꺼져 있으면 버린다 */
  readonly offerTurnRecord: (input: TurnBlockEvent) => void;
  /** 대화를 지운다. 그 대화의 `tr_*` 행과 쌓인 턴 상태를 지운다(§4.1 규칙 9). 저장소가 없으면 아무것도 하지 않는다 */
  readonly forgetThread: (threadId: string) => void;
} {
  const opened = openMeasureStore(join(deps.dir, MEASURE_DB_FILE_NAME));
  if (!opened.ok) {
    deps.logger.warn("measure.open_failed", { reason: opened.error.kind });
    return {
      stop: () => undefined,
      store: undefined,
      offerBody: () => undefined,
      offerFailure: () => undefined,
      offerCall: () => undefined,
      offerPluginCall: () => undefined,
      offerContext: () => undefined,
      offerTurnRecord: () => undefined,
      forgetThread: () => undefined,
    };
  }
  const store = opened.value;
  // 열린 Turn은 프로세스가 죽었을 때 남은 것이다. 열 때 한 번 `lost`로 바꾼다(§4.1 규칙 5)
  if (store.turnRecordAvailable()) {
    const lost = store.markLostTurns();
    if (!lost.ok) deps.logger.warn("measure.mark_lost_failed", { reason: lost.error.kind });
  }
  const retention = (): number => deps.retentionDays?.() ?? DEFAULT_RETENTION_DAYS;
  let lastPrune = Number.NEGATIVE_INFINITY;
  /** 보존 기간이 지난 원본을 일별 집계로 접고 지운다. 1시간에 한 번만 한다 */
  function maintain(): void {
    const now = deps.now();
    if (now - lastPrune < PRUNE_INTERVAL_MS) return;
    lastPrune = now;
    const pruned = store.prune(now, retention());
    if (!pruned.ok) deps.logger.warn("measure.prune_failed", { reason: pruned.error.kind });
  }
  maintain();
  // 턴 기록을 쓸 수 있게 된 시각(§4.8, 지난 턴의 `purged`와 `never_recorded`를 가른다). 이미 있으면 바꾸지 않는다
  if (store.turnRecordAvailable()) {
    const marked = store.markRecordingSince(deps.now());
    if (!marked.ok) deps.logger.warn("measure.mark_since_failed", { reason: marked.error.kind });
  }
  const recorder = startMeasureRecorder({
    session: deps.session,
    usage: deps.usage,
    trace: deps.trace,
    pluginSet: deps.pluginSet,
    store,
    enabled: deps.enabled,
    logger: deps.logger,
    maintain,
    storeBody: deps.storeRequestBody ?? (() => false),
    mask: deps.mask,
    turnRecords: store.turnRecordAvailable(),
    ...(deps.events === undefined ? {} : { events: deps.events }),
    maxTurnBytes: deps.maxTurnBytes ?? (() => DEFAULT_MAX_TURN_BYTES),
    testRunsAlwaysOn: deps.testRunsAlwaysOn ?? (() => true),
    ...(deps.parentOf === undefined ? {} : { parentOf: deps.parentOf }),
  });
  return {
    stop: () => {
      recorder.stop();
      store.close();
    },
    store,
    offerBody: recorder.offerBody,
    offerFailure: recorder.offerFailure,
    offerCall: recorder.offerCall,
    offerPluginCall: recorder.offerPluginCall,
    offerContext: recorder.offerContext,
    offerTurnRecord: recorder.offerTurnRecord,
    forgetThread: (threadId) => {
      recorder.forget(threadId);
      const removed = store.forgetThread(threadId);
      if (!removed.ok) deps.logger.warn("measure.forget_failed", { reason: removed.error.kind });
    },
  };
}
