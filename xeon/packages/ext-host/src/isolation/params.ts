// 자식이 받는 요청과 알림의 params를 검증한다(TY-10). 엔진이 보낸 값은 경계 입력이다. 검증을 통과한 값만 쓴다.
// 스키마는 isolation-protocol.ts의 인터페이스와 맞춘다. 각 함수의 반환 타입이 그 인터페이스라서 맞지 않으면 컴파일이 깨진다.
// 훅, 도구, 알림 호출은 대화 안에서 돌므로 `threadId`를 `ThreadId`(null이 아님)로 좁힌다(HandlerContext, ToolResourceDef).
// 명령과 메서드는 대화 밖에서도 불리므로 null을 받는다.
import { Type } from "typebox";
import { parse, type ParseError, type Result } from "@fresnel/contracts";
import { JsonValueSchema, ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import {
  GroupRecordSchema,
  type CommandRunParams,
  type EventNotifyParams,
  type GroupRecord,
  type HookInvokeParams,
  type HostDisposeParams,
  type HostInitParams,
  type MethodCallParams,
  type PostReceipt,
  type RequestCancelParams,
  type ScopeDisposeParams,
  type StateMigrateParams,
  type ToolExecuteParams,
  type UpdateStateReply,
} from "@fresnel/contracts/extensions";

const callContextShape = {
  threadId: Type.Union([ThreadIdSchema, Type.Null()]),
  deadlineMs: Type.Union([Type.Number(), Type.Null()]),
  replay: Type.Boolean(),
  caller: Type.String(),
  state: JsonValueSchema,
  settings: Type.Record(Type.String(), JsonValueSchema),
};

const hostInitSchema = Type.Object({
  protocolVersion: Type.Integer(),
  extension: Type.String(),
  versionId: Type.String(),
  manifest: JsonValueSchema,
  root: Type.String(),
  entry: Type.String(),
  settings: Type.Record(Type.String(), JsonValueSchema),
});

const hookInvokeSchema = Type.Object({
  ...callContextShape,
  threadId: ThreadIdSchema,
  registration: Type.String(),
  point: Type.String(),
  handlerIndex: Type.Integer({ minimum: 0 }),
  payload: JsonValueSchema,
  current: JsonValueSchema,
  dispatchKey: Type.Optional(Type.String()),
});

const toolExecuteSchema = Type.Object({
  ...callContextShape,
  threadId: ThreadIdSchema,
  registration: Type.String(),
  name: Type.String(),
  args: JsonValueSchema,
  // 엔진은 도구 호출마다 id를 보낸다. 멱등 키의 디스패치 키이고 ToolResourceDef.execute가 string을 받는다
  toolCallId: Type.String(),
  callerInfo: Type.Object({
    kind: Type.Union([Type.Literal("model"), Type.Literal("extension"), Type.Literal("host")]),
    agent: Type.Optional(
      Type.Union([Type.Literal("main"), Type.Literal("subagent"), Type.Literal("background")]),
    ),
    extension: Type.Optional(Type.String()),
    agentName: Type.Optional(Type.String()),
    afterUntrusted: Type.Optional(Type.Boolean()),
  }),
});

const commandRunSchema = Type.Object({
  ...callContextShape,
  registration: Type.String(),
  name: Type.String(),
  args: Type.String(),
  invocationId: Type.String(),
});

const methodCallSchema = Type.Object({
  ...callContextShape,
  registration: Type.String(),
  verb: Type.String(),
  params: JsonValueSchema,
  callId: Type.String(),
  callerKind: Type.Union([Type.Literal("wire"), Type.Literal("ui")]),
});

const scopeDisposeSchema = Type.Object({ registration: Type.String() });

const hostDisposeSchema = Type.Object({
  reason: Type.Union([
    Type.Literal("idle"),
    Type.Literal("shutdown"),
    Type.Literal("reload"),
    Type.Literal("disabled"),
  ]),
});

const eventNotifySchema = Type.Object({
  ...callContextShape,
  threadId: ThreadIdSchema,
  registration: Type.String(),
  point: Type.String(),
  handlerIndex: Type.Integer({ minimum: 0 }),
  eventKey: Type.String(),
  payload: JsonValueSchema,
  dispatchKey: Type.Optional(Type.String()),
});

const requestCancelSchema = Type.Object({ id: Type.Integer({ minimum: 0 }) });

const stateMigrateSchema = Type.Object({
  registration: Type.String(),
  doc: JsonValueSchema,
  fromVersion: Type.Integer(),
});

const updateStateReplySchema = Type.Union([
  Type.Object({ kind: Type.Literal("committed"), state: JsonValueSchema }),
  Type.Object({ kind: Type.Literal("conflict"), current: JsonValueSchema }),
  Type.Object({
    kind: Type.Literal("failed"),
    failure: Type.Union([
      Type.Literal("state_schema"),
      Type.Literal("state_too_large"),
      Type.Literal("storage_unavailable"),
      Type.Literal("lease_revoked"),
    ]),
  }),
]);

const postReceiptSchema = Type.Object({
  requestId: Type.String(),
  duplicate: Type.Boolean(),
});

// 검증을 통과한 값의 타입은 프로토콜 인터페이스를 쓴다. 스키마가 그보다 느슨하면 parse 반환의 대입이 컴파일에서 깨진다.
// `threadId`는 훅과 도구와 알림에서 null이 아니다(HandlerContext와 ToolResourceDef의 문맥이 ThreadId를 받는다).
/** 검증을 통과한 `host.init` params. 프로토콜 버전 검사는 호출한 쪽이 한다 */
export type HostInitInput = HostInitParams;
export type HookInvokeInput = Omit<HookInvokeParams, "threadId"> & { readonly threadId: ThreadId };
export type ToolExecuteInput = Omit<ToolExecuteParams, "threadId" | "toolCallId"> & {
  readonly threadId: ThreadId;
  readonly toolCallId: string;
};
export type CommandRunInput = Omit<CommandRunParams, "threadId"> & {
  readonly threadId: ThreadId | null;
};
export type MethodCallInput = Omit<MethodCallParams, "threadId"> & {
  readonly threadId: ThreadId | null;
};
export type ScopeDisposeInput = ScopeDisposeParams;
export type HostDisposeInput = HostDisposeParams;
export type EventNotifyInput = Omit<EventNotifyParams, "threadId"> & {
  readonly threadId: ThreadId;
};
export type RequestCancelInput = RequestCancelParams;
export type StateMigrateInput = StateMigrateParams;

export function parseHostInit(value: unknown): Result<HostInitInput, ParseError> {
  return parse(hostInitSchema, value);
}

export function parseHookInvoke(value: unknown): Result<HookInvokeInput, ParseError> {
  return parse(hookInvokeSchema, value);
}

export function parseToolExecute(value: unknown): Result<ToolExecuteInput, ParseError> {
  return parse(toolExecuteSchema, value);
}

export function parseCommandRun(value: unknown): Result<CommandRunInput, ParseError> {
  return parse(commandRunSchema, value);
}

export function parseMethodCall(value: unknown): Result<MethodCallInput, ParseError> {
  return parse(methodCallSchema, value);
}

export function parseScopeDispose(value: unknown): Result<ScopeDisposeInput, ParseError> {
  return parse(scopeDisposeSchema, value);
}

export function parseHostDispose(value: unknown): Result<HostDisposeInput, ParseError> {
  return parse(hostDisposeSchema, value);
}

export function parseEventNotify(value: unknown): Result<EventNotifyInput, ParseError> {
  return parse(eventNotifySchema, value);
}

export function parseRequestCancel(value: unknown): Result<RequestCancelInput, ParseError> {
  return parse(requestCancelSchema, value);
}

export function parseStateMigrate(value: unknown): Result<StateMigrateInput, ParseError> {
  return parse(stateMigrateSchema, value);
}

/** 엔진이 답한 `updateState` 결과. 값이라서 모양이 맞지 않으면 호출하는 쪽이 오류로 본다 */
export function parseUpdateStateReply(value: unknown): Result<UpdateStateReply, ParseError> {
  return parse(updateStateReplySchema, value);
}

/** 엔진이 답한 `engine.call`의 `post` 결과 */
export function parsePostReceipt(value: unknown): Result<PostReceipt, ParseError> {
  return parse(postReceiptSchema, value);
}

/** 엔진이 답한 `readRecords` 결과 */
export function parseGroupRecords(value: unknown): Result<readonly GroupRecord[], ParseError> {
  return parse(Type.Array(GroupRecordSchema), value);
}
