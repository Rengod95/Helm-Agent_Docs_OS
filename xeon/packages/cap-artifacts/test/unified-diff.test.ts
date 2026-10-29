import { describe, expect, test } from "bun:test";
import type { Result } from "@xeon/contracts";
import {
  hunkSides,
  mergeDiffFiles,
  normalizeReview,
  parseUnifiedDiff,
  renderReviewDiff,
} from "../src/reviews/unified-diff.ts";
import type { DiffFile, DiffHunk, ReviewFile } from "../src/reviews/types.ts";

const NO_NEWLINE = "\\ No newline at end of file";

/** 줄들을 줄바꿈으로 이어 diff 텍스트를 만든다. 마지막 줄에도 줄바꿈이 붙는다 */
function diff(...lines: string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

function hunk(
  header: string,
  oldStart: number,
  oldLines: number,
  newStart: number,
  newLines: number,
  lines: string[],
): DiffHunk {
  return { header, oldStart, oldLines, newStart, newLines, lines };
}

function plain(path: string): DiffFile {
  return { path, oldPath: path, change: "modified", binary: false, hunks: [] };
}

function valueOf<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
}

function reviewOf(files: readonly DiffFile[]): ReviewFile[] {
  return valueOf(normalizeReview(files));
}

describe("parseUnifiedDiff", () => {
  test("reads a modified file block in the buildFileChange shape", () => {
    const text = diff(
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,3 @@",
      " const a = 1;",
      "-const b = 2;",
      "+const b = 3;",
      " export {};",
    );

    expect(parseUnifiedDiff(text)).toEqual({
      ok: true,
      value: [
        {
          path: "src/a.ts",
          oldPath: "src/a.ts",
          change: "modified",
          binary: false,
          hunks: [
            hunk("@@ -1,3 +1,3 @@", 1, 3, 1, 3, [
              " const a = 1;",
              "-const b = 2;",
              "+const b = 3;",
              " export {};",
            ]),
          ],
        },
      ],
    });
  });

  test("a file added from /dev/null has no old path", () => {
    const text = diff(
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,2 @@",
      "+export const x = 1;",
      "+export const y = 2;",
    );

    expect(parseUnifiedDiff(text)).toEqual({
      ok: true,
      value: [
        {
          path: "src/new.ts",
          oldPath: null,
          change: "added",
          binary: false,
          hunks: [
            hunk("@@ -0,0 +1,2 @@", 0, 0, 1, 2, ["+export const x = 1;", "+export const y = 2;"]),
          ],
        },
      ],
    });
  });

  test("a file deleted to /dev/null keeps its old path as the path", () => {
    const text = diff("--- a/src/old.ts", "+++ /dev/null", "@@ -1 +0,0 @@", "-gone");

    expect(parseUnifiedDiff(text)).toEqual({
      ok: true,
      value: [
        {
          path: "src/old.ts",
          oldPath: "src/old.ts",
          change: "deleted",
          binary: false,
          hunks: [hunk("@@ -1 +0,0 @@", 1, 1, 0, 0, ["-gone"])],
        },
      ],
    });
  });

  test("keeps the no-newline marker in the hunk body", () => {
    const text = diff(
      "--- a/f.txt",
      "+++ b/f.txt",
      "@@ -1,2 +1,2 @@",
      " x",
      "-old",
      NO_NEWLINE,
      "+new",
    );

    expect(parseUnifiedDiff(text)).toEqual({
      ok: true,
      value: [
        {
          path: "f.txt",
          oldPath: "f.txt",
          change: "modified",
          binary: false,
          hunks: [hunk("@@ -1,2 +1,2 @@", 1, 2, 1, 2, [" x", "-old", NO_NEWLINE, "+new"])],
        },
      ],
    });
  });

  test("a removed line that starts with -- is body, not a file header", () => {
    const text = diff("--- a/notes.txt", "+++ b/notes.txt", "@@ -1 +1 @@", "--- note", "+x");

    expect(parseUnifiedDiff(text)).toEqual({
      ok: true,
      value: [
        {
          path: "notes.txt",
          oldPath: "notes.txt",
          change: "modified",
          binary: false,
          hunks: [hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["--- note", "+x"])],
        },
      ],
    });
  });

  test("reads several file blocks in order, git headers included", () => {
    const text = diff(
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1 +1 @@",
      "-a",
      "+b",
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1 @@",
      "+c",
    );

    expect(parseUnifiedDiff(text)).toEqual({
      ok: true,
      value: [
        {
          path: "src/a.ts",
          oldPath: "src/a.ts",
          change: "modified",
          binary: false,
          hunks: [hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["-a", "+b"])],
        },
        {
          path: "src/new.ts",
          oldPath: null,
          change: "added",
          binary: false,
          hunks: [hunk("@@ -0,0 +1 @@", 0, 0, 1, 1, ["+c"])],
        },
      ],
    });
  });

  test("binary files have no hunks and are decided per file", () => {
    const text = diff(
      "diff --git a/img/p.png b/img/p.png",
      "index 1111111..2222222 100644",
      "Binary files a/img/p.png and b/img/p.png differ",
      "diff --git a/img/new.bin b/img/new.bin",
      "new file mode 100644",
      "index 0000000..3333333",
      "Binary files /dev/null and b/img/new.bin differ",
    );

    expect(parseUnifiedDiff(text)).toEqual({
      ok: true,
      value: [
        { path: "img/p.png", oldPath: "img/p.png", change: "modified", binary: true, hunks: [] },
        { path: "img/new.bin", oldPath: null, change: "added", binary: true, hunks: [] },
      ],
    });
  });

  test("a rename is renamed, with or without hunks", () => {
    const text = diff(
      "diff --git a/src/q.ts b/src/r.ts",
      "similarity index 80%",
      "rename from src/q.ts",
      "rename to src/r.ts",
      "--- a/src/q.ts",
      "+++ b/src/r.ts",
      "@@ -1 +1 @@",
      "-x",
      "+y",
      "diff --git a/src/a.ts b/src/b.ts",
      "similarity index 100%",
      "rename from src/a.ts",
      "rename to src/b.ts",
    );

    expect(parseUnifiedDiff(text)).toEqual({
      ok: true,
      value: [
        {
          path: "src/r.ts",
          oldPath: "src/q.ts",
          change: "renamed",
          binary: false,
          hunks: [hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["-x", "+y"])],
        },
        { path: "src/b.ts", oldPath: "src/a.ts", change: "renamed", binary: false, hunks: [] },
      ],
    });
  });

  test("a hunk whose counts are short is unparsable at the header line", () => {
    const text = diff("--- a/x", "+++ b/x", "@@ -1,2 +1,2 @@", "-a", "+b");

    expect(parseUnifiedDiff(text)).toEqual({
      ok: false,
      error: { kind: "diff_unparsable", line: 3 },
    });
  });

  test("a hunk with extra body lines is unparsable at the header line", () => {
    const text = diff("--- a/x", "+++ b/x", "@@ -1 +1 @@", "-a", "+b", " c");

    expect(parseUnifiedDiff(text)).toEqual({
      ok: false,
      error: { kind: "diff_unparsable", line: 3 },
    });
  });

  test("garbage before the first header is unparsable at its line", () => {
    const text = diff("hello", "--- a/x", "+++ b/x", "@@ -1 +1 @@", "-a", "+b");

    expect(parseUnifiedDiff(text)).toEqual({
      ok: false,
      error: { kind: "diff_unparsable", line: 1 },
    });
  });

  test("garbage after a complete hunk is unparsable at its own line", () => {
    const text = diff("--- a/x", "+++ b/x", "@@ -1 +1 @@", "-a", "+b", "nonsense");

    expect(parseUnifiedDiff(text)).toEqual({
      ok: false,
      error: { kind: "diff_unparsable", line: 6 },
    });
  });

  test("a --- line without a +++ line is unparsable at the --- line", () => {
    const text = diff("--- a/x", "garbage");

    expect(parseUnifiedDiff(text)).toEqual({
      ok: false,
      error: { kind: "diff_unparsable", line: 1 },
    });
  });

  test("a malformed hunk header is unparsable at its line", () => {
    const text = diff("--- a/x", "+++ b/x", "@@ nope @@");

    expect(parseUnifiedDiff(text)).toEqual({
      ok: false,
      error: { kind: "diff_unparsable", line: 3 },
    });
  });

  test("a path without its a/ or b/ prefix is unparsable", () => {
    const text = diff("--- x", "+++ b/x", "@@ -1 +1 @@", "-a", "+b");

    expect(parseUnifiedDiff(text)).toEqual({
      ok: false,
      error: { kind: "diff_unparsable", line: 1 },
    });
  });

  test("a diff --git line with no content is unparsable", () => {
    expect(parseUnifiedDiff(diff("diff --git a/x b/x"))).toEqual({
      ok: false,
      error: { kind: "diff_unparsable", line: 1 },
    });
  });

  test("empty input has no file blocks and is unparsable at line 1", () => {
    expect(parseUnifiedDiff("")).toEqual({
      ok: false,
      error: { kind: "diff_unparsable", line: 1 },
    });
  });
});

