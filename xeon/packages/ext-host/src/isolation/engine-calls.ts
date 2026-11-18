// 플러그인 호스트가 엔진에 거는 호출(`engine.call`, isolation-protocol.ts)을 엔진의 실제 등록 API로 옮긴다.
// 호출자 신원 `plugin:<이름>`은 연결을 연 쪽이 붙였고, 여기서는 params를 검증한 뒤 `g`의 메서드를 부른다.
// 던진 오류는 `engine_call_failed` 값으로 바꾼다. 돌려주는 값은 모두 JSON이다. 돌려 보기 문맥에서는 쓰기를 버린다.
import { isDeepStrictEqual } from "node:util";
import { Type } from "typebox";
import {
  assertNever,
  attemptAsync,
  err,
  ok,
  parse,
  type ParseError,
  type Result,
} from "@fresnel/contracts";
import {
  CapabilityErrorDataSchema,
  type CapabilityErrorData,
  FileChangeEntrySchema,
  isCapabilityId,
  isCapabilityError,
  isSemVer,
  type ServiceKey,
} from "@fresnel/contracts/capabilities";
import {
  ImageContentSchema,
  JsonValueSchema,
  TextContentSchema,
  toJsonValue,
  type JsonValue,
} from "@fresnel/contracts/conversation";
import {
  RECORD_KIND_PATTERN,
  RECORD_KIND_READ_PATTERN,
  RecordKindSchema,
  RecordSubjectSchema,
  type EngineCallParams,
  isErrorDetailWithinLimit,
  SCRIPT_LIMITS,
  SCRIPT_NAME_PATTERN,
  type PluginEngineCallName,
  type PluginHostError,
  type PluginHostErrorOrigin,
  type PluginScriptPort,
  type RecordQuery,
  type RegistrationApi,
  type ReportedFileChange,
  type ScriptRunFailure,
  type ScriptRunResult,
  type ToolChangeReport,
} from "@fresnel/contracts/extensions";
import { stateAs } from "../erase.ts";
import { type Ambient, withAmbient } from "../primitives/ambient.ts";
import { PrimitiveError } from "../primitives/errors.ts";
import type { AnyState } from "../primitives/erased-types.ts";
import { EFFECT_KEY_MAX } from "../primitives/effect-worker.ts";
import { hostOf } from "../primitives/host-api.ts";

const ReportedChangeSchema = Type.Omit(FileChangeEntrySchema, ["source"]);

/** 알린 값 가운데 파일 변경 모양이 맞는 것만 남긴다 */
function reportedOf(values: readonly JsonValue[]): readonly ReportedFileChange[] {
  const kept: ReportedFileChange[] = [];
  for (const value of values) {
    const checked = parse(ReportedChangeSchema, value);
    if (checked.ok) kept.push(checked.value);
  }
  return kept;
}

/** 오류 메시지 상한. 프로토콜의 `error.message` 상한과 같다 */
const MESSAGE_MAX = 4000;

const EngineCallParamsSchema = Type.Object({
  method: Type.Union([
    Type.Literal("commit"),
    Type.Literal("commitWith"),
    Type.Literal("record"),
    Type.Literal("recordPrivate"),
    Type.Literal("readRecords"),
    Type.Literal("post"),
    Type.Literal("capability"),
    Type.Literal("requestEffect"),
    Type.Literal("startDrive"),
    Type.Literal("reportChanges"),
    Type.Literal("updateState"),
    Type.Literal("awaitUser"),
    Type.Literal("runScript"),
  ]),
  registration: Type.String({ minLength: 1 }),
  requestId: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  params: JsonValueSchema,
});

const RecordSchema = Type.Object({
  kind: RecordKindSchema,
  subject: RecordSubjectSchema,
  payload: JsonValueSchema,
});

const CommitWithSchema = Type.Object({
  next: JsonValueSchema,
  records: Type.Array(RecordSchema),
});

const UpdateStateSchema = Type.Object({
  prev: JsonValueSchema,
  next: JsonValueSchema,
  records: Type.Array(RecordSchema),
});

const AwaitUserSchema = Type.Object({
  phase: Type.Union([Type.Literal("begin"), Type.Literal("end")]),
});

const StartDriveSchema = Type.Object({
  input: Type.Union([JsonValueSchema, Type.Null()]),
});

const RecordPrivateSchema = Type.Object({
  kind: RecordKindSchema,
  payload: JsonValueSchema,
});

const ReadRecordsSchema = Type.Object({
  kind: Type.String({ minLength: 1, maxLength: 160 }),
  subject: Type.Optional(RecordSubjectSchema),
  limit: Type.Optional(Type.Integer({ minimum: 1 })),
});

