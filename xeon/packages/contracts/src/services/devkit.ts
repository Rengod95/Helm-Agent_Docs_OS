import type { Result } from "../base/index.ts";
import type { ContextRef, JsonValue } from "../conversation/index.ts";
import type {
  BridgeCapability,
  CompositionDecl,
  DependencyKind,
  ExtensionLayer,
  PluginSubmitRequest,
  PluginSubmitResult,
  UiDecl,
} from "../extensions/index.ts";

// L3.authoring.spec §3.3. 제작에 필요한 특권 동작의 F 서비스 계약(X-22). 구현은 apps/host(L4)이고 그룹에는 DI로 준다.
// wire(W-27~W-29, W-32, W-49)는 이 서비스를 그대로 노출한다(`wire/devkit.ts`).

export const DevkitServiceName = "fresnel.devkit" as const;

/** 종류 카탈로그의 버전(L3.authoring.spec §3.4). 제작 코어가 카탈로그를 내고, 대화하는 빌더는 이 값을 도구 결과에 싣는다 */
export const KIND_CATALOG_VERSION = "0.1.0";

export const KIND_LAYERS = ["L1", "L2", "L3", "plugin", "X"] as const;
export type KindLayer = (typeof KIND_LAYERS)[number];
export const KIND_STATUSES = ["stable", "preview", "blocked", "deprecated"] as const;
export type KindStatus = (typeof KIND_STATUSES)[number];

/**
 * 새로 만들 수 있는 확장의 종류. 종류는 플러그인 하나뿐이고 층은 고른다. 그룹은 `group` 선언이 있는 플러그인이라 종류가 아니다
 * (ADR-0022 §3.2, T-REG §8, review/m5/profile-project-loader.md §4.9.5)
 */
export const EXTENSION_KINDS = ["single-plugin"] as const;
export type ExtensionKind = (typeof EXTENSION_KINDS)[number];

/**
 * 플러그인의 방식(M5c §4.9.4, 카드의 세 칸 Inject·Hook·Drive). 빌더는 셋 가운데 하나로 뼈대를 만든다.
 * `hook`은 훅 하나에 붙는 코드, `inject`는 지침 파일(`components.instructions`), `drive`는 구동 단계 함수(`drives: true`, 그룹 구성원)다
 */
export const PLUGIN_MODES = ["hook", "inject", "drive"] as const;
export type PluginMode = (typeof PLUGIN_MODES)[number];

/**
 * 뿌리 뼈대(`authoring_scaffold`)의 방식. 구성원 방식 셋에 화면 뼈대 둘이 더해진다: `app`(자체 HTML/JS 화면과 메서드)과
 * `native`(선언형 화면 트리 하나와 읽기 메서드 하나, 코드 없는 화면)
 */
export const SCAFFOLD_MODES = ["hook", "inject", "drive", "app", "native"] as const;
export type ScaffoldMode = (typeof SCAFFOLD_MODES)[number];

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
  /** 플러그인의 방식. 생략하면 `hook`(기존 골격)이다 [제안: M5c §4.9.4] */
  readonly mode?: ScaffoldMode;
  /** `single-plugin`일 때 플러그인의 층. 생략하면 템플릿 기본값 [제안] */
  readonly layer?: ExtensionLayer;
  /** `group` 선언 초안. 있으면 매니페스트에 `group`이 붙는다 */
  readonly orchestration?: {
    readonly members?: readonly string[];
    readonly composition?: CompositionDecl;
  };
  /** Plugin UI 초안 */
  readonly ui?: UiDecl;
  /** 목적 한 문장. 매니페스트 `purpose`에 쓴다. 생략하면 빈 칸으로 두고 검사(AU-013)가 채우라고 말한다 [결정: 2026-11-23 사용자, AGE-31] */
  readonly purpose?: string;
  /** 하는 일의 설명. 매니페스트 `description`에 쓴다. 생략하면 빈 칸으로 두고 검사(AU-013)가 채우라고 말한다 */
  readonly description?: string;
}
export interface ScaffoldResult {
  readonly dir: string;
  /** 만든 파일(dir 기준 상대 경로) */
  readonly files: readonly string[];
}

