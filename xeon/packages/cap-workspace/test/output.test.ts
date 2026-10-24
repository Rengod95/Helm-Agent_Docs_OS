import { describe, expect, test } from "bun:test";
import {
  boundOutput,
  characterEnd,
  OutputBuffer,
  sanitizeOutput,
  utf8ByteLength,
} from "../src/upstream/output.ts";

// 포크한 harness/output.ts의 동작이 원본과 같은지 확인한다(plan W2·W3). 출력 절단(truncate.ts)은 platform-exec가 소유하고 거기서 시험한다(review.decisions-2 B-04).

describe("OutputBuffer (tail retention)", () => {
  test("keeps the last lines within the limits and counts what was dropped", () => {
    const buffer = new OutputBuffer({ maxBytes: 1000, maxLines: 3, retain: "tail" });
    buffer.push("l1\nl2\nl3\n");
    buffer.push("l4\nl5\n");
    buffer.end();
    const snapshot = buffer.snapshot();
    expect(snapshot.text).toBe("l3\nl4\nl5\n");
    expect(snapshot.droppedLines).toBe(2);
    expect(snapshot.droppedBytes).toBe(6);
  });

  test("an output within the limits is kept whole", () => {
    const buffer = new OutputBuffer({ maxBytes: 1000, maxLines: 10, retain: "tail" });
    buffer.push("a\nb\n");
    expect(buffer.snapshot()).toEqual({ text: "a\nb\n", droppedBytes: 0, droppedLines: 0 });
  });

  test("a skip is counted and the text after it is the new tail", () => {
    const buffer = new OutputBuffer({ maxBytes: 1000, maxLines: 2, retain: "tail" });
    buffer.push("last 1\nlast 2\n", { bytes: 500, newlines: 40, endsWithNewline: true });
    const snapshot = buffer.snapshot();
    expect(snapshot.text).toBe("last 1\nlast 2\n");
    expect(snapshot.droppedBytes).toBe(500);
    expect(snapshot.droppedLines).toBe(40);
  });

  test("a head buffer refuses skips", () => {
    const buffer = new OutputBuffer({ maxBytes: 100, maxLines: 2, retain: "head" });
    expect(() => buffer.push("x", { bytes: 1, newlines: 0, endsWithNewline: false })).toThrow();
  });

  test("a single over-long line is cut at the byte limit on a character boundary", () => {
    const buffer = new OutputBuffer({ maxBytes: 8, maxLines: 100, retain: "tail" });
    buffer.push("가각갂갃간");
    const snapshot = buffer.snapshot();
    // 한 글자 3바이트: 8바이트 창에는 두 글자(6바이트)만 들어간다
    expect(snapshot.text).toBe("갃간");
    expect(utf8ByteLength(snapshot.text)).toBeLessThanOrEqual(8);
  });
});

describe("output helpers", () => {
  test("boundOutput keeps whole lines for head and tail", () => {
    expect(boundOutput("1\n2\n3\n4\n", { maxBytes: 100, maxLines: 2, retain: "head" }).text).toBe(
      "1\n2\n",
    );
    expect(boundOutput("1\n2\n3\n4\n", { maxBytes: 100, maxLines: 2, retain: "tail" }).text).toBe(
      "3\n4\n",
    );
  });

  test("characterEnd backs up to a character boundary", () => {
    const bytes = new TextEncoder().encode("a가");
    expect(characterEnd(bytes, 2)).toBe(1);
    expect(characterEnd(bytes, 4)).toBe(4);
  });

  test("sanitizeOutput drops control characters but keeps tabs and newlines", () => {
    expect(sanitizeOutput("a\u0000b\tc\nd\u001Be")).toBe("ab\tc\nde");
  });
});
