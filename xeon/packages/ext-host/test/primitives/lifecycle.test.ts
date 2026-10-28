import { expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, EventFeed, CommitListener } from "@xeon/contracts/records";
import { SessionFeedPortKey } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { createTestHost } from "../../src/testing/index.ts";
import { makeGroupUnit, makeUnit } from "./fixtures/support.ts";

// M3-REQ-28(대기 상한 뒤 거부), M3-REQ-102·108(수명주기 지점은 커밋 뒤에 발화)

type Host = Awaited<ReturnType<typeof createTestHost>>;

function installDriveGroups(t: Host, names: readonly string[]): Promise<void> {
  return eachInOrder(names.entries(), async ([loadIndex, name]) => {
    await t.host.install(
      makeGroupUnit({ name, loadIndex }, (g) => {
        g.drive(() => {
          return Promise.resolve();
        });
      }),
    );
    return "continue";
  });
}

function rejectedIn(t: Host, thread: ThreadId): unknown[] {
  return t.records
    .events(thread)
    .filter((event) => event.kind === "lease.rejected")
    .map((event) => event.payload);
}

test("a drive request that waits past the limit is refused with lease.rejected, and the lifecycle point fires after the commit", async () => {
  const t = await createTestHost({ settings: { activeDriveGroup: "lr-a", leaseWaitLimit: 1 } });
  const thread = t.newThread();
  const heard: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "lr-listener", points: ["lifecycle.lease.rejected"], loadIndex: 5 }, (g) => {
      g.on("lifecycle.lease.rejected", (payload) => {
        heard.push(payload);
      });
    }),
  );
  await installDriveGroups(t, ["lr-a", "lr-b"]);
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.leaseOf(thread)?.scopeId).toBe("lr-a");
  expect(rejectedIn(t, thread)).toEqual([]);

  // 한 경계를 손으로 돌려 prepare, 커밋, settle 사이의 발화 시점을 본다
  const signal = { threadId: thread, kind: "turn_settled" as const };
  const contribution = await t.host.boundary.prepare(signal);
  const rejection = contribution.drafts.find((draft) => draft.kind === "lease.rejected");
  expect(rejection?.payload).toEqual({ groupId: "lr-b", reason: "wait_limit", requestSeq: 0 });
  expect(heard).toEqual([]);
  const committed = await t.records.commit({
    threadId: thread,
    requestId: "test:lease-rejected",
    drafts: contribution.drafts,
  });
  expect(committed.status).toBe("committed");
  expect(heard).toEqual([]);
  await t.host.boundary.settle(signal, "committed");
  expect(heard).toEqual([{ groupId: "lr-b", reason: "wait_limit", requestSeq: 0 }]);

  expect(rejectedIn(t, thread)).toHaveLength(1);
});

test("a failed boundary commit does not fire the lifecycle point", async () => {
  const t = await createTestHost({ settings: { activeDriveGroup: "lr-a", leaseWaitLimit: 1 } });
  const thread = t.newThread();
  const heard: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "lr-listener", points: ["lifecycle.lease.rejected"], loadIndex: 5 }, (g) => {
      g.on("lifecycle.lease.rejected", (payload) => {
        heard.push(payload);
      });
    }),
  );
  await installDriveGroups(t, ["lr-a", "lr-b"]);
  await t.host.openThread(thread);
  await t.settled();
  await t.boundary(thread).turnSettled({ fail: true });
  await t.settled();
  expect(heard).toEqual([]);
  expect(rejectedIn(t, thread)).toEqual([]);
  // 다음 경계가 다시 거부를 시도해 이번에는 커밋된다
  await t.boundary(thread).turnSettled();
  expect(heard).toEqual([{ groupId: "lr-b", reason: "wait_limit", requestSeq: 0 }]);
});

// ── 커밋 피드로 오는 위임 정착(core-agents가 쓰는 agent.settled) ──

function fakeFeed(): { feed: EventFeed; emit(events: readonly DurableEventEnvelope[]): void } {
  const listeners = new Set<CommitListener>();
  const feed: EventFeed = {
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
  };
  return {
    feed,
    emit(events) {
      for (const listener of listeners) listener({ firstSeq: 1, lastSeq: events.length, events });
    },
  };
}

test("agent.settled from the commit feed reaches only the owner scope's handler", async () => {
  const t = await createTestHost({ without: ["records"] });
  const fake = fakeFeed();
  await t.host.registerPlatform({
    name: "test-feed",
    setup(ctx) {
      ctx.providePort(SessionFeedPortKey, fake.feed);
    },
  });
  const heard: string[] = [];
  await eachInOrder(["lc-a", "lc-b"].entries(), async ([loadIndex, name]) => {
    await t.host.install(
      makeUnit({ name, loadIndex, points: ["lifecycle.agent.settled"] }, (g) => {
        g.on("lifecycle.agent.settled", (payload) => {
          heard.push(`${name}:${payload.requestId}`);
        });
      }),
    );
    return "continue";
  });
  const thread = t.newThread();
  await t.host.openThread(thread);
  let seq = 0;
  const envelope = (
    requestId: string,
    owner:
      | { kind: "scope"; scopeId: string }
      | { kind: "tool"; turnId: TurnId; toolCallId: string },
  ): DurableEventEnvelope => {
    seq += 1;
    return {
      id: t.ids.next("evt"),
      kind: "agent.settled",
      version: 1,
      threadId: thread,
      turnId: null,
      stepId: null,
      recordedAt: 1,
      causationId: null,
      correlationId: null,
      payload: {
        childThreadId: t.newThread(),
        requestId,
        status: "completed",
        report: null,
        answerItemId: null,
        usage: null,
        error: null,
        owner,
      },
      durable: true,
      seq,
      parentId: null,
    };
  };
  const owned = envelope("r1", { kind: "scope", scopeId: "lc-a" });
  fake.emit([owned]);
  await t.settled();
  expect(heard).toEqual(["lc-a:r1"]);
  // 같은 이벤트가 다시 와도 한 번만 발화한다
  fake.emit([owned]);
  await t.settled();
  expect(heard).toEqual(["lc-a:r1"]);
  // 도구가 맡긴 위임은 소유 scope가 없어 모든 구독자가 받는다 [미결]
  fake.emit([envelope("r2", { kind: "tool", turnId: t.ids.next("trn"), toolCallId: "c1" })]);
  await t.settled();
  expect(heard).toEqual(["lc-a:r1", "lc-a:r2", "lc-b:r2"]);
});
