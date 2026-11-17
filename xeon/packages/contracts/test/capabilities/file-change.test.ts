import { describe, expect, test } from "bun:test";
import { parse } from "../../src/base/index.ts";
import {
  FILE_CHANGES_KEY,
  FileChangeEntrySchema,
  fileChangesOf,
} from "../../src/capabilities/index.ts";

const HASH = "f".repeat(64);

// 타입 주석을 달지 않는다: 주석이 있으면 선택 속성이 JSON 값 검사에서 걸린다. 모든 속성이 값을 가진 리터럴이다.
const edited = {
  path: "src/a.ts",
  op: "modify",
  existed: true,
  diff: "@@ -1 +1 @@\n-old\n+new\n",
  added: 1,
  removed: 1,
  firstChangedLine: 1,
  before: { sha256: HASH, size: 3 },
  after: { sha256: HASH, size: 3 },
  source: "observed",
};
const renamed = {
  path: "src/b.ts",
  op: "rename",
  from: "src/old.ts",
  existed: true,
  added: 0,
  removed: 0,
  source: "reported",
};

describe("file change entries", () => {
  test("the reserved key is fileChanges", () => {
    expect(FILE_CHANGES_KEY).toBe("fileChanges");
  });

  test("the entry schema accepts a full entry and a rename", () => {
    expect(parse(FileChangeEntrySchema, edited).ok).toBe(true);
    expect(parse(FileChangeEntrySchema, renamed).ok).toBe(true);
  });

  test("the entry schema refuses an unknown key and an op outside the four", () => {
    expect(parse(FileChangeEntrySchema, { ...edited, extra: 1 }).ok).toBe(false);
    expect(parse(FileChangeEntrySchema, { ...edited, op: "copy" }).ok).toBe(false);
    expect(parse(FileChangeEntrySchema, { ...edited, source: "guessed" }).ok).toBe(false);
  });

  test("the new form reads the fileChanges list and keeps the tool's own details", () => {
    const details = { output: "saved", [FILE_CHANGES_KEY]: [edited, renamed] };
    expect(JSON.stringify(fileChangesOf(details))).toBe(JSON.stringify([edited, renamed]));
  });

  test("the old single FileChange reads as one observed entry, modify when the file existed", () => {
    const details = {
      path: "README.md",
      existed: true,
      diff: "--- a/README.md\n+++ b/README.md\n",
      added: 2,
      removed: 1,
    };
    expect(fileChangesOf(details)).toEqual([
      {
        path: "README.md",
        op: "modify",
        existed: true,
        diff: "--- a/README.md\n+++ b/README.md\n",
        added: 2,
        removed: 1,
        source: "observed",
      },
    ]);
  });

  test("the old FileChange that created a file reads as create and keeps the first changed line", () => {
    const details = {
      path: "new.txt",
      existed: false,
      diff: "",
      added: 3,
      removed: 0,
      firstChangedLine: 1,
    };
    expect(fileChangesOf(details)).toEqual([
      {
        path: "new.txt",
        op: "create",
        existed: false,
        diff: "",
        added: 3,
        removed: 0,
        firstChangedLine: 1,
        source: "observed",
      },
    ]);
  });

  test("null, scalars, arrays and objects without a change read as no entries", () => {
    expect(fileChangesOf(null)).toEqual([]);
    expect(fileChangesOf("text")).toEqual([]);
    expect(fileChangesOf(3)).toEqual([]);
    expect(fileChangesOf(true)).toEqual([]);
    expect(fileChangesOf([1, 2])).toEqual([]);
    expect(fileChangesOf({})).toEqual([]);
  });

  test("a broken fileChanges list reads as no entries, and never falls back to the old form", () => {
    expect(fileChangesOf({ [FILE_CHANGES_KEY]: "nope" })).toEqual([]);
    expect(fileChangesOf({ [FILE_CHANGES_KEY]: [{ path: "x" }] })).toEqual([]);
    const oldWithKey = {
      path: "a.ts",
      existed: true,
      diff: "",
      added: 0,
      removed: 0,
      [FILE_CHANGES_KEY]: [{ path: "x" }],
    };
    expect(fileChangesOf(oldWithKey)).toEqual([]);
  });
});
