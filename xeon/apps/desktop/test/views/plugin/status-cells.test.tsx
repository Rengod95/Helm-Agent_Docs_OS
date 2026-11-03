import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { UiNode } from "@fresnel/contracts/extensions";
import type { ExtListResult, ExtUiEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { createUiStore, type UiState } from "../../../src/state/ui/index.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { PluginUiProvider } from "../../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { StatusBar } from "../../../src/views/status-bar.tsx";
import { appEntryOf, extListEntryOf, uiEntryOf } from "../../plugin-ui/support.ts";
import { harness, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";
import { loadedPluginUi } from "./support.tsx";

// 상태 표시줄의 확장 칸. 열린 대화가 있을 때만 그리고, 꺼진 확장은 그리지 않는다(ADR-0021 §3.2).
// 서버 렌더는 효과를 돌리지 않으므로 칸의 본문은 첫 장면(읽는 중 글)으로 본다.

const TEXT_TREE: UiNode = { type: "Chip", bind: { text: { path: "/status/phase" } } };

/** 열린 대화를 고른 ui 읽기 면. 서버 렌더는 시작 상태를 읽으므로 고른 상태를 두 값으로 둔다 */
function uiReadOf(threadOpen: boolean): ReadonlyStore<UiState> {
  const store = createUiStore();
  if (threadOpen) store.actions.selectThread(thr(1));
  const state = store.read.getState();
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => undefined };
}

/** 상태 표시줄을 그린 글. 열린 대화 여부와 확장 목록을 고른다 */
async function barOf(options: {
  readonly threadOpen: boolean;
  readonly entries: readonly ExtUiEntry[];
  readonly extensions?: ExtListResult["extensions"];
}): Promise<string> {
  const plugin = await loadedPluginUi(options.entries, options.extensions);
  return renderToString(
    <Providers
      engine={harness().store.read}
      ui={uiReadOf(options.threadOpen)}
      commands={fakeCommands()}
    >
      <PluginUiProvider value={plugin}>
        <StatusBar />
      </PluginUiProvider>
    </Providers>,
  );
}

/** 칸으로 그려진 화면 키, 그린 순서대로 */
const cellsOf = (html: string): string[] =>
  [...html.matchAll(/data-status-cell="([^"]*)"/g)].map((match) => match[1] ?? "");

const PHASE = uiEntryOf({ id: "phase", placement: "status", title: "단계", tree: TEXT_TREE });

describe("status cells in the status bar", () => {
  test("one cell per ok native status entry shows while a thread is open, and reads its document first", async () => {
    const html = await barOf({
      threadOpen: true,
      entries: [PHASE, uiEntryOf({ id: "goal", placement: "status", tree: TEXT_TREE })],
    });
    expect(cellsOf(html)).toEqual(["helm/goal", "helm/phase"]);
    expect(html).toContain(t("desktop.plugin.state.loading"));
  });

  test("no cell is drawn without an open thread", async () => {
    const html = await barOf({ threadOpen: false, entries: [PHASE] });
    expect(cellsOf(html)).toEqual([]);
    expect(html).not.toContain(t("desktop.plugin.state.loading"));
  });

  test("a disabled extension's cell is not drawn even with a thread open", async () => {
    const html = await barOf({
      threadOpen: true,
      entries: [PHASE],
      extensions: [extListEntryOf("helm", { status: "disabled" })],
    });
    expect(cellsOf(html)).toEqual([]);
  });

  test("only ok native entries with a tree get a cell", async () => {
    const html = await barOf({
      threadOpen: true,
      entries: [
        uiEntryOf({ id: "off", placement: "status", state: "disabled", tree: TEXT_TREE }),
        uiEntryOf({ id: "bare", placement: "status" }),
        appEntryOf({ id: "app", placement: "status" }),
        PHASE,
      ],
    });
    expect(cellsOf(html)).toEqual(["helm/phase"]);
  });
});
