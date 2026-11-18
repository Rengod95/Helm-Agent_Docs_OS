// 지난 턴에 돌려 보기의 후보 실행기(turn-record-metrics.md 4.8 규칙 44~48, 53, 54). 후보의 훅은 격리된 플러그인 호스트 자식에서만 돈다.
// 자식은 감독(supervisor.ts)이 띄우고, 띄우기는 주입된 포트만 쓴다. 이 파일은 플러그인 진입점을 직접 읽거나 옮기지 않는다.
// 요청마다 `replay: true`를 싣는다. 자식이 `engine.call`로 부르는 쓰기(commit, record, post, updateState, startDrive)는
// 성공으로 답하고 아무것도 쓰지 않는다. 기능 호출(capability)은 `replay_mode_denied`로 거부하고, 그 호출은 `replay_denied`로 센다.
// 기록, 지표, 디스패처, 훅 시간 기록, 예산, 자동 끄기, 턴 기록기는 가져오지 않는다. 돌려 보기는 그 어느 곳에도 흔적을 남기지 않는다.
// 예상 가능한 실패(띄우기 실패, 시간 초과, 던짐, 거부)는 결과 값이다. `Bug`는 호출하는 쪽의 순서 위반에만 쓴다.
import { Type, type TSchema } from "typebox";
import {
  assertNever,
  Bug,
  eachAsync,
  err,
  ok,
  parse,
  type Logger,
  type ParseError,
  type Result,
} from "@fresnel/contracts";
import { isCapabilityId } from "@fresnel/contracts/capabilities";
import {
  ImageContentSchema,
  JsonValueSchema,
  TextContentSchema,
  type JsonValue,
} from "@fresnel/contracts/conversation";
import {
  decisionKindOf,
  FIRST_RANK,
  HOOKS,
  PLUGIN_HOST_PROTOCOL_VERSION,
  RECORD_KIND_PATTERN,
  RECORD_KIND_READ_PATTERN,
  RecordKindSchema,
  RecordSubjectSchema,
  type DecisionKind,
  type EngineCallParams,
  type HostDisposeParams,
  type HostInitParams,
  type IsolationProcessPort,
  type IsolationSpawnSpec,
  type PluginHostError,
  type PluginRegistrationDecl,
} from "@fresnel/contracts/extensions";
import {
  createPluginHostSupervisor,
  type CallError,
  type PluginHostSupervisor,
  type SupervisorError,
} from "./supervisor.ts";

/** 돌려 볼 수 있는 훅 지점(규칙 44). 그 밖의 지점은 호출하는 쪽이 `hookNotReplayable`로 거른다 */
export type ReplayPoint = "tool.call.before" | "guard.tool.before" | "tool.result";

/** 후보의 훅 핸들러 하나. `handlersFor`가 등록 순서대로 준다 */
export interface CandidateHandler {
  readonly registration: string;
  readonly handlerIndex: number;
  readonly hasState: boolean;
  /** 선언된 초기 상태의 사본(상태가 없으면 null). 호출마다 새로 보낸다. 쓰인 값은 어디에도 되돌려 쓰지 않는다 */
  readonly initialState: JsonValue;
}

/** 띄울 후보. 이름과 판 식별자는 라벨(`ext:<이름>:<versionId>`)과 `host.init`에 쓴다 */
export interface CandidateOpenInput {
  readonly name: string;
  readonly versionId: string;
  /** 후보 패키지 폴더 절대 경로(검토본 `tree/`, 초안은 `drafts/<id>/tree/`). 읽기 전용으로 열린다 */
  readonly root: string;
  /** 매니페스트 문서 그대로 */
  readonly manifest: JsonValue;
  /** 매니페스트 `entry`(루트 상대 경로) */
  readonly entry: string;
  /** 설정 키의 유효 값. 모든 호출에 같은 값을 싣는다 */
  readonly settings?: Readonly<Record<string, JsonValue>>;
}

/** 호출 하나. 시간 한도는 핸들러 요청 하나의 한도다(호출 전체의 한도가 아니다) */
export interface CandidateCall {
  readonly point: ReplayPoint;
  readonly threadId: string;
  readonly payload: JsonValue;
  /** `tool.result`의 결과 값. 다른 지점에서는 null */
  readonly current: JsonValue;
  readonly caller: string;
  readonly deadlineMs: number;
}

