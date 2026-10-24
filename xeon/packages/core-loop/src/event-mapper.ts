import { assertNever, Bug } from "@xeon/contracts";
import {
  assignPartIds,
  type AgentEvent,
  type AgentEventMapInit,
  type AgentEventMapper,
  type AgentMessage,
  type AssistantMessage,
  type ItemKind,
  type ItemId,
  type ItemStatus,
  type LifecycleEvent,
  type PartKind,
  type PartRecord,
  type StepId,
  type StopReason,
  type Usage,
} from "@xeon/contracts/conversation";

// L1.loop.spec §3.4, F.conversation.spec §3.5.4~§3.5.5. pi AgentEvent를 Xeon 알림 열로 바꾸는 순수 매퍼다.
// 시계와 난수를 쓰지 않고 id는 init.ids로만 만든다.

/** 래퍼 전용 확장. 이미 기록된 item의 id를 매퍼에 알린다. 공개하지 않는다 */
export interface BoundAgentEventMapper extends AgentEventMapper {
  /** 배치된 입력 메시지(steer 등)나 L1.tools가 기록한 toolResult의 item id */
  bindItem(
    ref: { readonly message: object } | { readonly toolCallId: string },
    itemId: ItemId,
  ): void;
  /** `message_end`로 끝난 어시스턴트 item의 파트 레코드. content 순서(partIds[i] ↔ content[i]) */
  partsOf(itemId: ItemId): readonly PartRecord[];
  /** 재개로 도구 단계 중간부터 시작할 때, 기록된 단계와 어시스턴트 item을 매퍼 상태로 되돌린다 */
  restoreStep(step: {
    readonly stepId: StepId;
    readonly stepIndex: number;
    readonly assistantItemId: ItemId;
  }): void;
  /** 이 매퍼가 본 turn 합계. turn.completed 기본값 계산에 쓴다 */
  totals(): {
    readonly stepCount: number;
    readonly usage: Usage | null;
    readonly lastStopReason: StopReason | null;
    readonly lastErrorMessage: string | null;
    readonly lastAssistantItemId: ItemId | null;
  };
}

export interface MapperOptions {
  /** 재개로 같은 단계의 요청만 다시 보낼 때, 다음 `turn_start`가 새 id를 만들지 않고 이 단계 id를 쓴다 */
  readonly adoptStepId?: StepId;
  /** 재개 전에 이미 끝난 단계 수와 사용량. totals에 더해진다 */
  readonly priorStepCount?: number;
  readonly priorUsage?: Usage | null;
  readonly priorLastStopReason?: StopReason | null;
  readonly priorLastErrorMessage?: string | null;
  readonly priorLastAssistantItemId?: ItemId | null;
}

type Notification<T extends LifecycleEvent["type"]> = Extract<LifecycleEvent, { readonly type: T }>;

function kindOfRole(message: AgentMessage): ItemKind {
  switch (message.role) {
    case "user":
      return "user";
    case "assistant":
      return "assistant";
    case "system":
      return "system";
    case "toolResult":
      return "toolResult";
    case "custom":
      return "custom";
    default:
      return assertNever(message, "AgentMessage.role");
  }
}

function itemStatusOf(stopReason: StopReason): ItemStatus {
  switch (stopReason) {
    case "aborted":
      return "interrupted";
    case "error":
      return "failed";
    case "pending":
    case "stop":
    case "length":
    case "toolUse":
    case "deferred":
      return "completed";
    default:
      return assertNever(stopReason, "StopReason");
  }
}

function stepStatusOf(stopReason: StopReason): "completed" | "interrupted" | "failed" {
  const status = itemStatusOf(stopReason);
  if (status === "interrupted") return "interrupted";
  if (status === "failed") return "failed";
  return "completed";
}

function addUsage(a: Usage | null, b: Usage): Usage {
  if (a === null) return structuredClone(b);
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    ...(a.cacheWrite1h === undefined && b.cacheWrite1h === undefined
      ? {}
      : { cacheWrite1h: (a.cacheWrite1h ?? 0) + (b.cacheWrite1h ?? 0) }),
    ...(a.reasoning === undefined && b.reasoning === undefined
      ? {}
      : { reasoning: (a.reasoning ?? 0) + (b.reasoning ?? 0) }),
    totalTokens: a.totalTokens + b.totalTokens,
    cost: {
      input: a.cost.input + b.cost.input,
      output: a.cost.output + b.cost.output,
      cacheRead: a.cost.cacheRead + b.cost.cacheRead,
      cacheWrite: a.cost.cacheWrite + b.cost.cacheWrite,
      total: a.cost.total + b.cost.total,
    },
  };
}

