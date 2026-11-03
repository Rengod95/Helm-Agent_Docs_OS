import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import { proposalListView, type ProposalRowVM } from "@fresnel/client/settings";
import type { ProposalRow } from "@fresnel/contracts/wire";
import {
  confirmActionOf,
  DIFF_FOLD_LINES,
  diffLinesOf,
  effectiveScopeOf,
  INITIAL_FILTER,
  INITIAL_PROPOSALS_STATE,
  listParamsOf,
  moveSelectionOf,
  proposalKeyIntentOf,
  proposalsReducer,
  selectedRowOf,
  visibleRowsOf,
  type ProposalPage,
  type ProposalsState,
} from "../../src/views/pages/proposals/proposals-model.ts";

// 제안 화면(P-06)의 순수 모델. 값은 `toEqual`로 비교한다. 행은 client의 `proposalListView`로 만든다(타입 단언 없이).

const THREAD = ((): ProposalRow["evidence"][number]["threadId"] => {
  const parsed = parse(ThreadIdSchema, "thr_00000000000000000000000001");
  if (!parsed.ok) throw new Error("test id must parse");
  return parsed.value;
})();

function wire(overrides: Partial<ProposalRow>): ProposalRow {
  return {
    source: "learning",
    id: "p1",
    kind: "skill",
    op: "create",
    target: "skills/review.md",
    status: "pending",
    destructive: false,
    diff: "+ line",
    rationale: null,
    evidence: [{ eventId: "evt_1", threadId: THREAD }],
    conflictsWith: null,
    reason: null,
    revision: 3,
    scope: null,
    afterUntrusted: false,
    createdAt: 1_000,
    ...overrides,
  };
}

/** 한 행의 화면 값. 목록 변환을 그대로 거친다 */
function rowVM(overrides: Partial<ProposalRow>): ProposalRowVM {
  const first = proposalListView({
    proposals: [wire(overrides)],
    nextCursor: null,
    unavailable: [],
  }).rows[0];
  if (first === undefined) throw new Error("expected one row");
  return first;
}

function pageOf(rows: readonly ProposalRowVM[], nextCursor: string | null = null): ProposalPage {
  return { rows, unavailableTexts: [], nextCursor };
}

function loaded(state: ProposalsState, page: ProposalPage, append = false): ProposalsState {
  return proposalsReducer(state, { type: "listLoaded", page, append, readAt: 5_000 });
}

describe("listParamsOf", () => {
  test("the default filter asks for pending proposals only and sends no source or cursor", () => {
    expect(listParamsOf(INITIAL_FILTER, null)).toEqual({ status: ["pending"] });
  });

  test("all statuses, all sources sends nothing but the cursor", () => {
    expect(listParamsOf({ status: "all", source: "all", kind: "all" }, "cur-2")).toEqual({
      cursor: "cur-2",
    });
  });

  test("applied from the learning source, with a cursor, sends each filter as the wire names it", () => {
    expect(listParamsOf({ status: "applied", source: "learning", kind: "skill" }, "cur-1")).toEqual(
      { status: ["applied"], source: "learning", cursor: "cur-1" },
    );
  });
});

describe("visibleRowsOf and selectedRowOf", () => {
  const rows = [
    rowVM({ id: "a", kind: "skill" }),
    rowVM({ id: "b", kind: "memory", source: "knowledge" }),
  ];

  test("a kind filter keeps only the rows of that kind; all keeps the order", () => {
    expect(visibleRowsOf(rows, "memory").map((row) => row.key)).toEqual(["knowledge:b"]);
    expect(visibleRowsOf(rows, "all").map((row) => row.key)).toEqual(["learning:a", "knowledge:b"]);
  });

  test("the selected row is found by key, and a missing key gives null", () => {
    expect(selectedRowOf(rows, "knowledge:b")?.id).toBe("b");
    expect(selectedRowOf(rows, "learning:zz")).toBeNull();
    expect(selectedRowOf(rows, null)).toBeNull();
  });
});

