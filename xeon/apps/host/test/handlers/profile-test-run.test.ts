import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@fresnel/contracts";
import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  DependencyDecl,
  ExtensionManifest,
  TestRunControlPort,
  TraceReadPort,
} from "@fresnel/contracts/extensions";
import { WIRE_METHODS, WireError } from "@fresnel/contracts/wire";
import type { ProfileCostFigures, ProfileInput } from "@fresnel/contracts/wire";
import type { RegistrationInfo } from "@fresnel/ext-host";
import type { CachePolicy } from "@fresnel/contracts/services";
import { isDevMode } from "../../src/assembly/m4/profile-test-run-port.ts";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import type { DeclaredInventory } from "../../src/assembly/m4/profile-cost.ts";
import { fixedIdFactory } from "@fresnel/ext-host/testing";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §3.4 프로필 처리기. 저장은 임시 폴더의 실제 `profiles.json`(v2)이고, 검증은 실제 설정 카탈로그를 쓴다.
// 플러그인 사실(`pluginFacts`)과 열린 대화 수, 설정 값은 시험이 넣는다.

/** 시험용 최소 매니페스트. 의존과 구성원이 없다 */
function manifestStub(name: string): ExtensionManifest {
  return { schemaVersion: 2, name, version: "1.0.0" };
}

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
/** 선언된 재료가 없는 사실. 비용은 0이고 도구는 없다 */
const NONE: DeclaredInventory = {
  code: false,
  root: "/nonexistent",
  tools: [],
  instructions: [],
  skills: [],
};
const DEMO_FACTS: readonly PluginFact[] = [
  {
    name: "helm",
    replaces: [],
    drives: false,
    requiredKeys: [],
    version: "1.0.0",
    manifest: manifestStub("helm"),
    declared: NONE,
  },
  {
    name: "demo",
    replaces: [],
    drives: true,
    requiredKeys: [],
    version: "1.0.0",
    manifest: manifestStub("demo"),
    declared: NONE,
  },
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
  /** 대화가 저장한 프로필 id. 생략하면 모든 대화가 기본을 쓴다 */
  readonly threadProfileId?: (threadId: ThreadId) => string | null;
  /** 닫히지 않은 대화 id */
  readonly openThreadIds?: readonly ThreadId[];
  /** 대화의 주도권 스택에 든 플러그인 이름(코어 제외). 생략하면 비어 있다 */
  readonly driveFramePlugins?: (threadId: ThreadId) => readonly string[];
  /** 오류로 멈춘 확장인가 */
  readonly stopped?: (name: string) => boolean;
  /** 선언된 재료 파일 내용. 생략하면 어떤 파일도 없다 */
  readonly readText?: (path: string) => Promise<string | undefined>;
  /** 대화의 캐시 정책. 생략하면 알 수 없다 */
  readonly cachePolicyOf?: (threadId: ThreadId) => CachePolicy | undefined;
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
      ...(options.readText === undefined ? {} : { readText: options.readText }),
      env: {
        registrations: () => options.registrations ?? [],
        openThreadProfiles: () => options.openThreads ?? [],
        openThreadIds: () => options.openThreadIds ?? [],
        driveFramePlugins: (threadId) => options.driveFramePlugins?.(threadId) ?? [],
        threadProfileId: options.threadProfileId ?? (() => null),
        forcedPlugins: () => [],
        defaultPlugins: () => ["helm"],
        stopped: options.stopped ?? (() => false),
        ...(options.settingValue === undefined ? {} : { settingValue: options.settingValue }),
        ...(options.cachePolicyOf === undefined ? {} : { cachePolicyOf: options.cachePolicyOf }),
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
    startDrive: null,
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
      startDrive: null,
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
  expect(created.profile).toMatchObject({ id: "review", builtin: false, rev: 1, startDrive: null });
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
        startDrive: "helm",
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

// ── 코어 필수 단위(M5c §4.1.17) ──────────────────────────────────────────

/** 코어가 기대는 내장 단위 두 개와 데모 플러그인의 사실. 저장 검증이 목록을 알아야 한다 */
const REQUIRED_FACTS: readonly PluginFact[] = [
  ...DEMO_FACTS,
  {
    name: "cap-workspace",
    replaces: [],
    drives: false,
    requiredKeys: [],
    version: "1.0.0",
    manifest: manifestStub("cap-workspace"),
    declared: NONE,
  },
  {
    name: "cap-dialog",
    replaces: [],
    drives: false,
    requiredKeys: [],
    version: "1.0.0",
    manifest: manifestStub("cap-dialog"),
    declared: NONE,
  },
];

test("a profile edit that drops a core-required unit is plugin.requiredByCore and stores nothing; adding it back is fine", async () => {
  const rig = rigOf({ pluginFacts: REQUIRED_FACTS });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ plugins: [{ name: "helm" }, { name: "cap-workspace" }, { name: "demo" }] }),
    baseRev: null,
  });
  const dropped = await failureOf(
    connection.request("profile.put", {
      profile: inputOf({ plugins: [{ name: "demo" }] }),
      baseRev: 1,
    }),
  );
  expect(dropped).toMatchObject({
    code: 3626,
    data: { kind: "plugin.requiredByCore", details: { plugin: "cap-workspace" } },
  });
  expect(await connection.request("profile.get", { id: "review" })).toMatchObject({
    profile: { rev: 1, plugins: [{ name: "helm" }, { name: "cap-workspace" }, { name: "demo" }] },
  });
  // 같은 목록을 그대로 두는 저장은 거절하지 않는다
  expect(
    await connection.request("profile.put", {
      profile: inputOf({
        plugins: [{ name: "helm" }, { name: "cap-workspace" }, { name: "demo" }],
      }),
      baseRev: 1,
    }),
  ).toMatchObject({ profile: { rev: 2 } });
  await connection.close();
});

