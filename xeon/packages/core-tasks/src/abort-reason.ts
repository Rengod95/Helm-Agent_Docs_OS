import type { AbortCode, AbortReason } from "@xeon/contracts/services";

const ABORT_CODES: readonly string[] = [
  "user",
  "parent",
  "lease_revoked",
  "budget",
  "lease_lost",
  "error",
] satisfies readonly AbortCode[];

/** 신호의 reason(unknown)이 AbortReason인지 좁힌다. 같은 객체를 그대로 돌려주려고 타입 술어로 둔다 */
export function isAbortReason(value: unknown): value is AbortReason {
  if (typeof value !== "object" || value === null) return false;
  const code: unknown = Reflect.get(value, "code");
  const message: unknown = Reflect.get(value, "message");
  return (
    typeof code === "string" &&
    ABORT_CODES.includes(code) &&
    (typeof message === "string" || message === null)
  );
}

/** 취소 사유를 알 수 없는 신호(트리 밖에서 켠 신호)에 쓰는 대체 값 */
export const UNKNOWN_ABORT_REASON: AbortReason = { code: "error", message: null };

/** 엔진 종료(close)가 보내는 사유. 의도는 쓰지 않는다 */
export const CLOSE_ABORT_REASON: AbortReason = { code: "error", message: "tasks.closed" };
