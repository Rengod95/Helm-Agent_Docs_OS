import { afterAll, expect, test } from "bun:test";
import { Bug } from "@xeon/contracts";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixedIdFactory } from "@xeon/ext-host/testing";
import { buildEngineCatalog } from "../../src/assembly/catalog.ts";
import { createSettingsEngine, type SettingsEngine } from "../../src/assembly/settings-engine.ts";
import {
  agentsSource,
  execOptionsOf,
  hostLimitsOf,
  logLevelOf,
  loopSource,
  modelsSource,
  operationsSource,
  persistenceSource,
  primitivesSource,
  sandboxSource,
  secretsSource,
  shutdownTimeoutMs,
  storeSettingsOf,
  tasksSource,
  toolsSource,
  workspaceSource,
} from "../../src/assembly/settings-sources.ts";

const THREAD = fixedIdFactory().next("thr");
const scratch = mkdtempSync(join(tmpdir(), "xh-src-"));
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

let counter = 0;
async function engineWith(values: Readonly<Record<string, unknown>>): Promise<SettingsEngine> {
  const built = buildEngineCatalog();
  if (!built.ok) throw new Error("the core catalog must build");
  const settings = createSettingsEngine(built.catalog);
  counter += 1;
  const path = join(scratch, `settings-${counter}.json`);
  writeFileSync(path, JSON.stringify(values));
  await settings.loadUserFile(path);
  return settings;
}

test("x.primitives.* are read into the primitives source: default caps, no ceiling", async () => {
  const defaults = primitivesSource(await engineWith({}));
  expect(defaults.driveDefaultLimits(THREAD)).toEqual({
    maxTurns: 4,
    maxSpawns: 8,
    maxTokens: 400000,
  });
  expect(defaults.driveLimits(THREAD)).toEqual({});
  expect(defaults.activeDriveGroup(THREAD)).toBeNull();
  expect(defaults.capabilityProviders()).toEqual({});

  const set = primitivesSource(
    await engineWith({
      "x.primitives.driveDefaultLimits": { maxTurns: 6 },
      "x.primitives.driveLimits": { maxTurns: 3, maxSpawns: 0 },
      "x.primitives.activeDriveGroup": "smoke-group",
      "x.primitives.capabilityProviders": { "web.search": "web-exa" },
    }),
  );
  // 일부 필드만 적은 기본 상한은 빠진 필드를 내장 기본값으로 채운다(U-12)
  expect(set.driveDefaultLimits(THREAD)).toEqual({
    maxTurns: 6,
    maxSpawns: 8,
    maxTokens: 400000,
  });
  expect(set.driveLimits(THREAD)).toEqual({ maxTurns: 3, maxSpawns: 0 });
  expect(set.activeDriveGroup(THREAD)).toBe("smoke-group");
  expect(set.capabilityProviders()).toEqual({ "web.search": "web-exa" });
});

test("the drive limits are read for the thread, so a session scope value applies to its lease", async () => {
  const settings = await engineWith({ "x.primitives.driveDefaultLimits": { maxTurns: 6 } });
  const other = fixedIdFactory(5).next("thr");
  settings.bindSession({
    layer: (threadId) => ({
      scope: "session",
      values:
        threadId === THREAD
          ? new Map<string, unknown>([
              ["x.primitives.driveDefaultLimits", { maxSpawns: 2 }],
              ["x.primitives.driveLimits", { maxTokens: 1000 }],
            ])
          : new Map<string, unknown>(),
    }),
    set: () => {
      throw new Bug("not used");
    },
    reset: () => {
      throw new Bug("not used");
    },
  });
  const source = primitivesSource(settings);
  expect(source.driveDefaultLimits(THREAD)).toEqual({
    maxTurns: 4,
    maxSpawns: 2,
    maxTokens: 400000,
  });
  expect(source.driveLimits(THREAD)).toEqual({ maxTokens: 1000 });
  expect(source.driveDefaultLimits(other)).toEqual({
    maxTurns: 6,
    maxSpawns: 8,
    maxTokens: 400000,
  });
  expect(source.driveLimits(other)).toEqual({});
});

