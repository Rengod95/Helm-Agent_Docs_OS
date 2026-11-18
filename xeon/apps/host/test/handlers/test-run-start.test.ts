import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@fresnel/contracts";
import type { DraftInfo } from "@fresnel/contracts/wire";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import type { DeclaredInventory } from "../../src/assembly/m4/profile-cost.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";

// M5c §4.8.1 `testRun.start`(처리기 값 시험). 프로필 저장은 실제 프로필 포트가, 엔진과 초안 목록은 가짜가 한다.
// 시험하는 것: 기준 프로필로 대화를 만들고 표지를 다는 것, 검사가 대화를 만들기 전에 거절하는 것, 초안이 있으면 P1 전 게이트다.

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const NONE: DeclaredInventory = {
  code: false,
  root: "/nonexistent",
  tools: [],
  instructions: [],
  skills: [],
};

/** 플러그인 사실을 시험 중에 바꿀 수 있게 가변 목록을 든다. 처음에는 공장 기본의 `helm`과 `demo`다 */
function rigOf(): {
  readonly host: FakeHost;
  readonly facts: PluginFact[];
  readonly drafts: DraftInfo[];
} {
  const dir = mkdtempSync(join(tmpdir(), "xh-test-run-start-"));
  roots.push(dir);
  const facts: PluginFact[] = [
    { name: "helm", replaces: [], drives: false, requiredKeys: [], declared: NONE },
    { name: "demo", replaces: [], drives: false, requiredKeys: [], declared: NONE },
  ];
  const drafts: DraftInfo[] = [];
  const host = createFakeHost({
    profiles: {
      configDir: dir,
      pluginFacts: () => facts,
    },
    overrides: {
      plugins: {
        draftList: (name) =>
          Promise.resolve(ok({ drafts: drafts.filter((draft) => draft.name === name) })),
      },
    },
  });
  return { host, facts, drafts };
}

async function connect(host: FakeHost) {
  const { connection } = host.connect();
  await connection.request("host.hello", HELLO_PARAMS);
  return connection;
}

function failureOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => undefined,
    (error: unknown) => error,
  );
}

function draftOf(over: Partial<DraftInfo> = {}): DraftInfo {
  return {
    draftId: "draft-1",
    name: "demo",
    contentHash: "sha256:0123456789abcdef",
    parent: null,
    createdAt: "2026-11-18T00:00:00.000Z",
    originThreadId: null,
    label: null,
    submittedItemId: null,
    ...over,
  };
}

test("testRun.start with no drafts makes a test-run thread on the base profile, and the marker carries the run group", async () => {
  const { host } = rigOf();
  const connection = await connect(host);
  const before = await connection.request("profile.get", { id: "default" });
  const started = await connection.request("testRun.start", {
    baseProfileId: "default",
    drafts: [],
    runGroupId: "grp-a",
  });
  expect(started).toEqual({
    threadId: expect.any(String),
    profileId: "default",
    drafts: [],
    runGroupId: "grp-a",
  });
  const listed = await connection.request("thread.list", {});
  expect(
    listed.threads.map((thread) => [thread.threadId, thread.profileId, thread.testRun]),
  ).toEqual([
    [
      started.threadId,
      "default",
      { profileId: "default", target: null, paused: false, runGroupId: "grp-a" },
    ],
  ]);
  // 기준 프로필의 저장된 값은 바뀌지 않는다
  expect(await connection.request("profile.get", { id: "default" })).toEqual(before);
  await connection.close();
});

test("a run group id is generated when none is given, and two starts get different ids", async () => {
  const { host } = rigOf();
  const connection = await connect(host);
  const first = await connection.request("testRun.start", { drafts: [] });
  const second = await connection.request("testRun.start", { drafts: [] });
  expect(first.profileId).toBe("default");
  expect(first.runGroupId).toMatch(/^trg-[0-9a-f-]{36}$/u);
  expect(second.runGroupId).not.toBe(first.runGroupId);
  await connection.close();
});

test("a base profile that is not stored is profile.notFound and creates no thread", async () => {
  const { host } = rigOf();
  const connection = await connect(host);
  expect(
    await failureOf(connection.request("testRun.start", { baseProfileId: "ghost", drafts: [] })),
  ).toMatchObject({ code: 3301, data: { kind: "profile.notFound", details: { id: "ghost" } } });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("the hidden craft profile cannot be the base, and an ordinary thread.create refuses it the same way", async () => {
  const { host } = rigOf();
  const connection = await connect(host);
  expect(
    await failureOf(connection.request("testRun.start", { baseProfileId: "craft", drafts: [] })),
  ).toMatchObject({ code: 3301, data: { kind: "profile.notFound" } });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("more than four drafts is overlay.limit and creates no thread", async () => {
  const { host } = rigOf();
  const connection = await connect(host);
  const drafts = Array.from({ length: 5 }, (_, index) => ({
    plugin: "demo",
    draftId: `draft-${index}`,
  }));
  expect(await failureOf(connection.request("testRun.start", { drafts }))).toMatchObject({
    code: 3613,
    data: { kind: "overlay.limit" },
  });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("a base profile that is invalid now is profile.invalid with the issues, and creates no thread or profile change", async () => {
  const { host, facts } = rigOf();
  const connection = await connect(host);
  await connection.request("profile.put", {
    profile: {
      id: "work",
      title: "Work",
      plugins: [{ name: "demo" }],
      settings: [],
      startDrive: null,
    },
    baseRev: null,
  });
  const stored = await connection.request("profile.get", { id: "work" });
  // 저장한 뒤 플러그인이 사라졌다: 같은 프로필이 이제 검증에서 오류가 난다
  facts.splice(
    facts.findIndex((fact) => fact.name === "demo"),
    1,
  );
  const refused = await failureOf(
    connection.request("testRun.start", { baseProfileId: "work", drafts: [] }),
  );
  expect(refused).toMatchObject({ code: 3307, data: { kind: "profile.invalid" } });
  expect(refused).toMatchObject({
    data: { details: { issues: [{ code: "plugin_unknown", severity: "error", plugin: "demo" }] } },
  });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  expect(await connection.request("profile.get", { id: "work" })).toEqual(stored);
  await connection.close();
});

test("a draft the plugin does not list is draft.notFound and creates no thread", async () => {
  const { host } = rigOf();
  const connection = await connect(host);
  expect(
    await failureOf(
      connection.request("testRun.start", { drafts: [{ plugin: "demo", draftId: "draft-x" }] }),
    ),
  ).toMatchObject({ code: 3616, data: { kind: "draft.notFound", details: { id: "draft-x" } } });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("a draft that exists is refused with overlay.draftUnavailable until the isolation step exists, and creates no thread", async () => {
  const { host, drafts } = rigOf();
  drafts.push(draftOf());
  const connection = await connect(host);
  expect(
    await failureOf(
      connection.request("testRun.start", { drafts: [{ plugin: "demo", draftId: "draft-1" }] }),
    ),
  ).toMatchObject({ code: 3615, data: { kind: "overlay.draftUnavailable" } });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});