function partKindOfBlock(type: "text" | "thinking" | "toolCall"): PartKind {
  return type;
}

/**
 * `AgentEventMapper` 구현. 같은 `init`(같은 `ids`)과 같은 이벤트 열이면 같은 알림 열을 낸다.
 * `CreateAgentEventMapper`(F)에 대입할 수 있다. 둘째 인자는 래퍼 전용이다.
 */
export function createAgentEventMapper(
  init: AgentEventMapInit,
  options: MapperOptions = {},
): BoundAgentEventMapper {
  const { threadId, turnId, ids } = init;
  let nextStepIndex = init.startStepIndex;
  let stepIndex = init.startStepIndex;
  let stepId: StepId | null = null;
  let adoptStepId: StepId | undefined = options.adoptStepId;
  let stepAssistantItemId: ItemId | null = null;
  let stepToolResultItems: ItemId[] = [];
  let stepCount = options.priorStepCount ?? 0;
  let usage: Usage | null = options.priorUsage ?? null;
  let lastStopReason: StopReason | null = options.priorLastStopReason ?? null;
  let lastErrorMessage: string | null = options.priorLastErrorMessage ?? null;
  let lastAssistantItemId: ItemId | null = options.priorLastAssistantItemId ?? null;

  const messageItems = new WeakMap<object, ItemId>();
  const toolResultItems = new Map<string, ItemId>();
  const toolCallItems = new Map<string, ItemId>();
  const open = new Set<ItemId>();
  const completedParts = new Map<ItemId, readonly PartRecord[]>();

  let assistantItemId: ItemId | null = null;
  // contentIndex → 스트림 중 발급한 PartId와 종류
  let streamParts = new Map<
    number,
    { readonly partId: PartRecord["partId"]; readonly kind: PartKind }
  >();

  function scope(): { threadId: typeof threadId; turnId: typeof turnId; stepId: StepId | null } {
    return { threadId, turnId, stepId };
  }

  function noteToolResultItem(toolCallId: string, itemId: ItemId): void {
    const previous = toolResultItems.get(toolCallId);
    toolResultItems.set(toolCallId, itemId);
    if (stepToolResultItems.includes(itemId)) return;
    const at = previous === undefined ? -1 : stepToolResultItems.indexOf(previous);
    // 매퍼가 먼저 만든 id를 기록된 id로 바꾼다(같은 호출의 item이 둘로 세어지지 않게)
    if (at >= 0) stepToolResultItems[at] = itemId;
    else stepToolResultItems.push(itemId);
  }

  function itemIdFor(message: AgentMessage): ItemId {
    const known = messageItems.get(message);
    if (known !== undefined) return known;
    if (message.role === "toolResult") {
      const bound = toolResultItems.get(message.toolCallId);
      if (bound !== undefined) {
        messageItems.set(message, bound);
        return bound;
      }
    }
    const fresh = ids.next("itm");
    messageItems.set(message, fresh);
    if (message.role === "toolResult") noteToolResultItem(message.toolCallId, fresh);
    return fresh;
  }

  function mapAssistantUpdate(
    event: Extract<AgentEvent, { type: "message_update" }>,
  ): LifecycleEvent[] {
    const itemId = assistantItemId;
    if (itemId === null) return [];
    const inner = event.assistantMessageEvent;
    switch (inner.type) {
      case "start":
      case "done":
      case "error":
        return [];
      case "text_start":
      case "thinking_start":
      case "toolcall_start": {
        const kind: PartKind =
          inner.type === "text_start"
            ? "text"
            : inner.type === "thinking_start"
              ? "thinking"
              : "toolCall";
        const partId = ids.next("prt");
        streamParts.set(inner.contentIndex, { partId, kind });
        return [
          {
            type: "item.updated",
            ...scope(),
            itemId,
            update: {
              kind: "part_delta",
              delta: {
                partId,
                itemId,
                contentIndex: inner.contentIndex,
                kind,
                phase: "start",
                delta: "",
              },
            },
          },
        ];
      }
      case "text_delta":
      case "thinking_delta":
      case "toolcall_delta": {
        const part = streamParts.get(inner.contentIndex);
        if (part === undefined) return [];
        return [
          {
            type: "item.updated",
            ...scope(),
            itemId,
            update: {
              kind: "part_delta",
              delta: {
                partId: part.partId,
                itemId,
                contentIndex: inner.contentIndex,
                kind: part.kind,
                phase: "delta",
                delta: inner.delta,
              },
            },
          },
        ];
      }
      case "text_end":
      case "thinking_end":
      case "toolcall_end": {
        const part = streamParts.get(inner.contentIndex);
        if (part === undefined) return [];
        const toolCallId = inner.type === "toolcall_end" ? inner.toolCall.id : null;
        return [
          {
            type: "item.updated",
            ...scope(),
            itemId,
            update: {
              kind: "part_completed",
              part: {
                partId: part.partId,
                itemId,
                contentIndex: inner.contentIndex,
                kind: part.kind,
                toolCallId: part.kind === "toolCall" ? toolCallId : null,
              },
            },
          },
        ];
      }
      default:
        return assertNever(inner, "AssistantMessageEvent");
    }
  }

  function finishAssistant(message: AssistantMessage, itemId: ItemId): LifecycleEvent[] {
    const kinds: PartKind[] = [];
    const toolCallIds: (string | null)[] = [];
    for (const block of message.content) {
      kinds.push(partKindOfBlock(block.type));
      toolCallIds.push(block.type === "toolCall" ? block.id : null);
    }
    const existing: PartRecord[] = [];
    for (const [contentIndex, part] of streamParts) {
      const block = message.content[contentIndex];
      if (block === undefined || partKindOfBlock(block.type) !== part.kind) continue;
      existing.push({
        partId: part.partId,
        itemId,
        contentIndex,
        kind: part.kind,
        toolCallId: block.type === "toolCall" ? block.id : null,
      });
    }
    const assignments = assignPartIds({ itemId, kinds, toolCallIds, existing }, ids);
    const records = assignments.map((assignment) => assignment.record);
    completedParts.set(itemId, records);
    open.delete(itemId);
    stepAssistantItemId = itemId;
    lastAssistantItemId = itemId;
    lastStopReason = message.stopReason;
    lastErrorMessage = message.errorMessage ?? null;
    usage = addUsage(usage, message.usage);
    assistantItemId = null;
    streamParts = new Map();
    return [
      {
        type: "item.completed",
        ...scope(),
        item: {
          itemId,
          status: itemStatusOf(message.stopReason),
          kind: "assistant",
          message,
          partIds: records.map((record) => record.partId),
        },
      },
    ];
  }

  function finishOther(message: AgentMessage, itemId: ItemId): LifecycleEvent[] {
    open.delete(itemId);
    switch (message.role) {
      case "user":
        return [
          {
            type: "item.completed",
            ...scope(),
            item: { itemId, status: "completed", kind: "user", message, requestId: null },
          },
        ];
      case "system":
        return [
          {
            type: "item.completed",
            ...scope(),
            item: { itemId, status: "completed", kind: "system", message },
          },
        ];
      case "toolResult":
        return [
          {
            type: "item.completed",
            ...scope(),
            item: { itemId, status: "completed", kind: "toolResult", message, effectId: null },
          },
        ];
      case "custom":
        return [
          {
            type: "item.completed",
            ...scope(),
            item: { itemId, status: "completed", kind: "custom", message },
          },
        ];
      case "assistant":
        throw new Bug("event-mapper: finishOther received an assistant message");
      default:
        return assertNever(message, "AgentMessage.role");
    }
  }

  function toolItemFor(toolCallId: string): ItemId {
    const known = toolCallItems.get(toolCallId);
    if (known !== undefined) return known;
    const fresh = ids.next("itm");
    toolCallItems.set(toolCallId, fresh);
    return fresh;
  }

  function map(event: AgentEvent): readonly LifecycleEvent[] {
    switch (event.type) {
      case "agent_start":
        return [{ type: "turn.updated", ...scope(), status: "running" }];
      case "turn_start": {
        const id = adoptStepId ?? ids.next("stp");
        adoptStepId = undefined;
        stepId = id;
        stepIndex = nextStepIndex;
        nextStepIndex += 1;
        stepAssistantItemId = null;
        stepToolResultItems = [];
        return [{ type: "step.started", ...scope(), stepIndex }];
      }
      case "message_start": {
        const message = event.message;
        if (message.role === "assistant") {
          const itemId = ids.next("itm");
          assistantItemId = itemId;
          streamParts = new Map();
          open.add(itemId);
          return [
            {
              type: "item.started",
              ...scope(),
              itemId,
              kind: "assistant",
              toolCallId: null,
              toolName: null,
            },
            { type: "step.updated", ...scope(), status: "requesting" },
          ];
        }
        const itemId = itemIdFor(message);
        open.add(itemId);
        return [
          {
            type: "item.started",
            ...scope(),
            itemId,
            kind: kindOfRole(message),
            toolCallId: null,
            toolName: null,
          },
        ];
      }
      case "message_update":
        return mapAssistantUpdate(event);
      case "message_end": {
        const message = event.message;
        if (message.role === "assistant") {
          const itemId = assistantItemId ?? ids.next("itm");
          return finishAssistant(message, itemId);
        }
        return finishOther(message, itemIdFor(message));
      }
      case "tool_execution_start": {
        const itemId = toolItemFor(event.toolCallId);
        open.add(itemId);
        const started: Notification<"item.started"> = {
          type: "item.started",
          ...scope(),
          itemId,
          kind: "toolCall",
          toolCallId: event.toolCallId,
          toolName: event.toolName,
        };
        return [started, { type: "step.updated", ...scope(), status: "tools" }];
      }
      case "tool_execution_update": {
        const itemId = toolItemFor(event.toolCallId);
        const partial: unknown = event.partialResult;
        if (!isAgentToolResultLike(partial)) return [];
        return [
          {
            type: "item.updated",
            ...scope(),
            itemId,
            update: { kind: "tool_progress", partialResult: partial },
          },
        ];
      }
      case "tool_execution_end": {
        const itemId = toolItemFor(event.toolCallId);
        open.delete(itemId);
        return [
          {
            type: "item.completed",
            ...scope(),
            item: {
              itemId,
              kind: "toolCall",
              toolCallId: event.toolCallId,
              toolName: event.toolName,
              effectId: null,
              status: event.isError ? "failed" : "completed",
            },
          },
        ];
      }
      case "turn_end": {
        const stopReason: StopReason = event.message.stopReason;
        for (const result of event.toolResults) {
          const known = toolResultItems.get(result.toolCallId);
          if (known !== undefined && !stepToolResultItems.includes(known)) {
            stepToolResultItems.push(known);
          }
        }
        stepCount += 1;
        return [
          {
            type: "step.completed",
            ...scope(),
            stepIndex,
            status: stepStatusOf(stopReason),
            stopReason,
            assistantItemId: stepAssistantItemId,
            toolResultItemIds: [...stepToolResultItems],
          },
        ];
      }
      case "agent_end": {
        const status =
          lastStopReason === "aborted"
            ? "interrupted"
            : lastStopReason === "error"
              ? "failed"
              : "completed";
        return [
          {
            type: "turn.completed",
            ...scope(),
            status,
            stepCount,
            usage,
            error: status === "completed" ? null : lastErrorMessage,
          },
        ];
      }
      default:
        return assertNever(event, "AgentEvent");
    }
  }

  return {
    map,
    snapshot: () => ({ stepId, stepIndex, openItemIds: [...open] }),
    bindItem(ref, itemId) {
      if ("message" in ref) {
        messageItems.set(ref.message, itemId);
      } else {
        noteToolResultItem(ref.toolCallId, itemId);
      }
    },
    restoreStep(step) {
      stepId = step.stepId;
      stepIndex = step.stepIndex;
      nextStepIndex = step.stepIndex + 1;
      stepAssistantItemId = step.assistantItemId;
      lastAssistantItemId = step.assistantItemId;
      stepToolResultItems = [];
    },
    partsOf: (itemId) => completedParts.get(itemId) ?? [],
    totals: () => ({
      stepCount,
      usage,
      lastStopReason,
      lastErrorMessage,
      lastAssistantItemId,
    }),
  };
}

/** tool_progress 휘발 알림이 싣는 부분 결과의 얕은 검사. 모양이 다르면 알림을 내지 않는다 */
function isAgentToolResultLike(
  value: unknown,
): value is Extract<
  Extract<LifecycleEvent, { readonly type: "item.updated" }>["update"],
  { readonly kind: "tool_progress" }
>["partialResult"] {
  return (
    typeof value === "object" &&
    value !== null &&
    "content" in value &&
    Array.isArray(value.content)
  );
}
