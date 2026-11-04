import { createContext, useContext, type Context } from "react";

// 셸이 엔진을 다시 띄울 수 있는지(U-02). 데스크톱 진입점(`main.tsx`)이 참으로 준다.
// 웹 진입점은 주지 않아 거짓이고, 그때는 "지금 다시 시작" 단추 대신 "서비스를 다시 시작해야 해요" 한 줄만 보인다.
// folder-pick-context.ts와 같은 방식이다.

export const ShellRestartContext: Context<boolean> = createContext<boolean>(false);

export function useShellRestart(): boolean {
  return useContext(ShellRestartContext);
}