/**
 * 호출 결과. `returned`의 값이 null이면 결정이 없다(통과). `tool.result`는 값을 낸 마지막 핸들러의 값이다.
 * `threw`는 자식이 핸들러 오류를 답했거나 결정이 모양을 어겼다. `timeout`은 시간 한도를 넘겨 프로세스를 멈춘 것이다
 */
export type CandidateOutcome =
  | { readonly kind: "returned"; readonly value: JsonValue; readonly ms: number }
  | { readonly kind: "threw"; readonly message: string; readonly ms: number }
  | { readonly kind: "timeout"; readonly ms: number }
  | { readonly kind: "replay_denied"; readonly ms: number }
  | {
      readonly kind: "process_failed";
      readonly reason: CallError["kind"];
      readonly message: string;
      readonly ms: number;
    };

/** 띄울 명령 정보. 호출하는 쪽의 `launch`가 명령과 환경을 고른다(구조가 proxy-entry의 `IsolationLaunchInfo`와 같다) */
export interface CandidateLaunchInfo {
  readonly name: string;
  readonly root: string;
  readonly entry: string;
  readonly versionId: string;
}

/** 띄울 명령. 환경은 허용 목록으로만 만든다(구조가 proxy-entry의 `IsolationLaunch`와 같다) */
export interface CandidateLaunch {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly runtimeReadRoots?: readonly string[];
}

/** 실행기 의존. 포트가 없으면 만들 수 없다(없을 때의 착오는 호출하는 쪽이 3524로 답한다) */
export interface CandidateRunnerDeps {
  readonly process: IsolationProcessPort;
  readonly launch: (info: CandidateLaunchInfo) => CandidateLaunch;
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  readonly now: () => number;
  readonly logger: Logger;
  /** 초기화(`host.init`) 응답 시간 한도(ms) */
  readonly initTimeoutMs: number;
  readonly maskSecrets?: (line: string) => string;
}

export interface CandidateRunner {
  /** 후보 프로세스를 띄우고 `host.init`으로 등록 선언을 받는다. 한 실행기는 한 번만 연다 */
  open(
    input: CandidateOpenInput,
  ): Promise<Result<readonly PluginRegistrationDecl[], SupervisorError>>;
  /** 지점의 핸들러를 등록 순서대로 준다. 열지 않았거나 없으면 빈 목록이다 */
  handlersFor(point: ReplayPoint): readonly CandidateHandler[];
  /** 핸들러를 순서대로 한 번에 하나씩 부른다. 한 번에 한 호출만 돈다 */
  run(call: CandidateCall): Promise<CandidateOutcome>;
  /** 프로세스를 끝낸다. 되풀이해 불러도 된다 */
  close(reason: HostDisposeParams["reason"]): void;
  /** 후보 프로세스 표준오류의 마지막 줄들(마스킹 뒤) */
  stderrTail(): readonly string[];
  /** 띄운 횟수에서 1을 뺀 값(시간 초과 뒤 다시 띄운 것과 유휴 뒤 다시 띄운 것을 모두 센다) */
  readonly restarts: number;
}

/** 지점의 합치기 방식. `first`는 첫 결정에서 멈춘다. `merged`는 모두 돌려 강한 결정이 이긴다. `chain`은 값을 이어 준다 */
type FoldRule =
  | { readonly kind: "first"; readonly schema: TSchema | undefined }
  | {
      readonly kind: "merged";
      readonly ranks: readonly DecisionKind[];
      readonly schema: TSchema | undefined;
    }
  | { readonly kind: "chain" };

function foldRuleOf(point: ReplayPoint): FoldRule {
  switch (point) {
    case "tool.call.before":
      return {
        kind: "merged",
        ranks: FIRST_RANK["tool.call.before"],
        schema: HOOKS["tool.call.before"].result,
      };
    case "guard.tool.before":
      return { kind: "first", schema: HOOKS["guard.tool.before"].result };
    case "tool.result":
      return { kind: "chain" };
    default:
      return assertNever(point, "ReplayPoint");
  }
}

// ── 돌려 보기 라우터(engine-calls.ts의 replay 분기와 같은 응답 모양) ─────────────
// 라우터 본문은 engine-calls.ts에 있고 replay 분기는 그 안의 `route`에 묻혀 있다. 그래서 같은 모양의 조각을 여기에 둔다.

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

