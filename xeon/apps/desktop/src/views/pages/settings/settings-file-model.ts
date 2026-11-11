import { t } from "@fresnel/client/i18n";
import { assertNever, jsonErrorPosition } from "@fresnel/contracts";
import type { SettingsReadFileResult } from "@fresnel/contracts/wire";
import type { CommandError } from "../../commands.ts";
import { errorText } from "../../settings.tsx";

// 설정 파일 편집기(P-09 "파일로 보기")의 순수 모델. 사용자 설정 파일 하나의 읽은 원문, 고치는 초안, 저장, 충돌, 다시 읽기의 전이를 값으로 만든다.
// 범위는 사용자 하나다(프로젝트 파일은 편집기에서 열지 않는다). 호스트를 부르지 않고 DOM도 보지 않는다.
// 명령은 `settings-screen.tsx`가 부르고, 응답은 번호(`seq`)가 맞을 때만 반영한다.
// 저장 기준은 마지막으로 읽거나 쓴 원문(`doc.text`)이고, `doc.sha256`이 `writeFile`의 `baseSha256`이다.

/** 파일 한 번 읽은 내용(`settings.readFile`의 결과 가운데 편집에 쓰는 것) */
export type FileDoc = Pick<
  SettingsReadFileResult,
  "path" | "exists" | "readOnly" | "text" | "sha256"
>;

/**
 * 편집기 단계.
 * - `closed`: 편집기가 닫혀 있다
 * - `loading`: 읽는 중이다(처음 열 때, 범위를 바꿀 때, 다시 읽을 때)
 * - `ready`: 원문을 보고 고칠 수 있다
 * - `conflict`: 저장하려는데 파일이 다른 곳에서 바뀌었다. 초안은 남고, 다시 읽어야 저장할 수 있다
 * - `failed`: 읽지 못했다. 다시 읽기로 한 번 더 한다
 */
type FileEditorPhase = "closed" | "loading" | "ready" | "conflict" | "failed";

export interface FileEditorState {
  readonly phase: FileEditorPhase;
  /** 마지막으로 시작한 읽기나 쓰기의 번호. 번호가 다른 늦은 응답은 버린다 */
  readonly seq: number;
  /** 마지막으로 읽었거나 쓴 원문. 저장 기준이다 */
  readonly doc: FileDoc | null;
  /** 지금 고치는 원문 */
  readonly draft: string;
  readonly saving: boolean;
  /** 읽기 실패나 저장 실패의 오류. 충돌은 `conflict` 단계가 맡으므로 여기에 오지 않는다 */
  readonly error: CommandError | null;
  /** 방금 저장했는지. "저장됨" 표시는 2초 뒤 `savedMarkCleared`로 지운다 */
  readonly saved: boolean;
}

export const initialFileEditor: FileEditorState = {
  phase: "closed",
  seq: 0,
  doc: null,
  draft: "",
  saving: false,
  error: null,
  saved: false,
};

export type FileEditorAction =
  | { readonly type: "started"; readonly seq: number }
  | { readonly type: "closed" }
  | { readonly type: "loaded"; readonly seq: number; readonly doc: FileDoc }
  | { readonly type: "loadFailed"; readonly seq: number; readonly error: CommandError }
  | { readonly type: "edited"; readonly text: string }
  | { readonly type: "discarded" }
  | { readonly type: "saveStarted"; readonly seq: number }
  | {
      readonly type: "saved";
      readonly seq: number;
      readonly path: string;
      readonly sha256: string;
      readonly text: string;
    }
  | { readonly type: "saveConflicted"; readonly seq: number }
  | { readonly type: "saveFailed"; readonly seq: number; readonly error: CommandError }
  | { readonly type: "savedMarkCleared" };

/**
 * host가 파일 전체 검사에서 주는 첫 문장(`settings.fileInvalid`의 issues[0], path "")이다. 화면은 이 영어 문장을 보이지 않고 메시지 키로 바꾼다.
 * 올바른 JSON이 아니어도 같은 문장이 온다(apps/host/src/handlers/settings.ts `checkFileText`).
 */
export const FILE_NOT_OBJECT_DETAIL = "the settings file must be a JSON object";

/**
 * 저장 실패 문장. host가 객체가 아니라고 한 초안은 문법 위치(`jsonErrorPosition`)가 있으면 그 줄과 칸을 붙이고,
 * 위치가 없으면(올바른 JSON인데 배열 등) 객체여야 한다는 문장만 쓴다. 다른 오류는 `errorText`가 쓴다.
 * `draft`는 저장을 보낸 원문이다. 저장이 실패해도 초안은 그대로 남으므로 편집기의 `draft`를 넘긴다.
 */
