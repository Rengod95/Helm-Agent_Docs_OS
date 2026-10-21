import { Bug } from "@xeon/contracts";
import { initSqlite, newDatabase } from "../../src/sqlite-env.ts";

/** 자식이 표준 출력에 남기는 보고 */
export interface OrderViolationReport {
  readonly exitCode: 1;
  readonly messageContains: "store.sqlite_already_loaded";
}

// 첫 Database를 만든 뒤 다른 경로로 SQLite를 지정하면 Bug(store.sqlite_already_loaded)다
newDatabase(":memory:").close();
try {
  initSqlite("/nonexistent/libsqlite3.dylib");
  process.stdout.write("NO_ERROR\n");
} catch (caught) {
  process.stdout.write(`${caught instanceof Bug ? caught.message : "OTHER_ERROR"}\n`);
  process.exit(1);
}
