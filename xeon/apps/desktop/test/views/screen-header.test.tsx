import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import { ScreenHeader } from "../../src/views/shell/screen-header.tsx";

// 머리 자체의 표지만 본다. 바로 뒤 내용의 위 간격은 styles-css 시험이 CSS 규칙으로 지킨다.

function headerHtml(flush: boolean): string {
  return renderToString(
    <ShellStoreContext value={createShellStore(1400)}>
      <ScreenHeader title="대화" flush={flush} />
    </ShellStoreContext>,
  );
}

describe("ScreenHeader: 바로 뒤 내용의 공용 간격 표지", () => {
  test("a header leaves the shared gap to the content after it by default", () => {
    const html = headerHtml(false);
    expect(html).toMatch(/<header class="shell-header /);
    expect(html).not.toContain("data-flush");
  });

  test("a flush header is marked so the content after it keeps its own top space", () => {
    expect(headerHtml(true)).toMatch(/<header class="shell-header [^"]*" data-flush=""/);
  });
});