/**
 * 구성원 편집 한 건(`editMembers`, L3.authoring.spec §3.3). 뿌리 플러그인은 구성원이 아니라 바꾸지 않는다.
 * 여러 건은 위에서 아래로 차례로 적용하고, 하나라도 실패하면 아무 파일도 쓰지 않는다
 */
export type MemberOp =
  | {
      readonly kind: "add";
      readonly id: string;
      /** 생략하면 뿌리 플러그인의 층(뿌리가 `plugin`이면 `plugin`) */
      readonly layer?: ExtensionLayer;
      readonly title?: string;
      /** 생략하면 `hook`. `inject`는 지침 선언만, `drive`는 층 L3에서만 */
      readonly mode?: PluginMode;
    }
  | { readonly kind: "rename"; readonly id: string; readonly to: string }
  /** 보이는 이름(매니페스트 `title`)만 바꾼다. id와 파일은 그대로다. 빈 문자열이면 제목을 지운다. 64자 이하 */
  | { readonly kind: "retitle"; readonly id: string; readonly title: string }
  | { readonly kind: "remove"; readonly id: string }
  /** 구성원끼리의 순서를 바꾼다(0부터, 구성원 목록 기준). 이 순서가 `plugins[]` 순서이고 등록·훅 순서가 된다 */
  | { readonly kind: "move"; readonly id: string; readonly toIndex: number };

/** 구성원의 지침 또는 스킬 한 항목. `id`는 `components`에 적힌 경로의 이름이다 */
export interface MemberInject {
  readonly id: string;
  readonly kind: "instruction" | "skill";
}

/** 구성원 하나(뿌리 제외)의 요약. `members`는 매니페스트 `plugins[]` 순서다 */
export interface MemberInfo {
  readonly id: string;
  readonly registrationId: string;
  readonly title: string | null;
  readonly layer: ExtensionLayer;
  readonly hooks: readonly string[];
  readonly drives: boolean;
  readonly defaultEnabled: boolean;
  /** `orchestration.composition.blocks` 가운데 `plugin`이 이 구성원인 블록 id */
  readonly blockIds: readonly string[];
  /**
   * 이 구성원에 귀속되는 지침과 스킬. 지금 매니페스트는 `components`를 최상위에만 적으므로(구성원별 자리가 없다)
   * 귀속할 근거가 없어 항상 빈 배열이다. 구성원별 선언이 생기면 그때 채운다
   */
  readonly injects: readonly MemberInject[];
  /**
   * 이 구성원에 귀속되는 도구 이름. 매니페스트 `tools`도 최상위에만 적혀 있어서 지금은 항상 빈 배열이다(`injects`와 같은 이유)
   */
  readonly tools: readonly string[];
}

export interface MembersEditInput {
  /** 플러그인 원본 폴더의 절대 경로(`.fresnel-plugin/plugin.json`이 있어야 한다) */
  readonly dir: string;
  readonly ops: readonly MemberOp[];
}

export interface MembersEditResult {
  readonly members: readonly MemberInfo[];
  /** 검사 경고와 알림. 오류가 있었으면 편집이 거절되어 여기 오지 않는다 */
  readonly issues: readonly DevkitIssue[];
  /** 쓰거나 옮긴 파일(dir 기준 상대 경로). 옮긴 파일은 새 경로로 적는다 */
  readonly changedFiles: readonly string[];
  /** `generated`: 엔트리가 생성 파일을 가져온다. `manual`: 호출자가 엔트리 배선을 직접 확인해야 한다 */
  readonly entryWiring: "generated" | "manual";
}

