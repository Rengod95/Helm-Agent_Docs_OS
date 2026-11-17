// 플러그인 호스트가 엔진에 거는 호출(`engine.call`, isolation-protocol.ts)을 엔진의 실제 등록 API로 옮긴다.
// 호출자 신원 `plugin:<이름>`은 연결을 연 쪽이 붙였고, 여기서는 params를 검증한 뒤 `g`의 메서드를 부른다.
// 던진 오류는 `engine_call_failed` 값으로 바꾼다. 돌려주는 값은 모두 JSON이다. 돌려 보기 문맥에서는 쓰기를 버린다.
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
  type PluginEngineCallName,
  type PluginHostError,
  type RecordQuery,
  type RegistrationApi,
  type ReportedFileChange,
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
    Type.Literal("reportChanges"),
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

/** 던진 값을 `engine_call_failed`로 옮긴다. 엔진의 오류 코드와 메시지를 싣는다 */
function failureOf(cause: unknown): PluginHostError {
  const text =
    cause instanceof PrimitiveError
      ? `${cause.code}: ${cause.message}`
      : isCapabilityError(cause)
        ? `${cause.data.code}: ${cause.message}`
        : messageOf(cause);
  return { kind: "engine_call_failed", message: text.slice(0, MESSAGE_MAX) };
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
  replay: boolean,
  changes: ToolChangeReport | undefined,
): Promise<Result<JsonValue, PluginHostError>> {
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
    default:
      return assertNever(method, "PluginEngineCallName");
  }
}

/** 엔진의 실제 등록 API로 `engine.call`을 옮기는 함수를 만든다. 호출마다 등록과 문맥을 조회한다 */
export function createEngineCallRouter(deps: EngineCallRouterDeps): EngineCallRouter {
  return async (params) => {
    const g = deps.gOf(params.registration);
    if (g === undefined) {
      return err({ kind: "unknown_target", message: `no registration ${params.registration}` });
    }
    const replay = deps.replayOf(params.requestId);
    const amb = deps.ambientOf?.(params.requestId);
    const changes = deps.changesOf?.(params.requestId);
    const routed = await attemptAsync(() =>
      amb === undefined
        ? route(g, params.method, params.params, replay, changes)
        : withAmbient(amb, () => route(g, params.method, params.params, replay, changes)),
    );
    if (!routed.ok) return err(failureOf(routed.error.cause));
    return routed.value;
  };
}