test("x.operations.* fill the budget table and the auto-disable policy", async () => {
  const defaults = operationsSource(await engineWith({}));
  expect(defaults.budgets()).toEqual({
    first: 30_000,
    chain: 10_000,
    tap: 5_000,
    streamTap: 1_000,
    shutdown: 2_000,
    setup: 10_000,
    hook: 30_000,
  });
  expect(defaults.autoDisable()).toEqual({
    enabled: true,
    consecutive: 5,
    windowSize: 50,
    minFailures: 10,
    failureRate: 0.5,
  });
  const set = operationsSource(
    await engineWith({
      "x.operations.budget.firstMs": 1234,
      "x.operations.autoDisable.enabled": false,
      "x.operations.autoDisable.failureRate": 0.25,
    }),
  );
  expect(set.budgets().first).toBe(1234);
  expect(set.autoDisable()).toMatchObject({ enabled: false, failureRate: 0.25 });
});

test("l1.tasks.queue.* reach the tasks source", async () => {
  const source = tasksSource(await engineWith({ "l1.tasks.queue.steeringMode": "all" }));
  expect(source.steeringMode()).toBe("all");
  expect(source.followUpMode()).toBe("one-at-a-time");
});

test("l1.models.* reach the models source and a malformed provider list falls back", async () => {
  const set = modelsSource(
    await engineWith({
      "l1.models.default": "tape/tape-1",
      "l1.models.providers": [{ id: "tape", enabled: true, apiKeyRef: null, baseUrl: null }],
      "l1.models.retry": { maxRetries: 1, baseDelayMs: 5, maxDelayMs: 50 },
    }),
  )();
  expect(set.default).toBe("tape/tape-1");
  expect(set.providers).toEqual([{ id: "tape", enabled: true, apiKeyRef: null, baseUrl: null }]);
  expect(set.retry).toEqual({ maxRetries: 1, baseDelayMs: 5, maxDelayMs: 50 });

  const defaults = modelsSource(await engineWith({ "l1.models.providers": "nope" }))();
  expect(defaults.default).toBeNull();
  expect(defaults.providers).toEqual([]);
  expect(defaults.retry).toEqual({ maxRetries: 3, baseDelayMs: 2000, maxDelayMs: 60_000 });
});

test("l1.loop.maxSteps, tools and workspace sources read the same layers", async () => {
  const settings = await engineWith({ "l1.loop.maxSteps": 7, "l2.workspace.read.maxLines": 99 });
  expect(loopSource(settings).maxSteps(THREAD)).toBe(7);
  expect(toolsSource(settings).layers()).toHaveLength(1);
  expect(workspaceSource(settings).layers(undefined)).toHaveLength(1);
  // 형식이 thread id가 아닌 문자열은 thread 없는 층으로 읽는다
  expect(workspaceSource(settings).layers("not-a-thread")).toHaveLength(1);
});

test("l1.agents.judge.maxRuns reaches the agents source and defaults to 3", async () => {
  expect(agentsSource(await engineWith({ "l1.agents.judge.maxRuns": 5 })).judgeMaxRuns?.()).toBe(5);
  expect(agentsSource(await engineWith({})).judgeMaxRuns?.()).toBe(3);
});

test("undeclared package keys are read raw: persistence, store, exec, shutdown", async () => {
  const reports: string[] = [];
  const settings = await engineWith({
    "l1.persistence.maxResumeAttempts": 9,
    "l0.store.heartbeatMs": 4000,
    "l0.store.leaseTtlMs": 20_000,
    "l0.exec.shell": "/bin/sh",
    "l0.exec.defaultTimeoutMs": 1500,
    "l0.exec.envAllowlist.extra": ["FOO_BAR"],
    "l0.process.shutdown.timeoutMs": 4500,
  });
  expect(persistenceSource(settings, (m) => reports.push(m))()).toMatchObject({
    maxResumeAttempts: 9,
    autoResume: false,
  });
  expect(storeSettingsOf(settings, (m) => reports.push(m))).toMatchObject({
    heartbeatMs: 4000,
    leaseTtlMs: 20_000,
  });
  expect(execOptionsOf(settings, "/work", "/state")).toEqual({
    cwd: "/work",
    tempDir: "/state/spill",
    shellPath: "/bin/sh",
    defaultTimeoutMs: 1500,
    outputSpillBytes: 10_485_760,
    envExtra: ["FOO_BAR"],
  });
  expect(shutdownTimeoutMs(settings)).toBe(4500);
  expect(reports).toEqual([]);
});

