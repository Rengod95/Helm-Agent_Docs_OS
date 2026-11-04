import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { renderToString } from "react-dom/server";
import { InfoTip } from "../../../src/views/craft/info-tip.tsx";
import { describedTextOf } from "./render-support.tsx";

// 올리기, 키보드 초점, 누르기로 여는 동작은 정적 마크업으로 볼 수 없다(열린 설명은 포털에 그려지고 서버에서는 그려지지 않는다).
// 여기서는 닫힌 기본 모양만 본다. 여는 동작은 실제 창에서 확인한다.

describe("InfoTip: 정보 아이콘 하나와 숨은 설명", () => {
  test("the icon is a button named by the info label, and the explanation is not shown by default", () => {
    const html = renderToString(<InfoTip text="처음 막은 결정이 이겨요" />);
    expect(html).toContain('data-slot="icon-button"');
    expect(html).toContain(`aria-label="${t("desktop.craft.infoTip.label")}"`);
    expect(html).toContain('type="button"');
    expect(html).not.toContain('data-slot="popover"');
  });

  test("the icon describes itself with the text it was given (the hidden explanation)", () => {
    const html = renderToString(<InfoTip text="처음 막은 결정이 이겨요" />);
    expect(describedTextOf(html)).toBe("처음 막은 결정이 이겨요");
  });

  test("a caller can name the icon more precisely than the default label", () => {
    const html = renderToString(
      <InfoTip text="앞뒤 줄에서 감쌀 수 있어요" label="내장 설명 보기" />,
    );
    expect(html).toContain('aria-label="내장 설명 보기"');
    expect(describedTextOf(html)).toBe("앞뒤 줄에서 감쌀 수 있어요");
  });
});
