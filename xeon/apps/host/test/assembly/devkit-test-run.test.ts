import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { err, ok, parse } from "@fresnel/contracts";
import { ThreadIdSchema, type ThreadId } from "@fresnel/contracts/conversation";
import type { Profile, ProfileApplyResult } from "@fresnel/contracts/wire";
import type { RegistrationInfo } from "@fresnel/ext-host";
import { createRuntimeReplayHarness, replayDrive, smokeGroup } from "@fresnel/group-sdk/testing";
import { createDevkitPort } from "../../src/assembly/m4/devkit-port.ts";
import type { M4HostEnv, M4PortDeps } from "../../src/assembly/m4/deps.ts";
import type { ExtUiVersionSource } from "../../src/assembly/m4/ext-ui-version-source.ts";
import {
  replayReportOf,
  type ReplayRunner,
  type ReplayRunReport,
} from "../../src/assembly/m4/replay-run.ts";
import type { ProfileTestRunPort } from "../../src/handlers/m4/profile-test-run.ts";
import { openFileLock, type OpenedFileLock } from "../fixtures/file-lock.ts";
import { partial } from "../fixtures/unsafe.ts";

// 제작 포트의 `ext.test.run`·`ext.test.list`(`assembly/m4/devkit-port.ts`)를 실제 파일 잠금과 실제 기록 파일 위에서 본다.
// 재생 실행기는 이 시험에서 스모크 그룹을 실제 하니스(`replayDrive` + 런타임 하니스)로 돌리는 것을 넘기거나, 넘기지 않으면 기본
// 실행기(`runInstalledReplay`, plugin-builder)를 쓴다. 시험 파일만 `@fresnel/group-sdk/testing`을 import한다(DR-08).
// Test run 대화의 생성, 프로필, 등록은 가짜다.

const root = mkdtempSync(join(tmpdir(), "devkit-test-run-"));
const locks: OpenedFileLock[] = [];
afterAll(async () => {
  await Promise.all(locks.map((lock) => lock.dispose()));
  rmSync(root, { recursive: true, force: true });
});

const THREAD = parseThread("thr_01ARZ3NDEKTSV4RRFFQ69G5FAV");
const CLOCK_MS = Date.parse("2026-11-04T09:00:00.000Z");

function parseThread(raw: string): ThreadId {
  const found = parse(ThreadIdSchema, raw);
  if (!found.ok) throw new Error(`the fixture thread id ${raw} is not a thread id`);
  return found.value;
}

function manifestOf(name: string, group: boolean): string {
  return JSON.stringify({
    schemaVersion: 2,
    name,
    version: "0.1.0",
    displayName: name,
    entry: "./src/index.ts",
    plugins: [
      group
        ? { layer: "L3", hooks: ["boundary.settle.after"], drives: true }
        : { layer: "plugin", hooks: ["boundary.settle.after"] },
    ],
    ...(group ? { group: {} } : {}),
    defaultEnabled: false,
    trust: { level: "user" },
  });
}

interface RigOptions {
  readonly devMode?: boolean;
  /** 설치된 확장(폴더와 매니페스트). `group`이 참이면 플러그인 그룹이다 */
  readonly installed?: readonly { readonly name: string; readonly group: boolean }[];
  /** 실린(등록된) 확장 이름. 등록이 있어야 Test run이 켤 수 있다 */
  readonly loaded?: readonly string[];
  readonly runner?: ReplayRunner;
  readonly profiles?: ProfileTestRunPort;
  readonly removeFails?: boolean;
  readonly corruptStore?: boolean;
  readonly testIds?: readonly string[];
}

interface Rig {
  readonly port: ReturnType<typeof createDevkitPort>;
  readonly configDir: string;
  readonly storePath: string;
  readonly created: {
    readonly workspace?: string;
    readonly title?: string;
    readonly testRun?: boolean;
  }[];
  readonly removed: ThreadId[];
  readonly toggles: {
    readonly id: string;
    readonly enabled: boolean;
    readonly threadId: ThreadId | undefined;
  }[];
  readonly logs: { readonly message: string; readonly fields: Readonly<Record<string, unknown>> }[];
}

