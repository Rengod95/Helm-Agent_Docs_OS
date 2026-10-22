import { test } from "bun:test";
import type * as PiAgentCore from "@earendil-works/pi-agent-core";
import type * as PiAi from "@earendil-works/pi-ai";
import type {
  AfterToolCallContext,
  AfterToolCallResult,
  AgentContext,
  AgentEvent,
  AgentTool,
  AgentToolCall,
  AgentToolHooks,
  AgentToolResult,
  AgentToolUpdateCallback,
  Api,
  AssistantMessageDiagnostic,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  BeforeToolCallContext,
  BeforeToolCallResult,
  CacheRetention,
  Context,
  CustomAgentMessages,
  DeferredHandle,
  DiagnosticErrorInfo,
  ImageContent,
  JsonObject,
  JsonValue,
  Model,
  ModelCost,
  ModelThinkingLevel,
  NestedToolCallRecord,
  NestedToolCalls,
  Provider,
  SimpleStreamOptions,
  StopReason,
  StreamFn,
  SystemMessage,
  TextContent,
  ThinkingBudgets,
  ThinkingContent,
  Tool,
  ToolCall,
  ToolExecutionMode,
  ToolReference,
  ToolResultMessage,
  TranscriptContext,
  Usage,
  UserMessage,
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

/** F가 재노출한 이름은 pi 원본과 같은 타입이다(F.conversation.spec §3.1). 거울이 아니라 항등이므로 구조 비교가 아니라 Equal로 본다 */
export type PiAiIdentity = [
  Expect<Equal<JsonValue, PiAi.JsonValue>>,
  Expect<Equal<JsonObject, PiAi.JsonObject>>,
  Expect<Equal<ModelThinkingLevel, PiAi.ModelThinkingLevel>>,
  Expect<Equal<StopReason, PiAi.StopReason>>,
  Expect<Equal<TextContent, PiAi.TextContent>>,
  Expect<Equal<ThinkingContent, PiAi.ThinkingContent>>,
  Expect<Equal<ImageContent, PiAi.ImageContent>>,
  Expect<Equal<ToolCall, PiAi.ToolCall>>,
  Expect<Equal<Usage, PiAi.Usage>>,
  Expect<Equal<Tool, PiAi.Tool>>,
  Expect<Equal<ToolReference, PiAi.ToolReference>>,
  Expect<Equal<SystemMessage, PiAi.SystemMessage>>,
  Expect<Equal<UserMessage, PiAi.UserMessage>>,
  Expect<Equal<AssistantMessage, PiAi.AssistantMessage>>,
  Expect<Equal<ToolResultMessage, PiAi.ToolResultMessage>>,
  Expect<Equal<Message, PiAi.Message>>,
  Expect<Equal<AssistantMessageEvent, PiAi.AssistantMessageEvent>>,
  Expect<Equal<DiagnosticErrorInfo, PiAi.DiagnosticErrorInfo>>,
  Expect<Equal<AssistantMessageDiagnostic, PiAi.AssistantMessageDiagnostic>>,
  Expect<Equal<DeferredHandle, PiAi.DeferredHandle>>,
  Expect<Equal<NestedToolCallRecord, PiAi.NestedToolCallRecord>>,
  Expect<Equal<NestedToolCalls, PiAi.NestedToolCalls>>,
  Expect<Equal<Api, PiAi.Api>>,
  Expect<Equal<CacheRetention, PiAi.CacheRetention>>,
  Expect<Equal<ThinkingBudgets, PiAi.ThinkingBudgets>>,
  Expect<Equal<ModelCost, PiAi.ModelCost>>,
  Expect<Equal<Model<Api>, PiAi.Model<PiAi.Api>>>,
  Expect<Equal<Context, PiAi.Context>>,
  Expect<Equal<TranscriptContext, PiAi.TranscriptContext>>,
  Expect<Equal<SimpleStreamOptions, PiAi.SimpleStreamOptions>>,
  Expect<Equal<Provider, PiAi.Provider>>,
];

export type PiAgentCoreIdentity = [
  Expect<Equal<ToolExecutionMode, PiAgentCore.ToolExecutionMode>>,
  Expect<Equal<CustomAgentMessages, PiAgentCore.CustomAgentMessages>>,
  Expect<Equal<AgentMessage, PiAgentCore.AgentMessage>>,
  Expect<Equal<AgentToolResult, PiAgentCore.AgentToolResult>>,
  Expect<Equal<AgentToolUpdateCallback, PiAgentCore.AgentToolUpdateCallback>>,
  Expect<Equal<AgentTool, PiAgentCore.AgentTool>>,
  Expect<Equal<AgentEvent, PiAgentCore.AgentEvent>>,
  Expect<Equal<AgentToolCall, PiAgentCore.AgentToolCall>>,
  Expect<Equal<AgentContext, PiAgentCore.AgentContext>>,
  Expect<Equal<BeforeToolCallResult, PiAgentCore.BeforeToolCallResult>>,
  Expect<Equal<AfterToolCallResult, PiAgentCore.AfterToolCallResult>>,
  Expect<Equal<BeforeToolCallContext, PiAgentCore.BeforeToolCallContext>>,
  Expect<Equal<AfterToolCallContext, PiAgentCore.AfterToolCallContext>>,
];

/** 스트림과 StreamFn은 재노출하지 않고 소비 계약만 적었다(pi.ts). pi 원본은 F 쪽에 대입할 수 있어야 한다 */
export type StreamContractAcceptsPi = [
  Expect<Assignable<PiAi.AssistantMessageEventStream, AssistantMessageEventStream>>,
  Expect<Assignable<PiAgentCore.StreamFn, StreamFn>>,
];

/** AgentToolHooks는 pi에 같은 이름이 없다. AgentLoopConfig의 두 훅을 필수로 좁힌 모양이다 */
export type ToolHooksShape = Expect<
  Equal<
    AgentToolHooks,
    {
      beforeToolCall: (
        context: PiAgentCore.BeforeToolCallContext,
        signal?: AbortSignal,
      ) => Promise<PiAgentCore.BeforeToolCallResult | undefined>;
      afterToolCall: (
        context: PiAgentCore.AfterToolCallContext,
        signal?: AbortSignal,
      ) => Promise<PiAgentCore.AfterToolCallResult | undefined>;
    }
  >
>;

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
