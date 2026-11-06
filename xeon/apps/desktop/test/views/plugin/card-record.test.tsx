import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import type { ItemRecord, JsonValue } from "@fresnel/contracts/conversation";
import type { UiNode } from "@fresnel/contracts/extensions";
import type { ExtUiEntry } from "@fresnel/contracts/wire";
import { renderToString } from "react-dom/server";
import { policyContextOf } from "../../../src/plugin-ui/policy-context.ts";
import type { ReadonlyStore } from "../../../src/state/shared/readonly-store.ts";
import { createUiStore } from "../../../src/state/ui/store.ts";
import { RecordedItem } from "../../../src/views/item-view.tsx";
import {
  PluginUiProvider,
  type PluginUiContextValue,
} from "../../../src/views/plugin/plugin-context.tsx";
import { NativeSurface, type Loaded } from "../../../src/views/plugin/plugin-view.tsx";
import { Providers } from "../../../src/views/providers.tsx";
import { extGetOf, extListEntryOf, uiEntryOf } from "../../plugin-ui/support.ts";
import { fakeConnection } from "../../state/fake-connection.ts";
import { itm, openedHarness, recorded, SUB, thr } from "../../state/helpers.ts";
import { fakeCommands } from "../fake-commands.ts";
import { emptyPluginUi, loadedPluginUi } from "./support.tsx";

// 트랜스크립트의 카드. 기록 종류(`customType`)가 카드의 `forKind`와 같으면 그 화면을 기록의 details로 그리고 출처 줄을 덧붙인다.
// 서버 렌더는 효과를 돌리지 않으므로 확장 문맥(`ext.get`)을 읽기 전의 첫 장면을 본다.
// 트리의 글은 고정 문서로 그리는 `NativeSurface`로 본다(기록 자리의 카드는 문맥을 읽은 뒤에 그 글이 나온다).

const CARD_TREE: UiNode = { type: "Chip", bind: { text: { path: "/lens" } } };
const FINISHED: ExtUiEntry = uiEntryOf({
  id: "helm-finished",
  placement: "card",
  title: "탐구 결과",
  forKind: "grp.helm.inquiry.finished",
  tree: CARD_TREE,
});
const SAVED: ExtUiEntry = uiEntryOf({
  id: "saved",
  placement: "card",
  title: "메모",
  forKind: "x.helm.note.saved",
  tree: CARD_TREE,
});

/** 확장 기록 하나. 종류 이름과 details를 싣는다 */
function customOf(n: number, customType: string, details: JsonValue): ItemRecord {
  return {
    itemId: itm(n),
    status: "completed",
    kind: "custom",
    message: { role: "custom", customType, content: "ctx", display: true, details, timestamp: 0 },
  };
}

/** 서버 렌더는 getInitialState를 읽는다. 초기 상태가 곧 그 상태인 읽기 전용 스토어 */
function frozen<T>(state: T): ReadonlyStore<T> {
  return { getState: () => state, getInitialState: () => state, subscribe: () => () => {} };
}

/** 열린 대화에 기록 하나를 넣고 그 행을 그린 글 */
function renderRecord(record: ItemRecord, plugin: PluginUiContextValue): string {
  const h = openedHarness();
  h.store.ingest({
    type: "batch",
    sub: SUB,
    from: 5,
    to: 6,
    caughtUp: true,
    facts: [recorded(6, record)],
  });
  h.store.flush();
  return renderToString(
    <Providers
      engine={frozen(h.store.read.getState())}
      ui={createUiStore().read}
      commands={fakeCommands()}
    >
      <PluginUiProvider value={plugin}>
        <RecordedItem id={itm(1)} />
      </PluginUiProvider>
    </Providers>,
  );
}

describe("a card's tree reads the fixed record document", () => {
  test("the record's details fill the tree text and no extension read happens", () => {
    const connection = fakeConnection({});
    const built = policyContextOf({
      get: extGetOf(),
      entry: FINISHED,
      openThreadId: thr(1),
      commands: [],
    });
    if (!built.ok) throw new Error(`policy context: ${built.error.kind}`);
    const loaded: Loaded = { connection: connection.connection, context: built.value };
    const html = renderToString(
      <Providers
        engine={frozen(openedHarness().store.read.getState())}
        ui={createUiStore().read}
        commands={fakeCommands()}
      >
        <PluginUiProvider value={emptyPluginUi()}>
          <NativeSurface entry={FINISHED} loaded={loaded} doc={{ lens: "실패 사례" }} dense />
        </PluginUiProvider>
      </Providers>,
    );
    expect(html).toContain("실패 사례");
    expect(connection.calls).toEqual([]);
  });
});

describe("custom records in the transcript", () => {
  test("a record whose type is a card's kind is drawn as the card with its group provenance", async () => {
    const plugin = await loadedPluginUi([FINISHED, SAVED]);
    const html = renderRecord(
      customOf(1, "grp.helm.inquiry.finished", { lens: "실패 사례" }),
      plugin,
    );
    expect(html).toContain("grp:helm");
    expect(html).toContain(t("desktop.plugin.state.loading"));
    expect(html).not.toContain("grp.helm.inquiry.finished");
  });

  test("an extension's own card kind gets the ext provenance line", async () => {
    const plugin = await loadedPluginUi([FINISHED, SAVED]);
    const html = renderRecord(customOf(1, "x.helm.note.saved", { lens: "메모" }), plugin);
    expect(html).toContain("ext:helm");
    expect(html).not.toContain("grp:helm");
    expect(html).not.toContain("x.helm.note.saved");
  });

  test("a record without a card shows its text instead of the type name and draws no provenance line", async () => {
    const plugin = await loadedPluginUi([FINISHED, SAVED]);
    const html = renderRecord(customOf(1, "x.knowledge.context", {}), plugin);
    expect(html).toContain("ctx");
    expect(html).not.toContain("x.knowledge.context");
    expect(html).not.toContain("grp:");
    expect(html).not.toContain("ext:");
  });

  test("a card of a switched-off extension falls back to its text", async () => {
    const plugin = await loadedPluginUi(
      [FINISHED],
      [extListEntryOf("helm", { status: "disabled" })],
    );
    const html = renderRecord(
      customOf(1, "grp.helm.inquiry.finished", { lens: "실패 사례" }),
      plugin,
    );
    expect(html).toContain("ctx");
    expect(html).not.toContain("grp.helm.inquiry.finished");
    expect(html).not.toContain("grp:helm");
    expect(html).not.toContain(t("desktop.plugin.state.loading"));
  });
});
