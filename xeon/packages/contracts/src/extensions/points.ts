import { Type, type TSchema, type TUnsafe } from "typebox";
import {
  AfterProviderResponsePayloadSchema,
  BeforeProviderHeadersPayloadSchema,
  BeforeProviderRequestPayloadSchema,
  CacheWarmingDecisionPayloadSchema,
  CacheWarmingPatchSchema,
  ContextPatchSchema,
  ContextPayloadSchema,
  HeadersPatchSchema,
  ModelSelectPayloadSchema,
  ProviderPayloadPatchSchema,
  ProviderStreamPayloadSchema,
  ThinkingLevelSelectPayloadSchema,
  type AfterProviderResponsePayload,
  type BeforeProviderHeadersPayload,
  type BeforeProviderRequestPayload,
  type CacheWarmingDecisionPayload,
  type CacheWarmingPatch,
  type CacheWarmingValue,
  type ContextPatch,
  type ContextPayload,
  type ContextValue,
  type HeadersPatch,
  type HeadersValue,
  type ModelSelectPayload,
  type ProviderPayloadPatch,
  type ProviderPayloadValue,
  type ProviderStreamPayload,
  type ThinkingLevelSelectPayload,
} from "./points/request.ts";
import {
  BeforeAgentStartPatchSchema,
  BeforeAgentStartPayloadSchema,
  InputPatchSchema,
  InputPayloadSchema,
  UserBashDecisionSchema,
  UserBashPayloadSchema,
  type BeforeAgentStartPatch,
  type BeforeAgentStartPayload,
  type BeforeAgentStartValue,
  type InputPatch,
  type InputPayload,
  type InputValue,
  type UserBashDecision,
  type UserBashPayload,
} from "./points/input.ts";
import {
  ToolCallDecisionSchema,
  ToolCallPayloadSchema,
  ToolExecutionEndPayloadSchema,
  ToolExecutionStartPayloadSchema,
  ToolExecutionUpdatePayloadSchema,
  ToolResultPatchSchema,
  ToolResultPayloadSchema,
  type ToolCallDecision,
  type ToolCallPayload,
  type ToolExecutionEndPayload,
  type ToolExecutionStartPayload,
  type ToolExecutionUpdatePayload,
  type ToolResultPatch,
  type ToolResultPayload,
  type ToolResultValue,
} from "./points/tool.ts";
import {
  AgentBeforeSettlePayloadSchema,
  AgentEndPayloadSchema,
  AgentSettledPayloadSchema,
  AgentStartPayloadSchema,
  BoundaryPatchSchema,
  MessageEndPatchSchema,
  MessageEndPayloadSchema,
  MessageStartPayloadSchema,
  MessageUpdatePayloadSchema,
  TurnEndPayloadSchema,
  TurnStartPayloadSchema,
  type AgentBeforeSettlePayload,
  type AgentEndPayload,
  type AgentSettledPayload,
  type AgentStartPayload,
  type BoundaryPatch,
  type BoundaryValue,
  type MessageEndPatch,
  type MessageEndPayload,
  type MessageEndValue,
  type MessageStartPayload,
  type MessageUpdatePayload,
  type TurnEndPayload,
  type TurnStartPayload,
} from "./points/boundary.ts";
import {
  McpServersChangePayloadSchema,
  ProjectTrustDecisionSchema,
  ProjectTrustPayloadSchema,
  ResourcesDiscoverPayloadSchema,
  ResourcesPatchSchema,
  SessionBeforeCompactDecisionSchema,
  SessionBeforeCompactPayloadSchema,
  SessionBeforeForkDecisionSchema,
  SessionBeforeForkPayloadSchema,
  SessionBeforeSwitchPayloadSchema,
  SessionBeforeTreeDecisionSchema,
  SessionBeforeTreePayloadSchema,
  SessionCancelDecisionSchema,
  SessionCompactFailedPayloadSchema,
  SessionCompactPayloadSchema,
  SessionInfoChangedPayloadSchema,
  SessionShutdownPayloadSchema,
  SessionStartPayloadSchema,
  SessionTreePayloadSchema,
  UIPromptPayloadSchema,
  type McpServersChangePayload,
  type ProjectTrustDecision,
  type ProjectTrustPayload,
  type ResourcesDiscoverPayload,
  type ResourcesPatch,
  type ResourcesValue,
  type SessionBeforeCompactDecision,
  type SessionBeforeCompactPayload,
  type SessionBeforeForkDecision,
  type SessionBeforeForkPayload,
  type SessionBeforeSwitchPayload,
  type SessionBeforeTreeDecision,
  type SessionBeforeTreePayload,
  type SessionCancelDecision,
  type SessionCompactFailedPayload,
  type SessionCompactPayload,
  type SessionInfoChangedPayload,
  type SessionShutdownPayload,
  type SessionStartPayload,
  type SessionTreePayload,
  type UIPromptPayload,
} from "./points/session.ts";
import {
  AgentSettledEventPayloadSchema,
  LeaseRejectedPayloadSchema,
  type AgentSettledEventPayload,
  type LeaseRejectedPayload,
} from "../records/index.ts";
import {
  GuardDecisionSchema,
  GuardOutputPayloadSchema,
  type GuardDecision,
  type GuardOutputPayload,
} from "./points/guard.ts";
import { assertNever } from "../base/index.ts";