test("a profile that never listed a core-required unit may edit freely, and the unit's own removal is refused", async () => {
  const rig = rigOf({ pluginFacts: REQUIRED_FACTS });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ plugins: [{ name: "helm" }] }),
    baseRev: null,
  });
  expect(
    await connection.request("profile.put", {
      profile: inputOf({ plugins: [{ name: "demo" }], startDrive: null }),
      baseRev: 1,
    }),
  ).toMatchObject({ profile: { rev: 2, plugins: [{ name: "demo" }] } });
  await connection.request("profile.put", {
    profile: inputOf({ plugins: [{ name: "helm" }, { name: "cap-dialog" }] }),
    baseRev: 2,
  });
  expect(
    await failureOf(
      connection.request("profile.removePlugin", {
        id: "review",
        plugin: "cap-dialog",
        baseRev: 3,
      }),
    ),
  ).toMatchObject({
    code: 3626,
    data: { kind: "plugin.requiredByCore", details: { plugin: "cap-dialog" } },
  });
  await connection.close();
});

test("profile.common.put refuses to drop a core-required unit from the common set", async () => {
  const rig = rigOf({ pluginFacts: REQUIRED_FACTS });
  const connection = await connect(rig);
  await connection.request("profile.common.put", {
    common: { plugins: [{ name: "cap-workspace" }], settings: [] },
    baseRev: 0,
  });
  expect(
    await failureOf(
      connection.request("profile.common.put", {
        common: { plugins: [], settings: [] },
        baseRev: 1,
      }),
    ),
  ).toMatchObject({
    code: 3626,
    data: { kind: "plugin.requiredByCore", details: { plugin: "cap-workspace" } },
  });
  expect((await connection.request("profile.list", {})).common).toMatchObject({ rev: 1 });
  await connection.close();
});

// ── 미리 보기 ───────────────────────────────────────────────────────────