describe("proposalsReducer", () => {
  test("a loaded page replaces the rows, records the read time and keeps a selection that is still there", () => {
    const first = rowVM({ id: "a" });
    const selected = proposalsReducer(loaded(INITIAL_PROPOSALS_STATE, pageOf([first])), {
      type: "select",
      key: "learning:a",
    });
    const again = loaded(selected, pageOf([first], "cur-2"));
    expect(again.selectedKey).toBe("learning:a");
    expect(again.readAt).toBe(5_000);
    expect(again.list).toEqual({
      status: "ready",
      loadingMore: false,
      rows: [first],
      unavailableTexts: [],
      nextCursor: "cur-2",
    });
  });

  test("a reload that no longer has the selected row clears the selection", () => {
    const selected = proposalsReducer(
      loaded(INITIAL_PROPOSALS_STATE, pageOf([rowVM({ id: "a" })])),
      {
        type: "select",
        key: "learning:a",
      },
    );
    expect(loaded(selected, pageOf([rowVM({ id: "b" })])).selectedKey).toBeNull();
  });

  test("a more-page appends its rows and keeps the selection", () => {
    const a = rowVM({ id: "a" });
    const b = rowVM({ id: "b" });
    const first = proposalsReducer(loaded(INITIAL_PROPOSALS_STATE, pageOf([a], "cur-2")), {
      type: "select",
      key: "learning:a",
    });
    const more = loaded(
      proposalsReducer(first, { type: "listStarted", append: true }),
      pageOf([b], null),
      true,
    );
    expect(more.selectedKey).toBe("learning:a");
    expect(more.list.status === "ready" ? more.list.rows.map((row) => row.key) : []).toEqual([
      "learning:a",
      "learning:b",
    ]);
    expect(more.list.status === "ready" ? more.list.loadingMore : true).toBe(false);
  });

  test("a changed filter starts loading again and drops the selection, editor and notice", () => {
    const busy = proposalsReducer(
      proposalsReducer(loaded(INITIAL_PROPOSALS_STATE, pageOf([rowVM({ id: "a" })])), {
        type: "editorOpened",
        mode: "edit",
        key: "learning:a",
      }),
      { type: "noticeSet", notice: { tone: "success", text: "done" } },
    );
    const changed = proposalsReducer(busy, {
      type: "filterChanged",
      filter: { status: "applied", source: "all", kind: "all" },
    });
    expect(changed.list).toEqual({ status: "loading" });
    expect(changed.selectedKey).toBeNull();
    expect(changed.editor).toEqual({ mode: "none" });
    expect(changed.notice).toBeNull();
  });

  test("the editor takes text and closes; opening a confirm closes the editor", () => {
    const opened = proposalsReducer(INITIAL_PROPOSALS_STATE, {
      type: "editorOpened",
      mode: "reject",
      key: "learning:a",
    });
    expect(opened.editor).toEqual({ mode: "reject", key: "learning:a", text: "" });
    const typed = proposalsReducer(opened, { type: "editorChanged", text: "중복이다" });
    expect(typed.editor).toEqual({ mode: "reject", key: "learning:a", text: "중복이다" });
    const confirming = proposalsReducer(typed, {
      type: "confirmOpened",
      key: "learning:a",
      action: "revert",
    });
    expect(confirming.editor).toEqual({ mode: "none" });
    expect(confirming.confirm).toEqual({ key: "learning:a", action: "revert" });
    expect(proposalsReducer(confirming, { type: "editorClosed" }).editor).toEqual({ mode: "none" });
  });

  test("selecting another row resets the chosen scope, editor and confirm", () => {
    const state: ProposalsState = {
      ...INITIAL_PROPOSALS_STATE,
      scope: "project",
      confirm: { key: "learning:a", action: "approve" },
    };
    const next = proposalsReducer(state, { type: "select", key: "learning:b" });
    expect(next.scope).toBeNull();
    expect(next.confirm).toBeNull();
    expect(next.selectedKey).toBe("learning:b");
  });
});

