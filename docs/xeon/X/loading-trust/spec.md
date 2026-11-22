---
id: X.loading-trust.spec
layer: X
domain: loading-trust
kind: spec
status: draft
depends_on: [F.extensions.spec, F.wire-settings.spec, F.capabilities.spec, X.primitives.spec, X.operations.spec, adr.0002, adr.0006, adr.0007, adr.0021, architecture.layers.spec, eng.transactions.design, eng.dependency-rules.guide, eng.context-map.design]
binds: [xeon/packages/ext-host/src/loading-trust/**]
---

# X 로딩과 신뢰 (loading-trust)

코드 위치: `xeon/packages/ext-host/src/loading-trust/`. 공개 이름은 `@fresnel/ext-host`가 재export한다. 루트가 다시 내보내는 이름의 목록은 X.primitives.spec §3.1 표(이 문서 행 포함)가 정본이고, 이 문서는 그 행에 들어갈 로딩·신뢰 이름의 시그니처를 정한다.

## 1. 목적과 범위

확장이 발견되고 검증되어 로드되는 흐름, 작업 폴더 신뢰, 선택적 프로세스 격리, SDK 가상 모듈, 기본 플러그인 설치를 정한다. pi 확장 어댑터는 두지 않는다(adr.0017 §3.7).

근거:

- [결정] 훅은 on(fold tap/first/chain), post, drive(배타 drive 락), Registration 4연산이다(`_research/decisions-log.md` 2026-10-21 계획 v2, adr.0007 §3).
- [결정] DI는 Cordis 하나다. `cordis`를 import하는 패키지는 `ext-host` 하나다(adr.0002 §3, eng.dependency-rules.guide DR-11). vendored Cordis에는 `@cordisjs/plugin-loader`가 없다(`xeon/vendor/cordis/UPSTREAM.json` `notCopied`). 설정 파일 기반 로딩은 ext-host가 직접 구현한다(adr.0002 §4.2).
- [결정] 확장 프로세스 격리는 사용자가 확장마다 켜는 2차 선택 기능이고 기본값은 꺼짐이다(`_research/layer-plan-v2-notes.md` "확장 프로세스 격리는 기본값이 아니어도 된다", `_research/decisions-log.md` 2026-10-21 결정(2차), adr.0006 §4.2).
- 층 구성 계획 v2 X-a 행: 확장 로딩(그대로, Cordis), 기능 선언 정적 검증(설계), 작업 폴더 신뢰(포크, pi `trust-manager.ts`·`project-trust.ts`), 프로세스 격리(자체, vscode-jsonrpc 9.0.3)(`_research/packages.md` §4.5, §2.5).
- 항목 카탈로그 X절의 확장 로딩 방식, 작업 폴더 신뢰, 프로세스 격리, 기능 선언 행(`_research/item-catalog.md` X절).

정하는 것:

- 탐색 규칙: 설치 위치, 매니페스트 파일, 우선순위, 로드 순서
- 로드 파이프라인 단계와 단계별 실패 상태, 진단 레코드
- TS 엔트리 로딩 방식, `ExtHost.install` 위임과 오류 변환, 핫 리로드 범위, 제거 흐름
- 확장 설정 연결과 예약 키 `ext.<name>.enabled`, `ext.<name>.isolation`, X 층 키 `x.loading-trust.*`
- 신뢰 등급 4값의 뜻과 허용 연산 표, 작업 폴더 신뢰 판정과 저장
- 프로세스 격리(2차)의 전송, 프록시, 직렬화, 수명, 기록 경로
- SDK 가상 모듈(`@fresnel/contracts`, `@fresnel/orchestration-sdk`, `typebox`)과 기본 플러그인 설치(§4.4.6, §4.4.7), 안전 모드 연결(§4.3.1 5a단계)
- `thread.trust.before`, `thread.resources` 훅의 발화 시점(F.extensions.spec §7)
- Plugin UI 기여(매니페스트 `ui`)의 파일과 정책 검사, Plugin App 파일 풀이, `x.ui.*` 키(§4.3.4, §3.10)

다루지 않는 것:

- 매니페스트 스키마, 훅 50행, fold 규칙, 정적 검사 함수(`validateManifest`, `validateUsage`, `validateManifestSet`)와 `ManifestIssueCode`: F.extensions.spec이 정본이다. 이 문서는 이름으로 인용한다.
- 4연산 실행, 디스패처, post 큐, drive 락 중재, Registration 토글·상태, 리소스 등록 API, 설정 키 `x.primitives.*`: X.primitives.spec.
- tier, 핸들러 시간 예산, 실패 격리·자동 끄기, 확장 전용 저장(접두 테이블 API), 이름 충돌 규칙, 안전 모드, 외부 훅 프로토콜(M4로 옮김 [결정: 2026-10-28 사용자]), 설정 키 `x.operations.*`: X.operations.spec. tier와 시간 예산은 operations 소유로 본다 [제안]. F.extensions.spec §1·§4.2의 primitives 표기는 정합성 단계에서 고친다.
- 설정 파일 경로와 읽기, 유효 값 계산: F.wire-settings.spec과 L1.persistence.spec. 이 문서는 키 정의와 신뢰 전 적용 제외 규칙만 둔다.
- 자식 프로세스 기동·종료의 OS 구현: L0.process.spec.

## 2. 용어

| 용어 | 뜻 |
|---|---|
| 후보 (candidate) | 탐색이 찾은 확장 하나. 매니페스트 위치와 설치 위치를 가진다. 아직 코드를 실행하지 않은 상태다 |
| 설치 위치 (source) | `builtin`, `managed`, `user`, `project` 넷. 후보를 어디서 찾았는지 나타낸다 |
| 신뢰 등급 (trust level) | `builtin`, `user`, `project`, `untrusted` 넷. 확장이 할 수 있는 일을 정한다(§4.6) |
| 작업 폴더 루트 | 신뢰 판정 대상 폴더. 현재 작업 디렉터리(cwd)를 정규화한 경로다 [제안] |
| 신뢰 필요 자원 | 신뢰 판정 전에 읽거나 실행하면 안 되는 작업 폴더 파일 묶음(§4.7.2). 카드 미리 보기가 이름을 읽는 것은 예외다(§4.7.4) |
| 로드 세대 (generation) | 한 확장의 엔트리를 한 번 실행한 단위. 핫 리로드나 격리 재시작마다 1씩 오른다 |
| 진단 레코드 | 로드 중 생긴 문제 하나를 적은 `LoadDiagnostic` 값 |
| 내장 필수 확장 | `essential: true`로 등록된 내장 확장. 이 확장의 실패는 시작 실패다 |
| 격리 확장 | 실효 격리 값이 `process`인 확장(§4.9.0). 플러그인 호스트 프로세스에서 실행된다 |
| 프록시 | 격리 확장 대신 호스트 프로세스에서 훅 핸들러와 리소스를 등록하는 대리 객체 |
| SDK 가상 모듈 | 플러그인 번들이 import하는 `@fresnel/contracts`, `@fresnel/orchestration-sdk`, `typebox`를 호스트가 쓰는 모듈 객체로 돌려주는 등록(§4.4.6) |
| 기본 플러그인 | 릴리즈에 들어 있고 첫 실행 때 사용자 확장 위치에 복사되는 외부 확장 형식의 플러그인(Helm, §4.4.7) |

## 3. 인터페이스

F에서 가져오는 이름은 F 문서 그대로 쓴다: `ExtensionManifest`, `ExtensionManifestSchema`, `ExtensionName`, `ExtensionEntry`, `RegistrationFn`, `RegistrationApi`, `ManifestIssue`, `ManifestIssueCode`, `ExtensionUsage`, `validateManifest`, `validateUsage`, `validateManifestSet`, `HookName`, `HOOKS`, `FIRST_DENY`, `PostItem`, `PostOptions`(F.extensions.spec), `CapabilityId`, `SemVer`, `ServiceKey`(F.capabilities.spec), `SettingDef`, `SettingDefInput`, `SettingCatalog`, `CatalogIssue`, `SettingNamespace`, `defineSettings`, `settingsFromManifest`, `buildCatalog`(F.wire-settings.spec).

### 3.1 신뢰 등급과 설치 위치 (`trust/levels.ts`)

```ts
import { Type, type Static } from "typebox";

/** F.extensions.spec TrustRequestSchema의 값 집합을 확정한다 [제안] */
export type TrustLevel = "builtin" | "user" | "project" | "untrusted";
export const TRUST_LEVELS: readonly ["builtin", "user", "project", "untrusted"] = ["builtin", "user", "project", "untrusted"];
/** 높을수록 앞. 비교는 이 배열의 index로 한다 */
export function trustRank(level: TrustLevel): number;

export type InstallSource = "builtin" | "managed" | "user" | "project";
export const INSTALL_SOURCES: readonly ["builtin", "managed", "user", "project"] = ["builtin", "managed", "user", "project"];

/** 설치 위치가 정하는 상한 등급 */
export const SOURCE_TRUST: { readonly [S in InstallSource]: Exclude<TrustLevel, "untrusted"> } = {
  builtin: "builtin",
  managed: "user",
  user: "user",
  project: "project",
};

export type StorageAccess = "prefix" | "none";
export type IsolationRule = "forbidden" | "optional" | "notLoaded";

export interface TrustPermissions {
  readonly load: boolean;
  /** project_trust 외 지점 */
  readonly on: boolean;
  /** project_trust 지점에 on을 걸 수 있는가 */
  readonly onProjectTrust: boolean;
  readonly post: boolean;
  /** 플러그인의 `drives`가 참이고 정책 `x.primitives.driveRequiresOrchestration`(X.primitives.spec §4.4.1)이 허용할 때 */
  readonly drive: boolean;
  /** 도구·명령·provider 등록(X.primitives.spec 리소스 등록) */
  readonly resources: boolean;
  /** 확장 접두 테이블(X.operations.spec). 격리 확장은 이 값과 무관하게 직접 접근이 없다(§4.9.6) */
  readonly storage: StorageAccess;
  readonly isolation: IsolationRule;
}

/** §4.6 표의 코드형. 문서 표와 같은지 테스트가 확인한다 */
export const TRUST_MATRIX: { readonly [L in TrustLevel]: TrustPermissions };
```

### 3.2 내장 모듈과 후보 (`discover.ts`)

```ts
import type { ExtensionEntry, ExtensionManifest, ExtensionName } from "@fresnel/contracts/extensions";

/** 내장 패키지(core-*, cap-*, group-*)가 export하는 확장 모듈. 조립 루트(L4 host)가 목록을 넘긴다 */
export interface BuiltinExtensionModule {
  readonly manifest: ExtensionManifest;
  /** 엔트리. 내장 패키지는 named export `extension`으로 둔다(§4.4) */
  readonly extension: ExtensionEntry;
  /** 참이면 이 확장의 로드 실패가 시작 실패다. 기본 false */
  readonly essential?: boolean;
}

export interface ExtensionCandidate {
  readonly source: InstallSource;
  /** 확장 루트 절대 경로(심볼릭 링크를 푼 경로). 내장은 null */
  readonly root: string | null;
  /** `.fresnel-plugin/plugin.json` 절대 경로. 내장은 null */
  readonly manifestPath: string | null;
  /** 내장만 */
  readonly builtin: BuiltinExtensionModule | null;
}

// 탐색이 쓰는 파일 접근(LoaderFs)과 설치 위치 경로(LoaderPaths)는 F 포트다(F.extensions.spec §3.2.1 로더 포트).
// X는 L0를 import하지 않으므로 조립 루트가 구현(L0.os)을 주입한다(architecture.layers.spec §4.3.3). 여기서는 다시 export만 한다
import type { LoaderFs, LoaderPaths } from "@fresnel/contracts/extensions";
export type { LoaderFs, LoaderPaths } from "@fresnel/contracts/extensions";

export interface ExternalLocation {
  readonly source: "managed" | "user" | "project";
  /** `extensions/`와 같은 모양의 디렉터리. 그 아래 한 단계의 디렉터리마다 후보 하나다 */
  readonly dir: string;
}

/**
 * 설치 위치별 탐색 디렉터리(§4.2.1 표). `projectRoot`는 신뢰가 허용된 뒤에만 넘긴다(§4.7.4).
 * `sources`를 생략하면 managed, user, project 모두다
 */
export function externalLocations(input: {
  readonly paths: LoaderPaths;
  /** x.loading-trust.paths 유효 값. user 위치로 본다 */
  readonly extraPaths: readonly string[];
  readonly projectRoot: string | null;
  readonly sources?: readonly ExternalLocation["source"][];
}): readonly ExternalLocation[];

/** 외부 확장 탐색. 매니페스트 내용은 읽지 않고 존재만 확인한다. 위치 순서, 이름의 코드 포인트 순이다 */
export function discoverExternal(fs: LoaderFs, locations: readonly ExternalLocation[]): Promise<{
  readonly candidates: readonly ExtensionCandidate[];
  readonly diagnostics: readonly LoadDiagnostic[];
}>;
```

### 3.3 로드 순서 (`load-order.ts`)

```ts
/** 내장 층 순서. L0 플랫폼 플러그인은 이 파이프라인 밖에서 먼저 등록된다(§4.3) */
export const BUILTIN_LAYER_ORDER: readonly ["L1", "L2", "L3", "plugin"] = ["L1", "L2", "L3", "plugin"];
export const SOURCE_ORDER: readonly ["builtin", "managed", "user", "project"] = ["builtin", "managed", "user", "project"];

export interface OrderKey {
  readonly source: InstallSource;
  /** 내장만 쓴다. 외부는 0 */
  readonly layerIndex: number;
  readonly name: ExtensionName;
}

/** 순수 함수. 입력 순서와 무관하게 같은 결과를 낸다 */
export function compareLoadOrder(a: OrderKey, b: OrderKey): number;
export function orderManifests<T extends { readonly key: OrderKey }>(items: readonly T[]): readonly T[];
```

### 3.4 상태와 진단 (`pipeline.ts`)

```ts
export type LoadState =
  | "discovered" | "validated" | "trusted" | "resolved" | "loading" | "active"
  | "rejected" | "disabled" | "error";

export type LoadStage =
  | "discover" | "manifest" | "set" | "trust" | "settings" | "ui" | "capabilities" | "admit"
  | "entry" | "usage" | "activate" | "isolation";

/** Plugin UI 검사가 내는 코드(§4.3.4). 매니페스트 모양 오류는 `manifest_invalid`(F의 `ui_*` 코드)로 남는다 */
export type UiDiagnosticCode =
  | "ui_file_missing" | "ui_invalid" | "ui_limit" | "ui_path_invalid" | "ui_mode_not_allowed"
  | "widgets_unsupported" | "bridge_unsupported";

export type LoadDiagnosticCode =
  | "manifest_missing" | "manifest_parse" | "manifest_invalid"
  | "name_conflict" | "trust_exceeds_source" | "trust_denied" | "trust_undecided" | "trust_store_corrupt"
  | "settings_rejected" | "settings_reserved_key" | "config_required"
  | "capability_missing" | "capability_provider_failed" | "dependency_missing" | "dependency_provider_failed" | "dependency_cycle"
  | "tier_rejected"
  | "entry_not_found" | "entry_import_failed" | "entry_not_function" | "entry_threw"
  | "setup_threw" | "setup_timeout" | "setup_action" | "reload_failed" | "reload_rejected"
  | "usage_invalid" | "usage_warning" | "plugin_not_registered"
  | "essential_failed" | "disabled_by_setting" | "safe_mode" | "disabled_flag" | "lazy_deferred" [제안]
  | "isolation_unavailable" | "isolation_point_unsupported"
  | "isolation_exited" | "isolation_restart_limit" | "isolation_protocol"
  | UiDiagnosticCode;

export const LoadDiagnosticSchema = Type.Object({
  extension: Type.Union([Type.String(), Type.Null()]),
  source: Type.Union([
    Type.Literal("builtin"), Type.Literal("managed"), Type.Literal("user"), Type.Literal("project"), Type.Null(),
  ]),
  stage: Type.String(),
  severity: Type.Union([Type.Literal("error"), Type.Literal("warning"), Type.Literal("info")]),
  code: Type.String(),
  message: Type.String({ maxLength: 2000 }),
  path: Type.Optional(Type.String()),
  /** validate* 결과 원본 */
  issues: Type.Optional(Type.Array(Type.Object({
    severity: Type.String(), code: Type.String(), path: Type.String(), message: Type.String(),
  }))),
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
  /** 로드 순서 index. 디스패치 순서의 두 번째 키(F.extensions.spec §4.2). 로드되지 않았으면 null */
  readonly loadIndex: number | null;
  readonly generation: number;
  /** 읽은 매니페스트. 읽거나 검증하지 못한 후보는 없다. 조립 루트의 `ext.list`가 위치와 상관없이(사용자, 관리, 작업 폴더) 이 값으로 행을 만든다 */
  readonly manifest?: ExtensionManifest;
  /** 확장 루트 디렉터리(절대 경로). 내장 확장은 없다 */
  readonly root?: string;
  readonly diagnostics: readonly LoadDiagnostic[];
}
```

### 3.5 로더 서비스 (`index.ts`)

```ts
export type LoaderMode = "interactive" | "headless";

export interface LoadOptions {
  readonly builtins: readonly BuiltinExtensionModule[];
  readonly cwd: string;
  readonly mode: LoaderMode;
  /** CLI 일회 지정. 있으면 신뢰 판정의 첫 단계로 쓴다(§4.7.3) */
  readonly trustOverride?: boolean;
  /** 안전 모드와 --disable-ext(X.operations.spec §3.6 StartupOptions). 없으면 둘 다 꺼짐 */
  readonly startup?: StartupOptions;
  /** x.loading-trust.paths 유효 값. 각 경로는 `extensions/`와 같은 모양의 디렉터리이고 user 위치로 본다(§4.2.1) [제안] */
  readonly extraPaths?: readonly string[];
  /**
   * 작업 폴더 확장을 어떻게 싣는가. 기본 "cwd"는 cwd의 작업 폴더를 이 호출에서 판정하고 싣는다(in-process·stdio 호스트).
   * "on_demand"는 판정도 적재도 하지 않는다. 서비스 모드는 작업 폴더를 여는 thread마다 loadProject를 부른다(§4.7.8)
   */
  readonly projects?: "cwd" | "on_demand";
  /**
   * `projects: "cwd"`에서 판정한 프로젝트 루트의 프로젝트 id [결정: 2026-11-18, 사용자, AGE-41 (2)]. 프로젝트 출처 검토본은 id가 같은 것만 싣는다(다른 프로젝트의 같은 이름 승인본이 실리지 않는다. 구분 키는 `프로젝트/이름` 문자열이 아니라 `projectId` 칸이다).
   * 없으면 시작 때 프로젝트 검토본을 싣지 않는다. 조립이 루트에서 id를 정한다(호스트의 `projectIdOf`)
   */
  readonly projectIdOf?: (projectRoot: string) => Promise<string | undefined>;
  /** 화면 앱 정책(`x.ui.apps`, `x.ui.allowProjectApps`, §4.3.4). 없는 값은 앱 켬, 작업 폴더 앱 끔이다(ADR-0021 §6 1번: 프레임 격리 시험이 macOS에서 통과해 [결정: 2026-11-04 사용자] 켰다). `loadProject`도 이 값을 쓴다 */
  readonly uiPolicy?: { readonly apps?: boolean; readonly allowProjectApps?: boolean };
  /**
   * 시작 때 싣는 외부 확장의 기본 집합 [M5c §4.1.11]. 기본 프로필이 처음 주는 번들 이름이다. 없으면 모두 싣는다(이전 동작).
   * 있으면 시작 때(`loadAll`의 묶음과 시작 때 싣는 프로젝트 묶음) 이름이 여기 없는 외부 확장은 `defaultEnabled`와 무관하게
   * 싣지 않는다(§4.3.1 5a단계 앞, 진단 `lazy_deferred`). 기록은 `disabled`로 남고 `ensureLoaded`가 싣는다(§4.4.4)
   */
  readonly defaultNames?: readonly ExtensionName[];
  readonly signal: AbortSignal;
}

/** loadProject 입력(§4.7.8) */
export interface LoadProjectOptions {
  /** 작업 폴더. 판정은 이 폴더의 작업 폴더 루트(정규화한 경로)에 대해 한다 */
  readonly projectRoot: string;
  readonly mode: LoaderMode;
  /** 이 호출 전용 프롬프트 수단. 없으면 LoaderDeps.prompter */
  readonly prompter?: TrustPrompter;
  /** 호출자가 이미 정한 판정(저장하지 않는다) */
  readonly trustOverride?: boolean;
  /**
   * 이 프로젝트 루트의 프로젝트 id [결정: 2026-11-18, 사용자, AGE-41 (2)]. 프로젝트 출처 검토본은 `projectId`가 같은 것만 싣는다.
   * 없으면 프로젝트 검토본을 하나도 싣지 않는다
   */
  readonly projectId?: string;
  readonly signal: AbortSignal;
}

export interface ProjectLoadReport {
  /** 정규화한 작업 폴더 루트. 판정이 실패했거나 안전 모드이면 null */
  readonly projectRoot: string | null;
  readonly projectTrust: ProjectTrustResult | null;
  /** 이 루트의 확장을 앞선 호출에서 이미 실었다. 다시 싣지 않았다 */
  readonly alreadyLoaded: boolean;
  /** 이 호출이 새로 시도한 작업 폴더 확장 */
  readonly extensions: readonly LoadedExtensionInfo[];
  /** 이 호출이 남긴 진단 */
  readonly diagnostics: readonly LoadDiagnostic[];
}

export interface LoadReport {
  readonly extensions: readonly LoadedExtensionInfo[];
  readonly diagnostics: readonly LoadDiagnostic[];
  /** 작업 폴더 신뢰 판정. 안전 모드라 판정하지 않았으면 null */
  readonly projectTrust: ProjectTrustResult | null;
  /** 거부된 확장을 뺀 설정 그룹. 조립 루트가 buildCatalog에 넣는다(§4.5.4) */
  readonly settingGroups: readonly {
    readonly owner: string;
    readonly namespace: SettingNamespace;
    readonly defs: readonly SettingDef[];
  }[];
}

/** 내장 필수 확장이 실패하면 loadAll이 던진다 */
export declare class LoadAbortError extends Error {
  readonly diagnostics: readonly LoadDiagnostic[];
}

/** 제거 확인 화면용. 지울 확장 전용 테이블 목록(X.operations.spec ExtStorageAdmin.dropExtension(name, false)) */
export interface RemovalPreview {
  readonly name: ExtensionName;
  readonly tables: readonly string[];
}

export interface RemoveResult {
  readonly name: ExtensionName;
  /** 지운 테이블. dropTables가 거짓이면 빈 배열 */
  readonly dropped: readonly string[];
  /** 남은 테이블("주인 없는 확장 테이블") */
  readonly remaining: readonly string[];
}

export interface ExtensionLoader {
  /** 시작 때 한 번. 파이프라인 전체를 실행한다 */
  loadAll(options: LoadOptions): Promise<LoadReport>;
  /** 작업 폴더 하나를 판정하고 신뢰되면 그 작업 폴더의 확장을 싣는다(모든 호스트 모드, §4.7.8). loadAll 뒤에 부른다 */
  loadProject(options: LoadProjectOptions): Promise<ProjectLoadReport>;
  /**
   * 꺼진 기록(`disabled`)을 5a~9단계로 다시 실어 `active`로 만든다. 부르는 때는 ext.<name>.enabled가 거짓에서 참이 되었을 때,
   * 시작 때 미룬 확장이 대화의 켜짐 집합(E(T))에 들었을 때, `unload` 뒤다 [제안]. 검토본 목록의 현재 사본이 기록이 쥔 사본과
   * 다르면 현재 사본으로 기록을 다시 만든다. 기록이 없으면 `loader.unknown_extension`(Bug)이다
   */
  ensureLoaded(name: ExtensionName, signal: AbortSignal): Promise<LoadedExtensionInfo>;
  list(): readonly LoadedExtensionInfo[];
  diagnostics(): readonly LoadDiagnostic[];
  /**
   * 화면 기여 항목의 검사 결과(§4.3.4). 로드 순서, 선언 순서다. `ext.ui.list`가 쓴다. 확장이 목록에서 빠지면 그 확장의 항목도 빠진다. 항목마다 확장 `version`, 설치 등급 `trust`(managed·user·project·builtin)가 붙고, 앱 모드이며 `ok`이고 `builtin`이 아니면 `appRoot`(확장 루트 + `app.root`의 절대 경로)가 붙는다 [결정: 2026-11-04 사용자]. 셸은 이 값으로 `app_roots_set`을 부른다. 주인을 확인한 card 항목만 `forKind`(레코드 kind)를 싣는다(§4.3.4 1번). 기여 선언에 `icon`이 있는 항목은 그 아이콘 이름을 그대로 싣는다 [결정: 2026-11-11 사용자]
   */
  uiEntries(): readonly UiEntryReport[];
  /** 설치된 외부 확장을 새 버전으로 바꾼다. 적용은 단계 경계다(§4.4.4) [결정: 2026-11-03 사용자 (a), M4 T-RELOAD] */
  reload(name: ExtensionName, signal: AbortSignal, options?: ReloadOptions): Promise<Result<ReloadStarted, ReloadFailure>>;
  /** 설치한 새 이름 하나를 사용자 위치에서 시작 때와 같은 파이프라인으로 싣는다. 켜기는 단계 경계 규칙을 따른다(§4.4.4) [결정: 2026-11-03 사용자 (a), M4 T-RELOAD] */
  loadInstalled(name: ExtensionName, signal: AbortSignal, options?: { readonly deferStart?: boolean }): Promise<Result<LoadInstalledStarted, LoadInstalledFailure>>;
  /**
   * 외부 확장을 호스트에서 내리고 로더 기록은 `disabled`로 남긴다(세대 +1) [제안, M5c §4.1.11]. 같은 이름의 `ensureLoaded`가
   * 다시 싣는다. 내장이거나 모르는 이름이면 false다. 기록을 지우는 제거는 이 함수가 하지 않는다
   */
  unload(name: ExtensionName): Promise<boolean>;
  /** 제거 1단계. 아무것도 바꾸지 않고 지울 테이블 목록만 돌려준다(§4.4.5). M2 */
  previewRemoval(name: ExtensionName): Promise<RemovalPreview>;
  /** 제거 2단계. 실행 중 호스트에서 내리고, dropTables가 참이면 확장 전용 테이블을 지운다(§4.4.5). M2 */
  remove(name: ExtensionName, options: { readonly dropTables: boolean; readonly signal: AbortSignal }): Promise<RemoveResult>;
  /** 역순으로 scope를 정리하고 격리 프로세스를 끝낸다 */
  dispose(): Promise<void>;
}

/** 조립 루트가 주입하는 의존. 없는 항목은 그 기능을 쓰는 단계에서 실패한다(§4.3.2) */
export interface LoaderDeps {
  /** 설치 대상. 엔트리 호출과 scope 실행은 ExtHost.install이 한다(§4.1) */
  readonly host: ExtHost;
  /** 운영 정책(X.operations.spec §3.8). 6a단계 admit, 설치 실패·제거 때 forget. 5a단계는 순수 함수 `startupFilter`를 직접 부른다 [제안] */
  readonly policy: Pick<OperationsPolicy, "admit" | "forget">;
  readonly fs: LoaderFs;
  readonly paths: LoaderPaths;
  readonly trustBackend: TrustStoreBackend;
  /** 대화형 프롬프트. headless면 없다 */
  readonly prompter?: TrustPrompter;
  /** 격리(2차). 조립 루트가 host.ports.get(ProcessPortKey)로 꺼내 넣는다. 없으면 격리 설정 확장은 isolation_unavailable */
  readonly process?: IsolationProcessPort;
  /** 제거 흐름의 테이블 삭제(X.operations.spec §3.4). 없으면 remove는 테이블을 남긴다. M2 */
  readonly storageAdmin?: ExtStorageAdmin;
  readonly clock: { now(): number };
  /**
   * 플러그인 번들에 줄 SDK 가상 모듈 가운데 X가 직접 등록하지 않는 것. 지정자 → 호스트가 쓰는 모듈 객체(§4.4.6). `@fresnel/contracts`와
   * 하위 경로, `typebox`는 X가 등록한다. `@fresnel/orchestration-sdk`은 L3라 X가 import할 수 없어 조립 루트가 넘기며, 없으면 그 import가 실패한다(`entry_import_failed`)
   */
  readonly sdkModules?: SdkModules;
  /** `thread.trust.before` 발화(§4.7.3 4번). 없으면 결정 없음으로 본다 */
  readonly emitProjectTrust?: (cwd: string, signal: AbortSignal) => Promise<{ readonly trusted: "yes" | "no"; readonly remember?: boolean } | undefined>;
}

export function createExtensionLoader(deps: LoaderDeps): ExtensionLoader;
```

- 같은 패키지의 다른 도메인 이름은 타입만 가져온다: `ExtHost`, `ExtensionUnit`, `InstallResult`(`../primitives/index.ts`), `OperationsPolicy`, `StartupOptions`, `ExtStorageAdmin`(`../operations/index.ts`). 값 import가 없으므로 도메인 사이 값 순환이 없다.
- [제안] `ExtensionLoader`는 Cordis 서비스로 등록하지 않는다. 조립 루트(L4 host)가 `createExtensionLoader(deps)` 결과를 직접 쥐고 `host.status`, 설정 화면, 확장 명령에 넘긴다. `ExtHost`(`fresnel.ext`)에는 `loader` 속성을 두지 않는다. 로더는 `ExtHost`를 쓰고 `ExtHost`는 로더를 참조하지 않으므로 의존이 한 방향이다.
- 조립 순서: `createOperationsPolicy` → `createExtHost` → `ExtHost.registerPlatform`(L0) → `createExtensionLoader({ host, policy, … })` → `loadAll`(X.operations.spec §3.8, L4.host-service.spec).
- L4.host-service.spec이 [가정]으로 둔 `HostPluginModule = import("@fresnel/ext-host").PluginModule`은 이 문서의 `BuiltinExtensionModule`이다 [제안]. 이름 `PluginModule`을 따로 두지 않는다.
- `LoaderFs`, `LoaderPaths`, `TrustStoreBackend`, `TrustPrompter`, `IsolationProcessPort`는 L0·L4가 구현하는 포트다. 타입 정본은 F.extensions.spec §3.2.1 `ports.ts`이고, 이 문서는 `@fresnel/contracts/extensions`에서 가져와 다시 export만 한다([결정: review.decisions-2 U-14]). 판정 함수(`discover`, `resolveProjectTrust`, `trustOptions`)와 신뢰 파일 스키마(`TrustFileSchema`)는 X에 남는다.

### 3.6 설정 키 정의 (`settings-keys.ts`)

```ts
import type { SettingDef, SettingDefInput, SettingGroup } from "@fresnel/contracts/settings";

/** ext.<name>.enabled, ext.<name>.isolation. 확장마다 로더가 만든다(§4.5) */
export function reservedExtensionSettings(manifest: ExtensionManifest, source: InstallSource): {
  readonly namespace: `ext.${string}`;
  readonly defs: readonly SettingDef[];
};

export const RESERVED_EXT_KEYS: readonly ["enabled", "isolation"] = ["enabled", "isolation"];

/** X 층 키. defineSettings("x.loading-trust", …) */
export declare const loadingTrustSettings: SettingGroup<"x.loading-trust", {
  readonly defaultProjectTrust: SettingDefInput;
  readonly paths: SettingDefInput;
  readonly "isolation.maxRestarts": SettingDefInput;
  readonly "isolation.restartWindowSec": SettingDefInput;
}>;
```

값 스키마와 기본값은 §6 표가 정한다.

### 3.7 신뢰 (`trust/store.ts`, `trust/resolve.ts`, `trust/resources.ts`)

```ts
// 신뢰 포트와 부속 타입은 F가 정본이다(F.extensions.spec §3.2.1 로더 포트). 여기서는 다시 export만 한다.
// 구현: TrustStoreBackend는 L0.os, TrustPrompter는 대화형 클라이언트(L4)
import type { Result } from "@fresnel/contracts";
import type {
  LoaderFs, TrustStoreBackend, TrustPrompter, TrustPromptRequest, TrustOption, TrustUpdate, TrustChoice, TrustChoiceKind,
} from "@fresnel/contracts/extensions";
export type {
  TrustStoreBackend, TrustPrompter, TrustPromptRequest, TrustOption, TrustUpdate, TrustChoice, TrustChoiceKind,
} from "@fresnel/contracts/extensions";

export type TrustVerdict = "allow" | "deny" | "undecided";

/** 저장 파일 형식. pi trust.json(Record<path, boolean|null>)에 버전과 출처를 더했다. 패키지 안에서만 쓴다(공개 이름이 아님) */
const TrustFileSchema = Type.Object({
  version: Type.Literal(1),
  entries: Type.Record(
    Type.String({ minLength: 1, maxLength: 4096 }),
    Type.Object({
      verdict: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
      /** ISO 8601 */
      decidedAt: Type.String(),
      via: Type.Union([Type.Literal("prompt"), Type.Literal("point"), Type.Literal("command")]),
    }),
  ),
});
type TrustFile = Static<typeof TrustFileSchema>;

export type TrustLookup =
  | { readonly kind: "found"; readonly verdict: "allow" | "deny"; readonly path: string }
  | { readonly kind: "none" }
  | { readonly kind: "corrupt"; readonly reason: string };

export interface ProjectTrustStore {
  /** 저장소 키로 쓰는 정규 경로(normalize) */
  canonical(path: string): Promise<string>;
  /** cwd에서 위로 올라가며 가장 가까운 항목. 읽기·파싱·스키마 실패는 던지지 않고 corrupt다 */
  lookup(cwd: string): Promise<TrustLookup>;
  /**
   * 갱신을 하나의 읽기-수정-쓰기(TrustStoreBackend.update)로 적용한다. 파일이 손상이면 쓰지 않고 corrupt를,
   * 백엔드 쓰기가 실패하면 io를 돌려준다(던지지 않는다, eng.typescript.guide TY-24)
   */
  setMany(updates: readonly TrustUpdate[]): Promise<Result<void, TrustStoreError>>;
  /**
   * 저장된 결정 전부를 파일 순서로 돌려준다(읽기만, 파일을 바꾸지 않는다). 없으면 빈 목록, 손상이면 corrupt, 읽기 실패는 io다.
   * 옛 형식 항목은 savedAt이 없다 [결정: 오케스트레이터 기본값, fxPT] (wire `trust.list`, F.wire-settings §3.3.1)
   */
  list(): Promise<Result<readonly TrustListing[], TrustStoreError>>;
}

/** normalize는 심볼릭 링크를 푼 정규 경로를 돌려준다. clock은 decidedAt에 쓴다. 클래스를 두지 않는다(eng.typescript.guide TY-16) */
export function createProjectTrustStore(backend: TrustStoreBackend, normalize: (path: string) => Promise<string>, clock: { now(): number }): ProjectTrustStore;

export type TrustStoreError =
  | { readonly kind: "corrupt"; readonly reason: string }
  | { readonly kind: "io"; readonly cause: unknown };

/**
 * pi getProjectTrustOptions 포크. §4.7.3 표의 선택지 다섯 개와 저장할 갱신(TrustOption은 F 타입). 상위 폴더가 없으면(parent가 null)
 * 상위 선택지를 뺀다. label은 L4가 현지화할 식별자이고 표시 문구는 담지 않는다(trust-folder, trust-parent, trust-session, deny-folder,
 * deny-session). 세션 선택지의 updates는 비어 있고 호출자가 sessionMemory에 둔다
 */
export function trustOptions(projectRoot: string, parent: string | null): readonly TrustOption[];

/** pi hasTrustRequiringProjectResources 포크(§4.7.2) */
export const TRUST_REQUIRING_PROJECT_RESOURCES: readonly string[];
export function findTrustRequiringResources(fs: LoaderFs, projectRoot: string, homeDir: string): Promise<readonly string[]>;

export type TrustVia =
  | "override" | "notRequired" | "point" | "store" | "sessionMemory" | "default" | "prompt" | "headless" | "corruptStore";

export interface ProjectTrustResult {
  readonly projectRoot: string;
  /** 신뢰 필요 자원이 있었는가 */
  readonly required: boolean;
  readonly trusted: boolean;
  readonly verdict: TrustVerdict;
  readonly via: TrustVia;
  /** 찾은 신뢰 필요 자원(작업 폴더 루트 기준 상대 경로) */
  readonly resources: readonly string[];
  /** 결정을 저장하려다 실패했다(손상된 저장 파일 등). 결정은 유효하다. 호출자가 trust_store_corrupt 진단을 남긴다 */
  readonly storeError?: TrustStoreError;
}

export interface ResolveProjectTrustInput {
  readonly projectRoot: string;
  readonly mode: LoaderMode;
  readonly trustOverride?: boolean;
  readonly defaultProjectTrust: "ask" | "always" | "never";
  readonly store: ProjectTrustStore;
  readonly fs: LoaderFs;
  readonly homeDir: string;
  readonly prompter?: TrustPrompter;
  /** project_trust 지점 디스패치. X.primitives의 디스패처를 감싼 함수 */
  readonly emitProjectTrust: (cwd: string, signal: AbortSignal) => Promise<
    { readonly trusted: "yes" | "no"; readonly remember?: boolean } | undefined
  >;
  /** 이번 호스트 프로세스 동안만 유지하는 결정 */
  readonly sessionMemory: Map<string, "allow" | "deny">;
  readonly signal: AbortSignal;
}

export function resolveProjectTrust(input: ResolveProjectTrustInput): Promise<ProjectTrustResult>;
```

- `emitProjectTrust`의 반환 형태는 pi `ProjectTrustEventResult`(`types.ts:693-696`)에서 `undecided`를 뺀 것이다. 정본은 F.extensions.spec §3.5.1의 `ProjectTrustDecision`(`{ trusted: "yes" | "no"; remember?: boolean }`)이고, 위 반환 형태와 같다.

### 3.8 프로세스 격리 (`isolation/`) [구현: M5b-1, 2026-11-18]

사용자·프로젝트 등급 플러그인은 플러그인 호스트 프로세스에서 돈다(설계 정본 `review.m5-drive-isolation` §3, 프로토콜 정본 `F.extensions.spec` 부록과 `contracts/src/extensions/isolation-protocol.ts`). 통신은 앱과 엔진 사이에 쓰는 줄 단위 JSON이고 새 외부 의존을 더하지 않는다(옛 구상의 `vscode-jsonrpc`는 쓰지 않는다).

| 모듈 | 내용 |
|---|---|
| `isolation/framing.ts`(`frame-line.ts`, `framing-types.ts`, `transfer-read.ts`, `transfer-write.ts`) | 줄 단위 프레임 읽기·쓰기와 큰 줄의 조각 전송(§4.9.3). 줄 상한 `PLUGIN_HOST_MAX_FRAME_BYTES`(16 MiB), 넘으면 `frame_too_large` 값. 옵션을 주면 조각으로 보낸다 |
| `isolation/child-runtime.ts`, `child-api.ts`, `params.ts` | 호스트 프로세스 안의 실행기 `runPluginHost`. 엔트리를 import하고 `g`와 `hostOf(g)`의 얇은 대리 객체를 만든다. 요청마다 실려 온 상태·설정 스냅샷을 즉시 읽기(`g.state()`, `settingValue`)에 쓴다 |
| `isolation/supervisor.ts` | 엔진 쪽 프로세스 관리: 처음 불릴 때 띄우기, 한동안 안 불리면 내리기(`idleMs`), 시간 초과 때 프로세스 종료(`process_killed`), 비정상 종료(`process_exit`)와 재시작 한도, 표준오류 수집 |
| `isolation/engine-calls.ts` | 호스트가 보내는 `engine.call`(`commit`, `record`, `post`, `capability`, `runScript` 등)을 엔진의 실제 `g`로 잇는 길. `replay`면 쓰기는 버리고 `capability`는 `replay_mode_denied` |
| `isolation/script-runner.ts` | [구현: 설계 B, 2026-11-18] 매니페스트 `scripts`의 스크립트를 띄우는 실행기 `createScriptRunner`(`PluginScriptPort`를 구현한다). 확장마다 하나다. 규칙은 아래 "스크립트 실행" |
| `isolation/proxy-entry.ts` | 선언(`host.init` 응답)으로 같은 등록을 엔진의 ExtHost에 만들고 훅·도구·명령·메서드마다 대리 핸들러를 건다. 스트림 지켜보기 훅(`PLUGIN_HOST_NOTIFY_HOOKS`)은 응답을 기다리지 않는 알림이다 |
| `isolation/effective.ts` | 격리 여부 결정(§4.9.0) |

```ts
// 자식 프로세스 기동 포트와 부속 타입은 F가 정본이다(F.extensions.spec §3.2.1). 구현은 platform-process(서비스 fresnel.process)다
export type { IsolationProcessPort, IsolationSpawnSpec, IsolatedChild, IsolationSpawnError } from "@fresnel/contracts/extensions";
// 로더 의존: LoaderDeps.process와 LoaderDeps.isolation(launch, setTimer, idleMs, maxRestarts(함수), restartWindowSec(함수), maskSecrets, onRestartLimit, onSupervisor)가 모두 있어야 격리가 켜진다
// 스크립트 실행기 의존(선택): LoaderIsolation.runner(실행기 이름 → 절대 경로), LoaderIsolation.allowedEnv(허용 환경 값). 없으면 스크립트는 띄우지 않는다
```

**스크립트 실행 [제안, 설계 B].** 격리 자식의 `g.runScript(name, {stdin?})`는 `engine.call` 메서드 `runScript`다(`PLUGIN_ENGINE_CALLS`). 엔진 쪽 처리기는 `engine-calls.ts`의 `runScript` 분기이고, 실행은 확장마다 만든 `createScriptRunner`(`script-runner.ts`)가 한다. 검사 순서는 F.extensions.spec §3.1.4의 `PluginScriptPort`를 따른다.

1. 선언: 매니페스트 `scripts`에 이름이 있어야 한다. 없으면 `script_not_declared`.
2. 위치: 파일 이름이 절대 경로, `..`, 백슬래시, NUL이면 `script_outside_tree`. 실제 위치(심볼릭 링크를 푼 것)가 확장 폴더 밖이면 `script_outside_tree`. 찾지 못하거나 일반 파일이 아니면(폴더 포함) `script_missing`. 파일 시스템 오류도 찾지 못한 것으로 본다.
3. 승인: 검토된 버전은 바로 뜬다. 초안은 승인 문(`ScriptRunnerDeps.draftGate`, 조립 루트가 `LoaderIsolation.scriptGate`로 준다)이 있고 호출한 대화(`ScriptRunRequest.threadId`, 훅이나 주도의 문맥에서 엔진이 붙인다)가 있을 때만 승인 카드를 거쳐 뜬다(드래프트 승인 `auto`인 테스트 런은 카드 없음, 그 밖에는 스크립트마다 처음 한 번만 묻고 같은 초안 내용의 같은 스크립트는 그 테스트 런 동안 다시 묻지 않는다. `[결정: 2026-11-19, 사용자, AGE-58]`, L1.tools §4.6.1 6c). 그 밖에는 `script_not_approved`다(문이 없음, 대화 없음). 순서는 선언, 위치, 승인 문 유무, replay, 실행기, (초안만) 격리 가능 여부, 카드다. 격리를 쓸 수 없으면 카드를 열지 않고 `sandbox_unavailable`이다. 카드 내용(`ScriptCard`)은 실행기 절대 경로, 인자(스크립트 절대 경로 포함), 자식에게 실제로 넘어가는 환경 변수 이름, 표준 입력 바이트 수와 앞 200자(가림 규칙을 지난 값, 가림 수단이 없으면 빈 값)다. 카드는 `uses`도 싣는다. 열린 정책의 스크립트(승인된 플러그인, 설정을 끈 승인 전 드래프트)는 `sandbox_full_access`(셸 도구와 같이 읽고 쓰고 시스템 도구를 쓴다, 막는 것은 보호 셋뿐), `user_environment`(자식 env는 사용자 환경에서 `FRESNEL_` 이름만 뺀 것), `network`(차단 목록 밖 전체)다. 설정 `narrowDrafts`를 켠 승인 전 드래프트의 좁은 길은 `system_tools`(`/bin`, `/usr/bin`의 도구를 읽고 실행)와 `network`뿐이고, 쓰기와 폴더 밖 읽기는 없다 [결정: 2026-11-21, 사용자, AGE-63; 제안, AGE-58]. 구현 승인 문은 `apps/host/src/assembly/plugins/script-gate.ts`다(L4.host-service §4.27 (c)). 스크립트 실행기가 도는 샌드박스는 도구를 막아도 네이티브 호출로 열리는 길(다른 프로세스 정보, IOKit 속성, 전원 관리, 배포 알림, LaunchServices 데이터베이스)을 프로필에서 닫았고, `launchd` 직접 통신은 막을 수 없어 열려 있다(L0.sandbox §4.9, 미결 13). 카드의 "코드 실행" 안내가 이 열림을 사용자에게 알리는 자리다 [결정: 2026-11-19, 사용자, AGE-58 "1-다 2-가": 이 길은 지금대로 두고 카드 안내와 승인에 기댄다. 더 강한 격리는 후속 이슈]. 검토 카드의 스크립트 줄(`CardScript.uses`)도 같은 `uses`를 싣는다. 실행기 `python3`는 PATH의 shim을 푼 실제 인터프리터의 설치 폴더를 읽기로 열어(`ScriptRunnerDeps.runnerReadRoots`, `IsolationSpawnSpec.runtimeReadRoots`) 돌고, 스크립트 환경에 `PYTHONDONTWRITEBYTECODE=1`을 준다(L0.sandbox §4.9). 가져온 훅 플러그인의 끝까지 시험(훑기 → 적용 → 승인 → 격리 자식의 실제 훅 → 막기·통과, 256 KiB 초과 입력은 묻기 카드)은 `apps/host/test/int/migration-hook-run.int.test.ts`다. [결정: 2026-11-19, 사용자, AGE-58 (3)]
4. 돌려 보기: `replay`면 띄우지 않고 `replay_mode_denied`다. 후보 실행기(`candidate-runner.ts`)도 같은 값으로 거부한다.
5. 실행기 이름: 조립 루트가 준 `runner(name)`이 절대 경로를 돌려야 한다. 없으면 `spawn_failed`(`code: runner_unavailable`).
6. 띄우기: `IsolationProcessPort.spawn`이 전부다. 정책은 호출이 고른다: `narrow`(승인 전 드래프트이고 설정 `l0.sandbox.narrowDrafts`가 켜졌을 때만. 드래프트의 플러그인 프로세스도 같다: `createIsolatedEntry`의 `narrow()`가 호출마다 읽는다)면 쓰기 없음 프로필과 읽기 허용 목록이고, 그 밖의 호출은 열린 정책이다(셸 도구와 같이 읽고 쓰고, 보호 셋만 막는다) [결정: 2026-11-21, 사용자, AGE-63]. 명령은 실행기 절대 경로, 인자는 `[검사를 통과한 실제 파일, ...args]`, `readRoot`는 확장 폴더, 라벨은 `script:<확장>:<스크립트>`다. 환경은 선언된 `envNames` 가운데 허용 값이 있고 시크릿 거부 패턴(`SENSITIVE_ENV_PATTERNS`)에 걸리지 않는 것을 `spec.env`로 싣는다. 부모 값은 어느 정책이든 셸 도구와 같은 허용 목록(`BASE_ENV_PASS_NAMES`)만 자식에 가고 `FRESNEL_` 값은 가지 않는다 [결정: 2026-11-22, 사용자, AGE-63]. 샌드박스를 쓸 수 없으면 `sandbox_unavailable`이고 격리 없이 띄우지 않는다.
7. 표준 입력: UTF-8로 쓰고 닫는다. 상한 `SCRIPT_LIMITS.stdinBytes`(256 KiB)를 넘으면 라우터가 `invalid_params`로 거절한다(호출하는 쪽의 오류이고 값이 아니다). [제안]
8. 표준 출력과 표준 오류: 각각 `SCRIPT_LIMITS.outputBytes`(64 KiB)까지 모으고 넘는 부분은 버린다(`truncated`). 종료는 자식이 끝나고 표준 출력이 닫힌 뒤다.
9. 기한: `timeoutMs`(생략하면 10초, 상한 60초)가 지나면 프로세스 트리를 `SIGKILL`로 죽이고 `timedOut: true`, `exitCode: null`, `signal: "SIGKILL"`로 답한다.
10. 값: 거절과 기동 실패는 모두 `Result`의 `error` 값이다. 엔진 호출 자체의 오류(`invalid_params`, `unknown_target`)만 응답의 `error`다. 자식의 `runScript`는 응답 모양이 맞지 않으면 `invalid_result` 엔진 오류로 던진다.
11. 공개 타입: 자식 대리 객체의 `ChildScriptApi`는 공개 이름이 아니다. 공개 타입은 P 층 `OrchestrationApi.runScript`(L3.group-sdk.spec §3.2)다. 같은 모양이고 값은 `Result<ScriptRunResult, ScriptRunFailure>`다. F `RegistrationApi`에는 더하지 않았다 [제안]. 엔진 안 등록에는 실행기가 없으므로 orchestration-sdk의 `wrap`이 `sandbox_unavailable`(reason `in_engine_registration`) 값을 준다 [제안].

**환경 모드 [결정: 2026-11-20, 사용자, AGE-58 원칙 가("가져온 스크립트는 원래 돌던 환경에서 돈다"); 아래 세부는 [제안]].** 선언에 `env`(F.extensions §3.1)가 있는 스크립트는 위 1~11 대신 다음 순서로 돈다. 구현은 `script-runner.ts`의 `runEnv`다.

1. **자격(가장 중요한 안전 조건).** `ScriptTarget.envGrant.granted`가 참이고 검토된 버전(초안 아님)일 때만 돈다. `envGrant`는 로더가 `ExtensionCandidate.importedScripts`(검토본 후보만 가진다)에서 만들고, 그 값은 호스트가 승인한 검토본의 기록(`meta.json`의 `importedScripts`, 승인한 검토 항목의 출처가 `migration`일 때만 `review.ts`가 쓴다)에서만 온다. 매니페스트의 `env`는 권한이 아니다. 초안, 사용자 폴더 플러그인, 빌더가 만든 플러그인, 손으로 만든 선언은 `script_env_not_granted`이고 좁은 모드로 바꿔 돌지 않는다(초안은 승인 문도 열지 않는다). 프로젝트 폴더가 정해지지 않아도(`ScriptRunnerDeps.projectDirOf(threadId)`가 대화의 프로젝트 루트, 없으면 대화 폴더를 준다. `envGrant.projectDir`가 대체값) 같은 실패다.
2. 동반 파일(`file`)이 플러그인 폴더 안의 일반 파일이어야 한다(위치 검사 3~4번). 돌려 보기는 `replay_mode_denied`다. 옛 길(설정 `l0.sandbox.sandboxImportedHooks`를 켰을 때)에서 격리를 쓸 수 없으면 `sandbox_unavailable`이다. 기본 길은 격리를 쓰지 않으므로 이 검사가 없다 [근거: `xeon/packages/ext-host/src/isolation/script-runner.ts`의 `runEnv`는 기본 길에서 `hookProcess` 포트만 부른다] [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"].
3. **지문 확인.** `refs`의 지문이 있는 파일마다 실행 직전에 본다. 없으면 `script_ref_changed(missing)`, 읽지 못하면 `unreadable`, 지문이 다르면 `changed`이고 스크립트는 돌지 않는다. 가져올 때 지문을 못 낸(null) 참조는 실행 때 확인하지 않고 돈다. 파일이 있든 없든 막지도 묻지도 않는다. `refsKnown`이 거짓인 선언(참조 파일을 찾지 못한 훅)도 확인 없이 돈다. 이때 카드가 "알 수 없음"이라고 말하는 것이 유일한 안내다 [결정: 2026-11-20, 사용자, AGE-58 "허용 중심"]. 지문이 있는 참조가 바뀌었을 때 묻는 것은 그대로다. 근거는 다른 하네스(Codex CLI, Gemini CLI)도 바뀐 훅을 다시 확인한다는 점이다 [결정: 2026-11-20, 사용자, AGE-58]. 훅은 도구 호출마다 돌므로 비용을 줄인다: 파일마다 크기와 수정 시각을 먼저 `stat`하고, 지난번에 같은 지문으로 확인한 파일과 크기·수정 시각·기대 지문이 모두 같으면 내용을 다시 읽지 않는다(호출당 `stat` 한 번, 바뀐 파일만 한 번 해시). 확인과 띄우기 사이의 틈은 막지 못한다(확인 직후에 파일이 바뀌면 그 호출은 바뀐 파일로 돈다). 명령 문자열 자체가 원래 하네스의 설정에서 바뀐 경우는 이 확인이 보지 못한다: 가져오기를 다시 해야 반영된다.
4. **환경.** `ScriptRunnerDeps.userEnv()`의 사용자 환경을 그대로 넘긴다. 빼는 것은 Fresnel 자신의 내부 값뿐이다: 이름이 `FRESNEL_*`에 맞는 것(대소문자 무시, 앞 밑줄 포함)과 잘못된 이름이다. 사용자의 `*_TOKEN`, `AWS_*`, `SSH_AUTH_SOCK`, `ANTHROPIC_*`, `NODE_OPTIONS`는 넘긴다 [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"]. `CLAUDE_PROJECT_DIR`를 프로젝트 폴더로 채운다. 선언의 `envNames`와 `BASE_ENV_POLICY`는 쓰지 않는다. 옛 길(설정을 켰을 때)은 시크릿 거부 패턴(`SENSITIVE_ENV_PATTERNS`)에 걸리는 이름과 잘못된 이름을 뺀다. 그 목록에는 `FRESNEL_*`, `*_TOKEN`, `AWS_*`, `ANTHROPIC_*`, `NODE_OPTIONS`, `BUN_OPTIONS`가 든다. 앞 밑줄이 붙은 `_FRESNEL_*`는 이 목록에 걸리지 않는다. 제공자 키와 `BUN_OPTIONS`·`NODE_OPTIONS`를 기본 길에서도 뺄지는 [미결](§10 27번)이다 [근거: `review/m5/migration.md` §11 Q17]. 호스트의 `userEnv`는 사용자의 로그인 셸을 한 번 띄워 환경을 읽는다(L4.host-service: `user-env.ts`; 시간 제한 5초, 10분 캐시, 실패하면 엔진 프로세스의 환경, 값은 기록하지 않고 변수 개수와 PATH 항목 개수만 기록한다).
5. **띄우기.** `<shell> -c "<command>"`(`shell`은 `sh` 또는 `bash`, 실행 파일은 `runner(shell)` 아니면 `/bin/<shell>`), 작업 폴더는 프로젝트 폴더다. 기본 길은 `HookProcessPort.run`(외부 훅 실행 포트)으로 샌드박스 없이 띄운다. 프로세스 트리 정리, 기한, 출력 상한을 포트가 맡고, Linux도 같다(bwrap을 쓰지 않는다). 옛 길(설정을 켰을 때)은 `IsolationProcessPort.spawn`에 `scriptEnv = {projectDir, readCarveOuts}`를 주고 L0.sandbox "스크립트 환경 프로필"로 띄운다 [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"]. `readCarveOuts`는 보호 경로 안에 있는 참조 파일의 읽기 예외다(`readCarveOutsOf`: 보호 경로의 하위 폴더에 있으면 그 폴더, 보호 경로 바로 아래면 그 파일 하나). 검토 카드의 `CardScript.uses`는 기본이 `SCRIPT_ENV_USES`(`user_full_access`, `user_environment`, `network`), 옛 길을 켰을 때가 `SCRIPT_ENV_SANDBOXED_USES`(`user_environment`, `read_wide`, `write_project`, `network`)다. 값은 검토 항목을 만들 때의 설정으로 정한다(`review.ts`가 `deps.envSandboxed?.()`를 본다).
6. **종료 코드와 기록.** 종료 코드의 뜻(0 통과, 2 막기와 표준 오류가 사유, 시간 제한)은 기존 훅 계약대로다. 막지 않는 오류(2가 아닌 비정상 종료, 기한, 신호)는 진행하되 `script.env_failed` 경고로 표준 오류 끝 512자(가림 규칙을 지난 값)와 종료 코드를 로그에 남긴다. 값은 남기지 않는다. 턴 기록의 Hook 행에는 실패 사유를 실을 칸이 없어(`TraceHandlerEntry.reason`은 핸들러가 던진 이유의 닫힌 목록) 새 저장 기록 종류를 만들지 않고 [미결]로 남긴다.
7. **훅을 돌릴 수 없을 때**: 실행 파일 없음(127), 실행 불가(126), 띄우기 실패(포트의 `spawnError`, 외부 훅 실행 포트가 없으면 `hook_process_unavailable`), 지문이 있는 참조의 불일치·없음·읽기 실패, 환경 모드 자격 없음(`script_env_not_granted`)은 `outcomeOf`가 이들을 "통과"로 두지 않고 `unrunnable`로 바꾸고 `tool.call.before`는 묻기(`ask`, 사유 "훅을 돌릴 수 없어요: …. 계속할까요?")로 답한다(`adapter-hooks@5`, migration.md §4.3.5). 옛 길에서 격리를 쓸 수 없는 `sandbox_unavailable`도 묻는다. 기본 길에는 쓰기 거부나 격리 불가로 묻는 경우가 없다 [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"]. 기한 초과(`timedOut`)는 지금 어댑터가 통과로 둔다. 묻기로 바꿀지는 [미결](§10 28번)이다 [근거: `xeon/packages/plugin-migration/src/adapters/hook-plugin.ts`의 `outcomeOf`]. 결정을 내지 않는 자리는 진행한다(`tool.result`는 결과 뒤에 사유를 붙인다).

환경 모드 훅의 출처(사용자 설정/프로젝트 설정/알 수 없음)는 실행 권한이 아니라 카드 표시다. 값은 호스트가 승인 기록(검토 항목의 카드)에 적은 것만 쓰고 매니페스트에서 읽지 않으며, 출처가 프로젝트여도 자격과 실행은 달라지지 않는다(F.extensions §3.1, migration.md §4.3.5 (자)) [제안, enFp].

### 3.9 SDK 가상 모듈과 기본 플러그인 (`virtual-modules.ts`, `default-plugin.ts`)

```ts
// virtual-modules.ts
/** 플러그인 번들이 호스트와 같은 인스턴스를 쓰게 하는 지정자 */
export const SDK_MODULE_SPECIFIERS: readonly ["@fresnel/contracts", "@fresnel/orchestration-sdk", "typebox"];
/** 지정자 → 호스트의 모듈 객체(보통 `import * as ns`의 결과) */
export type SdkModules = Readonly<Record<string, Readonly<Record<string, unknown>>>>;
export type SdkRegisterError =
  | { readonly kind: "unavailable" }                          // Bun 런타임이 아니다
  | { readonly kind: "conflict"; readonly specifier: string }; // 같은 지정자에 다른 객체가 이미 등록됐다
/** 같은 객체의 재등록은 아무 일도 하지 않는다. 충돌이면 아무것도 등록하지 않는다. 프로세스 전역이다 */
export function registerSdkModules(modules: SdkModules): Result<void, SdkRegisterError>;

// default-plugin.ts
/** 복사에 쓰는 파일 접근. LoaderFs는 읽기 전용이라 조립 루트가 L0.os로 구현해 넘긴다 */
export interface PluginInstallFs {
  readText(path: string): Promise<string | null>;
  listDir(path: string): Promise<readonly { readonly name: string; readonly kind: "file" | "dir" | "symlink" }[] | null>;
  readBytes(path: string): Promise<Uint8Array>;
  writeBytes(path: string, bytes: Uint8Array): Promise<void>;
  makeDir(path: string): Promise<void>;
  removeDir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}
export interface DefaultPluginInstallInput {
  readonly fs: PluginInstallFs;
  /** 릴리즈에 든 기본 플러그인 디렉터리 */
  readonly source: string;
  /** `<userDir>/extensions/<name>/` */
  readonly destination: string;
  /** 임시 디렉터리 뿌리. 탐색 밖, 대상과 같은 파일 시스템. 생략하면 `<userDir>/.staging` */
  readonly stagingRoot?: string;
  /** 있으면 교체할 때 버전 기록을 남긴다(§3.11, §4.4.8). 없으면 기록하지 않는다 */
  readonly history?: VersionHistory;
}
export type DefaultPluginInstallOutcome =
  | { readonly action: "installed"; readonly version: string }
  | { readonly action: "replaced"; readonly version: string; readonly previousVersion?: string }
  | { readonly action: "kept"; readonly version: string; readonly installedVersion: string };
export type DefaultPluginInstallError =
  | { readonly kind: "source_invalid"; readonly message: string }
  | { readonly kind: "io"; readonly message: string; readonly cause: unknown };
export function installDefaultPlugin(input: DefaultPluginInstallInput): Promise<Result<DefaultPluginInstallOutcome, DefaultPluginInstallError>>;
```

- [미결] `PluginInstallFs`의 정본 위치. 쓰기 포트는 F.extensions.spec §3.2.1 로더 포트에 있어야 한다. F 수정 요청.

### 3.10 Plugin UI 검사 (`ui-check.ts`, `app-files.ts`, `ui-settings.ts`) [결정: 2026-10-31 사용자, ADR-0021]

```ts
import type { AppDecl, LoaderFs, Placement, UiDecl, UiMode, UiNode } from "@fresnel/contracts/extensions";
import type { SettingDefInput, SettingGroup } from "@fresnel/contracts/settings";

/** 호스트가 싣는 위젯 카탈로그 버전(ADR-0021 §3.4.1 초안). `ui.widgets` 범위가 이 값을 포함해야 native 화면을 그린다 */
export const HOST_WIDGETS_VERSION: string;   // "1.0.0"
/** 다리 API 버전. contracts의 `BRIDGE_VERSION`(정수 1)을 SemVer로 쓴다 */
export const HOST_BRIDGE_VERSION: string;    // "1.0.0"
/** 화면 JSON 파일 하나의 크기 상한 */
export const UI_FILE_MAX_BYTES: number;      // 1048576

export interface UiPolicy {
  readonly apps: boolean;
  readonly allowProjectApps: boolean;
}
export const DEFAULT_UI_POLICY: UiPolicy;    // { apps: true, allowProjectApps: false }

export interface UiIssue {
  readonly severity: "error" | "warning" | "info";
  readonly code: UiDiagnosticCode;
  /** `/ui/items/<i>/...`. 화면 트리 안의 위치는 `#` 뒤에 JSON Pointer로 붙인다 */
  readonly path: string;
  readonly message: string;
}
type UiItemState = "ok" | "invalid" | "disabled";
export interface UiItemReport {
  readonly id: string;
  readonly placement: Placement;
  /** 실제로 그릴 모드. 앱이 금지되어 `fallback`을 쓰면 `native` */
  readonly mode: UiMode;
  readonly title: string;
  /** 기여 선언의 아이콘 이름(caustic 아이콘 어댑터 이름, DP-17). 선언에 있을 때만 싣는다 [결정: 2026-11-11 사용자] */
  readonly icon?: string;
  readonly state: UiItemState;
  readonly tree?: UiNode;
  readonly app?: AppDecl;
  readonly issues: readonly UiIssue[];
}
/** `ExtensionLoader.uiEntries()`의 원소. 확장 이름을 덧붙인다 */
export interface UiEntryReport extends UiItemReport {
  readonly extension: ExtensionName;
}

export interface UiCheckInput {
  readonly ui: UiDecl;
  /** 확장 루트 절대 경로. 후보의 `root`와 같다 */
  readonly root: string;
  readonly fs: LoaderFs;
  readonly source: InstallSource;
  readonly policy: UiPolicy;
  readonly hostWidgetsVersion: string;
  readonly hostBridgeVersion: string;
}
export function checkUiDecl(input: UiCheckInput): Promise<readonly UiItemReport[]>;

/** 거부 이유. 패키지 안에서만 쓴다(결과 타입에 들어간다) */
type AppFileRejection = "outside_root" | "not_found" | "not_a_file" | "forbidden_type";
export type AppFileResult =
  | { readonly ok: true; readonly path: string; readonly contentType: string }
  | { readonly ok: false; readonly reason: AppFileRejection };
export interface ResolveAppFileInput {
  /** 확장 루트 절대 경로 */
  readonly extensionRoot: string;
  readonly app: AppDecl;
  /** app root 안의 URL 경로. 빈 문자열이면 `app.entry` */
  readonly requestPath: string;
  readonly fs: LoaderFs;
}
export function resolveAppFile(input: ResolveAppFileInput): Promise<AppFileResult>;

/** `x.ui.apps`, `x.ui.allowProjectApps`(§6). `defineSettings("x.ui", …)` */
export declare const uiSettings: SettingGroup<"x.ui", {
  readonly apps: SettingDefInput;
  readonly allowProjectApps: SettingDefInput;
}>;
```

- `UiDiagnosticCode`는 §3.4에 있다. `UiDecl`, `UiContribution`, `AppDecl`, `UiNode`, `validateUi`, `validateUiTree`, `isEntryInsideRoot`, `UI_LIMITS`, `BRIDGE_VERSION`은 F.extensions.spec §3.1.1(`ui.ts`, `validate.ts`)이 정본이고 이 문서는 이름으로 인용한다.
- `checkUiDecl`과 `resolveAppFile`은 `LoaderFs` 포트만 쓴다. 경로 포함 검사(`within`)와 종류 판정(`kindOf`, 부모 폴더 나열로 구한다)은 패키지 안 내부 함수다.
- 앱 정책은 `LoadOptions.uiPolicy`로 로더에 들어온다. `uiSettings`의 값을 읽어 넘기는 일은 조립 루트(L4 host)가 한다(§8).

### 3.11 버전 기록 (`version-history.ts`) [제안: X-8, M4 T-XV]

```ts
// version-history.ts
import type { ExtRollbackResult, ExtVersionEntry } from "@fresnel/contracts/wire";

/** 보관 항목의 출처. `ExtVersionEntry.source`와 같다 */
export type VersionSource = ExtVersionEntry["source"]; // "bundled" | "user" | "authored"

/** 버전 기록의 파일 접근. 없으면 null이나 false, 입출력 실패는 거부다. 구현은 조립 루트(L4 host)가 node:fs로 만든다 */
export interface VersionHistoryFs {
  readText(path: string): Promise<string | null>;
  /** 임시 파일에 쓰고 옮겨 원자적으로 쓴다. 부모 디렉터리를 만든다 */
  writeText(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  listDir(path: string): Promise<readonly { readonly name: string; readonly kind: "file" | "dir" | "symlink" }[] | null>;
  /** 재귀 복사. `to`는 없어야 한다 */
  copyDir(from: string, to: string): Promise<void>;
  /** 디렉터리와 그 아래를 지운다. 없어도 오류가 아니다 */
  removeDir(path: string): Promise<void>;
  /** `to`는 없어야 한다 */
  renameDir(from: string, to: string): Promise<void>;
}
export interface VersionHistoryDeps {
  readonly fs: VersionHistoryFs;
  /** `<사용자 데이터>/extensions/.history`. 확장 탐색 밖이다 */
  readonly historyRoot: string;
  /** 설치 시각(ms). 주입한다 */
  now(): number;
  /** 매니페스트 텍스트의 해시. 빈 문자열이면 안 된다. 호스트는 sha256 16진수를 준다 */
  hash(text: string): string;
  /** 보관 개수. 생략하면 5. 1 이상의 정수가 아니면 `Bug`다 */
  readonly keep?: number;
}
export interface RecordVersionInput {
  readonly name: string;
  readonly version: string;
  readonly source: VersionSource;
  /** 복사할 설치본 디렉터리 */
  readonly extensionDir: string;
  readonly manifestText: string;
  readonly stateSchemaVersion: number | null;
  /** 정리에서 지우지 않을 버전. 되돌리기가 지금 설치본을 기록하는 동안 대상 버전을 지킨다(§4.4.8) */
  readonly protectVersion?: string;
}
export interface VersionRecordOutcome {
  /** 보관 개수를 넘어 지운 버전(새 것부터) */
  readonly pruned: readonly string[];
  /** 정리가 첫 실패에서 멈췄으면 그 원인. 기록은 이미 끝났다 */
  readonly pruneFailure: { readonly cause: unknown } | null;
}
export type VersionSkipReason = "dir_missing" | "meta_missing" | "meta_not_json" | "meta_invalid" | "version_mismatch";
export interface VersionListing {
  /** 설치 시각이 늦은 것부터. 같으면 버전 번호가 높은 것이 앞이다 */
  readonly versions: readonly ExtVersionEntry[];
  readonly skipped: readonly { readonly version: string; readonly reason: VersionSkipReason }[];
}
/** 되돌리기가 부르는 호스트 훅. 끄기와 켜기는 확장 등록 상태를, 상태 비우기는 확장 상태 저장소를 바꾼다 */
export interface RollbackHooks {
  disable(name: string): Promise<void>;
  enable(name: string): Promise<void>;
  clearState(name: string): Promise<void>;
  /** 있고 `hotReload`가 거짓이 아니면 끄기·켜기·상태 비우기 대신 쓴다(§4.4.4, §4.4.8). 새 버전이 열리지 못하면 던진다 */
  reload?(name: string, options: { readonly clearState: boolean }): Promise<RollbackReloadOutcome>;
}
export interface RollbackReloadOutcome {
  readonly stateCleared: boolean;
}
export interface RollbackVersionInput {
  readonly name: string;
  /** 되돌릴 보관 버전 */
  readonly version: string;
  /** 참이면 상태를 비우고 되돌린다. 내려가는 마이그레이션이 없을 때 쓴다 */
  readonly clearState?: boolean;
  /** 지금 설치본 디렉터리, 그 버전, 그 상태 스키마 버전(모르면 null) */
  readonly extensionDir: string;
  readonly currentVersion: string;
  readonly currentStateSchemaVersion: number | null;
  /** 생략하면 참. 거짓이면 `appliesAt`이 `restart`다 */
  readonly hotReload?: boolean;
  readonly hooks: RollbackHooks;
}
export type VersionHistoryError =
  | { readonly kind: "invalid_name"; readonly name: string }
  | { readonly kind: "invalid_version"; readonly version: string }
  | { readonly kind: "io"; readonly cause: unknown }
  | { readonly kind: "not_found"; readonly version: string }
  | { readonly kind: "state_schema_mismatch"; readonly targetSchemaVersion: number; readonly currentSchemaVersion: number }
  | { readonly kind: "disable_failed"; readonly cause: unknown }
  | { readonly kind: "swap_failed"; readonly step: "record" | "stage" | "move_current" | "place"; readonly cause: unknown; readonly restored: boolean; readonly reenabled: boolean; readonly followUps: readonly { readonly step: "restore" | "enable"; readonly cause: unknown }[] }
  | { readonly kind: "clear_state_failed"; readonly cause: unknown }
  | { readonly kind: "enable_failed"; readonly cause: unknown }
  | { readonly kind: "reload_failed"; readonly cause: unknown; readonly restored: boolean };
export interface VersionHistory {
  record(input: RecordVersionInput): Promise<Result<VersionRecordOutcome, VersionHistoryError>>;
  list(name: string, currentVersion: string): Promise<Result<VersionListing, VersionHistoryError>>;
  rollback(input: RollbackVersionInput): Promise<Result<ExtRollbackResult, VersionHistoryError>>;
}
export function createVersionHistory(deps: VersionHistoryDeps): VersionHistory;
```

- 파일 접근, 시계, 해시를 주입받으므로 X는 L0를 import하지 않는다. 예상 가능한 실패(없는 버전, 상태 스키마 불일치, 입출력 실패, 훅 실패)는 모두 `Result`의 오류 값이다.
- 공개 이름은 X.primitives.spec §3.1 표에 있다. `ExtVersionEntry`와 `ExtRollbackResult`는 F.wire-settings.spec(`wire/ext-read.ts`)의 타입이다.
- [미결] `VersionHistoryFs`의 정본은 `PluginInstallFs`와 같이 F.extensions.spec §3.2.1 로더 포트여야 한다(§10 23번).

## 4. 동작 규칙

### 4.1 기본 로딩 방식

- [결정] 기본 로딩은 같은 프로세스의 Cordis 플러그인이다. 격리는 확장마다 사용자가 켜는 2차 선택이다(§1 근거).
- [제안] 로더는 검증을 마친 확장을 `ExtensionUnit`(정규화 매니페스트, 엔트리, `loadIndex`, `builtin`)으로 만들어 `ExtHost.install(unit)`에 넘긴다(X.primitives.spec §3.2). 엔트리 호출, Registration 정의 수집(플러그인마다 하나), 세대마다의 Cordis fiber 생성, setup 실행과 시간 예산, setup 직후 `validateUsage`(그 Registration의 플러그인 항목으로)는 primitives가 한다(X.primitives.spec §4.5.3, §4.5.6). 로더는 `InstallResult`를 진단으로 옮긴다(§4.4.3).
- 로더는 Cordis(`@fresnel/vendor-cordis`)를 import하지 않는다. Cordis import는 `src/primitives/cordis-bridge.ts` 한 파일이다(X.primitives.plan §2). Cordis 객체(`Context`, `Fiber`)는 확장 코드에 넘기지 않는다(adr.0002 §3).
- 로드 세대는 엔트리를 다시 실행하는 단위(핫 리로드, 격리 재시작)다. scope를 켤 때마다 바뀌는 scope 세대(X.primitives.spec §2)와 다르다. 다시 로드할 때 로더는 `ExtHost.uninstall` 뒤 새 `install`을 부른다. 세대 번호는 `LoadedExtensionInfo.generation`과 진단 레코드에 남긴다.

### 4.2 탐색 규칙

#### 4.2.1 설치 위치와 매니페스트 파일

| 설치 위치 | 경로 [가정: 기준 디렉터리는 L0.os가 정한다] | 매니페스트 | 등급 상한 |
|---|---|---|---|
| `builtin` | 조립 루트가 넘기는 `BuiltinExtensionModule[]` | 모듈의 `manifest` 상수 | `builtin` |
| `managed` | `<managedDir>/extensions/<dir>/` | `.fresnel-plugin/plugin.json` | `user` |
| `user` | `<userDir>/extensions/<dir>/`, `x.loading-trust.paths`의 각 경로(`extensions/`와 같은 모양의 디렉터리, 그 아래 한 단계가 확장 하나) [제안] | `.fresnel-plugin/plugin.json` | `user` |
| `project` | `<projectRoot>/.fresnel/extensions/<dir>/` | `.fresnel-plugin/plugin.json` | `project` |

- [구현: M5c 검토본 단계] `LoaderDeps.reviewedSource`(검토본 목록 포트)가 있으면 `user`·`project` 위치와 `extraPaths`는 훑지 않고 목록에서 받는다. 목록 항목의 `root`는 검토본 `tree/`이고 후보의 `contentHash`가 된다. 매니페스트 파일이 없는 항목은 `ReviewedSourceEntry.manifest`(호스트가 폴더에서 추론해 준 매니페스트)가 있으면 그것으로 싣는다. 엔트리가 없으므로 코드는 돌지 않고 선언한 플러그인마다 등록 하나만 생긴다(§4.4.2). 추론도 없으면 싣지 않는다 [구현: enC3 2026-11-18, `discover.ts`의 `inferredManifest`, `apps/host/src/assembly/plugins/reviewed-source.ts`]. `managed`만 위 표대로 훑는다. 번들 출처는 사용자 등급으로 싣는다. 포트가 없으면 위 표 그대로다(시험 호환). 목록은 적재 때마다 검토본의 해시를 다시 맞추고 어긋난 항목은 진단 `pinned_corrupt`로 뺀다(`docs/xeon/review/m5/profile-project-loader.md` §4.6). [구현: AGE-41 2026-11-18] 프로젝트 출처 항목은 `ReviewedSourceEntry.projectId`를 싣는다. 로더는 `loadProject`의 `projectId`(또는 `projects: "cwd"`의 `projectIdOf`)와 같은 항목만 싣고, id가 없는 프로젝트 항목은 어느 프로젝트에서도 싣지 않으며 진단 `project_no_id`(경고)를 남긴다. 사용자·번들 항목은 `projectId`가 없고 지금처럼 싣는다. 시험은 `packages/ext-host/test/loading-trust/reviewed-source.test.ts`다. [구현: M5c 3b] `ExtensionLoader.reloadFromReviewed(name, signal, options)`는 검토본 목록의 현재 검토본을 `reload`와 같은 검사와 적용(`replaceUnit`, 단계 경계)으로 다시 읽는다. 기록의 후보가 새 `root`와 `contentHash`로 바뀌고, `LoadedExtensionInfo.contentHash`가 실린 판의 해시를 준다. 검토본 목록이 없으면 `reload`와 같다. 목록에 그 이름이 없으면 `rejected`다.
- 외부 확장의 매니페스트는 확장 루트의 `.fresnel-plugin/plugin.json`이다(F.extensions.spec §3.1, Claude Code `.claude-plugin/plugin.json` 레이아웃, `_research/refs/claude-code.md` 96-99행).
- 내장 패키지는 엔트리 모듈이 `manifest` 상수와 `extension` 엔트리를 named export한다. 로더는 같은 `validateManifest`로 검사한다. 내장 매니페스트도 JSON 파싱 결과와 같은 검사를 받는다.
- 탐색 깊이는 한 단계다. `extensions/` 아래 디렉터리마다 `.fresnel-plugin/plugin.json`이 있으면 후보 하나다. 더 깊이 내려가지 않는다.
- 매니페스트 파일이 없는 디렉터리는 `manifest_missing` 경고만 남기고 건너뛴다. Claude Code의 "매니페스트 없이 표준 레이아웃 자동 탐색"(`_research/refs/claude-code.md` 96행)은 채택하지 않는다 [제안]. 엔트리와 훅 선언이 없으면 정적 검사를 할 수 없기 때문이다.
- 심볼릭 링크는 `realpath`로 풀고, 같은 실제 경로는 한 번만 후보로 둔다. 점으로 시작하는 디렉터리는 확장이 아니므로 건너뛴다. 작업 폴더 위치의 확장이 `.fresnel/extensions` 밖으로 풀리면 후보로 두지 않고 경고(`manifest_missing`)만 남긴다. 저장소가 심볼릭 링크로 밖의 코드를 끌어오지 못하게 하기 위해서다.
- [결정: 2026-11-12 dzX] `x.loading-trust.paths`는 호스트 조립 루트가 재시작할 때 한 번 읽어 로더의 `loadAll` `extraPaths`로 싣는다(`apps/host/src/assembly/settings-sources.ts` `extensionSearchPathsOf`, `external.ts`). 절대 경로는 그대로 쓰고 `~/`는 홈 아래로 푼다(`cap-dialog`의 `~/` 규칙과 같다). 상대 경로는 프로세스 작업 폴더에 기대므로 싣지 않고 `ext.extra_path_ignored` 경고를 남긴다. 프로젝트 위치(`loadProject`)에는 싣지 않는다. 로더의 `LoadProjectOptions`에 그 자리가 없다 [근거: `packages/ext-host/src/loading-trust/index.ts` `LoadProjectOptions`]. [기본값을 따름: 상대 경로는 기준 디렉터리를 정하지 않고 무시한다. 기준을 정하면 여기서 바꾼다]

#### 4.2.2 우선순위와 이름 충돌

- [제안] 같은 `name`이 여러 위치에 있으면 `builtin` > `managed` > `user` > `project` 순서로 앞의 것을 쓴다. 뒤의 것은 `rejected`(`name_conflict`)다. `validateManifestSet`의 `name_conflict`는 같은 위치 안의 충돌에서도 나오며, 이때는 둘 다 `rejected`다.
- 이 순서는 작업 폴더가 내장이나 사용자 확장을 같은 이름으로 대체하지 못하게 한다. 관리 위치는 사용자 위치보다 앞이다(관리 정책).

#### 4.2.3 로드 순서

- [제안] 순서 키는 (설치 위치 순서, 내장 층 순서, 이름)이다. `SOURCE_ORDER`는 `builtin` → `managed` → `user` → `project`, 내장 층 순서는 `L1` → `L2` → `L3` → `plugin`이다. 같은 위치·같은 층은 `name`의 코드 포인트 사전순이다.
- L0 플랫폼 패키지는 매니페스트 층 값(`ExtensionLayerSchema`)에 L0가 없으므로 이 파이프라인 밖에서 조립 루트가 `ExtHost.registerPlatform`(X.primitives.spec §3.2)으로 먼저 등록한다. L0 등록 실패는 시작 실패다.
- 순서는 파일 시스템 나열 순서, 입력 배열 순서와 무관하게 같아야 한다. 이 순서는 디스패치 순서의 두 번째 키다(F.extensions.spec §4.2).
- 설치 순서는 로드 순서와 따로 정한다. 7단계 설치는 `requires`를 만족시키는 공급자를 소비자보다 먼저 설치하도록 로드 순서를 안정 정렬한 순서로 한다(로드 순서와 `loadIndex`는 바뀌지 않는다). `dependsOn`의 `hard` 대상도 같은 정렬에서 소비자보다 먼저 설치한다(AGE-33). 순환 의존은 풀 수 없어 로드 순서대로 설치하고, 관련 확장은 모두 `capability_missing`으로 `error`가 된다. 같은 묶음 안에서 이름이 앞선 소비자가 공급자 때문에 영구 실패하는 일을 막는다.

### 4.3 로드 파이프라인

#### 4.3.1 단계 표

[제안] 확장마다 아래 단계를 차례로 거친다. 한 단계라도 실패하면 그 확장은 표의 상태에서 멈추고 다음 단계를 실행하지 않는다.

| # | 단계 | 입력 → 출력 | 실패 시 상태 | 진단 코드 |
|---|---|---|---|---|
| 1 | 탐색 | 위치 → `ExtensionCandidate` | (후보 없음) | `manifest_missing` |
| 2 | `validateManifest` | JSON 파싱 결과 → 정규화 매니페스트 | `rejected` | `manifest_parse`, `manifest_invalid`(issues 포함) |
| 3 | `validateManifestSet` | 통과한 매니페스트 집합 → 집합 이슈 | `rejected`(오류만) | `name_conflict`, `manifest_invalid` |
| 4 | 신뢰 판정 | 설치 위치, `trust.level`, 작업 폴더 신뢰 → `TrustLevel` | `rejected` | `trust_exceeds_source`, `trust_denied`, `trust_undecided`, `trust_store_corrupt` |
| 5 | 설정 연결 | `settingsFromManifest` + 예약 키 → 설정 그룹 | `rejected` | `settings_rejected`, `settings_reserved_key` |
| 5a | 켜짐 확인 | `ext.<name>.enabled`, 필수 userConfig, `LoadOptions.startup`(`policy.startupFilter`, 2차) | `disabled` | `disabled_by_setting`, `config_required`, `safe_mode`, `disabled_flag` |
| 5a 앞 | 시작 지연 [제안] | `LoadOptions.defaultNames`(없으면 건너뜀). 이름이 기본 집합에 없으면 매니페스트 `defaultEnabled`와 무관하게 싣지 않는다("기본으로 켜짐"은 번들에만 효력이 있다, 2026-11-18 AGE-49). 5a의 켜짐 확인은 이 확장에 하지 않는다(대화가 쓸 때 `ensureLoaded`가 한다). 기본 집합의 플러그인이 hard로 기대는 대상(그 대상의 hard 대상까지)은 미루지 않고 기본 집합에 더해 싣는다(AGE-33 enDep: 미루면 기대는 쪽이 `dependency_missing`으로 멈춘다). soft로만 기대는 대상은 그대로 미룬다 | `disabled` | `lazy_deferred` |
| 5b | 화면 검사 | `checkUiDecl`(§4.3.4): 거부되지 않은 확장의 `ui`를 파일과 정책으로 본다 | 확장 상태는 그대로다. 항목만 `invalid`나 `disabled`가 된다 | `ui_file_missing`, `ui_invalid`, `ui_limit`, `ui_path_invalid`, `ui_mode_not_allowed`, `widgets_unsupported`, `bridge_unsupported` |
| 6 | 기능 요구 충족 | `requires` × 집합의 `provides`·코어 기능 | `error` | `capability_missing` |
| 6 | 의존 확인 | `dependsOn` × 집합의 살아 있는 확장(대상 확장, 구성원, `range`)(AGE-33) | `hard`면 `error`, `soft`면 `warning`(확장은 실패하지 않음) | `dependency_missing` |
| 6a | tier 등록 | `policy.admit`(X.operations.spec §3.8) | `error` | `tier_rejected` |
| 7 | 설치 | 엔트리 import(외부) → `ExtensionUnit` → `ExtHost.install` → `InstallResult` | `error` | `entry_not_found`, `entry_import_failed`, `entry_not_function`, `entry_threw`, `setup_threw`, `setup_timeout`, `setup_action` |
| 8 | 사용 대조 결과 반영 | `InstallResult.setups[].issues`(primitives가 부른 `validateUsage`) → 진단 | `error`(오류만) | `usage_invalid`, `usage_warning` |
| 9 | 활성화 | 시작 적용 결과 확정, provider 연쇄 확인 | `error` | `capability_provider_failed` |

- 2단계의 `unknown_key` 경고는 진단에 남기고 계속한다(F.extensions.spec §4.7).
- `ui`의 모양 오류(`validateUi`의 `ui_invalid`, `ui_limit`, `ui_path_invalid`, `ui_mode_not_allowed`, `ui_duplicate`, `ui_reason_empty`, `widgets_required`)는 2단계에서 매니페스트 거부(`manifest_invalid`)가 된다. 5b단계의 `ui_*` 진단은 파일과 정책을 본 결과이고 확장을 거부하지 않는다(§4.3.4).
- 5a단계의 안전 모드 판정은 `assignTier`로 tier를 구한 뒤 `startupFilter`(X.operations.spec §3.6)를 부른다. 안전 모드에서는 `user`·`project` tier(기본 플러그인 Helm 포함)와 L3 내장 플러그인이 `disabled`(`safe_mode`)이고, `--disable-ext`로 지정한 이름은 `disabled`(`disabled_flag`)다. 빠진 외부 확장은 매니페스트만 읽고 엔트리는 import하지 않는다. 안전 모드에서는 작업 폴더 위치를 탐색하지도, 작업 폴더 신뢰를 묻지도 않는다(`LoadReport.projectTrust`는 null이고 진단 `safe_mode` 하나가 남는다).
- 같은 이름이 여러 위치에 있을 때 위치가 다르면 낮은 순위의 것만 `rejected`이고, 같은 위치 안이면 둘 다 `rejected`다(§4.2.2).
- 3단계는 두 번 실행한다. 첫 번째는 작업 폴더 신뢰 전 집합(내장, 관리, 사용자), 두 번째는 작업 폴더 후보를 더한 집합이다. 두 번째에서 새로 생긴 오류는 작업 폴더 확장만 `rejected`로 만든다.
- `drive_conflict`, `capability_unprovided` 경고는 진단만 남긴다. 실행 중 drive 락은 X.primitives가 하나만 준다.
- 7단계에서 scope setup이 던지거나 시간 예산을 넘으면 primitives가 그 scope의 fiber를 해제해 setup 동안의 등록(on, drive, 리소스, onDispose)을 모두 되돌린다(X.primitives.spec §4.5.3).  시간 예산 값은 X.operations.spec의 `x.operations.budget.setupMs`이고, `ExtHostDeps.setupBudgetMs`로 primitives에 들어간다.
- 7·8단계에서 실패한 확장은 로더가 `ExtHost.uninstall`과 `policy.forget`을 불러 남은 정의와 tier 표 항목을 지운다.
- 8단계의 `hook_undeclared`, `post_undeclared`, `drive_undeclared`, `capability_undeclared`, `record_kind_undeclared`, `read_kind_undeclared`는 오류다. 7단계처럼 등록이 되돌려진 상태이고 `error`로 둔다. `hook_unused`는 경고다(`usage_warning`).
- 시작 때는 첫 turn 전이므로 install이 켜기를 바로 적용한다(X.primitives.spec §4.5.6 시작 적용). 실행 중 `ensureLoaded`처럼 thread가 돌고 있으면 켜기는 다음 단계 경계에 적용되고(F.extensions.spec §4.5), 그 setup 실패는 9단계 뒤 `RegistrationInfo.lastError`로만 보인다 [제안].

#### 4.3.2 실패 격리

- [제안] 내장 필수가 아닌 확장 하나의 실패는 그 확장만 멈춘다. 다른 확장의 단계 진행과 엔진 시작은 계속한다. 이 규칙은 모든 단계에 적용된다(항목 카탈로그 X절 실패 격리 행, .
- 예외 1: `essential: true` 내장 확장이 `rejected`, `disabled`, `error` 중 하나가 되면 `loadAll`은 `essential_failed` 진단과 함께 `LoadAbortError`를 던진다. 조립 루트는 연 자원을 닫고 시작을 거부한다(L4.host-service.spec §4.1). [제안] L1 코어 패키지(`core-*`)의 확장 모듈은 필수다. L2 기능과 L3 플러그인은 필수가 아니다.
- 예외 2: 로더 자신이 쓰는 주입 의존이 없으면 시작 실패다(architecture.layers.spec §4.3.3 1번). 대상은 `host`, `policy`, `LoaderFs`, `LoaderPaths`, `TrustStoreBackend`다. `TrustPrompter`가 없으면 headless로 보고, `IsolationProcessPort`가 없으면 격리 설정 확장만 `error`(`isolation_unavailable`)다.
- 의존 연쇄(AGE-33): `hard` 대상이 활성화되지 못했으면 그 대상에 기대는 확장도 `error`(`dependency_provider_failed`)가 된다. `soft`는 영향이 없다. 대화가 확장을 처음 쓸 때(`ensureLoaded`)는 `hard` 대상을 먼저 싣는다.
- 기능 연쇄: 6단계는 매니페스트의 `provides`로 정적으로 판정한다. 9단계 뒤 실제로 활성화되지 못한 provider가 있으면, 그 기능을 `requires`로 선언한 확장도 `error`(`capability_provider_failed`)로 바꾼다. `optional`은 영향이 없다. 작업 폴더 신뢰 전 집합의 확장이 작업 폴더 확장만 제공하는 기능을 `requires`하면 `capability_missing`이다 [제안].
- 같은 이유로 확장 A의 실패가 B의 setup을 막지 않도록 각 단계는 확장마다 `try`로 감싸고, 진단 레코드만 모은다.

#### 4.3.3 진단 레코드

- 모든 실패와 경고는 `LoadDiagnostic` 하나로 남는다. `issues`에는 `validate*`가 돌려준 `ManifestIssue`를 그대로 담는다.
- 진단은 메모리에 두고 `ExtensionLoader.diagnostics()`로 읽는다. L4는 설정 화면 "플러그인" 탭과 `host.status`에서 보인다(L4.settings-ui.spec, L4.host-service.spec). 보관 상한은 최근 256개이며, 넘치면 가장 오래된 진단부터 버린다.
- 진단을 내구 이벤트로 남길지는 [미결]이다(§10 미결 6). 현재 ext-host가 발행하는 코어 kind 영역은 `scope.`, `lease.`, `post.`이다(F.records.spec §3.3, X.primitives.spec §7). 확장 kind는 `x.`/`grp.` 접두다([결정: review.decisions-2 T-21]).
- `message`에는 시크릿 값, 설정 값, 파일 내용을 넣지 않는다. 경로와 코드만 넣는다.
- 5b단계 진단은 `stage`가 `ui`이고 `path`는 매니페스트 위치(`/ui/items/<i>/...`)다. 화면 트리 안의 위치는 `#` 뒤에 JSON Pointer로 붙인다. `message`는 `ui item "<id>": …` 꼴이다.

#### 4.3.4 Plugin UI 검사 (5b단계) [결정: 2026-10-31 사용자, ADR-0021 §3.2~§3.6]

- 대상은 거부되지 않은 확장 전부다. 꺼진 확장도 검사한다. 설정 화면이 깨진 화면을 보일 수 있게 하려는 것이다. 내장 확장은 확장 루트가 없어 건너뛴다([미결] §10 18번). 작업 폴더 확장은 신뢰된 뒤에만 여기 온다(§4.7).
- 시점은 5a단계 뒤, 7단계 설치 앞이다. 확장의 상태는 바꾸지 않고, 엔트리를 import하지 않는다.
- 입력은 매니페스트 `ui`, 확장 루트, `LoaderFs`, 설치 위치, 앱 정책(`LoadOptions.uiPolicy`), 호스트 위젯 버전 `1.0.0`, 다리 버전 `1.0.0`이다.

항목마다 아래 순서로 본다(`checkUiDecl`).

1. `placement`가 `card`이면 먼저 `forKind`의 주인을 본다(ADR-0021 §3.3, 보고 1). 주인은 자기 kind 접두(Drive를 맡는 플러그인은 `grp.<확장 이름>.`, 그 밖은 `x.<확장 이름>.`)의 kind와 매니페스트 `readsRecordKinds`가 덮는 kind(끝의 `*`는 접두 일치)입니다. 어느 것도 아니면 항목은 `invalid`이고 `ui_invalid`(위치 `/ui/items/<i>/forKind`)가 붙으며, 파일과 앱을 보지 않고 항목은 `forKind`를 싣지 않는다. 매니페스트 검사(F)는 kind의 주인을 보지 않으므로 이 검사가 맡는다. `placement`가 `command`면 화면이 없으므로 파일과 앱을 보지 않는다. 상태는 `ok`다.
2. `native`(`mode` 생략 포함)는 `file`을 확장 루트 안에서 찾는다. 없거나 종류가 다르면 `ui_file_missing`, 밖을 가리키면 `ui_path_invalid`다. 본문이 1 MiB(`UI_FILE_MAX_BYTES`)를 넘으면 `ui_limit`이다. LoaderFs에 크기를 묻는 함수가 없어 다 읽은 뒤에 잰다. JSON이 아니면 `ui_invalid`다(파서 원문은 싣지 않는다). 앞의 BOM은 건너뛴다. `validateUiTree`가 실패하면 그 이슈를 옮긴다(`ui_invalid`, `ui_limit`, 위치는 `#` 뒤 JSON Pointer). 통과하면 `tree`를 붙인다.
3. `app`은 정책을 먼저 본다. `x.ui.apps`가 거짓이면 전체가 막힌다. 설치 위치가 `project`이고 `x.ui.allowProjectApps`가 거짓이면 작업 폴더 확장이 막힌다. 막히면 앱 파일은 보지 않는다. `fallback`이 있으면 그 파일을 2번처럼 native 화면으로 읽고 검사한다. 모드는 `native`가 되고 정보 진단 `ui_mode_not_allowed`(severity `info`)가 붙는다. `fallback`이 없으면 상태는 `disabled`이고 경고 진단 `ui_mode_not_allowed`(severity `warning`)가 붙는다.
4. 정책이 허용하면 `app.root`가 확장 안의 폴더인지 보고(없으면 `ui_file_missing`, 밖이면 `ui_path_invalid`), `app.entry`가 `app.root` 안의 파일인지 본다. 그다음 `app.bridge`가 다리 버전 `1.0.0`을 포함하는지 본다(아니면 `bridge_unsupported`, 위치 `/ui/items/<i>/app/bridge`).
5. `ui.widgets` 범위가 `1.0.0`을 포함하지 않으면 native로 그리는 항목 모두(fallback으로 바뀐 항목 포함)에 `widgets_unsupported`(위치 `/ui/widgets`)를 붙이고 `invalid`로 둔다.

상태 규칙: `error` 진단이 하나라도 있으면 `invalid`, 없으면 `ok`다. 정책이 막고 대체 화면도 없으면 `disabled`다. `disabled`는 정책이 낸 상태이고, 확장이 꺼진 것은 확장의 `LoadState`가 나타낸다.

- 실패 격리: 화면 진단은 확장의 진단 목록에 항목마다 하나씩 남는다(`LoadDiagnostic`, `stage: "ui"`, `path`는 매니페스트 위치). 확장의 `LoadState`는 바뀌지 않는다. 항목의 `error`는 그 항목만 `invalid`로 만들고, 훅과 엔트리는 그대로 로드된다. 다만 `ui`의 모양 오류는 2단계에서 매니페스트 거부(`manifest_invalid`)이므로 그 확장은 `rejected`다.
- fs 포트가 던지면 그 경로를 찾지 못한 것으로 본다(`ui_file_missing`, 문장에는 던진 내용을 넣지 않는다). `checkUiDecl`은 던지지 않는다.
- 결과는 확장 기록마다 든다. `ExtensionLoader.uiEntries()`가 로드 순서와 선언 순서로 돌려준다. 확장이 목록에서 빠지면(다시 읽기, 제거) 그 확장의 항목도 빠진다.

앱 정책(`x.ui.apps`, `x.ui.allowProjectApps`, §6)이 앱 항목을 정하는 방식은 다음과 같다.

| 설치 위치 | `x.ui.apps` | `x.ui.allowProjectApps` | 앱 항목 |
|---|---|---|---|
| 무관 | 거짓 | 무관 | `fallback`이 있으면 native, 없으면 `disabled` |
| `managed`, `user` | 참 | 무관 | 앱 파일을 검사한다 |
| `project` | 참 | 거짓 | `fallback`이 있으면 native, 없으면 `disabled` |
| `project` | 참 | 참 | 앱 파일을 검사한다 |

Plugin App 파일 풀이(`resolveAppFile`)는 desktop의 전용 URL 스킴이 쓴다(ADR-0021 §3.6.2). 파일 본문은 읽지 않는다.

1. 요청 경로를 한 번만 퍼센트 디코딩한다. 디코딩이 깨지면 `outside_root`다. `%252e%252e`는 `%2e%2e`가 되고, 그 뒤에 `..`으로 보지 않는다.
2. 빈 요청은 `app.entry`다. 그 밖에 빈 마디, `.`과 `..` 마디, 백슬래시, NUL, 앞 `/`, 드라이브 문자(`C:`)가 있으면 `outside_root`다.
3. app root의 실제 경로가 확장 루트의 실제 경로 안이어야 한다(심볼릭 링크 포함). 밖이면 `outside_root`, 없으면 `not_found`다.
4. 요청 파일이 없으면 `not_found`다. 실제 경로가 app root의 실제 경로 밖이면(심볼릭 링크 포함) `outside_root`다.
5. 폴더면 `not_a_file`다.
6. 확장자가 허용 목록에 없으면 `forbidden_type`이다. 확장자는 대소문자를 가리지 않는다. wasm은 목록에 없다.

| 확장자 | Content-Type |
|---|---|
| `html` | `text/html; charset=utf-8` |
| `js`, `mjs` | `text/javascript; charset=utf-8` |
| `css` | `text/css; charset=utf-8` |
| `json`, `map` | `application/json; charset=utf-8` |
| `txt` | `text/plain; charset=utf-8` |
| `svg` | `image/svg+xml` |
| `png`, `jpg`, `jpeg`, `gif`, `webp` | `image/png`, `image/jpeg`, `image/jpeg`, `image/gif`, `image/webp` |
| `woff`, `woff2`, `ttf` | `font/woff`, `font/woff2`, `font/ttf` |

성공하면 `{ ok: true, path, contentType }`이다. `path`는 실제 경로다. 적대적 요청 표(`test/loading-trust/app-files.test.ts`)가 결과 값을 고정한다.

### 4.4 엔트리 로딩과 호출 규약

#### 4.4.1 TS 엔트리 로딩 방식 비교

| 안 | 방식 | 장점 | 단점 |
|---|---|---|---|
| A. Bun 직접 `import()` [제안] | 엔트리 절대 경로를 `import()`한다. 가상 모듈은 `Bun.plugin`의 `build.module(specifier, () => ({ exports, loader: "object" }))`로 등록한다 | 의존 0. Bun이 TS를 그대로 변환한다. 런타임과 같은 모듈 그래프라 `instanceof`가 맞는다 | 모듈 캐시를 끄는 옵션이 없다. 핫 리로드에 캐시 무효화 우회가 필요하다(§4.4.4). `Bun.plugin`은 프로세스 전역이다 |
| B. jiti | 별도 변환기로 엔트리를 평가하고 `moduleCache: false`와 `virtualModules`를 쓴다 | 캐시를 끌 수 있다 | 의존 하나와 별도 변환기. Bun 변환과 결과가 다를 수 있다 |
| C. `Bun.Transpiler` + 직접 평가 | 소스를 변환해 평가한다 | 캐시를 완전히 통제한다 | import 해석을 직접 만들어야 한다. 오류 위치가 흐려진다 |

- [결정] A를 쓴다. 스파이크 결과(Bun 1.4.3, 2026-10-28): `Bun.plugin`의 `build.module(specifier, () => ({ exports, loader: "object" }))`로 등록한 지정자는 그 뒤 `import()`하는 모듈(임의 경로의 `.ts` 엔트리 포함)이 호스트가 넘긴 객체의 값을 그대로 받고, 엔트리 옆 `node_modules`에 같은 이름의 패키지가 있어도 등록한 쪽이 이긴다. 받는 모듈 네임스페이스 객체는 호스트의 것과 다른 객체지만 그 안의 값(함수, 심볼, 배열)은 같다. 이 동작은 `test/loading-trust/external-loader.int.test.ts`가 고정한다.
- `bun build --compile` 바이너리에서 외부 `.ts` 파일의 동적 `import()`가 동작하는지는 확인하지 않았다 [가정]. 동작하지 않으면 B로 바꾼다. 데스크톱 패키징 작업이 확인한다.

#### 4.4.2 엔트리 모듈 형태

- 외부 확장: 매니페스트 `entry`(확장 루트 상대 경로)를 import한다. export는 `default` 또는 named `extension` 중 하나가 `ExtensionEntry` 함수여야 한다. 둘 다 없으면 `entry_not_function`이다. `entry`가 없으면 코드가 없는 플러그인이다(M5c §4.5.4): import하지 않고, 선언한 플러그인마다 설정도 상태도 없는 Registration 하나만 만든다(훅과 Drive는 선언하지 않는다).
- 내장 확장: `BuiltinExtensionModule.extension`을 그대로 쓴다. import는 조립 루트가 이미 했다. Fresnel 코드의 lint는 default export를 막으므로 내장 패키지는 named export만 쓴다(`xeon/AGENTS.md` 코드 규칙). F.extensions.spec §3.2의 "default export 형식" 주석과의 조정은 §10 미결 2다.
- `entry`가 확장 루트 밖을 가리키는 경우는 `validateManifest`의 `entry_invalid`가 막는다. 로더는 import 직전에 `realpath` 결과가 확장 루트 안인지 다시 확인한다.

#### 4.4.3 설치 위임과 오류 변환

1. 로더는 한 로드 세대에 `ExtHost.install(unit)`을 정확히 한 번 부른다. 엔트리 호출(`{ manifest, register }`, `manifest`는 정규화·동결 값)과 Registration 실행은 install 안에서 일어난다(X.primitives.spec §3.2, §4.5.6).
2. 엔트리 본문에서 부를 수 있는 연산은 `register(id, def, setup)`뿐이다(F `ExtensionEntry`). `on`, `drive`, `onDispose`, 리소스 등록, `capability(key)`는 Registration setup 안에서 부른다. 이 문서에서 "setup"은 Registration setup(`RegistrationSetup`)만 뜻한다.
3. 엔트리는 매니페스트의 플러그인마다 Registration 하나를 만든다. 루트 플러그인의 Registration id는 매니페스트 `name`, 그 밖은 `<name>/<플러그인 id>`다(F.extensions.spec §3.1 `registrationIdOf`). 선언했지만 만들지 않은 플러그인은 `plugin_not_registered`(warning)다 [제안]. `register`가 선언하지 않은 id를 받으면 `registration_unknown_plugin`으로 엔트리가 던진다. `InstallResult.registrations`가 비어 있고 `entryError`도 없으면 `usage_invalid`다 [제안].
4. Registration setup 본문은 thread 맥락 밖이다. 그래서 `state()`, `commit`, `post`, `record`, `readRecords`는 `PrimitiveError("no_thread")`로 거부된다(X.primitives.spec §4.6.3). pi도 로딩 중 동작 메서드를 막는다(`loader.ts:157-162`).
5. 엔트리 본문과 Registration setup은 `x.operations.budget.setupMs` 예산 안에서 await된다. 넘긴 뒤 늦게 끝난 setup의 등록은 scope 세대가 닫혀 있으므로 버려진다(X.primitives.spec §4.5.3, `_research/notes/X-2.md` §0 6번).
6. 활성화 뒤의 등록 호출(예: 핸들러 안의 `on`)은 primitives가 호출마다 검사한다. 선언 밖이면 그 호출만 `PrimitiveError("hook_undeclared")`로 거부하고 `ExtHostDeps.report`로 진단을 남긴다. 확장 전체를 끄지는 않는다 [제안]. 반복 위반의 자동 끄기는 X.operations.spec 몫이다. 이 경우는 로더 진단이 아니다.

[제안] 오류를 던지는 층과 로더 진단 코드의 대응:

| 일어나는 곳 | 던지는 쪽과 값 | `InstallResult`에서 보이는 곳 | 로더 진단 코드 | 확장 상태 |
|---|---|---|---|---|
| 엔트리 import(외부 확장) | 로더(Bun `import()`) | 해당 없음(install 전) | `entry_not_found`, `entry_import_failed`, `entry_not_function` | `error` |
| 엔트리 본문 예외 | 확장 코드 예외, `PrimitiveError`(`registration_foreign_id`, `registration_duplicate`, `registration_unknown_plugin`. 마지막은 `usage_invalid`가 아니라 `entry_threw`의 issues로 코드를 싣는다) | `entryError` | `entry_threw` | `error` |
| 엔트리가 Registration을 만들지 않음 | 없음 | `registrations` 빈 배열 | `usage_invalid` | `error` |
| setup 안의 선언 밖 연산 | `PrimitiveError`(`hook_undeclared`, `post_undeclared`, `drive_undeclared`, `drive_requires_orchestration`, `capability_undeclared`, `record_kind_undeclared`, `read_kind_undeclared`) | `setups[].failure`(`threw`, `code`) | `usage_invalid`(issues에 같은 코드) | `error` |
| setup 본문의 thread 맥락 연산 | `PrimitiveError("no_thread")` | `setups[].failure`(`threw`, `code: "no_thread"`) | `setup_action` | `error` |
| setup의 그 밖 예외 | 확장 코드 예외, 그 밖의 `PrimitiveError` | `setups[].failure`(`threw`) | `setup_threw` | `error` |
| setup 시간 초과 | primitives(`setupBudgetMs`) | `setups[].failure`(`timeout`) | `setup_timeout` | `error` |
| setup 직후 `validateUsage` 오류 | primitives | `setups[].issues`(error) | `usage_invalid` | `error` |
| setup 직후 `validateUsage` 경고 | primitives | `setups[].issues`(warning) | `usage_warning` | `active` 유지 |
| 선언한 플러그인을 엔트리가 `register`하지 않음 | primitives(`unregistered`) | `unregistered` | `plugin_not_registered`(warning, issues에 같은 코드) | `active` 유지 |
| 활성 뒤 선언 밖 `on` | `PrimitiveError("hook_undeclared")`, 그 호출만 | 없음(`ExtHostDeps.report`) | 없음 | `active` 유지 |

- 한 확장의 scope 가운데 하나라도 `failed`이면 그 확장 전체를 `error`로 두고 `uninstall`한다 [제안]. 확장 안의 scope 일부만 살리는 규칙은 두지 않는다.
- `ExtensionUsageError`라는 별도 클래스는 두지 않는다. 확장이 받는 오류는 `PrimitiveError`(X.primitives.spec §3.10) 하나다.

#### 4.4.4 핫 리로드 [결정: 2026-11-03 사용자 (a), M4 T-RELOAD]

열린 대화가 있는 채로 확장 코드를 새 버전으로 바꾼다. 플러그인 만들기에서 고친 확장을 바로 써 보는 길이고 버전 되돌리기(§4.4.8)가 적용되는 길이다. `ExtHost.uninstall`은 경계 없이 즉시 해제하므로 쓰지 않는다. 대신 `ExtHost.replaceUnit`(X.primitives.spec §4.4.10)이 단계 경계에서 단위를 교체한다.

- `ExtensionLoader.reload(name, signal, options?)` 순서: (1) 매니페스트를 다시 읽고 검증한다. (2) 이름이 같아야 한다(이름이 바뀌면 재시작). (3) 집합 검사를 다시 한다(다른 확장과 이름·기능 충돌). (4) 신뢰 상한을 다시 계산한다. 설치 위치가 줄 수 있는 등급이어야 하고 지금 등급과 같아야 한다(바뀌면 재시작). (5) 엔트리를 새 세대로 import한다. (6) `replaceUnit`이 새 엔트리를 호스트 상태 밖에서 실행해 검사한다. 여기까지 하나라도 실패하면 `rejected`(진단 `reload_rejected` 또는 `entry_import_failed`, `entry_not_function`, `entry_threw`, `plugin_not_registered`)이고 옛 버전이 그대로 돈다. 로더 기록(`manifest`, `generation`)도 바뀌지 않는다.
- 통과하면 `ReloadStarted`를 돌려준다. `appliesAt`은 `now`(실행 중인 thread가 없어 이 호출이 돌아오기 전에 적용을 끝냈다)이거나 `nextStepBoundary`(실행 중인 turn의 step이 끝난 경계를 기다린다)다. `applied`는 적용이 끝나면 정해진다. `applied`(`status: "applied"`)가 되면 그때 로더 기록의 `manifest`와 `generation`이 새 것으로 바뀐다. 경계에서 새 세대가 열리지 못하면 `failed`다: 옛 정의로 되돌려 다시 열었고(`restored`), 진단 `reload_failed`가 확장의 진단과 로더 진단에 남는다. 이 실패는 `nextStepBoundary`로 돌려준 호출에서는 나중에 `applied`로만 알 수 있다.
- 새 이름 싣기 [결정: 2026-11-03 사용자 (a), M4 T-RELOAD; 2026-11-04 사용자: 새 이름 플러그인도 재시작 없이 바로 불러온다]: `ExtensionLoader.loadInstalled(name, signal)`가 앱 안 설치(`ext.install`, HS-111)와 제작 플러그인의 `link`가 방금 복사한 `<userDir>/extensions/<name>` 하나를 싣는다. 시작 때(`loadAll`)와 같은 묶음 처리(`processBatch`)를 한 후보로 돌리므로 매니페스트 검증, 집합 검사, 신뢰 상한(사용자 위치의 `user`), 켜짐 확인, `assignTier`와 운영 정책 `admit`, 엔트리 import, `ExtHost.install`을 모두 거친다. 우회하는 길은 없다. 사용자 위치만 대상이라 프로젝트와 관리 위치의 확장은 싣지 않는다.
  - 결과 `Ok`는 `appliesAt`과 `info`다. 실행 중인 turn이 없으면 `now`, 있으면 켜기가 `ExtHost`의 시작 적용 규칙(`deferred`, X.primitives.spec §4.5.6)대로 다음 단계 경계로 미뤄져 `nextStepBoundary`다. 단계 경계 규칙은 이 로더가 바꾸지 않는다.
  - 실패는 `already_loaded`(같은 이름이 이미 실려 있다. 새 판은 `reload`), `safe_mode`(안전 모드는 사용자 위치를 싣지 않는다), `not_found`, `not_active`(`state`는 `rejected`, `error`, `disabled`와 진단)다. 실패하면 호스트에 아무것도 남지 않는다. `rejected`와 `error` 기록은 지워 같은 이름을 고쳐 다시 설치할 수 있고, `disabled`(설정으로 꺼졌거나 필수 설정이 비어 있음)는 기록을 남겨 설정으로 켤 때 `ensureLoaded`가 싣는다.
  - `unload(name)`은 외부 확장을 `ExtHost.uninstall`로 내리고 정책 표에서 뺀다(`policy.forget`). 로더 기록은 `disabled`로 남기고 세대를 올린다 [제안, M5c §4.1.11]. 그래서 목록에는 꺼진 채 보이고, 같은 이름의 `ensureLoaded`가 `unknown_extension` 없이 새 세대로 다시 싣는다. 이 해제는 §4.4.5처럼 경계 없이 즉시다. 기록을 지우는 제거 흐름은 이 함수가 아니다.
  - `ensureLoaded`가 꺼진 기록을 다시 실을 때 검토본 목록의 현재 사본이 기록이 쥔 사본과 다르면(승인이 current를 바꾼 경우) 현재 사본으로 기록을 다시 만든 뒤 5a~9단계를 돈다. 같은 사본이거나 목록에 없으면 쥔 사본을 쓴다. 기록의 진단은 다시 판정할 때 지운다 [제안].
- `active`인 외부 확장만 다시 읽는다. 내장 확장(`builtin`), 루트가 없는 확장, `active`가 아닌 확장(`error`, `disabled`, `rejected`)은 `not_reloadable`이다. 이런 확장은 재시작하거나 `ensureLoaded`로 싣는다.
- 재import는 Bun 모듈 캐시를 피하려고 엔트리를 `<절대 경로>?fresnel-gen=<세대>`로 import한다. [결정] `file://` URL 형태로는 안 된다: Bun 1.4.3은 `file://` URL의 질의를 무시하고 처음 평가한 모듈을 돌려준다(시험으로 확인). 절대 경로 문자열에 질의를 붙이면 새 모듈로 평가한다. 이전 세대 모듈은 메모리에 남는다. 개발용이라 이 누수를 받아들인다. 엔트리가 상대 경로로 import하는 다른 파일은 처음 평가한 것이 캐시되어 다시 평가되지 않는다. 그래서 번들된 엔트리(`dist/index.js` 하나)만 다시 읽기로 바뀐다 [미결: 하위 파일을 다시 읽으려면 번들하거나 재시작한다].
- `options.resetRefusedState`는 새 버전이 저장된 상태를 받지 못할 때 그 상태를 비우고 이어 가게 한다(되돌리기 `clearState`, X.primitives.spec §4.4.10 8번).
- 단계 경계, 실행 중인 turn, drive lock, 실패와 재시작 때의 규칙은 X.primitives.spec §4.4.10이 정한다. 이 로더는 그 규칙을 바꾸지 않는다.
- 격리 확장의 리로드는 자식 프로세스 재시작이다. 캐시 문제가 없다.
- 파일 감시는 L0 파일 감시 서비스가 있을 때만 쓴다. 기본은 명령(`fresnel ext reload <name>` [가정: 명령 이름은 L4.cli.spec])과 wire `ext.reload`다.

#### 4.4.5 제거 흐름 (M2)

[제안] 확장 제거는 확인 2단계다. 확인 화면은 L4가 만든다.

1. `previewRemoval(name)`: 아무것도 바꾸지 않는다. `storageAdmin.dropExtension(name, false)`로 지울 테이블 목록을 받아 `RemovalPreview`로 돌려준다. `storageAdmin`이 없으면 빈 목록이다.
2. 사용자가 확인하면 `remove(name, { dropTables: true })`, 테이블을 남기기로 하면 `remove(name, { dropTables: false })`를 부른다.
3. `remove`는 `ExtHost.uninstall(name)`을 await한다(scope 끄기 요청과 경계 적용, 등록 해제, 투영기 해제는 primitives·operations가 한다). 이어 `policy.forget(name)`을 부른다.
4. `dropTables`가 참이면 `storageAdmin.dropExtension(name, true)`를 부른다. 지우는 대상은 소유 장부(`xh_ext_tables`)에 오른 테이블뿐이고 이벤트는 남긴다(X.operations.spec §4.4.7).
5. 확장 상태를 목록에서 지우고 `RemoveResult`를 돌려준다. 설치 파일(확장 디렉터리)의 삭제는 로더 범위 밖이다 [가정: L4.cli.spec·L4.settings-ui.spec이 정한다].
6. [구현 2026-11-04] 위 1~4단계의 `previewRemoval`·`remove({ dropTables })`는 구현하지 않았다. 실제로는 호스트 포트(`assembly/m4/devkit-port.ts`)가 `ext.removePreview`와 `ext.remove { dropData }`로 이 흐름을 맡는다. `dropData`가 참이면 내리기(`ExtensionLoader.unload`), 저장 테이블 지우기(`ExtStorageManager.drop`), 설치 폴더 지우기 순서이고, 데이터 지우기가 실패하면 폴더를 남긴다. 세부는 X.operations.spec §4.4.7이다.

- 내장 확장은 제거할 수 없다. `remove`는 내장 확장 이름에 대해 오류를 던진다. 내장 확장은 `ext.<name>.enabled`로만 끈다.

#### 4.4.6 SDK 가상 모듈

- [제안] 플러그인 번들은 `@fresnel/contracts`와 그 하위 경로(`/capabilities`, `/conversation`, `/extensions`, `/records`, `/services`, `/settings`, `/wire`), `@fresnel/orchestration-sdk`, `typebox`를 import한다. 번들에 사본을 넣으면 `instanceof CapabilityError`, `Symbol`, 스키마 객체가 호스트와 어긋나므로, 로더가 이 지정자를 호스트가 쓰는 모듈 객체로 등록한다(M3-REQ-110, adr.0017 §3.7 4번). 이 밖의 하위 경로 지정자(`typebox/value` 등)는 등록하지 않는다. 필요해지면 조립 루트가 `LoaderDeps.sdkModules`에 더한다.
- `@fresnel/contracts`와 하위 경로, `typebox`는 X가 자기 의존으로 직접 등록한다(`X_SDK_MODULES`). 조립 루트는 넘기지 않아도 된다. `@fresnel/orchestration-sdk`은 L3 패키지라 X가 import할 수 없으므로 조립 루트가 `LoaderDeps.sdkModules`로 넘긴다. 조립 루트가 X 몫의 지정자를 다른 객체로 넘기면 `conflict`다. 등록은 첫 외부 엔트리를 import하기 직전에 한다(`registerSdkModules`).
- 등록은 `Bun.plugin`이라 프로세스 전역이고 첫 import 뒤에는 바꿀 수 없다. 같은 지정자에 같은 객체를 다시 등록하면 아무 일도 하지 않고, 다른 객체를 등록하려 하면 `conflict`다. 이 오류는 외부 확장의 `entry_import_failed`로 보인다. Bun이 아닌 런타임에서는 `unavailable`이다.
- 등록한 지정자는 같은 프로세스의 Fresnel 패키지가 import해도 같은 객체를 받는다. 호스트가 넘긴 객체가 곧 호스트가 쓰는 모듈이므로 결과가 같다.

#### 4.4.7 기본 플러그인 설치

- [제안] 릴리즈에 든 기본 플러그인(Helm, D-M3-01 c)은 `installDefaultPlugin`이 사용자 확장 위치 `<userDir>/extensions/<name>/`에 복사한다. 조립 루트가 `loadAll` 전에 부른다. 설치 위치가 `user`라 신뢰 상한이 `user`이고 안전 모드에서 실리지 않는다(M3-REQ-29, M3-REQ-110).
- 규칙은 설치본 매니페스트(`.fresnel-plugin/plugin.json`)의 `version`과 번들 매니페스트의 `version` 비교다.

| 설치본 | 동작 |
|---|---|
| 디렉터리 없음 | 복사한다(`installed`) |
| 매니페스트가 없거나 읽을 수 없거나 검증에 실패함 | 손상으로 보고 교체한다(`replaced`) |
| 번들보다 낮은 버전 | 교체한다(`replaced`, `previousVersion`) |
| 번들과 같거나 높은 버전 | 건드리지 않는다(`kept`). 사용자가 올린 개발 판을 내리지 않는다 |

- [제안: X-8] 교체할 때 `history`가 있으면 이전 설치본을 교체 전에, 새 번들 버전을 교체 뒤에 버전 기록에 남긴다(§4.4.8). 첫 설치(`installed`)는 기록하지 않는다. `history`가 없으면 동작은 이전과 같다.
- 임시 디렉터리는 확장 탐색 디렉터리 밖인 `<userDir>/.staging/<이름>.new`·`.old`다(대상과 같은 파일 시스템, `stagingRoot`로 바꿀 수 있다). 탐색은 점으로 시작하는 디렉터리를 건너뛰므로 남은 흔적이 `name_conflict`를 일으키지 않는다. 교체는 이전 설치본을 `.old`로 옮기고, 새 복사본을 대상으로 옮기고, `.old`를 지운다. 새 복사본을 옮기다 실패하면 `.old`를 되돌린다. 시작할 때 `.new`를 지우고, 대상이 없는데 `.old`가 있으면(교체 도중 끊김) 이전 설치본을 되돌린 뒤 버전을 비교한다. 번들 매니페스트가 없거나 잘못되면 `source_invalid`다(릴리즈 결함).
- [결정: A5 T-H] 사용자가 설치본을 직접 지우면 다시 설치하지 않는다. "이미 설치한 적 있음" 표지는 조립 루트(L4 host)가 호스트 상태 디렉터리의 `default-plugins.json`(`{ schemaVersion: 1, installed: { <이름>: <버전> } }`)에 둔다. X의 `installDefaultPlugin`은 표지를 모르고 번들·설치본 버전만 비교한다. 조립 루트는 표지에 이름이 있고 대상 디렉터리가 없으면 `installDefaultPlugin`을 부르지 않는다(`removed_by_user`). 표지 파일까지 지우면 새로 설치한다. 표지는 설치나 갱신에 성공했을 때만 쓴다(`kept`는 설치본 버전을 적는다). 손상된 표지는 비운 것으로 보고 경고한다.
- 번들 판 읽기: `readBundleManifest(fs, bundleDir)`는 위 설치와 같은 매니페스트 읽기와 검증으로 번들의 `{ version, manifestText }`를 돌려준다. 매니페스트가 없거나 검증에 실패하면 `null`이고, 읽기 실패만 `io` 오류다. L4 host가 버전 목록의 `bundledVersion`과 되돌리기 전 번들 판 기록에 쓴다(HS-108).

#### 4.4.8 버전 기록과 되돌리기 [제안: X-8, M4 T-XV, 제품 결정 수락]

- 위치는 `<사용자 데이터>/extensions/.history/<이름>/<버전>/`이다. `dir/`에 설치본 복사본을, `meta.json`에 `{ version, installedAt, source, manifestHash, stateSchemaVersion }`을 둔다. 이름이 점으로 시작하므로 확장 탐색이 건너뛴다(§4.2.1).
- 보관 개수는 확장마다 5개다. 기록할 때마다 설치 시각이 늦은 것부터 5개를 남기고 나머지를 지운다. 방금 기록한 버전(기록 시점의 설치본)은 빼지 않는다. 그래서 설치 시각이 오래된 설치본을 기록하면 보관이 6개가 될 수 있다.
- 출처(`source`)는 `bundled`(릴리즈의 기본 플러그인 번들), `user`(사용자가 둔 설치본), `authored`(Plugin Builder 묶음)다. 기록이 이미 있는 버전은 그 출처를 유지한다. 기록이 없을 때 기본 플러그인 교체가 남기는 이전 설치본은 `bundled`, 되돌리기가 남기는 지금 설치본은 `user`다.
- 같은 버전을 다시 기록하면 옛 기록을 바꿔 쓴다. 복사본과 메타는 임시 디렉터리 `.<버전>.new`에 다 만든 뒤 옮긴다. 옮기지 못하면 옛 기록이 남는다.
- 기본 플러그인 번들 판을 되돌리기 대상으로 쓸 때(§4.4.8 "앱에 든 버전" 기록), 보관에 같은 판 글자의 항목이 있어도 그 `manifestHash`가 번들 매니페스트 텍스트의 해시(호스트가 버전 기록에 쓰는 것과 같은 sha256)와 같을 때만 믿는다. 다르면 번들 원본을 같은 판으로 다시 기록한다(위 두 번째 불릿의 원자적 교체). 해시는 매니페스트 텍스트만 본다. 복사본(`dir/`)의 내용은 비교하지 않는다 [제안: 복사본 비교는 후속 과제].
- 정리 실패는 기록의 성공을 바꾸지 않는다. 정리는 첫 실패에서 멈추고 `pruneFailure`로 알린다. 남은 버전은 다음 기록이 다시 본다. 지우지 못한 임시 디렉터리도 다음 기록이나 되돌리기가 먼저 지운다.
- 목록은 `<이름>` 디렉터리 가운데 버전 형식 이름만 본다. 메타가 없으면 `meta_missing`, JSON이 아니면 `meta_not_json`, 형식이 맞지 않거나 설치 시각이 날짜가 아니면 `meta_invalid`, `dir/`가 없으면 `dir_missing`, 메타의 버전이 디렉터리 이름과 다르면 `version_mismatch`다. 이 항목은 `skipped`로 알리고 목록에 넣지 않는다. 목록은 설치 시각이 늦은 것부터, 같으면 버전 번호가 높은 것부터다.
- 되돌리기 순서: (1) 대상이 보관되어 있는지 본다. 없거나 건너뛴 버전이면 `not_found`다. (2) 상태 스키마를 본다. 대상 값과 지금 값이 모두 숫자이고 지금 값이 더 크며 `clearState`가 참이 아니면 `state_schema_mismatch`로 멈춘다. 파일은 바뀌지 않는다. UI는 "상태를 비우고 되돌리기"를 제안한다(O-11). (3) 끊긴 되돌리기의 흔적을 치운다. (4) 끄기 훅을 부른다. 실패하면 `disable_failed`로 멈춘다. 파일은 바뀌지 않았다. (5) 지금 설치본을 기록한다. (6) 교체한다. (7) `clearState`가 참이면 상태를 비운다. (8) 켜기 훅을 부른다. (9) 백업을 지운다. 끄기 → 기록 → 교체 → 상태 비우기 → 켜기 순서이고 적용은 다음 단계 경계다(`hotReload`가 거짓이면 재시작 뒤다).
- 핫 리로드 되돌리기 [결정: 2026-11-03 사용자 (a)]: `RollbackHooks.reload`가 있고 `hotReload`가 거짓이 아니면 4번(끄기)과 7·8번(상태 비우기, 켜기)을 하지 않고 7번 자리에서 `reload(name, { clearState })`를 부른다. 확장을 끄지 않으므로 열린 대화에서 확장이 사라지지 않고, 새 버전으로의 교체가 단계 경계에서 일어난다(§4.4.4). `clearState`는 reload가 새 버전이 받지 못하는 상태를 비우는 것으로 처리한다(`stateCleared`는 reload가 돌려준 값). 교체(6)가 실패하면 끈 적이 없으므로 다시 켜지 않는다(`reenabled: true`). reload가 던지면(새 버전이 열리지 못함, 옛 버전은 계속 돈다) 되돌리기 전 설치본(`.swap.old`)을 설치 위치로 되돌리고 `reload_failed`(`restored`)를 돌려준다. 되돌리지 못하면 `restored: false`이고 디스크 파일과 도는 코드가 다르다(재시작하면 디스크 파일이 돈다). 파일 교체 도중 프로세스가 끊기면 §4.4.8의 흔적 치우기(3번)가 다음 되돌리기에서, 시작할 때 로더가 디스크의 설치본을 한 번 싣는 것으로 하나의 세대로 돌아온다.
- 정리는 보관 개수를 넘은 버전을 지우되 되돌릴 대상을 지우지 않는다 [결정: 감사 LT-04]. 지금 설치본을 기록하는 5번이 `protectVersion`으로 대상 버전을 정리에서 뺀다. 그래서 보관이 가득 차 있어도 대상의 복사가 ENOENT로 실패하지 않고 보관본이 사라지지 않는다.
- 교체(6)는 대상 복사본을 `.swap.new`에 먼저 만든다. 옮기기보다 실패하기 쉬운 복사를 먼저 끝내므로 복사가 실패해도 설치본은 그대로다 [제안]. 그다음 설치본을 `.swap.old`로 옮기고 `.swap.new`를 설치 위치로 옮긴다. 마지막 옮기기가 실패하면 `.swap.old`를 설치 위치로 되돌린다.
- 교체 단계(5, 6)가 실패하면 파일을 처음 상태로 되돌리고(`restored`) 확장을 다시 켠다(`reenabled`). 되돌리기나 켜기도 실패하면 그 원인을 `followUps`에 담는다. 실패한 단계는 `step`(`record`, `stage`, `move_current`, `place`)이다.
- 상태 비우기(7)나 켜기(8)가 실패하면 교체는 끝난 채 남고 확장은 꺼진 채 남는다(`clear_state_failed`, `enable_failed`). 백업 삭제(9)가 실패해도 결과는 같고 남은 백업은 다음 되돌리기가 지운다.
- 상태 스키마 규칙: 내려가는 마이그레이션은 없다. 대상의 상태 스키마가 지금보다 낮으면 상태를 비우는 되돌리기만 된다. 값을 모르면(null) 검사하지 않는다. 기본 플러그인 기록은 상태 스키마 버전을 알 수 없어 `null`이다(§10 24번).
- 되돌리기는 보관을 지우지 않는다. 되돌리기 전 설치본이 새로 기록되므로 다시 앞으로 돌아갈 수 있다(왕복).
- 기본 플러그인 설치(§4.4.7)는 `history`가 있을 때만 기록한다. 교체 전 이전 설치본 기록이 실패하면 교체하지 않는다. 교체 뒤 새 번들 버전 기록이 실패하면 `io` 오류를 돌려준다. 설치는 끝난 상태이고, 다음 실행은 같은 버전이라 `kept`가 되어 기록하지 않는다.

### 4.5 설정 연결

#### 4.5.1 userConfig

- 로더는 5단계에서 `settingsFromManifest(manifest)`로 `SettingDef[]`를 얻는다(F.wire-settings.spec §3.8.3). 결과의 `issues`가 비어 있지 않으면 그 확장의 설정 전체가 거부된다.
- `UserConfigEntry`에 값 스키마 필드가 없는 동안(F.wire-settings §10 미결 8) `settingsFromManifest`는 항목을 문자열 값(기본 빈 문자열)으로, `sensitive`면 `SecretRef` 시크릿 설정(`ui.widget` `secret`)로 만든다 [제안: 미결 8이 풀리면 고친다]. 접두가 `ext.<name>.`가 아니거나 예약 이름이면 그 항목은 정의 대신 `CatalogIssue`로 돌려준다.
- 로더는 예약 키 두 개를 `reservedExtensionSettings`로 만들어 같은 그룹(`namespace: "ext.<name>"`, `owner: <name>`)에 더한다.
- userConfig 키가 `enabled`나 `isolation`이면 `settings_reserved_key`다(F.wire-settings.spec §3.8.3 "userConfig는 이 이름을 쓸 수 없다").

#### 4.5.2 예약 키

| 키 | 타입 | 기본값 | 범위(allowedScopes) | runtimeChange | 대상 |
|---|---|---|---|---|---|
| `ext.<name>.enabled` | `boolean` | 매니페스트 `defaultEnabled`, 없으면 `true` | `managed`만(D10) | `live` | 모든 확장 |
| `ext.<name>.isolation` | `"none" \| "process"` | 매니페스트 `isolation`, 값이 없으면 `"process"` | `managed`, `user` | `restart` | 내장이 아닌 확장 |

- `enabled`의 범위는 `managed`뿐이라(D10) 사용자가 설정이나 대화에서 바꾸지 못한다. 이 범위 값이 바뀌면 로더는 바로 요청을 기록하고, 실제 켜짐·꺼짐은 다음 단계 경계에서 적용된다(F.extensions.spec §4.5). 거짓이었다가 참이 된 확장이 아직 로드되지 않았으면 `ensureLoaded`로 5a~9단계를 실행한 뒤 경계에서 켠다. 참에서 거짓이 되면 scope 끄기만 하고 모듈은 남긴다.
- 로더가 `LoaderSettingsSource.enabled`로 받는 값은 잠금뿐이다. 관리 범위가 거짓으로 잠근 확장만 `false`다. 매니페스트 기본(`defaultEnabled: false`)과 사용자 값은 잠금이 아니라서 켜짐은 대화별 E(T)가 정한다(M5c §4.1.10, §4.1.11). 카탈로그 기본을 잠금으로 읽으면 대화가 쓰는 default-off 확장이 재시작 뒤 영영 실리지 않는다 [구현: enC3 2026-11-18, `apps/host/src/assembly/ext-settings.ts`].
- `enabled`가 거짓이면 엔트리를 import하지 않고 실행하지 않는다(5a단계 `disabled`). 내장 확장은 모듈이 이미 import되어 있지만 엔트리를 부르지 않는다.
- `isolation`의 대화 중 변경: 하지 않는다(`restart`). 범위를 `managed`, `user`로 한정하는 이유는 작업 폴더 파일이 격리를 끄지 못하게 하기 위해서다 [제안]. 값 `none`은 엔진 안에서 돌리기를 허락하는 예외이고 매니페스트 `isolation`은 설정 값이 없을 때의 요청이다(§4.9.0, F.extensions.spec §6).
- 내장 확장에는 `isolation` 키를 만들지 않는다. 내장 확장의 격리는 금지다(§4.6).
- 예약 키의 `layer`는 확장의 유효 층(`effectiveLayer`, 플러그인 `layer` 가운데 가장 높은 층, F.extensions.spec §3.1)을 따른다. `plugin`이면 `L2`로 본다. 켜기 키는 확장 단위 하나이고 플러그인 단위 키는 만들지 않는다. `orchestration.members` 밖의 플러그인을 따로 끄는 길은 두지 않는다(M4 밖) [제안](F.wire-settings.spec §3.8.3 [가정]을 따른다).
- `ui`: 두 키 모두 `tab: "plugins"`. `enabled`는 `toggle`, `isolation`은 `select`다.

#### 4.5.3 `foreignNamespace`와 로딩

- [제안] 설정 거부는 로딩 거부다. 매니페스트의 userConfig가 `foreignNamespace`(다른 네임스페이스 키)나 `invalidDef`, `settings_reserved_key`를 내면 그 확장은 5단계에서 `rejected`(`settings_rejected`)이고 엔트리를 실행하지 않는다.
- 이유: 설정이 없는 상태로 실행하면 확장이 기대한 키를 읽지 못해 다른 방식으로 실패한다. 다른 네임스페이스에 키를 더하려는 매니페스트는 의도적 침범일 수 있다.
- `required: true`인 userConfig 키의 유효 값이 없으면 `disabled`(`config_required`)다. 값이 채워지면 `ensureLoaded`로 이어서 실행한다.

#### 4.5.4 카탈로그 재조립

- 외부 확장 플러그인이 자기 설정을 읽는 길은 `RegistrationHostApi.settingValue`다(X.primitives.spec §3.8). 내장이 아닌 확장은 `fresnel.*` 포트를 쓸 수 없지만 이 메서드로 `ext.<자기 이름>.*` 키만 읽는다. 플러그인 설정 이름공간은 신뢰 `user`이면 `ext.<id>`다(`defineOrchestration`).
- 카탈로그는 시작 때 한 번 만들고 외부 확장이 낸 키는 적재 뒤에야 알려진다. 그래서 조립 루트가 적재 전에 키를 알아야 하는 확장(기본 플러그인 Helm)은 `reservedExtensionSettings(manifest, source)`를 X 루트에서 import해 예약 키(`enabled`, `isolation`)를 만들고, 자기 설정 그룹(`ext.<id>.*`)은 그 그룹의 `defineSettings` 값을 함께 카탈로그에 넣는다. 확장이 선언한 `userConfig` 키는 적재 뒤 `settingsFromManifest(manifest)`가 만든 정의를 조립 루트가 카탈로그에 더한다(앱 안에서 설치한 사용자 플러그인이 설정 읽기·쓰기를 쓰려면 키가 있어야 한다). 설정 스키마 산출물(`schema/`)은 정적 카탈로그만 쓴다 [결정: 2026-11-07 시나리오 작업, 기본값].
- `LoadReport.settingGroups`는 `rejected`가 아닌 확장의 그룹(`ext.<name>`)만 담는다. `x.*` 설정 그룹(`primitivesSettings`, `loadingTrustSettings`, `operationsSettings`)은 조립 루트(L4 host)가 코어 그룹, `LoadReport.settingGroups`와 함께 `buildCatalog`에 넣는다.
- 확장 그룹끼리 `duplicateKey`가 나면(같은 이름은 3단계에서 막히므로 [가정] 생기지 않는다) 로드 순서가 뒤인 확장을 `rejected`로 바꾸고 다시 조립한다. 다시 조립한 결과도 `ok: false`이면 남은 이슈는 코어 키 문제이므로 조립 루트가 시작을 거부한다(L4.host-service.spec §4.1 5번).

### 4.6 신뢰 등급과 허용 연산

#### 4.6.1 등급의 뜻과 결정

- [제안] F.extensions.spec이 [가정]으로 둔 값 `builtin`, `user`, `project`, `untrusted`를 그대로 확정한다.
- 유효 등급 = min(설치 위치 상한 `SOURCE_TRUST`, 매니페스트 `trust.level` 요청). 매니페스트가 요청을 생략하면 상한을 쓴다.
- 매니페스트가 상한보다 높은 등급을 요청하면 `rejected`(`trust_exceeds_source`)다. 외부 확장이 `builtin`을 요청해 예약 이름 검사(`name_reserved`)를 피하는 경로를 막는다. F의 `validateManifest`는 `trust.level`만 보고 예약 이름을 허용하므로, 로더는 2단계 전에 설치 위치가 `builtin`이 아닌 매니페스트의 `trust.level: "builtin"`을 거부한다(§10 미결 3).
- `project` 위치의 확장은 작업 폴더 신뢰가 `allow`일 때만 `project`이고, 그 밖에는 `untrusted`다.

#### 4.6.2 등급 × 허용 연산 표

| 등급 | 로드 | `on`(일반 훅) | `on`(`thread.trust.before`) | `post` | `drive` | 리소스 등록 | 저장(접두 테이블) | 격리 |
|---|---|---|---|---|---|---|---|---|
| `builtin` | 예 | 예 | 예 | 예 | 예 | 예 | prefix | forbidden |
| `user` | 예 | 예 | 예 | 예 | 예 | 예 | prefix | optional |
| `project` | 예 | 예 | 아니오 | 예 | 예 | 예 | prefix | optional |
| `untrusted` | 아니오 | 아니오 | 아니오 | 아니오 | 아니오 | 아니오 | none | notLoaded |

- `drive`는 그 위에 F 규칙(`plugins[].drives: true`와 정책 `x.primitives.driveRequiresOrchestration`, F.extensions.spec §4.6)을 함께 만족해야 한다. 정책을 풀어도 `untrusted`는 로드되지 않으므로 `drive`를 못 쓴다.
- `project` 등급의 `thread.trust.before` 금지는 순서 때문이기도 하다. 작업 폴더 확장은 신뢰 판정 뒤에 로드된다(§4.7.4). 로더는 `plugins[].hooks`에 `thread.trust.before`가 있는 작업 폴더 매니페스트를 `usage_invalid`로 거부한다.
- 격리 `forbidden`: 내장 확장은 L0~L2 서비스를 같은 프로세스에서 제공하므로 격리하지 않는다.
- 저장 `prefix`는 X.operations.spec의 확장 접두 테이블 API를 쓸 수 있다는 뜻이다. 격리 확장은 등급과 무관하게 직접 접근이 없다(§4.9.6).
- 이 표는 `TRUST_MATRIX` 상수와 같아야 한다(§9 수용 기준 14).

#### 4.6.3 `untrusted`의 처리

| 안 | 내용 | 장점 | 단점 |
|---|---|---|---|
| A. 로드하지 않음 [제안] | `untrusted` 확장은 import도 하지 않는다. 진단(`trust_denied` 또는 `trust_undecided`)만 남긴다 | 신뢰하지 않은 코드가 한 줄도 실행되지 않는다. 격리(2차)가 없는 M0~M2에서도 같은 규칙이다 | 사용자가 작업 폴더 확장을 쓰려면 폴더 신뢰를 해야 한다 |
| B. 격리 강제 | `untrusted` 확장을 자식 프로세스에서만 실행한다 | 신뢰 없이도 일부 기능을 쓴다 | 자식 프로세스도 같은 OS 사용자 권한으로 실행된다. 샌드박스 없는 프로세스 격리는 보안 경계가 아니다(pi `docs/security.md` "Extensions, package installers… run with those same permissions unless an operating-system or virtualization boundary restricts them"). 격리가 2차라 M2 전에는 실행 경로가 없다 |

- [제안] A로 확정한다. 프로세스 격리와 L0 샌드박스를 함께 적용하는 실행 경로가 생기면 B를 다시 검토한다(§10 미결 4).

#### 4.6.4 외부 확장이 공급하는 기능의 `idempotent` 선언 [결정: M3-REQ-31]

- 값 집합: `trust.level`은 `builtin`, `user`, `project`, `untrusted` 넷이다(§4.6.1). 새 값을 더하지 않는다.
- 외부 플러그인(`orchestration` 선언이 있는 확장)의 등급은 설치 위치가 정한다. `user`·`managed` 위치는 `user`, `project` 위치는 작업 폴더 신뢰가 `allow`일 때만 `project`다. `drive`는 두 등급 모두 허용이고 F 규칙(`usesDrive: true`)을 함께 만족해야 한다(§4.6.2).
- `idempotent` 선언은 F 기능 정의(`MethodDef.idempotent`)에 있고 공급자가 그 약속을 지키는지는 적합성 시험(ADR-0015 §3.6)으로만 확인된다. 외부 확장은 시험을 강제할 수 없다.
- 그래서 기능의 현재 공급자가 내장 확장(`builtin: true`, 저장소의 적합성 시험을 통과한 코드)일 때만 `idempotent` 선언을 믿는다. 공급자가 외부 확장(`user`, `project`)이면 X 기능 래퍼는 그 기능의 `idempotent` 메서드를 선언 없음으로 본다. on 핸들러와 drive 함수처럼 재실행되는 문맥에서는 `effect_not_allowed`이고 공급자를 부르지 않는다. 재실행되지 않는 문맥(도구 `execute`, 명령 처리기)에는 영향이 없다.
- 판정은 호출마다 현재 바인딩된 공급자로 한다. 공급자가 바뀌면 다음 호출부터 새 공급자의 등급을 쓴다. 바인딩이 없으면 믿지 않는다(닫힌 쪽).
- [결정: 오케스트레이터 기본값] 외부 공급자에게 신뢰를 열어 주는 설정(허용 확장 목록)은 두지 않는다. 같은 일은 요청 레코드와 워커(ADR-0015 §3.5)로 할 수 있다. 필요가 생기면 사용자 범위 설정으로만 열고 작업 폴더 범위는 열지 않는다.
- `readOnly` 선언은 같은 신뢰 조건을 적용하지 않는다. 읽기가 재실행되어 해로운 경우는 공급자 오선언 때뿐이고 비용 문제이지 중복 효과가 아니기 때문이다 [제안].

### 4.7 작업 폴더 신뢰

#### 4.7.1 포크 범위

[제안] pi `trust-manager.ts`(246줄)와 `project-trust.ts`(97줄)를 포크한다(`_research/packages.md` §4.5 X-a 작업 폴더 신뢰 행). 원본: `~/projects/_ref/pi-src/packages/coding-agent/src/core/trust-manager.ts`, `project-trust.ts`.

| 원본 요소 | 원본 동작 | Fresnel에서 바꿀 점 | 이유 |
|---|---|---|---|
| `import lockfile from "proper-lockfile"`, `acquireTrustLockSync`(138-168) | 동기 잠금, 20ms 바쁜 대기 10회 | 삭제. `TrustStoreBackend.update`가 잠금과 원자 교체를 맡는다 | 잠금 구현은 L0 소관이다(adr.0006 §6 대화 잠금 미결과 같은 문제). 바쁜 대기를 없앤다 |
| `CONFIG_DIR_NAME`(`../config.ts`) | `.pi` | 상수 `.fresnel`. config 모듈을 import하지 않는다 | config.ts 결합 해체 |
| `homedir()`, `process.env.HOME` | 직접 읽기 | `LoaderPaths.homeDir` 주입 | 테스트와 OS 차이를 L0로 넘긴다 |
| `existsSync`, `readFileSync`, `writeFileSync`, `mkdirSync` | 동기 fs | `LoaderFs`, `TrustStoreBackend` 비동기 포트 | X는 L0를 import하지 않는다(architecture.layers.spec §4.3.3) |
| `canonicalizePath`, `resolvePath`(`../utils/paths.ts`) | 경로 정규화 | 생성자에 받는 `normalize`(=`LoaderFs.realpath` 기반) | 유틸 결합 해체 |
| `stripBom`(`../utils/text.ts`) | BOM 제거 | 같은 기능의 로컬 함수 3줄 | 유틸 결합 해체 |
| 저장 위치 `~/.pi/agent/trust.json` | 사용자 영역 | `<userDir>/trust.json`(기본 `~/.fresnel/trust.json`) [가정: userDir은 L0.os] | `.fresnel` 사용자 영역 |
| 파일 형식 `Record<path, boolean \| null>` | 값만 | `TrustFileSchema`(`version`, `verdict`, `decidedAt`, `via`) | 버전 관리와 감사 |
| `readTrustFile`의 예외 | 손상이면 던짐 → 시작 실패 | `TrustLookup.kind: "corrupt"` → 불신 처리, 쓰기 거부(§4.7.5) | 손상 파일 하나로 엔진이 시작하지 못하는 일을 막는다. 덮어써서 기존 결정을 잃는 일도 막는다 |
| `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`(30-39) | `.pi/` 아래 8개 | §4.7.2 목록 | Fresnel 자원 이름 |
| `hasTrustRequiringProjectResources`(186-208) | 불리언 | `findTrustRequiringResources`가 찾은 목록을 돌려준다 | 프롬프트와 진단에 보인다 |
| `getProjectTrustOptions`(67-97) | 영어 라벨 5개 | `trustOptions`. 라벨은 L4가 현지화한다. 선택지는 §4.7.3 | 표시는 L4 소관 |
| `resolveProjectTrusted`(`project-trust.ts` 47-97) | 판정 순서 | `resolveProjectTrust`. 순서는 같고 `thread.trust.before` 예외는 거부(F fail-closed) | F.extensions.spec §3.4 27행 |
| `emitProjectTrustEvent` 결과 `undecided` | 결정 없음 | `undefined`(first fold의 결정 없음) | F fold 규칙 |
| `DefaultProjectTrust`(`settings-manager.ts`) | `always`/`never`/`ask` | 설정 키 `x.loading-trust.defaultProjectTrust` | F wire 설정 체계 |
| `AppMode`(`interactive`/`print`/`json`/`rpc`) | 프롬프트 가능 여부 | `LoaderMode`(`interactive`/`headless`) + `TrustPrompter` 유무 | 전송 형태와 무관하게 판정 |

- 라이선스 표기: pi는 MIT다(`~/projects/_ref/pi-src/LICENSE` "Copyright (c) 2025 Mario Zechner", `packages/coding-agent/package.json` `"license": "MIT"`, 소스 1.1.0, 커밋 `cdaf6c2`). 포크 파일 머리에 원본 경로, 커밋, 라이선스 문구를 둔다. 위치는 X.loading-trust.plan §4가 정한다.

#### 4.7.2 신뢰 필요 자원

[제안] 작업 폴더 루트에 아래 중 하나라도 있으면 신뢰 판정이 필요하다. 하나도 없으면 판정 없이 `trusted: true`(`via: "notRequired"`)다(pi `project-trust.ts:51-53`과 같다).

| 경로(작업 폴더 루트 기준) | 대상 |
|---|---|
| `.fresnel/extensions/` | 작업 폴더 확장 |
| `.fresnel/settings.json`, `.fresnel/settings.local.json` [가정: 파일 이름은 L1.persistence.spec] | 작업 폴더·로컬 설정 |
| `.fresnel/mcp.json` | 작업 폴더 MCP 서버(Fresnel 자체 배치, L2.mcp.spec §4.2). 루트 `.mcp.json`은 M5g-2 뒤 엔진이 읽지 않는다(아래) |
| `.fresnel/hooks/` [가정: 외부 훅 위치는 X.operations.spec, M4] | 외부 훅 |
| `.fresnel/skills/`, `.fresnel/commands/`, `.fresnel/prompts/`, `.fresnel/agents/` | 작업 폴더 자원. `.fresnel/commands/`는 `L2.dialog` 슬래시 명령 파일이다(셸 주입을 담을 수 있다. `L2.dialog.spec` §4.2.1a) |
| `.fresnel/SYSTEM.md`, `.fresnel/APPEND_SYSTEM.md` | 시스템 프롬프트 파일 |

- 빈 `.fresnel` 디렉터리는 신뢰를 요구하지 않는다(pi `docs/security.md` "A bare `.pi` directory does not require project trust").
- [결정: 2026-11-17 사용자, M5g-2] 루트 `.mcp.json`과 `.agents/skills`(작업 폴더와 상위 디렉터리)는 신뢰 자원이 아니다. 엔진이 읽지 않으므로 이 자리만 있는 폴더는 판정 없이 `trusted: true`(`via: "notRequired"`)이고, 두 자리는 `resources` 목록에도 들지 않는다. 다른 하네스 형식은 가져오기(`review/m5/migration.md`)로 플러그인 초안이 될 뿐이다. 스킬 로딩(`cap-knowledge`의 `resolveSkillRoots`)도 `.agents/skills`를 읽지 않는다.
- [결정: 오케스트레이터 기본값, fxPT] 이 목록의 파일을 "판정 전에 읽지 않는다"는 로드를 가리킨다. 신뢰 카드가 결정 전에 이름을 보이려고 하는 미리 보기는 §4.7.4의 이름 읽기만 한다.
- `AGENTS.md` 같은 컨텍스트 파일은 이 목록에 없다. pi처럼 신뢰와 무관하게 읽힌다(턴 시작에 `L1.context.spec` §4.2a가 읽는다). `CLAUDE.md`는 읽지 않는다(M5c 미결 5 결정). 내용은 모델 입력으로만 쓰이고 코드로 실행되지 않는다. 그래도 신뢰되지 않은 입력으로 본다(pi `docs/security.md` 작업 폴더 신뢰 절).

#### 4.7.3 판정 순서와 선택지

`resolveProjectTrust`의 순서:

1. `trustOverride`가 있으면 그 값(`via: "override"`). 저장하지 않는다.
2. 신뢰 필요 자원이 없으면 `trusted: true`(`via: "notRequired"`).
3. 이번 호스트 프로세스의 "세션" 기억(`sessionMemory`)에 결정이 있으면 그 값(`via: "sessionMemory"`).
4. `thread.trust.before` 훅을 발화한다. 첫 결정이 `yes`나 `no`면 그 값(`via: "point"`). `remember: true`면 저장한다. 핸들러 예외는 `FIRST_DENY.project_trust`(불신)다(F.extensions.spec §3.4 27행). 결정이 없으면 다음으로 간다.
5. 저장소 조회. `found`면 그 값(`via: "store"`). `corrupt`면 §4.7.5.
6. `x.loading-trust.defaultProjectTrust`가 `always`면 신뢰, `never`면 불신(`via: "default"`).
7. `mode`가 `headless`이거나 `TrustPrompter`가 없으면 불신(`via: "headless"`, 결정 `undecided`). 저장하지 않는다.
8. 프롬프트. 선택지는 아래 표다. 닫거나 취소하면 불신(`undecided`)이고 저장하지 않는다.

| 선택지 | `TrustChoice` | 저장 갱신 |
|---|---|---|
| 이 폴더를 신뢰 | `{ kind: "folder", verdict: "allow" }` | 작업 폴더 루트 `allow` |
| 상위 폴더를 신뢰 | `{ kind: "parent", verdict: "allow" }` | 상위 폴더 `allow`, 작업 폴더 루트 항목 삭제 |
| 이번 "세션"만 신뢰 | `{ kind: "session", verdict: "allow" }` | 없음. `sessionMemory`에 둔다 |
| 이 폴더를 신뢰하지 않음 | `{ kind: "folder", verdict: "deny" }` | 작업 폴더 루트 `deny` |
| 이번 "세션"만 신뢰하지 않음 | `{ kind: "session", verdict: "deny" }` | 없음. `sessionMemory`에 둔다 |

- 결정 3값: 저장소와 결과는 `allow`, `deny`, `undecided`를 쓴다. `undecided`는 저장되지 않는다.
- "이번 세션만"의 "세션"은 호스트 프로세스 수명이다 [제안]. 서비스 모드(adr.0006)에서는 서비스 프로세스가 끝날 때까지 유지된다. thread 단위로 좁힐지는 §10 미결 7.
- 상위 폴더 조회는 pi `findNearestTrustEntry`처럼 루트까지 올라가며 가장 가까운 항목을 쓴다(`trust-manager.ts:45-59`).
- 사용자가 나중에 결정을 바꾸는 경로는 명령(`/trust` 대응, [가정: 이름은 L4.cli.spec])이다. 저장 `via: "command"`.
- [제안] 비대화형 모드의 기본은 불신이다(pi `docs/security.md` "Project trust without an interactive prompt"). `always`를 사용자 설정에 둔 경우만 예외다.

#### 4.7.4 신뢰 전에 실행하지 않는 것과 `thread.trust.before` 발화 시점

시작 순서 [제안]:

1. L0 플랫폼 패키지 등록(조립 루트, `ExtHost.registerPlatform`).
2. 내장, 관리, 사용자 확장의 파이프라인 1~9단계. 작업 폴더 위치는 탐색하지 않는다.
3. `findTrustRequiringResources`로 작업 폴더 루트를 검사한다. 파일 존재만 확인하고 내용은 읽지 않는다.
4. 자원이 있고 `trustOverride`가 없으면 `thread.trust.before`를 발화한다(§4.7.3 4번). 이 시점의 핸들러는 2번에서 활성화된 `builtin`, `user` 등급 확장의 것뿐이다. 발화는 신뢰 판정 한 번에 한 번이다.
5. 신뢰가 `allow`면 작업 폴더 위치를 탐색하고 작업 폴더 후보에 1~9단계를 실행한다. 3단계 집합 검사는 두 번째 실행이다(§4.3.1).
6. `thread.resources`를 발화한다(§7).

신뢰 판정 전에 실행하거나 적용하지 않는 것:

| 대상 | 처리 | 소유 문서 |
|---|---|---|
| 작업 폴더 확장 | 매니페스트 읽기, import, 엔트리 실행을 하지 않는다. 판정 전에는 매니페스트 JSON도 파싱하지 않는다 | 이 문서 |
| 작업 폴더 훅(외부 훅 프로토콜, M4) | 실행하지 않는다 | X.operations.spec |
| 작업 폴더·로컬 설정 파일의 `ext.*` 키와 `x.loading-trust.*` 키 | 유효 값 계산에서 뺀다. 파일에서 지우지 않는다 | 이 문서(규칙), L1.persistence.spec(적용) |
| 작업 폴더 MCP 서버(`.fresnel/mcp.json`) | 기동하지 않고 로드하지 않는다. 카드 미리 보기는 이 파일을 읽어 서버 이름과 `command`·`args`만 본다(아래) | L2.mcp.spec |
| 작업 폴더 스킬·프롬프트·에이전트·시스템 프롬프트 파일 | 자원 목록에 넣지 않는다 | L2.knowledge.spec, L1.context.spec |

- 불신(`deny`, `undecided`)이면 위 표의 대상은 이 실행 동안 계속 제외된다. 작업 폴더 후보는 `rejected`(`trust_denied` 또는 `trust_undecided`)로 진단에 남는다. 탐색은 존재 확인만 한 상태이므로 후보 이름은 디렉터리 이름으로 적는다.
- 작업 폴더 설정 파일의 나머지 키(예: `l1.loop.maxSteps`)를 신뢰 전에 적용할지는 §10 미결 5다. pi는 작업 폴더 설정 전체를 막는다(pi `docs/security.md` "Granting project trust allows Pi to load: project settings").
- [결정: 오케스트레이터 기본값, fxPT] 신뢰 카드의 자원 이름 미리 보기(조립 루트 `apps/host/src/assembly/trust-preview.ts`의 `previewTrustResources`가 만들고, `trust.get`의 `details`로 간다)는 결정이 필요한 판정(`required`이고 `verdict`가 `allow`가 아님)에만 쓴다. 이름만 읽는다. `.fresnel/mcp.json`은 JSON으로 파싱해 서버 이름과 `command`·`args`만 뽑는다. `env`·`url`·`headers` 값은 읽고 버린다. `command`가 없거나 빈 문자열인 서버(원격 `url` 서버 등)와 `args`에 문자열이 아닌 값이 있는 서버는 목록에 싣지 않는다(파일 목록에는 남는다). `.fresnel/hooks`·`skills`·`commands`·`extensions`는 항목 이름만 본다. 실행, import, 등록은 하지 않고 이 파일 말고는 내용을 읽지 않는다. 파일이 손상되었거나 읽지 못하면 그 파일의 서버 목록을 비우고 진단 `trust.preview_skipped`를 남긴다(던지지 않는다). 목록은 상한(`TRUST_DETAILS_LIMITS`)까지만 싣는다.
- [결정: 오케스트레이터 기본값, fxPT] 미리 보기의 상한: 정의 파일 하나는 256 KiB까지만 읽고(넘으면 파싱하지 않고 `too_large`), MCP 정의 파일당 서버 50개, 디렉터리당 이름 100개, `command`와 인자 문자열 512자(말줄임표 포함), 인자 64개까지 싣는다. 잘리거나 빠진 자리가 있으면 `details.truncated`가 참이다. 프로젝트 밖을 가리키는 심볼릭 링크 정의 파일은 따르지 않고 `unreadable`이다.

#### 4.7.5 저장 파일 손상

- `TrustStoreBackend.read`가 실패하거나, JSON 파싱이 실패하거나, `TrustFileSchema` 검사가 실패하면 `lookup`은 `corrupt`다.
- [제안] `corrupt`이면 판정은 불신(`via: "corruptStore"`, 결정 `undecided`)이다. `defaultProjectTrust: "always"`와 `trustOverride`는 여전히 적용한다(1번, 6번이 먼저다). 프롬프트는 띄우지 않는다. 띄워서 저장하면 손상 파일을 덮어써 다른 폴더의 결정을 잃기 때문이다.
- 손상 상태에서 `setMany`는 쓰지 않고 `err({ kind: "corrupt", reason })`를 돌려준다. `resolveProjectTrust`는 저장에 실패해도 결정을 유지하고 결과의 `storeError`로 알린다. 진단 `trust_store_corrupt`를 남기고, L4는 파일 경로와 복구 방법(직접 수정, 초기화 명령)을 보인다.
- pi 형식(`Record<path, boolean | null>`) 파일을 읽으면 [제안] 손상으로 보지 않고 버전 0으로 읽어 같은 의미로 변환한다. 다음 쓰기 때 버전 1로 바꾼다.

#### 4.7.8 작업 폴더 확장의 적재 시점 [결정: review.m3-lower-requirements M3-REQ-38, 오케스트레이터 기본값]

작업 폴더 확장을 싣는 규칙이다. 여러 작업 폴더를 동시에 여는 서비스 프로세스(adr.0006)는 시작 때 작업 폴더를 싣지 않고(`loadAll({ projects: "on_demand" })`), 작업 폴더를 여는 때 `loadProject`가 싣는다. 작업 폴더를 여는 때 싣는 경로(`ensure`, `assembly/project-extensions.ts`)는 모든 호스트 모드(in-process, stdio, 서비스)가 같이 쓴다. [결정: 오케스트레이터 기본값, fxPT] in-process·stdio 호스트는 시작 때 `loadAll({ projects: "cwd" })`가 cwd의 작업 폴더를 판정해 이미 실었을 수 있고, 같은 루트는 `alreadyLoaded`로 다시 싣지 않는다. [결정: 오케스트레이터 기본값, fxPT]

1. 단위: 작업 폴더 루트(정규화한 경로) 하나다. 같은 루트는 한 번만 싣는다(`alreadyLoaded`). 적재가 중단되거나 실패하면 그 루트를 기억하지 않아 다음 호출이 다시 싣는다. 서비스 프로세스 안의 확장 이름은 하나뿐이라(§4.2.2) 먼저 실린 작업 폴더의 확장이 이름을 쥐고, 다른 작업 폴더의 같은 이름은 `name_conflict`로 거부된다. 나중 것만 거부하고 먼저 실린 것은 `active`로 두어 실행과 상태 표시가 어긋나지 않는다 [결정: 감사 LT-01]. 같은 묶음 안의 같은 위치 충돌(§4.2.2)만 둘 다 거부한다. 서비스를 다시 띄우면 처음부터 다시 정한다.
2. 시점: thread를 만들거나 여는 작업 폴더에 대해 모든 호스트 모드가 부른다. 신뢰가 아직 정해지지 않은 폴더(`undecided`)와 거부된 폴더는 아무것도 싣지 않고 묻지도 않는다. `ensure`의 판정은 headless라 프롬프트를 띄우지 않고 저장하지 않으며, 로더를 부르지 않으므로 진단도 남기지 않는다. 결정은 기억하지 않고, 결정이 나온 뒤 다음 호출이 싣는다. [결정: 오케스트레이터 기본값, fxPT]
3. 프롬프트를 받을 클라이언트: 그 폴더를 연 연결이다. thread가 없는 시점이므로 `thread.trust.before` 훅(thread 필요)은 이 경로에서 발화하지 않는다. 호스트는 wire `trust.get`(선택지)과 `trust.decide`(결정)를 쓰고 `approval.requested`와 같은 A안 모양(F wire, review.decisions-2 U-02)이다. `trust.get`은 아무것도 바꾸지 않는다. `trust.decide`가 `allow`를 반환하면 신뢰 포트가 `ensure`를 다시 불러 그 결과를 `trustOverride`로 `loadProject`에 넘긴다. [결정: 오케스트레이터 기본값, fxPT] 로더에 직접 프롬프트를 연결하는 구현(`LoadProjectOptions.prompter`)도 같은 규칙을 따르되 그 호출의 `prompter`로만 간다.
4. "이번 세션만" 결정은 서비스 프로세스 수명 동안 유지한다(§10 7번).
5. 안전 모드이면 판정하지 않고 `safe_mode` 진단만 남긴다.
6. 작업 폴더 확장이 선언한 설정 그룹(`ext.<name>`)은 시작 때 만든 카탈로그에 없다. 서비스 모드에서 작업 폴더 확장의 설정 키는 카탈로그에 추가되지 않는다 [미결].

### 4.8 기능 요구 충족

- 6단계는 `requires`의 각 `{ id, range }`에 대해 다음 둘 중 하나가 있는지 본다. (a) 같은 판정 집합 안에서 `rejected`, `disabled`가 아닌 확장의 `provides`에 `id`가 같고 `version`이 `range`를 만족하는 항목, (b) 코어 기능 레지스트리의 같은 조건 항목 [가정: 레지스트리 API는 X.primitives.spec].
- 없으면 `error`(`capability_missing`)이고 진단에 기능 ID와 범위를 적는다. `optional`은 검사하지 않는다. 실행 중 `optional` 기능이 없을 때의 호출 거부는 F.capabilities.spec §5 2번(`unavailable`)을 따른다.
- 이 단계는 엔트리 실행 전에 한다. 요구가 채워지지 않은 확장의 코드는 실행하지 않는다.

### 4.9 프로세스 격리 [구현: M5b-1]

#### 4.9.0 격리 여부 결정

`builtin`(저장소 패키지)은 늘 엔진 안이다. 사용자·프로젝트 등급은 설정 `ext.<name>.isolation`, 매니페스트 `isolation`, 기본 `process` 순으로 정한다. 설정 값 `none`은 "엔진 안에서 돌리기를 허락하는 예외"다 [결정: 2026-11-17 사용자]. 값을 직접 정한 경우(설정이나 매니페스트가 `process`)를 "명시"라 한다.

| 상황 | 결과 |
|---|---|
| 매니페스트에 `entry`가 없음(코드 없는 확장) | 엔진 안. 띄울 코드가 없어 설정이 `process`여도 격리하지 않는다(`no_entry`) |
| 실효 값 `none` | 엔진 안 |
| `process`, 포트(`process`·`isolation` 의존) 없음 | 명시면 `error`(`isolation_unavailable`), 기본이면 엔진 안 |
| `process`, `plugins[].drives: true` | 격리한다. `drives`는 격리를 막지 않는다(M5 P2). 주도 단계 함수는 `drive.step` 요청으로 자식에서 돈다(F.extensions 부록) |
| 그 밖의 `process` | 호스트 프로세스. `LoadedExtensionInfo.isolation = "process"` |
| 초안(`loadDraft`로 싣는 플러그인 초안) | 설정·매니페스트·기본을 보지 않고 언제나 격리한다. 포트가 없으면 싣지 않는다(§4.9.8) [제안] |

`LoadedExtensionInfo.isolation`은 실제로 도는 곳이다. `bundled` 출처(Helm)는 이 로더의 `InstallSource`가 아니라(내장·관리·사용자·프로젝트 넷뿐) 조립 루트가 `builtin: false`로 싣는 기본 플러그인이고, 사용자 등급이므로 기본 격리의 대상이다. `drives`는 격리를 막지 않는다(위 표의 `drives` 줄, review.m5-drive-isolation §3.1).

#### 4.9.1 구조와 수명

프로세스 하나가 플러그인(확장) 하나를 맡는다. 호스트 프로세스는 엔진 실행 파일을 하위 명령으로 다시 실행한 것이고 OS 샌드박스로 감싼다(§4.9.6). 새 `versionId`는 새 프로세스를 뜻한다. 검토본 후보의 `versionId`는 내용 해시(`sha256:<hex>`)이고 같은 해시의 다시 읽기는 같은 값을 쓴다. 내장과 시험 후보는 `<매니페스트 버전>.<로드 세대>`다([구현: M5c 검토본 단계], `docs/xeon/review/m5/profile-project-loader.md` §9.1). 다시 읽기는 새 감독자를 만들고 옛 것을 내린다. 마지막 등록이 꺼지면 연결을 닫고, 다시 켜면 새 연결을 연다. 감독자는 `dispose` 뒤 쓸 수 없다.

#### 4.9.2 프록시

선언은 `host.init`의 응답이다. 같은 등록 id로 `host.register`를 하고 훅은 `(지점, handlerIndex)`마다 하나씩 대리 핸들러를 건다. 상태 선언의 스키마는 JSON Schema 문서이고 엔진이 그대로 검사에 쓴다(`schemaOfJson`).

#### 4.9.3 직렬화와 취소

모든 값은 JSON이다. 프레임이 상한(`PLUGIN_HOST_MAX_FRAME_BYTES`, 16 MiB, 줄 끝 제외)을 넘는 줄은 두 쪽이 조각 칸(`transfer`)을 주고받아 협상했을 때만 조각 전송(`frame.begin`과 `frame.part`, 아래 단락)으로 보낸다. 협상이 안 된 쪽으로 넘는 줄은 보내지 않고 `frame_too_large`로 실패한다. 참조 넘기기(블롭 참조를 넘기고 조각을 따로 읽는 길)는 하지 않는다. 조각은 통신 층이 나누고 합치므로 플러그인 API, `OrchestrationApi`, `RegistrationApi`, 매니페스트는 바뀌지 않는다.

**입력 상한과의 관계.** 엔진이 받는 입력 상한(`DRIVE_INPUT_MAX_BYTES`, 기본 512 MiB, X.primitives §4.4.1)은 프레임 상한보다 크다. 엔진 안의 등록은 그 상한까지 받는다. 받는 쪽이 격리 등록이면 엔진이 그 등록의 입력 상한을 **기록하기 전에** 본다. 상한은 협상된 엔진 → 자식 조각 상한(엔진 값 `l0.store.maxBlobBytes`와 자식 상한 `PLUGIN_HOST_CHILD_TRANSFER_MAX_BYTES`, 128 MiB, 가운데 작은 값)에서 뼈대 몫 64 KiB를 뺀 값이다 [제안: 뼈대 몫 64 KiB]. 협상이 안 된 격리 등록(조각 칸이 없는 자식, 엔진 값이 없는 조립)은 옛 값 16 MiB − 64 KiB(`ISOLATED_DRIVE_INPUT_MAX_BYTES`)를 쓴다. 표의 "16 MiB를 넘으면"은 협상되지 않은 쪽의 동작이고, 협상된 쪽에서는 같은 자리의 협상된 상한을 넘을 때 같은 규칙이다. 등록마다 상한을 읽는 함수는 `markIsolatedStep`이 단계 함수에 단다(`isolation/mark.ts`). 넘으면 기록하지 않고 거절한다: 사용자 명령의 `startDrive`는 오류 `input_too_large`, `handoff`는 결과 `{ kind: "refused", code: "input_too_large" }`(받는 쪽이 격리 등록일 때), `done`은 맡긴 쪽이 격리 등록이면 `result_too_large`다. 주도 중인 격리 플러그인이 가로챌 사용자 메시지가 이 상한을 넘으면 가로채지 않고 코어 루프가 평소대로 받는다(기록하지 않는다). 그래서 등록은 `driveError`가 되지 않고 주도 프레임도 내려가지 않는다. 아래 표의 `frame_too_large`는 상한 안의 입력에 다른 칸(`last`, 상태 등)이 더해져 한 줄이 넘는 경우의 안전망이다. 격리 여부는 엔진 쪽 대리 등록이 자기 단계 함수에 다는 표시(`isolation/mark.ts`)로 안다(플러그인 API 변화 없음). 실리는 길은 다음과 같다.

| 길 | 싣는 값 | 16 MiB를 넘으면 |
|---|---|---|
| `drive.step` 요청 | `frame.input`(맡기기, 사용자 명령, 되살아난 입력의 `lease.acquired.input`) | 단계 오류, 주도 프레임 `error` |
| `drive.step` 요청 | `last`(가로챈 사용자 메시지, 맡긴 쪽이 받는 `done` 결과) | 단계 오류, 주도 프레임 `error` |
| `drive.step` 응답 | `command`의 `done` 결과, `handoff` 입력, `commit` 상태 | 자식이 오류 프레임으로 바꾸고(`frame_too_large`) 단계 오류 |
| `engine.call` `startDrive` | 자식이 엔진에 거는 시작 입력 | 자식이 보내지 않고 호출이 `frame_too_large`로 떨어진다 |

맡긴 입력을 싣지 않는 길은 `host.init`, `command.run`(인자는 명령 줄 글), `hook.invoke`(훅의 `payload`와 `current`), `method.call`, `tool.execute`, `event.notify`, `state.migrate`다. 같은 상한을 받지만 주도 입력과 무관하다. 상태 문서는 상한 안에 든다(X.primitives §5의 `state_too_large`).

조각 전송으로 격리 플러그인은 협상된 상한 안의 큰 입력을 받는다. 블롭 참조를 넘기고 `blob.read`로 조각을 받는 길(플러그인 API의 변화)은 여전히 없다. 협상이 안 된 격리 등록에는 16 MiB − 64 KiB가 닿고, 넘는 입력은 기록하기 전에 거절한다(`test/isolation/isolated-drive.test.ts`). 협상된 상한의 시험은 `test/isolation/transfer-drive.test.ts`다.

**큰 줄의 조각 전송(프레이밍) [결정: 2026-11-19 사용자, AGE-59 설계 메모 §8].** 쓰는 쪽은 `createFrameWriter`에 `transfer.maxBytes`를 주면 상한을 넘고 그 안인 줄을 시작 알림 `frame.begin`과 조각 알림 `frame.part`로 나눠 보낸다(모양은 `F.extensions.spec` 부록). 한 방향에서 큰 줄은 들어온 순서대로(FIFO) 한 번에 하나씩 나가고, 그 사이에 쓴 작은 줄도 뒤에서 기다린다. 조각을 하나 쓴 뒤에는 `drained()`를 기다리고, `PLUGIN_HOST_TRANSFER_STALL_MS`(30 s)를 넘으면 그 프레임의 전송을 접고 `transfer_stalled`를 알린다. `write`는 줄 세운 프레임에도 `ok`를 돌려주므로, 나중에 나가지 못한 프레임은 `onTransferFailed`로 알린다. `abort`는 프로세스가 죽었을 때 나가지 못한 프레임을 모두 알린다.

받는 쪽은 `createFrameReader`에 `maxTransferBytes`를 주면 시작 알림마다 한 전송만 모아 합치고, 합친 줄을 한 프레임으로 낸다. 조각 알림은 결과로 나오지 않는다. 옵션이 없으면 시작 알림은 `disabled`로 실패한다. 실패는 `transfer_failed` 값 하나이고, `reason`은 다음 가운데 하나다.

| 이유 | 뜻 |
|---|---|
| `disabled` | 받는 쪽이 조각 전송을 켜지 않았다 |
| `too_large` | 시작 알림의 `size`가 받을 수 있는 크기를 넘는다. 조각을 모으기 전에 버린다 |
| `busy` | 받는 중인 전송이 있는데 새 시작 알림이 왔다. 받던 것과 새 것을 모두 버린다 |
| `order` | 전송 번호나 순번이 어긋났다. 조각이 빠지거나 두 번 오거나 시작 없이 오거나, 전송 가운데 조각이 아닌 줄이 왔다 |
| `size` | 조각의 UTF-8 바이트 합이 `size`와 다르다. 넘는 순간 버린다 |
| `hash` | 합친 줄의 `sha256`이 다르다 |
| `truncated` | 전송 중에 입력이 끝났다 |

`frameId`는 시작 알림이 가진 값만 싣는다(`busy`는 새 시작 알림의 값이다). 실패 뒤 그 전송의 남은 조각은 다음 정상 줄이 올 때까지 조용히 버리므로, 실패 하나에 값 하나가 난다. 합친 줄이 JSON이 아니면 `parse_json`, 프레임 모양이 아니거나 조각 알림 메서드를 가지면 `invalid_frame` 값이다. 오류 값에는 줄 글과 해시를 싣지 않는다.

훅의 취소 신호가 서면 `request.cancel` 알림을 보낸다. 시간 초과로 선 신호면 프로세스를 종료하고(SIGTERM, `killGraceMs` 뒤 SIGKILL) 그 요청은 `process_killed`, 같은 프로세스의 다른 요청은 `process_exit`로 끝난다. 취소된 요청의 늦은 응답은 버린다.

**조각 전송의 협상과 상한 [결정: 2026-11-19 사용자, AGE-59 설계 메모 §8.2·§8.4].** 엔진은 띄울 때마다 설정 `l0.store.maxBlobBytes`를 읽는다(맡기기 입력 상한과 같은 값, live). 절대 최대 `PLUGIN_HOST_TRANSFER_HARD_MAX_BYTES`(1 GiB)로 자르고 `host.init` 요청의 `transfer: {maxBytes}`로 알리며, 자식 읽기의 상한으로도 쓴다. 자식은 자기 상한 `PLUGIN_HOST_CHILD_TRANSFER_MAX_BYTES`(128 MiB)를 응답의 `transfer`로 알린다. 엔진 → 자식의 조각 상한은 둘 가운데 작은 값이다. 응답에 칸이 없으면(옛 자식) 조각을 끈다. 자식 → 엔진 방향은 자식이 엔진의 값과 자기 상한 가운데 작은 값으로 나눈다. 엔진의 받는 쪽 상한은 엔진이 알린 값이다.

| 경우 | 호출의 결과 | 프로세스 |
|---|---|---|
| 답(또는 자식의 요청)의 조각이 어긋남: `order`, `size`, `hash`, `busy`, `too_large`, `disabled`, `invalid_frame` | 엔진이 기다리던 요청은 `invalid_response`(메시지에 이유를 싣는다). 자식의 `engine.call`이 깨졌으면 엔진은 `invalid_params` 오류로 답하고, 자식은 `engine.call`을 그 오류로 끝낸다 | 산다 |
| 같은 실패인데 프레임 `id`가 없다(알림) | 기록만 남긴다(`plugin_host.transfer_failed`, 이유만) | 산다 |
| 전송 중에 입력이 끝났다(`truncated`) | 답을 기다리던 요청은 `process_exit`(프로세스가 답을 다 쓰기 전에 끝났다) | 끝났다(죽음으로 센다) |
| 보내는 쪽의 쓰기가 끊겼다(프로세스가 죽었다) | 기다리던 요청은 `process_exit`. 보내던 전송은 멈춘다 | 끝났다 |
| 받는 쪽이 비우지 않는다: 조각 하나를 쓴 뒤 `transferStallMs`(기본 `PLUGIN_HOST_TRANSFER_STALL_MS`, 30 s) 안에 비워지지 않는다 | 요청은 `process_killed`(메시지에 멈춤을 적는다), 함께 떠 있던 것은 `process_exit` | 멈춘다(SIGTERM, 유예 뒤 SIGKILL). 죽음으로 센다 |
| 조각 상한을 넘는 줄 | 보내지 않고 `frame_too_large` | 산다 |
| 큰 줄을 보내는 동안 | 그 요청의 시간 한도 시계는 멈춘다. 전송이 끝나면 남은 시간으로 이어 간다. 엔진이 답을 받는 동안(자식 → 엔진)의 시계는 멈추지 않는다 [미결] [근거: packages/ext-host/src/isolation/supervisor.ts `onFrame`, 읽는 쪽은 호출의 시계를 가리키지 않는다] | — |

기록(`plugin_host.*`)에는 이유(`reason`)와 오류 종류만 싣는다. 조각의 글, 전체 글, 해시, 길이는 싣지 않는다(시험이 본다).

**측정 (AGE-59, 맥, bun 1.4.3, 실제 자식 `bun apps/host/src/main.ts plugin-host --stdio`, 한 조합 한 번 측정이라 ±10~20 %).** 자식 유휴 RSS는 85~92 MiB, 엔진 유휴(측정 도구 제외)는 59~63 MiB다. 자식 최고 RSS는 보내기(값 → 자식, 단계가 값을 다이제스트로 읽는다)와 받기(자식 → 엔진, 같은 크기의 값)를 따로 잰다. 벽시계는 호출 시작부터 답까지이고, 괄호 안은 자식의 단계가 값을 본 시각까지다.

| 크기 | 종류 | 자식 최고 RSS, 보내기 / 받기 (MiB) | 엔진 최고 RSS, 보내기 / 받기 (MiB) | 보내기 벽시계 (단계까지) ms | 받기 벽시계 ms |
|---|---|---|---|---|---|
| 20 MiB | ASCII | 216 / 263 | 188 / 168 | 120 (106) | 76 |
| 20 MiB | 한글 | 211 / 258 | 130 / 125 | 109 (92) | 78 |
| 20 MiB | 객체(1 KB 글 항목) | 204 / 239 | 177 / 131 | 113 (92) | 86 |
| 100 MiB | ASCII | 656 / 836 | 554 / 459 | 506 (435) | 353 |
| 100 MiB | 한글 | 579 / 709 | 303 / 204 | 441 (359) | 354 |
| 100 MiB | 객체 | 773 / 812 | 455 / 404 | 499 (393) | 396 |
| 128 MiB | ASCII | 807 / 863 | 695 / 551 | 638 (552) | 462 |
| 128 MiB | 한글 | 709 / 813 | 376 / 367 | 737 (595) | 715 |
| 128 MiB | 객체 | 903 / 946 | 392 / 326 | 654 (521) | 522 |
| 256 MiB | ASCII | 1479 / 1826 | 1061 / 563 | 1270 (1099) | 906 |
| 256 MiB | 한글 | 1299 / 1515 | 811 / 580 | 1113 (902) | 904 |
| 256 MiB | 객체 | 1611 / 1652 | 1025 / 505 | 1304 (1023) | 1400 |
| 512 MiB | ASCII | 2790 / 3505 | 1913 / 1140 | 2553 (2208) | 1831 |
| 512 MiB | 한글 | 2591 / 3615 | 590 / 704 | 2235 (1816) | 1831 |

- 100 MiB 행은 받는 쪽 조립의 `texts` 참조를 합친 뒤 놓는 줄임(`transfer-read.ts`)을 넣기 전에 잰 것이다. 그 줄임으로 받기만 한 최고 RSS는 358 → 352 MiB로 거의 줄지 않았다. 최고점은 파싱이 글 사본을 하나 더 만드는 순간이라 조각 참조를 놓는 것으로는 내려가지 않는다. 512 MiB의 객체 행은 시간 때문에 재지 않았다.
- 자식 최고 RSS는 받는 쪽이 줄 크기의 약 2.6배, 보내는 쪽이 약 6~7.5배다(100 MiB 측정에서 보내는 쪽은 V8 글 사본과 줄 글이 겹친다). 엔진 쪽은 보내는 동안 최고 RSS가 측정 도구가 든 값보다 줄 크기의 1.1배쯤 늘었다(100 MiB ASCII: 448 → 554 MiB). 기준 1.5배 아래다.
- 판단. 자식 최고 RSS 기준(512 MiB에서 2 GiB 이하, 아니면 256·128 MiB에서 1.5 GiB 이하)에 따라 512 MiB(최고 2.6~3.6 GiB)는 넘고 256 MiB(최고 1.3~1.8 GiB)도 받기 쪽이 넘는다. 그래서 자식 상한은 128 MiB(최고 0.7~0.95 GiB)다. 엔진 설정이 1 GiB여도 실제 상한은 자식 상한으로 줄어든다. 128 MiB 자식 상한이면 입력 상한은 128 MiB − 64 KiB다.
- 측정 값은 `docs/xeon/X/loading-trust/spec.md`에만 싣는다(재현 도구는 저장소 밖이다).


#### 4.9.4 격리 가능 훅

모든 훅이 격리 가능하다. 토큰마다 불리는 스트림 지켜보기 훅(`request.stream`, `boundary.message.update`, `tool.execution.update`)은 응답을 기다리지 않는 알림(`event.notify`)으로 보낸다. 알림은 같은 대화 안에서 발화 순서로 하나씩 가고 적어도 한 번 전달된다(핸들러는 `eventKey`로 멱등이어야 한다). 옛 `isolation_point_unsupported`는 내지 않는다. `g.subscribe`는 자식 안에서 `g.on` 등록 위에 돈다(엔진 안과 같은 `every`·`coalesce`, 선언된 이벤트만, 봉투의 `eventKey`는 엔진 디스패치 키). 선언 목록은 `host.init`의 매니페스트에서 읽는다. 새 훅 넷(`ask.human.*`, `agent.spawn.*`), `tool.call.before`의 `ask`·`replace` 결정과 합치기, `thread.resources`의 `workspace`, 매니페스트 `hookDecides`는 엔진 안과 같게 돈다(결정은 JSON 결과로 돌아와 엔진의 합치기가 처리한다). 내부 훅(`hook_internal`)을 선언한 비내장 플러그인은 자식의 `host.init` 매니페스트 검사에서도 거부된다. 도구의 `ctx.changes.report`는 `engine.call` `reportChanges`로 건넨다.

#### 4.9.5 drive

`drive`는 넘긴다(M5 P2). setup에서 `g.drive(step, options)`를 한 번 받아 두고, 엔진이 주도 단계마다 `drive.step` 요청으로 부른다(F.extensions 부록). 넘기지 않는 API는 `provide`, `providePort`, `registerWebProvider`, `registerShortcut`이다(`startDrive`는 엔진 왕복으로 넘긴다, X.primitives.spec §3.8)(`port`는 `service_reserved`로 답한다). `migrateState`, `hostOf(g).updateState`, `awaitUser`는 프로토콜로 넘긴다(F.extensions 부록). 이름은 진단 메시지에 실린다. 사용자는 `ext.<name>.isolation = none`으로 엔진 안에서 돌린다.

#### 4.9.6 기록 경로와 접근 경계

플러그인의 `commit`, `record`, `post`, `capability`는 모두 `engine.call`로 엔진의 같은 길(상태 서비스, 도구 실행 블록)을 지난다. 신원 `plugin:<이름>`은 엔진이 연결에서 붙인다. 프로세스의 환경 변수는 허용 목록으로만 만든다(DB 경로와 시크릿 없음). 샌드박스: 읽기는 L0 샌드박스의 보호 경로 거부 목록을 따르고(`L0.sandbox.spec` §4.9), 쓰기 루트는 없고, 네트워크는 전체 허용이다 [결정: 2026-11-17 사용자, 3단계에서 플러그인별 허용 목록].

#### 4.9.7 비정상 종료와 재시작

호스트가 스스로 끝나면(`process_exit`) 진행 중 요청은 그 훅의 실패 규칙으로 처리되고(막는 훅은 막고 고치는 훅은 건너뛴다) 다음 호출 때 다시 띄운다. 죽은 시각을 기록하고, 창(`restartWindowSec`초) 안의 죽음 수가 `maxRestarts`를 넘으면 `restart_limit`이다. 창 안에서 `maxRestarts + 1`번째 종료가 그 경우다. 한도 초과는 `onRestartLimit`이 자동 끄기 질문을 부른다. 창 밖으로 나간 죽음은 세지 않는다. 성공한 응답은 죽은 횟수를 지우지 않는다(창이 지나야 빠진다). 설정 `x.loading-trust.isolation.maxRestarts`(정수, 기본 3, 0~20)와 `restartWindowSec`(정수, 기본 600, 10~86400)는 `live`라서 감독자가 죽음을 셀 때마다 읽는다(조립 루트가 읽기 함수로 넘긴다, L4.host-service §4.9). 값이 없으면 기본을 쓴다. 엔진이 죽으면 호스트는 표준 입력이 닫힌 것을 보고 스스로 끝난다. 그래도 남은 자식은 다음 엔진 시작 때 정리한다(L4.host-service §4.9 "고아 정리"). 표준오류는 엔진이 모아(줄 상한, 시크릿 마스킹) 진단에 잇는다.

#### 4.9.8 초안 적재 [제안, AGE-19 A2]

초안(저장소의 `drafts/<draftId>/tree`)은 `ExtensionLoader.loadDraft`로만 싣는다. 설치 뒤 새 이름 싣기(§4.4.4)와 같은 파이프라인(검증, 집합 검사, 신뢰 상한, 설치)을 쓰고 다음만 다르다.

- 격리는 강제다. 설정 `ext.<이름>.isolation`, 매니페스트 `isolation`, 기본 규칙을 보지 않고 언제나 `process`다. 띄우기 포트와 띄우기 설정이 없으면 `isolation_unavailable`로 싣지 않는다. 엔진 안에서 도는 경로가 없다. 매니페스트에 `entry`가 없으면 띄울 코드가 없으므로 `draft_entry_missing`(단계 `isolation`)으로 거부한다.
- 출처는 사용자 등급(`source: "user"`)이고 신뢰 상한은 §4.6을 따른다.
- 내부 이름: `internalDraftName(plugin, draftId)` = `d` + 초안 식별자(`drf_` 접두를 뗀 ULID)의 소문자 영숫자 끝 여섯 글자 + `-` + 플러그인 이름. 앞쪽은 시간이라 같은 때 만든 판끼리 겹치므로 무작위인 끝을 쓴다 [구현 2026-11-20, enTr]. 플러그인 이름 부분은 전체가 32자가 되도록 자른다. 검토본과 등록이 겹치지 않게 하려는 것이다(`registration_duplicate` 방지). 매니페스트 `name`은 검증 전에 내부 이름으로 바꾼다. 그래서 등록 id, 테이블 접두와 도구 접두가 내부 이름을 따르고, 엔트리는 `manifest.name`으로 등록해야 한다(고정 이름이면 `plugin_not_registered`). 초안 매니페스트가 다른 플러그인 이름을 적으면 `manifest_invalid`다. 자른 이름이 겹치면 `name_taken`이다.
- 판 식별자(`versionId`)는 `draft:<draftId>:<내용 해시 앞 8자>`다. 격리 라벨은 `ext:<내부 이름>:<versionId>`다.
- `LoadedExtensionInfo`는 `isolation: "process"`이고 `name`은 내부 이름이며 `draft: { plugin, draftId }`를 더한다.
- 로더는 싣기에 성공한 초안을 내부 이름 표로 든다(`loadDraftsOf()`, `draftOf(내부 이름)`). 초안은 이 표로만 구분하고 이름 모양으로 판단하지 않는다.
- `loadAll`과 `reload`는 초안을 다루지 않는다. 초안에 `reload`와 `reloadFromReviewed`를 부르면 `not_reloadable`(`reason: "draft"`)이다. 내리기는 `unloadDraft`(또는 `unload`)이고, 재시작하면 초안은 실리지 않아 호출자가 다시 싣는다.
- 실패하면 호스트에 설치도 기록도 남지 않는다. 꺼진 기록도 남기지 않는다.

싣지 못한 이유(`LoadDraftFailure.kind`) [제안]: `isolation_unavailable`(포트나 띄우기 설정이 없다), `already_loaded`(같은 플러그인과 초안 식별자가 실려 있다), `name_taken`(내부 이름을 다른 확장이나 다른 초안이 쓴다), `safe_mode`, `not_found`(매니페스트가 없다), `not_active`(`state`는 `rejected`, `error`, `disabled` 가운데 하나이고 진단을 싣는다).

### 4.10 pi 확장 호환 (두지 않음)

[결정: review.m3-design-inputs D-M3-11 c, adr.0017 §3.7] pi 확장 어댑터, pi 가상 모듈, 설정 `x.loading-trust.piCompat`, pi 확장 디렉터리, `pi_*` 진단 코드는 없다. 외부 확장은 자체 확장 API(`.fresnel-plugin/plugin.json` 매니페스트와 `ExtensionEntry`)로만 싣는다. 가상 모듈 등록 수단은 SDK 모듈 세 개를 플러그인 번들에 주는 용도뿐이다(§4.4.6).

## 5. 실패와 경계 사례

| 사례 | 처리 |
|---|---|
| `plugin.json`이 JSON이 아님 | `rejected`(`manifest_parse`). 다른 확장은 계속 |
| 플러그인의 `hooks`에 없는 훅에 Registration setup 중 `on` | primitives가 `PrimitiveError("hook_undeclared")`로 setup을 끝내고 등록을 되돌린다 → `usage_invalid`(issues에 `hook_undeclared`), `error`(F.extensions.spec §5 1번, §4.4.3 표) |
| 활성 뒤 핸들러 안에서 선언 밖 훅에 `on` | 그 호출만 `PrimitiveError("hook_undeclared")`로 거부, primitives 진단(`ExtHostDeps.report`). 확장은 계속 |
| 엔트리 본문이 throw | `error`(`entry_threw`). 등록 없음. 다른 확장과 시작은 계속 |
| scope setup이 throw | `error`(`setup_threw`). 등록 되돌림. 다른 확장과 시작은 계속 |
| scope setup 본문에서 `post`·`state()` 호출 | `PrimitiveError("no_thread")` → `error`(`setup_action`) |
| 안전 모드 또는 `--disable-ext`로 빠진 확장 | `disabled`(`safe_mode`, `disabled_flag`). 외부 확장은 import하지 않고 내장 확장은 install하지 않는다 |
| 내장 필수 확장이 throw | `LoadAbortError`, 시작 거부 |
| 같은 이름이 사용자와 작업 폴더 위치에 모두 있음 | 사용자 것을 쓰고 작업 폴더 것은 `rejected`(`name_conflict`) |
| 외부 확장이 `trust.level: "builtin"` | `rejected`(`trust_exceeds_source`) |
| 매니페스트 디렉터리에 `plugin.json`이 없음 | 진단 `manifest_missing`(경고)만 남기고 건너뛴다 |
| `entry`가 가리키는 파일이 없음, 함수 export가 없음, import 중 예외, 확장 루트 밖으로 풀림 | `error`(각각 `entry_not_found`, `entry_not_function`, `entry_import_failed`). 다른 확장은 계속 |
| 취소 신호가 설치 중에 켜짐 | `ExtHost.install`이 엔트리를 기다리지 않고 끝내고 `loadAll`은 `LoadAbortError`를 던진다 |
| 비대화형 실행, 작업 폴더에 `.fresnel/extensions/` 있음, 저장 결정 없음 | 불신. 작업 폴더 확장은 import되지 않고 `rejected`(`trust_undecided`) |
| `thread.trust.before` 핸들러가 throw | `FIRST_DENY.project_trust`(불신). 저장하지 않는다 |
| 신뢰 저장 파일 손상 | 불신(`corruptStore`), 프롬프트 없음, 쓰기 거부, 진단 |
| 프롬프트 중 사용자가 창을 닫음 | 불신(`undecided`), 저장 없음 |
| `ext.foo.enabled = false` | 엔트리를 실행하지 않는다(`disabled`) |
| userConfig `setting`이 `l1.loop.maxSteps` | `foreignNamespace` → `rejected`(`settings_rejected`) |
| `requires: [{ id: "web.search", range: "^2.0.0" }]`인데 provider가 1.x | `error`(`capability_missing`). 진단에 기능 ID와 범위 |
| provider 확장이 9단계에서 실패 | 그 기능을 `requires`한 확장도 `error`(`capability_provider_failed`) |
| 격리를 명시했는데 `fresnel.process` 서비스나 `isolation` 의존이 없음 | `error`(`isolation_unavailable`). 기본값이 정한 격리면 엔진 안에서 돌리고 `LoadedExtensionInfo.isolation`은 `none`으로 보고한다(§4.9.0) |
| 격리 확장의 first 핸들러가 예산 초과 | `FIRST_DENY` 적용, 취소 전송, 유예 뒤 강제 종료 |
| 격리 프로세스 연결 끊김 | 진행 중 요청 예외 처리, 재시작 정책(§4.9.7) |
| 화면 파일이 없거나 JSON이 아니거나 트리 검사에 실패함 | 그 항목만 `invalid`(`ui_file_missing`, `ui_invalid`, `ui_limit`). 확장은 `active`이고 훅이 실행된다(§4.3.4) |
| 화면 파일이나 app root가 확장 밖을 가리키는 심볼릭 링크 | `ui_path_invalid`. 링크 대상은 읽지 않는다 |
| 작업 폴더 확장의 앱 화면, 또는 `x.ui.apps` 거짓 | 앱 파일을 보지 않는다. `fallback`이 있으면 native로 그리고 정보 진단 `ui_mode_not_allowed`, 없으면 `disabled` |
| `ui.widgets` 또는 `app.bridge` 범위가 호스트 버전 `1.0.0`을 포함하지 않음 | `widgets_unsupported`(native 항목 모두) 또는 `bridge_unsupported`. 그 항목은 `invalid` |
| 매니페스트 `ui`의 모양 오류(`validateUi`) | 매니페스트 거부(`manifest_invalid`). 화면 파일은 읽지 않는다 |

## 6. 설정 노출

F.wire-settings.spec §6의 열 형식을 따른다. 모든 키의 `ui.tab`은 `plugins`, `secret`은 거짓이다.

| 키 | 타입 | 기본값 | range | runtimeChange | allowedScopes | ui.widget |
|---|---|---|---|---|---|---|
| `ext.<name>.enabled` | `boolean` | 매니페스트 `defaultEnabled`, 없으면 `true` | - | `live` | `managed` | `toggle` |
| `ext.<name>.isolation` | `"none" \| "process"` | 매니페스트 `isolation`, 값이 없으면 `"process"` | enum `none`, `process` | `restart` | `managed`, `user` | `select` |
| `x.loading-trust.defaultProjectTrust` | `"ask" \| "always" \| "never"` | `"ask"` | enum | `restart` | `managed`, `user` | `select` |
| `x.loading-trust.paths` | `string[]` | `[]` | - | `restart` | `managed`, `user` | `list` |
| `x.loading-trust.isolation.maxRestarts` | `integer` | `3` | 0~20 | `live` | `managed`, `user` | `number` |
| `x.loading-trust.isolation.restartWindowSec` | `integer` | `600` | 10~86400 | `live` | `managed`, `user` | `number` |
| `x.loading-trust.sourceWatch` | `boolean` | `true` | - | `live` | `managed`, `user` | `toggle` |
| `x.ui.apps` | `boolean` | `true` | - | `restart` | `managed`, `user` | `toggle` |
| `x.ui.allowProjectApps` | `boolean` | `false` | - | `restart` | `managed`, `user` | `toggle` |

- [결정: 2026-11-18, 사용자, AGE-9] 격리 플러그인 프로세스 재시작 한도는 10분 안에 3회를 유지한다(`isolation.maxRestarts` 기본 3, `isolation.restartWindowSec` 기본 600). 코드의 기본도 같다(`isolation/supervisor.ts`의 `PLUGIN_HOST_RESTART_DEFAULTS`).
- `x.loading-trust.*` 키는 작업 폴더 범위를 허용하지 않는다. 저장소를 받는 것만으로 신뢰·탐색 설정이 바뀌지 않게 하기 위해서다(F.wire-settings.spec §4.7 규칙 4).
- `x.ui.*` 키도 같은 이유로 `project` 범위를 허용하지 않는다. F.wire-settings.spec 범위 표 3번의 `local`(작업 폴더의 개인 파일)도 작업 폴더가 쓴 값이라 빼며, `launch`는 `restart` 키에 D7 규칙으로 막힌다. 앱 정책은 시작 때 읽으므로 바뀐 값은 다음 시작에 적용된다. `x.ui.apps`를 끄면 작업 폴더가 `local`로 다시 켤 수 없다.
- [결정: 2026-11-12 dzX] 조립 루트(`apps/host`)는 재시작할 때 `x.ui.apps`, `x.ui.allowProjectApps`를 읽어 로더 `loadAll`의 `uiPolicy`로 싣는다(`apps/host/src/assembly/settings-sources.ts` `uiPolicyOf`, `apps/host/src/assembly/external.ts` `loadAllOptionsOf`). 불리언이 아닌 칸은 싣지 않아 로더 기본(앱 켬, 작업 폴더 앱 끔)을 쓴다. 작업 폴더 앱 끔이 보수적인 쪽이라 모르는 값도 그쪽으로 간다. 앱 정책 칸은 데스크톱 화면이 설정 값을 직접 읽어 항목을 가리는 일도 맡으므로, 화면과 엔진은 다음 시작까지 값이 어긋날 수 있다 [근거: `apps/desktop/src/plugin-ui/placements.ts`(화면 쪽 `appsAllowed`), `packages/ext-host/src/loading-trust/index.ts` `loadAll` `uiPolicy`].
- 안전 모드 키(`x.operations.safeMode.default`, `x.operations.safeMode.suggestAfter`)는 X.operations.spec 소유다. L4.settings-ui.spec §표가 `x.loading-trust.*`에 안전 모드를 넣은 표기는 정합성 단계에서 `x.operations.*`로 고친다 [제안].
- L4 노출: 설정 화면 "플러그인" 탭에 확장 목록(상태, 등급, 위치, 진단 수), 토글(`enabled`), 격리 선택(`isolation`), 신뢰 결정 목록(저장 파일 내용)을 둔다. CLI는 `fresnel config`로 같은 키를 다룬다.

## 7. 훅

| 훅 | 이 문서의 역할 | 발화 시점 |
|---|---|---|
| `thread.trust.before`(session, first) | 발화한다 | 작업 폴더 신뢰 판정 4번(§4.7.3). 내장·관리·사용자 확장 활성화 뒤, 작업 폴더 탐색 전. 판정 한 번에 한 번 |
| `thread.resources`(session, chain) | 발화한다 | `loadAll` 끝(모든 단계 뒤) `reason: "startup"`, `reload` 끝 `reason: "reload"`. 로더 수명에 맞춘다 [제안]. 작업 폴더 불신이면 작업 폴더 확장의 핸들러는 없다 |

- post, drive와의 관계: 로더는 post와 drive를 직접 쓰지 않는다. 격리 확장의 post는 `OutboxAgent`가 그 확장 scope로 대신 실행한다(§4.9.6). drive는 격리 확장에도 허용한다(§4.9.5, M5 P2).
- 4연산 사용과 매니페스트의 대조(`validateUsage`)는 primitives가 `install` 안에서 하고, 로더는 그 결과를 진단으로 옮긴다(§4.4.3). 연산 실행 자체도 X.primitives.spec이다.

## 8. 다른 문서와의 인터페이스

제공:

| 이름 | 쓰는 문서 |
|---|---|
| `createExtensionLoader`, `ExtensionLoader`, `LoadOptions`, `LoadProjectOptions`, `LoadReport`, `ProjectLoadReport`, `LoadAbortError`, `LoaderDeps`, `BuiltinExtensionModule`, `RemovalPreview`, `RemoveResult`, `ReloadOptions`, `ReloadStarted`, `ReloadApplied`, `ReloadFailure`, `LoadInstalledStarted`, `LoadInstalledFailure` | L4.host-service.spec(조립 3·5단계, 로더를 직접 보유), L4.settings-ui.spec·L4.cli.spec(제거 확인) |
| `LoadedExtensionInfo`, `LoadDiagnostic`, `LoadDiagnosticSchema`, `LoadState` | L4.settings-ui.spec, L4.host-service.spec(`host.status`), X.operations.spec |
| `TrustLevel`, `TRUST_LEVELS`, `TRUST_MATRIX`, `SOURCE_TRUST` | F.extensions.spec(`TrustRequestSchema` 값 확정), X.primitives.spec(연산 허용 검사), X.operations.spec |
| `ProjectTrustResult`, `TrustPrompter`·`TrustPromptRequest`·`TrustChoice`(F 이름 재export) | L4.cli.spec, L4.desktop.spec(프롬프트 구현) |
| `TrustStoreBackend`, `LoaderFs`, `LoaderPaths`(F 이름 재export) | L0.os.spec(구현) |
| `IsolationProcessPort`, `IsolatedChild`(F 이름 재export) | L0.process.spec(구현) |
| `registerSdkModules`, `X_SDK_MODULES`, `SDK_MODULE_SPECIFIERS`, `SdkModules`, `installDefaultPlugin`, `readBundleManifest`, `BundleManifest`, `PluginInstallFs` | L4.host-service.spec(조립 루트가 `LoaderDeps.sdkModules`와 첫 실행 설치에 사용, `registerSdkModules`·`X_SDK_MODULES`는 L3 `plugin-builder`의 설치본 replay가 로더와 같은 목록을 등록하는 데도 사용 [결정: 2026-11-04 사용자 지시에 따른 기본값], `readBundleManifest`는 버전 목록의 번들 판을 읽는 데 사용) |
| `createVersionHistory`, `VersionHistory`, `VersionHistoryDeps`, `VersionHistoryFs`, `VersionHistoryError`, `VersionListing`, `VersionRecordOutcome`, `VersionSkipReason`, `VersionSource`, `RecordVersionInput`, `RollbackHooks`, `RollbackReloadOutcome`, `RollbackVersionInput` | L4.host-service.spec(조립 루트가 `VersionHistoryFs`를 node:fs로 구현해 `installDefaultPlugin`의 `history`와 `ext.versions`·`ext.rollback` 처리기에 넘긴다), L4.desktop-ux.spec(W-31, O-11, §6.24.1) |
| 예약 키 `ext.<name>.enabled`, `ext.<name>.isolation`, 키 `x.loading-trust.*` | F.wire-settings.spec, L4.settings-ui.spec, L3.readme |
| 키 `x.ui.apps`, `x.ui.allowProjectApps`(`uiSettings`) | L4.settings-ui.spec(설정 화면 "플러그인" 탭), L4.host-service.spec(조립 루트가 카탈로그에 더하고 `LoadOptions.uiPolicy`에 넘긴다) |
| `uiSettings`, `resolveAppFile`, `AppFileResult`, `UiItemReport`, `UiEntryReport`, `UiIssue`, `ExtensionLoader.uiEntries`, `LoadOptions.uiPolicy` | L4.desktop-ux.spec(`ext.ui.list` 화면 기여 목록, 전용 URL 스킴 `fresnel-view://`의 파일 풀이), L4.host-service.spec |
| 신뢰 전 적용 제외 규칙(§4.7.4) | L1.persistence.spec, L2.mcp.spec, L2.knowledge.spec, X.operations.spec |

요구:

| 이름 | 출처 |
|---|---|
| `ExtensionManifest`, `ExtensionEntry`, `RegistrationFn`, `validateManifest`, `validateUsage`, `validateManifestSet`, `ManifestIssue`, `HOOKS`, `FIRST_DENY`, `HookName`, `ProjectTrustDecision` | F.extensions.spec |
| 로더 포트 `LoaderFs`, `LoaderPaths`, `TrustStoreBackend`, `TrustPrompter`와 부속 타입(`TrustPromptRequest`, `TrustOption`, `TrustUpdate`, `TrustChoice`, `TrustChoiceKind`), `IsolationProcessPort`, `IsolationSpawnSpec`, `IsolatedChild` | F.extensions.spec §3.2.1 `ports.ts` |
| `settingsFromManifest`, `buildCatalog`, `defineSettings`, `SettingDef`, `CatalogIssue` | F.wire-settings.spec |
| `CapabilityId`, `SemVer`, 범위 비교 [가정: `satisfies` 함수] | F.capabilities.spec |
| `UiDecl`, `UiContribution`, `AppDecl`, `UiNode`, `UI_LIMITS`, `BRIDGE_VERSION`, `validateUi`, `validateUiTree`, `isEntryInsideRoot` | F.extensions.spec §3.1.1 |
| `ExtHost.install`·`uninstall`·`registerPlatform`·`ports`, `ExtensionUnit`, `InstallResult`, `RegistrationSetupOutcome`, `PrimitiveError`, `ProcessPortKey`, `RegistrationFn` 구현, 디스패처, 리소스 등록, 코어 기능 레지스트리, scope 켜기·끄기 | X.primitives.spec |
| `OperationsPolicy.admit`·`forget`, `startupFilter`·`StartupOptions`(순수 함수와 타입), `ExtStorageAdmin`, 시간 예산(`x.operations.budget.setupMs`), 실패 격리·자동 끄기, 안전 모드, 접두 테이블 API, 외부 훅 | X.operations.spec |
| 의존 규칙(DR-07, DR-11, DR-14) | eng.dependency-rules.guide |
| outbox 규칙(§7) | eng.transactions.design |
| 층 순위와 주입 원칙(§4.3.3) | architecture.layers.spec |
| 단일 DI와 플러그인 로더 부재 | adr.0002 |
| 격리 2차, 서비스 모드 유휴 종료 | adr.0006 |
| 4연산 | adr.0007 |

## 9. 수용 기준

1. `hooks`에 `tool.call.before`만 선언한 플러그인이 Registration setup에서 `on("boundary.step.after", …)`을 호출하면 그 확장은 `error`이고 진단 코드는 `usage_invalid`, `issues`에 `hook_undeclared`가 있다. 그 확장의 다른 등록도 남지 않는다.
2. 내장 필수가 아닌 확장 셋 중 가운데 확장의 엔트리가 throw해도 나머지 둘은 `active`이고 `loadAll`은 성공한다.
3. `essential: true` 내장 확장의 엔트리가 throw하면 `loadAll`이 `LoadAbortError`를 던지고 진단에 `essential_failed`가 있다.
4. 작업 폴더 신뢰 판정 전에는 작업 폴더 확장의 엔트리 모듈이 import되지 않는다(가짜 `LoaderFs`와 import 기록기로 확인). `thread.trust.before` 핸들러가 `no`를 돌려주면 끝까지 import되지 않는다.
5. `mode: "headless"`, 저장 결정 없음, `defaultProjectTrust: "ask"`이면 작업 폴더 확장이 로드되지 않고 `ProjectTrustResult.via`가 `headless`, 진단 코드가 `trust_undecided`다.
6. 관리 잠금(`ext.<name>.enabled`가 관리 범위에서 거짓)인 확장은 엔트리가 한 번도 호출되지 않고 상태가 `disabled`다. 잠금이 없고 매니페스트 기본이 꺼졌으면 `ensureLoaded`(대화가 쓸 때)가 엔트리를 한 번 부른다. 이 값은 사용자 범위에서 바꿀 수 없다(D10).
7. 격리 확장 프록시의 `tool.call.before` 핸들러가 시간 예산을 넘기면 결정은 `FIRST_DENY.tool_call`이고 자식에게 취소가 전송된다(가짜 `IsolationProcessPort`).
8. (삭제) pi 어댑터는 두지 않는다.
9. `requires: [{ id: "web.search", range: "^1.0.0" }]`인 확장은 provider가 없으면 엔트리가 실행되지 않고 진단 `capability_missing`에 기능 ID가 있다.
10. 같은 후보 집합을 섞은 순서로 넣어도 `orderManifests` 결과와 `loadIndex`가 같다.
11. 신뢰 저장 파일이 JSON이 아니면 판정은 불신(`via: "corruptStore"`)이고, 프롬프트가 호출되지 않으며 `setMany`가 `TrustStoreCorruptError`를 던진다. 파일 내용은 바뀌지 않는다.
12. userConfig의 `setting`이 `l1.loop.maxSteps`인 확장은 `rejected`(`settings_rejected`)이고 `LoadReport.settingGroups`에 그 확장 그룹이 없다.
13. 사용자 위치와 작업 폴더 위치에 같은 이름이 있으면 사용자 것이 `active`, 작업 폴더 것이 `rejected`(`name_conflict`)다.
14. 이 문서 §4.6.2 표의 각 행·열과 `TRUST_MATRIX` 상수가 같다(문서 대조 테스트).
15. 외부 확장 매니페스트의 `trust.level: "builtin"`은 `trust_exceeds_source`로 거부된다.
16. 외부 확장의 `entry`가 없는 파일이거나 함수 export가 없거나 import 중 던지면 그 확장만 `error`(`entry_not_found`, `entry_not_function`, `entry_import_failed`)이고 다른 확장의 로드는 계속된다.
17. 사용자 위치의 외부 확장은 `<userDir>/extensions/<이름>/.fresnel-plugin/plugin.json`에서 발견되어 `user` 등급, `user` tier로 로드되고 `on` 핸들러가 호출된다. 플러그인이 import한 `@fresnel/contracts`, `typebox`, `@fresnel/orchestration-sdk`은 호스트가 넘긴 값과 같다.
18. 격리 자식이 `restartWindowSec` 안에 `maxRestarts + 1`번 끝나면 상태가 `error`(`isolation_restart_limit`)다.
19. 로더는 Cordis를 import하지 않는다. 확장 엔트리는 `ExtHost.install`로만 실행되고(가짜 `ExtHost`의 호출 기록으로 확인), scope setup 본문의 `post`는 `setup_action`, 엔트리 본문 예외는 `entry_threw`가 된다.
20. `policy.admit`이 `TierError`를 내면 그 확장은 install되지 않고 진단이 `tier_rejected`다.
21. `previewRemoval`은 아무것도 바꾸지 않고 테이블 목록만 돌려준다. `remove(name, { dropTables: true })`는 `uninstall`, `forget`, `dropExtension(name, true)`를 이 순서로 부른다. `dropTables: false`면 테이블이 남는다.
22. `LoadOptions.startup`의 `disabled`에 든 외부 확장은 엔트리가 import되지 않고 상태가 `disabled`, 진단이 `disabled_flag`다. 내장 확장이면 `install`이 불리지 않는다.
23. 안전 모드에서는 사용자 위치 외부 확장이 `disabled`(`safe_mode`)이고 엔트리가 import되지 않으며, L3 내장 플러그인이 `disabled`이고 L1·L2 내장은 `active`다. 작업 폴더 위치는 탐색하지 않고 `LoadReport.projectTrust`는 null이다.
24. 깨진 `plugin.json`(JSON 아님, 스키마 위반, 파일 없음)은 진단(`manifest_parse`, `manifest_invalid`, `manifest_missing`)만 남기고 다른 확장은 로드된다.
25. `installDefaultPlugin`은 없는 대상에 복사하고(`installed`), 같은 버전은 그대로 두며(`kept`), 번들이 더 높은 버전이거나 설치본 매니페스트가 손상이면 교체한다(`replaced`). 번들 매니페스트가 잘못되면 `source_invalid`이고 대상은 바뀌지 않는다.
26. 화면 파일이 없거나 JSON이 아니거나 트리 검사에 실패한 항목은 그 항목만 `invalid`(`ui_file_missing`, `ui_invalid`)이고, 확장은 `active`이며 훅이 실행된다. 진단의 `stage`는 `ui`, `path`는 `/ui/items/0/file`이다(`ui-loader.int.test.ts`).
27. 1 MiB를 넘는 화면 파일은 `ui_limit`이고, 정확히 1 MiB인 파일은 읽힌다(`ui-check.test.ts`).
28. 확장 밖을 가리키는 심볼릭 링크인 화면 파일과 app root는 `ui_path_invalid`이고, 링크 대상은 읽히지 않는다.
29. `app.bridge` 범위가 `1.0.0`을 포함하지 않으면 `bridge_unsupported`다. `ui.widgets`가 `1.0.0`을 포함하지 않으면 native 항목 모두 `widgets_unsupported`이고 `invalid`다.
30. `x.ui.apps`가 거짓이거나 작업 폴더 확장에서 `allowProjectApps`가 거짓이면 앱 파일을 보지 않고 `fallback`을 native로 그린다(정보 진단 `ui_mode_not_allowed`). `fallback`이 없으면 `disabled`다. 작업 폴더 확장에서 `allowProjectApps`를 켜면 같은 항목이 앱으로 검사된다(`ui-loader.int.test.ts`).
31. 꺼진 확장의 깨진 화면도 검사되어 `uiEntries()`에 `invalid`로 나온다. 내장 확장의 화면은 검사하지 않는다. 확장이 목록에서 빠지면 `uiEntries()`에서도 빠진다.
32. `resolveAppFile`의 적대적 요청 표 25개(`../secret.txt`, `%2e%2e/`, `..%5c`, NUL, 드라이브 문자, 심볼릭 링크 탈출 등)가 정확한 `outside_root`, `not_found`, `not_a_file`, `forbidden_type` 또는 성공 값을 낸다. 퍼센트 디코딩은 한 번만 한다(`%252e%252e`는 문자 그대로의 이름이다). 파일 본문은 읽지 않는다(`app-files.test.ts`).
33. `uiSettings`의 두 키는 카탈로그 규칙을 통과하고, 허용 범위는 `managed`, `user`뿐이다(`project`, `local`, `launch` 없음). `ui-settings.test.ts`.
34. 보관은 확장마다 설치 시각이 늦은 5개를 남기고, 방금 기록한 버전은 지우지 않는다. 같은 버전을 다시 기록하면 바뀐다. 잘못된 이름과 버전(`../x`, `1.0`)은 파일을 쓰기 전에 `invalid_name`, `invalid_version`으로 거부된다. 깨진 메타 항목은 목록에서 빠지고 `skipped`에 사유와 함께 나온다(`version-history.test.ts`).
35. 되돌리기 왕복: 두 버전을 기록하고 앞 버전으로 되돌리면 설치 위치의 파일이 기록과 같고, 되돌리기 전 설치본이 보관에 남으며, 훅은 `disable`→`enable` 순서로만 불린다. 대상보다 상태 스키마가 높으면 `state_schema_mismatch`로 멈추고 파일이 그대로다. `clearState`로 다시 하면 `clearState`가 `enable`보다 먼저 불린다. 교체가 실패하면 원래 파일이 돌아오고 확장이 다시 켜진다(`version-history.test.ts`). L4.desktop-ux.spec Y11의 왕복 시험이 이 파일이다.
36. 기본 플러그인이 `history`와 함께 교체하면 이전 설치본과 새 번들 버전이 기록된다. 이전 설치본을 기록하지 못하면 교체하지 않는다. 첫 설치는 기록하지 않는다(`default-plugin-history.test.ts`).

## 10. 미결 사항

1. (해소) [결정: review.decisions-2 U-14] 포트 타입(`LoaderFs`, `LoaderPaths`, `TrustStoreBackend`, `TrustPrompter`와 부속 타입, `IsolationProcessPort`, `IsolationSpawnSpec`, `IsolatedChild`)의 정본은 F.extensions.spec §3.2.1 `ports.ts`다. X 순위 유지의 조건 2(architecture.layers.spec §4.3.3, X가 받는 포트와 각 층의 서비스 인터페이스는 F에 정의한다)를 따른다. 이 문서는 §3.2, §3.7, §3.8에서 F 이름을 다시 export만 하고 자기 정의를 두지 않는다.
2. [미결] 엔트리 export 형태. F.extensions.spec §3.2는 `ExtensionEntry`를 default export로 적었고, Fresnel lint는 default export를 막는다. [제안] 내장은 named `extension`, 외부는 `default` 또는 `extension`을 허용한다. F 주석 수정 요청.
3. [미결] F `validateManifest`의 `name_reserved` 판정이 매니페스트 `trust.level`에만 의존한다. [제안] F가 설치 위치를 인자로 받거나, 로더의 `trust_exceeds_source` 검사를 정본으로 둔다. F 수정 요청.
4. [미결] `untrusted` 처리(§4.6.3). [제안] 로드하지 않음. 격리와 샌드박스를 함께 쓰는 경로가 생기면 격리 강제를 다시 검토한다.
5. [결정: review.m3-design-inputs D-M3-31 행 3] 작업 폴더 설정 파일의 키는 `ext.*`, `x.loading-trust.*` 밖의 것도 신뢰 뒤에만 적용한다(§4.7.4).
6. [미결] 로드 진단을 내구·휘발 이벤트로 낼지와 type 접두(`ext.`/`extension.`). F.records.spec과 eng.context-map.design 변경이 필요하다.
7. [결정: review.m3-design-inputs D-M3-31 행 3] "이번 세션만" 신뢰의 범위는 호스트 프로세스 수명이다. 서비스 모드에서도 thread·클라이언트 단위로 좁히지 않는다.
8. (닫힘, M5 P2) 격리 확장의 drive 허용(§4.9.5). 단계 함수는 `drive.step` 요청으로 자식에서 돈다.
9. (닫힘) pi `pi-coding-agent` 도구 팩토리 15종의 대응. pi 어댑터를 만들지 않으므로 대상이 없다 [결정: review.m3-design-inputs D-M3-11 c].
10. [결정: review.decisions-2 U-24] TypeBox 버전은 1.3.27이다. 가상 모듈 `typebox`가 플러그인 번들에 워크스페이스와 같은 판을 준다.
11. [미결] eng.context-map.design §4.1이 ext-host 소유 데이터로 `xh_*`(신뢰 결정, 설치·신뢰 등급)를 적었다. 이 문서는 신뢰 결정을 사용자 영역 파일(`<userDir>/trust.json`)에 둔다 [제안]. DB 테이블을 둘지, context-map 표를 고칠지 정해야 한다.
12. [결정: review.m3-lower-requirements M3-REQ-38, 오케스트레이터 기본값] 서비스 모드에서 작업 폴더 확장의 단위는 작업 폴더 루트다. 작업 폴더를 여는 때 `loadProject`로 판정하고 싣고, 프롬프트는 그 폴더를 연 연결에 `trust.get`·`trust.decide`로 보낸다(§4.7.8). 작업 폴더 확장의 설정 키 추가는 [미결]이다.
13. (해소) 이벤트 kind 접두는 F 규칙 `x.<name>.`/`grp.<name>.`이다([결정: review.decisions-2 T-21]).
14. [미결] eng.dependency-rules.guide DR-07 표에 `vscode-jsonrpc` → `ext-host` 행 추가 요청.
15. (해소, 일부) Bun 직접 `import()`와 `Bun.plugin` 모듈 등록은 스파이크로 확인했다(§4.4.1). `bun build --compile` 바이너리에서 외부 `.ts`를 불러오는지, 질의 접미로 캐시를 피할 수 있는지는 확인 전이다 [가정].
16. (닫힘) pi 가상 모듈은 제공하지 않는다 [결정: review.m3-design-inputs D-M3-11 c].
17. (해소, 일부) 기본 플러그인(Helm) 설치 경로는 §4.4.7이 정한다. 설치 위치가 `user`라 신뢰 상한은 `user`이고, `user` 등급은 `on`·`post`·`drive`를 쓸 수 있다(§4.6.2). 교체 규칙은 매니페스트 `version` 비교다. 재설치 방지 표지는 위 규칙으로 정했다. 남은 것은 `PluginInstallFs`의 F 정본화다.
18. [미결] 내장 확장의 화면 기여. 내장 패키지는 확장 루트가 없어 파일을 읽지 못한다. 화면 트리를 JS 값으로 내는지 파일 경로로 내는지 L3·L4와 정한다. 지금은 건너뛴다(§4.3.4).
19. `ui.messages`(메시지 카탈로그 폴더)는 폴더가 확장 안인지 보고, 그 안의 `en.json`, `ko.json`을 읽어(각 32 KiB 이하, 키와 문장이 모두 문자열인 평평한 객체) 항목 보고의 `messages`(로케일 -> 키 -> 문장)로 싣는다. 폴더나 로케일 파일이 없는 것은 오류가 아니다. 읽을 수 없거나 모양이 틀린 파일은 `ui_invalid`·`ui_limit`·`ui_path_invalid` 경고를 내고 그 로케일만 뺀다. 문구는 키 자체로 내려가므로 화면은 그대로 그려진다(ADR-0021 §3.8) [결정: 2026-11-04 T-I18N 기본값].
20. [미결] `LoaderFs`에 파일 크기와 종류를 묻는 함수가 없다. 1 MiB 검사는 읽은 뒤에 하고 종류는 부모 폴더 나열로 구한다. 포트에 `stat`이 생기면 읽기 전에 자르도록 F.extensions.spec §3.2.1을 고친다(F 수정 요청).
21. [미결] 조립 루트가 `uiSettings`를 `apps/host` 카탈로그에 더하고 `x.ui.*` 값을 `LoadOptions.uiPolicy`로 넘기는 연결은 `apps/host` 작업이다. 이 문서는 입력만 정했다.
22. [미결] 이름 정리. L4.desktop-ux.spec §10.3 W-33과 X-7의 옛 이름(`ext.view.list`, `view_*`)은 이 문서의 `ext.ui.list`와 `ui_*`와 다르다. 화면 쪽 문서를 고치는 일은 L4 담당이다.
23. [미결] `VersionHistoryFs`의 정본 위치. `PluginInstallFs`와 같은 사정이다. 쓰기 포트는 F.extensions.spec §3.2.1 로더 포트에 있어야 한다. F 수정 요청과 함께 정한다.
24. [미결] 기본 플러그인 기록과 되돌리기 전 기록의 `stateSchemaVersion`은 파일에서 알 수 없어 `null`이다. 상태 스키마 검사(§4.4.8)가 번들 버전에 걸리려면, 로더가 확장을 등록할 때 `StateDecl.version`(F.extensions.spec)을 알려 보관 항목의 값을 채우는 경로를 정해야 한다.
25. [결정: 2026-11-04 사용자, B2 1안] 설정 키 `x.ui.apps`와 `x.ui.allowProjectApps`의 소유 문서는 이 문서입니다(ADR-0021 §6 9번). 값 스키마는 §6 표에 있고(`x.ui.apps` 기본 `true`), 로더는 `LoadOptions.uiPolicy`로 받는다 [근거: `xeon/packages/ext-host/src/loading-trust/index.ts:181`]. §3.6 `loadingTrustSettings` 키 집합에 들어갔는지는 이 감사에서 확인하지 않았다. 프레임 `call` 확인 줄은 끌 수 없습니다. 어떤 설정 범위에서도 끄는 키를 두지 않습니다.
26. 승인이 새 이름의 코드를 싣지 않는다 [결정: 2026-11-18 사용자, AGE-41 "승인은 적재가 아니다"]. `loadInstalled(name, signal, { deferStart: true })`는 같은 파이프라인으로 검토본을 검증하고 기록만 꺼진 채(`disabled`, 진단 `lazy_deferred`) 남기며 엔트리를 import하지도 `ExtHost.install`을 부르지도 않는다(결과는 `not_active`의 `disabled`). 호스트의 승인 `reflect`(`apps/host/src/assembly/plugins/approval.ts`)가 이것으로 기록을 만들어 목록과 프로필 검사가 이름을 알게 하고, 처음 대화의 E(T)에 들 때(참조 0→1)와 덧씌우기가 `ensureLoaded`로 싣는다. 기록 없는 이름이 대화에 먼저 들면 `plugin-lifecycle.ts`가 `loadInstalled`로 싣는다 [근거: 2026-11-18 사용자 결정].
27. [미결] 환경 모드 기본 길의 환경 변수 거부 목록. 지금은 `FRESNEL_*`(앞 밑줄 포함)와 잘못된 이름만 뺀다. 제공자 키(`ANTHROPIC_*`, `OPENAI_*`, `GEMINI_*`, `OPENROUTER_*`), `BUN_OPTIONS`, `NODE_OPTIONS`를 더 뺄지 사용자가 정한다. 옛 길은 이것들을 뺀다(migration.md §11 Q17) [근거: `xeon/packages/ext-host/src/isolation/script-runner.ts`의 `userEnvOfDefault`와 `xeon/packages/contracts/src/services/exec.ts`의 `SENSITIVE_ENV_PATTERNS`] [결정: 2026-11-20, 사용자, AGE-58 "다른애들도 허용하면 우리도 막지말고 허용해 무조건"].
28. [미결] 환경 모드의 기한 초과(`timedOut`)를 묻을지 통과시킬지. 지금 어댑터는 통과로 둔다. 사용자 결정 목록은 시간 초과를 묻는 행으로 적었다 [결정: 2026-11-20, 사용자, AGE-58]. 어느 쪽인지 정한다(migration.md §11 Q16). [근거: `xeon/packages/plugin-migration/src/adapters/hook-plugin.ts`의 `outcomeOf`]