/** primitives/effect-worker.ts의 `EFFECT_KEY_MAX`와 같은 값이다(후보 실행기는 primitives를 가져오지 않는다) */
const EFFECT_KEY_MAX = 48;

const RequestEffectSchema = Type.Object({
  capability: Type.String({ minLength: 1, maxLength: 96 }),
  method: Type.String({ minLength: 1, maxLength: 64 }),
  input: JsonValueSchema,
  key: Type.String({ minLength: 1, maxLength: EFFECT_KEY_MAX }),
});

const KIND_REGEX = new RegExp(RECORD_KIND_PATTERN);
const READ_KIND_REGEX = new RegExp(RECORD_KIND_READ_PATTERN);

/** 읽기 질의의 종류. 끝의 `.*`는 접두 일치다(engine-calls.ts의 `isQueryKind`와 같다) */
function isQueryKind(value: string): boolean {
  return value.endsWith(".*") ? READ_KIND_REGEX.test(value) : KIND_REGEX.test(value);
}

function describeParse(error: ParseError): string {
  return error.issues.map((issue) => `${issue.path || "/"} ${issue.message}`).join("; ");
}

function invalidParamsOf(error: ParseError): PluginHostError {
  return { kind: "invalid_params", message: describeParse(error) };
}

/**
 * 자식의 `engine.call` 하나를 돌려 보기 응답으로 답한다. 쓰기는 버리고, 읽기는 저장소가 없으므로 빈 목록이다.
 * `capability`는 거부이고 `denial`에 그 사실을 적는다(같은 호출의 결과가 `replay_denied`가 된다)
 */
