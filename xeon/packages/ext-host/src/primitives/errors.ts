import type { ExtensionName, ManifestIssue, ScopeId } from "@xeon/contracts/extensions";

/** X.primitives.spec §3.10. ManifestIssue 코드와 겹치는 항목은 같은 문자열을 쓴다 */
export type PrimitiveErrorCode =
  | "port_unavailable"
  | "no_context"
  | "no_thread"
  | "post_undeclared"
  | "drive_requires_group"
  | "drive_undeclared"
  | "drive_duplicate"
  | "drive_outside_setup"
  | "lease_inactive"
  | "lease_revoked"
  | "lease_budget"
  | "scope_inactive"
  | "scope_foreign_id"
  | "scope_duplicate"
  | "scope_setup_failed"
  | "point_undeclared"
  | "state_undeclared"
  | "state_schema"
  | "state_conflict"
  | "state_too_large"
  | "state_migration_missing"
  | "storage_unavailable"
  | "record_kind_undeclared"
  | "record_invalid"
  | "read_kind_undeclared"
  | "record_private_invalid"
  | "capability_undeclared"
  | "capability_unavailable"
  | "capability_ambiguous"
  | "service_reserved"
  | "resource_conflict";

export interface PrimitiveErrorOptions {
  readonly scopeId?: ScopeId;
  readonly cause?: unknown;
}

/** 확장이 고칠 수 있는 오류. L1 결함(페이로드 위반, finalize 누락)은 Bug다 */
export class PrimitiveError extends Error {
  override readonly name: string = "PrimitiveError";
  readonly code: PrimitiveErrorCode;
  readonly scopeId: ScopeId | undefined;

  constructor(code: PrimitiveErrorCode, message: string, options?: PrimitiveErrorOptions) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.scopeId = options?.scopeId;
  }
}

/** 진단 출력. 확장 오류, 경고, 포트 부재(X.primitives.spec §3.2) */
export interface ExtDiagnostic {
  readonly level: "error" | "warning" | "info";
  readonly code:
    | PrimitiveErrorCode
    | ManifestIssue["code"]
    | "handler_failed"
    /** DriveOptions.limits가 x.primitives.driveLimits보다 커서 설정 값으로 줄였다(X.primitives.spec §4.4.2) */
    | "drive_limits_clamped"
    /** 시작 때 이미 열린 scope의 켜짐을 알리는 정보 진단 등 */
    | "scope_notice";
  readonly scopeId?: ScopeId;
  readonly extension?: ExtensionName;
  readonly message: string;
  readonly cause?: unknown;
}
