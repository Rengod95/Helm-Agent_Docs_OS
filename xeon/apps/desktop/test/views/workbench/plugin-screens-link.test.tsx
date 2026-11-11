// 확장 상세의 "플레이그라운드에서 보기" 단추. 이 확장이 앱에 더한 것(`ext.ui.list` 항목, 자리 무관)이 있을 때만 보이고,
// 누르면 대화 영역의 `plugins`(플레이그라운드) 화면에 그 플러그인 상세를 요청한다.
import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import { INITIAL_WORKBENCH, listLoaded } from "@fresnel/client/workbench";
import { renderToString } from "react-dom/server";
import { createShellStore } from "../../../src/state/shell/index.ts";
import { createWorkbenchStore } from "../../../src/state/workbench/index.ts";
import type { PluginUiContextValue } from "../../../src/views/plugin/plugin-context.tsx";
import { pendingAddonRequest } from "../../../src/views/plugin/plugin-pick.ts";
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

describe("확장 상세의 플레이그라운드에서 보기", () => {
  test("shows the link when the extension has a page entry", async () => {
    const plugin = await loadedPluginUi([uiEntryOf({ extension: "web", placement: "page" })]);
    expect(detailOf("web", plugin)).toContain(LINK);
  });

  test("shows the link when a non-helm extension has a panel entry", async () => {
    const plugin = await loadedPluginUi([uiEntryOf({ extension: "web", placement: "panel" })]);
    expect(detailOf("web", plugin)).toContain(LINK);
  });

  test("shows the link for helm's panel entry too: the add-on detail lists it under conversation features", async () => {
    const plugin = await loadedPluginUi([uiEntryOf({ extension: "helm", placement: "panel" })]);
    expect(detailOf("helm", plugin)).toContain(LINK);
  });

  test("shows the link for a settings-only entry and hides it when the extension adds nothing", async () => {
    const plugin = await loadedPluginUi([
      uiEntryOf({ extension: "web", id: "settings", placement: "settings" }),
      uiEntryOf({ extension: "other", placement: "page" }),
    ]);
    expect(detailOf("web", plugin)).toContain(LINK);
    expect(detailOf("lint", plugin)).not.toContain(LINK);
    expect(detailOf("web", await loadedPluginUi([]))).not.toContain(LINK);
  });

  test("the link's action asks for that plugin's detail and switches to the chat area's plugins screen", () => {
    const store = createShellStore(1400);
    store.actions.switchArea("workbench");
    openPluginScreens(store.actions, "web");
    const state = store.read.getState();
    expect(state.area).toBe("chat");
    expect(state.places.chat.screen).toBe("plugins");
    expect(state.places.chat.scroll).toBe(0);
    expect(pendingAddonRequest()?.target).toEqual({ kind: "plugin", name: "web" });
  });
});
