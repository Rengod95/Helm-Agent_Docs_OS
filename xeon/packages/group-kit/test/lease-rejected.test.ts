import { expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import type { ThreadId } from "@xeon/contracts/conversation";
import { LeaseArbiterPortKey, RecordCommitPortKey } from "@xeon/contracts/extensions";
import type {
  CommitListener,
  DurableEventDraft,
  DurableEventEnvelope,
  EventFeed,
} from "@xeon/contracts/records";
import type { GroupStatus } from "@xeon/contracts/services";
import { withDriveDefaults } from "@xeon/ext-host";
import { createTestHost, memoryRecordStore, type TestHost } from "@xeon/ext-host/testing";
import { Type } from "typebox";
import { createGroupService, defineGroup, type GroupModule } from "../src/index.ts";
import { groupCatalogOf, memoryDriveHolderSettings } from "../src/testing/index.ts";
import { GroupFeedPortKey } from "../src/ports/feed.ts";
import { install } from "./support/host.ts";
import { groupManifestOf } from "./support/manifests.ts";

const COUNTER = {
  schema: Type.Object({ n: Type.Integer({ minimum: 0 }) }),
  initial: { n: 0 },
  version: 1,
} as const;

/** 호출마다 상태를 올려 효과를 내므로 idle로 반납되지 않는 drive 그룹 */
function stableGroup(name: string): GroupModule {
  return defineGroup<{ readonly n: number }>({
    manifest: groupManifestOf({ name, usesDrive: true }),
    state: COUNTER,
    setup(g) {
      g.drive(async (_loop, state) => {
        await g.commit({ n: state.n + 1 });
      });
    },
  });
}

interface Feed {
  readonly feed: EventFeed;
  emit(thread: ThreadId, drafts: readonly DurableEventDraft[]): void;
}

/** 경계가 커밋한 초안을 커밋 피드로 흘려 보내는 가짜 SessionService 피드 */
function fakeFeed(t: TestHost): Feed {
  const listeners = new Set<CommitListener>();
  let seq = 0;
  return {
    feed: {
      headSeq: () => ok(0),
      oldestReplayableSeq: () => 0,
      read: () => ok({ events: [], scannedTo: 0 }),
      onCommit(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      onVolatile: () => () => {},
    },
    emit(thread, drafts) {
      const events: DurableEventEnvelope[] = drafts.map((draft) => {
        seq += 1;
        return {
          id: t.ids.next("evt"),
          kind: draft.kind,
          version: 1,
          threadId: thread,
          turnId: null,
          stepId: null,
          recordedAt: 1,
          causationId: null,
          correlationId: null,
          payload: draft.payload,
          durable: true,
          seq,
          parentId: null,
        };
      });
      for (const listener of listeners) listener({ firstSeq: seq, lastSeq: seq, events });
    },
  };
}

async function rig() {
  const holder = memoryDriveHolderSettings();
  const records = memoryRecordStore();
  // 커밋 이벤트 피드는 기록 포트와 같은 서비스(xeon.session)의 멤버라 같은 플랫폼에서 함께 제공한다
  const t = await createTestHost({
    without: ["records"],
    shared: { records },
    settingsSource: {
      driveDefaultLimits: () => withDriveDefaults({}),
      driveLimits: () => ({}),
      activeDriveGroup: () => holder.read(null),
      capabilityProviders: () => ({}),
      leaseWaitLimit: () => 1,
    },
  });
  const thread = t.newThread();
  const feed = fakeFeed(t);
  const modules = [stableGroup("lr-a"), stableGroup("lr-b")];
  const changes: (readonly GroupStatus[])[] = [];
  const service = createGroupService({
    host: t.host,
    catalog: groupCatalogOf(modules),
    holder,
    currentThread: () => thread,
    report: () => {},
  });
  await t.host.registerPlatform({
    name: "xeon-groups",
    setup(ctx) {
      ctx.providePort(LeaseArbiterPortKey, service);
      ctx.providePort(RecordCommitPortKey, records);
      ctx.providePort(GroupFeedPortKey, feed.feed);
    },
  });
  await install(t, modules[0] ?? stableGroup("unreachable"), 0);
  await install(t, modules[1] ?? stableGroup("unreachable"), 1);
  service.onChange((groups) => {
    changes.push(groups);
  });
  await t.host.openThread(thread);
  await t.settled();
  /** 경계 하나를 돌리고 커밋된 초안을 피드로 흘린 뒤 알림이 모이기를 기다린다 */
  const step = async (): Promise<void> => {
    feed.emit(thread, await t.boundary(thread).turnSettled());
    await t.settled();
  };
  return { t, thread, service, changes, step };
}

const driveOf = (groups: readonly GroupStatus[], id: string): string | undefined =>
  groups.find((group) => group.id === id)?.drive;

test("lease-rejected.a-waiting-group-shows-waiting-until-the-limit-then-rejected", async () => {
  const { service, step } = await rig();
  expect(service.list().map(({ id, drive }) => ({ id, drive }))).toEqual([
    { id: "lr-a", drive: "holder" },
    { id: "lr-b", drive: "waiting" },
  ]);
  await step();
  expect(service.list().map(({ id, drive }) => ({ id, drive }))).toEqual([
    { id: "lr-a", drive: "holder" },
    { id: "lr-b", drive: "rejected" },
  ]);
  const status = service.status("lr-b");
  expect(status.ok && status.value.drive).toBe("rejected");
});

test("lease-rejected.onchange-notifies-listeners-when-the-rejection-commits", async () => {
  const { changes, step } = await rig();
  await step();
  expect(changes.map((groups) => driveOf(groups, "lr-b")).at(-1)).toBe("rejected");
});

test("lease-rejected.clears-when-the-holder-releases-and-the-rejected-group-takes-over", async () => {
  const { service, step } = await rig();
  await step();
  expect(driveOf(service.list(), "lr-b")).toBe("rejected");
  service.disable("lr-a");
  await step();
  await step();
  expect(service.list().map(({ id, drive }) => ({ id, drive }))).toEqual([
    { id: "lr-b", drive: "holder" },
    { id: "lr-a", drive: "none" },
  ]);
});

test("lease-rejected.a-group-without-a-feed-stays-waiting", async () => {
  const holder = memoryDriveHolderSettings();
  const t = await createTestHost({
    settingsSource: {
      driveDefaultLimits: () => withDriveDefaults({}),
      driveLimits: () => ({}),
      activeDriveGroup: () => holder.read(null),
      capabilityProviders: () => ({}),
      leaseWaitLimit: () => 1,
    },
  });
  const thread = t.newThread();
  const modules = [stableGroup("nf-a"), stableGroup("nf-b")];
  const service = createGroupService({
    host: t.host,
    catalog: groupCatalogOf(modules),
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
  await install(t, stableGroup("nf-a"), 0);
  await install(t, stableGroup("nf-b"), 1);
  await t.host.openThread(thread);
  await t.settled();
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(driveOf(service.list(), "nf-b")).toBe("waiting");
});
