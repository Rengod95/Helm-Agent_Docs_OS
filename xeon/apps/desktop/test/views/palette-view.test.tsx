import { describe, expect, test } from "bun:test";
import { LEDGER_DISABLE_AFTER } from "@fresnel/client/views/ledger";
import type { ExtListResult, ExtUiEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createShellStore, ShellStoreContext } from "../../src/state/shell/index.ts";
import type { ReadonlyStore } from "../../src/state/shared/readonly-store.ts";
import type { EngineMirror } from "../../src/state/engine/index.ts";
import { createUiStore, type UiState } from "../../src/state/ui/store.ts";
import { PaletteBody } from "../../src/views/palette/palette.tsx";
import { PluginUiProvider } from "../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../src/views/providers.tsx";
import { extListEntryOf, uiEntryOf } from "../plugin-ui/support.ts";
import { harness, STORE, SUB, summary, thr } from "../state/helpers.ts";
import { fakeCommands } from "./fake-commands.ts";
import { loadedPluginUi } from "./plugin/support.tsx";

// 팔레트 본문을 서버에서 그린다. Dialog는 포털이라 SSR에 그려지지 않으므로 본문만 본다.
// SSR의 스토어 읽기는 `getInitialState`를 쓰므로(zustand) 값을 가진 읽기 면을 고정해서 넘긴다(approval-card-mounts와 같은 방식).
// 읽기(`command.list`, 설정 목록)는 효과가 하므로 여기서는 읽는 중 상태가 처음 그림이다.
// 플러그인 명령은 확장 목록을 먼저 읽어야 하므로(`loadedPluginUi`) 그릴 때 이미 들어 있다.

function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

async function render(input: {
  readonly live: boolean;
  readonly titles: readonly string[];
  readonly selected: boolean;
  readonly plugins?: readonly ExtUiEntry[];
  readonly extensions?: ExtListResult["extensions"];
  /** 장부가 이 화면 키들을 `view_disabled`로 끈 상태로 그린다(연속 실패 다섯 번) */
  readonly disabledViews?: readonly string[];
}): Promise<string> {
  const h = harness();
  if (input.live) {
    h.store.ingest({
      type: "subscribed",
      sub: SUB,
      storeId: STORE,
      start: 5,
      live: true,
      from: "head",
    });
  }
  h.store.ingest({
    type: "threads",
    threads: input.titles.map((title, index) => summary(thr(index + 1), { title })),
  });
  h.store.flush();
  const ui = createUiStore();
  const uiState: UiState = {
    ...ui.read.getState(),
    selectedThreadId: input.selected ? thr(1) : null,
  };
  const engine: EngineMirror = h.store.read.getState();
  const shell = createShellStore(1400);
  const plugin = await loadedPluginUi(input.plugins ?? [], input.extensions);
  for (const key of input.disabledViews ?? []) {
    for (let count = 0; count < LEDGER_DISABLE_AFTER; count += 1) {
      plugin.runtime.ledger.fail(key, "query_failed");
    }
  }
  return renderToString(
    <Providers engine={frozen(engine)} ui={frozen(uiState)} commands={fakeCommands()}>
      <PluginUiProvider value={plugin}>
        <ShellStoreContext value={shell}>
          <PaletteBody mac onRun={() => {}} />
        </ShellStoreContext>
      </PluginUiProvider>
    </Providers>,
  );
}

const SEVEN = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf"];

