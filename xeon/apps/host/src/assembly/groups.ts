import { assertNever, Bug, err, ok, type Result } from "@xeon/contracts";
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
  type HolderUnwritableReason,
  type HolderWriteError,
} from "@xeon/group-kit";
import { hostOf, type ExtHost, type ExtensionUnit } from "@xeon/ext-host";
import { keyReusedBug } from "../store-error.ts";
import type { SettingsStorePort, SettingsWriteFailure } from "../types.ts";
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
  /** 서비스가 상태를 보여 줄 thread: 이 엔진이 가장 최근에 쓰기 소유를 쥔 thread. 설정 쓰기의 대상을 정하는 데는 쓰지 않는다 */
  readonly currentThread: () => ThreadId | null;
  /** 이 엔진이 지금 쓰기 소유를 쥔 thread 전부. 요청이 thread를 가리키지 않은 session·project·local 쓰기가 대상을 정하는 데 쓴다 */
  readonly heldThreads: () => readonly ThreadId[];
  /** 설치된 단위 가운데 그룹(L3)의 매니페스트와 로드 순서 */
  readonly groups: () => readonly GroupCatalogEntry[];
  readonly report: (cause: unknown) => void;
  readonly loadIndex: number;
}

function locked(): HolderWriteError {
  return { kind: "locked", key: HOLDER_KEY };
}

function unwritable(reason: HolderUnwritableReason): HolderWriteError {
  return { kind: "unwritable", key: HOLDER_KEY, reason };
}

/** 이 범위의 쓰기가 thread를 필요로 하는가(settings.set과 같다: session은 thread, project·local은 thread의 작업 폴더) */
function needsThread(scope: SettingScope): boolean {
  return scope === "session" || scope === "project" || scope === "local";
}

/** 설정 쓰기 실패를 구동 그룹 쓰기 오류로 옮긴다. 관리 범위가 잠근 것만 `locked`이고 나머지는 이유를 가려서 알린다. `key_reused`는 호출 결함이라 던진다 */
function holderFailureOf(failure: SettingsWriteFailure): HolderWriteError {
  switch (failure.kind) {
    case "managed_read_only":
      return locked();
    case "thread_required":
    case "thread_not_found":
      return unwritable("no_thread");
    case "not_owner":
      return unwritable("not_owner");
    case "workspace_required":
    case "untrusted_project":
      return unwritable("project_unavailable");
    case "file_invalid":
    case "file_unwritable":
    case "busy":
    case "disk_full":
    case "io":
    case "ownership_lost":
    case "read_only":
    case "row_invalid":
      return unwritable("storage");
    case "key_reused":
      // 호스트는 쓰기마다 새 요청 키를 만든다. 같은 키가 다른 내용으로 오는 것은 호출 결함이다(settings.set과 같은 판정)
      throw keyReusedBug(failure, "groups.holder.write");
    default:
      return assertNever(failure, "SettingsWriteFailure");
  }
}

/**
 * 쓸 thread를 정한다. 요청이 가리킨 thread가 있으면 그 thread이고, 없으면 이 엔진이 쓰기 소유를 쥔 thread가 하나일 때만 그 thread다.
 * 없으면 `no_thread`, 여럿이면 `ambiguous_thread`다: 마지막에 쥔 thread에 조용히 쓰지 않는다
 */
function targetThread(
  options: HostGroupsOptions,
  requested: ThreadId | null,
): Result<ThreadId, HolderWriteError> {
  if (requested !== null) return ok(requested);
  const held = options.heldThreads();
  const only = held[0];
  if (only === undefined) return err(unwritable("no_thread"));
  if (held.length > 1) return err(unwritable("ambiguous_thread"));
  return ok(only);
}

/** 구동 그룹 설정 포트(시험이 직접 부른다). 값 검사는 `checkSettingWrite`(settings.set과 같은 함수)가 한다 */
export function holderSettings(options: HostGroupsOptions): DriveHolderSettingsPort {
  return {
    read(threadId) {
      const value = options.settings.value(HOLDER_KEY, threadId ?? undefined);
      return typeof value === "string" ? value : null;
    },
    async write(holder, scope, requested): Promise<Result<void, HolderWriteError>> {
      const store = options.store();
      if (store === undefined) return err(unwritable("storage"));
      let threadId: ThreadId | undefined;
      if (needsThread(scope)) {
        const target = targetThread(options, requested);
        if (!target.ok) return target;
        threadId = target.value;
      }
      const checked = checkSettingWrite(
        options.catalog,
        store.layers(threadId),
        HOLDER_KEY,
        scope,
        holder,
      );
      if (!checked.ok) {
        switch (checked.kind) {
          case "settings.locked":
            return err(locked());
          case "settings.scopeNotAllowed":
            // 관리 범위에 쓰려는 요청만 관리 범위 잠금(`locked`)이다. 다른 범위가 이 키에 허용되지 않은 것은 요청 오류다
            return err(scope === "managed" ? locked() : unwritable("invalid_value"));
          case "settings.unknownKey":
            // 구동 그룹 키는 X 층 카탈로그가 정의한다. 없으면 조립이 잘못된 것이다
            throw new Bug(`groups: ${HOLDER_KEY} is missing from the setting catalog`);
          case "settings.invalidValue":
          case "settings.secretValue":
          case "settings.reserved":
            return err(unwritable("invalid_value"));
          default:
            return assertNever(checked.kind, "WriteCheckKind");
        }
      }
      const written = await store.write(scope, HOLDER_KEY, holder, threadId);
      return written.ok ? ok(undefined) : err(holderFailureOf(written.error));
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