let rigCount = 0;
async function rig(options: RigOptions = {}): Promise<Rig> {
  rigCount += 1;
  const dir = join(root, `rig-${String(rigCount)}`);
  const configDir = join(dir, "config");
  const extensionsDir = join(dir, "extensions");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(extensionsDir, { recursive: true });
  for (const item of options.installed ?? []) {
    const folder = join(extensionsDir, item.name, ".fresnel-plugin");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "plugin.json"), manifestOf(item.name, item.group));
  }
  const storePath = join(configDir, "ext-tests.json");
  if (options.corruptStore === true) writeFileSync(storePath, "{ broken");
  mkdirSync(join(dir, "os"), { recursive: true });
  const lock = await openFileLock(join(dir, "os"));
  locks.push(lock);
  // 프로필을 주지 않은 시험도 표지를 달 수 있게 빈 프로필 포트를 쓴다(applyProfile은 호출되지 않는다)
  const defaultProfiles = partial<ProfileTestRunPort>({
    getProfile: (id) => Promise.resolve(err({ kind: "not_found", id })),
    registerTestRun: () => undefined,
  });
  const created: Rig["created"][number][] = [];
  const removed: ThreadId[] = [];
  const toggles: Rig["toggles"][number][] = [];
  const logs: Rig["logs"][number][] = [];
  const ids = [...(options.testIds ?? [])];
  let nextId = 0;
  const settings: Readonly<Record<string, unknown>> = {
    "l3.authoring.devMode": options.devMode === true,
  };
  const deps = partial<M4PortDeps>({
    extUi: partial<ExtUiVersionSource>({ extensionsDir }),
    threads: {
      exists: () => ok(true),
      create: (input) => {
        created.push(input);
        return Promise.resolve({ threadId: THREAD });
      },
      remove: (threadId) => {
        removed.push(threadId);
        return Promise.resolve(
          options.removeFails === true ? err({ kind: "busy" }) : ok(undefined),
        );
      },
    },
    log: {
      error: (message, fields) => {
        logs.push({ message, fields });
      },
    },
    env: partial<M4HostEnv>({
      configDir,
      fileLock: lock.fileLock,
      signal: new AbortController().signal,
      clock: { now: () => CLOCK_MS },
      settingValue: (key) => settings[key],
      registrations: () =>
        (options.loaded ?? []).map((extension) =>
          partial<RegistrationInfo>({ id: `reg-${extension}`, extension }),
        ),
      toggles: partial<M4HostEnv["toggles"]>({
        request: (id, enabled, _reason, threadId) => {
          toggles.push({ id, enabled, threadId });
        },
      }),
    }),
  });
  const port = createDevkitPort(deps, {
    profiles: options.profiles ?? defaultProfiles,
    ...(options.runner === undefined ? {} : { replay: options.runner }),
    newTestId: () => {
      const given = ids.shift();
      if (given !== undefined) return given;
      nextId += 1;
      return `t-${String(nextId)}`;
    },
  });
  return { port, configDir, storePath, created, removed, toggles, logs };
}

/** 실제 하니스로 스모크 그룹(턴 두 번, 후속 요청 없음)을 재생하는 실행기. 시험 파일에서만 쓴다(DR-08) */
const realRunner: ReplayRunner = {
  run: async (input) =>
    ok(
      await replayDrive({
        group: smokeGroup({ driveTurns: 2, followUps: 0 }).module,
        harness: createRuntimeReplayHarness(),
        maxCommits: input.maxCommits,
      }),
    ),
};

const GROUP = [
  { name: "demo-group", group: true },
  { name: "demo-plugin", group: false },
];

test("replay is refused as dev_mode_required when dev mode is off, and records nothing", async () => {
  const session = await rig({ devMode: false, installed: GROUP, runner: realRunner });
  expect(await session.port.testRun({ kind: "replay", target: "demo-group" })).toEqual(
    err({ kind: "dev_mode_required", message: "replay runs only in development mode" }),
  );
  expect(await session.port.testList()).toEqual(ok({ tests: [] }));
});

test("replay of a target that is not installed is not_found, and of a plugin without a group is invalid_input; neither records", async () => {
  const session = await rig({ devMode: true, installed: GROUP, runner: realRunner });
  expect(await session.port.testRun({ kind: "replay", target: "missing" })).toEqual(
    err({ kind: "not_found", message: "missing is not installed" }),
  );
  expect(await session.port.testRun({ kind: "replay", target: "demo-plugin" })).toEqual(
    err({
      kind: "invalid_input",
      message: "demo-plugin is not a plugin group (its manifest has no group)",
    }),
  );
  expect(await session.port.testList()).toEqual(ok({ tests: [] }));
});

test("replay with the default runner: a group folder without its entry is not_found, and the run is recorded failed with no report", async () => {
  // 시험 폴더에는 매니페스트만 있고 엔트리 파일이 없다. 기본 실행기(`runInstalledReplay`)가 그 자리에서 거절한다
  const session = await rig({ devMode: true, installed: GROUP });
  expect(await session.port.testRun({ kind: "replay", target: "demo-group" })).toEqual(
    err({ kind: "not_found", message: "entry ./src/index.ts does not exist" }),
  );
  expect(await session.port.testList()).toEqual(
    ok({
      tests: [
        {
          testId: "t-1",
          kind: "replay",
          target: "demo-group",
          state: "failed",
          startedAt: "2026-11-04T09:00:00.000Z",
          durationMs: 0,
          threadId: null,
          replay: null,
        },
      ],
    }),
  );
});

