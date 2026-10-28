// M3-REQ-80 보관 정리가 올리는 재전송 하한과 replayFrom 의미, M3-REQ-81 재개 때 모델 요청 재전송 정책.
import { describe, expect, test } from "bun:test";
import {
  createReplayResolver,
  DEFAULT_PERSISTENCE_SETTINGS,
  MODEL_REQUEST_RESEND_POLICY,
  modelRequestResendOf,
  PERSISTENCE_SETTING_DEFS,
  type PersistenceSettings,
} from "../src/index.ts";
import { completeTurn } from "./support/branching.ts";
import {
  expectOk,
  newThread,
  openHarness,
  reopenHarness,
  startTurn,
  type Harness,
} from "./support/harness.ts";

const DAY = 86_400_000;
const STORE = "store-test";

function withSettings(overrides: Partial<PersistenceSettings>): () => PersistenceSettings {
  return () => ({ ...DEFAULT_PERSISTENCE_SETTINGS, ...overrides });
}

async function agedThread(h: Harness, title: string): Promise<ReturnType<typeof newThread>> {
  const created = newThread(h, title);
  completeTurn(h, created.threadId);
  await h.service.release(created.threadId, "quit");
  h.store.leases.release(created.token);
  h.clock.advance(DAY);
  return created;
}

function headOf(h: Harness): number {
  return expectOk(h.service.feed.headSeq());
}

describe("oldestReplayableSeq follows the retention prune (M3-REQ-80)", () => {
  test("it is 0 until a thread is pruned, then the largest seq of the removed events", async () => {
    const h = await openHarness({ settings: withSettings({ retentionMaxCount: 1 }) });
    const first = await agedThread(h, "first");
    const second = await agedThread(h, "second");
    expect(h.service.feed.oldestReplayableSeq()).toBe(0);
    const headBeforePrune = headOf(h);
    expect(expectOk(h.retention.prune())).toEqual([first.threadId]);
    const floor = h.service.feed.oldestReplayableSeq();
    // 지운 thread의 이벤트가 앞쪽 seq이고, 남은 thread의 이벤트는 그 뒤에 있다
    expect(floor).toBeGreaterThan(0);
    expect(floor).toBeLessThan(headBeforePrune);
    const remaining = expectOk(
      h.service.feed.read(0, headBeforePrune, { threadIds: [second.threadId] }, 1000, 1000),
    );
    expect(remaining.events[0]?.seq).toBeGreaterThan(floor);
  });

  test("the floor never goes down and survives a restart", async () => {
    const h = await openHarness({ settings: withSettings({ retentionMaxCount: 1 }) });
    await agedThread(h, "first");
    await agedThread(h, "second");
    await agedThread(h, "third");
    expectOk(h.retention.prune());
    const floor = h.service.feed.oldestReplayableSeq();
    expect(floor).toBeGreaterThan(0);
    const restarted = await reopenHarness(h, { settings: withSettings({ retentionMaxCount: 1 }) });
    expect(restarted.service.feed.oldestReplayableSeq()).toBe(floor);
    // 정리할 것이 더 없으면 하한은 그대로다
    expect(expectOk(restarted.retention.prune())).toEqual([]);
    expect(restarted.service.feed.oldestReplayableSeq()).toBe(floor);
  });

  test("deleting a thread by hand raises the floor too", async () => {
    const h = await openHarness();
    await agedThread(h, "kept");
    // remove는 쓰기 소유 중인 thread에만 한다
    const doomed = newThread(h, "doomed");
    completeTurn(h, doomed.threadId);
    expect(h.service.feed.oldestReplayableSeq()).toBe(0);
    expectOk(h.service.threads.remove(doomed.threadId));
    expect(h.service.feed.oldestReplayableSeq()).toBeGreaterThan(0);
  });
});

