import { expect, test } from "bun:test";
import { createHostTruncator } from "../../src/assembly/truncator.ts";

const truncator = createHostTruncator();

test("text within both limits is returned as it is", () => {
  const cut = truncator.truncateHead("a\nb\nc", { maxLines: 3, maxBytes: 100 });
  expect(cut).toEqual({
    content: "a\nb\nc",
    truncated: false,
    truncatedBy: null,
    totalLines: 3,
    totalBytes: 5,
    outputLines: 3,
    outputBytes: 5,
  });
});

test("too many lines keep the head and report lines", () => {
  const cut = truncator.truncateHead("1\n2\n3\n4\n5", { maxLines: 2 });
  expect(cut).toMatchObject({
    content: "1\n2",
    truncated: true,
    truncatedBy: "lines",
    totalLines: 5,
    outputLines: 2,
    outputBytes: 3,
  });
});

test("too many bytes keep whole lines only and report bytes", () => {
  const cut = truncator.truncateHead("aaaa\nbbbb\ncccc", { maxBytes: 9 });
  expect(cut).toMatchObject({
    content: "aaaa\nbbbb",
    truncated: true,
    truncatedBy: "bytes",
    totalLines: 3,
    totalBytes: 14,
    outputLines: 2,
    outputBytes: 9,
  });
});

test("multi-byte characters are counted in UTF-8 bytes", () => {
  const cut = truncator.truncateHead("한글\n한글", { maxBytes: 7 });
  expect(cut.truncated).toBe(true);
  expect(cut.content).toBe("한글");
  expect(cut.outputBytes).toBe(6);
  expect(cut.totalBytes).toBe(13);
});

test("the defaults are 2000 lines and 50 KiB", () => {
  const lines = Array.from({ length: 2001 }, () => "x").join("\n");
  expect(truncator.truncateHead(lines).truncatedBy).toBe("lines");
  const wide = "y".repeat(51_201);
  expect(truncator.truncateHead(wide).truncated).toBe(true);
});

test("formatSize prints bytes under 1 KiB and kilobytes above", () => {
  expect(truncator.formatSize(512)).toBe("512B");
  expect(truncator.formatSize(2048)).toBe("2.0KB");
});
