import type { SemVer } from "@fresnel/contracts/capabilities";
import type {
  ExtensionManifest,
  ExtensionName,
  ManifestIssue,
} from "@fresnel/contracts/extensions";
import type { CatalogIssue } from "@fresnel/contracts/settings";
import {
  Type,
  type TArray,
  type TInteger,
  type TLiteral,
  type TNull,
  type TObject,
  type TOptional,
  type TString,
  type TUnion,
} from "typebox";
import type { InstallSource, TrustLevel } from "./trust/levels.ts";

export type LoadState =
  | "discovered"
  | "validated"
  | "trusted"
  | "resolved"
  | "loading"
  | "active"
  | "rejected"
  | "disabled"
  | "error";

export type LoadStage =
  | "discover"
  | "manifest"
  | "set"
  | "trust"
  | "settings"
  | "ui"
  | "capabilities"
  | "admit"
  | "entry"
  | "usage"
  | "activate"
  | "isolation";

/**
 * Plugin UI 항목 검사(X.loading-trust.spec §4.3.4)가 남기는 진단 코드. 같은 이름이 `validateUi`(매니페스트 검사)에도 있지만
 * 거기서는 매니페스트를 거부하는 이슈(`manifest_invalid`의 `issues`)로 나간다. 이 타입은 파일과 정책을 본 결과만 담고,
 * 항목 하나만 `invalid`나 `disabled`로 만든다
 */
export type UiDiagnosticCode =
  | "ui_file_missing"
  | "ui_invalid"
  | "ui_limit"
  | "ui_path_invalid"
  | "ui_mode_not_allowed"
  | "widgets_unsupported"
  | "bridge_unsupported";

export type LoadDiagnosticCode =
  | "manifest_missing"
  | "manifest_parse"
  | "manifest_invalid"
  | "name_conflict"
  | "trust_exceeds_source"
  | "trust_denied"
  | "trust_undecided"
  | "trust_store_corrupt"
  | "settings_rejected"
  | "settings_reserved_key"
  | "config_required"
  | "capability_missing"
  | "capability_provider_failed"
  | "tier_rejected"
  | "entry_not_found"
  | "entry_import_failed"
  | "entry_not_function"
  | "entry_threw"
  | "setup_threw"
  | "setup_timeout"
  | "setup_action"
  | "reload_failed"
  | "reload_rejected"
  | "usage_invalid"
  | "usage_warning"
  | "plugin_not_registered"
  | "essential_failed"
  | "disabled_by_setting"
  | "safe_mode"
  | "disabled_flag"
  | "isolation_unavailable"
  | "isolation_point_unsupported"
  | "isolation_drive_unsupported"
  | "isolation_exited"
  | "isolation_restart_limit"
  | "isolation_protocol"
  | UiDiagnosticCode;

const IssueSchema: TObject<{
  severity: TString;
  code: TString;
  path: TString;
  message: TString;
}> = Type.Object({
  severity: Type.String(),
  code: Type.String(),
  path: Type.String(),
  message: Type.String(),
});

export const LoadDiagnosticSchema: TObject<{
  extension: TUnion<[TString, TNull]>;
  source: TUnion<
    [TLiteral<"builtin">, TLiteral<"managed">, TLiteral<"user">, TLiteral<"project">, TNull]
  >;
  stage: TString;
  severity: TUnion<[TLiteral<"error">, TLiteral<"warning">, TLiteral<"info">]>;
  code: TString;
  message: TString;
  path: TOptional<TString>;
  /** validate* 결과 원본 */
  issues: TOptional<TArray<typeof IssueSchema>>;
  generation: TInteger;
}> = Type.Object({
  extension: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([
    Type.Literal("builtin"),
    Type.Literal("managed"),
    Type.Literal("user"),
    Type.Literal("project"),
    Type.Null(),
  ]),
  stage: Type.String(),
  severity: Type.Union([Type.Literal("error"), Type.Literal("warning"), Type.Literal("info")]),
  code: Type.String(),
  message: Type.String({ maxLength: 2000 }),
  path: Type.Optional(Type.String()),
  issues: Type.Optional(Type.Array(IssueSchema)),
  generation: Type.Integer({ minimum: 0 }),
});

export interface LoadDiagnostic {
  readonly extension: ExtensionName | null;
  readonly source: InstallSource | null;
  readonly stage: LoadStage;
  readonly severity: "error" | "warning" | "info";
  readonly code: LoadDiagnosticCode;
  /** 사람이 읽는 문장. 시크릿 값과 파일 내용을 넣지 않는다 */
  readonly message: string;
  readonly path?: string;
  readonly issues?: readonly ManifestIssue[];
  readonly catalogIssues?: readonly CatalogIssue[];
  readonly generation: number;
}

export interface LoadedExtensionInfo {
  readonly name: ExtensionName;
  readonly version: SemVer;
  readonly source: InstallSource;
  readonly trust: TrustLevel;
  readonly state: LoadState;
  readonly isolation: "none" | "process";
  readonly essential: boolean;
  /** 로드 순서 index. 디스패치 순서의 두 번째 키. 로드되지 않았으면 null */
  readonly loadIndex: number | null;
  readonly generation: number;
  /** 읽은 매니페스트. 매니페스트를 읽거나 검증하지 못한 후보는 없다 */
  readonly manifest?: ExtensionManifest;
  /** 확장 루트 디렉터리(절대 경로). 내장 확장은 없다 */
  readonly root?: string;
  readonly diagnostics: readonly LoadDiagnostic[];
}