describe("replayFrom (L1.persistence.spec 4.13.1)", () => {
  test('"none" starts at the head for that thread only', async () => {
    const h = await openHarness();
    const created = newThread(h);
    const resolver = createReplayResolver({
      db: h.store.db,
      feed: h.service.feed,
      storeId: STORE,
    });
    expect(resolver.resolve(created.threadId, "none")).toEqual({
      ok: true,
      value: { from: "head", threadIds: [created.threadId] },
    });
  });

  test('"all" starts just before the first event of the thread', async () => {
    const h = await openHarness();
    await agedThread(h, "other");
    const created = newThread(h, "mine");
    startTurn(h, created.threadId);
    const resolver = createReplayResolver({
      db: h.store.db,
      feed: h.service.feed,
      storeId: STORE,
    });
    const resolved = expectOk(resolver.resolve(created.threadId, "all"));
    const first = expectOk(
      h.service.feed.read(0, headOf(h), { threadIds: [created.threadId] }, 1, 1000),
    ).events[0];
    expect(first).toBeDefined();
    expect(resolved).toEqual({
      from: { storeId: STORE, seq: (first?.seq ?? 0) - 1 },
      threadIds: [created.threadId],
    });
  });

  test("a cursor is checked like events.subscribe: store, head and the retention floor", async () => {
    const h = await openHarness({ settings: withSettings({ retentionMaxCount: 1 }) });
    await agedThread(h, "first");
    const second = await agedThread(h, "second");
    expectOk(h.retention.prune());
    const resolver = createReplayResolver({
      db: h.store.db,
      feed: h.service.feed,
      storeId: STORE,
    });
    const head = headOf(h);
    const floor = h.service.feed.oldestReplayableSeq();
    expect(resolver.resolve(second.threadId, { storeId: STORE, seq: head })).toEqual({
      ok: true,
      value: { from: { storeId: STORE, seq: head }, threadIds: [second.threadId] },
    });
    expect(resolver.resolve(second.threadId, { storeId: "other", seq: head })).toEqual({
      ok: false,
      error: { kind: "out_of_range", reason: "storeMismatch" },
    });
    expect(resolver.resolve(second.threadId, { storeId: STORE, seq: head + 1 })).toEqual({
      ok: false,
      error: { kind: "out_of_range", reason: "aheadOfHead" },
    });
    expect(resolver.resolve(second.threadId, { storeId: STORE, seq: floor - 1 })).toEqual({
      ok: false,
      error: { kind: "out_of_range", reason: "beforeOldest" },
    });
  });

  test('"all" of a thread whose log was trimmed is beforeOldest, and an unknown thread is thread_not_found', async () => {
    const h = await openHarness();
    const resolver = createReplayResolver({
      db: h.store.db,
      feed: h.service.feed,
      storeId: STORE,
    });
    const created = newThread(h);
    const missing = h.ids.next("thr");
    expect(resolver.resolve(missing, "all")).toEqual({
      ok: false,
      error: { kind: "thread_not_found", threadId: missing },
    });
    expect(resolver.resolve(created.threadId, "all").ok).toBe(true);
  });
});

describe("auto resume default (M3-REQ-80)", () => {
  test("l1.persistence.autoResume is off by default and only the user and managed scopes can turn it on", () => {
    expect(DEFAULT_PERSISTENCE_SETTINGS.autoResume).toBe(false);
    const def = PERSISTENCE_SETTING_DEFS.find((entry) => entry.key === "l1.persistence.autoResume");
    expect(def?.default).toBe(false);
    expect(def?.allowedScopes).toEqual(["managed", "user"]);
  });
});

describe("model request resend on resume (M3-REQ-81)", () => {
  test("the policy is a checkpoint resend", () => {
    expect(MODEL_REQUEST_RESEND_POLICY).toBe("checkpoint_resend");
  });

  test("an open turn without a checkpoint resends step 0; a checkpoint resends the step after it", async () => {
    const h = await openHarness();
    const created = newThread(h);
    const turn = startTurn(h, created.threadId);
    const restarted = await reopenHarness(h);
    expectOk(restarted.service.openForWrite(created.threadId, created.token));
    const plan = expectOk(
      restarted.service.recover(created.threadId, {
        toolReplay: () => "safe",
        cancelledByOwner: () => false,
        hostMode: "service",
      }),
    );
    expect(plan.next).toBe("request");
    expect(modelRequestResendOf(plan)).toEqual({ kind: "resend_step", stepIndex: 0 });
    expect(plan.marker?.turnId).toBe(turn.turnId);
  });

  test("a turn waiting in tools or ended does not resend the model request", () => {
    const base = { checkpoint: null, marker: null };
    expect(modelRequestResendOf({ ...base, next: "tools" })).toEqual({ kind: "none" });
    expect(modelRequestResendOf({ ...base, next: "await_input" })).toEqual({ kind: "none" });
    expect(modelRequestResendOf({ ...base, next: "turn_end" })).toEqual({ kind: "none" });
    expect(modelRequestResendOf({ ...base, next: "idle" })).toEqual({ kind: "none" });
  });
});
