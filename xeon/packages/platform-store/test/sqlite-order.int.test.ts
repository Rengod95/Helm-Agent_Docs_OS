import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { openStore } from "../src/index.ts";
import type { ExportFirstReport } from "./fixtures/export-first.ts";
import type { OrderViolationReport } from "./fixtures/order-violation.ts";
import { directOptions } from "./support/store.ts";
import { own, releaseOwned } from "./support/own.ts";
import { tempDir } from "./support/tmp.ts";
import { runScript } from "./support/spawn.ts";

afterEach(releaseOwned);

test("setCustomSQLite after first Database is a bug", async () => {
  const result = await runScript(join(import.meta.dir, "fixtures", "order-violation.ts"));
  const expected: OrderViolationReport = {
    exitCode: 1,
    messageContains: "store.sqlite_already_loaded",
  };
  expect(result.code).toBe(expected.exitCode);
  expect(result.stdout).toContain(expected.messageContains);
});

test("exporting before openStore makes a later custom dylib open a bug (S-13)", async () => {
  const dir = own(tempDir());
  const dbPath = dir.join("fresnel.db");
  const created = await openStore(directOptions(dbPath).options);
  if (!created.ok) throw new Error(`setup failed: ${created.error.kind}`);
  await created.value.close();

  // 자식 프로세스는 내보내기를 먼저 부른다. 그래서 첫 연결이 번들 SQLite로 로드 상태를 정한다
  const result = await runScript(join(import.meta.dir, "fixtures", "export-first.ts"), [
    dbPath,
    dir.join("out"),
  ]);
  const expected: ExportFirstReport = { exported: "ok", opened: "store.sqlite_already_loaded" };
  expect(result.code).toBe(0);
  const report: unknown = JSON.parse(result.stdout);
  expect(report).toEqual(expected);
});
