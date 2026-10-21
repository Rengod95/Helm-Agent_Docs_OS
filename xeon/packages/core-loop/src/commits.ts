import type { Clock } from "@xeon/contracts";
import type {
  AgentMessage,
  EventId,
  IdFactory,
  ImageContent,
  ItemId,
  ItemRecord,
  PartRecord,
  StepCompletedPayload,
  StepId,
  TextContent,
  ThreadId,
  ToolResultMessage,
  TurnCompletedPayload,
  TurnId,
  XeonCustomMessage,
} from "@xeon/contracts/conversation";
import type { CustomMessageDraft, PostContent, PostItem } from "@xeon/contracts/extensions";
import type {
  CommitPlan,
  CommitRequest,
  DurableEventDraft,
  PendingToolCall,
  StampedDraft,
  StepCheckpoint,
  StepCheckpointInput,
  TxView,
} from "@xeon/contracts/records";
import type {
  AbortReason,
  PlacementSelection,
  QueuedInput,
  TaskService,
} from "@xeon/contracts/services";
import type { Drafter, DraftScope } from "./drafts.ts";

// L1.loop.spec §3.5 커밋 지점 T1~T4·T6, 취소 의도. 커밋 키는 eng.transactions.design §4.8,
// 지문 원천은 신원만 담는다(생성 id·시각·시도 번호를 넣지 않는다, §4.7).

export const commitKeys: {
  readonly turnStart: (turnId: TurnId) => string;
  readonly turnPrestart: (turnId: TurnId) => string;
  readonly stepStart: (turnId: TurnId, stepIndex: number) => string;
  readonly response: (turnId: TurnId, stepIndex: number) => string;
  readonly stepEnd: (turnId: TurnId, stepIndex: number) => string;
  readonly turnEnd: (turnId: TurnId) => string;
  readonly abort: (turnId: TurnId) => string;
  readonly toolResult: (toolCallId: string) => string;
  readonly strayItem: (turnId: TurnId, stepIndex: number, n: number) => string;
} = {
  turnStart: (turnId) => `turn:${turnId}:start`,
  turnPrestart: (turnId) => `turn:${turnId}:prestart`,
  stepStart: (turnId, stepIndex) => `step:${turnId}:${stepIndex}:start`,
  response: (turnId, stepIndex) => `resp:${turnId}:${stepIndex}`,
  stepEnd: (turnId, stepIndex) => `step:${turnId}:${stepIndex}:end`,
  turnEnd: (turnId) => `turn:${turnId}:end`,
  abort: (turnId) => `abort:${turnId}`,
  toolResult: (toolCallId) => `tool:${toolCallId}:result`,
  strayItem: (turnId, stepIndex, n) => `item:${turnId}:${stepIndex}:${n}`,
};

function append(
  drafts: readonly StampedDraft[],
  checkpoint: StepCheckpointInput | null,
): CommitPlan {
  return { kind: "append", drafts, checkpoint };
}

// ── item 레코드 도우미 ───────────────────────────────────────────────────

function contentOf(content: PostContent): string | (TextContent | ImageContent)[] {
  return typeof content === "string" ? content : [...content];
}

/** 입력 항목 하나를 item 레코드와 모델에 넣을 메시지로 바꾼다 */
export interface PlacedMessage {
  readonly record: Extract<ItemRecord, { readonly kind: "user" | "custom" }>;
  readonly message: AgentMessage;
}

export function placedMessageOf(
  itemId: ItemId,
  item: PostItem,
  requestId: string | null,
  timestamp: number,
): PlacedMessage {
  if (item.kind === "user") {
    const message: AgentMessage = {
      role: "user",
      content: contentOf(item.content),
      timestamp,
    };
    return {
      message,
      record: { itemId, status: "completed", kind: "user", message, requestId },
    };
  }
  const message: XeonCustomMessage = {
    role: "custom",
    customType: item.customType,
    content: contentOf(item.content),
    display: item.display,
    details: item.details ?? null,
    timestamp,
  };
  return { message, record: { itemId, status: "completed", kind: "custom", message } };
}

export function customItemOf(
  itemId: ItemId,
  draft: CustomMessageDraft,
  timestamp: number,
): Extract<ItemRecord, { readonly kind: "custom" }> {
  return {
    itemId,
    status: "completed",
    kind: "custom",
    message: {
      role: "custom",
      customType: draft.customType,
      content: contentOf(draft.content),
      display: draft.display,
      details: draft.details ?? null,
      timestamp,
    },
  };
}

// ── T2 단계 시작 ─────────────────────────────────────────────────────────

export interface StepRef extends DraftScope {
  readonly turnId: TurnId;
  readonly stepId: StepId;
  readonly stepIndex: number;
}

export function stepStartRequest(drafter: Drafter, step: StepRef): CommitRequest {
  return {
    threadId: step.threadId,
    requestId: commitKeys.stepStart(step.turnId, step.stepIndex),
    fingerprintSource: {
      kind: "step.started",
      threadId: step.threadId,
      turnId: step.turnId,
      stepIndex: step.stepIndex,
    },
    build: () => append([drafter.make("step.started", { stepIndex: step.stepIndex }, step)], null),
  };
}

