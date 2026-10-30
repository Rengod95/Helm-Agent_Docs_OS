import { describe, expect, test } from "bun:test";
import type { Result } from "@xeon/contracts";
import {
  applyEdits,
  detectLineEnding,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
  type AppliedEdits,
  type Edit,
  type EditFailure,
} from "../src/files/upstream/edit-diff.ts";

// L2.workspace.spec §4.4 E1~E17. 테스트 이름은 spec 표와 문자 그대로 같다.
// 결과는 `Result` 전체를 값으로 비교한다. 쓰기 전 처리(BOM, CRLF)는 호출한 쪽의 일이라 테스트에서 직접 거친다.

const FUZZY = { fuzzy: true } as const;

describe("edit", () => {
  test("edit restores CRLF line endings", () => {
    const original = "a\r\nb\r\n";
    const ending = detectLineEnding(original);
    const result: Result<AppliedEdits, EditFailure> = applyEdits(
      normalizeToLF(original),
      [{ oldText: "b\n", newText: "c\n" }],
      FUZZY,
    );
    expect(ending).toBe("\r\n");
    expect(result).toStrictEqual({
      ok: true,
      value: { baseContent: "a\nb\n", newContent: "a\nc\n", matchMode: "exact" },
    });
    const written = result.ok ? restoreLineEndings(result.value.newContent, ending) : undefined;
    expect(written).toBe("a\r\nc\r\n");
  });

  test("edit preserves BOM", () => {
    const original = "\uFEFFa\nb\n";
    const { bom, text } = stripBom(original);
    expect({ bom, text }).toStrictEqual({ bom: "\uFEFF", text: "a\nb\n" });
    const result = applyEdits(text, [{ oldText: "a\n", newText: "x\n" }], FUZZY);
    expect(result).toStrictEqual({
      ok: true,
      value: { baseContent: "a\nb\n", newContent: "x\nb\n", matchMode: "exact" },
    });
    const written = result.ok ? bom + result.value.newContent : undefined;
    expect(written).toBe("\uFEFFx\nb\n");
  });

  test("edit prefers exact match", () => {
    // 정확 일치는 "now" 한 곳뿐이다. 퍼지 공간으로 바꾸면 줄의 곡선 따옴표가 곧은 따옴표로 바뀐다.
    const result = applyEdits("say “hi” now\n", [{ oldText: "now", newText: "later" }], FUZZY);
    expect(result).toStrictEqual({
      ok: true,
      value: { baseContent: "say “hi” now\n", newContent: "say “hi” later\n", matchMode: "exact" },
    });
  });

  test("edit fuzzy matches NFKC equivalents", () => {
    // 전각 A(U+FF21)는 NFKC로 A가 된다. 정확 일치는 실패한다.
    const result = applyEdits(
      "value = Ａbc\n",
      [{ oldText: "value = Abc\n", newText: "value = Xyz\n" }],
      FUZZY,
    );
    expect(result).toStrictEqual({
      ok: true,
      value: { baseContent: "value = Ａbc\n", newContent: "value = Xyz\n", matchMode: "fuzzy" },
    });
  });

  test("edit fuzzy ignores trailing whitespace", () => {
    const result = applyEdits(
      "alpha   \nbeta\n",
      [{ oldText: "alpha\nbeta\n", newText: "gamma\nbeta\n" }],
      FUZZY,
    );
    expect(result).toStrictEqual({
      ok: true,
      value: { baseContent: "alpha   \nbeta\n", newContent: "gamma\nbeta\n", matchMode: "fuzzy" },
    });
  });

  test("edit fuzzy normalizes smart quotes", () => {
    const result = applyEdits(
      "say ‘hi’ and “bye”\n",
      [{ oldText: `say 'hi' and "bye"\n`, newText: `say 'yo' and "bye"\n` }],
      FUZZY,
    );
    expect(result).toStrictEqual({
      ok: true,
      value: {
        baseContent: "say ‘hi’ and “bye”\n",
        newContent: `say 'yo' and "bye"\n`,
        matchMode: "fuzzy",
      },
    });
  });

  test("edit fuzzy normalizes dashes", () => {
    // U+2013 en-dash, U+2014 em-dash
    const result = applyEdits(
      "range 1–5 — total\n",
      [{ oldText: "range 1-5 - total\n", newText: "range 1-9 - total\n" }],
      FUZZY,
    );
    expect(result).toStrictEqual({
      ok: true,
      value: {
        baseContent: "range 1–5 — total\n",
        newContent: "range 1-9 - total\n",
        matchMode: "fuzzy",
      },
    });
  });

  test("edit fuzzy normalizes special spaces", () => {
    // U+00A0 NBSP, U+3000 ideographic space, U+2009 thin space
    const result = applyEdits(
      "a\u00A0b\u3000c\u2009d\n",
      [{ oldText: "a b c d\n", newText: "a b c e\n" }],
      FUZZY,
    );
    expect(result).toStrictEqual({
      ok: true,
      value: {
        baseContent: "a\u00A0b\u3000c\u2009d\n",
        newContent: "a b c e\n",
        matchMode: "fuzzy",
      },
    });
  });

  test("edit switches all edits to fuzzy space", () => {
    // 첫 편집은 줄 끝 공백 때문에 퍼지로 찾는다. 둘째 편집은 정확히 찾지만 같은 공간에서 바뀌어 곧은 따옴표가 된다.
    const edits: Edit[] = [
      { oldText: "one\n", newText: "1\n" },
      { oldText: "now\n", newText: "later\n" },
    ];
    const result = applyEdits("one  \nsay “hi” now\n", edits, FUZZY);
    expect(result).toStrictEqual({
      ok: true,
      value: {
        baseContent: "one  \nsay “hi” now\n",
        newContent: `1\nsay "hi" later\n`,
        matchMode: "fuzzy",
      },
    });
  });

  test("edit fuzzy preserves untouched lines", () => {
    // 바뀌지 않은 줄의 곡선 따옴표는 원문 그대로 남는다.
    const result = applyEdits(
      "keep “q”\nold  \nkeep “r”\n",
      [{ oldText: "old\n", newText: "new\n" }],
      FUZZY,
    );
    expect(result).toStrictEqual({
      ok: true,
      value: {
        baseContent: "keep “q”\nold  \nkeep “r”\n",
        newContent: "keep “q”\nnew\nkeep “r”\n",
        matchMode: "fuzzy",
      },
    });
  });

  test("edit matches every edit against original", () => {
    // 둘째 편집의 "b\n"은 원본에서 한 번뿐이다. 앞 편집 결과(b가 두 번)에 이어 찾으면 중복으로 실패한다.
    const edits: Edit[] = [
      { oldText: "a\n", newText: "b\n" },
      { oldText: "b\n", newText: "x\n" },
    ];
    const result = applyEdits("a\nb\nc\n", edits, FUZZY);
    expect(result).toStrictEqual({
      ok: true,
      value: { baseContent: "a\nb\nc\n", newContent: "b\nx\nc\n", matchMode: "exact" },
    });
  });

  test("edit rejects empty oldText", () => {
    const single = applyEdits("a\n", [{ oldText: "", newText: "x\n" }], FUZZY);
    expect(single).toStrictEqual({
      ok: false,
      error: {
        kind: "empty_old_text",
        message: "oldText must not be empty.",
        editIndex: 0,
        totalEdits: 1,
      },
    });
    const second = applyEdits(
      "a\n",
      [
        { oldText: "a\n", newText: "b\n" },
        { oldText: "", newText: "x" },
      ],
      FUZZY,
    );
    expect(second).toStrictEqual({
      ok: false,
      error: {
        kind: "empty_old_text",
        message: "edits[1].oldText must not be empty.",
        editIndex: 1,
        totalEdits: 2,
      },
    });
  });

  test("edit rejects missing oldText", () => {
    const single = applyEdits("a\n", [{ oldText: "zzz\n", newText: "x\n" }], FUZZY);
    expect(single).toStrictEqual({
      ok: false,
      error: {
        kind: "not_found",
        message:
          "Could not find the exact text. The old text must match exactly including all whitespace and newlines.",
        editIndex: 0,
        totalEdits: 1,
      },
    });
    const second = applyEdits(
      "a\n",
      [
        { oldText: "a\n", newText: "b\n" },
        { oldText: "zzz\n", newText: "x\n" },
      ],
      FUZZY,
    );
    expect(second).toStrictEqual({
      ok: false,
      error: {
        kind: "not_found",
        message:
          "Could not find edits[1]. The oldText must match exactly including all whitespace and newlines.",
        editIndex: 1,
        totalEdits: 2,
      },
    });
  });

  test("edit rejects ambiguous oldText", () => {
    const result = applyEdits("x\nx\n", [{ oldText: "x\n", newText: "y\n" }], FUZZY);
    expect(result).toStrictEqual({
      ok: false,
      error: {
        kind: "ambiguous",
        message:
          "Found 2 occurrences of the text. The text must be unique. Please provide more context to make it unique.",
        editIndex: 0,
        totalEdits: 1,
        occurrences: 2,
      },
    });
  });

  test("edit rejects overlapping edits", () => {
    const edits: Edit[] = [
      { oldText: "abc", newText: "X" },
      { oldText: "cde", newText: "Y" },
    ];
    const result = applyEdits("abcdef\n", edits, FUZZY);
    expect(result).toStrictEqual({
      ok: false,
      error: {
        kind: "overlap",
        message:
          "edits[0] and edits[1] overlap. Merge them into one edit or target disjoint regions.",
        editIndex: 0,
        totalEdits: 2,
      },
    });
  });

  test("edit rejects no-op edits", () => {
    const result = applyEdits("a\n", [{ oldText: "a\n", newText: "a\n" }], FUZZY);
    expect(result).toStrictEqual({
      ok: false,
      error: {
        kind: "no_change",
        message:
          "No changes made. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.",
        editIndex: 0,
        totalEdits: 1,
      },
    });
  });

  test("edit fuzzy can be disabled", () => {
    const edits: Edit[] = [{ oldText: "old\n", newText: "new\n" }];
    // 줄 끝 공백만 다르므로 퍼지가 켜져 있으면 찾는다.
    expect(applyEdits("old  \n", edits, { fuzzy: true })).toStrictEqual({
      ok: true,
      value: { baseContent: "old  \n", newContent: "new\n", matchMode: "fuzzy" },
    });
    // 끄면 정확 일치 실패이고 detail에 fuzzyDisabled가 붙는다.
    expect(applyEdits("old  \n", edits, { fuzzy: false })).toStrictEqual({
      ok: false,
      error: {
        kind: "not_found",
        message:
          "Could not find the exact text. The old text must match exactly including all whitespace and newlines.",
        editIndex: 0,
        totalEdits: 1,
        fuzzyDisabled: true,
      },
    });
    // 정확 일치는 끈 상태에서도 된다.
    expect(
      applyEdits("say “hi”\n", [{ oldText: "say", newText: "hey" }], { fuzzy: false }),
    ).toStrictEqual({
      ok: true,
      value: { baseContent: "say “hi”\n", newContent: "hey “hi”\n", matchMode: "exact" },
    });
  });
});