export * from "./points/input.ts";
export * from "./points/request.ts";
export * from "./points/tool.ts";
export * from "./points/boundary.ts";
export * from "./points/session.ts";
export * from "./points/guard.ts";

// ── 기본 타입 ────────────────────────────────────────────────────────────

export type Fold = "tap" | "first" | "chain" | "collect";
export type PointKind =
  | "input"
  | "request"
  | "tool"
  | "boundary"
  | "session"
  | "lifecycle"
  | "guard";

export interface TapSig<P> {
  readonly fold: "tap";
  readonly payload: P;
}
export interface FirstSig<P, D> {
  readonly fold: "first";
  readonly payload: P;
  readonly decision: D;
}
export interface ChainSig<P, V, X> {
  readonly fold: "chain";
  readonly payload: P;
  readonly value: V;
  readonly patch: X;
}

/**
 * collect: 모든 핸들러가 원본 payload를 받고 반환값(contribution)을 등록 순서대로 모은다.
 * 병합은 지점의 순수 함수(`COLLECT_RULES`)가 한 번 한다
 */
export interface CollectSig<P, V, C> {
  readonly fold: "collect";
  readonly payload: P;
  readonly value: V;
  readonly contribution: C;
}

/** 지점 이름 → 정적 시그니처. F.extensions.spec §3.4 표와 같은 46행 */
export interface PointSignatures {
  "input.user.before": ChainSig<InputPayload, InputValue, InputPatch>;
  "input.bash.before": FirstSig<UserBashPayload, UserBashDecision>;
  "input.agent.before": CollectSig<
    BeforeAgentStartPayload,
    BeforeAgentStartValue,
    BeforeAgentStartPatch
  >;
  "request.context.before": ChainSig<ContextPayload, ContextValue, ContextPatch>;
  "request.system.before": ChainSig<ContextPayload, ContextValue, ContextPatch>;
  "request.cache.before": ChainSig<
    CacheWarmingDecisionPayload,
    CacheWarmingValue,
    CacheWarmingPatch
  >;
  "request.provider.before": ChainSig<
    BeforeProviderRequestPayload,
    ProviderPayloadValue,
    ProviderPayloadPatch
  >;
  "request.headers.before": ChainSig<BeforeProviderHeadersPayload, HeadersValue, HeadersPatch>;
  "request.provider.after": TapSig<AfterProviderResponsePayload>;
  "request.stream": TapSig<ProviderStreamPayload>;
  "request.model.after": TapSig<ModelSelectPayload>;
  "request.thinking.after": TapSig<ThinkingLevelSelectPayload>;
  "tool.call.before": FirstSig<ToolCallPayload, ToolCallDecision>;
  "tool.result": ChainSig<ToolResultPayload, ToolResultValue, ToolResultPatch>;
  "tool.execution.before": TapSig<ToolExecutionStartPayload>;
  "tool.execution.update": TapSig<ToolExecutionUpdatePayload>;
  "tool.execution.after": TapSig<ToolExecutionEndPayload>;
  "boundary.turn.before": TapSig<AgentStartPayload>;
  "boundary.step.before": TapSig<TurnStartPayload>;
  "boundary.message.before": TapSig<MessageStartPayload>;
  "boundary.message.update": TapSig<MessageUpdatePayload>;
  "boundary.message.after": ChainSig<MessageEndPayload, MessageEndValue, MessageEndPatch>;
  "boundary.step.after": ChainSig<TurnEndPayload, BoundaryValue, BoundaryPatch>;
  "boundary.settle.before": ChainSig<AgentBeforeSettlePayload, BoundaryValue, BoundaryPatch>;
  "boundary.turn.after": TapSig<AgentEndPayload>;
  "boundary.settle.after": TapSig<AgentSettledPayload>;
  "session.trust.before": FirstSig<ProjectTrustPayload, ProjectTrustDecision>;
  "session.resources": CollectSig<ResourcesDiscoverPayload, ResourcesValue, ResourcesPatch>;
  "session.mcp.after": TapSig<McpServersChangePayload>;
  "session.start": TapSig<SessionStartPayload>;
  "session.info.after": TapSig<SessionInfoChangedPayload>;
  "session.switch.before": FirstSig<SessionBeforeSwitchPayload, SessionCancelDecision>;
  "session.fork.before": FirstSig<SessionBeforeForkPayload, SessionBeforeForkDecision>;
  "session.compact.before": FirstSig<SessionBeforeCompactPayload, SessionBeforeCompactDecision>;
  "session.compact.after": TapSig<SessionCompactPayload>;
  "session.compact.failed": TapSig<SessionCompactFailedPayload>;
  "session.tree.before": FirstSig<SessionBeforeTreePayload, SessionBeforeTreeDecision>;
  "session.tree.after": TapSig<SessionTreePayload>;
  "session.shutdown": TapSig<SessionShutdownPayload>;
  "session.prompt.before": TapSig<UIPromptPayload>;
  "session.prompt.after": TapSig<UIPromptPayload>;
  "guard.model.before": FirstSig<BeforeProviderRequestPayload, GuardDecision>;
  "guard.tool.before": FirstSig<ToolCallPayload, GuardDecision>;
  "guard.output.before": FirstSig<GuardOutputPayload, GuardDecision>;
  "lifecycle.agent.settled": TapSig<AgentSettledEventPayload>;
  "lifecycle.lease.rejected": TapSig<LeaseRejectedPayload>;
}

