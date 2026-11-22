// 테스트 챗 창이 빌린 대화(`window-model.ts`의 `Borrow`). 창 부품이 내려갔다 다시 서도 이어지도록 부품 밖에 두고,
// 창 밖의 Craft 화면이 빌린 대화를 따라가지 않도록(`useWorkThreadId`) 구독할 수 있게 둔다.
import { useSyncExternalStore } from "react";
import type { ThreadId } from "@fresnel/contracts/conversation";
import { useOpenThreadId } from "../../../state/engine/index.ts";
import { IDLE_BORROW, workThreadOf, type Borrow } from "./window-model.ts";

let borrow: Borrow = IDLE_BORROW;
const listeners = new Set<() => void>();

export function currentBorrow(): Borrow {
  return borrow;
}

function sameBorrow(a: Borrow, b: Borrow): boolean {
  if (a.kind === "idle" || b.kind === "idle") return a.kind === b.kind;
  return a.thread === b.thread && a.returnTo === b.returnTo;
}

export function setBorrow(next: Borrow): void {
  if (sameBorrow(next, borrow)) return;
  borrow = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 창 밖의 Craft 화면이 볼 대화. 창이 빌린 테스트 챗이 열려 있으면 빌리기 전의 대화다(`workThreadOf`) */
export function useWorkThreadId(): ThreadId | null {
  const open = useOpenThreadId();
  const lent = useSyncExternalStore(subscribe, currentBorrow, currentBorrow);
  return workThreadOf(lent, open);
}
