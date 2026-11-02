import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TestRunControlPort, TraceReadPort } from "@fresnel/contracts/extensions";
import type { ScopeLayer, SettingScope } from "@fresnel/contracts/settings";
import type { ProfileInput } from "@fresnel/contracts/wire";
import type { RegistrationInfo } from "@fresnel/ext-host";
import { isDevMode } from "../../src/assembly/m4/profile-test-run-port.ts";
import type { SettingsStorePort, SettingsWriteFailure } from "../../src/types.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// spec-deltas/t-wb.md §1, §2. 프로필 처리기 6개, trace.turn, testRun.*, thread.create { testRun, profileId }.
// 설정 저장소는 범위별 메모리 대역이고 프로필 파일은 임시 폴더의 실제 파일이다.

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-profile-"));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const KEY_STEPS = "l1.loop.maxSteps";
const KEY_REPEAT = "l1.loop.repeat.enabled";
const KEY_DRIVER = "x.primitives.activeDriver";

interface WriteRecord {
  readonly op: "write" | "reset";
  readonly scope: SettingScope;
  readonly key: string;
  readonly value: unknown;
  readonly threadId: ThreadId | undefined;
}

interface MemorySettings {
  readonly port: Partial<SettingsStorePort>;
  readonly values: ReadonlyMap<SettingScope, Map<string, unknown>>;
  readonly records: WriteRecord[];
}

/** 범위별 메모리 설정. `failWrite`가 실패를 돌려주는 쓰기(op와 키)를 정한다 */
function memorySettings(
  failWrite: (record: WriteRecord) => SettingsWriteFailure | undefined = () => undefined,
): MemorySettings {
  const values = new Map<SettingScope, Map<string, unknown>>([
    ["user", new Map()],
    ["project", new Map()],
    ["launch", new Map()],
  ]);
  const records: WriteRecord[] = [];
  const scopeValues = (scope: SettingScope): Map<string, unknown> => {
    const found = values.get(scope);
    if (found === undefined) throw new Error(`no scope ${scope}`);
    return found;
  };
  return {
    values,
    records,
    port: {
      layers: () =>
        [...values].map(([scope, map]): ScopeLayer => ({ scope, values: new Map(map) })),
      prepare: () => Promise.resolve(),
      write(scope, key, value, threadId) {
        const record: WriteRecord = { op: "write", scope, key, value, threadId };
        records.push(record);
        const failure = failWrite(record);
        if (failure !== undefined) return Promise.resolve(err(failure));
        scopeValues(scope).set(key, value);
        return Promise.resolve(ok(undefined));
      },
      reset(scope, key, threadId) {
        const record: WriteRecord = { op: "reset", scope, key, value: undefined, threadId };
        records.push(record);
        const failure = failWrite(record);
        if (failure !== undefined) return Promise.resolve(err(failure));
        scopeValues(scope).delete(key);
        return Promise.resolve(ok(undefined));
      },
    },
  };
}

function inputOf(over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    id: "review",
    title: "Review",
    enable: [],
    disable: [],
    settings: [],
    driver: null,
    ...over,
  };
}

interface Rig {
  readonly host: FakeHost;
  readonly dir: string;
  readonly memory: MemorySettings;
  readonly toggles: {
    id: string;
    enabled: boolean;
    reason: string;
    threadId: ThreadId | undefined;
  }[];
  readonly removed: ThreadId[];
}

function rigOf(
  options: {
    readonly failWrite?: (record: WriteRecord) => SettingsWriteFailure | undefined;
    readonly registrations?: readonly RegistrationInfo[];
    readonly traceRead?: TraceReadPort;
    readonly testRunControl?: TestRunControlPort;
    readonly settingValue?: (key: string) => unknown;
  } = {},
): Rig {
  const dir = tempDir();
  const memory = memorySettings(options.failWrite);
  const toggles: Rig["toggles"] = [];
  const removed: ThreadId[] = [];
  const host = createFakeHost({
    overrides: {
      settings: memory.port,
      threads: {
        remove: (threadId) => {
          removed.push(threadId);
          return Promise.resolve(ok(undefined));
        },
      },
    },
    profiles: {
      configDir: dir,
      ...(options.traceRead === undefined ? {} : { traceRead: options.traceRead }),
      ...(options.testRunControl === undefined ? {} : { testRunControl: options.testRunControl }),
      env: {
        registrations: () => options.registrations ?? [],
        toggles: {
          scopes: () => [],
          request: (id, enabled, reason, threadId) => {
            toggles.push({ id, enabled, reason, threadId });
          },
        },
        ...(options.settingValue === undefined ? {} : { settingValue: options.settingValue }),
      },
    },
  });
  return { host, dir, memory, toggles, removed };
}