export type PointName = keyof PointSignatures;
export type FirstPointName = {
  [N in PointName]: PointSignatures[N]["fold"] extends "first" ? N : never;
}[PointName];
export type ChainPointName = {
  [N in PointName]: PointSignatures[N]["fold"] extends "chain" ? N : never;
}[PointName];
export type CollectPointName = {
  [N in PointName]: PointSignatures[N]["fold"] extends "collect" ? N : never;
}[PointName];
export type TapPointName = {
  [N in PointName]: PointSignatures[N]["fold"] extends "tap" ? N : never;
}[PointName];

/** §3.4 표 순서(번호 1~46)의 지점 이름 */
export const POINT_NAMES: readonly PointName[] = [
  "input.user.before",
  "input.bash.before",
  "input.agent.before",
  "request.context.before",
  "request.system.before",
  "request.cache.before",
  "request.provider.before",
  "request.headers.before",
  "request.provider.after",
  "request.stream",
  "request.model.after",
  "request.thinking.after",
  "tool.call.before",
  "tool.result",
  "tool.execution.before",
  "tool.execution.update",
  "tool.execution.after",
  "boundary.turn.before",
  "boundary.step.before",
  "boundary.message.before",
  "boundary.message.update",
  "boundary.message.after",
  "boundary.step.after",
  "boundary.settle.before",
  "boundary.turn.after",
  "boundary.settle.after",
  "session.trust.before",
  "session.resources",
  "session.mcp.after",
  "session.start",
  "session.info.after",
  "session.switch.before",
  "session.fork.before",
  "session.compact.before",
  "session.compact.after",
  "session.compact.failed",
  "session.tree.before",
  "session.tree.after",
  "session.shutdown",
  "session.prompt.before",
  "session.prompt.after",
  "guard.model.before",
  "guard.tool.before",
  "guard.output.before",
  "lifecycle.agent.settled",
  "lifecycle.lease.rejected",
];

/** POINTS 키의 문자열 열거 */
export const PointNameSchema: TUnsafe<PointName> = Type.Unsafe<PointName>(
  Type.String({ enum: POINT_NAMES, minLength: 1, maxLength: 48 }),
);

/**
 * 지점별 실패 정책(adr.0017 §3.4). closed: 핸들러 예외가 그 지점의 거부값이 된다.
 * open: 기록하고 그 핸들러의 몫만 버린 채 계속한다. skip: 그 핸들러의 패치만 버리고 계속한다.
 */
export type FailurePolicy = "closed" | "open" | "skip";
/** fold별 기본값. first는 closed가 기본이고 지점이 open으로 바꿀 수 있다 */
export type FoldFailure<F extends Fold> = F extends "tap" | "collect"
  ? "open"
  : F extends "first"
    ? "closed" | "open"
    : "skip";

/** 지점이 fold 기본값과 다른 실패 정책을 가진 지점(사유는 POINTS 선언 주석) */
export type FailOpenFirstPointName = "session.compact.before";

export interface PiSource {
  /** 옛 pi 이벤트명. 지점 이름과 다르다(지점 이름은 `name`) */
  readonly event: string;
  /** 정의 위치. 예: "types.ts:1228/1426" */
  readonly def: string;
  /** 합성 위치. 예: "runner.ts:1242 emitToolCall" */
  readonly emit: string;
  readonly piFold: "tap" | "tap-mutate" | "first" | "chain" | "collect";
}

