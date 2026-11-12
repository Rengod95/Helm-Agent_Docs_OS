import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ShimmerText,
  ThinkingIndicator,
  ThinkingPill,
} from "../../src/views/thinking-indicator.tsx";

// 생각 표시(DP-162). orb는 canvas라 서버 렌더에서는 틀만 나온다

test("orb는 장식이다: 화면 낭독에서 빠지고 보이는 크기를 따로 줄 수 있다", () => {
  const html = renderToStaticMarkup(<ThinkingIndicator size={64} display={36} active />);
  expect(html).toContain("<canvas");
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('data-active="true"');
  expect(html).toContain("width:36px;height:36px");
});

test("크기를 주지 않으면 프리셋 크기로 보인다", () => {
  const html = renderToStaticMarkup(<ThinkingIndicator size={20} active={false} />);
  expect(html).toContain("width:20px;height:20px");
  expect(html).toContain('data-active="false"');
});

test("반짝이는 글은 같은 글을 data-text에 두고 본문은 한 번만 쓴다", () => {
  expect(renderToStaticMarkup(<ShimmerText text="생각하는 중…" />)).toBe(
    '<span class="thinking-shimmer" data-text="생각하는 중…">생각하는 중…</span>',
  );
});

test("대기 알약은 orb와 반짝이는 글이다", () => {
  const html = renderToStaticMarkup(<ThinkingPill label="생각하는 중…" />);
  expect(html.startsWith('<span class="thinking-pill">')).toBe(true);
  expect(html).toContain("<canvas");
  expect(html).toContain('data-text="생각하는 중…"');
});