test("replay runs the group on the real harness and records the report as passed", async () => {
  const session = await rig({ devMode: true, installed: GROUP, runner: realRunner });
  const run = await session.port.testRun({ kind: "replay", target: "demo-group" });
  expect(run).toEqual(ok({ testId: "t-1", threadId: null }));
  const listed = await session.port.testList();
  expect(listed.ok).toBe(true);
  if (!listed.ok) return;
  const [only] = listed.value.tests;
  expect(listed.value.tests).toHaveLength(1);
  expect(only).toMatchObject({
    testId: "t-1",
    kind: "replay",
    target: "demo-group",
    state: "passed",
    startedAt: "2026-11-04T09:00:00.000Z",
    threadId: null,
  });
  expect(only?.durationMs).toBeGreaterThanOrEqual(0);
  // 두 번 커밋하는 스모크 그룹(turn 두 번)을 한 칸씩 자른 결과다. 모두 같고, 실패 이유가 없다
  expect(only?.replay).toEqual({
    ok: true,
    commits: 2,
    passed: 2,
    firstDiff: null,
    cuts: [
      { commitIndex: 1, equal: true, firstDiff: null },
      { commitIndex: 2, equal: true, firstDiff: null },
    ],
    effects: { turn: 2, spawn: 0, delegate: 0, post: 0 },
    failure: null,
  });
});

test("a replay whose report does not hold is recorded failed with its reason, and the call still returns its id", async () => {
  const report: ReplayRunReport = {
    ok: false,
    commits: 2,
    cuts: [
      { commitIndex: 1, equal: true, firstDiff: null },
      { commitIndex: 2, equal: false, firstDiff: 5 },
    ],
    effects: { turn: 2, spawn: 0, delegate: 0, post: 1 },
    failure: "effects-doubled",
  };
  const session = await rig({
    devMode: true,
    installed: GROUP,
    runner: { run: () => Promise.resolve(ok(report)) },
  });
  expect(await session.port.testRun({ kind: "replay", target: "demo-group" })).toEqual(
    ok({ testId: "t-1", threadId: null }),
  );
  const listed = await session.port.testList();
  expect(listed).toMatchObject({
    ok: true,
    value: {
      tests: [
        {
          state: "failed",
          replay: {
            ok: false,
            commits: 2,
            passed: 1,
            firstDiff: 5,
            effects: { turn: 2, spawn: 0, delegate: 0, post: 1 },
            failure: "effects-doubled",
          },
        },
      ],
    },
  });
});

test("a runner that cannot run the group records the test failed with no report, and the call returns the io error", async () => {
  const session = await rig({
    devMode: true,
    installed: GROUP,
    runner: {
      run: () => Promise.resolve(err({ kind: "io", message: "the entry cannot be read" })),
    },
  });
  expect(await session.port.testRun({ kind: "replay", target: "demo-group" })).toEqual(
    err({ kind: "io", message: "the entry cannot be read" }),
  );
  expect(await session.port.testList()).toEqual(
    ok({
      tests: [
        {
          testId: "t-1",
          kind: "replay",
          target: "demo-group",
          state: "failed",
          startedAt: "2026-11-04T09:00:00.000Z",
          durationMs: 0,
          threadId: null,
          replay: null,
        },
      ],
    }),
  );
});

test("a runner that throws records the test failed and returns io naming the target", async () => {
  const session = await rig({
    devMode: true,
    installed: GROUP,
    runner: {
      run: () => {
        throw new Error("harness exploded");
      },
    },
  });
  const run = await session.port.testRun({ kind: "replay", target: "demo-group" });
  expect(run).toEqual(
    err({ kind: "io", message: "the replay of demo-group threw: harness exploded" }),
  );
  const listed = await session.port.testList();
  expect(listed).toMatchObject({ ok: true, value: { tests: [{ state: "failed", replay: null }] } });
});