describe("mergeDiffFiles", () => {
  test("merges blocks of one path in input order, keeping first-seen path order", () => {
    const first: DiffFile = {
      path: "src/z.ts",
      oldPath: "src/z.ts",
      change: "modified",
      binary: false,
      hunks: [hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["-a", "+b"])],
    };
    const other: DiffFile = {
      path: "src/a.ts",
      oldPath: null,
      change: "added",
      binary: false,
      hunks: [hunk("@@ -0,0 +1 @@", 0, 0, 1, 1, ["+c"])],
    };
    const second: DiffFile = {
      path: "src/z.ts",
      oldPath: "src/other.ts",
      change: "renamed",
      binary: true,
      hunks: [hunk("@@ -2 +2 @@", 2, 1, 2, 1, ["-d", "+e"])],
    };

    expect(mergeDiffFiles([first, other, second])).toEqual([
      {
        path: "src/z.ts",
        oldPath: "src/z.ts",
        change: "modified",
        binary: false,
        hunks: [
          hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["-a", "+b"]),
          hunk("@@ -2 +2 @@", 2, 1, 2, 1, ["-d", "+e"]),
        ],
      },
      {
        path: "src/a.ts",
        oldPath: null,
        change: "added",
        binary: false,
        hunks: [hunk("@@ -0,0 +1 @@", 0, 0, 1, 1, ["+c"])],
      },
    ]);
  });
});