function answerEngineCall(
  call: EngineCallParams,
  registered: ReadonlySet<string>,
  denial: () => void,
): Result<JsonValue, PluginHostError> {
  if (!registered.has(call.registration)) {
    return err({ kind: "unknown_target", message: `no registration ${call.registration}` });
  }
  switch (call.method) {
    case "commit":
      // 보낸 상태를 그대로 성공으로 돌려준다(자식이 스키마를 검사한다)
      return ok(call.params);
    case "commitWith": {
      const parsed = parse(CommitWithSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      return ok(parsed.value.next);
    }
    case "record": {
      const parsed = parse(RecordSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      return ok(null);
    }
    case "recordPrivate": {
      const parsed = parse(RecordPrivateSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      return ok(null);
    }
    case "readRecords": {
      const parsed = parse(ReadRecordsSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      if (!isQueryKind(parsed.value.kind)) {
        return err({ kind: "invalid_params", message: "the query kind is not a record kind" });
      }
      return ok([]);
    }
    case "post": {
      const parsed = parse(PostSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      return ok({ requestId: parsed.value.options.requestId, duplicate: false });
    }
    case "capability": {
      const parsed = parse(CapabilitySchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      denial();
      return err({
        kind: "replay_mode_denied",
        message: "a capability call cannot run in a replay",
      });
    }
    case "requestEffect": {
      const parsed = parse(RequestEffectSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      if (!isCapabilityId(parsed.value.capability)) {
        return err({ kind: "invalid_params", message: "the effect capability is malformed" });
      }
      return ok(null);
    }
    case "reportChanges": {
      const parsed = parse(ReportChangesSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      // 훅 호출에는 도구 실행의 변경 문맥이 없다. 실제 라우터도 훅 호출에서 같은 오류로 답한다
      return err({
        kind: "invalid_params",
        message: "reportChanges is only valid while a tool call runs",
      });
    }
    case "updateState": {
      const parsed = parse(UpdateStateSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      return ok({ kind: "committed", state: parsed.value.next });
    }
    case "startDrive": {
      const parsed = parse(StartDriveSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      return ok({ ok: true });
    }
    case "awaitUser": {
      const parsed = parse(AwaitUserSchema, call.params);
      if (!parsed.ok) return err(invalidParamsOf(parsed.error));
      return ok(null);
    }
    default:
      return assertNever(call.method, "PluginEngineCallName");
  }
}

/** 자식이 답한 실패를 결과 값으로 바꾼다. 시간 초과는 `timeout`, 자식의 핸들러 오류는 `threw`, 프로세스 쪽 실패는 `process_failed` */
function outcomeOfFailure(error: CallError, ms: number): CandidateOutcome {
  switch (error.kind) {
    case "process_killed":
      return { kind: "timeout", ms };
    case "invalid_response":
    case "handler_threw":
    case "unknown_target":
    case "unsupported_api":
    case "protocol_version":
    case "replay_mode_denied":
    case "engine_call_failed":
      return { kind: "threw", message: error.message, ms };
    // 엔진 쪽 형식 오류와 띄우기·종료 실패는 후보의 잘못이 아니다
    case "spawn_failed":
    case "sandbox_unavailable":
    case "init_failed":
    case "init_timeout":
    case "process_exit":
    case "restart_limit":
    case "declarations_changed":
    case "disposed":
    case "frame_too_large":
    case "invalid_params":
    case "cancelled":
      return { kind: "process_failed", reason: error.kind, message: error.message, ms };
    default:
      return assertNever(error, "CallError");
  }
}

export function createCandidateRunner(deps: CandidateRunnerDeps): CandidateRunner {
  let supervisor: PluginHostSupervisor | undefined;
  let opened = false;
  let closed = false;
  let registrations: readonly PluginRegistrationDecl[] = [];
  let registered: ReadonlySet<string> = new Set<string>();
  let settings: Readonly<Record<string, JsonValue>> = {};
  let spawns = 0;
  /** 지금 도는 호출. 자식의 기능 호출 거부가 여기에 적힌다. 호출은 한 번에 하나만 돈다 */
  let active: { denied: boolean } | undefined;

  function specOf(input: CandidateOpenInput): IsolationSpawnSpec {
    const launch = deps.launch({
      name: input.name,
      root: input.root,
      entry: input.entry,
      versionId: input.versionId,
    });
    return {
      command: launch.command,
      args: [...launch.args],
      readRoot: input.root,
      env: { ...launch.env },
      ...(launch.runtimeReadRoots === undefined
        ? {}
        : { runtimeReadRoots: [...launch.runtimeReadRoots] }),
      label: `ext:${input.name}:${input.versionId}`,
    };
  }

  function initParamsOf(input: CandidateOpenInput): HostInitParams {
    return {
      protocolVersion: PLUGIN_HOST_PROTOCOL_VERSION,
      extension: input.name,
      versionId: input.versionId,
      manifest: input.manifest,
      root: input.root,
      entry: input.entry,
      settings: { ...settings },
    };
  }

  async function open(
    input: CandidateOpenInput,
  ): Promise<Result<readonly PluginRegistrationDecl[], SupervisorError>> {
    if (supervisor !== undefined || closed) throw new Bug("candidate.open_again");
    settings = { ...input.settings };
    // 띄우기 횟수만 센다. 포트 호출은 그대로 넘긴다
    const counted: IsolationProcessPort = {
      spawn: (spec) => {
        spawns += 1;
        return deps.process.spawn(spec);
      },
    };
    const created = createPluginHostSupervisor({
      process: counted,
      specOf: () => specOf(input),
      setTimer: deps.setTimer,
      now: deps.now,
      logger: deps.logger,
      initParams: () => initParamsOf(input),
      initTimeoutMs: deps.initTimeoutMs,
      onEngineCall: (call) => Promise.resolve(answerEngineCall(call, registered, denied)),
      onRestartLimit: (info) => {
        deps.logger.warn("candidate.restart_limit", { deaths: info.deaths });
      },
      ...(deps.maskSecrets === undefined ? {} : { maskSecrets: deps.maskSecrets }),
    });
    supervisor = created;
    const started = await created.start();
    if (!started.ok) return err(started.error);
    registrations = started.value.registrations;
    registered = new Set(registrations.map((decl) => decl.id));
    opened = true;
    return ok(registrations);
  }

  function denied(): void {
    if (active !== undefined) active.denied = true;
  }

  function handlersFor(point: ReplayPoint): readonly CandidateHandler[] {
    const found: CandidateHandler[] = [];
    for (const decl of registrations) {
      for (const hook of decl.hooks) {
        if (hook.point !== point) continue;
        found.push({
          registration: decl.id,
          handlerIndex: hook.handlerIndex,
          hasState: decl.state !== null,
          initialState: structuredClone(decl.state === null ? null : decl.state.initial),
        });
      }
    }
    return found;
  }

  /** 핸들러 요청 하나. 돌려 보기 플래그를 싣고 자식의 답을 기다린다 */
  function invokeHandler(
    sup: PluginHostSupervisor,
    call: CandidateCall,
    handler: CandidateHandler,
    current: JsonValue,
  ): Promise<Result<JsonValue, CallError>> {
    const body: JsonValue = {
      threadId: call.threadId,
      deadlineMs: call.deadlineMs,
      replay: true,
      caller: call.caller,
      state: handler.initialState,
      settings: { ...settings },
      registration: handler.registration,
      point: call.point,
      handlerIndex: handler.handlerIndex,
      payload: call.payload,
      current,
    };
    return sup.call("hook.invoke", body, { deadlineMs: call.deadlineMs });
  }

  /** 핸들러를 등록 순서대로 한 번에 하나씩 돌리고, 지점의 합치기 규칙으로 결과를 정한다 */
  async function walk(
    sup: PluginHostSupervisor,
    call: CandidateCall,
    handlers: readonly CandidateHandler[],
    scope: { denied: boolean },
  ): Promise<CandidateOutcome> {
    const started = deps.now();
    const rule = foldRuleOf(call.point);
    // 지점마다 모으는 값. 핸들러 하나가 끝날 때마다 갱신한다
    const fold: {
      current: JsonValue;
      last: JsonValue;
      strongest: { readonly value: JsonValue; readonly rank: number } | undefined;
    } = { current: call.current, last: null, strongest: undefined };
    // 핸들러는 등록 순서대로 한 번에 하나씩 돈다(규칙 47). 결과가 정해지면 `{ value }`로 멈춘다
    const stopped = await eachAsync<CandidateHandler, CandidateOutcome>(
      handlers,
      async (handler) => {
        const reply = await invokeHandler(sup, call, handler, fold.current);
        const elapsed = deps.now() - started;
        if (scope.denied) return { value: { kind: "replay_denied", ms: elapsed } };
        if (!reply.ok) return { value: outcomeOfFailure(reply.error, elapsed) };
        const value = reply.value;
        if (value === null) return undefined;
        if (rule.kind === "chain") {
          fold.current = value;
          fold.last = value;
          return undefined;
        }
        // 결정 모양은 훅 선언의 스키마로 검사한다. 어긋나면 후보의 실패다(실제 디스패처가 첫 결정을 거부로 바꾸는 것과 같다)
        if (rule.schema === undefined || !parse(rule.schema, value).ok) {
          return {
            value: {
              kind: "threw",
              message: `the decision of ${call.point} does not match its schema`,
              ms: elapsed,
            },
          };
        }
        if (rule.kind === "first") return { value: { kind: "returned", value, ms: elapsed } };
        const kind = decisionKindOf(value);
        if (kind === null) throw new Bug("candidate.decision_kind");
        if (kind === "block") return { value: { kind: "returned", value, ms: elapsed } };
        const rank = rule.ranks.indexOf(kind);
        if (fold.strongest === undefined || rank < fold.strongest.rank) {
          fold.strongest = { value, rank };
        }
        return undefined;
      },
    );
    if (stopped !== undefined) return stopped.value;
    const total = deps.now() - started;
    if (rule.kind === "chain") return { kind: "returned", value: fold.last, ms: total };
    return { kind: "returned", value: fold.strongest?.value ?? null, ms: total };
  }

  async function run(call: CandidateCall): Promise<CandidateOutcome> {
    const sup = supervisor;
    if (sup === undefined || !opened) throw new Bug("candidate.run_before_open");
    if (active !== undefined) throw new Bug("candidate.run_overlap");
    const handlers = handlersFor(call.point);
    if (handlers.length === 0) throw new Bug("candidate.point_without_handler");
    const scope = { denied: false };
    active = scope;
    try {
      return await walk(sup, call, handlers, scope);
    } finally {
      active = undefined;
    }
  }

  function close(reason: HostDisposeParams["reason"]): void {
    closed = true;
    supervisor?.dispose(reason);
  }

  return {
    open,
    handlersFor,
    run,
    close,
    stderrTail: () => supervisor?.stderrTail() ?? [],
    get restarts(): number {
      return Math.max(0, spawns - 1);
    },
  };
}
