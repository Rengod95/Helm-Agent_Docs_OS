import { describe, expect, test } from "bun:test";
import { err, ok, type Result } from "@xeon/contracts";
import type {
  CommitBatch,
  DurableEventEnvelope,
  ReadFailure,
  VolatileEventEnvelope,
} from "@xeon/contracts/records";
import { faultAt } from "../src/testing/index.ts";
import {
  commitOrThrow,
  commitResult,
  draftOf,
  endTurn,
  expectOk,
  fullStep,
  newThread,
  openHarness,
  startTurn,
} from "./support/harness.ts";

function blobRef(sha256: string) {
  return { type: "blob" as const, sha256, size: 13, mediaType: "text/plain" };
}

async function collect(
  source: AsyncIterable<Result<DurableEventEnvelope, ReadFailure>>,
): Promise<DurableEventEnvelope[]> {
  const out: DurableEventEnvelope[] = [];
  for await (const event of source) out.push(expectOk(event));
  return out;
}

describe("commit listeners", () => {
  // plan subscribe_emits_only_after_commit, spec §9.16
  test("subscribe_emits_only_after_commit", async () => {
    const fault = faultAt("before_commit");
    fault.armed = false;
    const h = await openHarness({ faults: fault.injector });
    const { threadId } = newThread(h);
    const batches: CommitBatch[] = [];
    h.service.feed.onCommit((batch) => {
      batches.push(batch);
    });
    fault.armed = true;
    expect(() => startTurn(h, threadId)).toThrow("fault:before_commit");
    expect(batches).toHaveLength(0);
    fault.armed = false;
    startTurn(h, threadId);
    expect(batches).toHaveLength(1);
    expect(batches[0]?.events.map((event) => event.kind)).toEqual([
      "turn.started",
      "item.recorded",
    ]);
    expect(batches[0]?.lastSeq).toBe(batches[0]?.events.at(-1)?.seq ?? -1);
  });

  test("listeners receive batches in seq order and a throwing listener harms nobody", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const seen: number[] = [];
    h.service.feed.onCommit(() => {
      throw new Error("listener failed");
    });
    h.service.feed.onCommit((batch) => {
      seen.push(batch.firstSeq);
    });
    const turn = startTurn(h, threadId);
    endTurn(h, turn);
    expect(seen).toHaveLength(2);
    expect(seen).toEqual(seen.toSorted((a, b) => a - b));
    expect(h.logs.filter((line) => line === "error:session.listener_failed")).toHaveLength(2);
  });

  // plan commit_nested_inside_listener_is_bug
  test("commit_nested_inside_listener_is_bug", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    let nested = "";
    h.service.feed.onCommit(() => {
      try {
        commitResult(h, threadId, "nested:1", () => ({ kind: "reject", code: "x", detail: null }));
      } catch (caught) {
        nested = caught instanceof Error ? caught.message : "";
      }
    });
    startTurn(h, threadId);
    expect(nested).toContain("store.nested_write");
    // 쓰기가 필요하면 queueMicrotask로 미룬다: 미룬 커밋은 통과한다
    let deferred = false;
    h.service.feed.onCommit(() => {
      queueMicrotask(() => {
        commitResult(h, threadId, "deferred:1", () => ({
          kind: "reject",
          code: "x",
          detail: null,
        }));
        deferred = true;
      });
    });
    startTurn(h, threadId);
    await Promise.resolve();
    expect(deferred).toBe(true);
  });

  test("a replayed commit emits nothing", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    let emitted = 0;
    h.service.feed.onCommit(() => {
      emitted += 1;
    });
    const request = {
      threadId,
      requestId: "turn:x:start",
      fingerprintSource: {},
      build: () => ({
        kind: "append" as const,
        drafts: [
          draftOf(
            h,
            h.loop,
            "turn.started",
            threadId,
            { turnId: h.ids.next("trn"), stepId: null },
            {
              inputItemIds: [],
              requestId: null,
              scopeId: null,
            },
          ),
        ],
        checkpoint: null,
      }),
    };
    expectOk(h.service.commit(request));
    expectOk(h.service.commit(request));
    expect(emitted).toBe(1);
  });

  test("unsubscribe stops delivery", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    let emitted = 0;
    const off = h.service.feed.onCommit(() => {
      emitted += 1;
    });
    startTurn(h, threadId);
    off();
    startTurn(h, threadId);
    expect(emitted).toBe(1);
  });
});