const PostContentSchema = Type.Union([
  Type.String(),
  Type.Array(Type.Union([TextContentSchema, ImageContentSchema])),
]);

const PostSchema = Type.Object({
  item: Type.Union([
    Type.Object({ kind: Type.Literal("user"), content: PostContentSchema }),
    Type.Object({
      kind: Type.Literal("context"),
      customType: RecordKindSchema,
      content: PostContentSchema,
      display: Type.Boolean(),
      details: Type.Optional(JsonValueSchema),
    }),
  ]),
  options: Type.Object({
    when: Type.Union([Type.Literal("steer"), Type.Literal("followUp"), Type.Literal("next")]),
    requestId: Type.String({ minLength: 1, maxLength: 64 }),
  }),
});

/** `ctx.changes.report`가 알린 항목. 모양 확인은 코어가 하므로 여기서는 JSON 배열인지만 본다 */
const ReportChangesSchema = Type.Object({ entries: Type.Array(JsonValueSchema) });

const CapabilitySchema = Type.Object({
  key: Type.Object({
    capability: Type.String({ minLength: 1, maxLength: 96 }),
    version: Type.String({ minLength: 1, maxLength: 128 }),
  }),
  member: Type.String({ minLength: 1, maxLength: 64 }),
  input: JsonValueSchema,
  options: Type.Optional(JsonValueSchema),
});

const RequestEffectSchema = Type.Object({
  capability: Type.String({ minLength: 1, maxLength: 96 }),
  method: Type.String({ minLength: 1, maxLength: 64 }),
  input: JsonValueSchema,
  key: Type.String({ minLength: 1, maxLength: EFFECT_KEY_MAX }),
});

/**
 * `runScript`의 params(설계 B). 이름은 매니페스트 `scripts`의 이름 문법이다. 표준 입력은 없으면 빈 문자열이고
 * 상한(`SCRIPT_LIMITS.stdinBytes`)은 바이트로 본다(라우터가 본다)
 */
const RunScriptSchema = Type.Object({
  name: Type.String({ pattern: SCRIPT_NAME_PATTERN, maxLength: 32 }),
  stdin: Type.Optional(Type.String()),
});

/** `engine.call`의 params를 검증한다. 맞지 않으면 호출하는 쪽이 `invalid_params`로 답한다 */
export function parseEngineCallParams(value: unknown): Result<EngineCallParams, ParseError> {
  return parse(EngineCallParamsSchema, value);
}

export interface EngineCallRouterDeps {
  /** 등록 id의 실제 `g`. 없으면 undefined이고 `unknown_target`으로 답한다 */
  readonly gOf: (registration: string) => RegistrationApi<AnyState> | undefined;
  /** 호출을 낳은 엔진 요청이 돌려 보기 문맥인가. `requestId`가 null이면 문맥이 없다 */
  readonly replayOf: (requestId: number | null) => boolean;
  /**
   * 호출을 낳은 엔진 요청(디스패치 핸들러, 도구 실행 등)의 ambient 문맥. 있으면 `g`의 호출을 그 문맥 안에서 한다
   * (쓰기와 기록은 thread와 멱등 키를 문맥에서 읽는다). 없으면 문맥 없이 부른다. 대리 등록이 채운다 [제안 part 2]
   */
  readonly ambientOf?: (requestId: number | null) => Ambient | undefined;
  /** 호출을 낳은 도구 실행의 `ctx.changes`. 도구 실행 밖이거나 코어가 주지 않았으면 undefined다 */
  readonly changesOf?: (requestId: number | null) => ToolChangeReport | undefined;
  /**
   * 호출을 낳은 요청의 열린 사용자 대기 수. `awaitUser`의 `begin`마다 하나 늘고 `end`마다 하나 준다.
   * 대리 등록이 요청이 끝날 때 남은 만큼 시간 예산 시계를 푼다(끝 신호 없이 죽은 자식의 대기가 시계를 영원히 멈추지 않게)
   */
  readonly waitsOf?: (requestId: number | null) => OpenWaits | undefined;
  /**
   * 스크립트 실행기(`runScript`, 설계 B). 없으면 스크립트 호출은 `sandbox_unavailable` 값으로 답한다(격리 없이 띄우지 않는다).
   * 확장마다 `createScriptRunner`로 만들어 준다
   */
  readonly scripts?: PluginScriptPort;
}

