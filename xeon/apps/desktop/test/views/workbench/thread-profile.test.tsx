import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { Profile } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { ProfileSection, type ProfileLoad } from "../../../src/views/workbench/thread-profile.tsx";
import { pluginPagesEndTab } from "../../../src/views/workbench/index.tsx";
import { screenStore } from "./support.tsx";

// 대화 영역 "플러그인" 탭의 "이 대화의 프로필" 구역. 크래프트 검사 탭에서 옮겨 왔다(사용자 결정 2026-11-04: 크래프트는 전역만).

const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

const QUIET: Profile = {
  id: "quiet",
  title: "조용히",
  enable: [],
  disable: ["web"],
  settings: [],
  driver: null,
  updatedAt: "2026-11-04T10:00:00Z",
  rev: 1,
};
const LOUD: Profile = { ...QUIET, id: "loud", title: "시끄럽게", disable: [], enable: ["web"] };

function section(profiles: ProfileLoad, threadOpen: boolean): string {
  return renderToString(
    <ProfileSection profiles={profiles} threadOpen={threadOpen} onApply={() => {}} />,
  );
}

/** 단추 하나의 여는 태그와 글. 잠김 여부를 본다 */
function buttonOf(html: string, label: string): string {
  const end = html.indexOf(`>${label}</button>`);
  if (end === -1) return "";
  return html.slice(html.lastIndexOf("<button", end), end + label.length + "</button>".length + 1);
}

describe("이 대화의 프로필 구역", () => {
  test("열린 대화에서 프로필 고르기는 보이고, 고르기 전에는 적용이 잠긴다", () => {
    const html = section({ kind: "ready", value: [QUIET, LOUD] }, true);
    expect(html).toContain(`aria-label="${t("desktop.inspect.profile.title")}"`);
    expect(textOf(html)).toContain(t("desktop.inspect.profile.select"));
    expect(textOf(html)).toContain(t("desktop.inspect.profile.pick"));
    expect(buttonOf(html, t("desktop.inspect.profile.apply"))).toContain('disabled=""');
    expect(html).not.toContain(t("desktop.inspect.profile.noThread"));
  });

  test("대화가 없으면 고르기와 적용이 잠기고 대화를 열라는 글을 보인다", () => {
    const html = section({ kind: "ready", value: [QUIET] }, false);
    expect(textOf(html)).toContain(t("desktop.inspect.profile.noThread"));
    expect(buttonOf(html, t("desktop.inspect.profile.apply"))).toContain('disabled=""');
  });

  test("저장된 프로필이 없으면 빈 글을, 목록을 못 읽으면 오류 한 줄을, 읽는 중이면 아무 글도 보이지 않는다", () => {
    expect(textOf(section({ kind: "ready", value: [] }, true))).toContain(
      t("desktop.inspect.profile.empty"),
    );
    expect(textOf(section({ kind: "error" }, true))).toContain(
      t("desktop.inspect.profile.loadFailed"),
    );
    const loading = textOf(section({ kind: "loading" }, true));
    expect(loading).not.toContain(t("desktop.inspect.profile.empty"));
    expect(loading).not.toContain(t("desktop.inspect.profile.loadFailed"));
  });
});

describe("플러그인 탭 등록 위치", () => {
  test("플러그인 탭은 대화 영역에만 등록된다(이 대화에서 끄기와 프로필이 대화 범위이므로)", () => {
    expect(pluginPagesEndTab(screenStore()).area).toBe("chat");
  });
});