export interface PointDecl<N extends PointName = PointName> {
  readonly name: N;
  readonly kind: PointKind;
  readonly fold: PointSignatures[N]["fold"];
  /** 핸들러 실패 정책. fold 기본값과 다르면 선언에 사유 주석을 단다 */
  readonly failure: FoldFailure<PointSignatures[N]["fold"]>;
  /** tap만 detached 허용. detached는 디스패처가 완료를 기다리지 않는다 */
  readonly dispatch: "await" | "detached";
  readonly payload: TSchema;
  /** first: decision 스키마, chain: patch 스키마, collect: contribution 스키마, tap: 없음 */
  readonly result?: TSchema;
  /** boundary 지점의 최종 검증 여부(§4.1) */
  readonly finalize?: "boundary";
  /**
   * 참이면 thread 없이 호스트 수준에서 발화하는 지점이다(§7). 페이로드에 threadId가 없고 발화 문맥에도 thread가 없다.
   * 지금은 `session.trust.before`뿐이다(thread를 만들기 전에 폴더 신뢰를 판정한다).
   */
  readonly threadless?: true;
  /** M1 스모크에서 페이로드를 정확화한 지점 */
  readonly m1: boolean;
  /** pi 이벤트에서 온 41행의 출처. 새로 연 지점(guard, lifecycle)은 없다 */
  readonly pi?: PiSource;
}

function pi(event: string, def: string, emit: string, piFold: PiSource["piFold"]): PiSource {
  return { event, def, emit, piFold };
}

/**
 * 지점 선언 표. 46행 모두 fold, kind, payload, failure를 가진다. pi 출처는 pi에서 온 41행만 가진다.
 * 이 표와 F.extensions.spec §3.4 표가 일치하는지는 test/extensions/points.doc.test.ts가 대조한다.
 */
