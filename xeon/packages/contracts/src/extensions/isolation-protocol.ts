import { Type, type TUnsafe } from "typebox";
import { err, ok, type Result } from "../base/index.ts";
import type { SchemaProof } from "../base/schema-proof.ts";
import {
  CapabilityErrorDataSchema,
  type CallerInfo,
  type CapabilityErrorData,
} from "../capabilities/index.ts";
import type { JsonValue } from "../conversation/index.ts";
import type { DriveFrameInfo, DriveLimits, DriveLockBudget } from "./drive.ts";
import type { RecordKind, RecordSubject } from "./group-record.ts";

// review.m5-drive-isolation §3.2 P1 프로토콜 한 표. 엔진과 플러그인 호스트 프로세스는 줄 단위 JSON으로 말한다.
// 줄 하나가 프레임 하나다. 요청은 `id`가 있고 응답은 같은 `id`를 가지며 알림은 `id`가 없다.
// 이 파일은 이름과 모양만 정한다. 전송, 수명, 실패 처리는 X(ext-host)가 맡는다.

/** 프로토콜 버전. 올리는 책임은 계약 동결 C0의 책임자다. `host.init`에서 서로 다르면 시작을 거부한다 */
export const PLUGIN_HOST_PROTOCOL_VERSION = 1 as const;

/**
 * 프레임 한 줄의 상한(바이트). 앱과 엔진 사이의 상한(1 MiB, wire)을 그대로 쓰지 않는다: 5 MB 입력의 왕복이 14 ms 안팎이라
 * 훅 입력(컨텍스트 조립의 메시지 목록)이 1 MiB를 넘는 일이 흔하기 때문이다. 넘으면 보내지 않고 `frame_too_large`로 실패한다.
 * 나눠 보내기와 참조 넘기기는 하지 않는다(3단계 이후의 일)
 */
export const PLUGIN_HOST_MAX_FRAME_BYTES: number = 16 * 1024 * 1024;

/** 플러그인 프로세스가 표준오류로 내는 글을 엔진이 남기는 상한. 줄 하나(글자), 모아 두는 줄 수 */
export const PLUGIN_HOST_STDERR_LINE_MAX: number = 2000;
export const PLUGIN_HOST_STDERR_LINES_MAX: number = 200;

/** 엔진 → 플러그인 요청 */
export const PLUGIN_HOST_REQUESTS = [
  "host.init",
  "hook.invoke",
  "tool.execute",
  "command.run",
  "method.call",
  "scope.dispose",
  "host.dispose",
  "state.migrate",
  "drive.step",
] as const;
export type PluginHostRequestName = (typeof PLUGIN_HOST_REQUESTS)[number];

/** 엔진 → 플러그인 알림 */
export const PLUGIN_HOST_NOTIFICATIONS_TO_HOST = ["event.notify", "request.cancel"] as const;
export type PluginHostNotificationName = (typeof PLUGIN_HOST_NOTIFICATIONS_TO_HOST)[number];

/** 플러그인 → 엔진 알림(응답 없음). `event.done`은 `event.notify` 처리를 마쳤다는 확인이다 */
export const PLUGIN_HOST_NOTIFICATIONS_TO_ENGINE = ["event.done"] as const;
export type PluginHostToEngineNotificationName =
  (typeof PLUGIN_HOST_NOTIFICATIONS_TO_ENGINE)[number];

export function isPluginHostToEngineNotification(
  value: string,
): value is PluginHostToEngineNotificationName {
  return PLUGIN_HOST_NOTIFICATIONS_TO_ENGINE.some((name) => name === value);
}

/** 플러그인 → 엔진 요청. 호출자 신원 `plugin:<이름>`은 엔진이 연결에서 붙인다(요청 필드에 없다) */
export const PLUGIN_ENGINE_CALLS = [
  "commit",
  "commitWith",
  "record",
  "recordPrivate",
  "readRecords",
  "post",
  "capability",
  "requestEffect",
  "startDrive",
  "reportChanges",
  "updateState",
  "awaitUser",
] as const;
export type PluginEngineCallName = (typeof PLUGIN_ENGINE_CALLS)[number];

/**
 * 응답을 기다리지 않는 알림으로 보내는 훅. 토큰마다 불리는 스트림 지켜보기다(`event.notify`).
 * 같은 대화 안에서 한 구독자에게 발화 순서대로 하나씩 전달한다. 결과가 없으므로 턴의 결과를 바꾸지 못한다
 */
