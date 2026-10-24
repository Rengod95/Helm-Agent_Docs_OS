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
import { assertNever } from "../base/index.ts";

export * from "./points/input.ts";
export * from "./points/request.ts";
export * from "./points/tool.ts";
export * from "./points/boundary.ts";
export * from "./points/session.ts";

// ── 기본 타입 ────────────────────────────────────────────────────────────

export type Fold = "tap" | "first" | "chain";
export type PointKind = "input" | "request" | "tool" | "boundary" | "session";

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

/** 지점 이름 → 정적 시그니처. F.extensions.spec §3.4 표와 같은 41행 */
export interface PointSignatures {
  input: ChainSig<InputPayload, InputValue, InputPatch>;
  user_bash: FirstSig<UserBashPayload, UserBashDecision>;
  before_agent_start: ChainSig<
    BeforeAgentStartPayload,
    BeforeAgentStartValue,
    BeforeAgentStartPatch
  >;
  context: ChainSig<ContextPayload, ContextValue, ContextPatch>;
  context_with_system: ChainSig<ContextPayload, ContextValue, ContextPatch>;
  cache_warming_decision: ChainSig<
    CacheWarmingDecisionPayload,
    CacheWarmingValue,
    CacheWarmingPatch
  >;
  before_provider_request: ChainSig<
    BeforeProviderRequestPayload,
    ProviderPayloadValue,
    ProviderPayloadPatch
  >;
  before_provider_headers: ChainSig<BeforeProviderHeadersPayload, HeadersValue, HeadersPatch>;
  after_provider_response: TapSig<AfterProviderResponsePayload>;
  provider_stream_event: TapSig<ProviderStreamPayload>;
  model_select: TapSig<ModelSelectPayload>;
  thinking_level_select: TapSig<ThinkingLevelSelectPayload>;
  tool_call: FirstSig<ToolCallPayload, ToolCallDecision>;
  tool_result: ChainSig<ToolResultPayload, ToolResultValue, ToolResultPatch>;
  tool_execution_start: TapSig<ToolExecutionStartPayload>;
  tool_execution_update: TapSig<ToolExecutionUpdatePayload>;
  tool_execution_end: TapSig<ToolExecutionEndPayload>;
  agent_start: TapSig<AgentStartPayload>;
  turn_start: TapSig<TurnStartPayload>;
  message_start: TapSig<MessageStartPayload>;
  message_update: TapSig<MessageUpdatePayload>;
  message_end: ChainSig<MessageEndPayload, MessageEndValue, MessageEndPatch>;
  turn_end: ChainSig<TurnEndPayload, BoundaryValue, BoundaryPatch>;
  agent_before_settle: ChainSig<AgentBeforeSettlePayload, BoundaryValue, BoundaryPatch>;
  agent_end: TapSig<AgentEndPayload>;
  agent_settled: TapSig<AgentSettledPayload>;
  project_trust: FirstSig<ProjectTrustPayload, ProjectTrustDecision>;
  resources_discover: ChainSig<ResourcesDiscoverPayload, ResourcesValue, ResourcesPatch>;
  mcp_servers_change: TapSig<McpServersChangePayload>;
  session_start: TapSig<SessionStartPayload>;
  session_info_changed: TapSig<SessionInfoChangedPayload>;
  session_before_switch: FirstSig<SessionBeforeSwitchPayload, SessionCancelDecision>;
  session_before_fork: FirstSig<SessionBeforeForkPayload, SessionBeforeForkDecision>;
  session_before_compact: FirstSig<SessionBeforeCompactPayload, SessionBeforeCompactDecision>;
  session_compact: TapSig<SessionCompactPayload>;
  session_compact_failed: TapSig<SessionCompactFailedPayload>;
  session_before_tree: FirstSig<SessionBeforeTreePayload, SessionBeforeTreeDecision>;
  session_tree: TapSig<SessionTreePayload>;
  session_shutdown: TapSig<SessionShutdownPayload>;
  ui_prompt_start: TapSig<UIPromptPayload>;
  ui_prompt_end: TapSig<UIPromptPayload>;
}

