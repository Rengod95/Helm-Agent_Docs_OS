import { describe, expect, test } from "bun:test";
import { parse } from "@fresnel/contracts";
import { ThreadIdSchema } from "@fresnel/contracts/conversation";
import { proposalListView, type ProposalRowVM } from "@fresnel/client/settings";
import type { ExtListEntry, ProposalRow, WireResult } from "@fresnel/contracts/wire";
import {
  confirmActionOf,
  DIFF_FOLD_LINES,
  diffLinesOf,
  effectiveScopeOf,
  INITIAL_FILTER,
  INITIAL_PROPOSALS_STATE,
  learningStateOf,
  listParamsOf,
  moveSelectionOf,
  overlayOpenOf,
  proposalKeyIntentOf,
  proposalsReducer,
  rowTitleOf,
  selectedRowOf,
  skillFailureOf,
  unavailableShownOf,
  visibleRowsOf,
  type LearningState,
  type ProposalPage,
  type ProposalsState,
  type SkillRequest,
} from "../../src/views/pages/proposals/proposals-model.ts";
import {
  doneNoticeOf,
  expiryDateTextOf,
  unavailableTextIdOf,
} from "../../src/views/pages/proposals/proposals-text.ts";

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
    target: "review",
    status: "pending",
    destructive: false,
    diff: "+ line",
    rationale: null,
    evidence: [{ eventId: "evt_1", threadId: THREAD }],
    conflictsWith: null,
    reason: null,
    note: null,
    revision: 3,
    scope: null,
    afterUntrusted: false,
    createdAt: 1_000,
    expiresAt: 1_000 + 30 * 86_400_000,
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
  return { rows, unavailable: [], nextCursor };
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
      unavailable: [],
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

describe("doneNoticeOf", () => {
  test("a revert the ledger performed is a success; one it refused stays applied and is a warning, never a success", () => {
    // 성공: 원장이 되돌려 행이 `reverted`가 됐다(엔진은 `applied: false`)
    expect(doneNoticeOf("revert", false, "reverted")).toEqual({
      tone: "success",
      textId: "desktop.proposals.done.reverted",
    });
    // 거절: 그 사이 기억이 바뀌어 행이 `applied`로 남았다(엔진은 `applied: true`, reason rollback_refused)
    expect(doneNoticeOf("revert", true, "applied")).toEqual({
      tone: "warning",
      textId: "desktop.proposals.done.revertRefused",
    });
    // 상태를 모르면 되돌렸다고 말하지 않는다
    expect(doneNoticeOf("revert", false, "applied")).toEqual({
      tone: "warning",
      textId: "desktop.proposals.done.revertRefused",
    });
  });

  test("approve says whether it was applied; edit and reject are plain successes", () => {
    expect(doneNoticeOf("approve", true, "applied")).toEqual({
      tone: "success",
      textId: "desktop.proposals.done.approved",
    });
    expect(doneNoticeOf("approve", false, "approved")).toEqual({
      tone: "success",
      textId: "desktop.proposals.done.approvedNotApplied",
    });
    expect(doneNoticeOf("edit", false, "pending")).toEqual({
      tone: "success",
      textId: "desktop.proposals.done.edited",
    });
    expect(doneNoticeOf("reject", false, "rejected")).toEqual({
      tone: "success",
      textId: "desktop.proposals.done.rejected",
    });
  });
});

describe("unavailableTextIdOf and unavailableShownOf", () => {
  const OFF: LearningState = { status: "off", turnOn: null };

  test("each unreadable source has its own sentence", () => {
    expect(unavailableTextIdOf("learning")).toBe("client.settings.proposals.unavailable.learning");
    expect(unavailableTextIdOf("knowledge")).toBe(
      "client.settings.proposals.unavailable.knowledge",
    );
  });

  test("with learning off, a learning read gap is not an error; the knowledge gap still shows", () => {
    expect(unavailableShownOf(["learning", "knowledge"], OFF)).toEqual(["knowledge"]);
    expect(unavailableShownOf(["learning"], OFF)).toEqual([]);
    expect(unavailableShownOf(["learning"], { status: "on" })).toEqual(["learning"]);
    expect(unavailableShownOf(["learning"], { status: "unknown" })).toEqual(["learning"]);
  });
});

/** 확장 목록의 한 항목. 학습 그룹의 켜짐 상태 시험에만 쓴다 */
function extEntry(overrides: Partial<ExtListEntry>): ExtListEntry {
  return {
    name: "learning",
    displayName: "Learning",
    layer: "L3",
    isGroup: true,
    version: "0.1.0",
    location: "builtin",
    requestedGrade: "builtin",
    effectiveGrade: "builtin",
    tier: null,
    status: "enabled",
    plugins: [],
    diagnostics: [],
    autoDisabled: false,
    safeModeExcluded: null,
    hookCount: 0,
    ...overrides,
  };
}

