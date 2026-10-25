import type { Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type {
  DriveHolderSetting,
  GroupSettingUnwritableReason,
  HolderReceipt,
} from "@xeon/contracts/services";

export type HolderSettingScope = HolderReceipt["scope"];

/** 쓸 수 없었던 이유. F `group.settingUnwritable`의 `reason`과 같은 집합이다 */
export type HolderUnwritableReason = GroupSettingUnwritableReason;

export type HolderWriteError =
  /** 관리 범위가 값을 잠갔다 */
  | { readonly kind: "locked"; readonly key: string }
  /** 잠기지 않았지만 쓸 수 없었다(대상 thread, 쓰기 소유, 프로젝트 파일, 값, 저장소) */
  | { readonly kind: "unwritable"; readonly key: string; readonly reason: HolderUnwritableReason };

/**
 * 설정 `x.primitives.activeDriveGroup`의 읽기와 쓰기(L3.group-kit.spec §3.8, §3.13 마지막 문단).
 * 설정 서비스(F.wire-settings `EffectiveSetting`, `WriteCheck`)에 연결하는 일은 HOST 조립이 한다.
 * 그 전까지 시험은 `memoryDriveHolderSettings`(`@xeon/group-kit/testing`)를 쓴다.
 */
export interface DriveHolderSettingsPort {
  /** thread 범위 유효 값. thread가 없으면 전역 값 */
  read(threadId: ThreadId | null): DriveHolderSetting;
  /**
   * `threadId`는 요청이 가리킨 thread다(`setDriveHolder`의 `options.threadId`, 가리키지 않았으면 null).
   * `session`·`project`·`local` 범위는 쓸 thread가 필요하다. 구현은 가리킨 thread가 없을 때 쓰기 소유를 쥔 thread가 하나일 때만 그 thread에 쓰고,
   * 정할 수 없으면 `unwritable`(`no_thread`·`ambiguous_thread`)로 알린다. "마지막으로 쥔 thread"를 고르지 않는다
   */
  write(
    holder: DriveHolderSetting,
    scope: HolderSettingScope,
    threadId: ThreadId | null,
  ): Promise<Result<void, HolderWriteError>>;
}
