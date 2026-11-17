import { parse, type Logger } from "@fresnel/contracts";
import {
  StepCompletedPayloadSchema,
  TurnCompletedPayloadSchema,
  TurnStartedPayloadSchema,
  type TurnId,
} from "@fresnel/contracts/conversation";
import type {
  ContextTraceEvent,
  ToolCallTraceEvent,
  TraceReadPort,
} from "@fresnel/contracts/extensions";
import type { DurableEventEnvelope } from "@fresnel/contracts/records";
import type { UsageRecord } from "@fresnel/contracts/services";
import {
  SCOPE_KINDS,
  type RecordLevel,
  type ScopeKind,
  type TurnStatus,
} from "@fresnel/contracts/wire";
import type { MeasureStore } from "./store.ts";
import {
  advertisedRecordOf,
  cacheBreakOf,
  MAX_MATERIAL_ROWS_PER_TURN,
  MAX_SKILL_ROWS_PER_TURN,
  materialKeyOf,
  materialPlanOf,
  materialsFingerprintOf,
  nameOf,
  noteToolRows,
  trCacheRowsOf,
  trMaterialRowOf,
  trToolUseRowOf,
  type CacheUsage,
} from "./turn-context.ts";
import type { TrSkillRow, TrStepBatch, TrToolUseRow } from "./turn-tables.ts";
import {
  callRecordOf,
  flatHooksOf,
  hookKeyOf,
  hooksOfStep,
  lateHooksOf,
  MAX_CALL_ROWS_PER_TURN,
  MAX_HOOK_ROWS_PER_TURN,
  newDraft,
  stepRecordOf,
  stepRowOf,
  trCallRowOf,
  trHookRowOf,
  turnRowOf,
  type TurnDraft,
  type TurnState,
} from "./turn-rows.ts";

// 턴 기록의 쓰는 쪽(정본 `docs/xeon/review/m5/turn-record-metrics.md` §4.1, §4.6). 커밋된 사건을 보고 턴 하나의 상태를 메모리에 모은다.
// 쓰기는 모두 `queue`로 넘겨 마이크로태스크의 묶음에서 실행한다(TX-09): 모델 호출 경로는 SQLite 쓰기를 기다리지 않는다.
// 턴은 `turn.started`에 `open` 행으로 열고, 단계가 끝날 때 그 단계의 행을 쓰고, `turn.completed`에 최종 상태로 닫는다.
// 계측이 꺼진 턴은 턴 행만 쓴다(`log_only`, 규칙 3). 켜진 턴은 단계 행과 훅 행을 쓴다(`full`).

/** 아직 끝나지 않은 턴의 상태를 쥐는 상한. 넘으면 가장 먼저 연 턴부터 버린다(그 턴의 행은 `open`으로 남고 다음 열기 때 `lost`가 된다) */
const MAX_OPEN_TURNS = 64;

type StoreOp = (store: MeasureStore) => void;

export interface TurnWriterDeps {
  readonly store: MeasureStore;
  readonly trace: Pick<TraceReadPort, "turn"> | undefined;
  /** 계측 켬 여부(`x.operations.trace.enabled`의 현재 값). 턴을 처음 볼 때 한 번 읽는다(규칙 6) */
  readonly enabled: () => boolean;
  readonly logger: Logger;
  /** 쓰기를 묶음에 넣는다. 마이크로태스크에서 넣은 순서대로 실행된다 */
  readonly queue: (op: StoreOp) => void;
}

export interface TurnWriter {
  /** 커밋된 사건 한 건. 턴 시작, 단계 끝, 턴 끝만 본다 */
  event(record: DurableEventEnvelope): void;
  /** 모델 호출 한 번(사용량 합산기). 단계의 모델 호출을 모은다 */
  usage(call: UsageRecord): void;
  /** 도구 호출 하나가 닫힌 줄(추적 싱크). 계측이 켜진 턴의 단계에 모은다. 반환값은 호출 경로로 돌아가지 않는다 */
  call(event: ToolCallTraceEvent): void;
  /** 조립 재료·광고(`step_context`)와 스킬 본문 읽기(`skill_read`)의 읽기 전용 사건. 단계가 끝날 때 행으로 바뀐다 */
  context(event: ContextTraceEvent): void;
  /** 대화를 지운다. 이 대화의 열린 턴 상태를 버린다. 대기 중인 쓰기는 호출자가 먼저 비운다 */
  forget(threadId: string): void;
}