describe("subscribe catch-up", () => {
  // plan subscribe_catch_up_then_live_has_no_gap
  test("subscribe_catch_up_then_live_has_no_gap", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, [{ toolCallId: "tc1", toolName: "read", replay: "safe" }]);
    const afterSeq = 3;
    const seqs: number[] = [];
    const off = expectOk(
      h.service.subscribe(afterSeq, (batch) => {
        for (const event of batch.events) seqs.push(event.seq);
      }),
    );
    endTurn(h, turn);
    startTurn(h, threadId);
    off();
    const head = expectOk(h.service.feed.headSeq());
    expect(seqs).toEqual(
      Array.from({ length: head - afterSeq }, (_, index) => afterSeq + 1 + index),
    );
  });

  test("filters by thread and kind prefix, in catch-up and live", async () => {
    const h = await openHarness();
    const a = newThread(h, "a");
    const b = newThread(h, "b");
    startTurn(h, a.threadId);
    startTurn(h, b.threadId);
    const got: string[] = [];
    expectOk(
      h.service.subscribe(
        0,
        (batch) => {
          for (const event of batch.events)
            got.push(`${event.threadId === a.threadId ? "a" : "b"}:${event.kind}`);
        },
        { threadIds: [a.threadId], excludeKindPrefixes: ["item."] },
      ),
    );
    startTurn(h, b.threadId);
    startTurn(h, a.threadId);
    expect(got).toEqual(["a:thread.started", "a:turn.started", "a:turn.started"]);
  });
});

