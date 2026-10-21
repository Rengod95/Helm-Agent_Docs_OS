import { test } from "bun:test";
import type {
  AgentMessage,
  AssistantMessage,
  CheckpointId,
  EffectId,
  EventId,
  IdByPrefix,
  IdPrefix,
  ItemId,
  ItemRecord,
  ItemStatus,
  ItemUpdate,
  LifecycleEvent,
  Message,
  PartDelta,
  PartId,
  PartRecord,
  StepId,
  ThreadId,
  ToolResultRecord,
  TurnId,
  XeonCustomMessage,
} from "../../src/conversation/index.ts";
import type { Assignable, Equal, Expect } from "../types/expect.ts";

// 이 파일의 단언은 tsc -b가 판정한다(컴파일 시점). 아래 테스트는 파일이 bun test와 knip 진입점에 들게 한다.
// pi 원본과의 항등 검사(`pi-types.type-test.ts`의 expectTypeOf)는 pi 패키지가 연결된 뒤 더한다.

/** AgentMessage에 XeonCustomMessage가 들어간다(CustomAgentMessages 병합) */
export type CustomIsAgentMessage = Expect<Assignable<XeonCustomMessage, AgentMessage>>;
/** Message는 custom을 포함하지 않는다 */
export type CustomIsNotMessage = Expect<Equal<Assignable<XeonCustomMessage, Message>, false>>;

/** IdByPrefix의 키가 IdPrefix와 같고 ID들이 서로 대입되지 않는다(브랜드) */
export type PrefixKeys = Expect<Equal<keyof IdByPrefix, IdPrefix>>;
export type BrandsAreDistinct = Expect<
  Equal<
    [
      Assignable<ThreadId, TurnId>,
      Assignable<EventId, EffectId>,
      Assignable<ItemId, PartId>,
      Assignable<StepId, CheckpointId>,
      Assignable<string, ThreadId>,
    ],
    [false, false, false, false, false]
  >
>;
export type BrandIsString = Expect<Assignable<ThreadId, string>>;

/** 스키마에서 파생한 타입이 스펙이 적은 모양과 같다 */
export type PartRecordShape = Expect<
  Equal<
    PartRecord,
    {
      partId: PartId;
      itemId: ItemId;
      contentIndex: number;
      kind: "text" | "thinking" | "toolCall";
      toolCallId: string | null;
    }
  >
>;
export type PartDeltaShape = Expect<
  Equal<
    PartDelta,
    {
      partId: PartId;
      itemId: ItemId;
      contentIndex: number;
      kind: "text" | "thinking" | "toolCall";
      phase: "start" | "delta" | "end";
      delta: string;
    }
  >
>;
export type ItemKinds = Expect<
  Equal<ItemRecord["kind"], "user" | "assistant" | "system" | "toolResult" | "custom">
>;
export type AssistantItemShape = Expect<
  Equal<
    Extract<ItemRecord, { kind: "assistant" }>,
    {
      itemId: ItemId;
      status: ItemStatus;
      kind: "assistant";
      message: AssistantMessage;
      partIds: PartId[];
    }
  >
>;
export type ToolProgressUpdate = Expect<
  Equal<Extract<ItemUpdate, { kind: "tool_progress" }>["kind"], "tool_progress">
>;
export type ResultRecordOptional = Expect<
  Equal<
    Assignable<{ status?: "complete" | "input_required" }, Pick<ToolResultRecord, "status">>,
    true
  >
>;
export type LifecycleTypes = Expect<
  Equal<
    LifecycleEvent["type"],
    | "thread.started"
    | "thread.updated"
    | "thread.closed"
    | "turn.started"
    | "turn.updated"
    | "turn.completed"
    | "step.started"
    | "step.updated"
    | "step.completed"
    | "item.started"
    | "item.updated"
    | "item.completed"
  >
>;

test("type assertions compile", () => {});
