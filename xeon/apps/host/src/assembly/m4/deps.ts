import type { ScheduleService } from "@fresnel/cap-schedule";
import type { Clock, Result } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TestRunControlPort, TraceReadPort } from "@fresnel/contracts/extensions";
import type { ReadFailure } from "@fresnel/contracts/records";
import type { ScopeStack, SettingCatalog, SettingScope } from "@fresnel/contracts/settings";
import type { RegistrationInfo, RegistrationToggleSourceOf } from "@fresnel/ext-host";
import type { FileLock } from "@fresnel/platform-os";
import type { HostErrorMappers, ProfileWriteFailure } from "../../handlers/m4/profile-test-run.ts";
import type { DialogAreaHolder } from "./dialog-area-bridge.ts";
import type { ExtUiVersionSource } from "./ext-ui-version-source.ts";

// M4 포트 구현이 받는 의존. 계측 읽기와 Test run 제어는 계약의 포트 타입이라 소유 트랙이 ext-host를 기다리지 않는다.
// T-F 시점에는 빈 구현을 넘기고, T-XD의 마지막 커밋이 `index.ts`에서 ext-host 구현으로 바꾼다(`spec-deltas/t-f.md` §5 4번).

/** 엔진 포트에서 오는 의존. `createEnginePorts`가 넘긴다. 소유 트랙마다 필요한 만큼만 더한다 */
export interface M4EngineDeps {
  /** T-WC: 예약 서비스(`schedule.update`, `schedule.runs`) */
  readonly schedule: Pick<ScheduleService, "open" | "list" | "runs" | "update">;
  /** T-WC: thread 존재 확인(`goal.status`, `work.tasks.list`) */
  readonly threads: {
    exists(threadId: ThreadId): Result<boolean, ReadFailure>;
  };
  /** T-WC: 목표·작업 기능 API 자리(조립 확장이 채운다) */
  readonly dialogArea: DialogAreaHolder;
}

/** 프로필 적용이 쓰는 설정 저장소의 부분형(`types.ts`의 `SettingsStorePort`가 그대로 대입된다. 순환을 피하려고 거기서 가져오지 않는다) */
interface ProfileSettingsPort {
  layers(threadId: ThreadId | undefined): ScopeStack;
  prepare(threadId: ThreadId): Promise<void>;
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
  /** 확장(Registration)의 켜짐 요청 통로. thread 층 프로필 적용이 쓴다 */
  readonly toggles: RegistrationToggleSourceOf;
  readonly registrations: () => readonly RegistrationInfo[];
  /** 사용자 설정 폴더(L0.os의 `dirs.config`). `profiles.json`이 여기에 놓인다 */
  readonly configDir: string;
  /** 프로세스 사이 파일 잠금(`OsServiceHandle.fileLock`) */
  readonly fileLock: FileLock;
  readonly clock: Clock;
  readonly signal: AbortSignal;
}

export interface M4PortDeps extends M4EngineDeps {
  readonly traceRead: TraceReadPort;
  readonly testRunControl: TestRunControlPort;
  readonly env: M4HostEnv;
  /** 확장 버전과 화면 목록의 원천(T-XV, HS-108). 조립 루트가 넘긴다. 없으면 확장이 없는 것으로 본다 */
  readonly extUi?: ExtUiVersionSource | undefined;
}
