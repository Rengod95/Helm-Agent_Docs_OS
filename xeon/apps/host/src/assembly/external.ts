import { join } from "node:path";
import { attemptAsync, parseJson, type Clock, type Logger } from "@fresnel/contracts";
import {
  validateManifest,
  type ExtensionManifest,
  type IsolationProcessPort,
  type LoaderFs,
  type TrustStoreBackend,
} from "@fresnel/contracts/extensions";
import {
  createExtensionLoader,
  type ExtensionLoader,
  type ExtHost,
  type LoaderIsolation,
  type LoadOptions,
  type LoadReport,
  type OperationsPolicy,
  type ReviewedSource,
  type StartupOptions,
} from "@fresnel/ext-host";
import { coreCapabilityVersions } from "./capability-defs.ts";
import type { ExtSettingsSource } from "./ext-settings.ts";
import { HOST_SDK_MODULES } from "../plugin-host/sdk-modules.ts";

// X.loading-trust.spec §4.2, §4.4.6. 조립 루트가 외부 확장 로더를 만들어 사용자 확장 위치(<config>/extensions)를 싣는다.
// 외부 플러그인 번들은 SDK 모듈을 외부 import로 남기므로 호스트가 같은 인스턴스를 가상 모듈로 등록한다(plugin-host/sdk-modules.ts). 조립 루트 코드(DR-14 예외 2).
// 격리(L4.host-service.spec §4.9)는 띄우기 포트(`process`)와 띄우기 설정(`isolation`)이 둘 다 있어야 켜진다.

export interface ExternalLoadingDeps {
  readonly ext: ExtHost;
  readonly operations: Pick<OperationsPolicy, "admit" | "forget" | "autoDisabler">;
  readonly fs: LoaderFs;
  /** `<config>`: 사용자 확장은 `<userDir>/extensions/<이름>/` */
  readonly userDir: string;
  readonly homeDir: string;
  readonly trustBackend: TrustStoreBackend;
  readonly clock: Pick<Clock, "now">;
  readonly logger: Logger;
  /** 로더의 설정 읽기: `ext.<name>.enabled`, 필수 사용자 설정, `ext.<name>.isolation` 명시 값, 설정 값(ext-settings.ts) */
  readonly settings: ExtSettingsSource;
  /** 격리 확장의 띄우기 포트(`fresnel.process`). 없으면 격리 확장은 명시 요청이면 `isolation_unavailable`이다 */
  readonly process?: IsolationProcessPort;
  /** 격리 띄우기 설정(명령, 시계, 진단, 재시작 한도). `process`와 함께 있어야 격리가 켜진다 */
  readonly isolation?: LoaderIsolation;
  /** 검토본 목록(M5c §4.6). 있으면 사용자·프로젝트·번들 확장은 검토본 `tree/`에서 싣는다(원본 폴더를 훑지 않는다) */
  readonly reviewedSource?: ReviewedSource;
  readonly cwd: string;
  /** `x.loading-trust.paths`에서 옮긴 절대 경로(settings-sources.ts `extensionSearchPathsOf`). 사용자 위치 뒤에 탐색한다 */
  readonly extraPaths: readonly string[];
  /** 화면 앱 정책(`x.ui.apps`, `x.ui.allowProjectApps`, settings-sources.ts `uiPolicyOf`). 빈 객체면 로더 기본을 쓴다 */
  readonly uiPolicy: NonNullable<LoadOptions["uiPolicy"]>;
  /** 서비스 모드는 "on_demand": 시작 때 프로젝트를 싣지 않고 작업 폴더를 여는 때 `loadProject`가 싣는다 */
  readonly projects?: "cwd" | "on_demand";
  /** cwd 프로젝트의 프로젝트 id(AGE-41). 시작 때 판정한 프로젝트 루트마다 부른다. 없으면 시작 때 프로젝트 검토본을 싣지 않는다 */
  readonly projectIdOf?: (projectRoot: string) => Promise<string | undefined>;
  /** 공장 기본 프로필의 기본 번들 이름(`defaultPluginNamesFor`). 시작 때 싣는 외부 확장의 기본 집합이다(X.loading-trust §4.3.1 5a 앞) */
  readonly defaultNames?: readonly string[];
  readonly signal: AbortSignal;
  readonly startup?: StartupOptions;
}

export interface ExternalLoading {
  readonly loader: ExtensionLoader;
  readonly report: LoadReport;
  /** 적재에 성공한 외부 확장의 매니페스트(그룹 서비스 카탈로그가 읽는다) */
  readonly manifests: readonly {
    readonly manifest: ExtensionManifest;
    readonly loadIndex: number;
  }[];
}

