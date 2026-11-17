import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type { TestRunControlPort, TraceReadPort } from "@fresnel/contracts/extensions";
import { WIRE_METHODS, WireError } from "@fresnel/contracts/wire";
import type { ProfileInput } from "@fresnel/contracts/wire";
import type { RegistrationInfo } from "@fresnel/ext-host";
import { isDevMode } from "../../src/assembly/m4/profile-test-run-port.ts";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4 프로필 처리기. 저장은 임시 폴더의 실제 `profiles.json`(v2)이고, 검증은 실제 설정 카탈로그를 쓴다.
// 플러그인 사실(`pluginFacts`)과 열린 대화 수, 설정 값은 시험이 넣는다.

const roots: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "xh-profile-"));
  roots.push(dir);
  return dir;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const PERMISSION = "l1.tools.permissionMode";
const DEMO_FACTS: readonly PluginFact[] = [
  { name: "helm", replaces: [], drives: false, requiredKeys: [] },
  { name: "demo", replaces: [], drives: true, requiredKeys: [] },
];

interface Rig {
  readonly host: FakeHost;
  readonly dir: string;
  readonly removed: ThreadId[];
}

interface RigOptions {
  readonly pluginFacts?: readonly PluginFact[];
  readonly registrations?: readonly RegistrationInfo[];
  readonly traceRead?: TraceReadPort;
  readonly testRunControl?: TestRunControlPort;
  readonly settingValue?: (key: string) => unknown;
  /** 닫히지 않은 대화가 저장한 프로필 id(없으면 null) */
  readonly openThreads?: readonly (string | null)[];
}

function rigOf(options: RigOptions = {}): Rig {
  const dir = tempDir();
  const removed: ThreadId[] = [];
  const host = createFakeHost({
    overrides: {
      threads: {
        remove: (threadId) => {
          removed.push(threadId);
          return Promise.resolve(ok(undefined));
        },
      },
    },
    profiles: {
      configDir: dir,
      pluginFacts: () => options.pluginFacts ?? DEMO_FACTS,
      ...(options.traceRead === undefined ? {} : { traceRead: options.traceRead }),
      ...(options.testRunControl === undefined ? {} : { testRunControl: options.testRunControl }),
      env: {
        registrations: () => options.registrations ?? [],
        openThreadProfiles: () => options.openThreads ?? [],
        openThreadIds: () => [],
        threadProfileId: () => null,
        forcedPlugins: () => [],
        defaultPlugins: () => ["helm"],
        ...(options.settingValue === undefined ? {} : { settingValue: options.settingValue }),
      },
    },
  });
  return { host, dir, removed };
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

function inputOf(over: Partial<ProfileInput> = {}): ProfileInput {
  return {
    id: "review",
    title: "Review",
    plugins: [{ name: "demo" }],
    settings: [],
    driver: null,
    ...over,
  };
}

/** 거절된 저장의 이슈 코드들. 와이어 오류가 아니면 빈 목록이다 */
function issueCodesOf(error: unknown): string[] {
  if (!(error instanceof WireError)) return [];
  const issues = error.data.details?.["issues"];
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue: unknown) =>
    typeof issue === "object" && issue !== null && "code" in issue && typeof issue.code === "string"
      ? [issue.code]
      : [],
  );
}

function profileFileOf(dir: string): unknown {
  return JSON.parse(readFileSync(join(dir, "profiles.json"), "utf8"));
}

// ── 목록과 기본 프로필 ──────────────────────────────────────────────────

test("profile.list starts with the factory default at rev 0 and an empty common set, and writes nothing", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  const listed = await connection.request("profile.list", {});
  expect(listed.rev).toBe(0);
  expect(listed.common).toMatchObject({ plugins: [], settings: [], rev: 0 });
  expect(listed.profiles).toEqual([
    {
      id: "default",
      title: "default",
      builtin: true,
      plugins: [{ name: "helm" }],
      settings: [{ key: PERMISSION, value: "bypass" }],
      driver: null,
      updatedAt: "1970-01-01T00:00:00.000Z",
      rev: 0,
    },
  ]);
  expect((await connection.request("profile.get", { id: "default" })).profile.rev).toBe(0);
  await connection.close();
});

