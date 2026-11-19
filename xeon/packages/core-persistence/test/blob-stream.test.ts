import { describe, expect, test } from "bun:test";
import { canonicalJson } from "@fresnel/contracts";
import {
  jsonUtf8Length,
  stringUtf8Sizes,
  type BlobStreamSource,
  type DurableEventDraft,
} from "@fresnel/contracts/records";
import { detachLarge, restoreDetached } from "../src/blob.ts";
import { canonicalJsonSha256Hex, jsonBlobSource, stringBlobSource } from "../src/json-stream.ts";
import { sha256Hex } from "../src/hash.ts";
import { fixedIdFactory } from "./support/clock.ts";
import {
  appendItem,
  bigObject,
  KIB,
  leaseDraft,
  MIB,
  openRealHarness,
  replayed,
  storedRow,
  userItemPayload,
} from "./support/large.ts";
import { commitResult, expectOk, memoryBlobs, newThread } from "./support/harness.ts";

// 큰 값의 조각 인코딩(L1.persistence.spec §4.11): 조각을 이어 붙이면 `TextEncoder`와 `JSON.stringify`의 바이트와 같다

const encoder = new TextEncoder();

/** 원천의 조각을 모두 모은다. 조각은 `sink` 호출 동안만 유효하므로 복사해 둔다. 조각 크기 목록도 돌려준다 */
function collect(source: BlobStreamSource): {
  readonly bytes: Uint8Array;
  readonly sizes: number[];
} {
  const parts: Uint8Array[] = [];
  const sizes: number[] = [];
  source.produce((chunk) => {
    parts.push(chunk.slice());
    sizes.push(chunk.byteLength);
  });
  const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let at = 0;
  for (const part of parts) {
    bytes.set(part, at);
    at += part.byteLength;
  }
  return { bytes, sizes };
}

/** 글의 원천을 만든다. 크기는 `stringUtf8Sizes`가 정한 값이다 */
function stringSourceOf(text: string): BlobStreamSource {
  return stringBlobSource(text, stringUtf8Sizes(text).utf8);
}

/** JSON 원천을 만든다. 함수나 심볼이 있으면 시험 결함이다 */
function jsonSourceOf(value: unknown): BlobStreamSource {
  const source = jsonBlobSource(value, jsonUtf8Length(value));
  if (source === undefined) throw new Error("the test value is not streamable JSON");
  return source;
}

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

// 시험 글. 서로게이트 짝이 조각 경계(1 MiB 글자 또는 16 KiB 글자)에 걸리도록 앞에 `a` 하나를 둔다
const EMOJI_ON_BOUNDARY = `a${"😀".repeat(600_000)}`;
const LONE_AT_STEP = `${"a".repeat(1024 * 1024 - 1)}\ud800b${"c".repeat(10)}`;

describe("string source: the pieces concatenate to TextEncoder's bytes", () => {
  const CASES: readonly (readonly [string, string])[] = [
    ["ASCII", "0123456789abcdef".repeat(5000)],
    ["Korean", "가나다라마바사아".repeat(10_000)],
    ["emoji with a pair at the 1 MiB piece boundary", EMOJI_ON_BOUNDARY],
    ["lone high surrogate at the 1 MiB piece boundary", LONE_AT_STEP],
    ["lone surrogates in the middle", "pre\udc00mid\ud800post\udbff"],
    ["more than one 1 MiB buffer of Korean text", "가".repeat(400_000)],
    ["empty", ""],
  ];
  for (const [name, text] of CASES) {
    test(name, () => {
      const { bytes, sizes } = collect(stringSourceOf(text));
      expect(bytes).toEqual(encoder.encode(text));
      expect(bytes.byteLength).toBe(stringUtf8Sizes(text).utf8);
      expect(Math.max(0, ...sizes)).toBeLessThanOrEqual(MIB);
    });
  }
});

