import { expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { ThreadId, TurnId } from "@fresnel/contracts/conversation";
import type { DurableEventEnvelope, EventFeed, CommitListener } from "@fresnel/contracts/records";
import { RecordCommitPortKey, type RegistrationDef } from "@fresnel/contracts/extensions";
import { SessionFeedPortKey } from "../../src/primitives/index.ts";
import { eachInOrder } from "../../src/primitives/sequence.ts";
import { Type } from "typebox";
import { createTestHost, memoryRecordStore } from "../../src/testing/index.ts";
import { makeGroupUnit, makeUnit } from "./fixtures/support.ts";

// M3-REQ-102·108(수명주기 지점은 커밋 뒤에 발화). lease.rejected는 새로 발행되지 않고 옛 기록을 읽을 때만 있다

type Host = Awaited<ReturnType<typeof createTestHost>>;

function installDriveGroups(t: Host, names: readonly string[]): Promise<void> {
  return eachInOrder(names.entries(), async ([loadIndex, name]) => {
    await t.host.install(
      makeGroupUnit({ name, loadIndex }, (g) => {
        g.drive(() => {
          return Promise.resolve({ do: "yield" });
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

test("a failed boundary commit does not fire the lifecycle point", async () => {
  const t = await createTestHost();
  const thread = t.newThread();
  const heard: unknown[] = [];
  await t.host.install(
    makeUnit({ name: "lr-listener", hooks: ["lifecycle.lease.rejected"], loadIndex: 5 }, (g) => {
      g.on("lifecycle.lease.rejected", (payload) => {
        heard.push(payload);
      });
    }),
  );
  await installDriveGroups(t, ["lr-a"]);
  await t.host.openThread(thread);
  t.host.startDrive(thread, "lr-a");
  await t.settled();
  expect(t.host.leaseOf(thread)?.scopeId).toBe("lr-a");
  await t.boundary(thread).turnSettled({ fail: true });
  await t.settled();
  expect(heard).toEqual([]);
  expect(rejectedIn(t, thread)).toEqual([]);
  // lease.rejected는 더 이상 새로 발행되지 않으므로 다음 경계가 커밋되어도 지점은 발화하지 않는다
  await t.boundary(thread).turnSettled();
  await t.settled();
  expect(heard).toEqual([]);
  expect(rejectedIn(t, thread)).toEqual([]);
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
      makeUnit({ name, loadIndex, hooks: ["lifecycle.agent.settled"] }, (g) => {
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
const counterDef: RegistrationDef<{ n: number }> = {
  state: { schema: CounterSchema, initial: { n: 0 }, version: 1 },
};

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
        hooks: ["lifecycle.agent.settled", "boundary.settle.after"],
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
      makeUnit({ name, loadIndex, hooks: ["lifecycle.agent.settled"] }, (g) => {
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
    makeUnit({ name: "lc-held", hooks: ["lifecycle.agent.settled"] }, (g) => {
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