// ── T3 응답 확정 ─────────────────────────────────────────────────────────

/** 단계 안에서 pi가 만든 system·custom item, 조립이 낸 system item. 어시스턴트 item과 같은 커밋에 기록한다 */
export type PreludeItem = Extract<ItemRecord, { readonly kind: "system" | "custom" }>;

export interface ResponseCommit {
  readonly step: StepRef;
  readonly prelude: readonly PreludeItem[];
  readonly assistant: Extract<ItemRecord, { readonly kind: "assistant" }>;
  readonly parts: readonly PartRecord[];
}

export function responseRequest(drafter: Drafter, response: ResponseCommit): CommitRequest {
  const { step } = response;
  return {
    threadId: step.threadId,
    requestId: commitKeys.response(step.turnId, step.stepIndex),
    fingerprintSource: {
      kind: "response",
      threadId: step.threadId,
      turnId: step.turnId,
      stepIndex: step.stepIndex,
    },
    build: () => {
      const drafts: StampedDraft[] = [];
      for (const item of response.prelude) {
        drafts.push(drafter.make("item.recorded", { item }, step));
      }
      for (const part of response.parts) {
        drafts.push(drafter.make("part.recorded", { part }, step));
      }
      drafts.push(drafter.make("item.recorded", { item: response.assistant }, step));
      return append(drafts, null);
    },
  };
}

/** 기록되지 않은 system·custom·user 메시지 하나를 따로 기록한다(드문 경로) */
export function strayItemRequest(
  drafter: Drafter,
  step: StepRef,
  n: number,
  item: ItemRecord,
): CommitRequest {
  return {
    threadId: step.threadId,
    requestId: commitKeys.strayItem(step.turnId, step.stepIndex, n),
    fingerprintSource: {
      kind: "stray_item",
      threadId: step.threadId,
      turnId: step.turnId,
      stepIndex: step.stepIndex,
      n,
    },
    build: () => append([drafter.make("item.recorded", { item }, step)], null),
  };
}

/** 효과 이벤트 없이 끝난 도구 호출(차단·미발견·검증 실패)의 결과 item을 기록한다(L1.tools.spec §4.2) */
export function toolResultItemRequest(
  drafter: Drafter,
  step: StepRef,
  itemId: ItemId,
  message: ToolResultMessage,
): CommitRequest {
  return {
    threadId: step.threadId,
    requestId: commitKeys.toolResult(message.toolCallId),
    fingerprintSource: {
      kind: "tool_result_item",
      threadId: step.threadId,
      toolCallId: message.toolCallId,
    },
    build: () =>
      append(
        [
          drafter.make(
            "item.recorded",
            { item: { itemId, status: "completed", kind: "toolResult", message, effectId: null } },
            step,
          ),
        ],
        null,
      ),
  };
}

// ── T4 단계 끝 ───────────────────────────────────────────────────────────

export interface PlacedInput {
  readonly input: QueuedInput;
  readonly itemId: ItemId;
  readonly message: AgentMessage;
}

export interface StepEndParams {
  readonly step: StepRef;
  readonly clock: Clock;
  readonly ids: IdFactory;
  readonly tasks: Pick<TaskService, "inputs">;
  readonly stepCompleted: StepCompletedPayload;
  /** 검증을 통과한 boundary 엔트리(turn_end → agent_before_settle 순서) */
  readonly entries: readonly DurableEventDraft[];
  /** X 경계 기여(scope.changed, lease.*) */
  readonly contributions: readonly DurableEventDraft[];
  /** 거짓이면 배치를 고르지 않는다(결정 end) */
  readonly drain: boolean;
  /** `drain`의 `continuing` 인자: 도구 호출이 이어지거나 게이트 계속이 있다 */
  readonly continuing: boolean;
  /** 배치하지 않을 때 다음 요청이 나갈 뒤의 값: 결정 end가 turn을 열어 두는지(stop) 닫는지 */
  readonly endNext: "request" | "turn_end" | "await_input";
  readonly endNow: boolean;
  /** 이 커밋 전까지 소비한 입력 seq */
  readonly priorConsumedSeq: number;
  readonly model: StepCheckpoint["model"];
  readonly pendingToolCalls: readonly PendingToolCall[];
}

export interface StepEndOutcome {
  readonly placed: readonly PlacedInput[];
  readonly consumedSeq: number;
  readonly next: StepCheckpoint["next"];
  readonly leaseRefs: readonly EventId[];
  readonly scopeRef: EventId | null;
}

