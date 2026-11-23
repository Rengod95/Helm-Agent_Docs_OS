// 보드와 순서 목록의 낙관적 갱신(AGE-78 질문 7). React가 없어 시험이 화면과 같은 함수를 그대로 돈다.
// 놓는 즉시 화면은 초안(draft)을 그리고, 쓰기 메서드가 실패하면 초안을 버려 서버 값으로 되돌린 뒤 한 줄로 알린다.
// 초안은 받은 데이터의 서명(`basis`)에 묶인다. 데이터가 새로 오면(확장이 바꿨다는 알림이나 주기 읽기) 서명이 바뀌어 초안은 저절로 빠진다.

export interface Draft<T> {
  /** 초안을 만들 때의 데이터 서명 */
  readonly basis: string;
  /** 놓기 차례 번호. 늦게 끝난 앞의 실패가 뒤의 초안을 지우지 않게 한다 */
  readonly seq: number;
  readonly value: T;
}

/** 지금 그릴 값. 초안이 지금 데이터에 묶여 있으면 초안, 아니면 서버 값이다 */
export function shownOf<T>(server: T, basis: string, draft: Draft<T> | undefined): T {
  return draft !== undefined && draft.basis === basis ? draft.value : server;
}

/** 받은 목록들의 서명. 같은 데이터면 같은 글이다. 목록은 풀린 스칼라와 평평한 레코드뿐이라 직렬화가 실패하지 않는다 */
export function basisOf(lists: readonly unknown[]): string {
  return JSON.stringify(lists);
}

export type DraftUpdate<T> = (current: Draft<T> | undefined) => Draft<T> | undefined;

/**
 * 놓기 하나. 초안을 바로 세우고 메서드를 부른다. 실패하면 그 초안이 아직 마지막 것일 때만 지우고(`onFailed`는 늘 부른다) 거짓을 돌려준다.
 * 던지지 않는다(`call`은 거짓으로 실패를 알린다)
 */
export async function commitDraft<T>(input: {
  readonly draft: Draft<T>;
  readonly setDraft: (update: DraftUpdate<T>) => void;
  readonly call: () => Promise<boolean>;
  readonly onFailed: () => void;
}): Promise<boolean> {
  const { draft, setDraft, call, onFailed } = input;
  setDraft(() => draft);
  const ok = await call();
  if (ok) return true;
  setDraft((current) => (current?.seq === draft.seq ? undefined : current));
  onFailed();
  return false;
}
