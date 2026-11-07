import { createContext, useContext, type Context } from "react";
import type { ShellActions } from "../state/shell/index.ts";
import type { WorkbenchActions } from "../state/workbench/index.ts";

// 확장 기록으로 가기(대화 행의 "기록 보기"). 값은 워크벤치 쪽이 준다(`workbench/records-jump.tsx`). 문맥이 없으면 null이고
// 행은 링크를 그리지 않는다(열 곳이 없다). `thread-link.ts`와 같은 모양이다.

export type OpenExtensionRecords = (extension: string) => void;

export const OpenExtensionRecordsContext: Context<OpenExtensionRecords | null> =
  createContext<OpenExtensionRecords | null>(null);

export function useOpenExtensionRecords(): OpenExtensionRecords | null {
  return useContext(OpenExtensionRecordsContext);
}

/**
 * 확장 기록으로 가는 동작: 작업대 영역의 확장 화면으로 가고, 그 확장을 고른 뒤 자세히 보기를 기록 탭으로 연다.
 * 자세히 보기는 고른 확장을 가리키므로(`openDetail`은 선택을 바꾸지 않는다) 고르기를 먼저 한다
 */
export function recordsJumpOf(
  shell: ShellActions,
  workbench: WorkbenchActions,
): OpenExtensionRecords {
  return (extension) => {
    shell.switchArea("workbench");
    shell.updatePlace({ screen: "extensions", scroll: 0 });
    workbench.pickPlugin(extension);
    workbench.openDetail(extension, "record");
  };
}
