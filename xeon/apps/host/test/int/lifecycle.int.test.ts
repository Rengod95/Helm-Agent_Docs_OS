import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { WireError, type HostConnection } from "@xeon/contracts/wire";
import { createHostConnection } from "../../src/client.ts";
import { startInProcessHost, type InProcessHost } from "../../src/main.ts";
import { useEngineHome, type EngineHome } from "../fixtures/engine-home.ts";
import { realEngineGate } from "../fixtures/real-engine.ts";
import { rejectionOf } from "../fixtures/rejection.ts";
import { answeringModels } from "../fixtures/tape-host.ts";
import { TAPE_SETTINGS, writeUserSettings } from "../fixtures/user-settings.ts";
import { collectEvents, HELLO_PARAMS } from "../fixtures/wire-client.ts";

// HOST.2, HOST.4 (int): 실제 엔진과 저장소 위의 thread 수명 주기와 읽기. 모델은 테이프다.

const gate = await realEngineGate();
const realTest = gate.blocker === undefined ? test : test.skip;

async function wireErrorOf(call: Promise<unknown>): Promise<WireError> {
  const caught = await rejectionOf(call);
  if (caught instanceof WireError) return caught;
  throw caught;
}

interface Session {
  readonly home: EngineHome;
  readonly host: InProcessHost;
  readonly connection: HostConnection;
  close(): Promise<void>;
}

/** 시험마다 새 엔진 홈(저장소)에서 시작한다. 같은 홈에 이어서 여는 시험은 `home`을 넘긴다 */
async function start(answers: string, shared?: EngineHome): Promise<Session> {
  const home = shared ?? useEngineHome();
  if (shared === undefined) writeUserSettings(home, TAPE_SETTINGS);
  const host = await startInProcessHost({
    devChecks: true,
    defaultGroups: false,
    buildModels: answeringModels("lifecycle", answers),
  });
  const connection = createHostConnection(host.client);
  await connection.request("host.hello", HELLO_PARAMS);
  return {
    host,
    connection,
    home,
    async close() {
      await connection.close();
      await host.close();
      if (shared === undefined) home.dispose();
    },
  };
}

/** 한 번 묻고 답이 끝난 thread를 만든다 */
async function answeredThread(session: Session): Promise<ThreadId> {
  const collector = collectEvents(session.connection);
  await session.connection.request("events.subscribe", { from: "head" });
  const created = await session.connection.request("thread.create", { title: "lifecycle" });
  await session.connection.request("turn.start", { threadId: created.threadId, input: "question" });
  await collector.waitFor((event) => event.kind === "turn.completed");
  return created.threadId;
}

describe("thread.read", () => {
  realTest(
    "reads the committed items oldest first with the head the items were read at",
    async () => {
      const session = await start("the answer");
      const threadId = await answeredThread(session);
      const read = await session.connection.request("thread.read", { threadId });
      expect(read.threadId).toBe(threadId);
      expect(read.hasMore).toBe(false);
      // 시스템 프롬프트 item은 첫 단계 시작에 기록된다
      expect(read.items.map((item) => item.kind)).toEqual(["user", "system", "assistant"]);
      const [user, , assistant] = read.items;
      expect(user).toMatchObject({ kind: "user", message: { content: "question" } });
      expect(JSON.stringify(assistant)).toContain("the answer");
      const subscribed = await session.connection.request("events.subscribe", { from: "head" });
      expect(read.position.storeId).toBe(subscribed.storeId);
      expect(read.position.seq).toBe(subscribed.headSeq);
      await session.close();
    },
  );

  realTest("pages backwards with limit and before; hasMore is exact", async () => {
    const session = await start("a");
    const threadId = await answeredThread(session);
    const newest = await session.connection.request("thread.read", { threadId, limit: 1 });
    expect(newest.items.map((item) => item.kind)).toEqual(["assistant"]);
    expect(newest.hasMore).toBe(true);
    const first = newest.items[0];
    if (first === undefined) throw new Error("expected an item");
    const older = await session.connection.request("thread.read", {
      threadId,
      limit: 1,
      before: first.itemId,
    });
    expect(older.items.map((item) => item.kind)).toEqual(["system"]);
    expect(older.hasMore).toBe(true);
    const oldest = older.items[0];
    if (oldest === undefined) throw new Error("expected an item");
    const head = await session.connection.request("thread.read", {
      threadId,
      limit: 5,
      before: oldest.itemId,
    });
    expect(head.items.map((item) => item.kind)).toEqual(["user"]);
    expect(head.hasMore).toBe(false);
    await session.close();
  });

  realTest(
    "an unknown thread is 3001; an item that is not in the thread is 3005 item_not_found",
    async () => {
      const session = await start("a");
      const threadId = await answeredThread(session);
      const other = await session.connection.request("thread.create", {});
      const read = await session.connection.request("thread.read", { threadId });
      const item = read.items[0];
      if (item === undefined) throw new Error("expected an item");
      const unknownThread = await wireErrorOf(
        session.connection.request("thread.read", {
          threadId: session.host.engine.ports.ids.next("thr"),
        }),
      );
      expect(unknownThread.code).toBe(3001);
      const foreign = await wireErrorOf(
        session.connection.request("thread.read", {
          threadId: other.threadId,
          before: item.itemId,
        }),
      );
      expect(foreign.code).toBe(3005);
      expect(foreign.data.details).toEqual({ reason: "item_not_found" });
      const missing = await wireErrorOf(
        session.connection.request("thread.read", {
          threadId,
          before: session.host.engine.ports.ids.next("itm"),
        }),
      );
      expect(missing.data.details).toEqual({ reason: "item_not_found" });
      await session.close();
    },
  );

  realTest("a thread nobody owns can be read without taking the ownership", async () => {
    const session = await start("a");
    const threadId = await answeredThread(session);
    await session.connection.request("thread.close", { threadId });
    // 같은 홈의 저장소를 연 두 번째 호스트. 모델은 쓰지 않는다
    const reader = await startInProcessHost({ devChecks: true, defaultGroups: false });
    const other = createHostConnection(reader.client);
    await other.request("host.hello", HELLO_PARAMS);
    // 같은 저장소를 연 두 번째 호스트는 쓰기 소유를 얻지 못해도 읽는다
    const read = await other.request("thread.read", { threadId });
    expect(read.items).toHaveLength(3);
    await other.close();
    await reader.close();
    await session.close();
  });
});

