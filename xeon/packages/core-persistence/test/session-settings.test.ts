import { describe, expect, test } from "bun:test";
import { completeTurn, itemAt } from "./support/branching.ts";
import { expectOk, newThread, openHarness, reopenHarness } from "./support/harness.ts";

const KEY = "l1.tools.example";

function layerOf(
  h: Awaited<ReturnType<typeof openHarness>>,
  threadId: Parameters<typeof h.service.sessionSettings.layer>[0],
) {
  return h.service.sessionSettings.layer(threadId);
}

describe("session settings", () => {
  test("set and reset commit settings.changed and the layer reads them back", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    expect(layerOf(h, threadId)).toEqual({ scope: "session", values: new Map() });
    expectOk(h.service.sessionSettings.set(threadId, KEY, { mode: "fast" }, "s1"));
    expect(layerOf(h, threadId).values.get(KEY)).toEqual({ mode: "fast" });
    const event = h.store.raw
      .query<{ envelope: string }, []>(
        "SELECT envelope FROM events WHERE kind = 'settings.changed'",
      )
      .get();
    expect(JSON.parse(event?.envelope ?? "{}").payload).toEqual({
      key: KEY,
      scope: "session",
      value: { mode: "fast" },
    });
    // 같은 키 재시도는 새 이벤트를 더하지 않는다
    expectOk(h.service.sessionSettings.set(threadId, KEY, { mode: "fast" }, "s1"));
    expect(
      h.store.raw
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM events WHERE kind = 'settings.changed'",
        )
        .get()?.n,
    ).toBe(1);
    expectOk(h.service.sessionSettings.reset(threadId, KEY, "s2"));
    expect(layerOf(h, threadId).values.has(KEY)).toBe(false);
  });

  // spec plan session_settings_follow_branch
  test("session_settings_follow_branch: a value set after the rewind point disappears with the rewind", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    completeTurn(h, threadId);
    expectOk(h.service.sessionSettings.set(threadId, KEY, 1, "s1"));
    completeTurn(h, threadId);
    expectOk(h.service.sessionSettings.set(threadId, KEY, 2, "s2"));
    completeTurn(h, threadId);
    // leaf가 앞으로만 나아가면 최신 값이다
    expect(layerOf(h, threadId).values.get(KEY)).toBe(2);
    // 둘째 turn의 설정 이전으로 되감는다: 첫 turn의 마지막 item
    expectOk(await h.service.threads.revert(threadId, itemAt(h, threadId, 1).itemId, "rv1"));
    expect(layerOf(h, threadId).values.has(KEY)).toBe(false);
    expectOk(h.service.sessionSettings.set(threadId, KEY, 3, "s3"));
    expect(layerOf(h, threadId).values.get(KEY)).toBe(3);
    // 다시 시작해도 활성 가지의 값이다
    const restarted = await reopenHarness(h);
    expect(layerOf(restarted, threadId).values.get(KEY)).toBe(3);
  });

  test("a request key outside the commit key alphabet is hashed instead of failing the commit", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    expectOk(h.service.sessionSettings.set(threadId, KEY, 7, "설정 키 with space"));
    expectOk(h.service.sessionSettings.set(threadId, KEY, 8, "k".repeat(500)));
    expect(layerOf(h, threadId).values.get(KEY)).toBe(8);
  });

  test("a non-owner cannot write and an unknown thread has an empty layer", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const other = await reopenHarness(h);
    expect(other.service.sessionSettings.set(threadId, KEY, true, "s1")).toEqual({
      ok: false,
      error: { kind: "ownership_lost", threadId },
    });
    const ghost = h.ids.next("thr");
    expect(layerOf(h, ghost).values.size).toBe(0);
  });
});
