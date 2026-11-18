import type { WorkspaceDeps as CoreWorkspaceDeps } from "@fresnel/core-workspace";
import type { RewindCapture } from "./rewind/capture.ts";
import type { WorkspaceSettings } from "./settings.ts";

// 도구가 쓰는 의존. 서비스 의존(`@fresnel/core-workspace`의 WorkspaceDeps)에 l2.workspace 설정 전체 모양을 입힌다.
// 읽기·쓰기·검색·이미지 도구는 설정의 read, grep, images 키를 읽고, 셸 실행은 shell 키만 읽는다.
export interface WorkspaceDeps extends CoreWorkspaceDeps<WorkspaceSettings> {
  /**
   * 편집 도구의 원본 저장(L2.workspace.spec §4.8). 없으면 쓰기는 원본을 저장하지 않고 그대로 간다
   * (blob 포트나 세션 포트가 없는 조립).
   */
  readonly rewind?: RewindCapture;
}
