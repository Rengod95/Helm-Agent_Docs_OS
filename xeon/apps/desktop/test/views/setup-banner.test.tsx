import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { SetupBannerView } from "../../src/views/setup-banner.tsx";

describe("setup banner", () => {
  test("offers the getting-started guide, not a settings page, next to the requirement", () => {
    const out = renderToString(<SetupBannerView onOpen={() => {}} />);
    expect(out).toContain("모델 키와 기본 모델을 먼저 정해야 대화를 시작할 수 있어요.");
    expect(out).toContain("시작 안내 열기");
    expect(out).not.toContain("설정 열기");
  });
});
