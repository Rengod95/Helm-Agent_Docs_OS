import { describe, expect, test } from "bun:test";
import type { UiNode } from "@fresnel/contracts/extensions";
import {
  boardLayoutOf,
  moveCard,
  moveItem,
  placeOf,
  sortableItemsOf,
  stepPlace,
  type BoardLayout,
} from "../../../src/views/native/board.ts";
import { checkTree } from "../../../src/views/native/check.ts";
import { resolveTree } from "../../../src/views/native/resolve.ts";

// 보드와 순서 목록의 순수 계산, 카탈로그 검사, 데이터 풀이를 값으로 본다.

const COLUMNS = [
  { id: "todo", title: "할 일" },
  { id: "doing", title: "진행 중" },
  { id: "done", title: "끝" },
];
const CARDS = [
  { id: "c2", title: "Second", column: "todo", order: 1 },
  { id: "c1", title: "First", column: "todo", order: 0, detail: "first card", tag: "ui" },
  { id: "c3", title: "Third", column: "doing", order: 0, tone: "warning" },
  { id: "c4", title: "Lost", column: "nowhere", order: 0 },
  { id: "c1", title: "Duplicate", column: "done", order: 0 },
  { title: "No id", column: "done" },
];

/** 배치를 열마다 카드 id 목록으로 줄인다 */
function ids(layout: BoardLayout): Record<string, readonly string[]> {
  return Object.fromEntries(layout.map((column) => [column.id, column.cards.map((c) => c.id)]));
}

describe("boardLayoutOf", () => {
  test("columns keep their order, cards sort by order inside their column, unknown and repeated cards are left out", () => {
    const layout = boardLayoutOf(COLUMNS, CARDS);
    expect(layout).toEqual([
      {
        id: "todo",
        title: "할 일",
        cards: [
          { id: "c1", title: "First", detail: "first card", tag: "ui" },
          { id: "c2", title: "Second" },
        ],
      },
      { id: "doing", title: "진행 중", cards: [{ id: "c3", title: "Third", tone: "warning" }] },
      { id: "done", title: "끝", cards: [] },
    ]);
  });

  test("a plain string column is its own id and title, and cards without order keep the order they came in", () => {
    const layout = boardLayoutOf(
      ["Inbox", "Inbox", "Later"],
      [
        { id: "b", column: "Inbox" },
        { id: "a", column: "Inbox" },
      ],
    );
    expect(layout).toEqual([
      {
        id: "Inbox",
        title: "Inbox",
        cards: [
          { id: "b", title: "b" },
          { id: "a", title: "a" },
        ],
      },
      { id: "Later", title: "Later", cards: [] },
    ]);
  });
});

describe("moveCard", () => {
  const layout = boardLayoutOf(COLUMNS, CARDS);

  test("a move to another column puts the card at the index there and takes it out of the old one", () => {
    expect(ids(moveCard(layout, "c1", { column: "doing", index: 1 }))).toEqual({
      todo: ["c2"],
      doing: ["c3", "c1"],
      done: [],
    });
  });

  test("a move inside one column counts the index without the card itself", () => {
    expect(ids(moveCard(layout, "c1", { column: "todo", index: 1 }))).toEqual({
      todo: ["c2", "c1"],
      doing: ["c3"],
      done: [],
    });
  });

  test("an index past the end lands at the end, and an unknown card or column changes nothing", () => {
    expect(ids(moveCard(layout, "c3", { column: "done", index: 9 }))).toEqual({
      todo: ["c1", "c2"],
      doing: [],
      done: ["c3"],
    });
    expect(moveCard(layout, "nope", { column: "done", index: 0 })).toBe(layout);
    expect(moveCard(layout, "c1", { column: "nope", index: 0 })).toBe(layout);
  });
});

describe("stepPlace (keyboard moves)", () => {
  const layout = boardLayoutOf(COLUMNS, CARDS);

  test("up and down stay in the column and stop at its ends", () => {
    expect(stepPlace(layout, "c1", "down")).toEqual({ column: "todo", index: 1 });
    expect(stepPlace(layout, "c2", "up")).toEqual({ column: "todo", index: 0 });
    expect(stepPlace(layout, "c1", "up")).toBeUndefined();
    expect(stepPlace(layout, "c2", "down")).toBeUndefined();
  });

  test("left and right go to the next column at the same height, no lower than its end", () => {
    expect(stepPlace(layout, "c2", "right")).toEqual({ column: "doing", index: 1 });
    expect(stepPlace(layout, "c3", "right")).toEqual({ column: "done", index: 0 });
    expect(stepPlace(layout, "c1", "left")).toBeUndefined();
  });

  test("a whole keyboard walk: right twice then up lands the card on top of the last column", () => {
    let shown = layout;
    for (const step of ["right", "right"] as const) {
      const next = stepPlace(shown, "c2", step);
      if (next === undefined) throw new Error(`no place for ${step}`);
      shown = moveCard(shown, "c2", next);
    }
    expect(placeOf(shown, "c2")).toEqual({ column: "done", index: 0 });
    expect(ids(shown)).toEqual({ todo: ["c1"], doing: ["c3"], done: ["c2"] });
  });
});

describe("sortable list items", () => {
  test("records and strings become items, repeated ids are left out, and a move reorders", () => {
    const items = sortableItemsOf([
      { id: "a", title: "Alpha", detail: "first" },
      "Beta",
      { id: "a", title: "Again" },
      { title: "no id" },
    ]);
    expect(items).toEqual([
      { id: "a", title: "Alpha", detail: "first" },
      { id: "Beta", title: "Beta" },
    ]);
    expect(moveItem(items, "a", 1).map((item) => item.id)).toEqual(["Beta", "a"]);
    expect(moveItem(items, "zzz", 0)).toBe(items);
  });
});

describe("catalog and resolve for Board and SortableList", () => {
  const BOARD: UiNode = {
    type: "Board",
    props: { move: "move", add: "add" },
    bind: { columns: { path: "/board/columns" }, cards: { path: "/board/cards" } },
  };

  test("a board with verb props passes the catalog check, a bad verb and a bound verb do not", () => {
    expect(checkTree(BOARD).issues).toEqual([]);
    expect(
      checkTree({
        type: "SortableList",
        props: { move: "Move it" },
        bind: { items: { path: "/x" }, move: { path: "/verb" } },
      }).issues,
    ).toEqual([
      {
        code: "prop_type",
        path: "/props/move",
        message: 'prop "move" must be a method verb (letters and digits, starting lowercase)',
      },
      {
        code: "bind_not_allowed",
        path: "/bind/move",
        message: '"move" is not a bind key of SortableList',
      },
    ]);
  });

  test("both array binds of a board become lists, and the verb is not looked up in the message catalog", () => {
    const resolved = resolveTree(BOARD, {
      doc: { board: { columns: COLUMNS, cards: CARDS.slice(0, 2) } },
      locale: "ko",
      nowMs: 0,
      messages: { ko: { move: "옮기기" } },
    });
    expect(resolved.issues).toEqual([]);
    expect(resolved.root).toEqual({
      type: "Board",
      props: { move: "move", add: "add" },
      children: [],
      lists: { columns: COLUMNS, cards: CARDS.slice(0, 2) },
    });
  });
});
