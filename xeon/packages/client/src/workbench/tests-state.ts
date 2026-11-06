// P-19 테스트 화면의 상태 전이. 목록은 읽기 상태(`TabRead`)로 따로 두고, 여기에는 거르기, 고른 행, Test run의 멈춤 표시,
// 새 시험 시트와 확인 대화 상자, 마지막 알림을 둔다. 값은 명령의 결과로만 바뀐다(거울에 넣지 않는다).
import { assertNever } from "@fresnel/contracts";
import type { ExtTestRunParams } from "@fresnel/contracts/wire";
import { ALL_TESTS, NEW_TEST_DEFAULT, type NewTestDraft, type TestFilter } from "./tests.ts";

/** 명령 실패의 종류(화면이 메시지로 바꾼다). 잠김과 엔진 대상 전환 중은 `failed`로 묶는다 */
export type TestFailure = "offline" | "unsupported" | "rejected" | "targetNotLoaded" | "failed";

export type TestsNotice =
  /** Test run 대화를 만들었다. `name`은 대화 이름이 된 대상 확장 이름이다 */
  | { readonly kind: "created"; readonly name: string }
  | { readonly kind: "started" }
  | { readonly kind: "copied" }
  | { readonly kind: "copyFailed" }
  | { readonly kind: "failed"; readonly failure: TestFailure };

export interface TestsUiState {
  readonly devMode: boolean;
  readonly filter: TestFilter;
  /** 고른 행의 시험 id. 목록에 없으면 상세를 그리지 않는다 */
  readonly selected: string | null;
  /** Test run 대화 id → 멈춘 채인가. 명령 결과로만 바뀐다(목록에 표지가 없다) */
  readonly paused: Readonly<Record<string, boolean>>;
  /** Test run 대화 id → 단계 이름(`testRun.phase`의 `phase`). 없으면 null */
  readonly phase: Readonly<Record<string, string | null>>;
  /** 새 시험 시트의 입력. null이면 닫혀 있다 */
  readonly sheet: NewTestDraft | null;
  readonly sending: boolean;
  /** 비용 확인 대화 상자에 올린 실행. null이면 대화 상자가 없다 */
  readonly confirm: ExtTestRunParams | null;
  readonly notice: TestsNotice | null;
}

export const INITIAL_TESTS_UI: TestsUiState = {
  devMode: false,
  filter: ALL_TESTS,
  selected: null,
  paused: {},
  phase: {},
  sheet: null,
  sending: false,
  confirm: null,
  notice: null,
};

export type TestsUiAction =
  | { readonly type: "devMode"; readonly devMode: boolean }
  | { readonly type: "filter"; readonly filter: TestFilter }
  | { readonly type: "select"; readonly testId: string | null }
  | { readonly type: "sheetOpen" }
  | { readonly type: "sheetChange"; readonly draft: NewTestDraft }
  | { readonly type: "sheetClose" }
  | { readonly type: "sending"; readonly sending: boolean }
  | { readonly type: "confirmOpen"; readonly params: ExtTestRunParams }
  | { readonly type: "confirmClose" }
  | { readonly type: "controlDone"; readonly threadId: string; readonly paused: boolean }
  | { readonly type: "phaseDone"; readonly threadId: string; readonly phase: string | null }
  | { readonly type: "notice"; readonly notice: TestsNotice | null };

export function testsUiReducer(state: TestsUiState, action: TestsUiAction): TestsUiState {
  switch (action.type) {
    case "devMode":
      return { ...state, devMode: action.devMode };
    case "filter":
      return { ...state, filter: action.filter };
    case "select":
      return { ...state, selected: action.testId };
    case "sheetOpen":
      return { ...state, sheet: NEW_TEST_DEFAULT, sending: false, notice: null };
    case "sheetChange":
      return { ...state, sheet: action.draft };
    case "sheetClose":
      return { ...state, sheet: null, sending: false, confirm: null };
    case "sending":
      return { ...state, sending: action.sending };
    case "confirmOpen":
      return { ...state, confirm: action.params };
    case "confirmClose":
      return { ...state, confirm: null };
    case "controlDone":
      return { ...state, paused: { ...state.paused, [action.threadId]: action.paused } };
    case "phaseDone":
      return { ...state, phase: { ...state.phase, [action.threadId]: action.phase } };
    case "notice":
      return { ...state, notice: action.notice };
    default:
      return assertNever(action, "TestsUiAction");
  }
}
