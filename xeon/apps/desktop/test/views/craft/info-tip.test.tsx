import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { join } from "node:path";
import { renderToString } from "react-dom/server";
import { InfoTip } from "../../../src/views/craft/info-tip.tsx";
import { read, SRC } from "../../styles/source-scan.ts";
import { describedTextOf } from "./render-support.tsx";

// 올리기, 키보드 초점, 누르기로 여는 동작은 정적 마크업으로 볼 수 없다(열린 설명은 포털에 그려지고 서버에서는 그려지지 않는다).
// 여기서는 닫힌 기본 모양과 Popover에 넘기는 위치 값만 본다. 여는 동작은 실제 창에서 확인한다.

/** 정적 마크업에서 첫 단추의 여는 태그 */
function buttonTagOf(html: string): string {
  return /<button\b[^>]*>/.exec(html)?.[0] ?? "";
}

/** 여는 태그의 class 토큰들 */
function classesOf(tag: string): string[] {
  return (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");
}

describe("InfoTip: 정보 아이콘 하나와 숨은 설명", () => {
  test("the anchor is a bare button named by the info label, not the caustic icon button", () => {
    const html = renderToString(<InfoTip text="처음 막은 결정이 이겨요" />);
    const button = buttonTagOf(html);
    expect(html).not.toContain('data-slot="icon-button"');
    expect(button).toContain('type="button"');
    expect(button).toContain(`aria-label="${t("desktop.craft.infoTip.label")}"`);
    expect(html).not.toContain('data-slot="popover"');
  });

  test("the bare button has no padding, a text-tertiary color, and the focus ring; its icon is 14px", () => {
    const html = renderToString(<InfoTip text="처음 막은 결정이 이겨요" />);
    const classes = classesOf(buttonTagOf(html));
    expect(classes).toContain("p-0");
    expect(classes).toContain("text-text-tertiary");
    expect(classes).toContain("rounded-sm");
    expect(classes).toContain("focus-visible:focus-ring");
    const icon = /<svg\b[^>]*>/.exec(html)?.[0] ?? "";
    expect(classesOf(icon)).toContain("size-3.5");
  });

  test("the icon describes itself with the text it was given (the hidden explanation)", () => {
    const html = renderToString(<InfoTip text="처음 막은 결정이 이겨요" />);
    expect(buttonTagOf(html)).toContain('aria-describedby="');
    expect(describedTextOf(html)).toBe("처음 막은 결정이 이겨요");
  });

  test("a caller can name the icon more precisely than the default label", () => {
    const html = renderToString(
      <InfoTip text="앞뒤 줄에서 감쌀 수 있어요" label="내장 설명 보기" />,
    );
    expect(buttonTagOf(html)).toContain('aria-label="내장 설명 보기"');
    expect(describedTextOf(html)).toBe("앞뒤 줄에서 감쌀 수 있어요");
  });

  test("the explanation opens above the icon and centered on it", () => {
    // 열린 설명은 포털에 그려져 정적 마크업에 없으므로, Popover 여는 태그에 넘기는 값을 소스에서 본다
    const source = read(join(SRC, "views/craft/info-tip.tsx"));
    const popover = source.slice(source.indexOf("<Popover"), source.indexOf("anchor={"));
    expect(popover).toContain('side="top"');
    expect(popover).toContain('align="center"');
  });
});
