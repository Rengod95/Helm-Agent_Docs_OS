// loading-trust 도메인의 모든 export(패키지 내부용 포함). 루트(src/index.ts)는 공개 이름만 다시 내보낸다.
import { basename, join } from "node:path";
import {
  assertNever,
  attemptAsync,
  Bug,
  err,
  ok,
  parseJson,
  type Logger,
  type Result,
} from "@fresnel/contracts";
import { isSemVer, type CapabilityId, type SemVer } from "@fresnel/contracts/capabilities";
import {
  dependenciesOf,
  effectiveLayer,
  pluginDeclsOf,
  validateManifest,
  validateManifestSet,
  type ExtensionEntry,
  type ExtensionManifest,
  type ExtensionName,
  type LoaderFs,
  type LoaderPaths,
  type HookProcessPort,
  type IsolationProcessPort,
  type ManifestIssue,
  type PluginDecl,
  type ScriptDraftGate,
  type ScriptRunner,
  type TrustPrompter,
  type TrustStoreBackend,
} from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { SettingDef, SettingNamespace } from "@fresnel/contracts/settings";
import type { AdmitInfo, OperationsPolicy } from "../operations/index.ts";
import { NO_STARTUP_OPTIONS, startupFilter, type StartupOptions } from "../operations/safe-mode.ts";
import { assignTier } from "../operations/tier.ts";
import type { ExtHost, ExtensionUnit } from "../primitives/host.ts";
import {
  candidatesFromBuiltins,
  discoverExternal,
  externalLocations,
  MANIFEST_RELATIVE_PATH,
  orderKeyOfBuiltin,
  scriptEnvGrantOf,
  type BuiltinExtensionModule,
  type ExtensionCandidate,
} from "./discover.ts";
import { eachInOrder } from "../primitives/sequence.ts";
import { toCapabilityIds } from "../primitives/services.ts";
import {
  importExternalEntry,
  unitOfBuiltin,
  unitOfExternal,
  verdictOfInstall,
} from "./entry-loader.ts";
import { compareLoadOrder, orderManifests, type OrderKey } from "./load-order.ts";
import type {
  LoadDiagnostic,
  LoadDiagnosticCode,
  LoadedExtensionInfo,
  LoadStage,
  LoadState,
} from "./pipeline.ts";
import { satisfiesRange } from "./semver.ts";
import {
  checkDependencies,
  type DependencyNode,
  type DependencyProblem,
} from "./dependency-graph.ts";
import {
  RESERVED_EXT_KEYS,
  reservedExtensionSettings,
  settingsFromManifest,
} from "./settings-keys.ts";
import {
  checkUiDecl,
  DEFAULT_UI_POLICY,
  HOST_BRIDGE_VERSION,
  HOST_WIDGETS_VERSION,
  type UiEntryReport,
  type UiItemReport,
  type UiPolicy,
} from "./ui-check.ts";
import {
  effectiveTrust,
  type InstallSource,
  type LoaderMode,
  type TrustLevel,
} from "./trust/levels.ts";
import { resolveProjectTrust, type ProjectTrustResult } from "./trust/resolve.ts";
import { createProjectTrustStore } from "./trust/store.ts";
import { registerSdkModules, X_SDK_MODULES, type SdkModules } from "./virtual-modules.ts";
import {
  effectiveIsolationOf,
  type IsolationDecision,
  type IsolationRefusal,
} from "../isolation/effective.ts";
import { createScriptRunner, type ScriptRefReader } from "../isolation/script-runner.ts";
import {
  createIsolatedEntry,
  type IsolationLaunch,
  type IsolationLaunchInfo,
} from "../isolation/proxy-entry.ts";
import type { PluginHostSupervisor, RestartLimitInfo } from "../isolation/supervisor.ts";
import {
  draftVersionIdOf,
  internalDraftName,
  type DraftInfo,
  type DraftLoadInput,
  type DraftOrigin,
  type LoadDraftFailure,
} from "./drafts.ts";

export {
  BUILTIN_LAYER_ORDER,
  compareLoadOrder,
  orderManifests,
  type OrderKey,
} from "./load-order.ts";
export {
  effectiveTrust,
  INSTALL_SOURCES,
  SOURCE_TRUST,
  TRUST_LEVELS,
  TRUST_MATRIX,
  trustRank,
  type InstallSource,
  type TrustLevel,
  type TrustPermissions,
} from "./trust/levels.ts";
export { type BuiltinExtensionModule, type LoaderFs, type LoaderPaths } from "./discover.ts";
export {
  installDefaultPlugin,
  readBundleManifest,
  type BundleManifest,
  type DefaultPluginInstallError,
  type DefaultPluginInstallInput,
  type DefaultPluginInstallOutcome,
  type PluginInstallFs,
} from "./default-plugin.ts";
export {
  createVersionHistory,
  type RecordVersionInput,
  type RollbackHooks,
  type RollbackReloadOutcome,
  type RollbackVersionInput,
  type VersionHistory,
  type VersionHistoryDeps,
  type VersionHistoryError,
  type VersionHistoryFs,
  type VersionListing,
  type VersionRecordOutcome,
  type VersionSkipReason,
  type VersionSource,
} from "./version-history.ts";
export {
  registerSdkModules,
  SDK_MODULE_SPECIFIERS,
  X_SDK_MODULES,
  type SdkModules,
} from "./virtual-modules.ts";
export { compareVersions } from "./semver.ts";
export {
  LoadDiagnosticSchema,
  type LoadDiagnostic,
  type LoadDiagnosticCode,
  type LoadedExtensionInfo,
  type LoadStage,
  type LoadState,
} from "./pipeline.ts";
export {
  loadingTrustSettings,
  RESERVED_EXT_KEYS,
  reservedExtensionSettings,
  settingsFromManifest,
} from "./settings-keys.ts";
export { uiSettings } from "./ui-settings.ts";
export { resolveAppFile, type AppFileResult } from "./app-files.ts";
export {
  checkUiDecl,
  HOST_BRIDGE_VERSION,
  HOST_WIDGETS_VERSION,
  UI_FILE_MAX_BYTES,
  type UiCheckInput,
  type UiEntryReport,
  type UiIssue,
  type UiItemReport,
  type UiOwner,
  type UiPolicy,
} from "./ui-check.ts";
export { satisfiesRange } from "./semver.ts";
export {
  blockingDependents,
  checkDependencies,
  dependencyViewOf,
  dependentsOf,
  enableOrder,
  missingForEnabled,
  updateBreaks,
  type Dependent,
  type DependencyNode,
  type DependencyProblem,
  type DependencyProblemCode,
  type DependencyReport,
  type DependencyView,
} from "./dependency-graph.ts";
export {
  findTrustRequiringResources,
  TRUST_REQUIRING_PROJECT_RESOURCES,
} from "./trust/resources.ts";
export {
  resolveProjectTrust,
  type ProjectTrustResult,
  type ResolveProjectTrustInput,
  type TrustVia,
} from "./trust/resolve.ts";
export {
  createProjectTrustStore,
  trustOptions,
  type ProjectTrustStore,
  type TrustListing,
  type TrustLookup,
  type TrustStoreError,
  type TrustVerdict,
} from "./trust/store.ts";
export { verdictOfInstall } from "./entry-loader.ts";
export {
  draftVersionIdOf,
  internalDraftName,
  type DraftInfo,
  type DraftLoadInput,
  type LoadDraftFailure,
} from "./drafts.ts";

export type { LoaderMode } from "./trust/levels.ts";

/** 매니페스트의 플러그인 선언(`plugins` 없으면 추론한 루트 하나). 기록에 매니페스트가 없으면 빈 목록이다 */
function declsOfManifest(manifest: ExtensionManifest | undefined): readonly PluginDecl[] {
  return manifest === undefined ? [] : pluginDeclsOf(manifest);
}

export interface LoadOptions {
  readonly builtins: readonly BuiltinExtensionModule[];
  readonly cwd: string;
  readonly mode: LoaderMode;
  /** CLI 일회 지정. 프로젝트 신뢰 판정의 첫 단계다. 프로젝트 확장이 생기는 M2부터 쓴다 */
  readonly trustOverride?: boolean;
  /** 안전 모드와 --disable-ext(X.operations.spec §3.6). 없으면 둘 다 꺼짐 */
  readonly startup?: StartupOptions;
  /** `x.loading-trust.paths` 유효 값. 각 경로는 `extensions/`와 같은 모양의 디렉터리다(그 아래 한 단계가 확장 하나) */
  readonly extraPaths?: readonly string[];
  /**
   * 프로젝트 확장을 어떻게 싣는가. 기본 `"cwd"`는 `cwd`의 프로젝트를 이 호출에서 판정하고 싣는다(in-process·stdio 호스트).
   * `"on_demand"`는 프로젝트를 판정하지도 싣지도 않는다. 서비스 모드는 작업 폴더를 여는 thread마다 `loadProject`로 싣는다(spec §4.7.8)
   */
  readonly projects?: "cwd" | "on_demand";
  /**
   * `projects: "cwd"`에서 판정한 프로젝트 루트의 프로젝트 id(M5c §4.7.9, AGE-41). 프로젝트 출처 검토본은 이 id가 맞을 때만 싣는다.
   * 없으면 이 프로젝트의 검토본을 싣지 않는다. 조립이 루트에서 id를 정한다
   */
  readonly projectIdOf?: (projectRoot: string) => Promise<string | undefined>;
  /**
   * 화면 앱 정책(`x.ui.apps`, `x.ui.allowProjectApps`, X.loading-trust.spec §4.3.4). 없는 값은 기본을 쓴다(앱 켬, 프로젝트 앱 끔).
   * 이 호출의 값을 `loadProject`도 그대로 쓴다. 바뀌면 다음 시작에 적용한다
   */
  readonly uiPolicy?: { readonly apps?: boolean; readonly allowProjectApps?: boolean };
  /**
   * 시작 때 싣는 외부 확장의 기본 집합 [M5c §4.1.11]. 기본 프로필이 처음 주는 번들 이름이다. 있으면 외부 확장 가운데
   * 이름이 여기 들지 않은 것은 `defaultEnabled`와 무관하게 시작 때 싣지 않는다. 꺼진 기록으로 남아
   * `lazy_deferred` 진단을 받고, 대화의 켜짐 집합(E(T))에 들 때 `ensureLoaded`가 싣는다. 없으면 모두 시작 때 싣는다(이전 동작)
   */
  readonly defaultNames?: readonly ExtensionName[];
  readonly signal: AbortSignal;
}

/** `loadProject` 입력. 프로젝트 하나의 판정과 적재 */
export interface LoadProjectOptions {
  /** 작업 폴더. 판정은 이 폴더의 프로젝트 루트(정규화한 경로)에 대해 한다 */
  readonly projectRoot: string;
  readonly mode: LoaderMode;
  /** 이 호출 전용 프롬프트 수단. 서비스 모드에서는 그 thread를 연 연결로 보내는 구현이다. 없으면 `LoaderDeps.prompter` */
  readonly prompter?: TrustPrompter;
  /** 호출자가 이미 정한 판정(저장하지 않는다). 서비스 호스트가 클라이언트의 `trust.decide` 결과를 넘길 때 쓴다 */
  readonly trustOverride?: boolean;
  /**
   * 이 프로젝트 루트의 프로젝트 id(M5c §4.7.9, AGE-41). 프로젝트 출처 검토본은 `projectId`가 같은 것만 싣는다.
   * 없으면 프로젝트 검토본을 하나도 싣지 않는다(그 항목은 진단으로 남는다)
   */
  readonly projectId?: string;
  readonly signal: AbortSignal;
}

export interface ProjectLoadReport {
  /** 정규화한 프로젝트 루트. 판정이 실패했으면 null */
  readonly projectRoot: string | null;
  readonly projectTrust: ProjectTrustResult | null;
  /** 이 루트의 확장을 앞선 호출에서 이미 실었다. 다시 싣지 않았다 */
  readonly alreadyLoaded: boolean;
  /** 이 호출이 새로 시도한 프로젝트 확장 */
  readonly extensions: readonly LoadedExtensionInfo[];
  /** 이 호출이 남긴 진단 */
  readonly diagnostics: readonly LoadDiagnostic[];
}

export interface LoadReport {
  readonly extensions: readonly LoadedExtensionInfo[];
  readonly diagnostics: readonly LoadDiagnostic[];
  /** 프로젝트 신뢰 판정. 안전 모드라 판정하지 않았으면 null */
  readonly projectTrust: ProjectTrustResult | null;
  /** 거부된 확장을 뺀 설정 그룹. 조립 루트가 buildCatalog에 넣는다 */
  readonly settingGroups: readonly {
    readonly owner: string;
    readonly namespace: SettingNamespace;
    readonly defs: readonly SettingDef[];
  }[];
}

/** 내장 필수 확장이 실패하면 loadAll이 던진다 */
export class LoadAbortError extends Error {
  override readonly name: string = "LoadAbortError";
  readonly diagnostics: readonly LoadDiagnostic[];

  constructor(message: string, diagnostics: readonly LoadDiagnostic[]) {
    super(message);
    this.diagnostics = diagnostics;
  }
}

/** 확장 설정 유효 값 읽기. 조립 루트가 설정 서비스에 연결해 넘긴다 [제안, LoaderDeps에 선택으로 더한다] */
export interface LoaderSettingsSource {
  /**
   * `ext.<name>.enabled`의 잠금 값. 관리 범위가 거짓으로 잠갔을 때만 `false`를 준다. 잠기지 않았으면 undefined다.
   * 매니페스트 기본(`defaultEnabled: false`)은 잠금이 아니다: 켜짐은 대화별 E(T)가 정한다(M5c §4.1.10, §4.1.11)
   */
  enabled(name: ExtensionName): boolean | undefined;
  /** 설정 키에 유효 값이 있는가. required userConfig 확인에 쓴다 */
  hasValue(key: string): boolean;
  /** `x.loading-trust.defaultProjectTrust` 유효 값. 없으면 "ask" */
  defaultProjectTrust?(): "ask" | "always" | "never";
  /**
   * `ext.<name>.isolation`의 명시 값. 값을 정하지 않았으면 undefined다(기본값은 세지 않는다. 매니페스트와 기본 규칙을 쓴다).
   * 설정 값 `none`은 격리 확장을 엔진 안에서 돌리도록 허용한다(F5)
   */
  isolation?(name: ExtensionName): "none" | "process" | undefined;
  /** `ext.*` 설정 키의 유효 값(`hostOf(g).settingValue`와 같은 값). 격리 확장의 호스트 초기화 설정에 쓴다 */
  settingValue?(key: string): unknown;
}

/**
 * 격리 확장(플러그인 호스트 프로세스)을 띄우는 조립 설정. `LoaderDeps.process`(띄우기 포트)와 함께 주입해야 격리를 쓸 수 있다.
 * 둘 중 하나라도 없으면 격리 설정 확장은 명시 요청이면 `isolation_unavailable`, 기본이면 엔진 안에서 돈다
 */
