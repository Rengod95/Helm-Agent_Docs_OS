import { join } from "node:path";
import { parse, type Logger } from "@fresnel/contracts";
import {
  StepCompletedPayloadSchema,
  TurnCompletedPayloadSchema,
  type StepContextWarning,
} from "@fresnel/contracts/conversation";
import type { TraceReadPort } from "@fresnel/contracts/extensions";
import type { CommitBatch, SessionService } from "@fresnel/contracts/records";
import type { UsageMeter, UsageRecord } from "@fresnel/contracts/services";
import {
  DEFAULT_RETENTION_DAYS,
  openMeasureStore,
  type MeasureRecord,
  type MeasureStore,
} from "./store.ts";

/** 측정 DB 파일 이름 */
const MEASURE_DB_FILE_NAME = "measure.db";

// T-MEAS-STORE. 내구 이벤트 피드에서 Turn 경계(`turn.completed`)를 보고 Turn 하나의 요약을 측정 저장소에 쓴다.
// 커밋 경로 안에서는 모으기만 하고(TX-09) 쓰기는 마이크로태스크에서 한 묶음으로 한다. 그래서 모델 호출 경로가 SQLite 쓰기를 기다리지 않는다.
// 켜기와 끄기는 `x.operations.trace.enabled`(`enabled()`)로 묶는다. 꺼져 있으면 모으지도 쓰지도 않는다.
// 쓰는 종류(`kind`): `turn`(Turn 요약), `call`(모델 호출 한 번: 지연과 토큰), `hook`(핸들러 실행 한 번: 결과와 시간), `ctx`(단계 요청의 소유자별 토큰), `cache`(캐시 사건).
// 호출(`call`)과 핸들러(`hook`)는 메모리에서 오므로 Turn 경계에서 모은다. 호출은 합산기 구독으로 Turn별로 쌓았다가 `turn.completed` 커밋 때 같은 묶음에 넣고,
// 핸들러는 그 시점에 계측 링 버퍼(`TraceReadPort.turn`)에서 읽는다. `ctx`와 `cache`는 `step.completed` 내구 기록(`composition`, `contextWarnings`)에서 온다.
// 요청 본문은 저장하지 않는다(`storeRequestBody`는 기본 끔이고 이 트랙은 켜는 길을 만들지 않는다).

/** 호출 기록을 Turn별로 쌓는 상한. Turn 경계가 오지 않아도 메모리가 자라지 않게 한다 */
const MAX_PENDING_CALLS = 2000;
/** Turn 하나에서 쓰는 `hook` 행 상한. 링 버퍼 상한(5000)보다 낮게 잡아 한 Turn이 저장소를 키우지 않게 한다 */
const MAX_HOOK_ROWS_PER_TURN = 500;

interface MeasureRecorderDeps {
  readonly session: Pick<SessionService, "feed">;
  /** 모델 호출 합산기(`ModelService.usage`) */
  readonly usage: Pick<UsageMeter, "subscribe">;
  /** 핸들러 계측 링 버퍼 읽기. 없으면 `hook` 기록을 하지 않는다 */
  readonly trace: Pick<TraceReadPort, "turn"> | undefined;
  readonly store: MeasureStore;
  /** 켬 여부(`x.operations.trace.enabled`의 현재 값) */
  readonly enabled: () => boolean;
  readonly logger: Logger;
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
    },
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

/** 캐시를 깬 경고만 기록한다. 원인 소유자는 모델 전환과 도구 보류는 알고(`model`, `tools`), 접두가 바뀐 경우는 합치기 훅 때문이라는 것까지만 안다(`context-hook`) */
function cacheRecord(
  base: { readonly at: number; readonly threadId: string; readonly turnId: string | null },
  stepIndex: number,
  warning: StepContextWarning,
): MeasureRecord | undefined {
  switch (warning.code) {
    case "cache_prefix_reset":
      return {
        ...base,
        kind: "cache",
        metrics: { step: stepIndex, at: warning.at ?? -1 },
        tags: { code: warning.code, owner: "context-hook" },
      };
    case "cache_reset_model_switch":
      return {
        ...base,
        kind: "cache",
        metrics: { step: stepIndex },
        tags: {
          code: warning.code,
          owner: "model",
          from: warning.from ?? "",
          to: warning.to ?? "",
        },
      };
    case "tools_deferred":
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
    case "near_window":
      return undefined;
    default:
      return undefined;
  }
}

