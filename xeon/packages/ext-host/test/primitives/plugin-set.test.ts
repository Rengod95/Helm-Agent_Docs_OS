import { expect, test } from "bun:test";
import { PluginSetPortKey, type PluginSetPort } from "@fresnel/contracts/extensions";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { registrationToggleSourceOf } from "../../src/primitives/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeManifest, makeUnit } from "./fixtures/support.ts";

// E(T)(M5c §4.1.5, X.primitives.spec §4.5.8)는 호스트가 `PluginSetPortKey`로 주는 집합이다. 시험은 그 값을 바꿔 가며 쓴다.
// 엔진 안의 끄기(`RegistrationHandle.disable`, 자동 끄기·안전 모드)는 E(T)가 바뀌기 전까지 이겨야 한다.

/** 대화 집합을 시험이 바꾸는 포트. 집합과 검토본 해시 말고 값은 고정이다 */
interface PluginSetState {
  plugins: readonly string[];
  /** 실행 중인 검토본의 해시. 없으면 E(T)에 `pluginHashes`를 싣지 않는다 */
  hashes?: readonly { readonly plugin: string; readonly contentHash: string }[];
  /** 대화의 턴 덧씌우기(M5c §4.3). 없으면 E(T)에 `overlay`를 싣지 않는다 */
  overlay?: readonly {
    readonly plugin: string;
    readonly contentHash: string;
    readonly until: "turn";
  }[];
}

async function providePluginSet(t: TestHost, state: PluginSetState): Promise<void> {
  const port: PluginSetPort = {
    resolve: () => ({
      plugins: [...state.plugins],
      profileId: "default",
      profileRev: 0,
      commonRev: 0,
      ...(state.hashes === undefined ? {} : { pluginHashes: [...state.hashes] }),
      ...(state.overlay === undefined ? {} : { overlay: [...state.overlay] }),
    }),
  };
  const registered = await t.host.registerPlatform({
    name: "test-plugin-set",
    setup(ctx) {
      ctx.providePort(PluginSetPortKey, port);
    },
  });
  expect(registered.ok).toBe(true);
}

/** 경계 기여 가운데 scope.changed의 값만 모은다 */
function scopeChangesOf(
  drafts: readonly { readonly kind: string; readonly payload: unknown }[],
): readonly unknown[] {
  return drafts.filter((draft) => draft.kind === "scope.changed").map((draft) => draft.payload);
}

test("an engine disable() holds at later boundaries until E(T) itself changes", async () => {
  const t = await createTestHost();
  const state: { plugins: readonly string[] } = { plugins: ["pset-one"] };
  await providePluginSet(t, state);
  await t.host.install(makeUnit({ name: "pset-one", hooks: ["tool.call.before"] }, () => {}));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.registration("pset-one")?.status).toBe("enabled");

  // 사용자 turn이 도는 중에 엔진이 끈다. 적용은 단계 경계에서다
  t.loop.setRunning(thread, true);
  t.host.registration("pset-one")?.disable();
  await t.settled();
  const off = await t.boundary(thread).stepEnd();
  expect(scopeChangesOf(off)).toEqual([{ scopeId: "pset-one", status: "disabled" }]);
  expect(t.host.registration("pset-one")?.status).toBe("disabled");

  // E(T)가 그대로인 다음 경계는 엔진이 끈 것을 다시 켜지 않는다
  const again = await t.boundary(thread).stepEnd();
  expect(scopeChangesOf(again)).toEqual([]);
  expect(t.host.registration("pset-one")?.status).toBe("disabled");

  // E(T)에서 빠졌다가 다시 들어오면 그때 켠다
  state.plugins = [];
  await t.boundary(thread).stepEnd();
  state.plugins = ["pset-one"];
  const back = await t.boundary(thread).stepEnd();
  expect(scopeChangesOf(back)).toEqual([{ scopeId: "pset-one", status: "enabled" }]);
  expect(t.host.registration("pset-one")?.status).toBe("enabled");
});

test("an E(T) change requests only the plugins whose membership changed, and applies at idle without a boundary", async () => {
  const t = await createTestHost();
  const state: { plugins: readonly string[] } = { plugins: ["pset-a", "pset-b"] };
  await providePluginSet(t, state);
  await t.host.install(makeUnit({ name: "pset-a", hooks: ["tool.call.before"] }, () => {}));
  await t.host.install(makeUnit({ name: "pset-b", hooks: ["tool.call.before"] }, () => {}));
  await t.host.install(makeUnit({ name: "pset-c", hooks: ["tool.call.before"] }, () => {}));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["pset-a", "enabled"],
    ["pset-b", "enabled"],
    ["pset-c", "disabled"],
  ]);

  // 엔진이 pset-a만 끈다
  t.loop.setRunning(thread, true);
  t.host.registration("pset-a")?.disable();
  await t.settled();
  await t.boundary(thread).stepEnd();
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["pset-a", "disabled"],
    ["pset-b", "enabled"],
    ["pset-c", "disabled"],
  ]);

  // E(T)에 pset-c만 더해진다. 유휴 대화라 적용 요청만으로 다음 매크로태스크에 적용된다
  t.loop.setRunning(thread, false);
  state.plugins = ["pset-a", "pset-b", "pset-c"];
  registrationToggleSourceOf(t.host).requestApply(thread);
  await t.settled();
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["pset-a", "disabled"],
    ["pset-b", "enabled"],
    ["pset-c", "enabled"],
  ]);
  const applied = t.records.events(thread).filter((event) => event.kind === "scope.changed");
  expect(applied.at(-1)?.payload).toEqual({ scopeId: "pset-c", status: "enabled" });
});

