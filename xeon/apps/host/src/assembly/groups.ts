import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import {
  defineManifest,
  LeaseArbiterPortKey,
  type ExtensionEntry,
} from "@xeon/contracts/extensions";
import {
  checkSettingWrite,
  type SettingCatalog,
  type SettingScope,
} from "@xeon/contracts/settings";
import {
  createGroupService,
  GroupSettingsSourceKey,
  type DriveHolderSettingsPort,
  type GroupCatalogEntry,
  type HolderWriteError,
} from "@xeon/group-kit";
import { hostOf, type ExtHost, type ExtensionUnit } from "@xeon/ext-host";
import type { SettingsStorePort } from "../types.ts";
import type { SettingsEngine } from "./settings-engine.ts";

// m2-plan HOST.6, L3.group-kit.plan §8. group-kit은 서비스 팩토리(`createGroupService`)만 내놓고 확장 단위가 없다. 이 파일이 서비스를 올려
// X의 임대 중재 포트(`xeon.groups`, LeaseArbiterPort)로 낸다. 서비스가 받는 포트 셋을 실제 구현으로 잇는다:
// - 그룹 목록(GroupCatalogPort): 설치한 단위 가운데 L3 매니페스트
// - 구동 그룹 설정(DriveHolderSettingsPort): `x.primitives.activeDriveGroup`을 설정 엔진과 설정 저장소로 읽고 쓴다
// - 그룹 설정 읽기(GroupSettingsSource, `xeon.settings`): 설정 엔진의 유효 값
// `/group` 명령은 등록하지 않는다: 명령 처리기가 출력을 돌려줄 길(F `CommandResourceDef`는 void)이 아직 없다.
// 조립 루트 코드(DR-14 예외 2).

const HOLDER_KEY = "x.primitives.activeDriveGroup";

export interface HostGroupsOptions {
  readonly ext: ExtHost;
  readonly catalog: SettingCatalog;
  readonly settings: SettingsEngine;
  /** 엔진 포트의 설정 저장소. 엔진 포트는 서비스가 모두 올라온 뒤에 만들어져 쓸 때 얻는다 */
  readonly store: () => SettingsStorePort | undefined;
  /** 서비스가 상태를 보여 줄 thread: 이 엔진이 가장 최근에 쓰기 소유를 쥔 thread */
  readonly currentThread: () => ThreadId | null;
  /** 설치된 단위 가운데 그룹(L3)의 매니페스트와 로드 순서 */
  readonly groups: () => readonly GroupCatalogEntry[];
  readonly report: (cause: unknown) => void;
  readonly loadIndex: number;
}

function locked(): HolderWriteError {
  return { kind: "locked", key: HOLDER_KEY };
}

/** 구동 그룹 설정 포트. 값 검사는 `checkSettingWrite`(settings.set과 같은 함수)가 한다. 쓰지 못하면 모두 잠금으로 알린다 */
function holderSettings(options: HostGroupsOptions): DriveHolderSettingsPort {
  return {
    read(threadId) {
      const value = options.settings.value(HOLDER_KEY, threadId ?? undefined);
      return typeof value === "string" ? value : null;
    },
    async write(holder, scope: SettingScope): Promise<Result<void, HolderWriteError>> {
      const store = options.store();
      if (store === undefined) return err(locked());
      const threadId = options.currentThread() ?? undefined;
      const checked = checkSettingWrite(
        options.catalog,
        store.layers(threadId),
        HOLDER_KEY,
        scope,
        holder,
      );
      if (!checked.ok) return err(locked());
      const written = await store.write(scope, HOLDER_KEY, holder, threadId);
      return written.ok ? ok(undefined) : err(locked());
    },
  };
}

/** 내장 확장 단위. `xeon.groups`(LeaseArbiterPort)와 `xeon.settings`(GroupSettingsSource) 포트를 낸다. 그룹보다 먼저 싣는다 */
export function hostGroupsPlugin(options: HostGroupsOptions): ExtensionUnit {
  const manifest = defineManifest({
    schemaVersion: 1,
    name: "host-groups",
    version: "0.1.0",
    displayName: "Group service",
    description:
      "Provides the group service as the lease arbiter and the group settings port (host assembly).",
    defaultEnabled: true,
    layer: "plugin",
    kind: "plugin",
    entry: "./src/index.ts",
    points: [],
    usesDrive: false,
    trust: { level: "builtin" },
  });
  const entry: ExtensionEntry = ({ manifest: loaded, scope }) => {
    scope(loaded.name, { defaultEnabled: true }, (g) => {
      const host = hostOf(g);
      const instrumentation = (): boolean =>
        options.settings.value("l3.group-kit.instrumentation") !== false;
      const service = createGroupService({
        host: options.ext,
        catalog: { groups: options.groups },
        holder: holderSettings(options),
        currentThread: options.currentThread,
        report: options.report,
        instrumentation,
      });
      host.providePort(LeaseArbiterPortKey, service);
      host.providePort(GroupSettingsSourceKey, {
        value: (key) => options.settings.value(key),
      });
    });
  };
  return { manifest, entry, loadIndex: options.loadIndex, builtin: true };
}
