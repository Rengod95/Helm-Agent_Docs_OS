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

// F.wire-settings.spec §3.5. 오류 코드 구간 표(§3.5.3)와 구간 검사 함수는 M2다(F.wire-settings.plan W16).

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
  | "settings.unknownKey"
  | "settings.invalidValue"
  | "settings.scopeNotAllowed"
  | "settings.locked"
  | "settings.secretValue"
  | "request.cancelled"
  | "host.shuttingDown";

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
