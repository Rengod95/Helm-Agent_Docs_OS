import { describe, expect, test } from "bun:test";
import type { ItemRecord } from "@fresnel/contracts/conversation";
import { itm, prt, STORE, summary, thr, userItem } from "../state/helpers.ts";
import { engineFake, makeApp, until, type EngineExtra } from "./support.ts";

// 대화 메시지 단위 명령(갈라내기, 되감기, 다시 만들기)을 가짜 엔진 위에서 끝까지 돌린다. wire params는 `toEqual`로 정확히 비교한다.

const POSITION = { storeId: STORE, seq: 7 };
const LOCKED = {
  code: 3002,
  kind: "thread.locked",
  details: { ownerKind: "cli", options: ["observe", "fork", "delegate"] },
};

const USAGE = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** 답 item. 가짜 엔진의 thread.read 결과에 JSON으로 실린다 */
function reply(n: number, text: string): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "assistant",
    message: {
      role: "assistant",
      content: [{ type: "text", text }],
      api: "anthropic-messages",
      provider: "anthropic",
      model: "m",
      usage: USAGE,
      stopReason: "stop",
      timestamp: 0,
    },
    partIds: [prt(n * 10)],
  };
}

async function liveApp(extra: EngineExtra, threads = [summary(thr(1))]) {
  const engine = engineFake(threads, undefined, extra);
  const app = makeApp(engine.fake);
  await until(() => app.engine.read.getState().threads.status === "ready", "threads ready");
  return { app, ...engine };
}

/** 대화 하나를 열고 확정 기록이 올라올 때까지 기다린다 */
async function openedApp(extra: EngineExtra, threads = [summary(thr(1))]) {
  const made = await liveApp(extra, threads);
  made.app.commands.selectThread(thr(1));
  await until(
    () => made.app.engine.read.getState().transcript?.status === "ready",
    "transcript ready",
  );
  return made;
}

const sent = (params: readonly { method: string; params: unknown }[], method: string) =>
  params.filter((entry) => entry.method === method).map((entry) => entry.params);

const TRANSCRIPT = {
  threadId: thr(1),
  items: [userItem(1, "hello"), reply(2, "hi there")],
  position: POSITION,
  hasMore: false,
};

describe("message commands: fork at a message", () => {
  test("sends the item as the fork point and opens the new conversation", async () => {
    const { app, params } = await liveApp({
      results: { "thread.fork": { threadId: thr(2), position: POSITION } },
    });
    const done = await app.commands.message.forkAt(thr(1), itm(1));
    expect(done).toEqual({ ok: true, value: null });
    expect(sent(params, "thread.fork")).toEqual([{ threadId: thr(1), at: itm(1) }]);
    expect(app.ui.read.getState().selectedThreadId).toBe(thr(2));
    await app.stop();
  });

  test("a refused fork comes back as a rejected value and nothing is selected", async () => {
    const { app } = await liveApp({
      errors: {
        "thread.fork": {
          code: 3005,
          kind: "thread.invalidTarget",
          details: { reason: "not_on_branch" },
        },
      },
    });
    const done = await app.commands.message.forkAt(thr(1), itm(1));
    expect(done).toEqual({ ok: false, error: { kind: "rejected", code: 3005 } });
    expect(app.ui.read.getState().selectedThreadId).toBeNull();
    await app.stop();
  });
});

describe("message commands: rewind to a message", () => {
  test("sends the item as the last kept item and sends no turn", async () => {
    const { app, params } = await liveApp({ results: { "thread.revert": { position: POSITION } } });
    const done = await app.commands.message.rewindTo(thr(1), itm(1));
    expect(done).toEqual({ ok: true, value: null });
    expect(sent(params, "thread.revert")).toEqual([{ threadId: thr(1), to: itm(1) }]);
    expect(sent(params, "turn.start")).toEqual([]);
    await app.stop();
  });

  test("refuses while a turn runs and sends nothing", async () => {
    const { app, params } = await liveApp(
      { results: { "thread.revert": { position: POSITION } } },
      [summary(thr(1), { status: "running" })],
    );
    const done = await app.commands.message.rewindTo(thr(1), itm(1));
    expect(done).toEqual({ ok: false, error: { kind: "rejected", code: 3003 } });
    expect(sent(params, "thread.revert")).toEqual([]);
    await app.stop();
  });

  test("a lock held by another process opens the dialog and the error comes back", async () => {
    const { app } = await liveApp({ errors: { "thread.revert": LOCKED } });
    const done = await app.commands.message.rewindTo(thr(1), itm(1));
    expect(done).toEqual({
      ok: false,
      error: { kind: "locked", ownerKind: "cli", options: ["observe", "fork"] },
    });
    expect(app.ui.read.getState().locked).toEqual({
      threadId: thr(1),
      ownerKind: "cli",
      options: ["observe", "fork"],
    });
    await app.stop();
  });
});

