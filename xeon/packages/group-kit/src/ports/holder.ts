import type { Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DriveHolderSetting, HolderReceipt } from "@xeon/contracts/services";

export type HolderSettingScope = HolderReceipt["scope"];

/** 관리 범위가 값을 잠갔다 */
export interface HolderWriteError {
  readonly kind: "locked";
  readonly key: string;
}

/**
 * 설정 `x.primitives.activeDriveGroup`의 읽기와 쓰기(L3.group-kit.spec §3.8, §3.13 마지막 문단).
 * 설정 서비스(F.wire-settings `EffectiveSetting`, `WriteCheck`)에 연결하는 일은 HOST 조립이 한다.
 * 그 전까지 시험은 `memoryDriveHolderSettings`(`@xeon/group-kit/testing`)를 쓴다.
 */
export interface DriveHolderSettingsPort {
  /** thread 범위 유효 값. thread가 없으면 전역 값 */
  read(threadId: ThreadId | null): DriveHolderSetting;
  write(
    holder: DriveHolderSetting,
    scope: HolderSettingScope,
  ): Promise<Result<void, HolderWriteError>>;
}
