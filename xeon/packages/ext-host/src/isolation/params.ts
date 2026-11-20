// 자식이 받는 요청과 알림의 params를 검증한다(TY-10). 엔진이 보낸 값은 경계 입력이다. 검증을 통과한 값만 쓴다.
// 스키마는 isolation-protocol.ts의 인터페이스와 맞춘다. 각 함수의 반환 타입이 그 인터페이스라서 맞지 않으면 컴파일이 깨진다.
// 훅, 도구, 알림 호출은 대화 안에서 돌므로 `threadId`를 `ThreadId`(null이 아님)로 좁힌다(HandlerContext, ToolResourceDef).
// 명령과 메서드는 대화 밖에서도 불리므로 null을 받는다.
import { Type } from "typebox";
import { err, ok, parse, type ParseError, type Result } from "@fresnel/contracts";
import { JsonValueSchema, ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import {
  DriveFrameInfoSchema,
  DriveLimitsSchema,
  DriveLockBudgetSchema,
  DriveStepLastSchema,
  GroupRecordSchema,
  PluginHostTransferOptionSchema,
  type ScriptRunFailure,
  type ScriptRunResult,
  type CommandRunParams,
  type DriveFrameInfo,
  type DriveLockBudget,
  type DriveStepParams,
  type DriveStepReply,
  type EventNotifyParams,
  type GroupRecord,
  type HookInvokeParams,
  type HostDisposeParams,
  type HostInitParams,
  type MethodCallParams,
  type PostReceipt,
  type RequestCancelParams,
  type ScopeDisposeParams,
  type StartDriveReply,
  type StateMigrateParams,
  type StepResult,
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
  transfer: Type.Optional(PluginHostTransferOptionSchema),
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
  dropped: Type.Optional(Type.Integer({ minimum: 0 })),
});

const eventKeySchema = Type.Object({ eventKey: Type.String() });

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

const startDriveReplySchema = Type.Union([
  Type.Object({ ok: Type.Literal(true) }),
  Type.Object({
    ok: Type.Literal(false),
    error: Type.Object({
      kind: Type.Union([
        Type.Literal("unknown_thread"),
        Type.Literal("unknown_scope"),
        Type.Literal("child_thread"),
        Type.Literal("not_drive"),
        Type.Literal("drive_error"),
        Type.Literal("input_too_large"),
        Type.Literal("no_context"),
      ]),
    }),
  }),
]);

const driveStepSchema = Type.Object({
  ...callContextShape,
  threadId: ThreadIdSchema,
  registration: Type.String(),
  last: DriveStepLastSchema,
  budget: DriveLockBudgetSchema,
  frame: DriveFrameInfoSchema,
});

const driveStepReplySchema = Type.Object({
  command: JsonValueSchema,
  limits: Type.Union([DriveLimitsSchema, Type.Null()]),
});

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
/** 검증을 통과한 `drive.step` params. `last`는 `StepResult`(또는 첫 단계의 null)이고 `threadId`는 대화 안에서 null이 아니다 */
export type DriveStepInput = Omit<DriveStepParams, "threadId" | "last" | "budget" | "frame"> & {
  readonly threadId: ThreadId;
  readonly last: StepResult | null;
  readonly budget: DriveLockBudget;
  readonly frame: DriveFrameInfo;
};

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

/**
 * 알림의 `eventKey`만 읽는다. 처리 모양이 맞지 않아도 확인(`event.done`)을 보낼 키를 얻는 데 쓴다
 */
export function parseEventKey(value: unknown): Result<string, ParseError> {
  const checked = parse(eventKeySchema, value);
  return checked.ok ? ok(checked.value.eventKey) : err(checked.error);
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

/** 엔진 → 호스트 `drive.step`의 params 검사. 단계 함수에 넘길 입력 모양을 맞춘다 */
export function parseDriveStep(value: unknown): Result<DriveStepInput, ParseError> {
  return parse(driveStepSchema, value);
}

/** 호스트가 낸 `drive.step` 응답의 모양. 엔진이 명령과 한도를 읽는다 */
export function parseDriveStepReply(value: unknown): Result<DriveStepReply, ParseError> {
  return parse(driveStepReplySchema, value);
}

/** 엔진이 답한 `engine.call` `startDrive` 결과. 거부는 값이라서 모양이 맞지 않는 것만 오류다 */
export function parseStartDriveReply(value: unknown): Result<StartDriveReply, ParseError> {
  return parse(startDriveReplySchema, value);
}

/** 엔진이 답한 `engine.call`의 `post` 결과 */
export function parsePostReceipt(value: unknown): Result<PostReceipt, ParseError> {
  return parse(postReceiptSchema, value);
}

/** 엔진이 답한 `readRecords` 결과 */
export function parseGroupRecords(value: unknown): Result<readonly GroupRecord[], ParseError> {
  return parse(Type.Array(GroupRecordSchema), value);
}

const scriptRunResultSchema = Type.Object({
  exitCode: Type.Union([Type.Integer(), Type.Null()]),
  signal: Type.Union([Type.String(), Type.Null()]),
  stdout: Type.String(),
  stdoutTruncated: Type.Boolean(),
  stderr: Type.String(),
  stderrTruncated: Type.Boolean(),
  timedOut: Type.Boolean(),
});

const scriptRunFailureSchema = Type.Union([
  Type.Object({ kind: Type.Literal("script_not_declared") }),
  Type.Object({ kind: Type.Literal("script_outside_tree") }),
  Type.Object({ kind: Type.Literal("script_missing") }),
  Type.Object({ kind: Type.Literal("script_not_approved") }),
  Type.Object({ kind: Type.Literal("replay_mode_denied") }),
  Type.Object({
    kind: Type.Literal("spawn_failed"),
    code: Type.String(),
    message: Type.String(),
  }),
  Type.Object({ kind: Type.Literal("sandbox_unavailable"), reason: Type.String() }),
  // 환경 모드(AGE-58): 자격이 없거나 참조 파일 지문이 다르면 엔진이 이 두 값으로 답한다. 빠지면 자식이 응답을 읽지 못해 핸들러가 던진다
  Type.Object({ kind: Type.Literal("script_env_not_granted") }),
  Type.Object({
    kind: Type.Literal("script_ref_changed"),
    path: Type.String(),
    reason: Type.Union([
      Type.Literal("changed"),
      Type.Literal("missing"),
      Type.Literal("unreadable"),
    ]),
  }),
]);

const scriptOutcomeSchema = Type.Union([
  Type.Object({ ok: Type.Literal(true), value: scriptRunResultSchema }),
  Type.Object({ ok: Type.Literal(false), error: scriptRunFailureSchema }),
]);

/** 엔진이 답한 `runScript` 결과(`Result<ScriptRunResult, ScriptRunFailure>`의 JSON). 거절과 기동 실패도 값으로 온다 */
export function parseScriptOutcome(
  value: unknown,
): Result<Result<ScriptRunResult, ScriptRunFailure>, ParseError> {
  return parse(scriptOutcomeSchema, value);
}
