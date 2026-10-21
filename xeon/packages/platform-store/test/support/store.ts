import { toStorePlatform } from "../../src/select.ts";
import { DEFAULT_STORE_SETTINGS } from "../../src/settings.ts";
import type { OpenStoreOptions, StoreEnvironment } from "../../src/types.ts";
import { fixedIdFactory, manualClock, type ManualClock } from "./clock.ts";

export function currentPlatform(): StoreEnvironment["platform"] {
  const platform = toStorePlatform(process.platform);
  if (platform === undefined) throw new Error("unsupported test platform");
  return platform;
}

function testEnvironment(override: Partial<StoreEnvironment> = {}): StoreEnvironment {
  return {
    platform: currentPlatform(),
    wsl: false,
    dbDirFsKind: "local",
    bundledSqlitePath: null,
    machineId: "test-machine",
    processStartedAt: (): number | null => null,
    ...override,
  };
}

export interface DirectOpen {
  readonly options: OpenStoreOptions;
  readonly clock: ManualClock;
}

/** openStore를 직접 부르는 테스트용 옵션. openTestStore가 숨기는 값을 바꿔 볼 때 쓴다 */
export function directOptions(
  dbPath: string,
  override: Partial<OpenStoreOptions> = {},
  clock: ManualClock = manualClock(),
): DirectOpen {
  return {
    clock,
    options: {
      dbPath,
      env: testEnvironment(),
      clock,
      scheduler: clock,
      ids: fixedIdFactory(clock, "direct"),
      settings: DEFAULT_STORE_SETTINGS,
      engineVersion: "0.0.0-test",
      ...override,
    },
  };
}
