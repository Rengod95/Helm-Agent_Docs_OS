import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { err, ok } from "@fresnel/contracts";
import type { DraftInfo } from "@fresnel/contracts/wire";
import type { LoadInstalledStarted } from "@fresnel/ext-host";
import type { FixedDraftMark } from "../../src/assembly/m4/plugin-set.ts";
import { createDraftLoader, type DraftLoaderPort } from "../../src/assembly/plugins/draft-load.ts";
import type { DraftRef, OverlayTarget } from "../../src/assembly/plugins/overlay.ts";
import { createTestRunDrafts } from "../../src/assembly/plugins/test-run-drafts.ts";
import type { PluginFact } from "../../src/assembly/m4/plugin-fact.ts";
import type { DeclaredInventory } from "../../src/assembly/m4/profile-cost.ts";
import { createFakeHost, type FakeHost } from "../fixtures/fake-host.ts";
import { HELLO_PARAMS } from "../fixtures/wire-client.ts";
import { invalidParams, partial } from "../fixtures/unsafe.ts";

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

/** 초안 싣기 대역이 기록하는 것: 싣기 요청, 묶인 구성. 시험이 싣기를 실패시키거나 프로젝트 동반 플러그인으로 바꾼다 */
interface DraftFakes {
  /** 싣기 요청(`플러그인:초안 id`) */
  readonly loads: string[];
  /** 대화에 묶인 고정 초안(대화 id마다) */
  readonly bound: {
    readonly threadId: string;
    readonly marks: readonly FixedDraftMark[];
    /** 묶을 때 넘긴 승인 방식. `auto`가 아니면 `undefined`다(= `ask`) */
    readonly approval?: "auto" | undefined;
  }[];
  /** 참이면 싣기가 격리 포트 없음으로 실패한다 */
  failLoad: boolean;
  /** 참이면 초안 플러그인, 프로젝트 동반 플러그인이다 */
  project: boolean;
  /** 참이면 싣은 초안에 시작 Drive 등록이 없다 */
  noDrive: boolean;
}

/** 플러그인 사실을 시험 중에 바꿀 수 있게 가변 목록을 든다. 처음에는 공장 기본의 `helm`과 `demo`다 */
function rigOf(): {
  readonly host: FakeHost;
  readonly facts: PluginFact[];
  readonly drafts: DraftInfo[];
  readonly fakes: DraftFakes;
} {
  const dir = mkdtempSync(join(tmpdir(), "xh-test-run-start-"));
  roots.push(dir);
  const facts: PluginFact[] = [
    { name: "helm", replaces: [], drives: false, requiredKeys: [], declared: NONE },
    { name: "demo", replaces: [], drives: false, requiredKeys: [], declared: NONE },
  ];
  const drafts: DraftInfo[] = [];
  const fakes: DraftFakes = {
    loads: [],
    bound: [],
    failLoad: false,
    project: false,
    noDrive: false,
  };
  // 초안 포트는 실제 구현을 가짜 로더 위에 세운다. 검사, 싣기, 묶기의 값이 실제 경로를 탄다
  const loader: DraftLoaderPort = {
    loadDraft: (input) => {
      fakes.loads.push(`${input.plugin}:${input.draftId}`);
      return Promise.resolve(ok(partial<LoadInstalledStarted>({ appliesAt: "now" })));
    },
    unloadDraft: () => Promise.resolve(true),
    draftOf: () => undefined,
  };
  const failing: DraftLoaderPort = {
    loadDraft: () => Promise.resolve(err({ kind: "isolation_unavailable" })),
    unloadDraft: () => Promise.resolve(false),
    draftOf: () => undefined,
  };
  const loadDrafts = createDraftLoader({
    loader: () => (fakes.failLoad ? failing : loader),
    report: () => undefined,
    timeoutMs: 1_000,
  });
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
      testRunDrafts: createTestRunDrafts({
        targetOf: (name) =>
          Promise.resolve(
            ok<OverlayTarget | undefined>(
              fakes.project
                ? { name, reviewedHash: null, entries: [], addsTools: false, origin: "project" }
                : undefined,
            ),
          ),
        draftOf: (draftId) => {
          const found = drafts.find((draft) => draft.draftId === draftId);
          return Promise.resolve(
            ok<DraftRef | undefined>(
              found === undefined
                ? undefined
                : {
                    name: found.name,
                    draftId: found.draftId,
                    contentHash: found.contentHash,
                    tree: `/drafts/${found.draftId}/tree`,
                  },
            ),
          );
        },
        loadDrafts,
        hasDrive: () => !fakes.noDrive,
        pluginSet: {
          hold: () => Promise.resolve(() => undefined),
          setTestRunDrafts: (threadId, marks, approval) => {
            fakes.bound.push({ threadId, marks, approval });
            return Promise.resolve();
          },
        },
      }),
    },
  });
  return { host, facts, drafts, fakes };
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
    skippedPlugins: [],
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

