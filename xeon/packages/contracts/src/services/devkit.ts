import type { Result } from "../base/index.ts";
import type { CompositionDecl, ExtensionLayer, UiDecl } from "../extensions/index.ts";

// L3.authoring.spec §3.3. 제작에 필요한 특권 동작의 F 서비스 계약(X-22). 구현은 apps/host(L4)이고 그룹에는 DI로 준다.
// wire(W-27~W-29, W-32, W-49)는 이 서비스를 그대로 노출한다(`wire/devkit.ts`).

export const DevkitServiceName = "fresnel.devkit" as const;

export const KIND_LAYERS = ["L1", "L2", "L3", "plugin", "X"] as const;
export type KindLayer = (typeof KIND_LAYERS)[number];
export const KIND_STATUSES = ["stable", "preview", "blocked", "deprecated"] as const;
export type KindStatus = (typeof KIND_STATUSES)[number];

/**
 * 새로 만들 수 있는 확장의 종류. `single-plugin`은 플러그인 하나(층은 고른다), `plugin-group`은 `group` 선언이 있는
 * 플러그인 그룹이다(ADR-0022 §3.2, T-REG §8) [제안: 옛 plugin·group 종류를 대체한다]
 */
export const EXTENSION_KINDS = ["single-plugin", "plugin-group"] as const;
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

/** 종류 카탈로그 항목 하나(`catalog/kinds/<id>.json`) */
export interface KindEntry {
  readonly id: ExtensionKind;
  readonly title: string;
  /** 이 종류의 플러그인이 쓸 수 있는 층 */
  readonly layers: readonly KindLayer[];
  readonly status: KindStatus;
  readonly since: string;
  readonly requires: {
    readonly contracts: string;
    readonly bridge?: string;
    readonly widgets?: string;
  };
  readonly template?: string;
  /** 돌릴 검사 id(AU-NNN) */
  readonly checks: readonly string[];
  readonly decisions: readonly string[];
  readonly security: readonly string[];
  /** `status`가 blocked일 때 */
  readonly blockedReason?: string;
}

export interface ScaffoldInput {
  readonly kind: ExtensionKind;
  readonly name: string;
  readonly dir: string;
  /** `single-plugin`일 때 플러그인의 층. 생략하면 템플릿 기본값 [제안] */
  readonly layer?: ExtensionLayer;
  /** `plugin-group`일 때의 `group` 선언 초안 */
  readonly group?: { readonly members?: readonly string[]; readonly composition?: CompositionDecl };
  /** Plugin UI 초안 */
  readonly ui?: UiDecl;
}
export interface ScaffoldResult {
  readonly dir: string;
  /** 만든 파일(dir 기준 상대 경로) */
  readonly files: readonly string[];
}

/** 검사 결과 한 건. F `ManifestIssue`와 AU 규칙(`AU-NNN`)을 함께 싣는다 */
export interface DevkitIssue {
  readonly severity: "error" | "warning" | "info";
  readonly code: string;
  readonly path: string;
  readonly message: string;
  readonly file?: string;
  readonly line?: number;
}
export interface ValidationReport {
  /** 오류가 하나도 없으면 참 */
  readonly ok: boolean;
  readonly issues: readonly DevkitIssue[];
}

export interface TestRunInput {
  readonly target: string;
  readonly profileId?: string;
  readonly workspace?: string;
}
export interface TestRunHandle {
  readonly threadId: string;
}

export interface ReplayInput {
  readonly target: string;
  readonly maxCommits?: number;
}
export const REPLAY_FAILURES = [
  "effects-doubled",
  "effects-mismatch",
  "max-commits-exceeded",
  "no-commits",
] as const;
export type ReplayFailure = (typeof REPLAY_FAILURES)[number];
/** group-sdk `ReplayDriveReport`의 wire 모양 */
export interface ReplayReport {
  readonly ok: boolean;
  readonly commits: number;
  /** 절단마다 같았던 수 */
  readonly passed: number;
  readonly firstDiff: number | null;
  readonly effects: {
    readonly turn: number;
    readonly spawn: number;
    readonly delegate: number;
    readonly post: number;
  };
  readonly failure: ReplayFailure | null;
}

export interface PackInput {
  readonly dir: string;
  readonly out?: string;
}
export interface PackResult {
  readonly path: string;
  readonly files: readonly string[];
  /** 소문자 hex 64자 */
  readonly sha256: string;
}

export interface LinkInput {
  /** 묶음 또는 폴더 경로 */
  readonly source: string;
}
export interface LinkResult {
  readonly name: string;
  readonly version: string;
  readonly location: string;
}

export const DEVKIT_ERROR_KINDS = [
  "dev_mode_required",
  "invalid_input",
  "not_found",
  "exists",
  "blocked_kind",
  "denied",
  "io",
] as const;
export type DevkitErrorKind = (typeof DEVKIT_ERROR_KINDS)[number];
export interface DevkitError {
  readonly kind: DevkitErrorKind;
  readonly message: string;
}

export type DevkitResult<T> = Result<T, DevkitError>;

export interface DevkitService {
  kinds(): Promise<readonly KindEntry[]>;
  scaffold(input: ScaffoldInput): Promise<DevkitResult<ScaffoldResult>>;
  validate(dir: string): Promise<DevkitResult<ValidationReport>>;
  validateComposition(composition: CompositionDecl): ValidationReport;
  testRun(input: TestRunInput): Promise<DevkitResult<TestRunHandle>>;
  /** 개발 모드가 아니면 `err({ kind: "dev_mode_required" })` */
  replay(input: ReplayInput): Promise<DevkitResult<ReplayReport>>;
  pack(input: PackInput): Promise<DevkitResult<PackResult>>;
  /** 사용자 확장 위치에 연결한다(W-32). 사람 확인 뒤에만 부른다 */
  link(input: LinkInput): Promise<DevkitResult<LinkResult>>;
}
