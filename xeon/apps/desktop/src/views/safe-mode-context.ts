import { createContext, useContext, type Context } from "react";
import type { SafeModeSnapshot } from "./commands.ts";

// 안전 모드 상태(U-06). `safe-mode-provider.tsx`가 엔진이 running이 될 때 읽어 얹는다. 값이 없으면(읽기 전, 읽기 실패) null이고 그때는 아무것도 보이지 않는다.
// shell-restart-context.ts와 같은 방식이다.

export const SafeModeContext: Context<SafeModeSnapshot | null> =
  createContext<SafeModeSnapshot | null>(null);

export function useSafeMode(): SafeModeSnapshot | null {
  return useContext(SafeModeContext);
}
