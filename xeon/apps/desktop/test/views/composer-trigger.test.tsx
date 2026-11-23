import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { CommandRowVM } from "@fresnel/client/settings";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { Menu } from "@caustic/react";
import { parseHTML } from "linkedom";
import type { ModelEntry } from "@fresnel/contracts/wire";
import {
  SlashRow,
  StopButton,
  composerBlankHit,
  modeErrorText,
  ownsComposerRequest,
  secretWarningOf,
} from "../../src/views/composer.tsx";
import {
  ModelChip,
  PermissionModeChip,
  PermissionModeMenuBody,
  ThinkingChip,
  modelChipText,
  permissionModeChipText,
} from "../../src/views/composer-chips.tsx";
import { slashMenuOf, type SlashMenuRow } from "../../src/views/composer-slash.ts";
import { thr } from "../state/helpers.ts";

// 입력창 아래 칩(DP-101)과 멈춤 단추. 효과가 없는 서버 렌더로만 본다(DOM이 없다).

/** 첫 단추 태그와 그 class 목록 */
function firstButton(markup: string): {
  readonly tag: string;
  readonly classes: readonly string[];
} {
  const tag = markup.match(/<button[^>]*>/)?.[0] ?? "";
  return { tag, classes: (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(" ") };
}

const MODEL: ModelEntry = {
  ref: "anthropic/claude-haiku-5-5",
  name: "Claude Haiku 5.5",
  contextWindow: 200_000,
  reasoning: true,
  inputPrice: 1,
  outputPrice: 5,
};

describe("model chip", () => {
  const props = {
    current: "anthropic/claude-haiku-5-5",
    chosen: false,
    fallback: "anthropic/claude-haiku-5-5",
    choices: [MODEL],
    denied: {},
    onChange: () => {},
  };

  test("shows the model name only, no price or context size, and does not submit the form", () => {
    const { tag } = firstButton(renderToString(<ModelChip {...props} disabled={false} />));
    expect(tag).toContain('type="button"');
    expect(tag).toContain('data-composer-chip="model"');
    expect(tag).toContain('aria-label="이 대화의 모델: Claude Haiku 5.5"');
    const text = visibleText(renderToString(<ModelChip {...props} disabled={false} />));
    expect(text).toBe("Claude Haiku 5.5");
  });

  test("the chip is the form-standard sm control (28px, DP-132), with no height override", () => {
    const { classes } = firstButton(renderToString(<ModelChip {...props} disabled={false} />));
    expect(classes).toContain("h-control-sm");
    expect(classes).not.toContain("h-auto");
    expect(classes).toContain("px-2");
    expect(classes).toContain("gap-1");
  });

  test("a disabled composer disables the chip", () => {
    const { tag } = firstButton(renderToString(<ModelChip {...props} disabled />));
    expect(tag).toMatch(/ disabled=""/);
  });

  test("an unknown model falls back to a tidied name of its reference (DP-144)", () => {
    expect(modelChipText([], "openai/gpt-x")).toBe("GPT X");
    expect(modelChipText([MODEL], "anthropic/claude-haiku-5-5")).toBe("Claude Haiku 5.5");
  });
});

describe("permission mode chip", () => {
  test("names the mode with a short label and an icon, and does not submit the form", () => {
    const markup = renderToString(
      <PermissionModeChip
        mode="default"
        bypassAllowed={false}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const { tag } = firstButton(markup);
    expect(tag).toContain('type="button"');
    expect(tag).toContain('aria-label="이 대화의 승인 모드: 실행마다 묻기"');
    expect(visibleText(markup)).toBe("실행마다 묻기");
    expect(markup).toContain("<svg");
  });

  test("each mode's chip reads as its name", () => {
    expect(permissionModeChipText("default")).toBe("실행마다 묻기");
    expect(permissionModeChipText("acceptEdits")).toBe("편집 자동 허용");
    expect(permissionModeChipText("bypass")).toBe("모두 허용");
  });

  test("a disabled composer disables the chip", () => {
    const { tag } = firstButton(
      renderToString(
        <PermissionModeChip
          mode="acceptEdits"
          bypassAllowed={false}
          disabled
          onChange={() => {}}
        />,
      ),
    );
    expect(tag).toMatch(/ disabled=""/);
  });

  test("keeps its place while the mode is being read: a disabled chip named for the mode (DP-213)", () => {
    const markup = renderToString(
      <PermissionModeChip mode={null} bypassAllowed={false} disabled={false} onChange={() => {}} />,
    );
    const { tag } = firstButton(markup);
    expect([
      tag.includes(' disabled=""'),
      tag.includes('data-state="loading"'),
      visibleText(markup),
    ]).toEqual([true, true, t("desktop.composer.mode.loading")]);
  });

  test("an unknown engine value shows the default mode, dotted, with the reason as its title (DP-213)", () => {
    const markup = renderToString(
      <PermissionModeChip
        mode="default"
        note={{ id: "desktop.composer.approvalMode.unknown", value: "plan" }}
        bypassAllowed={false}
        disabled={false}
        onChange={() => {}}
      />,
    );
    const { tag } = firstButton(markup);
    const reason = t("desktop.composer.approvalMode.unknown", { value: "plan" });
    expect([
      tag.includes('data-state="unsure"'),
      tag.includes(`title="${reason}"`),
      visibleText(markup),
    ]).toEqual([true, true, permissionModeChipText("default")]);
  });

  test("the bypass chip uses the danger text colour, the other modes the tertiary one", () => {
    const bypass = firstButton(
      renderToString(
        <PermissionModeChip mode="bypass" bypassAllowed disabled={false} onChange={() => {}} />,
      ),
    );
    const normal = firstButton(
      renderToString(
        <PermissionModeChip mode="default" bypassAllowed disabled={false} onChange={() => {}} />,
      ),
    );
    expect(bypass.classes).toContain("text-danger-text");
    expect(normal.classes).toContain("text-text-tertiary");
    expect(normal.classes).not.toContain("text-danger-text");
  });
});

/** 메뉴를 펼쳐 그린 문서. 줄은 `role^=menuitem` 요소다 */
function menuOf(node: ReactNode): Document {
  return parseHTML(
    `<!doctype html><html><body>${renderToString(
      <Menu inline open size="sm">
        {node}
      </Menu>,
    )}</body></html>`,
  ).document;
}
const rowsOf = (doc: Document) =>
  [...doc.querySelectorAll('[role^="menuitem"]')].map((row) => ({
    profile: row.getAttribute("data-mode-profile"),
    checked: row.getAttribute("aria-checked"),
    text: row.textContent,
  }));
const line = (
  view: { kind: "applied"; mode: "acceptEdits" } | { kind: "revert"; mode: "bypass" | null },
) => ({
  view,
  profile: "코딩",
  look: "ready" as const,
  onRevert: noop,
});

describe("permission mode menu: the fixed profile row (DP-231, AGE-71)", () => {
  const HINT = {
    default: t("desktop.composer.mode.default.hint"),
    acceptEdits: t("desktop.composer.mode.acceptEdits.hint"),
    bypass: t("desktop.composer.mode.bypass.hint"),
  };
  const hint = (id: keyof typeof HINT): string => HINT[id];

  test("without a chat value: no check above, a separator, then the profile's mode marked as chosen", () => {
    const doc = menuOf(
      <PermissionModeMenuBody
        mode="acceptEdits"
        note={null}
        bypassAllowed
        profile={line({ kind: "applied", mode: "acceptEdits" })}
        onChange={noop}
      />,
    );
    expect(rowsOf(doc)).toEqual([
      { profile: null, checked: "false", text: `실행마다 묻기${hint("default")}` },
      { profile: null, checked: "false", text: `편집 자동 허용${hint("acceptEdits")}` },
      { profile: null, checked: "false", text: `모두 허용${hint("bypass")}` },
      { profile: "applied", checked: "true", text: "편집 자동 허용코딩 프로필이 정함" },
    ]);
    expect(doc.querySelectorAll('[role="separator"]').length).toBe(1);
    expect(
      doc.querySelector('[data-mode-profile="applied"] [data-profile-glyph="ready"]'),
    ).not.toBeNull();
  });

  test("with a chat value: the chosen mode is checked and the row below goes back to the profile's value", () => {
    const doc = menuOf(
      <PermissionModeMenuBody
        mode="default"
        note={null}
        bypassAllowed
        profile={line({ kind: "revert", mode: "bypass" })}
        onChange={noop}
      />,
    );
    expect(rowsOf(doc).map((row) => [row.profile, row.checked])).toEqual([
      [null, "true"],
      [null, "false"],
      [null, "false"],
      ["revert", null],
    ]);
    expect(rowsOf(doc)[3]?.text).toBe("모두 허용코딩 프로필 값으로 되돌리기");
  });

  test("before the profile's value is read, the revert row says only where it goes back to", () => {
    const doc = menuOf(
      <PermissionModeMenuBody
        mode="default"
        note={null}
        bypassAllowed={false}
        profile={line({ kind: "revert", mode: null })}
        onChange={noop}
      />,
    );
    expect(rowsOf(doc).at(-1)?.text).toBe("코딩 프로필 값으로 되돌리기");
  });

  test("the profile screen's menu (no profile row) keeps the three rows only, with the check", () => {
    const doc = menuOf(
      <PermissionModeMenuBody
        mode="default"
        note={null}
        bypassAllowed={false}
        profile={null}
        onChange={noop}
      />,
    );
    expect(rowsOf(doc).map((row) => [row.profile, row.checked])).toEqual([
      [null, "true"],
      [null, "false"],
    ]);
    expect(doc.querySelectorAll('[role="separator"]').length).toBe(0);
  });
});

describe("thinking chip", () => {
  test("shows the level name only, without a leading icon (DP-132), at the sm height", () => {
    const markup = renderToString(<ThinkingChip level="medium" disabled={false} onChange={noop} />);
    expect(visibleText(markup)).toBe("보통");
    expect(markup).not.toContain("<svg");
    expect(firstButton(markup).classes).toContain("h-control-sm");
  });
});

describe("stop button", () => {
  test("a running turn shows the stop glyph and can be pressed", () => {
    const { tag } = firstButton(
      renderToString(<StopButton aborting={false} blockedReason={null} onStop={() => {}} />),
    );
    expect(tag).toContain('aria-label="중단"');
    expect(tag).toContain('data-composer-stop="idle"');
    expect(tag).not.toMatch(/ disabled=""/);
  });

  test("after stop is pressed it says it is stopping and cannot be pressed again", () => {
    const { tag } = firstButton(
      renderToString(<StopButton aborting blockedReason={null} onStop={() => {}} />),
    );
    expect(tag).toContain('aria-label="멈추는 중…"');
    expect(tag).toContain('data-composer-stop="stopping"');
    expect(tag).toContain('aria-busy="true"');
    expect(tag).toMatch(/ disabled=""/);
  });

  test("without an engine the stop button says why and is disabled", () => {
    const { tag } = firstButton(
      renderToString(<StopButton aborting={false} blockedReason="엔진 없음" onStop={() => {}} />),
    );
    expect(tag).toContain('aria-label="엔진 없음"');
    expect(tag).toMatch(/ disabled=""/);
  });
});

describe("mode change error text", () => {
  test("a failed mode change shows the approval-mode sentence", () => {
    expect(modeErrorText({ kind: "command", error: { kind: "unsupported" } })).toBe(
      "승인 모드를 바꾸지 못했어요.",
    );
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

/** closest()만 흉내 낸 요소: 조상 가운데 고른 선택자에 맞는 것이 있으면 그것을 돌려준다 */
function at(control: boolean): { closest(selector: string): unknown } {
  return { closest: () => (control ? {} : null) };
}

describe("composer blank-area focus", () => {
  test("a press on the footer gap inside the box focuses the input", () => {
    expect(composerBlankHit(at(false), true)).toBe(true);
  });

  test("buttons, chips, attachments and the text box itself keep their own behaviour", () => {
    expect(composerBlankHit(at(true), true)).toBe(false);
  });

  test("a press outside the box is not the composer's", () => {
    expect(composerBlankHit(at(false), false)).toBe(false);
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
