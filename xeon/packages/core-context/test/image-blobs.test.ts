import { expect, test } from "bun:test";
import { err, ok } from "@fresnel/contracts";
import type { ItemRecord, Message } from "@fresnel/contracts/conversation";
import { BLOB_PLACEHOLDER_PREFIX } from "@fresnel/contracts/records";
import { UNREADABLE_IMAGE_TEXT } from "../src/resolve-blobs.ts";
import type { MemoryLog } from "./support/log.ts";
import { assembleOptions } from "./support/builders.ts";
import { harness } from "./support/harness.ts";
import { valueOf } from "./support/result.ts";

const GOOD = "a".repeat(64);
const GONE = "b".repeat(64);
const BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 255]);

function imageUser(log: MemoryLog, hashes: readonly string[]): ItemRecord {
  const message: Message = {
    role: "user",
    content: [
      ...hashes.map((hash) => ({
        type: "image" as const,
        data: `${BLOB_PLACEHOLDER_PREFIX}${hash}`,
        mimeType: "image/png",
      })),
      { type: "text" as const, text: "pic.png" },
    ],
    timestamp: 1,
  };
  return {
    itemId: log.ids.next("itm"),
    status: "completed",
    kind: "user",
    message,
    requestId: null,
  };
}

function reader(sha256: string) {
  return sha256 === GOOD ? ok(BYTES) : err({ kind: "blob_missing" as const, sha256 });
}

test("an image placeholder is resolved to the stored bytes as base64 in the model request", async () => {
  const h = await harness({ readBlobByHash: reader });
  h.log.append("thread.started", {});
  h.log.append("item.recorded", { item: imageUser(h.log, [GOOD]) });
  const out = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const user = out.messages.find((m) => m.role === "user");
  expect(user?.content).toEqual([
    { type: "image", data: Buffer.from(BYTES).toString("base64"), mimeType: "image/png" },
    { type: "text", text: "pic.png" },
  ]);
});

test("an unreadable blob becomes a text part in the request and does not block the thread", async () => {
  const h = await harness({ readBlobByHash: reader });
  h.log.append("thread.started", {});
  h.log.append("item.recorded", { item: imageUser(h.log, [GONE, GOOD]) });
  const out = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const user = out.messages.find((m) => m.role === "user");
  expect(user?.content).toEqual([
    { type: "text", text: UNREADABLE_IMAGE_TEXT },
    { type: "image", data: Buffer.from(BYTES).toString("base64"), mimeType: "image/png" },
    { type: "text", text: "pic.png" },
  ]);
  expect(h.logged.some((c) => c.event === "context.image_blob_unreadable")).toBe(true);
});

test("a malformed placeholder also becomes the text part", async () => {
  const h = await harness({ readBlobByHash: reader });
  h.log.append("thread.started", {});
  h.log.append("item.recorded", { item: imageUser(h.log, ["../x"]) });
  const out = valueOf(
    await h.service.assemble(h.log.threadId, h.log.leaf(), assembleOptions(h.log.ids)),
  );
  const user = out.messages.find((m) => m.role === "user");
  expect(user?.content).toEqual([
    { type: "text", text: UNREADABLE_IMAGE_TEXT },
    { type: "text", text: "pic.png" },
  ]);
});
