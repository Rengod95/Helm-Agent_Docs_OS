import { describe, expect, test } from "bun:test";
import { t } from "@fresnel/client/i18n";
import {
  createActionRunner,
  type ActionRunner,
  type BridgeBackend,
  type BridgePolicyContext,
} from "@fresnel/client/views/app";
import { createScreenLedger } from "@fresnel/client/views/ledger";
import {
  boardLayoutOf,
  moveCard,
  type BoardLayout,
  type ResolvedNode,
} from "@fresnel/client/views/native";
import { renderToString } from "react-dom/server";
import { createBridgeBackend } from "../../../src/plugin-ui/backend.ts";
import { policyContextOf } from "../../../src/plugin-ui/policy-context.ts";
import { createConfirmQueue, type ConfirmQueue } from "../../../src/views/plugin/confirm-host.tsx";
import {
  basisOf,
  commitDraft,
  shownOf,
  type Draft,
} from "../../../src/views/plugin/native-board-model.ts";
import { methodRefused, treeActionsOf } from "../../../src/views/plugin/native-run.ts";
import { NativeTree, type NativeTreeActions } from "../../../src/views/plugin/native-tree.tsx";
import { extGetOf, HELM_MANIFEST, uiEntryOf } from "../../plugin-ui/support.ts";
import { fakeConnection } from "../../state/fake-connection.ts";
import { thr } from "../../state/helpers.ts";

// 보드와 순서 목록: 그리기(서버 렌더), 옮기기가 쓰기 메서드를 맞는 인자로 부르는 길(실행기, 확인 줄, 연결 대역), 실패 때 되돌림.
// 끌기와 키보드의 자리 계산은 client의 board.test.ts가 값으로 본다. 여기서는 그 결과가 메서드 인자가 되는 길을 본다.

const SCREEN_KEY = "helm/board";
const OPEN_THREAD = thr(1);

const COLUMNS = [
  { id: "todo", title: "할 일" },
  { id: "doing", title: "진행 중" },
  { id: "done", title: "끝" },
];
const CARDS = [
  { id: "c1", title: "첫 카드", column: "todo", order: 0, detail: "보조 글", tag: "ui" },
  { id: "c2", title: "둘째 카드", column: "todo", order: 1 },
  { id: "c3", title: "셋째 카드", column: "doing", order: 0 },
];

function boardNode(props: ResolvedNode["props"]): ResolvedNode {
  return { type: "Board", props, children: [], lists: { columns: COLUMNS, cards: CARDS } };
}

const calls: string[] = [];
const quiet: NativeTreeActions = {
  runCommand: () => {},
  callMethod: (verb) => {
    calls.push(verb);
    return Promise.resolve(true);
  },
  openLink: () => {},
};

function html(root: ResolvedNode): string {
  return renderToString(<NativeTree root={root} actions={quiet} />);
}

describe("Board draws columns and cards from the bound lists", () => {
  test("column titles, counts, card text, the empty column line, and one add button per column", () => {
    const out = html(boardNode({ move: "move", add: "add" }));
    for (const text of [
      "할 일",
      "진행 중",
      "끝",
      "첫 카드",
      "보조 글",
      "ui",
      "둘째 카드",
      "셋째 카드",
    ]) {
      expect(out).toContain(`>${text}<`);
    }
    expect(out).toContain(t("desktop.plugin.board.count", { count: 2 }));
    expect(out).toContain(t("desktop.plugin.board.count", { count: 0 }));
    expect(out).toContain(t("desktop.plugin.board.empty"));
    expect(out.split(`data-board-card="`).length - 1).toBe(3);
    expect(out.split(t("desktop.plugin.board.add")).length - 1).toBe(3);
    expect(out).toContain('role="button"');
    expect(out).toContain(t("desktop.plugin.board.instructions"));
    expect(calls).toEqual([]);
  });

  test("without move the cards are not focusable buttons, and without add there is no add button", () => {
    const out = html(boardNode({}));
    expect(out).not.toContain('role="button"');
    expect(out).not.toContain("tabindex");
    expect(out).not.toContain(t("desktop.plugin.board.add"));
  });

  test("a long title is drawn whole in one truncated line and kept in the title attribute", () => {
    const long = "아주 긴 제목 ".repeat(20).trim();
    const out = html({
      type: "Board",
      props: {},
      children: [],
      lists: { columns: COLUMNS, cards: [{ id: "x", title: long, column: "todo" }] },
    });
    expect(out).toContain(`title="${long}"`);
    expect(out).toContain("truncate");
  });
});

