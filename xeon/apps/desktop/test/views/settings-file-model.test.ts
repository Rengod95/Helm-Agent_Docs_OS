import { describe, expect, test } from "bun:test";
import {
  fileCloseableOf,
  fileDirtyOf,
  fileDiscardableOf,
  fileEditableOf,
  fileEditorReducer,
  fileSaveableOf,
  fileScopesOf,
  initialFileEditor,
  type FileDoc,
  type FileEditorAction,
  type FileEditorState,
} from "../../src/views/pages/settings/settings-file-model.ts";
import { thr } from "../state/helpers.ts";

// 설정 파일 편집기의 순수 전이 시험. 응답은 번호가 맞을 때만 들어가고, 충돌과 저장 실패는 초안을 남기고,
// 오프라인은 편집과 저장을 잠근다. 값은 `toBe`·`toEqual`로 정확히 비교한다.

const SHA = "ab".repeat(32);
const NEXT = "cd".repeat(32);
const PATH = "/home/user/.fresnel/settings.json";
const TEXT = '{\n  "l1.models.default": "sonnet"\n}\n';

const DOC: FileDoc = { path: PATH, exists: true, readOnly: false, text: TEXT, sha256: SHA };

function run(...actions: readonly FileEditorAction[]): FileEditorState {
  return actions.reduce(fileEditorReducer, initialFileEditor);
}

/** 읽기를 끝낸 편집기. 번호 1, 사용자 범위 */
function ready(): FileEditorState {
  return run(
    { type: "started", seq: 1, scope: "user", threadId: null },
    { type: "loaded", seq: 1, doc: DOC },
  );
}

describe("opening and reading", () => {
  test("opening starts a read with the scope, the conversation and a new number", () => {
    const state = fileEditorReducer(initialFileEditor, {
      type: "started",
      seq: 1,
      scope: "project",
      threadId: thr(1),
    });
    expect(state.phase).toBe("loading");
    expect(state.seq).toBe(1);
    expect(state.scope).toBe("project");
    expect(state.threadId).toBe(thr(1));
    expect(state.doc).toBeNull();
    expect(state.draft).toBe("");
  });

  test("a read that arrives loads the text into the draft and the draft is clean", () => {
    const state = ready();
    expect(state.phase).toBe("ready");
    expect(state.doc).toEqual(DOC);
    expect(state.draft).toBe(TEXT);
    expect(fileDirtyOf(state)).toBe(false);
  });

  test("a read answer with another number is ignored", () => {
    const loading = run({ type: "started", seq: 2, scope: "user", threadId: null });
    const late = fileEditorReducer(loading, { type: "loaded", seq: 1, doc: DOC });
    expect(late).toBe(loading);
  });

  test("a failed read keeps the reason and shows the retry phase", () => {
    const state = run(
      { type: "started", seq: 1, scope: "user", threadId: null },
      {
        type: "loadFailed",
        seq: 1,
        error: { kind: "rejected", code: 3108, detail: "값이 맞지 않아요" },
      },
    );
    expect(state.phase).toBe("failed");
    expect(state.error).toEqual({ kind: "rejected", code: 3108, detail: "값이 맞지 않아요" });
  });

  test("a missing file starts empty and is saved with no base hash", () => {
    const missing: FileDoc = { path: PATH, exists: false, readOnly: false, text: "", sha256: null };
    const state = run(
      { type: "started", seq: 1, scope: "user", threadId: null },
      { type: "loaded", seq: 1, doc: missing },
    );
    expect(state.draft).toBe("");
    expect(state.doc?.sha256).toBeNull();
    const edited = fileEditorReducer(state, { type: "edited", text: "{}\n" });
    expect(fileSaveableOf(edited, true)).toBe(true);
  });

  test("a read-only file cannot be edited or saved", () => {
    const locked: FileDoc = { ...DOC, readOnly: true };
    const state = run(
      { type: "started", seq: 1, scope: "user", threadId: null },
      { type: "loaded", seq: 1, doc: locked },
    );
    expect(fileEditableOf(state, true)).toBe(false);
    const typed = fileEditorReducer(state, { type: "edited", text: "{}" });
    expect(typed.draft).toBe(TEXT);
  });
});

describe("editing, discarding and closing", () => {
  test("an edit makes the draft dirty and a save is possible only while live", () => {
    const state = fileEditorReducer(ready(), { type: "edited", text: "{}\n" });
    expect(fileDirtyOf(state)).toBe(true);
    expect(fileSaveableOf(state, true)).toBe(true);
    expect(fileSaveableOf(state, false)).toBe(false);
  });

  test("discard puts the read text back and leaves nothing to discard", () => {
    const edited = fileEditorReducer(ready(), { type: "edited", text: "{}\n" });
    const discarded = fileEditorReducer(edited, { type: "discarded" });
    expect(discarded.draft).toBe(TEXT);
    expect(fileDirtyOf(discarded)).toBe(false);
    expect(fileDiscardableOf(discarded)).toBe(false);
  });

  test("closing is refused while the draft is not saved and works once it is discarded", () => {
    const edited = fileEditorReducer(ready(), { type: "edited", text: "{}\n" });
    expect(fileCloseableOf(edited)).toBe(false);
    expect(fileEditorReducer(edited, { type: "closed" })).toBe(edited);
    const closed = fileEditorReducer(fileEditorReducer(edited, { type: "discarded" }), {
      type: "closed",
    });
    expect(closed.phase).toBe("closed");
    expect(closed.doc).toBeNull();
  });

  test("a read that answers after closing does not reopen the editor", () => {
    const closed = fileEditorReducer(fileEditorReducer(ready(), { type: "closed" }), {
      type: "closed",
    });
    const late = fileEditorReducer(closed, { type: "loaded", seq: 1, doc: DOC });
    expect(late.phase).toBe("closed");
  });

  test("offline keeps the read text and locks editing and saving, discard still works", () => {
    const edited = fileEditorReducer(ready(), { type: "edited", text: "{}\n" });
    expect(fileEditableOf(edited, false)).toBe(false);
    expect(fileSaveableOf(edited, false)).toBe(false);
    expect(fileDiscardableOf(edited)).toBe(true);
    expect(edited.draft).toBe("{}\n");
  });

  test("the scope choice has only the user scope without a conversation", () => {
    expect(fileScopesOf(false)).toEqual(["user"]);
    expect(fileScopesOf(true)).toEqual(["user", "project", "local"]);
  });
});

