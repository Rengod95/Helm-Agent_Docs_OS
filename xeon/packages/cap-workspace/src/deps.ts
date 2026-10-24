import type { Clock } from "@xeon/contracts";
import type { SandboxService } from "@xeon/contracts/services";
import type { WorkspaceEnv } from "./env.ts";
import type { BlobSink } from "./ports/blobs.ts";
import type { ThreadWorkspaces } from "./ports/threads.ts";
import type { RootsDeps } from "./roots.ts";
import type { WorkspaceSettings } from "./settings.ts";

/** 서비스 조립에 필요한 의존. 플러그인이 포트에서 모아 넘기고, 시험은 대역을 넘긴다 */
export interface WorkspaceDeps {
  readonly env: WorkspaceEnv;
  readonly roots: RootsDeps;
  /** 없으면 셸 실행은 unavailable로 거부한다(격리 없이 조용히 실행하지 않는다) */
  readonly sandbox: Pick<SandboxService, "defaultPolicy" | "wrapShell"> | undefined;
  /** 샌드박스가 쓰기를 허용할 임시 디렉터리. 출력 spill 파일이 여기에 생긴다 */
  readonly tempDir: string;
  readonly clock: Clock;
  /** 호출 한 번이 읽는 유효 설정. threadId가 있으면 세션 범위를 포함한다 */
  readonly settings: (threadId: string | undefined) => WorkspaceSettings;
  /** 이미지 blob 저장소. 없으면 `workspace.images`는 unavailable이고 `read`는 이미지를 바이너리로 본다 */
  readonly blobs?: BlobSink;
  /** 대화별 작업 폴더. 없으면 모든 대화가 `env`의 cwd 하나를 쓴다(M1 동작) */
  readonly threads?: ThreadWorkspaces;
}