describe("learningStateOf", () => {
  test("an unread extension list is unknown; a running group is on", () => {
    expect(learningStateOf(null)).toEqual({ status: "unknown" });
    expect(learningStateOf([extEntry({ status: "enabled" })])).toEqual({ status: "on" });
  });

  test("a disabled group is off and offers the same switch write the extension list uses", () => {
    expect(learningStateOf([extEntry({ status: "disabled" })])).toEqual({
      status: "off",
      turnOn: { key: "ext.learning.enabled", value: true, scope: "user" },
    });
  });

  test("a group the safe mode left out is off with no switch; a managed group is off with no switch", () => {
    expect(learningStateOf([extEntry({ status: "disabled", safeModeExcluded: "flag" })])).toEqual({
      status: "off",
      turnOn: null,
    });
    expect(learningStateOf([extEntry({ status: "disabled", enabledSource: "managed" })])).toEqual({
      status: "off",
      turnOn: null,
    });
  });

  test("a list without the learning group means it is not loaded here: off, no switch", () => {
    expect(learningStateOf([extEntry({ name: "helm" })])).toEqual({ status: "off", turnOn: null });
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

describe("rowTitleOf", () => {
  test("a one-line feedback is titled by its sentence, which is short enough to keep whole", () => {
    const row = rowVM({
      kind: "feedback",
      op: "add",
      target: "user/work-style",
      diff: "+ 커밋 메시지는 feat/fix/chore 중 하나로 쓰고 한 줄로 쓴다. 팀 규칙이다.",
    });
    expect(rowTitleOf(row)).toEqual(
      "커밋 메시지는 feat/fix/chore 중 하나로 쓰고 한 줄로 쓴다. 팀 규칙이다.",
    );
  });

  test("a title longer than 60 characters is cut after 60 and an ellipsis follows", () => {
    const row = rowVM({ kind: "memory", op: "add", target: "user", diff: `+ ${"가".repeat(61)}` });
    expect(rowTitleOf(row)).toEqual(`${"가".repeat(60)}…`);
  });

  test("the first line with text is used: blank and space-only lines are skipped and inner runs of spaces collapse", () => {
    const row = rowVM({
      kind: "memory",
      op: "replace",
      target: "user/0123456789ab",
      diff: "@@ replace user/0123456789ab\n+   \n+ 첫  번째 \n+ 둘째",
    });
    expect(rowTitleOf(row)).toEqual("첫 번째");
  });

  test("a skill is titled by its name, whether the target is the bare name or a file under it", () => {
    expect(
      rowTitleOf(
        rowVM({ kind: "skill", op: "create", target: "cache-debug", diff: "+ # cache-debug" }),
      ),
    ).toEqual("스킬 cache-debug");
    expect(
      rowTitleOf(
        rowVM({
          kind: "skill",
          op: "add_file",
          target: "cache-debug/references/notes.md",
          diff: "+ 참고",
        }),
      ),
    ).toEqual("스킬 cache-debug");
  });

  test("removing a skill names it; removing a memory names the first removed line; with nothing to name it says the kind", () => {
    expect(
      rowTitleOf(
        rowVM({
          kind: "skill",
          op: "archive",
          target: "cache-debug",
          diff: "@@ archive cache-debug",
        }),
      ),
    ).toEqual("스킬 지우기: cache-debug");
    expect(
      rowTitleOf(
        rowVM({
          kind: "memory",
          op: "remove",
          target: "user/0123456789ab",
          diff: "@@ remove user/0123456789ab\n- 커밋 메시지는 한 줄로 쓴다.",
        }),
      ),
    ).toEqual("메모리 지우기: 커밋 메시지는 한 줄로 쓴다.");
    expect(
      rowTitleOf(
        rowVM({
          kind: "memory",
          op: "remove",
          target: "user/0123456789ab",
          diff: "@@ remove user/0123456789ab",
        }),
      ),
    ).toEqual("메모리 지우기");
  });

  test("a memory replace is titled by its new text, and a feedback with no text gives its kind alone", () => {
    expect(
      rowTitleOf(
        rowVM({
          kind: "memory",
          op: "replace",
          target: "user/0123456789ab",
          diff: "@@ replace user/0123456789ab\n+ 새 기억 한 줄",
        }),
      ),
    ).toEqual("새 기억 한 줄");
    expect(
      rowTitleOf(rowVM({ kind: "feedback", op: "add", target: "user/work-style", diff: "" })),
    ).toEqual("피드백");
  });
});

describe("expiryDateTextOf", () => {
  test("the expiry date is a long local date in the locale, with no time", () => {
    const at = new Date(2033, 5, 17, 12).getTime();
    expect(expiryDateTextOf(at, "ko")).toEqual("2033년 6월 17일");
    expect(expiryDateTextOf(at, "en")).toEqual("June 17, 2033");
  });
});

describe("충돌 스킬 대화 상자 상태", () => {
  const VIEW: WireResult<"knowledge.skills.view"> = {
    name: "cache-debug",
    scope: "user",
    description: "캐시 만료를 디버깅한다",
    body: "1. 단위를 확인한다",
    bodyTruncated: false,
    files: ["references/notes.md"],
    treeHash: "a".repeat(64),
  };
  const USER_REQUEST: SkillRequest = { name: "cache-debug", threadId: null };
  const PROJECT_REQUEST: SkillRequest = {
    name: "cache-debug",
    threadId: "thr_00000000000000000000000001",
  };

  test("opening sets loading with its request, and the reply for that request becomes ready", () => {
    const opened = proposalsReducer(INITIAL_PROPOSALS_STATE, {
      type: "skillOpened",
      request: USER_REQUEST,
    });
    expect(opened.skill).toEqual({ status: "loading", name: "cache-debug", threadId: null });
    const loaded = proposalsReducer(opened, {
      type: "skillLoaded",
      request: USER_REQUEST,
      skill: VIEW,
    });
    expect(loaded.skill).toEqual({
      status: "ready",
      name: "cache-debug",
      threadId: null,
      skill: VIEW,
    });
  });

  test("a failure keeps its request, so a retry asks for the same skill and project workspace", () => {
    const failed = proposalsReducer(
      proposalsReducer(INITIAL_PROPOSALS_STATE, { type: "skillOpened", request: PROJECT_REQUEST }),
      { type: "skillFailed", request: PROJECT_REQUEST, failure: "notFound" },
    );
    expect(failed.skill).toEqual({
      status: "notFound",
      name: "cache-debug",
      threadId: "thr_00000000000000000000000001",
    });
    const retried = proposalsReducer(failed, { type: "skillOpened", request: PROJECT_REQUEST });
    expect(retried.skill).toEqual({
      status: "loading",
      name: "cache-debug",
      threadId: "thr_00000000000000000000000001",
    });
  });

  test("a reply after the dialog closed, or for another skill, is dropped", () => {
    const open = proposalsReducer(INITIAL_PROPOSALS_STATE, {
      type: "skillOpened",
      request: USER_REQUEST,
    });
    const closed = proposalsReducer(open, { type: "skillClosed" });
    expect(closed.skill).toEqual({ status: "closed" });
    expect(
      proposalsReducer(closed, { type: "skillLoaded", request: USER_REQUEST, skill: VIEW }).skill,
    ).toEqual({ status: "closed" });

    const other = proposalsReducer(open, {
      type: "skillOpened",
      request: { name: "other-skill", threadId: null },
    });
    expect(
      proposalsReducer(other, { type: "skillLoaded", request: USER_REQUEST, skill: VIEW }).skill,
    ).toEqual({ status: "loading", name: "other-skill", threadId: null });
    expect(
      proposalsReducer(other, { type: "skillFailed", request: USER_REQUEST, failure: "failed" })
        .skill,
    ).toEqual({ status: "loading", name: "other-skill", threadId: null });
  });

  test("the host's errors map to the four reasons the dialog shows; a missing connection is offline", () => {
    expect([
      skillFailureOf({ kind: "not_found" }),
      skillFailureOf({ kind: "unsupported" }),
      skillFailureOf({ kind: "offline" }),
      skillFailureOf({ kind: "failed" }),
      skillFailureOf({ kind: "rejected", code: -32603 }),
      skillFailureOf({ kind: "locked", ownerKind: "tui", options: [] }),
      skillFailureOf({ kind: "switching" }),
    ]).toEqual(["notFound", "unsupported", "offline", "failed", "failed", "failed", "failed"]);
  });
});

describe("overlayOpenOf", () => {
  test("a confirm, an editor or the skill dialog holds the list keys; a closed screen does not", () => {
    expect(overlayOpenOf(INITIAL_PROPOSALS_STATE)).toBe(false);
    expect(
      overlayOpenOf(
        proposalsReducer(INITIAL_PROPOSALS_STATE, {
          type: "confirmOpened",
          key: "learning:p1",
          action: "revert",
        }),
      ),
    ).toBe(true);
    expect(
      overlayOpenOf(
        proposalsReducer(INITIAL_PROPOSALS_STATE, {
          type: "editorOpened",
          mode: "reject",
          key: "learning:p1",
        }),
      ),
    ).toBe(true);
    const skillOpen = proposalsReducer(INITIAL_PROPOSALS_STATE, {
      type: "skillOpened",
      request: { name: "cache-debug", threadId: null },
    });
    expect(overlayOpenOf(skillOpen)).toBe(true);
    expect(overlayOpenOf(proposalsReducer(skillOpen, { type: "skillClosed" }))).toBe(false);
  });
});

describe("learning state", () => {
  test("a read stores the learning state, and a closed screen starts unknown", () => {
    expect(INITIAL_PROPOSALS_STATE.learning).toEqual({ status: "unknown" });
    const off = proposalsReducer(INITIAL_PROPOSALS_STATE, {
      type: "learningRead",
      learning: { status: "off", turnOn: null },
    });
    expect(off.learning).toEqual({ status: "off", turnOn: null });
  });
});
