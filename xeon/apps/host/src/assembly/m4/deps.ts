import type { ScheduleService } from "@fresnel/cap-schedule";
import type { Clock, Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TestRunControlPort, TraceReadPort } from "@fresnel/contracts/extensions";
import type { ReadFailure } from "@fresnel/contracts/records";
import type { ScopeStack, SettingCatalog, SettingScope } from "@fresnel/contracts/settings";
import type { RegistrationInfo, RegistrationToggleSourceOf } from "@fresnel/ext-host";
import type { FileLock } from "@fresnel/platform-os";
import type { HostErrorMappers, ProfileWriteFailure } from "../../handlers/m4/profile-test-run.ts";
import type { TestRunMarks } from "../measure/test-run-marks.ts";
import type { DialogAreaHolder } from "./dialog-area-bridge.ts";
import type { ExtUiVersionSource } from "./ext-ui-version-source.ts";

// M4 포트 구현이 받는 의존. 계측 읽기와 Test run 제어는 계약의 포트 타입이라 소유 트랙이 ext-host를 기다리지 않는다.
// T-F 시점에는 빈 구현을 넘기고, T-XD의 마지막 커밋이 `index.ts`에서 ext-host 구현으로 바꾼다(`spec-deltas/t-f.md` §5 4번).

/** 엔진 포트에서 오는 의존. `createEnginePorts`가 넘긴다. 소유 트랙마다 필요한 만큼만 더한다 */
export interface M4EngineDeps {
  /** T-WC: 예약 서비스(`schedule.update`, `schedule.runs`) */
  readonly schedule: Pick<ScheduleService, "open" | "list" | "runs" | "update">;
  /** T-WC: thread 존재 확인(`goal.status`, `work.tasks.list`). `ext.test.run`의 testRun이 Test run 대화를 만들고 지우는 데도 쓴다 */
  readonly threads: {
    exists(threadId: ThreadId): Result<boolean, ReadFailure>;
    create(input: {
      readonly workspace?: string;
      readonly title?: string;
      readonly testRun?: boolean;
    }): Promise<{ readonly threadId: ThreadId }>;
    remove(threadId: ThreadId): Promise<Result<void, { readonly kind: string }>>;
  };
  /** T-WC: 목표·작업 기능 API 자리(조립 확장이 채운다) */
  readonly dialogArea: DialogAreaHolder;
  /** 호스트 로그. Test run 대화를 지우지 못했을 때 남긴다. 구조 타입이다(`types.ts`의 `HostLogPort`가 대입된다) */
  readonly log: { error(message: string, fields: Readonly<Record<string, unknown>>): void };
}

/** 설정 저장소의 부분형(`types.ts`의 `SettingsStorePort`가 그대로 대입된다. 순환을 피하려고 거기서 가져오지 않는다). 확장 읽기가 쓰기 경로로 쓴다 */
interface ProfileSettingsPort {
  layers(threadId: ThreadId | undefined): ScopeStack;
  write(
    scope: SettingScope,
    key: string,
    value: unknown,
    threadId: ThreadId | undefined,
  ): Promise<Result<void, ProfileWriteFailure>>;
  reset(
    scope: SettingScope,
    key: string,
    threadId: ThreadId | undefined,
  ): Promise<Result<void, ProfileWriteFailure>>;
}

/** 호스트 조립이 넘기는 설정, thread, 확장 조회와 파일 위치. 프로필 적용(T-WB)이 쓴다 */
export interface M4HostEnv {
  readonly catalog: SettingCatalog;
  readonly settings: ProfileSettingsPort;
  readonly errors: HostErrorMappers;
  /** 카탈로그 키의 유효 값. 모르는 키는 undefined */
  readonly settingValue: (key: string, threadId?: ThreadId) => unknown;
  readonly threadExists: (threadId: ThreadId) => Result<boolean, ReadFailure>;
  /** 확장(Registration)의 켜짐 요청과 적용 예약 통로. 대화별 켜짐 집합(E(T))의 적용이 쓴다 */
  readonly toggles: RegistrationToggleSourceOf;
  readonly registrations: () => readonly RegistrationInfo[];
  /** 사용자 설정 폴더(L0.os의 `dirs.config`). `profiles.json`이 여기에 놓인다 */
  readonly configDir: string;
  /** 호스트 상태 폴더(`OsDirs.state`). 옮김 기록 `migration.log`가 여기에 놓인다 */
  readonly stateDir: string;
  /** 시크릿 이름 목록. 읽지 못하면 null이고, 그때 검증은 `secret_missing` 경고를 내지 않는다 */
  readonly secretNames: () => Promise<ReadonlySet<string> | null>;
  /** 검토 대기 항목의 플러그인 이름(검토본이 없는 것 포함). 프로필 검증이 `plugin_not_reviewed`를 낼 때 쓴다(M5c §4.2.7) */
  readonly pendingPluginNames: () => Promise<readonly string[]>;
  /** 지금 실행 중인 검토본의 내용 해시(없으면 undefined). 대화별 E(T)의 `pluginHashes`가 쓴다(M5c §4.6.7) */
  readonly loadedHash: (name: string) => string | undefined;
  /**
   * 닫히지 않은 대화마다 저장한 프로필 id(없으면 null = 기본). 프로필을 참조하는 열린 대화를 셀 때 쓴다(M5c §4.1.14)
   */
  readonly openThreadProfiles: () => readonly (string | null)[];
  /** 닫히지 않은 대화 id. 프로필이 바뀌었을 때 대화별 켜짐 집합을 다시 맞춘다 */
  readonly openThreadIds: () => readonly ThreadId[];
  /** 대화가 저장한 프로필 id(없거나 대화가 없으면 null). 대화별 켜짐 집합(E(T))이 읽는다 */
  readonly threadProfileId: (threadId: ThreadId) => string | null;
  /** 모든 대화에 항상 켜는 플러그인(개발 모드의 가이드 그룹) */
  readonly forcedPlugins: () => readonly string[];
  /** 공장 기본 프로필의 플러그인(코어가 아닌 내장 가운데 기본 켜짐과 번들) */
  readonly defaultPlugins: () => readonly string[];
  /** 프로세스 사이 파일 잠금(`OsServiceHandle.fileLock`) */
  readonly fileLock: FileLock;
  readonly clock: Clock;
  readonly signal: AbortSignal;
  /** Test run 표지의 내구 사본(`tr_thread`). 없으면 메모리 표지만 쓴다. 조립 루트가 넘긴다 */
  readonly testRunMarks?: TestRunMarks;
}

export interface M4PortDeps extends M4EngineDeps {
  readonly traceRead: TraceReadPort;
  readonly testRunControl: TestRunControlPort;
  readonly env: M4HostEnv;
  /** 확장 버전과 화면 목록의 원천(T-XV, HS-108). 조립 루트가 넘긴다. 없으면 확장이 없는 것으로 본다 */
  readonly extUi?: ExtUiVersionSource | undefined;
}
