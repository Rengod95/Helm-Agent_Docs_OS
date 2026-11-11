import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMarkdown } from "../../src/lib/markdown.tsx";

// 서버 렌더(정적 마크업)로 출력을 값으로 비교한다. 원시 HTML과 위험 스킴 링크는 나오면 안 된다.
const html = (source: string): string => renderToStaticMarkup(renderMarkdown(source));

describe("renderMarkdown", () => {
  test("표(GFM)는 table로 그린다", () => {
    expect(html("| 이름 | 값 |\n|---|---|\n| 가 | 1 |")).toBe(
      "<table><thead><tr><th>이름</th><th>값</th></tr></thead><tbody><tr><td>가</td><td>1</td></tr></tbody></table>",
    );
  });

  test("체크 목록(GFM)은 disabled 체크박스로 그린다", () => {
    expect(html("- [x] 완료\n- [ ] 남음")).toBe(
      '<ul class="contains-task-list">\n<li class="task-list-item"><input type="checkbox" disabled="" checked=""/> 완료</li>\n<li class="task-list-item"><input type="checkbox" disabled=""/> 남음</li>\n</ul>',
    );
  });

  test("원시 HTML의 script는 출력에 없다", () => {
    const out = html("<script>alert(1)</script>\n\n<b>x</b> 본문");
    expect(out).toBe("\n<p>x 본문</p>");
    expect(out).not.toContain("script");
    expect(out).not.toContain("alert");
  });

  test("javascript: 링크는 href로 나오지 않는다", () => {
    expect(html("[나쁨](javascript:alert(1))")).toBe('<p><a href="">나쁨</a></p>');
  });

  test("https 링크는 그대로 href가 된다", () => {
    expect(html("[글](https://example.com/a)")).toBe(
      '<p><a href="https://example.com/a">글</a></p>',
    );
  });

  test("코드 블록은 language 클래스만 남기고 색 span이나 style을 만들지 않는다", () => {
    const out = html("```ts\nconst a = 1;\n```");
    expect(out).toBe('<pre><code class="language-ts">const a = 1;\n</code></pre>');
    expect(out).not.toContain("style=");
  });

  test("components 옵션의 code 렌더러를 쓴다", () => {
    const out = renderToStaticMarkup(
      renderMarkdown("`a`", { components: { code: (props) => <kbd>{props.children}</kbd> } }),
    );
    expect(out).toBe("<p><kbd>a</kbd></p>");
  });
});