describe("effectiveScopeOf and confirmActionOf", () => {
  test("a skill defaults to the user scope and keeps a chosen one; other kinds have no scope", () => {
    const skill = rowVM({ kind: "skill" });
    expect(effectiveScopeOf(skill, null)).toBe("user");
    expect(effectiveScopeOf(skill, "project")).toBe("project");
    expect(effectiveScopeOf(rowVM({ kind: "memory", source: "knowledge" }), "project")).toBeNull();
  });

  test("revert always asks; approve asks only for a destructive proposal; reject never asks", () => {
    const plain = rowVM({ destructive: false, status: "applied" });
    const destructive = rowVM({ destructive: true });
    expect(confirmActionOf(plain, "revert")).toBe("revert");
    expect(confirmActionOf(plain, "approve")).toBeNull();
    expect(confirmActionOf(destructive, "approve")).toBe("approve");
    expect(confirmActionOf(destructive, "reject")).toBeNull();
  });
});

describe("moveSelectionOf", () => {
  const rows = [rowVM({ id: "a" }), rowVM({ id: "b" }), rowVM({ id: "c" })];

  test("moves one row at a time, starts at the first row, and stops at either end", () => {
    expect(moveSelectionOf(rows, null, 1)).toBe("learning:a");
    expect(moveSelectionOf(rows, "learning:b", 1)).toBe("learning:c");
    expect(moveSelectionOf(rows, "learning:c", 1)).toBe("learning:c");
    expect(moveSelectionOf(rows, "learning:a", -1)).toBe("learning:a");
  });

  test("an empty list selects nothing", () => {
    expect(moveSelectionOf([], null, 1)).toBeNull();
  });
});

describe("proposalKeyIntentOf", () => {
  const base = {
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    editable: false,
  };

  test("arrows move and the letter keys act on the selected row", () => {
    expect(proposalKeyIntentOf({ ...base, key: "ArrowDown" })).toEqual({ type: "move", delta: 1 });
    expect(proposalKeyIntentOf({ ...base, key: "ArrowUp" })).toEqual({ type: "move", delta: -1 });
    expect(proposalKeyIntentOf({ ...base, key: "a" })).toEqual({ type: "act", action: "approve" });
    expect(proposalKeyIntentOf({ ...base, key: "e" })).toEqual({ type: "act", action: "edit" });
    expect(proposalKeyIntentOf({ ...base, key: "x" })).toEqual({ type: "act", action: "reject" });
    expect(proposalKeyIntentOf({ ...base, key: "u" })).toEqual({ type: "act", action: "revert" });
  });

  test("typing in a field, a modifier key, or an unbound key gives no intent", () => {
    expect(proposalKeyIntentOf({ ...base, key: "a", editable: true })).toBeNull();
    expect(proposalKeyIntentOf({ ...base, key: "a", metaKey: true })).toBeNull();
    expect(proposalKeyIntentOf({ ...base, key: "a", shiftKey: true })).toBeNull();
    expect(proposalKeyIntentOf({ ...base, key: "z" })).toBeNull();
  });
});

describe("diffLinesOf", () => {
  test("a plus line is an add, a minus line a removal, others context, with 1-based numbers and one leading space dropped", () => {
    expect(diffLinesOf("+ add\n- del\n keep")).toEqual([
      { number: 1, kind: "add", text: "add" },
      { number: 2, kind: "remove", text: "del" },
      { number: 3, kind: "context", text: "keep" },
    ]);
  });

  test("an empty diff has no lines", () => {
    expect(diffLinesOf("")).toEqual([]);
  });

  test("the fold limit is 500 lines", () => {
    expect(DIFF_FOLD_LINES).toBe(500);
    expect(diffLinesOf(Array.from({ length: 501 }, () => "x").join("\n")).length).toBe(501);
  });
});
