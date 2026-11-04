import { createContext, useContext, type Context } from "react";
import type { FileSaveInvoke } from "./file-save.ts";

// 저장 창을 여는 invoke를 대화 내보내기 대화 상자까지 내린다. App이 받은 `fileSave`를 이 문맥으로 준다.
// 문맥이 없으면 null이고 대화 상자는 "저장…" 대신 "내려받기"를 보인다(웹 등).

export const FileSaveContext: Context<FileSaveInvoke | null> = createContext<FileSaveInvoke | null>(
  null,
);

export function useFileSave(): FileSaveInvoke | null {
  return useContext(FileSaveContext);
}
