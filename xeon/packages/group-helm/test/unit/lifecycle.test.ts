import { expect, test } from "bun:test";
import { parse } from "@xeon/contracts";
import { defineManifest, LeaseArbiterPortKey } from "@xeon/contracts/extensions";
import { withDriveDefaults } from "@xeon/ext-host";
import { createTestHost } from "@xeon/ext-host/testing";
import { createGroupService, defineGroup, type GroupModule } from "@xeon/group-kit";
import { groupCatalogOf, memoryDriveHolderSettings } from "@xeon/group-kit/testing";
import { Type } from "typebox";
import { helmGroup } from "../../src/index.ts";
import { HelmStateSchema, type HelmState } from "../../src/state.ts";
import { callCommand, createRig, drainRounds, settleOnce, type Rig } from "../support/rig.ts";

function statesOf(
  records: readonly { readonly kind: string; readonly payload: unknown }[],
): readonly HelmState[] {
  return records
    .filter((event) => event.kind === "grp.helm.state.committed")
    .flatMap((event) => {
      const payload: unknown = event.payload;
      if (typeof payload !== "object" || payload === null || !("doc" in payload)) return [];
      const checked = parse(HelmStateSchema, payload.doc);
      return checked.ok ? [checked.value] : [];
    });
}

function leaseReleases(rig: Rig): readonly unknown[] {
  return rig.t.records
    .events(rig.thread)
    .filter((event) => event.kind === "lease.released")
    .map((event) => event.payload);
}

test("disable.at-step-boundary-releases-lease: the inquiry resumes from the same phase after re-enabling", async () => {
  const holder: { rig?: Rig } = {};
  const rig = await createRig({
    onTurn: async (request) => {
      const target = holder.rig;
      if (target === undefined || !request.requestId.includes(":turn:diverge:")) return;
      // diverge turn 도중 끄기를 요청하고, 턴 안의 단계 경계가 그것을 적용한다
      target.t.host.scope("helm")?.disable();
      await target.t.boundary(target.thread).stepEnd();
    },
  });
  holder.rig = rig;
  await rig.command("start 캐시 무효화");
  await rig.settle("s");
  await rig.drain();
  const disabled = leaseReleases(rig).filter(
    (payload) =>
      typeof payload === "object" &&
      payload !== null &&
      "reason" in payload &&
      payload.reason === "disabled",
  );
  expect(disabled).toHaveLength(1);
  const stopped = statesOf(rig.t.records.events(rig.thread)).at(-1);
  expect(stopped?.phase).toBe("diverge");
  expect(rig.t.loop.spawns).toHaveLength(0);
  const inquiryId = stopped?.inquiryId;
  expect(inquiryId).not.toBeNull();
  rig.t.host.scope("helm")?.enable();
  await rig.drain(12);
  const finished = rig.records("grp.helm.inquiry.finished");
  expect(finished).toHaveLength(1);
  expect(finished[0]).toMatchObject({ inquiryId, outcome: "applied" });
  // 같은 requestId라 diverge turn은 기록된 결과를 돌려받고 적용 turn은 한 번이다
  expect(
    rig.t.loop.turns.filter((request) => request.requestId.includes(":turn:apply:")),
  ).toHaveLength(1);
});

test("coexist.learning-on-while-helm-holds-lease: another group's on handler and post keep working", async () => {
  const seen: (string | undefined)[] = [];
  const holder: { rig?: Rig } = {};
  const learn = defineGroup({
    manifest: defineManifest({
      schemaVersion: 1,
      name: "learn-fake",
      version: "0.1.0",
      layer: "L3",
      kind: "group",
      entry: "./src/index.ts",
      points: ["boundary.settle.after"],
      usesPost: true,
      usesDrive: false,
      trust: { level: "builtin" },
    }),
    setup(g) {
      g.on("boundary.settle.after", async (payload) => {
        seen.push(holder.rig?.t.host.leaseOf(holder.rig.thread)?.scopeId);
        await g.post(
          {
            kind: "context",
            customType: "grp.learn-fake.notice.seen",
            content: "x",
            display: false,
          },
          { when: "next", requestId: `learn:${payload.turnId}` },
        );
      });
    },
  });
  const rig = await createRig({
    onTurn: (request) => {
      if (!request.requestId.includes(":turn:diverge:")) return;
      void holder.rig?.t.host.dispatch(
        "boundary.settle.after",
        { turnId: holder.rig.t.ids.next("trn"), aborted: false },
        { threadId: holder.rig.thread, dispatchKey: "learn-during-helm" },
      );
    },
  });
  holder.rig = rig;
  await rig.t.host.install({
    manifest: learn.manifest,
    entry: learn.entry,
    loadIndex: 9,
    builtin: true,
  });
  await rig.runInquiry("캐시 무효화");
  expect(seen).toContain("helm");
  expect(rig.t.queue.items.some((item) => item.requestId.startsWith("learn:"))).toBe(true);
  expect(rig.records("grp.helm.inquiry.finished")[0]).toMatchObject({ outcome: "applied" });
});

