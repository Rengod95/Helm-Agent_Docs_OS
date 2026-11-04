import { createContext, useContext, type Context } from "react";

// 대화 이름으로 가기. 셸이 받은 `onGoToThread`(App의 `openThread`)를 이 문맥으로 내리고, 승인 카드 머리가 읽는다.
// 문맥이 없으면 null이고 카드는 링크를 그리지 않는다(열 곳이 없다).

export type GoToThread = (threadId: string) => void;

export const GoToThreadContext: Context<GoToThread | null> = createContext<GoToThread | null>(null);

export function useGoToThread(): GoToThread | null {
  return useContext(GoToThreadContext);
}