export type PointName = keyof PointSignatures;
export type FirstPointName = {
  [N in PointName]: PointSignatures[N]["fold"] extends "first" ? N : never;
}[PointName];
export type ChainPointName = {
  [N in PointName]: PointSignatures[N]["fold"] extends "chain" ? N : never;
}[PointName];
export type TapPointName = {
  [N in PointName]: PointSignatures[N]["fold"] extends "tap" ? N : never;
}[PointName];

/** §3.4 표 순서(번호 1~41)의 지점 이름 */
export const POINT_NAMES: readonly PointName[] = [
  "input",
  "user_bash",
  "before_agent_start",
  "context",
  "context_with_system",
  "cache_warming_decision",
  "before_provider_request",
  "before_provider_headers",
  "after_provider_response",
  "provider_stream_event",
  "model_select",
  "thinking_level_select",
  "tool_call",
  "tool_result",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
  "agent_start",
  "turn_start",
  "message_start",
  "message_update",
  "message_end",
  "turn_end",
  "agent_before_settle",
  "agent_end",
  "agent_settled",
  "project_trust",
  "resources_discover",
  "mcp_servers_change",
  "session_start",
  "session_info_changed",
  "session_before_switch",
  "session_before_fork",
  "session_before_compact",
  "session_compact",
  "session_compact_failed",
  "session_before_tree",
  "session_tree",
  "session_shutdown",
  "ui_prompt_start",
  "ui_prompt_end",
];

/** POINTS 키의 문자열 열거 */
export const PointNameSchema: TUnsafe<PointName> = Type.Unsafe<PointName>(
  Type.String({ enum: POINT_NAMES, minLength: 1, maxLength: 48 }),
);

export type OnError = "record" | "deny" | "skip";
export type FoldOnError<F extends Fold> = F extends "tap"
  ? "record"
  : F extends "first"
    ? "deny"
    : "skip";

export interface PiSource {
  /** pi 이벤트명. 지점 이름과 같다 */
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
  readonly onError: FoldOnError<PointSignatures[N]["fold"]>;
  /** tap만 detached 허용. detached는 디스패처가 완료를 기다리지 않는다 */
  readonly dispatch: "await" | "detached";
  readonly payload: TSchema;
  /** first: decision 스키마, chain: patch 스키마, tap: 없음 */
  readonly result?: TSchema;
  /** boundary 지점의 최종 검증 여부(§4.1) */
  readonly finalize?: "boundary";
  /** M1 스모크에서 페이로드를 정확화한 지점 */
  readonly m1: boolean;
  readonly pi: PiSource;
}

function pi(event: string, def: string, emit: string, piFold: PiSource["piFold"]): PiSource {
  return { event, def, emit, piFold };
}

/**
 * 지점 선언 표. 41행 모두 fold, kind, payload, onError, pi 출처를 가진다.
 * 이 표와 F.extensions.spec §3.4 표가 일치하는지는 test/extensions/points.doc.test.ts가 대조한다.
 */
