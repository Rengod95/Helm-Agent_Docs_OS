import { describe, expect, test } from "bun:test";
import type { ContextRef } from "@fresnel/contracts/conversation";
import type { DraftInfo } from "@fresnel/contracts/wire";
import {
  borrowNext,
  workThreadOf,
  clampOffset,
  collapsedEdgeOf,
  contextChipsOf,
  draftLabelOf,
  draftRowOf,
  IDLE_BORROW,
  type Box,
} from "../../../src/views/craft/test-chat/window-model.ts";
import { thr } from "../../state/helpers.ts";

// 테스트 챗 창의 순수 모델(window-model.ts)을 구체 값으로 본다. 화면 부품과 저장소는 여기서 다루지 않는다.

const A = thr(1);
const B = thr(2);
const C = thr(3);

describe("borrowNext", () => {
  test("idle with a show selects the shown thread and remembers the previous selection", () => {
    expect(borrowNext(IDLE_BORROW, { show: B, selected: A })).toEqual({
      borrow: { kind: "lent", thread: B, returnTo: A },
      action: { kind: "select", thread: B },
    });
  });

  test("idle with a show that is already selected lends nothing back: action null, returnTo null", () => {
    expect(borrowNext(IDLE_BORROW, { show: A, selected: A })).toEqual({
      borrow: { kind: "lent", thread: A, returnTo: null },
      action: null,
    });
  });

  test("idle and hidden does nothing", () => {
    expect(borrowNext(IDLE_BORROW, { show: null, selected: A })).toEqual({
      borrow: IDLE_BORROW,
      action: null,
    });
  });

  test("lent then hidden with the borrowed thread still selected returns to returnTo", () => {
    expect(
      borrowNext({ kind: "lent", thread: B, returnTo: A }, { show: null, selected: B }),
    ).toEqual({
      borrow: IDLE_BORROW,
      action: { kind: "select", thread: A },
    });
  });

  test("lent then hidden with no returnTo leaves the selected thread", () => {
    expect(
      borrowNext({ kind: "lent", thread: B, returnTo: null }, { show: null, selected: B }),
    ).toEqual({
      borrow: IDLE_BORROW,
      action: { kind: "leave" },
    });
  });

  test("lent then hidden while the user picked another thread gives no action and goes idle", () => {
    expect(
      borrowNext({ kind: "lent", thread: B, returnTo: A }, { show: null, selected: C }),
    ).toEqual({
      borrow: IDLE_BORROW,
      action: null,
    });
  });

  test("lent and still shown with the borrowed thread selected keeps the borrow and no action", () => {
    expect(borrowNext({ kind: "lent", thread: B, returnTo: A }, { show: B, selected: B })).toEqual({
      borrow: { kind: "lent", thread: B, returnTo: A },
      action: null,
    });
  });

  test("lent and show changes to another thread keeps the original returnTo", () => {
    expect(borrowNext({ kind: "lent", thread: B, returnTo: A }, { show: C, selected: B })).toEqual({
      borrow: { kind: "lent", thread: C, returnTo: A },
      action: { kind: "select", thread: C },
    });
  });
});

const AREA: Box = { left: 0, top: 0, right: 1000, bottom: 800 };
const BASE: Box = { left: 100, top: 100, right: 200, bottom: 200 };
// 세로 단추 띠. 영역보다 좁지만 창이 넘지 못할 왼쪽 경계를 준다
const RAIL: Box = { left: 900, top: 300, right: 930, bottom: 500 };

describe("workThreadOf", () => {
  test("창이 빌린 대화가 열려 있으면 빌리기 전의 대화를 본다", () => {
    expect(workThreadOf({ kind: "lent", thread: B, returnTo: A }, B)).toBe(A);
    expect(workThreadOf({ kind: "lent", thread: B, returnTo: null }, B)).toBeNull();
  });

  test("빌리지 않았거나 다른 대화가 열려 있으면 열린 대화 그대로다", () => {
    expect(workThreadOf(IDLE_BORROW, B)).toBe(B);
    expect(workThreadOf({ kind: "lent", thread: B, returnTo: A }, C)).toBe(C);
    expect(workThreadOf(IDLE_BORROW, null)).toBeNull();
  });
});

describe("clampOffset", () => {
  test("an offset that keeps the window inside the area is unchanged", () => {
    expect(clampOffset(BASE, { x: 50, y: -30 }, AREA, null)).toEqual({ x: 50, y: -30 });
  });

  test("clamps at the left and top edges, leaving the gap inside the area", () => {
    expect(clampOffset(BASE, { x: -500, y: -500 }, AREA, null)).toEqual({ x: -88, y: -88 });
  });

  test("clamps at the right and bottom edges, leaving the gap inside the area", () => {
    expect(clampOffset(BASE, { x: 5000, y: 5000 }, AREA, null)).toEqual({ x: 788, y: 588 });
  });

  test("cannot pass rail.left minus the gap even when the area is wider", () => {
    expect(clampOffset(BASE, { x: 5000, y: 0 }, AREA, RAIL)).toEqual({ x: 688, y: 0 });
  });

  test("an offset that stays left of the rail is not moved by the rail", () => {
    expect(clampOffset(BASE, { x: 300, y: 0 }, AREA, RAIL)).toEqual({ x: 300, y: 0 });
  });

  test("with no rail the right limit is area.right minus the gap", () => {
    expect(clampOffset(BASE, { x: 5000, y: 0 }, AREA, null)).toEqual({ x: 788, y: 0 });
  });
});

