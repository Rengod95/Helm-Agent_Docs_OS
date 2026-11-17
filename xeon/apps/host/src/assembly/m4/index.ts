import { detach } from "@fresnel/contracts";
import {
  effectiveLayer,
  PluginSetPortKey,
  PluginSubmitPortKey,
} from "@fresnel/contracts/extensions";
import { resolveSetting } from "@fresnel/contracts/settings";
import { testRunControlOf, traceReadOf, type ExtHost } from "@fresnel/ext-host";
import type { DevkitPort } from "../../handlers/m4/devkit.ts";
import type { DialogAreaPort } from "../../handlers/m4/dialog-area.ts";
import type { ExtMethodPort } from "../../handlers/m4/ext-method.ts";
import type { ExtReadPort } from "../../handlers/m4/ext-read.ts";
import type { ExtUiVersionPort } from "../../handlers/m4/ext-ui-version.ts";
import type { ProfileTestRunPort } from "../../handlers/m4/profile-test-run.ts";
import type { ProjectPort } from "../../handlers/m4/project.ts";
import type { SandboxSelfTestPort } from "../../handlers/m4/sandbox-self-test.ts";
import type { M4EngineDeps, M4HostEnv, M4PortDeps } from "./deps.ts";
import type { ExtUiVersionSource } from "./ext-ui-version-source.ts";
import { createDevkitPort } from "./devkit-port.ts";
import { createDialogAreaPort } from "./dialog-area-port.ts";
import { createExtReadPort, type ExtensionRecord, type ExtReadSources } from "./ext-read-port.ts";
import { withEnabledSources } from "./enabled-source.ts";
import { createExtUiVersionPort } from "./ext-ui-version-port.ts";
import { REQUIRED_BY_CORE } from "./profile-defaults.ts";
import { createPluginSet, type PluginSetHandle } from "./plugin-set.ts";
import { pluginFactOf } from "./plugin-fact.ts";
import { createProfileTestRunPort } from "./profile-test-run-port.ts";
import { readTextFile } from "./profile-cost.ts";
import { createSandboxSelfTestPort } from "./sandbox-self-test-port.ts";

// M4 wire 처리기 43개의 포트 묶음(`spec-deltas/t-f.md` §5). 이 파일은 T-F가 한 번 쓰고, 그 뒤에는 T-XD가
// 계측 읽기와 Test run 제어(`emptyTraceRead`, `emptyTestRunControl`)를 ext-host 구현으로 바꾸는 한 줄만 고친다.

/** 코어인가: 등급이 guard·core이거나 내장 L1 단위(`core-*`)다. 내장 단위는 로더의 승인 표를 거치지 않아 등급이 늘 builtin이라 층으로 가린다 */
function isCore(record: ExtensionRecord): boolean {
  return (
    record.tier === "guard" ||
    record.tier === "core" ||
    (record.origin === "builtin" && effectiveLayer(record.manifest) === "L1")
  );
}

/** 코어 확장의 이름: 등급이 guard·core이거나 내장 L1 단위이거나 코어 필수 단위다(§4.1.3, §4.1.17). 프로필과 무관하게 켜진다 */
export function coreNamesOf(records: readonly ExtensionRecord[]): readonly string[] {
  return records
    .filter((record) => isCore(record) || REQUIRED_BY_CORE.has(record.manifest.name))
    .map((record) => record.manifest.name);
}

/** 코어가 아닌 확장 가운데 매니페스트 기본이 켜진 것의 이름(§4.1.2). 공장 기본 프로필의 플러그인 가운데 이 부분이다 */
function defaultNamesOf(records: readonly ExtensionRecord[]): readonly string[] {
  return records
    .filter((record) => !isCore(record) && record.manifest.defaultEnabled !== false)
    .map((record) => record.manifest.name);
}

/** 공장 기본 프로필의 플러그인 이름: 기본 번들 `base`와 `defaultNamesOf`의 합집합(중복 없음). 옮김과 기본 프로필이 같은 목록을 쓴다 */
export function factoryPluginsOf(
  base: readonly string[],
  records: readonly ExtensionRecord[],
): readonly string[] {
  return [...new Set([...base, ...defaultNamesOf(records)])];
}

export interface M4Ports {
  readonly extRead: ExtReadPort;
  readonly extUi: ExtUiVersionPort;
  /** 확장 메서드 `ext.<확장>.<동사>`의 호출(X-2, X-3). 닫힌 처리기 표 밖이라 연결 층이 바로 쓴다 */
  readonly extMethod: ExtMethodPort;
  readonly profileTestRun: ProfileTestRunPort;
  /** 프로젝트 wire(`project.*`). 포트는 조립 루트가 만들어 `M4EngineDeps.projects`로 넘긴다 */
  readonly project: ProjectPort;
  /** 대화별 켜짐 집합(E(T)). X가 `PluginSetPortKey`로 읽고, 처리기가 프로필 전환 뒤 다시 맞춘다 */
  readonly pluginSet: PluginSetHandle;
  readonly dialogArea: DialogAreaPort;
  readonly devkit: DevkitPort;
  /** 샌드박스 자가 시험 읽기와 실행(`sandbox.lastSelfTest`, `sandbox.selfTest`) */
  readonly sandboxSelfTest: SandboxSelfTestPort;
}