describe("reads", () => {
  test("feed.read pages with limit and scanLimit and reports scannedTo", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const turn = startTurn(h, threadId);
    fullStep(h, turn, 0, []);
    const head = expectOk(h.service.feed.headSeq());
    const firstPage = expectOk(h.service.feed.read(0, head, undefined, 2, 100));
    expect(firstPage.events.map((event) => event.seq)).toEqual([1, 2]);
    expect(firstPage.scannedTo).toBe(2);
    const filtered = expectOk(h.service.feed.read(0, head, { kindPrefixes: ["step."] }, 10, 3));
    expect(filtered.events).toEqual([]);
    expect(filtered.scannedTo).toBe(3);
    const rest = expectOk(h.service.feed.read(3, head, { kindPrefixes: ["step."] }, 10, 100));
    expect(rest.events.map((event) => event.kind)).toEqual(["step.started", "step.completed"]);
    expect(rest.scannedTo).toBe(head);
    expect(h.service.feed.oldestReplayableSeq()).toBe(0);
  });

  test("readFrom honours afterSeq (exclusive), threadId and limit", async () => {
    const h = await openHarness();
    const a = newThread(h, "a");
    const b = newThread(h, "b");
    startTurn(h, a.threadId);
    startTurn(h, b.threadId);
    const all = await collect(h.service.readFrom(0));
    expect(all.map((event) => event.seq)).toEqual(all.map((_, index) => index + 1));
    const after = await collect(h.service.readFrom(2));
    expect(after[0]?.seq).toBe(3);
    const onlyB = await collect(h.service.readFrom(0, { threadId: b.threadId }));
    expect(onlyB.every((event) => event.threadId === b.threadId)).toBe(true);
    const limited = await collect(h.service.readFrom(0, { limit: 2 }));
    expect(limited).toHaveLength(2);
  });

  test("readBranch walks parentId from the leaf to the root, oldest first", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    startTurn(h, threadId);
    const events = await collect(h.service.readBranch(threadId));
    expect(events.map((event) => event.kind)).toEqual([
      "thread.started",
      "turn.started",
      "item.recorded",
    ]);
    const upTo = events[1];
    const partial = await collect(h.service.readBranch(threadId, upTo?.id));
    expect(partial.map((event) => event.kind)).toEqual(["thread.started", "turn.started"]);
  });

  test("emitVolatile reaches volatile listeners without being stored", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const got: VolatileEventEnvelope[] = [];
    h.service.feed.onVolatile((event) => {
      got.push(event);
    });
    const before = h.store.rowCounts();
    h.service.emitVolatile({
      id: h.ids.next("evt"),
      kind: "turn.updated",
      version: 1,
      threadId,
      turnId: null,
      stepId: null,
      recordedAt: h.clock.now(),
      causationId: null,
      correlationId: null,
      payload: { status: "running" },
      durable: false,
      n: 0,
      afterSeq: 1,
    });
    expect(got).toHaveLength(1);
    expect(h.store.rowCounts()).toEqual(before);
  });

  test("hydrate puts detached strings back from their blobs and keeps the placeholder when a blob is gone", async () => {
    const present = "a".repeat(64);
    const missing = "b".repeat(64);
    const blobs = new Map([[present, new TextEncoder().encode("the full text")]]);
    const h = await openHarness({
      readBlob: (ref) => {
        const bytes = blobs.get(ref.sha256);
        return bytes === undefined ? err({ kind: "blob_missing", sha256: ref.sha256 }) : ok(bytes);
      },
    });
    const { threadId } = newThread(h);
    const turnId = h.ids.next("trn");
    commitOrThrow(h, threadId, "blob:1", () => ({
      kind: "append",
      drafts: [
        h.loop.draft({
          id: h.ids.next("evt"),
          kind: "item.recorded",
          threadId,
          turnId,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: {
            item: {
              itemId: h.ids.next("itm"),
              status: "completed",
              kind: "user",
              message: { role: "user", content: `blob:sha256:${present}`, timestamp: 1 },
              requestId: null,
            },
          },
          detached: [{ pointer: "/item/message/content", ref: blobRef(present) }],
        }),
        h.loop.draft({
          id: h.ids.next("evt"),
          kind: "item.recorded",
          threadId,
          turnId,
          stepId: null,
          causationId: null,
          correlationId: null,
          payload: {
            item: {
              itemId: h.ids.next("itm"),
              status: "completed",
              kind: "user",
              message: { role: "user", content: `blob:sha256:${missing}`, timestamp: 1 },
              requestId: null,
            },
          },
          detached: [{ pointer: "/item/message/content", ref: blobRef(missing) }],
        }),
      ],
      checkpoint: null,
    }));
    const events = await collect(h.service.readFrom(1, { threadId }));
    const [first, second] = events;
    if (first === undefined || second === undefined) throw new Error("missing events");
    const hydratedFirst = await h.service.hydrate(first);
    expect(JSON.stringify(hydratedFirst.payload)).toContain("the full text");
    expect(first.payload).not.toEqual(hydratedFirst.payload);
    const hydratedSecond = await h.service.hydrate(second);
    expect(JSON.stringify(hydratedSecond.payload)).toContain(`blob:sha256:${missing}`);
    expect(h.logs).toContain("warn:session.hydrate_missing_blob");
    // readBlob이 없으면 되돌릴 수 없다
    const bare = await openHarness();
    let message = "";
    await bare.service.hydrate(first).catch((caught: unknown) => {
      message = caught instanceof Error ? caught.message : "";
    });
    expect(message).toContain("store.blob_unavailable");
  });

  test("hydrate returns an event without detached fields as is", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const [first] = await collect(h.service.readFrom(0, { threadId, limit: 1 }));
    if (first === undefined) throw new Error("no event");
    expect(await h.service.hydrate(first)).toBe(first);
  });
});
