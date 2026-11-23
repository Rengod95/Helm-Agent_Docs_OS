import { describe, expect, test } from "bun:test";
import { attemptAsync, err, ok, type Result } from "@fresnel/contracts";
import type { PluginCard } from "@fresnel/contracts/extensions";
import type {
  MemberInfo,
  MembersDetachInput,
  MembersDetachResult,
  MembersEditResult,
  MembersMergeInput,
  MembersMergeResult,
} from "@fresnel/contracts/services";
import type { HostConnection, PluginDraftCreateResult } from "@fresnel/contracts/wire";
import type { CommandError } from "../../../src/views/commands.ts";
import { detachToReview, mergeToReview } from "../../../src/views/craft/members/split-source.ts";
import { fakeConnection, type Table } from "../../state/fake-connection.ts";

// 합치기와 떼기의 리뷰 제출 값(AGE-72). 프로필 맥락이 있으면 `originProfileId`와 `profilePlan`이 정확히 실리고, 없으면 `originProfileId` 키가 없다.
// 떼기에서 남는 구성원이 있으면 새 플러그인을 리뷰로 낸 뒤에만 원래 묶음 폴더에서 구성원을 빼고 그 새 판을 낸다.
// 연결은 가짜다. 연결이 던지면 `offline`으로 답한다(앱의 `withConnection`과 같다).

const HASH = `sha256:${"a".repeat(64)}`;
const SOURCE = "/src/group";
const NEW_DIR = "/src/group-lead";
const MERGE_DIR = "/src/merged";

const OFFLINE: CommandError = { kind: "offline" };

function runOn(connection: HostConnection) {
  return async <T>(work: (c: HostConnection) => Promise<T>): Promise<Result<T, CommandError>> => {
    const result = await attemptAsync(() => work(connection));
    return result.ok ? ok(result.value) : err(OFFLINE);
  };
}

function card(name: string): PluginCard {
  return {
    name,
    displayName: name,
    version: "1.0.0",
    purpose: `${name} purpose`,
    description: `${name} description`,
    does: {
      inject: null,
      hook: {
        hooks: [{ name: "guard.tool.before", fold: "chain", position: "tools.before", powers: [] }],
      },
      drive: null,
    },
    enforcement: "advisory",
    runs: { code: true, isolated: true },
    cost: { always: null, drive: null, onDemand: null, toolCount: null, basis: "unknown" },
    health: { state: "ok", lastActiveAt: null, lastError: null },
    origin: { kind: "user" },
    review: { state: "approved", currentHash: "abc123", pendingItemId: null, approvedAt: null },
    usedBy: [],
  };
}

function draftOf(draftId: string, name: string): PluginDraftCreateResult {
  return {
    draftId,
    contentHash: HASH,
    card: card(name),
    info: {
      draftId,
      name,
      contentHash: HASH,
      parent: null,
      createdAt: "2026-11-23T00:00:00Z",
      originThreadId: null,
      label: null,
      submittedItemId: null,
    },
  };
}

function member(id: string, over: Partial<MemberInfo> = {}): MemberInfo {
  return {
    id,
    registrationId: `group/${id}`,
    title: null,
    layer: "plugin",
    hooks: [],
    drives: false,
    defaultEnabled: true,
    blockIds: [],
    injects: [],
    tools: [],
    ...over,
  };
}

const MERGE_INPUT: MembersMergeInput = {
  dirs: ["/src/alpha", "/src/beta"],
  outDir: MERGE_DIR,
  name: "merged",
};

const DETACH_INPUT: MembersDetachInput = {
  dir: SOURCE,
  member: "lead",
  outDir: NEW_DIR,
  name: "group-lead",
  keepDependency: true,
  dependencyKind: "soft",
};

/** 같은 이름이 두 번 나와도 확장 이름은 한 번만 뺀다(`alpha/guard`는 `alpha`의 것) */
const MERGED: MembersMergeResult = {
  outDir: MERGE_DIR,
  name: "merged",
  members: [],
  changedFiles: [],
  issues: [],
  profileMove: [
    { from: "alpha", to: "merged/alpha" },
    { from: "alpha/guard", to: "merged/alpha" },
    { from: "beta", to: "merged/beta" },
  ],
};

const DETACHED: MembersDetachResult = {
  outDir: NEW_DIR,
  name: "group-lead",
  changedFiles: [],
  issues: [],
  profileMove: { from: "group/lead", to: "group-lead" },
};

const EDITED: MembersEditResult = {
  members: [],
  issues: [],
  changedFiles: [],
  entryWiring: "manual",
};