test("profile.preview of a draft reports the resolved list, the declared cost, the threads using it and the permission change", async () => {
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
  // 두 플러그인 모두 선언된 재료가 없는 비코드 플러그인이라 비용은 0으로 선언되어 있다(§4.2.8)
  const zero: ProfileCostFigures = {
    always: 0,
    drive: null,
    onDemand: 0,
    toolCount: 0,
    basis: "declared",
  };
  expect(preview.cost).toEqual({
    total: zero,
    byPlugin: [
      { plugin: "helm", cost: zero },
      { plugin: "demo", cost: zero },
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
      {
        name: "helm",
        replaces: [],
        drives: false,
        requiredKeys: ["ext.helm.token"],
        version: "1.0.0",
        manifest: manifestStub("helm"),
        declared: NONE,
      },
      {
        name: "demo",
        replaces: [],
        drives: true,
        requiredKeys: [],
        version: "1.0.0",
        manifest: manifestStub("demo"),
        declared: NONE,
      },
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
      {
        name: "alpha",
        replaces: ["web.fetch"],
        drives: false,
        requiredKeys: [],
        version: "1.0.0",
        manifest: manifestStub("alpha"),
        declared: NONE,
      },
      {
        name: "beta",
        replaces: ["web.fetch"],
        drives: false,
        requiredKeys: [],
        version: "1.0.0",
        manifest: manifestStub("beta"),
        declared: NONE,
      },
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

// ── 미리 보기의 비용과 도구 변화(M5c §4.2.8, §3.4, §4.3.7) ──────────────────

const UNKNOWN_COST: ProfileCostFigures = {
  always: null,
  drive: null,
  onDemand: null,
  toolCount: null,
  basis: "unknown",
};

/** 도구 `ping`(이름과 설명 "abcdefgh"는 13글자라 4토큰)을 선언한 코드 플러그인 */
const TOOLY: PluginFact = {
  name: "tooly",
  replaces: [],
  drives: false,
  requiredKeys: [],
  version: "1.0.0",
  manifest: manifestStub("tooly"),
  declared: {
    code: true,
    root: "/ext/tooly",
    tools: [{ name: "ping", description: "abcdefgh" }],
    instructions: [],
    skills: [],
  },
};
/** 도구 `run`, `stop`을 선언한 코드 플러그인 */
const RUNNER: PluginFact = {
  name: "runner",
  replaces: [],
  drives: false,
  requiredKeys: [],
  version: "1.0.0",
  manifest: manifestStub("runner"),
  declared: {
    code: true,
    root: "/ext/runner",
    tools: [
      { name: "run", description: "x" },
      { name: "stop", description: "y" },
    ],
    instructions: [],
    skills: [],
  },
};
/** 코드가 없고 지침 파일과 스킬 하나를 선언한 플러그인 */
const NOTES: PluginFact = {
  name: "notes",
  replaces: [],
  drives: false,
  requiredKeys: [],
  version: "1.0.0",
  manifest: manifestStub("notes"),
  declared: {
    code: false,
    root: "/ext/notes",
    tools: [],
    instructions: ["AGENTS.md"],
    skills: ["skills/a"],
  },
};
/** 코드 플러그인인데 도구를 선언하지 않았다. 비용을 셀 수 없다 */
const BARE: PluginFact = {
  name: "bare",
  replaces: [],
  drives: false,
  requiredKeys: [],
  version: "1.0.0",
  manifest: manifestStub("bare"),
  declared: { code: true, root: "/ext/bare", tools: [], instructions: [], skills: [] },
};
/** 선언한 지침 파일이 없다 */
const GONE: PluginFact = {
  name: "gone",
  replaces: [],
  drives: false,
  requiredKeys: [],
  version: "1.0.0",
  manifest: manifestStub("gone"),
  declared: { code: false, root: "/ext/gone", tools: [], instructions: ["MISSING.md"], skills: [] },
};
const HELM: PluginFact = {
  name: "helm",
  replaces: [],
  drives: false,
  requiredKeys: [],
  version: "1.0.0",
  manifest: manifestStub("helm"),
  declared: NONE,
};

/** 시험의 재료 파일. 글자 수가 정해져 있어 토큰 수를 손으로 셀 수 있다 */
const FILES: ReadonlyMap<string, string> = new Map([
  ["/ext/notes/AGENTS.md", "12345678"],
  // 설명 "abcd"(4글자, 1토큰), 본문 "body12345"(9글자, 3토큰)
  ["/ext/notes/skills/a/SKILL.md", "---\ndescription: abcd\n---\nbody12345"],
]);
const readFixture = (path: string): Promise<string | undefined> => Promise.resolve(FILES.get(path));

function policyOf(midConversationToolChanges: boolean): CachePolicy {
  return {
    retention: "short",
    sessionKey: "thread",
    sites: ["system", "tools", "summary", "tail"],
    maxBreakpoints: 4,
    midConversationSystem: true,
    midConversationToolChanges,
  };
}

test("profile.preview sums the declared cost of tools, instruction files and skills on fixed fixtures", async () => {
  const rig = rigOf({ pluginFacts: [TOOLY, NOTES], readText: readFixture });
  const connection = await connect(rig);
  const preview = await connection.request("profile.preview", {
    draft: inputOf({ plugins: [{ name: "tooly" }, { name: "notes" }] }),
  });
  // tooly: 도구 4토큰. notes: 지침 2토큰, 스킬은 색인 1 + 본문 3이다
  expect(preview.cost).toEqual({
    total: { always: 6, drive: null, onDemand: 4, toolCount: 1, basis: "declared" },
    byPlugin: [
      {
        plugin: "tooly",
        cost: { always: 4, drive: null, onDemand: 0, toolCount: 1, basis: "declared" },
      },
      {
        plugin: "notes",
        cost: { always: 2, drive: null, onDemand: 4, toolCount: 0, basis: "declared" },
      },
    ],
  });
  await connection.close();
});

test("a code plugin without declared tools, or a declared file that cannot be read, is unknown and makes the total unknown", async () => {
  const rig = rigOf({ pluginFacts: [TOOLY, BARE, GONE], readText: readFixture });
  const connection = await connect(rig);
  const withBare = await connection.request("profile.preview", {
    draft: inputOf({ plugins: [{ name: "tooly" }, { name: "bare" }] }),
  });
  expect(withBare.cost).toEqual({
    total: UNKNOWN_COST,
    byPlugin: [
      {
        plugin: "tooly",
        cost: { always: 4, drive: null, onDemand: 0, toolCount: 1, basis: "declared" },
      },
      { plugin: "bare", cost: UNKNOWN_COST },
    ],
  });
  const withGone = await connection.request("profile.preview", {
    draft: inputOf({ plugins: [{ name: "gone" }] }),
  });
  expect(withGone.cost.byPlugin).toEqual([{ plugin: "gone", cost: UNKNOWN_COST }]);
  await connection.close();
});

test("profile.preview with a thread reports the tools the thread would gain, and the cache impact from its policy", async () => {
  const rig = rigOf({ pluginFacts: [TOOLY, RUNNER, HELM], cachePolicyOf: () => policyOf(true) });
  const connection = await connect(rig);
  const thread = await connection.request("thread.create", {});
  await connection.request("profile.put", {
    profile: inputOf({ id: "review", plugins: [{ name: "tooly" }, { name: "runner" }] }),
    baseRev: null,
  });
  // 대화는 기본(helm)을 쓰므로 기준에는 도구가 없다
  const preview = await connection.request("profile.preview", {
    id: "review",
    threadId: thread.threadId,
  });
  expect(preview.toolsChanged).toEqual({ added: ["ping", "run", "stop"], removed: [] });
  expect(preview.cacheImpact).toBe("tool_change_append");
  await connection.close();
});

test("a cache policy without mid-conversation tool changes makes the same tool change a readvertise", async () => {
  const rig = rigOf({ pluginFacts: [TOOLY, RUNNER, HELM], cachePolicyOf: () => policyOf(false) });
  const connection = await connect(rig);
  const thread = await connection.request("thread.create", {});
  await connection.request("profile.put", {
    profile: inputOf({ id: "review", plugins: [{ name: "tooly" }] }),
    baseRev: null,
  });
  const preview = await connection.request("profile.preview", {
    id: "review",
    threadId: thread.threadId,
  });
  expect(preview.toolsChanged).toEqual({ added: ["ping"], removed: [] });
  expect(preview.cacheImpact).toBe("readvertise");
  await connection.close();
});

test("the tools a thread loses are the removed names, measured against the profile the thread uses", async () => {
  const rig = rigOf({
    pluginFacts: [TOOLY, RUNNER, HELM],
    threadProfileId: () => "review",
    cachePolicyOf: () => policyOf(false),
  });
  const connection = await connect(rig);
  const thread = await connection.request("thread.create", {});
  await connection.request("profile.put", {
    profile: inputOf({ id: "review", plugins: [{ name: "tooly" }, { name: "runner" }] }),
    baseRev: null,
  });
  const preview = await connection.request("profile.preview", {
    draft: inputOf({ id: "review", plugins: [{ name: "helm" }] }),
    threadId: thread.threadId,
  });
  expect(preview.toolsChanged).toEqual({ added: [], removed: ["ping", "run", "stop"] });
  expect(preview.cacheImpact).toBe("readvertise");
  await connection.close();
});

test("a preview of the profile the thread already uses reports no tool change and cache impact none", async () => {
  const rig = rigOf({ pluginFacts: [TOOLY, RUNNER, HELM], cachePolicyOf: () => policyOf(true) });
  const connection = await connect(rig);
  const thread = await connection.request("thread.create", {});
  const preview = await connection.request("profile.preview", {
    id: "default",
    threadId: thread.threadId,
  });
  expect(preview).not.toHaveProperty("toolsChanged");
  expect(preview.cacheImpact).toBe("none");
  await connection.close();
});

test("without a thread, the baseline is the stored profile of the same id; a new id has no baseline and reports no tool change", async () => {
  const rig = rigOf({ pluginFacts: [TOOLY, RUNNER, HELM], cachePolicyOf: () => policyOf(true) });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ id: "review", plugins: [{ name: "tooly" }, { name: "runner" }] }),
    baseRev: null,
  });
  const shrunk = await connection.request("profile.preview", {
    draft: inputOf({ id: "review", plugins: [{ name: "tooly" }] }),
  });
  expect(shrunk.toolsChanged).toEqual({ added: [], removed: ["run", "stop"] });
  // 대화가 없으면 캐시 정책을 알 수 없어 cacheImpact를 싣지 않는다
  expect(shrunk.cacheImpact).toBeUndefined();

  const fresh = await connection.request("profile.preview", {
    draft: inputOf({ id: "fresh", plugins: [{ name: "tooly" }] }),
  });
  expect(fresh.toolsChanged).toBeUndefined();
  expect(fresh.cacheImpact).toBeUndefined();
  await connection.close();
});

test("a plugin the runtime has stopped does not contribute its tools to the change", async () => {
  const rig = rigOf({
    pluginFacts: [TOOLY, RUNNER, HELM],
    stopped: (name) => name === "runner",
    cachePolicyOf: () => policyOf(true),
  });
  const connection = await connect(rig);
  const thread = await connection.request("thread.create", {});
  await connection.request("profile.put", {
    profile: inputOf({ id: "review", plugins: [{ name: "tooly" }, { name: "runner" }] }),
    baseRev: null,
  });
  const preview = await connection.request("profile.preview", {
    id: "review",
    threadId: thread.threadId,
  });
  expect(preview.toolsChanged).toEqual({ added: ["ping"], removed: [] });
  await connection.close();
});

test("with no cache policy known for the thread, a tool change omits cacheImpact and keeps toolsChanged", async () => {
  const rig = rigOf({ pluginFacts: [TOOLY, RUNNER, HELM] });
  const connection = await connect(rig);
  const thread = await connection.request("thread.create", {});
  await connection.request("profile.put", {
    profile: inputOf({ id: "review", plugins: [{ name: "tooly" }] }),
    baseRev: null,
  });
  const preview = await connection.request("profile.preview", {
    id: "review",
    threadId: thread.threadId,
  });
  expect(preview.toolsChanged).toEqual({ added: ["ping"], removed: [] });
  expect(preview.cacheImpact).toBeUndefined();
  await connection.close();
});

test("thread.setProfile reports the tool change and the cache impact of the switch it makes", async () => {
  const rig = rigOf({ pluginFacts: [TOOLY, RUNNER, HELM], cachePolicyOf: () => policyOf(true) });
  const connection = await connect(rig);
  const thread = await connection.request("thread.create", {});
  await connection.request("profile.put", {
    profile: inputOf({ id: "review", plugins: [{ name: "tooly" }, { name: "runner" }] }),
    baseRev: null,
  });
  const switched = await connection.request("thread.setProfile", {
    threadId: thread.threadId,
    profileId: "review",
  });
  expect(switched.preview).toEqual({
    toolsChanged: { added: ["ping", "run", "stop"], removed: [] },
    cacheImpact: "tool_change_append",
  });
  await connection.close();
});

test("profile.removePlugin reports the tools the removed plugin took away from the stored profile", async () => {
  const rig = rigOf({ pluginFacts: [TOOLY, RUNNER, HELM] });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ plugins: [{ name: "tooly" }, { name: "runner" }] }),
    baseRev: null,
  });
  const removed = await connection.request("profile.removePlugin", {
    id: "review",
    plugin: "runner",
    baseRev: 1,
  });
  expect(removed.preview).toEqual({
    threadsUsing: 0,
    toolsChanged: { added: [], removed: ["run", "stop"] },
    dropsDrive: null,
  });
  await connection.close();
});

