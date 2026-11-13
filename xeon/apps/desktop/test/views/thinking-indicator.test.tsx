import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ShimmerText,
  ThinkingIndicator,
  ThinkingLive,
} from "../../src/views/thinking-indicator.tsx";

// 생각 표시(DP-162·168). orb는 canvas라 서버 렌더에서는 틀만 나온다

test("orb는 장식이다: 화면 낭독에서 빠지고 작은 프리셋 20px 하나다", () => {
  const html = renderToStaticMarkup(<ThinkingIndicator active />);
  expect(html).toContain("<canvas");
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('data-active="true"');
  expect(html).toContain("width:20px;height:20px");
  expect(renderToStaticMarkup(<ThinkingIndicator active={false} />)).toContain(
    'data-active="false"',
  );
});

test("반짝이는 글은 같은 글을 data-text에 두고 본문은 한 번만 쓴다", () => {
  expect(renderToStaticMarkup(<ShimmerText text="생각하는 중…" />)).toBe(
    '<span class="thinking-shimmer" data-text="생각하는 중…">생각하는 중…</span>',
  );
});

test("생각하는 중 표시는 아이콘 칸의 작은 구슬과 반짝이는 동사다(알약 없음)", () => {
  const html = renderToStaticMarkup(<ThinkingLive label="생각하는 중" />);
  expect(html.startsWith('<span class="convo-line-icon">')).toBe(true);
  expect(html).toContain("thinking-indicator thinking-indicator-inline");
  expect(html).toContain("width:20px;height:20px");
  expect(html).toContain('<span class="thinking-shimmer convo-line-verb" data-text="생각하는 중">');
  expect(html).not.toContain("pill");
});
