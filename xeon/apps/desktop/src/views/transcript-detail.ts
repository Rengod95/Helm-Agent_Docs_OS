import { useSyncExternalStore } from "react";

// 대화 기록에 보이는 생각과 도구 호출의 양(설정 "외관"의 "생각·도구 표시" 줄). 원천은 이 기기의 로컬 설정(`LOCAL.transcriptDetail`)이다.
// `appearance-prefs.ts`가 시작할 때와 저장할 때 값을 여기에 밀어 넣고, 대화 기록 화면은 `useTranscriptDetail`로 받는다.
// 셸이 없는 웹 미리보기에서는 아무도 밀지 않으므로 기본값 "full"이 그대로 쓰인다.
//   full: 생각을 펼치고 모든 도구 줄을 보인다.
//   summary: 생각을 한 줄로 접고 도구 줄을 접는다.
//   hidden: 생각과 성공한 도구 줄을 숨기고, 실패·실행 중·승인 대기 줄은 보인다.

export type TranscriptDetail = "full" | "summary" | "hidden";

export const TRANSCRIPT_DETAILS: readonly TranscriptDetail[] = ["full", "summary", "hidden"];

export const DEFAULT_TRANSCRIPT_DETAIL: TranscriptDetail = "full";

/** 저장된 값을 읽는다. 없거나 목록에 없는 값이면 기본값("full")이다 */
export function transcriptDetailOf(value: unknown): TranscriptDetail {
  return TRANSCRIPT_DETAILS.find((detail) => detail === value) ?? DEFAULT_TRANSCRIPT_DETAIL;
}

let current: TranscriptDetail = DEFAULT_TRANSCRIPT_DETAIL;
const listeners = new Set<() => void>();

export function getTranscriptDetail(): TranscriptDetail {
  return current;
}

/** 값을 바꾸고 구독한 화면에 알린다. 같은 값이면 알리지 않는다 */
export function setTranscriptDetailValue(value: TranscriptDetail): void {
  if (value === current) return;
  current = value;
  for (const listener of listeners) listener();
}

export function subscribeTranscriptDetail(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 대화 기록 화면이 쓰는 훅. 값이 바뀌면 이 값을 읽는 화면만 다시 그린다 */
export function useTranscriptDetail(): TranscriptDetail {
  return useSyncExternalStore(subscribeTranscriptDetail, getTranscriptDetail, getTranscriptDetail);
}
