import { join } from "node:path";
import { expect, test } from "bun:test";
import type { OrderViolationReport } from "./fixtures/order-violation.ts";
import { runScript } from "./support/spawn.ts";

test("setCustomSQLite after first Database is a bug", async () => {
  const result = await runScript(join(import.meta.dir, "fixtures", "order-violation.ts"));
  const expected: OrderViolationReport = {
    exitCode: 1,
    messageContains: "store.sqlite_already_loaded",
  };
  expect(result.code).toBe(expected.exitCode);
  expect(result.stdout).toContain(expected.messageContains);
});