export interface LoaderIsolation {
  /** 띄울 명령과 환경을 정한다. 앱이 정한다(예: 엔진 실행 파일의 하위 명령). 띄울 때마다 부른다 */
  readonly launch: (info: IsolationLaunchInfo) => IsolationLaunch;
  /** 유휴 내리기, 시간 초과, 죽음 셈의 시계. 취소 함수를 돌려준다 */
  readonly setTimer: (ms: number, fn: () => void) => () => void;
  /** 감독 진단을 기록한다. 없으면 버린다 */
  readonly logger?: Logger;
  /** host.init 응답 시간 한도(ms). 기본 10초 */
  readonly initTimeoutMs?: number;
  /** 마지막 호출 뒤 내리기까지(ms). 기본은 감독 기본값 */
  readonly idleMs?: number;
  /** 멈춤 요청 뒤 강제 종료까지(ms). 기본은 감독 기본값 */
  readonly killGraceMs?: number;
  /** 죽은 뒤 다시 띄우는 한도. 죽음을 셀 때마다 읽는다(설정 `x.loading-trust.isolation.maxRestarts`, live). 없으면 감독 기본 */
  readonly maxRestarts?: () => number;
  /** 죽음을 세는 창(초). 죽음을 셀 때마다 읽는다(설정 `x.loading-trust.isolation.restartWindowSec`, live). 없으면 감독 기본 */
  readonly restartWindowSec?: () => number;
  /** 표준오류 한 줄을 저장하기 전에 가린다. 던지면 그 줄을 버린다 */
  readonly maskSecrets?: (line: string) => string;
  /**
   * 조각 전송(큰 줄을 나눠 보내기)의 엔진 쪽 상한(바이트). 띄울 때마다 읽는다(live). 없거나 `undefined`면 조각을 쓰지 않는다
   * (격리 입력의 상한은 한 줄 상한이다). 앱이 `l0.store.maxBlobBytes`를 넘긴다(X.loading-trust §4.9.3)
   */
  readonly transferMaxBytes?: () => number | undefined;
  /** 재시작 한도를 넘으면 한 번 알린다. 앱은 이 알림으로 확장을 끌지 묻는다 */
  readonly onRestartLimit?: (name: ExtensionName, info: RestartLimitInfo) => void;
  /** 세션(감독)을 열 때마다 부른다. 조립이 표준오류 꼬리 같은 진단을 읽을 때 쓴다 */
  readonly onSupervisor?: (name: ExtensionName, supervisor: PluginHostSupervisor) => void;
  /**
   * 스크립트 실행기 이름(`sh`, `bash`, `bun`, `node`, `python3`)을 절대 경로로 푼다(설계 B [제안]). 조립 루트가 준다.
   * 없으면 스크립트 호출은 `runner_unavailable`로 답한다(띄우지 않는다)
   */
  readonly runner?: (name: ScriptRunner) => string | undefined;
  /** 실행기가 샌드박스 안에서 시작하려고 읽어야 하는 경로(읽기 전용). 실행기 이름과 `runner`가 푼 절대 경로를 받는다. 없으면 더하지 않는다 */
  readonly runnerReadRoots?: (name: ScriptRunner, command: string) => readonly string[];
  /**
   * 스크립트에 넘길 허용 환경 값. 선언된 `envNames` 가운데 여기 있고 시크릿 거부 패턴에 걸리지 않는 것만 넘긴다. 없으면 빈 값
   */
  readonly allowedEnv?: Readonly<Record<string, string>>;
  /**
   * 초안 스크립트의 승인 문(AGE-58 [제안]). 조립 루트가 준다. 없으면 초안의 스크립트는 `script_not_approved`다.
   * 있어도 구현이 테스트 런의 묶인 초안인지 보고, 일반 대화는 거절한다
   */
  readonly scriptGate?: ScriptDraftGate;
  /** 이 기기에서 격리(샌드박스)를 쓸 수 있는가. 초안 스크립트가 카드를 열기 전에 묻는다. 없으면 묻지 않는다(띄울 때 막힌다) */
  readonly sandboxAvailable?: () => boolean;
  /** 승인 전 드래프트의 스크립트와 플러그인 프로세스를 좁은 길로 돌리는가(설정 `l0.sandbox.narrowDrafts`). `ScriptRunnerDeps.narrowDrafts` */
  readonly narrowDrafts?: () => boolean;
  /** 환경 모드(기본)의 외부 훅 실행 포트. `ScriptRunnerDeps.hookProcess` */
  readonly hookProcess?: () => HookProcessPort | undefined;
  /** 참이면 환경 모드를 샌드박스 안에서 돌린다(옛 길). `ScriptRunnerDeps.envSandboxed` */
  readonly envSandboxed?: () => boolean;
  /** 환경 모드 스크립트의 사용자 환경(AGE-58 [제안]). 값은 기록하지 않는다. `ScriptRunnerDeps.userEnv` */
  readonly userEnv?: () => Promise<Readonly<Record<string, string>>>;
  /** 환경 모드 참조 파일의 지문 확인 수단. `ScriptRunnerDeps.refs` */
  readonly scriptRefs?: ScriptRefReader;
  /** 환경 모드 참조 파일 가운데 보호 경로 안의 것의 읽기 예외. `ScriptRunnerDeps.readCarveOutsFor` */
  readonly readCarveOutsFor?: (refPaths: readonly string[]) => readonly string[];
  /** 호출한 대화의 프로젝트 폴더. `ScriptRunnerDeps.projectDirOf` */
  readonly projectDirOf?: (threadId: ThreadId | undefined) => string | undefined;
}

/**
 * 검토본 목록의 항목 하나(M5c §4.6.3). `root`는 검토본 `tree/`이고 실행과 읽기는 이 폴더만 쓴다. 원본 폴더는 읽지 않는다.
 * `source`는 저장소 기록의 출처다(`bundled`는 로더에서 사용자 등급으로 싣는다, §4.6.9).
 * `projectId`는 프로젝트 출처 항목만 가진다(AGE-41). 같은 이름이라도 프로젝트가 다르면 다른 검토본이고, 로더는 그 프로젝트를 여는 때만 싣는다.
 * 프로젝트 출처인데 `projectId`가 없으면 어느 프로젝트에서도 싣지 않는다
 */
export interface ReviewedSourceEntry {
  readonly name: ExtensionName;
  readonly source: "user" | "project" | "bundled";
  /** 프로젝트 출처 항목의 프로젝트 id. 사용자·번들 항목은 없다 */
  readonly projectId?: string;
  readonly root: string;
  /** `sha256:<hex>`. 판 식별자 `versionId`가 된다 */
  readonly contentHash: string;
  /**
   * 검토본 트리에 매니페스트 파일이 없을 때 호스트가 추론한 매니페스트(스킬 폴더에서 옮긴 것). 파일도 추론도 없으면 싣지 않는다.
   * 파일이 있으면 파일이 이긴다
   */
  readonly manifest?: ExtensionManifest;
  /** 승인한 검토 항목의 출처가 마이그레이션이면 참(호스트가 `meta.json`에서 채운다). 환경 모드 스크립트를 받을 자격의 유일한 근거다(AGE-58 [제안]) */
  readonly importedScripts?: boolean;
}

/** 적재 때 검토본 저장소가 낸 진단. 무결성이 어긋난 항목은 목록에서 빠지고 이것으로 남는다(M5c §4.6.5) */
export interface ReviewedSourceDiagnostic {
  readonly name: ExtensionName;
  readonly source: ReviewedSourceEntry["source"];
  readonly code: "pinned_corrupt";
  readonly message: string;
}

export interface ReviewedSourceListing {
  readonly entries: readonly ReviewedSourceEntry[];
  readonly diagnostics: readonly ReviewedSourceDiagnostic[];
}

/**
 * 검토본 목록 포트(M5c §4.6). 호스트가 구현한다. 있으면 사용자·프로젝트·번들 출처의 외부 확장은 원본 폴더를 훑지 않고 이 목록에서 싣는다.
 * `list()`가 적재 때마다 검토본의 해시를 다시 계산해 저장된 값과 맞춘다(호출자가 맡는 일이 아니다)
 */
export interface ReviewedSource {
  list(): Promise<ReviewedSourceListing>;
}

/** 검토본 목록에서 고른 후보 하나와 그 이름 */
interface ReviewedPick {
  readonly name: ExtensionName;
  readonly candidate: ExtensionCandidate;
}

/** 검토본 출처를 로더의 설치 위치로 옮긴다. 번들은 사용자 등급이고 격리 대상이다(M5c §4.6.9) */
function installSourceOf(source: ReviewedSourceEntry["source"]): InstallSource {
  return source === "project" ? "project" : "user";
}

/** 검토본 목록의 진단을 로더 진단으로 옮긴다 */
function reviewedDiagnosticOf(item: ReviewedSourceDiagnostic): LoadDiagnostic {
  return {
    extension: item.name,
    source: installSourceOf(item.source),
    stage: "discover",
    severity: "error",
    code: item.code,
    message: item.message,
    generation: 0,
  };
}

/** 로더가 판 식별자를 정한다: 검토본이면 내용 해시, 아니면 매니페스트 버전과 세대(내장·시험 후보) */
function versionIdOf(
  candidate: ExtensionCandidate,
  manifest: ExtensionManifest,
  generation: number,
): string {
  if (candidate.draft !== undefined) return draftVersionIdOf(candidate.draft);
  return candidate.contentHash ?? `${manifest.version}.${generation}`;
}

/** 조립 루트가 주입하는 의존. 필수 항목이 없으면 시작 실패다(X.loading-trust.spec §4.3.2) */
export interface LoaderDeps {
  /** 설치 대상. 엔트리 호출과 scope 실행은 ExtHost.install이 한다 */
  readonly host: ExtHost;
  /** 운영 정책. 6a단계 admit, 설치 실패·제거 때 forget */
  readonly policy: Pick<OperationsPolicy, "admit" | "forget"> & {
    /** 있으면 설정으로 다시 켤 때 실패 장부를 비운다. 조립 루트는 `OperationsPolicy`를 그대로 넘긴다 */
    readonly autoDisabler?: Pick<OperationsPolicy["autoDisabler"], "clearLedger">;
  };
  readonly fs: LoaderFs;
  readonly paths: LoaderPaths;
  readonly trustBackend: TrustStoreBackend;
  /** 대화형 프롬프트. headless면 없다 */
  readonly prompter?: TrustPrompter;
  /** 격리의 띄우기 포트(fresnel.process 서비스). 없으면 격리 설정 확장은 명시면 isolation_unavailable, 기본이면 엔진 안이다 */
  readonly process?: IsolationProcessPort;
  /** 격리 확장을 띄우는 설정(명령, 시계, 진단). `process`와 함께 있어야 격리가 실행된다(F5) */
  readonly isolation?: LoaderIsolation;
  readonly clock: { now(): number };
  readonly settings?: LoaderSettingsSource;
  /**
   * 검토본 목록(M5c §4.6). 있으면 사용자·프로젝트·번들 외부 확장은 원본 폴더를 훑지 않고 이 목록에서 싣는다(시험 호환: 없으면 기존 탐색)
   */
  readonly reviewedSource?: ReviewedSource;
  /** 코어가 제공하는 기능과 버전. 6단계가 매니페스트 provides와 함께 본다 [가정: 코어 기능 레지스트리 API는 X.primitives] */
  readonly coreCapabilities?: ReadonlyMap<CapabilityId, SemVer>;
  /**
   * 플러그인 번들이 호스트와 같은 인스턴스를 쓰게 할 SDK 가상 모듈 가운데 X가 직접 등록하지 않는 것. 지정자 → 호스트의 모듈 객체.
   * `@fresnel/contracts`와 하위 경로, `typebox`는 X가 등록하므로 넘기지 않아도 된다. `@fresnel/orchestration-sdk`은 L3라 X가 import할 수 없어 조립 루트가 넘긴다(M3-REQ-110)
   */
  readonly sdkModules?: SdkModules;
  /** `thread.trust.before` 발화(X.loading-trust.spec §4.7.3 4번). 없으면 결정 없음으로 본다 */
  readonly emitProjectTrust?: (
    cwd: string,
    signal: AbortSignal,
  ) => Promise<{ readonly trusted: "yes" | "no"; readonly remember?: boolean } | undefined>;
}

export interface ReloadOptions {
  /** 참이면 새 버전이 저장된 상태를 받지 못할 때 그 상태를 `initial`로 다시 쓴다(되돌리기 `clearState`) */
  readonly resetRefusedState?: boolean;
}

/** 다시 읽기를 시작하지 못한 이유. 이때 옛 버전이 그대로 돌고 로더 기록은 바뀌지 않는다 */
export type ReloadFailure =
  | { readonly kind: "unknown_extension" }
  /**
   * 내장 확장이거나, 활성이 아닌 확장이다(재시작이나 `ensureLoaded`로 싣는다). 초안은 다시 읽지 않는다(`loadDraft`로 새로 싣는다) [제안]
   */
  | {
      readonly kind: "not_reloadable";
      readonly reason: "builtin" | "not_active" | "no_root" | "draft";
    }
  | { readonly kind: "rejected"; readonly diagnostics: readonly LoadDiagnostic[] };

/** 단계 경계에서 적용이 끝난 다시 읽기 */
export type ReloadApplied =
  | {
      readonly status: "applied";
      readonly statesCleared: number;
      readonly info: LoadedExtensionInfo;
    }
  | {
      readonly status: "failed";
      readonly diagnostics: readonly LoadDiagnostic[];
      readonly restored: boolean;
    }
  | { readonly status: "superseded" | "cancelled" };

export interface ReloadStarted {
  readonly appliesAt: "now" | "nextStepBoundary";
  readonly applied: Promise<ReloadApplied>;
}

/** 설치한 새 이름을 싣지 못한 이유. 이때 호스트에는 아무것도 남지 않는다(`disabled`는 로더 기록만 남아 `ensureLoaded`로 켠다) */
export type LoadInstalledFailure =
  /** 이미 실려 있다(같은 이름의 새 판은 `reload`가 싣는다) */
  | { readonly kind: "already_loaded" }
  /** 안전 모드라 사용자 위치의 확장을 싣지 않는다 */
  | { readonly kind: "safe_mode" }
  /** 사용자 위치에 그 이름의 설치본이 없다 */
  | { readonly kind: "not_found"; readonly diagnostics: readonly LoadDiagnostic[] }
  /** 파이프라인이 거부했거나(`rejected`, `error`) 꺼진 채로 두었다(`disabled`) */
  | {
      readonly kind: "not_active";
      readonly state: "rejected" | "disabled" | "error";
      readonly diagnostics: readonly LoadDiagnostic[];
    };

/**
 * `loadInstalled`의 선택 값. `deferStart`면 검토본을 검증해 기록만 꺼진 채(`disabled`, `lazy_deferred`) 남기고 코드는 싣지 않는다.
 * 승인은 적재가 아니다(M5c §4.1.11): 승인한 새 이름을 목록과 프로필 검사가 알도록 기록만 두고, 대화의 집합에 처음 들 때 `ensureLoaded`가 싣는다
 */
interface LoadInstalledOptions {
  readonly deferStart?: boolean;
}

/** 새 이름을 실었다 */
export interface LoadInstalledStarted {
  /** now: 이 호출이 돌아오기 전에 켜졌다. nextStepBoundary: 실행 중인 turn이 있어 켜기가 단계 경계를 기다린다 */
  readonly appliesAt: "now" | "nextStepBoundary";
  readonly info: LoadedExtensionInfo;
}

