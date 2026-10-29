import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import { createIdFactory, systemRandom, systemScheduler } from "@xeon/platform-os";
import {
  DEFAULT_STORE_SETTINGS,
  exportDatabase,
  openStore,
  type StoreEnvironment,
} from "@xeon/platform-store";
import { openTestStore } from "@xeon/platform-store/testing";
import { EXIT } from "../src/exit-codes.ts";
import { createHarness } from "./support/harness.ts";

// M3-REQ-63 종단: 실제 저장소(bun:sqlite 파일)에 행과 블롭을 쓰고, 엔진 없이 `db export`를 돌리고, 내보낸 사본을
// openStore로 열어 행과 블롭 바이트가 원본과 같은지 값으로 비교한다. 내보내기는 원본을 열어 둔 채로 한다(엔진이 떠 있는 경우).

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const BLOB = new TextEncoder().encode("블롭 바이트: db export round trip");

/** 읽기 전용으로 여는 사본의 환경. 플랫폼은 Node의 값을 세 가지 중 하나로 좁힌다 */
function storeEnv(): StoreEnvironment {
  const platform =
    process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux";
  return {
    platform,
    wsl: false,
    dbDirFsKind: "local",
    bundledSqlitePath: null,
    machineId: "test-machine",
    processStartedAt: () => null,
  };
}

test("db export round trip: rows and blob bytes written by a store come back from the exported copy", async () => {
  const root = mkdtempSync(join(tmpdir(), "xcli-export-"));
  dirs.push(root);
  const dataDir = join(root, "data");
  mkdirSync(dataDir, { recursive: true });
  const dbPath = join(dataDir, "xeon.db");
  const dest = join(root, "out");
  // 엔진 없이 실행한다: 가짜 호스트 없이 runCli가 실제 exportDatabase를 부른다. 시계는 하네스의 것을 쓴다
  const h = createHarness({
    dataDir,
    exportDatabase: (options) => Promise.resolve(exportDatabase(options)),
  });
  const clock = h.clock;

  // 원본: 행 두 개와 블롭 하나를 쓴다. 닫지 않고 내보낸다
  const writer = await openTestStore({
    path: dbPath,
    clock,
    ids: createIdFactory(clock, systemRandom()),
  });
  const created = writer.root.write((tx) => {
    tx.run("CREATE TABLE t_probe (id INTEGER PRIMARY KEY, body TEXT NOT NULL) STRICT");
    tx.run("INSERT INTO t_probe (body) VALUES ('첫 줄'), ('둘째 줄')");
  });
  expect(created.ok).toBe(true);
  const put = writer.service.putBlob(BLOB, "text/plain");
  if (!put.ok) throw new Error(`putBlob failed: ${put.error.kind}`);
  const ref = put.value;

  try {
    expect(await h.run(["db", "export", dest])).toBe(EXIT.ok);
    expect(h.stdoutText()).toBe(`exported 1 blobs to ${dest}\n`);
    expect(h.stderrText()).toBe("");
    expect(h.startOptions).toEqual([]);
  } finally {
    h.dispose();
    await writer.opened.close();
  }

  // 사본: manifest와 블롭 파일, 그리고 openStore로 연 행과 블롭 바이트
  const manifest: unknown = JSON.parse(readFileSync(join(dest, "manifest.json"), "utf8"));
  expect(manifest).toEqual({
    format: 1,
    exportedAt: clock.now(),
    sqliteFile: "xeon.sqlite",
    blobCount: 1,
    missingBlobs: [],
  });
  const onDisk = readFileSync(join(dest, "blobs", ref.sha256.slice(0, 2), ref.sha256.slice(2)));
  expect(new TextDecoder().decode(onDisk)).toBe(new TextDecoder().decode(BLOB));

  const reopened = await openStore({
    dbPath: join(dest, "xeon.sqlite"),
    env: storeEnv(),
    clock,
    scheduler: systemScheduler(),
    ids: createIdFactory(clock, systemRandom()),
    settings: DEFAULT_STORE_SETTINGS,
    engineVersion: "0.0.0-test",
    readOnly: true,
  });
  if (!reopened.ok) throw new Error(`openStore failed: ${reopened.error.kind}`);
  try {
    const rows = reopened.value.root.read((tx) =>
      tx.all("SELECT id, body FROM t_probe ORDER BY id"),
    );
    expect(rows).toEqual(
      ok([
        { id: 1, body: "첫 줄" },
        { id: 2, body: "둘째 줄" },
      ]),
    );
    const bytes = reopened.value.service.readBlob(ref);
    if (!bytes.ok) throw new Error(`readBlob failed: ${bytes.error.kind}`);
    expect(new TextDecoder().decode(bytes.value)).toBe(new TextDecoder().decode(BLOB));
  } finally {
    await reopened.value.close();
  }
});
