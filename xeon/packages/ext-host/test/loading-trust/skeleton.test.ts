// M1 걷는 골격의 X 쪽 연결: 로더가 테스트용 그룹 하나를 싣고 on/post/drive가 돈다(X.loading-trust.plan L-12).
import { expect, test } from "bun:test";
import { createSmokeGroup } from "../../src/testing/index.ts";
import { createLoaderHarness } from "./support/harness.ts";
import { unsafeInput } from "../primitives/fixtures/support.ts";

test("skeleton: the loader loads the smoke group and its operations run", async () => {
  const harness = await createLoaderHarness();
  const { t } = harness;
  const { unit, probe } = createSmokeGroup({ ids: t.ids });
  const thread = t.newThread();
  await t.host.openThread(thread);
  const report = await harness.loader.loadAll(
    harness.options([{ manifest: unit.manifest, extension: unit.entry }]),
  );
  await t.settled();
  expect(report.extensions.map((info) => [info.name, info.state, info.trust])).toEqual([
    ["smoke-group", "active", "builtin"],
  ]);
  expect(report.diagnostics).toEqual([]);
  expect(report.settingGroups.map((group) => group.namespace)).toEqual(["ext.smoke-group"]);
  expect(harness.policy.tiers.get("smoke-group")).toBe("builtin");

  // drive: 임대를 받아 turn 한 번과 상태 커밋
  expect(t.loop.turns).toHaveLength(1);
  expect(t.records.events(thread).map((event) => event.kind)).toEqual([
    "scope.changed",
    "lease.acquired",
    "grp.smoke-group.state.committed",
  ]);

  // on: tool_call 거부
  const denied = await t.host.dispatch(
    "tool_call",
    { toolCallId: "call_1", toolName: "danger", input: {} },
    { threadId: thread, dispatchKey: "tc" },
  );
  expect(denied.decision).toMatchObject({ block: true });
  expect(probe.deniedCalls).toEqual(["call_1"]);
});

test("skeleton: turning the group off through the setting applies at the next step boundary", async () => {
  const harness = await createLoaderHarness();
  const { t } = harness;
  const { unit } = createSmokeGroup({ ids: t.ids });
  const thread = t.newThread();
  await t.host.openThread(thread);
  await harness.loader.loadAll(
    harness.options([{ manifest: unit.manifest, extension: unit.entry }]),
  );
  await t.settled();
  // turn이 도는 중에 설정이 바뀐다
  t.loop.setRunning(thread, true);
  harness.settings.enabled.set("smoke-group", false);
  await harness.loader.settingChanged("smoke-group", new AbortController().signal);
  expect(t.host.scope("smoke-group")?.status).toBe("disabling");
  const drafts = await t.boundary(thread).stepEnd();
  expect(drafts.map((draft) => draft.kind)).toEqual(["lease.released", "scope.changed"]);
  expect(drafts[0]?.payload).toMatchObject({ reason: "disabled" });
  expect(drafts[1]?.payload).toMatchObject({ status: "disabled" });
});

test("skeleton: dispose uninstalls in reverse load order and clears the policy table", async () => {
  const harness = await createLoaderHarness();
  const { t } = harness;
  const { unit } = createSmokeGroup({ ids: t.ids });
  await harness.loader.loadAll(
    harness.options([{ manifest: unit.manifest, extension: unit.entry }]),
  );
  expect(harness.policy.tiers.get("smoke-group")).toBe("builtin");
  await harness.loader.dispose();
  expect(t.host.scope("smoke-group")).toBeUndefined();
  expect(harness.policy.tiers.get("smoke-group")).toBeUndefined();
});

test("skeleton: a missing dependency is a start failure", async () => {
  const harness = await createLoaderHarness();
  const { createExtensionLoader } = await import("../../src/loading-trust/index.ts");
  const loader = createExtensionLoader({
    // JS 호출자가 필수 항목을 빠뜨린 경우
    host: unsafeInput(undefined),
    policy: harness.policy,
    fs: {
      readText: () => Promise.resolve(null),
      listDir: () => Promise.resolve(null),
      exists: () => Promise.resolve(false),
      realpath: (p) => Promise.resolve(p),
    },
    paths: { userDir: "/u", managedDir: null, homeDir: "/h" },
    trustBackend: {
      read: () => Promise.resolve({ ok: true, text: null }),
      update: () => Promise.resolve(),
    },
    clock: { now: () => 0 },
  });
  let message = "";
  try {
    await loader.loadAll(harness.options([]));
  } catch (error) {
    message = error instanceof Error ? error.message : "";
  }
  expect(message).toContain("loader.missing_dependency: host");
});
