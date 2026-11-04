import { expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import type { LeafMask } from "../../src/conversation/index.ts";
import {
  InputQueuedPayloadSchema,
  maskQueuedInput,
  type InputQueuedPayload,
} from "../../src/records/index.ts";

// L0.secrets.spec §3.5.1. 대기 입력 칩의 글은 호스트가 준 구간으로 가린다. 요청 키와 모드는 바뀌지 않는다.

const VALUE = "maskprobe";

function build(content: unknown): InputQueuedPayload {
  const parsed = parse(InputQueuedPayloadSchema, {
    mode: "followUp",
    item: { kind: "user", content },
    requestId: "req-1",
    source: { type: "user", via: "interactive" },
  });
  if (!parsed.ok) throw new Error("the test payload must be valid");
  return parsed.value;
}

function leafFor(pointer: string, text: string): LeafMask {
  const start = text.indexOf(VALUE);
  return {
    pointer,
    len: text.length,
    ranges: [{ start, end: start + VALUE.length, label: "token" }],
  };
}

test("a plain-string input is masked at /item/content and everything else is unchanged", () => {
  const text = `deploy with ${VALUE} now`;
  const payload = build(text);
  const masked = maskQueuedInput(payload, [leafFor("/item/content", text)]);
  expect(masked).toEqual({
    ...payload,
    item: { kind: "user", content: "deploy with [REDACTED:token] now" },
  });
  // 입력은 바뀌지 않는다
  expect(payload.item).toEqual({ kind: "user", content: text });
});

test("a text part in a parts list is masked at its own pointer", () => {
  const text = `key ${VALUE}`;
  const payload = build([{ type: "text", text }]);
  const masked = maskQueuedInput(payload, [leafFor("/item/content/0/text", text)]);
  expect(masked?.item).toEqual({
    kind: "user",
    content: [{ type: "text", text: "key [REDACTED:token]" }],
  });
});

test("no marks give the payload back; a length that no longer matches hides the leaf", () => {
  const payload = build("hello");
  expect(maskQueuedInput(payload, undefined)).toBe(payload);
  const stale: LeafMask = { pointer: "/item/content", len: 99, ranges: [] };
  expect(maskQueuedInput(payload, [stale])?.item).toEqual({
    kind: "user",
    content: "[REDACTED:unverified]",
  });
});

test("a mark that points at something that is not a string is null", () => {
  const payload = build("hello");
  expect(maskQueuedInput(payload, [{ pointer: "/item", len: 1, ranges: [] }])).toBeNull();
});
