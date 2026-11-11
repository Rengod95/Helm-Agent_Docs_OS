import { describe, expect, test } from "bun:test";
import { ok } from "@fresnel/contracts";
import type { ExtUiEntry, HostConnection } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createPluginUiRuntime } from "../../../src/plugin-ui/runtime.ts";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { createUiStore } from "../../../src/state/ui/store.ts";
import { createConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import { PluginUiProvider } from "../../../src/views/plugin/plugin-context.tsx";
import { AddonsScreen } from "../../../src/views/plugin/addons-screen.tsx";
import { createWorkbenchStore, WorkbenchStoreContext } from "../../../src/state/workbench/index.ts";
import { Providers } from "../../../src/views/providers.tsx";
import { uiEntryOf } from "../../plugin-ui/support.ts";
import { openedHarness } from "../../state/helpers.ts";
import { fakeConnection } from "../../state/fake-connection.ts";
import { fakeCommands } from "../fake-commands.ts";

// 추가 기능 화면의 첫 장면(목록과 빈 상태). 서버 렌더는 효과를 돌리지 않는다.

async function render(entries: readonly ExtUiEntry[]): Promise<string> {
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
      <ShellStoreContext value={createShellStore(1280)}>
        <PluginUiProvider
          value={{ runtime, confirm: createConfirmQueue(), openExternal: () => Promise.resolve() }}
        >
          <WorkbenchStoreContext value={createWorkbenchStore()}>
            <AddonsScreen />
          </WorkbenchStoreContext>
        </PluginUiProvider>
      </ShellStoreContext>
    </Providers>,
  );
}

describe("AddonsScreen", () => {
  test("with no screens it shows what the place is for and the two ways in", async () => {
    const html = await render([]);
    expect(html).toContain("추가 기능 없음");
    expect(html).toContain("플러그인 찾기");
    expect(html).toContain("플러그인 만들기");
  });

  test("the list has one row per plugin with its screen titles and count", async () => {
    const html = await render([
      uiEntryOf({ extension: "alpha", id: "a", title: "개요" }),
      uiEntryOf({ extension: "alpha", id: "b", title: "기록" }),
      uiEntryOf({ extension: "beta", id: "c", title: "보드" }),
    ]);
    const text = html.replaceAll("<!-- -->", "");
    expect(text).toContain("개요, 기록");
    expect(text).toContain("화면 2개");
    expect(text).toContain("화면 1개");
    expect(text).toContain("보드");
  });
});
