import type { Clock, Result } from "../base/index.ts";
import type { CapabilityApi, CapabilityId, WorkspaceShell } from "../capabilities/index.ts";
import type { ThreadId } from "../conversation/index.ts";
import type { BlobError, BlobRef } from "../records/index.ts";
import type { CancelScope, ExecService, ExecutionEnv } from "./exec.ts";
import type { ProtectedPathEntry, SandboxService } from "./sandbox.ts";
import type { ToolOutputFiles } from "./tool-output.ts";

// L2.workspace 코어의 공유 모양. 구현은 `@fresnel/core-workspace`다. 기능 패키지(cap-workspace)는 이 타입으로만 말하고,
// 구현 함수는 조립 루트가 `WorkspaceCore`(묶음)로 넘긴다. 타입은 런타임에 지워진다(값은 없다).

/**
 * `fresnel.exec`에서 이 패키지가 쓰는 메서드. 같은 `fresnel.exec`에서 cwd만 다른 env를 만든다(`envAtCwd`).
 * 쓰는 메서드를 좁혀 두면 시험용 대역이 이 목록만 구현하면 된다.
 */
export type WorkspaceEnv = Pick<ExecService, "truncateHeadOf"> &
  Pick<
    ExecutionEnv,
    | "id"
    | "cwd"
    | "absolutePath"
    | "canonicalPath"
    | "exists"
    | "fileInfo"
    | "listDir"
    | "openBinaryReader"
    | "readTextFile"
    | "readBinaryFile"
    | "writeFile"
    | "flushFile"
    | "renameFile"
    | "remove"
    | "joinPath"
    | "exec"
    | "cleanup"
  >;

/** 이미지 blob 저장소 포트. 실제 구현은 `fresnel.store`(`StoreService.putBlob`)다 */
export interface BlobSink {
  putBlob(bytes: Uint8Array, mediaType: string | null): Result<BlobRef, BlobError>;
}

/**
 * 대화마다 다른 작업 폴더를 풀어 주는 포트(open-issues M-06, plan DG.4). 실제 구현은 `fresnel.session`의
 * `query.thread(threadId).workspace`와 `fresnel.exec`의 `withCwd`다.
 */
export interface ThreadWorkspaces {
  /** 대화가 만들어질 때 저장한 작업 폴더. 값이 없거나 옛 행이면 null이다 */
  workspaceOf(threadId: ThreadId): string | null;
  /** 그 폴더를 cwd로 하는 실행 환경 */
  envAt(cwd: string): WorkspaceEnv;
  /**
   * 테스트 대화(Craft, M5c §4.8.7)의 쓰기 범위 표지. 표지가 없으면(일반 대화) undefined다. `folder`는 묶인 플러그인의 원본 폴더이고,
   * 묶이지 않았으면 null이다. 있으면 허용 root는 `craftRoots`가 정하고 작업 폴더 규칙(`workspaceOf`)은 쓰지 않는다
   */
  craftScopeOf?(threadId: ThreadId): { readonly folder: string | null } | undefined;
}

/** 허용 root. 정규 경로(심볼릭 링크를 푼 절대 경로) 목록 */
export interface AllowedRoots {
  readonly read: readonly string[];
  readonly write: readonly string[];
}

export type PathAccess = "read" | "write";

/** 경로 해석의 결과. `canonical`로 접근해야 검사한 경로와 연 경로가 같다 */
export interface ResolvedPath {
  /** 입력 경로 그대로 */
  readonly requested: string;
  /** 접근에 쓸 정규 경로. 아직 없는 대상이면 존재하는 가장 가까운 상위의 정규 경로에 나머지 마디를 붙인 값 */
  readonly canonical: string;
  readonly exists: boolean;
}

/** 경로 검사가 쓰는 의존 */
export interface RootsDeps {
  readonly env: Pick<ExecutionEnv, "absolutePath" | "canonicalPath" | "exists">;
  /**
   * 허용 root를 돌려준다. 허용 root 조회 API는 L1.tools.spec이 정한다(L2.workspace.spec §10 미결 7).
   * 그 전에는 읽기·쓰기 root 모두 `defaultRoots`가 만든 세션 cwd 하나다.
   */
  readonly roots: (context: CancelScope) => Promise<AllowedRoots>;
  /**
   * L0.sandbox 보호 경로 목록. 샌드박스 서비스가 없으면 빈 목록. `roots`는 이 호출이 허용하는 정규 root이고,
   * 샌드박스가 root별 git 항목(`.git/hooks` 등)을 더한다. 넘기지 않으면 bash를 돌리기 전에는 그 항목이 비어 있다.
   */
  readonly protectedPaths: (roots: readonly string[]) => readonly ProtectedPathEntry[];
  /**
   * 잘린 도구 출력의 파일 사본. 있으면 그 폴더가 읽기 root에 더해지고(쓰기 root에는 더하지 않는다), 없는 사본을 읽으려 하면
   * 읽기 직전에 blob에서 다시 만든다(L2.workspace.spec §4.3 [결정: 2026-11-13 사용자]).
   */
  readonly outputs?: ToolOutputFiles;
}

