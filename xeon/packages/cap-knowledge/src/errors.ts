import { assertNever } from "@xeon/contracts";
import {
  CapabilityError,
  DEFAULT_RETRYABLE,
  type CapabilityId,
  type CommonErrorCode,
} from "@xeon/contracts/capabilities";
import type { JsonValue } from "@xeon/contracts/conversation";
import type { StoreReadError, StoreWriteError } from "@xeon/contracts/records";
import type { FsError } from "./fs/port.ts";

// L2.knowledge.spec §3.2·§3.3·§3.5 오류 코드와 §5 경계 사례. 안쪽 코드는 Result<T, KnowledgeFailure>로 실패를 돌려주고,
// 서비스 경계(`reject`)가 CapabilityError로 거부한다(F.capabilities.spec §3.6).

export type KnowledgeFailureKind =
  | CommonErrorCode
  | "base_stale"
  | "name_conflict"
  | "limit_exceeded"
  | "scan_blocked"
  | "approval_denied"
  | "read_only_scope"
  | "patch_mismatch"
  | "rollback_conflict"
  | "rollback_unsafe"
  | "proposal_closed"
  | "memory_full"
  | "drift_detected"
  | "duplicate_entry";

export interface KnowledgeFailure {
  readonly kind: KnowledgeFailureKind;
  readonly message: string;
  readonly detail?: JsonValue;
  /** 던져진 값이나 안쪽 오류. 서비스 경계 밖으로 내보내지 않고 기록에만 쓴다(TY-25) */
  readonly cause?: unknown;
}

export function failure(
  kind: KnowledgeFailureKind,
  message: string,
  extra: { readonly detail?: JsonValue; readonly cause?: unknown } = {},
): KnowledgeFailure {
  return {
    kind,
    message,
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
    ...(extra.cause === undefined ? {} : { cause: extra.cause }),
  };
}

function retryableOf(kind: KnowledgeFailureKind): boolean {
  switch (kind) {
    case "invalid_input":
    case "not_found":
    case "unsupported":
    case "unavailable":
    case "denied":
    case "rate_limited":
    case "timeout":
    case "upstream_error":
    case "aborted":
    case "internal":
      return DEFAULT_RETRYABLE[kind];
    case "rollback_unsafe":
      return true;
    case "base_stale":
    case "proposal_closed":
    case "memory_full":
    case "drift_detected":
    case "duplicate_entry":
    case "name_conflict":
    case "limit_exceeded":
    case "scan_blocked":
    case "approval_denied":
    case "read_only_scope":
    case "patch_mismatch":
    case "rollback_conflict":
      return false;
    default:
      return assertNever(kind, "KnowledgeFailureKind");
  }
}

/** 서비스 메서드가 실패를 거부(reject)할 때 던지는 CapabilityError를 만든다 */
export function toCapabilityError(
  capability: CapabilityId,
  method: string,
  error: KnowledgeFailure,
): CapabilityError {
  return new CapabilityError({
    capability,
    method,
    code: error.kind,
    message: error.message,
    retryable: retryableOf(error.kind),
    ...(error.detail === undefined ? {} : { detail: error.detail }),
  });
}

/** 파일 시스템 오류를 서비스 오류로 옮긴다. 메시지에는 경로와 OS 코드만 싣고 원본은 cause에 둔다 */
export function fromFsError(error: FsError, action: string): KnowledgeFailure {
  const where = `${action} ${error.path}`;
  switch (error.kind) {
    case "not_found":
      return failure("not_found", `${where}: not found`, { cause: error });
    case "permission_denied":
      return failure("denied", `${where}: permission denied`, { cause: error });
    case "disk_full":
      return failure("unavailable", `${where}: disk full`, { cause: error });
    case "not_directory":
    case "is_directory":
    case "exists":
    case "io":
      return failure("internal", `${where}: ${error.code || error.kind}`, { cause: error });
    default:
      return assertNever(error.kind, "FsErrorKind");
  }
}

/** 저장소 읽기·쓰기 실패를 서비스 오류로 옮긴다 */
export function fromStoreError(
  error: StoreReadError | StoreWriteError,
  action: string,
): KnowledgeFailure {
  switch (error.kind) {
    case "busy":
      return failure("unavailable", `${action}: store is busy`, { cause: error });
    case "disk_full":
      return failure("unavailable", `${action}: disk full`, { cause: error });
    case "io":
      return failure("internal", `${action}: store io ${error.code}`, { cause: error });
    default:
      return assertNever(error, "StoreError");
  }
}
