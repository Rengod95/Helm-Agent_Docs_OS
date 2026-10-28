import { expect, test } from "bun:test";
import { err, ok } from "@xeon/contracts";
import type { FileChange, WatchError, WatchHandle } from "@xeon/contracts/services";
import { createFileWatcher, type WatchBackend } from "../src/watch/watcher.ts";
import { manualClock, memoryLogger } from "./support/clock.ts";

interface FakeBackend extends WatchBackend {
  emit(changes: readonly FileChange[]): void;
  closed(): number;
}

function fakeBackend(id: string, failure?: WatchError): FakeBackend {
  let onRaw: ((changes: readonly FileChange[]) => void) | undefined;
  let closed = 0;
  return {
    id,
    subscribe(_root, _ignore, cb) {
      if (failure !== undefined) return Promise.resolve(err(failure));
      onRaw = cb;
      const handle: WatchHandle = {
        close() {
          closed += 1;
          return Promise.resolve();
        },
      };
      return Promise.resolve(ok(handle));
    },
    emit: (changes) => onRaw?.(changes),
    closed: () => closed,
  };
}

function setup(backends: readonly WatchBackend[]) {
  const clock = manualClock();
  const watcher = createFileWatcher({
    allowedRoots: ["/app/config", "/app/state", "/work/tree"],
    scheduler: clock,
    logger: memoryLogger().logger,
    backends,
  });
  return { clock, watcher };
}

test("a root outside the app dirs is outside_app_dirs, an extra root is allowed", async () => {
  const { watcher } = setup([fakeBackend("a")]);
  expect(await watcher.watch("/etc", {}, () => {})).toEqual(
    err({ kind: "outside_app_dirs", path: "/etc" }),
  );
  expect(await watcher.watch("/app/config/../../etc", {}, () => {})).toEqual(
    err({ kind: "outside_app_dirs", path: "/app/config/../../etc" }),
  );
  expect((await watcher.watch("/work/tree/sub", {}, () => {})).ok).toBe(true);
  expect((await watcher.watch("/app/config", {}, () => {})).ok).toBe(true);
});

test("raw changes are merged per path and delivered once after debounceMs", async () => {
  const backend = fakeBackend("a");
  const { clock, watcher } = setup([backend]);
  const batches: (readonly FileChange[])[] = [];
  await watcher.watch("/app/config", { debounceMs: 100 }, (b) => batches.push(b));
  backend.emit([{ type: "create", path: "/app/config/a.json" }]);
  await clock.advance(60);
  backend.emit([
    { type: "update", path: "/app/config/a.json" },
    { type: "delete", path: "/app/config/b.json" },
  ]);
  await clock.advance(39);
  expect(batches).toEqual([]);
  await clock.advance(1);
  expect(batches).toEqual([
    [
      { type: "create", path: "/app/config/a.json" },
      { type: "delete", path: "/app/config/b.json" },
    ],
  ]);
});

test("ignore globs drop matching paths relative to the root", async () => {
  const backend = fakeBackend("a");
  const { clock, watcher } = setup([backend]);
  const batches: (readonly FileChange[])[] = [];
  await watcher.watch("/app/config", { ignore: ["**/*.tmp", "cache/*"] }, (b) => batches.push(b));
  backend.emit([
    { type: "update", path: "/app/config/x.tmp" },
    { type: "update", path: "/app/config/d/y.tmp" },
    { type: "update", path: "/app/config/cache/z" },
    { type: "update", path: "/app/config/keep.json" },
  ]);
  await clock.advance(100);
  expect(batches).toEqual([[{ type: "update", path: "/app/config/keep.json" }]]);
});

test("closing stops delivery, drops pending changes and closes the backend", async () => {
  const backend = fakeBackend("a");
  const { clock, watcher } = setup([backend]);
  const batches: (readonly FileChange[])[] = [];
  const handle = await watcher.watch("/app/config", {}, (b) => batches.push(b));
  backend.emit([{ type: "update", path: "/app/config/a" }]);
  if (handle.ok) await handle.value.close();
  await clock.advance(1000);
  expect(batches).toEqual([]);
  expect(backend.closed()).toBe(1);
});

test("limit_reached falls through to the next backend; not_found does not", async () => {
  const limit: WatchError = { kind: "limit_reached", backend: "native", detail: "ENOSPC" };
  const second = fakeBackend("second");
  const { watcher } = setup([fakeBackend("first", limit), second]);
  expect((await watcher.watch("/app/config", {}, () => {})).ok).toBe(true);

  const missing: WatchError = { kind: "not_found", path: "/app/config" };
  const third = fakeBackend("third");
  const next = setup([fakeBackend("first", missing), third]);
  expect(await next.watcher.watch("/app/config", {}, () => {})).toEqual(err(missing));

  const only = setup([fakeBackend("only", limit)]);
  expect(await only.watcher.watch("/app/config", {}, () => {})).toEqual(err(limit));
});

test("closeAll closes every open watch", async () => {
  const backend = fakeBackend("a");
  const { watcher } = setup([backend]);
  await watcher.watch("/app/config", {}, () => {});
  await watcher.watch("/app/state", {}, () => {});
  await watcher.closeAll();
  expect(backend.closed()).toBe(2);
});

test("create then update stays create, delete then create becomes update", async () => {
  const backend = fakeBackend("a");
  const { clock, watcher } = setup([backend]);
  const batches: (readonly FileChange[])[] = [];
  await watcher.watch("/app/config", {}, (b) => batches.push(b));
  backend.emit([
    { type: "create", path: "/app/config/a" },
    { type: "update", path: "/app/config/a" },
    { type: "delete", path: "/app/config/b" },
    { type: "create", path: "/app/config/b" },
  ]);
  await clock.advance(100);
  expect(batches).toEqual([
    [
      { type: "create", path: "/app/config/a" },
      { type: "update", path: "/app/config/b" },
    ],
  ]);
});
