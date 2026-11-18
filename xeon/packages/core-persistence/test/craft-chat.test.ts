import { describe, expect, test } from "bun:test";
import type { ContextRef, CraftChatStarted, ThreadId } from "@fresnel/contracts/conversation";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { completeTurn, itemAt } from "./support/branching.ts";
import { expectOk, newThread, openHarness, type Harness } from "./support/harness.ts";
import { TEST_HOLDER_A } from "./support/sqlite-store.ts";

// M5c §4.8.1~§4.8.3: 테스트 대화의 표지는 thread.started.craftChat이 쓰고, thread.updated.craftChat이 플러그인에 한 번 묶는다.
// 표지는 투영 행(craft_chat, craft_plugin, craft_contexts)과 요약(ThreadSummaryRow.craftChat)에 실린다.
// thread.list는 표지가 있는 대화를 기본으로 뺀다(includeCraft가 참이면 낸다).

const HELM_CONTEXT: ContextRef = { kind: "plugin", name: "helm" };

function craftRow(h: Harness, threadId: string) {
  return h.store.raw
    .query<Record<string, string | number | null>, [string]>(
      "SELECT craft_chat, craft_plugin, craft_contexts FROM p_threads WHERE thread_id = ?",
    )
    .get(threadId);
}

function updatedCount(h: Harness, threadId: string): number {
  return (
    h.store.raw
      .query<{ n: number }, [string]>(
        "SELECT COUNT(*) AS n FROM events WHERE thread_id = ? AND kind = 'thread.updated'",
      )
      .get(threadId)?.n ?? -1
  );
}

/** 이 시험이 대화의 쓰기 소유를 쥐게 한다(newThread와 같은 순서). create와 fork는 임대를 주지 않는다 */
function ownForWrite(h: Harness, threadId: ThreadId): void {
  const token = expectOk(h.store.leases.acquire(`thread:${threadId}`, TEST_HOLDER_A));
  expectOk(h.service.openForWrite(threadId, token));
}

/** 표지가 든 대화를 만들고 쓰기 소유를 쥔다 */
function createCraft(h: Harness, title: string, craftChat: CraftChatStarted): ThreadId {
  const threadId = h.ids.next("thr");
  expectOk(h.service.threads.create({ threadId, title, craftChat }));
  ownForWrite(h, threadId);
  return threadId;
}

describe("craft chat marker: thread.started", () => {
  test("a created craft thread stores its marker, and a plain thread has none", async () => {
    const h = await openHarness();
    const threadId = createCraft(h, "test chat", { plugin: null, contexts: [HELM_CONTEXT] });
    expect(expectOk(h.service.query.thread(threadId))?.craftChat).toEqual({ plugin: null });
    expect(craftRow(h, threadId)).toEqual({
      craft_chat: 1,
      craft_plugin: null,
      craft_contexts: JSON.stringify([HELM_CONTEXT]),
    });
    const plain = newThread(h, "plain").threadId;
    expect(expectOk(h.service.query.thread(plain))?.craftChat).toBeUndefined();
    expect(craftRow(h, plain)).toEqual({ craft_chat: 0, craft_plugin: null, craft_contexts: null });
  });

  test("the projector takes the plugin from thread.started when the chat is created bound", async () => {
    const h = await openHarness();
    const threadId = createCraft(h, "bound at start", { plugin: "helm", contexts: [] });
    expect(expectOk(h.service.query.thread(threadId))?.craftChat).toEqual({ plugin: "helm" });
    expect(craftRow(h, threadId)).toMatchObject({ craft_chat: 1, craft_plugin: "helm" });
  });

  test("a stored context list that does not match the schema is a row_invalid value", async () => {
    const h = await openHarness();
    const threadId = createCraft(h, "damaged", { plugin: null, contexts: [] });
    h.store.raw.run("UPDATE p_threads SET craft_contexts = ? WHERE thread_id = ?", [
      '[{"kind":"bogus"}]',
      threadId,
    ]);
    expect(h.service.query.thread(threadId)).toEqual({
      ok: false,
      error: { kind: "row_invalid", where: "p_threads.craft_contexts" },
    });
  });
});