export function stepEndRequest(
  drafter: Drafter,
  params: StepEndParams,
): { readonly request: CommitRequest; readonly outcome: () => StepEndOutcome | undefined } {
  const { step } = params;
  let captured: StepEndOutcome | undefined;

  const build = (view: TxView): CommitPlan => {
    const drafts: StampedDraft[] = [drafter.make("step.completed", params.stepCompleted, step)];
    // 핸들러는 turnId를 모른다(TurnEndPayload에 없다). null이면 이 turn으로 채운다
    for (const entry of params.entries) {
      drafts.push(drafter.stamp(entry.turnId === null ? { ...entry, turnId: step.turnId } : entry));
    }
    for (const contribution of params.contributions) drafts.push(drafter.stamp(contribution));

    const selection: PlacementSelection | null = params.drain
      ? params.tasks.inputs.drain(view, step.threadId, "stepEnd", {
          continuing: params.continuing,
        })
      : null;
    const placed: PlacedInput[] = [];
    if (selection !== null) {
      for (const input of selection.inputs) {
        const itemId = params.ids.next("itm");
        const { record, message } = placedMessageOf(
          itemId,
          input.item,
          input.requestId,
          params.clock.now(),
        );
        placed.push({ input, itemId, message });
        drafts.push(drafter.make("item.recorded", { item: record }, step));
      }
      if (placed.length > 0) {
        drafts.push(
          ...selection.drafts(
            placed.map((p) => ({
              inputId: p.input.inputId,
              itemId: p.itemId,
              turnId: step.turnId,
            })),
          ),
        );
      }
    }

    const previous = view.lastCheckpoint(step.threadId);
    let leaseRefs: EventId[] = [...(previous?.leaseRefs ?? [])];
    let scopeRef: EventId | null = previous?.scopeRef ?? null;
    for (const contribution of params.contributions) {
      if (contribution.kind === "lease.acquired") {
        leaseRefs.push(contribution.id);
      } else if (contribution.kind === "lease.released") {
        const released = leaseIdOf(contribution);
        leaseRefs = leaseRefs.filter((ref) => ref !== released);
      } else if (contribution.kind === "scope.changed") {
        scopeRef = contribution.id;
      }
    }

    const continuingFinal = params.continuing || placed.length > 0;
    const next: StepCheckpoint["next"] = params.endNow
      ? params.endNext
      : continuingFinal
        ? "request"
        : "turn_end";
    const consumedSeq = Math.max(params.priorConsumedSeq, selection?.consumedSeq ?? 0);
    captured = { placed, consumedSeq, next, leaseRefs, scopeRef };

    return append(drafts, {
      turnId: step.turnId,
      stepId: step.stepId,
      stepIndex: step.stepIndex,
      next,
      pendingToolCalls: [...params.pendingToolCalls],
      inputCursor: { consumedSeq },
      model: params.model,
      leaseRefs,
      scopeRef,
    });
  };

  return {
    request: {
      threadId: step.threadId,
      requestId: commitKeys.stepEnd(step.turnId, step.stepIndex),
      fingerprintSource: {
        kind: "step_end",
        threadId: step.threadId,
        turnId: step.turnId,
        stepIndex: step.stepIndex,
      },
      build,
    },
    outcome: () => captured,
  };
}

function leaseIdOf(draft: DurableEventDraft): string | undefined {
  const payload = draft.payload;
  if (typeof payload !== "object" || payload === null || !("leaseId" in payload)) return undefined;
  return typeof payload.leaseId === "string" ? payload.leaseId : undefined;
}

// ── T6 turn 끝 ───────────────────────────────────────────────────────────

export function turnEndRequest(
  drafter: Drafter,
  scope: DraftScope & { readonly turnId: TurnId },
  payload: TurnCompletedPayload,
  contributions: readonly DurableEventDraft[],
): CommitRequest {
  return {
    threadId: scope.threadId,
    requestId: commitKeys.turnEnd(scope.turnId),
    fingerprintSource: { kind: "turn_end", threadId: scope.threadId, turnId: scope.turnId },
    build: () =>
      append(
        [
          drafter.make("turn.completed", payload, scope),
          ...contributions.map((contribution) => drafter.stamp(contribution)),
        ],
        null,
      ),
  };
}

// ── 취소 의도 ────────────────────────────────────────────────────────────

export function abortIntentRequest(
  drafter: Drafter,
  scope: { readonly threadId: ThreadId; readonly turnId: TurnId },
  reason: AbortReason,
  cause: "direct" | "cascade",
): CommitRequest {
  return {
    threadId: scope.threadId,
    requestId: commitKeys.abort(scope.turnId),
    fingerprintSource: { kind: "abort", threadId: scope.threadId, turnId: scope.turnId },
    build: (view) => {
      const turn = view.turn(scope.turnId);
      if (turn !== undefined && turn.status !== "running" && turn.status !== "waiting") {
        return { kind: "reject", code: "turn_closed", detail: turn.status };
      }
      return append(
        [
          drafter.make(
            "turn.abort_requested",
            { reason: { code: reason.code, message: reason.message }, cause, background: false },
            { threadId: scope.threadId, turnId: scope.turnId, stepId: null },
          ),
        ],
        null,
      );
    },
  };
}
