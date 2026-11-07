// 한글 같은 IME 조합 중 Enter는 글자를 확정하는 키이지 저장·제출이 아니다. WebKit과 Chromium은 마지막 음절 조합 중 Enter를
// `isComposing` 참으로 내거나(첫 keydown), compositionend 뒤 keydown을 `keyCode` 229로 낸다. 두 단서를 한 곳에서 본다.
// 입력창(`composer-model.ts`)은 조합 끝 직후 유예까지 보는 자기 가드를 따로 쓴다.

const IME_PROCESS_KEY_CODE = 229;

/** React `KeyboardEvent`에서 이 판정이 읽는 부분 */
export type ImeKeyEvent = {
  readonly key: string;
  readonly keyCode: number;
  readonly nativeEvent: { readonly isComposing: boolean };
};

/** 이 keydown이 IME가 가로챈 키인가(조합 중이거나 keyCode 229) */
function isImeKey(event: ImeKeyEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === IME_PROCESS_KEY_CODE;
}

/** 이 keydown이 IME가 쓴 Enter인가 */
export function isImeEnter(event: ImeKeyEvent): boolean {
  return event.key === "Enter" && isImeKey(event);
}

/** 저장·제출로 칠 Enter인가: Enter이고 조합 중이 아니다 */
export function isCommitEnter(event: ImeKeyEvent): boolean {
  return event.key === "Enter" && !isImeKey(event);
}
