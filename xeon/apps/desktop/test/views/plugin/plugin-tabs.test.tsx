import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { ExtUiEntry, HostConnection } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createPluginUiRuntime } from "../../../src/plugin-ui/runtime.ts";
import { createUiStore } from "../../../src/state/ui/store.ts";
import { createConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import { PluginUiProvider } from "../../../src/views/plugin/plugin-context.tsx";
import { HelmPanelTab, PluginPagesTab } from "../../../src/views/plugin/plugin-tabs.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { uiEntryOf } from "../../plugin-ui/support.ts";
import { openedHarness } from "../../state/helpers.ts";
import { fakeConnection } from "../../state/fake-connection.ts";
import { fakeCommands } from "../fake-commands.ts";

// Helm 옆 패널과 플러그인 탭이 항목을 배치별로 골라 그린다. 서버 렌더는 효과를 돌리지 않으므로 첫 장면(머리, 상태 글)만 본다.

async function render(entries: readonly ExtUiEntry[], tab: "helm" | "pages"): Promise<string> {
  const fake = fakeConnection({
    "ext.ui.list": () => Promise.resolve({ items: [...entries] }),
    "ext.list": () => Promise.resolve({ extensions: [] }),
    "settings.get": () => Promise.resolve({ settings: [] }),
  });
  const runtime = createPluginUiRuntime({
    withConnection: async <T,>(run: (connection: HostConnection) => Promise<T>) =>
      ok(await run(fake.connection)),
    appRootsInvoke: undefined,
    framesSupported: true,
  });
  await runtime.refresh();
  const harness = openedHarness();
  return renderToString(
    <Providers engine={harness.store.read} ui={createUiStore().read} commands={fakeCommands()}>
      <PluginUiProvider
        value={{ runtime, confirm: createConfirmQueue(), openExternal: () => Promise.resolve() }}
      >
        {tab === "helm" ? <HelmPanelTab /> : <PluginPagesTab />}
      </PluginUiProvider>
    </Providers>,
  );
}

describe("plugin tabs", () => {
  test("the Helm tab shows only helm's panel entry, under the shell header", async () => {
    const html = await render(
      [
        uiEntryOf({ id: "panel", placement: "panel", title: "Helm 패널" }),
        uiEntryOf({ id: "page", placement: "page", title: "쪽" }),
        uiEntryOf({ extension: "other", id: "panel", placement: "panel", title: "다른 패널" }),
      ],
      "helm",
    );
    expect(html).toContain("Helm 패널");
    // 서버 렌더는 이어 붙인 글 사이에 주석 표지를 넣는다
    expect(html.replaceAll("<!-- -->", "")).toContain("helm · v0.1.0");
    expect(html).not.toContain("다른 패널");
    expect(html).not.toContain(">쪽<");
  });

  test("the Helm tab says the extension has no views when nothing is placed", async () => {
    const html = await render([], "helm");
    expect(html).toContain("이 확장은 화면을 내지 않아요");
  });

  test("the pages tab lists pages and non-helm panels, and shows an invalid entry's reason", async () => {
    const html = await render(
      [
        uiEntryOf({
          extension: "other",
          id: "bad",
          placement: "page",
          title: "고장",
          state: "invalid",
          issues: [{ severity: "error", code: "tree_invalid", message: "bad tree" }],
        }),
        uiEntryOf({ id: "panel", placement: "panel", title: "Helm 패널" }),
      ],
      "pages",
    );
    expect(html).toContain("고장");
    expect(html).toContain("이 화면을 열 수 없어요: bad tree");
    expect(html).not.toContain("Helm 패널");
  });
});