export function fileErrorTextOf(error: CommandError, draft: string): string {
  if (error.kind !== "rejected" || error.detail !== FILE_NOT_OBJECT_DETAIL) return errorText(error);
  const position = jsonErrorPosition(draft);
  if (position === undefined) return t("desktop.settings.file.notObject");
  return t("desktop.settings.file.syntaxAt", { line: position.line, column: position.column });
}

/** 초안이 읽은 원문과 다른가. 읽기 전에는 다르지 않다 */
export function fileDirtyOf(state: FileEditorState): boolean {
  return state.doc !== null && state.draft !== state.doc.text;
}

/** 탭을 옮길 때 열린 파일 칸을 닫아도 되는가: 열려 있고, 고친 초안이 없고, 저장 중이 아니다 */
export function fileClosesOnTabMoveOf(state: FileEditorState): boolean {
  return state.phase !== "closed" && !fileDirtyOf(state) && !state.saving;
}

/** 초안을 바꿀 수 있는 상태인가: 원문을 읽었고, 쓸 수 있는 파일이고, 저장 중이 아니다. 연결은 화면이 따로 본다 */
function draftWritableOf(state: FileEditorState): boolean {
  return (
    (state.phase === "ready" || state.phase === "conflict") &&
    !state.saving &&
    state.doc !== null &&
    !state.doc.readOnly
  );
}

/** 원문을 고칠 수 있는가: 연결이 살아 있고 초안을 바꿀 수 있는 상태다 */
export function fileEditableOf(state: FileEditorState, live: boolean): boolean {
  return live && draftWritableOf(state);
}

/** "저장"을 누를 수 있는가. 충돌 뒤에는 다시 읽어야 하므로 막는다 */
export function fileSaveableOf(state: FileEditorState, live: boolean): boolean {
  return fileEditableOf(state, live) && state.phase === "ready" && fileDirtyOf(state);
}

/** "되돌리기"를 누를 수 있는가. 연결과 무관하게 초안만 되돌린다 */
export function fileDiscardableOf(state: FileEditorState): boolean {
  return state.doc !== null && !state.saving && fileDirtyOf(state);
}

/** "닫기"를 누를 수 있는가. 저장하지 않은 초안이 있거나 저장 중이면 닫지 않는다 */
export function fileCloseableOf(state: FileEditorState): boolean {
  return !state.saving && !fileDirtyOf(state);
}

export function fileEditorReducer(
  state: FileEditorState,
  action: FileEditorAction,
): FileEditorState {
  switch (action.type) {
    case "started":
      // 저장 중에는 다시 읽지 않는다. 초안을 거르는 일은 화면이 막는다
      if (state.saving) return state;
      return { ...initialFileEditor, phase: "loading", seq: action.seq };
    case "closed":
      // 초안이 남았거나 저장 중이면 닫지 않는다. 번호는 그대로 둬서 닫기 전에 보낸 응답이 맞지 않게 한다
      if (state.saving || fileDirtyOf(state)) return state;
      return { ...initialFileEditor, seq: state.seq };
    case "loaded":
      if (state.phase !== "loading" || action.seq !== state.seq) return state;
      return { ...state, phase: "ready", doc: action.doc, draft: action.doc.text, error: null };
    case "loadFailed":
      if (state.phase !== "loading" || action.seq !== state.seq) return state;
      return { ...state, phase: "failed", error: action.error };
    case "edited":
      if (!draftWritableOf(state)) return state;
      return { ...state, draft: action.text, error: null, saved: false };
    case "discarded":
      if (state.doc === null || state.saving) return state;
      return { ...state, draft: state.doc.text, error: null, saved: false };
    case "saveStarted":
      // 저장은 고쳐진 초안이 있을 때만 시작한다. 연결이 살아 있는지는 화면이 본다
      if (state.phase !== "ready" || state.saving || state.doc === null || !fileDirtyOf(state)) {
        return state;
      }
      return { ...state, seq: action.seq, saving: true, error: null, saved: false };
    case "saved":
      if (!state.saving || action.seq !== state.seq || state.doc === null) return state;
      return {
        ...state,
        saving: false,
        saved: true,
        doc: {
          ...state.doc,
          path: action.path,
          exists: true,
          text: action.text,
          sha256: action.sha256,
        },
      };
    case "saveConflicted":
      if (!state.saving || action.seq !== state.seq) return state;
      return { ...state, phase: "conflict", saving: false, error: null };
    case "saveFailed":
      if (!state.saving || action.seq !== state.seq) return state;
      return { ...state, saving: false, error: action.error };
    case "savedMarkCleared":
      return state.saved ? { ...state, saved: false } : state;
    default:
      return assertNever(action, "FileEditorAction");
  }
}