test("the first save of default is accepted at baseRev null, and the file is schemaVersion 2 with the default row", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  const saved = await connection.request("profile.put", {
    profile: inputOf({ id: "default", title: "기본", plugins: [{ name: "helm" }] }),
    baseRev: null,
  });
  expect(saved.profile).toMatchObject({ id: "default", builtin: true, rev: 1 });
  const file = profileFileOf(rig.dir);
  expect(file).toMatchObject({
    schemaVersion: 2,
    common: { plugins: [], settings: [], rev: 0 },
    profiles: [{ id: "default", builtin: true, rev: 1 }],
  });
  await connection.close();
});

// ── 저장과 충돌 ─────────────────────────────────────────────────────────

test("profile.put creates at rev 1, updates with the matching baseRev and rejects every other baseRev as profile.conflict", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  const created = await connection.request("profile.put", { profile: inputOf(), baseRev: null });
  expect(created.profile).toMatchObject({ id: "review", builtin: false, rev: 1, driver: null });
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
      connection.request("profile.put", { profile: inputOf({ id: "default" }), baseRev: 4 }),
    ),
  ).toMatchObject({
    data: { kind: "profile.conflict", details: { id: "default", rev: 0, baseRev: 4 } },
  });
  await connection.close();
});

test("profile.put refuses a profile with an error and stores nothing; the details carry the issues", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  const refused = await failureOf(
    connection.request("profile.put", {
      profile: inputOf({
        plugins: [{ name: "ghost" }],
        driver: "helm",
        settings: [{ key: "ext.demo.missing", value: 1 }],
      }),
      baseRev: null,
    }),
  );
  expect(refused).toMatchObject({
    code: 3307,
    data: { kind: "profile.invalid" },
  });
  expect(issueCodesOf(refused)).toEqual([
    "plugin_unknown",
    "driver_not_in_list",
    "setting_unknown_key",
  ]);
  expect(
    (await connection.request("profile.list", {})).profiles.map((profile) => profile.id),
  ).toEqual(["default"]);
  await connection.close();
});

test("profile.delete removes a profile; the default cannot be deleted and an unknown id is notFound", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: inputOf(), baseRev: null });
  expect(await connection.request("profile.delete", { id: "review" })).toEqual({
    rev: 2,
    reassignedThreads: 0,
  });
  expect(await failureOf(connection.request("profile.get", { id: "review" }))).toMatchObject({
    code: 3301,
    data: { kind: "profile.notFound", details: { id: "review" } },
  });
  expect(await failureOf(connection.request("profile.delete", { id: "default" }))).toMatchObject({
    code: 3308,
    data: { kind: "profile.builtinProtected", details: { id: "default" } },
  });
  expect(await failureOf(connection.request("profile.delete", { id: "review" }))).toMatchObject({
    data: { kind: "profile.notFound" },
  });
  await connection.close();
});

test("profile.delete counts the open threads that reference the profile; a thread on a missing profile counts as default", async () => {
  // review 프로필을 쓰는 열린 대화 둘, 기본을 쓰는 대화 하나, 없는 프로필 gone을 쓰는 대화 하나(기본으로 읽는다)
  const rig = rigOf({ openThreads: ["review", "review", null, "gone"] });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ id: "default", plugins: [{ name: "helm" }] }),
    baseRev: null,
  });
  await connection.request("profile.put", { profile: inputOf(), baseRev: null });
  expect(await connection.request("profile.delete", { id: "review" })).toMatchObject({
    reassignedThreads: 2,
  });
  await connection.close();
});