describe("SortableList draws a caustic list", () => {
  const items = [
    { id: "a", title: "Alpha", detail: "first" },
    { id: "b", title: "Beta" },
  ];
  test("with move the rows get reorder handles named after the row title", () => {
    const out = html({
      type: "SortableList",
      props: { move: "reorder" },
      children: [],
      lists: { items },
    });
    expect(out).toContain(">Alpha<");
    expect(out).toContain(">first<");
    expect(out).toContain(t("desktop.plugin.sortable.handle", { title: "Beta" }));
  });

  test("without move it is a plain list, and an empty list shows the empty line", () => {
    const plain = html({ type: "SortableList", props: {}, children: [], lists: { items } });
    expect(plain).not.toContain(t("desktop.plugin.sortable.handle", { title: "Beta" }));
    const empty = html({ type: "SortableList", props: {}, children: [], lists: { items: [] } });
    expect(empty).toContain(t("desktop.plugin.sortable.empty"));
  });
});

// ---------- 쓰기 메서드를 부르는 길 ----------

/** 칸반 모양의 매니페스트: move는 자기 데이터만 바꾸고, shuffle은 표시가 없어 확인 줄을 거친다 */
const MANIFEST: Readonly<Record<string, unknown>> = {
  ...HELM_MANIFEST,
  methods: [
    { verb: "board", params: {}, result: {}, readOnly: true },
    {
      verb: "move",
      params: {},
      result: {},
      readOnly: false,
      label: "카드 옮기기",
      ownDataOnly: true,
    },
    { verb: "shuffle", params: {}, result: {}, readOnly: false, label: "카드 섞기" },
    { verb: "reset", params: {}, result: {}, readOnly: false, approval: true },
  ],
};

function contextOf(): BridgePolicyContext {
  const built = policyContextOf({
    get: extGetOf(MANIFEST),
    entry: uiEntryOf({ id: "board" }),
    openThreadId: OPEN_THREAD,
    commands: [],
  });
  if (!built.ok) throw new Error(`policy context: ${built.error.kind}`);
  return built.value;
}

function backendOf(
  connection: ReturnType<typeof fakeConnection>,
  context: BridgePolicyContext,
): BridgeBackend {
  return createBridgeBackend({
    connection: () => connection.connection,
    extension: "helm",
    screen: "board",
    openThreadId: () => OPEN_THREAD,
    policy: () => context,
    snapshot: () => ({
      threadId: OPEN_THREAD,
      threadTitle: undefined,
      connection: "connected",
      locale: "ko-KR",
      theme: "light",
      extension: { enabled: true, trust: "user", safeMode: false },
    }),
    navigate: () => false,
    openExternal: () => Promise.resolve(),
    resize: () => {},
    diagnostic: () => {},
  });
}

function runnerOf(
  backend: BridgeBackend,
  context: BridgePolicyContext,
  queue: ConfirmQueue,
): ActionRunner {
  return createActionRunner({
    screenKey: SCREEN_KEY,
    context: () => context,
    backend,
    ledger: createScreenLedger(),
    clock: { now: () => 0 },
    scheduler: { setTimeout: () => 0, clearTimeout: () => {} },
    confirm: queue.request,
    cancelConfirm: queue.cancel,
    recheck: () => Promise.resolve(context),
    onDisabled: () => {},
  });
}

function actionsOf(
  connection: ReturnType<typeof fakeConnection>,
  queue: ConfirmQueue,
): NativeTreeActions {
  const context = contextOf();
  return treeActionsOf({
    runner: runnerOf(backendOf(connection, context), context, queue),
    context: () => context,
    ledger: createScreenLedger(),
    screenKey: SCREEN_KEY,
    openChat: () => {},
  });
}

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function extCallsOf(
  connection: ReturnType<typeof fakeConnection>,
): readonly { readonly method: string; readonly params: unknown }[] {
  return connection.calls.filter((call) => call.method.startsWith("ext.helm."));
}