describe("normalizeReview", () => {
  test("sorts paths by UTF-8 bytes, not UTF-16 units, and numbers files from 0", () => {
    const files = ["b.ts", "\u{1F600}.ts", "é.ts", "�.ts", "a.ts"].map(plain);

    expect(normalizeReview(files)).toEqual({
      ok: true,
      value: [
        {
          fileIndex: 0,
          path: "a.ts",
          oldPath: "a.ts",
          change: "modified",
          binary: false,
          hunks: [],
        },
        {
          fileIndex: 1,
          path: "b.ts",
          oldPath: "b.ts",
          change: "modified",
          binary: false,
          hunks: [],
        },
        {
          fileIndex: 2,
          path: "é.ts",
          oldPath: "é.ts",
          change: "modified",
          binary: false,
          hunks: [],
        },
        {
          fileIndex: 3,
          path: "�.ts",
          oldPath: "�.ts",
          change: "modified",
          binary: false,
          hunks: [],
        },
        {
          fileIndex: 4,
          path: "\u{1F600}.ts",
          oldPath: "\u{1F600}.ts",
          change: "modified",
          binary: false,
          hunks: [],
        },
      ],
    });
  });

  test("hunk ids follow the hunk order of the input, not oldStart", () => {
    const file: DiffFile = {
      path: "a.ts",
      oldPath: "a.ts",
      change: "modified",
      binary: false,
      hunks: [
        hunk("@@ -10,1 +10,1 @@", 10, 1, 10, 1, ["-a", "+b"]),
        hunk("@@ -2,1 +2,1 @@", 2, 1, 2, 1, ["-a", "+b"]),
      ],
    };

    expect(normalizeReview([file])).toEqual({
      ok: true,
      value: [
        {
          fileIndex: 0,
          path: "a.ts",
          oldPath: "a.ts",
          change: "modified",
          binary: false,
          hunks: [
            {
              ...hunk("@@ -10,1 +10,1 @@", 10, 1, 10, 1, ["-a", "+b"]),
              hunkId: "f0h0",
              patchSha256: "bc58abad77395ec97b72e785c5b2e91191f2bf33cde0deca8a85b37d3125834a",
            },
            {
              ...hunk("@@ -2,1 +2,1 @@", 2, 1, 2, 1, ["-a", "+b"]),
              hunkId: "f0h1",
              patchSha256: "1de5ee4b747fe8134ac7c6884ccf55965b063b5684d135e457e68acb56e6a07e",
            },
          ],
        },
      ],
    });
  });

  test("the patch hash is sha256 of the header, a newline and the body joined by newlines", () => {
    const file: DiffFile = {
      path: "a.ts",
      oldPath: "a.ts",
      change: "modified",
      binary: false,
      hunks: [hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["-a", "+b"])],
    };

    expect(reviewOf([file])[0]?.hunks).toEqual([
      {
        ...hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["-a", "+b"]),
        hunkId: "f0h0",
        patchSha256: "f66a89464b010b341f1aff020e1ce988a94fabf234c1cdf681f812918d8b132d",
      },
    ]);
  });

  test("more files or hunks than the limit is review_too_large", () => {
    const files = [plain("a.ts"), plain("b.ts")];
    const hunks = [
      hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["-a", "+b"]),
      hunk("@@ -2 +2 @@", 2, 1, 2, 1, ["-a", "+b"]),
      hunk("@@ -3 +3 @@", 3, 1, 3, 1, ["-a", "+b"]),
    ];
    const withHunks: DiffFile[] = [
      { ...plain("a.ts"), hunks: hunks.slice(0, 2) },
      { ...plain("b.ts"), hunks: hunks.slice(2) },
    ];

    expect(normalizeReview(files, { maxFiles: 1, maxHunks: 4096 })).toEqual({
      ok: false,
      error: { kind: "review_too_large" },
    });
    expect(normalizeReview(withHunks, { maxFiles: 256, maxHunks: 2 })).toEqual({
      ok: false,
      error: { kind: "review_too_large" },
    });
  });

  test("exactly at the limit is accepted", () => {
    const files = [plain("a.ts"), plain("b.ts")];

    expect(normalizeReview(files, { maxFiles: 2, maxHunks: 0 })).toEqual({
      ok: true,
      value: [
        {
          fileIndex: 0,
          path: "a.ts",
          oldPath: "a.ts",
          change: "modified",
          binary: false,
          hunks: [],
        },
        {
          fileIndex: 1,
          path: "b.ts",
          oldPath: "b.ts",
          change: "modified",
          binary: false,
          hunks: [],
        },
      ],
    });
  });

  test("the default limits are 256 files and 4096 hunks", () => {
    const manyFiles = Array.from({ length: 257 }, (_, index) => plain(`f${index}.ts`));
    const manyHunks: DiffFile = {
      ...plain("big.ts"),
      hunks: Array.from({ length: 4097 }, () => hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["-a", "+b"])),
    };

    expect(normalizeReview(manyFiles)).toEqual({ ok: false, error: { kind: "review_too_large" } });
    expect(normalizeReview([manyHunks])).toEqual({
      ok: false,
      error: { kind: "review_too_large" },
    });
  });
});