test("profile.clone copies the plugins and settings into a new profile; a taken id is conflict", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: inputOf(), baseRev: null });
  const cloned = await connection.request("profile.clone", {
    id: "review",
    newId: "review-2",
    title: "Copy",
  });
  expect(cloned.profile).toMatchObject({
    id: "review-2",
    title: "Copy",
    builtin: false,
    plugins: [{ name: "demo" }],
    rev: 1,
  });
  expect(
    await failureOf(
      connection.request("profile.clone", { id: "review", newId: "review", title: "x" }),
    ),
  ).toMatchObject({ data: { kind: "profile.conflict" } });
  expect(
    await failureOf(
      connection.request("profile.clone", { id: "review", newId: "default", title: "x" }),
    ),
  ).toMatchObject({ data: { kind: "profile.builtinProtected" } });
  await connection.close();
});

// ── 공통 묶음 ───────────────────────────────────────────────────────────

test("profile.common.put stores the common set with the matching baseRev and bumps its rev; a wrong baseRev is conflict", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  const put = await connection.request("profile.common.put", {
    common: { plugins: [{ name: "helm" }], settings: [] },
    baseRev: 0,
  });
  expect(put.common).toMatchObject({ plugins: [{ name: "helm" }], rev: 1 });
  expect(put.issues).toEqual([]);
  expect(
    await failureOf(
      connection.request("profile.common.put", {
        common: { plugins: [], settings: [] },
        baseRev: 0,
      }),
    ),
  ).toMatchObject({
    data: { kind: "profile.conflict", details: { id: "common", rev: 1, baseRev: 0 } },
  });
  expect((await connection.request("profile.list", {})).common).toMatchObject({ rev: 1 });
  await connection.close();
});

// ── 미리 보기 ───────────────────────────────────────────────────────────

test("profile.preview of a draft reports the resolved list, unknown cost, the threads using it and the permission change", async () => {
  const rig = rigOf({
    openThreads: [null, null],
    settingValue: (key) => (key === PERMISSION ? "ask" : undefined),
  });
  const connection = await connect(rig);
  const preview = await connection.request("profile.preview", {
    draft: inputOf({
      settings: [{ key: PERMISSION, value: "bypass" }],
      plugins: [{ name: "helm" }, { name: "demo" }],
    }),
  });
  expect(preview.resolved).toEqual([{ name: "helm" }, { name: "demo" }]);
  expect(preview.issues).toEqual([]);
  expect(preview.cost).toEqual({
    total: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    byPlugin: [
      {
        plugin: "helm",
        cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
      },
      {
        plugin: "demo",
        cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
      },
    ],
  });
  expect(preview.permission).toEqual({ from: "ask", to: "bypass" });
  expect(preview.dropsDrive).toBeNull();
  // 초안 id를 저장한 대화가 없으므로 0이다(기본을 쓰는 대화는 초안이 아니라 기본 프로필을 가리킨다)
  expect(preview.threadsUsing).toBe(0);
  await connection.close();
});

test("profile.preview of the stored default counts the open threads and reports the missing required keys as warnings", async () => {
  const rig = rigOf({
    openThreads: [null, "gone"],
    pluginFacts: [
      { name: "helm", replaces: [], drives: false, requiredKeys: ["ext.helm.token"] },
      { name: "demo", replaces: [], drives: true, requiredKeys: [] },
    ],
  });
  const connection = await connect(rig);
  const preview = await connection.request("profile.preview", { id: "default" });
  expect(preview.threadsUsing).toBe(2);
  expect(preview.missingRequired).toEqual([{ plugin: "helm", key: "ext.helm.token" }]);
  expect(preview.issues.map((issue) => issue.code)).toEqual(["required_unset"]);
  expect(await failureOf(connection.request("profile.preview", { id: "ghost" }))).toMatchObject({
    data: { kind: "profile.notFound" },
  });
  await connection.close();
});

test("profile.preview names a plugin the library does not have, and a replaced tool that two plugins claim", async () => {
  const rig = rigOf({
    pluginFacts: [
      { name: "alpha", replaces: ["web.fetch"], drives: false, requiredKeys: [] },
      { name: "beta", replaces: ["web.fetch"], drives: false, requiredKeys: [] },
    ],
  });
  const connection = await connect(rig);
  const preview = await connection.request("profile.preview", {
    draft: inputOf({ plugins: [{ name: "alpha" }, { name: "beta" }, { name: "ghost" }] }),
  });
  expect(preview.issues).toEqual([
    { code: "plugin_unknown", severity: "error", plugin: "ghost" },
    {
      code: "replace_conflict",
      severity: "error",
      plugin: "beta",
      other: "alpha",
      tool: "web.fetch",
    },
  ]);
  await connection.close();
});