test("a plugin the default profile first gives but the user deleted is skipped, listed in the result, and the test run starts", async () => {
  const { host, facts } = rigOf();
  const connection = await connect(host);
  // 기본 프로필이 처음 주는 `helm`을 사용자가 지웠다(설치돼 있지 않다)
  facts.splice(
    facts.findIndex((fact) => fact.name === "helm"),
    1,
  );
  const started = await connection.request("testRun.start", { drafts: [], runGroupId: "grp-s" });
  expect(started).toEqual({
    threadId: expect.any(String),
    profileId: "default",
    drafts: [],
    runGroupId: "grp-s",
    skippedPlugins: ["helm"],
  });
  const listed = await connection.request("thread.list", {});
  expect(listed.threads.map((thread) => [thread.threadId, thread.profileId])).toEqual([
    [started.threadId, "default"],
  ]);
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

test("a draft is loaded before the thread exists, the thread is bound to it, and the result names its version", async () => {
  const { host, drafts, fakes } = rigOf();
  drafts.push(draftOf({ contentHash: "sha256:0123456789abcdef" }));
  const connection = await connect(host);
  const started = await connection.request("testRun.start", {
    drafts: [{ plugin: "demo", draftId: "draft-1" }],
    runGroupId: "grp-d",
  });
  // 결과의 초안 줄은 이름, 초안 id, 판 식별자(해시 앞 8자)다(§4.8.1 3)
  expect(started).toEqual({
    threadId: expect.any(String),
    profileId: "default",
    drafts: [{ plugin: "demo", draftId: "draft-1", versionId: "draft:draft-1:01234567" }],
    runGroupId: "grp-d",
    skippedPlugins: [],
  });
  // 싣기는 대화를 만들기 전에 한 번 했고, 묶은 구성은 내부 이름과 검토본 이름을 함께 싣는다
  expect(fakes.loads).toEqual(["demo:draft-1"]);
  expect(fakes.bound).toEqual([
    {
      threadId: started.threadId,
      marks: [
        {
          plugin: "ddraft1-demo",
          draftId: "draft-1",
          contentHash: "sha256:0123456789abcdef",
          replaces: "demo",
        },
      ],
    },
  ]);
  // 표지는 초안을 쓰는 테스트 실행임을 싣는다
  expect(
    (await connection.request("thread.list", {})).threads.map((thread) => thread.testRun),
  ).toEqual([
    {
      profileId: "default",
      target: null,
      paused: false,
      runGroupId: "grp-d",
      kind: "draft",
      draft: true,
    },
  ]);
  await connection.close();
});

test("a draft that cannot be loaded is overlay.draftUnavailable: nothing is bound and no thread is created", async () => {
  const { host, drafts, fakes } = rigOf();
  drafts.push(draftOf());
  fakes.failLoad = true;
  const connection = await connect(host);
  expect(
    await failureOf(
      connection.request("testRun.start", { drafts: [{ plugin: "demo", draftId: "draft-1" }] }),
    ),
  ).toMatchObject({ code: 3615, data: { kind: "overlay.draftUnavailable" } });
  expect(fakes.bound).toEqual([]);
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("two drafts of the same plugin cannot both replace its reviewed version: overlay.draftUnavailable, no thread", async () => {
  const { host, drafts, fakes } = rigOf();
  drafts.push(draftOf({ draftId: "draft-1" }), draftOf({ draftId: "draft-2" }));
  const connection = await connect(host);
  expect(
    await failureOf(
      connection.request("testRun.start", {
        drafts: [
          { plugin: "demo", draftId: "draft-1" },
          { plugin: "demo", draftId: "draft-2" },
        ],
      }),
    ),
  ).toMatchObject({ code: 3615, data: { kind: "overlay.draftUnavailable" } });
  expect(fakes.bound).toEqual([]);
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("a draft of a project companion plugin is overlay.draftUnavailable, as for an overlay", async () => {
  const { host, drafts, fakes } = rigOf();
  drafts.push(draftOf());
  fakes.project = true;
  const connection = await connect(host);
  expect(
    await failureOf(
      connection.request("testRun.start", { drafts: [{ plugin: "demo", draftId: "draft-1" }] }),
    ),
  ).toMatchObject({ code: 3615, data: { kind: "overlay.draftUnavailable" } });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("a draft that names the start entry runs its start Drive: the bound mark says so, and the version is unchanged", async () => {
  const { host, drafts, fakes } = rigOf();
  drafts.push(draftOf());
  const connection = await connect(host);
  const started = await connection.request("testRun.start", {
    drafts: [{ plugin: "demo", draftId: "draft-1", entry: "start" }],
    runGroupId: "grp-s",
  });
  expect(started).toEqual({
    threadId: expect.any(String),
    profileId: "default",
    drafts: [{ plugin: "demo", draftId: "draft-1", versionId: "draft:draft-1:01234567" }],
    runGroupId: "grp-s",
    skippedPlugins: [],
  });
  expect(fakes.bound).toEqual([
    {
      threadId: started.threadId,
      marks: [
        {
          plugin: "ddraft1-demo",
          draftId: "draft-1",
          contentHash: "sha256:0123456789abcdef",
          replaces: "demo",
          startDrive: true,
        },
      ],
    },
  ]);
  await connection.close();
});

test("a start-Drive draft whose loaded plugin has no drive registration is overlay.noEntry: nothing is bound and no thread is created", async () => {
  const { host, drafts, fakes } = rigOf();
  drafts.push(draftOf());
  fakes.noDrive = true;
  const connection = await connect(host);
  expect(
    await failureOf(
      connection.request("testRun.start", {
        drafts: [{ plugin: "demo", draftId: "draft-1", entry: "start" }],
      }),
    ),
  ).toMatchObject({ code: 3614, data: { kind: "overlay.noEntry", details: { name: "demo" } } });
  expect(fakes.bound).toEqual([]);
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("two start-Drive drafts are overlay.draftUnavailable: one conversation has at most one start Drive", async () => {
  const { host, drafts, fakes } = rigOf();
  drafts.push(draftOf({ draftId: "draft-1" }), draftOf({ draftId: "draft-2", name: "helm" }));
  const connection = await connect(host);
  expect(
    await failureOf(
      connection.request("testRun.start", {
        drafts: [
          { plugin: "demo", draftId: "draft-1", entry: "start" },
          { plugin: "helm", draftId: "draft-2", entry: "start" },
        ],
      }),
    ),
  ).toMatchObject({ code: 3615, data: { kind: "overlay.draftUnavailable" } });
  expect(fakes.loads).toEqual([]);
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

// 드래프트 승인 방식(§4.8.1 항목 10 [결정: 2026-11-18 사용자, AGE-56]). `auto`는 묶음과 표지에 실리고, 생략과 `ask`는 싣지 않는다.
// `auto`여도 격리 싣기는 거치므로 싣지 못하면 대화를 만들지 않는다.

test("testRun.start with draftApproval auto binds its drafts with auto and the marker says so; omitted or ask binds without it", async () => {
  const { host, drafts, fakes } = rigOf();
  drafts.push(draftOf());
  const connection = await connect(host);
  const autoRun = await connection.request("testRun.start", {
    drafts: [{ plugin: "demo", draftId: "draft-1" }],
    runGroupId: "grp-auto",
    draftApproval: "auto",
  });
  expect(fakes.bound).toEqual([
    {
      threadId: autoRun.threadId,
      marks: [
        {
          plugin: "ddraft1-demo",
          draftId: "draft-1",
          contentHash: "sha256:0123456789abcdef",
          replaces: "demo",
        },
      ],
      approval: "auto",
    },
  ]);
  const listed = await connection.request("thread.list", {});
  expect(listed.threads.find((thread) => thread.threadId === autoRun.threadId)?.testRun).toEqual({
    profileId: "default",
    target: null,
    paused: false,
    runGroupId: "grp-auto",
    kind: "draft",
    draft: true,
    draftApproval: "auto",
  });

  // 생략은 `ask`다: 묶을 때 `auto`를 싣지 않고 표지에도 없다
  const askRun = await connection.request("testRun.start", {
    drafts: [{ plugin: "demo", draftId: "draft-1" }],
    runGroupId: "grp-ask",
  });
  const explicitAsk = await connection.request("testRun.start", {
    drafts: [{ plugin: "demo", draftId: "draft-1" }],
    runGroupId: "grp-ask-2",
    draftApproval: "ask",
  });
  expect(fakes.bound.map((entry) => entry.approval)).toEqual(["auto", undefined, undefined]);
  expect(fakes.bound.map((entry) => entry.threadId)).toEqual([
    autoRun.threadId,
    askRun.threadId,
    explicitAsk.threadId,
  ]);
  const afterAsk = await connection.request("thread.list", {});
  for (const id of [askRun.threadId, explicitAsk.threadId]) {
    expect(afterAsk.threads.find((thread) => thread.threadId === id)?.testRun).not.toHaveProperty(
      "draftApproval",
    );
  }
  await connection.close();
});

test("draftApproval auto does not skip the isolation: without a loadable draft it is overlay.draftUnavailable and no conversation is made", async () => {
  const { host, drafts, fakes } = rigOf();
  drafts.push(draftOf());
  fakes.failLoad = true;
  const connection = await connect(host);
  expect(
    await failureOf(
      connection.request("testRun.start", {
        drafts: [{ plugin: "demo", draftId: "draft-1" }],
        draftApproval: "auto",
      }),
    ),
  ).toMatchObject({ code: 3615, data: { kind: "overlay.draftUnavailable" } });
  expect(fakes.bound).toEqual([]);
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});

test("draftApproval takes only ask or auto: any other value is an invalid-params refusal and creates no thread", async () => {
  const { host } = rigOf();
  const connection = await connect(host);
  expect(
    await failureOf(
      connection.request("testRun.start", invalidParams({ drafts: [], draftApproval: "always" })),
    ),
  ).toMatchObject({ code: -32602, data: { kind: "jsonrpc.invalidParams" } });
  expect((await connection.request("thread.list", {})).threads).toEqual([]);
  await connection.close();
});