test("one replay at a time: a second replay while one runs is denied, and a test run is not held back by it", async () => {
  const gate = Promise.withResolvers<void>();
  const begun = Promise.withResolvers<void>();
  const slow: ReplayRunner = {
    run: async () => {
      begun.resolve();
      await gate.promise;
      return ok({ ok: true, commits: 1, cuts: [{ commitIndex: 1, equal: true, firstDiff: null }] });
    },
  };
  const session = await rig({
    devMode: true,
    installed: GROUP,
    loaded: ["demo-plugin"],
    runner: slow,
  });
  const first = session.port.testRun({ kind: "replay", target: "demo-group" });
  await begun.promise;
  expect(await session.port.testRun({ kind: "replay", target: "demo-group" })).toEqual(
    err({ kind: "denied", message: "another replay is running; replays run one at a time" }),
  );
  expect(await session.port.testRun({ kind: "testRun", target: "demo-plugin" })).toMatchObject({
    ok: true,
    value: { threadId: THREAD },
  });
  gate.resolve();
  expect(await first).toEqual(ok({ testId: "t-1", threadId: null }));
  // 끝난 뒤에는 다시 돌릴 수 있다
  expect(await session.port.testRun({ kind: "replay", target: "demo-group" })).toEqual(
    ok({ testId: "t-3", threadId: null }),
  );
});

test("maxCommits outside 1 to 1000 is invalid_input and records nothing", async () => {
  const session = await rig({ devMode: true, installed: GROUP, runner: realRunner });
  const refusals = await Promise.all(
    [0, 1001, 2.5].map((maxCommits) =>
      session.port.testRun({ kind: "replay", target: "demo-group", options: { maxCommits } }),
    ),
  );
  for (const refusal of refusals) {
    expect(refusal).toEqual(
      err({ kind: "invalid_input", message: "maxCommits must be an integer from 1 to 1000" }),
    );
  }
  expect(await session.port.testList()).toEqual(ok({ tests: [] }));
});

test("a test run opens a thread with the test run mark, enables the target on it and records it running", async () => {
  const session = await rig({ installed: GROUP, loaded: ["demo-plugin"] });
  expect(
    await session.port.testRun({
      kind: "testRun",
      target: "demo-plugin",
      options: { workspace: "/work/a" },
    }),
  ).toEqual(ok({ testId: "t-1", threadId: THREAD }));
  expect(session.created).toEqual([{ workspace: "/work/a", title: "demo-plugin", testRun: true }]);
  expect(session.toggles).toEqual([{ id: "reg-demo-plugin", enabled: true, threadId: THREAD }]);
  expect(session.removed).toEqual([]);
  expect(await session.port.testList()).toEqual(
    ok({
      tests: [
        {
          testId: "t-1",
          kind: "testRun",
          target: "demo-plugin",
          state: "running",
          startedAt: "2026-11-04T09:00:00.000Z",
          durationMs: null,
          threadId: THREAD,
          replay: null,
        },
      ],
    }),
  );
});

test("a test run without options names its thread after the target and records it running with that thread", async () => {
  const session = await rig({ installed: GROUP, loaded: ["demo-plugin"] });
  expect(await session.port.testRun({ kind: "testRun", target: "demo-plugin" })).toEqual(
    ok({ testId: "t-1", threadId: THREAD }),
  );
  expect(session.created).toEqual([{ title: "demo-plugin", testRun: true }]);
  expect(await session.port.testList()).toEqual(
    ok({
      tests: [
        {
          testId: "t-1",
          kind: "testRun",
          target: "demo-plugin",
          state: "running",
          startedAt: "2026-11-04T09:00:00.000Z",
          durationMs: null,
          threadId: THREAD,
          replay: null,
        },
      ],
    }),
  );
});

test("a test run of a target that is installed but not loaded is invalid_input, and no thread is made", async () => {
  const session = await rig({ installed: GROUP, loaded: [] });
  expect(await session.port.testRun({ kind: "testRun", target: "demo-plugin" })).toEqual(
    err({
      kind: "invalid_input",
      message: "demo-plugin is not loaded, so it cannot run in a test run thread",
    }),
  );
  expect(session.created).toEqual([]);
});

test("a test run with a profile that does not exist is not_found and makes no thread", async () => {
  const profiles = partial<ProfileTestRunPort>({
    getProfile: (id) => Promise.resolve(err({ kind: "not_found", id })),
  });
  const session = await rig({ installed: GROUP, loaded: ["demo-plugin"], profiles });
  expect(
    await session.port.testRun({
      kind: "testRun",
      target: "demo-plugin",
      options: { profileId: "p-missing" },
    }),
  ).toEqual(err({ kind: "not_found", message: "profile p-missing is not found" }));
  expect(session.created).toEqual([]);
});

