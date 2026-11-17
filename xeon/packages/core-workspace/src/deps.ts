import type { Clock, Result } from "@fresnel/contracts";
import type { SandboxService } from "@fresnel/contracts/services";
import type { WorkspaceEnv } from "./env.ts";
import type { BlobSink } from "./ports/blobs.ts";
import type { ThreadWorkspaces } from "./ports/threads.ts";
import type { WriteAccessPort } from "./ports/write-access.ts";
import type { RootsDeps } from "./roots.ts";

/**
 * ripgrep 실행 파일 경로를 얻는다. `rgPath`가 빈 문자열이 아니면 그 경로를 그대로 돌려준다(spec §6 grep.rgPath).
 * 빈 문자열이면 `fresnel.os`가 번들 바이너리를 찾는다. 실패는 값이다: `missing`은 찾지 못함, `cancelled`는 중단 신호.
 */
export type RgResolver = (
  rgPath: string,
  signal: AbortSignal | undefined,
) => Promise<Result<string, { readonly kind: "missing" | "cancelled"; readonly message: string }>>;

/**
 * 이 패키지가 읽는 설정 모양. 설정 키 `l2.workspace.*`의 소유자는 cap-workspace이므로(L2.workspace.spec §6) 여기서는
 * 셸 실행이 읽는 키만 선언한다. cap-workspace의 전체 설정 값은 이 모양을 포함하므로 그대로 넘어간다.
 */
export interface WorkspaceShellSettings {
  readonly shell: {
    readonly maxLines: number;
    readonly maxBytes: number;
    readonly defaultTimeoutSec: number;
  };
}

/** 서비스 조립에 필요한 의존. 플러그인이 포트에서 모아 넘기고, 시험은 대역을 넘긴다 */
export interface WorkspaceDeps<S extends WorkspaceShellSettings = WorkspaceShellSettings> {
  readonly env: WorkspaceEnv;
  readonly roots: RootsDeps;
  /** 없으면 셸 실행은 unavailable로 거부한다(격리 없이 조용히 실행하지 않는다) */
  readonly sandbox: Pick<SandboxService, "defaultPolicy" | "wrapShell"> | undefined;
  /** 샌드박스가 쓰기를 허용할 임시 디렉터리. 출력 spill 파일이 여기에 생긴다 */
  readonly tempDir: string;
  readonly clock: Clock;
  /** 호출 한 번이 읽는 유효 설정. threadId가 있으면 세션 범위를 포함한다 */
  readonly settings: (threadId: string | undefined) => S;
  /** 이미지 blob 저장소. 없으면 `workspace.images`는 unavailable이고 `read`는 이미지를 바이너리로 본다 */
  readonly blobs?: BlobSink;
  /** 대화별 작업 폴더. 없으면 모든 대화가 `env`의 cwd 하나를 쓴다(M1 동작) */
  readonly threads?: ThreadWorkspaces;
  /** ripgrep 경로 해석. 없으면 `grep`, `find`는 unavailable(detail.reason: "rg_missing")이다 */
  readonly rg?: RgResolver;
  /** 무인 호출(`CallContext.interactive === false`)의 셸 제한 시간 상한(ms). 호출마다 읽는다. 없으면 상한을 걸지 않는다(L0.exec.spec §3.8.1) */
  readonly unattendedTimeoutMs?: () => number;
  /** 작업 폴더 밖 쓰기 허용을 사람에게 묻는 포트. 없으면 묻지 않고 지금처럼 막는다(L2.workspace.spec §4.3.1) */
  readonly writeAccess?: WriteAccessPort;
  /** 사용자 홈. 막힌 경로를 쓰기 루트로 올릴 폴더(`~/.npm`, `~/Library/Caches/<앱>`)로 바꿀 때 쓴다 */
  readonly homeDir?: string;
}
