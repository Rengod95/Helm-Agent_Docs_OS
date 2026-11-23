import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { INITIAL_WORKBENCH, listLoaded } from "@fresnel/client/workbench";
import type { UiNode } from "@fresnel/contracts/extensions";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import type { PluginUiContextValue } from "../../../src/views/plugin/plugin-context.tsx";
import { PluginSettingsSlot } from "../../../src/views/workbench/surfaces-tab.tsx";
import { extListEntryOf, uiEntryOf } from "../../plugin-ui/support.ts";
import { entry, inContexts } from "../workbench/support.tsx";
import { loadedPluginUi } from "./support.tsx";

// 크래프트 상세 "화면과 설정" 탭 안 설정 화면 자리(settings slot). 이 확장의 `settings` 항목 하나를 그린다. 항목 제목은 화면에 쓰지 않고 자리의 이름(aria-label)으로만 쓴다. 없으면 아무것도 그리지 않는다(ADR-0021 §3.2).

const TEXT_TREE: UiNode = { type: "Chip", bind: { text: { path: "/status/phase" } } };

/** 플러그인 `helm`의 설정 화면 자리를 그린 글 */
function detailOf(plugin: PluginUiContextValue): string {
  const row = entry("helm");
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <PluginSettingsSlot name="helm" />,
      createWorkbenchStore(() => state),
      undefined,
      plugin,
    ),
  );
}

/** 설정 화면 자리(section)의 이름, 곧 항목 제목(aria-label), 그린 순서대로 */
const slotNamesOf = (html: string): string[] =>
  [...html.matchAll(/<section aria-label="([^"]*)"/g)].map((match) => match[1] ?? "");

const SETTINGS: ExtUiEntry = uiEntryOf({
  id: "settings",
  placement: "settings",
  title: "설정 항목 제목",
  tree: TEXT_TREE,
});

describe("the screens and settings tab's settings slot", () => {
  test("draws the extension's settings entry, named by its title", async () => {
    const html = detailOf(await loadedPluginUi([SETTINGS]));
    expect(slotNamesOf(html)).toEqual(["설정 항목 제목"]);
    expect(html).toContain(t("desktop.plugin.state.loading"));
  });

  test("draws nothing when the extension has no settings entry", async () => {
    const html = detailOf(await loadedPluginUi([uiEntryOf({ id: "page", placement: "page" })]));
    expect(slotNamesOf(html)).toEqual([]);
    expect(html).not.toContain(t("desktop.plugin.state.loading"));
  });

  test("draws nothing for an extension that is switched off", async () => {
    const html = detailOf(
      await loadedPluginUi([SETTINGS], [extListEntryOf("helm", { status: "disabled" })]),
    );
    expect(slotNamesOf(html)).toEqual([]);
  });
});
