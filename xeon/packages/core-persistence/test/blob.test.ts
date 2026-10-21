import { describe, expect, test } from "bun:test";
import { err } from "@xeon/contracts";
import { ENVELOPE_MAX_BYTES, type DurableEventDraft } from "@xeon/contracts/records";
import { detachLarge, pointerOf } from "../src/blob.ts";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import {
  commitOrThrow,
  commitResult,
  draftOf,
  memoryBlobs,
  newThread,
  openHarness,
} from "./support/harness.ts";

// 큰 문자열 분리(L1.persistence.spec §4.11, PS-15)

const BIG = "큰".repeat(100_000);

function userItem(h: ReturnType<typeof openHarness>, content: unknown): unknown {
  return {
    item: {
      itemId: h.ids.next("itm"),
      status: "completed",
      kind: "user",
      message: { role: "user", content, timestamp: 1 },
      requestId: null,
    },
  };
}

describe("detachLarge", () => {
  test("detach_large_strings_keeps_envelope_under_limit", async () => {
    const blobs = memoryBlobs();
    const h = openHarness({ putBlob: blobs.putBlob, readBlob: blobs.readBlob });
    const { threadId } = newThread(h);
    const turnId = h.ids.next("trn");
    const scope = { turnId, stepId: null };
    const committed = commitOrThrow(h, threadId, "blob:big", () => ({
      kind: "append",
      drafts: [draftOf(h, h.loop, "item.recorded", threadId, scope, userItem(h, BIG))],
      checkpoint: null,
    }));
    expect(committed.replayed).toBe(false);

    const row = h.store.raw
      .query<{ envelope: string }, [string]>("SELECT envelope FROM events WHERE id = ?")
      .get(committed.eventIds[0] ?? "");
    const stored = row?.envelope ?? "";
    expect(new TextEncoder().encode(stored).length).toBeLessThanOrEqual(ENVELOPE_MAX_BYTES);
    expect(stored).toContain("blob:sha256:");
    expect(stored).not.toContain(BIG);

    // hydrate가 원문을 돌려준다
    const all = await Array.fromAsync(h.service.readFrom(1, { threadId }));
    const event = all.find((candidate) => candidate.id === committed.eventIds[0]);
    if (event === undefined) throw new Error("the committed event is missing");
    const hydrated = await h.service.hydrate(event);
    expect(JSON.stringify(hydrated.payload)).toContain(BIG);

    // 참조 목록과 재생 가능성
    const refs = h.service.query.liveBlobRefs();
    expect(refs).toHaveLength(1);
    expect([...blobs.files.keys()]).toEqual([...refs]);
    expectProjectionsRebuildable(h.store.db);
  });

  test("a draft under the limit is not touched and writes no blob", () => {
    const blobs = memoryBlobs();
    const h = openHarness({ putBlob: blobs.putBlob, readBlob: blobs.readBlob });
    const { threadId } = newThread(h);
    const scope = { turnId: h.ids.next("trn"), stepId: null };
    commitOrThrow(h, threadId, "blob:small", () => ({
      kind: "append",
      drafts: [draftOf(h, h.loop, "item.recorded", threadId, scope, userItem(h, "x".repeat(1000)))],
      checkpoint: null,
    }));
    expect(blobs.files.size).toBe(0);
    expect(h.service.query.liveBlobRefs()).toEqual([]);
  });

  test("a retry of the same key after detaching is replayed and writes the event once", () => {
    const blobs = memoryBlobs();
    const h = openHarness({ putBlob: blobs.putBlob, readBlob: blobs.readBlob });
    const { threadId } = newThread(h);
    const scope = { turnId: h.ids.next("trn"), stepId: null };
    const request = {
      threadId,
      requestId: "blob:retry",
      fingerprintSource: { key: "blob:retry" },
      build: () => ({
        kind: "append" as const,
        drafts: [draftOf(h, h.loop, "item.recorded", threadId, scope, userItem(h, BIG))],
        checkpoint: null,
      }),
    };
    const first = h.service.commit(request);
    const second = h.service.commit(request);
    expect(first.ok && first.value.status).toBe("committed");
    expect(second.ok && second.value.status === "committed" && second.value.replayed).toBe(true);
    expect(
      h.store.raw
        .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM events WHERE kind = 'item.recorded'")
        .get()?.n,
    ).toBe(1);
  });

  test("without a blob store an oversize envelope is the producer's Bug", () => {
    const h = openHarness();
    const { threadId } = newThread(h);
    const scope = { turnId: h.ids.next("trn"), stepId: null };
    expect(() =>
      commitResult(h, threadId, "blob:none", () => ({
        kind: "append",
        drafts: [draftOf(h, h.loop, "item.recorded", threadId, scope, userItem(h, BIG))],
        checkpoint: null,
      })),
    ).toThrow("store.event_too_large");
  });

  test("a full disk while writing the blob is a store error and nothing is committed", () => {
    const h = openHarness({ putBlob: () => err({ kind: "disk_full" }) });
    const { threadId } = newThread(h);
    const before = h.service.feed.headSeq();
    const scope = { turnId: h.ids.next("trn"), stepId: null };
    const result = commitResult(h, threadId, "blob:full", () => ({
      kind: "append",
      drafts: [draftOf(h, h.loop, "item.recorded", threadId, scope, userItem(h, BIG))],
      checkpoint: null,
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("disk_full");
    expect(h.service.feed.headSeq()).toBe(before);
  });

  test("pointers escape ~ and / and the largest strings go first", () => {
    expect(pointerOf(["a/b", "c~d", "0"])).toBe("/a~1b/c~0d/0");
    const sizes: number[] = [];
    const h = openHarness();
    const draft: DurableEventDraft = {
      id: h.ids.next("evt"),
      kind: "item.recorded",
      version: 1,
      durable: true,
      threadId: h.ids.next("thr"),
      turnId: null,
      stepId: null,
      causationId: null,
      correlationId: null,
      payload: { small: "x".repeat(70_000), large: "y".repeat(260_000) },
    };
    const moved = detachLarge(draft, (bytes, mediaType) => {
      sizes.push(bytes.length);
      return {
        ok: true,
        value: { type: "blob", sha256: "a".repeat(64), size: bytes.length, mediaType },
      };
    });
    expect(moved.ok).toBe(true);
    // 큰 것 하나만 옮기면 상한 아래가 되므로 거기서 멈춘다
    expect(sizes).toEqual([260_000]);
    if (moved.ok) expect(moved.value.detached?.map((field) => field.pointer)).toEqual(["/large"]);
  });
});