export interface ExtensionLoader {
  /** 시작 때 한 번. 파이프라인 전체를 실행한다 */
  loadAll(options: LoadOptions): Promise<LoadReport>;
  /**
   * 프로젝트 하나를 판정하고 신뢰되면 그 프로젝트의 확장을 싣는다(작업 폴더를 여는 때, 모든 호스트 모드, X.loading-trust.spec §4.7.8).
   * 같은 루트는 한 번만 싣는다(`alreadyLoaded`). 불신이면 아무것도 싣지 않고 결정은 기억하지 않아 다음 호출이 다시 판정한다.
   * 안전 모드이면 판정하지 않고 `safe_mode` 진단만 남긴다. `loadAll` 뒤에 불러야 한다
   */
  loadProject(options: LoadProjectOptions): Promise<ProjectLoadReport>;
  /** ext.<name>.enabled가 거짓에서 참이 되면 부른다. 아직 로드되지 않은 확장을 로드한다 */
  ensureLoaded(name: ExtensionName, signal: AbortSignal): Promise<LoadedExtensionInfo>;
  /**
   * `ext.<name>.enabled` 유효 값이 바뀌었을 때 조립 루트가 부른다 [제안]. 참이 되면 ensureLoaded 또는 scope 켜기,
   * 거짓이 되면 scope 끄기를 요청한다. 적용은 단계 경계에서 일어난다
   */
  settingChanged(
    name: ExtensionName,
    signal: AbortSignal,
  ): Promise<LoadedExtensionInfo | undefined>;
  /**
   * 설치된 외부 확장의 코드를 다시 읽어 새 버전으로 바꾼다(§4.4.4). 매니페스트 검증, 집합 검사, 신뢰 상한, 엔트리 import와 실행(호스트
   * 상태를 건드리지 않는다)을 먼저 하고, 하나라도 실패하면 옛 버전이 그대로 돈다(`rejected`). 적용은 `ExtHost.replaceUnit`이 단계
   * 경계에서 한다(X.primitives.spec §4.4.10). `applied`는 적용이 끝나면 정해진다: 실행 중인 thread가 없으면 이 호출이 돌아올 때 이미
   * 정해져 있다(`appliesAt: "now"`)
   */
  reload(
    name: ExtensionName,
    signal: AbortSignal,
    options?: ReloadOptions,
  ): Promise<Result<ReloadStarted, ReloadFailure>>;
  /**
   * `reload`와 같되 검토본 목록(`reviewedSource`)의 현재 검토본을 새 판으로 읽는다(M5c §4.6.7). 승인이나 되돌리기로 `current`가
   * 바뀐 뒤 부른다. 검토본 목록이 없으면 `reload`와 같다. 목록에 그 이름의 검토본이 없으면 `rejected`다
   */
  reloadFromReviewed(
    name: ExtensionName,
    signal: AbortSignal,
    options?: ReloadOptions,
  ): Promise<Result<ReloadStarted, ReloadFailure>>;
  /**
   * 시작 때 싣기를 미룬 기록(`lazy_deferred`로 꺼진 것)이 가리키는 검토본이 현재 검토본과 다르면 기록을 현재 검토본으로 다시 만든다.
   * 코드는 싣지 않고 여전히 미룬 채다(승인이나 되돌리기 뒤 목록과 상세가 새 버전을 보게 한다). 바꾼 때만 true다.
   * 미루지 않은 기록(켜진 것, 설정이나 오류로 꺼진 것)과 모르는 이름은 건드리지 않아 false다
   */
  refreshDeferred(name: ExtensionName, signal: AbortSignal): Promise<boolean>;
  /**
   * 설치 뒤에 시작 때와 같은 파이프라인(검증, 집합 검사, 신뢰 상한, 켜짐 확인, `assignTier`, 엔트리 import, `ExtHost.install`)으로
   * 사용자 위치(`<userDir>/extensions/<name>`)의 새 이름 하나를 싣는다(§4.4.4). 우회하는 길은 없다. 실행 중인 turn이 있으면 켜기는
   * `ExtHost`의 시작 적용 규칙대로 다음 단계 경계에서 일어난다(`nextStepBoundary`). 실패하면 기록을 남기지 않아 같은 이름을 다시 설치해 싣을 수 있다
   */
  loadInstalled(
    name: ExtensionName,
    signal: AbortSignal,
    options?: LoadInstalledOptions,
  ): Promise<Result<LoadInstalledStarted, LoadInstalledFailure>>;
  /**
   * 외부 확장을 호스트에서 내리고 로더 기록은 `disabled`로 남긴다 [제안, M5c §4.1.11]. 세대는 올라가고, 같은 이름의
   * `ensureLoaded`가 검토본 사본에서 다시 싣는다(기록이 없어 생기는 `unknown_extension`이 없다). 목록에는 꺼진 채 보인다.
   * 내장 확장이거나 로더가 모르는 이름이면 false다. 초안이면 `unloadDraft`와 같다
   */
  unload(name: ExtensionName): Promise<boolean>;
  /**
   * 초안을 싣는다 [제안, X.loading-trust.spec §4.9.8]. 초안은 격리 프로세스에서만 돈다: 설정과 매니페스트의 `none`과 기본을 무시하고,
   * 띄우기 포트나 띄우기 설정이 없으면 `isolation_unavailable`로 거부한다. 등록과 설치 이름은 `internalDraftName`이라 검토본과 겹치지 않는다.
   * 나머지 단계(검증, 집합 검사, 신뢰 상한, 설치)는 `loadInstalled`와 같다. 실패하면 기록과 설치를 남기지 않는다.
   * `loadAll`과 `reload`는 초안을 다루지 않는다
   */
  loadDraft(
    input: DraftLoadInput,
    signal: AbortSignal,
  ): Promise<Result<LoadInstalledStarted, LoadDraftFailure>>;
  /** 실린 초안을 내리고 격리 세션을 닫는다. 기록과 `draftOf` 항목도 지운다. 초안이 아니면 false다 [제안] */
  unloadDraft(internalName: ExtensionName): Promise<boolean>;
  /** 실린 초안의 목록(싣은 순서) [제안] */
  loadDraftsOf(): readonly DraftInfo[];
  /** 내부 이름의 초안 정보. 실리지 않았으면 undefined [제안] */
  draftOf(internalName: ExtensionName): DraftInfo | undefined;
  list(): readonly LoadedExtensionInfo[];
  diagnostics(): readonly LoadDiagnostic[];
  /**
   * 화면 기여 항목의 검사 결과(X.loading-trust.spec §4.3.4). 로드 순서, 항목 선언 순서로 돌려준다. `ext.ui.list`가 이것을 쓴다.
   * 확장이 목록에서 빠지면(다시 읽기, 제거) 그 확장의 항목도 같이 빠진다
   */
  uiEntries(): readonly UiEntryReport[];
  /** 역순으로 scope를 정리하고 정책 표에서 뺀다 */
  dispose(): Promise<void>;
}

interface ExtRecord {
  name: ExtensionName;
  /** 실행 중인 판의 후보. 검토본 다시 읽기가 성공하면 새 검토본 후보로 바뀐다 */
  candidate: ExtensionCandidate;
  manifest: ExtensionManifest | undefined;
  readonly source: InstallSource;
  trust: TrustLevel;
  state: LoadState;
  loadIndex: number | null;
  generation: number;
  readonly essential: boolean;
  readonly diagnostics: LoadDiagnostic[];
  /** Plugin UI 검사 결과(§4.3.4). 매니페스트에 `ui`가 없거나 내장 확장이면 빈 배열이다 */
  ui: readonly UiItemReport[];
  /** 마지막 설치에서 켜기가 실행 중인 turn 때문에 단계 경계로 미뤄졌는가 */
  deferred: boolean;
  /** 실제로 격리 프로세스에서 도는가(설치가 성공한 격리 확장). 보고 `LoadedExtensionInfo.isolation`이 이것이다 */
  isolation: "none" | "process";
  /** 격리 감독 손잡이. 격리로 설치할 때 만들고, 세션이 열릴 때마다 현재 감독을 바꾼다 */
  handle: IsolationHandle | undefined;
  /** 다시 읽기 중인가. 격리 세션을 닫는 사유를 `reload`로 정한다 */
  reloading: boolean;
}

/** 격리 확장 하나의 감독 손잡이. `current`는 지금 세션의 감독이다 */
interface IsolationHandle {
  current: PluginHostSupervisor | undefined;
}

function versionOf(manifest: ExtensionManifest | undefined): SemVer {
  const version = manifest?.version;
  return version !== undefined && isSemVer(version) ? version : "0.0.0";
}

/** 의존 계산의 입력(확장 한 개). 매니페스트가 없으면 계산할 수 없다 */
function dependencyNodeOf(record: ExtRecord): DependencyNode | undefined {
  const manifest = record.manifest;
  if (manifest === undefined) return undefined;
  return { name: record.name, version: versionOf(manifest), manifest };
}

/** 살아 있는(resolved/active) 기록만 의존 계산의 집합으로 바꾼다 */
function liveNodesOf(records: readonly ExtRecord[]): DependencyNode[] {
  return records.flatMap((record) => {
    if (record.state !== "resolved" && record.state !== "active") return [];
    const node = dependencyNodeOf(record);
    return node === undefined ? [] : [node];
  });
}

/** 기대는 hard 의존의 대상 확장 이름들(선언 순서) */
function hardTargetsOf(record: ExtRecord): readonly string[] {
  const manifest = record.manifest;
  if (manifest === undefined) return [];
  return dependenciesOf(manifest).flatMap((dependency) =>
    dependency.kind === "hard" ? [dependency.targetExtension] : [],
  );
}

/** 의존이 맞지 않는 까닭을 사람이 읽는 문장으로 바꾼다. 대상과 범위, 찾은 판을 싣는다 */
function dependencyMessageOf(problem: DependencyProblem): string {
  switch (problem.code) {
    case "target_missing":
      return `${problem.from} depends on ${problem.target}, which is not loaded`;
    case "member_missing":
      return `${problem.from} depends on ${problem.target}, which the extension does not provide`;
    case "range_unmet":
      return `${problem.from} depends on ${problem.target} ${problem.range ?? "*"}, but found ${problem.found ?? "unknown"}`;
    case "target_disabled":
      return `${problem.from} depends on ${problem.target}, which is disabled`;
    default:
      return assertNever(problem.code, "dependency problem");
  }
}

function messageOfError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function fallbackName(candidate: ExtensionCandidate, index: number): string {
  if (candidate.builtin !== null) return candidate.builtin.manifest.name;
  return candidate.root === null ? `unknown-${index}` : basename(candidate.root);
}

function projectDiagnostic(
  code: LoadDiagnosticCode,
  severity: LoadDiagnostic["severity"],
  message: string,
): LoadDiagnostic {
  return {
    extension: null,
    source: "project",
    stage: "trust",
    severity,
    code,
    message,
    generation: 0,
  };
}

function refusalMessage(name: ExtensionName): string {
  return `${name} requires process isolation, but no fresnel.process service is available; set ext.${name}.isolation to none to run it inside the engine`;
}

/** 매니페스트 원본을 읽은 결과. 실패하면 진단 코드와 문장을 준다 */
type ManifestInputRead =
  | { readonly ok: true; readonly input: unknown }
  | { readonly ok: false; readonly code: LoadDiagnosticCode; readonly message: string };

/**
 * 초안 매니페스트의 이름을 내부 이름으로 바꾼다. 다른 플러그인 이름을 적었으면 검증 전에 거부한다 [제안].
 * 이름을 바꾼 뒤의 검증은 내부 이름으로 돈다(등록 id, 테이블과 도구 접두가 내부 이름을 따른다)
 */
function namedAsDraft(input: unknown, origin: DraftOrigin): ManifestInputRead {
  if (
    typeof input !== "object" ||
    input === null ||
    !("name" in input) ||
    input.name !== origin.plugin
  ) {
    return {
      ok: false,
      code: "manifest_invalid",
      message: `the draft manifest must name ${origin.plugin}`,
    };
  }
  return { ok: true, input: { ...input, name: origin.internalName } };
}

/** 격리 거부 문장. 초안은 설정 `none`으로도 엔진 안에 둘 수 없다는 것을 말한다 [제안] */
function refusalTextOf(record: ExtRecord, code: IsolationRefusal): string {
  if (record.candidate.draft === undefined) return refusalMessage(record.name);
  return code === "draft_entry_missing"
    ? `${record.name} is a draft without an entry; a draft runs only in an isolated plugin host, so it needs code to run`
    : `${record.name} is a draft and needs the isolated plugin host, but no fresnel.process service is available; a draft never runs inside the engine`;
}

/** 격리 감독 손잡이의 세션을 닫는다. 손잡이가 없으면 아무것도 하지 않는다 */
function retireHandle(handle: IsolationHandle | undefined, reason: "disabled" | "reload"): void {
  handle?.current?.dispose(reason);
}

/** 기록의 격리 세션을 닫고 격리 상태를 되돌린다. 호스트에서 내린 뒤에 부른다(정리 동작이 먼저 돌도록) */
function retireRecord(record: ExtRecord, reason: "disabled" | "reload"): void {
  retireHandle(record.handle, reason);
  record.handle = undefined;
  record.isolation = "none";
}

/** 설치 진단 코드가 놓이는 단계. 격리 코드는 격리 단계다 */
function stageOfVerdict(code: LoadDiagnosticCode): LoadStage {
  if (code === "usage_invalid" || code === "usage_warning") return "usage";
  if (code.startsWith("isolation_")) return "isolation";
  return "entry";
}

function fallbackKey(name: string): OrderKey {
  return { source: "builtin", layerIndex: Number.MAX_SAFE_INTEGER, name };
}

/** 단계 검사 뒤의 현재 상태. 검사 함수가 상태를 바꿨을 수 있어 좁혀진 타입을 쓰지 않는다 */
function currentState(record: ExtRecord): ExtRecord["state"] {
  return record.state;
}

/**
 * 로더가 메모리에 두는 진단 수. 서비스 모드처럼 오래 도는 호스트에서 `loadProject`가 진단을 끝없이 쌓지 않도록
 * 가장 최근 것만 남긴다(X.loading-trust.spec §4.3.3)
 */
const MAX_RETAINED_DIAGNOSTICS = 256;

/** 최근 `MAX_RETAINED_DIAGNOSTICS`개 진단만 보관하는 추가 전용 목록. 넘치면 가장 오래된 것부터 버린다 */
interface DiagnosticLog {
  push(entry: LoadDiagnostic): void;
  pushAll(entries: readonly LoadDiagnostic[]): void;
  /** 보관 중인 진단을 오래된 것부터 새 배열로 돌려준다 */
  snapshot(): LoadDiagnostic[];
  /** 지금까지 추가한 총 개수(버린 것 포함). `since`에 넘기는 기준점이다 */
  mark(): number;
  /** `mark()` 뒤에 추가된 진단 가운데 아직 보관 중인 것을 추가된 순서대로 돌려준다 */
  since(mark: number): LoadDiagnostic[];
  /** 보관 중인 진단만 비운다. 총 개수는 이어서 세므로 그 전에 받은 `mark()`는 그대로 유효하다 */
  clear(): void;
}

function createDiagnosticLog(): DiagnosticLog {
  const retained: LoadDiagnostic[] = [];
  let appended = 0;
  function push(entry: LoadDiagnostic): void {
    appended += 1;
    retained.push(entry);
    if (retained.length > MAX_RETAINED_DIAGNOSTICS) retained.shift();
  }
  return {
    push,
    pushAll(entries) {
      for (const entry of entries) push(entry);
    },
    snapshot: () => [...retained],
    mark: () => appended,
    // 보관 중인 첫 진단의 추가 순번은 appended - retained.length다. 그 앞은 이미 버려졌다
    since: (mark) => retained.slice(Math.max(0, mark - (appended - retained.length))),
    clear() {
      retained.length = 0;
    },
  };
}

