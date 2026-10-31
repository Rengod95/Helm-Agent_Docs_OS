// 자리표시(`blob:sha256:<hex>`)만으로 이벤트가 참조하는 블롭은 p_blob_refs가 모은다(L0.store.spec §10 S-15 해소).
// detached 필드와 effect.*의 BlobRef만 보던 예전 규칙으로는 이 블롭이 GC로 지워졌다.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import type { ThreadId } from "@xeon/contracts/conversation";
import { expectProjectionsRebuildable } from "../src/testing/index.ts";
import { manualClock } from "./support/clock.ts";
import {
  commitOrThrow,
  draftOf,
  expectOk,
  newThread,
  openHarness,
  reopenHarness,
  type Harness,
} from "./support/harness.ts";
import { openTestStore } from "./support/sqlite-store.ts";

// 기본 l0.store.blobGraceMs(1일)를 넘도록 시계를 민다
const PAST_GRACE_MS = 86_400_000 + 1;

function placeholder(sha256: string): string {
  return `blob:sha256:${sha256}`;
}

function userItem(h: Harness, content: unknown): unknown {
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

/** 사용자 항목 하나를 detached 없이 커밋한다. 자리표시는 payload 문자열에만 있다 */
function recordUserItem(h: Harness, threadId: ThreadId, key: string, content: unknown): string {
  const turnId = h.ids.next("trn");
  const committed = commitOrThrow(h, threadId, key, () => ({
    kind: "append",
    drafts: [
      draftOf(h, h.loop, "item.recorded", threadId, { turnId, stepId: null }, userItem(h, content)),
    ],
    checkpoint: null,
  }));
  const eventId = committed.eventIds[0];
  if (eventId === undefined) throw new Error("the commit wrote no event");
  return eventId;
}

describe("p_blob_refs collects placeholders in event payloads", () => {
  test("an image part and a text part that embeds a placeholder are live refs, with no detached field", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const image = "a".repeat(64);
    const embedded = "b".repeat(64);
    const eventId = recordUserItem(h, threadId, "placeholder:a", [
      { type: "image", data: placeholder(image), mimeType: "image/png" },
      { type: "text", text: `tool output: saved as ${placeholder(embedded)}; done` },
    ]);

    expect(expectOk(h.service.query.liveBlobRefs())).toEqual([image, embedded]);
    const events = (await Array.fromAsync(h.service.readFrom(1, { threadId }))).map(expectOk);
    const event = events.find((candidate) => candidate.id === eventId);
    expect(event).toBeDefined();
    expect(event?.detached).toBeUndefined();
    expectProjectionsRebuildable(h.store.db);
  });

  test("a blob that only a placeholder names survives a real GC and an orphan blob is removed", async () => {
    const clock = manualClock();
    const store = await openTestStore({ clock });
    const h = await openHarness({
      clock,
      store,
      putBlob: (bytes, mediaType) => store.service.putBlob(bytes, mediaType),
      readBlob: (ref) => store.service.readBlob(ref),
    });
    const { threadId } = newThread(h);
    const live = expectOk(
      store.service.putBlob(
        new TextEncoder().encode("image bytes named only by a placeholder"),
        "image/png",
      ),
    );
    const orphan = expectOk(
      store.service.putBlob(new TextEncoder().encode("nothing refers to this blob"), "text/plain"),
    );
    recordUserItem(h, threadId, "placeholder:gc", [
      { type: "image", data: placeholder(live.sha256), mimeType: "image/png" },
    ]);
    const liveRefs = expectOk(h.service.query.liveBlobRefs());
    expect(liveRefs).toEqual([live.sha256]);

    clock.advance(PAST_GRACE_MS);
    const report = store.gcBlobs({ liveRefs: new Set(liveRefs) });
    expect(report).toEqual({
      ok: true,
      value: { rows: 1, orphanFiles: 0, tmpFiles: 0, deferred: 0, truncated: false },
    });
    const rows = store.raw
      .query<{ sha256: string }, []>("SELECT sha256 FROM sys_blobs ORDER BY sha256")
      .all()
      .map((row) => row.sha256);
    expect(rows).toEqual([live.sha256]);
    expect(existsSync(blobFile(store.blobsDir, orphan.sha256))).toBe(false);
    expect(existsSync(blobFile(store.blobsDir, live.sha256))).toBe(true);
    const read = store.service.readBlob(live);
    expect(read.ok && new TextDecoder().decode(read.value)).toBe(
      "image bytes named only by a placeholder",
    );
  });

  test("strings that only look like a placeholder are not collected", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    recordUserItem(h, threadId, "placeholder:lookalike", [
      { type: "text", text: `blob:sha256:${"a".repeat(63)}` },
      { type: "text", text: `blob:sha256:${"a".repeat(65)}` },
      { type: "text", text: `blob:sha256:${"g".repeat(64)}` },
      { type: "text", text: `blob:sha256:${"A".repeat(64)}` },
      { type: "text", text: `blob-sha256:${"a".repeat(64)}` },
      { type: "text", text: "a".repeat(64) },
    ]);

    expect(expectOk(h.service.query.liveBlobRefs())).toEqual([]);
    expectProjectionsRebuildable(h.store.db);
  });

  test("an older core projection collects the placeholder refs when it is rebuilt on the next start", async () => {
    const h = await openHarness();
    const { threadId } = newThread(h);
    const image = "c".repeat(64);
    recordUserItem(h, threadId, "placeholder:stale", [
      { type: "image", data: placeholder(image), mimeType: "image/png" },
    ]);
    expect(expectOk(h.service.query.liveBlobRefs())).toEqual([image]);

    // 옛 투영(버전 4, 자리표시 참조 행 없음)을 흉내 낸다. 다음 열기가 코어 투영기를 다시 만든다
    h.store.raw.run("UPDATE projector_state SET version = 4 WHERE name = 'core'");
    h.store.raw.run("DELETE FROM p_blob_refs");
    const restarted = await reopenHarness(h);

    expect(expectOk(restarted.service.query.liveBlobRefs())).toEqual([image]);
    expectProjectionsRebuildable(restarted.store.db);
  });
});

function blobFile(blobsDir: string, sha256: string): string {
  return join(blobsDir, sha256.slice(0, 2), sha256.slice(2));
}
