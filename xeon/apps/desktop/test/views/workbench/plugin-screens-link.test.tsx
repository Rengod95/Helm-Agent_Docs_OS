// 확장 상세의 "플러그인 화면 열기" 단추. 이 확장이 플러그인 화면 항목(page, Helm이 아닌 확장의 panel)을 가졌을 때만 보이고,
// 누르면 대화 영역의 `plugins` 화면으로 간다.
import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { INITIAL_WORKBENCH, listLoaded } from "@fresnel/client/workbench";
import { renderToString } from "react-dom/server";
import { createShellStore } from "../../../src/state/shell/index.ts";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import type { PluginUiContextValue } from "../../../src/views/plugin/plugin-context.tsx";
import { ExtDetail, openPluginScreens } from "../../../src/views/workbench/ext-detail.tsx";
import { uiEntryOf } from "../../plugin-ui/support.ts";
import { loadedPluginUi } from "../plugin/support.tsx";
import { entry, inContexts } from "./support.tsx";

const LINK = t("desktop.workbench.detail.openPluginScreens");

/** 확장 `name`의 상세를 그린 글 */
function detailOf(name: string, plugin: PluginUiContextValue): string {
  const row = entry(name);
  const state = listLoaded(INITIAL_WORKBENCH, [row]);
  return renderToString(
    inContexts(
      <ExtDetail
        state={state}
        entry={row}
        tab="overview"
        onTab={() => undefined}
        onBack={() => undefined}
        onToggle={() => undefined}
        onKeepOn={() => undefined}
        onKeepOff={() => undefined}
        onRemove={() => undefined}
      />,
      createWorkbenchStore(() => state),
      undefined,
      plugin,
    ),
  );
}

describe("확장 상세의 플러그인 화면 열기", () => {
  test("shows the link when the extension has a page entry", async () => {
    const plugin = await loadedPluginUi([uiEntryOf({ extension: "web", placement: "page" })]);
    expect(detailOf("web", plugin)).toContain(LINK);
  });

  test("shows the link when a non-helm extension has a panel entry", async () => {
    const plugin = await loadedPluginUi([uiEntryOf({ extension: "web", placement: "panel" })]);
    expect(detailOf("web", plugin)).toContain(LINK);
  });

  test("hides the link for helm's panel entry, which the Helm tab draws and the plugin screens do not", async () => {
    const plugin = await loadedPluginUi([uiEntryOf({ extension: "helm", placement: "panel" })]);
    expect(detailOf("helm", plugin)).not.toContain(LINK);
  });

  test("hides the link when the extension has no page or panel entry", async () => {
    const plugin = await loadedPluginUi([
      uiEntryOf({ extension: "web", id: "settings", placement: "settings" }),
      uiEntryOf({ extension: "other", placement: "page" }),
    ]);
    expect(detailOf("web", plugin)).not.toContain(LINK);
    expect(detailOf("web", await loadedPluginUi([]))).not.toContain(LINK);
  });

  test("the link's action switches to the chat area and its plugins screen", () => {
    const store = createShellStore(1400);
    store.actions.switchArea("workbench");
    openPluginScreens(store.actions);
    const state = store.read.getState();
    expect(state.area).toBe("chat");
    expect(state.places.chat.screen).toBe("plugins");
    expect(state.places.chat.scroll).toBe(0);
  });
});
