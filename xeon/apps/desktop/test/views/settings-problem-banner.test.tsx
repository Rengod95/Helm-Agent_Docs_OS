import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { t } from "@fresnel/client/i18n";
import type { SettingsFileProblem } from "@fresnel/contracts/wire";
import { HostNoticesContext } from "../../src/views/host-notices-context.ts";
import {
  SettingsProblemBanner,
  SettingsProblemBannerView,
} from "../../src/views/settings-problem-banner.tsx";

// 읽지 못한 설정 파일의 경고 띠(`settings-problem-banner.tsx`)를 서버 렌더로 본다. 제목, 위치, 보조 글, "파일로 보기" 단추를 그리고,
// 파일 편집기를 열 수 없으면 단추를 잠근다. 알림 값이 없거나 문제가 없으면 아무것도 그리지 않는다.

const PROBLEM: SettingsFileProblem = {
  scope: "user",
  path: "/home/me/.fresnel/settings.json",
  reason: "invalid_json",
  line: 3,
  column: 5,
};

describe("the settings problem banner", () => {
  test("it names the file, the position, and offers to open the file", () => {
    const out = renderToString(
      <SettingsProblemBannerView problem={PROBLEM} onOpenFile={() => {}} />,
    );
    expect(out).toContain(t("desktop.settings.problem.title"));
    expect(out).toContain("~/.fresnel/settings.json (3줄 5칸)");
    expect(out).toContain(t("desktop.settings.problem.note"));
    expect(out).toContain(t("desktop.settings.problem.openFile"));
  });

  test("without an open action it draws no button", () => {
    const out = renderToString(<SettingsProblemBannerView problem={PROBLEM} />);
    expect(out).toContain(t("desktop.settings.problem.title"));
    expect(out).not.toContain(t("desktop.settings.problem.openFile"));
  });

  test("a locked open action is drawn disabled", () => {
    const out = renderToString(
      <SettingsProblemBannerView problem={PROBLEM} onOpenFile={() => {}} openFileDisabled />,
    );
    expect(out).toContain('disabled=""');
    expect(out).toContain(t("desktop.settings.problem.openFile"));
  });

  test("the banner draws nothing without a notice or with an empty problem list", () => {
    expect(renderToString(<SettingsProblemBanner />)).toBe("");
    expect(
      renderToString(
        <HostNoticesContext value={{ settingsProblems: [], startupNotices: [] }}>
          <SettingsProblemBanner />
        </HostNoticesContext>,
      ),
    ).toBe("");
  });

  test("the banner reads the first problem from the host notices", () => {
    const out = renderToString(
      <HostNoticesContext value={{ settingsProblems: [PROBLEM], startupNotices: [] }}>
        <SettingsProblemBanner onOpenFile={() => {}} />
      </HostNoticesContext>,
    );
    expect(out).toContain(t("desktop.settings.problem.title"));
    expect(out).toContain("~/.fresnel/settings.json (3줄 5칸)");
  });
});