/**
 * 의존 편집 한 건(`editDependencies`, AGE-33). 매니페스트 `plugins[].dependsOn`의 한 줄을 더하거나 뺀다.
 * `from`은 의존을 거는 구성원의 id이고, 생략하면 뿌리 플러그인이다. 여러 건은 위에서 아래로 차례로 적용하고, 하나라도 실패하면 아무 파일도 쓰지 않는다
 */
export type DependencyOp =
  | {
      readonly kind: "add";
      readonly from?: string;
      /** 같은 `plugin`의 줄이 이미 있으면 그 줄을 이 값으로 바꾼다. `kind`를 생략하면 soft다 */
      readonly dependency: {
        readonly plugin: string;
        readonly range?: string;
        readonly kind?: DependencyKind;
      };
    }
  | { readonly kind: "remove"; readonly from?: string; readonly plugin: string };

/** 의존 한 줄의 요약. `from`은 의존을 건 Registration id, `target`은 가리키는 Registration id다 */
export interface DependencyInfo {
  readonly from: string;
  readonly target: string;
  readonly kind: DependencyKind;
  /** 생략하면 어느 버전이든 된다 */
  readonly range: string | null;
}

export interface DependenciesEditInput {
  /** 플러그인 원본 폴더의 절대 경로(`.fresnel-plugin/plugin.json`이 있어야 한다) */
  readonly dir: string;
  /** 1~32건을 받는다. 빈 배열이면 쓰지 않는 읽기다 */
  readonly ops: readonly DependencyOp[];
}

export interface DependenciesEditResult {
  /** 확장 전체의 의존 줄(플러그인 등록 순서) */
  readonly dependencies: readonly DependencyInfo[];
  /** 검사 경고와 알림. 오류가 있었으면 편집이 거절되어 여기 오지 않는다 */
  readonly issues: readonly DevkitIssue[];
  /** 쓴 파일(dir 기준 상대 경로). 매니페스트만 쓴다 */
  readonly changedFiles: readonly string[];
}

/**
 * 구성원 떼기(`detachMember`, AGE-33). 구성원 하나를 독립 플러그인 폴더로 옮긴다. 원본 폴더 `dir`은 읽기만 하고,
 * 새 폴더 `outDir`(없거나 비어 있어야 한다)에만 쓴다. 프로필 파일은 건드리지 않는다: 프로필 참조는 `profileMove`로 알린다
 */
export interface MembersDetachInput {
  /** 원본 폴더의 절대 경로(`.fresnel-plugin/plugin.json`이 있어야 한다) */
  readonly dir: string;
  /** 떼어 낼 구성원의 id(뿌리 플러그인은 떼지 않는다) */
  readonly member: string;
  /** 새 폴더의 절대 경로. 없거나 비어 있어야 한다 */
  readonly outDir: string;
  /** 새 이름. 생략하면 `<원래 이름>-<member>`다 */
  readonly name?: string;
  /** 참이면 새 플러그인이 원래 이름의 플러그인에 `dependsOn`으로 기댄다 */
  readonly keepDependency?: boolean;
  /** `keepDependency`일 때 의존의 종류. 생략하면 soft다 */
  readonly dependencyKind?: DependencyKind;
  /** 새 매니페스트의 목적 한 문장(200자 이하). 생략하면 원본의 `purpose`를 그대로 옮기고, 원본에도 없으면 만들지 않는다 */
  readonly purpose?: string;
}

/** 떼기의 결과. `changedFiles`는 새 폴더 안의 파일(`outDir` 기준 상대 경로)이다 */
export interface MembersDetachResult {
  /** 새 폴더의 절대 경로 */
  readonly outDir: string;
  /** 새 이름(매니페스트 `name`) */
  readonly name: string;
  readonly changedFiles: readonly string[];
  readonly issues: readonly DevkitIssue[];
  /**
   * 프로필 참조를 옮길 때 화면이 승인 때 묻는 값. `from`은 떼기 전 구성원의 Registration id(`<원래 이름>/<member>`),
   * `to`는 새 이름이다. 프로필은 이 함수가 바꾸지 않는다
   */
  readonly profileMove: { readonly from: string; readonly to: string };
}

