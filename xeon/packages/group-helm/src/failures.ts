import {
  CapabilityError,
  COMMON_ERROR_CODES,
  type CapabilityId,
  type CommonErrorCode,
} from "@xeon/contracts/capabilities";

/** 탐구가 실패하는 예상 가능한 경우(L3.helm.spec §3.12). `Result`의 오류 쪽에 싣는다 */
export type HelmFailure =
  /** 임대 회수·중단 */
  | { readonly kind: "lease_lost" }
  /** 임대 상한 */
  | { readonly kind: "budget"; readonly limit: "turns" | "spawns" | "tokens" }
  /** 상태 커밋 판 충돌 */
  | { readonly kind: "state_conflict" }
  /** fitState 뒤에도 64 KiB 초과 */
  | { readonly kind: "state_too_large" }
  /** 저장소 실패 */
  | { readonly kind: "storage" }
  /** 그룹이 꺼짐 */
  | { readonly kind: "disabled" }
  /** 능력 호출 실패 */
  | {
      readonly kind: "capability";
      readonly capability: CapabilityId;
      readonly code: CommonErrorCode;
    }
  /** loop.turn 결과가 completed가 아님 */
  | {
      readonly kind: "turn";
      readonly phase: "diverge" | "apply";
      readonly status: "aborted" | "error";
    }
  /** loop.spawn 결과가 completed가 아니거나 거부됨 */
  | { readonly kind: "spawn"; readonly lensId: string; readonly status: "aborted" | "error" }
  /** 탐구 단계인데 필수 필드가 없음 */
  | { readonly kind: "state_inconsistent"; readonly detail: string };

export type HelmCommandError =
  | { readonly kind: "usage"; readonly message: string }
  | { readonly kind: "already_running"; readonly inquiryId: string | null }
  | { readonly kind: "no_topic" }
  | { readonly kind: "disabled" }
  | {
      readonly kind: "state_write";
      readonly failure: Extract<
        HelmFailure,
        { kind: "state_conflict" | "state_too_large" | "storage" }
      >;
    };

/** `failureOf`가 실패 지점에서 알아야 하는 것 */
export interface FailureSite {
  readonly capability?: CapabilityId;
  /** `lease_budget`이 어느 상한인지 호출 종류로 알린다. 생략하면 turns */
  readonly limit?: "turns" | "spawns" | "tokens";
}

function primitiveCodeOf(error: unknown): string | undefined {
  if (!(error instanceof Error) || error.name !== "PrimitiveError") return undefined;
  if (!("code" in error) || typeof error.code !== "string") return undefined;
  return error.code;
}

const LEASE_LOST_CODES: ReadonlySet<string> = new Set([
  "lease_inactive",
  "lease_revoked",
  "handler_aborted",
]);

function isCommonCode(code: string): code is CommonErrorCode {
  return COMMON_ERROR_CODES.some((known) => known === code);
}

/**
 * X의 PrimitiveError와 능력의 CapabilityError를 HelmFailure로 바꾼다. 둘 다 아니면 undefined(호출자가 다시 던진다).
 * ext-host를 import하지 않으므로 PrimitiveError는 이름과 code로 알아본다. 순수 함수
 */
export function failureOf(error: unknown, at: FailureSite): HelmFailure | undefined {
  if (error instanceof CapabilityError) {
    if (error.data.code === "aborted") return { kind: "lease_lost" };
    return {
      kind: "capability",
      capability: error.data.capability,
      code: isCommonCode(error.data.code) ? error.data.code : "internal",
    };
  }
  if (error instanceof Error && error.name === "AbortError") return { kind: "lease_lost" };
  const code = primitiveCodeOf(error);
  if (code === undefined) return undefined;
  if (LEASE_LOST_CODES.has(code)) return { kind: "lease_lost" };
  if (code === "lease_budget") return { kind: "budget", limit: at.limit ?? "turns" };
  if (code === "state_conflict") return { kind: "state_conflict" };
  if (code === "state_too_large") return { kind: "state_too_large" };
  if (code === "storage_unavailable") return { kind: "storage" };
  if (code === "scope_inactive") return { kind: "disabled" };
  if (code === "capability_unavailable" && at.capability !== undefined) {
    return { kind: "capability", capability: at.capability, code: "unavailable" };
  }
  return undefined;
}
