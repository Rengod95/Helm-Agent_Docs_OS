import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { persistenceQueryOf } from "../src/index.ts";
import {
  appendItem,
  bigObject,
  countRows,
  KIB,
  leaseDraft,
  MIB,
  openRealHarness,
  replayed,
  storedRow,
  userItemPayload,
} from "./support/large.ts";
import { commitResult, expectOk, newThread, type Harness } from "./support/harness.ts";

// 되돌리기 경계: 스냅샷은 실릴 값만 되돌리고, 재생·읽기는 blob을 읽지 않는다(L1.persistence.spec §4.11)

/** 임대 기록 하나를 커밋한다(`ext.commit`) */
async function commitLease(
  h: Harness,
  threadId: ThreadId,
  requestId: string,
  kind: "lease.acquired" | "lease.released" | "lease.requested" | "lease.user_input",
  payload: unknown,
): Promise<void> {
  const result = await h.service.ext.commit({
    threadId,
    requestId,
    drafts: [leaseDraft(h, threadId, kind, payload)],
  });
  if (result.status !== "committed") throw new Error(`${requestId} was ${result.status}`);
}

describe("loadSnapshot returns the values it shows, hydrated", () => {
  test("open lease input, queued request input, held user input and a handoff result come back as values", async () => {
    const { h, reads } = await openRealHarness({});
    const { threadId } = newThread(h);
    const parentInput = { note: "small" };
    await commitLease(h, threadId, "a1", "lease.acquired", {
      leaseId: "a",
      lineageId: "a",
      scopeId: "alpha",
      limits: {},
      input: parentInput,
    });
    const childInput = bigObject(1000, 300);
    await commitLease(h, threadId, "b1", "lease.acquired", {
      leaseId: "b",
      lineageId: "b",
      scopeId: "alpha",
      limits: {},
      parent: "a",
      input: childInput,
    });
    const handoffResult = bigObject(1000, 301);
    await commitLease(h, threadId, "b2", "lease.released", {
      leaseId: "b",
      scopeId: "alpha",
      reason: "done",
      result: handoffResult,
    });
    const openInput = bigObject(1000, 302);
    await commitLease(h, threadId, "c1", "lease.acquired", {
      leaseId: "c",
      lineageId: "c",
      scopeId: "alpha",
      limits: {},
      input: openInput,
    });
    const requestInput = bigObject(1000, 303);
    await commitLease(h, threadId, "r1", "lease.requested", {
      requestId: "req-1",
      scopeId: "alpha",
      status: "queued",
      trigger: "user",
      input: requestInput,
    });
    const userInput = bigObject(1000, 304);
    await commitLease(h, threadId, "u1", "lease.user_input", {
      requestId: "msg-1",
      scopeId: "alpha",
      status: "held",
      input: userInput,
    });

    const before = reads.count;
    const snapshot = expectOk(await h.service.ext.loadThread(threadId));
    expect(reads.count).toBeGreaterThan(before);
    expect(snapshot.openLeases.map((lease) => lease.leaseId)).toEqual(["a", "c"]);
    const [parentLease, openLease] = snapshot.openLeases;
    expect(parentLease?.input).toEqual(parentInput);
    expect(parentLease?.handoffEnd).toEqual({ status: "done", result: handoffResult });
    expect(openLease?.input).toEqual(openInput);
    expect(snapshot.pendingRequests).toEqual([
      { requestId: "req-1", scopeId: "alpha", trigger: "user", parent: null, input: requestInput },
    ]);
    expect(snapshot.pendingUserInputs).toEqual([
      { requestId: "msg-1", scopeId: "alpha", input: userInput },
    ]);
  });

  test("a closed lease's input is not read: only the open lease's blob is read", async () => {
    const { h, store, reads } = await openRealHarness({});
    const { threadId } = newThread(h);
    await commitLease(h, threadId, "x1", "lease.acquired", {
      leaseId: "x",
      lineageId: "x",
      scopeId: "alpha",
      limits: {},
      input: bigObject(1000, 300),
    });
    await commitLease(h, threadId, "x2", "lease.released", {
      leaseId: "x",
      scopeId: "alpha",
      reason: "idle",
    });
    const openInput = bigObject(1000, 305);
    await commitLease(h, threadId, "y1", "lease.acquired", {
      leaseId: "y",
      lineageId: "y",
      scopeId: "alpha",
      limits: {},
      input: openInput,
    });
    expect(countRows(store, "SELECT COUNT(*) AS n FROM p_blob_refs")).toBe(2);

    const before = reads.count;
    const snapshot = expectOk(await h.service.ext.loadThread(threadId));
    expect(reads.count - before).toBe(1);
    expect(snapshot.openLeases.map((lease) => lease.input)).toEqual([openInput]);
  });

  test("a genuine string that looks like a placeholder is not a detached field", async () => {
    const { h, reads } = await openRealHarness({});
    const { threadId } = newThread(h);
    const look = `blob:sha256:${"a".repeat(64)}`;
    await commitLease(h, threadId, "p1", "lease.acquired", {
      leaseId: "p",
      lineageId: "p",
      scopeId: "alpha",
      limits: {},
      input: { note: look },
    });
    const before = reads.count;
    const snapshot = expectOk(await h.service.ext.loadThread(threadId));
    expect(snapshot.openLeases.map((lease) => lease.input)).toEqual([{ note: look }]);
    expect(reads.count).toBe(before);
  });
});

