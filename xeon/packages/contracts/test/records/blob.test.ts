import { describe, expect, test } from "bun:test";
import { ImageBlobRefSchema, toJsonSchema } from "../../src/capabilities/index.ts";
import { parse } from "../../src/index.ts";
import { BlobRefSchema, DetachedFieldSchema } from "../../src/records/index.ts";
import { SHA } from "./fixtures/payloads.ts";

describe("BlobRef", () => {
  const good = { type: "blob", sha256: SHA, size: 0, mediaType: null };

  test("accepts lowercase 64-hex and size 0", () => {
    expect(parse(BlobRefSchema, good).ok).toBe(true);
    expect(parse(BlobRefSchema, { ...good, mediaType: "image/png" }).ok).toBe(true);
  });

  test("rejects 63 chars, uppercase, negative size", () => {
    expect(parse(BlobRefSchema, { ...good, sha256: "a".repeat(63) }).ok).toBe(false);
    expect(parse(BlobRefSchema, { ...good, sha256: "A".repeat(64) }).ok).toBe(false);
    expect(parse(BlobRefSchema, { ...good, size: -1 }).ok).toBe(false);
    expect(parse(BlobRefSchema, { ...good, extra: 1 }).ok).toBe(false);
  });

  test("capabilities' ImageBlobRefSchema describes the same JSON (L2.workspace.spec §10 3)", () => {
    const records = toJsonSchema(BlobRefSchema);
    const capabilities = toJsonSchema(ImageBlobRefSchema);
    // 두 스키마가 같은 값을 받아들이고 같은 값을 거부한다
    const samples: unknown[] = [
      good,
      { ...good, sha256: "a".repeat(63) },
      { ...good, size: -1 },
      { ...good, mediaType: "image/png" },
      { ...good, extra: 1 },
      { type: "blob" },
    ];
    for (const sample of samples) {
      expect(parse(ImageBlobRefSchema, sample).ok).toBe(parse(BlobRefSchema, sample).ok);
    }
    // 같은 JSON Schema 문서다
    expect(records).toEqual(capabilities);
  });
});

describe("DetachedField", () => {
  const ref = { type: "blob", sha256: SHA, size: 4, mediaType: null };

  test("pointer is empty or starts with a slash", () => {
    expect(parse(DetachedFieldSchema, { pointer: "", ref }).ok).toBe(true);
    expect(parse(DetachedFieldSchema, { pointer: "/a/0/data", ref }).ok).toBe(true);
    expect(parse(DetachedFieldSchema, { pointer: "a/b", ref }).ok).toBe(false);
  });
});
