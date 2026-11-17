import { expect, test } from "bun:test";
import type { StepResult } from "@fresnel/contracts/extensions";
import { defineSettings } from "@fresnel/contracts/settings";
import { createTestHost } from "@fresnel/ext-host/testing";
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
        hooks: ["boundary.settle.after"],
        usesPost: true,
        drives: true,
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
        g.drive(async ({ last }) => {
          if (last?.kind === "ok" && last.of === "spawn") return { do: "yield" };
          return { do: "spawn", agent: "helper", task: "t" };
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

test("wrap.ask-command-reaches-the-host-loop", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  // 직전 결과가 다음 단계의 last로 돌아온다. ask는 승인 서비스가 없어 거부 결과(refused)로 돌아온다
  const results: StepResult[] = [];
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "asks", drives: true }),
      setup(g) {
        g.drive(async ({ last }) => {
          if (last !== null) {
            results.push(last);
            return { do: "yield" };
          }
          return {
            do: "ask",
            requestId: "asks:gate:1",
            card: {
              questions: [
                {
                  id: "go",
                  header: "Go",
                  text: "Go?",
                  options: [],
                  multiSelect: false,
                  allowFreeText: true,
                },
              ],
            },
          };
        });
      },
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  // ask 명령은 호스트의 loop.ask까지 닿는다. 시험 호스트에는 승인 서비스가 없어 승인 포트 부재로 거부된다
  expect(results).toEqual([{ kind: "refused", code: "port_unavailable" }]);
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

test("wrap.commit-command-is-checked-like-g-commit", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await install(
    t,
    defineGroup<{ readonly n: number }>({
      manifest: groupManifestOf({ name: "checked", drives: true }),
      state: {
        schema: Type.Object({ n: Type.Integer({ minimum: 0 }) }),
        initial: { n: 0 },
        version: 1,
      },
      setup(g) {
        g.drive(async () => ({ do: "commit", state: { n: -1 }, next: { do: "yield" } }));
      },
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  // g.commit과 같은 검사로 거부한다. 단계가 던져 임대는 오류로 반납되고, 상태 사건은 남지 않는다
  expect(t.diagnostics).toMatchObject([
    { level: "error", code: "state_schema", scopeId: "checked" },
  ]);
  expect(t.host.registrations().find((info) => info.id === "checked")?.drive).toBe("error");
  expect(t.records.events(thread).map((event) => event.kind)).not.toContain(
    "grp.checked.state.committed",
  );
});

test("wrap.commit-command-counts-only-a-changed-state", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  let api: GroupApi<{ readonly n: number }> | undefined;
  // 시험 관찰용: 단계 함수가 본 커밋 값을 적는다(상태가 아니라 시험 기록이다)
  const seen: number[] = [];
  await install(
    t,
    defineGroup<{ readonly n: number }>({
      manifest: groupManifestOf({ name: "tally", drives: true }),
      state: {
        schema: Type.Object({ n: Type.Integer({ minimum: 0 }) }),
        initial: { n: 0 },
        version: 1,
      },
      setup(g) {
        api = g;
        // 처음에는 값을 바꾸고, 다음 호출에서는 같은 값을 커밋한다
        g.drive(async ({ state }) => {
          seen.push(state.n);
          const next = state.n === 0 ? 1 : state.n;
          return { do: "commit", state: { n: next }, next: { do: "yield" } };
        });
      },
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  expect(api?.metrics.snapshot()).toMatchObject({ commits: 1 });
  await t.boundary(thread).turnSettled();
  await t.settled();
  // 두 번째 호출은 값 1을 보고 같은 값을 커밋하려 한다. 그 커밋은 상태 사건을 쓰지 않고 계측하지도 않는다(g.commit과 같은 규칙)
  expect(seen.slice(0, 2)).toEqual([0, 1]);
  const kinds = t.records.events(thread).map((event) => event.kind);
  expect(kinds.filter((kind) => kind === "grp.tally.state.committed")).toHaveLength(1);
  expect(kinds.filter((kind) => kind === "drive.command_settled")).toHaveLength(0);
  expect(api?.metrics.snapshot()).toMatchObject({ commits: 1 });
});

test("wrap.done-releases-the-lease-with-reason-done", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "finisher", drives: true }),
      setup(g) {
        g.drive(async ({ last }) => {
          if (last?.kind === "ok" && last.of === "turn") return { do: "done" };
          return { do: "turn", input: { kind: "user", content: "once" }, requestId: "finisher:1" };
        });
      },
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  // done은 주도권을 내려놓는다. 반납 사유는 done이다
  expect(
    t.records
      .events(thread)
      .filter((event) => event.kind === "lease.released")
      .map((event) => event.payload),
  ).toMatchObject([{ scopeId: "finisher", reason: "done" }]);
  expect(t.host.leaseOf(thread)).toBeNull();
});

test("wrap.two-effect-free-yields-release-the-lease-as-idle", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  await install(
    t,
    defineGroup({
      manifest: groupManifestOf({ name: "resting", drives: true }),
      setup(g) {
        g.drive(async () => ({ do: "yield" }));
      },
    }),
  );
  await t.host.openThread(thread);
  await t.settled();
  // 첫 yield는 주도권을 유지한다. 같은 상태 판의 두 번째 효과 없는 yield에서 idle로 반납한다
  expect(t.host.leaseOf(thread)).toMatchObject({ scopeId: "resting" });
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(
    t.records
      .events(thread)
      .filter((event) => event.kind === "lease.released")
      .map((event) => event.payload),
  ).toMatchObject([{ scopeId: "resting", reason: "idle" }]);
});