describe("thread lifecycle", () => {
  realTest("thread.list shows the thread with its title and pending counts", async () => {
    const session = await start("a");
    const threadId = await answeredThread(session);
    const listed = await session.connection.request("thread.list", {});
    const row = listed.threads.find((thread) => thread.threadId === threadId);
    expect(row).toMatchObject({ title: "lifecycle", pendingApprovals: 0, queuedInputs: 0 });
    expect(listed.nextCursor).toBeNull();
    await session.close();
  });

  realTest(
    "fork makes a new thread that points at its source and that this connection owns",
    async () => {
      const session = await start("a");
      const threadId = await answeredThread(session);
      const forked = await session.connection.request("thread.fork", { threadId });
      expect(forked.threadId).not.toBe(threadId);
      const listed = await session.connection.request("thread.list", {});
      const row = listed.threads.find((thread) => thread.threadId === forked.threadId);
      expect(row?.forkedFrom?.threadId).toBe(threadId);
      // 소유한 thread라 turn.interrupt가 3002가 아니다
      expect(
        await session.connection.request("turn.interrupt", { threadId: forked.threadId }),
      ).toEqual({
        interrupted: false,
      });
      await session.close();
    },
  );

  realTest("fork at an unknown item is 3005", async () => {
    const session = await start("a");
    const threadId = await answeredThread(session);
    const error = await wireErrorOf(
      session.connection.request("thread.fork", {
        threadId,
        at: session.host.engine.ports.ids.next("itm"),
      }),
    );
    expect(error.code).toBe(3005);
    await session.close();
  });

  realTest("revert moves the branch back; the later item is no longer read", async () => {
    const session = await start("a");
    const threadId = await answeredThread(session);
    const before = await session.connection.request("thread.read", { threadId });
    const user = before.items[0];
    if (user === undefined) throw new Error("expected the user item");
    const reverted = await session.connection.request("thread.revert", {
      threadId,
      to: user.itemId,
    });
    expect(reverted.position.seq).toBeGreaterThan(before.position.seq);
    const after = await session.connection.request("thread.read", { threadId });
    expect(after.items.map((item) => item.kind)).toEqual(["user"]);
    // 가지 밖이 된 item을 before로 부르면 not_on_branch다
    const assistant = before.items[2];
    if (assistant === undefined) throw new Error("expected the assistant item");
    const off = await wireErrorOf(
      session.connection.request("thread.read", { threadId, before: assistant.itemId }),
    );
    expect(off.data.details).toEqual({ reason: "not_on_branch" });
    await session.close();
  });

  realTest("delete removes the thread; a thread with forks cannot be deleted (3004)", async () => {
    const session = await start("a");
    const threadId = await answeredThread(session);
    const forked = await session.connection.request("thread.fork", { threadId });
    const blocked = await wireErrorOf(session.connection.request("thread.delete", { threadId }));
    expect(blocked.code).toBe(3004);
    expect(blocked.data.details).toEqual({ forks: [forked.threadId] });
    await session.connection.request("thread.delete", { threadId: forked.threadId });
    await session.connection.request("thread.delete", { threadId });
    const gone = await wireErrorOf(session.connection.request("thread.read", { threadId }));
    expect(gone.code).toBe(3001);
    expect((await session.connection.request("thread.list", {})).threads).toEqual([]);
    await session.close();
  });

  realTest(
    "delete works on a thread this host does not hold yet, then gives the lock back",
    async () => {
      const first = await start("a");
      const threadId = await answeredThread(first);
      await first.connection.request("thread.close", { threadId });
      await first.connection.close();
      await first.host.close();
      const second = await start("a", first.home);
      // 새 호스트는 아직 이 thread의 잠금이 없다. delete가 얻어서 지운다
      await second.connection.request("thread.delete", { threadId });
      expect((await second.connection.request("thread.list", {})).threads).toEqual([]);
      await second.close();
      first.home.dispose();
    },
  );
});

describe("host.status and unsubscribe", () => {
  realTest("host.status counts connections and events.unsubscribe ends the stream", async () => {
    const session = await start("a");
    const status = await session.connection.request("host.status", {});
    expect(status).toMatchObject({ mode: "in-process", connections: 1, liveTurns: 0 });
    expect(status.pid).toBe(process.pid);
    const subscribed = await session.connection.request("events.subscribe", { from: "head" });
    await session.connection.request("events.unsubscribe", { sub: subscribed.sub });
    const again = await wireErrorOf(
      session.connection.request("events.unsubscribe", { sub: subscribed.sub }),
    );
    expect(again.code).toBe(2002);
    await session.close();
  });
});