/** 분리된 내용이 든 thread를 재생한다. 재생 중 blob 읽기가 없어야 하고, 되돌리기는 따로 불렀을 때 같은 값을 준다 */
async function expectReplayReadsNothing(
  h: Harness,
  reads: { count: number },
  threadId: ThreadId,
  payload: unknown,
): Promise<void> {
  const before = reads.count;
  const events = await replayed(h, threadId);
  const item = events.find((event) => event.kind === "item.recorded");
  if (item === undefined) throw new Error("the item.recorded event is missing");
  // 내용이 실제로 분리되어 있어야 0회 읽기가 뜻이 있다
  expect(item.detached?.map((field) => field.pointer)).toEqual(["/item/message/content"]);
  const branch = (await Array.fromAsync(h.service.readBranch(threadId, item.id))).map(expectOk);
  expect(branch.length).toBeGreaterThan(0);
  expect(reads.count).toBe(before);
  expect((await h.service.hydrate(item)).payload).toEqual(payload);
}

describe("replay and readFrom never read a blob", () => {
  test("replaying a thread with 300 KiB of detached content reads no blob", async () => {
    const { h, reads } = await openRealHarness({});
    const { threadId } = newThread(h, "small");
    const payload = userItemPayload(h.ids.next("itm"), "s".repeat(300 * KIB));
    expect(commitResult(h, threadId, "replay-small", appendItem(h, threadId, payload)).ok).toBe(
      true,
    );
    await expectReplayReadsNothing(h, reads, threadId, payload);
  });

  test("replaying a thread with 64 MiB of detached content reads no blob", async () => {
    const { h, reads } = await openRealHarness({});
    const { threadId } = newThread(h, "big");
    const payload = userItemPayload(h.ids.next("itm"), "b".repeat(64 * MIB));
    expect(commitResult(h, threadId, "replay-big", appendItem(h, threadId, payload)).ok).toBe(true);
    await expectReplayReadsNothing(h, reads, threadId, payload);
  }, 120_000);
});

describe("blob usage per thread", () => {
  test("p_blob_refs holds the string and JSON refs, the usage reads them, and removing a thread drops them", async () => {
    const { h, store } = await openRealHarness({});
    const first = newThread(h, "first");
    const second = newThread(h, "second");
    expect(
      commitResult(
        h,
        first.threadId,
        "u-1",
        appendItem(h, first.threadId, userItemPayload(h.ids.next("itm"), "u".repeat(300 * KIB))),
      ).ok,
    ).toBe(true);
    await commitLease(h, first.threadId, "u-2", "lease.acquired", {
      leaseId: "l",
      lineageId: "l",
      scopeId: "alpha",
      limits: {},
      input: bigObject(1000, 300),
    });
    expect(
      commitResult(
        h,
        second.threadId,
        "u-3",
        appendItem(h, second.threadId, userItemPayload(h.ids.next("itm"), "v".repeat(300 * KIB))),
      ).ok,
    ).toBe(true);

    const acquired = (await replayed(h, first.threadId)).find(
      (event) => event.kind === "lease.acquired",
    );
    if (acquired === undefined) throw new Error("the lease.acquired event is missing");
    const jsonRef = storedRow(store, acquired.id).envelope.detached?.[0]?.ref.sha256 ?? "";
    expect(storedRow(store, acquired.id).envelope.detached?.[0]?.encoding).toBe("json");

    const usage = persistenceQueryOf(h.service);
    if (usage === undefined) throw new Error("the persistence query is not registered");
    const rows = expectOk(usage.blobUsageByThread());
    expect(rows.map((row) => row.threadId)).toEqual([first.threadId, second.threadId].toSorted());
    const perThread = Object.fromEntries(rows.map((row) => [row.threadId, row.blobs]));
    expect(perThread[first.threadId]).toBe(2);
    expect(perThread[second.threadId]).toBe(1);
    const sums = store.raw
      .query<{ bytes: number }, [string]>(
        "SELECT COALESCE(SUM(b.size), 0) AS bytes FROM p_blob_refs r JOIN sys_blobs b ON b.sha256 = r.sha256 WHERE r.thread_id = ?",
      )
      .get(first.threadId);
    expect(rows.find((row) => row.threadId === first.threadId)?.bytes).toBe(sums?.bytes);
    const refs = store.raw
      .query<{ sha256: string }, [string]>(
        "SELECT sha256 FROM p_blob_refs WHERE thread_id = ? ORDER BY sha256",
      )
      .all(first.threadId)
      .map((row) => row.sha256);
    expect(refs).toContain(jsonRef);
    expect(refs.length).toBe(2);

    expectOk(h.service.threads.remove(first.threadId));
    expect(
      countRows(
        store,
        `SELECT COUNT(*) AS n FROM p_blob_refs WHERE thread_id = '${first.threadId}'`,
      ),
    ).toBe(0);
    expect(expectOk(usage.blobUsageByThread()).map((row) => row.threadId)).toEqual([
      second.threadId,
    ]);
  });
});
