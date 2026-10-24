import {
  Type,
  type Static,
  type TLiteral,
  type TNull,
  type TObject,
  type TOptional,
  type TRecord,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import { err, ok, parse, type Result } from "../../base/index.ts";
import { JsonRpcErrorSchema } from "./errors.ts";
import { classifyMethodName } from "./method-name.ts";

// F.wire-settings.spec §3.2, §3.6(`_meta`와 traceparent, F.wire-settings.plan W17).

export const WIRE_LIMITS: {
  readonly maxDepth: number;
  readonly maxArrayLength: number;
  /** 1 MiB. stdio·socket 프레임 하나 */
  readonly maxFrameBytes: number;
  readonly maxMethodNameLength: number;
} = {
  maxDepth: 64,
  maxArrayLength: 10_000,
  maxFrameBytes: 1_048_576,
  maxMethodNameLength: 96,
};

/** 요청 id. 문자열 1~64자 `[A-Za-z0-9._:-]`. 숫자와 null은 요청 id로 쓸 수 없다 */
export const RpcIdSchema: TString = Type.String({
  minLength: 1,
  maxLength: 64,
  pattern: "^[A-Za-z0-9._:-]+$",
});
export type RpcId = Static<typeof RpcIdSchema>;

const MethodNameString: TString = Type.String({
  minLength: 1,
  maxLength: WIRE_LIMITS.maxMethodNameLength,
});
/** params와 result는 항상 객체다 */
const ParamsSchema: TRecord<"^.*$", TUnknown> = Type.Record(Type.String(), Type.Unknown());

export const JsonRpcRequestSchema: TObject<{
  jsonrpc: TLiteral<"2.0">;
  id: typeof RpcIdSchema;
  method: typeof MethodNameString;
  params: typeof ParamsSchema;
}> = Type.Object(
  {
    jsonrpc: Type.Literal("2.0"),
    id: RpcIdSchema,
    method: MethodNameString,
    params: ParamsSchema,
  },
  { additionalProperties: false },
);
export type JsonRpcRequest = Static<typeof JsonRpcRequestSchema>;

export const JsonRpcNotificationSchema: TObject<{
  jsonrpc: TLiteral<"2.0">;
  method: typeof MethodNameString;
  params: typeof ParamsSchema;
}> = Type.Object(
  { jsonrpc: Type.Literal("2.0"), method: MethodNameString, params: ParamsSchema },
  { additionalProperties: false },
);
export type JsonRpcNotification = Static<typeof JsonRpcNotificationSchema>;

export const JsonRpcSuccessSchema: TObject<{
  jsonrpc: TLiteral<"2.0">;
  id: typeof RpcIdSchema;
  result: typeof ParamsSchema;
}> = Type.Object(
  { jsonrpc: Type.Literal("2.0"), id: RpcIdSchema, result: ParamsSchema },
  { additionalProperties: false },
);
export type JsonRpcSuccess = Static<typeof JsonRpcSuccessSchema>;

export const JsonRpcFailureSchema: TObject<{
  jsonrpc: TLiteral<"2.0">;
  /** null은 id를 읽을 수 없을 때만 */
  id: TUnion<[typeof RpcIdSchema, TNull]>;
  error: typeof JsonRpcErrorSchema;
}> = Type.Object(
  {
    jsonrpc: Type.Literal("2.0"),
    id: Type.Union([RpcIdSchema, Type.Null()]),
    error: JsonRpcErrorSchema,
  },
  { additionalProperties: false },
);
export type JsonRpcFailure = Static<typeof JsonRpcFailureSchema>;

export const JsonRpcMessageSchema: TUnion<
  [
    typeof JsonRpcRequestSchema,
    typeof JsonRpcNotificationSchema,
    typeof JsonRpcSuccessSchema,
    typeof JsonRpcFailureSchema,
  ]
> = Type.Union([
  JsonRpcRequestSchema,
  JsonRpcNotificationSchema,
  JsonRpcSuccessSchema,
  JsonRpcFailureSchema,
]);
export type JsonRpcMessage = Static<typeof JsonRpcMessageSchema>;

export type EnvelopeIssue =
  | { readonly code: "batch" }
  | { readonly code: "depth"; readonly depth: number }
  | { readonly code: "arrayLength"; readonly length: number }
  | { readonly code: "schema"; readonly path: string; readonly message: string }
  | { readonly code: "methodName"; readonly method: string };

export type EnvelopeCheck =
  | { readonly ok: true; readonly message: JsonRpcMessage }
  | { readonly ok: false; readonly errorCode: -32600 | -32602; readonly issue: EnvelopeIssue };

/** 한도 검사 결과. 깊이는 가장 바깥 객체를 1로 센다 */
type LimitViolation =
  | { readonly code: "depth"; readonly depth: number }
  | { readonly code: "arrayLength"; readonly length: number };

/** 반복으로 순회한다. 순환 참조는 깊이 한도에서 걸린다 */
function findLimitViolation(root: unknown): LimitViolation | undefined {
  const stack: { readonly value: unknown; readonly depth: number }[] = [{ value: root, depth: 1 }];
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { value, depth } = item;
    if (typeof value !== "object" || value === null) continue;
    if (depth > WIRE_LIMITS.maxDepth) return { code: "depth", depth };
    if (Array.isArray(value)) {
      if (value.length > WIRE_LIMITS.maxArrayLength) {
        return { code: "arrayLength", length: value.length };
      }
      for (const element of value) stack.push({ value: element, depth: depth + 1 });
    } else {
      for (const element of Object.values(value)) stack.push({ value: element, depth: depth + 1 });
    }
  }
  return undefined;
}