describe("a board move calls the declared write method with the card, the column and the index", () => {
  test("an ownDataOnly method runs with no confirm line, with { id, column, index } and the open thread", async () => {
    const connection = fakeConnection({}, { "ext.helm.move": () => Promise.resolve({ ok: true }) });
    const queue = createConfirmQueue();
    const done = actionsOf(connection, queue).callMethod("move", {
      id: "c1",
      column: "doing",
      index: 1,
    });
    await settle();
    expect(queue.current()).toBeUndefined();
    expect(await done).toBe(true);
    expect(extCallsOf(connection)).toEqual([
      {
        method: "ext.helm.move",
        params: { id: "c1", column: "doing", index: 1, threadId: OPEN_THREAD },
      },
    ]);
  });

  test("a write method without ownDataOnly waits for the confirm line with its label, and a denial sends nothing", async () => {
    const connection = fakeConnection(
      {},
      { "ext.helm.shuffle": () => Promise.resolve({ ok: true }) },
    );
    const queue = createConfirmQueue();
    const done = actionsOf(connection, queue).callMethod("shuffle", { id: "c1", index: 0 });
    await settle();
    expect(queue.current()?.request).toEqual({
      kind: "call",
      extension: "helm",
      trust: "user",
      action: "shuffle",
      label: "카드 섞기",
      paramsSummary: 'id="c1", index=0',
      approval: false,
    });
    queue.current()?.answer("deny");
    expect(await done).toBe(false);
    expect(extCallsOf(connection)).toEqual([]);
  });

  test("an allowed confirm line sends the call once", async () => {
    const connection = fakeConnection(
      {},
      { "ext.helm.shuffle": () => Promise.resolve({ ok: true }) },
    );
    const queue = createConfirmQueue();
    const done = actionsOf(connection, queue).callMethod("shuffle", { id: "c2", index: 3 });
    await settle();
    queue.current()?.answer("allow");
    expect(await done).toBe(true);
    expect(extCallsOf(connection)).toEqual([
      { method: "ext.helm.shuffle", params: { id: "c2", index: 3, threadId: OPEN_THREAD } },
    ]);
  });

  test("a refusing answer { ok: false }, a read verb, an undeclared verb and an approval method are all false", async () => {
    const connection = fakeConnection(
      {},
      { "ext.helm.move": () => Promise.resolve({ ok: false, reason: "no_thread" }) },
    );
    const actions = actionsOf(connection, createConfirmQueue());
    expect(await actions.callMethod("move", { id: "c1", column: "done", index: 0 })).toBe(false);
    expect(await actions.callMethod("board", {})).toBe(false);
    expect(await actions.callMethod("nope", {})).toBe(false);
    // 승인이 필요한 메서드는 확인 줄을 거쳐도 승인 결과를 받는 길이 없어 백엔드가 닫는다(ADR-0021 §6)
    const queue = createConfirmQueue();
    const pending = actionsOf(connection, queue).callMethod("reset", {});
    await settle();
    expect(queue.current()?.request.approval).toBe(true);
    queue.current()?.answer("allow");
    expect(await pending).toBe(false);
    expect(extCallsOf(connection).map((call) => call.method)).toEqual(["ext.helm.move"]);
  });

  test("methodRefused is true only for a record whose ok is false", () => {
    expect(
      [{ ok: false }, { ok: true }, { cards: [] }, null, [false], "no"].map(methodRefused),
    ).toEqual([true, false, false, false, false, false]);
  });
});

/** 초안 하나를 담는 상자. 화면의 useState 자리다 */
function holder(): {
  current: () => Draft<BoardLayout> | undefined;
  set: (
    update: (current: Draft<BoardLayout> | undefined) => Draft<BoardLayout> | undefined,
  ) => void;
} {
  let value: Draft<BoardLayout> | undefined;
  return {
    current: () => value,
    set: (update) => {
      value = update(value);
    },
  };
}

describe("optimistic moves: the board changes at once and goes back when the call fails", () => {
  const server: BoardLayout = boardLayoutOf(COLUMNS, CARDS);
  const basis = basisOf([COLUMNS, CARDS]);
  const moved = moveCard(server, "c1", { column: "done", index: 0 });

  test("the draft is shown while the call runs and stays after a success", async () => {
    const state = holder();
    const gate = Promise.withResolvers<boolean>();
    const failed: string[] = [];
    const done = commitDraft({
      draft: { basis, seq: 1, value: moved },
      setDraft: state.set,
      call: () => gate.promise,
      onFailed: () => failed.push("failed"),
    });
    expect(shownOf(server, basis, state.current())).toBe(moved);
    gate.resolve(true);
    expect(await done).toBe(true);
    expect(shownOf(server, basis, state.current())).toBe(moved);
    expect(failed).toEqual([]);
  });

  test("a failed call drops the draft, so the server layout shows again, and the one-line notice is asked for", async () => {
    const state = holder();
    const failed: string[] = [];
    const ok = await commitDraft({
      draft: { basis, seq: 1, value: moved },
      setDraft: state.set,
      call: () => Promise.resolve(false),
      onFailed: () => failed.push("failed"),
    });
    expect(ok).toBe(false);
    expect(state.current()).toBeUndefined();
    expect(shownOf(server, basis, state.current())).toBe(server);
    expect(failed).toEqual(["failed"]);
  });

  test("a late failure of an earlier drop does not undo a later drop", async () => {
    const state = holder();
    const firstGate = Promise.withResolvers<boolean>();
    const first = commitDraft({
      draft: { basis, seq: 1, value: moved },
      setDraft: state.set,
      call: () => firstGate.promise,
      onFailed: () => {},
    });
    const later = moveCard(moved, "c2", { column: "doing", index: 0 });
    await commitDraft({
      draft: { basis, seq: 2, value: later },
      setDraft: state.set,
      call: () => Promise.resolve(true),
      onFailed: () => {},
    });
    firstGate.resolve(false);
    await first;
    expect(shownOf(server, basis, state.current())).toBe(later);
  });

  test("new data from the extension replaces the draft (its basis no longer matches)", () => {
    const fresh = basisOf([COLUMNS, [...CARDS, { id: "c4", title: "넷째", column: "done" }]]);
    expect(shownOf(server, fresh, { basis, seq: 1, value: moved })).toBe(server);
  });
});
