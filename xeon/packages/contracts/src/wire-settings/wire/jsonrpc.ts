import {
  Type,
  type Static,
  type TLiteral,
  type TNull,
  type TObject,
  type TRecord,
  type TString,
  type TUnion,
  type TUnknown,
} from "typebox";
import { parse } from "../../base/index.ts";
import { JsonRpcErrorSchema } from "./errors.ts";
import { classifyMethodName } from "./method-name.ts";

// F.wire-settings.spec §3.2. `_meta`(WireMeta)와 traceparent 직렬화는 M2다(F.wire-settings.plan W17).

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
