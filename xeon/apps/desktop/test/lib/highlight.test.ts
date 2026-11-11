import { describe, expect, test } from "bun:test";
import { HIGHLIGHT_THEME, highlightCode } from "../../src/lib/highlight.ts";

const PLAIN_STYLE = { italic: false, bold: false, underline: false };
// 문법을 처음 불러올 때 시간이 걸린다. 기기가 바쁠 때 bun 기본 5초를 넘기지 않도록 시간을 늘린다.
const GRAMMAR_TIMEOUT = 30_000;

describe("highlightCode", () => {
  test("테마 이름은 fresnel-syntax다", () => {
    expect(HIGHLIGHT_THEME).toBe("fresnel-syntax");
  });

  test("모르는 언어는 줄마다 평문 한 토큰이다", async () => {
    expect(await highlightCode("a\nb", "cobol")).toEqual([
      [{ text: "a", color: undefined, fontStyle: PLAIN_STYLE }],
      [{ text: "b", color: undefined, fontStyle: PLAIN_STYLE }],
    ]);
  });

  test("모르는 언어의 빈 줄은 빈 토큰 배열이다", async () => {
    expect(await highlightCode("", "cobol")).toEqual([[]]);
  });

  test(
    "ts 한 줄은 여러 토큰으로 나뉘고 각 색은 CSS 변수다",
    async () => {
      const lines = await highlightCode("const x = 1;\nlet y = 'a';\n", "ts");
      const first = lines[0] ?? [];
      expect(first.length).toBeGreaterThan(1);
      for (const token of first) {
        expect(token.color?.startsWith("var(")).toBe(true);
      }
      expect(first[0]).toEqual({
        text: "const",
        color: "var(--cs-syntax-token-keyword)",
        fontStyle: PLAIN_STYLE,
      });
    },
    GRAMMAR_TIMEOUT,
  );

  test(
    "줄 수는 입력의 줄 수와 같다",
    async () => {
      const code = "const x = 1;\nlet y = 'a';\n";
      const lines = await highlightCode(code, "ts");
      expect(lines.length).toBe(code.split("\n").length);
      expect(lines.length).toBe(3);
      expect((await highlightCode("a\nb", "ts")).length).toBe(2);
    },
    GRAMMAR_TIMEOUT,
  );

  test(
    "언어 이름은 대소문자와 앞뒤 공백을 무시한다",
    async () => {
      expect(await highlightCode("let y = 1;", " TS ")).toEqual(
        await highlightCode("let y = 1;", "ts"),
      );
    },
    GRAMMAR_TIMEOUT,
  );

  test(
    "bash는 셸 문법으로 함수 이름 색을 낸다",
    async () => {
      const lines = await highlightCode("ls -la", "bash");
      expect(lines[0]?.[0]).toEqual({
        text: "ls",
        color: "var(--cs-syntax-token-function)",
        fontStyle: PLAIN_STYLE,
      });
    },
    GRAMMAR_TIMEOUT,
  );

  test(
    "json 토큰도 모두 CSS 변수 색이다",
    async () => {
      const lines = await highlightCode('{"a": 1}', "json");
      const tokens = lines[0] ?? [];
      expect(tokens.length).toBeGreaterThan(1);
      for (const token of tokens) {
        expect(token.color?.startsWith("var(")).toBe(true);
      }
    },
    GRAMMAR_TIMEOUT,
  );
});