describe("message commands: regenerate", () => {
  test("from a reply, rewinds to the user message before it and sends the same words again", async () => {
    const { app, params } = await openedApp({
      results: {
        "thread.read": TRANSCRIPT,
        "thread.revert": { position: POSITION },
        "turn.start": { turnId: "trn_00000000000000000000000001" },
      },
    });
    const done = await app.commands.message.regenerate(thr(1), itm(2));
    expect(done).toEqual({ ok: true, value: null });
    // 되감기가 turn.start보다 먼저 나간다
    expect(
      params
        .map((entry) => entry.method)
        .filter((m) => m === "thread.revert" || m === "turn.start"),
    ).toEqual(["thread.revert", "turn.start"]);
    expect(sent(params, "thread.revert")).toEqual([{ threadId: thr(1), to: itm(1) }]);
    expect(sent(params, "turn.start")).toEqual([
      { threadId: thr(1), input: "hello", requestId: expect.any(String) },
    ]);
    await app.stop();
  });

  test("from the user message itself, rewinds to that message and sends its words", async () => {
    const { app, params } = await openedApp({
      results: {
        "thread.read": TRANSCRIPT,
        "thread.revert": { position: POSITION },
        "turn.start": { turnId: "trn_00000000000000000000000001" },
      },
    });
    const done = await app.commands.message.regenerate(thr(1), itm(1));
    expect(done).toEqual({ ok: true, value: null });
    expect(sent(params, "thread.revert")).toEqual([{ threadId: thr(1), to: itm(1) }]);
    expect(sent(params, "turn.start")).toEqual([
      { threadId: thr(1), input: "hello", requestId: expect.any(String) },
    ]);
    await app.stop();
  });

  test("an item that the open conversation does not hold is refused before any write", async () => {
    const { app, params } = await openedApp({
      results: { "thread.read": TRANSCRIPT, "thread.revert": { position: POSITION } },
    });
    const done = await app.commands.message.regenerate(thr(1), itm(9));
    expect(done).toEqual({ ok: false, error: { kind: "rejected", code: 3005 } });
    expect(sent(params, "thread.revert")).toEqual([]);
    expect(sent(params, "turn.start")).toEqual([]);
    await app.stop();
  });

  test("refuses while a turn runs and sends nothing", async () => {
    const { app, params } = await liveApp(
      { results: { "thread.revert": { position: POSITION } } },
      [summary(thr(1), { status: "running" })],
    );
    const done = await app.commands.message.regenerate(thr(1), itm(1));
    expect(done).toEqual({ ok: false, error: { kind: "rejected", code: 3003 } });
    expect(sent(params, "thread.revert")).toEqual([]);
    expect(sent(params, "turn.start")).toEqual([]);
    await app.stop();
  });

  test("a refused send after the rewind reports the lock and leaves the conversation rewound", async () => {
    const { app, params } = await openedApp({
      results: { "thread.read": TRANSCRIPT, "thread.revert": { position: POSITION } },
      errors: { "turn.start": LOCKED },
    });
    const done = await app.commands.message.regenerate(thr(1), itm(2));
    expect(done).toEqual({
      ok: false,
      error: { kind: "locked", ownerKind: "cli", options: ["observe", "fork"] },
    });
    expect(sent(params, "thread.revert")).toEqual([{ threadId: thr(1), to: itm(1) }]);
    expect(app.ui.read.getState().locked?.threadId).toBe(thr(1));
    await app.stop();
  });

  test("a successful send clears a stale observing flag", async () => {
    const { app } = await openedApp({
      results: {
        "thread.read": TRANSCRIPT,
        "thread.revert": { position: POSITION },
        "turn.start": { turnId: "trn_00000000000000000000000001" },
      },
    });
    app.ui.actions.setObserving(thr(1), true);
    expect((await app.commands.message.regenerate(thr(1), itm(2))).ok).toBe(true);
    expect(app.ui.read.getState().observing).toEqual({});
    await app.stop();
  });
});