/** 요청 하나의 열린 사용자 대기 수. 라우터가 셈하고 대리 등록이 읽는다 */
export interface OpenWaits {
  count: number;
  /** 요청의 시간 한도 시계(단계 함수 등). 있으면 사용자 대기 동안 멈춘다. 대리 등록이 요청을 보낼 때 채운다 */
  clock?: { pause(): void; resume(): void };
}

/** 한 `engine.call`이 쓰는 호출 문맥. 요청에서 온 것이고 없으면 undefined다 */
interface RouteContext {
  readonly replay: boolean;
  readonly changes: ToolChangeReport | undefined;
  readonly ambient: Ambient | undefined;
  readonly waits: OpenWaits | undefined;
  readonly scripts: PluginScriptPort | undefined;
}

/** `engine.call` 하나를 처리한다. 값은 응답의 `result`이고 오류는 응답의 `error`다 */
export type EngineCallRouter = (
  params: EngineCallParams,
) => Promise<Result<JsonValue, PluginHostError>>;

/** 기록 종류 패턴을 따르는가. 읽기 질의는 끝의 `.*`로 접두 일치를 쓸 수 있다 */
const KIND_REGEX = new RegExp(RECORD_KIND_PATTERN);
const READ_KIND_REGEX = new RegExp(RECORD_KIND_READ_PATTERN);

function isQueryKind(value: string): value is RecordQuery["kind"] {
  return value.endsWith(".*") ? READ_KIND_REGEX.test(value) : KIND_REGEX.test(value);
}

type UnknownCallable = (...args: readonly unknown[]) => unknown;

function isCallable(value: unknown): value is UnknownCallable {
  return typeof value === "function";
}

function hasMember(value: object, name: string): value is Readonly<Record<string, unknown>> {
  return name in value;
}