// ── 플러그인 빼기와 기본 값 되돌리기 ─────────────────────────────────────

test("profile.removePlugin drops the plugin and clears it as the driver; a plugin not in the profile is refused and a stale baseRev is conflict", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ plugins: [{ name: "helm" }, { name: "demo" }], driver: "demo" }),
    baseRev: null,
  });
  const removed = await connection.request("profile.removePlugin", {
    id: "review",
    plugin: "demo",
    baseRev: 1,
  });
  expect(removed.profile).toMatchObject({ plugins: [{ name: "helm" }], driver: null, rev: 2 });
  expect(removed.preview).toEqual({ threadsUsing: 0, dropsDrive: null });
  expect(
    await failureOf(
      connection.request("profile.removePlugin", { id: "review", plugin: "demo", baseRev: 2 }),
    ),
  ).toMatchObject({ data: { kind: "profile.pluginNotInProfile", details: { name: "demo" } } });
  expect(
    await failureOf(
      connection.request("profile.removePlugin", { id: "review", plugin: "helm", baseRev: 1 }),
    ),
  ).toMatchObject({ data: { kind: "profile.conflict" } });
  await connection.close();
});

test("profile.default.reset previews the change without writing, then removes the stored default so the factory values return", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ id: "default", plugins: [{ name: "helm" }, { name: "demo" }] }),
    baseRev: null,
  });
  const previewed = await connection.request("profile.default.reset", { preview: true });
  // 저장된 기본은 공장 값과 다르다(플러그인 목록과 설정 값이 모두 다르다)
  expect(previewed.changed).toEqual({ plugins: true, settings: true });
  expect(previewed.profile.plugins).toEqual([{ name: "helm" }, { name: "demo" }]);
  expect((await connection.request("profile.get", { id: "default" })).profile.rev).toBe(1);

  const reset = await connection.request("profile.default.reset", {});
  expect(reset.profile).toMatchObject({ id: "default", rev: 0, plugins: [{ name: "helm" }] });
  expect((await connection.request("profile.get", { id: "default" })).profile.rev).toBe(0);
  await connection.close();
});

test("profile.defaultFor is default: no thread binds another profile yet", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  expect(await connection.request("profile.defaultFor", { workspace: "/w" })).toEqual({
    profileId: "default",
  });
  await connection.close();
});

// ── 손상된 파일 ─────────────────────────────────────────────────────────

test("a corrupted profiles.json is a profile.fileCorrupt value and is never overwritten; the default factory values stay readable", async () => {
  const rig = rigOf();
  const file = join(rig.dir, "profiles.json");
  mkdirSync(rig.dir, { recursive: true });
  writeFileSync(file, '{"schemaVersion":3,"profiles":"nope"}');
  const connection = await connect(rig);
  expect(await failureOf(connection.request("profile.list", {}))).toMatchObject({
    code: 3303,
    data: { kind: "profile.fileCorrupt" },
  });
  expect((await connection.request("profile.get", { id: "default" })).profile.id).toBe("default");
  expect(await failureOf(connection.request("profile.get", { id: "review" }))).toMatchObject({
    data: { kind: "profile.fileCorrupt" },
  });
  expect(
    await failureOf(connection.request("profile.put", { profile: inputOf(), baseRev: null })),
  ).toMatchObject({ data: { kind: "profile.fileCorrupt" } });
  expect(readFileSync(file, "utf8")).toBe('{"schemaVersion":3,"profiles":"nope"}');
  await connection.close();
});

// ── 대화 쪽 ─────────────────────────────────────────────────────────────