/**
 * 계측 읽기와 Test run 제어는 ext-host 구현(`traceReadOf`, `testRunControlOf`)이다(T-XD).
 * 소유 트랙은 이 함수를 고치지 않는다.
 */
export function createM4Ports(
  host: ExtHost,
  engine: M4EngineDeps,
  env: M4HostEnv,
  extReadSources: ExtReadSources,
  extUi?: ExtUiVersionSource,
): M4Ports {
  const deps: M4PortDeps = {
    ...engine,
    traceRead: traceReadOf(host),
    testRunControl: testRunControlOf(host),
    env,
    extUi,
  };
  // 프로필·Test run 포트는 표지 장부를 쥐므로 제작 포트와 한 인스턴스를 나눠 쓴다(`ext.test.run`의 testRun이 표지를 단다)
  // 코어는 모든 대화에 항상 켜진다(빠지면 `core-tasks`의 `fresnel.tasks`가 없어 `turn.start`가 응답하지 않는다).
  // 공장 기본 프로필은 코어가 아닌 확장 가운데 매니페스트 기본이 켜진 것이다(§4.1.2, §7.2)
  const scopedEnv: M4HostEnv = {
    ...env,
    forcedPlugins: () => [...coreNamesOf(extReadSources.extensions()), ...env.forcedPlugins()],
    defaultPlugins: () => [...factoryPluginsOf(env.defaultPlugins(), extReadSources.extensions())],
  };
  const profileTestRun = createProfileTestRunPort({
    ...deps,
    env: scopedEnv,
    pluginFacts: () =>
      extReadSources.extensions().map((record) => pluginFactOf(record.manifest, record.location)),
    pendingNames: () => env.pendingPluginNames(),
    readText: readTextFile,
  });
  const pluginSet = createPluginSet({
    profiles: profileTestRun,
    threadProfileId: env.threadProfileId,
    loadedHash: env.loadedHash,
    forcedPlugins: scopedEnv.forcedPlugins,
    defaultPlugins: scopedEnv.defaultPlugins,
    openThreadIds: env.openThreadIds,
    managedOff: (name) => managedOffOf(env, name),
    stopped: env.stopped,
    registrations: env.registrations,
    toggles: env.toggles,
    settingsChanged: env.settingsChanged,
    report: (message, fields) => {
      engine.log.error(message, fields);
    },
  });
  // 확장 목록의 `enabledSource`와 정지 풀기 뒤의 다시 맞춤은 E(T)가 낸다(M5c §3.4, §4.1.12)
  const sources = withEnabledSources(extReadSources, pluginSet, env.registrations);
  // X가 `fresnel.pluginSet` 포트로 읽는다. 플랫폼 모듈로 내놓아 확장 설치와 같은 등록 경로를 쓴다
  detach(
    host
      .registerPlatform({
        name: "fresnel.plugin-set",
        setup(ctx) {
          ctx.providePort(PluginSetPortKey, pluginSet.port);
        },
      })
      .then((registered) => {
        if (!registered.ok) engine.log.error("plugin_set.register_failed", {});
        return registered.ok;
      }),
    (cause) => {
      engine.log.error("plugin_set.register_failed", {
        reason: cause instanceof Error ? cause.message : String(cause),
      });
    },
  );
  detach(pluginSet.refresh(), (cause) => {
    engine.log.error("plugin_set.initial_refresh_failed", {
      reason: cause instanceof Error ? cause.message : String(cause),
    });
  });
  return {
    pluginSet,
    extRead: createExtReadPort(
      { ...deps, defaultPlugins: () => pluginSet.defaultView().plugins },
      sources,
    ),
    extUi: createExtUiVersionPort(deps),
    extMethod: {
      async call(request) {
        return await host.methods.call({
          extension: request.extension,
          verb: request.verb,
          params: request.params,
          threadId: request.threadId,
          signal: request.signal,
          caller: "wire",
        });
      },
    },
    profileTestRun,
    project: engine.projects,
    dialogArea: createDialogAreaPort(deps),
    // 제출 포트는 플랫폼 모듈(`fresnel.plugin-submit`)이 올라온 뒤에 찾는다(M5c §3.5). 호출 때 읽는다
    devkit: createDevkitPort(deps, {
      profiles: profileTestRun,
      submit: () => host.ports.get(PluginSubmitPortKey),
    }),
    sandboxSelfTest: createSandboxSelfTestPort(host),
  };
}

/**
 * 관리 범위가 `ext.<이름>.enabled`를 거짓으로 잠갔는가(M5c §4.1.10). 키는 관리 범위만 허용되므로 값의 출처가 관리일 때만 잠금이다.
 * 기본값(매니페스트 기본이 꺼짐이면 거짓)은 잠금이 아니라 프로필이 정한다.
 */
function managedOffOf(env: M4HostEnv, name: string): boolean {
  const def = env.catalog.get(`ext.${name}.enabled`);
  if (def === undefined) return false;
  const { setting } = resolveSetting(def, env.settings.layers(undefined));
  return setting.source.scope === "managed" && setting.value === false;
}

/** 매니페스트에서 프로필 검증이 쓰는 사실을 뽑는다. 대체 도구, Drive 등록 가능, 필수 설정 키 */
