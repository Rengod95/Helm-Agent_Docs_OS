import type { ThreadId } from "@fresnel/contracts/conversation";
import {
  defineManifest,
  isGroupExtension,
  type ExtensionEntry,
  type ExtensionManifest,
} from "@fresnel/contracts/extensions";
import {
  createGroupService,
  type GroupServiceDeps,
  GroupSettingsSourceKey,
  type GroupCatalogEntry,
  type GroupServiceWithUsage,
} from "@fresnel/group-sdk";
import { hostOf, type ExtHost, type ExtensionUnit } from "@fresnel/ext-host";
import type { SettingsEngine } from "./settings-engine.ts";

// m2-plan HOST.6, L3.group-sdk.plan §8. group-sdk은 서비스 팩토리(`createGroupService`)만 내놓고 확장 단위가 없다. 이 파일이 서비스를 만들어
// 서비스가 받는 포트 셋을 실제 구현으로 잇는다:
// - 그룹 목록(GroupCatalogPort): 설치한 단위 가운데 L3 매니페스트
// - 그룹 설정 읽기(GroupSettingsSource, `fresnel.settings`): 설정 엔진의 유효 값
// 서비스는 `onService`로 조립 루트에 넘긴다(확장 읽기 `group.*`와 `drive.*`가 현재 서비스를 읽는다). 중재 포트와 구동 그룹 설정은 없다(E3, drive-isolation.md 2.2).
// `/group` 명령은 등록하지 않는다: 명령 처리기가 출력을 돌려줄 길(F `CommandResourceDef`는 void)이 아직 없다.
// 조립 루트 코드(DR-14 예외 2).

export interface HostGroupsOptions {
  readonly ext: ExtHost;
  readonly settings: SettingsEngine;
  /** 서비스가 상태를 보여 줄 thread: 이 엔진이 가장 최근에 쓰기 소유를 쥔 thread */
  readonly currentThread: () => ThreadId | null;
  /** 설치된 단위 가운데 그룹(L3)의 매니페스트와 로드 순서 */
  readonly groups: () => readonly GroupCatalogEntry[];
  readonly report: (cause: unknown) => void;
  readonly loadIndex: number;
  /** `/group on`이 켠 직후 부른다(`GroupServiceDeps.onEnabled`) */
  readonly onEnabled?: (id: string) => void;
  /** 서비스가 올라올 때마다 부른다. 확장 읽기(`group.*`, `drive.*`)가 현재 서비스를 읽는다 */
  readonly onService?: (service: GroupServiceWithUsage) => void;
  /** 대화가 보는 도구 이름으로 도구 주인을 찾는다(승격 집계). 도구 이름이 대화마다 다르므로 이름만으로는 주인이 하나로 정해지지 않는다 */
  readonly toolOwnerIn?: GroupServiceDeps["toolOwnerIn"];
}

/**
 * 그룹 카탈로그에 올릴 매니페스트인가. `group` 선언이 있고 id 없는 루트 플러그인이 L3다.
 * group-sdk의 defineGroup이 그룹을 알아보는 기준(orchestrationOf)과 같다. 옛 형식의 `layer === "L3"`를 대신한다
 */
export function isGroupCatalogManifest(manifest: ExtensionManifest): boolean {
  return (
    isGroupExtension(manifest) &&
    (manifest.plugins ?? []).some((plugin) => plugin.id === undefined && plugin.layer === "L3")
  );
}

/** 내장 확장 단위. 그룹 서비스를 만들고 `fresnel.settings`(GroupSettingsSource) 포트를 낸다. 그룹보다 먼저 싣는다 */
export function hostGroupsPlugin(options: HostGroupsOptions): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 2,
    name: "host-groups",
    version: "0.1.0",
    displayName: "Group service",
    description:
      "Provides the group service as the lease arbiter and the group settings port (host assembly).",
    defaultEnabled: true,
    entry: "./src/index.ts",
    plugins: [{ layer: "plugin", hooks: [] }],
    trust: { level: "builtin" },
  });
  const entry: ExtensionEntry = ({ manifest: loaded, register }) => {
    register(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const instrumentation = (): boolean =>
        options.settings.value("l3.group-sdk.instrumentation") !== false;
      const service = createGroupService({
        host: options.ext,
        ...(options.toolOwnerIn === undefined ? {} : { toolOwnerIn: options.toolOwnerIn }),
        catalog: { groups: options.groups },
        currentThread: options.currentThread,
        report: options.report,
        instrumentation,
        ...(options.onEnabled === undefined ? {} : { onEnabled: options.onEnabled }),
      });
      options.onService?.(service);
      host.providePort(GroupSettingsSourceKey, {
        value: (key) => options.settings.value(key),
      });
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex, builtin: true };
}