async function connect(rig: Rig) {
  const { connection } = rig.host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function registration(
  id: string,
  extension: string,
  drive: RegistrationInfo["drive"],
): RegistrationInfo {
  return { id, extension, status: "enabled", generation: 1, waiting: [], drive };
}

const INSTALLED = [
  registration("helm", "helm", "registered"),
  registration("account-rotation", "account-rotation", "none"),
];

// ── 저장 ────────────────────────────────────────────────────────────────

test("profile.put creates at rev 1, updates with the matching baseRev and rejects every other baseRev as profile.conflict", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  const created = await connection.request("profile.put", { profile: inputOf(), baseRev: null });
  expect(created.profile).toEqual({
    id: "review",
    title: "Review",
    enable: [],
    disable: [],
    settings: [],
    driver: null,
    updatedAt: "2026-01-05T00:00:00.000Z",
    rev: 1,
  });
  const updated = await connection.request("profile.put", {
    profile: inputOf({ title: "Review 2" }),
    baseRev: 1,
  });
  expect([updated.profile.title, updated.profile.rev]).toEqual(["Review 2", 2]);

  expect(
    await failureOf(connection.request("profile.put", { profile: inputOf(), baseRev: 1 })),
  ).toMatchObject({
    code: 3302,
    data: { kind: "profile.conflict", details: { id: "review", rev: 2, baseRev: 1 } },
  });
  expect(
    await failureOf(connection.request("profile.put", { profile: inputOf(), baseRev: null })),
  ).toMatchObject({ data: { kind: "profile.conflict", details: { rev: 2, baseRev: null } } });
  expect(
    await failureOf(
      connection.request("profile.put", { profile: inputOf({ id: "ghost" }), baseRev: 4 }),
    ),
  ).toMatchObject({
    data: { kind: "profile.conflict", details: { id: "ghost", rev: null, baseRev: 4 } },
  });
  await connection.close();
});

test("profile.list, get and delete read the file; a missing id is profile.notFound and the list rev rises with every write", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  expect(await connection.request("profile.list", {})).toEqual({ profiles: [], rev: 0 });
  await connection.request("profile.put", { profile: inputOf(), baseRev: null });
  await connection.request("profile.put", { profile: inputOf({ id: "second" }), baseRev: null });
  const list = await connection.request("profile.list", {});
  expect(list.profiles.map((profile) => profile.id)).toEqual(["review", "second"]);
  expect(list.rev).toBe(2);
  expect((await connection.request("profile.get", { id: "second" })).profile.id).toBe("second");
  expect(await connection.request("profile.delete", { id: "review" })).toEqual({ rev: 3 });
  expect(
    (await connection.request("profile.list", {})).profiles.map((profile) => profile.id),
  ).toEqual(["second"]);
  expect(await failureOf(connection.request("profile.get", { id: "review" }))).toMatchObject({
    code: 3301,
    data: { kind: "profile.notFound", details: { id: "review" } },
  });
  expect(await failureOf(connection.request("profile.delete", { id: "review" }))).toMatchObject({
    data: { kind: "profile.notFound" },
  });
  await connection.close();
});

test("a corrupted profiles.json is a profile.fileCorrupt value and is never overwritten", async () => {
  const rig = rigOf();
  const file = join(rig.dir, "profiles.json");
  mkdirSync(rig.dir, { recursive: true });
  writeFileSync(file, '{"schemaVersion":1,"profiles":"nope"}');
  const connection = await connect(rig);
  expect(await failureOf(connection.request("profile.list", {}))).toMatchObject({
    code: 3303,
    data: { kind: "profile.fileCorrupt" },
  });
  expect(
    await failureOf(connection.request("profile.put", { profile: inputOf(), baseRev: null })),
  ).toMatchObject({ data: { kind: "profile.fileCorrupt" } });
  expect(readFileSync(file, "utf8")).toBe('{"schemaVersion":1,"profiles":"nope"}');
  await connection.close();
});

// ── 적용 ────────────────────────────────────────────────────────────────