/**
 * 순수 함수. 배치, 깊이·배열 길이 한도, envelope 스키마, 메서드 이름을 차례로 검사한다.
 * 프레임 크기는 전송이 먼저 검사한다(F.wire-settings.spec §4.3 1단계).
 * 오류 코드는 params가 객체가 아닐 때만 -32602이고 나머지는 -32600이다.
 */
export function checkEnvelope(value: unknown): EnvelopeCheck {
  if (Array.isArray(value)) {
    return { ok: false, errorCode: -32600, issue: { code: "batch" } };
  }
  const violation = findLimitViolation(value);
  if (violation !== undefined) return { ok: false, errorCode: -32600, issue: violation };

  if (typeof value === "object" && value !== null && Array.isArray(Reflect.get(value, "params"))) {
    return {
      ok: false,
      errorCode: -32602,
      issue: { code: "schema", path: "/params", message: "params must be an object" },
    };
  }

  const parsed = parse(JsonRpcMessageSchema, value);
  if (!parsed.ok) {
    const first = parsed.error.issues[0];
    return {
      ok: false,
      errorCode: -32600,
      issue: {
        code: "schema",
        path: first?.path ?? "",
        message: first?.message ?? "invalid envelope",
      },
    };
  }
  const message = parsed.value;
  if ("method" in message && classifyMethodName(message.method) === undefined) {
    return { ok: false, errorCode: -32600, issue: { code: "methodName", method: message.method } };
  }
  return { ok: true, message };
}

// ── _meta와 추적 컨텍스트 (§3.6) ────────────────────────────────────────

/** W3C Trace Context traceparent. 버전 2자, trace-id 32자, parent-id 16자, 플래그 2자(소문자 hex) */
export const TRACEPARENT_PATTERN: string = "^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$";
/** W3C 세 키 밖에서 `_meta`가 받는 키. `<네임스페이스>/<이름>` 형태다. 예: xeon/clientTime */
export const WIRE_META_NAMESPACED_KEY_PATTERN: string = "^[a-z][a-z0-9-]*/[A-Za-z][A-Za-z0-9._-]*$";

/**
 * params 안의 예약 키 `_meta`의 값. 세 W3C 키(traceparent, tracestate, baggage)와 `<네임스페이스>/<이름>` 키만 받는다.
 * 네임스페이스 키의 값은 검사하지 않으며(Unknown) 정적 타입에도 나타나지 않는다.
 */
export const WireMetaSchema: TObject<{
  traceparent: TOptional<TString>;
  tracestate: TOptional<TString>;
  baggage: TOptional<TString>;
}> = Type.Object(
  {
    traceparent: Type.Optional(Type.String({ pattern: TRACEPARENT_PATTERN })),
    tracestate: Type.Optional(Type.String({ maxLength: 512 })),
    baggage: Type.Optional(Type.String({ maxLength: 8192 })),
  },
  {
    additionalProperties: false,
    patternProperties: { [WIRE_META_NAMESPACED_KEY_PATTERN]: Type.Unknown() },
  },
);
export type WireMeta = Static<typeof WireMetaSchema>;

/** traceparent 한 줄을 푼 값. 버전은 항상 00이다 */
export interface TraceContext {
  /** 소문자 hex 32자. 전부 0이 아니다 */
  readonly traceId: string;
  /** 소문자 hex 16자. 전부 0이 아니다 */
  readonly spanId: string;
  /** trace-flags 한 바이트(0~255). 0x01이 sampled다 */
  readonly flags: number;
}

export type TraceparentError =
  | { readonly kind: "malformed" }
  /** 버전 ff는 W3C가 금지한다 */
  | { readonly kind: "unsupported_version"; readonly version: string }
  /** trace-id나 parent-id가 전부 0이다 */
  | { readonly kind: "zero_id" };

const TRACEPARENT_REGEX = new RegExp(TRACEPARENT_PATTERN);
const ALL_ZERO = /^0+$/;

/** 순수 함수. traceparent 문자열을 푼다. 던지지 않는다 */
export function parseTraceparent(value: string): Result<TraceContext, TraceparentError> {
  if (!TRACEPARENT_REGEX.test(value)) return err({ kind: "malformed" });
  const [version = "", traceId = "", spanId = "", flags = ""] = value.split("-");
  if (version === "ff") return err({ kind: "unsupported_version", version });
  if (ALL_ZERO.test(traceId) || ALL_ZERO.test(spanId)) return err({ kind: "zero_id" });
  return ok({ traceId, spanId, flags: Number.parseInt(flags, 16) });
}

/** 순수 함수. 버전 00 traceparent 문자열을 만든다. 형식이 틀린 입력은 오류 값이다 */
export function formatTraceparent(context: TraceContext): Result<string, TraceparentError> {
  if (!Number.isInteger(context.flags) || context.flags < 0 || context.flags > 255) {
    return err({ kind: "malformed" });
  }
  const flags = context.flags.toString(16).padStart(2, "0");
  const text = `00-${context.traceId}-${context.spanId}-${flags}`;
  const parsed = parseTraceparent(text);
  return parsed.ok ? ok(text) : parsed;
}
