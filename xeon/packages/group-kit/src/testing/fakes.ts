import { err, ok, type Result } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import type { DriveHolderSetting } from "@xeon/contracts/services";
import type { GroupModule } from "../types.ts";
import type { GroupCatalogPort } from "../ports/catalog.ts";
import type {
  DriveHolderSettingsPort,
  HolderSettingScope,
  HolderWriteError,
} from "../ports/holder.ts";

/** 인메모리 구동 그룹 설정. 실제 설정 서비스를 연결하기 전 시험과 조립 시험이 쓴다 */
export interface MemoryDriveHolderSettings extends DriveHolderSettingsPort {
  /** 쓰기가 거부된 범위와 받아들인 쓰기 기록 */
  readonly writes: readonly {
    readonly holder: DriveHolderSetting;
    readonly scope: HolderSettingScope;
  }[];
  set(holder: DriveHolderSetting): void;
}

export interface MemoryDriveHolderSettingsOptions {
  readonly initial?: DriveHolderSetting;
  /** 관리 범위가 잠근 것처럼 쓰기를 거부한다 */
  readonly locked?: boolean;
}

export function memoryDriveHolderSettings(
  options: MemoryDriveHolderSettingsOptions = {},
): MemoryDriveHolderSettings {
  let current: DriveHolderSetting = options.initial ?? null;
  const writes: { holder: DriveHolderSetting; scope: HolderSettingScope }[] = [];
  return {
    writes,
    read: (_threadId: ThreadId | null) => current,
    write(holder, scope): Promise<Result<void, HolderWriteError>> {
      if (options.locked === true) {
        return Promise.resolve(err({ kind: "locked", key: "x.primitives.activeDriveGroup" }));
      }
      current = holder;
      writes.push({ holder, scope });
      return Promise.resolve(ok(undefined));
    },
    set(holder) {
      current = holder;
    },
  };
}

/** 그룹 모듈 목록으로 만든 카탈로그. 로드 순서는 배열 순서다 */
export function groupCatalogOf(modules: readonly GroupModule[]): GroupCatalogPort {
  return {
    groups: () => modules.map((module, loadIndex) => ({ manifest: module.manifest, loadIndex })),
  };
}