const FULL: ProfileInput = inputOf({
  enable: ["helm"],
  disable: ["account-rotation"],
  settings: [
    { key: KEY_STEPS, value: 5 },
    { key: KEY_REPEAT, value: false },
  ],
  driver: "helm",
});

test("profile.apply writes the extension switches, the settings and the driver to the user layer, and a missing layer means user", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: FULL, baseRev: null });
  const applied = await connection.request("profile.apply", { id: "review" });
  expect(applied).toEqual({
    written: [
      "ext.helm.enabled",
      "ext.account-rotation.enabled",
      KEY_STEPS,
      KEY_REPEAT,
      KEY_DRIVER,
    ],
    layer: "user",
    appliesAt: "now",
  });
  expect(rig.memory.records).toEqual([
    { op: "write", scope: "user", key: "ext.helm.enabled", value: true, threadId: undefined },
    {
      op: "write",
      scope: "user",
      key: "ext.account-rotation.enabled",
      value: false,
      threadId: undefined,
    },
    { op: "write", scope: "user", key: KEY_STEPS, value: 5, threadId: undefined },
    { op: "write", scope: "user", key: KEY_REPEAT, value: false, threadId: undefined },
    { op: "write", scope: "user", key: KEY_DRIVER, value: "helm", threadId: undefined },
  ]);
  await connection.close();
});

test("a failing write restores every key already written: earlier values come back and keys that were absent are reset", async () => {
  const rig = rigOf({
    failWrite: (record) =>
      record.op === "write" && record.key === KEY_REPEAT
        ? { kind: "file_unwritable", path: "/x/settings.json", code: "EACCES" }
        : undefined,
  });
  rig.memory.values.get("user")?.set(KEY_STEPS, 3);
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: FULL, baseRev: null });
  expect(await failureOf(connection.request("profile.apply", { id: "review" }))).toMatchObject({
    data: { kind: "store.io", details: { code: "EACCES" } },
  });
  expect([...(rig.memory.values.get("user") ?? [])]).toEqual([[KEY_STEPS, 3]]);
  expect(rig.memory.records.map((record) => `${record.op}:${record.key}`)).toEqual([
    "write:ext.helm.enabled",
    "write:ext.account-rotation.enabled",
    `write:${KEY_STEPS}`,
    `write:${KEY_REPEAT}`,
    `write:${KEY_STEPS}`,
    "reset:ext.account-rotation.enabled",
    "reset:ext.helm.enabled",
  ]);
  await connection.close();
});

test("when the restore fails too, profile.applyPartial names the keys left written", async () => {
  const rig = rigOf({
    failWrite: (record) => {
      if (record.key === KEY_REPEAT) return { kind: "io", code: "EIO" };
      if (record.op === "reset" && record.key === "ext.account-rotation.enabled") {
        return { kind: "io", code: "EIO" };
      }
      return undefined;
    },
  });
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: FULL, baseRev: null });
  expect(await failureOf(connection.request("profile.apply", { id: "review" }))).toMatchObject({
    code: 3305,
    data: {
      kind: "profile.applyPartial",
      details: { written: ["ext.account-rotation.enabled"], failed: KEY_REPEAT },
    },
  });
  expect([...(rig.memory.values.get("user") ?? [])].map(([key]) => key)).toEqual([
    "ext.account-rotation.enabled",
  ]);
  await connection.close();
});

test("settings the catalog rejects are refused before anything is written", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({
      id: "bad-key",
      settings: [
        { key: KEY_STEPS, value: 1 },
        { key: "l1.nope.missing", value: 1 },
      ],
    }),
    baseRev: null,
  });
  await connection.request("profile.put", {
    profile: inputOf({
      id: "bad-value",
      settings: [
        { key: KEY_STEPS, value: 1 },
        { key: KEY_REPEAT, value: "yes" },
      ],
    }),
    baseRev: null,
  });
  expect(await failureOf(connection.request("profile.apply", { id: "bad-key" }))).toMatchObject({
    data: { kind: "settings.unknownKey", details: { key: "l1.nope.missing" } },
  });
  expect(await failureOf(connection.request("profile.apply", { id: "bad-value" }))).toMatchObject({
    data: { kind: "settings.invalidValue", details: { key: KEY_REPEAT } },
  });
  expect(rig.memory.records).toEqual([]);
  await connection.close();
});