// ── 플러그인 빼기와 기본 값 되돌리기 ─────────────────────────────────────

test("profile.removePlugin drops the plugin and clears it as the startDrive; a plugin not in the profile is refused and a stale baseRev is conflict", async () => {
  const rig = rigOf();
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ plugins: [{ name: "helm" }, { name: "demo" }], startDrive: "demo" }),
    baseRev: null,
  });
  const removed = await connection.request("profile.removePlugin", {
    id: "review",
    plugin: "demo",
    baseRev: 1,
  });
  expect(removed.profile).toMatchObject({ plugins: [{ name: "helm" }], startDrive: null, rev: 2 });
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

/** 다른 플러그인에 `dependsOn`으로 기대는 플러그인의 사실. `drives`면 시작 Drive가 될 수 있다 */
function dependentOf(name: string, dependsOn: DependencyDecl[], drives = false): PluginFact {
  return {
    name,
    version: "1.0.0",
    manifest: {
      schemaVersion: 2,
      name,
      version: "1.0.0",
      plugins: [{ layer: "plugin", hooks: [], dependsOn }],
    },
    replaces: [],
    drives,
    requiredKeys: [],
    declared: NONE,
  };
}

test("profile.removePlugin refuses to drop a plugin a hard dependent still needs; the issue names the dependent and the target, and nothing is stored", async () => {
  const rig = rigOf({
    pluginFacts: [...DEMO_FACTS, dependentOf("lib", [{ plugin: "demo", kind: "hard" }])],
  });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ plugins: [{ name: "helm" }, { name: "demo" }, { name: "lib" }] }),
    baseRev: null,
  });
  expect(
    await failureOf(
      connection.request("profile.removePlugin", { id: "review", plugin: "demo", baseRev: 1 }),
    ),
  ).toMatchObject({
    data: {
      kind: "profile.invalid",
      details: {
        issues: [{ code: "dependency_disabled", severity: "error", plugin: "lib", other: "demo" }],
      },
    },
  });
  const listed = await connection.request("profile.list", {});
  expect(listed.profiles.find((profile) => profile.id === "review")).toMatchObject({
    rev: 1,
    plugins: [{ name: "helm" }, { name: "demo" }, { name: "lib" }],
  });
  await connection.close();
});

