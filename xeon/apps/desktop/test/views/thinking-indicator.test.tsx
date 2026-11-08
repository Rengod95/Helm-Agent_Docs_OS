import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingIndicator } from "../../src/views/thinking-indicator.tsx";

test("the thinking indicator is a decorative svg with three rings and a center dot", () => {
  const html = renderToStaticMarkup(<ThinkingIndicator active size={20} />);
  expect(html).toContain('aria-hidden="true"');
  expect(html).toContain('width="20"');
  expect(html).toContain('data-active="true"');
  expect(html.match(/<circle/g)?.length).toBe(4);
  for (const step of [0, 1, 2, 3]) expect(html).toContain(`thinking-indicator-step-${step}`);
});

test("a finished thought is the still shape at the default 16px", () => {
  const html = renderToStaticMarkup(<ThinkingIndicator active={false} />);
  expect(html).toContain('data-active="false"');
  expect(html).toContain('width="16"');
});
