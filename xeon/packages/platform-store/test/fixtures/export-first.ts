import { Bug } from "@fresnel/contracts";
import { exportDatabase, openStore } from "../../src/index.ts";
import { DEFAULT_STORE_SETTINGS } from "../../src/settings.ts";
import { manualClock } from "../support/clock.ts";
import { directOptions } from "../support/store.ts";

/** 자식이 표준 출력에 한 줄 JSON으로 남기는 값: 내보내기 결과와 커스텀 dylib 열기의 결과 */
export interface ExportFirstReport {
  readonly exported: "ok" | "failed";
  readonly opened: "store.sqlite_already_loaded" | "opened" | "other";
}

// 인자: <db 경로> <대상 폴더>. 내보내기를 열기보다 먼저 부른다(L0.store.spec §4.10). 그 뒤 커스텀 dylib 경로로 열면 Bug다
const [dbPath = "", destDir = ""] = process.argv.slice(2);
const exported = exportDatabase({ dbPath, destDir, clock: manualClock() });
const { options } = directOptions(dbPath, {
  settings: { ...DEFAULT_STORE_SETTINGS, customSqlitePath: "/nonexistent/libsqlite3.dylib" },
});

let opened: ExportFirstReport["opened"];
try {
  // macOS 정책으로 연다. 커스텀 dylib 지정은 macOS에서만 쓰인다
  const result = await openStore({ ...options, env: { ...options.env, platform: "darwin" } });
  opened = result.ok ? "opened" : "other";
  if (result.ok) await result.value.close();
} catch (caught) {
  const isLoadedBug =
    caught instanceof Bug && caught.message.startsWith("store.sqlite_already_loaded");
  opened = isLoadedBug ? "store.sqlite_already_loaded" : "other";
}

const report: ExportFirstReport = { exported: exported.ok ? "ok" : "failed", opened };
process.stdout.write(`${JSON.stringify(report)}\n`);