/** 기능 서비스 객체에서 멤버 함수를 찾는다. 없거나 함수가 아니면 undefined */
function memberOf(service: unknown, name: string): UnknownCallable | undefined {
  if (typeof service !== "object" || service === null || !hasMember(service, name))
    return undefined;
  const value = service[name];
  return isCallable(value) ? value : undefined;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function describeParse(error: ParseError): string {
  return error.issues.map((issue) => `${issue.path || "/"} ${issue.message}`).join("; ");
}

function invalidParams(error: ParseError): Result<never, PluginHostError> {
  return err({ kind: "invalid_params", message: describeParse(error) });
}

/** 기능 오류의 데이터를 프로토콜 모양으로 옮긴다. 메시지는 상한으로 자르고 detail이 상한을 넘으면 뺀다. JSON이 아니면 undefined */
function capabilityOriginOf(data: CapabilityErrorData): PluginHostErrorOrigin | undefined {
  const { detail, ...rest } = data;
  const fitted = detail === undefined || isErrorDetailWithinLimit(detail) ? data : rest;
  const json = toJsonValue({ ...fitted, message: data.message.slice(0, MESSAGE_MAX) });
  if (json === undefined) return undefined;
  const checked = parse(CapabilityErrorDataSchema, json);
  return checked.ok ? { kind: "capability", data: checked.value } : undefined;
}

/** 던진 값의 원래 종류. 기능 오류는 데이터를, 확장 오류는 코드와 등록 id를 싣는다. 다른 오류는 싣지 않는다 */
function originOf(cause: unknown): PluginHostErrorOrigin | undefined {
  if (cause instanceof PrimitiveError) {
    return {
      kind: "primitive",
      code: cause.code,
      ...(cause.scopeId === undefined ? {} : { scopeId: cause.scopeId }),
    };
  }
  return isCapabilityError(cause) ? capabilityOriginOf(cause.data) : undefined;
}

/** 던진 값을 `engine_call_failed`로 옮긴다. 엔진의 오류 코드와 메시지를 싣고, 원래 종류가 있으면 `origin`도 싣는다 */
function failureOf(cause: unknown): PluginHostError {
  const text =
    cause instanceof PrimitiveError
      ? `${cause.code}: ${cause.message}`
      : isCapabilityError(cause)
        ? `${cause.data.code}: ${cause.message}`
        : messageOf(cause);
  const origin = originOf(cause);
  return {
    kind: "engine_call_failed",
    message: text.slice(0, MESSAGE_MAX),
    ...(origin === undefined ? {} : { origin }),
  };
}

/** 엔진의 돌려줄 값을 JSON으로 바꾼다. 없으면(undefined) null이고, JSON이 아니면 실패다 */
function jsonReply(value: unknown, what: string): Result<JsonValue, PluginHostError> {
  if (value === undefined) return ok(null);
  const json = toJsonValue(value);
  return json === undefined
    ? err({ kind: "engine_call_failed", message: `${what} is not JSON` })
    : ok(json);
}

async function route(
  g: RegistrationApi<AnyState>,
  method: PluginEngineCallName,
  params: JsonValue,
  context: RouteContext,
): Promise<Result<JsonValue, PluginHostError>> {
  const { replay, changes, ambient, waits } = context;
  switch (method) {
    case "commit": {
      // 돌려 보기에서는 쓰지 않고, 보낸 상태를 그대로 성공으로 돌려준다(호출하는 쪽이 스키마를 검사한다)
      if (replay) return ok(params);
      return jsonReply(await g.commit(stateAs(params)), "the committed state");
    }
    case "commitWith": {
      const parsed = parse(CommitWithSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      if (replay) return ok(parsed.value.next);
      const committed = await hostOf(g).commitWith(
        stateAs(parsed.value.next),
        parsed.value.records,
      );
      return jsonReply(committed, "the committed state");
    }
    case "record": {
      const parsed = parse(RecordSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      if (!replay) await g.record(parsed.value.kind, parsed.value.subject, parsed.value.payload);
      return ok(null);
    }
    case "recordPrivate": {
      const parsed = parse(RecordPrivateSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      if (!replay) await g.recordPrivate(parsed.value.kind, parsed.value.payload);
      return ok(null);
    }
    case "readRecords": {
      const parsed = parse(ReadRecordsSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      const { kind, subject, limit } = parsed.value;
      if (!isQueryKind(kind)) {
        return err({ kind: "invalid_params", message: "the query kind is not a record kind" });
      }
      const query: RecordQuery = {
        kind,
        ...(subject === undefined ? {} : { subject }),
        ...(limit === undefined ? {} : { limit }),
      };
      return jsonReply(await g.readRecords(query), "the records");
    }
    case "post": {
      const parsed = parse(PostSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      const { item, options } = parsed.value;
      // 돌려 보기에서는 쓰지 않는다. 대리 쪽의 `post`는 영수증을 기다리므로 같은 모양의 영수증을 돌려준다(중복 아님)
      if (replay) return ok({ requestId: options.requestId, duplicate: false });
      return jsonReply(await g.post(item, options), "the post receipt");
    }
    case "capability": {
      const parsed = parse(CapabilitySchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      if (replay) {
        return err({
          kind: "replay_mode_denied",
          message: "a capability call cannot run in a replay",
        });
      }
      const { capability, version } = parsed.value.key;
      if (!isCapabilityId(capability) || !isSemVer(version)) {
        return err({ kind: "invalid_params", message: "the capability key is malformed" });
      }
      const key: ServiceKey<unknown> = { capability, version };
      // 등록 시점의 기능 선언 검사와 호출 가드는 `g.capability`가 맡는다(실제 가드된 서비스)
      const member = memberOf(g.capability(key), parsed.value.member);
      if (member === undefined) {
        return err({
          kind: "invalid_params",
          message: `capability ${capability} has no member ${parsed.value.member}`,
        });
      }
      const options = parsed.value.options ?? undefined;
      const result = await member(parsed.value.input, options);
      return jsonReply(result, "the capability result");
    }
    case "requestEffect": {
      const parsed = parse(RequestEffectSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      const { capability, method: name, input, key } = parsed.value;
      if (!isCapabilityId(capability)) {
        return err({ kind: "invalid_params", message: "the effect capability is malformed" });
      }
      if (!replay) await hostOf(g).requestEffect({ capability, method: name, input, key });
      return ok(null);
    }
    case "reportChanges": {
      const parsed = parse(ReportChangesSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      if (changes === undefined) {
        return err({
          kind: "invalid_params",
          message: "reportChanges is only valid while a tool call runs",
        });
      }
      // 코어가 항목마다 모양을 확인하고 틀린 것은 버린다(F.capabilities.spec §3.13). 모양이 맞는 것만 넘긴다
      if (!replay) changes.report(reportedOf(parsed.value.entries));
      return ok(null);
    }
    case "updateState": {
      const parsed = parse(UpdateStateSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      const { prev, next, records } = parsed.value;
      // 돌려 보기에서는 쓰지 않고, 보낸 문서를 커밋한 것으로 답한다(호스트는 함수를 다시 돌리지 않는다)
      if (replay) return ok({ kind: "committed", state: next });
      // 함수는 호스트가 돌렸다. 엔진은 줄 안에서 현재 문서가 `prev`와 같을 때만 커밋한다. 줄은 `updateState`가 세운다
      const done = await hostOf(g).updateState(
        (current) => {
          if (!isDeepStrictEqual(toJsonValue(current), prev)) {
            throw new PrimitiveError(
              "state_conflict",
              `state of ${g.id} changed before the update`,
              { scopeId: g.id },
            );
          }
          return stateAs(next);
        },
        () => records,
      );
      if (done.ok) {
        const committed = jsonReply(done.value, "the committed state");
        return committed.ok ? ok({ kind: "committed", state: committed.value }) : committed;
      }
      const failure = done.error.kind;
      if (failure === "state_conflict") {
        // 줄 안에서 본 현재 문서를 돌려준다. 호스트가 이것으로 한 번 더 한다
        const current = jsonReply(g.state(), "the current state");
        return current.ok ? ok({ kind: "conflict", current: current.value }) : current;
      }
      return ok({ kind: "failed", failure });
    }
    case "startDrive": {
      const parsed = parse(StartDriveSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      // 돌려 보기에서는 시작 요청을 내지 않고 성공으로 답한다(호스트가 다시 큐에 넣지 않게)
      if (replay) return ok({ ok: true });
      // 문맥(thread)은 `withAmbient`가 낸 호출 요청의 것이다. 문맥이 없으면 `no_context` 값이 돌아온다
      const started = await hostOf(g).startDrive(parsed.value.input ?? undefined);
      return ok(started.ok ? { ok: true } : { ok: false, error: { kind: started.error.kind } });
    }
    case "awaitUser": {
      const parsed = parse(AwaitUserSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      // 핸들러의 예산 시계와 요청의 시간 한도 시계(단계 함수)를 멈춘다. 둘 다 없으면(도구, 명령) 멈출 시계가 없다
      const gate = ambient?.handler?.gate;
      const clock = waits?.clock;
      if (waits === undefined || (gate === undefined && clock === undefined)) return ok(null);
      if (parsed.value.phase === "begin") {
        gate?.pause();
        clock?.pause();
        waits.count += 1;
      } else if (waits.count > 0) {
        gate?.resume();
        clock?.resume();
        waits.count -= 1;
      }
      return ok(null);
    }
    case "runScript": {
      const parsed = parse(RunScriptSchema, params);
      if (!parsed.ok) return invalidParams(parsed.error);
      const { name } = parsed.value;
      const stdin = parsed.value.stdin ?? "";
      if (new TextEncoder().encode(stdin).byteLength > SCRIPT_LIMITS.stdinBytes) {
        return err({
          kind: "invalid_params",
          message: `stdin is over ${SCRIPT_LIMITS.stdinBytes} bytes`,
        });
      }
      // 답은 `Result<ScriptRunResult, ScriptRunFailure>`의 JSON이다. 거절과 기동 실패는 호출하는 쪽에 값으로 간다
      const outcome: Result<ScriptRunResult, ScriptRunFailure> =
        context.scripts === undefined
          ? SCRIPTS_NOT_INJECTED
          : await context.scripts.run({ registration: g.id, name, stdin, replay });
      return jsonReply(outcome, "the script result");
    }
    default:
      return assertNever(method, "PluginEngineCallName");
  }
}

/** 실행기가 주입되지 않은 조립의 답. 띄우지 않고 닫힌 실패(`sandbox_unavailable`)로 준다 */
const SCRIPTS_NOT_INJECTED: Result<ScriptRunResult, ScriptRunFailure> = err({
  kind: "sandbox_unavailable",
  reason: "script_port_missing",
});

/** 엔진의 실제 등록 API로 `engine.call`을 옮기는 함수를 만든다. 호출마다 등록과 문맥을 조회한다 */
export function createEngineCallRouter(deps: EngineCallRouterDeps): EngineCallRouter {
  return async (params) => {
    const g = deps.gOf(params.registration);
    if (g === undefined) {
      return err({ kind: "unknown_target", message: `no registration ${params.registration}` });
    }
    const replay = deps.replayOf(params.requestId);
    const amb = deps.ambientOf?.(params.requestId);
    const context: RouteContext = {
      replay,
      changes: deps.changesOf?.(params.requestId),
      ambient: amb,
      waits: deps.waitsOf?.(params.requestId),
      scripts: deps.scripts,
    };
    const routed = await attemptAsync(() =>
      amb === undefined
        ? route(g, params.method, params.params, context)
        : withAmbient(amb, () => route(g, params.method, params.params, context)),
    );
    if (!routed.ok) return err(failureOf(routed.error.cause));
    return routed.value;
  };
}
