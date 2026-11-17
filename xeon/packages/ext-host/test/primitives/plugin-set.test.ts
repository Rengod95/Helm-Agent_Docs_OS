import { expect, test } from "bun:test";
import { PluginSetPortKey, type PluginSetPort } from "@fresnel/contracts/extensions";
import { registrationToggleSourceOf } from "../../src/primitives/index.ts";
import { createTestHost, type TestHost } from "../../src/testing/index.ts";
import { makeUnit } from "./fixtures/support.ts";

// E(T)(M5c §4.1.5, X.primitives.spec §4.5.8)는 호스트가 `PluginSetPortKey`로 주는 집합이다. 시험은 그 값을 바꿔 가며 쓴다.
// 엔진 안의 끄기(`RegistrationHandle.disable`, 자동 끄기·안전 모드)는 E(T)가 바뀌기 전까지 이겨야 한다.

/** 대화 집합을 시험이 바꾸는 포트. 집합과 검토본 해시 말고 값은 고정이다 */
interface PluginSetState {
  plugins: readonly string[];
  /** 실행 중인 검토본의 해시. 없으면 E(T)에 `pluginHashes`를 싣지 않는다 */
  hashes?: readonly { readonly plugin: string; readonly contentHash: string }[];
}

async function providePluginSet(t: TestHost, state: PluginSetState): Promise<void> {
  const port: PluginSetPort = {
    resolve: () => ({
      plugins: [...state.plugins],
      profileId: "default",
      profileRev: 0,
      commonRev: 0,
      ...(state.hashes === undefined ? {} : { pluginHashes: [...state.hashes] }),
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