export const PLUGIN_HOST_NOTIFY_HOOKS: readonly string[] = [
  "request.stream",
  "boundary.message.update",
  "tool.execution.update",
];

/**
 * `updateState` 호출이 값으로 돌려주는 상태 실패(`StateUpdateError`의 conflict를 뺀 것). 엔진이 저장소 상태를 쓰지 못한 이유다
 */
export const UPDATE_STATE_FAILURE_KINDS = [
  "state_schema",
  "state_too_large",
  "storage_unavailable",
  "lease_revoked",
] as const;
export type UpdateStateFailureKind = (typeof UPDATE_STATE_FAILURE_KINDS)[number];

/** 프로토콜이 쓰는 오류 이름. 응답의 `error.kind`다 */
export const PLUGIN_HOST_ERROR_KINDS = [
  "protocol_version",
  "handler_threw",
  "unknown_target",
  "unsupported_api",
  "frame_too_large",
  "invalid_params",
  "replay_mode_denied",
  "cancelled",
  "engine_call_failed",
] as const;
export type PluginHostErrorKind = (typeof PLUGIN_HOST_ERROR_KINDS)[number];

/** 훅 실패 이유에 더하는 새 문자열. 기록(`trace`)과 실패 장부에 저장된다 */
export const PLUGIN_PROCESS_FAILURE_REASONS = ["process_exit", "process_killed"] as const;
export type PluginProcessFailureReason = (typeof PLUGIN_PROCESS_FAILURE_REASONS)[number];

/**
 * `detail`의 상한(JSON 바이트). 엔진은 이보다 큰 detail을 빼고 보내고, 받는 쪽은 넘는 프레임을 `invalid_frame`으로 버린다.
 * JSON Schema는 바이트 크기를 셀 수 없어 `classifyFrame`이 본다
 */
export const PLUGIN_HOST_ERROR_DETAIL_MAX_BYTES: number = 8192;

/** `detail`이 상한 안인가. 타입이 JsonValue라 JSON으로 직렬화할 수 있다 */
export function isErrorDetailWithinLimit(detail: JsonValue): boolean {
  return (
    new TextEncoder().encode(JSON.stringify(detail)).byteLength <=
    PLUGIN_HOST_ERROR_DETAIL_MAX_BYTES
  );
}

/**
 * 엔진 호출 실패(`engine_call_failed`)가 원래 어떤 오류였는지. 자식은 이것으로 엔진 안과 같은 종류의 오류를 되던진다
 * (Helm의 실패 분류가 `CapabilityError`와 `PrimitiveError`의 종류와 코드를 본다). `capability`는 기능 오류의 데이터,
 * `primitive`는 확장 오류의 코드와 등록 id다. 다른 종류의 오류는 싣지 않는다
 */
export type PluginHostErrorOrigin =
  | { readonly kind: "capability"; readonly data: CapabilityErrorData }
  | { readonly kind: "primitive"; readonly code: string; readonly scopeId?: string };

export interface PluginHostError {
  readonly kind: PluginHostErrorKind;
  readonly message: string;
  /** 엔진 호출 실패에만 붙는다. 원래 오류가 기능 오류도 확장 오류도 아니면 없다 */
  readonly origin?: PluginHostErrorOrigin;
}

/** 줄 하나. 셋 중 하나의 모양이다 */
export type PluginHostFrame =
  | { readonly id: number; readonly method: string; readonly params: JsonValue }
  | { readonly id: number; readonly result: JsonValue }
  | { readonly id: number; readonly error: PluginHostError }
  | { readonly method: string; readonly params: JsonValue };

const ErrorOriginShape = Type.Union([
  Type.Object(
    { kind: Type.Literal("capability"), data: CapabilityErrorDataSchema },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("primitive"),
      code: Type.String({ pattern: "^[a-z][a-z0-9_]{0,63}$" }),
      scopeId: Type.Optional(Type.String({ minLength: 1, maxLength: 256 })),
    },
    { additionalProperties: false },
  ),
]);

