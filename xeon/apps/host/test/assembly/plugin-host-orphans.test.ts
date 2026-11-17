import { afterAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { err, ok, type Logger } from "@fresnel/contracts";
import type {
  IsolatedChild,
  IsolationProcessPort,
  IsolationSpawnSpec,
} from "@fresnel/contracts/extensions";
import { readOsRuntime, systemScheduler } from "@fresnel/platform-os";
import { detectProcessPlatform } from "@fresnel/platform-process";
import {
  nodePluginHostFiles,
  PLUGIN_HOSTS_DIR,
  psCommandOf,
  sweepOrphanPluginHosts,
  trackedPluginHostPort,
  type PluginHostFiles,
} from "../../src/assembly/plugin-host-orphans.ts";
import { createPluginHostAssembly } from "../../src/assembly/plugin-host.ts";

// L4.host-service §4.9, drive-isolation.md §3.6: 자식 기록, 엔진 시작 때 고아 정리, 재시작 설정 읽기.
// 가짜 프로세스 표와 가짜 파일 저장소로 판정을 보고, 실제 자식 한 건으로 끝까지 본다.

const root = mkdtempSync(join(tmpdir(), "plugin-host-orphans-"));
afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const DIR = join("/state", PLUGIN_HOSTS_DIR);
const ENGINE = 100;
const HOST = "bun /repo/apps/host/src/main.ts plugin-host --stdio";

interface Logged {
  readonly level: string;
  readonly event: string;
}

function recordingLogger(logged: Logged[]): Logger {
  const logger: Logger = {
    debug: (event) => {
      logged.push({ level: "debug", event });
    },
    info: (event) => {
      logged.push({ level: "info", event });
    },
    warn: (event) => {
      logged.push({ level: "warn", event });
    },
    error: (event) => {
      logged.push({ level: "error", event });
    },
    child: () => logger,
  };
  return logger;
}

/** 메모리 파일 저장소. 키는 전체 경로다 */
function fakeFilesOf(initial: ReadonlyMap<string, string>): {
  readonly files: PluginHostFiles;
  readonly store: Map<string, string>;
} {
  const store = new Map(initial);
  const files: PluginHostFiles = {
    async list(dir) {
      return [...store.keys()]
        .filter((path) => dirname(path) === dir)
        .map((path) => basename(path));
    },
    async read(path) {
      const text = store.get(path);
      if (text === undefined) throw new Error(`ENOENT: ${path}`);
      return text;
    },
    async write(path, text) {
      store.set(path, text);
    },
    async remove(path) {
      store.delete(path);
    },
  };
  return { files, store };
}

interface FakeProcess {
  readonly command: string;
  /** 이 신호에 끝난다. SIGKILL(`force`)은 언제나 끝낸다 */
  readonly endsOn: "graceful" | "force";
}

/** 가짜 프로세스 표. 신호를 받은 기록과 유예 시간을 남긴다 */
function fakeProcessesOf(entries: readonly (readonly [number, FakeProcess])[]): {
  readonly table: Map<number, FakeProcess>;
  readonly signals: { readonly pid: number; readonly signal: "graceful" | "force" }[];
  readonly waits: number[];
  readonly commandOf: (pid: number) => string | null;
  readonly signalTree: (pid: number, signal: "graceful" | "force") => void;
  readonly wait: (ms: number) => Promise<void>;
} {
  const table = new Map<number, FakeProcess>(entries);
  const signals: { readonly pid: number; readonly signal: "graceful" | "force" }[] = [];
  const waits: number[] = [];
  return {
    table,
    signals,
    waits,
    commandOf: (pid) => table.get(pid)?.command ?? null,
    signalTree: (pid, signal) => {
      signals.push({ pid, signal });
      const proc = table.get(pid);
      if (proc !== undefined && (signal === "force" || proc.endsOn === "graceful")) {
        table.delete(pid);
      }
    },
    wait: async (ms) => {
      waits.push(ms);
    },
  };
}

function recordText(pid: number, enginePid: number): string {
  return JSON.stringify({ pid, label: `ext:demo${String(pid)}:1`, startedAt: 1, enginePid });
}

test("a record of a dead engine is stopped only when its pid still runs a plugin host command", async () => {
  const procs = fakeProcessesOf([
    [ENGINE, { command: "bun /repo/apps/host/src/main.ts", endsOn: "graceful" }],
    [60, { command: "bun /other/apps/host/src/main.ts", endsOn: "graceful" }],
    [201, { command: HOST, endsOn: "graceful" }],
    // pid가 재사용되어 다른 프로세스가 되었다. 명령줄에 `plugin-host` 인자가 없다
    [202, { command: "/usr/bin/less plugin-host.log", endsOn: "graceful" }],
    // 유예 뒤에도 남아 SIGKILL을 받는다
    [204, { command: HOST, endsOn: "force" }],
    [301, { command: HOST, endsOn: "graceful" }],
    [401, { command: HOST, endsOn: "graceful" }],
  ]);
  const { files, store } = fakeFilesOf(
    new Map([
      [join(DIR, "201.json"), recordText(201, 50)],
      [join(DIR, "202.json"), recordText(202, 50)],
      // 죽은 pid
      [join(DIR, "203.json"), recordText(203, 50)],
      [join(DIR, "204.json"), recordText(204, 50)],
      // 이 엔진의 자식
      [join(DIR, "301.json"), recordText(301, ENGINE)],
      // 다른 살아 있는 엔진의 자식
      [join(DIR, "401.json"), recordText(401, 60)],
      [join(DIR, "broken.json"), "not json"],
      [join(DIR, "notes.txt"), "keep"],
    ]),
  );
  const logged: Logged[] = [];

  const swept = await sweepOrphanPluginHosts({
    dir: DIR,
    enginePid: ENGINE,
    files,
    commandOf: procs.commandOf,
    signalTree: procs.signalTree,
    wait: procs.wait,
    graceMs: 2000,
    logger: recordingLogger(logged),
  });

  expect(swept).toEqual([201, 204]);
  expect(procs.signals).toEqual([
    { pid: 201, signal: "graceful" },
    { pid: 204, signal: "graceful" },
    { pid: 204, signal: "force" },
  ]);
  expect(procs.waits).toEqual([2000]);
  expect(procs.table.has(201)).toBe(false);
  expect(procs.table.has(204)).toBe(false);
  expect(procs.table.has(202)).toBe(true);
  expect(procs.table.has(301)).toBe(true);
  expect(procs.table.has(401)).toBe(true);
  expect([...store.keys()].toSorted()).toEqual(
    [join(DIR, "301.json"), join(DIR, "401.json"), join(DIR, "notes.txt")].toSorted(),
  );
  expect(logged.filter((entry) => entry.event === "plugin_host.orphan_swept")).toEqual([
    { level: "warn", event: "plugin_host.orphan_swept" },
    { level: "warn", event: "plugin_host.orphan_swept" },
  ]);
});

test("a failed scan of the record folder is logged and nothing is signalled", async () => {
  const procs = fakeProcessesOf([[201, { command: HOST, endsOn: "graceful" }]]);
  const { files } = fakeFilesOf(new Map([[join(DIR, "201.json"), recordText(201, 50)]]));
  const logged: Logged[] = [];

  const swept = await sweepOrphanPluginHosts({
    dir: DIR,
    enginePid: ENGINE,
    files: {
      ...files,
      list: async () => {
        throw new Error("EACCES");
      },
    },
    commandOf: procs.commandOf,
    signalTree: procs.signalTree,
    wait: procs.wait,
    graceMs: 2000,
    logger: recordingLogger(logged),
  });

  expect(swept).toEqual([]);
  expect(procs.signals).toEqual([]);
  expect(logged.map((entry) => entry.event)).toEqual(["plugin_host.orphan_scan_failed"]);
});

test("a signal that throws is logged and the sweep goes on with the other records", async () => {
  const procs = fakeProcessesOf([
    [201, { command: HOST, endsOn: "graceful" }],
    [204, { command: HOST, endsOn: "force" }],
  ]);
  const { files, store } = fakeFilesOf(
    new Map([
      [join(DIR, "201.json"), recordText(201, 50)],
      [join(DIR, "204.json"), recordText(204, 50)],
    ]),
  );
  const logged: Logged[] = [];

  const swept = await sweepOrphanPluginHosts({
    dir: DIR,
    enginePid: ENGINE,
    files,
    commandOf: procs.commandOf,
    signalTree: (pid, signal) => {
      if (pid === 201) throw new Error("EPERM");
      procs.signalTree(pid, signal);
    },
    wait: procs.wait,
    graceMs: 2000,
    logger: recordingLogger(logged),
  });

  expect(swept).toEqual([201, 204]);
  expect(procs.signals).toEqual([
    { pid: 204, signal: "graceful" },
    { pid: 204, signal: "force" },
  ]);
  expect(logged.map((entry) => entry.event)).toContain("plugin_host.orphan_signal_failed");
  expect(store.size).toBe(0);
});

/** 이벤트 루프 한 바퀴. 끝난 자식의 기록을 지우는 비동기 작업이 끝날 때까지 기다린다 */
function flush(): Promise<void> {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function controlledChild(pid: number): {
  readonly child: IsolatedChild;
  readonly exit: () => void;
} {
  let finish: (() => void) | undefined;
  const exited = new Promise<{ readonly code: number | null; readonly signal: string | null }>(
    (resolve) => {
      finish = () => {
        resolve({ code: 0, signal: null });
      };
    },
  );
  const child: IsolatedChild = {
    pid,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exited,
    kill: () => {},
  };
  return {
    child,
    exit: () => {
      finish?.();
    },
  };
}

const SPEC: IsolationSpawnSpec = {
  command: "bun",
  args: ["plugin-host", "--stdio"],
  readRoot: "/repo/demo",
  env: {},
  label: "ext:demo:1",
};

test("a spawned child gets a record, and the record is removed when the child exits", async () => {
  const { child, exit } = controlledChild(500);
  const port: IsolationProcessPort = {
    spawn: async () => ok(child),
  };
  const { files, store } = fakeFilesOf(new Map());
  const tracked = trackedPluginHostPort(port, {
    dir: DIR,
    enginePid: ENGINE,
    now: () => 42,
    files,
    logger: recordingLogger([]),
  });

  const spawned = await tracked.spawn(SPEC);
  expect(spawned.ok).toBe(true);
  expect(store.get(join(DIR, "500.json"))).toBe(
    `${JSON.stringify({ pid: 500, label: "ext:demo:1", startedAt: 42, enginePid: ENGINE })}\n`,
  );

  exit();
  await flush();
  expect(store.has(join(DIR, "500.json"))).toBe(false);
});

test("a failed spawn writes no record and returns the port's error", async () => {
  const port: IsolationProcessPort = {
    spawn: async () => err({ kind: "sandbox_unavailable", reason: "no sandbox" }),
  };
  const { files, store } = fakeFilesOf(new Map());
  const tracked = trackedPluginHostPort(port, {
    dir: DIR,
    enginePid: ENGINE,
    now: () => 42,
    files,
    logger: recordingLogger([]),
  });

  expect(await tracked.spawn(SPEC)).toEqual(
    err({ kind: "sandbox_unavailable", reason: "no sandbox" }),
  );
  expect(store.size).toBe(0);
});

test("a record that cannot be written is logged and the child still starts", async () => {
  const { child } = controlledChild(501);
  const port: IsolationProcessPort = {
    spawn: async () => ok(child),
  };
  const { files } = fakeFilesOf(new Map());
  const logged: Logged[] = [];
  const tracked = trackedPluginHostPort(port, {
    dir: DIR,
    enginePid: ENGINE,
    now: () => 42,
    files: {
      ...files,
      write: async () => {
        throw new Error("ENOSPC");
      },
    },
    logger: recordingLogger(logged),
  });

  const spawned = await tracked.spawn(SPEC);
  expect(spawned.ok).toBe(true);
  expect(logged.map((entry) => entry.event)).toEqual(["plugin_host.record_write_failed"]);
});

test("the real sweep stops a real plugin-host child that a dead engine left behind", async () => {
  const dir = join(root, PLUGIN_HOSTS_DIR);
  mkdirSync(dir, { recursive: true });
  // 엔진 pid는 이미 끝난 프로세스다(죽은 엔진)
  const deadEngine = Bun.spawn([process.execPath, "-e", "0"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  await deadEngine.exited;
  const child = Bun.spawn(
    [process.execPath, "-e", "setInterval(() => {}, 1000)", "plugin-host", "--stdio"],
    { stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  );
  const recordPath = join(dir, `${String(child.pid)}.json`);
  try {
    writeFileSync(
      recordPath,
      JSON.stringify({
        pid: child.pid,
        label: "ext:real:1",
        startedAt: 1,
        enginePid: deadEngine.pid,
      }),
    );
    const platform = detectProcessPlatform();
    if (!platform.ok) throw new Error(`no process platform: ${platform.error.kind}`);

    const swept = await sweepOrphanPluginHosts({
      dir,
      enginePid: process.pid,
      files: nodePluginHostFiles,
      commandOf: psCommandOf(readOsRuntime().runSync),
      signalTree: (pid, signal) => {
        platform.value.signalTree(pid, signal);
      },
      wait: (ms) => Bun.sleep(ms),
      graceMs: 300,
      logger: recordingLogger([]),
    });

    expect(swept).toEqual([child.pid]);
    // 기한 안에 끝나야 한다. 끝나지 않으면 finally에서 죽인다
    const stopped = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(5000).then(() => false),
    ]);
    expect(stopped).toBe(true);
    expect(existsSync(recordPath)).toBe(false);
  } finally {
    child.kill("SIGKILL");
  }
});

test("the restart settings are read on each call and fall back to the setting defaults", () => {
  const settings = new Map<string, unknown>([["x.loading-trust.isolation.maxRestarts", 2]]);
  const assembly = createPluginHostAssembly({
    scheduler: systemScheduler(),
    logger: recordingLogger([]),
    maskSecrets: (line) => line,
    autoDisabler: { disableNow: () => {} },
    processPort: undefined,
    stateDir: root,
    settingValue: (key) => settings.get(key),
    now: () => 0,
  });

  expect(assembly.isolation.maxRestarts?.()).toBe(2);
  expect(assembly.isolation.restartWindowSec?.()).toBe(600);
  settings.set("x.loading-trust.isolation.maxRestarts", 5);
  expect(assembly.isolation.maxRestarts?.()).toBe(5);
  settings.set("x.loading-trust.isolation.maxRestarts", "many");
  expect(assembly.isolation.maxRestarts?.()).toBe(3);
  settings.set("x.loading-trust.isolation.restartWindowSec", 30);
  expect(assembly.isolation.restartWindowSec?.()).toBe(30);
});

test("without a process port the assembly has no tracked port and the sweep does nothing", async () => {
  const stateDir = join(root, "no-port");
  const assembly = createPluginHostAssembly({
    scheduler: systemScheduler(),
    logger: recordingLogger([]),
    maskSecrets: (line) => line,
    autoDisabler: { disableNow: () => {} },
    processPort: undefined,
    stateDir,
    settingValue: () => undefined,
    now: () => 0,
  });

  expect(assembly.process).toBeUndefined();
  await assembly.sweepOrphans();
  expect(existsSync(join(stateDir, PLUGIN_HOSTS_DIR))).toBe(false);
});