test("an untrusted project refuses a project-layer apply as profile.trustRequired and keeps what it wrote", async () => {
  const rig = rigOf({
    failWrite: (record) =>
      record.scope === "project" ? { kind: "untrusted_project", workspace: "/w" } : undefined,
  });
  const connection = await connect(rig);
  const threadId = rig.host.fake.seedThread();
  await connection.request("profile.put", { profile: FULL, baseRev: null });
  expect(
    await failureOf(
      connection.request("profile.apply", { id: "review", layer: "project", threadId }),
    ),
  ).toMatchObject({
    code: 3304,
    data: { kind: "profile.trustRequired", details: { workspace: "/w" } },
  });
  expect([...(rig.memory.values.get("project") ?? [])]).toEqual([]);
  // project 층은 작업 폴더를 알려면 대화가 있어야 한다
  expect(
    await failureOf(connection.request("profile.apply", { id: "review", layer: "project" })),
  ).toMatchObject({ code: -32602, data: { details: { issues: [{ path: "threadId" }] } } });
  await connection.close();
});

test("the thread layer writes the launch scope and sends per-thread switch requests for the extensions", async () => {
  const rig = rigOf({
    registrations: [
      registration("helm", "helm", "registered"),
      registration("helm/side", "helm", "none"),
      registration("account-rotation", "account-rotation", "none"),
    ],
  });
  const connection = await connect(rig);
  const threadId = rig.host.fake.seedThread();
  await connection.request("profile.put", { profile: FULL, baseRev: null });
  expect(
    await failureOf(connection.request("profile.apply", { id: "review", layer: "thread" })),
  ).toMatchObject({ code: -32602, data: { details: { issues: [{ path: "threadId" }] } } });

  const applied = await connection.request("profile.apply", {
    id: "review",
    layer: "thread",
    threadId,
  });
  expect(applied).toEqual({
    written: [
      "ext.helm.enabled",
      "ext.account-rotation.enabled",
      KEY_STEPS,
      KEY_REPEAT,
      KEY_DRIVER,
    ],
    layer: "thread",
    appliesAt: "nextStepBoundary",
  });
  expect(rig.memory.records.map((record) => [record.scope, record.key, record.threadId])).toEqual([
    ["launch", KEY_STEPS, threadId],
    ["launch", KEY_REPEAT, threadId],
    ["launch", KEY_DRIVER, threadId],
  ]);
  expect(rig.toggles).toEqual([
    { id: "helm", enabled: true, reason: "request", threadId },
    { id: "helm/side", enabled: true, reason: "request", threadId },
    { id: "account-rotation", enabled: false, reason: "request", threadId },
  ]);

  await connection.request("profile.put", {
    profile: inputOf({ id: "ghost", enable: ["ghost"] }),
    baseRev: null,
  });
  expect(
    await failureOf(
      connection.request("profile.apply", { id: "ghost", layer: "thread", threadId }),
    ),
  ).toMatchObject({ data: { kind: "settings.unknownKey", details: { key: "ext.ghost.enabled" } } });
  expect(rig.toggles).toHaveLength(3);
  await connection.close();
});

test("an unknown thread is thread.notFound for apply and preview", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: FULL, baseRev: null });
  const ghost = rig.host.fake.ids.next("thr");
  expect(
    await failureOf(
      connection.request("profile.apply", { id: "review", layer: "thread", threadId: ghost }),
    ),
  ).toMatchObject({ data: { kind: "thread.notFound", details: { threadId: ghost } } });
  expect(
    await failureOf(connection.request("profile.preview", { id: "review", threadId: ghost })),
  ).toMatchObject({ data: { kind: "thread.notFound" } });
  await connection.close();
});

// ── 미리보기 ────────────────────────────────────────────────────────────