test("invalid undeclared values fall back to defaults and are reported without the value", async () => {
  const reports: string[] = [];
  const settings = await engineWith({
    "l1.persistence.maxResumeAttempts": "many",
    "l0.store.heartbeatMs": 1,
  });
  expect(persistenceSource(settings, (m) => reports.push(m))().maxResumeAttempts).toBe(3);
  expect(storeSettingsOf(settings, (m) => reports.push(m)).heartbeatMs).toBe(5000);
  expect(reports.length).toBeGreaterThanOrEqual(2);
  expect(reports.join("\n")).not.toContain("many");
});

test("l0.sandbox.* reach the sandbox source (enabled by default)", async () => {
  expect(sandboxSource(await engineWith({}))().enabled).toBe(true);
  const off = sandboxSource(
    await engineWith({ "l0.sandbox.enabled": false, "l0.sandbox.onUnavailable": "ask" }),
  )();
  expect(off.enabled).toBe(false);
  expect(off.onUnavailable).toBe("ask");
});

test("l0.secrets.* build the secrets config and drop malformed sops files", async () => {
  const defaults = secretsSource(await engineWith({}))();
  expect(defaults.sops.files).toEqual([]);
  expect(defaults.ageKey.source).toBe("auto");
  expect(defaults.approval.default).toBe("per-session");
  const set = secretsSource(
    await engineWith({
      "l0.secrets.sops.files": [{ env: "dev", path: "/s/dev.yaml" }, { env: 1 }, "x"],
      "l0.secrets.sops.binary": "/usr/bin/sops",
      "l0.secrets.ageKey.source": "file",
      "l0.secrets.ageKey.filePath": "/k/keys.txt",
      "l0.secrets.approval.default": "per-use",
      "l0.secrets.approval.writeHosts": "per-session",
      "l0.secrets.lease.ttlSeconds": 60,
    }),
  )();
  expect(set.sops).toEqual({
    files: [{ env: "dev", path: "/s/dev.yaml" }],
    binary: "/usr/bin/sops",
  });
  expect(set.ageKey).toEqual({ source: "file", filePath: "/k/keys.txt" });
  expect(set.approval).toEqual({ default: "per-use", writeHosts: "per-session" });
  expect(set.lease).toEqual({ ttlSeconds: 60, maxUses: 200 });
  const odd = secretsSource(await engineWith({ "l0.secrets.ageKey.source": "magic" }))();
  expect(odd.ageKey.source).toBe("auto");
});

test("host limits read the live value every time", async () => {
  const settings = await engineWith({});
  const limits = hostLimitsOf((key) => settings.value(key));
  expect(limits.maxReplayEvents).toBe(100_000);
  expect(limits.maxSubscriptionsPerConnection).toBe(16);
  expect(limits.replayBatchMaxEvents).toBe(500);
  expect(limits.scanLimit).toBe(10_000);
  expect(limits.sendLowWaterBytes).toBe(1_048_576);
  counter += 1;
  const path = join(scratch, `reload-${counter}.json`);
  writeFileSync(path, JSON.stringify({ "l4.host-service.maxSubscriptionsPerConnection": 3 }));
  await settings.loadUserFile(path);
  expect(limits.maxSubscriptionsPerConnection).toBe(3);
});

test("l0.os.log.level is read on every call, so a change applies from the next log line", async () => {
  const settings = await engineWith({ "l0.os.log.level": "debug" });
  const level = logLevelOf(settings);
  expect(level()).toBe("debug");
  settings.setUserValue("l0.os.log.level", "warn");
  expect(level()).toBe("warn");
  settings.setUserValue("l0.os.log.level", undefined);
  expect(level()).toBe("info");
});

test("the exec spill folder is under the state directory, never the OS temp folder", async () => {
  const options = execOptionsOf(await engineWith({}), "/work", "/home/u/.local/state/xeon");
  expect(options.tempDir).toBe("/home/u/.local/state/xeon/spill");
});
