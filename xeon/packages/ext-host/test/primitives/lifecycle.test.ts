import { expect, test } from "bun:test";
import { ok } from "@xeon/contracts";
import type { ThreadId, TurnId } from "@xeon/contracts/conversation";
import type { DurableEventEnvelope, EventFeed, CommitListener } from "@xeon/contracts/records";
import { RecordCommitPortKey, type ScopeDef } from "@xeon/contracts/extensions";
import { SessionFeedPortKey } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { Type } from "typebox";
import {
  createStaticPrimitivesSettings,
  type PrimitivesSettingsSource,
} from "../../src/primitives/settings.ts";
import { createTestHost, memoryRecordStore } from "../../src/testing/index.ts";
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

// ── 리뷰 지적 D2, D5, D6 ──

const CounterSchema = Type.Object({ n: Type.Integer({ minimum: 0 }) });
const counterDef: ScopeDef<{ n: number }> = {
  state: { schema: CounterSchema, initial: { n: 0 }, version: 1 },
};

/** 호출마다 상태를 올려 효과를 내므로 idle로 반납되지 않는 drive 그룹 */
function installStableGroups(t: Host, names: readonly string[]): Promise<void> {
  return eachInOrder(names.entries(), async ([loadIndex, name]) => {
    await t.host.install(
      makeGroupUnit({ name, loadIndex, def: counterDef }, (g) => {
        g.drive(async (_loop, state) => {
          await g.commit({ n: state.n + 1 });
        });
      }),
    );
    return "continue";
  });
}

function mutableSettings(
  initial: string,
  leaseWaitLimit: number,
): { source: PrimitivesSettingsSource; set(next: string): void } {
  const base = createStaticPrimitivesSettings({ leaseWaitLimit });
  const state = { active: initial };
  return {
    source: { ...base, activeDriveGroup: () => state.active },
    set(next) {
      state.active = next;
    },
  };
}

test("a rejection after the thread is reopened under a new holder is a new record, not a replay of the old key", async () => {
  const settings = mutableSettings("lr-a", 1);
  const t = await createTestHost({ settingsSource: settings.source });
  const thread = t.newThread();
  await installStableGroups(t, ["lr-a", "lr-b", "lr-c"]);
  await t.host.openThread(thread);
  await t.settled();
  await t.boundary(thread).turnSettled();
  await t.settled();
  const first = rejectedIn(t, thread);
  expect(first).toEqual([
    { groupId: "lr-b", reason: "wait_limit", requestSeq: 0 },
    { groupId: "lr-c", reason: "wait_limit", requestSeq: 1 },
  ]);
  // 사용자가 구동 그룹을 lr-c로 바꾸면 lr-a의 임대가 회수되고 lr-c가 받는다
  settings.set("lr-c");
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(t.host.leaseOf(thread)?.scopeId).toBe("lr-c");
  // 프로세스 안의 순번(requestSeq)이 0부터 다시 시작하는 재열기
  await t.host.closeThread(thread);
  await t.host.openThread(thread);
  await t.settled();
  expect(t.host.leaseOf(thread)?.scopeId).toBe("lr-c");
  await t.boundary(thread).turnSettled();
  await t.settled();
  const forB = rejectedIn(t, thread).filter(
    (payload) =>
      typeof payload === "object" &&
      payload !== null &&
      "groupId" in payload &&
      payload.groupId === "lr-b",
  );
  // lr-b는 lr-a 아래에서 한 번, 재열기 뒤 lr-c 아래에서 한 번 거부되었다. 두 번째 기록이 첫 키와 겹쳐 사라지지 않는다
  expect(forB).toHaveLength(2);
});

test("a failed boundary commit gives the waited boundary back, so the limit counts committed boundaries only", async () => {
  const settings = mutableSettings("lr-a", 2);
  const t = await createTestHost({ settingsSource: settings.source });
  const thread = t.newThread();
  await installStableGroups(t, ["lr-a", "lr-b"]);
  await t.host.openThread(thread);
  await t.settled();
  // 열 때의 유휴 경계 하나가 세어졌다(1). 실패한 경계는 세지 않는다
  await t.boundary(thread).turnSettled({ fail: true });
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(rejectedIn(t, thread)).toEqual([]);
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(rejectedIn(t, thread)).toHaveLength(1);
});

