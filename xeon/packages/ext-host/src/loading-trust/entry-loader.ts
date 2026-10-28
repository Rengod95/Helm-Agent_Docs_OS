import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { attemptAsync, err, ok, type Result } from "@xeon/contracts";
import type {
  ExtensionEntry,
  ExtensionManifest,
  LoaderFs,
  ManifestIssue,
} from "@xeon/contracts/extensions";
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

/** 외부 확장 엔트리를 싣지 못한 이유. `code`는 로더 진단 코드와 같다(X.loading-trust.spec §4.4.3 표) */
export interface EntryLoadError {
  readonly code: "entry_not_found" | "entry_import_failed" | "entry_not_function";
  readonly message: string;
}

type UnknownCallable = (...args: readonly unknown[]) => unknown;

function isCallable(value: unknown): value is UnknownCallable {
  return typeof value === "function";
}

function hasKey<K extends string>(value: object, key: K): value is Record<K, unknown> {
  return key in value;
}

/** 모듈의 `default` 또는 named `extension` 중 함수인 쪽(X.loading-trust.spec §4.4.2). `default`가 먼저다 */
function exportedEntry(module: unknown): UnknownCallable | undefined {
  if (typeof module !== "object" || module === null) return undefined;
  for (const key of ["default", "extension"] as const) {
    if (hasKey(module, key)) {
      const value = module[key];
      if (isCallable(value)) return value;
    }
  }
  return undefined;
}

/**
 * 외부 확장의 엔트리를 import한다(X.loading-trust.spec §4.4.2). 매니페스트 `entry`(확장 루트 상대 경로)를
 * `realpath`로 풀어 확장 루트 안인지 다시 확인한 뒤 import한다. 함수 export가 없으면 `entry_not_function`이다.
 * SDK 가상 모듈(`registerSdkModules`)은 이 호출 전에 등록되어 있어야 번들이 호스트와 같은 인스턴스를 쓴다
 */
export async function importExternalEntry(
  fs: LoaderFs,
  root: string,
  manifest: ExtensionManifest,
): Promise<Result<ExtensionEntry, EntryLoadError>> {
  const declared = join(root, manifest.entry);
  const present = await attemptAsync(() => fs.exists(declared));
  if (!present.ok || !present.value) {
    return err({ code: "entry_not_found", message: `entry ${manifest.entry} does not exist` });
  }
  const resolved = await attemptAsync(() => fs.realpath(declared));
  if (!resolved.ok) {
    return err({ code: "entry_not_found", message: `entry ${manifest.entry} cannot be resolved` });
  }
  const real = resolved.value;
  if (!real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)) {
    return err({
      code: "entry_import_failed",
      message: `entry ${manifest.entry} resolves outside the extension root`,
    });
  }
  const imported = await attemptAsync(async () => {
    const loaded: unknown = await import(pathToFileURL(real).href);
    return loaded;
  });
  if (!imported.ok) {
    return err({
      code: "entry_import_failed",
      message: `entry ${manifest.entry} failed to import: ${messageOf(imported.error.cause)}`,
    });
  }
  const fn = exportedEntry(imported.value);
  if (fn === undefined) {
    return err({
      code: "entry_not_function",
      message: `entry ${manifest.entry} exports neither a default nor an "extension" function`,
    });
  }
  const entry: ExtensionEntry = async (host) => {
    // 외부 모듈의 함수는 호출 때까지 모양을 알 수 없다. 반환 값은 기다리기만 하고 쓰지 않는다
    await fn(host);
  };
  return ok(entry);
}

/** 외부 확장과 검증을 마친 매니페스트 → ExtHost.install이 받는 단위 */
export function unitOfExternal(
  entry: ExtensionEntry,
  manifest: ExtensionManifest,
  loadIndex: number,
  initialEnabled: boolean | undefined,
): ExtensionUnit {
  return {
    manifest,
    entry,
    loadIndex,
    builtin: false,
    ...(initialEnabled === undefined ? {} : { initialEnabled }),
  };
}
