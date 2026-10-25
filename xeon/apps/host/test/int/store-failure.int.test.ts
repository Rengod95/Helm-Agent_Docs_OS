import { Database } from "bun:sqlite";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "bun:test";
import { AssembleError, assemble } from "../../src/assemble.ts";
import { useEngineHome } from "../fixtures/engine-home.ts";

// G2-06: 저장소를 열지 못했을 때 호스트가 안내 분류(F.records.spec §3.7 7항)를 이슈에 싣는다.
// 실제 DB 파일을 만든 뒤 망가뜨려 실제 열기 오류를 얻는다.

async function createDatabase(home: ReturnType<typeof useEngineHome>): Promise<string> {
  const engine = await assemble({ mode: "in-process" });
  await engine.close();
  const path = join(home.dataDir, "xeon.db");
  expect(existsSync(path)).toBe(true);
  return path;
}

async function storeIssueOfFailedStart(): Promise<unknown> {
  const caught = await assemble({ mode: "in-process" }).then(
    () => undefined,
    (error: unknown) => error,
  );
  if (!(caught instanceof AssembleError)) throw new Error("expected the start to be refused");
  return caught.issues;
}

test("a database written by a newer engine is refused as future_version, and nothing is rewritten", async () => {
  const home = useEngineHome();
  try {
    const path = await createDatabase(home);
    const newer = new Database(path);
    newer.run(
      `INSERT INTO sys_migrations (owner, version, checksum, applied_at, engine_version)
       SELECT 'sys', MAX(version) + 1, '${"1".repeat(64)}', 1, '9.9.9' FROM sys_migrations WHERE owner = 'sys'`,
    );
    newer.close();
    expect(await storeIssueOfFailedStart()).toEqual([
      { code: "store", message: "storeFutureVersion", failure: "future_version" },
    ]);
  } finally {
    home.dispose();
  }
});

test("a database whose migration history was changed is refused as corrupt", async () => {
  const home = useEngineHome();
  try {
    const path = await createDatabase(home);
    const tamper = new Database(path);
    tamper.run(
      `UPDATE sys_migrations SET checksum = '${"0".repeat(64)}' WHERE owner = 'sys' AND version = 1`,
    );
    tamper.close();
    expect(await storeIssueOfFailedStart()).toEqual([
      { code: "store", message: "storeCorrupt", failure: "corrupt" },
    ]);
  } finally {
    home.dispose();
  }
});

test("a step that fails is migration_failed, and the snapshot taken first is on disk", async () => {
  const home = useEngineHome();
  try {
    const path = await createDatabase(home);
    // 마지막 단계의 기록을 지워 이미 적용된 단계가 다시 남은 것처럼 만든다: 실행하면 이미 있는 객체와 부딪친다
    const rewind = new Database(path);
    rewind.run(
      `DELETE FROM sys_migrations WHERE owner = 'sys' AND version = (SELECT MAX(version) FROM sys_migrations WHERE owner = 'sys')`,
    );
    rewind.close();
    const issues = await storeIssueOfFailedStart();
    expect(issues).toEqual([
      { code: "store", message: "storeMigrationFailed", failure: "migration_failed" },
    ]);
    expect(readdirSync(join(home.dataDir, "backups")).length).toBe(1);
  } finally {
    home.dispose();
  }
});