interface EngineScript {
  readonly members?: readonly MemberInfo[];
  /** 원래 묶음 폴더 편집이 거절된다(구성원을 다른 곳이 기대는 경우) */
  readonly editFails?: boolean;
  /** 새 플러그인의 리뷰 제출이 실패한다 */
  readonly newSendFails?: boolean;
  /** 구성원 읽기가 실패한다 */
  readonly readFails?: boolean;
}

function engine(script: EngineScript = {}): Table {
  return {
    "ext.members.read": () =>
      script.readFails === true
        ? Promise.reject(new Error("read failed"))
        : Promise.resolve({ members: script.members ?? [] }),
    "ext.members.merge": () => Promise.resolve(MERGED),
    "ext.members.detach": () => Promise.resolve(DETACHED),
    "ext.members.edit": () =>
      script.editFails === true ? Promise.reject(new Error("refused")) : Promise.resolve(EDITED),
    "plugin.draft.create": ({ dir }) =>
      Promise.resolve(
        dir === SOURCE ? draftOf("drf_bundle", "group") : draftOf("drf_new", "group-lead"),
      ),
    "pluginReview.submitDraft": ({ draftId }) =>
      draftId === "drf_new" && script.newSendFails === true
        ? Promise.reject(new Error("offline"))
        : Promise.resolve({ itemId: draftId === "drf_new" ? "rv_new" : "rv_bundle" }),
  };
}

function paramsOf(
  calls: readonly { readonly method: string; readonly params: unknown }[],
  method: string,
): readonly unknown[] {
  return calls.filter((c) => c.method === method).map((c) => c.params);
}

function methodsOf(calls: readonly { readonly method: string }[]): readonly string[] {
  return calls.map((c) => c.method);
}

describe("합치기 리뷰 제출", () => {
  test("캔버스에서 시작하면 열린 프로필을 원래 프로필로, 빼야 할 원래 플러그인의 확장 이름을(한 번씩) 싣는다", async () => {
    const fake = fakeConnection(engine());
    const out = await mergeToReview(runOn(fake.connection), MERGE_INPUT, { profileId: "default" });
    expect(paramsOf(fake.calls, "pluginReview.submitDraft")).toStrictEqual([
      {
        draftId: "drf_new",
        originProfileId: "default",
        profilePlan: { swapOut: ["alpha", "beta"], placeAfter: null, driveFrom: null },
      },
    ]);
    expect(out).toMatchObject({
      ok: true,
      itemId: "rv_new",
      sendFailed: null,
      bundleItemId: null,
      bundleFailed: null,
    });
  });

  test("프로필 맥락이 없으면(목록이나 상세에서 시작) originProfileId 키 없이 계획만 싣는다", async () => {
    const fake = fakeConnection(engine());
    await mergeToReview(runOn(fake.connection), MERGE_INPUT);
    await mergeToReview(runOn(fake.connection), MERGE_INPUT, { profileId: null });
    const plan = { swapOut: ["alpha", "beta"], placeAfter: null, driveFrom: null };
    expect(paramsOf(fake.calls, "pluginReview.submitDraft")).toStrictEqual([
      { draftId: "drf_new", profilePlan: plan },
      { draftId: "drf_new", profilePlan: plan },
    ]);
  });

  test("합치기는 원래 묶음 폴더를 고치지 않는다(편집과 두 번째 제출이 없다)", async () => {
    const fake = fakeConnection(engine());
    await mergeToReview(runOn(fake.connection), MERGE_INPUT, { profileId: "default" });
    expect(methodsOf(fake.calls)).toEqual([
      "ext.members.merge",
      "plugin.draft.create",
      "pluginReview.submitDraft",
    ]);
  });
});

