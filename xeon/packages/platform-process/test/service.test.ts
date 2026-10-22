import { describe, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { ProcessPortKey, type PortKey, type ProcessPort } from "@xeon/contracts/extensions";
import type { ProcessService, ShutdownCoordinator } from "@xeon/contracts/services";
import {
  PROCESS_SERVICE_SETTINGS_DEFAULTS,
  createProcessService,
  processPlugin,
  type ProcessOsPort,
  type ProcessPlatformContext,
} from "../src/index.ts";
import { manualClock } from "./support/clock.ts";
import {
  exitRecorder,
  fakeProcess,
  memoryLogger,
  rejectionOf,
  sequentialLocalIds,
} from "./support/fakes.ts";

function isProcessService(port: ProcessPort): port is ProcessService {
  return "background" in port && "shutdown" in port;
}

function build() {
  const clock = manualClock();
  const exits = exitRecorder();
  const logger = memoryLogger();
  const handle = createProcessService({
    clock,
    scheduler: clock,
    ids: sequentialLocalIds(),
    logger,
    settings: { shutdownTimeoutMs: 3000 },
    exit: (code) => exits.exit(code),
  });
  return { clock, exits, handle, logger };
}

describe("process service", () => {
  test("process service satisfies ProcessPort", () => {
    const { handle } = build();
    const asPort: ProcessPort = handle.service;
    const asService: ProcessService = handle.service;
    const coordinator: ShutdownCoordinator = handle.service.shutdown;
    expect(asPort).toBe(asService);
    expect(coordinator).toBe(handle.shutdown);
    expect(handle.service.background).toBe(handle.background);
  });

  test("spawn rejects in the first release instead of starting anything", async () => {
    const { handle } = build();
    const spawnRejection = await rejectionOf(
      handle.service.spawn({ main: "/x.ts", args: [], cwd: "/", env: {}, label: "ext:a:1" }),
    );
    expect(spawnRejection).toBeInstanceOf(Bug);
    if (spawnRejection instanceof Error) {
      expect(spawnRejection.message).toContain("isolation_unavailable");
    }
  });

  test("run reports an unsupported platform as a spawn error instead of rejecting", async () => {
    const clock = manualClock();
    const exits = exitRecorder();
    const handle = createProcessService({
      clock,
      scheduler: clock,
      ids: sequentialLocalIds(),
      logger: memoryLogger(),
      settings: { shutdownTimeoutMs: 3000 },
      exit: (code) => exits.exit(code),
      platform: null,
    });
    const run = await handle.service.run({
      argv: ["true"],
      cwd: "/",
      env: {},
      stdin: "",
      maxStdoutChars: 10,
      maxStderrChars: 10,
      signal: new AbortController().signal,
    });
    expect(run).toMatchObject({ exitCode: null, spawnError: "unsupported_platform" });
  });

  test("shutdown stops every background process through the registry", async () => {
    const { handle } = build();
    const fake = fakeProcess();
    const registered = handle.service.background.register({
      label: "watcher",
      owner: { kind: "other", threadId: null, ref: null },
      pid: 42,
      stopper: fake.stopper,
    });
    expect(registered.ok).toBe(true);
    const outcome = await handle.shutdown.request("shutdown_request");
    expect(outcome.completed).toBe(true);
    expect(fake.stopCalls).toEqual(["graceful"]);
    expect(
      handle.background.register({
        label: "late",
        owner: { kind: "other", threadId: null, ref: null },
        pid: 43,
        stopper: fakeProcess().stopper,
      }),
    ).toEqual({ ok: false, error: { kind: "registry_closed" } });
  });

  test("uses the configured shutdown timeout", async () => {
    const clock = manualClock();
    const exits = exitRecorder();
    const handle = createProcessService({
      clock,
      scheduler: clock,
      ids: sequentialLocalIds(),
      logger: memoryLogger(),
      settings: { shutdownTimeoutMs: 700 },
      exit: (code) => exits.exit(code),
    });
    handle.shutdown.onShutdown("stuck", () => new Promise<void>(() => {}));
    const outcome = handle.shutdown.request("signal");
    expect(await rejectionOf(clock.advance(700))).toBeInstanceOf(Error);
    expect(exits.codes).toEqual([1]);
    expect((await outcome).completed).toBe(false);
  });

  test("accepts a shutdown made by the assembly root", async () => {
    const { handle: first } = build();
    const clock = manualClock();
    const exits = exitRecorder();
    const handle = createProcessService({
      clock,
      scheduler: clock,
      ids: sequentialLocalIds(),
      logger: memoryLogger(),
      settings: PROCESS_SERVICE_SETTINGS_DEFAULTS,
      exit: (code) => exits.exit(code),
      shutdown: first.shutdown,
    });
    expect(handle.shutdown).toBe(first.shutdown);
  });
});

function fakeContext() {
  const clock = manualClock();
  const logger = memoryLogger();
  const os: ProcessOsPort = {
    time: { clock, scheduler: clock, random: () => 0.5 },
    logger: () => logger,
  };
  const provided: { key: PortKey<ProcessPort>; impl: ProcessPort }[] = [];
  const disposers: (() => void | Promise<void>)[] = [];
  const looked: string[] = [];
  const ctx: ProcessPlatformContext = {
    providePort(key, impl) {
      provided.push({ key, impl });
    },
    port(key) {
      looked.push(key.name);
      return os;
    },
    onDispose(fn) {
      disposers.push(fn);
    },
  };
  return { ctx, disposers, looked, provided };
}

describe("processPlugin", () => {
  test("provides ProcessService under the xeon.process port", () => {
    const { ctx, looked, provided } = fakeContext();
    const exits = exitRecorder();
    const module = processPlugin({
      ids: sequentialLocalIds(),
      settings: PROCESS_SERVICE_SETTINGS_DEFAULTS,
      exit: (code) => exits.exit(code),
    });
    expect(module.name).toBe("platform-process");
    module.setup(ctx);
    expect(looked).toEqual(["xeon.os"]);
    expect(provided).toHaveLength(1);
    expect(provided[0]?.key).toBe(ProcessPortKey);
    expect(provided[0]?.key.name).toBe("xeon.process");
  });

  test("closes the background registry when the host is disposed", async () => {
    const { ctx, disposers, provided } = fakeContext();
    const exits = exitRecorder();
    processPlugin({
      ids: sequentialLocalIds(),
      settings: PROCESS_SERVICE_SETTINGS_DEFAULTS,
      exit: (code) => exits.exit(code),
    }).setup(ctx);
    expect(disposers).toHaveLength(1);
    const service = provided[0]?.impl;
    if (service === undefined || !isProcessService(service))
      throw new Error("service not provided");
    const fake = fakeProcess();
    service.background.register({
      label: "watcher",
      owner: { kind: "other", threadId: null, ref: null },
      pid: 7,
      stopper: fake.stopper,
    });
    await disposers[0]?.();
    expect(fake.stopCalls).toEqual(["graceful"]);
    expect(exits.codes).toEqual([]);
  });
});
