import { describe, expect, test } from "bun:test";
import type { ContextRef } from "@fresnel/contracts/conversation";
import type { CommandError } from "../../../src/views/commands.ts";
import { ZERO_OFFSET } from "../../../src/views/craft/test-chat/window-model.ts";
import {
  CLOSED_WINDOW,
  reduceTestChat,
  type TestChatWindow,
} from "../../../src/views/craft/test-chat/window-state.ts";
import { thr } from "../../state/helpers.ts";

// 테스트 챗 창의 상태 전이(window-state.ts의 reduceTestChat)를 구체 값으로 본다.
// 닫힌 창에 맞지 않는 사건은 같은 상태 객체를 돌려준다(`toBe`로 본다).

const CONTEXT: ContextRef = { kind: "finding", findingId: "fnd_1" };
const OFFLINE: CommandError = { kind: "offline" };

/** 열려서 대화를 받은 창 */
const READY: TestChatWindow = {
  ...CLOSED_WINDOW,
  phase: { kind: "ready", threadId: thr(1), plugin: "notes" },
  contexts: [CONTEXT],
  shape: "dock",
};

describe("reduceTestChat: opening", () => {
  test("opening a closed window shows the opening phase, expanded, with the given contexts", () => {
    expect(
      reduceTestChat(CLOSED_WINDOW, { type: "opening", plugin: "notes", contexts: [CONTEXT] }),
    ).toEqual({
      phase: { kind: "opening", plugin: "notes" },
      collapsed: false,
      contexts: [CONTEXT],
      offset: ZERO_OFFSET,
      shape: "dock",
    });
  });

  test("opening a closed window starts at zero offset even when a stale offset was left", () => {
    const moved = reduceTestChat(CLOSED_WINDOW, { type: "move", offset: { x: 5, y: 6 } });
    expect(moved.offset).toEqual({ x: 5, y: 6 });
    expect(reduceTestChat(moved, { type: "opening", plugin: null, contexts: [] }).offset).toEqual(
      ZERO_OFFSET,
    );
  });

  test("opening a window that is already open keeps its offset and shape, and expands it", () => {
    const shown: TestChatWindow = {
      ...READY,
      offset: { x: 30, y: -4 },
      collapsed: true,
      shape: "column",
    };
    expect(reduceTestChat(shown, { type: "opening", plugin: "tasks", contexts: [] })).toEqual({
      phase: { kind: "opening", plugin: "tasks" },
      collapsed: false,
      contexts: [],
      offset: { x: 30, y: -4 },
      shape: "column",
    });
  });
});

describe("reduceTestChat: opened", () => {
  test("opened while opening becomes ready with the thread and plugin", () => {
    const opening = reduceTestChat(CLOSED_WINDOW, {
      type: "opening",
      plugin: "notes",
      contexts: [],
    });
    expect(reduceTestChat(opening, { type: "opened", threadId: thr(7), plugin: "notes" })).toEqual({
      ...CLOSED_WINDOW,
      phase: { kind: "ready", threadId: thr(7), plugin: "notes" },
    });
  });

  test("opened after the window was closed does not reopen it", () => {
    const opening = reduceTestChat(CLOSED_WINDOW, {
      type: "opening",
      plugin: "notes",
      contexts: [],
    });
    const closed = reduceTestChat(opening, { type: "close" });
    expect(reduceTestChat(closed, { type: "opened", threadId: thr(7), plugin: "notes" })).toBe(
      closed,
    );
  });

  test("opened while closed or already ready changes nothing", () => {
    expect(
      reduceTestChat(CLOSED_WINDOW, { type: "opened", threadId: thr(7), plugin: "notes" }),
    ).toBe(CLOSED_WINDOW);
    expect(reduceTestChat(READY, { type: "opened", threadId: thr(9), plugin: "tasks" })).toBe(
      READY,
    );
  });
});

describe("reduceTestChat: failed", () => {
  test("failed while opening keeps the opening plugin and records the error", () => {
    const opening = reduceTestChat(CLOSED_WINDOW, {
      type: "opening",
      plugin: "notes",
      contexts: [],
    });
    expect(reduceTestChat(opening, { type: "failed", error: OFFLINE })).toEqual({
      ...opening,
      phase: { kind: "failed", plugin: "notes", error: { kind: "offline" } },
    });
  });

  test("failed while opening a new-plugin chat keeps a null plugin", () => {
    const opening = reduceTestChat(CLOSED_WINDOW, {
      type: "opening",
      plugin: null,
      contexts: [],
    });
    expect(reduceTestChat(opening, { type: "failed", error: OFFLINE }).phase).toEqual({
      kind: "failed",
      plugin: null,
      error: { kind: "offline" },
    });
  });

  test("failed while closed or ready changes nothing", () => {
    expect(reduceTestChat(CLOSED_WINDOW, { type: "failed", error: OFFLINE })).toBe(CLOSED_WINDOW);
    expect(reduceTestChat(READY, { type: "failed", error: OFFLINE })).toBe(READY);
  });
});

describe("reduceTestChat: collapse", () => {
  test("collapse sets the collapsed flag and leaves the rest of the window alone", () => {
    expect(reduceTestChat(READY, { type: "collapse", collapsed: true })).toEqual({
      ...READY,
      collapsed: true,
    });
  });

  test("collapse expands a collapsed window again", () => {
    const folded: TestChatWindow = { ...READY, collapsed: true };
    expect(reduceTestChat(folded, { type: "collapse", collapsed: false })).toEqual({
      ...READY,
      collapsed: false,
    });
  });

  test("collapse on a closed window changes nothing", () => {
    expect(reduceTestChat(CLOSED_WINDOW, { type: "collapse", collapsed: true })).toBe(
      CLOSED_WINDOW,
    );
  });
});

describe("reduceTestChat: close", () => {
  test("close returns to the closed phase but keeps the chosen shape", () => {
    const shown: TestChatWindow = {
      ...READY,
      shape: "strip",
      offset: { x: 9, y: 9 },
      collapsed: true,
    };
    expect(reduceTestChat(shown, { type: "close" })).toEqual({
      ...CLOSED_WINDOW,
      shape: "strip",
    });
  });
});

describe("reduceTestChat: shape", () => {
  test("changing the shape keeps the phase and resets the offset to zero", () => {
    const moved: TestChatWindow = { ...READY, offset: { x: 3, y: 4 } };
    expect(reduceTestChat(moved, { type: "shape", shape: "column" })).toEqual({
      ...READY,
      shape: "column",
      offset: ZERO_OFFSET,
    });
  });
});

describe("reduceTestChat: move", () => {
  test("move stores the offset and leaves the rest of the window alone", () => {
    expect(reduceTestChat(READY, { type: "move", offset: { x: 12, y: -8 } })).toEqual({
      ...READY,
      offset: { x: 12, y: -8 },
    });
  });
});
