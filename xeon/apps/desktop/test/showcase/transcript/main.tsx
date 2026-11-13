// 대화 줄 전시 화면(시험 전용, 제품 코드가 import하지 않는다). 고정 대화를 엔진 거울에 넣고 실제 줄 부품으로 그린다.
// 가상 목록 대신 줄을 모두 그린다(전체 화면 찍기). 문서는 스크롤하지 않으므로(styles.css) `<main>`이 스크롤 영역이다. 주소의 `?theme=dark|light`가 `<html data-theme>`를 정한다.
// 첫 그림과 코드 강조가 끝나면 `document.body.dataset.ready = "1"`이다.
import { setActiveLocale } from "@fresnel/client/i18n";
import { detach, ok, rethrow } from "@fresnel/contracts";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { createRoot } from "react-dom/client";
import { highlightCode } from "../../../src/lib/highlight.ts";
import { createPluginUiRuntime } from "../../../src/plugin-ui/runtime.ts";
import {
  useCompactionAnchors,
  useConvoMarkers,
  useLeadSegments,
  useTranscriptShapes,
  useTurnSummaries,
  type EngineMirror,
} from "../../../src/state/engine/index.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { createShellStore, ShellStoreContext } from "../../../src/state/shell/index.ts";
import { createUiStore } from "../../../src/state/ui/store.ts";
import {
  MessageActionsContext,
  type MessageActionsPort,
} from "../../../src/views/convo/message-actions.tsx";
import { TranscriptRowView } from "../../../src/views/item-view.tsx";
import { createConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import {
  PluginUiProvider,
  type PluginUiContextValue,
} from "../../../src/views/plugin/plugin-context.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { transcriptRowsOf } from "../../../src/views/transcript-rows.ts";
import { extGetOf, uiEntryOf } from "../../plugin-ui/support.ts";
import { fakeConnection } from "../../state/fake-connection.ts";
import { openedHarness } from "../../state/helpers.ts";
import { fakeCommands } from "../../views/fake-commands.ts";
import { compactionFact, CONVO, itemFacts, THREAD } from "./conversation.ts";
import { LONG_CONVO, longItemFacts } from "./long-conversation.ts";

// 화면 글은 제품 기본인 한국어로 고정한다(브라우저 언어와 상관없이)
setActiveLocale("ko");
const params = new URLSearchParams(window.location.search);
const theme = params.get("theme");
// `?set=long`이면 긴 줄 대화(넘침 재기, DP-180)를 그린다
const longSet = params.get("set") === "long";
document.documentElement.dataset["theme"] = theme === "light" ? "light" : "dark";

/** 읽기만 하는 고정 거울 */
function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

function mirror(): EngineMirror {
  const h = openedHarness(5, THREAD);
  const facts = longSet
    ? [...longItemFacts()]
    : [...itemFacts(), compactionFact()].toSorted((a, b) => a.seq - b.seq);
  h.store.ingest({ type: "batch", sub: "s1", from: 5, to: 200, caughtUp: true, facts });
  h.store.flush();
  const state = h.store.read.getState();
  return { ...state, convo: { ...state.convo, [THREAD]: longSet ? LONG_CONVO : CONVO } };
}

/** 확장 카드 하나(`x.helm.progress.saved`)를 아는 플러그인 문맥 */
async function pluginUi(): Promise<PluginUiContextValue> {
  const card = uiEntryOf({
    id: "progress",
    placement: "card",
    title: "진행 상황",
    forKind: "x.helm.progress.saved",
    tree: { type: "Chip", bind: { text: { path: "/lens" } } },
  });
  const fake = fakeConnection({
    "ext.ui.list": () => Promise.resolve({ items: [card] }),
    "ext.list": () => Promise.resolve({ extensions: [] }),
    "ext.get": () => Promise.resolve(extGetOf()),
    "settings.get": () => Promise.resolve({ settings: [] }),
  });
  const runtime = createPluginUiRuntime({
    withConnection: async (run) => ok(await run(fake.connection)),
    appRootsInvoke: undefined,
    framesSupported: false,
  });
  await runtime.refresh();
  return { runtime, confirm: createConfirmQueue(), openExternal: () => Promise.resolve() };
}

const noAction: MessageActionsPort = {
  forkAt: () => Promise.resolve(ok(null)),
  rewindTo: () => Promise.resolve(ok(null)),
  regenerate: () => Promise.resolve(ok(null)),
};

/** 열린 대화의 줄을 가상 목록 없이 모두 그린다(`transcript.tsx`의 `ThreadRows`와 같은 줄 모델) */
function AllRows(): ReactNode {
  const shapes = useTranscriptShapes();
  const anchors = useCompactionAnchors(THREAD);
  const turns = useTurnSummaries(THREAD);
  const markers = useConvoMarkers(THREAD);
  const leads = useLeadSegments(THREAD);
  const rows = useMemo(
    () =>
      transcriptRowsOf({
        shapes,
        live: [],
        showLive: true,
        anchors,
        turns,
        markers,
        leads,
        running: false,
      }),
    [anchors, leads, markers, shapes, turns],
  );
  return (
    <main
      data-showcase="transcript"
      style={{
        height: "100%",
        overflowY: "auto",
        paddingBlock: 32,
        background: "var(--cs-color-surface-base)",
      }}
    >
      {rows.map((row) => (
        <TranscriptRowView key={row.key} threadId={THREAD} row={row} unsentId={null} />
      ))}
    </main>
  );
}

/** 모든 코드 블록이 칠해졌으면 참 */
function highlighted(): boolean {
  const blocks = [...document.querySelectorAll(".convo-code-body code")];
  return blocks.length > 0 && blocks.every((code) => code.querySelector("span.block") !== null);
}

/** 그림이 끝나면 준비 표식을 단다. 10초 안에 칠해지지 않아도 표식은 단다(`data-ready-late`) */
function markReady(): void {
  const deadline = performance.now() + 10000;
  const tick = (): void => {
    if (highlighted() || performance.now() > deadline) {
      if (!highlighted()) document.body.dataset["readyLate"] = "1";
      document.body.dataset["ready"] = "1";
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function start(): Promise<void> {
  // 강조 문법을 먼저 읽어 둔다(첫 그림 뒤 칠하기가 빨리 끝난다)
  await Promise.all([highlightCode("x", "ts"), highlightCode("x", "bash")]);
  const plugin = await pluginUi();
  const host = document.getElementById("root");
  if (host === null) return;
  createRoot(host).render(
    <ShellStoreContext value={createShellStore(1440)}>
      <Providers engine={frozen(mirror())} ui={createUiStore().read} commands={fakeCommands()}>
        <PluginUiProvider value={plugin}>
          <MessageActionsContext value={noAction}>
            <AllRows />
          </MessageActionsContext>
        </PluginUiProvider>
      </Providers>
    </ShellStoreContext>,
  );
  markReady();
}

detach(start(), rethrow);
