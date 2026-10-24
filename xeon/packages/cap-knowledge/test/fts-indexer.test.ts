import { afterEach, describe, expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import type { StoreDb } from "@xeon/contracts/records";
import { startIndexer } from "../src/search/indexer.ts";
import { asHost } from "./support/helpers.ts";
import { closeWorlds, createWorld, type World } from "./support/world.ts";

afterEach(closeWorlds);

const KIT = (world: World) => {
  if (world.sessions === undefined) throw new Error("world has no sessions");
  return world.sessions;
};

function count(world: World, table: string, where = "1 = 1"): number {
  const read = world.store.root.read((tx) =>
    tx.get(`SELECT count(*) AS n FROM ${table} WHERE ${where}`),
  );
  if (!read.ok || read.value === undefined) throw new Error("count failed");
  return Number(read.value["n"]);
}

function rows(world: World, sql: string) {
  const read = world.store.root.read((tx) => tx.all(sql));
  if (!read.ok) throw new Error("read failed");
  return read.value;
}

describe("session projection", () => {
  test("a thread becomes a session row with its title, project hash and message count", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread({ title: "Planning", workspace: "/work/alpha" });
    kit.say(threadId, "user", "hello");
    kit.say(threadId, "assistant", "hi there");
    kit.sayWithoutText(threadId);
    kit.toolResult(threadId, "ignored");
    const [row] = rows(world, "SELECT * FROM cap_knowledge_sessions");
    expect(row).toMatchObject({
      thread_id: threadId,
      kind: "main",
      title: "Planning",
      // 사용자·어시스턴트 메시지만 센다(텍스트가 없는 어시스턴트 메시지 포함, 도구 결과 제외)
      messages: 3,
    });
    expect(String(row?.["project"])).toMatch(/^[0-9a-f]{16}$/);
    kit.retitle(threadId, "Planning v2");
    expect(rows(world, "SELECT title FROM cap_knowledge_sessions")[0]?.["title"]).toBe(
      "Planning v2",
    );
    const list = await world.runtime.searchApi.list({}, asHost());
    expect(list.sessions).toMatchObject([
      { sessionId: threadId, title: "Planning v2", kind: "main", messages: 3 },
    ]);
  });

  test("hidden kinds come from agent.spawned in either order", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const parent = kit.newThread({ title: "Parent" });
    const startedFirst = kit.newThread({ title: "Explorer" });
    kit.spawn(parent, startedFirst, false);
    // 부모의 spawned가 자식 thread.started보다 먼저 커밋되는 순서도 kind를 지킨다
    const early = kit.newId();
    kit.spawn(parent, early, true);
    kit.newThread({ id: early, title: "Background job" });
    const kinds = Object.fromEntries(
      rows(world, "SELECT thread_id, kind FROM cap_knowledge_sessions").map((row) => [
        String(row["thread_id"]),
        String(row["kind"]),
      ]),
    );
    expect(kinds[parent]).toBe("main");
    expect(kinds[startedFirst]).toBe("subagent");
    expect(kinds[early]).toBe("background");
    const visible = await world.runtime.searchApi.list({}, asHost());
    expect(visible.sessions.map((session) => session.sessionId)).toEqual([parent]);
    const all = await world.runtime.searchApi.list({ includeHidden: true }, asHost());
    expect(all.sessions).toHaveLength(3);
  });
});