export const POINTS: { readonly [N in PointName]: PointDecl<N> } = {
  "input.user.before": {
    name: "input.user.before",
    kind: "input",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: InputPayloadSchema,
    result: InputPatchSchema,
    m1: true,
    pi: pi("input", "types.ts:1143/1156", "runner.ts:1520 emitInput", "chain"),
  },
  "input.bash.before": {
    name: "input.bash.before",
    kind: "input",
    fold: "first",
    failure: "closed",
    dispatch: "await",
    payload: UserBashPayloadSchema,
    result: UserBashDecisionSchema,
    m1: false,
    pi: pi("user_bash", "types.ts:1125/1438", "runner.ts:1262 emitUserBash", "first"),
  },
  "input.agent.before": {
    name: "input.agent.before",
    kind: "input",
    fold: "collect",
    failure: "open",
    dispatch: "await",
    payload: BeforeAgentStartPayloadSchema,
    result: BeforeAgentStartPatchSchema,
    m1: false,
    pi: pi(
      "before_agent_start",
      "types.ts:919/1468",
      "runner.ts:1420 emitBeforeAgentStart",
      "chain",
    ),
  },
  "request.context.before": {
    name: "request.context.before",
    kind: "request",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: ContextPayloadSchema,
    result: ContextPatchSchema,
    m1: true,
    pi: pi("context", "types.ts:871/1415", "runner.ts:1298 emitContext 1단계", "chain"),
  },
  "request.system.before": {
    name: "request.system.before",
    kind: "request",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: ContextPayloadSchema,
    result: ContextPatchSchema,
    m1: false,
    pi: pi("context_with_system", "types.ts:881/1415", "runner.ts:1298 emitContext 2단계", "chain"),
  },
  "request.cache.before": {
    name: "request.cache.before",
    kind: "request",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: CacheWarmingDecisionPayloadSchema,
    result: CacheWarmingPatchSchema,
    m1: false,
    pi: pi(
      "cache_warming_decision",
      "cache-warmer.ts:112/117",
      "runner.ts:1121 emitCacheWarmingDecision",
      "collect",
    ),
  },
  "request.provider.before": {
    name: "request.provider.before",
    kind: "request",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: BeforeProviderRequestPayloadSchema,
    result: ProviderPayloadPatchSchema,
    m1: true,
    pi: pi(
      "before_provider_request",
      "types.ts:887/1422",
      "runner.ts:1361 emitBeforeProviderRequest",
      "chain",
    ),
  },
  "request.headers.before": {
    name: "request.headers.before",
    kind: "request",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: BeforeProviderHeadersPayloadSchema,
    result: HeadersPatchSchema,
    m1: false,
    pi: pi(
      "before_provider_headers",
      "types.ts:897/—",
      "runner.ts:1392 emitBeforeProviderHeaders",
      "tap-mutate",
    ),
  },
  "request.provider.after": {
    name: "request.provider.after",
    kind: "request",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: AfterProviderResponsePayloadSchema,
    m1: false,
    pi: pi("after_provider_response", "types.ts:903", "runner.ts:1089 emit", "tap"),
  },
  "request.stream": {
    name: "request.stream",
    kind: "request",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: ProviderStreamPayloadSchema,
    m1: false,
    pi: pi("provider_stream_event", "types.ts:910", "runner.ts:1089 emit", "tap"),
  },
  "request.model.after": {
    name: "request.model.after",
    kind: "request",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: ModelSelectPayloadSchema,
    m1: false,
    pi: pi("model_select", "types.ts:1106", "runner.ts:1089 emit", "tap"),
  },
  "request.thinking.after": {
    name: "request.thinking.after",
    kind: "request",
    fold: "tap",
    failure: "open",
    dispatch: "detached",
    payload: ThinkingLevelSelectPayloadSchema,
    m1: false,
    pi: pi("thinking_level_select", "types.ts:1114", "runner.ts:1089 emit (대기 안 함)", "tap"),
  },
  "tool.call.before": {
    name: "tool.call.before",
    kind: "tool",
    fold: "first",
    failure: "closed",
    dispatch: "await",
    payload: ToolCallPayloadSchema,
    result: ToolCallDecisionSchema,
    m1: true,
    pi: pi("tool_call", "types.ts:1228/1426", "runner.ts:1242 emitToolCall", "first"),
  },
  "tool.result": {
    name: "tool.result",
    kind: "tool",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: ToolResultPayloadSchema,
    result: ToolResultPatchSchema,
    m1: true,
    pi: pi("tool_result", "types.ts:1303/1455", "runner.ts:1183 emitToolResult", "chain"),
  },
  "tool.execution.before": {
    name: "tool.execution.before",
    kind: "tool",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: ToolExecutionStartPayloadSchema,
    m1: false,
    pi: pi("tool_execution_start", "types.ts:1066", "runner.ts:1089 emit", "tap"),
  },
  "tool.execution.update": {
    name: "tool.execution.update",
    kind: "tool",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: ToolExecutionUpdatePayloadSchema,
    m1: false,
    pi: pi("tool_execution_update", "types.ts:1076", "runner.ts:1089 emit", "tap"),
  },
  "tool.execution.after": {
    name: "tool.execution.after",
    kind: "tool",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: ToolExecutionEndPayloadSchema,
    m1: false,
    pi: pi("tool_execution_end", "types.ts:1087", "runner.ts:1089 emit", "tap"),
  },
  "boundary.turn.before": {
    name: "boundary.turn.before",
    kind: "boundary",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: AgentStartPayloadSchema,
    m1: false,
    pi: pi("agent_start", "types.ts:932", "runner.ts:1089 emit", "tap"),
  },
  "boundary.step.before": {
    name: "boundary.step.before",
    kind: "boundary",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: TurnStartPayloadSchema,
    m1: true,
    pi: pi("turn_start", "types.ts:1030", "runner.ts:1089 emit", "tap"),
  },
  "boundary.message.before": {
    name: "boundary.message.before",
    kind: "boundary",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: MessageStartPayloadSchema,
    m1: false,
    pi: pi("message_start", "types.ts:1047", "runner.ts:1089 emit", "tap"),
  },
  "boundary.message.update": {
    name: "boundary.message.update",
    kind: "boundary",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: MessageUpdatePayloadSchema,
    m1: false,
    pi: pi("message_update", "types.ts:1053", "runner.ts:1089 emit", "tap"),
  },
  "boundary.message.after": {
    name: "boundary.message.after",
    kind: "boundary",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: MessageEndPayloadSchema,
    result: MessageEndPatchSchema,
    m1: false,
    pi: pi("message_end", "types.ts:1060/1463", "runner.ts:1144 emitMessageEnd", "chain"),
  },
  "boundary.step.after": {
    name: "boundary.step.after",
    kind: "boundary",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: TurnEndPayloadSchema,
    result: BoundaryPatchSchema,
    finalize: "boundary",
    m1: true,
    pi: pi("turn_end", "types.ts:1037/994", "runner.ts:1029 emitBoundary", "chain"),
  },
  "boundary.settle.before": {
    name: "boundary.settle.before",
    kind: "boundary",
    fold: "chain",
    failure: "skip",
    dispatch: "await",
    payload: AgentBeforeSettlePayloadSchema,
    result: BoundaryPatchSchema,
    finalize: "boundary",
    m1: true,
    pi: pi("agent_before_settle", "types.ts:1000/994", "runner.ts:1029 emitBoundary", "chain"),
  },
  "boundary.turn.after": {
    name: "boundary.turn.after",
    kind: "boundary",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: AgentEndPayloadSchema,
    m1: false,
    pi: pi("agent_end", "types.ts:937", "runner.ts:1089 emit", "tap"),
  },
  "boundary.settle.after": {
    name: "boundary.settle.after",
    kind: "boundary",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: AgentSettledPayloadSchema,
    m1: true,
    pi: pi("agent_settled", "types.ts:1005", "runner.ts:1089 emit", "tap"),
  },
  "session.trust.before": {
    name: "session.trust.before",
    kind: "session",
    fold: "first",
    failure: "closed",
    dispatch: "await",
    payload: ProjectTrustPayloadSchema,
    result: ProjectTrustDecisionSchema,
    threadless: true,
    m1: false,
    pi: pi("project_trust", "types.ts:686/693", "runner.ts:295 emitProjectTrustEvent", "first"),
  },
  "session.resources": {
    name: "session.resources",
    kind: "session",
    fold: "collect",
    failure: "open",
    dispatch: "await",
    payload: ResourcesDiscoverPayloadSchema,
    result: ResourcesPatchSchema,
    m1: false,
    pi: pi(
      "resources_discover",
      "types.ts:711/718",
      "runner.ts:1474 emitResourcesDiscover",
      "collect",
    ),
  },
  "session.mcp.after": {
    name: "session.mcp.after",
    kind: "session",
    fold: "tap",
    failure: "open",
    dispatch: "detached",
    payload: McpServersChangePayloadSchema,
    m1: false,
    pi: pi("mcp_servers_change", "types.ts:730", "runner.ts:459 emit (대기 안 함)", "tap"),
  },
  "session.start": {
    name: "session.start",
    kind: "session",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: SessionStartPayloadSchema,
    m1: true,
    pi: pi("session_start", "types.ts:741", "runner.ts:1089 emit", "tap"),
  },
  "session.info.after": {
    name: "session.info.after",
    kind: "session",
    fold: "tap",
    failure: "open",
    dispatch: "detached",
    payload: SessionInfoChangedPayloadSchema,
    m1: false,
    pi: pi("session_info_changed", "types.ts:750", "runner.ts:1089 emit (대기 안 함)", "tap"),
  },
  "session.switch.before": {
    name: "session.switch.before",
    kind: "session",
    fold: "first",
    failure: "closed",
    dispatch: "await",
    payload: SessionBeforeSwitchPayloadSchema,
    result: SessionCancelDecisionSchema,
    m1: false,
    pi: pi(
      "session_before_switch",
      "types.ts:757/1474",
      "runner.ts:1089 emit (cancel 중단 1096-1103)",
      "first",
    ),
  },
  "session.fork.before": {
    name: "session.fork.before",
    kind: "session",
    fold: "first",
    failure: "closed",
    dispatch: "await",
    payload: SessionBeforeForkPayloadSchema,
    result: SessionBeforeForkDecisionSchema,
    m1: false,
    pi: pi("session_before_fork", "types.ts:764/1478", "runner.ts:1089 emit", "first"),
  },
  "session.compact.before": {
    name: "session.compact.before",
    kind: "session",
    fold: "first",
    // fail-open 예외(adr.0017 §3.4.3). 컨텍스트가 넘친 상태에서 핸들러 예외가 컴팩션을 막으면 대화를 이어 갈 수 없다.
    // 예외를 낸 핸들러는 결정 없음으로 보고 다음 핸들러로 간다
    failure: "open",
    dispatch: "await",
    payload: SessionBeforeCompactPayloadSchema,
    result: SessionBeforeCompactDecisionSchema,
    m1: false,
    pi: pi("session_before_compact", "types.ts:771/1483", "runner.ts:1089 emit", "first"),
  },
  "session.compact.after": {
    name: "session.compact.after",
    kind: "session",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: SessionCompactPayloadSchema,
    m1: false,
    pi: pi("session_compact", "types.ts:784", "runner.ts:1089 emit", "tap"),
  },
  "session.compact.failed": {
    name: "session.compact.failed",
    kind: "session",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: SessionCompactFailedPayloadSchema,
    m1: false,
    pi: pi("session_compact_failed", "types.ts:795", "runner.ts:1089 emit", "tap"),
  },
  "session.tree.before": {
    name: "session.tree.before",
    kind: "session",
    fold: "first",
    failure: "closed",
    dispatch: "await",
    payload: SessionBeforeTreePayloadSchema,
    result: SessionBeforeTreeDecisionSchema,
    m1: false,
    pi: pi("session_before_tree", "types.ts:833/1488", "runner.ts:1089 emit", "first"),
  },
  "session.tree.after": {
    name: "session.tree.after",
    kind: "session",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: SessionTreePayloadSchema,
    m1: false,
    pi: pi("session_tree", "types.ts:840", "runner.ts:1089 emit", "tap"),
  },
  "session.shutdown": {
    name: "session.shutdown",
    kind: "session",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: SessionShutdownPayloadSchema,
    m1: true,
    pi: pi("session_shutdown", "types.ts:810", "runner.ts:258 emitSessionShutdownEvent", "tap"),
  },
  "session.prompt.before": {
    name: "session.prompt.before",
    kind: "session",
    fold: "tap",
    failure: "open",
    dispatch: "detached",
    payload: UIPromptPayloadSchema,
    m1: false,
    pi: pi(
      "ui_prompt_start",
      "types.ts:1014",
      "runner.ts:611 emitUIPromptEvent (대기 안 함)",
      "tap",
    ),
  },
  "session.prompt.after": {
    name: "session.prompt.after",
    kind: "session",
    fold: "tap",
    failure: "open",
    dispatch: "detached",
    payload: UIPromptPayloadSchema,
    m1: false,
    pi: pi("ui_prompt_end", "types.ts:1022", "runner.ts:595, 611 (대기 안 함)", "tap"),
  },
  "guard.model.before": {
    name: "guard.model.before",
    kind: "guard",
    fold: "first",
    failure: "closed",
    dispatch: "await",
    payload: BeforeProviderRequestPayloadSchema,
    result: GuardDecisionSchema,
    m1: false,
  },
  "guard.tool.before": {
    name: "guard.tool.before",
    kind: "guard",
    fold: "first",
    failure: "closed",
    dispatch: "await",
    payload: ToolCallPayloadSchema,
    result: GuardDecisionSchema,
    m1: false,
  },
  "guard.output.before": {
    name: "guard.output.before",
    kind: "guard",
    fold: "first",
    failure: "closed",
    dispatch: "await",
    payload: GuardOutputPayloadSchema,
    result: GuardDecisionSchema,
    m1: false,
  },
  "lifecycle.agent.settled": {
    name: "lifecycle.agent.settled",
    kind: "lifecycle",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: AgentSettledEventPayloadSchema,
    m1: false,
  },
  "lifecycle.lease.rejected": {
    name: "lifecycle.lease.rejected",
    kind: "lifecycle",
    fold: "tap",
    failure: "open",
    dispatch: "await",
    payload: LeaseRejectedPayloadSchema,
    m1: false,
  },
};