const FrameShape = Type.Object(
  {
    id: Type.Optional(Type.Integer({ minimum: 0 })),
    method: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    params: Type.Optional(Type.Unknown()),
    result: Type.Optional(Type.Unknown()),
    error: Type.Optional(
      Type.Object(
        {
          kind: Type.String({ maxLength: 64 }),
          message: Type.String({ maxLength: 4000 }),
          origin: Type.Optional(ErrorOriginShape),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

/** 줄을 파싱한 뒤의 느슨한 프레임. 종류는 `classifyFrame`이 정한다 */
export interface RawPluginHostFrame {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: {
    readonly kind: string;
    readonly message: string;
    readonly origin?: PluginHostErrorOrigin;
  };
}
export const RawPluginHostFrameSchema: TUnsafe<RawPluginHostFrame> =
  Type.Unsafe<RawPluginHostFrame>(
    FrameShape satisfies SchemaProof<RawPluginHostFrame, typeof FrameShape>,
  );

export type ClassifiedFrame =
  | {
      readonly kind: "request";
      readonly id: number;
      readonly method: string;
      readonly params: unknown;
    }
  | { readonly kind: "notification"; readonly method: string; readonly params: unknown }
  | { readonly kind: "response"; readonly id: number; readonly result: unknown }
  | { readonly kind: "failure"; readonly id: number; readonly error: RawPluginHostFrame["error"] };

/** 프레임의 종류를 정한다. 어느 모양도 아니면 `invalid_frame`이다 */
export function classifyFrame(
  frame: RawPluginHostFrame,
): Result<ClassifiedFrame, { readonly kind: "invalid_frame" }> {
  const { id, method, params, result, error } = frame;
  if (method !== undefined) {
    if (id === undefined) return ok({ kind: "notification", method, params });
    return ok({ kind: "request", id, method, params });
  }
  if (id !== undefined && error !== undefined) {
    const detail = error.origin?.kind === "capability" ? error.origin.data.detail : undefined;
    if (detail !== undefined && !isErrorDetailWithinLimit(detail)) {
      return err({ kind: "invalid_frame" });
    }
    return ok({ kind: "failure", id, error });
  }
  if (id !== undefined && "result" in frame) return ok({ kind: "response", id, result });
  return err({ kind: "invalid_frame" });
}

// ── 요청의 모양 ───────────────────────────────────────────────────────────

/** 훅과 도구와 명령 호출에 실리는 공통 문맥 */
export interface PluginCallContext {
  /** 호출을 낳은 대화. 대화 밖 호출이면 null */
  readonly threadId: string | null;
  /** 시간 한도(ms). 넘기면 엔진이 취소 알림을 보내고 프로세스를 멈춘다 */
  readonly deadlineMs: number | null;
  /** 돌려 보기 요청. 참이면 엔진은 `commit`, `record`, `post`를 성공으로 받되 버리고 `capability`는 `replay_mode_denied`로 거부한다 */
  readonly replay: boolean;
  /** 호출한 쪽. 엔진이 정한다: `"engine"` 또는 `plugin:<이름>` */
  readonly caller: string;
  /** 요청 시점에 마지막으로 커밋된 그 scope의 상태 문서. 즉시 읽기(`g.state()`)가 이 값을 읽는다 */
  readonly state: JsonValue;
  /** 이 확장의 `ext.<이름>.*` 설정 유효 값(키는 매니페스트 `userConfig`). 즉시 읽기가 이 값을 읽는다 */
  readonly settings: Readonly<Record<string, JsonValue>>;
}

export interface HostInitParams {
  readonly protocolVersion: number;
  /** 확장 이름 */
  readonly extension: string;
  /** 검토본의 내용 해시 또는 초안 id. 프로세스 키의 한 부분이다 */
  readonly versionId: string;
  /** 매니페스트 문서 그대로(`host.manifest`) */
  readonly manifest: JsonValue;
  /** 확장 루트 절대 경로. 엔트리를 여기서 읽는다 */
  readonly root: string;
  readonly entry: string;
  readonly settings: Readonly<Record<string, JsonValue>>;
}

/** 플러그인이 등록한 것 하나의 선언. 엔진은 이 선언으로 대리 핸들러를 같은 등록 순서로 만든다 */
export interface PluginRegistrationDecl {
  readonly id: string;
  readonly defaultEnabled: boolean | null;
  /** 상태 선언. 스키마는 JSON Schema 문서다 */
  readonly state: {
    readonly schema: JsonValue;
    readonly initial: JsonValue;
    readonly version: number;
  } | null;
  /** 훅 핸들러. 같은 지점에 여럿이면 `handlerIndex`가 등록 순서다 */
  readonly hooks: readonly { readonly point: string; readonly handlerIndex: number }[];
  readonly tools: readonly PluginToolDecl[];
  readonly commands: readonly { readonly name: string; readonly description: string | null }[];
  readonly methods: readonly { readonly verb: string }[];
  readonly flags: readonly { readonly name: string; readonly def: JsonValue }[];
  readonly providers: readonly { readonly name: string; readonly config: JsonValue }[];
  readonly mcpServers: readonly { readonly name: string; readonly config: JsonValue }[];
  readonly renderers: readonly {
    readonly customType: string;
    readonly module: string;
    readonly export: string;
  }[];
  /** `onDispose`를 등록했는가 */
  readonly hasDisposers: boolean;
  /**
   * `migrateState`를 등록했는가. 참이면 엔진이 `state.migrate` 요청으로 저장된 문서의 이전을 호스트에 맡긴다.
   * 상태 선언이 없으면 거짓이다
   */
  readonly hasMigration: boolean;
  /**
   * `drive`를 등록했는가(drive-isolation.md 3.2). 있으면 `limits`는 setup 때 읽은 한도 옵션이다(없으면 null).
   * 엔진은 이 값으로 대리 `drive`를 등록하고 한도의 첫 값으로 쓴다. 없으면 null이다
   */
  readonly drive: { readonly limits: DriveLimits | null } | null;
}

/** 도구 선언. `execute`를 뺀 `ToolResourceDef`다. 모양은 JSON이다 */
export interface PluginToolDecl {
  readonly name: string;
  readonly def: JsonValue;
}

export interface HostInitResult {
  readonly protocolVersion: number;
  readonly registrations: readonly PluginRegistrationDecl[];
}

export interface HookInvokeParams extends PluginCallContext {
  readonly registration: string;
  readonly point: string;
  readonly handlerIndex: number;
  readonly payload: JsonValue;
  /** chain 훅의 현재 값. 다른 fold에서는 null */
  readonly current: JsonValue;
  /** 엔진 디스패치 키. 격리된 `g.subscribe`가 봉투의 `eventKey`로 쓴다. 없으면 호출 id를 쓴다 */
  readonly dispatchKey?: string;
}

export interface ToolExecuteParams extends PluginCallContext {
  readonly registration: string;
  readonly name: string;
  readonly args: JsonValue;
  readonly toolCallId: string | null;
  /** 엔진이 정한 호출자 정보(`CallerInfo` 문서). 도구 `execute`의 `ctx.caller`가 된다 */
  readonly callerInfo: CallerInfo;
}

export interface CommandRunParams extends PluginCallContext {
  readonly registration: string;
  readonly name: string;
  readonly args: string;
  readonly invocationId: string;
}

export interface MethodCallParams extends PluginCallContext {
  readonly registration: string;
  readonly verb: string;
  readonly params: JsonValue;
  readonly callId: string;
  readonly callerKind: "wire" | "ui";
}

/** 알림. 응답이 없다. `eventKey`로 멱등이어야 한다(적어도 한 번 전달) */
export interface EventNotifyParams extends PluginCallContext {
  readonly registration: string;
  readonly point: string;
  readonly handlerIndex: number;
  readonly eventKey: string;
  readonly payload: JsonValue;
  /** 엔진 디스패치 키. 격리된 `g.subscribe`가 봉투의 `eventKey`로 쓴다 */
  readonly dispatchKey?: string;
  /**
   * 엔진이 이 알림 앞에서 합친 수(덮인 전달). 합치기가 없었으면 생략한다. 격리된 `g.subscribe`가 봉투의 `dropped`에 더한다
   */
  readonly dropped?: number;
}

/**
 * 플러그인 → 엔진 알림 `event.done`. `event.notify` 처리가 끝났음(성공과 실패 모두)을 알린다. 엔진은 이 확인으로 키마다
 * 미확인 수를 줄인다(X.loading-trust와 drive-isolation.md 3.2의 이벤트 전달 규약)
 */
export interface EventDoneParams {
  readonly eventKey: string;
}

export interface RequestCancelParams {
  /** 취소할 엔진 → 플러그인 요청의 `id` */
  readonly id: number;
}

export interface ScopeDisposeParams {
  readonly registration: string;
}

export interface HostDisposeParams {
  readonly reason: "idle" | "shutdown" | "reload" | "disabled";
}

/**
 * 엔진 → 호스트 요청 `state.migrate`. 저장된 상태 문서를 현재 판의 모양으로 옮긴다. 응답의 `result`는 옮긴 문서(JSON)다.
 * 호스트가 `migrateState`로 등록한 함수를 부르고, 함수가 던지거나 JSON이 아닌 값을 내면 `handler_threw`다
 */
export interface StateMigrateParams {
  readonly registration: string;
  readonly doc: JsonValue;
  readonly fromVersion: number;
}

/**
 * 엔진 → 호스트 요청 `drive.step`(drive-isolation.md 1.1). 단계 함수를 한 번 부른다. 상태는 `PluginCallContext.state`다.
 * `last`는 직전 명령의 결과(`StepResult`)이고 첫 단계면 null이다. `budget`은 남은 예산(null은 상한 없음)이다.
 * 응답은 `DriveStepReply`다. 엔진은 그 명령을 실행하고 결과를 다음 단계의 `last`로 준다
 */
export interface DriveStepParams extends PluginCallContext {
  readonly registration: string;
  readonly last: JsonValue;
  readonly budget: DriveLockBudget;
  readonly frame: DriveFrameInfo;
}

/**
 * `drive.step`의 응답. `command`는 `DriveCommand` 모양의 JSON이다(엔진이 검사한다). `limits`는 응답을 만들 때 읽은 한도 옵션이고,
 * 엔진은 이것을 다음 임대를 받을 때의 한도로 쓴다(실행 중인 임대의 한도는 바뀌지 않는다). 없으면 null이다
 */
export interface DriveStepReply {
  readonly command: JsonValue;
  readonly limits: DriveLimits | null;
}

/**
 * `engine.call` `updateState`의 params. 함수는 호스트가 돌린다. 엔진은 줄 안에서 현재 상태가 `prev`와 같을 때만
 * `next`를 `records`와 함께 커밋한다. 응답은 `UpdateStateReply`다
 */
export interface UpdateStateParams {
  /** 호스트가 `fn`을 부른 문서 */
  readonly prev: JsonValue;
  /** `fn`이 낸 새 문서 */
  readonly next: JsonValue;
  /** `records` 함수가 `next`로 낸 그룹 레코드(`commitWith`와 같은 모양) */
  readonly records: readonly {
    readonly kind: RecordKind;
    readonly subject: RecordSubject;
    readonly payload: JsonValue;
  }[];
}

/**
 * `updateState`의 응답. `committed`는 커밋한 문서, `conflict`는 엔진이 가진 현재 문서(호스트가 한 번 더 시도한다),
 * `failed`는 저장할 수 없었던 이유다. 값이지 오류가 아니다
 */
export type UpdateStateReply =
  | { readonly kind: "committed"; readonly state: JsonValue }
  | { readonly kind: "conflict"; readonly current: JsonValue }
  | { readonly kind: "failed"; readonly failure: UpdateStateFailureKind };

/**
 * `engine.call` `awaitUser`의 params. `begin`은 호출을 낳은 요청의 시간 예산 시계를 멈추고, `end`는 다시 돌린다.
 * 요청이 `end` 없이 끝나면 엔진이 그 대기를 푼다. 응답은 null이다
 */
export interface AwaitUserParams {
  readonly phase: "begin" | "end";
}

/**
 * `engine.call` `startDrive`의 params. 호출을 낳은 엔진 요청의 thread에 이 등록을 주도 시작 요청으로 넣는다(`hostOf(g).startDrive`).
 * 입력이 없으면 null이다
 */
export interface StartDriveParams {
  readonly input: JsonValue | null;
}

/**
 * `startDrive`의 응답. 성공은 `{ ok: true }`다. 거부는 `ok: false`와 이유 `error.kind`다(`StartDriveError`의 kind, 또는 문맥이 없는
 * `no_context`). 값이지 오류가 아니다
 */
export type StartDriveReply =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: {
        readonly kind:
          | "unknown_thread"
          | "unknown_scope"
          | "child_thread"
          | "not_drive"
          | "drive_error"
          | "no_context";
      };
    };

/** 플러그인 → 엔진. `requestId`는 호출을 낳은 엔진 → 플러그인 요청의 `id`다(없으면 null) */
export interface EngineCallParams {
  readonly method: PluginEngineCallName;
  readonly registration: string;
  readonly requestId: number | null;
  readonly params: JsonValue;
}

/** 새 훅 실패 이유가 붙은 오류. 대리 핸들러가 던지면 실패 규칙이 그 이유로 장부에 쓴다 */
export interface PluginProcessFailure {
  readonly reason: PluginProcessFailureReason;
  readonly message: string;
}