describe("palette body (server render)", () => {
  test("offline the palette shows the app actions and the offline notice only", async () => {
    const html = await render({ live: false, titles: ["alpha"], selected: true });
    expect(html).toContain("새 대화");
    expect(html).toContain("엔진에 연결되면");
    expect(html).not.toContain("명령 목록을 읽고 있어요");
    expect(html).not.toContain("설정 항목을 읽고 있어요");
    expect(html).not.toContain("alpha");
  });

  test("connected with an open thread the slash and settings groups show while they load", async () => {
    const html = await render({ live: true, titles: ["alpha"], selected: true });
    expect(html).toContain("alpha");
    expect(html).toContain("슬래시 명령");
    expect(html).toContain("명령 목록을 읽고 있어요");
    expect(html).toContain("설정");
    expect(html).toContain("설정 항목을 읽고 있어요");
    expect(html).not.toContain("엔진에 연결되면");
  });

  test("connected without an open thread the slash group is left out", async () => {
    const html = await render({ live: true, titles: [], selected: false });
    expect(html).not.toContain("슬래시 명령");
    expect(html).not.toContain("명령 목록을 읽고 있어요");
    expect(html).toContain("설정 항목을 읽고 있어요");
  });

  test("a group shows five rows and a more row for the rest", async () => {
    const html = await render({ live: true, titles: SEVEN, selected: false });
    expect(html).toContain("echo");
    expect(html).not.toContain("foxtrot");
    expect(html).not.toContain("golf");
    expect(html).toContain("더 보기");
  });
});

const START = uiEntryOf({ id: "helm-start", placement: "command", title: "탐구 시작…" });

describe("palette plugin group (server render)", () => {
  test("with an open thread a plugin command shows in its group with its extension name", async () => {
    const html = await render({ live: true, titles: [], selected: true, plugins: [START] });
    expect(html).toContain("플러그인");
    expect(html).toContain("탐구 시작…");
    expect(html).toContain("helm");
  });

  test("without an open thread the plugin group is left out", async () => {
    const html = await render({ live: true, titles: [], selected: false, plugins: [START] });
    expect(html).not.toContain("플러그인");
    expect(html).not.toContain("탐구 시작…");
  });

  test("a switched-off extension's command is left out", async () => {
    const html = await render({
      live: true,
      titles: [],
      selected: true,
      plugins: [START],
      extensions: [extListEntryOf("helm", { status: "disabled" })],
    });
    expect(html).not.toContain("플러그인");
    expect(html).not.toContain("탐구 시작…");
  });

  test("a command whose view the ledger turned off is left out, and its sibling stays", async () => {
    const other = uiEntryOf({ id: "other", placement: "command", title: "다른 명령" });
    const html = await render({
      live: true,
      titles: [],
      selected: true,
      plugins: [START, other],
      disabledViews: ["helm/helm-start"],
    });
    expect(html).not.toContain("탐구 시작…");
    expect(html).toContain("helm · 다른 명령");
  });

  test("a plugin command's row names its extension before its title", async () => {
    const html = await render({ live: true, titles: [], selected: true, plugins: [START] });
    expect(html).toContain("helm · 탐구 시작…");
  });

  test("a command whose state is not ok is left out", async () => {
    const html = await render({
      live: true,
      titles: [],
      selected: true,
      plugins: [
        uiEntryOf({ id: "off", placement: "command", title: "끈 명령", state: "disabled" }),
      ],
    });
    expect(html).not.toContain("플러그인");
    expect(html).not.toContain("끈 명령");
  });
});

describe("palette hand-offs in the ui store", () => {
  test("a settings jump opens the settings screen and stays until the screen settles it", () => {
    const ui = createUiStore();
    ui.actions.requestSettingsJump({ tab: "sandbox", key: "l1.sandbox.paths" });
    expect(ui.read.getState().screen).toBe("settings");
    expect(ui.read.getState().settingsJump).toEqual({ tab: "sandbox", key: "l1.sandbox.paths" });
    ui.actions.settleSettingsJump();
    expect(ui.read.getState().settingsJump).toBeNull();
    expect(ui.read.getState().screen).toBe("settings");
  });

  test("a composer request carries its insert text until the input settles it", () => {
    const ui = createUiStore();
    ui.actions.requestComposer("/helm ");
    expect(ui.read.getState().composerRequest).toEqual({ insert: "/helm " });
    ui.actions.requestComposer(null);
    expect(ui.read.getState().composerRequest).toEqual({ insert: null });
    ui.actions.settleComposerRequest();
    expect(ui.read.getState().composerRequest).toBeNull();
  });
});
