import { createContext, useContext, type Context } from "react";
import type { FolderPickInvoke } from "./folder-pick.ts";

// 폴더 선택 창을 여는 invoke를 화면 깊은 곳(설치 대화 상자)까지 내린다. App이 받은 `folderPick`을 이 문맥으로 준다.
// 문맥이 없으면 null이고 화면은 "폴더 고르기" 단추를 그리지 않는다(웹 등).

export const FolderPickContext: Context<FolderPickInvoke | null> =
  createContext<FolderPickInvoke | null>(null);

export function useFolderPick(): FolderPickInvoke | null {
  return useContext(FolderPickContext);
}