describe("contextChipsOf", () => {
  test("plugin refs are skipped and each chip is keyed by kind and original index", () => {
    const contexts: readonly ContextRef[] = [
      { kind: "plugin", name: "notes" },
      { kind: "finding", findingId: "fnd_1" },
      { kind: "turn", threadId: "thr_0002", turnId: "trn_0003" },
      { kind: "plugin", name: "tasks" },
      { kind: "draft", draftId: "dr_4" },
    ];
    expect(contextChipsOf(contexts)).toEqual([
      { key: "finding:1", label: "desktop.craft.testChat.context.finding" },
      { key: "turn:2", label: "desktop.craft.testChat.context.turn" },
      { key: "draft:4", label: "desktop.craft.testChat.context.draft" },
    ]);
  });

  test("only plugin refs gives no chips", () => {
    expect(contextChipsOf([{ kind: "plugin", name: "notes" }])).toEqual([]);
  });
});

const CONTENT_HASH = "sha256:9f2c4b1ad3e7060a5b8c91f2e4d6a7b8c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5";

function draftOf(draftId: string, patch: Partial<DraftInfo> = {}): DraftInfo {
  return {
    draftId,
    name: "notes-draft",
    contentHash: CONTENT_HASH,
    parent: null,
    createdAt: "2026-11-20T09:00:00.000Z",
    originThreadId: null,
    label: null,
    submittedItemId: null,
    ...patch,
  };
}

describe("draftRowOf", () => {
  test("no draft from this thread gives none", () => {
    expect(draftRowOf([], A)).toEqual({ kind: "none" });
    expect(draftRowOf([draftOf("dr_1", { originThreadId: B })], A)).toEqual({ kind: "none" });
  });

  test("an unsent draft from this thread gives the draft row", () => {
    const mine = draftOf("dr_2", { originThreadId: A });
    expect(draftRowOf([mine], A)).toEqual({ kind: "draft", draft: mine });
  });

  test("a sent draft from this thread gives the in-review row with its item id", () => {
    const sent = draftOf("dr_3", { originThreadId: A, submittedItemId: "rv_0004" });
    expect(draftRowOf([sent], A)).toEqual({
      kind: "inReview",
      draft: sent,
      itemId: "rv_0004",
    });
  });

  test("the first match in the newest-first list wins, even when an older draft was sent", () => {
    // 목록은 새것이 먼저다. 이 대화의 가장 새 드래프트(dr_5)가 아직 안 보냈으면 오래된 보낸 드래프트(dr_3)는 무시된다
    const newest = draftOf("dr_5", { originThreadId: A });
    const older = draftOf("dr_3", { originThreadId: A, submittedItemId: "rv_0009" });
    expect(draftRowOf([draftOf("dr_6", { originThreadId: B }), newest, older], A)).toEqual({
      kind: "draft",
      draft: newest,
    });
  });

  test("the first match wins when the newest draft from this thread was sent", () => {
    const newest = draftOf("dr_8", { originThreadId: A, submittedItemId: "rv_0011" });
    const older = draftOf("dr_7", { originThreadId: A });
    expect(draftRowOf([newest, older], A)).toEqual({
      kind: "inReview",
      draft: newest,
      itemId: "rv_0011",
    });
  });
});

describe("draftLabelOf", () => {
  test("a label wins over the content hash", () => {
    expect(draftLabelOf(draftOf("dr_1", { label: "first try" }))).toBe("first try");
  });

  test("a blank or missing label falls back to the first 7 hex chars after sha256:", () => {
    expect(draftLabelOf(draftOf("dr_1", { label: "   " }))).toBe("9f2c4b1");
    expect(draftLabelOf(draftOf("dr_1", { label: "" }))).toBe("9f2c4b1");
    expect(draftLabelOf(draftOf("dr_1", { label: null }))).toBe("9f2c4b1");
  });

  test("a content hash without the sha256: prefix also gives its first 7 chars", () => {
    expect(
      draftLabelOf(
        draftOf("dr_1", { contentHash: "9f2c4b1ad3e7060a5b8c91f2e4d6a7b8c0d1e2f3", label: null }),
      ),
    ).toBe("9f2c4b1");
  });
});

describe("collapsedEdgeOf", () => {
  test("a collapsed column stands at the top", () => {
    expect(collapsedEdgeOf("column")).toBe("top");
  });

  test("a collapsed dock and strip stand at the bottom", () => {
    expect(collapsedEdgeOf("dock")).toBe("bottom");
    expect(collapsedEdgeOf("strip")).toBe("bottom");
  });
});