export const POINTS: { readonly [N in PointName]: PointDecl<N> } = {
  input: {
    name: "input",
    kind: "input",
    fold: "chain",
    onError: "skip",
    dispatch: "await",
    payload: InputPayloadSchema,
    result: InputPatchSchema,
    m1: true,
    pi: pi("input", "types.ts:1143/1156", "runner.ts:1520 emitInput", "chain"),
  },
  user_bash: {
    name: "user_bash",
    kind: "input",
    fold: "first",
    onError: "deny",
    dispatch: "await",
    payload: UserBashPayloadSchema,
    result: UserBashDecisionSchema,
    m1: false,
    pi: pi("user_bash", "types.ts:1125/1438", "runner.ts:1262 emitUserBash", "first"),
  },
  before_agent_start: {
    name: "before_agent_start",
    kind: "input",
    fold: "chain",
    onError: "skip",
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
  context: {
    name: "context",
    kind: "request",
    fold: "chain",
    onError: "skip",
    dispatch: "await",
    payload: ContextPayloadSchema,
    result: ContextPatchSchema,
    m1: true,
    pi: pi("context", "types.ts:871/1415", "runner.ts:1298 emitContext 1단계", "chain"),
  },
  context_with_system: {
    name: "context_with_system",
    kind: "request",
    fold: "chain",
    onError: "skip",
    dispatch: "await",
    payload: ContextPayloadSchema,
    result: ContextPatchSchema,
    m1: false,
    pi: pi("context_with_system", "types.ts:881/1415", "runner.ts:1298 emitContext 2단계", "chain"),
  },
  cache_warming_decision: {
    name: "cache_warming_decision",
    kind: "request",
    fold: "chain",
    onError: "skip",
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
  before_provider_request: {
    name: "before_provider_request",
    kind: "request",
    fold: "chain",
    onError: "skip",
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
  before_provider_headers: {
    name: "before_provider_headers",
    kind: "request",
    fold: "chain",
    onError: "skip",
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
  after_provider_response: {
    name: "after_provider_response",
    kind: "request",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: AfterProviderResponsePayloadSchema,
    m1: false,
    pi: pi("after_provider_response", "types.ts:903", "runner.ts:1089 emit", "tap"),
  },
  provider_stream_event: {
    name: "provider_stream_event",
    kind: "request",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: ProviderStreamPayloadSchema,
    m1: false,
    pi: pi("provider_stream_event", "types.ts:910", "runner.ts:1089 emit", "tap"),
  },
  model_select: {
    name: "model_select",
    kind: "request",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: ModelSelectPayloadSchema,
    m1: false,
    pi: pi("model_select", "types.ts:1106", "runner.ts:1089 emit", "tap"),
  },
  thinking_level_select: {
    name: "thinking_level_select",
    kind: "request",
    fold: "tap",
    onError: "record",
    dispatch: "detached",
    payload: ThinkingLevelSelectPayloadSchema,
    m1: false,
    pi: pi("thinking_level_select", "types.ts:1114", "runner.ts:1089 emit (대기 안 함)", "tap"),
  },
  tool_call: {
    name: "tool_call",
    kind: "tool",
    fold: "first",
    onError: "deny",
    dispatch: "await",
    payload: ToolCallPayloadSchema,
    result: ToolCallDecisionSchema,
    m1: true,
    pi: pi("tool_call", "types.ts:1228/1426", "runner.ts:1242 emitToolCall", "first"),
  },
  tool_result: {
    name: "tool_result",
    kind: "tool",
    fold: "chain",
    onError: "skip",
    dispatch: "await",
    payload: ToolResultPayloadSchema,
    result: ToolResultPatchSchema,
    m1: true,
    pi: pi("tool_result", "types.ts:1303/1455", "runner.ts:1183 emitToolResult", "chain"),
  },
  tool_execution_start: {
    name: "tool_execution_start",
    kind: "tool",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: ToolExecutionStartPayloadSchema,
    m1: false,
    pi: pi("tool_execution_start", "types.ts:1066", "runner.ts:1089 emit", "tap"),
  },
  tool_execution_update: {
    name: "tool_execution_update",
    kind: "tool",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: ToolExecutionUpdatePayloadSchema,
    m1: false,
    pi: pi("tool_execution_update", "types.ts:1076", "runner.ts:1089 emit", "tap"),
  },
  tool_execution_end: {
    name: "tool_execution_end",
    kind: "tool",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: ToolExecutionEndPayloadSchema,
    m1: false,
    pi: pi("tool_execution_end", "types.ts:1087", "runner.ts:1089 emit", "tap"),
  },
  agent_start: {
    name: "agent_start",
    kind: "boundary",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: AgentStartPayloadSchema,
    m1: false,
    pi: pi("agent_start", "types.ts:932", "runner.ts:1089 emit", "tap"),
  },
  turn_start: {
    name: "turn_start",
    kind: "boundary",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: TurnStartPayloadSchema,
    m1: true,
    pi: pi("turn_start", "types.ts:1030", "runner.ts:1089 emit", "tap"),
  },
  message_start: {
    name: "message_start",
    kind: "boundary",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: MessageStartPayloadSchema,
    m1: false,
    pi: pi("message_start", "types.ts:1047", "runner.ts:1089 emit", "tap"),
  },
  message_update: {
    name: "message_update",
    kind: "boundary",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: MessageUpdatePayloadSchema,
    m1: false,
    pi: pi("message_update", "types.ts:1053", "runner.ts:1089 emit", "tap"),
  },
  message_end: {
    name: "message_end",
    kind: "boundary",
    fold: "chain",
    onError: "skip",
    dispatch: "await",
    payload: MessageEndPayloadSchema,
    result: MessageEndPatchSchema,
    m1: false,
    pi: pi("message_end", "types.ts:1060/1463", "runner.ts:1144 emitMessageEnd", "chain"),
  },
  turn_end: {
    name: "turn_end",
    kind: "boundary",
    fold: "chain",
    onError: "skip",
    dispatch: "await",
    payload: TurnEndPayloadSchema,
    result: BoundaryPatchSchema,
    finalize: "boundary",
    m1: true,
    pi: pi("turn_end", "types.ts:1037/994", "runner.ts:1029 emitBoundary", "chain"),
  },
  agent_before_settle: {
    name: "agent_before_settle",
    kind: "boundary",
    fold: "chain",
    onError: "skip",
    dispatch: "await",
    payload: AgentBeforeSettlePayloadSchema,
    result: BoundaryPatchSchema,
    finalize: "boundary",
    m1: true,
    pi: pi("agent_before_settle", "types.ts:1000/994", "runner.ts:1029 emitBoundary", "chain"),
  },
  agent_end: {
    name: "agent_end",
    kind: "boundary",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: AgentEndPayloadSchema,
    m1: false,
    pi: pi("agent_end", "types.ts:937", "runner.ts:1089 emit", "tap"),
  },
  agent_settled: {
    name: "agent_settled",
    kind: "boundary",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: AgentSettledPayloadSchema,
    m1: true,
    pi: pi("agent_settled", "types.ts:1005", "runner.ts:1089 emit", "tap"),
  },
  project_trust: {
    name: "project_trust",
    kind: "session",
    fold: "first",
    onError: "deny",
    dispatch: "await",
    payload: ProjectTrustPayloadSchema,
    result: ProjectTrustDecisionSchema,
    m1: false,
    pi: pi("project_trust", "types.ts:686/693", "runner.ts:295 emitProjectTrustEvent", "first"),
  },
  resources_discover: {
    name: "resources_discover",
    kind: "session",
    fold: "chain",
    onError: "skip",
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
  mcp_servers_change: {
    name: "mcp_servers_change",
    kind: "session",
    fold: "tap",
    onError: "record",
    dispatch: "detached",
    payload: McpServersChangePayloadSchema,
    m1: false,
    pi: pi("mcp_servers_change", "types.ts:730", "runner.ts:459 emit (대기 안 함)", "tap"),
  },
  session_start: {
    name: "session_start",
    kind: "session",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: SessionStartPayloadSchema,
    m1: true,
    pi: pi("session_start", "types.ts:741", "runner.ts:1089 emit", "tap"),
  },
  session_info_changed: {
    name: "session_info_changed",
    kind: "session",
    fold: "tap",
    onError: "record",
    dispatch: "detached",
    payload: SessionInfoChangedPayloadSchema,
    m1: false,
    pi: pi("session_info_changed", "types.ts:750", "runner.ts:1089 emit (대기 안 함)", "tap"),
  },
  session_before_switch: {
    name: "session_before_switch",
    kind: "session",
    fold: "first",
    onError: "deny",
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
  session_before_fork: {
    name: "session_before_fork",
    kind: "session",
    fold: "first",
    onError: "deny",
    dispatch: "await",
    payload: SessionBeforeForkPayloadSchema,
    result: SessionBeforeForkDecisionSchema,
    m1: false,
    pi: pi("session_before_fork", "types.ts:764/1478", "runner.ts:1089 emit", "first"),
  },
  session_before_compact: {
    name: "session_before_compact",
    kind: "session",
    fold: "first",
    onError: "deny",
    dispatch: "await",
    payload: SessionBeforeCompactPayloadSchema,
    result: SessionBeforeCompactDecisionSchema,
    m1: false,
    pi: pi("session_before_compact", "types.ts:771/1483", "runner.ts:1089 emit", "first"),
  },
  session_compact: {
    name: "session_compact",
    kind: "session",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: SessionCompactPayloadSchema,
    m1: false,
    pi: pi("session_compact", "types.ts:784", "runner.ts:1089 emit", "tap"),
  },
  session_compact_failed: {
    name: "session_compact_failed",
    kind: "session",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: SessionCompactFailedPayloadSchema,
    m1: false,
    pi: pi("session_compact_failed", "types.ts:795", "runner.ts:1089 emit", "tap"),
  },
  session_before_tree: {
    name: "session_before_tree",
    kind: "session",
    fold: "first",
    onError: "deny",
    dispatch: "await",
    payload: SessionBeforeTreePayloadSchema,
    result: SessionBeforeTreeDecisionSchema,
    m1: false,
    pi: pi("session_before_tree", "types.ts:833/1488", "runner.ts:1089 emit", "first"),
  },
  session_tree: {
    name: "session_tree",
    kind: "session",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: SessionTreePayloadSchema,
    m1: false,
    pi: pi("session_tree", "types.ts:840", "runner.ts:1089 emit", "tap"),
  },
  session_shutdown: {
    name: "session_shutdown",
    kind: "session",
    fold: "tap",
    onError: "record",
    dispatch: "await",
    payload: SessionShutdownPayloadSchema,
    m1: true,
    pi: pi("session_shutdown", "types.ts:810", "runner.ts:258 emitSessionShutdownEvent", "tap"),
  },
  ui_prompt_start: {
    name: "ui_prompt_start",
    kind: "session",
    fold: "tap",
    onError: "record",
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
  ui_prompt_end: {
    name: "ui_prompt_end",
    kind: "session",
    fold: "tap",
    onError: "record",
    dispatch: "detached",
    payload: UIPromptPayloadSchema,
    m1: false,
    pi: pi("ui_prompt_end", "types.ts:1022", "runner.ts:595, 611 (대기 안 함)", "tap"),
  },
};

const DENY_REASON = "extension handler failed";

/** first 지점의 거부값. 핸들러 예외는 이 값으로 바뀐다(fail-closed) */
export const FIRST_DENY: { readonly [N in FirstPointName]: PointSignatures[N]["decision"] } = {
  user_bash: { type: "deny", reason: DENY_REASON },
  tool_call: { block: true, reason: DENY_REASON, terminate: false },
  project_trust: { trusted: "no" },
  session_before_switch: { cancel: true, reason: DENY_REASON },
  session_before_fork: { cancel: true, reason: DENY_REASON },
  session_before_compact: { cancel: true, reason: DENY_REASON },
  session_before_tree: { cancel: true, reason: DENY_REASON },
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
        return assertNever(patch, "CHAIN_RULES.input.merge");
    }
  },
  stop: (value) => value.handled,
};

const beforeAgentStartRule: ChainRule<BeforeAgentStartValue, BeforeAgentStartPatch> = {
  merge: (current, patch) => ({
    messages: patch.message === undefined ? current.messages : [...current.messages, patch.message],
    systemPrompt: patch.systemPrompt ?? current.systemPrompt,
  }),
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
        "message_end",
        `message_end patch must keep the role "${current.message.role}", got "${patch.message.role}"`,
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

const resourcesRule: ChainRule<ResourcesValue, ResourcesPatch> = {
  merge: (current, patch) => ({
    skillPaths: [...current.skillPaths, ...(patch.skillPaths ?? [])],
    promptPaths: [...current.promptPaths, ...(patch.promptPaths ?? [])],
    themePaths: [...current.themePaths, ...(patch.themePaths ?? [])],
  }),
};

export const CHAIN_RULES: {
  readonly [N in ChainPointName]: ChainRule<
    PointSignatures[N]["value"],
    PointSignatures[N]["patch"]
  >;
} = {
  input: inputRule,
  before_agent_start: beforeAgentStartRule,
  context: replaceMessagesRule,
  context_with_system: replaceMessagesRule,
  cache_warming_decision: cacheWarmingRule,
  before_provider_request: providerPayloadRule,
  before_provider_headers: headersRule,
  tool_result: toolResultRule,
  message_end: messageEndRule,
  turn_end: boundaryRule,
  agent_before_settle: boundaryRule,
  resources_discover: resourcesRule,
};