describe("session indexing", () => {
  test("only user and assistant text is indexed", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", "first question");
    kit.say(threadId, "assistant", "the answer");
    kit.sayWithoutText(threadId);
    kit.toolResult(threadId, "tool output that must not be searchable");
    await world.settleIndex();
    expect(count(world, "cap_knowledge_sessiondocs")).toBe(2);
    expect(count(world, "cap_knowledge_sessionfts")).toBe(2);
    expect(count(world, "cap_knowledge_sessionfts", "text LIKE '%searchable%'")).toBe(0);
    expect(count(world, "cap_knowledge_sessionfts", "text LIKE '%secret reasoning%'")).toBe(0);
    const seqs = rows(world, "SELECT seq, role FROM cap_knowledge_sessiondocs ORDER BY seq");
    expect(seqs.map((row) => `${String(row["seq"])}:${String(row["role"])}`)).toEqual([
      "1:user",
      "2:assistant",
    ]);
  });

  test("the cursor advances over events that are not indexed", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.toolResult(threadId, "only a tool result");
    await world.settleIndex();
    const cursor = rows(world, "SELECT event_seq FROM cap_knowledge_sessioncursor");
    expect(Number(cursor[0]?.["event_seq"])).toBeGreaterThan(0);
    expect(count(world, "cap_knowledge_sessiondocs")).toBe(0);
  });

  test("idempotent on redelivery", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", "alpha message");
    kit.say(threadId, "assistant", "beta message");
    await world.settleIndex();
    const before = [
      count(world, "cap_knowledge_sessiondocs"),
      count(world, "cap_knowledge_sessionfts"),
    ];
    expect(before).toEqual([2, 2]);
    // 커서를 0으로 되돌려 같은 이벤트를 다시 받게 한다
    world.store.root.write((tx) => {
      tx.run("UPDATE cap_knowledge_sessioncursor SET event_seq = 0");
    });
    const again = startIndexer({
      session: KIT(world).session,
      db: world.deps.db,
      logger: world.deps.logger,
    });
    if (!again.ok) throw new Error(again.error.message);
    await again.value.settled();
    expect([
      count(world, "cap_knowledge_sessiondocs"),
      count(world, "cap_knowledge_sessionfts"),
    ]).toEqual(before);
    // 다시 받은 뒤에도 세션 안 메시지 번호는 그대로다
    expect(
      rows(world, "SELECT seq FROM cap_knowledge_sessiondocs ORDER BY seq").map((r) =>
        Number(r["seq"]),
      ),
    ).toEqual([1, 2]);
    again.value.stop();
  });

  test("cursor and rows in one transaction", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    kit.say(threadId, "user", "kept after the failed write");
    await world.settleIndex();
    world.store.root.write((tx) => {
      tx.run("DELETE FROM cap_knowledge_sessioncursor");
      tx.run("DELETE FROM cap_knowledge_sessionfts");
      tx.run("DELETE FROM cap_knowledge_sessiondocs");
    });
    // 쓰기 콜백이 행을 넣은 뒤에 던지면 행과 커서가 함께 취소된다
    let armed = true;
    const failing: StoreDb = {
      read: (fn) => world.deps.db.read(fn),
      write: (fn) =>
        world.deps.db.write((tx) => {
          const result = fn(tx);
          if (armed) throw new Error("injected failure before commit");
          return result;
        }),
    };
    const first = startIndexer({
      session: KIT(world).session,
      db: failing,
      logger: world.deps.logger,
    });
    if (!first.ok) throw new Error(first.error.message);
    await first.value.settled();
    expect(count(world, "cap_knowledge_sessiondocs")).toBe(0);
    expect(count(world, "cap_knowledge_sessionfts")).toBe(0);
    expect(count(world, "cap_knowledge_sessioncursor")).toBe(0);
    expect(world.logs.some((line) => line.event === "knowledge.indexer.failed")).toBe(true);
    first.value.stop();
    // 재시작하면 같은 배치부터 처리한다
    armed = false;
    const second = startIndexer({
      session: KIT(world).session,
      db: failing,
      logger: world.deps.logger,
    });
    if (!second.ok) throw new Error(second.error.message);
    await second.value.settled();
    expect(count(world, "cap_knowledge_sessiondocs")).toBe(1);
    expect(count(world, "cap_knowledge_sessionfts")).toBe(1);
    second.value.stop();
  });

  test("a failed read of the cursor stops the start without throwing", async () => {
    const world = await createWorld({ sessions: true });
    const broken: StoreDb = {
      read: () => err({ kind: "busy" }),
      write: (fn) => world.deps.db.write(fn),
    };
    const started = startIndexer({
      session: KIT(world).session,
      db: broken,
      logger: world.deps.logger,
    });
    expect(started.ok).toBe(false);
  });

  test("session delete removes index", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const keep = kit.newThread({ title: "keep" });
    const drop = kit.newThread({ title: "drop" });
    kit.say(keep, "user", "stays in the index");
    kit.say(drop, "user", "leaves with the session");
    await world.settleIndex();
    expect(count(world, "cap_knowledge_sessiondocs")).toBe(2);
    const removed = kit.session.threads.remove(drop);
    expect(removed.ok).toBe(true);
    expect(count(world, "cap_knowledge_sessions", `thread_id = '${drop}'`)).toBe(0);
    expect(count(world, "cap_knowledge_sessiondocs", `thread_id = '${drop}'`)).toBe(0);
    expect(count(world, "cap_knowledge_sessionfts", `thread_id = '${drop}'`)).toBe(0);
    expect(count(world, "cap_knowledge_sessiondocs")).toBe(1);
    const hits = await world.runtime.searchApi.query(
      { query: "leaves with the session" },
      asHost(),
    );
    expect(hits.hits).toEqual([]);
  });

  test("a very long message is restored from its blob before it is indexed", async () => {
    const world = await createWorld({ sessions: true });
    const kit = KIT(world);
    const threadId = kit.newThread();
    const long = `${"filler words ".repeat(30_000)}needle-at-the-end`;
    kit.say(threadId, "user", long);
    await world.settleIndex();
    const [row] = rows(world, "SELECT chars FROM cap_knowledge_sessiondocs");
    expect(Number(row?.["chars"])).toBe(Array.from(long).length);
    const hits = await world.runtime.searchApi.query({ query: "needle-at-the-end" }, asHost());
    expect(hits.hits).toHaveLength(1);
  });
});
