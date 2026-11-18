import { describe, expect, test } from "bun:test";
import type { DurableEventDraft, DurableEventEnvelope } from "@fresnel/contracts/records";
import { storeFaultAt } from "@fresnel/platform-store/testing";
import { detachLarge, restoreDetached } from "../src/blob.ts";
import { fixedIdFactory } from "./support/clock.ts";
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
import { commitResult, expectOk, memoryBlobs, newThread } from "./support/harness.ts";

// 큰 값의 JSON 하위 분리, blob 저장 경로, 장애와 한도(L1.persistence.spec §4.11, PS-15)

describe("detachLarge on the commit path", () => {
  test("an object of many 1 KB strings detaches as one JSON blob: envelope small, hydrate deep-equals", async () => {
    const { h, store } = await openRealHarness({});
    const { threadId } = newThread(h);
    const input = bigObject(3072, 1024);
    const payload = {
      leaseId: "lease-big",
      lineageId: "lease-big",
      scopeId: "alpha",
      limits: {},
      input,
    };
    expect(
      await h.service.ext.commit({
        threadId,
        requestId: "big-object-1",
        drafts: [leaseDraft(h, threadId, "lease.acquired", payload)],
      }),
    ).toEqual({ status: "committed" });

    const events = await replayed(h, threadId);
    const acquired = events.find((event) => event.kind === "lease.acquired");
    if (acquired === undefined) throw new Error("the lease.acquired event is missing");
    const stored = storedRow(store, acquired.id);
    expect(new TextEncoder().encode(stored.text).length).toBeLessThan(256 * KIB);
    const field = stored.envelope.detached?.[0];
    expect(stored.envelope.detached?.length).toBe(1);
    expect(field?.pointer).toBe("/input");
    expect(field?.encoding).toBe("json");
    expect(stored.envelope.payload).toEqual({
      ...payload,
      input: `blob:sha256:${field?.ref.sha256 ?? ""}`,
    });

    expect((await h.service.hydrate(acquired)).payload).toEqual(payload);
    expect(
      expectOk(await h.service.ext.loadThread(threadId)).openLeases.map((lease) => lease.input),
    ).toEqual([input]);
  });

  test("a 70 MiB string leaf round-trips through the blob store as a plain string", async () => {
    const { h, store } = await openRealHarness({});
    const { threadId } = newThread(h);
    const text = "0123456789abcdef".repeat((70 * MIB) / 16);
    const itemId = h.ids.next("itm");
    const payload = userItemPayload(itemId, text);
    const committed = commitResult(h, threadId, "huge-leaf", appendItem(h, threadId, payload));
    expect(committed.ok).toBe(true);

    const events = await replayed(h, threadId);
    const item = events.find((event) => event.kind === "item.recorded");
    if (item === undefined) throw new Error("the item.recorded event is missing");
    const stored = storedRow(store, item.id);
    expect(new TextEncoder().encode(stored.text).length).toBeLessThan(256 * KIB);
    expect(stored.envelope.detached?.map((field) => [field.pointer, field.encoding])).toEqual([
      ["/item/message/content", undefined],
    ]);
    expect((await h.service.hydrate(item)).payload).toEqual(payload);
    expect(expectOk(h.service.query.liveBlobRefs())).toEqual([
      stored.envelope.detached?.[0]?.ref.sha256 ?? "",
    ]);
  }, 120_000);

  test("the same content committed twice stores one blob file and one sys_blobs row", async () => {
    const { h, store } = await openRealHarness({});
    // envelope 목표(256 KiB)를 넘어야 분리된다
    const content = "same ".repeat(70_000);
    const first = newThread(h, "first");
    const second = newThread(h, "second");
    expect(
      commitResult(
        h,
        first.threadId,
        "dup-1",
        appendItem(h, first.threadId, userItemPayload(h.ids.next("itm"), content)),
      ).ok,
    ).toBe(true);
    expect(
      commitResult(
        h,
        second.threadId,
        "dup-2",
        appendItem(h, second.threadId, userItemPayload(h.ids.next("itm"), content)),
      ).ok,
    ).toBe(true);

    expect(store.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sys_blobs").get()?.n).toBe(
      1,
    );
    expect(expectOk(store.service.blobUsage()).total.blobs).toBe(1);
    expect(
      store.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM p_blob_refs").get()?.n,
    ).toBe(2);
  });

  test("a blob over maxBlobBytes makes the commit fail with the mapped store error and writes no event", async () => {
    const { h, store } = await openRealHarness({ settings: { maxBlobBytes: 100 * KIB } });
    const { threadId } = newThread(h);
    const before = expectOk(h.service.feed.headSeq());
    const result = commitResult(
      h,
      threadId,
      "too-big",
      appendItem(h, threadId, userItemPayload(h.ids.next("itm"), "y".repeat(300 * KIB))),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("disk_full");
    expect(expectOk(h.service.feed.headSeq())).toBe(before);
    expect(store.raw.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM sys_blobs").get()?.n).toBe(
      0,
    );
    expect(
      store.raw
        .query<{ n: number }, []>(
          "SELECT COUNT(*) AS n FROM events WHERE envelope LIKE '%blob:sha256%'",
        )
        .get()?.n,
    ).toBe(0);
  });

  test("a string detached before the encoding field existed (no encoding) reads back as the same string", async () => {
    const { h, store } = await openRealHarness({});
    const { threadId } = newThread(h);
    // 내용이 JSON 배열처럼 보여도 문자열 잎은 문자열로 되돌아온다(옛 기록과 같은 형식: encoding 없음)
    const looksLikeJson = `[${"0,".repeat(150_000)}0]`;
    const itemId = h.ids.next("itm");
    const payload = userItemPayload(itemId, looksLikeJson);
    commitResult(h, threadId, "old-format", appendItem(h, threadId, payload));
    const item = (await replayed(h, threadId)).find((event) => event.kind === "item.recorded");
    if (item === undefined) throw new Error("the item.recorded event is missing");
    const stored = storedRow(store, item.id);
    expect(stored.envelope.detached?.[0]?.encoding).toBeUndefined();
    expect((await h.service.hydrate(item)).payload).toEqual(payload);
  });

  test("a small inline value is not touched and replay reads no blob", async () => {
    const { h, reads } = await openRealHarness({});
    const { threadId } = newThread(h);
    const payload = userItemPayload(h.ids.next("itm"), "hello");
    commitResult(h, threadId, "small", appendItem(h, threadId, payload));
    const events = await replayed(h, threadId);
    const item = events.find((event) => event.kind === "item.recorded");
    expect(item?.detached).toBeUndefined();
    expect(item?.payload).toEqual(payload);
    expect(reads.count).toBe(0);
  });
});

describe("detachLarge and restoreDetached (no store)", () => {
  const ids = fixedIdFactory();
  const draftOfPayload = (payload: unknown): DurableEventDraft => ({
    id: ids.next("evt"),
    kind: "item.recorded",
    version: 1,
    durable: true,
    threadId: ids.next("thr"),
    turnId: null,
    stepId: null,
    causationId: null,
    correlationId: null,
    payload,
  });

  test("a root string detaches at the empty pointer and restores", () => {
    const blobs = memoryBlobs();
    const text = "r".repeat(300 * KIB);
    const moved = detachLarge(draftOfPayload(text), blobs.putBlob);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.detached?.map((field) => field.pointer)).toEqual([""]);
    const restored = restoreDetached(moved.value.payload, moved.value.detached ?? [], {
      readBlob: blobs.readBlob,
      logger: undefined,
    });
    expect(restored).toBe(text);
  });

  test("with fits false a JSON subtree is never chosen, string leaves still are", () => {
    const blobs = memoryBlobs();
    const parts = Array.from({ length: 300 }, () => "z".repeat(1000));
    const draft = draftOfPayload({ obj: { parts }, text: "t".repeat(70 * KIB) });
    const moved = detachLarge(draft, blobs.putBlob, () => false);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(moved.value.detached?.map((field) => [field.pointer, field.encoding])).toEqual([
      ["/text", undefined],
    ]);
  });

  test("an unparseable JSON blob keeps the placeholder and logs, like a missing blob", async () => {
    const { h } = await openRealHarness({});
    const { threadId } = newThread(h);
    const badBytes = new TextEncoder().encode("{not json");
    const stored = expectOk(h.store.service.putBlob(badBytes, "application/json"));
    const base = (await replayed(h, threadId))[0];
    if (base === undefined) throw new Error("the thread has no events");
    const placeholder = `blob:sha256:${stored.sha256}`;
    const synthetic: DurableEventEnvelope = {
      ...base,
      payload: { value: placeholder },
      detached: [{ pointer: "/value", ref: stored, encoding: "json" }],
    };
    const hydrated = await h.service.hydrate(synthetic);
    expect(hydrated.payload).toEqual({ value: placeholder });
    expect(h.logs).toContain("warn:session.hydrate_bad_blob");
  });
});

