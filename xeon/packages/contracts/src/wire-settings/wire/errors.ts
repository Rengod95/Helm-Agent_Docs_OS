import {
  Type,
  type Static,
  type TBoolean,
  type TInteger,
  type TObject,
  type TOptional,
  type TRecord,
  type TSchema,
  type TString,
  type TUnknown,
} from "typebox";

// F.wire-settings.spec §3.5. 오류 코드 구간 표(§3.5.3)와 codeRangeOf는 F.wire-settings.plan W16이다.

/** 열린 객체다. 새 필드를 더해도 옛 클라이언트가 깨지지 않게 하기 위해서다 */
export const WireErrorDataSchema: TObject<{
  kind: TString;
  retryable: TBoolean;
  retryAfterMs: TOptional<TInteger>;
  details: TOptional<TRecord<"^.*$", TUnknown>>;
  traceId: TOptional<TString>;
}> = Type.Object(
  {
    /** 오류 종류 이름. 예: "settings.locked" */
    kind: Type.String({ minLength: 1, maxLength: 96 }),
    retryable: Type.Boolean(),
    retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
    details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    traceId: Type.Optional(Type.String({ maxLength: 64 })),
  },
  { additionalProperties: true },
);
export type WireErrorData = Static<typeof WireErrorDataSchema>;

export const JsonRpcErrorSchema: TObject<{
  code: TInteger;
  message: TString;
  data: typeof WireErrorDataSchema;
}> = Type.Object(
  {
    code: Type.Integer(),
    /** 개발자용 영어 한 줄. 화면에 그대로 쓰지 않는다 */
    message: Type.String({ maxLength: 512 }),
    data: WireErrorDataSchema,
  },
  { additionalProperties: false },
);
export type JsonRpcError = Static<typeof JsonRpcErrorSchema>;

export interface WireErrorSpec {
  readonly code: number;
  readonly kind: string;
  readonly retryable: boolean;
  /** details 객체의 스키마. 없으면 details를 싣지 않는다 */
  readonly details?: TSchema;
}

const IssuesSchema: TSchema = Type.Array(
  Type.Object(
    { path: Type.String({ maxLength: 512 }), message: Type.String({ maxLength: 512 }) },
    { additionalProperties: false },
  ),
  { maxItems: 20 },
);

const KeyDetails: TSchema = Type.Object(
  { key: Type.String({ maxLength: 128 }) },
  { additionalProperties: false },
);
const IssueDetails: TSchema = Type.Object(
  { issue: Type.Unknown() },
  { additionalProperties: false },
);

export type WireErrorKind =
  | "jsonrpc.parseError"
  | "jsonrpc.invalidRequest"
  | "jsonrpc.methodNotFound"
  | "jsonrpc.invalidParams"
  | "internal"
  | "host.helloRequired"
  | "host.helloDuplicate"
  | "protocol.unsupported"
  | "host.authFailed"
  | "replay.outOfRange"
  | "events.subscriptionNotFound"
  | "events.subscriptionLimit"
  | "events.filterInvalid"
  | "thread.notFound"
  | "thread.locked"
  | "turn.busy"
  | "thread.hasForks"
  | "thread.invalidTarget"
  | "thread.cancelledByExtension"
  | "settings.unknownKey"
  | "settings.invalidValue"
  | "settings.scopeNotAllowed"
  | "settings.locked"
  | "settings.secretValue"
  | "request.cancelled"
  | "host.shuttingDown"
  | "store.busy"
  | "store.diskFull"
  | "store.readOnly"
  | "store.io";

/**
 * M1 오류 목록(F.wire-settings.spec §3.5.2): kind → 정의. 키와 kind가 같고 code와 kind는 1:1이다.
 * 확장 구간(10000~19999)은 `ext.<id>.` kind로 M2에서 연다.
 */