describe("craft chat marker: thread.updated binds the plugin once", () => {
  test("setCraftPlugin binds an unbound chat, and the projection and summary show it", async () => {
    const h = await openHarness();
    const threadId = createCraft(h, "to bind", { plugin: null, contexts: [] });
    expectOk(h.service.threads.setCraftPlugin(threadId, "helm", "bind-1"));
    expect(expectOk(h.service.query.thread(threadId))?.craftChat).toEqual({ plugin: "helm" });
    expect(craftRow(h, threadId)).toMatchObject({ craft_chat: 1, craft_plugin: "helm" });
    expectProjectionsRebuildable(h.store.db);
    expect(craftRow(h, threadId)).toMatchObject({ craft_plugin: "helm" });
  });

  test("the same plugin again is a no-op that writes nothing", async () => {
    const h = await openHarness();
    const threadId = createCraft(h, "same again", { plugin: null, contexts: [] });
    expectOk(h.service.threads.setCraftPlugin(threadId, "helm", "bind-1"));
    const before = updatedCount(h, threadId);
    expectOk(h.service.threads.setCraftPlugin(threadId, "helm", "bind-2"));
    expect(updatedCount(h, threadId)).toBe(before);
    expect(expectOk(h.service.query.thread(threadId))?.craftChat).toEqual({ plugin: "helm" });
  });

  test("a different plugin is refused with an error value and the binding stays", async () => {
    const h = await openHarness();
    const threadId = createCraft(h, "refused", { plugin: null, contexts: [] });
    expectOk(h.service.threads.setCraftPlugin(threadId, "helm", "bind-1"));
    const before = updatedCount(h, threadId);
    expect(h.service.threads.setCraftPlugin(threadId, "other", "bind-3")).toEqual({
      ok: false,
      error: { kind: "craft_plugin_bound", threadId, bound: "helm", requested: "other" },
    });
    expect(updatedCount(h, threadId)).toBe(before);
    expect(expectOk(h.service.query.thread(threadId))?.craftChat).toEqual({ plugin: "helm" });
  });

  test("a chat created bound refuses a different plugin too", async () => {
    const h = await openHarness();
    const threadId = createCraft(h, "bound at start again", { plugin: "helm", contexts: [] });
    expect(h.service.threads.setCraftPlugin(threadId, "other", "bind-4")).toEqual({
      ok: false,
      error: { kind: "craft_plugin_bound", threadId, bound: "helm", requested: "other" },
    });
  });

  test("a thread without the marker refuses a binding with not_craft_chat", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "plain");
    expect(h.service.threads.setCraftPlugin(threadId, "helm", "bind-5")).toEqual({
      ok: false,
      error: { kind: "not_craft_chat", threadId },
    });
    expect(expectOk(h.service.query.thread(threadId))?.craftChat).toBeUndefined();
  });

  test("a closed craft chat refuses a binding and stays unbound", async () => {
    const h = await openHarness();
    const threadId = createCraft(h, "closing", { plugin: null, contexts: [] });
    expectOk(h.service.threads.close(threadId, "done"));
    expect(h.service.threads.setCraftPlugin(threadId, "helm", "bind-6")).toEqual({
      ok: false,
      error: { kind: "thread_closed", threadId },
    });
    expect(expectOk(h.service.query.thread(threadId))?.craftChat).toEqual({ plugin: null });
  });
});

describe("craft chat marker: thread.list and fork", () => {
  test("thread.list leaves craft chats out by default and includeCraft returns them", async () => {
    const h = await openHarness();
    const plain = newThread(h, "plain").threadId;
    const craft = createCraft(h, "craft", { plugin: null, contexts: [] });
    const defaults = h.service.threads.list({}).threads.map((row) => row.threadId);
    expect(defaults).toContain(plain);
    expect(defaults).not.toContain(craft);
    const all = h.service.threads.list({ includeCraft: true }).threads;
    const allIds = all.map((row) => row.threadId);
    expect(allIds).toContain(plain);
    expect(allIds).toContain(craft);
    expect(all.find((row) => row.threadId === craft)?.craftChat).toEqual({ plugin: null });
    expect(all.find((row) => row.threadId === plain)?.craftChat).toBeUndefined();
  });

  test("a fork copies the marker, its plugin and its contexts", async () => {
    const h = await openHarness();
    const origin = createCraft(h, "origin", { plugin: "helm", contexts: [HELM_CONTEXT] });
    completeTurn(h, origin);
    const forkId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(origin, itemAt(h, origin, 0).itemId, forkId));
    expect(expectOk(h.service.query.thread(forkId))?.craftChat).toEqual({ plugin: "helm" });
    expect(craftRow(h, forkId)).toEqual(craftRow(h, origin));
    expect(h.service.threads.list({}).threads.map((row) => row.threadId)).not.toContain(forkId);
  });

  test("a fork of an unbound craft chat stays unbound and can still bind once", async () => {
    const h = await openHarness();
    const origin = createCraft(h, "unbound origin", { plugin: null, contexts: [] });
    completeTurn(h, origin);
    const forkId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(origin, itemAt(h, origin, 0).itemId, forkId));
    expect(expectOk(h.service.query.thread(forkId))?.craftChat).toEqual({ plugin: null });
    ownForWrite(h, forkId);
    expectOk(h.service.threads.setCraftPlugin(forkId, "helm", "fork-bind"));
    expect(expectOk(h.service.query.thread(forkId))?.craftChat).toEqual({ plugin: "helm" });
  });
});

describe("craft context: craft.context is recorded on a craft chat only (M5c §4.8.8)", () => {
  test("recordCraftContext appends one craft.context event with the refs and intent, and an ordinary thread refuses it", async () => {
    const h = await openHarness();
    const threadId = createCraft(h, "ctx chat", { plugin: null, contexts: [] });
    const refs: ContextRef[] = [
      { kind: "plugin", name: "demo" },
      { kind: "review", itemId: "rvw_1" },
    ];
    expect(
      h.service.threads.recordCraftContext(threadId, { refs, intent: "올리기" }, "ctx-req-1"),
    ).toEqual({ ok: true, value: undefined });
    const payloads: unknown[] = [];
    for await (const item of h.service.readFrom(0, { threadId })) {
      if (!item.ok) throw new Error(`the thread could not be read: ${item.error.kind}`);
      if (item.value.kind === "craft.context") payloads.push(item.value.payload);
    }
    expect(payloads).toEqual([{ refs, intent: "올리기" }]);
    // 같은 요청 키로 다시 쓰면 기록을 늘리지 않는다(요청 id 멱등)
    expect(
      h.service.threads.recordCraftContext(threadId, { refs, intent: "올리기" }, "ctx-req-1"),
    ).toEqual({ ok: true, value: undefined });
    const plain = newThread(h, "plain").threadId;
    expect(
      h.service.threads.recordCraftContext(plain, { refs, intent: null }, "ctx-req-2"),
    ).toEqual({ ok: false, error: { kind: "not_craft_chat", threadId: plain } });
  });
});