/** guard 지점 셋(adr.0017 §3.6). 키는 발화 시점의 대상이다 */
export const GUARD_POINTS: {
  readonly request: "guard.model.before";
  readonly tool: "guard.tool.before";
  readonly output: "guard.output.before";
} = {
  request: "guard.model.before",
  tool: "guard.tool.before",
  output: "guard.output.before",
};

/**
 * lifecycle 지점과 내구 이벤트 kind의 대응. 디스패치 키는 이벤트 id이고, 레코드 kind에서 지점 이름으로 가는 길은 이 표 하나다.
 * 이름이 다른 이유: kind는 내구 이벤트의 이름 공간(`<영역>.<이름>`)이고 지점 이름은 `<종류>.<대상>.<시점>` 규칙을 따른다
 */
export const LIFECYCLE_POINTS: {
  readonly "agent.settled": "lifecycle.agent.settled";
  readonly "lease.rejected": "lifecycle.lease.rejected";
} = {
  "agent.settled": "lifecycle.agent.settled",
  "lease.rejected": "lifecycle.lease.rejected",
};
export type LifecycleEventKind = keyof typeof LIFECYCLE_POINTS;

const DENY_REASON = "extension handler failed";

/** fail-closed first 지점의 거부값. 핸들러 예외는 이 값으로 바뀐다. fail-open 지점(FailOpenFirstPointName)은 거부값이 없다 */
export const FIRST_DENY: {
  readonly [N in Exclude<FirstPointName, FailOpenFirstPointName>]: PointSignatures[N]["decision"];
} = {
  "input.bash.before": { type: "deny", reason: DENY_REASON },
  "tool.call.before": { block: true, reason: DENY_REASON, terminate: false },
  "session.trust.before": { trusted: "no" },
  "session.switch.before": { cancel: true, reason: DENY_REASON },
  "session.fork.before": { cancel: true, reason: DENY_REASON },
  "session.tree.before": { cancel: true, reason: DENY_REASON },
  "guard.model.before": { block: true, reason: DENY_REASON },
  "guard.tool.before": { block: true, reason: DENY_REASON },
  "guard.output.before": { block: true, reason: DENY_REASON },
};

