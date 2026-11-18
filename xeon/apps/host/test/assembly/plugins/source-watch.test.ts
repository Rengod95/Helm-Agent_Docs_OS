import { expect, test } from "bun:test";
import { err, ok, type Logger } from "@fresnel/contracts";
import type { FileChange, WatchError, WatchHandle } from "@fresnel/contracts/services";
import { createSourceWatch } from "../../../src/assembly/plugins/source-watch.ts";

// 원본 폴더 감시(M5c §4.5.7)의 감시 집합 맞추기와 훑기 호출. OS 감시는 대역이다(실제 감시는 int 시험이 본다).

interface Opened {
  readonly root: string;
  readonly debounceMs: number | undefined;
  closed: boolean;
  readonly emit: (changes: readonly FileChange[]) => void;
}

function rig(options: {
  containers: string[];
  existing: Set<string>;
  sources?: string[];
  maxWatches?: number;
  failRoots?: Map<string, WatchError>;
  scan?: () => Promise<void>;
}) {
  const opened: Opened[] = [];
  const warnings: string[] = [];
  let scans = 0;
  let enabled = true;
  const logger: Logger = {
    debug() {},
    info() {},
    warn: (message) => {
      warnings.push(message);
    },
    error() {},
    child: () => logger,
  };
  const watch = createSourceWatch({
    enabled: () => enabled,
    containers: () => Promise.resolve(options.containers),
    sourceDirs: () => Promise.resolve(options.sources ?? []),
    exists: (path) => Promise.resolve(options.existing.has(path)),
    watch: (root, opts, onBatch) => {
      const failure = options.failRoots?.get(root);
      if (failure !== undefined) return Promise.resolve(err(failure));
      const entry: Opened = { root, debounceMs: opts.debounceMs, closed: false, emit: onBatch };
      opened.push(entry);
      const handle: WatchHandle = {
        close() {
          entry.closed = true;
          return Promise.resolve();
        },
      };
      return Promise.resolve(ok(handle));
    },
    scan:
      options.scan ??
      (() => {
        scans += 1;
        return Promise.resolve();
      }),
    logger,
    ...(options.maxWatches === undefined ? {} : { maxWatches: options.maxWatches }),
  });
  return {
    watch,
    opened,
    warnings,
    scans: () => scans,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
  };
}

const flush = () => Bun.sleep(20);

test("opens one watch per existing container with the 1s debounce and nothing runs while idle", async () => {
  const r = rig({
    containers: ["/c/plugins", "/p/.fresnel/plugins"],
    existing: new Set(["/c/plugins", "/p/.fresnel/plugins"]),
  });
  await r.watch.sync();
  expect(r.opened.map((o) => [o.root, o.debounceMs])).toEqual([
    ["/c/plugins", 1000],
    ["/p/.fresnel/plugins", 1000],
  ]);
  await flush();
  expect(r.scans()).toBe(0);
  await r.watch.close();
});

test("a change inside a container scans once; a change elsewhere does not", async () => {
  const r = rig({ containers: ["/c/plugins"], existing: new Set(["/c/plugins"]) });
  await r.watch.sync();
  r.opened[0]?.emit([{ type: "update", path: "/c/other/file" }]);
  await flush();
  expect(r.scans()).toBe(0);
  r.opened[0]?.emit([
    { type: "update", path: "/c/plugins/a/index.ts" },
    { type: "create", path: "/c/plugins/a/new.ts" },
  ]);
  await flush();
  expect(r.scans()).toBe(1);
  await r.watch.close();
});

test("changes arriving during a scan produce exactly one more scan", async () => {
  const gate: { release: (() => void) | undefined } = { release: undefined };
  let calls = 0;
  const r = rig({
    containers: ["/c/plugins"],
    existing: new Set(["/c/plugins"]),
    scan: () => {
      calls += 1;
      return new Promise<void>((resolve) => {
        gate.release = resolve;
      });
    },
  });
  await r.watch.sync();
  const change: FileChange = { type: "update", path: "/c/plugins/a/x" };
  r.opened[0]?.emit([change]);
  await flush();
  r.opened[0]?.emit([change]);
  r.opened[0]?.emit([change]);
  expect(calls).toBe(1);
  gate.release?.();
  await flush();
  expect(calls).toBe(2);
  gate.release?.();
  await r.watch.close();
  expect(calls).toBe(2);
});