test("a changed reviewed copy of a plugin in E(T) records profile.applied with plugin_updated at the next boundary", async () => {
  const t = await createTestHost();
  const state: PluginSetState = {
    plugins: ["pset-a"],
    hashes: [{ plugin: "pset-a", contentHash: "sha256:aa" }],
  };
  await providePluginSet(t, state);
  await t.host.install(makeUnit({ name: "pset-a", hooks: ["tool.call.before"] }, () => {}));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  // 검토본이 바뀌었다. 집합은 그대로이고 해시만 다르다. 유휴 대화는 다음 매크로태스크에 맞춘다
  state.hashes = [{ plugin: "pset-a", contentHash: "sha256:bb" }];
  registrationToggleSourceOf(t.host).requestApply(thread);
  await t.settled();
  const recorded = t.records
    .events(thread)
    .filter((event) => event.kind === "profile.applied")
    .map((event) => event.payload);
  expect(recorded).toEqual([
    {
      reason: "open",
      profileId: "default",
      profileRev: 0,
      commonRev: 0,
      added: ["pset-a"],
      removed: [],
      overlay: [],
    },
    {
      reason: "plugin_updated",
      profileId: "default",
      profileRev: 0,
      commonRev: 0,
      added: [],
      removed: [],
      overlay: [],
      updated: [{ plugin: "pset-a", fromHash: "sha256:aa", toHash: "sha256:bb" }],
    },
  ]);
});

test("a turn_settled boundary calls the port's turnSettled once the commit is settled", async () => {
  const t = await createTestHost();
  const settledThreads: ThreadId[] = [];
  const port: PluginSetPort = {
    resolve: () => ({ plugins: [], profileId: "default", profileRev: 0, commonRev: 0 }),
    turnSettled: (threadId) => {
      settledThreads.push(threadId);
    },
  };
  const registered = await t.host.registerPlatform({
    name: "test-plugin-set-settled",
    setup(ctx) {
      ctx.providePort(PluginSetPortKey, port);
    },
  });
  expect(registered.ok).toBe(true);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  await t.boundary(thread).turnSettled();
  expect(settledThreads).toEqual([thread]);
  await t.boundary(thread).idle();
  expect(settledThreads).toEqual([thread]);
});

test("a turn overlay records profile.applied overlay_on when it joins E(T) and overlay_off when it leaves", async () => {
  const t = await createTestHost();
  const state: PluginSetState = { plugins: ["pset-keep"] };
  await providePluginSet(t, state);
  await t.host.install(makeUnit({ name: "pset-keep", hooks: ["tool.call.before"] }, () => {}));
  await t.host.install(makeUnit({ name: "pset-extra", hooks: ["tool.call.before"] }, () => {}));
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();

  // 턴 덧씌우기가 얹혔다. 입력 처리 앞에 적용을 기다린다
  state.plugins = ["pset-keep", "pset-extra"];
  state.overlay = [{ plugin: "pset-extra", contentHash: "sha256:cc", until: "turn" }];
  await registrationToggleSourceOf(t.host).applyNow(thread);
  await t.settled();
  expect(t.host.registration("pset-extra")?.status).toBe("enabled");

  // 턴이 정착했다. 덧씌우기가 빠지고 집합을 다시 맞춘다
  state.plugins = ["pset-keep"];
  state.overlay = [];
  registrationToggleSourceOf(t.host).requestApply(thread);
  await t.settled();
  expect(t.host.registration("pset-extra")?.status).toBe("disabled");

  const recorded = t.records
    .events(thread)
    .filter((event) => event.kind === "profile.applied")
    .map((event) => event.payload);
  expect(recorded).toEqual([
    {
      reason: "open",
      profileId: "default",
      profileRev: 0,
      commonRev: 0,
      added: ["pset-keep"],
      removed: [],
      overlay: [],
    },
    {
      reason: "overlay_on",
      profileId: "default",
      profileRev: 0,
      commonRev: 0,
      added: ["pset-extra"],
      removed: [],
      overlay: [{ plugin: "pset-extra", contentHash: "sha256:cc", until: "turn" }],
    },
    {
      reason: "overlay_off",
      profileId: "default",
      profileRev: 0,
      commonRev: 0,
      added: [],
      removed: ["pset-extra"],
      overlay: [{ plugin: "pset-extra", contentHash: "sha256:cc", until: "turn" }],
    },
  ]);
});

test("a non-root declaration with defaultEnabled false starts disabled and runs once its extension is in E(T)", async () => {
  // M5c §4.1.9: E(T)는 확장 단위로 정해지고 같은 확장의 모든 선언(비루트 포함)을 함께 켠다. `defaultEnabled`는 켜짐에 쓰지 않는다
  const t = await createTestHost();
  const state: { plugins: readonly string[] } = { plugins: [] };
  await providePluginSet(t, state);
  const outcome = await t.host.install({
    manifest: makeManifest({
      name: "pset-multi",
      hooks: [],
      extraPlugins: [
        { id: "idle", layer: "plugin", hooks: ["tool.call.before"], defaultEnabled: false },
      ],
    }),
    loadIndex: 0,
    builtin: true,
    entry: ({ register }) => {
      register("pset-multi", {}, () => {});
      register("pset-multi/idle", {}, () => {});
    },
  });
  expect(outcome.unregistered).toEqual([]);
  // 루트는 매니페스트 기본(켜짐)으로 시작하고, 비루트는 자기 `defaultEnabled: false`로 꺼져 시작한다
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["pset-multi", "enabled"],
    ["pset-multi/idle", "disabled"],
  ]);

  // 확장이 E(T)에 든 대화가 열리면 두 선언이 함께 켜진다
  state.plugins = ["pset-multi"];
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.registrations().map((info) => [info.id, info.status])).toEqual([
    ["pset-multi", "enabled"],
    ["pset-multi/idle", "enabled"],
  ]);
});
