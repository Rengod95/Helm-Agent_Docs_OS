import type { SemVer } from "@xeon/contracts/capabilities";
import type { ExtensionName, ManifestIssue } from "@xeon/contracts/extensions";
import type { CatalogIssue } from "@xeon/contracts/settings";
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
  | "capabilities"
  | "admit"
  | "entry"
  | "usage"
  | "activate"
  | "isolation";

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
  | "usage_invalid"
  | "usage_warning"
  | "essential_failed"
  | "disabled_by_setting"
  | "safe_mode"
  | "disabled_flag"
  | "isolation_unavailable"
  | "isolation_point_unsupported"
  | "isolation_drive_unsupported"
  | "isolation_exited"
  | "isolation_restart_limit"
  | "isolation_protocol";

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
  /** 사람이 읽는 문장. 비밀 값과 파일 내용을 넣지 않는다 */
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
  readonly diagnostics: readonly LoadDiagnostic[];
}