describe("saving", () => {
  test("a saved file takes the new hash and text as its base and shows the saved mark", () => {
    const edited = fileEditorReducer(ready(), { type: "edited", text: "{}\n" });
    const sending = fileEditorReducer(edited, { type: "saveStarted", seq: 2 });
    expect(sending.saving).toBe(true);
    expect(fileEditableOf(sending, true)).toBe(false);
    const saved = fileEditorReducer(sending, {
      type: "saved",
      seq: 2,
      path: PATH,
      sha256: NEXT,
      text: "{}\n",
    });
    expect(saved.saving).toBe(false);
    expect(saved.saved).toBe(true);
    expect(saved.doc).toEqual({ ...DOC, text: "{}\n", sha256: NEXT });
    expect(fileDirtyOf(saved)).toBe(false);
    const cleared = fileEditorReducer(saved, { type: "savedMarkCleared" });
    expect(cleared.saved).toBe(false);
    expect(fileEditorReducer(cleared, { type: "savedMarkCleared" })).toBe(cleared);
  });

  test("a conflict keeps the draft, blocks saving, and still allows editing and discard", () => {
    const edited = fileEditorReducer(ready(), { type: "edited", text: "{}\n" });
    const sending = fileEditorReducer(edited, { type: "saveStarted", seq: 2 });
    const conflict = fileEditorReducer(sending, { type: "saveConflicted", seq: 2 });
    expect(conflict.phase).toBe("conflict");
    expect(conflict.draft).toBe("{}\n");
    expect(conflict.error).toBeNull();
    expect(fileDirtyOf(conflict)).toBe(true);
    expect(fileSaveableOf(conflict, true)).toBe(false);
    expect(fileEditableOf(conflict, true)).toBe(true);
    expect(fileDiscardableOf(conflict)).toBe(true);
  });

  test("a reread after a conflict replaces the draft with the file as it is now", () => {
    const edited = fileEditorReducer(ready(), { type: "edited", text: "{}\n" });
    const sending = fileEditorReducer(edited, { type: "saveStarted", seq: 2 });
    const conflicted = fileEditorReducer(sending, { type: "saveConflicted", seq: 2 });
    const reading = fileEditorReducer(conflicted, {
      type: "started",
      seq: 3,
      scope: "user",
      threadId: null,
    });
    expect(reading.phase).toBe("loading");
    const now: FileDoc = { ...DOC, text: '{ "other": true }\n', sha256: NEXT };
    const reloaded = fileEditorReducer(reading, { type: "loaded", seq: 3, doc: now });
    expect(reloaded.phase).toBe("ready");
    expect(reloaded.draft).toBe('{ "other": true }\n');
    expect(fileDirtyOf(reloaded)).toBe(false);
  });

  test("a save failure keeps the draft and the reason, and the editor stays ready", () => {
    const edited = fileEditorReducer(ready(), { type: "edited", text: "{}\n" });
    const sending = fileEditorReducer(edited, { type: "saveStarted", seq: 2 });
    const failed = fileEditorReducer(sending, {
      type: "saveFailed",
      seq: 2,
      error: { kind: "failed" },
    });
    expect(failed.phase).toBe("ready");
    expect(failed.saving).toBe(false);
    expect(failed.error).toEqual({ kind: "failed" });
    expect(failed.draft).toBe("{}\n");
    expect(fileSaveableOf(failed, true)).toBe(true);
  });

  test("a save answer with another number is ignored", () => {
    const edited = fileEditorReducer(ready(), { type: "edited", text: "{}\n" });
    const sending = fileEditorReducer(edited, { type: "saveStarted", seq: 2 });
    expect(
      fileEditorReducer(sending, { type: "saved", seq: 1, path: PATH, sha256: NEXT, text: "{}\n" }),
    ).toBe(sending);
    expect(fileEditorReducer(sending, { type: "saveConflicted", seq: 1 })).toBe(sending);
    expect(
      fileEditorReducer(sending, { type: "saveFailed", seq: 1, error: { kind: "failed" } }),
    ).toBe(sending);
  });

  test("a read cannot start while a save is running, and an edit cannot land then", () => {
    const sending = fileEditorReducer(
      fileEditorReducer(ready(), { type: "edited", text: "{}\n" }),
      { type: "saveStarted", seq: 2 },
    );
    expect(
      fileEditorReducer(sending, { type: "started", seq: 3, scope: "user", threadId: null }),
    ).toBe(sending);
    expect(fileEditorReducer(sending, { type: "edited", text: "x" })).toBe(sending);
    expect(fileEditorReducer(sending, { type: "closed" })).toBe(sending);
  });

  test("a save is not started without a read or with no change", () => {
    const clean = ready();
    expect(fileSaveableOf(clean, true)).toBe(false);
    expect(fileEditorReducer(clean, { type: "saveStarted", seq: 2 })).toBe(clean);
  });
});