/** 원자적 쓰기가 쓰는 파일 시스템 메서드 */
export type AtomicEnv = Pick<
  ExecutionEnv,
  "readTextFile" | "writeFile" | "flushFile" | "renameFile" | "remove" | "exists" | "joinPath"
>;

export interface AtomicWriteOptions {
  /**
   * 있으면 이름을 바꾸기 직전에 대상 파일을 다시 읽어 이 내용과 같은지 본다. 다르거나 파일이 없어졌으면
   * `edit_conflict`로 거부하고 대상은 그대로 둔다(읽은 뒤 다른 프로세스나 `bash`가 파일을 바꾼 경우).
   */
  readonly expectedBefore?: string;
}

/**
 * ripgrep 실행 파일 경로를 얻는다. `rgPath`가 빈 문자열이 아니면 그 경로를 그대로 돌려준다(spec §6 grep.rgPath).
 * 빈 문자열이면 `fresnel.os`가 번들 바이너리를 찾는다. 실패는 값이다: `missing`은 찾지 못함, `cancelled`는 중단 신호.
 */
export type RgResolver = (
  rgPath: string,
  signal: AbortSignal | undefined,
) => Promise<Result<string, { readonly kind: "missing" | "cancelled"; readonly message: string }>>;

/**
 * 이 패키지가 읽는 설정 모양. 설정 키 `l2.workspace.*`의 소유자는 cap-workspace이므로 여기서는
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
  /** 무인 호출(`CallContext.interactive === false`)의 셸 제한 시간 상한(ms). 없으면 상한을 걸지 않는다(L0.exec.spec §3.8.1) */
  readonly unattendedTimeoutMs?: () => number;
}

/** 셸 기능의 API 객체 타입 */
export type ShellApi = CapabilityApi<typeof WorkspaceShell>;

/**
 * 코어 구현 함수 묶음. 조립 루트(apps/host)가 `@fresnel/core-workspace`의 `workspaceCore`를 넘기고, 기능 패키지는 이 값을
 * 의존 객체(`deps.core`)로 받아 부른다. 각 멤버의 모양은 코어의 함수와 같다.
 */
export interface WorkspaceCore {
  defaultRoots(
    env: Pick<ExecutionEnv, "cwd" | "canonicalPath">,
    context: CancelScope,
    outputs?: ToolOutputFiles,
  ): Promise<AllowedRoots>;
  envAtCwd(exec: Pick<ExecService, "withCwd" | "truncateHeadOf">, cwd: string): WorkspaceEnv;
  scopedDeps<S extends WorkspaceShellSettings>(
    deps: WorkspaceDeps<S>,
    threadId: ThreadId | undefined,
  ): WorkspaceDeps<S>;
  createShellApi(base: WorkspaceDeps): ShellApi;
  atomicWrite(
    env: AtomicEnv,
    path: string,
    content: string,
    context: CancelScope,
    options?: AtomicWriteOptions,
  ): Promise<void>;
  mutationKey(envId: string, canonicalPath: string): string;
  queueInCallOrder<R, T>(
    envId: string,
    resolve: () => Promise<R>,
    keyOf: (resolved: R) => string,
    run: (resolved: R) => Promise<T>,
  ): Promise<T>;
  relativeToRoots(roots: readonly string[], path: string): string;
  resolveWorkspacePath(
    deps: RootsDeps,
    requested: string,
    access: PathAccess,
    context: CancelScope,
    options?: {
      readonly variants?: boolean;
    },
  ): Promise<ResolvedPath>;
  getOrThrow<T, E extends Error>(result: Result<T, E>): T;
  characterEnd(bytes: Uint8Array, index: number): number;
  utf8ByteLength(content: string): number;
  /** 기능 메서드 본문을 실행하고 실패를 CapabilityError로 거부한다(서비스 경계) */
  guarded<T>(capability: CapabilityId, method: string, run: () => Promise<T>): Promise<T>;
}
