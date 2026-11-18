import type { ThreadId } from "@fresnel/contracts/conversation";
import type {
  WorkspaceCore,
  WorkspaceDeps as CoreWorkspaceDeps,
} from "@fresnel/contracts/services";
import type { RewindCapture } from "./rewind/capture.ts";
import type { WorkspaceSettings } from "./settings.ts";

// 도구가 쓰는 의존. 서비스 의존(F의 WorkspaceDeps)에 l2.workspace 설정 전체 모양을 입히고, 경로·쓰기·셸 구현 묶음(`core`)을 더한다.
// 구현 묶음은 조립 루트가 `core` 옵션으로 넘기며, 이 패키지는 구현을 import하지 않는다(DR-15).
// 읽기·쓰기·검색·이미지 도구는 설정의 read, grep, images 키를 읽고, 셸 실행은 shell 키만 읽는다.
export type WorkspaceDeps = CoreWorkspaceDeps<WorkspaceSettings> & {
  readonly core: WorkspaceCore;
  /**
   * 편집 도구의 원본 저장(L2.workspace.spec §4.8). 없으면 쓰기는 원본을 저장하지 않고 그대로 간다
   * (blob 포트나 세션 포트가 없는 조립).
   */
  readonly rewind?: RewindCapture;
};

/**
 * 호출한 대화의 작업 폴더로 의존을 맞춘다. `core.scopedDeps`는 `core`를 싣지 않는 타입을 돌려주므로 여기서 다시 붙인다.
 * `rewind`도 그대로 옮긴다.
 */
export function scopeDeps(deps: WorkspaceDeps, threadId: ThreadId | undefined): WorkspaceDeps {
  return {
    ...deps.core.scopedDeps(deps, threadId),
    core: deps.core,
    ...(deps.rewind === undefined ? {} : { rewind: deps.rewind }),
  };
}
