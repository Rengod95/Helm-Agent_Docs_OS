import type { ExtensionManifest, ManifestIssue } from "@xeon/contracts/extensions";
import type { ExtensionUnit, InstallResult } from "../primitives/host.ts";
import type { BuiltinExtensionModule } from "./discover.ts";
import type { LoadDiagnosticCode } from "./pipeline.ts";

/** setup이 던진 PrimitiveError 코드 가운데 선언 대조 위반인 것들과 같은 문자열의 ManifestIssue 코드(X.loading-trust.spec §4.4.3 표) */
const USAGE_ISSUE_CODES: Readonly<Record<string, ManifestIssue["code"]>> = {
  point_undeclared: "point_undeclared",
  post_undeclared: "post_undeclared",
  drive_undeclared: "drive_undeclared",
  drive_requires_group: "drive_requires_group",
  capability_undeclared: "capability_undeclared",
  record_kind_undeclared: "record_kind_undeclared",
  read_kind_undeclared: "read_kind_undeclared",
};

interface InstallDiagnostic {
  readonly severity: "error" | "warning";
  readonly code: LoadDiagnosticCode;
  readonly message: string;
  readonly issues?: readonly ManifestIssue[];
}

export interface InstallVerdict {
  /** 하나라도 error면 거짓. 거짓이면 로더가 uninstall과 forget을 부른다 */
  readonly ok: boolean;
  readonly diagnostics: readonly InstallDiagnostic[];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function issuesOf(code: ManifestIssue["code"], message: string): readonly ManifestIssue[] {
  return [{ severity: "error", code, path: "", message }];
}

/** InstallResult → 진단 코드 변환(X.loading-trust.spec §4.4.3 표). 순수 함수 */
export function verdictOfInstall(result: InstallResult): InstallVerdict {
  const diagnostics: InstallDiagnostic[] = [];
  if (result.entryError !== undefined) {
    diagnostics.push({
      severity: "error",
      code: "entry_threw",
      message: `entry of ${result.name} threw: ${messageOf(result.entryError)}`,
    });
    return { ok: false, diagnostics };
  }
  if (result.scopes.length === 0) {
    diagnostics.push({
      severity: "error",
      code: "usage_invalid",
      message: `${result.name} defined no scope`,
    });
    return { ok: false, diagnostics };
  }
  for (const setup of result.setups) {
    if (setup.status === "failed" && setup.failure !== undefined) {
      const { failure } = setup;
      const detail = messageOf(failure.error);
      if (failure.kind === "timeout") {
        diagnostics.push({
          severity: "error",
          code: "setup_timeout",
          message: `setup of ${setup.scopeId} exceeded its time budget`,
        });
      } else if (failure.code !== undefined && USAGE_ISSUE_CODES[failure.code] !== undefined) {
        const issueCode = USAGE_ISSUE_CODES[failure.code];
        const issues =
          setup.issues.length > 0 || issueCode === undefined
            ? setup.issues
            : issuesOf(issueCode, detail);
        diagnostics.push({
          severity: "error",
          code: "usage_invalid",
          message: `setup of ${setup.scopeId} broke its declaration: ${failure.code}`,
          issues,
        });
      } else if (failure.code === "no_thread") {
        diagnostics.push({
          severity: "error",
          code: "setup_action",
          message: `setup of ${setup.scopeId} used a thread operation: ${detail}`,
        });
      } else if (failure.code === "capability_unavailable") {
        diagnostics.push({
          severity: "error",
          code: "capability_missing",
          message: `setup of ${setup.scopeId} needs a capability that is not available`,
        });
      } else if (setup.issues.some((issue) => issue.severity === "error")) {
        diagnostics.push({
          severity: "error",
          code: "usage_invalid",
          message: `setup of ${setup.scopeId} does not match the manifest`,
          issues: setup.issues,
        });
      } else {
        diagnostics.push({
          severity: "error",
          code: "setup_threw",
          message: `setup of ${setup.scopeId} threw: ${detail}`,
        });
      }
      continue;
    }
    const warnings = setup.issues.filter((issue) => issue.severity === "warning");
    if (warnings.length > 0) {
      diagnostics.push({
        severity: "warning",
        code: "usage_warning",
        message: `setup of ${setup.scopeId} has ${warnings.length} usage warning(s)`,
        issues: warnings,
      });
    }
  }
  return { ok: !diagnostics.some((entry) => entry.severity === "error"), diagnostics };
}

/** 내장 모듈과 검증을 마친 매니페스트 → ExtHost.install이 받는 단위 */
export function unitOfBuiltin(
  module: BuiltinExtensionModule,
  manifest: ExtensionManifest,
  loadIndex: number,
  initialEnabled: boolean | undefined,
): ExtensionUnit {
  return {
    manifest,
    entry: module.extension,
    loadIndex,
    builtin: true,
    ...(initialEnabled === undefined ? {} : { initialEnabled }),
  };
}