describe("떼기 리뷰 제출", () => {
  test("구성원이 둘 이상이면 새 플러그인은 원래 묶음 바로 뒤에 들고, 떼는 구성원만 Drive면 Drive도 옮긴다. 원래 폴더에서 그 구성원을 빼고 새 판을 낸다", async () => {
    const fake = fakeConnection(
      engine({
        members: [member("guard"), member("lead", { drives: true }), member("notes")],
      }),
    );
    const out = await detachToReview(runOn(fake.connection), DETACH_INPUT, {
      profileId: "default",
    });
    expect(methodsOf(fake.calls)).toEqual([
      "ext.members.read",
      "ext.members.detach",
      "plugin.draft.create",
      "pluginReview.submitDraft",
      "ext.members.edit",
      "plugin.draft.create",
      "pluginReview.submitDraft",
    ]);
    expect(paramsOf(fake.calls, "pluginReview.submitDraft")).toStrictEqual([
      {
        draftId: "drf_new",
        originProfileId: "default",
        profilePlan: { swapOut: [], placeAfter: "group", driveFrom: "group" },
      },
      { draftId: "drf_bundle" },
    ]);
    expect(paramsOf(fake.calls, "ext.members.edit")).toStrictEqual([
      { dir: SOURCE, ops: [{ kind: "remove", id: "lead" }] },
    ]);
    expect(out).toMatchObject({
      ok: true,
      itemId: "rv_new",
      sendFailed: null,
      bundleItemId: "rv_bundle",
      bundleFailed: null,
    });
  });

  test("떼는 구성원이 Drive가 아니면 Drive는 원래 묶음에 남는다(driveFrom null)", async () => {
    const fake = fakeConnection(
      engine({ members: [member("guard"), member("lead", { drives: true }), member("notes")] }),
    );
    await detachToReview(runOn(fake.connection), { ...DETACH_INPUT, member: "guard" });
    expect(paramsOf(fake.calls, "pluginReview.submitDraft")[0]).toStrictEqual({
      draftId: "drf_new",
      profilePlan: { swapOut: [], placeAfter: "group", driveFrom: null },
    });
  });

  test("떼는 구성원이 Drive여도 남은 구성원 가운데 Drive가 있으면 Drive는 원래 묶음에 남는다(driveFrom null)", async () => {
    const fake = fakeConnection(
      engine({
        members: [
          member("guard"),
          member("lead", { drives: true }),
          member("notes", { drives: true }),
        ],
      }),
    );
    await detachToReview(runOn(fake.connection), DETACH_INPUT);
    expect(paramsOf(fake.calls, "pluginReview.submitDraft")[0]).toStrictEqual({
      draftId: "drf_new",
      profilePlan: { swapOut: [], placeAfter: "group", driveFrom: null },
    });
  });

  test("구성원이 하나뿐이면 묶음이 프로필에서 빠지고(swapOut) 원래 폴더는 건드리지 않는다", async () => {
    const fake = fakeConnection(engine({ members: [member("lead", { drives: true })] }));
    const out = await detachToReview(runOn(fake.connection), DETACH_INPUT, {
      profileId: "default",
    });
    expect(paramsOf(fake.calls, "pluginReview.submitDraft")).toStrictEqual([
      {
        draftId: "drf_new",
        originProfileId: "default",
        profilePlan: { swapOut: ["group"], placeAfter: null, driveFrom: null },
      },
    ]);
    expect(methodsOf(fake.calls)).not.toContain("ext.members.edit");
    expect(out).toMatchObject({ ok: true, bundleItemId: null, bundleFailed: null });
  });

  test("원래 묶음 폴더 편집이 거절되면 새 플러그인 제출은 그대로 두고 알림만 싣는다", async () => {
    const fake = fakeConnection(
      engine({ members: [member("guard"), member("lead")], editFails: true }),
    );
    const out = await detachToReview(runOn(fake.connection), DETACH_INPUT);
    expect(out).toMatchObject({
      ok: true,
      itemId: "rv_new",
      sendFailed: null,
      bundleItemId: null,
      bundleFailed: "desktop.craft.split.bundle.failed",
    });
    expect(paramsOf(fake.calls, "pluginReview.submitDraft")).toStrictEqual([
      { draftId: "drf_new", profilePlan: { swapOut: [], placeAfter: "group", driveFrom: null } },
    ]);
  });

  test("새 플러그인을 리뷰로 못 내면 원래 묶음은 건드리지 않고 그 까닭을 싣는다", async () => {
    const fake = fakeConnection(
      engine({ members: [member("guard"), member("lead")], newSendFails: true }),
    );
    const out = await detachToReview(runOn(fake.connection), DETACH_INPUT);
    expect(out).toMatchObject({
      ok: true,
      itemId: null,
      sendFailed: "desktop.craft.members.fail.offline",
      bundleItemId: null,
      bundleFailed: "desktop.craft.split.bundle.notSent",
    });
    expect(methodsOf(fake.calls)).not.toContain("ext.members.edit");
  });

  test("구성원을 읽지 못하면 떼지 않는다", async () => {
    const fake = fakeConnection(engine({ readFails: true }));
    const out = await detachToReview(runOn(fake.connection), DETACH_INPUT);
    expect(out).toEqual({ ok: false, text: "desktop.craft.members.fail.offline" });
    expect(methodsOf(fake.calls)).toEqual(["ext.members.read"]);
  });
});