test("a lifecycle handler reads the post-commit state, not the state before the commit path finished", async () => {
  const t = await createTestHost({ without: ["records"] });
  const fake = fakeFeed();
  const inner = memoryRecordStore();
  // 저장소 커밋 안에서 동기로 피드를 부르는 SessionService처럼 흉내 낸다
  const thread = t.newThread();
  const settledEvent = (id: string): DurableEventEnvelope => ({
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
      requestId: id,
      status: "completed",
      report: { text: "done", truncated: false, flags: [], originalChars: 4 },
      answerItemId: null,
      usage: null,
      error: null,
    },
    durable: true,
    seq: 1,
    parentId: null,
  });
  await t.host.registerPlatform({
    name: "test-session",
    setup(ctx) {
      ctx.providePort(RecordCommitPortKey, {
        ...inner,
        async commit(request) {
          const result = await inner.commit(request);
          if (request.drafts.some((draft) => draft.kind.endsWith(".state.committed"))) {
            fake.emit([settledEvent("r-1")]);
          }
          return result;
        },
      });
      ctx.providePort(SessionFeedPortKey, fake.feed);
    },
  });
  const seen: number[] = [];
  await t.host.install(
    makeUnit(
      {
        name: "lc-state",
        points: ["lifecycle.agent.settled", "boundary.settle.after"],
        def: counterDef,
      },
      (g) => {
        g.on("lifecycle.agent.settled", (_payload, ctx) => {
          seen.push(ctx.state.n);
        });
        g.on("boundary.settle.after", async () => {
          await g.commit({ n: 1 });
        });
      },
    ),
  );
  await t.host.openThread(thread);
  await t.host.dispatch(
    "boundary.settle.after",
    { turnId: t.ids.next("trn"), aborted: false },
    { threadId: thread, dispatchKey: "k" },
  );
  await t.settled();
  expect(seen).toEqual([1]);
});

test("an agent.settled written on the parent thread by core-agents (turnId null) is dispatched with its owner", async () => {
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
          heard.push(
            `${name}:${payload.childThreadId}:${payload.requestId}:${payload.report?.text}`,
          );
        });
      }),
    );
    return "continue";
  });
  const parent = t.newThread();
  await t.host.openThread(parent);
  const child = t.newThread();
  fake.emit([
    {
      id: t.ids.next("evt"),
      kind: "agent.settled",
      version: 1,
      threadId: parent,
      turnId: null,
      stepId: null,
      recordedAt: 1,
      causationId: null,
      correlationId: null,
      payload: {
        childThreadId: child,
        requestId: "learning:review:3",
        status: "completed",
        report: { text: "ok", truncated: false, flags: [], originalChars: 2 },
        answerItemId: null,
        usage: null,
        error: null,
        owner: { kind: "scope", scopeId: "lc-b" },
      },
      durable: true,
      seq: 7,
      parentId: null,
    },
  ]);
  await t.settled();
  expect(heard).toEqual([`lc-b:${child}:learning:review:3:ok`]);
});

test("an event that arrives while its thread is closed is held and fires when the thread opens", async () => {
  const t = await createTestHost({ without: ["records"] });
  const fake = fakeFeed();
  await t.host.registerPlatform({
    name: "test-feed",
    setup(ctx) {
      ctx.providePort(SessionFeedPortKey, fake.feed);
    },
  });
  const heard: string[] = [];
  await t.host.install(
    makeUnit({ name: "lc-held", points: ["lifecycle.agent.settled"] }, (g) => {
      g.on("lifecycle.agent.settled", (payload) => {
        heard.push(payload.requestId);
      });
    }),
  );
  const other = t.newThread();
  await t.host.openThread(other); // 피드 구독을 시작한다
  const parent = t.newThread();
  fake.emit([
    {
      id: t.ids.next("evt"),
      kind: "agent.settled",
      version: 1,
      threadId: parent,
      turnId: null,
      stepId: null,
      recordedAt: 1,
      causationId: null,
      correlationId: null,
      payload: {
        childThreadId: t.newThread(),
        requestId: "late-1",
        status: "completed",
        report: null,
        answerItemId: null,
        usage: null,
        error: null,
      },
      durable: true,
      seq: 2,
      parentId: null,
    },
  ]);
  await t.settled();
  expect(heard).toEqual([]);
  await t.host.openThread(parent);
  await t.settled();
  expect(heard).toEqual(["late-1"]);
});