test("profile.removePlugin with withDependents drops the plugins that lean on it hard, down the whole chain, in one save; a soft dependent stays and the start drive clears", async () => {
  const rig = rigOf({
    pluginFacts: [
      ...DEMO_FACTS,
      dependentOf("mid", [{ plugin: "demo", kind: "hard" }]),
      dependentOf("top", [{ plugin: "mid", kind: "hard" }], true),
      dependentOf("side", [{ plugin: "demo" }]),
    ],
  });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({
      plugins: [
        { name: "helm" },
        { name: "top" },
        { name: "mid" },
        { name: "demo" },
        { name: "side" },
      ],
      startDrive: "top",
    }),
    baseRev: null,
  });
  const removed = await connection.request("profile.removePlugin", {
    id: "review",
    plugin: "demo",
    baseRev: 1,
    withDependents: true,
  });
  expect(removed.profile).toMatchObject({
    plugins: [{ name: "helm" }, { name: "side" }],
    startDrive: null,
    rev: 2,
  });
  await connection.close();
});

test("a soft dependent does not block the removal of its target, so the plugin is dropped and the dependent is kept", async () => {
  const rig = rigOf({
    pluginFacts: [...DEMO_FACTS, dependentOf("side", [{ plugin: "demo" }])],
  });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ plugins: [{ name: "helm" }, { name: "demo" }, { name: "side" }] }),
    baseRev: null,
  });
  const removed = await connection.request("profile.removePlugin", {
    id: "review",
    plugin: "demo",
    baseRev: 1,
  });
  expect(removed.profile).toMatchObject({ plugins: [{ name: "helm" }, { name: "side" }], rev: 2 });
  await connection.close();
});

