import { createContext, useContext, type Context } from "react";
import type { UpdateController } from "./update-controller.ts";

// 업데이트 컨트롤러를 상태 표시줄의 칸과 설정 줄까지 내린다. 데스크톱 진입점(`main.tsx`)이 만들어 준다.
// 문맥이 없으면 null이고 화면은 업데이트 칸과 줄을 그리지 않는다(웹 등). folder-pick-context.ts와 같은 방식이다.

export const UpdateContext: Context<UpdateController | null> =
  createContext<UpdateController | null>(null);

export function useUpdate(): UpdateController | null {
  return useContext(UpdateContext);
}
