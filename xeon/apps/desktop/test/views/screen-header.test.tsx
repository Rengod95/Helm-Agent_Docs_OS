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

function withControls(titleFixed: boolean): string {
  return renderToString(
    <ShellStoreContext value={createShellStore(1400)}>
      <ScreenHeader title="메트릭" titleFixed={titleFixed} controls={<span>필터</span>} />
    </ShellStoreContext>,
  );
}

describe("ScreenHeader: 좁은 창에서 줄어드는 쪽 (rerun3 T-05)", () => {
  test("by default the title takes the spare width and shrinks, and the controls keep their width", () => {
    const html = withControls(false);
    expect(html).toContain('<div class="flex min-w-0 flex-1 items-center gap-2.5">');
    expect(html).toContain(
      '<div class="flex min-w-0 flex-none items-center gap-2"><span>필터</span>',
    );
  });

  test("a fixed title keeps its own width and the controls shrink, pushed to the right", () => {
    const html = withControls(true);
    expect(html).toContain('<div class="flex shrink-0 items-center gap-2.5">');
    expect(html).toContain(
      '<div class="ms-auto flex min-w-0 shrink items-center gap-2"><span>필터</span>',
    );
    expect(html).not.toContain("flex-1 items-center gap-2.5");
  });
});