describe("renderReviewDiff", () => {
  const source: DiffFile[] = [
    {
      path: "src/a.ts",
      oldPath: "src/a.ts",
      change: "modified",
      binary: false,
      hunks: [
        hunk("@@ -1,3 +1,3 @@", 1, 3, 1, 3, [
          " const a = 1;",
          "-const b = 2;",
          "+const b = 3;",
          " export {};",
        ]),
      ],
    },
    {
      path: "src/new.ts",
      oldPath: null,
      change: "added",
      binary: false,
      hunks: [
        hunk("@@ -0,0 +1,2 @@", 0, 0, 1, 2, ["+export const x = 1;", "+export const y = 2;"]),
      ],
    },
    {
      path: "src/old.ts",
      oldPath: "src/old.ts",
      change: "deleted",
      binary: false,
      hunks: [hunk("@@ -1 +0,0 @@", 1, 1, 0, 0, ["-gone"])],
    },
    {
      path: "src/r.ts",
      oldPath: "src/q.ts",
      change: "renamed",
      binary: false,
      hunks: [hunk("@@ -1 +1 @@", 1, 1, 1, 1, ["-x", "+y"])],
    },
    { path: "img/p.png", oldPath: "img/p.png", change: "modified", binary: true, hunks: [] },
    {
      path: "src/n.txt",
      oldPath: "src/n.txt",
      change: "modified",
      binary: false,
      hunks: [hunk("@@ -1,2 +1,2 @@", 1, 2, 1, 2, [" x", "-old", NO_NEWLINE, "+new"])],
    },
  ];

  test("writes the canonical text, files in path byte order", () => {
    expect(renderReviewDiff(reviewOf(source))).toBe(
      diff(
        "Binary files a/img/p.png and b/img/p.png differ",
        "--- a/src/a.ts",
        "+++ b/src/a.ts",
        "@@ -1,3 +1,3 @@",
        " const a = 1;",
        "-const b = 2;",
        "+const b = 3;",
        " export {};",
        "--- a/src/n.txt",
        "+++ b/src/n.txt",
        "@@ -1,2 +1,2 @@",
        " x",
        "-old",
        NO_NEWLINE,
        "+new",
        "--- /dev/null",
        "+++ b/src/new.ts",
        "@@ -0,0 +1,2 @@",
        "+export const x = 1;",
        "+export const y = 2;",
        "--- a/src/old.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-gone",
        "rename from src/q.ts",
        "rename to src/r.ts",
        "--- a/src/q.ts",
        "+++ b/src/r.ts",
        "@@ -1 +1 @@",
        "-x",
        "+y",
      ),
    );
  });

  test("parsing the rendered text and normalizing it gives the same review", () => {
    const review = reviewOf(source);
    const parsed = valueOf(parseUnifiedDiff(renderReviewDiff(review)));

    expect(normalizeReview(parsed)).toEqual({ ok: true, value: review });
  });
});

