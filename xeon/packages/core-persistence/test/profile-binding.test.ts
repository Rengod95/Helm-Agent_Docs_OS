import { describe, expect, test } from "bun:test";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { completeTurn, itemAt } from "./support/branching.ts";
import { expectOk, newThread, openHarness } from "./support/harness.ts";

// M5c §4.1.1: 대화가 참조하는 프로필 id는 thread.started.profileId(생성)와 thread.updated.profileId(전환)로 저장한다.
// 활성 가지의 마지막 값이 현재 값이고, 없으면 기본(`default`)이다. 투영 행과 요약 행에 실린다.

describe("thread profile binding", () => {
  test("a created thread stores its profile id, and a thread created without one has none", async () => {
    const h = await openHarness();
    const threadId = h.ids.next("thr");
    expectOk(h.service.threads.create({ threadId, title: "t", profileId: "review" }));
    expect(expectOk(h.service.query.thread(threadId))?.profileId).toBe("review");
    const plain = newThread(h, "plain").threadId;
    expect(expectOk(h.service.query.thread(plain))?.profileId).toBeUndefined();
  });

  test("setProfile stores the id, the last value wins, and title or model changes keep it", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "before");
    expectOk(h.service.threads.setProfile(threadId, "review", "p1"));
    expect(expectOk(h.service.query.thread(threadId))?.profileId).toBe("review");
    expectOk(h.service.threads.setTitle(threadId, "renamed", "p-t"));
    expectOk(h.service.threads.setModel(threadId, "a/one", "p-m"));
    expect(expectOk(h.service.query.thread(threadId))?.profileId).toBe("review");
    expectOk(h.service.threads.setProfile(threadId, "default", "p2"));
    expect(expectOk(h.service.query.thread(threadId))?.profileId).toBe("default");
  });

  test("the profile id is on the thread summary row that thread.list reads", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "listed");
    expectOk(h.service.threads.setProfile(threadId, "review", "p1"));
    const listed = h.service.threads.list({}).threads.find((row) => row.threadId === threadId);
    expect(listed?.profileId).toBe("review");
  });

  test("the same request key with another profile is key_reused, like the model", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "same");
    expectOk(h.service.threads.setProfile(threadId, "a", "same"));
    expectOk(h.service.threads.setProfile(threadId, "a", "same"));
    expect(h.service.threads.setProfile(threadId, "b", "same")).toEqual({
      ok: false,
      error: { kind: "key_reused", requestKey: "same" },
    });
  });

  test("a closed thread refuses a profile switch and keeps the old value", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "closing");
    expectOk(h.service.threads.setProfile(threadId, "review", "p1"));
    expectOk(h.service.threads.close(threadId, "done"));
    expect(h.service.threads.setProfile(threadId, "default", "p2")).toEqual({
      ok: false,
      error: { kind: "thread_closed", threadId },
    });
    expect(expectOk(h.service.query.thread(threadId))?.profileId).toBe("review");
  });

  test("a forked thread takes the profile of its source", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "origin");
    expectOk(h.service.threads.setProfile(threadId, "review", "p1"));
    completeTurn(h, threadId);
    const forkId = h.ids.next("thr");
    expectOk(await h.service.threads.fork(threadId, itemAt(h, threadId, 0).itemId, forkId));
    expect(expectOk(h.service.query.thread(forkId))?.profileId).toBe("review");
  });

  test("the profile id survives a projection rebuild", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h, "rebuilt");
    expectOk(h.service.threads.setProfile(threadId, "review", "p1"));
    expectProjectionsRebuildable(h.store.db);
    expect(expectOk(h.service.query.thread(threadId))?.profileId).toBe("review");
  });
});
