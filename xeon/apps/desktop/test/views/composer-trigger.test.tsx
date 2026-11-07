import { describe, expect, test } from "bun:test";
import type { CommandRowVM } from "@fresnel/client/settings";
import { renderToString } from "react-dom/server";
import {
  ModelSelect,
  PermissionModeSelect,
  SlashRow,
  UsageRing,
  defaultRowText,
  modelOptionText,
  ownsComposerRequest,
  secretWarningOf,
} from "../../src/views/composer.tsx";
import { slashMenuOf, type SlashMenuRow } from "../../src/views/composer-slash.ts";
import type { ModelOption } from "../../src/views/model-usage.ts";
import { thr } from "../state/helpers.ts";

// 입력창 단추 줄의 모델 select와 문맥 사용량 링. 효과가 없는 서버 렌더로만 본다(DOM이 없다).
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

describe("model select", () => {
  const props = {
    current: "anthropic/claude-haiku-5-5",
    chosen: false,
    fallback: "anthropic/claude-haiku-5-5",
    choices: [],
    denied: {},
    onChange: () => {},
  };

  test("is a combobox button named for the conversation's model that does not submit the form", () => {
    const markup = renderToString(<ModelSelect {...props} disabled={false} />);
    const tag = markup.match(/<button[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('type="button"');
    expect(tag).toContain('role="combobox"');
    expect(tag).toContain('aria-label="이 대화의 모델"');
    expect(tag).not.toMatch(/ disabled=""/);
  });

  test("a disabled composer disables the select", () => {
    const markup = renderToString(<ModelSelect {...props} disabled />);
    const tag = markup.match(/<button[^>]*>/)?.[0] ?? "";
    expect(tag).toMatch(/ disabled=""/);
  });
});

describe("denied model hint", () => {
  // 403으로 실패한 모델의 줄에만 "이 키로 못 써요"가 뒤에 붙는다. 가격 글은 그대로다
  const option: ModelOption = {
    value: "anthropic/claude-haiku-5-5",
    label: "claude-haiku-5-5",
    contextWindow: null,
    price: "unknown",
  };

  test("a denied model's row adds the note after its price text, and a usable one does not", () => {
    expect(modelOptionText(option, null, false)).toBe("claude-haiku-5-5 · 가격 모름");
    expect(modelOptionText(option, null, true)).toBe(
      "claude-haiku-5-5 · 가격 모름 · 이 키로 못 써요",
    );
  });

  test("the default row adds the note only when the default model is denied", () => {
    expect(defaultRowText("claude-haiku-5-5", false)).toBe("기본 모델 · claude-haiku-5-5");
    expect(defaultRowText("claude-haiku-5-5", true)).toBe(
      "기본 모델 · claude-haiku-5-5 · 이 키로 못 써요",
    );
  });
});

describe("approval mode select", () => {
  test("is a combobox button named for the conversation's approval mode that does not submit the form", () => {
    const markup = renderToString(
      <PermissionModeSelect mode="default" disabled={false} onChange={() => {}} />,
    );
    const tag = markup.match(/<button[^>]*>/)?.[0] ?? "";
    expect(tag).toContain('type="button"');
    expect(tag).toContain('role="combobox"');
    expect(tag).toContain('aria-label="이 대화의 승인 모드"');
    expect(tag).not.toMatch(/ disabled=""/);
  });

  test("a disabled composer disables the select", () => {
    const markup = renderToString(
      <PermissionModeSelect mode="plan" disabled onChange={() => {}} />,
    );
    const tag = markup.match(/<button[^>]*>/)?.[0] ?? "";
    expect(tag).toMatch(/ disabled=""/);
  });
});

describe("secret warning line", () => {
  test("secret-like draft shows the secret warning, attachments show the attach notice", () => {
    expect(secretWarningOf(`sk-${"a1b2c3d4".repeat(3)}`, false)).toBe(
      "시크릿처럼 보이는 값이 들어 있어요. 보내면 모델에 그대로 전달돼요.",
    );
    expect(secretWarningOf("hello", true)).toBe(
      "이미지와 텍스트 파일은 모델에 그대로 전달돼요. 시크릿이 든 파일은 붙이지 마세요.",
    );
  });

  test("nothing is shown for plain text without attachments", () => {
    expect(secretWarningOf("hello", false)).toBeNull();
  });
});

describe("composer focus request owner", () => {
  test("only the composer of the selected thread takes the request", () => {
    expect(ownsComposerRequest(thr(2), thr(1))).toBe(false);
    expect(ownsComposerRequest(thr(2), thr(2))).toBe(true);
    expect(ownsComposerRequest(null, thr(1))).toBe(true);
  });
});

/** 태그와 주석을 떼고 화면에 보이는 글만 남긴다 */
function visibleText(html: string): string {
  return html.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]*>/g, "");
}

const noop = (): void => {};

/** 목록에서 이름으로 행 하나를 고른다. 없으면 시험이 실패한다 */
function menuRow(draft: string, engine: readonly CommandRowVM[], name: string): SlashMenuRow {
  const found = slashMenuOf(draft, engine).find((row) => row.name === name);
  if (found === undefined) throw new Error(`no slash row named ${name}`);
  return found;
}

function commandRow(
  name: string,
  description: string,
  source: CommandRowVM["source"],
  hint: string | null,
): CommandRowVM {
  return {
    name,
    label: `/${name}`,
    description,
    hint,
    kind: "template",
    origin: "test",
    source,
    needsShellConfirm: false,
    firstChoices: [],
  };
}

describe("slash row", () => {
  test("a project command shows the Project chip between its name and its hint and description", () => {
    const row = menuRow("/hel", [commandRow("hello", "인사", "project", "[이름]")], "hello");
    const markup = renderToString(
      <SlashRow row={row} selected={false} onFill={noop} onHover={noop} />,
    );
    expect(markup).toContain('id="composer-slash-hello"');
    expect(markup).toContain('aria-selected="false"');
    expect(markup).toContain("data-composer-slash-source");
    expect(visibleText(markup)).toBe("/hello프로젝트[이름]인사");
  });

  test("a user command shows the User chip", () => {
    const row = menuRow("/mine", [commandRow("mine", "내 명령", "user", null)], "mine");
    const markup = renderToString(<SlashRow row={row} selected onFill={noop} onHover={noop} />);
    expect(markup).toContain('aria-selected="true"');
    expect(visibleText(markup)).toBe("/mine사용자내 명령");
  });

  test("a built-in command shows no chip", () => {
    const row = menuRow("/helm", [commandRow("helm", "탐구", "builtin", null)], "helm");
    const markup = renderToString(
      <SlashRow row={row} selected={false} onFill={noop} onHover={noop} />,
    );
    expect(markup).not.toContain("data-composer-slash-source");
    expect(visibleText(markup)).toBe("/helm탐구");
  });
});
