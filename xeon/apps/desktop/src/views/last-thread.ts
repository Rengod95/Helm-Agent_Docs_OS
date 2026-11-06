// 앱을 다시 켤 때 마지막에 보던 대화를 여는 판정(L4.desktop-ux 창 다시 열 때 복원, scJ S1-1). 순수 함수라 화면 밖에서 시험한다.

export type RestoreInput<T extends string> = {
  /** 이 실행에서 이미 한 번 판정했다 */
  readonly decided: boolean;
  readonly threadsReady: boolean;
  /** 지금 선택된 대화 */
  readonly selected: string | null;
  /** 저장해 둔 마지막 대화 id */
  readonly saved: string | null;
  readonly threadIds: readonly T[];
};

export type RestoreStep<T extends string> =
  /** 목록이 아직 안 왔거나 이미 판정했다. 아무것도 하지 않는다 */
  | { readonly kind: "wait" }
  /** 판정을 끝낸다. 열 대화가 없다 */
  | { readonly kind: "none" }
  /** 판정을 끝내고 이 대화를 연다. 선택이 이 대화가 될 때까지 저장을 미룬다 */
  | { readonly kind: "open"; readonly threadId: T };

export function restoreStepOf<T extends string>(input: RestoreInput<T>): RestoreStep<T> {
  if (input.decided || !input.threadsReady) return { kind: "wait" };
  if (input.selected !== null) return { kind: "none" };
  const found = input.threadIds.find((id) => id === input.saved);
  return found === undefined ? { kind: "none" } : { kind: "open", threadId: found };
}

/**
 * 선택을 저장해도 되는가. 판정 전과, 연다고 판정한 대화가 아직 선택되지 않은 동안에는 저장하지 않는다:
 * 복원 직후의 선택(null)을 쓰면 저장해 둔 대화 id를 지워 버린다.
 */
export function mayPersistSelection(input: {
  readonly decided: boolean;
  readonly opening: string | null;
  readonly selected: string | null;
}): boolean {
  if (!input.decided) return false;
  return input.opening === null || input.selected === input.opening;
}