test("profile.removePlugin with withDependents is plugin.requiredByCore when a dependent to drop is a core-required unit, and stores nothing", async () => {
  const rig = rigOf({
    pluginFacts: [...DEMO_FACTS, dependentOf("cap-workspace", [{ plugin: "demo", kind: "hard" }])],
  });
  const connection = await connect(rig);
  await connection.request("profile.put", {
    profile: inputOf({ plugins: [{ name: "cap-workspace" }, { name: "demo" }] }),
    baseRev: null,
  });
  expect(
    await failureOf(
      connection.request("profile.removePlugin", {
        id: "review",
        plugin: "demo",
        baseRev: 1,
        withDependents: true,
      }),
    ),
  ).toMatchObject({
    data: { kind: "plugin.requiredByCore", details: { plugin: "cap-workspace" } },
  });
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

test("profile.preview reports the open threads of the profile whose drive stack holds a plugin the new list drops", async () => {
  const thread: ThreadId = fixedIdFactory().next("thr");
  const rig = rigOf({
    openThreads: [null],
    openThreadIds: [thread],
    driveFramePlugins: () => ["demo"],
  });
  const connection = await connect(rig);
  // 기본 프로필을 참조하는 대화가 demo를 주도 중이다. demo를 뺀 새 목록은 그 프레임을 내린다
  const drops = await connection.request("profile.preview", {
    draft: inputOf({ id: "default", plugins: [{ name: "helm" }] }),
  });
  expect(drops.dropsDrive).toEqual({ threadCount: 1 });
  // demo를 남기면 내려갈 프레임이 없다
  const keeps = await connection.request("profile.preview", {
    draft: inputOf({ id: "default", plugins: [{ name: "helm" }, { name: "demo" }] }),
  });
  expect(keeps.dropsDrive).toBeNull();
  // 다른 프로필을 참조하는 대화의 프레임은 세지 않는다
  const other = await connection.request("profile.preview", {
    draft: inputOf({ id: "review", plugins: [{ name: "helm" }] }),
  });
  expect(other.dropsDrive).toBeNull();
  await connection.close();
});
