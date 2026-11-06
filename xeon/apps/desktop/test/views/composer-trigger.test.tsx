import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import type { SettingsJump } from "../../src/state/ui/index.ts";
import { ModelButton, UsageRing, openDefaultModelSetting } from "../../src/views/composer.tsx";

// 입력창 단추 줄의 모델 단추와 문맥 사용량 링. 효과가 없는 서버 렌더로만 본다(DOM이 없다).
// 링의 값은 표식 속성과 호의 dash offset으로 비교한다. 호가 빈 만큼 offset이 커진다.

const RING_C = 50.27;

function arcOffsetOf(markup: string): number {
  const offset = markup.match(/stroke-dashoffset="([^"]+)"/)?.[1];
  if (offset === undefined) throw new Error("no arc offset in the ring");
  return Number(offset);
}

function ringAt(percent: number): string {
  return renderToString(<UsageRing percent={percent} disabled={false} />);
}

describe("usage ring", () => {
  test("draws nothing when the limit is unknown", () => {
    expect(renderToString(<UsageRing percent={null} disabled={false} />)).toBe("");
  });

  test("names the rounded percent and sets the arc from it", () => {
    const markup = renderToString(<UsageRing percent={41} disabled={false} />);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="문맥 41%"');
    expect(markup).toContain(`stroke-dasharray="${String(RING_C)}"`);
    expect(arcOffsetOf(markup)).toBeCloseTo(RING_C * 0.59, 6);
  });

  test("the tone turns warning above 80 and danger above 95", () => {
    expect(ringAt(80)).not.toContain("data-level");
    expect(ringAt(81)).toContain('data-level="warning"');
    expect(ringAt(95)).toContain('data-level="warning"');
    expect(ringAt(96)).toContain('data-level="danger"');
  });

  test("a percent past the limit clamps to a full ring", () => {
    const markup = renderToString(<UsageRing percent={120} disabled={false} />);
    expect(markup).toContain('aria-label="문맥 100%"');
    expect(arcOffsetOf(markup)).toBeCloseTo(0, 6);
  });

  test("a disabled composer dims the ring to the disabled text color", () => {
    const markup = renderToString(<UsageRing percent={41} disabled />);
    expect(markup).toContain("text-disabled-text");
    expect(markup).not.toContain("text-accent-solid");
  });
});

describe("model button", () => {
  test("is a plain button that does not submit the form and shows the model name", () => {
    const markup = renderToString(
      <ModelButton label="claude-haiku-5-5" disabled={false} onClick={() => {}} />,
    );
    const tag = markup.match(/<button[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('type="button"');
    expect(markup).toContain("claude-haiku-5-5");
    // 꺼짐은 disabled 특성으로 본다(클래스의 disabled: 변형은 셈하지 않는다)
    expect(tag).not.toMatch(/ disabled=""/);
  });

  test("a disabled composer disables the model button", () => {
    const markup = renderToString(
      <ModelButton label="claude-haiku-5-5" disabled onClick={() => {}} />,
    );
    const tag = markup.match(/<button[^>]*>/)?.[0] ?? "";
    expect(tag).toMatch(/ disabled=""/);
  });
});

describe("opening the default model setting", () => {
  test("asks the settings screen for the models tab at the default-model row", () => {
    const jumps: SettingsJump[] = [];
    openDefaultModelSetting({
      requestSettingsJump: (jump) => {
        jumps.push(jump);
      },
    });
    expect(jumps).toEqual([{ tab: "models", key: "l1.models.default" }]);
  });
});