describe("a fault while the blob is written (platform-store fault points)", () => {
  for (const point of ["blob_after_rename", "blob_before_row"] as const) {
    test(`${point}: no event references the blob, the thread reads normally, a retry commits`, async () => {
      const fault = storeFaultAt(point);
      const { h, store } = await openRealHarness({ storeFaults: fault.injector });
      const { threadId } = newThread(h);
      const before = expectOk(h.service.feed.headSeq());

      const payload = userItemPayload(h.ids.next("itm"), "f".repeat(300 * KIB));
      expect(() => commitResult(h, threadId, "fault-1", appendItem(h, threadId, payload))).toThrow(
        `fault:${point}`,
      );
      fault.armed = false;

      expect(expectOk(h.service.feed.headSeq())).toBe(before);
      expect(
        countRows(store, "SELECT COUNT(*) AS n FROM events WHERE envelope LIKE '%blob:sha256%'"),
      ).toBe(0);
      expect(countRows(store, "SELECT COUNT(*) AS n FROM p_blob_refs")).toBe(0);
      const events = await replayed(h, threadId);
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((event) => event.detached !== undefined)).toBe(false);

      // 장애가 풀린 뒤 같은 내용을 다시 쓰면 커밋되고 참조가 생긴다
      const retry = userItemPayload(h.ids.next("itm"), "f".repeat(300 * KIB));
      expect(commitResult(h, threadId, "fault-2", appendItem(h, threadId, retry)).ok).toBe(true);
      expect(countRows(store, "SELECT COUNT(*) AS n FROM p_blob_refs")).toBe(1);
    });
  }
});