// ── chain 병합 규칙 ──────────────────────────────────────────────────────

/** 병합이 패치를 거부했다(예: message_end의 role 불일치). 디스패처는 그 핸들러의 패치만 버리고 계속한다 */
export class ChainMergeError extends Error {
  override readonly name: string = "ChainMergeError";
  readonly point: ChainPointName;

  constructor(point: ChainPointName, message: string) {
    super(message);
    this.point = point;
  }
}

/** chain 지점의 병합·중단 규칙. 순수 함수 */
export interface ChainRule<V, X> {
  readonly merge: (current: V, patch: X) => V;
  readonly stop?: (value: V) => boolean;
}

const inputRule: ChainRule<InputValue, InputPatch> = {
  merge: (current, patch) => {
    switch (patch.action) {
      case "transform": {
        const images = patch.images ?? current.images;
        return {
          text: patch.text,
          handled: current.handled,
          ...(images !== undefined ? { images } : {}),
        };
      }
      case "handled":
        return { ...current, handled: true };
      default:
        return assertNever(patch, "CHAIN_RULES[input.user.before].merge");
    }
  },
  stop: (value) => value.handled,
};

const replaceMessagesRule: ChainRule<ContextValue, ContextPatch> = {
  merge: (_current, patch) => ({ messages: patch.messages }),
};

const cacheWarmingRule: ChainRule<CacheWarmingValue, CacheWarmingPatch> = {
  merge: (current, patch) => ({ action: patch.action ?? current.action }),
};

const providerPayloadRule: ChainRule<ProviderPayloadValue, ProviderPayloadPatch> = {
  merge: (_current, patch) => ({ payload: patch.payload }),
};

