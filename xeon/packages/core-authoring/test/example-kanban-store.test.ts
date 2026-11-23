// 본보기 `examples/kanban`을 실제 엔트리로 싣고, 대화가 없을 때 보드가 플러그인 저장소에서 읽히고 더하기와 옮기기가 값으로 바뀌는지 본다.
// 대화가 열려 있을 때는 상태 문서를 쓰고 저장소는 비어 있는지, 열리지 않은 대화에 묶인 읽기는 저장소를 읽는지도 본다.
// 본보기는 워크스페이스 패키지가 아니므로(package.json이 없다) `just check examples/kanban`은 돌지 않는다. 이 시험은 `just test packages/core-authoring`에서 돈다.
import { cpSync } from "node:fs";
import { join } from "node:path";
import { afterAll, expect, test } from "bun:test";
import { parseJson } from "@fresnel/contracts";
import type { PluginStorePort } from "@fresnel/contracts/extensions";
import { createTestHost, memoryPluginStore } from "@fresnel/ext-host/testing";
import { callMethod, cleanupStaged, installStaged, stageRoot } from "./support/staged-extension.ts";

const KANBAN = join(import.meta.dir, "..", "..", "..", "examples", "kanban");
const NAME = "kanban";

afterAll(cleanupStaged);

/** 본보기를 시험 공간에 복사해 저장소를 붙인 호스트에 싣는다 */
async function kanbanHost(store: PluginStorePort) {
  const t = await createTestHost({ pluginStore: store });
  const root = stageRoot();
  cpSync(KANBAN, root, { recursive: true });
  await installStaged(t, root);
  return t;
}

/** 저장소에 있는 보드 값. 없으면 시험이 실패하도록 던진다 */
async function storedBoard(store: PluginStorePort): Promise<unknown> {
  const stored = await store.get(NAME, "board");
  if (!stored.ok || stored.value === null) throw new Error("no board in the plugin store");
  const parsed = parseJson(stored.value);
  if (!parsed.ok) throw new Error("the stored board is not JSON");
  return parsed.value;
}

test("with no conversation, add and move change the board in the plugin store, and board reads it back", async () => {
  const store = memoryPluginStore();
  const t = await kanbanHost(store);
  expect(await callMethod(t, NAME, "board", {}, null)).toEqual({ ok: true, cards: [] });
  expect(await callMethod(t, NAME, "add", { title: "첫 카드" }, null)).toEqual({
    ok: true,
    cards: [{ id: "card-1", title: "첫 카드", column: "todo", order: 0 }],
  });
  expect(await callMethod(t, NAME, "add", { title: "둘째 카드" }, null)).toEqual({
    ok: true,
    cards: [
      { id: "card-1", title: "첫 카드", column: "todo", order: 0 },
      { id: "card-2", title: "둘째 카드", column: "todo", order: 1 },
    ],
  });
  // card-1을 doing 칸 맨 앞으로 옮기면 todo에는 card-2만 남고, 칸마다 순서를 0부터 다시 매긴다
  const moved = [
    { id: "card-2", title: "둘째 카드", column: "todo", order: 0 },
    { id: "card-1", title: "첫 카드", column: "doing", order: 0 },
  ];
  expect(
    await callMethod(t, NAME, "move", { id: "card-1", column: "doing", index: 0 }, null),
  ).toEqual({ ok: true, cards: moved });
  expect(await callMethod(t, NAME, "board", {}, null)).toEqual({ ok: true, cards: moved });
  // 저장소에는 보드 값 전체가 들어 있다. seq는 다음 카드 번호의 바탕이다
  expect(await storedBoard(store)).toEqual({ cards: moved, seq: 2 });
});

test("with no conversation, a missing card and a failing store come back as reasons, not throws", async () => {
  const t = await kanbanHost(memoryPluginStore());
  expect(
    await callMethod(t, NAME, "move", { id: "card-9", column: "done", index: 0 }, null),
  ).toEqual({ ok: false, reason: "not_found" });

  const broken = await kanbanHost(memoryPluginStore({ fail: true }));
  expect(await callMethod(broken, NAME, "board", {}, null)).toEqual({
    ok: false,
    reason: "storage_unavailable",
  });
  expect(await callMethod(broken, NAME, "add", { title: "카드" }, null)).toEqual({
    ok: false,
    reason: "storage_unavailable",
  });
});

test("with no conversation, adds that run at the same time get distinct ids and none is lost", async () => {
  const store = memoryPluginStore();
  const t = await kanbanHost(store);
  await Promise.all(["가", "나", "다"].map((title) => callMethod(t, NAME, "add", { title }, null)));
  // 세 번 더하면 번호는 3까지 가고 카드 id는 card-1, card-2, card-3이 모두 있어야 한다
  expect(await storedBoard(store)).toEqual({
    cards: expect.arrayContaining([
      expect.objectContaining({ id: "card-1" }),
      expect.objectContaining({ id: "card-2" }),
      expect.objectContaining({ id: "card-3" }),
    ]),
    seq: 3,
  });
});

test("with an open conversation, the board lives in the plugin store and a read with no conversation sees it", async () => {
  const store = memoryPluginStore();
  const t = await kanbanHost(store);
  const thread = t.newThread();
  await t.host.openThread(thread);
  await t.settled();
  expect(await callMethod(t, NAME, "board", {}, thread)).toEqual({ ok: true, cards: [] });
  expect(await callMethod(t, NAME, "add", { title: "대화 카드" }, thread)).toEqual({
    ok: true,
    cards: [{ id: "card-1", title: "대화 카드", column: "todo", order: 0 }],
  });
  const done = [{ id: "card-1", title: "대화 카드", column: "done", order: 0 }];
  expect(
    await callMethod(t, NAME, "move", { id: "card-1", column: "done", index: 0 }, thread),
  ).toEqual({ ok: true, cards: done });
  expect(await callMethod(t, NAME, "board", {}, null)).toEqual({ ok: true, cards: done });
  expect(await storedBoard(store)).toEqual({ cards: done, seq: 1 });
});

test("a conversation that is not open reads the board from the plugin store", async () => {
  const t = await kanbanHost(memoryPluginStore());
  await callMethod(t, NAME, "add", { title: "저장된 카드" }, null);
  // 열지 않은 대화에 묶인 읽기는 상태 문서가 없으므로 저장소의 보드를 준다
  const unopened = t.newThread();
  expect(await callMethod(t, NAME, "board", {}, unopened)).toEqual({
    ok: true,
    cards: [{ id: "card-1", title: "저장된 카드", column: "todo", order: 0 }],
  });
});