test("profile.preview computes the holder and the overrides without writing, and refuses what apply would refuse", async () => {
  const rig = rigOf({
    registrations: [
      registration("helm", "helm", "registered"),
      { ...registration("account-rotation", "account-rotation", "registered"), status: "disabled" },
      registration("plain", "plain", "none"),
    ],
    settingValue: () => null,
  });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({
      enable: ["account-rotation"],
      settings: [{ key: KEY_STEPS, value: 7 }],
      driver: "account-rotation",
    }),
    baseRev: null,
  });
  expect(await connection.request("profile.preview", { id: "review" })).toEqual({
    enabled: ["account-rotation"],
    disabled: [],
    candidates: ["helm", "account-rotation"],
    expectedHolder: "account-rotation",
    overrides: [
      { key: KEY_STEPS, value: 7 },
      { key: KEY_DRIVER, value: "account-rotation" },
    ],
    hookCount: 0,
    layer: "user",
  });
  // 드라이버를 정하지 않으면 이미 켜져 있던 쪽이 먼저다
  await connection.request("profile.put", {
    profile: inputOf({ id: "auto", enable: ["account-rotation"] }),
    baseRev: null,
  });
  expect((await connection.request("profile.preview", { id: "auto" })).expectedHolder).toBe("helm");
  // 켜져 있던 쪽을 끄면 새로 켜지는 쪽만 남는다
  await connection.request("profile.put", {
    profile: inputOf({ id: "swap", enable: ["account-rotation"], disable: ["helm"] }),
    baseRev: null,
  });
  const swapped = await connection.request("profile.preview", { id: "swap" });
  expect([swapped.candidates, swapped.expectedHolder]).toEqual([
    ["account-rotation"],
    "account-rotation",
  ]);
  // 지정한 드라이버가 후보가 아니면 아무도 받지 않는다
  await connection.request("profile.put", {
    profile: inputOf({ id: "named", driver: "plain" }),
    baseRev: null,
  });
  expect((await connection.request("profile.preview", { id: "named" })).expectedHolder).toBeNull();
  await connection.request("profile.put", {
    profile: inputOf({ id: "broken", settings: [{ key: "l1.nope.missing", value: 1 }] }),
    baseRev: null,
  });
  expect(await failureOf(connection.request("profile.preview", { id: "broken" }))).toMatchObject({
    data: { kind: "settings.unknownKey" },
  });
  expect(rig.memory.records).toEqual([]);
  await connection.close();
});

// ── thread.create ───────────────────────────────────────────────────────

test("thread.create { testRun, profileId } applies the profile to the thread layer and marks the thread in thread.list", async () => {
  const rig = rigOf({ registrations: INSTALLED });
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: FULL, baseRev: null });
  const plain = await connection.request("thread.create", {});
  const created = await connection.request("thread.create", { testRun: true, profileId: "review" });
  expect(rig.memory.records.map((record) => [record.scope, record.key, record.threadId])).toEqual([
    ["launch", KEY_STEPS, created.threadId],
    ["launch", KEY_REPEAT, created.threadId],
    ["launch", KEY_DRIVER, created.threadId],
  ]);
  const bare = await connection.request("thread.create", { testRun: true });
  const list = await connection.request("thread.list", {});
  const markers = Object.fromEntries(
    list.threads.map((thread) => [thread.threadId, thread.testRun]),
  );
  expect(markers).toEqual({
    [plain.threadId]: undefined,
    [created.threadId]: { profileId: "review", target: null, paused: false },
    [bare.threadId]: { profileId: null, target: null, paused: false },
  });
  await connection.close();
});

test("thread.create refuses a profile on a plain thread and an unknown profile before it makes a thread", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: FULL, baseRev: null });
  expect(
    await failureOf(connection.request("thread.create", { profileId: "review" })),
  ).toMatchObject({
    code: -32602,
    data: { details: { issues: [{ path: "profileId" }] } },
  });
  expect(
    await failureOf(connection.request("thread.create", { testRun: true, profileId: "ghost" })),
  ).toMatchObject({ data: { kind: "profile.notFound", details: { id: "ghost" } } });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("a profile that fails to apply removes the thread it just created and reports the failure", async () => {
  const rig = rigOf({
    registrations: INSTALLED,
    failWrite: (record) => (record.key === KEY_REPEAT ? { kind: "io", code: "EIO" } : undefined),
  });
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: FULL, baseRev: null });
  expect(
    await failureOf(connection.request("thread.create", { testRun: true, profileId: "review" })),
  ).toMatchObject({ data: { kind: "store.io" } });
  expect(rig.removed).toHaveLength(1);
  expect([...(rig.memory.values.get("launch") ?? [])]).toEqual([]);
  await connection.close();
});

const readerOf = (value: unknown) => (key: string) =>
  key === "l3.authoring.devMode" ? value : "unrelated";

// ── 개발 모드 판정(§3) ───────────────────────────────────────────────────

test("isDevMode is true only when l3.authoring.devMode is the value true", () => {
  expect([true, false, undefined, "true", 1].map((value) => isDevMode(readerOf(value)))).toEqual([
    true,
    false,
    false,
    false,
    false,
  ]);
});