/** 헤더 이름은 있는 그대로 비교한다. 소문자 정규화는 발화하는 쪽(L1.models)이 한다 */
const headersRule: ChainRule<HeadersValue, HeadersPatch> = {
  merge: (current, patch) => ({
    headers: Object.fromEntries([
      ...Object.entries(current.headers).filter(([name]) => !(name in patch.set)),
      ...Object.entries(patch.set).filter(([, value]) => value !== null),
    ]),
  }),
};

const toolResultRule: ChainRule<ToolResultValue, ToolResultPatch> = {
  merge: (current, patch) => {
    // content만 바꾸면 structuredContent는 더 이상 맞지 않을 수 있어 지운다(pi types.ts:1450-1455와 같다)
    const structuredContent =
      patch.structuredContent !== undefined
        ? patch.structuredContent
        : patch.content !== undefined
          ? undefined
          : current.structuredContent;
    const details = patch.details !== undefined ? patch.details : current.details;
    const usage = patch.usage !== undefined ? patch.usage : current.usage;
    return {
      content: patch.content ?? current.content,
      isError: patch.isError ?? current.isError,
      ...(details !== undefined ? { details } : {}),
      ...(structuredContent !== undefined ? { structuredContent } : {}),
      ...(usage !== undefined ? { usage } : {}),
    };
  },
};

const messageEndRule: ChainRule<MessageEndValue, MessageEndPatch> = {
  merge: (current, patch) => {
    if (patch.message.role !== current.message.role) {
      throw new ChainMergeError(
        "boundary.message.after",
        `boundary.message.after patch must keep the role "${current.message.role}", got "${patch.message.role}"`,
      );
    }
    return { message: patch.message };
  },
};

const boundaryRule: ChainRule<BoundaryValue, BoundaryPatch> = {
  merge: (current, patch) => ({
    entries: patch.entries ?? current.entries,
    continue: patch.continue ?? current.continue,
  }),
};

export const CHAIN_RULES: {
  readonly [N in ChainPointName]: ChainRule<
    PointSignatures[N]["value"],
    PointSignatures[N]["patch"]
  >;
} = {
  "input.user.before": inputRule,
  "request.context.before": replaceMessagesRule,
  "request.system.before": replaceMessagesRule,
  "request.cache.before": cacheWarmingRule,
  "request.provider.before": providerPayloadRule,
  "request.headers.before": headersRule,
  "tool.result": toolResultRule,
  "boundary.message.after": messageEndRule,
  "boundary.step.after": boundaryRule,
  "boundary.settle.before": boundaryRule,
};

/** collect 지점의 병합 규칙. initial에 모은 기여를 등록 순서대로 한 번 합친다. 순수 함수 */
export interface CollectRule<V, C> {
  readonly merge: (initial: V, contributions: readonly C[]) => V;
}

const beforeAgentStartRule: CollectRule<BeforeAgentStartValue, BeforeAgentStartPatch> = {
  merge: (initial, contributions) => ({
    messages: [
      ...initial.messages,
      ...contributions.flatMap((patch) => (patch.message === undefined ? [] : [patch.message])),
    ],
    systemPrompt: mergeSystemPrompts(
      initial.systemPrompt,
      contributions.flatMap((patch) =>
        patch.systemPrompt === undefined ? [] : [patch.systemPrompt],
      ),
    ),
  }),
};

/**
 * 핸들러는 모두 원본 시스템 프롬프트를 본다. 원본으로 시작하는 값은 덧붙임으로 보고 덧붙인 부분을 순서대로 모으고,
 * 원본으로 시작하지 않는 값은 전체 교체로 보고 마지막 교체가 이긴다(이전 덧붙임은 새 교체 앞에서 버리지 않고 뒤에 이어 붙인다).
 * 그래서 두 핸들러가 각자 덧붙여도 서로 덮지 않는다
 */
function mergeSystemPrompts(original: string, prompts: readonly string[]): string {
  let base = original;
  const additions: string[] = [];
  for (const prompt of prompts) {
    if (prompt.startsWith(original)) {
      const added = prompt.slice(original.length).trim();
      if (added !== "") additions.push(added);
    } else {
      base = prompt;
    }
  }
  if (additions.length === 0) return base;
  return base === "" ? additions.join("\n\n") : `${base}\n\n${additions.join("\n\n")}`;
}

const resourcesRule: CollectRule<ResourcesValue, ResourcesPatch> = {
  merge: (initial, contributions) => ({
    skillPaths: [...initial.skillPaths, ...contributions.flatMap((p) => p.skillPaths ?? [])],
    promptPaths: [...initial.promptPaths, ...contributions.flatMap((p) => p.promptPaths ?? [])],
    themePaths: [...initial.themePaths, ...contributions.flatMap((p) => p.themePaths ?? [])],
  }),
};

export const COLLECT_RULES: {
  readonly [N in CollectPointName]: CollectRule<
    PointSignatures[N]["value"],
    PointSignatures[N]["contribution"]
  >;
} = {
  "input.agent.before": beforeAgentStartRule,
  "session.resources": resourcesRule,
};
