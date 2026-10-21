import { Type, type TUnsafe } from "typebox";
import type { JsonValue } from "../conversation/index.ts";
import { CapabilityIdSchema, type CapabilityId } from "./ids.ts";

export const COMMON_ERROR_CODES: readonly [
  "invalid_input",
  "not_found",
  "unsupported",
  "unavailable",
  "denied",
  "rate_limited",
  "timeout",
  "upstream_error",
  "aborted",
  "internal",
] = [
  "invalid_input",
  "not_found",
  "unsupported",
  "unavailable",
  "denied",
  "rate_limited",
  "timeout",
  "upstream_error",
  "aborted",
  "internal",
];
export type CommonErrorCode = (typeof COMMON_ERROR_CODES)[number];

export interface CapabilityErrorData {
  readonly capability: CapabilityId;
  readonly method: string;
  /** 공통 코드 또는 MethodDef.errors의 키 */
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  /** rate_limited 등에서 다시 시도해도 되는 최소 대기 시간 */
  readonly retryAfterMs?: number;
  /** 응답을 만든 provider 식별자. 정보용 */
  readonly provider?: string;
  readonly detail?: JsonValue;
}

/** 와이어(격리 프로세스, 도구 결과 details)로 오갈 때 쓰는 스키마 */
export const CapabilityErrorDataSchema: TUnsafe<CapabilityErrorData> =
  Type.Unsafe<CapabilityErrorData>(
    Type.Object(
      {
        capability: CapabilityIdSchema,
        method: Type.String({ minLength: 1, maxLength: 48 }),
        code: Type.String({ pattern: "^[a-z][a-z0-9_]{0,47}$" }),
        message: Type.String({ maxLength: 8192 }),
        retryable: Type.Boolean(),
        retryAfterMs: Type.Optional(Type.Integer({ minimum: 0 })),
        provider: Type.Optional(Type.String({ maxLength: 128 })),
        detail: Type.Optional(Type.Unknown()),
      },
      { additionalProperties: false },
    ),
  );

/** 서비스 메서드는 실패 시 이 오류로 거부(reject)한다. pi AgentTool.execute와 같은 예외 기반 규약이다. */
export class CapabilityError extends Error {
  override readonly name: string = "CapabilityError";
  readonly data: CapabilityErrorData;

  constructor(data: CapabilityErrorData) {
    super(data.message);
    this.data = data;
  }
}

export function isCapabilityError(value: unknown): value is CapabilityError {
  return value instanceof CapabilityError;
}

/** 공통 코드의 기본 retryable 값 */
export const DEFAULT_RETRYABLE: Readonly<Record<CommonErrorCode, boolean>> = {
  invalid_input: false,
  not_found: false,
  unsupported: false,
  unavailable: true,
  denied: false,
  rate_limited: true,
  timeout: true,
  upstream_error: true,
  aborted: false,
  internal: false,
};
