import { describe, expect, test } from "bun:test";
import { formatSize, truncateHead, truncateHeadOf } from "../../src/upstream/truncate.ts";

// XEON-PATCH: P4
// 원본 test/env-truncate.test.ts의 포팅(vitest -> bun:test). Buffer 없는 런타임 시험은 P10으로 대체 계산을 지워 뺐다.
// truncateHeadOf 시험은 L2 cap-workspace의 사본에서 옮겨 왔다(review.decisions-2 B-04).

const encoder = new TextEncoder();

function byteLength(content: string): number {
  return encoder.encode(content).length;
}

describe("truncate utilities", () => {
  test("reports UTF-8 byte counts in truncation results", () => {
    const content = "aé🙂\nb";
    const result = truncateHead(content, { maxBytes: 100, maxLines: 10 });

    expect(result.truncated).toBe(false);
    expect(result.totalBytes).toBe(byteLength(content));
    expect(result.outputBytes).toBe(byteLength(content));
    expect(result.totalBytes).toBe(9);
  });

  test("counts UTF-8 bytes of lone surrogates and multi-byte characters like TextEncoder", () => {
    for (const input of ["", "ascii", "é", "中", "🙂", "a🙂b", "߿ࠀ￿"]) {
      expect(truncateHead(input).totalBytes).toBe(byteLength(input));
    }
    expect(truncateHead("aé🙂\nb", { maxBytes: 7, maxLines: 10 })).toMatchObject({
      content: "aé🙂",
      outputBytes: 7,
      truncatedBy: "bytes",
    });
  });

  test("does not count a trailing newline as an extra line", () => {
    const content = `${Array.from({ length: 3 }, () => "line").join("\n")}\n`;
    const head = truncateHead(content, { maxBytes: 100, maxLines: 3 });

    expect(head).toMatchObject({ truncated: false, totalLines: 3, outputLines: 3 });
  });

  test("truncates head by line limits", () => {
    const content = "one\ntwo\nthree\nfour";
    expect(truncateHead(content, { maxBytes: 100, maxLines: 2 })).toMatchObject({
      content: "one\ntwo",
      truncated: true,
      truncatedBy: "lines",
      totalLines: 4,
      outputLines: 2,
    });
  });

  test("reports bytes when only a trailing newline exceeds limits at the line cap", () => {
    expect(truncateHead("hello\nworld\n", { maxBytes: 11, maxLines: 2 })).toMatchObject({
      content: "hello\nworld",
      truncated: true,
      truncatedBy: "bytes",
      totalLines: 2,
      outputLines: 2,
    });
  });

  test("truncates head on UTF-8 byte limits without partial lines", () => {
    const content = "éé\nabc";
    const result = truncateHead(content, { maxBytes: 4, maxLines: 10 });

    expect(result.content).toBe("éé");
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("bytes");
    expect(result.outputBytes).toBe(4);
    expect(result.firstLineExceedsLimit).toBe(false);
  });

  test("reports head truncation when the first line exceeds the byte limit", () => {
    const result = truncateHead("éé\nabc", { maxBytes: 3, maxLines: 10 });

    expect(result.content).toBe("");
    expect(result.truncated).toBe(true);
    expect(result.truncatedBy).toBe("bytes");
    expect(result.firstLineExceedsLimit).toBe(true);
  });

  test("applies the defaults of 2000 lines and 50KB and reports the applied limits", () => {
    const result = truncateHead("short");
    expect(result).toMatchObject({ truncated: false, maxLines: 2000, maxBytes: 51_200 });
    const many = Array.from({ length: 2500 }, (_, index) => `l${index}`).join("\n");
    expect(truncateHead(many)).toMatchObject({ truncatedBy: "lines", outputLines: 2000 });
  });

  test("formats sizes", () => {
    expect(formatSize(1023)).toBe("1023B");
    expect(formatSize(1536)).toBe("1.5KB");
    expect(formatSize(3 * 1024 * 1024)).toBe("3.0MB");
  });
});

describe("truncateHeadOf", () => {
  test("equals truncateHead of the whole text for a long enough prefix", () => {
    const whole = Array.from({ length: 50 }, (_, index) => `row ${index}`).join("\n");
    const options = { maxLines: 5, maxBytes: 1000 };
    const prefix = whole.split("\n").slice(0, 6).join("\n");
    const totals = { lines: 50, bytes: byteLength(whole) };
    expect(truncateHeadOf(prefix, totals, options)).toEqual(truncateHead(whole, options));
  });

  test("uses the given totals, not the prefix, for the reported totals", () => {
    const result = truncateHeadOf("a\nb\nc", { lines: 100, bytes: 9999 }, { maxLines: 2 });
    expect(result).toMatchObject({
      content: "a\nb",
      totalLines: 100,
      totalBytes: 9999,
      truncatedBy: "lines",
    });
  });
});
