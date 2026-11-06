import { describe, expect, test } from "bun:test";
import {
  closesFence,
  openFenceAfter,
  parseInline,
  parseMarkdown,
} from "../../src/views/markdown-blocks.ts";

describe("inline tokens", () => {
  test("bold, italic and inline code become tokens and the rest stays text", () => {
    expect(parseInline("a **굵게** b *기울임* c `x *y*` d")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", text: "굵게" },
      { type: "text", text: " b " },
      { type: "em", text: "기울임" },
      { type: "text", text: " c " },
      { type: "code", text: "x *y*" },
      { type: "text", text: " d" },
    ]);
  });

  test("underscore emphasis works, but an underscore inside a word is text", () => {
    expect(parseInline("_기울임_")).toEqual([{ type: "em", text: "기울임" }]);
    expect(parseInline("snake_case_name")).toEqual([{ type: "text", text: "snake_case_name" }]);
  });

  test("an unclosed ** stays literal, and so do an unclosed * and an unclosed backtick", () => {
    expect(parseInline("a **b")).toEqual([{ type: "text", text: "a **b" }]);
    expect(parseInline("*x")).toEqual([{ type: "text", text: "*x" }]);
    expect(parseInline("a `b")).toEqual([{ type: "text", text: "a `b" }]);
  });

  test("a run of two or more backticks is text, not a code span", () => {
    expect(parseInline("```x```")).toEqual([{ type: "text", text: "```x```" }]);
  });

  test("a link becomes its label as text, and no token carries the address", () => {
    expect(parseInline("[문서](https://example.test/a)")).toEqual([{ type: "text", text: "문서" }]);
    expect(parseInline("앞 [문서](https://example.test/a) 뒤")).toEqual([
      { type: "text", text: "앞 문서 뒤" },
    ]);
  });

  test("raw html is text, never a token", () => {
    expect(parseInline("<script>alert(1)</script> <b>x</b>")).toEqual([
      { type: "text", text: "<script>alert(1)</script> <b>x</b>" },
    ]);
  });

  test("a long run of unmatched openers finishes and stays literal", () => {
    const text = "*a ".repeat(30000).trimEnd();
    expect(parseInline(text)).toEqual([{ type: "text", text }]);
    const brackets = `${"[".repeat(30000)}]`;
    expect(parseInline(brackets)).toEqual([{ type: "text", text: brackets }]);
  });
});

describe("blocks", () => {
  test("ATX headings keep their level and drop the closing hashes", () => {
    expect(parseMarkdown("# 제목\n### 소제목 ##")).toEqual([
      { type: "heading", level: 1, inlines: [{ type: "text", text: "제목" }] },
      { type: "heading", level: 3, inlines: [{ type: "text", text: "소제목" }] },
    ]);
  });

  test("a hash without a space is a paragraph, and seven hashes are not a heading", () => {
    expect(parseMarkdown("#tag")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "#tag" }] },
    ]);
    expect(parseMarkdown("#######")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "#######" }] },
    ]);
  });

  test("consecutive lines form one paragraph with their line breaks kept, and a blank line ends it", () => {
    expect(parseMarkdown("첫 줄\n둘째 줄\n\n새 문단")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "첫 줄\n둘째 줄" }] },
      { type: "paragraph", inlines: [{ type: "text", text: "새 문단" }] },
    ]);
  });

  test("bullet markers -, * and + make one bullet list", () => {
    expect(parseMarkdown("- 하나\n* 둘\n+ 셋")).toEqual([
      {
        type: "bullets",
        items: [
          [{ type: "text", text: "하나" }],
          [{ type: "text", text: "둘" }],
          [{ type: "text", text: "셋" }],
        ],
      },
    ]);
  });

  test("a numbered list keeps its first number as the start", () => {
    expect(parseMarkdown("3. 셋\n4) 넷")).toEqual([
      {
        type: "numbered",
        start: 3,
        items: [[{ type: "text", text: "셋" }], [{ type: "text", text: "넷" }]],
      },
    ]);
  });

  test("a numbered list that continues after a blank line is still one list", () => {
    expect(parseMarkdown("1. 가\n\n2. 나")).toEqual([
      {
        type: "numbered",
        start: 1,
        items: [[{ type: "text", text: "가" }], [{ type: "text", text: "나" }]],
      },
    ]);
  });

  test("an indented line after an item continues that item", () => {
    expect(parseMarkdown("1. 가\n   이어서")).toEqual([
      { type: "numbered", start: 1, items: [[{ type: "text", text: "가\n이어서" }]] },
    ]);
  });

  test("a bullet after a numbered item starts a new list of its own kind", () => {
    expect(parseMarkdown("1. 가\n- 나")).toEqual([
      { type: "numbered", start: 1, items: [[{ type: "text", text: "가" }]] },
      { type: "bullets", items: [[{ type: "text", text: "나" }]] },
    ]);
  });

  test("a fenced code block is code with no inline reading, and the text after it is a paragraph", () => {
    expect(parseMarkdown("```ts\nconst x = **1**;\n```\n뒤")).toEqual([
      { type: "code", text: "const x = **1**;" },
      { type: "paragraph", inlines: [{ type: "text", text: "뒤" }] },
    ]);
  });

  test("a fence closes only with a fence of the same character and at least the same length", () => {
    expect(parseMarkdown("~~~~\n```\n**그대로**\n~~~~")).toEqual([
      { type: "code", text: "```\n**그대로**" },
    ]);
  });

  test("an unclosed fence is code until the end of the text", () => {
    expect(parseMarkdown("```\n**열림**\n더")).toEqual([{ type: "code", text: "**열림**\n더" }]);
  });

  test("a line of three or more dashes is a rule, and it ends a paragraph", () => {
    expect(parseMarkdown("---")).toEqual([{ type: "rule" }]);
    expect(parseMarkdown("a\n---")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "a" }] },
      { type: "rule" },
    ]);
  });

  test("a blockquote marker is not interpreted and stays literal", () => {
    expect(parseMarkdown("> 인용")).toEqual([
      { type: "paragraph", inlines: [{ type: "text", text: "> 인용" }] },
    ]);
  });

  test("CRLF line endings parse like LF", () => {
    expect(parseMarkdown("# a\r\n\r\nb")).toEqual([
      { type: "heading", level: 1, inlines: [{ type: "text", text: "a" }] },
      { type: "paragraph", inlines: [{ type: "text", text: "b" }] },
    ]);
  });

  test("an empty text has no blocks", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("\n\n  \n")).toEqual([]);
  });
});

describe("fence lines", () => {
  test("an open fence is reported with its marker until a closing line", () => {
    expect(openFenceAfter(["a", "```ts", "x"])).toBe("```");
    expect(openFenceAfter(["```", "x", "```"])).toBeNull();
    expect(closesFence("```", "```")).toBe(true);
    expect(closesFence("````", "```")).toBe(true);
    expect(closesFence("``` ts", "```")).toBe(false);
  });
});