/** 범위 표지를 대화의 `tr_thread`에서 읽는다. 표지가 없거나 읽지 못하면 `live`다(§4.6 규칙 31) */
function scopeOf(store: MeasureStore, threadId: string, logger: Logger): ScopeKind {
  const found = store.getThread(threadId);
  if (!found.ok) {
    logger.warn("measure.scope_read_failed", { reason: found.error.kind });
    return "live";
  }
  const kind = found.value?.scopeKind;
  if (kind === undefined) return "live";
  return SCOPE_KINDS.find((candidate) => candidate === kind) ?? "live";
}

export function createTurnWriter(deps: TurnWriterDeps): TurnWriter {
  /** 열려 있는 턴. 끝나면(`turn.completed`) 지운다 */
  const drafts = new Map<string, TurnDraft>();
  /** 설치별 소금(`tr_meta`). 호출 해시를 HMAC할 때 처음 한 번 읽고, 성공한 값만 쥔다 */
  let salt: string | undefined;
  /** 대화별 앞 모델 호출의 사용량(캐시 판정의 앞 호출, §4.5 규칙 30). 단계가 끝날 때 갈아 끼운다 */
  const priorUsage = new Map<
    string,
    CacheUsage & { readonly model: string; readonly endedAt: number }
  >();
  /** 압축 사건이 있었던 대화. 다음 단계 끝에서 한 번 읽고 지운다 */
  const compactedThreads = new Set<string>();

  function installSaltOf(): string | undefined {
    if (salt !== undefined) return salt;
    const read = deps.store.installSalt();
    if (!read.ok) {
      deps.logger.warn("measure.salt_read_failed", { reason: read.error.kind });
      return undefined;
    }
    salt = read.value;
    return salt;
  }

  function levelNow(): RecordLevel {
    return deps.enabled() ? "full" : "log_only";
  }

  function remember(draft: TurnDraft): void {
    drafts.set(draft.turnId, draft);
    if (drafts.size <= MAX_OPEN_TURNS) return;
    const oldest = drafts.keys().next();
    if (oldest.done !== true) drafts.delete(oldest.value);
  }

  /** 턴 행 하나를 쓴다. 범위는 쓰는 때마다 대화의 표지에서 다시 읽는다 */
  function writeTurnRow(
    store: MeasureStore,
    draft: TurnDraft,
    state: TurnState,
    phase: "open" | "closed",
  ): void {
    draft.scope = scopeOf(store, draft.threadId, deps.logger);
    const written = store.upsertTurn(turnRowOf(draft, state));
    if (!written.ok) {
      deps.logger.warn("measure.turn_write_failed", { reason: written.error.kind, phase });
    }
  }

  function turnStarted(record: DurableEventEnvelope, turnId: TurnId): void {
    const parsed = parse(TurnStartedPayloadSchema, record.payload);
    const origin = parsed.ok && parsed.value.origin !== undefined ? parsed.value.origin : "user";
    // 같은 턴을 두 번 열지 않는다(방어)
    if (drafts.has(turnId)) return;
    const draft = newDraft({
      threadId: record.threadId,
      turnId,
      startedAt: record.recordedAt,
      startedEventId: record.id,
      origin,
      level: levelNow(),
    });
    remember(draft);
    deps.queue((store) => {
      writeTurnRow(
        store,
        draft,
        { status: "open", endedAt: null, complete: false, turnHooks: [] },
        "open",
      );
    });
  }

  /** 처음 보는 턴(기록기를 켜기 전에 턴이 시작된 경우)을 단계 끝이나 턴 끝에서 만든다. 열린 행은 쓰지 않는다 */
  function draftOf(record: DurableEventEnvelope, turnId: TurnId): TurnDraft {
    const known = drafts.get(turnId);
    if (known !== undefined) return known;
    const draft = newDraft({
      threadId: record.threadId,
      turnId,
      startedAt: record.recordedAt,
      startedEventId: null,
      origin: "user",
      level: levelNow(),
    });
    remember(draft);
    return draft;
  }

  function stepCompleted(record: DurableEventEnvelope, turnId: TurnId): void {
    const parsed = parse(StepCompletedPayloadSchema, record.payload);
    // 압축은 이 단계 앞에 있었는지만 본다. 계측이 꺼진 턴도 다음 단계를 위해 비운다
    const compacted = compactedThreads.delete(record.threadId);
    if (!parsed.ok) return;
    const draft = draftOf(record, turnId);
    // 계측이 꺼진 턴은 단계 행을 쓰지 않는다(규칙 3: 턴 행만)
    if (draft.level !== "full") return;
    const { stepIndex, composition, contextWarnings } = parsed.value;
    const stepId = record.stepId ?? `step:${String(stepIndex)}`;
    // 단계 끝의 훅(`boundary.step.after`, `boundary.settle.before`)은 이 커밋 전에 실행되어 이미 버퍼에 있다
    const entries = deps.trace?.turn(record.threadId, turnId)?.entries ?? [];
    const flats = flatHooksOf(entries);
    // 이 단계의 실행은 모두 본 것으로 친다(쓰거나 상한으로 버린 것). 아직 끝나지 않은 실행은 턴을 닫을 때 늦은 행이 된다
    for (const flat of flats) {
      if (flat.entry.step === stepIndex) draft.seenHooks.add(hookKeyOf(flat));
    }
    const hooks = hooksOfStep(
      flats,
      stepIndex,
      MAX_HOOK_ROWS_PER_TURN - draft.hookRows,
      draft.approvals,
    );
    draft.hookRows += hooks.rows.length;
    draft.elidedHooks += hooks.elided;
    const hookRuns = hooks.rows.map((row) => row.run);
    // 도구 호출 줄은 단계의 CallRecord와 tr_call 행이 된다. 각 호출에는 그 호출 id로 묶인 훅 행을 붙인다(§4.3)
    const toolEvents = draft.toolCalls.get(stepId) ?? [];
    draft.toolCalls.delete(stepId);
    const sealed = toolEvents.length === 0 ? undefined : installSaltOf();
    const pairs =
      sealed === undefined
        ? []
        : toolEvents.map((event) => ({
            event,
            record: callRecordOf(event, {
              salt: sealed,
              turnStartedAt: draft.startedAt,
              hooks: hookRuns.filter((run) => run.toolCallId === event.toolCallId),
            }),
          }));
    const base = { threadId: draft.threadId, turnId: draft.turnId, stepIndex };
    const usage = draft.calls.get(stepId) ?? [];

    // 조립 재료·광고와 스킬 읽기(측정 싱크가 준 것). 싱크가 없었던 단계는 자리 값이다
    const context = draft.contexts.get(stepId);
    draft.contexts.delete(stepId);
    const reads = draft.skillReads.get(stepId) ?? [];
    draft.skillReads.delete(stepId);
    const calledNames = toolEvents.flatMap((event) =>
      event.caller === "plugin" ? [] : [event.tool],
    );
    const noted = noteToolRows({
      tools: draft.tools,
      advertised: context?.advertised,
      calledNames,
    });
    draft.elidedTools += noted.elided;
    const materialPlan = materialPlanOf({
      materials: context?.materials ?? [],
      budget: MAX_MATERIAL_ROWS_PER_TURN - draft.materialCount,
      seen: draft.materialKeys,
    });
    for (const material of materialPlan.fresh) draft.materialKeys.add(materialKeyOf(material));
    draft.materialCount += materialPlan.kept.length;
    draft.elidedMaterials += materialPlan.elided;
    const advertised =
      context === undefined ? undefined : advertisedRecordOf(context.advertised, noted.stepTools);
    const freshSkills: TrSkillRow[] = [];
    for (const read of reads) {
      const call = toolEvents.find((event) => event.toolCallId === read.toolCallId);
      // 실행되지 않은 호출은 읽은 것이 아니다
      if (call === undefined || call.verdict !== "allowed") continue;
      const name = nameOf(read.name);
      if (draft.skills.has(name)) continue;
      if (draft.skills.size >= MAX_SKILL_ROWS_PER_TURN) {
        draft.elidedSkills += 1;
        continue;
      }
      const skill = {
        name,
        plugin: nameOf(call.plugin ?? "none"),
        stepIndex,
        tokens: call.result?.tokens ?? 0,
      };
      draft.skills.set(name, skill);
      freshSkills.push({
        threadId: draft.threadId,
        turnId: draft.turnId,
        skill: skill.name,
        plugin: skill.plugin,
        listed: false,
        read: true,
        via: "model",
        stepIndex,
        tokens: skill.tokens,
      });
    }

    // 캐시 원인(§4.5 규칙 30). 앞 모델 호출과 이 단계의 사용량, 구조 경고, 압축 사건으로 정한다
    const first = usage[0];
    const current =
      first === undefined
        ? undefined
        : {
            model: first.modelId,
            startedAt: first.startedAt ?? first.recordedAt,
            cacheRead: usage.reduce((sum, call) => sum + call.usage.cacheRead, 0),
            cacheWrite: usage.reduce((sum, call) => sum + call.usage.cacheWrite, 0),
          };
    const cache = cacheBreakOf({
      warnings: contextWarnings ?? [],
      current,
      prior: priorUsage.get(draft.threadId),
      compacted,
      pluginOfTool: (name) => draft.tools.get(nameOf(name))?.plugin,
    });
    if (current !== undefined) {
      priorUsage.set(draft.threadId, {
        model: current.model,
        endedAt: Math.max(...usage.map((call) => call.recordedAt)),
        cacheRead: current.cacheRead,
        cacheWrite: current.cacheWrite,
      });
    }

    const step = stepRecordOf({
      stepIndex,
      stepId,
      turnStartedAt: draft.startedAt,
      calls: draft.calls.get(stepId) ?? [],
      toolCalls: pairs.map((pair) => pair.record),
      composition: composition ?? null,
      hooks: hookRuns,
      materials: materialPlan.kept,
      ...(advertised === undefined ? {} : { advertised }),
      cache,
    });
    draft.steps.push(step);
    const toolRows: TrToolUseRow[] = [];
    for (const name of noted.touched) {
      const row = draft.tools.get(name);
      if (row !== undefined) toolRows.push(trToolUseRowOf(row, draft));
    }
    const batch: TrStepBatch = {
      step: stepRowOf({
        threadId: draft.threadId,
        turnId: draft.turnId,
        stepIndex,
        calls: step.modelCalls,
        ...(advertised === undefined
          ? {}
          : {
              context: {
                advertised,
                materialsFp:
                  step.materials.length === 0 ? null : materialsFingerprintOf(step.materials),
              },
            }),
      }),
      calls: pairs.map((pair) => trCallRowOf(pair.event, pair.record, base)),
      hooks: hooks.rows.map((row) => trHookRowOf(row, base)),
      materials: materialPlan.fresh.map((material) => trMaterialRowOf(material, base)),
      tooluse: toolRows,
      skills: freshSkills,
      plugincalls: [],
      cache: cache === null ? [] : trCacheRowsOf(cache, base),
    };
    deps.queue((store) => {
      const written = store.writeStep(batch);
      if (written.ok) return;
      draft.writeFailures += 1;
      deps.logger.warn("measure.step_write_failed", {
        reason: written.error.kind,
        stepIndex,
      });
    });
  }

  function turnCompleted(record: DurableEventEnvelope, turnId: TurnId): void {
    const parsed = parse(TurnCompletedPayloadSchema, record.payload);
    const status: TurnStatus = parsed.ok ? parsed.value.status : "failed";
    const draft = draftOf(record, turnId);
    drafts.delete(turnId);
    const full = draft.level === "full";
    const flats = flatHooksOf(deps.trace?.turn(record.threadId, turnId)?.entries ?? []);
    // 단계 밖 훅(턴 경계: step 0)은 `record_json`의 `turnHooks`에만 든다. 행으로는 쓰지 않는다(§3.2)
    const turnRows = full
      ? hooksOfStep(flats, 0, MAX_HOOK_ROWS_PER_TURN - draft.hookRows, draft.approvals)
      : { rows: [], elided: 0 };
    const turnHooks = turnRows.rows.map((row) => row.run);
    // 아직 행으로 쓰지 않은 훅 실행은 늦은 행이다(§7 분리 실행). 실행이 시작된 단계에 한 번만 쓰고, 상한은 턴 훅 다음이다
    const late = full
      ? lateHooksOf(flats, {
          seen: draft.seenHooks,
          approvals: draft.approvals,
          room: MAX_HOOK_ROWS_PER_TURN - draft.hookRows - turnRows.rows.length,
        })
      : { rows: [], elided: 0 };
    draft.hookRows += turnRows.rows.length + late.rows.length;
    draft.elidedHooks += turnRows.elided + late.elided;
    // 늦은 행은 그 단계의 기록에도 더한다(`record_json`의 steps.hooks). 단계 기록이 없으면 행으로만 남는다
    for (let at = 0; at < draft.steps.length; at += 1) {
      const step = draft.steps[at];
      if (step === undefined) continue;
      const extra = late.rows
        .filter((row) => row.stepIndex === step.stepIndex)
        .map((row) => row.run);
      if (extra.length > 0) draft.steps[at] = { ...step, hooks: [...step.hooks, ...extra] };
    }
    const lateBatch = late.rows.map((row) =>
      trHookRowOf(
        { run: row.run, seqGlobal: row.seqGlobal },
        { threadId: draft.threadId, turnId: draft.turnId, stepIndex: row.stepIndex },
      ),
    );
    const endedAt = record.recordedAt;
    deps.queue((store) => {
      // 늦은 행을 먼저 쓴다. 쓰기가 실패하면 턴은 불완전하다
      if (lateBatch.length > 0) {
        const written = store.writeHooks(lateBatch);
        if (!written.ok) {
          draft.writeFailures += 1;
          deps.logger.warn("measure.hook_write_failed", {
            reason: written.error.kind,
            turnId,
          });
        }
      }
      // 단계 쓰기가 하나라도 실패했으면 턴은 불완전하다. 계측이 꺼진 턴도 단계 기록이 없으므로 불완전하다
      const complete = full && draft.writeFailures === 0;
      writeTurnRow(store, draft, { status, endedAt, complete, turnHooks }, "closed");
    });
  }

  return {
    event(record) {
      if (record.kind === "thread.compacted") compactedThreads.add(record.threadId);
      const turnId = record.turnId;
      if (turnId === null) return;
      if (record.kind === "turn.started") turnStarted(record, turnId);
      else if (record.kind === "step.completed") stepCompleted(record, turnId);
      else if (record.kind === "turn.completed") turnCompleted(record, turnId);
    },
    usage(call) {
      if (call.turnId === null || call.stepId === null) return;
      const draft = drafts.get(call.turnId);
      if (draft === undefined || draft.level !== "full") return;
      const calls = draft.calls.get(call.stepId) ?? [];
      calls.push(call);
      draft.calls.set(call.stepId, calls);
    },
    call(event) {
      if (event.turnId === null || event.stepId === null) return;
      const draft = drafts.get(event.turnId);
      if (draft === undefined || draft.level !== "full" || draft.threadId !== event.threadId) {
        return;
      }
      if (draft.callRows >= MAX_CALL_ROWS_PER_TURN) {
        draft.elidedCalls += 1;
        return;
      }
      draft.callRows += 1;
      // 승인 해결은 훅 행의 물음 답을 채울 때 쓴다(턴을 닫을 때 늦은 행에도 맞도록 턴 단위로 쥔다)
      if (event.approval !== null) draft.approvals.set(event.toolCallId, event.approval);
      const bucket = draft.toolCalls.get(event.stepId) ?? [];
      bucket.push(event);
      draft.toolCalls.set(event.stepId, bucket);
    },
    context(event) {
      const draft = drafts.get(event.turnId);
      if (draft === undefined || draft.level !== "full" || draft.threadId !== event.threadId) {
        return;
      }
      if (event.kind === "step_context") {
        draft.contexts.set(event.stepId, event);
        return;
      }
      const reads = draft.skillReads.get(event.stepId) ?? [];
      reads.push({ toolCallId: event.toolCallId, name: event.name });
      draft.skillReads.set(event.stepId, reads);
    },
    forget(threadId) {
      for (const [turnId, draft] of drafts) {
        if (draft.threadId === threadId) drafts.delete(turnId);
      }
      priorUsage.delete(threadId);
      compactedThreads.delete(threadId);
    },
  };
}
