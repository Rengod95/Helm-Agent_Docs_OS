import type { StoreCapabilities } from "@xeon/contracts/records";
import { openStore } from "../../src/index.ts";
import { DEFAULT_STORE_SETTINGS } from "../../src/settings.ts";
import { fixedIdFactory } from "../support/clock.ts";

/** 자식이 표준 출력에 한 줄 JSON으로 남기는 값: 열린 저장소의 능력 */
export type DarwinCustomReport = StoreCapabilities;

// 인자: <db 경로> <커스텀 SQLite 경로>. macOS 정책으로 열면 setCustomSQLite가 첫 Database 전에 불리고 경로가 기록된다
const [dbPath, custom] = process.argv.slice(2);
if (dbPath === undefined || custom === undefined) process.exit(2);
const clock = { now: () => Date.now() };
const opened = await openStore({
  dbPath,
  env: {
    platform: "darwin",
    wsl: false,
    dbDirFsKind: "local",
    bundledSqlitePath: null,
    machineId: "test-machine",
    processStartedAt: () => null,
  },
  clock,
  scheduler: { setTimeout: () => 0, clearTimeout: () => {} },
  ids: fixedIdFactory(clock, "darwin"),
  settings: { ...DEFAULT_STORE_SETTINGS, customSqlitePath: custom },
  engineVersion: "0.0.0-child",
});
if (!opened.ok) {
  process.stdout.write(`OPEN_FAILED ${opened.error.kind}\n`);
  process.exit(3);
}
process.stdout.write(`${JSON.stringify(opened.value.service.capabilities)}\n`);
await opened.value.close();
