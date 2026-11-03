import { join } from "node:path";
import { attemptAsync, parseJson, type Clock, type Logger } from "@fresnel/contracts";
import {
  validateManifest,
  type ExtensionManifest,
  type LoaderFs,
  type TrustStoreBackend,
} from "@fresnel/contracts/extensions";
import {
  createExtensionLoader,
  type ExtensionLoader,
  type ExtHost,
  type LoadReport,
  type OperationsPolicy,
  type SdkModules,
  type StartupOptions,
} from "@fresnel/ext-host";
import * as groupSdk from "@fresnel/group-sdk";

// X.loading-trust.spec §4.2, §4.4.6. 조립 루트가 외부 확장 로더를 만들어 사용자 확장 위치(<config>/extensions)를 싣는다.
// 외부 플러그인 번들은 SDK 모듈을 외부 import로 남기므로 호스트가 같은 인스턴스를 가상 모듈로 등록한다. 조립 루트 코드(DR-14 예외 2).

/** X가 직접 등록하지 못하는 L3 모듈만 넘긴다. `@fresnel/contracts`(하위 경로 포함)와 `typebox`는 X가 등록한다(X.loading-trust.spec §4.4.6) */
const HOST_SDK_MODULES: SdkModules = { "@fresnel/group-sdk": groupSdk };

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
  /** `ext.<name>.enabled` 유효 값. 값이 없으면 undefined */
  readonly enabled: (name: string) => boolean | undefined;
  readonly cwd: string;
  /** 서비스 모드는 "on_demand": 시작 때 프로젝트를 싣지 않고 작업 폴더를 여는 때 `loadProject`가 싣는다 */
  readonly projects?: "cwd" | "on_demand";
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

/** 사용자 위치의 외부 확장을 싣는다. 프로젝트 확장은 cwd의 프로젝트만 판정해 싣고, 서비스 모드는 작업 폴더를 여는 때 싣는다(project-extensions.ts) */
export async function loadExternalExtensions(deps: ExternalLoadingDeps): Promise<ExternalLoading> {
  const loader = createExtensionLoader({
    host: deps.ext,
    policy: deps.operations,
    fs: deps.fs,
    paths: { userDir: deps.userDir, managedDir: null, homeDir: deps.homeDir },
    trustBackend: deps.trustBackend,
    clock: deps.clock,
    sdkModules: HOST_SDK_MODULES,
    settings: { enabled: deps.enabled, hasValue: () => false },
  });
  const report = await loader.loadAll({
    builtins: [],
    cwd: deps.cwd,
    mode: "headless",
    trustOverride: false,
    ...(deps.projects === undefined ? {} : { projects: deps.projects }),
    signal: deps.signal,
    ...(deps.startup === undefined ? {} : { startup: deps.startup }),
  });
  for (const diagnostic of report.diagnostics) {
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
      manifest: await manifestOf(deps, info.name),
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

async function manifestOf(
  deps: ExternalLoadingDeps,
  name: string,
): Promise<ExtensionManifest | undefined> {
  const text = await attemptAsync(() =>
    deps.fs.readText(join(deps.userDir, "extensions", name, ".fresnel-plugin", "plugin.json")),
  );
  if (!text.ok || text.value === null) return undefined;
  const checked = validateManifest(safeJson(text.value));
  return checked.manifest;
}

function safeJson(text: string): unknown {
  const parsed = parseJson(text);
  return parsed.ok ? parsed.value : undefined;
}