/** 피드를 구독해 Turn 경계마다 한 묶음을 쓴다. 돌려주는 함수가 구독을 끊고 남은 묶음을 쓴다 */
function startMeasureRecorder(deps: MeasureRecorderDeps): () => void {
  let pending: MeasureRecord[] = [];
  let scheduled = false;
  /** Turn별로 쌓은 호출. 그 Turn의 `turn.completed` 커밋이 오면 묶음에 넣는다 */
  const callsByTurn = new Map<string, MeasureRecord[]>();
  /** Turn에 속하지 않는 호출(제목 등). 다음 커밋 묶음에 넣는다 */
  let looseCalls: MeasureRecord[] = [];
  let pendingCalls = 0;

  const offUsage = deps.usage.subscribe((call) => {
    if (!deps.enabled() || pendingCalls >= MAX_PENDING_CALLS) return;
    pendingCalls += 1;
    const record = callRecord(call);
    if (call.turnId === null) {
      looseCalls.push(record);
      return;
    }
    const known = callsByTurn.get(call.turnId);
    if (known === undefined) callsByTurn.set(call.turnId, [record]);
    else known.push(record);
  });

  function flush(): void {
    scheduled = false;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const written = deps.store.writeBatch(batch);
    if (!written.ok) {
      deps.logger.warn("measure.write_failed", {
        reason: written.error.kind,
        dropped: batch.length,
      });
    }
  }

  const off = deps.session.feed.onCommit((batch) => {
    if (!deps.enabled()) return;
    for (const event of batch.events) {
      pending.push(...stepRecords(event));
      const record = turnRecord(event);
      if (record === undefined) continue;
      pending.push(record);
      if (event.turnId !== null) {
        const calls = callsByTurn.get(event.turnId) ?? [];
        callsByTurn.delete(event.turnId);
        pendingCalls -= calls.length;
        pending.push(...calls);
        let hookRows = 0;
        for (const entry of deps.trace?.turn(event.threadId, event.turnId)?.entries ?? []) {
          for (const handler of entry.handlers) {
            if (hookRows >= MAX_HOOK_ROWS_PER_TURN) break;
            hookRows += 1;
            pending.push({
              at: event.recordedAt,
              threadId: event.threadId,
              turnId: event.turnId,
              kind: "hook",
              metrics: { ms: handler.ms, seq: entry.seq, step: entry.step },
              tags: {
                hook: entry.hook,
                registrationId: handler.registrationId,
                result: handler.result,
              },
            });
          }
        }
      }
    }
    if (pending.length > 0 && looseCalls.length > 0) {
      pendingCalls -= looseCalls.length;
      pending.push(...looseCalls);
      looseCalls = [];
    }
    if (pending.length > 0 && !scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });

  return () => {
    off();
    offUsage();
    flush();
  };
}

export interface MeasurementDeps {
  /** 측정 DB를 둘 폴더(대화 DB와 같은 데이터 폴더). 파일 이름은 `measure.db`다 */
  readonly dir: string;
  readonly session: Pick<SessionService, "feed">;
  readonly usage: Pick<UsageMeter, "subscribe">;
  readonly trace?: Pick<TraceReadPort, "turn">;
  readonly enabled: () => boolean;
  readonly logger: Logger;
  readonly now: () => number;
  /** 원본 보관 일수(기본 30) */
  readonly retentionDays?: number;
}

/**
 * 측정 저장소를 열고 보존 정리를 한 번 한 뒤 기록기를 켠다. 열지 못하면 로그만 남기고 측정 없이 간다(측정은 대화를 막지 않는다).
 * 돌려주는 함수가 기록기를 끊고 저장소를 닫는다
 */
export function startMeasurement(deps: MeasurementDeps): () => void {
  const opened = openMeasureStore(join(deps.dir, MEASURE_DB_FILE_NAME));
  if (!opened.ok) {
    deps.logger.warn("measure.open_failed", { reason: opened.error.kind });
    return () => undefined;
  }
  const store = opened.value;
  const pruned = store.prune(deps.now(), deps.retentionDays ?? DEFAULT_RETENTION_DAYS);
  if (!pruned.ok) deps.logger.warn("measure.prune_failed", { reason: pruned.error.kind });
  const stop = startMeasureRecorder({
    session: deps.session,
    usage: deps.usage,
    trace: deps.trace,
    store,
    enabled: deps.enabled,
    logger: deps.logger,
  });
  return () => {
    stop();
    store.close();
  };
}