describe("hunkSides", () => {
  test("context lines go to both sides, removed to old, added to new", () => {
    expect(hunkSides(hunk("@@ -1,3 +1,3 @@", 1, 3, 1, 3, [" a", "-b", "+c", " d"]))).toEqual({
      oldText: "a\nb\nd\n",
      newText: "a\nc\nd\n",
    });
  });

  test("a marker after a removed line drops its newline on the old side only", () => {
    const removed = hunk("@@ -1,2 +1,2 @@", 1, 2, 1, 2, [" x", "-old", NO_NEWLINE, "+new"]);

    expect(hunkSides(removed)).toEqual({
      oldText: "x\nold",
      newText: "x\nnew\n",
    });
  });

  test("a marker after an added line drops its newline on the new side only", () => {
    expect(hunkSides(hunk("@@ -1 +1,2 @@", 1, 1, 1, 2, ["-old", "+new", NO_NEWLINE]))).toEqual({
      oldText: "old\n",
      newText: "new",
    });
  });

  test("a marker after a context line drops its newline on both sides", () => {
    expect(
      hunkSides(hunk("@@ -1,3 +1,3 @@", 1, 3, 1, 3, [" a", "-b", "+c", " z", NO_NEWLINE])),
    ).toEqual({
      oldText: "a\nb\nz",
      newText: "a\nc\nz",
    });
  });
});