test("thread.create takes the default profile id without testRun and returns it; an unknown profile is notFound before a thread is made", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  const created = await connection.request("thread.create", { profileId: "default" });
  expect(created.profileId).toBe("default");
  expect(
    await failureOf(connection.request("thread.create", { profileId: "ghost" })),
  ).toMatchObject({ data: { kind: "profile.notFound", details: { id: "ghost" } } });
  const plain = await connection.request("thread.create", {});
  expect(plain.profileId).toBe("default");
  expect(
    (await connection.request("thread.list", {})).threads.map((thread) => thread.profileId),
  ).toEqual(["default", "default"]);
  await connection.close();
});

test("thread.create with a stored profile binds the thread to it, and the list shows that profile", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", { profile: inputOf(), baseRev: null });
  const created = await connection.request("thread.create", { profileId: "review" });
  expect(created.profileId).toBe("review");
  expect((await connection.request("thread.list", {})).threads.map((t) => t.profileId)).toEqual([
    "review",
  ]);
  await connection.close();
});

test("thread.create with a profile that is not stored is profile.notFound and makes no thread", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  expect(
    await failureOf(connection.request("thread.create", { profileId: "review" })),
  ).toMatchObject({ data: { kind: "profile.notFound" } });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("thread.setProfile switches the binding and previews the permission change; an unknown profile is notFound and keeps the old binding", async () => {
  const rig = rigOf({ settingValue: (key) => (key === PERMISSION ? "ask" : undefined) });
  const connection = await connect(rig);
  const thread = await connection.request("thread.create", {});
  await connection.request("profile.put", { profile: inputOf(), baseRev: null });
  const switched = await connection.request("thread.setProfile", {
    threadId: thread.threadId,
    profileId: "review",
  });
  expect(switched.position.seq).toBeGreaterThan(thread.position.seq);
  expect((await connection.request("thread.list", {})).threads.map((t) => t.profileId)).toEqual([
    "review",
  ]);
  expect(
    await failureOf(
      connection.request("thread.setProfile", { threadId: thread.threadId, profileId: "ghost" }),
    ),
  ).toMatchObject({ data: { kind: "profile.notFound" } });
  expect((await connection.request("thread.list", {})).threads.map((t) => t.profileId)).toEqual([
    "review",
  ]);
  await connection.close();
});

// ── 제거된 메서드 ───────────────────────────────────────────────────────

test("profile.apply and the ext install and remove methods are not in the wire registry", () => {
  const registered: Record<string, unknown> = WIRE_METHODS;
  for (const removed of [
    "profile.apply",
    "ext.install",
    "ext.installPreview",
    "ext.remove",
    "ext.removePreview",
  ]) {
    expect(Object.hasOwn(registered, removed)).toBe(false);
  }
  for (const added of [
    "profile.list",
    "profile.common.put",
    "profile.defaultFor",
    "thread.setProfile",
  ]) {
    expect(Object.hasOwn(registered, added)).toBe(true);
  }
});

// ── Test run ────────────────────────────────────────────────────────────

test("thread.create { testRun } marks the thread with the profile id and thread.list shows the marker", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  const plain = await connection.request("thread.create", {});
  const created = await connection.request("thread.create", {
    testRun: true,
    profileId: "default",
  });
  const bare = await connection.request("thread.create", { testRun: true });
  const list = await connection.request("thread.list", {});
  const markers = Object.fromEntries(
    list.threads.map((thread) => [thread.threadId, thread.testRun]),
  );
  expect(markers).toEqual({
    [plain.threadId]: undefined,
    [created.threadId]: { profileId: "default", target: null, paused: false },
    [bare.threadId]: { profileId: null, target: null, paused: false },
  });
  await connection.close();
});

test("isDevMode is true only when l3.authoring.devMode is the value true", () => {
  expect(isDevMode((key) => (key === "l3.authoring.devMode" ? true : undefined))).toBe(true);
  expect(isDevMode((key) => (key === "l3.authoring.devMode" ? "true" : undefined))).toBe(false);
  expect(isDevMode(() => undefined)).toBe(false);
});