const COUNTER = {
  schema: Type.Object({ n: Type.Integer({ minimum: 0 }) }),
  initial: { n: 0 },
  version: 1,
} as const;

/** 호출마다 상태를 올려 효과를 내므로 idle로 반납되지 않는 drive 그룹. 임대를 계속 쥔다 */
function holderGroup(): GroupModule {
  return defineGroup<{ readonly n: number }>({
    manifest: defineManifest({
      schemaVersion: 1,
      name: "other-drive",
      version: "0.1.0",
      layer: "L3",
      kind: "group",
      entry: "./src/index.ts",
      points: [],
      usesDrive: true,
      trust: { level: "builtin" },
    }),
    state: COUNTER,
    setup(g) {
      g.drive(async (_loop, state) => {
        await g.commit({ n: state.n + 1 });
      });
    },
  });
}

async function waitingRig() {
  const holder = memoryDriveHolderSettings();
  const t = await createTestHost({
    settingsSource: {
      driveDefaultLimits: () => withDriveDefaults({}),
      driveLimits: () => ({}),
      activeDriveGroup: () => holder.read(null),
      capabilityProviders: () => ({}),
      leaseWaitLimit: () => 2,
    },
  });
  const thread = t.newThread();
  const other = holderGroup();
  const service = createGroupService({
    host: t.host,
    catalog: groupCatalogOf([other, helmGroup]),
    holder,
    currentThread: () => thread,
    report: () => {},
  });
  await t.host.registerPlatform({
    name: "xeon-groups",
    setup(ctx) {
      ctx.providePort(LeaseArbiterPortKey, service);
    },
  });
  await t.host.install({
    manifest: other.manifest,
    entry: other.entry,
    loadIndex: 0,
    builtin: true,
  });
  await t.host.install({
    manifest: helmGroup.manifest,
    entry: helmGroup.entry,
    loadIndex: 1,
    builtin: true,
  });
  await t.host.openThread(thread);
  await t.settled();
  return { t, thread, service };
}

test("coexist.waiting-lease-keeps-signals: with another group holding the lease Helm stays idle with its pending request", async () => {
  const { t, thread } = await waitingRig();
  await callCommand(t, thread, "start 캐시 무효화");
  await settleOnce(t, thread, "w1");
  await drainRounds(t, thread, 1);
  const states = statesOf(t.records.events(thread));
  expect(states.at(-1)?.phase).toBe("idle");
  expect(states.at(-1)?.pending).toMatchObject({ topic: "캐시 무효화" });
  expect(t.host.leaseOf(thread)?.scopeId).toBe("other-drive");
  // 쓰기 거부는 걸리지 않는다
  const bash = await t.host.dispatch(
    "tool.call.before",
    { toolCallId: "c1", toolName: "bash", input: {}, risk: "exec" },
    { threadId: thread, dispatchKey: "g1" },
  );
  expect(bash.decision).toBeUndefined();
  // 신호 기록은 계속된다
  const failing = (n: number) =>
    t.host.dispatch(
      "tool.execution.after",
      {
        toolCallId: `e${String(n)}`,
        toolName: "bash",
        input: { n },
        result: { content: [{ type: "text", text: "boom" }] },
        isError: true,
      },
      { threadId: thread, dispatchKey: `e${String(n)}` },
    );
  await failing(1);
  await failing(2);
  await failing(3);
  await settleOnce(t, thread, "w2");
  expect(t.records.events(thread).some((event) => event.kind === "grp.helm.signal.detected")).toBe(
    true,
  );
});

test("lease.wait-rejected-clears-pending: after the wait limit the pending request is cleared and one notice is posted", async () => {
  const { t, thread } = await waitingRig();
  await callCommand(t, thread, "start 캐시 무효화");
  await settleOnce(t, thread, "w1");
  await drainRounds(t, thread, 6);
  const states = statesOf(t.records.events(thread));
  expect(states.some((state) => state.pending !== null)).toBe(true);
  expect(states.at(-1)?.pending).toBeNull();
  const notices = t.queue.items.filter((item) => item.requestId.endsWith(":rejected"));
  expect(notices).toHaveLength(1);
  expect(notices[0]?.requestId).toMatch(/^helm:h[a-z2-7]{13}:idle:0:rejected$/);
});
