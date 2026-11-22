// 프로필 캔버스(C3)가 쓰는 엔진 명령의 진입점(`members-source.ts`, `review-source.ts`와 같은 자리). 캔버스 부품은 이 파일로만 명령을 받는다.
import { useCommands, type CommandError, type ProfileCanvasCommands } from "../../commands.ts";

export type { CommandError, ProfileCanvasCommands };

/** 프로필 목록, 카드, 블록을 읽고 프로필을 쓰는 명령 */
export function useProfileCommands(): ProfileCanvasCommands {
  return useCommands().profileCanvas;
}
