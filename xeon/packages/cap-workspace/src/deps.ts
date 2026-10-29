import type { Clock, Result } from "@xeon/contracts";
import type { SandboxService } from "@xeon/contracts/services";
import type { WorkspaceEnv } from "./env.ts";
import type { BlobSink } from "./ports/blobs.ts";
import type { ThreadWorkspaces } from "./ports/threads.ts";
import type { RootsDeps } from "./roots.ts";
import type { WorkspaceSettings } from "./settings.ts";

/**
 * ripgrep 실행 파일 경로를 얻는다. `rgPath`가 빈 문자열이 아니면 그 경로를 그대로 돌려준다(spec §6 grep.rgPath).
 * 빈 문자열이면 `xeon.os`가 번들 바이너리를 찾는다. 실패는 값이다: `missing`은 찾지 못함, `cancelled`는 중단 신호.
 */
export type RgResolver = (
  rgPath: string,
  signal: AbortSignal | undefined,
) => Promise<Result<string, { readonly kind: "missing" | "cancelled"; readonly message: string }>>;

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
  /** ripgrep 경로 해석. 없으면 `grep`, `find`는 unavailable(detail.reason: "rg_missing")이다 */
  readonly rg?: RgResolver;
}
