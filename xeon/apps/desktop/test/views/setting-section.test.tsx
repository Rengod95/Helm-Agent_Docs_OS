import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { infoLinesOf } from "../../src/views/craft/info-tip.tsx";
import { explanationOf } from "../../src/views/pages/settings/settings-field.tsx";
import {
  FIELD_WIDTH,
  formColumnOf,
  RowNote,
  SettingRow,
  SettingSection,
} from "../../src/views/pages/settings/settings-section.tsx";
import { defOf, fieldIn, settingOf, viewOf } from "./settings-fixtures.ts";

// 설정 카드·줄 부품(DP-77~79). 서버 렌더 마크업에서 줄 모양, 열 폭, 재시작 안내 문장을 본다.

/** 첫 요소의 class 토큰들 */
function classesOf(html: string, slot: string): string[] {
  const tag = new RegExp(`<[a-z]+\\b[^>]*data-slot="${slot}"[^>]*>`).exec(html)?.[0] ?? "";
  return (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");
}

describe("formColumnOf: 본문 열 폭 두 단계", () => {
  test("form sections and search results use 600px, table sections 720px", () => {
    expect(formColumnOf("general")).toBe("max-w-150");
    expect(formColumnOf(null)).toBe("max-w-150");
    expect(formColumnOf("secrets")).toBe("max-w-180");
    expect(formColumnOf("connection")).toBe("max-w-180");
  });

  test("input widths are three steps", () => {
    expect(Object.values(FIELD_WIDTH)).toEqual(["w-24", "w-56", "w-full"]);
  });
});

describe("infoLinesOf: 정보 아이콘 설명 줄", () => {
  test("a single text is one line and empty lines drop", () => {
    expect(infoLinesOf("한 줄")).toEqual(["한 줄"]);
    expect(infoLinesOf(["가", "", "나"])).toEqual(["가", "나"]);
  });
});

describe("SettingRow: 줄 하나", () => {
  test("inline row puts the control on the label line with 8px vertical padding", () => {
    const html = renderToString(
      <SettingRow label="자동 저장" info="설명" control={<button type="button">x</button>} />,
    );
    const classes = classesOf(html, "setting-row");
    expect(html).toContain('data-layout="inline"');
    expect(classes).toContain("py-2");
    expect(classes).toContain("hover:bg-neutral-hover");
    expect(html).toContain('data-slot="info-tip"');
  });

  test("stacked row puts the control below the label with 12px vertical padding", () => {
    const html = renderToString(
      <SettingRow layout="stacked" label="경로" control={<input aria-label="경로" />} />,
    );
    expect(html).toContain('data-layout="stacked"');
    expect(classesOf(html, "setting-row")).toContain("py-3");
  });

  test("a row without info draws no info icon", () => {
    const html = renderToString(<SettingRow label="이름" />);
    expect(html).not.toContain('data-slot="info-tip"');
  });

  test("row note is a note with a secondary sentence", () => {
    const html = renderToString(<RowNote>값이 덮였어요</RowNote>);
    expect(html).toContain('role="note"');
    expect(html).toContain("text-text-secondary");
    expect(html).toContain("text-warning-text");
  });
});

describe("SettingSection: 구역 카드", () => {
  test("a titled section has 40px above, 8px under the title, and a rows card", () => {
    const html = renderToString(
      <SettingSection title="일반">
        <SettingRow label="이름" />
      </SettingSection>,
    );
    const section = classesOf(html, "setting-section");
    expect(section).toContain("pt-10");
    expect(section).toContain("first:pt-0");
    expect(html).toContain("mb-2");
    expect(html).toContain('data-body="rows"');
    expect(classesOf(html, "setting-card")).toContain("rounded-xl");
  });

  test("a continuing card sits 8px under the previous one", () => {
    const html = renderToString(
      <SettingSection continues label="이어서" body="plain">
        <p>본문</p>
      </SettingSection>,
    );
    expect(classesOf(html, "setting-section")).toEqual(["pt-2"]);
    expect(html).toContain('aria-label="이어서"');
    expect(html).toContain('data-body="plain"');
  });
});

describe("explanationOf: 재시작 설정의 설명 끝 문장", () => {
  const RESTART = defOf(
    "l1.models.default",
    "models",
    "text",
    { type: "string" },
    { runtimeChange: "restart" },
    { label: "기본 모델", help: "요청에 쓸 기본 모델" },
  );
  const LIVE = defOf(
    "l1.models.default",
    "models",
    "text",
    { type: "string" },
    {},
    { label: "기본 모델" },
  );

  test("a restart setting ends its explanation with the restart sentence", () => {
    const view = viewOf(
      [RESTART],
      [settingOf("l1.models.default", "m", { runtimeChange: "restart" })],
    );
    const field = fieldIn(view, "l1.models.default");
    expect(field).toBeDefined();
    if (field === undefined) return;
    const lines = explanationOf(field, "text");
    expect(lines.at(-1)).toBe(t("desktop.settings.field.restartNote"));
    expect(lines[0]).toBe("요청에 쓸 기본 모델");
  });

  test("a live setting has no restart sentence", () => {
    const view = viewOf([LIVE], [settingOf("l1.models.default", "m")]);
    const field = fieldIn(view, "l1.models.default");
    expect(field).toBeDefined();
    if (field === undefined) return;
    expect(explanationOf(field, "text")).not.toContain(t("desktop.settings.field.restartNote"));
  });
});