/**
 * 구성원 합치기(`mergeMembers`, AGE-33). 독립 플러그인 폴더 2~16개를 한 플러그인의 구성원으로 묶은 새 폴더(`outDir`)를 쓴다.
 * 원본 폴더들은 읽기만 한다. 매니페스트와 선언만 합친다: 코드 파일과 공용 항목은 옮기지 않고 `issues`로 알린다.
 * 프로필 파일은 건드리지 않는다: 프로필 참조는 `profileMove`로 알린다
 */
export interface MembersMergeInput {
  /** 원본 폴더의 절대 경로 2~16개. 각 폴더는 `plugins` 선언이 하나뿐이고 `orchestration`이 없는 독립 플러그인이어야 한다 */
  readonly dirs: readonly string[];
  /** 새 폴더의 절대 경로. 없거나 비어 있어야 한다 */
  readonly outDir: string;
  /** 새 이름(매니페스트 `name`). 원본 이름이나 설치된 이름과 겹치면 안 된다 */
  readonly name: string;
  /** 뿌리 플러그인의 제목. 생략하면 없다 */
  readonly title?: string;
  /**
   * 새 매니페스트의 목적 한 문장(200자 이하). 생략하면 원본들의 `purpose`를 선언 순서대로 `; `로 이어 붙인다.
   * 원본에 하나도 없으면 만들지 않는다
   */
  readonly purpose?: string;
}

/**
 * 합치기의 결과. `profileMove`의 `from`은 원본의 Registration id(선언에 id가 없으면 원본 이름), `to`는 `<새 이름>/<구성원 id>`다(구성원 id는 원본 이름이다).
 * 프로필은 이 함수가 바꾸지 않는다
 */