test("a profile that fails to apply removes the new thread, marks nothing and records nothing", async () => {
  const profile = partial<Profile>({ id: "p-1" });
  const profiles = partial<ProfileTestRunPort>({
    getProfile: () => Promise.resolve(ok(profile)),
    applyProfile: () => Promise.resolve(err({ kind: "unknown_extension", name: "demo-plugin" })),
    registerTestRun: () => {
      throw new Error("a failed profile must not mark the thread");
    },
  });
  const session = await rig({ installed: GROUP, loaded: ["demo-plugin"], profiles });
  expect(
    await session.port.testRun({
      kind: "testRun",
      target: "demo-plugin",
      options: { profileId: "p-1" },
    }),
  ).toEqual(err({ kind: "invalid_input", message: "demo-plugin is not installed" }));
  expect(session.removed).toEqual([THREAD]);
  expect(session.toggles).toEqual([]);
  expect(await session.port.testList()).toEqual(ok({ tests: [] }));
});

test("a profile that applies marks the thread with the profile id and enables the target", async () => {
  const profile = partial<Profile>({ id: "p-1" });
  const applied: string[] = [];
  const marked: { readonly threadId: ThreadId; readonly profileId: string | null }[] = [];
  const profiles = partial<ProfileTestRunPort>({
    getProfile: () => Promise.resolve(ok(profile)),
    applyProfile: (request) => {
      applied.push(`${request.id}:${request.layer}`);
      return Promise.resolve(
        ok(partial<ProfileApplyResult>({ written: [], layer: "thread", appliesAt: "now" })),
      );
    },
    registerTestRun: (threadId, profileId) => {
      marked.push({ threadId, profileId });
    },
  });
  const session = await rig({ installed: GROUP, loaded: ["demo-plugin"], profiles });
  expect(
    await session.port.testRun({
      kind: "testRun",
      target: "demo-plugin",
      options: { profileId: "p-1" },
    }),
  ).toMatchObject({ ok: true, value: { threadId: THREAD } });
  expect(applied).toEqual(["p-1:thread"]);
  expect(marked).toEqual([{ threadId: THREAD, profileId: "p-1" }]);
  expect(session.toggles).toEqual([{ id: "reg-demo-plugin", enabled: true, threadId: THREAD }]);
});

test("a record that cannot be begun removes the new thread and returns io", async () => {
  const session = await rig({ installed: GROUP, loaded: ["demo-plugin"], corruptStore: true });
  expect(await session.port.testRun({ kind: "testRun", target: "demo-plugin" })).toEqual(
    err({
      kind: "io",
      message: "ext-tests.json is damaged (not JSON); it is kept as it is",
    }),
  );
  expect(session.removed).toEqual([THREAD]);
  expect(readFileSync(session.storePath, "utf8")).toBe("{ broken");
});

test("a thread that cannot be removed after a failed record is logged and the io error is still returned", async () => {
  const session = await rig({
    installed: GROUP,
    loaded: ["demo-plugin"],
    corruptStore: true,
    removeFails: true,
  });
  const run = await session.port.testRun({ kind: "testRun", target: "demo-plugin" });
  expect(run.ok).toBe(false);
  expect(session.logs).toEqual([
    { message: "ext.test.run.cleanup_failed", fields: { threadId: THREAD, kind: "busy" } },
  ]);
});

test("ext.test.list on a damaged record file is io and leaves the file as it was", async () => {
  const session = await rig({ installed: GROUP, corruptStore: true });
  expect(await session.port.testList()).toEqual(
    err({ kind: "io", message: "ext-tests.json is damaged (not JSON); it is kept as it is" }),
  );
  expect(readFileSync(session.storePath, "utf8")).toBe("{ broken");
});

test("the report mapping keeps the first differing cut, counts equal cuts, defaults the effects and drops thread-mismatch to null", () => {
  const wire = replayReportOf({
    ok: false,
    commits: 3,
    cuts: [
      { commitIndex: 1, equal: true, firstDiff: null },
      { commitIndex: 2, equal: false, firstDiff: 7 },
      { commitIndex: 3, equal: false, firstDiff: 2 },
    ],
    failure: "thread-mismatch",
  });
  expect(wire).toEqual({
    ok: false,
    commits: 3,
    passed: 1,
    firstDiff: 7,
    cuts: [
      { commitIndex: 1, equal: true, firstDiff: null },
      { commitIndex: 2, equal: false, firstDiff: 7 },
      { commitIndex: 3, equal: false, firstDiff: 2 },
    ],
    effects: { turn: 0, spawn: 0, delegate: 0, post: 0 },
    failure: null,
  });
  const exhausted = replayReportOf({
    ok: false,
    commits: 0,
    cuts: [],
    failure: "no-commits",
  });
  expect(exhausted).toMatchObject({ passed: 0, firstDiff: null, failure: "no-commits" });
});
