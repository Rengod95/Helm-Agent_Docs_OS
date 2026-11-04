import { describe, expect, test } from "bun:test";
import { parse } from "../../src/index.ts";
import { WIRE_LIMITS, WIRE_METHODS } from "../../src/wire-settings/wire/index.ts";
import { rawId } from "../helpers/ids.ts";

// M4 thread.export(F.wire-settings.spec §3.4.7 [제안]). 요청과 결과 스키마를 값으로 고정한다.
// 쪽 나누기와 본문의 모양은 호스트 시험(test/handlers/thread-export.test.ts)이 본다.

const THREAD = rawId("thr", 1);
const ITEM = rawId("itm", 2);
const { params, result } = WIRE_METHODS["thread.export"];

describe("thread.export registry row", () => {
  test("is an M4 method and is not counted among the M1~M3 rows", () => {
    expect(WIRE_METHODS["thread.export"].stage).toBe("M4");
    expect(WIRE_METHODS["thread.export"].since).toBe("0.1.0");
    expect(WIRE_METHODS["thread.export"].status).toBe("active");
  });
});

describe("thread.export params", () => {
  test("threadId and format are required, after is optional", () => {
    expect(parse(params, { threadId: THREAD, format: "markdown" }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, format: "json" }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD, format: "json", after: ITEM }).ok).toBe(true);
    expect(parse(params, { threadId: THREAD }).ok).toBe(false);
    expect(parse(params, { format: "markdown" }).ok).toBe(false);
  });

  test("format accepts only markdown and json", () => {
    expect(parse(params, { threadId: THREAD, format: "html" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, format: "Markdown" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, format: 1 }).ok).toBe(false);
  });

  test("after must be an item id, and unknown keys are refused", () => {
    expect(parse(params, { threadId: THREAD, format: "json", after: "itm_x" }).ok).toBe(false);
    expect(parse(params, { threadId: "thr_x", format: "json" }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, format: "json", limit: 5 }).ok).toBe(false);
    expect(parse(params, { threadId: THREAD, format: "json", before: ITEM }).ok).toBe(false);
  });
});

describe("thread.export result", () => {
  const first = {
    format: "markdown",
    filename: "회의 메모.md",
    chunk: "# 회의 메모\n",
    itemCount: 2,
  };

  test("a page with next and a last page without next both parse", () => {
    expect(parse(result, { ...first, next: ITEM }).ok).toBe(true);
    expect(parse(result, first).ok).toBe(true);
    expect(parse(result, { ...first, format: "json", chunk: "[]", itemCount: 0 }).ok).toBe(true);
  });

  test("filename is 1 to 200 characters", () => {
    expect(parse(result, { ...first, filename: "" }).ok).toBe(false);
    expect(parse(result, { ...first, filename: "a".repeat(200) }).ok).toBe(true);
    expect(parse(result, { ...first, filename: "a".repeat(201) }).ok).toBe(false);
  });

  test("a chunk longer than one frame is refused", () => {
    const frame = "x".repeat(WIRE_LIMITS.maxFrameBytes);
    expect(parse(result, { ...first, chunk: frame }).ok).toBe(true);
    expect(parse(result, { ...first, chunk: `${frame}x` }).ok).toBe(false);
  });

  test("itemCount is a non-negative integer and next is an item id", () => {
    expect(parse(result, { ...first, itemCount: -1 }).ok).toBe(false);
    expect(parse(result, { ...first, itemCount: 1.5 }).ok).toBe(false);
    expect(parse(result, { ...first, next: "itm_x" }).ok).toBe(false);
  });

  test("format is one of the two formats and the shape is closed", () => {
    expect(parse(result, { ...first, format: "html" }).ok).toBe(false);
    expect(parse(result, { format: "markdown", filename: "a.md", itemCount: 0 }).ok).toBe(false);
    expect(parse(result, { ...first, extra: true }).ok).toBe(false);
  });
});
