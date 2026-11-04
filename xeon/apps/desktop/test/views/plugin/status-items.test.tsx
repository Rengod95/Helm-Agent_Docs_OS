import { describe, expect, test } from "bun:test";
import { renderToString } from "react-dom/server";
import { createUiStore, type UiState } from "../../../src/state/ui/index.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { PluginUiProvider } from "../../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { StatusBar } from "../../../src/views/status-bar.tsx";
import { harness, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";
import { loadedPluginUi } from "./support.tsx";

// 상태 표시줄의 대화 상태 칸(B-09). 거울에 든 `status.list` 스냅숏을 열린 대화 것만 그린다. 글은 칸 소유자가 정한 한 줄이다.

function uiReadOf(threadOpen: boolean): ReadonlyStore<UiState> {
  const store = createUiStore();
  if (threadOpen) store.actions.selectThread(thr(1));
  const state = store.read.getState();
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => undefined };
}

async function barOf(options: {
  readonly threadOpen: boolean;
  readonly seedThread: number;
}): Promise<string> {
  const h = harness();
  h.store.ingest({
    type: "status",
    threadId: thr(options.seedThread),
    items: [
      { id: "core.turn", text: "작업 중 · 2단계", tone: "busy" },
      { id: "helm.phase", text: "검토 대기", tone: "warn", order: 10 },
      { id: "core.cost", text: "$0.12" },
    ],
  });
  h.store.flush();
  const plugin = await loadedPluginUi([]);
  // 서버 렌더는 시작 상태(`getInitialState`)를 읽으므로 커밋한 상태를 시작 상태로 내놓는다
  const committed = h.store.read.getState();
  const engine: typeof h.store.read = {
    getState: () => committed,
    getInitialState: () => committed,
    subscribe: () => () => undefined,
  };
  return renderToString(
    <Providers engine={engine} ui={uiReadOf(options.threadOpen)} commands={fakeCommands()}>
      <PluginUiProvider value={plugin}>
        <StatusBar />
      </PluginUiProvider>
    </Providers>,
  );
}

const itemsOf = (html: string): string[] =>
  [...html.matchAll(/data-status-item="([^"]*)"/g)].map((match) => match[1] ?? "");

describe("status items in the status bar", () => {
  test("the open thread's items show in order, with the warn tone class and a busy marker", async () => {
    const html = await barOf({ threadOpen: true, seedThread: 1 });
    expect(itemsOf(html)).toEqual(["helm.phase", "core.turn", "core.cost"]);
    expect(html).toContain("검토 대기");
    expect(html).toMatch(/class="[^"]*\bwarn\b[^"]*"[^>]*data-status-item="helm.phase"/);
    expect(html).toMatch(/data-status-item="core.turn" aria-busy="true"/);
  });

  test("another thread's items and a closed thread show nothing", async () => {
    expect(itemsOf(await barOf({ threadOpen: true, seedThread: 2 }))).toEqual([]);
    expect(itemsOf(await barOf({ threadOpen: false, seedThread: 1 }))).toEqual([]);
  });
});