export interface MembersMergeResult {
  /** 새 폴더의 절대 경로 */
  readonly outDir: string;
  /** 새 이름(매니페스트 `name`) */
  readonly name: string;
  /** 새 매니페스트의 구성원 요약(`plugins[]` 순서) */
  readonly members: readonly MemberInfo[];
  /** 쓴 파일(`outDir` 기준 상대 경로). 매니페스트 하나뿐이다 */
  readonly changedFiles: readonly string[];
  readonly issues: readonly DevkitIssue[];
  readonly profileMove: readonly { readonly from: string; readonly to: string }[];
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

/**
 * 설치하지 않은 폴더의 Test run(L3.authoring.spec §4.3). `dir`은 제작 대화의 대상 폴더(절대 경로)다.
 * 폴더를 초안으로 만들어 Test run 대화에만 고정해 시작한다. 사용자 확장 폴더에 설치하지 않는다
 */
export interface TestRunInput {
  readonly dir: string;
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
/** 절단 한 칸: 앞에서 `commitIndex`개의 커밋을 복원해 다시 돌린 결과. orchestration-sdk `ReplayCut`의 wire 모양 */
export interface ReplayCut {
  /** 앞에서 몇 개의 커밋을 복원했는가(1부터) */
  readonly commitIndex: number;
  /** 기준 실행과 정규화 이벤트열이 같았는가 */
  readonly equal: boolean;
  /** 정규화 이벤트열에서 처음 달라진 위치. 같으면 null */
  readonly firstDiff: number | null;
}

/** orchestration-sdk `ReplayDriveReport`의 wire 모양 */
export interface ReplayReport {
  readonly ok: boolean;
  readonly commits: number;
  /** 절단마다 같았던 수. `cuts`에서 `equal`인 칸의 수다 */
  readonly passed: number;
  readonly firstDiff: number | null;
  /** 커밋 시점마다 한 칸, 커밋 순. 칸별 같음·다름을 싣는다(절단 띠 그림에 쓴다) */
  readonly cuts: readonly ReplayCut[];
  readonly effects: {
    readonly turn: number;
    readonly spawn: number;
    readonly delegate: number;
    readonly post: number;
  };
  readonly failure: ReplayFailure | null;
}

/** 기존 플러그인의 원본 폴더 사실(`sourceOf`, M5c §4.9.3). 빌더는 이 폴더에서 시작한다 */
export interface SourceFacts {
  /** 원본 폴더의 절대 경로(`<설정 폴더>/plugins/<이름>`) */
  readonly dir: string;
  /** 검토본의 출처가 번들 패키지인가. 원본 폴더가 있으면 사용자가 그 번들을 옮겨 둔 것이다 */
  readonly bundled: boolean;
  /** 원본이 검토본과 다른가(손 수정으로 보이는 변경 포함). 참이어도 빌더는 원본에서 시작한다 */
  readonly differsFromReviewed: boolean;
}

/** 초안 하나(`draftList`). 같은 플러그인의 초안은 `parent`로 이어지고 목록은 최신 먼저다 */
export interface DraftSummary {
  readonly draftId: string;
  readonly parent: string | null;
  readonly contentHash: string;
  readonly createdAt: string;
  readonly originThreadId: string | null;
  /** 검토함으로 보냈으면 그 항목 id */
  readonly submittedItemId: string | null;
}

/** 맥락 참조 하나와 그 내용(`craftContext`). 발견 참조는 근거 묶음(`findings.bundle`과 같은 값)을 싣는다 */
export interface CraftContextEntry {
  readonly ref: ContextRef;
  /** 발견 참조의 근거 묶음. 발견이 아니거나 읽지 못했으면 null */
  readonly bundle: JsonValue | null;
}
/** 테스트 대화의 맥락(`craftContext`): 기록 순서대로 이어 붙인 참조 목록 */
export interface CraftContextView {
  readonly threadId: string;
  readonly refs: readonly CraftContextEntry[];
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

/** 앱 안 설치의 미리 보기(`ext.installPreview`). 디스크에 아무것도 쓰지 않는다 */
/** 설치 미리 보기에 보이는 화면(`ui.items`) 하나. 프레임(`app`)이면 선언한 다리 권한이 따른다 */
export interface InstallPreviewScreen {
  readonly id: string;
  readonly title: string;
  readonly placement: string;
  readonly mode: "native" | "app";
  /** `app` 화면이 선언한 셸 기능 권한. `native`는 비어 있다 */
  readonly capabilities: readonly BridgeCapability[];
}
export interface InstallPreview {
  readonly name: string;
  readonly version: string;
  readonly displayName: string | null;
  readonly description: string | null;
  /** 출처 폴더 경로 */
  readonly source: string;
  /** 폴더 내용 해시(`folderHash`). 설치 경로는 폐기됐고(M5c §7.7) 이 값은 미리 보기 화면의 표시용으로만 남는다 */
  readonly sha256: string;
  /** 매니페스트가 요청한 신뢰 등급. 요청이 없으면 null */
  readonly trustRequest: "user" | "project" | "untrusted" | null;
  /** 같은 이름의 설치본이 있으면 그 버전(바꿔 놓게 된다) */
  readonly installedVersion: string | null;
  readonly hooks: readonly string[];
  /** 같은 이름으로 바꿔 놓겠다고 선언한 내장 도구 */
  readonly tools: readonly string[];
  /** 요청한 기능. 선택이면 `optional` */
  readonly capabilities: readonly { readonly id: string; readonly optional: boolean }[];
  /** 요청한 기능 가운데 네트워크(`web.*`, `mcp.*`), 파일(`workspace.files`, `workspace.images`), 명령 실행(`workspace.shell`)에 닿는 것 */
  readonly network: readonly string[];
  readonly files: readonly string[];
  readonly shell: readonly string[];
  readonly drives: boolean;
  /** 매니페스트 `ui.items`의 화면 목록과 그 화면이 선언한 다리 권한 */
  readonly screens: readonly InstallPreviewScreen[];
  readonly warnings: readonly DevkitIssue[];
}
export const DEVKIT_ERROR_KINDS = [
  "dev_mode_required",
  "invalid_input",
  "not_found",
  "exists",
  "blocked_kind",
  "denied",
  /** 미리 보기 뒤 폴더 내용이 바뀌었다 */
  "source_changed",
  /** 안전 모드라 설치하지 않는다 */
  "safe_mode_active",
  /** `managed` 범위가 이 확장의 설정을 잠갔다 */
  "managed_locked",
  /** 설치할 폴더 경로가 절대 경로가 아니다 */
  "not_absolute",
  /** 폴더는 있지만 `.fresnel-plugin/plugin.json`이 없다(폴더가 없으면 `not_found`) */
  "no_manifest",
  /** 번들 플러그인이라 원본 폴더가 없다. 고칠 수 없다(M5c §4.9.3) */
  "bundled_not_editable",
  "io",
] as const;
export type DevkitErrorKind = (typeof DEVKIT_ERROR_KINDS)[number];
/**
 * 입력이 거절된 사유 한 건(설치 미리 보기·설치). `code`는 사유 종류이고 화면이 이것으로 문장을 고른다.
 * `field`는 매니페스트 안 경로(맨 앞 `/` 없이, 예: `plugins/0/hooks`), `line`은 원문에서 그 키를 찾았을 때의 줄이다.
 * `message`는 검사기가 쓴 원문 문장이라 화면에 그대로 보이지 않는다
 */
export interface DevkitReason {
  readonly code: string;
  readonly field?: string;
  readonly line?: number;
  readonly message?: string;
}
export interface DevkitError {
  readonly kind: DevkitErrorKind;
  readonly message: string;
  /** 거절된 사유 목록. 설치 입력이 검사에서 걸렸을 때만 있다. 없으면 `kind`와 `message`만 본다 */
  readonly reasons?: readonly DevkitReason[];
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
  /**
   * 담당 AI의 제출(M5c §3.5, §4.9). 폴더를 초안으로 만들고 검토 항목을 연다. 설치하지 않는다: 승인은 검토함에서 사용자가 한다.
   * 포트 `PluginSubmitPort`는 호스트가 `PluginSubmitPortKey`로 조회해 부른다
   */
  submit(input: PluginSubmitRequest): Promise<DevkitResult<PluginSubmitResult>>;
  /**
   * 기존 플러그인의 원본 폴더(M5c §4.9.3). 이름만으로 연다. 없으면 `not_found`, 번들이면 `bundled_not_editable`.
   * 구현이 없으면 빌더는 기존 플러그인 고치기를 거절한다(`source_unavailable`)
   */
  sourceOf?(name: string): Promise<DevkitResult<SourceFacts>>;
  /** 플러그인의 초안 목록, 최신 먼저(M5c §4.9.2). 구현이 없으면 빌더의 `authoring_drafts`가 거절한다 */
  draftList?(name: string): Promise<DevkitResult<{ readonly drafts: readonly DraftSummary[] }>>;
  /**
   * 대화의 마지막 turn id(없으면 null). 빌더가 Test run 대화에서 제출의 증거 turn을 스스로 고른다(F-46: 사람이 turn id를 알려 줄 수 없다).
   * 구현이 없으면 빌더는 모델이 넘긴 `turnId`만 쓴다
   */
  latestTurn?(threadId: string): Promise<DevkitResult<string | null>>;
  /** 테스트 대화의 맥락 참조(M5c §4.8.8, 도구 `authoring_context`). 구현이 없으면 도구가 거절한다 */
  craftContext?(threadId: string): Promise<DevkitResult<CraftContextView>>;
  /**
   * 이 대화가 테스트 대화(`craftChat` 표지)인가 [제안, M5c §4.8.6]. 상주 모드는 모델이 넘기는 `resident`가 아니라 이 판정으로 정한다.
   * 구현이 없으면 빌더는 모델이 넘긴 값을 그대로 쓴다. 읽지 못하면 오류다
   */
  isCraftChat?(threadId: string): Promise<DevkitResult<boolean>>;
}
