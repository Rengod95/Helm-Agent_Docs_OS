import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { INITIAL_WORKBENCH, listLoaded } from "@fresnel/client/workbench";
import type { UiNode } from "@fresnel/contracts/extensions";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import type { PluginUiContextValue } from "../../../src/views/plugin/plugin-context.tsx";
import { SettingsTab } from "../../../src/views/workbench/settings-tab.tsx";
import { extListEntryOf, uiEntryOf } from "../../plugin-ui/support.ts";
import { entry, inContexts } from "../workbench/support.tsx";
import { loadedPluginUi } from "./support.tsx";

// 확장 상세의 설정 탭 안 설정 화면 자리(settings slot). 이 확장의 `settings` 항목 하나를 항목 제목으로 그린다. 없으면 아무것도 그리지 않는다(ADR-0021 §3.2).

const TEXT_TREE: UiNode = { type: "Chip", bind: { text: { path: "/status/phase" } } };

/** 확장 `helm`의 설정 탭을 그린 글(설정 탭이 열린 상태) */
function detailOf(plugin: PluginUiContextValue): string {
  const row = entry("helm");
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <SettingsTab name="helm" />,
      createWorkbenchStore(() => state),
      undefined,
      plugin,
    ),
  );
}

/** 구역 제목(`h4`) 글, 그린 순서대로 */
const sectionTitlesOf = (html: string): string[] =>
  [...html.matchAll(/<h4\b[^>]*>([^<]*)<\/h4>/g)].map((match) => match[1] ?? "");

const SETTINGS: ExtUiEntry = uiEntryOf({
  id: "settings",
  placement: "settings",
  title: "설정 항목 제목",
  tree: TEXT_TREE,
});

describe("the settings tab's settings slot", () => {
  test("draws the extension's settings entry under its title", async () => {
    const html = detailOf(await loadedPluginUi([SETTINGS]));
    expect(sectionTitlesOf(html)).toEqual(["설정 항목 제목"]);
    expect(html).toContain(t("desktop.plugin.state.loading"));
  });

  test("draws nothing when the extension has no settings entry", async () => {
    const html = detailOf(await loadedPluginUi([uiEntryOf({ id: "page", placement: "page" })]));
    expect(sectionTitlesOf(html)).toEqual([]);
    expect(html).not.toContain(t("desktop.plugin.state.loading"));
  });

  test("draws nothing for an extension that is switched off", async () => {
    const html = detailOf(
      await loadedPluginUi([SETTINGS], [extListEntryOf("helm", { status: "disabled" })]),
    );
    expect(sectionTitlesOf(html)).toEqual([]);
  });
});
