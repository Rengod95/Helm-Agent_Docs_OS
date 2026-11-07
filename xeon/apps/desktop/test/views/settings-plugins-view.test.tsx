import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ExtListEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import {
  groupInfoIdOf,
  PluginsPanelView,
} from "../../src/views/pages/settings/settings-plugins-view.tsx";

// 설정 "플러그인과 그룹" 탭의 그림. 학습 그룹 행에만 설명 정보 아이콘이 붙는다(확장 목록에는 설명 칸이 없어 그룹 이름으로 고른다).

const NOOP = (): void => {};

/** 확장 목록의 한 항목. 내장 그룹으로 둔다 */
function extEntry(overrides: Partial<ExtListEntry>): ExtListEntry {
  return {
    name: "learning",
    displayName: "학습",
    layer: "L3",
    isGroup: true,
    version: "0.1.0",
    location: "builtin",
    origin: "builtin",
    requestedGrade: "builtin",
    effectiveGrade: "builtin",
    tier: null,
    status: "enabled",
    plugins: [],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 0,
    ...overrides,
  };
}

describe("groupInfoIdOf", () => {
  test("only the learning group has an explanation; other groups and plugins have none", () => {
    expect(groupInfoIdOf(extEntry({ name: "learning" }))).toEqual(
      "desktop.settings.plugins.learning.info",
    );
    expect(groupInfoIdOf(extEntry({ name: "helm", displayName: "Helm" }))).toEqual(null);
    expect(groupInfoIdOf(extEntry({ name: "learning", isGroup: false }))).toEqual(null);
  });
});

describe("PluginsPanelView learning explanation", () => {
  const info = t("desktop.settings.plugins.learning.info");

  test("the learning row carries its explanation behind the info icon, and no other row does", () => {
    const markup = renderToString(
      <PluginsPanelView
        load={{
          kind: "ready",
          rev: 0,
          entries: [
            extEntry({ name: "learning", displayName: "학습" }),
            extEntry({ name: "helm", displayName: "Helm" }),
          ],
        }}
        busy={new Set()}
        onToggle={NOOP}
        onReload={NOOP}
      />,
    );
    expect(markup.split(info).length - 1).toEqual(1);
    expect(markup).toContain("학습");
    expect(markup).toContain("Helm");
  });

  test("a group list without the learning group shows no explanation sentence", () => {
    const markup = renderToString(
      <PluginsPanelView
        load={{ kind: "ready", rev: 0, entries: [extEntry({ name: "helm", displayName: "Helm" })] }}
        busy={new Set()}
        onToggle={NOOP}
        onReload={NOOP}
      />,
    );
    expect(markup.split(info).length - 1).toEqual(0);
  });
});
