import { describe, expect, test } from "bun:test";
import { buildFileChange } from "../src/files/diff.ts";

// `FileChange.diff`를 만드는 `buildFileChange`의 값 비교 테스트. 출력 문자열 전체를 비교한다.

function numbered(from: number, to: number, prefix: string): string[] {
  return Array.from({ length: to - from + 1 }, (_, index) => `${prefix}${from + index}`);
}

describe("file change diff", () => {
  test("diff new file", () => {
    const change = buildFileChange({
      path: "/w/new.txt",
      relativePath: "new.txt",
      existed: false,
      before: "",
      after: "a\nb\n",
    });
    expect(change).toStrictEqual({
      path: "/w/new.txt",
      existed: false,
      diff: "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n",
      added: 2,
      removed: 0,
      firstChangedLine: 1,
    });
  });

  test("diff one-line change", () => {
    const change = buildFileChange({
      path: "/w/f.txt",
      relativePath: "f.txt",
      existed: true,
      before: "a\nb\nc\nd\ne\n",
      after: "a\nb\nC\nd\ne\n",
    });
    expect(change).toStrictEqual({
      path: "/w/f.txt",
      existed: true,
      diff: "--- a/f.txt\n+++ b/f.txt\n@@ -1,5 +1,5 @@\n a\n b\n-c\n+C\n d\n e\n",
      added: 1,
      removed: 1,
      firstChangedLine: 3,
    });
  });

  test("diff multi-hunk with merge of near hunks", () => {
    // 2행과 6행은 사이 줄이 3개라 한 덩어리로 합쳐지고, 18행은 사이 줄이 11개라 따로 나온다.
    const before = numbered(1, 20, "l")
      .map((line) => `${line}\n`)
      .join("");
    const lines = numbered(1, 20, "l");
    lines[1] = "x2";
    lines[5] = "x6";
    lines[17] = "x18";
    const after = lines.map((line) => `${line}\n`).join("");
    const change = buildFileChange({
      path: "/w/m.txt",
      relativePath: "m.txt",
      existed: true,
      before,
      after,
    });
    expect(change).toStrictEqual({
      path: "/w/m.txt",
      existed: true,
      diff: [
        "--- a/m.txt",
        "+++ b/m.txt",
        "@@ -1,9 +1,9 @@",
        " l1",
        "-l2",
        "+x2",
        " l3",
        " l4",
        " l5",
        "-l6",
        "+x6",
        " l7",
        " l8",
        " l9",
        "@@ -15,6 +15,6 @@",
        " l15",
        " l16",
        " l17",
        "-l18",
        "+x18",
        " l19",
        " l20",
        "",
      ].join("\n"),
      added: 3,
      removed: 3,
      firstChangedLine: 2,
    });
  });

  test("diff deletion at end", () => {
    const change = buildFileChange({
      path: "/w/d.txt",
      relativePath: "d.txt",
      existed: true,
      before: "a\nb\nc\n",
      after: "a\nb\n",
    });
    // 삭제만 있으면 firstChangedLine은 삭제 자리 바로 뒤 줄(새 파일 기준)이다.
    expect(change).toStrictEqual({
      path: "/w/d.txt",
      existed: true,
      diff: "--- a/d.txt\n+++ b/d.txt\n@@ -1,3 +1,2 @@\n a\n b\n-c\n",
      added: 0,
      removed: 1,
      firstChangedLine: 3,
    });
  });

  test("diff no trailing newline", () => {
    const change = buildFileChange({
      path: "/w/n.txt",
      relativePath: "n.txt",
      existed: true,
      before: "a\nb",
      after: "a\nc",
    });
    expect(change).toStrictEqual({
      path: "/w/n.txt",
      existed: true,
      diff: [
        "--- a/n.txt",
        "+++ b/n.txt",
        "@@ -1,2 +1,2 @@",
        " a",
        "-b",
        "\\ No newline at end of file",
        "+c",
        "\\ No newline at end of file",
        "",
      ].join("\n"),
      added: 1,
      removed: 1,
      firstChangedLine: 2,
    });
  });

  test("diff identical content", () => {
    const change = buildFileChange({
      path: "/w/same.txt",
      relativePath: "same.txt",
      existed: true,
      before: "x\ny\n",
      after: "x\ny\n",
    });
    expect(change).toStrictEqual({
      path: "/w/same.txt",
      existed: true,
      diff: "",
      added: 0,
      removed: 0,
    });
  });

  test("diff large file prefix and suffix trim", () => {
    // 20,000줄 파일의 한 줄만 바뀐다. 앞뒤 공통 줄을 먼저 떼므로 가운데 한 줄끼리만 비교한다.
    const before = numbered(1, 20_000, "line ")
      .map((line) => `${line}\n`)
      .join("");
    const lines = numbered(1, 20_000, "line ");
    lines[9_999] = "changed";
    const after = lines.map((line) => `${line}\n`).join("");
    const change = buildFileChange({
      path: "/w/big.txt",
      relativePath: "big.txt",
      existed: true,
      before,
      after,
    });
    expect(change).toStrictEqual({
      path: "/w/big.txt",
      existed: true,
      diff: [
        "--- a/big.txt",
        "+++ b/big.txt",
        "@@ -9997,7 +9997,7 @@",
        " line 9997",
        " line 9998",
        " line 9999",
        "-line 10000",
        "+changed",
        " line 10001",
        " line 10002",
        " line 10003",
        "",
      ].join("\n"),
      added: 1,
      removed: 1,
      firstChangedLine: 10_000,
    });
  });

  test("diff fallback block", () => {
    // 가운데 구간은 2,002줄씩이라 칸 수가 4,000,000을 넘는다. LCS를 만들지 않고 삭제 한 덩어리와 추가 한 덩어리로 낸다.
    // "keep" 줄은 양쪽에 있지만 LCS였다면 문맥으로 남았을 것이다.
    const oldMiddle = [...numbered(0, 999, "o"), "keep", ...numbered(1000, 2000, "o")];
    const newMiddle = [...numbered(0, 999, "n"), "keep", ...numbered(1000, 2000, "n")];
    const before = ["head", ...oldMiddle, "tail"].map((line) => `${line}\n`).join("");
    const after = ["head", ...newMiddle, "tail"].map((line) => `${line}\n`).join("");
    const change = buildFileChange({
      path: "/w/f.txt",
      relativePath: "f.txt",
      existed: true,
      before,
      after,
    });
    expect(change).toStrictEqual({
      path: "/w/f.txt",
      existed: true,
      diff: [
        "--- a/f.txt",
        "+++ b/f.txt",
        "@@ -1,2004 +1,2004 @@",
        " head",
        ...oldMiddle.map((line) => `-${line}`),
        ...newMiddle.map((line) => `+${line}`),
        " tail",
        "",
      ].join("\n"),
      added: 2002,
      removed: 2002,
      firstChangedLine: 2,
    });
  });
});