/**
 * 로더의 `loadAll` 입력. 조립이 정한 값(탐색 경로, 화면 앱 정책, 프로젝트 모드, 안전 모드)을 그대로 옮긴다.
 * 빠진 칸은 로더의 기본을 쓴다. 시험은 이 함수의 값을 본다(외부 로더는 만들어진 뒤라 안을 볼 수 없다).
 */
export function loadAllOptionsOf(
  deps: Pick<
    ExternalLoadingDeps,
    | "cwd"
    | "extraPaths"
    | "uiPolicy"
    | "projects"
    | "projectIdOf"
    | "signal"
    | "startup"
    | "defaultNames"
  >,
): LoadOptions {
  return {
    builtins: [],
    cwd: deps.cwd,
    mode: "headless",
    trustOverride: false,
    extraPaths: deps.extraPaths,
    uiPolicy: deps.uiPolicy,
    ...(deps.projects === undefined ? {} : { projects: deps.projects }),
    ...(deps.projectIdOf === undefined ? {} : { projectIdOf: deps.projectIdOf }),
    ...(deps.defaultNames === undefined ? {} : { defaultNames: deps.defaultNames }),
    signal: deps.signal,
    ...(deps.startup === undefined ? {} : { startup: deps.startup }),
  };
}

/** 사용자 위치의 외부 확장을 싣는다. 프로젝트 확장은 시작 때 cwd의 프로젝트만 판정해 싣고(서비스 모드는 싣지 않는다), 작업 폴더는 모든 모드가 여는 때 싣는다(project-extensions.ts) */
export async function loadExternalExtensions(deps: ExternalLoadingDeps): Promise<ExternalLoading> {
  const loader = createExtensionLoader({
    host: deps.ext,
    policy: deps.operations,
    fs: deps.fs,
    paths: { userDir: deps.userDir, managedDir: null, homeDir: deps.homeDir },
    trustBackend: deps.trustBackend,
    clock: deps.clock,
    sdkModules: HOST_SDK_MODULES,
    settings: deps.settings,
    // 격리는 두 값이 다 있어야 켜진다(X.loading-trust §4.3.2). 없는 쪽은 넘기지 않는다(exactOptionalPropertyTypes)
    ...(deps.process === undefined ? {} : { process: deps.process }),
    ...(deps.isolation === undefined ? {} : { isolation: deps.isolation }),
    ...(deps.reviewedSource === undefined ? {} : { reviewedSource: deps.reviewedSource }),
    coreCapabilities: coreCapabilityVersions(),
  });
  const report = await loader.loadAll(loadAllOptionsOf(deps));
  for (const diagnostic of report.diagnostics) {
    // 시작 때 미룬 확장은 정상이라(대화가 쓸 때 싣는다) 경고로 남기지 않는다
    if (diagnostic.code === "lazy_deferred") continue;
    const fields = {
      extension: diagnostic.extension ?? "",
      code: diagnostic.code,
      message: diagnostic.message,
    };
    if (diagnostic.severity === "error") deps.logger.error("ext.load_diagnostic", fields);
    else deps.logger.warn("ext.load_diagnostic", fields);
  }
  // 싣지 못한 확장(불신, 안전 모드, 실패)의 매니페스트도 읽는다: 확장 목록이 그 상태와 진단을 보인다
  const read = await Promise.all(
    report.extensions.map(async (info) => ({
      name: info.name,
      loadIndex: info.state === "active" ? info.loadIndex : null,
      manifest: await manifestOf(deps, info.root),
    })),
  );
  const discovered = read.flatMap((entry) =>
    entry.manifest === undefined
      ? []
      : [{ name: entry.name, manifest: entry.manifest, loadIndex: entry.loadIndex }],
  );
  const manifests = discovered.flatMap((entry) =>
    entry.loadIndex === null ? [] : [{ manifest: entry.manifest, loadIndex: entry.loadIndex }],
  );
  return { loader, report, manifests };
}

/** 적재한 확장의 매니페스트. 루트가 없으면(내장) 파일이 없다. 루트는 설치 위치나 검토본 `tree/`다 */
async function manifestOf(
  deps: ExternalLoadingDeps,
  root: string | undefined,
): Promise<ExtensionManifest | undefined> {
  if (root === undefined) return undefined;
  const text = await attemptAsync(() =>
    deps.fs.readText(join(root, ".fresnel-plugin", "plugin.json")),
  );
  if (!text.ok || text.value === null) return undefined;
  const checked = validateManifest(safeJson(text.value));
  return checked.manifest;
}

function safeJson(text: string): unknown {
  const parsed = parseJson(text);
  return parsed.ok ? parsed.value : undefined;
}
