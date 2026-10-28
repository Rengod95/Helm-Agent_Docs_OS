import { expect, test } from "bun:test";
import { TITLE_FROM_INPUT_MAX, titleFromInput } from "../src/title.ts";

// G2-12: 첫 입력 80자가 대화 제목이다. 순수 함수.

test("a short text is the title as it is", () => {
  expect(titleFromInput("fix the build")).toBe("fix the build");
});

test("line breaks and runs of spaces become one space and the ends are trimmed", () => {
  expect(titleFromInput("  fix\n\nthe   build\t now \n")).toBe("fix the build now");
});

test("the title is cut at 80 characters, counting code points so an emoji is never split", () => {
  const long = "가".repeat(100);
  expect(titleFromInput(long)).toBe("가".repeat(80));
  expect(TITLE_FROM_INPUT_MAX).toBe(80);
  const emoji = `${"a".repeat(79)}😀😀😀`;
  const cut = titleFromInput(emoji);
  expect(cut).toBe(`${"a".repeat(79)}😀`);
  expect(Array.from(cut ?? "")).toHaveLength(80);
});

test("a cut that ends in a space does not leave the space in the title", () => {
  expect(titleFromInput(`${"a".repeat(79)} bbb`)).toBe("a".repeat(79));
});

test("only the text blocks of a block list count, images are skipped, and no text means no title", () => {
  expect(
    titleFromInput([
      { type: "text", text: "look at" },
      { type: "image", data: "blob:sha256:00", mimeType: "image/png" },
      { type: "text", text: "this" },
    ]),
  ).toBe("look at this");
  expect(
    titleFromInput([{ type: "image", data: "blob:sha256:00", mimeType: "image/png" }]),
  ).toBeUndefined();
  expect(titleFromInput("  \n ")).toBeUndefined();
  expect(titleFromInput("")).toBeUndefined();
});
