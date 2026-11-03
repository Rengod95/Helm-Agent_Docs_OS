import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  applyRanges,
  ItemIdSchema,
  maskItemRecord,
  maskPartText,
  type ItemRecord,
  type LeafMask,
  type MaskRange,
  type PartMask,
} from "../../src/conversation/index.ts";

// L0.secrets.spec §3.5.1 [결정: 2026-11-03 사용자]. 적용기는 호스트가 준 구간만 적용한다. 값과 패턴을 모른다.

const parsedId = parse(ItemIdSchema, `itm_${"0".repeat(22)}0001`);
if (!parsedId.ok) throw new Error("bad test item id");
const itemId = parsedId.value;

/** 조각 표식 하나(검증된 것). 시험 본문마다 다시 만들지 않는다 */
function verified(len: number, visible: number, ranges: MaskRange[]): PartMask {
  return { verified: true, len, visible, ranges };
}

function userItem(content: string): ItemRecord {
  return {
    itemId,
    status: "completed",
    kind: "user",
    requestId: null,
    message: { role: "user", content, timestamp: 0 },
  };
}

function toolResultItem(text: string): ItemRecord {
  return {
    itemId,
    status: "completed",
    kind: "toolResult",
    effectId: null,
    message: {
      role: "toolResult",
      toolCallId: "call_1",
      toolName: "bash",
      content: [{ type: "text", text }],
      isError: false,
      timestamp: 0,
    },
  };
}

describe("applyRanges", () => {
  test("replaces each range with the label marker and keeps the rest", () => {
    expect(
      applyRanges("aa secret1 bb secret2 cc", [
        { start: 3, end: 10, label: "known:x" },
        { start: 14, end: 21, label: "kv" },
      ]),
    ).toBe("aa [REDACTED:known:x] bb [REDACTED:kv] cc");
  });

  test("no ranges returns the text unchanged", () => {
    expect(applyRanges("plain", [])).toBe("plain");
  });

  test("a range that is out of order, empty, or past the end hides the whole text", () => {
    expect(applyRanges("abcdef", [{ start: 4, end: 2, label: "kv" }])).toBe(
      "[REDACTED:unverified]",
    );
    expect(applyRanges("abcdef", [{ start: 2, end: 2, label: "kv" }])).toBe(
      "[REDACTED:unverified]",
    );
    expect(applyRanges("abcdef", [{ start: 0, end: 9, label: "kv" }])).toBe(
      "[REDACTED:unverified]",
    );
    expect(
      applyRanges("abcdef", [
        { start: 0, end: 4, label: "kv" },
        { start: 2, end: 5, label: "kv" },
      ]),
    ).toBe("[REDACTED:unverified]");
  });
});

describe("maskItemRecord", () => {
  test("without leaves the record is returned as is", () => {
    const item = userItem("hello");
    expect(maskItemRecord(item, undefined)).toBe(item);
    expect(maskItemRecord(item, [])).toBe(item);
  });

  test("a user string content is masked and the input is not changed", () => {
    const item = userItem("password=hunter2hunter2");
    const leaves: readonly LeafMask[] = [
      { pointer: "/message/content", len: 23, ranges: [{ start: 9, end: 23, label: "kv" }] },
    ];
    const out = maskItemRecord(item, leaves);
    expect(out?.kind === "user" ? out.message.content : null).toBe("password=[REDACTED:kv]");
    expect(item.kind === "user" ? item.message.content : null).toBe("password=hunter2hunter2");
  });

  test("a tool result text block inside an array is masked by its index", () => {
    const item = toolResultItem("ok");
    const withSecret = toolResultItem("token=maskprobe");
    const leaves: readonly LeafMask[] = [
      {
        pointer: "/message/content/0/text",
        len: "token=maskprobe".length,
        ranges: [{ start: 6, end: 15, label: "kv" }],
      },
    ];
    const out = maskItemRecord(withSecret, leaves);
    expect(out?.kind === "toolResult" ? out.message.content : null).toEqual([
      { type: "text", text: "token=[REDACTED:kv]" },
    ]);
    expect(item.kind).toBe("toolResult");
  });

  test("a length that does not match the leaf hides the leaf", () => {
    const item = userItem("abcdefgh");
    const leaves: readonly LeafMask[] = [{ pointer: "/message/content", len: 99, ranges: [] }];
    const out = maskItemRecord(item, leaves);
    expect(out?.kind === "user" ? out.message.content : null).toBe("[REDACTED:unverified]");
  });

  test("a pointer to a path that is not in the record is ignored", () => {
    const item = userItem("hi");
    const out = maskItemRecord(item, [{ pointer: "/message/nope", len: 2, ranges: [] }]);
    expect(out).toEqual(item);
  });

  test("a pointer to a non-string leaf makes the record unreadable (null)", () => {
    const item = userItem("hi");
    const out = maskItemRecord(item, [{ pointer: "/message", len: 0, ranges: [] }]);
    expect(out).toBeNull();
  });
});

describe("maskPartText", () => {
  test("no mask shows the raw text (a host that sends no marks)", () => {
    expect(maskPartText("raw text", undefined)).toBe("raw text");
  });

  test("an unverified part shows nothing until the durable item arrives", () => {
    expect(maskPartText("raw text", { verified: false })).toBe("");
  });

  test("a length mismatch (a dropped delta) shows nothing", () => {
    expect(maskPartText("short", verified(9, 5, []))).toBe("");
  });

  test("the visible prefix is shown with its ranges and the held tail is not", () => {
    const raw = "x token=maskprobe and more";
    // 보이는 앞부분은 "x token=maskprobe "(공백까지)다
    const visible = "x token=maskprobe ".length;
    expect(
      maskPartText(raw, verified(raw.length, visible, [{ start: 8, end: 17, label: "kv" }])),
    ).toBe("x token=[REDACTED:kv] ");
  });
});