describe("JSON source: the pieces concatenate to JSON.stringify's bytes", () => {
  const CASES: readonly (readonly [string, unknown])[] = [
    ["ASCII object", { name: "plain ascii", list: [1, 2.5, true, null, "x"] }],
    ["Korean object", { 제목: "한글 값", 목록: ["가", "나", { 깊이: "다" }] }],
    ["emoji leaf longer than the leaf slice", { text: EMOJI_ON_BOUNDARY }],
    ["lone surrogates in a key and a value", { "k\ud800": "v\udc00", ok: "fine" }],
    [
      "nested object with a big leaf",
      { outer: { inner: { leaf: "z".repeat(300 * KIB) }, after: [1, { deep: "q" }] } },
    ],
    ["string bigger than the JSON buffer", { big: "가".repeat(100_000) }],
    ["empty string", ""],
    ["undefined members skipped, undefined in arrays is null", { a: undefined, b: [undefined, 1] }],
    ["escapes", { quote: 'say "hi"', back: "a\\b", ctl: "tab\tnl\n\u0001", del: "\u007f" }],
    ["numbers", [0, -0, 1e21, 0.1, Number.NaN, Number.POSITIVE_INFINITY]],
  ];
  for (const [name, value] of CASES) {
    test(name, () => {
      const { bytes, sizes } = collect(jsonSourceOf(value));
      expect(bytes).toEqual(encoder.encode(JSON.stringify(value)));
      expect(Math.max(0, ...sizes)).toBeLessThanOrEqual(64 * KIB);
    });
  }

  test("a value with a function or a symbol has no JSON source (the caller writes JSON.stringify)", () => {
    expect(jsonBlobSource({ fn: (): number => 1 }, 0)).toBeUndefined();
    expect(jsonBlobSource([Symbol("s")], 0)).toBeUndefined();
    expect(jsonBlobSource({ nested: { fn: (): number => 1 } }, 0)).toBeUndefined();
  });
});

describe("canonicalJsonSha256Hex: the fingerprint is the hash of canonicalJson's bytes", () => {
  const CASES: readonly (readonly [string, unknown])[] = [
    ["unsorted keys, nested", { b: 1, a: { d: [1, null, "x"], c: true } }],
    ["Korean and emoji keys and values", { 키: "값 😀", "😀": ["한"] }],
    ["undefined members are skipped", { a: undefined, b: 2 }],
    ["lone surrogates in a key and a value", { "k\ud800": "v\udc00" }],
    ["a big leaf with a pair at the piece boundary", { text: EMOJI_ON_BOUNDARY }],
    ["many objects in an array", Array.from({ length: 2000 }, (_, i) => ({ z: i, a: `${i}` }))],
    ["a scalar", "plain"],
  ];
  for (const [name, value] of CASES) {
    test(name, () => {
      expect(canonicalJsonSha256Hex(value)).toBe(sha256Hex(canonicalJson(value)));
    });
  }

  test("values canonicalJson rejects are rejected with the same Bug family", () => {
    expect(() => canonicalJsonSha256Hex([undefined])).toThrow(
      "canonicalJson: undefined array item",
    );
    expect(() => canonicalJsonSha256Hex({ n: Number.NaN })).toThrow(
      "canonicalJson: non-finite number",
    );
    expect(() => canonicalJsonSha256Hex({ f: (): number => 1 })).toThrow(
      "canonicalJson: unsupported function",
    );
    expect(() => canonicalJsonSha256Hex(undefined)).toThrow("canonicalJson: unsupported undefined");
  });
});

