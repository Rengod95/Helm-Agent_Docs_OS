import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "../../src/lib/markdown.tsx";
import {
  closeOpenFence,
  closeStreamingMarkdown,
  renderStreamingMarkdown,
} from "../../src/lib/markdown-stream.ts";

// 입력 → 출력을 정확히 비교한다. 완성된 문서는 그대로여야 하고, 미완성 조각만 닫히거나 보류된다.
describe("closeStreamingMarkdown", () => {
  test("빈 문자열은 빈 문자열이다", () => {
    expect(closeStreamingMarkdown("")).toBe("");
  });

  describe("코드 울타리", () => {
    test("닫히지 않은 울타리를 같은 글자와 길이로 닫는다", () => {
      expect(closeStreamingMarkdown("```ts\nconst a = 1;\n")).toBe("```ts\nconst a = 1;\n```");
    });

    test("마지막 줄이 끝나지 않았어도 줄바꿈을 넣고 닫는다", () => {
      expect(closeStreamingMarkdown("```ts\nconst a = 1;")).toBe("```ts\nconst a = 1;\n```");
    });

    test("물결 울타리도 닫는다", () => {
      expect(closeStreamingMarkdown("~~~\nx")).toBe("~~~\nx\n~~~");
    });

    test("울타리가 열린 줄만 있어도 빈 코드 블록으로 닫는다", () => {
      expect(closeStreamingMarkdown("text\n```")).toBe("text\n```\n```");
    });

    test("울타리 안의 표 줄은 표로 보류하지 않고 그대로 둔다", () => {
      expect(closeStreamingMarkdown("```\n| a | b |\n")).toBe("```\n| a | b |\n```");
      expect(closeStreamingMarkdown("```md\n| a | b |\n|---")).toBe("```md\n| a | b |\n|---\n```");
    });

    test("울타리 안의 강조는 닫지 않는다", () => {
      expect(closeStreamingMarkdown("```\n**x")).toBe("```\n**x\n```");
    });

    test("닫는 울타리는 여는 울타리보다 길어야 하므로, 더 긴 울타리로 열면 그 길이로 닫는다", () => {
      expect(closeStreamingMarkdown("````md\n```\ninner\n```")).toBe(
        "````md\n```\ninner\n```\n````",
      );
    });

    test("닫힌 울타리 블록은 불변이다", () => {
      expect(closeStreamingMarkdown("```ts\n```\n")).toBe("```ts\n```\n");
      expect(closeStreamingMarkdown("```js\n```")).toBe("```js\n```");
    });
  });

  describe("표", () => {
    test("완전한 표는 그대로 둔다", () => {
      const full = "| 이름 | 값 |\n|---|---|\n| 가 | 1 |\n";
      expect(closeStreamingMarkdown(full)).toBe(full);
      expect(closeStreamingMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")).toBe(
        "| a | b |\n|---|---|\n| 1 | 2 |",
      );
    });

    test("마지막 행이 잘린 표는 그 행을 보류한다", () => {
      expect(closeStreamingMarkdown("| a | b |\n|---|---|\n| 1 | 2")).toBe(
        "| a | b |\n|---|---|\n",
      );
    });

    test("구분선이 잘린 표는 구분선 줄을 보류한다", () => {
      expect(closeStreamingMarkdown("| a | b |\n|---")).toBe("| a | b |\n");
    });

    test("헤더 한 줄만 있으면 표가 아니므로 그대로 둔다", () => {
      expect(closeStreamingMarkdown("| a | b |")).toBe("| a | b |");
    });

    test("잘린 헤더 줄만 있으면 보류해서 빈 문자열이다", () => {
      expect(closeStreamingMarkdown("| a | b")).toBe("");
    });
  });

  describe("인라인 표식", () => {
    test("열린 강조 ** 를 닫는다", () => {
      expect(closeStreamingMarkdown("**bold")).toBe("**bold**");
      expect(closeStreamingMarkdown("**굵고 `코드")).toBe("**굵고 `코드`**");
    });

    test("열린 기울임 * 와 _ 를 닫는다", () => {
      expect(closeStreamingMarkdown("*it")).toBe("*it*");
      expect(closeStreamingMarkdown("_x")).toBe("_x_");
      expect(closeStreamingMarkdown("# 제목 *강조")).toBe("# 제목 *강조*");
    });

    test("열린 인라인 코드 백틱을 닫는다", () => {
      expect(closeStreamingMarkdown("a `code")).toBe("a `code`");
    });

    test("끝에 남은 여는 백틱은 지운다", () => {
      expect(closeStreamingMarkdown("a `b` `")).toBe("a `b` ");
      expect(closeStreamingMarkdown("`")).toBe("");
    });

    test("열린 링크의 주소는 떼고 글만 남긴다", () => {
      expect(closeStreamingMarkdown("[링크](https://exa")).toBe("링크");
    });

    test("닫힌 링크는 그대로 둔다", () => {
      expect(closeStreamingMarkdown("[글](https://example.com)")).toBe("[글](https://example.com)");
    });

    test("단어 가운데의 * 와 _ 는 강조로 세지 않는다", () => {
      expect(closeStreamingMarkdown("2*3 * 4 and snake_case_name")).toBe(
        "2*3 * 4 and snake_case_name",
      );
    });
  });

  test("닫힌 문서는 불변이다", () => {
    const closed = "# 제목\n\n**굵게**와 `코드`와 _기울임_\n\n- 항목 하나\n- 항목 둘\n";
    expect(closeStreamingMarkdown(closed)).toBe(closed);
  });
});

describe("renderStreamingMarkdown", () => {
  test("보정한 뒤 렌더한다(renderMarkdown과 closeStreamingMarkdown의 합성과 같다)", () => {
    const source = "**굵게";
    expect(renderToStaticMarkup(renderStreamingMarkdown(source))).toBe(
      "<p><strong>굵게</strong></p>",
    );
    expect(renderToStaticMarkup(renderStreamingMarkdown(source))).toBe(
      renderToStaticMarkup(renderMarkdown(closeStreamingMarkdown(source))),
    );
  });

  test("잘린 표 행은 렌더에 나타나지 않는다", () => {
    expect(renderToStaticMarkup(renderStreamingMarkdown("| a | b |\n|---|---|\n| 1 | 2"))).toBe(
      "<table><thead><tr><th>a</th><th>b</th></tr></thead></table>",
    );
  });
});

describe("closeOpenFence", () => {
  test("a finished text cut inside a fence gets the same fence closed after it", () => {
    expect(closeOpenFence("보세요.\n\n```py\nprint(1)\n# 같")).toEqual({
      text: "보세요.\n\n```py\nprint(1)\n# 같\n```",
      cut: true,
    });
  });
  test("a text ending with a newline inside a tilde fence closes without an extra blank line", () => {
    expect(closeOpenFence("~~~~\nx\n")).toEqual({ text: "~~~~\nx\n~~~~", cut: true });
  });
  test("a text whose fences are all closed comes back as is", () => {
    const text = "```\na\n```\n\n끝";
    expect(closeOpenFence(text)).toEqual({ text, cut: false });
  });
  test("plain text is not touched", () => {
    expect(closeOpenFence("그냥 글")).toEqual({ text: "그냥 글", cut: false });
  });
});