export function createExtensionLoader(deps: LoaderDeps): ExtensionLoader {
  const records = new Map<ExtensionName, ExtRecord>();
  const diagnosticLog = createDiagnosticLog();
  let order: ExtRecord[] = [];
  /** 이름이 같거나 알 수 없는 후보에 붙이는 일련번호. 묶음이 달라도 겹치지 않게 loadAll마다 0부터 센다 */
  let anonymous = 0;
  let startup: StartupOptions = NO_STARTUP_OPTIONS;
  /** 화면 앱 정책. `loadAll`이 정하고 `loadProject`도 같은 값을 쓴다(§4.3.4) */
  let uiPolicy: UiPolicy = DEFAULT_UI_POLICY;
  /** "이번 세션만" 결정은 호스트 프로세스 수명 동안 유지한다(§4.7.3) */
  const sessionTrust = new Map<string, "allow" | "deny">();
  /** `loadProject`가 이미 실은 프로젝트 루트(정규화한 경로) */
  const loadedProjects = new Set<string>();
  /**
   * 내려갔거나 싣지 못한 이름이 다음에 쓸 로드 세대. Bun은 한 번 평가한 경로(실패한 것 포함)의 모듈을 캐시하므로
   * 같은 이름을 다시 설치해 싣을 때 세대를 올려 새 모듈로 import한다(§4.4.4)
   */
  const nextGeneration = new Map<ExtensionName, number>();
  /** 실린 초안(내부 이름 → 정보). 싣기에 성공한 것만 들고, 내리면 지운다 [제안] */
  const drafts = new Map<ExtensionName, DraftInfo>();

  function missingDependency(): string | undefined {
    const required: readonly (readonly [string, unknown])[] = [
      ["host", deps.host],
      ["policy", deps.policy],
      ["fs", deps.fs],
      ["paths", deps.paths],
      ["trustBackend", deps.trustBackend],
      ["clock", deps.clock],
    ];
    return required.find(([, value]) => value === undefined || value === null)?.[0];
  }

  function diag(
    record: Pick<ExtRecord, "name" | "source" | "diagnostics" | "generation">,
    stage: LoadStage,
    severity: LoadDiagnostic["severity"],
    code: LoadDiagnosticCode,
    message: string,
    extra: { readonly issues?: readonly ManifestIssue[]; readonly path?: string } = {},
  ): void {
    const entry: LoadDiagnostic = {
      extension: record.name,
      source: record.source,
      stage,
      severity,
      code,
      message,
      ...(extra.path === undefined ? {} : { path: extra.path }),
      ...(extra.issues === undefined ? {} : { issues: extra.issues }),
      generation: record.generation,
    };
    record.diagnostics.push(entry);
    diagnosticLog.push(entry);
  }

  function infoOf(record: ExtRecord): LoadedExtensionInfo {
    return {
      name: record.name,
      version: versionOf(record.manifest),
      source: record.source,
      trust: record.trust,
      state: record.state,
      isolation: record.isolation,
      essential: record.essential,
      loadIndex: record.loadIndex,
      generation: record.generation,
      ...(record.manifest === undefined ? {} : { manifest: record.manifest }),
      ...(record.candidate.root === null ? {} : { root: record.candidate.root }),
      ...(record.candidate.contentHash === null || record.candidate.contentHash === undefined
        ? {}
        : { contentHash: record.candidate.contentHash }),
      ...(record.candidate.draft === undefined
        ? {}
        : {
            draft: {
              plugin: record.candidate.draft.plugin,
              draftId: record.candidate.draft.draftId,
            },
          }),
      diagnostics: [...record.diagnostics],
    };
  }

  function fail(
    record: ExtRecord,
    state: "rejected" | "disabled" | "error",
    stage: LoadStage,
    code: LoadDiagnosticCode,
    message: string,
    issues?: readonly ManifestIssue[],
  ): void {
    record.state = state;
    diag(
      record,
      stage,
      state === "disabled" ? "info" : "error",
      code,
      message,
      issues === undefined ? {} : { issues },
    );
  }

  /** 후보의 매니페스트 원본(2단계 입력). 초안이면 이름을 내부 이름으로 바꾼다 [제안] */
  async function readManifestInput(candidate: ExtensionCandidate): Promise<ManifestInputRead> {
    const raw = await readRawManifestInput(candidate);
    if (!raw.ok || candidate.draft === undefined) return raw;
    return namedAsDraft(raw.input, candidate.draft);
  }

  /** 후보의 매니페스트 원본. 내장은 모듈의 상수, 외부는 `plugin.json`을 읽어 파싱한다 */
  async function readRawManifestInput(candidate: ExtensionCandidate): Promise<ManifestInputRead> {
    if (candidate.builtin !== null) return { ok: true, input: candidate.builtin.manifest };
    if (candidate.inferredManifest !== undefined) {
      return { ok: true, input: candidate.inferredManifest };
    }
    const path = candidate.manifestPath;
    if (path === null) return { ok: false, code: "manifest_missing", message: "no manifest path" };
    const read = await attemptAsync(() => deps.fs.readText(path));
    if (!read.ok) {
      return { ok: false, code: "manifest_missing", message: `cannot read ${path}` };
    }
    if (read.value === null) {
      return { ok: false, code: "manifest_missing", message: `${path} does not exist` };
    }
    const json = parseJson(read.value.startsWith("﻿") ? read.value.slice(1) : read.value);
    if (!json.ok) {
      return { ok: false, code: "manifest_parse", message: `${path} is not valid JSON` };
    }
    return { ok: true, input: json.value };
  }

  /**
   * 검토본 목록의 한 항목을 후보로 만든다. 매니페스트 파일이 없으면 호스트가 준 추론 매니페스트를 쓰고, 그것도 없으면 undefined다.
   * 코드가 없는 검토본(지침이나 스킬만 든 폴더)은 이렇게 실린다: 엔트리가 없으면 `noCodeEntry`가 등록만 만든다
   */
  async function reviewedPickOf(entry: ReviewedSourceEntry): Promise<ReviewedPick | undefined> {
    // 발견과 같은 규칙으로 실제 경로를 쓴다. 엔트리가 루트 밖인지 가리는 검사는 실제 경로끼리 비교하기 때문이다(macOS의 /var → /private/var)
    const resolved = await attemptAsync(() => deps.fs.realpath(entry.root));
    if (!resolved.ok) {
      diagnosticLog.push({
        extension: entry.name,
        source: installSourceOf(entry.source),
        stage: "discover",
        severity: "warning",
        code: "manifest_missing",
        message: `cannot resolve the reviewed copy of ${entry.name}; it is not loaded`,
        path: entry.root,
        generation: 0,
      });
      return undefined;
    }
    const root = resolved.value;
    const manifestPath = join(root, MANIFEST_RELATIVE_PATH);
    const present = await attemptAsync(() => deps.fs.exists(manifestPath));
    if (!present.ok) {
      diagnosticLog.push({
        extension: entry.name,
        source: installSourceOf(entry.source),
        stage: "discover",
        severity: "warning",
        code: "manifest_missing",
        message: `cannot check the manifest of ${entry.name}; it is not loaded`,
        path: manifestPath,
        generation: 0,
      });
      return undefined;
    }
    const source = installSourceOf(entry.source);
    if (!present.value) {
      if (entry.manifest === undefined) return undefined;
      return {
        name: entry.name,
        candidate: {
          source,
          root,
          manifestPath: null,
          builtin: null,
          contentHash: entry.contentHash,
          inferredManifest: entry.manifest,
          ...(entry.importedScripts === true ? { importedScripts: true } : {}),
        },
      };
    }
    return {
      name: entry.name,
      candidate: {
        source,
        root,
        manifestPath,
        builtin: null,
        contentHash: entry.contentHash,
        ...(entry.importedScripts === true ? { importedScripts: true } : {}),
      },
    };
  }

  /**
   * 검토본 목록에서 `include`가 고른 출처의 후보를 만든다. 매니페스트 파일도 추론 매니페스트도 없는 항목은 건너뛴다.
   * 매니페스트를 확인하지 못한 항목은 경고 진단을 남기고 건너뛴다
   */
  async function reviewedPicksOf(
    listing: ReviewedSourceListing,
    include: (source: ReviewedSourceEntry["source"]) => boolean,
  ): Promise<ReviewedPick[]> {
    const checked = await Promise.all(
      listing.entries.filter((entry) => include(entry.source)).map(reviewedPickOf),
    );
    const picks: ReviewedPick[] = [];
    for (const pick of checked) {
      if (pick !== undefined) picks.push(pick);
    }
    return picks;
  }

  function orderKeyOfRecord(record: ExtRecord): OrderKey {
    const manifest = record.manifest;
    if (manifest === undefined) return fallbackKey(record.name);
    if (record.source === "builtin") return orderKeyOfBuiltin(manifest);
    return { source: record.source, layerIndex: 0, name: record.name };
  }

  /**
   * 1~4단계: 후보 → 검증된 매니페스트, 집합 검사, 순서, 신뢰. 한 묶음(내장·관리·사용자, 그 다음 프로젝트)씩 부르고
   * 새로 만든 기록을 돌려준다. 로드 순서 index는 앞 묶음 뒤에서 이어 매긴다
   */
  async function ingest(candidates: readonly ExtensionCandidate[]): Promise<readonly ExtRecord[]> {
    const batch: ExtRecord[] = [];
    // 같은 이름은 builtin > managed > user > project 순서로 앞의 것을 쓴다(§4.2.2). 같은 위치끼리는 입력 순서를 지킨다
    const sorted = candidates.toSorted((a, b) =>
      compareLoadOrder(
        { source: a.source, layerIndex: 0, name: "" },
        { source: b.source, layerIndex: 0, name: "" },
      ),
    );
    const raws = await Promise.all(sorted.map((candidate) => readManifestInput(candidate)));
    for (const [position, candidate] of sorted.entries()) {
      anonymous += 1;
      const raw = raws[position];
      if (raw === undefined) throw new Bug("loader.manifest_read_missing");
      const result = raw.ok ? validateManifest(raw.input) : undefined;
      const name =
        candidate.draft?.internalName ??
        result?.manifest?.name ??
        fallbackName(candidate, anonymous);
      const record: ExtRecord = {
        name,
        candidate,
        manifest: result?.manifest,
        source: candidate.source,
        trust: "untrusted",
        state: "discovered",
        loadIndex: null,
        generation: nextGeneration.get(name) ?? 0,
        essential: candidate.builtin?.essential === true,
        diagnostics: [],
        ui: [],
        deferred: false,
        isolation: "none",
        handle: undefined,
        reloading: false,
      };
      const first = records.get(name);
      if (first !== undefined) {
        // 같은 이름이 두 번 들어왔다. 위치가 다르면 뒤의 것만, 같은 위치면 둘 다 거부한다
        record.name = `${name}~${anonymous}`;
        records.set(record.name, record);
        batch.push(record);
        const message = `extension name "${name}" is installed twice`;
        fail(record, "rejected", "set", "name_conflict", message);
        // 같은 묶음 안의 같은 위치 충돌만 둘 다 거부한다. 앞 묶음에서 이미 실린 확장(다른 프로젝트 포함)은 이름을 쥔 채 두고 나중 것만 거부한다(§4.7.8 1번)
        if (first.source === record.source && first.state !== "rejected" && batch.includes(first)) {
          fail(first, "rejected", "set", "name_conflict", message);
        }
        continue;
      }
      records.set(name, record);
      batch.push(record);
      if (!raw.ok) {
        fail(record, "rejected", "manifest", raw.code, raw.message);
        continue;
      }
      const warnings = (result?.issues ?? []).filter((issue) => issue.severity === "warning");
      if (result?.manifest === undefined) {
        fail(
          record,
          "rejected",
          "manifest",
          "manifest_invalid",
          `manifest of ${name} is invalid`,
          result?.issues,
        );
        continue;
      }
      if (warnings.length > 0) {
        diag(
          record,
          "manifest",
          "warning",
          "manifest_invalid",
          `manifest of ${name} has warnings`,
          { issues: warnings },
        );
      }
      record.state = "validated";
    }

    // 3단계 집합 검사: 앞 묶음에서 살아 있는 확장도 같이 보지만 거부는 이번 묶음의 확장에만 적용한다
    const valid = batch.filter((record) => record.state === "validated");
    const prior = [...records.values()].filter(
      (record) => !batch.includes(record) && record.state !== "rejected",
    );
    const setIssues = validateManifestSet(
      [...prior, ...valid].flatMap((record) =>
        record.manifest === undefined ? [] : [record.manifest],
      ),
      new Set<string>(deps.coreCapabilities?.keys() ?? []),
    );
    for (const issue of setIssues) {
      const owner = valid.find((record) => issue.path.startsWith(`${record.name}/`));
      if (owner === undefined) continue;
      if (issue.severity === "error") {
        fail(
          owner,
          "rejected",
          "set",
          issue.code === "dependency_cycle" ? "dependency_cycle" : "name_conflict",
          issue.message,
          [issue],
        );
      } else {
        diag(owner, "set", "warning", "manifest_invalid", issue.message, { issues: [issue] });
      }
    }

    // 로드 순서: 입력 순서와 무관하다
    const ordered = orderManifests(
      batch
        .filter((record) => record.state === "validated" && record.manifest !== undefined)
        .map((record) => ({ record, key: orderKeyOfRecord(record) })),
    );
    const base = order.length;
    ordered.forEach((item, index) => {
      item.record.loadIndex = base + index;
    });
    const added = ordered.map((item) => item.record);
    order = [...order, ...added];

    // 4단계 신뢰: 설치 위치 상한과 요청 등급의 낮은 쪽
    for (const record of added) {
      const requested = record.manifest?.trust?.level;
      const effective = effectiveTrust(record.source, requested);
      if (!effective.ok) {
        fail(
          record,
          "rejected",
          "trust",
          "trust_exceeds_source",
          `${record.name} requests trust "${requested ?? "?"}" which source "${record.source}" cannot give`,
        );
        continue;
      }
      record.trust = effective.level;
      record.state = "trusted";
    }
    return batch;
  }

  /** 실효 격리 판정(F5). 설정 값, 매니페스트, 포트 유무, drives로 정한다. 다시 읽기는 새 매니페스트로 다시 부른다 */
  function isolationOf(
    record: ExtRecord,
    manifest: ExtensionManifest | undefined,
  ): IsolationDecision {
    return effectiveIsolationOf({
      source: record.source,
      setting: deps.settings?.isolation?.(record.name),
      manifest: manifest?.isolation,
      hasEntry: manifest?.entry !== undefined,
      portAvailable: deps.process !== undefined && deps.isolation !== undefined,
      draft: record.candidate.draft !== undefined,
    });
  }

  /** 4b단계: 명시 요청이 맞지 않으면 거부한다. 기본 격리는 포트가 없으면 엔진 안에서 돈다 */
  function checkIsolation(record: ExtRecord): void {
    const decision = isolationOf(record, record.manifest);
    if (decision.kind !== "refused") return;
    fail(record, "error", "isolation", decision.code, refusalTextOf(record, decision.code));
  }

  /** 5단계: userConfig 검증. 예약 키 충돌과 다른 네임스페이스 침범은 거부한다 */
  function checkSettings(record: ExtRecord): void {
    const manifest = record.manifest;
    if (manifest === undefined) return;
    const prefix = `ext.${manifest.name}.`;
    for (const [key, entry] of Object.entries(manifest.userConfig ?? {})) {
      const rest = entry.setting.startsWith(prefix)
        ? entry.setting.slice(prefix.length)
        : undefined;
      if (rest === undefined) {
        fail(
          record,
          "rejected",
          "settings",
          "settings_rejected",
          `userConfig "${key}" points at ${entry.setting}, outside ${prefix}*`,
        );
        return;
      }
      if (RESERVED_EXT_KEYS.some((reserved) => reserved === rest)) {
        fail(
          record,
          "rejected",
          "settings",
          "settings_reserved_key",
          `userConfig "${key}" uses the reserved name "${rest}"`,
        );
        return;
      }
    }
    record.state = "resolved";
  }

  function enabledSettingOf(record: ExtRecord): boolean | undefined {
    return deps.settings?.enabled(record.name);
  }

  /** 안전 모드와 `--disable-ext`로 이번 시작에서 빠지는가(X.operations.spec §4.6). 빠지면 사유를 돌려준다 */
  function startupSkipOf(record: ExtRecord): "safe_mode" | "disabled_flag" | undefined {
    const manifest = record.manifest;
    if (manifest === undefined) return undefined;
    const tier = assignTier({
      name: record.name,
      source: record.source,
      trust: record.trust,
      layer: effectiveLayer(manifest),
    });
    if (!tier.ok) return undefined;
    const filtered = startupFilter(
      [{ name: record.name, tier: tier.value, layer: effectiveLayer(manifest) }],
      startup,
    );
    return filtered.skipped[0]?.reason;
  }

  /** 5a단계: 안전 모드와 시작 때 끄기, 켜짐 확인, 필수 userConfig */
  function checkEnabled(record: ExtRecord): boolean {
    const manifest = record.manifest;
    if (manifest === undefined) return false;
    const skipped = startupSkipOf(record);
    if (skipped !== undefined) {
      fail(
        record,
        "disabled",
        "settings",
        skipped,
        skipped === "safe_mode"
          ? `${record.name} is not loaded in safe mode`
          : `${record.name} is disabled by --disable-ext`,
      );
      return false;
    }
    // 켜짐은 대화별 E(T)가 정한다(M5c §4.1.11). 여기서는 관리 잠금(`ext.<이름>.enabled = false`)만 본다
    const enabled = enabledSettingOf(record) ?? true;
    if (!enabled) {
      fail(
        record,
        "disabled",
        "settings",
        "disabled_by_setting",
        `ext.${record.name}.enabled is false`,
      );
      return false;
    }
    for (const [key, entry] of Object.entries(manifest.userConfig ?? {})) {
      if (entry.required === true && deps.settings?.hasValue(entry.setting) !== true) {
        fail(
          record,
          "disabled",
          "settings",
          "config_required",
          `required userConfig "${key}" (${entry.setting}) has no value`,
        );
        return false;
      }
    }
    return true;
  }

  /** 기능 요구 충족: 같은 집합에서 살아 있는 확장의 provides 또는 코어 기능(X.loading-trust.spec §4.8) */
  function checkCapabilities(alive: ExtRecord[]): void {
    let changed = true;
    while (changed) {
      changed = false;
      for (const record of alive.filter((candidate) => candidate.state === "resolved")) {
        const manifest = record.manifest;
        if (manifest === undefined) continue;
        for (const requirement of pluginDeclsOf(manifest).flatMap(
          (plugin) => plugin.requires ?? [],
        )) {
          const provided = alive.some(
            (other) =>
              other !== record &&
              (other.state === "resolved" || other.state === "active") &&
              declsOfManifest(other.manifest)
                .flatMap((plugin) => plugin.provides ?? [])
                .some(
                  (provision) =>
                    provision.id === requirement.id &&
                    satisfiesRange(provision.version, requirement.range),
                ),
          );
          const core = [...(deps.coreCapabilities ?? [])].some(
            ([id, version]) => id === requirement.id && satisfiesRange(version, requirement.range),
          );
          if (!provided && !core) {
            fail(
              record,
              "error",
              "capabilities",
              "capability_missing",
              `${record.name} requires ${requirement.id} ${requirement.range}, which nothing provides`,
            );
            changed = true;
            break;
          }
        }
      }
    }
  }

  /**
   * 의존 검사(AGE-33). hard 대상은 같은 집합에서 살아 있는(resolved/active) 확장이고 구성원과 범위가 맞아야 한다.
   * 맞지 않으면 그 확장은 `dependency_missing`(오류)으로 실패하고, 실패한 대상에 기대던 확장도 다음 바퀴에서 같은 이유로 실패한다.
   * soft가 맞지 않으면 같은 코드를 경고로만 남긴다. 판정은 dependency-graph가 한다. hard 순환은 집합 검사가 이미 막는다
   */
  function checkDependencyTargets(alive: ExtRecord[]): void {
    let changed = true;
    while (changed) {
      changed = false;
      const nodes = liveNodesOf(alive);
      for (const record of alive.filter((candidate) => candidate.state === "resolved")) {
        const subject = dependencyNodeOf(record);
        if (subject === undefined) continue;
        const [problem] = checkDependencies(subject, nodes).blocking;
        if (problem === undefined) continue;
        fail(record, "error", "capabilities", "dependency_missing", dependencyMessageOf(problem));
        changed = true;
        break;
      }
    }
    // 경고는 대상이 모두 정해진 뒤 한 번만 남긴다(바퀴마다 남기면 같은 줄이 겹친다)
    const nodes = liveNodesOf(alive);
    for (const record of alive.filter((candidate) => candidate.state === "resolved")) {
      const subject = dependencyNodeOf(record);
      if (subject === undefined) continue;
      for (const problem of checkDependencies(subject, nodes).warnings) {
        diag(record, "capabilities", "warning", "dependency_missing", dependencyMessageOf(problem));
      }
    }
  }

  /**
   * 설치 순서. 로드 순서(디스패치의 두 번째 키, §4.2.3)는 그대로 두고, 공급자와 hard 의존 대상을 소비자보다 먼저 설치하도록 안정 정렬한다.
   * 소비자가 공급자보다 앞서 설치되면 `capability_unavailable`로 영구 실패하기 때문이다. 순환은 풀 수 없어 로드 순서대로 두고 둘 다 설치에서 실패한다
   * hard 순환은 집합 검사가 막아 여기까지 오지 않는다. soft 의존은 이 정렬에 넣지 않는다
   */
  function installSequence(loadOrdered: readonly ExtRecord[]): readonly ExtRecord[] {
    const providersOf = (record: ExtRecord): ExtRecord[] => {
      const requirements = declsOfManifest(record.manifest).flatMap(
        (plugin) => plugin.requires ?? [],
      );
      const targets = hardTargetsOf(record);
      return loadOrdered.filter(
        (other) =>
          other !== record &&
          (targets.includes(other.name) ||
            declsOfManifest(other.manifest)
              .flatMap((plugin) => plugin.provides ?? [])
              .some((provision) =>
                requirements.some(
                  (requirement) =>
                    requirement.id === provision.id &&
                    satisfiesRange(provision.version, requirement.range),
                ),
              )),
      );
    };
    const sequence: ExtRecord[] = [];
    const visiting = new Set<ExtRecord>();
    const visit = (record: ExtRecord): void => {
      if (sequence.includes(record) || visiting.has(record)) return;
      visiting.add(record);
      for (const provider of providersOf(record)) visit(provider);
      visiting.delete(record);
      sequence.push(record);
    };
    for (const record of loadOrdered) visit(record);
    return sequence;
  }

  /** 요구한 기능을 공급하기로 한 확장이 모두 활성화되지 못했으면 그 기능 id를 돌려준다 */
  function deadProvider(record: ExtRecord): CapabilityId | undefined {
    for (const requirement of declsOfManifest(record.manifest).flatMap(
      (plugin) => plugin.requires ?? [],
    )) {
      const potential = order.some(
        (other) =>
          other !== record &&
          (other.state === "resolved" || other.state === "loading" || other.state === "active") &&
          declsOfManifest(other.manifest)
            .flatMap((plugin) => plugin.provides ?? [])
            .some((provision) => provision.id === requirement.id),
      );
      const core = [...(deps.coreCapabilities ?? [])].some(([id]) => id === requirement.id);
      if (!potential && !core) return toCapabilityIds([requirement.id])[0];
    }
    return undefined;
  }

  /** 기대는 hard 대상 가운데 활성화될 수 없게 된 것(기록이 없거나 실패했거나 꺼졌다). `deadProvider`와 같은 기준이다 */
  function deadHardTargetOf(record: ExtRecord): string | undefined {
    return hardTargetsOf(record).find(
      (target) =>
        !order.some(
          (other) =>
            other !== record &&
            other.name === target &&
            (other.state === "resolved" || other.state === "loading" || other.state === "active"),
        ),
    );
  }

  /** 격리 확장의 엔트리를 만든다. 감독 손잡이는 세션이 열릴 때 채운다. 다시 읽기는 새 손잡이와 세대를 준다 */
  function isolatedEntryFor(
    record: ExtRecord,
    manifest: ExtensionManifest,
    root: string,
    generation: number,
    handle: IsolationHandle,
  ): ExtensionEntry {
    const port = deps.process;
    const isolation = deps.isolation;
    if (port === undefined || isolation === undefined) {
      throw new Bug(`loader.isolation_without_port: ${record.name}`);
    }
    const envGrant = scriptEnvGrantOf(record.candidate);
    return createIsolatedEntry({
      manifest,
      root,
      versionId: versionIdOf(record.candidate, manifest, generation),
      port,
      launch: isolation.launch,
      // 승인 전 드래프트의 프로세스만, 설정을 켰을 때 좁은 길이다. 승인된 플러그인은 설정과 상관없이 열린 길이다 [결정: 2026-11-22, 사용자, AGE-63]
      narrow: () => record.candidate.draft !== undefined && isolation.narrowDrafts?.() === true,
      setTimer: isolation.setTimer,
      now: () => deps.clock.now(),
      ...(isolation.logger === undefined ? {} : { logger: isolation.logger }),
      settingValue: (key) => deps.settings?.settingValue?.(key),
      endReason: () => (record.reloading ? "reload" : "disabled"),
      onRestartLimit: (info) => {
        isolation.onRestartLimit?.(record.name, info);
      },
      onSupervisor: (supervisor) => {
        handle.current = supervisor;
        isolation.onSupervisor?.(record.name, supervisor);
      },
      ...(isolation.initTimeoutMs === undefined ? {} : { initTimeoutMs: isolation.initTimeoutMs }),
      ...(isolation.idleMs === undefined ? {} : { idleMs: isolation.idleMs }),
      ...(isolation.killGraceMs === undefined ? {} : { killGraceMs: isolation.killGraceMs }),
      ...(isolation.maxRestarts === undefined ? {} : { maxRestarts: isolation.maxRestarts }),
      ...(isolation.restartWindowSec === undefined
        ? {}
        : { restartWindowSec: isolation.restartWindowSec }),
      ...(isolation.maskSecrets === undefined ? {} : { maskSecrets: isolation.maskSecrets }),
      ...(isolation.transferMaxBytes === undefined
        ? {}
        : { transferMaxBytes: isolation.transferMaxBytes }),
      // 스크립트는 검토된 버전에서 뜬다. 초안은 승인 문(`scriptGate`)이 호출마다 카드를 열 때만 뜨고, 문이 없으면 띄우지 않는다(script_not_approved)
      scripts: createScriptRunner({
        process: port,
        fs: deps.fs,
        target: {
          extension: manifest.name,
          scripts: manifest.scripts ?? [],
          tree: root,
          approved: record.candidate.draft === undefined,
          ...(envGrant === undefined ? {} : { envGrant }),
        },
        resolveRunner: isolation.runner ?? (() => undefined),
        ...(isolation.runnerReadRoots === undefined
          ? {}
          : { runnerReadRoots: isolation.runnerReadRoots }),
        allowedEnv: isolation.allowedEnv ?? {},
        setTimer: isolation.setTimer,
        ...(isolation.logger === undefined ? {} : { logger: isolation.logger }),
        ...(isolation.scriptGate === undefined ? {} : { draftGate: isolation.scriptGate }),
        ...(isolation.sandboxAvailable === undefined
          ? {}
          : { sandboxAvailable: isolation.sandboxAvailable }),
        ...(isolation.narrowDrafts === undefined ? {} : { narrowDrafts: isolation.narrowDrafts }),
        ...(isolation.maskSecrets === undefined ? {} : { maskText: isolation.maskSecrets }),
        ...(isolation.userEnv === undefined ? {} : { userEnv: isolation.userEnv }),
        ...(isolation.hookProcess === undefined ? {} : { hookProcess: isolation.hookProcess }),
        ...(isolation.envSandboxed === undefined ? {} : { envSandboxed: isolation.envSandboxed }),
        ...(isolation.scriptRefs === undefined ? {} : { refs: isolation.scriptRefs }),
        ...(isolation.readCarveOutsFor === undefined
          ? {}
          : { readCarveOutsFor: isolation.readCarveOutsFor }),
        ...(isolation.projectDirOf === undefined ? {} : { projectDirOf: isolation.projectDirOf }),
      }),
    });
  }

  /** 외부 확장의 엔트리를 import해 설치 단위로 만든다. 실패하면 진단을 남기고 undefined */
  async function unitOfRecord(
    record: ExtRecord,
    manifest: ExtensionManifest,
    loadIndex: number,
  ): Promise<ExtensionUnit | undefined> {
    const module = record.candidate.builtin;
    const initialEnabled = enabledSettingOf(record);
    record.handle = undefined;
    // 단위에 싣는 등급은 신뢰 단계가 정한 유효 등급이다. 요청 값은 상한을 넘으면 이미 거부되었다
    if (module !== null) {
      return unitOfBuiltin(module, manifest, loadIndex, initialEnabled, record.trust);
    }
    const root = record.candidate.root;
    if (root === null) return undefined;
    const decision = isolationOf(record, manifest);
    if (decision.kind === "refused") return undefined;
    if (decision.kind === "process") {
      const handle: IsolationHandle = { current: undefined };
      record.handle = handle;
      const entry = isolatedEntryFor(record, manifest, root, record.generation, handle);
      return unitOfExternal(
        entry,
        manifest,
        loadIndex,
        initialEnabled,
        record.trust,
        record.candidate.contentHash ?? undefined,
      );
    }
    // X가 쓰는 SDK 모듈(contracts와 하위 경로, typebox)은 항상 등록하고, 조립 루트가 넘긴 것(orchestration-sdk 등)을 더한다
    const registered = registerSdkModules({ ...X_SDK_MODULES, ...deps.sdkModules });
    if (!registered.ok) {
      fail(
        record,
        "error",
        "entry",
        "entry_import_failed",
        registered.error.kind === "conflict"
          ? `SDK module ${registered.error.specifier} is already registered with another instance`
          : "SDK virtual modules need the Bun runtime",
      );
      return undefined;
    }
    const loaded = await importExternalEntry(deps.fs, root, manifest, record.generation);
    if (!loaded.ok) {
      fail(record, "error", "entry", loaded.error.code, loaded.error.message);
      return undefined;
    }
    return unitOfExternal(
      loaded.value,
      manifest,
      loadIndex,
      initialEnabled,
      record.trust,
      record.candidate.contentHash ?? undefined,
    );
  }

  /** 6a~9단계 가운데 설치: admit → (외부는 엔트리 import) → install → InstallResult 변환 */
  async function install(record: ExtRecord, signal: AbortSignal): Promise<void> {
    const manifest = record.manifest;
    if (manifest === undefined || record.loadIndex === null) return;
    const dead = deadProvider(record);
    if (dead !== undefined) {
      fail(
        record,
        "error",
        "activate",
        "capability_provider_failed",
        `${record.name} needs ${dead}, whose provider failed to load`,
      );
      return;
    }
    const deadTarget = deadHardTargetOf(record);
    if (deadTarget !== undefined) {
      fail(
        record,
        "error",
        "activate",
        "dependency_provider_failed",
        `${record.name} depends on ${deadTarget}, which did not activate`,
      );
      return;
    }
    record.state = "loading";
    const info: AdmitInfo = {
      name: record.name,
      source: record.source,
      trust: record.trust,
      essential: record.essential,
    };
    const admitted = deps.policy.admit(info, effectiveLayer(manifest));
    if (!admitted.ok) {
      fail(
        record,
        "error",
        "admit",
        "tier_rejected",
        `tier assignment failed: ${admitted.error.kind}`,
      );
      return;
    }
    const unit = await unitOfRecord(record, manifest, record.loadIndex);
    if (unit === undefined) {
      deps.policy.forget(record.name);
      return;
    }
    const isolated = record.handle !== undefined;
    try {
      const result = await deps.host.install(unit, { signal });
      const verdict = verdictOfInstall(result);
      for (const entry of verdict.diagnostics) {
        diag(
          record,
          stageOfVerdict(entry.code),
          entry.severity,
          entry.code,
          entry.message,
          entry.issues === undefined ? {} : { issues: entry.issues },
        );
      }
      if (!verdict.ok) {
        record.state = "error";
        await deps.host.uninstall(record.name);
        retireRecord(record, "disabled");
        deps.policy.forget(record.name);
        return;
      }
      record.deferred = result.setups.some((setup) => setup.status === "deferred");
      record.isolation = isolated ? "process" : "none";
      record.state = "active";
    } catch (error) {
      fail(
        record,
        "error",
        "entry",
        "setup_threw",
        `install of ${record.name} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      await deps.host.uninstall(record.name);
      retireRecord(record, "disabled");
      deps.policy.forget(record.name);
    }
  }

  /** 활성 확장이 잃은 공급자: 기능을 공급하던 확장이거나 hard 대상이다. 잃은 것이 없으면 undefined */
  function lostProviderOf(
    record: ExtRecord,
  ): { readonly code: LoadDiagnosticCode; readonly message: string } | undefined {
    const capability = declsOfManifest(record.manifest)
      .flatMap((plugin) => plugin.requires ?? [])
      .find((requirement) => !hasProvider(record, requirement.id));
    if (capability !== undefined) {
      return {
        code: "capability_provider_failed",
        message: `${record.name} lost its provider of ${capability.id}`,
      };
    }
    const target = hardTargetsOf(record).find(
      (name) =>
        !order.some((other) => other !== record && other.name === name && other.state === "active"),
    );
    if (target !== undefined) {
      return {
        code: "dependency_provider_failed",
        message: `${record.name} lost its hard dependency ${target}`,
      };
    }
    return undefined;
  }

  /** 9단계 뒤: 기능을 공급하기로 한 확장이나 hard 대상이 활성화되지 못했으면 그 확장도 내린다 */
  async function cascadeProviderFailures(): Promise<void> {
    const [orphan] = order.flatMap((record) => {
      if (record.state !== "active") return [];
      const lost = lostProviderOf(record);
      return lost === undefined ? [] : [{ record, lost }];
    });
    if (orphan === undefined) return;
    fail(orphan.record, "error", "activate", orphan.lost.code, orphan.lost.message);
    await deps.host.uninstall(orphan.record.name);
    retireRecord(orphan.record, "disabled");
    deps.policy.forget(orphan.record.name);
    await cascadeProviderFailures();
  }

  function hasProvider(record: ExtRecord, id: string): boolean {
    const provider = order.some(
      (other) =>
        other !== record &&
        other.state === "active" &&
        declsOfManifest(other.manifest)
          .flatMap((plugin) => plugin.provides ?? [])
          .some((provision) => provision.id === id),
    );
    return provider || [...(deps.coreCapabilities ?? [])].some(([coreId]) => coreId === id);
  }

  /**
   * 취소 신호는 단계 경계와 확장 하나를 설치하기 직전에 확인하고(TY-22) `ExtHost.install`에도 넘긴다. 설치 중 취소되면
   * 엔트리 실행을 기다리지 않고 `entryError`(`registration_setup_failed`)로 끝나 그 확장이 `entry_threw`가 된다.
   * 단계 경계에서 취소되면 시작을 거부하는 것과 같은 LoadAbortError를 던진다
   */
  function throwIfCancelled(signal: AbortSignal, before: string): void {
    if (!signal.aborted) return;
    throw new LoadAbortError(
      `extension loading was cancelled before ${before}`,
      diagnosticLog.snapshot(),
    );
  }

  function assertNotEssentialFailure(record: ExtRecord): void {
    if (!record.essential) return;
    if (record.state === "rejected" || record.state === "disabled" || record.state === "error") {
      diag(
        record,
        "activate",
        "error",
        "essential_failed",
        `essential extension ${record.name} is ${record.state}`,
      );
      throw new LoadAbortError(
        `essential extension ${record.name} failed to load`,
        diagnosticLog.snapshot(),
      );
    }
  }

  function settingGroupsOf(): LoadReport["settingGroups"] {
    return order
      .filter((record) => record.state !== "rejected" && record.manifest !== undefined)
      .flatMap((record) => {
        if (record.manifest === undefined) return [];
        const group = reservedExtensionSettings(record.manifest, record.source);
        const declared = settingsFromManifest(record.manifest);
        return [
          {
            owner: record.name,
            namespace: group.namespace,
            defs: [...group.defs, ...declared.defs],
          },
        ];
      });
  }

  /**
   * Plugin UI 검사(X.loading-trust.spec §4.3.4). 거부되지 않은 확장은 꺼져 있어도 검사한다(설정 화면이 깨진 화면을 보일 수 있게).
   * 내장 확장은 확장 루트가 없어 파일을 읽지 못하므로 건너뛴다. 진단은 확장의 진단에 남기고 확장의 상태는 바꾸지 않는다(실패 격리)
   */
  async function checkUiOf(record: ExtRecord): Promise<void> {
    const manifest = record.manifest;
    const root = record.candidate.root;
    if (manifest === undefined || manifest.ui === undefined || root === null) return;
    record.ui = await checkUiDecl({
      ui: manifest.ui,
      root,
      fs: deps.fs,
      source: record.source,
      owner: {
        name: manifest.name,
        ...(manifest.orchestration === undefined ? {} : { orchestration: manifest.orchestration }),
        readsRecordKinds: pluginDeclsOf(manifest).flatMap((decl) => decl.readsRecordKinds ?? []),
        methods: (manifest.methods ?? []).map((method) => ({
          verb: method.verb,
          readOnly: method.readOnly,
        })),
      },
      policy: uiPolicy,
      hostWidgetsVersion: HOST_WIDGETS_VERSION,
      hostBridgeVersion: HOST_BRIDGE_VERSION,
    });
    for (const item of record.ui) {
      for (const found of item.issues) {
        diag(record, "ui", found.severity, found.code, `ui item "${item.id}": ${found.message}`, {
          path: found.path,
        });
      }
    }
  }

  /** 상태를 바꾸지 않고 이번 다시 읽기의 진단을 남긴다 */
  function reloadDiag(
    record: ExtRecord,
    out: LoadDiagnostic[],
    stage: LoadStage,
    code: LoadDiagnosticCode,
    message: string,
    issues?: readonly ManifestIssue[],
  ): void {
    const before = record.diagnostics.length;
    diag(record, stage, "error", code, message, issues === undefined ? {} : { issues });
    out.push(...record.diagnostics.slice(before));
  }

  async function reload(
    name: ExtensionName,
    signal: AbortSignal,
    options?: ReloadOptions,
  ): Promise<Result<ReloadStarted, ReloadFailure>> {
    const record = records.get(name);
    if (record === undefined) return err({ kind: "unknown_extension" });
    if (record.candidate.draft !== undefined)
      return err({ kind: "not_reloadable", reason: "draft" });
    if (record.candidate.builtin !== null) {
      return err({ kind: "not_reloadable", reason: "builtin" });
    }
    const root = record.candidate.root;
    if (root === null) return err({ kind: "not_reloadable", reason: "no_root" });
    return reloadFrom(record, record.candidate, root, signal, options);
  }

  async function reloadFromReviewed(
    name: ExtensionName,
    signal: AbortSignal,
    options?: ReloadOptions,
  ): Promise<Result<ReloadStarted, ReloadFailure>> {
    if (deps.reviewedSource === undefined) return reload(name, signal, options);
    const record = records.get(name);
    if (record === undefined) return err({ kind: "unknown_extension" });
    if (record.candidate.draft !== undefined)
      return err({ kind: "not_reloadable", reason: "draft" });
    if (record.candidate.builtin !== null) {
      return err({ kind: "not_reloadable", reason: "builtin" });
    }
    const listing = await deps.reviewedSource.list();
    const entry = listing.entries.find(
      (item) => item.name === name && installSourceOf(item.source) === record.candidate.source,
    );
    const pick = entry === undefined ? undefined : await reviewedPickOf(entry);
    if (pick === undefined || pick.candidate.root === null) {
      return err({
        kind: "rejected",
        diagnostics: [
          {
            extension: name,
            source: record.candidate.source,
            stage: "discover",
            severity: "error",
            code: "manifest_missing",
            message: `reload of ${name}: no reviewed copy to read`,
            generation: record.generation,
          },
        ],
      });
    }
    return reloadFrom(record, pick.candidate, pick.candidate.root, signal, options);
  }

  /** 다시 읽기의 본체. `candidate`의 `root`에서 매니페스트와 엔트리를 읽어 새 판으로 바꾼다. 성공하면 기록의 후보도 바뀐다 */
  async function reloadFrom(
    record: ExtRecord,
    candidate: ExtensionCandidate,
    root: string,
    signal: AbortSignal,
    options: ReloadOptions | undefined,
  ): Promise<Result<ReloadStarted, ReloadFailure>> {
    const name = record.name;
    if (record.state !== "active" || record.manifest === undefined || record.loadIndex === null) {
      return err({ kind: "not_reloadable", reason: "not_active" });
    }
    const found: LoadDiagnostic[] = [];
    const rejected = (): Result<never, ReloadFailure> =>
      err({ kind: "rejected", diagnostics: found });
    // 1. 매니페스트를 다시 읽는다
    const raw = await readManifestInput(candidate);
    if (!raw.ok) {
      reloadDiag(record, found, "manifest", "reload_rejected", `reload of ${name}: ${raw.message}`);
      return rejected();
    }
    const validated = validateManifest(raw.input);
    const manifest = validated.manifest;
    if (manifest === undefined) {
      reloadDiag(
        record,
        found,
        "manifest",
        "reload_rejected",
        `reload of ${name}: the manifest is invalid`,
        validated.issues,
      );
      return rejected();
    }
    if (manifest.name !== name) {
      reloadDiag(
        record,
        found,
        "manifest",
        "reload_rejected",
        `reload of ${name}: the manifest now names the extension "${manifest.name}"; a rename needs a restart`,
      );
      return rejected();
    }
    // 2. 집합 검사: 다른 확장이 있는 채로 이 매니페스트가 이름·기능 충돌을 만들지 않아야 한다
    const setIssues = validateManifestSet(
      [
        ...[...records.values()]
          .filter((other) => other !== record && other.state !== "rejected")
          .flatMap((other) => (other.manifest === undefined ? [] : [other.manifest])),
        manifest,
      ],
      new Set<string>(deps.coreCapabilities?.keys() ?? []),
    ).filter((issue) => issue.severity === "error" && issue.path.startsWith(`${name}/`));
    if (setIssues.length > 0) {
      reloadDiag(
        record,
        found,
        "set",
        "reload_rejected",
        `reload of ${name}: the manifest conflicts with the installed set`,
        setIssues,
      );
      return rejected();
    }
    // 3. 신뢰 상한: 설치 위치가 줄 수 있는 등급이어야 하고 지금 등급이 달라지면 다시 판정해야 하므로 재시작이다
    const effective = effectiveTrust(record.source, manifest.trust?.level);
    if (!effective.ok || effective.level !== record.trust) {
      reloadDiag(
        record,
        found,
        "trust",
        "reload_rejected",
        `reload of ${name}: the requested trust level changed; restart the host to apply it`,
      );
      return rejected();
    }
    // 3b. 격리 판정을 새 매니페스트로 다시 한다. 엔진 안과 격리 사이를 바꾸는 다시 읽기는 재시작이 필요하다
    const decision = isolationOf(record, manifest);
    if (decision.kind === "refused") {
      reloadDiag(
        record,
        found,
        "isolation",
        decision.code,
        `reload of ${name}: ${refusalTextOf(record, decision.code)}`,
      );
      return rejected();
    }
    if ((decision.kind === "process") !== (record.isolation === "process")) {
      reloadDiag(
        record,
        found,
        "isolation",
        "reload_rejected",
        `reload of ${name}: the isolation changed; restart the host to apply it`,
      );
      return rejected();
    }
    if (decision.kind === "process") {
      return reloadIsolated(
        record,
        candidate,
        manifest,
        root,
        record.loadIndex,
        signal,
        found,
        options,
      );
    }
    // 4. 엔트리를 새 세대로 import한다
    const registered = registerSdkModules({ ...X_SDK_MODULES, ...deps.sdkModules });
    if (!registered.ok) {
      reloadDiag(
        record,
        found,
        "entry",
        "entry_import_failed",
        `reload of ${name}: SDK modules are not available`,
      );
      return rejected();
    }
    const generation = record.generation + 1;
    const loaded = await importExternalEntry(deps.fs, root, manifest, generation);
    if (!loaded.ok) {
      reloadDiag(
        record,
        found,
        "entry",
        loaded.error.code,
        `reload of ${name}: ${loaded.error.message}`,
      );
      return rejected();
    }
    throwIfCancelled(signal, `reloading ${name}`);
    // 5. 호스트가 엔트리를 따로 실행해 검사하고 경계에서 바꾼다
    // 재읽기는 등급을 바꾸지 않는다(3단계에서 같은 등급인지 확인했다)
    const unit = unitOfExternal(
      loaded.value,
      manifest,
      record.loadIndex,
      undefined,
      record.trust,
      candidate.contentHash ?? undefined,
    );
    const started = await deps.host.replaceUnit(unit, {
      signal,
      ...(options?.resetRefusedState === true ? { resetRefusedState: true } : {}),
    });
    if (!started.ok) {
      const refusal = started.error;
      reloadDiag(
        record,
        found,
        "entry",
        refusal.kind === "plugins_unregistered" ? "plugin_not_registered" : "entry_threw",
        refusal.kind === "entry_failed"
          ? `reload of ${name}: entry threw: ${messageOfError(refusal.error)}`
          : refusal.kind === "plugins_unregistered"
            ? `reload of ${name}: the entry did not register ${refusal.registrations.join(", ")}`
            : `reload of ${name}: the extension is not installed in the host`,
      );
      return rejected();
    }
    const applied = started.value.applied.then(async (outcome): Promise<ReloadApplied> => {
      if (outcome.status === "superseded" || outcome.status === "cancelled") return outcome;
      if (outcome.status === "failed") {
        const issued: LoadDiagnostic[] = [];
        reloadDiag(
          record,
          issued,
          "activate",
          "reload_failed",
          `reload of ${name} failed at ${outcome.scopeId} (${outcome.code}): ${outcome.message}; ${outcome.restored ? "the previous version keeps running" : `these scopes stayed off: ${outcome.failedToRestore.join(", ")}`}`,
        );
        return { status: "failed", diagnostics: issued, restored: outcome.restored };
      }
      record.candidate = candidate;
      record.manifest = manifest;
      record.generation = generation;
      record.ui = [];
      await checkUiOf(record);
      return { status: "applied", statesCleared: outcome.statesCleared, info: infoOf(record) };
    });
    return ok({ appliesAt: started.value.appliesAt, applied });
  }

  /**
   * 격리 확장의 다시 읽기. 새 세대의 엔트리가 새 감독을 연다(엔트리가 `host.init`까지 맞춘다). 적용이 끝나면 옛 감독을 `reload`로 닫는다.
   * 적용이 실패하거나 취소되면 새 감독을 닫고 옛 버전이 그대로 돈다
   */
  async function reloadIsolated(
    record: ExtRecord,
    candidate: ExtensionCandidate,
    manifest: ExtensionManifest,
    root: string,
    loadIndex: number,
    signal: AbortSignal,
    found: LoadDiagnostic[],
    options: ReloadOptions | undefined,
  ): Promise<Result<ReloadStarted, ReloadFailure>> {
    const name = record.name;
    const generation = record.generation + 1;
    throwIfCancelled(signal, `reloading ${name}`);
    const handle: IsolationHandle = { current: undefined };
    const unit = unitOfExternal(
      isolatedEntryFor(record, manifest, root, generation, handle),
      manifest,
      loadIndex,
      undefined,
      record.trust,
      candidate.contentHash ?? undefined,
    );
    record.reloading = true;
    const started = await deps.host.replaceUnit(unit, {
      signal,
      ...(options?.resetRefusedState === true ? { resetRefusedState: true } : {}),
    });
    if (!started.ok) {
      record.reloading = false;
      retireHandle(handle, "reload");
      const refusal = started.error;
      reloadDiag(
        record,
        found,
        "entry",
        refusal.kind === "plugins_unregistered" ? "plugin_not_registered" : "entry_threw",
        refusal.kind === "entry_failed"
          ? `reload of ${name}: entry threw: ${messageOfError(refusal.error)}`
          : refusal.kind === "plugins_unregistered"
            ? `reload of ${name}: the entry did not register ${refusal.registrations.join(", ")}`
            : `reload of ${name}: the extension is not installed in the host`,
      );
      return err({ kind: "rejected", diagnostics: found });
    }
    const applied = started.value.applied.then(async (outcome): Promise<ReloadApplied> => {
      record.reloading = false;
      if (outcome.status === "superseded" || outcome.status === "cancelled") {
        retireHandle(handle, "reload");
        return outcome;
      }
      if (outcome.status === "failed") {
        retireHandle(handle, "reload");
        const issued: LoadDiagnostic[] = [];
        reloadDiag(
          record,
          issued,
          "activate",
          "reload_failed",
          `reload of ${name} failed at ${outcome.scopeId} (${outcome.code}): ${outcome.message}; ${outcome.restored ? "the previous version keeps running" : `these scopes stayed off: ${outcome.failedToRestore.join(", ")}`}`,
        );
        return { status: "failed", diagnostics: issued, restored: outcome.restored };
      }
      const previous = record.handle;
      record.handle = handle;
      retireHandle(previous, "reload");
      record.candidate = candidate;
      record.manifest = manifest;
      record.generation = generation;
      record.ui = [];
      await checkUiOf(record);
      return { status: "applied", statesCleared: outcome.statesCleared, info: infoOf(record) };
    });
    return ok({ appliesAt: started.value.appliesAt, applied });
  }

  /**
   * 꺼진 기록이 가리는 검토본이 목록의 현재 사본과 다르면 그 사본을 돌려준다(승인이 기록을 꺼 둔 채 현재를 바꾼 경우).
   * 같거나 목록에 없거나 검토본 목록이 없으면 undefined다
   */
  async function currentReviewedCopyOf(record: ExtRecord): Promise<ExtensionCandidate | undefined> {
    if (deps.reviewedSource === undefined || record.candidate.builtin !== null) return undefined;
    const listing = await deps.reviewedSource.list();
    const pick = (await reviewedPicksOf(listing, (source) => source !== "project")).find(
      (item) => item.name === record.name,
    );
    if (pick === undefined || pick.candidate.contentHash === record.candidate.contentHash) {
      return undefined;
    }
    return pick.candidate;
  }

  async function refreshDeferred(name: ExtensionName, signal: AbortSignal): Promise<boolean> {
    const record = records.get(name);
    if (record === undefined || record.state !== "disabled") return false;
    if (!record.diagnostics.some((item) => item.code === "lazy_deferred")) return false;
    const current = await currentReviewedCopyOf(record);
    if (current === undefined) return false;
    throwIfCancelled(signal, `refreshing ${name}`);
    records.delete(name);
    order = order.filter((item) => item !== record);
    nextGeneration.set(name, record.generation + 1);
    await processBatch([current], signal, undefined, true);
    return true;
  }

  async function ensureLoaded(
    name: ExtensionName,
    signal: AbortSignal,
  ): Promise<LoadedExtensionInfo> {
    const record = records.get(name);
    if (record === undefined) throw new Bug(`loader.unknown_extension: ${name}`);
    if (record.state !== "disabled") return infoOf(record);
    throwIfCancelled(signal, `loading ${name}`);
    // 꺼진 기록은 시작 때 본 사본을 쥐고 있다. 그 뒤 승인으로 현재가 바뀌었으면 현재 사본으로 기록을 다시 만든다
    const current = await currentReviewedCopyOf(record);
    if (current !== undefined) {
      records.delete(name);
      order = order.filter((item) => item !== record);
      nextGeneration.set(name, record.generation + 1);
      await processBatch([current], signal);
      const reloaded = records.get(name);
      if (reloaded === undefined) throw new Bug(`loader.reingest_without_record: ${name}`);
      assertNotEssentialFailure(reloaded);
      return infoOf(reloaded);
    }
    // 시작 때의 이유(꺼진 채 남긴 `lazy_deferred` 같은 것)는 이번 시도의 판정으로 바뀐다. 남은 것만 다시 적는다
    record.diagnostics.length = 0;
    record.state = "resolved";
    if (checkEnabled(record)) {
      const live = order.filter(
        (candidate) => candidate.state === "resolved" || candidate.state === "active",
      );
      checkCapabilities(live);
      checkDependencyTargets(live);
      checkIsolation(record);
      if (currentState(record) === "resolved") await install(record, signal);
    }
    assertNotEssentialFailure(record);
    return infoOf(record);
  }

  /**
   * 초안 입력으로 후보를 만든다. 검토본과 같은 규칙으로 실제 경로와 매니페스트를 정하고(파일이 없으면 추론 매니페스트), 초안 출처를 붙인다
   */
  async function draftCandidateOf(
    input: DraftLoadInput,
    origin: DraftOrigin,
  ): Promise<ExtensionCandidate | undefined> {
    const pick = await reviewedPickOf({
      name: input.plugin,
      source: "user",
      root: input.root,
      contentHash: input.contentHash,
      ...(input.manifest === undefined ? {} : { manifest: input.manifest }),
    });
    if (pick === undefined) return undefined;
    return { ...pick.candidate, draft: origin };
  }

  /**
   * 초안을 싣는다 [제안, X.loading-trust.spec §4.9.8]. 띄우기 포트나 띄우기 설정이 없으면 아무것도 싣지 않는다(엔진 안 실행 경로가 없다).
   * 나머지 단계는 `loadInstalled`와 같고, 기록은 내부 이름으로 둔다. 실패하면 기록을 지운다(꺼진 기록도 남기지 않는다).
   */
  async function loadDraft(
    input: DraftLoadInput,
    signal: AbortSignal,
  ): Promise<Result<LoadInstalledStarted, LoadDraftFailure>> {
    if (deps.process === undefined || deps.isolation === undefined) {
      return err({ kind: "isolation_unavailable" });
    }
    if (startup.safeMode.active) return err({ kind: "safe_mode" });
    const internalName = internalDraftName(input.plugin, input.draftId);
    const held = drafts.get(internalName);
    if (held !== undefined) {
      return err(
        held.plugin === input.plugin && held.draftId === input.draftId
          ? { kind: "already_loaded" }
          : { kind: "name_taken", internalName },
      );
    }
    if (records.has(internalName)) return err({ kind: "name_taken", internalName });
    const mark = diagnosticLog.mark();
    const origin: DraftOrigin = {
      plugin: input.plugin,
      draftId: input.draftId,
      internalName,
      contentHash: input.contentHash,
    };
    const candidate = await draftCandidateOf(input, origin);
    if (candidate === undefined) {
      if (diagnosticLog.since(mark).length === 0) {
        diagnosticLog.push({
          extension: internalName,
          source: "user",
          stage: "discover",
          severity: "error",
          code: "manifest_missing",
          message: `draft ${input.plugin} has no manifest`,
          path: input.root,
          generation: 0,
        });
      }
      return err({ kind: "not_found", diagnostics: diagnosticLog.since(mark) });
    }
    const before = new Set(records.values());
    await processBatch([candidate], signal);
    const added = [...records.values()].filter((record) => !before.has(record));
    const record = added.find((item) => item.candidate === candidate) ?? added[0];
    if (record === undefined) throw new Bug(`loader.draft_without_record: ${internalName}`);
    if (record.state === "active") {
      drafts.set(internalName, {
        internalName,
        plugin: input.plugin,
        draftId: input.draftId,
        contentHash: input.contentHash,
      });
      return ok({ appliesAt: record.deferred ? "nextStepBoundary" : "now", info: infoOf(record) });
    }
    const state = record.state;
    const failure = {
      kind: "not_active",
      state: state === "disabled" || state === "error" ? state : "rejected",
      diagnostics: [...record.diagnostics],
    } as const;
    records.delete(internalName);
    order = order.filter((item) => item !== record);
    return err(failure);
  }

  /**
   * 실린 초안을 내린다. 활성이면 호스트에서 내리고 격리 세션을 닫은 뒤 기록과 `drafts` 항목을 지운다. 초안이 아니면 false다 [제안]
   */
  async function unloadDraft(internalName: ExtensionName): Promise<boolean> {
    if (!drafts.has(internalName)) return false;
    const record = records.get(internalName);
    if (record !== undefined) {
      if (record.state === "active" || record.state === "loading") {
        await deps.host.uninstall(internalName);
        retireRecord(record, "disabled");
        deps.policy.forget(internalName);
      }
      records.delete(internalName);
      order = order.filter((item) => item !== record);
    }
    drafts.delete(internalName);
    await cascadeProviderFailures();
    return true;
  }

  async function loadInstalled(
    name: ExtensionName,
    signal: AbortSignal,
    options?: LoadInstalledOptions,
  ): Promise<Result<LoadInstalledStarted, LoadInstalledFailure>> {
    if (records.has(name)) return err({ kind: "already_loaded" });
    if (startup.safeMode.active) return err({ kind: "safe_mode" });
    throwIfCancelled(signal, `loading ${name}`);
    const mark = diagnosticLog.mark();
    let target: ExtensionCandidate | undefined;
    if (deps.reviewedSource === undefined) {
      const found = await discoverExternal(
        deps.fs,
        externalLocations({
          paths: deps.paths,
          extraPaths: [],
          projectRoot: null,
          sources: ["user"],
        }),
      );
      // 위치는 사용자 확장 위치 하나뿐이라 디렉터리 이름이 곧 설치 이름이다
      target = found.candidates.find(
        (candidate) => candidate.root !== null && basename(candidate.root) === name,
      );
    } else {
      // 검토본 목록에서 이름으로 찾는다. 검토본 폴더 이름은 해시라서 디렉터리 이름으로 찾을 수 없다
      const listing = await deps.reviewedSource.list();
      diagnosticLog.pushAll(
        listing.diagnostics
          .filter((item) => item.name === name && item.source !== "project")
          .map(reviewedDiagnosticOf),
      );
      const pick = (await reviewedPicksOf(listing, (source) => source !== "project")).find(
        (item) => item.name === name,
      );
      target = pick?.candidate;
    }
    if (target === undefined) {
      return err({ kind: "not_found", diagnostics: diagnosticLog.since(mark) });
    }
    const before = new Set(records.values());
    await processBatch([target], signal, undefined, options?.deferStart === true);
    const added = [...records.values()].filter((record) => !before.has(record));
    const record = added.find((item) => item.candidate === target) ?? added[0];
    if (record === undefined) throw new Bug(`loader.install_without_record: ${name}`);
    if (record.state === "active") {
      return ok({ appliesAt: record.deferred ? "nextStepBoundary" : "now", info: infoOf(record) });
    }
    const state = record.state;
    const failure = {
      kind: "not_active",
      state: state === "disabled" || state === "error" ? state : "rejected",
      diagnostics: [...record.diagnostics],
    } as const;
    // 꺼진 채로 둔 것만 기록을 남겨 `ensureLoaded`가 켤 수 있게 한다. 그 밖은 지워 같은 이름을 다시 설치할 수 있게 한다
    if (state !== "disabled") {
      nextGeneration.set(name, record.generation + 1);
      records.delete(record.name);
      order = order.filter((item) => item !== record);
    }
    return err(failure);
  }

  /**
   * 외부 확장을 호스트에서 내리고 기록은 꺼진 채 남긴다(`disabled`, 세대 +1). 같은 이름의 `ensureLoaded`가 검토본에서 다시 싣는다.
   * 내장 확장이거나 로더가 모르는 이름이면 false다
   */
  async function unload(name: ExtensionName): Promise<boolean> {
    if (drafts.has(name)) return unloadDraft(name);
    const record = records.get(name);
    if (record === undefined || record.candidate.builtin !== null) return false;
    if (record.state === "active" || record.state === "loading") {
      await deps.host.uninstall(name);
      retireRecord(record, "disabled");
      deps.policy.forget(name);
    }
    record.generation += 1;
    record.state = "disabled";
    await cascadeProviderFailures();
    return true;
  }

  /** 로드 순서 index가 있는 것부터, 같거나 없으면 이름 순. 목록과 화면 기여 목록이 같은 순서를 쓴다 */
  function inLoadOrder(): ExtRecord[] {
    return [...records.values()].toSorted(
      (a, b) =>
        (a.loadIndex ?? Number.MAX_SAFE_INTEGER) - (b.loadIndex ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );
  }

  function listAll(): readonly LoadedExtensionInfo[] {
    return inLoadOrder().map(infoOf);
  }

  /**
   * 시작 때 싣지 않고 꺼진 채 남길 외부 확장인가(`LoadOptions.defaultNames`). 기본 집합 밖이면 매니페스트 `defaultEnabled`와
   * 무관하게 미룬다(매니페스트의 "기본으로 켜짐"은 번들에만 효력이 있다, 2026-11-18 AGE-49). 집합이 없으면(`undefined`) 아무것도 미루지 않는다
   */
  function deferredAtStartup(
    record: ExtRecord,
    defaultNames: ReadonlySet<string> | undefined,
    pinned: ReadonlySet<string>,
  ): boolean {
    if (defaultNames === undefined || record.manifest === undefined) return false;
    if (pinned.has(record.name)) return false;
    return !defaultNames.has(record.name);
  }

  /**
   * 기본 집합의 확장이 hard로 기대는 대상의 닫힘(AGE-33). 이 이름들은 기본 집합 밖이어도 시작 때 싣는다. 미루면 기대는 쪽이
   * `dependency_missing`(오류)으로 멈추기 때문이다. 대상의 hard 대상까지 따라간다. soft 대상은 닫힘에 들지 않아 그대로 미룬다.
   * 묶음 안의 기록만 본다(앞 묶음에서 미룬 대상은 이 시작에서 다시 싣지 않는다)
   */
  function hardClosureOf(
    batch: readonly ExtRecord[],
    defaultNames: ReadonlySet<string> | undefined,
  ): ReadonlySet<string> {
    const closure = new Set<string>();
    if (defaultNames === undefined) return closure;
    const byName = new Map(batch.map((record) => [record.name, record] as const));
    const pending = batch
      .filter((record) => defaultNames.has(record.name))
      .map((record) => record.name);
    for (let name = pending.pop(); name !== undefined; name = pending.pop()) {
      const manifest = byName.get(name)?.manifest;
      if (manifest === undefined) continue;
      for (const dependency of dependenciesOf(manifest)) {
        if (dependency.kind !== "hard" || closure.has(dependency.targetExtension)) continue;
        closure.add(dependency.targetExtension);
        pending.push(dependency.targetExtension);
      }
    }
    return closure;
  }

  /** 한 묶음의 1~9단계. 묶음 안에서 순서대로 설치하고 마지막에 기능 연쇄 실패를 정리한다 */
  async function processBatch(
    candidates: readonly ExtensionCandidate[],
    signal: AbortSignal,
    defaultNames?: ReadonlySet<string>,
    deferAll = false,
  ): Promise<void> {
    throwIfCancelled(signal, "validation");
    const batch = await ingest(candidates);
    // 거부된 확장도 필수 확장이면 시작 실패다
    for (const record of batch) assertNotEssentialFailure(record);

    throwIfCancelled(signal, "settings");
    for (const record of batch) if (record.state === "trusted") checkSettings(record);
    for (const record of batch) if (record.state === "resolved") checkIsolation(record);
    for (const record of batch) assertNotEssentialFailure(record);

    throwIfCancelled(signal, "enable check");
    const alive: ExtRecord[] = [];
    const pinned = hardClosureOf(batch, defaultNames);
    for (const record of batch) {
      if (
        record.state === "resolved" &&
        (deferAll || deferredAtStartup(record, defaultNames, pinned))
      ) {
        // 시작 때 싣지 않는다. 기록은 꺼진 채 남고 `ensureLoaded`가 대화의 E(T)에 들 때 싣는다
        fail(
          record,
          "disabled",
          "settings",
          "lazy_deferred",
          `${record.name} is not in the default set; it loads when a conversation uses it`,
        );
      } else if (record.state === "resolved" && checkEnabled(record)) {
        alive.push(record);
      }
      assertNotEssentialFailure(record);
    }
    const live = order.filter((record) => record.state === "resolved" || record.state === "active");
    checkCapabilities(live);
    checkDependencyTargets(live);
    for (const record of alive) assertNotEssentialFailure(record);

    // 5b단계 화면 검사: 설치 전에 한다. 항목의 진단은 확장의 진단에 남고 확장의 상태는 바꾸지 않는다(§4.3.4)
    throwIfCancelled(signal, "screen check");
    await eachInOrder(
      batch.filter((record) => record.state !== "rejected"),
      async (record) => {
        await checkUiOf(record);
        return "continue";
      },
    );

    await eachInOrder(
      installSequence(order.filter((record) => alive.includes(record))),
      async (record) => {
        if (record.state !== "resolved") return "continue";
        throwIfCancelled(signal, `installing ${record.name}`);
        await install(record, signal);
        assertNotEssentialFailure(record);
        return "continue";
      },
    );
    throwIfCancelled(signal, "provider cascade");
    await cascadeProviderFailures();
  }

  /** 프로젝트 신뢰를 정하고 거부·미결정이면 진단을 남긴다. 판정 자체가 실패하면 불신으로 둔다 */
  async function resolveProject(options: {
    readonly cwd: string;
    readonly mode: LoaderMode;
    readonly prompter?: TrustPrompter | undefined;
    readonly trustOverride?: boolean | undefined;
    readonly signal: AbortSignal;
  }): Promise<ProjectTrustResult | null> {
    const store = createProjectTrustStore(
      deps.trustBackend,
      (path) => deps.fs.realpath(path),
      deps.clock,
    );
    const decided = await attemptAsync(() =>
      resolveProjectTrust({
        projectRoot: options.cwd,
        mode: options.mode,
        ...(options.trustOverride === undefined ? {} : { trustOverride: options.trustOverride }),
        defaultProjectTrust: deps.settings?.defaultProjectTrust?.() ?? "ask",
        store,
        fs: deps.fs,
        homeDir: deps.paths.homeDir,
        ...(options.prompter === undefined && deps.prompter === undefined
          ? {}
          : { prompter: options.prompter ?? deps.prompter }),
        emitProjectTrust: deps.emitProjectTrust ?? (() => Promise.resolve(undefined)),
        sessionMemory: sessionTrust,
        signal: options.signal,
      }),
    );
    if (!decided.ok) {
      diagnosticLog.push(
        projectDiagnostic("trust_undecided", "error", "project trust could not be decided"),
      );
      return null;
    }
    const result = decided.value;
    if (result.storeError !== undefined) {
      diagnosticLog.push(
        projectDiagnostic(
          "trust_store_corrupt",
          "error",
          `trust store is ${result.storeError.kind}`,
        ),
      );
    }
    if (!result.trusted && result.resources.length > 0) {
      diagnosticLog.push(
        projectDiagnostic(
          result.verdict === "deny" ? "trust_denied" : "trust_undecided",
          "warning",
          `project ${result.projectRoot} is not trusted (${result.via}); its extensions are not loaded`,
        ),
      );
    }
    return result;
  }

  /**
   * 신뢰된 프로젝트 루트의 확장을 찾아 한 묶음으로 싣는다. 검토본 목록이 있으면 `projectId`가 이 프로젝트인 프로젝트 검토본만 싣는다
   * (AGE-41). 프로젝트 id가 없는 프로젝트 검토본은 어느 프로젝트에서도 싣지 않고 진단을 남긴다.
   */
  async function loadProjectCandidates(
    projectRoot: string,
    signal: AbortSignal,
    projectId: string | undefined,
    defaultNames?: ReadonlySet<string>,
  ): Promise<void> {
    if (deps.reviewedSource !== undefined) {
      // 검토본 목록이 있으면 프로젝트 폴더를 훑지 않는다. 프로젝트 동반은 검토 항목이 승인된 뒤에만 목록에 나타난다(M5c §4.7.9).
      // 이미 실린 이름은 다시 싣지 않는다. 같은 이름의 다른 프로젝트 검토본은 목록에 있어도 여기서 이름이 겹쳐 건너뛴다
      const listing = await deps.reviewedSource.list();
      diagnosticLog.pushAll(
        listing.diagnostics.filter((item) => item.source === "project").map(reviewedDiagnosticOf),
      );
      const projectEntries = listing.entries.filter((entry) => entry.source === "project");
      for (const entry of projectEntries) {
        if (entry.projectId !== undefined) continue;
        diagnosticLog.push(
          projectDiagnostic(
            "project_no_id",
            "warning",
            `reviewed project copy ${entry.name} has no project id; it is not loaded`,
          ),
        );
      }
      const mine = projectEntries.filter(
        (entry) => entry.projectId !== undefined && entry.projectId === projectId,
      );
      const picks = (
        await reviewedPicksOf({ entries: mine, diagnostics: [] }, (source) => source === "project")
      ).filter((pick) => !records.has(pick.name));
      await processBatch(
        picks.map((pick) => pick.candidate),
        signal,
        defaultNames,
      );
      return;
    }
    const project = await discoverExternal(
      deps.fs,
      externalLocations({
        paths: deps.paths,
        extraPaths: [],
        projectRoot,
        sources: ["project"],
      }),
    );
    diagnosticLog.pushAll(project.diagnostics);
    await processBatch(project.candidates, signal, defaultNames);
  }

  async function loadProject(options: LoadProjectOptions): Promise<ProjectLoadReport> {
    throwIfCancelled(options.signal, "project trust");
    const diagnosticsMark = diagnosticLog.mark();
    const recordsBefore = new Set(records.values());
    const finish = (
      projectTrust: ProjectTrustResult | null,
      alreadyLoaded: boolean,
    ): ProjectLoadReport => ({
      projectRoot: projectTrust?.projectRoot ?? null,
      projectTrust,
      alreadyLoaded,
      extensions: [...records.values()]
        .filter((record) => !recordsBefore.has(record))
        .toSorted((a, b) => a.name.localeCompare(b.name))
        .map(infoOf),
      diagnostics: diagnosticLog.since(diagnosticsMark),
    });
    if (startup.safeMode.active) {
      diagnosticLog.push(
        projectDiagnostic(
          "safe_mode",
          "info",
          "project extensions are not discovered in safe mode",
        ),
      );
      return finish(null, false);
    }
    const trust = await resolveProject({
      cwd: options.projectRoot,
      mode: options.mode,
      prompter: options.prompter,
      trustOverride: options.trustOverride,
      signal: options.signal,
    });
    if (trust === null) return finish(null, false);
    if (!trust.trusted) return finish(trust, false);
    const alreadyLoaded = loadedProjects.has(trust.projectRoot);
    // 검토본 목록이 있으면 이미 실은 루트도 다시 본다. 승인이 그 뒤에 끝난 프로젝트 동반 플러그인이 다음 열기에 실리게 하려고다
    // (이미 실린 이름은 `loadProjectCandidates`가 건너뛴다). 목록이 없는 조립은 훑기가 중복 이름을 내므로 기억한 루트를 다시 훑지 않는다
    if (alreadyLoaded && deps.reviewedSource === undefined) return finish(trust, true);
    // 실리기 전에 중단되거나 실패하면 기억하지 않는다. 다음 호출이 다시 싣는다
    await loadProjectCandidates(trust.projectRoot, options.signal, options.projectId);
    loadedProjects.add(trust.projectRoot);
    for (const record of order) assertNotEssentialFailure(record);
    return finish(trust, alreadyLoaded);
  }

  return {
    async loadAll(options) {
      const missing = missingDependency();
      if (missing !== undefined) throw new Bug(`loader.missing_dependency: ${missing}`);
      throwIfCancelled(options.signal, "validation");
      records.clear();
      drafts.clear();
      nextGeneration.clear();
      diagnosticLog.clear();
      order = [];
      anonymous = 0;
      startup = options.startup ?? NO_STARTUP_OPTIONS;
      uiPolicy = {
        apps: options.uiPolicy?.apps ?? DEFAULT_UI_POLICY.apps,
        allowProjectApps: options.uiPolicy?.allowProjectApps ?? DEFAULT_UI_POLICY.allowProjectApps,
      };
      const safeMode = startup.safeMode.active;
      const extraPaths = options.extraPaths ?? [];

      // 1. 내장, 관리, 사용자 확장. 검토본 목록이 있으면 사용자와 번들 확장은 거기서 받고 사용자 위치는 훑지 않는다(M5c §4.5.2, §4.6.3).
      //    프로젝트 위치는 신뢰 판정 뒤에만 탐색한다(§4.7.4)
      const reviewed =
        deps.reviewedSource === undefined ? undefined : await deps.reviewedSource.list();
      const external = await discoverExternal(
        deps.fs,
        externalLocations({
          paths: deps.paths,
          extraPaths: reviewed === undefined ? extraPaths : [],
          projectRoot: null,
          sources: reviewed === undefined ? ["managed", "user"] : ["managed"],
        }),
      );
      diagnosticLog.pushAll(external.diagnostics);
      const reviewedFirst =
        reviewed === undefined
          ? []
          : await reviewedPicksOf(reviewed, (source) => source !== "project");
      diagnosticLog.pushAll(
        (reviewed?.diagnostics ?? [])
          .filter((item) => item.source !== "project")
          .map(reviewedDiagnosticOf),
      );
      // 시작 때 싣는 기본 집합(`defaultNames`)은 이 호출에서만 쓴다. 나중의 `loadInstalled`·`ensureLoaded`는 집합과 무관하게 싣는다
      const defaultNames =
        options.defaultNames === undefined ? undefined : new Set<string>(options.defaultNames);
      await processBatch(
        [
          ...candidatesFromBuiltins(options.builtins),
          ...external.candidates,
          ...reviewedFirst.map((pick) => pick.candidate),
        ],
        options.signal,
        defaultNames,
      );

      // 2. 프로젝트 신뢰와 프로젝트 확장. 안전 모드에서는 프로젝트 확장을 싣지 않으므로 판정(프롬프트)도 하지 않는다.
      //    on_demand(서비스 모드)에서는 여기서 판정하지 않고 작업 폴더를 여는 때 loadProject가 한다
      let projectTrust: ProjectTrustResult | null = null;
      loadedProjects.clear();
      if (safeMode) {
        diagnosticLog.push(
          projectDiagnostic(
            "safe_mode",
            "info",
            "project extensions are not discovered in safe mode",
          ),
        );
      } else if (options.projects !== "on_demand") {
        throwIfCancelled(options.signal, "project trust");
        projectTrust = await resolveProject(options);
        if (projectTrust?.trusted === true) {
          loadedProjects.add(projectTrust.projectRoot);
          const projectId =
            options.projectIdOf === undefined
              ? undefined
              : await options.projectIdOf(projectTrust.projectRoot);
          await loadProjectCandidates(
            projectTrust.projectRoot,
            options.signal,
            projectId,
            defaultNames,
          );
        }
      }
      for (const record of order) assertNotEssentialFailure(record);
      return {
        extensions: listAll(),
        diagnostics: diagnosticLog.snapshot(),
        projectTrust,
        settingGroups: settingGroupsOf(),
      };
    },
    loadProject,
    ensureLoaded,
    reload,
    reloadFromReviewed,
    refreshDeferred,
    loadInstalled,
    loadDraft,
    unloadDraft,
    loadDraftsOf: () => [...drafts.values()],
    draftOf: (internalName) => drafts.get(internalName),
    unload,
    async settingChanged(name, signal) {
      const record = records.get(name);
      if (record === undefined) return undefined;
      throwIfCancelled(signal, `applying the setting of ${name}`);
      const enabled = enabledSettingOf(record) ?? true;
      if (record.state === "disabled" && enabled) return ensureLoaded(name, signal);
      if (record.state === "active") {
        for (const info of deps.host.registrations().filter((scope) => scope.extension === name)) {
          const handle = deps.host.registration(info.id);
          if (enabled) handle?.enable();
          else handle?.disable();
        }
        // 다시 켜면 실패 장부를 비운다. 비우지 않으면 자동으로 꺼진 확장이 재시작 전까지 다시 꺼지지 않는다(M4 X-4)
        if (enabled) deps.policy.autoDisabler?.clearLedger(`ext:${name}`);
      }
      return infoOf(record);
    },
    list: listAll,
    diagnostics: () => diagnosticLog.snapshot(),
    uiEntries: () =>
      inLoadOrder().flatMap((record) =>
        record.ui.map((item) => ({
          extension: record.name,
          version: versionOf(record.manifest),
          trust: record.source,
          ...item,
        })),
      ),
    async dispose() {
      await eachInOrder([...order].toReversed(), async (record) => {
        if (record.state !== "active") return "continue";
        await deps.host.uninstall(record.name);
        retireRecord(record, "disabled");
        deps.policy.forget(record.name);
        record.state = "disabled";
        return "continue";
      });
      drafts.clear();
    },
  };
}
