import { expect, test } from "bun:test";
import { defineSettings } from "@xeon/contracts/settings";
import { createTestHost } from "@xeon/ext-host/testing";
import { Type } from "typebox";
import { defineGroup, GroupSettingsSourceKey, type GroupApi } from "../src/index.ts";
import { fireSettled, install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

const modeInputs = {
  mode: {
    type: Type.String({ enum: ["fast", "slow"] }),
    default: "fast",
    runtimeChange: "live",
    allowedScopes: ["user"],
    since: "0.1.0",
  },
  limit: {
    type: Type.Integer({ minimum: 1 }),
    default: 3,
    runtimeChange: "live",
    allowedScopes: ["user"],
    since: "0.1.0",
  },
} as const;

const modeSettings = defineSettings("l3.with-mode", modeInputs);

type ModeDefs = typeof modeSettings.defs;

function modeGroup(sink: { api?: GroupApi<never, ModeDefs> }): ReturnType<typeof defineGroup> {
  return defineGroup({
    manifest: groupManifestOf({ name: "with-mode" }),
    settings: modeSettings,
    setup(g) {
      sink.api = g;
    },
  });
}

test("wrap.settings-returns-defaults-without-a-source", async () => {
  const t = await createTestHost();
  const sink: { api?: GroupApi<never, ModeDefs> } = {};
  await install(t, modeGroup(sink));
  expect(sink.api?.settings()).toEqual({ mode: "fast", limit: 3 });
});

test("wrap.settings-reads-valid-values-and-falls-back-on-invalid", async () => {
  const t = await createTestHost();
  const values: Record<string, unknown> = { "l3.with-mode.mode": "slow", "l3.with-mode.limit": 0 };
  await t.host.registerPlatform({
    name: "settings-source",
    setup(ctx) {
      ctx.providePort(GroupSettingsSourceKey, { value: (key) => values[key] });
    },
  });
  const sink: { api?: GroupApi<never, ModeDefs> } = {};
  await install(t, modeGroup(sink));
  // limit 0은 최소 1 위반이라 기본값 3으로 돌아간다
  expect(sink.api?.settings()).toEqual({ mode: "slow", limit: 3 });
  values["l3.with-mode.limit"] = 7;
  expect(sink.api?.settings().limit).toBe(7);
});

test("wrap.settings-of-a-group-without-settings-is-empty", async () => {
  const t = await createTestHost();
  let seen: unknown;
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "no-settings" }),
      setup(g) {
        seen = g.settings();
      },
    }),
  );
  expect(seen).toEqual({});
});

test("delegate.rejects-long-request-id", async () => {
  const t = await createTestHost();
  let api: GroupApi<never> | undefined;
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "delegator" }),
      setup(g) {
        api = g;
      },
    }),
  );
  const base = {
    agent: "reviewer",
    task: "look",
    requestId: "r1",
    report: { customType: "grp.delegator.review.done", display: true, when: "next" },
  } as const;
  const tooLong = await api?.delegate({ ...base, requestId: "x".repeat(49) });
  expect(tooLong).toMatchObject({
    ok: false,
    error: { kind: "group.delegateInvalid", field: "requestId" },
  });
  const foreign = await api?.delegate({
    ...base,
    report: { customType: "grp.other.review.done", display: true, when: "next" },
  });
  expect(foreign).toMatchObject({
    ok: false,
    error: { kind: "group.delegateInvalid", field: "report.customType" },
  });
  const noAgent = await api?.delegate({ ...base, agent: "has space" });
  expect(noAgent).toMatchObject({ ok: false, error: { field: "agent" } });
  // 입력이 맞아도 M2에는 위임 서비스가 없다
  expect(await api?.delegate(base)).toEqual({
    ok: false,
    error: { kind: "group.delegateUnavailable" },
  });
});

test("wrap.metrics-count-commits-posts-and-spawns", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  let api: GroupApi<{ readonly n: number }> | undefined;
  await install(
    t,
    defineGroup<{ readonly n: number }>({
      manifest: groupManifestOf({
        name: "counted",
        points: ["boundary.settle.after"],
        usesPost: true,
        usesDrive: true,
      }),
      state: {
        schema: Type.Object({ n: Type.Integer({ minimum: 0 }) }),
        initial: { n: 0 },
        version: 1,
      },
      setup(g) {
        api = g;
        g.on("boundary.settle.after", async (_payload, ctx) => {
          await g.post({ kind: "user", content: "hi" }, { when: "next", requestId: "same-key" });
          await g.post(
            { kind: "user", content: "hi again" },
            { when: "next", requestId: "same-key" },
          );
          await g.commit({ n: ctx.state.n + 1 });
        });
        g.drive(async (loop) => {
          await loop.spawn({ agent: "helper", task: "t" });
        });
      },
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  await fireSettled(t, thread, "k1");
  await t.settled();
  const snapshot = api?.metrics.snapshot();
  // 같은 requestId의 두 번째 post는 duplicate라 세지 않는다
  expect(snapshot).toMatchObject({
    groupId: "counted",
    posts: 1,
    commits: 1,
    spawns: 1,
    denies: 0,
    delegates: 0,
  });
});

test("wrap.settings-of-a-user-trust-group-read-only-its-own-ext-namespace", async () => {
  const t = await createTestHost();
  const values: Record<string, unknown> = {
    "ext.user-mode.mode": "slow",
    "ext.user-mode.limit": 9,
    "ext.other.limit": 5,
  };
  await t.host.registerPlatform({
    name: "settings-source",
    setup(ctx) {
      ctx.providePort(GroupSettingsSourceKey, { value: (key) => values[key] });
    },
  });
  const sink: { api?: GroupApi<never, ModeDefs> } = {};
  const group = defineGroup({
    manifest: groupManifestOf({ name: "user-mode", builtin: false }),
    settings: defineSettings("ext.user-mode", modeInputs),
    setup(g) {
      sink.api = g;
    },
  });
  await t.host.install({
    manifest: group.manifest,
    entry: group.entry,
    loadIndex: 0,
    builtin: false,
  });
  expect(sink.api?.settings()).toEqual({ mode: "slow", limit: 9 });
});