export const WIRE_ERRORS: {
  readonly [K in WireErrorKind]: WireErrorSpec & { readonly kind: K };
} = {
  "jsonrpc.parseError": { code: -32700, kind: "jsonrpc.parseError", retryable: false },
  "jsonrpc.invalidRequest": {
    code: -32600,
    kind: "jsonrpc.invalidRequest",
    retryable: false,
    details: IssueDetails,
  },
  "jsonrpc.methodNotFound": {
    code: -32601,
    kind: "jsonrpc.methodNotFound",
    retryable: false,
    details: Type.Object(
      { method: Type.String({ maxLength: 96 }) },
      { additionalProperties: false },
    ),
  },
  "jsonrpc.invalidParams": {
    code: -32602,
    kind: "jsonrpc.invalidParams",
    retryable: false,
    details: Type.Object({ issues: IssuesSchema }, { additionalProperties: false }),
  },
  internal: { code: -32603, kind: "internal", retryable: true },
  "host.helloRequired": { code: 1001, kind: "host.helloRequired", retryable: false },
  "host.helloDuplicate": { code: 1002, kind: "host.helloDuplicate", retryable: false },
  "protocol.unsupported": {
    code: 1003,
    kind: "protocol.unsupported",
    retryable: false,
    details: Type.Object(
      {
        serverVersion: Type.String({ maxLength: 128 }),
        clientVersion: Type.String({ maxLength: 128 }),
      },
      { additionalProperties: false },
    ),
  },
  /** M2: host.hello의 auth.token이 없거나 맞지 않다. 응답 뒤 연결을 닫는다 */
  "host.authFailed": { code: 1004, kind: "host.authFailed", retryable: false },
  "replay.outOfRange": {
    code: 2001,
    kind: "replay.outOfRange",
    retryable: false,
    details: Type.Object(
      {
        reason: Type.Union([
          Type.Literal("storeMismatch"),
          Type.Literal("aheadOfHead"),
          Type.Literal("beforeOldest"),
          Type.Literal("tooFar"),
        ]),
        storeId: Type.String({ maxLength: 64 }),
        headSeq: Type.Integer({ minimum: 0 }),
        oldestReplayableSeq: Type.Integer({ minimum: 0 }),
      },
      { additionalProperties: false },
    ),
  },
  "events.subscriptionNotFound": {
    code: 2002,
    kind: "events.subscriptionNotFound",
    retryable: false,
    details: Type.Object({ sub: Type.String({ maxLength: 16 }) }, { additionalProperties: false }),
  },
  "events.subscriptionLimit": {
    code: 2003,
    kind: "events.subscriptionLimit",
    retryable: false,
    details: Type.Object({ max: Type.Integer({ minimum: 1 }) }, { additionalProperties: false }),
  },
  "events.filterInvalid": {
    code: 2004,
    kind: "events.filterInvalid",
    retryable: false,
    details: IssueDetails,
  },
  "thread.notFound": {
    code: 3001,
    kind: "thread.notFound",
    retryable: false,
    details: Type.Object(
      { threadId: Type.String({ maxLength: 64 }) },
      { additionalProperties: false },
    ),
  },
  "thread.locked": {
    code: 3002,
    kind: "thread.locked",
    retryable: true,
    details: Type.Object(
      {
        ownerKind: Type.String({ maxLength: 32 }),
        options: Type.Array(
          Type.Union([Type.Literal("observe"), Type.Literal("fork"), Type.Literal("delegate")]),
          { maxItems: 3 },
        ),
      },
      { additionalProperties: false },
    ),
  },
  "turn.busy": {
    code: 3003,
    kind: "turn.busy",
    retryable: true,
    details: Type.Object(
      { turnId: Type.String({ maxLength: 64 }) },
      { additionalProperties: false },
    ),
  },
  /** thread.delete가 이 thread를 forkedFrom으로 가리키는 thread가 있어 거절했다(L1.persistence FR-P6) */
  "thread.hasForks": {
    code: 3004,
    kind: "thread.hasForks",
    retryable: false,
    details: Type.Object(
      { forks: Type.Array(Type.String({ maxLength: 64 }), { maxItems: 200 }) },
      { additionalProperties: false },
    ),
  },
  /** thread.fork·thread.revert의 대상이 맞지 않는다 */
  "thread.invalidTarget": {
    code: 3005,
    kind: "thread.invalidTarget",
    retryable: false,
    details: Type.Object(
      {
        reason: Type.Union([
          Type.Literal("item_not_found"),
          Type.Literal("not_on_branch"),
          Type.Literal("inside_turn"),
          Type.Literal("open_tool_calls"),
        ]),
      },
      { additionalProperties: false },
    ),
  },
  /** 확장이 thread 전환·분기·되감기를 막았다 */
  "thread.cancelledByExtension": {
    code: 3006,
    kind: "thread.cancelledByExtension",
    retryable: false,
    details: Type.Object(
      {
        point: Type.Union([
          Type.Literal("session_before_fork"),
          Type.Literal("session_before_tree"),
          Type.Literal("session_before_switch"),
        ]),
        reason: Type.Union([Type.String({ maxLength: 512 }), Type.Null()]),
      },
      { additionalProperties: false },
    ),
  },
  "settings.unknownKey": {
    code: 3101,
    kind: "settings.unknownKey",
    retryable: false,
    details: KeyDetails,
  },
  "settings.invalidValue": {
    code: 3102,
    kind: "settings.invalidValue",
    retryable: false,
    details: Type.Object(
      { key: Type.String({ maxLength: 128 }), issues: IssuesSchema },
      { additionalProperties: false },
    ),
  },
  "settings.scopeNotAllowed": {
    code: 3103,
    kind: "settings.scopeNotAllowed",
    retryable: false,
    details: Type.Object(
      {
        key: Type.String({ maxLength: 128 }),
        scope: Type.String({ maxLength: 16 }),
        allowedScopes: Type.Array(Type.String({ maxLength: 16 }), { maxItems: 5 }),
        /** 열린 프로젝트 없이 project·local에 쓸 때 "workspaceRequired" [제안, L4.readme §8 G] */
        reason: Type.Optional(Type.String({ maxLength: 64 })),
      },
      { additionalProperties: false },
    ),
  },
  "settings.locked": {
    code: 3104,
    kind: "settings.locked",
    retryable: false,
    details: Type.Object(
      { key: Type.String({ maxLength: 128 }), lockedBy: Type.Literal("managed") },
      { additionalProperties: false },
    ),
  },
  /** 오류 details에 값을 싣지 않는다 */
  "settings.secretValue": {
    code: 3105,
    kind: "settings.secretValue",
    retryable: false,
    details: KeyDetails,
  },
  "request.cancelled": { code: 5001, kind: "request.cancelled", retryable: false },
  "host.shuttingDown": {
    code: 5002,
    kind: "host.shuttingDown",
    retryable: true,
    details: Type.Object(
      { retryAfterMs: Type.Integer({ minimum: 0 }) },
      { additionalProperties: false },
    ),
  },
  /** 저장소 쓰기 잠금 대기가 시간을 넘었다. 같은 요청을 다시 보내도 된다 */
  "store.busy": { code: 5003, kind: "store.busy", retryable: true },
  /** 저장 매체가 가득 찼다. 공간을 비운 뒤 다시 보내야 한다 */
  "store.diskFull": { code: 5004, kind: "store.diskFull", retryable: false },
  /** 저장소가 읽기 전용으로 열려 있어 쓸 수 없다 */
  "store.readOnly": {
    code: 5005,
    kind: "store.readOnly",
    retryable: false,
    details: Type.Object(
      { reason: Type.String({ maxLength: 64 }) },
      { additionalProperties: false },
    ),
  },
  /** 저장 매체 I/O 실패. 코드는 OS나 SQLite가 준 값이다 */
  "store.io": {
    code: 5006,
    kind: "store.io",
    retryable: false,
    details: Type.Object({ code: Type.String({ maxLength: 64 }) }, { additionalProperties: false }),
  },
};

