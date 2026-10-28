import { afterEach, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import type { FileChange } from "@xeon/contracts/services";
import { memoryLogger } from "./support/clock.ts";
import { tempDir, type TempDir } from "../src/testing/index.ts";
import { systemScheduler } from "../src/time/scheduler.ts";
import { createFsWatchBackend } from "../src/watch/fs-watch.ts";
import { createFileWatcher } from "../src/watch/watcher.ts";

// L0.os.spec §3.8, M3-REQ-49. 실제 파일과 fs.watch로 설정 파일 외부 변경 통지를 확인한다.

let temp: TempDir | undefined;
afterEach(async () => {
  await temp?.remove();
  temp = undefined;
});

function waitFor(predicate: () => boolean, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate() || Date.now() - started > ms) {
        clearInterval(timer);
        resolve(predicate());
      }
    }, 10);
  });
}

test("create, update and delete of settings.json reach onBatch with the path and type", async () => {
  temp = await tempDir();
  const config = temp.join("config");
  await mkdir(config);
  const scheduler = systemScheduler();
  const logger = memoryLogger().logger;
  const watcher = createFileWatcher({
    allowedRoots: [config],
    scheduler,
    logger,
    backends: [createFsWatchBackend({ logger })],
  });
  const seen: FileChange[] = [];
  const handle = await watcher.watch(config, { debounceMs: 30 }, (batch) => seen.push(...batch));
  expect(handle.ok).toBe(true);
  const file = `${config}/settings.json`;

  await writeFile(file, "{}");
  expect(await waitFor(() => seen.some((c) => c.path === file), 3000)).toBe(true);
  expect(seen.find((c) => c.path === file)?.type).toBe("create");

  seen.length = 0;
  await writeFile(file, '{"a":1}');
  expect(await waitFor(() => seen.some((c) => c.path === file), 3000)).toBe(true);
  expect(seen.find((c) => c.path === file)?.type).toBe("update");

  seen.length = 0;
  await rm(file);
  expect(await waitFor(() => seen.some((c) => c.path === file), 3000)).toBe(true);
  expect(seen.find((c) => c.path === file)?.type).toBe("delete");

  await watcher.closeAll();
  scheduler.dispose();
  seen.length = 0;
  await writeFile(file, "{}");
  await Bun.sleep(150);
  expect(seen).toEqual([]);
});

test("watching a missing directory is not_found", async () => {
  temp = await tempDir();
  const missing = temp.join("nope");
  const logger = memoryLogger().logger;
  const watcher = createFileWatcher({
    allowedRoots: [temp.path],
    scheduler: systemScheduler(),
    logger,
    backends: [createFsWatchBackend({ logger })],
  });
  const result = await watcher.watch(missing, {}, () => {});
  expect(result.ok ? undefined : result.error).toEqual({ kind: "not_found", path: missing });
});