describe("detachLarge streams the detached value in pieces", () => {
  test("a 2.5 MB string is written in pieces of at most 1 MiB and reads back as the same bytes", () => {
    const blobs = memoryBlobs();
    const text = "a".repeat(2_500_000);
    const moved = detachLarge(draftOfPayload(text), blobs.putBlob, undefined, blobs.putBlobStream);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const ref = moved.value.detached?.[0]?.ref;
    expect(moved.value.detached?.map((field) => field.pointer)).toEqual([""]);
    expect(blobs.pieces.count).toBeGreaterThan(2);
    expect(blobs.pieces.largest).toBeLessThanOrEqual(MIB);
    expect(blobs.files.get(ref?.sha256 ?? "")).toEqual(encoder.encode(text));
  });

  test("a JSON subtree is written in pieces of at most 64 KiB and reads back as JSON.stringify's bytes", () => {
    const blobs = memoryBlobs();
    const value = {
      rows: Array.from({ length: 300 }, (_, i) => ({ i, text: `${i}`.padEnd(1000, "x") })),
    };
    const moved = detachLarge(
      draftOfPayload({ value }),
      blobs.putBlob,
      undefined,
      blobs.putBlobStream,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const field = moved.value.detached?.[0];
    expect(field?.pointer).toBe("/value");
    expect(field?.encoding).toBe("json");
    expect(blobs.pieces.count).toBeGreaterThan(2);
    expect(blobs.pieces.largest).toBeLessThanOrEqual(64 * KIB);
    expect(blobs.files.get(field?.ref.sha256 ?? "")).toEqual(encoder.encode(JSON.stringify(value)));
    const restored = restoreDetached(moved.value.payload, moved.value.detached ?? [], {
      readBlob: blobs.readBlob,
      logger: undefined,
    });
    expect(restored).toEqual({ value });
  });

  test("a JSON subtree with a function member keeps the buffered path and writes JSON.stringify's bytes", () => {
    const blobs = memoryBlobs();
    const value = { fn: (): number => 1, pad: "y".repeat(300 * KIB) };
    const moved = detachLarge(
      draftOfPayload({ value }),
      blobs.putBlob,
      undefined,
      blobs.putBlobStream,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const field = moved.value.detached?.[0];
    expect(field?.encoding).toBe("json");
    expect(blobs.pieces.count).toBe(0);
    expect(blobs.files.get(field?.ref.sha256 ?? "")).toEqual(
      encoder.encode(JSON.stringify({ pad: value.pad })),
    );
  });

  test("without putBlobStream the whole value goes through putBlob as before", () => {
    const blobs = memoryBlobs();
    const text = "b".repeat(300 * KIB);
    const moved = detachLarge(draftOfPayload(text), blobs.putBlob);
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    expect(blobs.pieces.count).toBe(0);
    expect(blobs.files.get(moved.value.detached?.[0]?.ref.sha256 ?? "")).toEqual(
      encoder.encode(text),
    );
  });
});

describe("round trip through the real store with the streamed write", () => {
  test("a big string is stored as a blob whose bytes are the string's UTF-8, and hydrates to the same string", async () => {
    const { h, store } = await openRealHarness({});
    const { threadId } = newThread(h);
    const text = "가나다라마바사아".repeat(12_500);
    const itemId = h.ids.next("itm");
    const payload = userItemPayload(itemId, text);
    expect(commitResult(h, threadId, "stream-string", appendItem(h, threadId, payload)).ok).toBe(
      true,
    );

    const item = (await replayed(h, threadId)).find((event) => event.kind === "item.recorded");
    if (item === undefined) throw new Error("the item.recorded event is missing");
    const stored = storedRow(store, item.id);
    const ref = stored.envelope.detached?.[0]?.ref;
    expect(stored.envelope.detached?.map((field) => field.pointer)).toEqual([
      "/item/message/content",
    ]);
    expect(store.service.readBlob(ref ?? fail())).toEqual({
      ok: true,
      value: encoder.encode(text),
    });
    expect((await h.service.hydrate(item)).payload).toEqual(payload);
  });

  test("a big JSON value is stored as a JSON blob whose bytes are JSON.stringify's, and hydrates deep-equal", async () => {
    const { h, store } = await openRealHarness({});
    const { threadId } = newThread(h);
    const input = bigObject(400, 1024);
    const payload = {
      leaseId: "lease-stream",
      lineageId: "lease-stream",
      scopeId: "alpha",
      limits: {},
      input,
    };
    expect(
      await h.service.ext.commit({
        threadId,
        requestId: "stream-json-1",
        drafts: [leaseDraft(h, threadId, "lease.acquired", payload)],
      }),
    ).toEqual({ status: "committed" });

    const acquired = (await replayed(h, threadId)).find((event) => event.kind === "lease.acquired");
    if (acquired === undefined) throw new Error("the lease.acquired event is missing");
    const stored = storedRow(store, acquired.id);
    const field = stored.envelope.detached?.[0];
    expect(field?.pointer).toBe("/input");
    expect(field?.encoding).toBe("json");
    expect(store.service.readBlob(field?.ref ?? fail())).toEqual({
      ok: true,
      value: encoder.encode(JSON.stringify(input)),
    });
    expect((await h.service.hydrate(acquired)).payload).toEqual(payload);
    expect(
      expectOk(await h.service.ext.loadThread(threadId)).openLeases.map((lease) => lease.input),
    ).toEqual([input]);
  });
});

/** 값이 없어야 하는 자리에서 쓴다. 시험이 실패하게 한다 */
function fail(): never {
  throw new Error("expected a value");
}