/** 처리기가 던지는 오류. 디스패처가 JsonRpcError로 바꿔 응답한다(§4.3 6단계) */
export class WireError extends Error {
  override readonly name: string = "WireError";
  readonly code: number;
  readonly data: WireErrorData;

  constructor(code: number, message: string, data: WireErrorData) {
    super(message);
    this.code = code;
    this.data = data;
  }
}

export interface WireErrorOptions {
  /** 개발자용 영어 한 줄. 생략하면 kind를 쓴다 */
  readonly message?: string;
  readonly retryAfterMs?: number;
  readonly traceId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

/** 표에 있는 kind로 WireError를 만든다. details 스키마 검사는 호출자 몫이다 */
export function wireError(kind: WireErrorKind, options: WireErrorOptions = {}): WireError {
  const spec: WireErrorSpec = WIRE_ERRORS[kind];
  const data: WireErrorData = {
    kind: spec.kind,
    retryable: spec.retryable,
    ...(options.retryAfterMs !== undefined ? { retryAfterMs: options.retryAfterMs } : {}),
    ...(options.details !== undefined ? { details: options.details } : {}),
    ...(options.traceId !== undefined ? { traceId: options.traceId } : {}),
  };
  return new WireError(spec.code, options.message ?? spec.kind, data);
}

export function toJsonRpcError(error: WireError): JsonRpcError {
  return { code: error.code, message: error.message.slice(0, 512), data: error.data };
}

/**
 * 알 수 없는 예외를 -32603 internal로 바꾼다. 원인은 응답에 싣지 않고(로그에만 남긴다)
 * traceId로 연결한다(F.wire-settings.spec §3.5.1).
 */
export function internalJsonRpcError(traceId?: string): JsonRpcError {
  const spec = WIRE_ERRORS.internal;
  return {
    code: spec.code,
    message: "Internal error",
    data: {
      kind: spec.kind,
      retryable: spec.retryable,
      ...(traceId !== undefined ? { traceId } : {}),
    },
  };
}

/** 처리기가 던진 값을 응답 오류로 바꾼다. WireError는 그대로, 그 밖의 예외는 정제한다(§4.3 6단계) */
export function toRpcError(cause: unknown, traceId?: string): JsonRpcError {
  if (cause instanceof WireError) return toJsonRpcError(cause);
  return internalJsonRpcError(traceId);
}

// ── 오류 코드 구간 (§3.5.3) ───────────────────────────────────────────────

export type WireCodeRangeName =
  | "jsonrpc"
  | "wire.connection"
  | "wire.events"
  | "core"
  | "capability"
  | "host"
  | "extension";

export interface WireCodeRange {
  readonly name: WireCodeRangeName;
  /** 구간의 처음과 끝 코드(둘 다 포함) */
  readonly from: number;
  readonly to: number;
  /** 소유: 이 구간의 코드를 정의하는 층 */
  readonly owner: "JSON-RPC" | "F" | "L1" | "L2" | "L4" | "extension";
  readonly purpose: string;
  /** 이 구간의 오류 `kind`가 시작해야 하는 접두. 없으면 제한이 없다 */
  readonly kindPrefix?: string;
}

/** 능력(L2) 오류는 코드 4000 하나로 싣는다. kind는 `cap.<CapabilityId>.<code>`, details는 CapabilityErrorData다 */
export const WIRE_CAPABILITY_ERROR_CODE: number = 4000;

export const WIRE_CODE_RANGES: readonly WireCodeRange[] = [
  { name: "jsonrpc", from: -32768, to: -32000, owner: "JSON-RPC", purpose: "표준 다섯 개만 쓴다" },
  { name: "wire.connection", from: 1000, to: 1999, owner: "F", purpose: "연결, 핸드셰이크, 버전" },
  { name: "wire.events", from: 2000, to: 2999, owner: "F", purpose: "이벤트, 구독, 재전송" },
  {
    name: "core",
    from: 3000,
    to: 3999,
    owner: "L1",
    purpose: "thread, turn, approval(3000~3099), settings(3100~3199), 나머지 L1 예비",
  },
  {
    name: "capability",
    from: 4000,
    to: 4999,
    owner: "L2",
    purpose: "능력 오류는 4000 하나. 4001~4999는 예비",
    kindPrefix: "cap.",
  },
  { name: "host", from: 5000, to: 5999, owner: "L4", purpose: "호스트 상태, 취소, 서비스 모드" },
  {
    name: "extension",
    from: 10000,
    to: 19999,
    owner: "extension",
    purpose: "확장이 자유롭게 쓴다. 코드가 겹치면 kind로 구분한다",
    kindPrefix: "ext.",
  },
];

/** 순수 함수. 코드가 속한 구간. 어느 구간에도 속하지 않으면(0~999, 6000~9999, 20000 이상, 정수가 아님) null */
export function codeRangeOf(code: number): WireCodeRange | null {
  if (!Number.isInteger(code)) return null;
  return WIRE_CODE_RANGES.find((range) => code >= range.from && code <= range.to) ?? null;
}

/**
 * 순수 함수. 코드와 kind가 구간 규칙에 맞는지. 구간 밖 코드이거나 구간이 kind 접두를 요구하는데 어긋나면 false다.
 * 클라이언트는 분기 판단에 code보다 kind를 쓴다(확장 구간은 코드가 겹칠 수 있다).
 */
export function wireErrorCodeMatchesKind(code: number, kind: string): boolean {
  const range = codeRangeOf(code);
  if (range === null) return false;
  return range.kindPrefix === undefined || kind.startsWith(range.kindPrefix);
}