test("a missing container waits on its parent and the own watch opens when it returns", async () => {
  const existing = new Set(["/p/.fresnel"]);
  const r = rig({ containers: ["/p/.fresnel/plugins"], existing });
  await r.watch.sync();
  expect(r.opened.map((o) => o.root)).toEqual(["/p/.fresnel"]);
  // 부모에서 위치 자신이 만들어지면 훑고 위치 감시로 바꾼다
  existing.add("/p/.fresnel/plugins");
  r.opened[0]?.emit([{ type: "create", path: "/p/.fresnel/plugins" }]);
  await flush();
  expect(r.scans()).toBe(1);
  expect(r.opened.map((o) => [o.root, o.closed])).toEqual([
    ["/p/.fresnel", true],
    ["/p/.fresnel/plugins", false],
  ]);
  // 위치가 지워지면 다시 부모 감시로 돌아간다
  existing.delete("/p/.fresnel/plugins");
  r.opened[1]?.emit([{ type: "delete", path: "/p/.fresnel/plugins" }]);
  await flush();
  expect(r.opened.filter((o) => !o.closed).map((o) => o.root)).toEqual(["/p/.fresnel"]);
  await r.watch.close();
});

test("a linked source outside the containers gets its own watch; one inside does not", async () => {
  const r = rig({
    containers: ["/c/plugins"],
    existing: new Set(["/c/plugins"]),
    sources: ["/c/plugins/a", "/elsewhere/linked"],
  });
  await r.watch.sync();
  expect(r.opened.map((o) => o.root)).toEqual(["/c/plugins", "/elsewhere/linked"]);
  await r.watch.close();
});

test("the watch count is capped and the overflow is logged", async () => {
  const names = ["/a", "/b", "/c"];
  const r = rig({ containers: names, existing: new Set(names), maxWatches: 2 });
  await r.watch.sync();
  expect(r.opened.map((o) => o.root)).toEqual(["/a", "/b"]);
  expect(r.warnings).toContain("plugin.watch.limit");
  await r.watch.close();
});

test("a watch that cannot open is logged and the others still open", async () => {
  const r = rig({
    containers: ["/a", "/b"],
    existing: new Set(["/a", "/b"]),
    failRoots: new Map([["/a", { kind: "limit_reached", backend: "native", detail: "EMFILE" }]]),
  });
  await r.watch.sync();
  expect(r.opened.map((o) => o.root)).toEqual(["/b"]);
  expect(r.warnings).toContain("plugin.watch.open_failed");
  await r.watch.close();
});

test("turning the setting off closes every watch and turning it on reopens them", async () => {
  const r = rig({ containers: ["/a"], existing: new Set(["/a"]) });
  await r.watch.sync();
  r.setEnabled(false);
  await r.watch.sync();
  expect(r.opened.map((o) => o.closed)).toEqual([true]);
  r.setEnabled(true);
  await r.watch.sync();
  expect(r.opened.map((o) => o.closed)).toEqual([true, false]);
  await r.watch.close();
});

test("close closes every watch, later events and syncs do nothing", async () => {
  const r = rig({ containers: ["/a", "/b"], existing: new Set(["/a", "/b"]) });
  await r.watch.sync();
  const first = r.opened[0];
  await r.watch.close();
  expect(r.opened.map((o) => o.closed)).toEqual([true, true]);
  first?.emit([{ type: "update", path: "/a/x" }]);
  await r.watch.sync();
  await flush();
  expect(r.scans()).toBe(0);
  expect(r.opened).toHaveLength(2);
});
